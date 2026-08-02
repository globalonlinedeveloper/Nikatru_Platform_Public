// ─────────────────────────────────────────────────────────────────────────────
// GET /config/:app — CFG-1. Compiled-in defaults overlaid with a KV override
// (`config:<app>`), edge-cached. Unknown app ⇒ 404. Never returns secrets.
//
// 🔴 VALIDATE BEFORE THE KV READ. This route used to read
// `CONFIG_KV.get('config:' + appId)` as its FIRST statement, with the app id
// taken straight off the path and never checked. Two consequences, both live:
//
//   1. The unvalidated id was then used as an object key against the
//      compiled-in registry, so `GET /config/__proto__` answered 200 with the
//      body `{}` and `GET /config/constructor` (and `/toString`, `/valueOf`)
//      answered 500. See src/config.ts for which limb stops which.
//   2. EVERY unknown-app request burnt a free-tier KV read on a route with no
//      rate limiter — and the answer for an unknown app never depended on KV in
//      the first place, because the registry of known apps is compiled in.
//
// So the 404 is decided from memory, before any I/O at all.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { isKnownApp, resolveConfig } from '../config';
import { withinEdgeCeiling } from '../lib/edge-ceiling';

const app = new Hono<AppEnv>();

app.get('/:app', async (c) => {
  const appId = c.req.param('app');
  // Cheapest first, and it costs nothing an abuser can spend: an unknown or
  // malformed id is answered from the compiled-in registry with zero I/O, so it
  // never reaches KV and never consumes the breaker's budget either.
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // The SAME server-derived ceiling /v1/events got in PR #91, on its own
  // namespace so it cannot spend that route's budget (and that route cannot
  // spend this one's).
  //
  // WHY THIS ROUTE NEEDS ONE AT ALL, now that unknown apps are free: a KNOWN app
  // still costs a KV read, and `Cache-Control: s-maxage=300` only collapses
  // requests that share a cache key. `GET /config/subly?cb=<random>` does not —
  // the query string is part of the cache key and Hono routes on the path — so a
  // caller can bust the edge cache at will and turn one KV read per five minutes
  // into one per request, against the same shared free-tier allowance the
  // analytics ingest draws on. Keyed on `request.cf` (colo+asn) because a key a
  // caller can rotate bounds nothing; fails OPEN if the binding is absent, so a
  // missing binding degrades config resolution to exactly today's behaviour
  // rather than taking every app's launch path down.
  if (!(await withinEdgeCeiling(c.env.CONFIG_CEILING_LIMITER, c))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  const kvValue = await c.env.CONFIG_KV.get(`config:${appId}`);
  const cfg = resolveConfig(appId, kvValue);
  if (!cfg) return c.json({ error: 'unknown_app' }, 404);
  // Edge + client cache; overrides propagate within the TTL.
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.json(cfg);
});

export default app;
