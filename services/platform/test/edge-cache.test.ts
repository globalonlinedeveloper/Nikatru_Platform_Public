// ─────────────────────────────────────────────────────────────────────────────
// THE WORKER'S OWN EDGE CACHE on GET /config/:app and GET /v1/fx/latest.
// ⏱ 2026-10-01 · O-NIGHTLY-CRON-INVOCATION-BUDGET-UNSUMMED (folds
// O-WORKER-RESPONSES-NOT-EDGE-CACHED, rv2-services-014).
//
// 🔴 MEASURED FIRST: two consecutive node `fetch` GETs of
// https://platform.nikatru.com/v1/fx/latest and /config/subscriptiontracker on
// 2026-10-01 both answered 200 with NO `cf-cache-status` and NO `age` — the CDN
// never cached the Worker's own responses, whatever `s-maxage` said, because a
// custom-domain Worker runs in front of the cache. src/lib/edge-cache.ts records
// the read.
//
// Every case goes through the REAL Worker (`app` from src/index), CORS middleware
// included, with `caches.default` stubbed by an in-memory cache. RED CONTROL: drop
// the `edgeCacheMatch` call from either route and the 🔴 cases fail on the second
// KV read.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import VECTOR_RAW from '../../../contracts/fx/latest.v1.example.json?raw';
import { app } from '../src/index';
import { FX_KV_KEY } from '../src/fx';
import { RELEASE_CHANNELS } from '../src/config';
import { EDGE_CACHE_HEADER, edgeCacheKey } from '../src/lib/edge-cache';
import type { Env } from '../src/types';

const VECTOR = JSON.parse(VECTOR_RAW) as { response: unknown };

/** An in-memory `caches.default`: what was put, and every key matched. */
class CacheStub {
  store = new Map<string, Response>();
  puts: string[] = [];
  matches: string[] = [];
  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    this.matches.push(String(key));
    return this.store.get(String(key))?.clone();
  }
  async put(key: RequestInfo | URL, res: Response): Promise<void> {
    this.puts.push(String(key));
    this.store.set(String(key), new Response(await res.arrayBuffer(), res));
  }
}

class FakeKv {
  store = new Map<string, string>();
  reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    return this.store.get(key) ?? null;
  }
}

const allow = { limit: async () => ({ success: true }) };

let cache: CacheStub;
beforeEach(() => {
  cache = new CacheStub();
  vi.stubGlobal('caches', { default: cache });
});
afterEach(() => vi.unstubAllGlobals());

function get(kv: FakeKv, path: string) {
  const req = new Request(`https://platform.nikatru.com${path}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  Object.defineProperty(req, 'cf', { value: { colo: 'BOM', asn: 64500 } });
  const env = { CONFIG_KV: kv, CONFIG_CEILING_LIMITER: allow, FX_CEILING_LIMITER: allow } as unknown as Env;
  return app.fetch(req, env);
}

describe('the cache key is the path plus the parameters the route reads', () => {
  it('drops every other parameter, so `?cb=<random>` is not a fresh entry', () => {
    expect(edgeCacheKey('https://h.example/config/a?cb=1&channel=beta', ['channel'])).toBe('https://h.example/config/a?channel=beta');
    expect(edgeCacheKey('https://h.example/config/a?cb=2', ['channel'])).toBe('https://h.example/config/a');
    expect(edgeCacheKey('https://h.example/v1/fx/latest?x=1')).toBe('https://h.example/v1/fx/latest');
  });
});

describe('GET /v1/fx/latest', () => {
  it('🔴 a second GET is served from the cache: one KV read for two answers', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const first = await get(kv, '/v1/fx/latest');
    expect(first.status).toBe(200);
    expect(first.headers.get(EDGE_CACHE_HEADER)).toBe('MISS');
    const second = await get(kv, '/v1/fx/latest?cb=12345');
    expect(second.status).toBe(200);
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('HIT');
    expect(await second.json()).toEqual(VECTOR.response);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(kv.reads).toEqual([FX_KV_KEY]);
    expect(cache.puts).toEqual(['https://platform.nikatru.com/v1/fx/latest']);
  });

  it('the cached copy keeps no per-request CORS header, and a hit gets this request\'s back', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const first = await get(kv, '/v1/fx/latest');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const stored = cache.store.get('https://platform.nikatru.com/v1/fx/latest');
    expect(stored?.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(stored?.headers.get('Vary')).toBeNull();
    expect(stored?.headers.get(EDGE_CACHE_HEADER)).toBeNull();
    const second = await get(kv, '/v1/fx/latest');
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('HIT');
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('a 503 is never put: the next request reads KV again', async () => {
    const kv = new FakeKv();
    expect((await get(kv, '/v1/fx/latest')).status).toBe(503);
    expect(cache.puts).toEqual([]);
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    expect((await get(kv, '/v1/fx/latest')).status).toBe(200);
    expect(kv.reads).toHaveLength(2);
  });
});

describe('GET /config/:app', () => {
  it('🔴 a second GET is served from the cache: one KV read for two answers, whatever `?cb=` says', async () => {
    const kv = new FakeKv();
    const first = await get(kv, '/config/subscriptiontracker');
    expect(first.status).toBe(200);
    expect(first.headers.get(EDGE_CACHE_HEADER)).toBe('MISS');
    const body = await first.json();
    const second = await get(kv, '/config/subscriptiontracker?cb=987');
    expect(second.status).toBe(200);
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('HIT');
    expect(await second.json()).toEqual(body);
    expect(kv.reads).toEqual(['config:subscriptiontracker']);
  });

  it('`?channel=` is part of the key: a different channel is its own entry', async () => {
    const channel = [...RELEASE_CHANNELS][0];
    expect(channel, 'the channel register declares no channel, so this case would test nothing').toBeDefined();
    const kv = new FakeKv();
    await get(kv, '/config/subscriptiontracker');
    await get(kv, `/config/subscriptiontracker?channel=${channel}&cb=1`);
    await get(kv, `/config/subscriptiontracker?cb=2&channel=${channel}`);
    expect(kv.reads).toHaveLength(2);
    expect(cache.puts).toEqual([
      'https://platform.nikatru.com/config/subscriptiontracker',
      `https://platform.nikatru.com/config/subscriptiontracker?channel=${channel}`,
    ]);
  });

  // ⏱ 2026-10-03 · merge of main's `?market=` (O-WEB-INR-PRICE-BOOK) over this
  // cache. Red control: key on ['channel'] alone in routes/config.ts and the
  // no-market GET below is a HIT on the India answer, served in INR.
  it('🔴 `?market=` is part of the key: an India answer is never served to a buyer who declared no market', async () => {
    type Offering = { currency_code: string };
    const currencies = async (res: Response) =>
      ((await res.json()) as { paywall: { offerings: Offering[] } }).paywall.offerings.map((o) => o.currency_code);
    const kv = new FakeKv();
    const india = await get(kv, '/config/subscriptiontracker?market=IN');
    expect(india.headers.get(EDGE_CACHE_HEADER)).toBe('MISS');
    expect(new Set(await currencies(india))).toEqual(new Set(['INR']));
    const none = await get(kv, '/config/subscriptiontracker?cb=1');
    expect(none.headers.get(EDGE_CACHE_HEADER)).toBe('MISS');
    expect(new Set(await currencies(none))).toEqual(new Set(['USD']));
    const indiaAgain = await get(kv, '/config/subscriptiontracker?cb=2&market=IN');
    expect(indiaAgain.headers.get(EDGE_CACHE_HEADER)).toBe('HIT');
    expect(new Set(await currencies(indiaAgain))).toEqual(new Set(['INR']));
    expect(cache.puts).toEqual([
      'https://platform.nikatru.com/config/subscriptiontracker?market=IN',
      'https://platform.nikatru.com/config/subscriptiontracker',
    ]);
  });

  it('an unknown app or channel is answered before the cache is even asked', async () => {
    const kv = new FakeKv();
    expect((await get(kv, '/config/__proto__')).status).toBe(404);
    expect((await get(kv, '/config/subscriptiontracker?channel=nope')).status).toBe(400);
    expect(cache.matches).toEqual([]);
    expect(kv.reads).toEqual([]);
  });

  it('with no Cache API at all the route answers exactly as before', async () => {
    vi.stubGlobal('caches', undefined);
    const kv = new FakeKv();
    expect((await get(kv, '/config/subscriptiontracker')).status).toBe(200);
    expect((await get(kv, '/config/subscriptiontracker')).status).toBe(200);
    expect(kv.reads).toHaveLength(2);
  });
});
