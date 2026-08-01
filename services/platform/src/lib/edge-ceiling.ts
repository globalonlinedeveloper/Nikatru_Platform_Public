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
 * Ask a Rate Limiting binding about `key`.
 *
 * Fails OPEN (no binding configured ⇒ allow), because dropping real traffic
 * because a binding is missing is worse than the burst it would have stopped.
 * The cost of that choice is that deleting a binding from wrangler.jsonc
 * disables the breaker in production while every unit test stays green — which
 * is why test/wrangler-breaker.test.ts asserts the DEPLOYED config.
 */
export async function withinRateLimit(
  limiter: RateLimiterBinding | undefined,
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

/**
 * The server-derived ceiling, in one call. Deliberately takes NO body-derived
 * argument: a caller cannot accidentally mix a client value into this key.
 */
export function withinEdgeCeiling(
  limiter: RateLimiterBinding | undefined,
  c: EdgeContext,
): Promise<boolean> {
  return withinRateLimit(limiter, edgeCeilingKey(c));
}
