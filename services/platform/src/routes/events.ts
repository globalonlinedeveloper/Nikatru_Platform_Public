import { Hono } from 'hono';
import type { AnalyticsBatch, AnalyticsEvent, AppEnv, EdgeGeo } from '../types';
import { nowIso } from '../lib/d1';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling, withinRateLimit } from '../lib/edge-ceiling';

// ─────────────────────────────────────────────────────────────────────────────
// G-12 — first-party product analytics ingest ([ADR 011]).
//   PUBLIC POST /v1/events   — batched, pseudonymous, consent-gated CLIENT-side.
//   PUBLIC POST /v1/consent  — the DPDP consent artifact each event references.
//
// Both are unauthenticated on purpose: analytics is pseudonymous and pre-login
// events (first_launch, paywall_viewed) are the most valuable ones. There is no
// user identity here to protect — the protections are the rate limiter, the
// hard batch caps, and the fact that nothing here can read or mutate user data.
//
// PRIVACY INVARIANTS — these are the reason this file exists rather than a
// generic ingest:
//   • CF-Connecting-IP is NEVER read and NEVER stored. Coarse geo comes from the
//     `request.cf` object, which the runtime populates unconditionally. Rows are
//     therefore PSEUDONYMOUS, not anonymous — the privacy policy says so.
//   • `anon_id` is the client's install id. Nothing here writes a mapping from
//     anon_id to a user_id, and nothing ever may: that mapping would convert
//     this table into erasure-subject personal data ([ADR 020]).
//   • `params` are enumerable values only. The client sanitizes; we re-check.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard caps. A batch beyond these is a bug or an abuser, not a real client. */
const MAX_EVENTS_PER_BATCH = 100;
const MAX_EVENT_NAME_LEN = 64;
const MAX_ID_LEN = 64;
const MAX_PARAMS_JSON_LEN = 2048;

/**
 * ⚠️ THE TWO PARAM CAPS MIRROR `packages/core/lib/src/analytics/analytics.dart`
 * — `kMaxParamCount` and `kMaxParamValueLength`. Dart and TypeScript cannot
 * share a literal, so the pair is asserted to AGREE by
 * test/analytics-contract.test.ts, which reads the Dart source and fails when
 * either side moves alone. Without the count cap the server enforced no bound at
 * all: the client stopped at 12 keys and a hand-rolled POST stored 200.
 */
export const MAX_PARAM_COUNT = 12;
export const MAX_PARAM_VALUE_LEN = 64;

/**
 * Byte ceilings on the RAW REQUEST BODY, enforced before it is parsed.
 *
 * `MAX_EVENTS_BODY_BYTES` is sized from the caps above rather than picked: 100
 * events × (2048 bytes of params + ~400 bytes of ids, name and timestamps) is
 * ≈ 245 KB, so 256 KiB accepts every batch the caps permit and nothing beyond.
 * A consent artifact is a dozen short fields, so it gets a far tighter one.
 */
export const MAX_EVENTS_BODY_BYTES = 256 * 1024;
export const MAX_CONSENT_BODY_BYTES = 8 * 1024;

const events = new Hono<AppEnv>();

/** Coarse geo from the `request.cf` object — never from a header. */
function edgeGeo(c: { req: { raw: Request } }): EdgeGeo {
  const cf = (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf;
  if (!cf) return {};
  return {
    country: typeof cf.country === 'string' ? cf.country : undefined,
    region: typeof cf.region === 'string' ? cf.region : undefined,
    city: typeof cf.city === 'string' ? cf.city : undefined,
  };
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/**
 * Keep only enumerable scalars — mirrors the client's sanitizer. Defence in
 * depth: free text in D1 is a posture that cannot be retracted once written.
 *
 * 🔴 THE COUNT LIMB IS NEW AND IT IS THE POINT. "The client sanitizes; we
 * re-check" was true of the value TYPE and the value LENGTH and false of the
 * KEY COUNT: `kMaxParamCount` stopped honest clients at 12 while a hand-rolled
 * POST stored every key it sent (200, measured). The JSON-length cap did not
 * cover it either — 200 short keys serialise well under 2048 bytes, so the only
 * thing that ever bounded the column width was the client being ours.
 *
 * The break is placed exactly where the Dart mirror puts it — on the count of
 * ACCEPTED keys, before the next entry is examined — so a map of 12 valid keys
 * followed by 100 rejected ones behaves identically on both sides.
 */
function sanitizeParams(v: unknown): string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return '{}';
  const out: Record<string, string | number | boolean> = {};
  let kept = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (kept >= MAX_PARAM_COUNT) break;
    if (typeof val === 'boolean' || typeof val === 'number') out[k] = val;
    else if (typeof val === 'string' && val.length <= MAX_PARAM_VALUE_LEN) out[k] = val;
    else continue;
    kept++;
  }
  const json = JSON.stringify(out);
  return json.length <= MAX_PARAMS_JSON_LEN ? json : '{}';
}

/**
 * The two-key cost circuit breaker. BOTH halves now live in lib/edge-ceiling.ts,
 * because GET /config/:app needs the identical server-derived key and two
 * near-identical definitions is exactly the drift F-2 exists to stop. Their
 * reasoning — why the Rate Limiting binding rather than KV, why `colo`+`asn`
 * cannot be chosen by the caller, why absence fails OPEN, and the honest limit
 * of a per-colo eventually-consistent limiter — is recorded there, once.
 *
 * ⚠️ THE ORDER IS PART OF THE PROTECTION, AND IT IS STRICTER THAN IT WAS.
 * The server-derived ceiling needs NOTHING from the body, so it is now evaluated
 * BEFORE the body is read at all (see each handler). It used to run after
 * `c.req.json()` had already materialised whatever the caller chose to send, so
 * the breaker was grading a request the isolate had already paid for in full.
 * The fairness half still runs after the parse, because its key IS body-derived
 * — and it is still reached only when the ceiling has already allowed.
 *
 * A consequence, stated here rather than discovered later: the ceiling is now
 * charged for malformed bodies too. That is the correct direction. A flood of
 * garbage costs this isolate the same work as a flood of valid batches, and the
 * key it is charged against is the one a caller cannot rotate out of.
 */
// 429 with ok:false — an honest rejection. The client keeps its queue and
// retries later; pretending we took the batch would lose it. The batch route
// also says `received: 0`, because "how many did you take" is a question its
// success shape answers and a rejection must answer the same way; /v1/consent
// posts one artifact and has no such field to be consistent with.
const RATE_LIMITED_BATCH = { ok: false, error: 'rate_limited', received: 0 } as const;
const RATE_LIMITED = { ok: false, error: 'rate_limited' } as const;

events.post('/events', async (c) => {
  // 1 · SHED FIRST, ON A KEY THAT NEEDS NO BODY. Nothing below this line runs
  //     for a caller already over the per-(colo, asn) ceiling — including the
  //     read.
  if (!(await withinEdgeCeiling(c.env.EVENTS_CEILING_LIMITER, c))) {
    return c.json(RATE_LIMITED_BATCH, 429);
  }

  // 2 · BOUND THE BODY, THEN PARSE IT. `c.req.json()` used to be the first
  //     statement of this handler: the 413 below and the breaker above both
  //     graded values that existed only because the isolate had already
  //     materialised the whole request. Reproduced at HEAD — an 8 MB POST was
  //     parsed in full and then answered 429.
  const read = await readBoundedBody(c.req.raw, MAX_EVENTS_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  let body: AnalyticsBatch;
  try {
    body = JSON.parse(read.text) as AnalyticsBatch;
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }

  const appId = str(body?.app_id, MAX_ID_LEN);
  const list = Array.isArray(body?.events) ? body.events : [];
  if (!appId) return c.json({ error: 'missing_app_id' }, 400);
  if (list.length === 0) return c.json({ ok: true, received: 0 });
  if (list.length > MAX_EVENTS_PER_BATCH) {
    return c.json({ error: 'batch_too_large' }, 413);
  }

  // Bucket by app + install so one noisy client cannot starve the portfolio.
  // NOT `?? 'unknown'`: that collapsed every client whose install-id provider
  // returned null into ONE bucket, capping them together at 120/min while the
  // rotation bypass stayed wide open — and wrote rows with anon_id='unknown'.
  // A batch whose first event has no usable anon_id is malformed: the column is
  // NOT NULL (migrations/0002_analytics.sql) and the wire type declares it
  // required, so this is a 400, not a merge.
  const firstAnon = str(list[0]?.anon_id, MAX_ID_LEN);
  if (!firstAnon) return c.json({ error: 'missing_anon_id' }, 400);
  // 3 · The body-derived half, reached only once the ceiling has allowed.
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `${appId}:${firstAnon}`))) {
    return c.json(RATE_LIMITED_BATCH, 429);
  }

  const geo = edgeGeo(c);
  const serverTs = nowIso();

  const stmt = c.env.PLATFORM_DB.prepare(
    // ON CONFLICT(event_id) DO NOTHING — NOT `INSERT OR IGNORE`, which also
    // swallows NOT NULL / CHECK / FK violations, so genuine corruption would be
    // indistinguishable from a duplicate retry.
    `INSERT INTO events (
       event_id, app_id, anon_id, session_id, platform, app_version,
       event, params, client_ts, server_ts, country, region, city, consent_id
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(event_id) DO NOTHING`,
  );

  const rows = [];
  for (const e of list as AnalyticsEvent[]) {
    const eventId = str(e?.event_id, MAX_ID_LEN);
    const name = str(e?.event, MAX_EVENT_NAME_LEN);
    // Each row carries its OWN anon_id — never one borrowed from another event.
    // Borrowing attributed one install's events to a different install id.
    const anonId = str(e?.anon_id, MAX_ID_LEN);
    if (!eventId || !name || !anonId) continue; // skip malformed, keep the rest
    rows.push(
      stmt.bind(
        eventId,
        appId,
        anonId,
        str(e?.session_id, MAX_ID_LEN),
        str(e?.platform, 32),
        str(e?.app_version, 32),
        name,
        sanitizeParams(e?.params),
        str(e?.ts, 40), // client clock — untrusted, stored for skew analysis
        serverTs, // authoritative
        geo.country ?? null,
        geo.region ?? null,
        geo.city ?? null,
        str(e?.consent_id, MAX_ID_LEN),
      ),
    );
  }
  if (rows.length === 0) return c.json({ ok: true, received: 0 });

  try {
    await c.env.PLATFORM_DB.batch(rows);
  } catch (err) {
    console.error(`[events] rid=${c.get('requestId') ?? '-'}`, err);
    // 503 so the client KEEPS the batch and retries — dedup makes that safe.
    return c.json({ error: 'ingest_failed' }, 503);
  }
  // `received`, NOT `accepted`: this is the count of well-formed events taken
  // in, which is not the number of rows inserted — duplicates are dropped by
  // ON CONFLICT and D1's batch does not report per-statement row counts. Live
  // verification sent 2 events sharing one event_id and correctly stored 1, so
  // a field named "accepted" would have overstated what happened.
  return c.json({ ok: true, received: rows.length });
});

events.post('/consent', async (c) => {
  // Same three steps, same order, same reasons as /v1/events above: shed on the
  // server-derived key first, bound the body, then parse. A consent artifact is
  // a dozen short fields, so its ceiling is far tighter than the batch route's —
  // there is no legitimate 256 KB consent record.
  if (!(await withinEdgeCeiling(c.env.EVENTS_CEILING_LIMITER, c))) {
    return c.json(RATE_LIMITED, 429);
  }

  const read = await readBoundedBody(c.req.raw, MAX_CONSENT_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(read.text) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }

  const consentId = str(body?.consent_id, MAX_ID_LEN);
  const appId = str(body?.app_id, MAX_ID_LEN);
  const anonId = str(body?.anon_id, MAX_ID_LEN);
  const purpose = str(body?.purpose, 32);
  const policyVersion = str(body?.policy_version, 64);
  if (!consentId || !appId || !anonId || !purpose || !policyVersion) {
    return c.json({ error: 'missing_fields' }, 400);
  }
  // Same two-key breaker as /v1/events: the consent row is a D1 write on the
  // same unauthenticated surface, so a rotating caller must be shed here too.
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `consent:${appId}:${anonId}`))) {
    return c.json(RATE_LIMITED, 429);
  }

  try {
    // Append-only: a withdrawal is a NEW row with granted=0, never an UPDATE.
    // The conflict clause is idempotency for a retried request, nothing more.
    await c.env.PLATFORM_DB.prepare(
      `INSERT INTO consent_artifacts (
         consent_id, app_id, anon_id, purpose, granted,
         policy_version, app_version, platform, client_ts, server_ts
       ) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(consent_id) DO NOTHING`,
    )
      .bind(
        consentId,
        appId,
        anonId,
        purpose,
        body?.granted === true ? 1 : 0,
        policyVersion,
        str(body?.app_version, 32),
        str(body?.platform, 32),
        str(body?.ts, 40),
        nowIso(),
      )
      .run();
  } catch (err) {
    console.error(`[consent] rid=${c.get('requestId') ?? '-'}`, err);
    return c.json({ error: 'consent_failed' }, 503);
  }
  return c.json({ ok: true });
});

export default events;
