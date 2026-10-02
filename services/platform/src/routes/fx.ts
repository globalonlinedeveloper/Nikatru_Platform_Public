// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/fx/latest — ST-I3. The ECB euro reference rates the nightly cron keeps
// in CONFIG_KV (`fx:ecb:latest`, written by src/fx.ts), served to every app.
//
// PUBLIC, because the table is the same for everybody and says nothing about
// anybody: no session, no app id, no user data in or out. The payload carries
// `source` and `asOf` so the UI can print the attribution line and core's
// FxTable can say when it has gone stale; the shape is
// contracts/fx/latest.v1.example.json's `response`.
//
// 🔴 THE SAME SERVER-DERIVED CEILING /config HAS, ON ITS OWN NAMESPACE. A cached
// answer costs nothing, but the query string is part of the edge cache key, so
// `?cb=<random>` reaches this handler every time and spends a KV read every
// time. FX_CEILING_LIMITER bounds that burst per (colo, asn) — keyed by
// src/lib/edge-ceiling.ts, never by anything the caller sends — and fails OPEN
// when unbound, like every limiter on this Worker.
// ⏱ 2026-10-01 · O-WORKER-RESPONSES-NOT-EDGE-CACHED: "a cached answer" assumed a
// CDN cache that never held this route (measured: no `cf-cache-status`, no
// `age`). The route now calls the Cache API itself, keyed on the path alone, so a
// hit is answered before the limiter and `?cb=` no longer makes a fresh entry;
// the limiter stays as the bound on misses (src/lib/edge-cache.ts).
//
// ⚠️ NO TABLE IS A 503, NEVER AN EMPTY 200. Before the first nightly run (or if
// the key was ever lost) there is nothing honest to convert with, and a `{}` or
// a zero rate would read as a table. `no-store`, so the refusal is not cached
// past the run that fills the key.
//
// ⏱ 2026-10-01 · rv2-services-013. A KV READ THAT THROWS IS THE SAME 503, also
// `no-store`. It was an unhandled 500; it is not a table either, and nothing
// compiled in may stand in for one.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { EDGE_CACHE_HEADER, edgeCacheKey, edgeCacheMatch, edgeCachePut, hitResponse, waitUntilOf } from '../lib/edge-cache';
import { FX_KV_KEY, parseStoredFxTable } from '../fx';

const app = new Hono<AppEnv>();

app.get('/latest', async (c) => {
  // ⏱ 2026-10-01 · O-WORKER-RESPONSES-NOT-EDGE-CACHED. The Worker's OWN cache,
  // keyed on the path alone: this route reads no parameter, so no query string
  // can make a fresh entry (src/lib/edge-cache.ts says why the CDN never did).
  const cacheKey = edgeCacheKey(c.req.url);
  const hit = await edgeCacheMatch(cacheKey);
  if (hit) {
    const r = hitResponse(hit);
    return c.newResponse(r.body, r);
  }
  if (!(await withinEdgeCeiling(c.env.FX_CEILING_LIMITER, c, 'FX_CEILING_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  let stored: string | null;
  try {
    stored = await c.env.CONFIG_KV.get(FX_KV_KEY);
  } catch (err) {
    console.warn(`[fx] rid=${c.get('requestId') ?? '-'} KV read failed — 503`, err);
    stored = null;
  }
  const table = parseStoredFxTable(stored);
  if (!table) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'fx_unavailable' }, 503);
  }
  // The table changes once a day, at the 06:00 UTC run; an hour's edge and
  // client cache delays that by at most an hour and collapses everything else.
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  c.header(EDGE_CACHE_HEADER, 'MISS');
  const res = c.json(table);
  await edgeCachePut(cacheKey, res, waitUntilOf(c));
  return res;
});

export default app;
