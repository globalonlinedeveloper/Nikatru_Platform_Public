import { Hono } from 'hono';
import type { AnalyticsBatch, AnalyticsEvent, AppEnv, EdgeGeo } from '../types';
import { nowIso } from '../lib/d1';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling, withinRateLimit } from '../lib/edge-ceiling';
import { requestGeo } from '../../../_shared/src/geo';
// ONE registry predicate for the whole Worker. `routes/config.ts`,
// `routes/entitlements.ts` and both write routes here now ask the same question
// of the same source — an app the shared server will answer for is one thing,
// not four spellings of it that can drift apart.
import { isKnownApp } from '../config';
import { UNRELEASED_BUILD, refusesStamp } from '../lib/build-stamp';

// ─────────────────────────────────────────────────────────────────────────────
// G-12 — first-party product analytics ingest ([ADR 011]).
//   PUBLIC POST /v1/events   — batched, pseudonymous, consent-gated on BOTH
//                              sides: the client collects nothing before a
//                              grant, and this route stores nothing for an
//                              install whose latest analytics artifact is
//                              missing or a withdrawal (see `consentVerdicts`).
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

/**
 * 🔴 LOWERED 100 → 50 ON 2026-08-01, AND THE OLD VALUE WAS NEVER SAFE.
 *
 * D1's documented ceiling is **50 queries per Worker invocation on Free**
 * (`tooling/ceilings.json` → `d1.queriesPerInvocation`, sourced and dated). The
 * handler below issues ONE `PLATFORM_DB.batch()` holding one INSERT per
 * well-formed event, so a full batch at the old cap asked for 100 statements
 * against a 50-query limit — double, with nothing in the tree able to say so,
 * for as long as the constant named no ceiling.
 *
 * ⚠️ WHY 50 AND NOT "MEASURE FIRST". Cloudflare does NOT document whether a
 * `batch()` of N statements spends ONE query or N (the limits page states the 50
 * without qualifying batches; the Binding API page describes `batch()` purely as
 * a latency optimisation; the pricing page mentions batches only for ROW
 * counting). That ambiguity is recorded verbatim on the ceiling row. Under the
 * one-query reading 100 was fine; under the per-statement reading it was a 500
 * on the shared database every app in the portfolio depends on — and the second
 * reading fails ONLY in production, where it cannot be observed in CI. So the
 * cap takes the worst case.
 *
 * AND IT COSTS NOTHING. The first-party client flushes at `kFlushBatchSize = 20`
 * (`packages/core/lib/src/analytics/analytics_recorder.dart`), so the cap still
 * leaves over 2× headroom over the largest batch any shipped app actually sends.
 * The alternative — leaving 100 in place until someone runs the miniflare probe
 * — meant shipping a server whose own cap exceeded its platform's documented
 * limit, indefinitely, to avoid a change that no client can notice.
 *
 * 🔴 50 → 49 ON 2026-10-01: THE CONSENT READ IS A QUERY TOO. The handler now
 * issues ONE indexed read of `consent_artifacts` per batch before the write
 * (`CONSENT_READS_PER_BATCH`, below), so a full batch is 1 + N statements. At
 * 50 that was 51 against the worst-case reading of the 50 — the B-6 defect
 * again, one query over. test/events.test.ts counts a full batch's statements
 * against `tooling/ceilings.json` and fails when the sum passes the ceiling.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const MAX_EVENTS_PER_BATCH = 49;
/** @ceiling none — a COUNT of statements this handler issues besides its
 *  inserts, not a vendor limit. It is the `+ 1` that MAX_EVENTS_PER_BATCH above
 *  is sized against, exported so the test that sums the two cannot drift. */
export const CONSENT_READS_PER_BATCH = 1;
/** @ceiling none — bounds the WIDTH of one `events.event` value, not a platform
 *  resource. Sized to the locked event taxonomy, which has no name near 64. */
const MAX_EVENT_NAME_LEN = 64;
/** @ceiling none — an identifier column's width (UUIDv4 is 36). Bounds the shape
 *  of one field; no D1, KV or Workers limit moves with it. */
const MAX_ID_LEN = 64;
/** @ceiling none — the serialised width of one `events.params` cell. An input
 *  shape cap; the resource it touches (row size) has a 2 MB D1 ceiling this is
 *  three orders of magnitude below, so it can never be the binding constraint. */
const MAX_PARAMS_JSON_LEN = 2048;

/**
 * ⚠️ THE TWO PARAM CAPS MIRROR `packages/core/lib/src/analytics/analytics.dart`
 * — `kMaxParamCount` and `kMaxParamValueLength`. Dart and TypeScript cannot
 * share a literal, so the pair is asserted to AGREE by
 * test/analytics-contract.test.ts, which reads the Dart source and fails when
 * either side moves alone. Without the count cap the server enforced no bound at
 * all: the client stopped at 12 keys and a hand-rolled POST stored 200.
 */
/** @ceiling none — mirrors the Dart client's `kMaxParamCount`. Its right-hand
 *  side is the OTHER LANGUAGE, not a vendor limit, and test/analytics-contract.test.ts
 *  is the assertion that keeps the pair equal. */
export const MAX_PARAM_COUNT = 12;
/** @ceiling none — mirrors the Dart client's `kMaxParamValueLength`, same pair,
 *  same test. An enumerable value that needs 64 characters is not enumerable. */
export const MAX_PARAM_VALUE_LEN = 64;

/**
 * Byte ceilings on the RAW REQUEST BODY, enforced before it is parsed.
 *
 * `MAX_EVENTS_BODY_BYTES` is sized from the caps above rather than picked: at the
 * cap of 49 events × (2048 bytes of params + ~400 bytes of ids, name and
 * timestamps) it is ≈ 120 KB, so 256 KiB accepts every batch the caps permit and
 * nothing beyond. (It was sized against the old cap of 100 at ≈ 245 KB and is
 * deliberately NOT tightened alongside it: the headroom is now 2×, and a byte
 * ceiling that tracked the event cap exactly would reject a legitimate batch of
 * unusually verbose — but individually legal — params.)
 *
 * A consent artifact is a dozen short fields, so it gets a far tighter one.
 *
 * ⚠️ THE VENDOR CEILING ABOVE BOTH IS 100 MB. The edge will hand this Worker a
 * body that large (`workers.maxRequestBodySize`, Free), so these two constants
 * are the ONLY thing between an isolate and 100 MB of work it has already been
 * charged for — which is why they are enforced before `JSON.parse`, not after.
 */
/** @ceiling workers.maxRequestBodySize lte */
export const MAX_EVENTS_BODY_BYTES = 256 * 1024;
/** @ceiling workers.maxRequestBodySize lte */
export const MAX_CONSENT_BODY_BYTES = 8 * 1024;

const events = new Hono<AppEnv>();

/** Coarse geo from the `request.cf` object — never from a header. Read through
 *  `requestGeo` (services/_shared/src/geo.ts), the one module that reads `.cf`. */
function edgeGeo(c: { req: { raw: Request } }): EdgeGeo {
  const { country, region, city } = requestGeo(c.req.raw);
  return { country, region, city };
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
// 422 with ok:false — PRODUCTION ONLY, and the one refusal the client must NOT
// retry: the build's stamp cannot change while it runs, so the next send would
// be refused identically. See lib/build-stamp.ts for which stamps production
// takes and why; packages/core's AnalyticsRecorder stops sending on this code.
const UNRELEASED_BATCH = { ok: false, error: UNRELEASED_BUILD, received: 0 } as const;
const UNRELEASED = { ok: false, error: UNRELEASED_BUILD } as const;

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 CONSENT IS ENFORCED HERE, NOT ONLY IN THE APP (2026-10-01).
//
// Until this date the handler never read `consent_artifacts`: `consent_id` was
// optional and stored unverified, and a batch from an install whose latest
// artifact was `granted=0` was stored like any other. "Only after consent"
// (tooling/legal/data-inventory.json, `table:platform_db.events`) was true of
// OUR client and of nothing else — a stamped app that forgot the gate, an old
// or forked build of this public repo, or a queue flushed after withdrawal all
// stored usage rows for people who had not consented.
//
// The rule, per (app_id, anon_id) — the LATEST `purpose='analytics'` artifact
// decides, because the trail is append-only and a withdrawal is a newer row:
//   none            → the event is dropped; 409 `consent_not_recorded` when
//                     nothing in the batch survives. RETRYABLE: the client
//                     keeps its queue, posts its artifact, and re-sends.
//   granted = 0     → the event is dropped; 403 `consent_withdrawn` when
//                     nothing survives. NOT retryable: the client drops its
//                     queue, because nothing collected under it may land.
//   granted = 1     → stored, exactly as before.
// A batch whose survivors are not empty is a 200 for the survivors. Our client
// sends one install per batch, so a split batch is not a real client — but
// dropping a stranger's rows must not cost an install with consent its own.
//
// ⚠️ ONE READ, NOT ONE PER EVENT. The batch's distinct anon_ids travel as ONE
// bound JSON array through `json_each` (inline at its `.prepare`, where
// assert-d1-sql-inventory reads it), each resolved by a correlated
// `ORDER BY server_ts DESC LIMIT 1` that `idx_consent_lookup`
// (migrations/0002_analytics.sql) serves as an index search with no sort —
// test/events.test.ts asserts the plan. `rowid DESC` breaks a same-millisecond
// tie toward the row inserted last, which is the decision taken last.
// ─────────────────────────────────────────────────────────────────────────────
export const CONSENT_NOT_RECORDED = 'consent_not_recorded';
export const CONSENT_WITHDRAWN = 'consent_withdrawn';
const CONSENT_NOT_RECORDED_BATCH = { ok: false, error: CONSENT_NOT_RECORDED, received: 0 } as const;
const CONSENT_WITHDRAWN_BATCH = { ok: false, error: CONSENT_WITHDRAWN, received: 0 } as const;

type ConsentVerdict = 'granted' | typeof CONSENT_NOT_RECORDED | typeof CONSENT_WITHDRAWN;

events.post('/events', async (c) => {
  // 1 · SHED FIRST, ON A KEY THAT NEEDS NO BODY. Nothing below this line runs
  //     for a caller already over the per-(colo, asn) ceiling — including the
  //     read.
  if (!(await withinEdgeCeiling(c.env.EVENTS_CEILING_LIMITER, c, 'EVENTS_CEILING_LIMITER'))) {
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
  // [pipeline B-4a] AN UNREGISTERED app_id IS A 404, AND WRITES NOTHING.
  // Until 2026-08-03 this route took ANY string of ≤64 chars and bound it
  // straight into `events.app_id`, while `routes/config.ts` has always answered
  // 404 for an app it does not know. That asymmetry meant the ONE shared
  // database behind the whole portfolio accepted rows attributed to apps that
  // do not exist — unattributable storage against a 5 GB account-wide ceiling,
  // on an unauthenticated route, with no way to tell a typo from a probe.
  //
  // 404 rather than 400: it is the same answer `GET /config/<unknown>` already
  // gives for the same question ("is this an app?"), and a caller that cannot
  // distinguish "unknown app" from "malformed request" cannot act differently on
  // them anyway. Placed BEFORE the empty-list short-circuit below on purpose —
  // an unregistered app posting zero events must not receive `{ ok: true }` and
  // conclude the rail is working.
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  // [pipeline B-16] Attribution, set the moment the id is VALIDATED and not
  // before — everything downstream (this route's own catch, and `app.onError`
  // for anything it does not catch) can now name the app.
  c.set('appId', appId);
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
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `${appId}:${firstAnon}`, 'EVENTS_LIMITER'))) {
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

  // Each bound row keeps the install it belongs to, so the consent verdict
  // below can drop exactly the rows it refuses and no others.
  const rows: Array<{ anonId: string; stmt: D1PreparedStatement }> = [];
  for (const e of list as AnalyticsEvent[]) {
    const eventId = str(e?.event_id, MAX_ID_LEN);
    const name = str(e?.event, MAX_EVENT_NAME_LEN);
    // Each row carries its OWN anon_id — never one borrowed from another event.
    // Borrowing attributed one install's events to a different install id.
    const anonId = str(e?.anon_id, MAX_ID_LEN);
    if (!eventId || !name || !anonId) continue; // skip malformed, keep the rest
    const appVersion = str(e?.app_version, 32);
    // ⏱ 2026-09-26 — one unreleased row refuses the WHOLE batch, before
    // anything is written. One build stamps one version, so a mixed batch is
    // not a real client, and a partial write would leave the rows the
    // provenance monitor reddens on.
    if (refusesStamp(c.env, 'events', appVersion)) return c.json(UNRELEASED_BATCH, 422);
    rows.push({
      anonId,
      stmt: stmt.bind(
        eventId,
        appId,
        anonId,
        str(e?.session_id, MAX_ID_LEN),
        str(e?.platform, 32),
        appVersion,
        name,
        sanitizeParams(e?.params),
        str(e?.ts, 40), // client clock — untrusted, stored for skew analysis
        serverTs, // authoritative
        geo.country ?? null,
        geo.region ?? null,
        geo.city ?? null,
        str(e?.consent_id, MAX_ID_LEN),
      ),
    });
  }
  if (rows.length === 0) return c.json({ ok: true, received: 0 });

  // 4 · CONSENT, AFTER THE FAIRNESS LIMITER AND BEFORE ANY WRITE. Placed after
  //     the stamp refusal on purpose: that one costs no query, this one does.
  //     The prepare stays OUTSIDE the try, like the INSERT's above, so an
  //     unbound PLATFORM_DB still reaches `app.onError` rather than a 503.
  // The latest analytics decision for each install named in the batch.
  const lookup = c.env.PLATFORM_DB.prepare(
    `SELECT j.value AS anon_id,
       (SELECT ca.granted FROM consent_artifacts AS ca
         WHERE ca.app_id = ? AND ca.anon_id = j.value AND ca.purpose = 'analytics'
         ORDER BY ca.server_ts DESC, ca.rowid DESC
         LIMIT 1) AS granted
       FROM json_each(?) AS j`,
  );
  let verdicts: Map<string, ConsentVerdict>;
  try {
    verdicts = await consentVerdicts(lookup, appId, rows.map((r) => r.anonId));
  } catch (err) {
    console.error(
      `[events] rid=${c.get('requestId') ?? '-'} app=${appId} release=${c.env.RELEASE ?? '-'} consent read failed`,
      err,
    );
    // 503, the same answer as a failed write: nothing was stored, so the
    // client KEEPS the batch and retries.
    return c.json({ error: 'ingest_failed' }, 503);
  }
  const permitted = rows.filter((r) => verdicts.get(r.anonId) === 'granted');
  const dropped = rows.length - permitted.length;
  if (dropped > 0) {
    let notRecorded = 0;
    for (const r of rows) if (verdicts.get(r.anonId) === CONSENT_NOT_RECORDED) notRecorded++;
    // Counts and the app only. An anon_id is never logged: the log would then
    // be a second, unswept copy of the identifier this table is keyed on.
    console.warn(
      `[events] rid=${c.get('requestId') ?? '-'} app=${appId} release=${c.env.RELEASE ?? '-'} consent refused ` +
        `${CONSENT_NOT_RECORDED}=${notRecorded} ${CONSENT_WITHDRAWN}=${dropped - notRecorded}`,
    );
    if (permitted.length === 0) {
      // A missing artifact wins over a withdrawal in a split batch: 409 is the
      // answer the client can ACT on (post consent, re-send), and the re-send
      // drops the withdrawn install's rows again on its own.
      return notRecorded > 0
        ? c.json(CONSENT_NOT_RECORDED_BATCH, 409)
        : c.json(CONSENT_WITHDRAWN_BATCH, 403);
    }
  }

  try {
    await c.env.PLATFORM_DB.batch(permitted.map((r) => r.stmt));
  } catch (err) {
    // [pipeline B-16] `app=` and `release=`. This line was the plan's recorded
    // failing input: an ingest failure on the shared Worker logged a request id
    // and nothing else, so "the analytics rail is dropping batches" could be
    // seen but never attributed to an app or to a deploy.
    console.error(
      `[events] rid=${c.get('requestId') ?? '-'} app=${appId} release=${c.env.RELEASE ?? '-'} ingest failed`,
      err,
    );
    // 503 so the client KEEPS the batch and retries — dedup makes that safe.
    return c.json({ error: 'ingest_failed' }, 503);
  }
  // `received`, NOT `accepted`: this is the count of well-formed events taken
  // in, which is not the number of rows inserted — duplicates are dropped by
  // ON CONFLICT and D1's batch does not report per-statement row counts. Live
  // verification sent 2 events sharing one event_id and correctly stored 1, so
  // a field named "accepted" would have overstated what happened. Rows the
  // consent check refused are not "taken in", so they are not counted.
  return c.json({ ok: true, received: permitted.length });
});

/**
 * Resolve each distinct install in the batch to its LATEST analytics decision,
 * in ONE query. See the block above `CONSENT_NOT_RECORDED` for the rule.
 */
async function consentVerdicts(
  lookup: D1PreparedStatement,
  appId: string,
  anonIds: readonly string[],
): Promise<Map<string, ConsentVerdict>> {
  const distinct = [...new Set(anonIds)];
  const { results } = await lookup
    .bind(appId, JSON.stringify(distinct))
    .all<{ anon_id: string; granted: number | null }>();
  const out = new Map<string, ConsentVerdict>();
  for (const id of distinct) out.set(id, CONSENT_NOT_RECORDED);
  for (const r of results ?? []) {
    if (r.granted === null || r.granted === undefined) continue;
    out.set(r.anon_id, Number(r.granted) === 1 ? 'granted' : CONSENT_WITHDRAWN);
  }
  return out;
}

events.post('/consent', async (c) => {
  // Same three steps, same order, same reasons as /v1/events above: shed on the
  // server-derived key first, bound the body, then parse. A consent artifact is
  // a dozen short fields, so its ceiling is far tighter than the batch route's —
  // there is no legitimate 256 KB consent record.
  if (!(await withinEdgeCeiling(c.env.EVENTS_CEILING_LIMITER, c, 'EVENTS_CEILING_LIMITER'))) {
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
  // [pipeline B-4a], the second write route. `consent_artifacts` is the table
  // the DPDP §6(3) trail is kept in, so an unattributable row here is worse than
  // an unattributable analytics row: a consent record naming an app that does
  // not exist is evidence of nothing, and it cannot be cleaned up without
  // deciding whether it was ever real.
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId); // [pipeline B-16], same rule as /v1/events above.
  // Same two-key breaker as /v1/events: the consent row is a D1 write on the
  // same unauthenticated surface, so a rotating caller must be shed here too.
  if (
    !(await withinRateLimit(c.env.EVENTS_LIMITER, `consent:${appId}:${anonId}`, 'EVENTS_LIMITER'))
  ) {
    return c.json(RATE_LIMITED, 429);
  }
  const appVersion = str(body?.app_version, 32);
  // ⏱ 2026-09-26 — same rule as /v1/events; `e2e-*` also passes here, because
  // e2e.yml's live drive writes consent rows to production and purges them.
  if (refusesStamp(c.env, 'consent_artifacts', appVersion)) return c.json(UNRELEASED, 422);

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
        appVersion,
        str(body?.platform, 32),
        str(body?.ts, 40),
        nowIso(),
      )
      .run();
  } catch (err) {
    console.error(
      `[consent] rid=${c.get('requestId') ?? '-'} app=${appId} release=${c.env.RELEASE ?? '-'} write failed`,
      err,
    );
    return c.json({ error: 'consent_failed' }, 503);
  }
  return c.json({ ok: true });
});

export default events;
