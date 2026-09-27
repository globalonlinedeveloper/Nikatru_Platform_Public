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
//   3. serves GET /auth/v1/.well-known/jwks.json from the edge cache for 300 s.
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
/** ONE cache entry whatever the query string, so `?cb=<random>` cannot miss on purpose. */
const JWKS_CACHE_KEY = `https://${AUTH_HOST}${JWKS_PATH}`;

/** The origin's response with the shield header added; status, headers and body stream untouched. */
export function withShield(res: Response, cache?: 'HIT' | 'MISS'): Response {
  // A protocol switch cannot be re-wrapped; neither host serves one, so pass it as is.
  if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;
  const out = new Response(res.body, res);
  out.headers.set(SHIELD_HEADER, '1');
  if (cache) out.headers.set('x-nikatru-shield-cache', cache);
  return out;
}

async function jwks(request: Request, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(JWKS_CACHE_KEY, { method: 'GET' });
  let cache: Cache | null = null;
  try {
    cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return withShield(hit, 'HIT');
  } catch (err) {
    // A cache fault is a miss, never an outage.
    console.error(JSON.stringify({ event: 'shield_cache_fault', reason: err instanceof Error ? err.message : String(err) }));
    cache = null;
  }
  const origin = await fetch(request);
  if (origin.status !== 200 || cache === null) return withShield(origin);
  const res = new Response(origin.body, origin);
  res.headers.set('Cache-Control', `public, max-age=${JWKS_TTL_SECONDS}`);
  res.headers.delete('Set-Cookie');
  const stored = res.clone();
  ctx.waitUntil(
    cache.put(key, stored).catch((err: unknown) => {
      console.error(JSON.stringify({ event: 'shield_cache_fault', reason: err instanceof Error ? err.message : String(err) }));
    }),
  );
  return withShield(res, 'MISS');
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
