// ─────────────────────────────────────────────────────────────────────────────
// rate-limit.ts — THE RATE LIMITER, AND THE SERVER-DERIVED HALF OF EVERY COST
// CIRCUIT BREAKER. THE ONE HOME.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-009).
// Moved VERBATIM from services/platform/src/lib/edge-ceiling.ts, which is now a
// whole-file re-export of this file, as is the brick's stamped Worker's
// src/lib/rate-limit.ts. "This Worker" below is services/platform, where every
// route named here lives; `RateLimiterBinding` is declared here, structurally,
// because this home may carry no import from a carrier.
//
// Extracted from routes/events.ts (PR #91) so the SECOND unauthenticated route
// that needs it — GET /config/:app — uses the same key rather than a second,
// subtly different one. F-2: the value is declared once. A fork here would be
// invisible: two edge keys that differ only in their prefix still both "work",
// and the drift is only ever discovered when one of them turns out to bound
// nothing.
//
// 🔴 NOTHING IN THE KEY COMES FROM THE CALLER. `colo` is the edge PoP that
// terminated the connection and `asn` is derived by Cloudflare from the real
// transport source; neither is a header and neither is in the request body. A
// breaker keyed on the attacker's own input cannot fail closed on the burst it
// exists to stop — that was the original /v1/events defect.
//
// This is NOT `CF-Connecting-IP`. That header is never read anywhere in this
// Worker, and nothing here is stored: the key lives only for the duration of the
// `limit()` call.
//
// ⬜ HONEST LIMIT (unchanged from PR #91): the Rate Limiting binding is per-colo
// and eventually consistent — Cloudflare documents it as "intentionally designed
// to not be used as an accurate accounting system". It bounds the burst per
// network, not the account-wide daily budget.
// ─────────────────────────────────────────────────────────────────────────────
/** A Cloudflare Rate Limiting binding (`ratelimits` in wrangler.jsonc). Each
 *  carrier's `Env` names its own bindings with a type this one accepts. */
export interface RateLimiterBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** The subset of the Hono context these helpers need. Keeps them testable. */
export interface EdgeContext {
  req: { raw: Request };
}

/**
 * `edge:<colo>:<asn>` from `request.cf`. A missing/hostile `cf` degrades to the
 * single bucket `edge:-:-` — bounded, never per-request-unique, because a key
 * that varies per request is the same thing as no ceiling at all.
 */
export function edgeCeilingKey(c: EdgeContext): string {
  const cf = (c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf;
  const colo = typeof cf?.colo === 'string' && cf.colo.length <= 16 ? cf.colo : '-';
  const asnRaw = (cf as { asn?: unknown } | undefined)?.asn;
  const asn =
    typeof asnRaw === 'number' || (typeof asnRaw === 'string' && asnRaw.length <= 16)
      ? String(asnRaw)
      : '-';
  return `edge:${colo}:${asn}`;
}

/**
 * Bindings already reported ABSENT in this isolate.
 *
 * One line per isolate, not per request. Absence is a PERMANENT
 * misconfiguration — the second line says nothing the first did not — and the
 * requests that would emit it are, by definition, the flood the breaker exists
 * to shed. Logging per request would bill a log line for every request of the
 * one event we most need to survive. Isolates recycle, so the signal recurs.
 */
const reportedAbsent = new Set<string>();

/**
 * Ask a Rate Limiting binding about `key`.
 *
 * Fails OPEN (no binding configured ⇒ allow), because dropping real traffic
 * because a binding is missing is worse than the burst it would have stopped.
 * The cost of that choice is that deleting a binding from wrangler.jsonc
 * disables the breaker in production while every unit test stays green — which
 * is why test/wrangler-breaker.test.ts asserts the DEPLOYED config.
 *
 * 🔴 THE TWO FAIL-OPEN PATHS MUST NOT BE THE SAME OBSERVABLE EVENT, and until
 * 2026-08-06 they were: both returned `true` in silence, so "there is no
 * limiter" and "the limiter allowed it" produced byte-identical output. A run of
 * 200 requests answering 200 therefore could not distinguish a dead breaker from
 * a working one — and [4]B-13 was recorded as a CONFIRMED defect, twice, on
 * exactly that evidence. It was not a defect: all four bindings were live, and
 * the probes were simply too brief to out-run the counter's documented
 * asynchronous propagation (measured: first 429 at t+6.0s under sustained load).
 * The bug was that a negative measurement was UNFALSIFIABLE. Hence `binding`:
 *
 *   • ABSENT  → `console.error`, once per isolate. A permanent misconfiguration
 *               that no amount of traffic will ever surface as a 429.
 *   • THREW   → `console.warn`, every time. A transient edge error; a rate that
 *               matters is a rate you can only see if each one is logged.
 *
 * Both still ALLOW. The fail-open behaviour is deliberate and unchanged — this
 * only makes the two cases tellable apart after the fact.
 */
export async function withinRateLimit(
  limiter: RateLimiterBinding | undefined,
  key: string,
  binding: string,
): Promise<boolean> {
  if (!limiter) {
    if (!reportedAbsent.has(binding)) {
      reportedAbsent.add(binding);
      console.error(
        `[ratelimit] ${binding} IS NOT BOUND — failing OPEN, so every request on this path is ` +
          'allowed and no burst can ever produce a 429. This is a deploy-time misconfiguration, ' +
          'not load: check the `ratelimits` block in wrangler.jsonc reached the deployed script.',
      );
    }
    return true;
  }
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.warn(`[ratelimit] ${binding} limit() threw — failing OPEN for this request`, err);
    return true;
  }
}

/**
 * The server-derived ceiling, in one call. Deliberately takes NO body-derived
 * argument: a caller cannot accidentally mix a client value into this key.
 *
 * `binding` is REQUIRED rather than defaulted: a default would let the next call
 * site added here log `(unnamed)` and compile, which is the same unfalsifiable
 * silence this parameter exists to end.
 */
export function withinEdgeCeiling(
  limiter: RateLimiterBinding | undefined,
  c: EdgeContext,
  binding: string,
): Promise<boolean> {
  return withinRateLimit(limiter, edgeCeilingKey(c), binding);
}

/** What a FAIL-CLOSED limiter answered: under the cap, over it, or no answer at all. */
export type StrictVerdict = 'within' | 'over' | 'unavailable';

/**
 * Ask a Rate Limiting binding about `key`, FAILING CLOSED.
 *
 * ⏱ 2026-09-28 · ST-N1 (routes/native-auth.ts). `withinRateLimit` above admits
 * when the binding is absent or throws, and says why that is right for the
 * routes it fronts: a lost analytics batch is worse than a burst. It is WRONG
 * for a route whose limiter is the only thing standing where a captcha would
 * stand. POST /v1/auth/native/<app>/<op> forwards a password grant with the service-role
 * bearer, so GoTrue skips its captcha for it; a limiter that admitted on a fault
 * would turn "Cloudflare's rate-limit service hiccuped" into "unbounded password
 * guessing at the identity server". So here absence and a throw are
 * `unavailable`, and the caller answers 503 — never admits.
 *
 * The two faults stay tellable apart, as above: ABSENT logs once per isolate
 * (a deploy misconfiguration), THREW logs every time (a transient edge error).
 * Neither line carries the key, which may be derived from an account.
 */
export async function strictRateLimit(
  limiter: RateLimiterBinding | undefined,
  key: string,
  binding: string,
): Promise<StrictVerdict> {
  if (!limiter) {
    if (!reportedAbsent.has(binding)) {
      reportedAbsent.add(binding);
      console.error(
        `[ratelimit] ${binding} IS NOT BOUND — failing CLOSED, so every request on this path answers 503 ` +
          'until the `ratelimits` block in wrangler.jsonc reaches the deployed script.',
      );
    }
    return 'unavailable';
  }
  try {
    const { success } = await limiter.limit({ key });
    return success ? 'within' : 'over';
  } catch (err) {
    console.warn(`[ratelimit] ${binding} limit() threw (${err instanceof Error ? err.name : typeof err}) — failing CLOSED for this request`);
    return 'unavailable';
  }
}

/** The server-derived ceiling (`edgeCeilingKey`), FAILING CLOSED. See `strictRateLimit`. */
export function strictEdgeCeiling(
  limiter: RateLimiterBinding | undefined,
  c: EdgeContext,
  binding: string,
): Promise<StrictVerdict> {
  return strictRateLimit(limiter, edgeCeilingKey(c), binding);
}
