// ─────────────────────────────────────────────────────────────────────────────
// GET /config/:app — CFG-1. Compiled-in defaults overlaid with a KV override
// (`config:<app>`), edge-cached — by the Worker's own Cache API calls since
// 2026-10-01 (src/lib/edge-cache.ts: the CDN never cached it, measured).
// Unknown app ⇒ 404. Never returns secrets.
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
//
// `?channel=<id>` (O-UPDATE-FLOOR-HAS-NO-CHANNEL) picks which channel's floor
// and update destination the response carries; src/config.ts says why the two
// are per channel. No parameter ⇒ `default`. A value the channel register does
// not declare ⇒ 400 `unknown_channel`, decided the same way as the 404: from
// memory, before the ceiling and before KV.
//
// ⏱ 2026-10-01 · fix-india-rail-tax-data · O-WEB-INR-PRICE-BOOK. `?market=<ISO
// 3166-1 alpha-2>` is the BUYER'S OWN declaration of where they buy from — never
// `cf.country` (Q2, ruled). A market with its own web price book (India) is served
// every paywall offering at that book's price and currency (src/config.ts
// `priceForMarket`: rupees, GST-inclusive); any other well-formed market is served
// the default (USD) book. A malformed value ⇒ 400 `unknown_market`, from memory,
// before the ceiling and before KV, exactly as an unknown channel is.
//
// ⏱ 2026-10-01 · rv2-services-013. A KV READ THAT THROWS IS A 503
// `config_unavailable`, `no-store` — never the compiled-in defaults. A thrown
// `get` is not "no override": the override may be exactly the raised floor or
// the kill switch an app's launch path must see, and serving the defaults in its
// place would hand every client a stale answer, edge-cached for five minutes, as
// if it were current. It was an unhandled 500 before; a 503 says "try again"
// and the client keeps the config it has.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { DEFAULT_CHANNEL, MARKET_PATTERN, isKnownApp, isKnownChannel, isPricedMarket, priceForMarket, resolveConfig } from '../config';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { EDGE_CACHE_HEADER, edgeCacheKey, edgeCacheMatch, edgeCachePut, hitResponse, waitUntilOf } from '../lib/edge-cache';

const app = new Hono<AppEnv>();

app.get('/:app', async (c) => {
  const appId = c.req.param('app');
  // Cheapest first, and it costs nothing an abuser can spend: an unknown or
  // malformed id is answered from the compiled-in registry with zero I/O, so it
  // never reaches KV and never consumes the breaker's budget either.
  if (!isKnownApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId); // [pipeline B-16] attribution, post-validation.

  // The same rule for the channel, for the same reason: an id the register does
  // not declare is answered from memory, so it never reaches KV and never
  // charges the ceiling below. An EMPTY value is refused too — a client with no
  // channel sends no parameter, never an empty one.
  const channel = c.req.query('channel');
  if (channel !== undefined && !isKnownChannel(channel)) {
    return c.json({ error: 'unknown_channel' }, 400);
  }
  // The buyer-declared market, refused the same way when it is not a market at all.
  const market = c.req.query('market');
  if (market !== undefined && !MARKET_PATTERN.test(market)) {
    return c.json({ error: 'unknown_market' }, 400);
  }

  // ⏱ 2026-10-01 · O-WORKER-RESPONSES-NOT-EDGE-CACHED. The Worker's OWN cache
  // (src/lib/edge-cache.ts says why the CDN never cached this route). A hit costs
  // no KV read and no ceiling budget, and `?cb=<random>` lands on the same entry
  // as no parameter at all.
  //
  // 🔴 ⏱ 2026-10-03 · PR #1165 ruling (MONEY). THE KEY IS EVERY INPUT THE BODY
  // DEPENDS ON: the app (the path), the channel AND the market. It was keyed on
  // `?channel=` alone, so whichever market warmed the entry first was served to
  // every buyer after it — an India buyer could get USD, or a US buyer rupees.
  // Nothing else reaches the body: KV is read by app id only, and no header is
  // read at all. Each input is keyed by the ANSWER it selects, not its spelling:
  // an absent market and a well-formed market with no book of its own (both the
  // default book) are one entry, and the parameter order and any other parameter
  // never split one. Case and empty values cannot split or share an entry either:
  // `?market=in`, `?market=` and `?channel=` (and `?channel=default`) are all
  // 400s above, so a malformed value can neither write an entry nor overwrite a
  // valid one. Red control:
  // test/edge-cache.test.ts, "keyed on the market".
  const keyChannel = channel ?? DEFAULT_CHANNEL;
  const keyMarket = market !== undefined && isPricedMarket(market) ? market : undefined;
  const canonical = new URL(c.req.url);
  canonical.search = '';
  if (keyChannel !== DEFAULT_CHANNEL) canonical.searchParams.set('channel', keyChannel);
  if (keyMarket !== undefined) canonical.searchParams.set('market', keyMarket);
  const cacheKey = edgeCacheKey(canonical.toString(), ['channel', 'market']);
  const hit = await edgeCacheMatch(cacheKey);
  if (hit) {
    const r = hitResponse(hit);
    return c.newResponse(r.body, r);
  }

  // The SAME server-derived ceiling /v1/events got in PR #91, on its own
  // namespace so it cannot spend that route's budget (and that route cannot
  // spend this one's).
  //
  // WHY THIS ROUTE NEEDS ONE AT ALL, now that unknown apps are free: a KNOWN app
  // still costs a KV read, and `Cache-Control: s-maxage=300` only collapses
  // requests that share a cache key. `GET /config/subscriptiontracker?cb=<random>` does not —
  // the query string is part of the cache key and Hono routes on the path — so a
  // caller can bust the edge cache at will and turn one KV read per five minutes
  // into one per request, against the same shared free-tier allowance the
  // analytics ingest draws on. Keyed on `request.cf` (colo+asn) because a key a
  // caller can rotate bounds nothing; fails OPEN if the binding is absent, so a
  // missing binding degrades config resolution to exactly today's behaviour
  // rather than taking every app's launch path down.
  // ⏱ 2026-10-01: the cache-key half of this is no longer true — the key above
  // drops every parameter but `?channel=` and `?market=` — so the ceiling now
  // bounds misses only.
  if (!(await withinEdgeCeiling(c.env.CONFIG_CEILING_LIMITER, c, 'CONFIG_CEILING_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  let kvValue: string | null;
  try {
    kvValue = await c.env.CONFIG_KV.get(`config:${appId}`);
  } catch (err) {
    console.warn(`[config] rid=${c.get('requestId') ?? '-'} app=${appId} KV read failed — 503`, err);
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'config_unavailable' }, 503);
  }
  const cfg = resolveConfig(appId, kvValue, channel ?? DEFAULT_CHANNEL);
  if (!cfg) return c.json({ error: 'unknown_app' }, 404);
  // Edge + client cache; overrides propagate within the TTL — the Worker's own
  // cache honours the same `s-maxage`. The body is built from the SAME `keyMarket`
  // the key carries, so an entry can only ever hold the book its key names.
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  c.header(EDGE_CACHE_HEADER, 'MISS');
  const res = c.json(keyMarket === undefined ? cfg : priceForMarket(cfg, appId, keyMarket));
  await edgeCachePut(cacheKey, res, waitUntilOf(c));
  return res;
});

export default app;
