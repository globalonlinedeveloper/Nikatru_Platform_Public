// ─────────────────────────────────────────────────────────────────────────────
// THE SERVER-DERIVED HALF OF EVERY COST CIRCUIT BREAKER IN THIS WORKER.
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
import type { RateLimiterBinding } from '../types';

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
