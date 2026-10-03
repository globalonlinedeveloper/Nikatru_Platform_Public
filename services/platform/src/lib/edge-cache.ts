// ─────────────────────────────────────────────────────────────────────────────
// THE WORKER'S OWN EDGE CACHE — ⏱ 2026-10-01 · O-NIGHTLY-CRON-INVOCATION-BUDGET-
// UNSUMMED (folds O-WORKER-RESPONSES-NOT-EDGE-CACHED, rv2-services-014).
//
// 🔴 THE CDN NEVER CACHED THESE RESPONSES, AND EVERY COMMENT SAID IT DID. GET
// /config/:app and GET /v1/fx/latest send `s-maxage`, and the route comments, the
// limiter sizing and the KV read arithmetic all assumed the edge answered repeat
// GETs. A Worker on a custom domain runs IN FRONT of the cache, so its own
// responses are cached only if it calls the Cache API. MEASURED 2026-10-01 with
// two consecutive node `fetch` GETs of each URL, ~0.1 s apart: every answer 200
// with NO `cf-cache-status` and NO `age` header — each one ran the Worker and
// read KV.
//
// So the two routes call `caches.default` here. THE KEY IS THE PATH PLUS THE
// QUERY PARAMETERS THE ROUTE READS, NOTHING ELSE: `?cb=<random>` used to be a
// fresh cache key at will (the reason CONFIG_CEILING_LIMITER and FX_CEILING_
// LIMITER exist), and now it maps to the same entry as no parameter at all.
//
// ⚠️ ACCESS-CONTROL-ALLOW-ORIGIN AND VARY ARE STRIPPED BEFORE THE PUT. The CORS
// middleware sets them per request from the caller's Origin; a cached copy that
// kept them would answer the NEXT caller with the FIRST caller's origin. On a hit
// the route answers through `c.newResponse`, so the middleware's headers for THIS
// request are merged back in.
//
// ⚠️ NO CACHE = NO CACHING, NEVER AN ERROR. `caches` does not exist in Node (the
// test suite) or on a workers.dev host, and a match or put that throws must not
// fail a launch path: every failure falls through to the uncached answer.
// ─────────────────────────────────────────────────────────────────────────────

/** Says which path answered: `HIT` from the cache, `MISS` from KV. The deploy is
 *  verified by reading it on two consecutive GETs. */
export const EDGE_CACHE_HEADER = 'X-Edge-Cache';

/** The headers a cached copy must not keep — see the header above. */
const PER_REQUEST_HEADERS = ['Access-Control-Allow-Origin', 'Vary', EDGE_CACHE_HEADER];

/** The Cache API's default cache, or null where there is none. */
function defaultCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

/**
 * The cache key for `url`: its origin and path, plus only the query parameters
 * in `keep`, in the order given. Everything else in the query is dropped.
 */
export function edgeCacheKey(url: string, keep: readonly string[] = []): string {
  const u = new URL(url);
  const out = new URL(`${u.origin}${u.pathname}`);
  for (const name of keep) {
    const v = u.searchParams.get(name);
    if (v !== null) out.searchParams.set(name, v);
  }
  return out.toString();
}

/** The cached response for `key`, or null on a miss, no cache, or a failure. */
export async function edgeCacheMatch(key: string): Promise<Response | null> {
  const cache = defaultCache();
  if (!cache) return null;
  try {
    return (await cache.match(key)) ?? null;
  } catch (err) {
    console.warn('[edge-cache] match failed — answering uncached', err);
    return null;
  }
}

/**
 * Store a copy of `res` under `key`, without the per-request headers. `waitUntil`
 * keeps the isolate alive for the put without delaying the answer; without one
 * (a test) the put is awaited.
 */
export async function edgeCachePut(
  key: string,
  res: Response,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  const cache = defaultCache();
  if (!cache) return;
  const copy = new Response(res.clone().body, res);
  for (const h of PER_REQUEST_HEADERS) copy.headers.delete(h);
  const put = cache.put(key, copy).catch((err: unknown) => {
    console.warn('[edge-cache] put failed — the next request reads KV', err);
  });
  if (waitUntil) waitUntil(put);
  else await put;
}

/** The hit, marked `HIT`, with mutable headers. The route answers with
 *  `c.newResponse(r.body, r)`, which takes its status and headers and merges the
 *  CORS headers of THIS request back in. */
export function hitResponse(hit: Response): Response {
  const r = new Response(hit.body, hit);
  r.headers.set(EDGE_CACHE_HEADER, 'HIT');
  return r;
}

/** `c.executionCtx.waitUntil`, or undefined where Hono has no execution context. */
export function waitUntilOf(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return undefined;
  }
}
