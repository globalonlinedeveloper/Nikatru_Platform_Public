import { Hono } from 'hono';
import type { AnalyticsBatch, AnalyticsEvent, AppEnv, EdgeGeo } from '../types';
import { nowIso } from '../lib/d1';

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

/** Keep only enumerable scalars — mirrors the client's sanitizer. Defence in
 *  depth: free text in D1 is a posture that cannot be retracted once written. */
function sanitizeParams(v: unknown): string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return '{}';
  const out: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'boolean' || typeof val === 'number') out[k] = val;
    else if (typeof val === 'string' && val.length <= 64) out[k] = val;
  }
  const json = JSON.stringify(out);
  return json.length <= MAX_PARAMS_JSON_LEN ? json : '{}';
}

/**
 * Cost circuit breaker. Deliberately the Rate Limiting binding and NOT KV:
 * a KV counter is eventually consistent with a ~60s edge cache, so under the
 * exact burst it exists to stop it reads a stale value and lets the burst
 * through — the failure mode is "the breaker is useless precisely when needed".
 * Free-tier D1 writes are the resource being protected.
 *
 * Fails OPEN (no binding configured ⇒ allow), because dropping real analytics
 * because a binding is missing is worse than the burst it would have stopped.
 */
async function withinRateLimit(
  limiter: AppEnv['Bindings']['EVENTS_LIMITER'] | undefined,
  key: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

events.post('/events', async (c) => {
  let body: AnalyticsBatch;
  try {
    body = (await c.req.json()) as AnalyticsBatch;
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
  const firstAnon = str(list[0]?.anon_id, MAX_ID_LEN) ?? 'unknown';
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `${appId}:${firstAnon}`))) {
    // 429 with ok:false and received:0 — an honest rejection. The client keeps
    // its queue and retries later; pretending we took the batch would lose it.
    return c.json({ ok: false, error: 'rate_limited', received: 0 }, 429);
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
    const anonId = str(e?.anon_id, MAX_ID_LEN) ?? firstAnon;
    if (!eventId || !name) continue; // skip malformed, keep the rest
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
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
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
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `consent:${appId}:${anonId}`))) {
    return c.json({ ok: false, error: 'rate_limited' }, 429);
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
