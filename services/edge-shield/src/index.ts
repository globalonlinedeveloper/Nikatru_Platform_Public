// ─────────────────────────────────────────────────────────────────────────────
// edge-shield — THE CLOUDFLARE EDGE IN FRONT OF BOX B AND BOX C.
//
// LEAD RULING SHIELD-R1 (2026-09-26), row O-BOXES-UNSHIELDED-FROM-SPIKES. The
// owner's direction: everything served is held by Cloudflare, and Box B
// (GlitchTip) and Box C (self-hosted GoTrue) are protected there against sudden
// spikes and attacks, so a box never crashes. Both boxes were already behind
// Cloudflare Tunnels (no box IP in DNS), but nothing limited the auth endpoints
// or the crash intake: the Free plan's one rate-limiting rule guards GlitchTip's
// own login form.
//
// WHAT IT DOES, AND ALL IT DOES:
//   1. passes every request to the origin UNCHANGED — method, headers, body,
//      streaming — with `fetch(request)`, and adds exactly one response header,
//      `x-nikatru-shield: 1`, which ops-watch reads to prove the shield is still
//      in path (tooling/ops/check-edge-shield.mjs);
//   2. counts the requests of four classes (src/classify.ts) against one
//      GLOBAL cap each, and refuses one over its cap with Retry-After
//      (src/limit.ts): 429, or 503 for the refresh grant, which the auth SDK
//      would otherwise turn into a sign-out (LEAD RULING SHIELD-R2). It reads no
//      client address (SHIELD-R3): the per-IP limit on the credential paths is
//      the zone's own rate-limiting rule, tooling/edge-ratelimit-rule.json;
//   3. serves GET /auth/v1/.well-known/jwks.json from the edge cache for 300 s,
//      and a stale copy when the origin fails (see jwks() below).
// Apps change nothing: no rebuild, and builds already shipped are covered too.
//
// 🔴 FAIL OPEN, TWICE OVER. src/limit.ts admits on any limiter fault; and
// `passThroughOnException()` below means an exception anywhere in this file
// hands the request to the origin exactly as if no Worker were bound. The shield
// must never be the reason auth is down.
//
// ⚠️ THE ORIGIN STILL SEES THE REAL CLIENT. A same-zone subrequest carries
// CF-Connecting-IP from the client (it reflects x-real-ip, which this Worker
// never touches), so once Box C sets GOTRUE_RATE_LIMIT_HEADER to
// CF-Connecting-IP as ADR no.059 locks it (unset when last read, 2026-09-24),
// GoTrue's own per-IP limiter counts per user, not per Worker.
// test/shield.test.ts holds that the forwarded request is the incoming one.
// ─────────────────────────────────────────────────────────────────────────────
import { AUTH_HOST, JWKS_PATH, classify } from './classify';
import { SHIELD_HEADER, admit } from './limit';
import type { Env } from './types';

/** JWKS rotation is rare; five minutes of staleness is the ruling's bound. */
// @ceiling none — a cache lifetime (the JWKS staleness bound, LEAD RULING SHIELD-R1 §5), not a platform resource
export const JWKS_TTL_SECONDS = 300;
/**
 * How long a stored copy may still be served when the origin FAILS. While the
 * origin is healthy no client gets a copy older than [JWKS_TTL_SECONDS], because
 * past that every read asks the origin first. This bound applies only in an
 * outage, where the alternative is an error that fails every token verification
 * downstream.
 */
// @ceiling none — a cache lifetime (the stale-if-error bound for an origin outage), not a platform resource
export const JWKS_STALE_IF_ERROR_SECONDS = 86_400;
/**
 * How long a revalidation waits for the origin when a stale copy is there to
 * fall back on. Measured 2026-09-30: one origin read costs ~1.3 s through SIN,
 * and the lead's laptop probe took 1.8 s, so 5 s is well clear of a slow
 * success. With NO stored copy the read has no deadline at all: cutting a slow
 * success short would turn it into the very error this exists to avoid.
 */
// @ceiling none — a latency budget for one subrequest, not a platform resource
export const JWKS_REVALIDATE_TIMEOUT_MS = 5_000;
/** ONE cache entry whatever the query string, so `?cb=<random>` cannot miss on purpose. */
const JWKS_CACHE_KEY = `https://${AUTH_HOST}${JWKS_PATH}`;
/** When the stored copy was read from the origin, in epoch ms. Internal: never served. */
export const STORED_AT_HEADER = 'x-nikatru-shield-stored-at';

type CacheState = 'HIT' | 'MISS' | 'STALE';

/** The origin's response with the shield header added; status, headers and body stream untouched. */
export function withShield(res: Response, cache?: CacheState): Response {
  // A protocol switch cannot be re-wrapped; neither host serves one, so pass it as is.
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const out = new Response(res.body, res);
  out.headers.set(SHIELD_HEADER, '1');
  if (cache) out.headers.set('x-nikatru-shield-cache', cache);
  return out;
}

function cacheFault(err: unknown): void {
  console.error(JSON.stringify({ event: 'shield_cache_fault', reason: err instanceof Error ? err.message : String(err) }));
}

/** A stored copy as the client gets it: the downstream TTL, and no internal header. */
function served(held: Response, state: CacheState): Response {
  const out = withShield(held, state);
  out.headers.delete(STORED_AT_HEADER);
  out.headers.set('Cache-Control', state === 'STALE' ? 'no-cache' : `public, max-age=${JWKS_TTL_SECONDS}`);
  return out;
}

/**
 * GET the JWKS through the edge cache.
 *
 * 🔴 WHY THE STORED ENTRY OUTLIVES ITS FRESHNESS. Until 2026-09-30 the entry was
 * stored with `max-age=300`, so the cache expired it itself. Cloudflare logs a
 * lookup of an expired entry as a Cache API subrequest with status 504
 * (`requestSource: edgeWorkerCacheAPI`, `cacheStatus: stale`,
 * `originResponseStatus: 0`). That is a cache miss, not an answer any client got.
 * But in the zone's analytics it read as "12% of auth-api requests are 504s on
 * the JWKS path" (879 a day) while every client got a 200. An expired entry was
 * also gone at the one moment it was worth having: when the origin was failing.
 * So the entry is now stored for [JWKS_STALE_IF_ERROR_SECONDS], and its
 * freshness is judged here from [STORED_AT_HEADER]:
 *   · fresh (under [JWKS_TTL_SECONDS] old)  → served as it is (HIT);
 *   · older                                 → the origin is asked, with a
 *     [JWKS_REVALIDATE_TIMEOUT_MS] deadline. A 200 replaces the copy (MISS); a
 *     5xx, a throw or the deadline serves the stored copy (STALE), never a 504;
 *   · nothing stored (or a cache fault)     → the origin's answer, whatever it
 *     is, with no deadline, because there is nothing to fall back on.
 * A 4xx from the origin passes through even when a copy is held: it is a
 * definite answer about the path, not an outage.
 */
async function jwks(request: Request, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(JWKS_CACHE_KEY, { method: 'GET' });
  let cache: Cache | null = null;
  let stale: Response | null = null;
  try {
    cache = caches.default;
    const held = await cache.match(key);
    if (held) {
      const storedAt = Number(held.headers.get(STORED_AT_HEADER));
      const ageMs = Date.now() - storedAt;
      // An entry with no stamp (stored before this change), or a clock that went
      // backwards, is not fresh. It is revalidated and still held as the fallback.
      if (storedAt > 0 && ageMs >= 0 && ageMs < JWKS_TTL_SECONDS * 1000) return served(held, 'HIT');
      stale = held;
    }
  } catch (err) {
    // A cache fault is a miss, never an outage.
    cacheFault(err);
    cache = null;
  }
  let origin: Response;
  try {
    origin = await (stale ? fetch(request, { signal: AbortSignal.timeout(JWKS_REVALIDATE_TIMEOUT_MS) }) : fetch(request));
  } catch (err) {
    if (!stale) throw err;
    console.error(JSON.stringify({ event: 'shield_jwks_stale', reason: err instanceof Error ? err.name : 'origin threw' }));
    return served(stale, 'STALE');
  }
  if (origin.status >= 500 && stale) {
    origin.body?.cancel().catch(() => {});
    console.error(JSON.stringify({ event: 'shield_jwks_stale', reason: `origin ${origin.status}` }));
    return served(stale, 'STALE');
  }
  if (origin.status !== 200 || cache === null) return withShield(origin);
  const stored = new Response(origin.body, origin);
  stored.headers.set('Cache-Control', `public, max-age=${JWKS_STALE_IF_ERROR_SECONDS}`);
  stored.headers.set(STORED_AT_HEADER, String(Date.now()));
  stored.headers.delete('Set-Cookie');
  const res = served(stored.clone(), 'MISS');
  ctx.waitUntil(cache.put(key, stored).catch(cacheFault));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();
    const route = classify(new URL(request.url), request.method);
    if (route.kind === 'jwks') return jwks(request, ctx);
    if (route.kind === 'limit') {
      const refused = await admit(route.cls, env);
      if (refused) return refused;
    }
    return withShield(await fetch(request));
  },
} satisfies ExportedHandler<Env>;
