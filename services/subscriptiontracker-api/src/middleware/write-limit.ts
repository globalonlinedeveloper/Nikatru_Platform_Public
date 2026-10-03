// ─────────────────────────────────────────────────────────────────────────────
// write-limit.ts — THE PER-ACCOUNT WRITE LIMITER (rv2-services-008).
//
// ⏱ 2026-10-01 · lane fix-st-api-bounds. This Worker had no `ratelimits`
// binding at all, so one signed-in account could write as fast as it could
// send: the burst half of "one account fills subscriptiontracker_db" (the
// per-user row cap in routes/subscriptions.ts is the total half).
//
// 🔴 KEYED ON THE VERIFIED SUBJECT, NEVER ON THE CALLER'S INPUT. Mounted AFTER
// `supabaseAuth` in src/index.ts, so `userId` is the `sub` of a token this
// Worker verified; a key taken from a header or the body could be varied per
// request, which is the same as no limit (services/_shared/src/rate-limit.ts).
// The key is never logged.
//
// Writes only: GET, HEAD and OPTIONS pass. A read writes no row, and the list
// is bounded by the row cap and keyset paging instead.
//
// ⚖️ IT FAILS OPEN (the kit's `withinRateLimit`), DELIBERATELY. This limiter
// fronts a user's own data, and refusing every save because Cloudflare's limiter
// hiccuped is worse than the burst it would have stopped; the row cap still
// holds without it. A binding that is ABSENT is logged once per isolate, and
// test/wrangler-config.test.ts asserts the deployed config declares it in both
// environments, so "no limiter" cannot ship quietly.
// ─────────────────────────────────────────────────────────────────────────────
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';
import { withinRateLimit } from '../../../_shared/src/rate-limit';

/** The `ratelimits[].name` in wrangler.jsonc, top level and env.sandbox. */
export const WRITE_LIMITER_BINDING = 'WRITE_LIMITER';

/**
 * Seconds a refused write is told to wait: the binding's `period` (60 s), the
 * longest the counter can take to free a slot.
 *
 * @ceiling none — a Retry-After hint, equal to the limiter's own period.
 */
export const WRITE_RETRY_AFTER_SECONDS = 60;

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const writeLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (READS.has(c.req.method)) return next();
  const admitted = await withinRateLimit(c.env.WRITE_LIMITER, `st:${c.get('userId')}`, WRITE_LIMITER_BINDING);
  if (!admitted) {
    c.header('Retry-After', String(WRITE_RETRY_AFTER_SECONDS));
    return c.json({ error: 'rate_limited', retry_after: WRITE_RETRY_AFTER_SECONDS }, 429);
  }
  await next();
};
