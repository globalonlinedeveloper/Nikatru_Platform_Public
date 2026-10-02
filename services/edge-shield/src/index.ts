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
//      `x-nikatru-shield: <RELEASE>`, which ops-watch reads to prove the shield is
//      still in path and the deploy smoke reads to prove THIS commit is
//      (tooling/ops/check-edge-shield.mjs; `1` when no RELEASE was deployed);
//   2. counts the requests of six classes (src/classify.ts) against one
//      GLOBAL cap each, and refuses one over its cap with Retry-After
//      (src/limit.ts): 429, or 503 for the refresh grant, which the auth SDK
//      would otherwise turn into a sign-out (LEAD RULING SHIELD-R2). It reads no
//      client address (SHIELD-R3): the per-IP limit on the credential paths is
//      the zone's own rate-limiting rule, tooling/edge-ratelimit-rule.json;
//   3. serves GET /auth/v1/.well-known/jwks.json from the edge cache for 300 s,
//      and a stale copy for up to an hour when the origin fails (see jwks() below).
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

/** A deployed RELEASE is the commit SHA (`--var RELEASE:${{ github.sha }}`). */
const RELEASE_SHA = /^[0-9a-f]{40}$/;

/**
 * The shield header's value: the RELEASE this version was deployed with, so the
 * deploy smoke can tell THIS commit's shield from any older one still in path
 * (row O-EDGE-SHIELD-SMOKE-NOT-JOINED-TO-SHA). A version deployed without one, or
 * with anything that is not a SHA, still marks itself in path with `1`: the header
 * must never be the thing that goes missing.
 */
export function shieldMark(env: Pick<Env, 'RELEASE'> | undefined): string {
  const release = env?.RELEASE;
  return typeof release === 'string' && RELEASE_SHA.test(release) ? release : '1';
}

/** JWKS rotation is rare; five minutes of staleness is the ruling's bound. */
// @ceiling none — a cache lifetime (the JWKS staleness bound, LEAD RULING SHIELD-R1 §5), not a platform resource
export const JWKS_TTL_SECONDS = 300;
/**
 * How long the cache STORES a copy. It is long only so that the cache never
 * expires the entry itself (an expired-entry lookup is the phantom 504; see
 * jwks() below). It does NOT bound what is served: [JWKS_MAX_STALE_SECONDS] does.
 */
// @ceiling none — a cache storage lifetime, not a platform resource
export const JWKS_STORE_SECONDS = 86_400;
/**
 * How long past its freshness a copy may still be served when the origin FAILS.
 * Past this the origin's own error goes to the client. So a Box C outage reaches
 * GlitchTip monitor 17 (the JWKS uptime check) within this bound, and a rotation
 * can be hidden behind a failing origin for no longer than this. Everything
 * measured on 2026-09-30 (single-request 520s, slow reads) fits well inside an
 * hour (lead ruling on the #1096 review, 2026-10-01).
 */
// @ceiling none — a stale-if-error bound for an origin outage, not a platform resource
export const JWKS_MAX_STALE_SECONDS = 3_600;
/**
 * How long a revalidation waits for the origin when a stale copy is there to
 * fall back on. Measured 2026-09-30: one origin read costs ~1.3 s through SIN,
 * and the lead's laptop probe took 1.8 s, so 5 s is well clear of a slow
 * success. With NO servable copy the read has no deadline at all: cutting a slow
 * success short would turn it into the very error this exists to avoid.
 */
// @ceiling none — a latency budget for one subrequest, not a platform resource
export const JWKS_REVALIDATE_TIMEOUT_MS = 5_000;
/**
 * After a failed revalidation, how long the stale copy is served WITHOUT asking
 * the origin again. Without it every JWKS read at a colo would reach Box C, each
 * held up to the deadline, for exactly as long as Box C is struggling. That is
 * the opposite of SHIELD-R1's "a flood of it never reaches Box C".
 */
// @ceiling none — a back-off interval after an origin failure, not a platform resource
export const JWKS_RETRY_BACKOFF_SECONDS = 60;
/** ONE cache entry whatever the query string, so `?cb=<random>` cannot miss on purpose. */
const JWKS_CACHE_KEY = `https://${AUTH_HOST}${JWKS_PATH}`;
/** When the stored copy was read from the origin, in epoch ms. Internal: never served. */
export const STORED_AT_HEADER = 'x-nikatru-shield-stored-at';
/** Until when (epoch ms) a failed revalidation is not retried. Internal: never served. */
export const RETRY_AT_HEADER = 'x-nikatru-shield-retry-at';
/** On every STALE answer: the copy's age in whole seconds, so a monitor can tell stale from fresh. */
export const STALE_HEADER = 'x-edge-shield-stale';
/**
 * The User-Agent of the shield's own JWKS read. It lets the zone's analytics
 * tell a failed revalidation (each one opens a stale-serve window) apart from
 * every other read of the path: tooling/ops/check-jwks-error-rate.mjs counts them.
 */
export const REVALIDATE_UA = 'nikatru-edge-shield/jwks-revalidate';

type CacheState = 'HIT' | 'MISS' | 'STALE';

/** The origin's response with the shield header added; status, headers and body stream untouched. */
export function withShield(res: Response, mark: string, cache?: CacheState): Response {
  // A protocol switch cannot be re-wrapped; neither host serves one, so pass it as is.
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const out = new Response(res.body, res);
  out.headers.set(SHIELD_HEADER, mark);
  if (cache) out.headers.set('x-nikatru-shield-cache', cache);
  return out;
}

function cacheFault(err: unknown): void {
  console.error(JSON.stringify({ event: 'shield_cache_fault', reason: err instanceof Error ? err.message : String(err) }));
}

/** A stored copy as the client gets it: the remaining freshness, and no internal header. */
function served(held: Response, state: CacheState, ageMs: number, mark: string): Response {
  const out = withShield(held, mark, state);
  out.headers.delete(STORED_AT_HEADER);
  out.headers.delete(RETRY_AT_HEADER);
  if (state === 'STALE') {
    out.headers.set('Cache-Control', 'no-cache');
    out.headers.set(STALE_HEADER, String(Math.floor(ageMs / 1000)));
  } else {
    // What is LEFT of the 300 s, so no downstream cache holds a copy past the ruling's bound.
    const left = Math.max(0, Math.floor(JWKS_TTL_SECONDS - ageMs / 1000));
    out.headers.set('Cache-Control', `public, max-age=${left}`);
  }
  return out;
}

/** A JWKS document worth storing: JSON whose `keys` is a non-empty array (the rule probeJwks applies). */
export function isUsableJwks(text: string): boolean {
  try {
    const doc = JSON.parse(text) as { keys?: unknown } | null;
    return Array.isArray(doc?.keys) && doc.keys.length > 0;
  } catch {
    return false;
  }
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
 * the JWKS path" (879 a day) while every client got a 200. So the entry is
 * stored for [JWKS_STORE_SECONDS], and its age is judged here from
 * [STORED_AT_HEADER]:
 *   · under [JWKS_TTL_SECONDS]             → served as it is (HIT);
 *   · up to [JWKS_MAX_STALE_SECONDS] more  → the origin is asked under a
 *     [JWKS_REVALIDATE_TIMEOUT_MS] deadline, and a usable 200 replaces the copy
 *     (MISS). A 5xx, a throw, the deadline, or a 200 that is not a JWKS serves the
 *     copy (STALE, with [STALE_HEADER]) and backs off for
 *     [JWKS_RETRY_BACKOFF_SECONDS]. During the back-off the copy is served
 *     without asking the origin again;
 *   · older, unstamped, stamped in the future, nothing stored, or a cache fault →
 *     the origin's answer, whatever it is, with no deadline.
 * The origin read is ALWAYS a clean GET of the canonical URL: never the client's
 * path variant, query or headers. Only a usable JWKS is stored. A 4xx passes
 * through even when a copy is held: it is a definite answer about the path, not
 * an outage.
 */
async function jwks(ctx: ExecutionContext, mark: string): Promise<Response> {
  const key = new Request(JWKS_CACHE_KEY, { method: 'GET' });
  const now = Date.now();
  let cache: Cache | null = null;
  let stale: Response | null = null;
  let staleAgeMs = 0;
  try {
    cache = caches.default;
    const held = await cache.match(key);
    if (held) {
      const storedAt = Number(held.headers.get(STORED_AT_HEADER));
      const ageMs = now - storedAt;
      // No stamp (stored before the stamp existed), or a stamp in the future (a
      // clock that went backwards), is an age that cannot be trusted. Such a copy
      // is neither fresh nor servable as stale: the origin is asked as if nothing
      // were stored.
      if (storedAt > 0 && ageMs >= 0) {
        if (ageMs < JWKS_TTL_SECONDS * 1000) return served(held, 'HIT', ageMs, mark);
        if (ageMs < (JWKS_TTL_SECONDS + JWKS_MAX_STALE_SECONDS) * 1000) {
          if (Number(held.headers.get(RETRY_AT_HEADER)) > now) return served(held, 'STALE', ageMs, mark);
          stale = held;
          staleAgeMs = ageMs;
        }
      }
    }
  } catch (err) {
    // A cache fault is a miss, never an outage.
    cacheFault(err);
    cache = null;
  }

  /**
   * Serve the held copy, and back off so the next reads do not ask the origin.
   *
   * The back-off write is a COMPARE-AND-SET on the stored stamp. While this
   * request waited up to the deadline, another one may have revalidated and
   * stored a fresh copy; putting the old copy back over it would serve that
   * colo stale answers for a whole back-off while the origin is healthy (and
   * keep a rotated-out key set that much longer). So the entry is re-read, and
   * the write is skipped unless it still holds the copy this request read. The
   * Cache API has no atomic swap, so this narrows the window to the gap between
   * the re-read and the put; it does not close it.
   */
  const serveStale = (held: Response, reason: string): Response => {
    console.error(JSON.stringify({ event: 'shield_jwks_stale', reason, ageS: Math.floor(staleAgeMs / 1000) }));
    if (cache) {
      const store = cache;
      const readStamp = held.headers.get(STORED_AT_HEADER);
      const backoff = new Response(held.clone().body, held);
      backoff.headers.set(RETRY_AT_HEADER, String(now + JWKS_RETRY_BACKOFF_SECONDS * 1000));
      ctx.waitUntil(
        (async () => {
          const current = await store.match(key);
          const currentStamp = current?.headers.get(STORED_AT_HEADER) ?? null;
          // Not awaited: cancelling one branch of a tee resolves only when the other
          // branch is done too, so an await here can hang the whole back-off.
          current?.body?.cancel().catch(() => {});
          if (currentStamp !== readStamp) return;
          await store.put(key, backoff);
        })().catch(cacheFault),
      );
    }
    return served(held, 'STALE', staleAgeMs, mark);
  };

  const init: RequestInit = { method: 'GET', headers: { 'User-Agent': REVALIDATE_UA, Accept: 'application/json' } };
  if (stale) init.signal = AbortSignal.timeout(JWKS_REVALIDATE_TIMEOUT_MS);
  let origin: Response;
  let text: string | null = null;
  try {
    origin = await fetch(JWKS_CACHE_KEY, init);
    if (origin.status === 200) text = await origin.text();
  } catch (err) {
    if (!stale) throw err;
    return serveStale(stale, err instanceof Error ? err.name : 'origin threw');
  }
  if (text === null) {
    if (stale && origin.status >= 500) {
      origin.body?.cancel().catch(() => {});
      return serveStale(stale, `origin ${origin.status}`);
    }
    return withShield(origin, mark);
  }
  if (!isUsableJwks(text)) {
    if (stale) return serveStale(stale, 'origin 200 is not a JWKS');
    return withShield(new Response(text, origin), mark);
  }
  const fresh = new Response(text, origin);
  fresh.headers.delete('Set-Cookie');
  if (cache) {
    const stored = new Response(text, fresh);
    stored.headers.set('Cache-Control', `public, max-age=${JWKS_STORE_SECONDS}`);
    stored.headers.set(STORED_AT_HEADER, String(now));
    ctx.waitUntil(cache.put(key, stored).catch(cacheFault));
  }
  return served(fresh, 'MISS', 0, mark);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();
    const mark = shieldMark(env);
    const route = classify(new URL(request.url), request.method);
    if (route.kind === 'jwks') return jwks(ctx, mark);
    if (route.kind === 'limit') {
      const refused = await admit(route.cls, env, mark);
      if (refused) return refused;
    }
    return withShield(await fetch(request), mark);
  },
} satisfies ExportedHandler<Env>;
