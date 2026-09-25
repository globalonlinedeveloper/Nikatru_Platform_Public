import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import config from '../src/routes/config';
import type { AppEnv } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// GET /config/:app — THE ROUTE, not just the resolver.
//
// config.test.ts covers `resolveConfig` as a pure function and always did. What
// nothing covered was the HANDLER, which is where both halves of the defect
// lived: it took the app id straight off the path and used it, unvalidated, as
// (1) an object key against the compiled-in registry and (2) a KV key — in that
// order, with the KV read FIRST.
//
// Measured at HEAD, before the fix, on this exact route:
//
//   /config/subscriptiontracker        200   1 KV read   (the real config)
//   /config/__proto__    200   1 KV read   body `{}`  ← Object.prototype's JSON
//   /config/constructor  500   1 KV read   ← JSON.stringify(fn) is undefined,
//   /config/toString     500   1 KV read      and JSON.parse(undefined) throws
//   /config/valueOf      500   1 KV read
//   /config/nope         404   1 KV read   ← the honest answer, still paid for
//
// The 500s are the interesting ones: an unauthenticated caller could make this
// Worker throw at will, and every row above spent a free-tier KV read on a route
// with no rate limiter at all.
// ─────────────────────────────────────────────────────────────────────────────

/** A KV stub that RECORDS its reads — the resource the defect was burning. */
class FakeKv {
  reads: string[] = [];
  constructor(private readonly value: string | null = null) {}
  async get(key: string) {
    this.reads.push(key);
    return this.value;
  }
}

class FakeLimiter {
  keys: string[] = [];
  constructor(private readonly allow: boolean = true) {}
  limit = async ({ key }: { key: string }) => {
    this.keys.push(key);
    return { success: this.allow };
  };
}

function harness(opts: { kvValue?: string | null; allowCeiling?: boolean; omit?: boolean } = {}) {
  const app = new Hono<AppEnv>();
  app.route('/config', config);
  // The real Worker's onError, so a throw surfaces here exactly as it does in
  // production — a 500, not an unhandled rejection the test would swallow.
  app.onError((_err, c) => c.json({ error: 'internal_error' }, 500));

  const kv = new FakeKv(opts.kvValue ?? null);
  const ceiling = new FakeLimiter(opts.allowCeiling !== false);
  const env = {
    CONFIG_KV: kv,
    CONFIG_CEILING_LIMITER: opts.omit ? undefined : ceiling,
  } as unknown as AppEnv['Bindings'];

  const get = (appId: string, cf?: Record<string, unknown>, query = '') => {
    const req = new Request(
      `https://config.nikatru.com/config/${encodeURIComponent(appId)}${query}`,
      {
        // Deliberately present: this Worker must never read it.
        headers: { 'CF-Connecting-IP': '203.0.113.9' },
      },
    );
    if (cf) Object.defineProperty(req, 'cf', { value: cf });
    return app.fetch(req, env);
  };
  return { kv, ceiling, get };
}

describe('GET /config/:app rejects a non-app-id BEFORE it touches anything', () => {
  // The four shapes reproduced at HEAD, plus a plain unknown app.
  const HOSTILE = ['__proto__', 'constructor', 'toString', 'valueOf'];

  it('every prototype name is a clean 404 — no 200, no 500', async () => {
    for (const appId of HOSTILE) {
      const { get } = harness();
      const res = await get(appId);
      expect(res.status, `${appId} should be 404`).toBe(404);
      expect(await res.json(), appId).toEqual({ error: 'unknown_app' });
    }
  });

  it('…and none of them reaches KV at all', async () => {
    // This is the second half of the defect and it is not cosmetic: the answer
    // for an app that is not in the compiled-in registry never depended on KV,
    // so every one of these reads was a free-tier read spent to learn nothing,
    // on a route that had no rate limiter.
    for (const appId of [...HOSTILE, 'nope', 'Subly', 'sub ly', '../secrets', '']) {
      const { kv, get } = harness();
      await get(appId);
      expect(kv.reads, `${appId || '<empty>'} must cost no KV read`).toEqual([]);
    }
  });

  it('a KNOWN app still resolves, and reads exactly one KV key', async () => {
    const { kv, get } = harness({ kvValue: JSON.stringify({ paywall: { enabled: true } }) });
    const res = await get('subscriptiontracker');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { app_id: string; paywall: { enabled: boolean } };
    expect(body.app_id).toBe('subscriptiontracker');
    expect(body.paywall.enabled).toBe(true); // the override was applied
    expect(kv.reads).toEqual(['config:subscriptiontracker']);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('the 404 body never leaks which limb refused', async () => {
    // `unknown_app` for a bad pattern AND for a well-formed unregistered id: the
    // response must not become an oracle for what the registry contains.
    const a = await (await harness().get('__proto__')).json();
    const b = await (await harness().get('nope')).json();
    expect(a).toEqual(b);
  });
});

describe('GET /config/:app is behind the same server-derived ceiling as /v1/events', () => {
  const cf = { colo: 'MAA', asn: 24560 };

  it('the ceiling is keyed on request.cf, never on the path or a header', async () => {
    const { ceiling, get } = harness();
    await get('subscriptiontracker', cf);
    expect(ceiling.keys).toEqual(['edge:MAA:24560']);
    // Nothing the caller chose is in it — not the app id, not the IP header the
    // harness always sends.
    expect(ceiling.keys[0]).not.toContain('subscriptiontracker');
    expect(ceiling.keys[0]).not.toContain('203.0.113.9');
  });

  it('a denied ceiling sheds with 429 and never reaches KV', async () => {
    const { kv, get } = harness({ allowCeiling: false });
    const res = await get('subscriptiontracker', cf);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(kv.reads).toEqual([]);
  });

  it('CACHE-BUSTING QUERY STRINGS land in the same bucket', async () => {
    // This is why the route needs a breaker at all despite `s-maxage=300`: the
    // query string is part of the edge cache key, so `?cb=<random>` misses the
    // cache every time and reaches the origin — and therefore KV — every time.
    // The ceiling must not move with it.
    const { ceiling, get } = harness();
    for (let i = 0; i < 3; i++) await get('subscriptiontracker', cf, `?cb=${i}`);
    expect(new Set(ceiling.keys).size).toBe(1);
  });

  it('an UNKNOWN app is refused before the ceiling is even charged', async () => {
    // Order matters in both directions: a caller must not be able to spend this
    // Worker's limiter budget with requests that cost it nothing to answer.
    const { ceiling, get } = harness();
    await get('nope');
    await get('__proto__');
    expect(ceiling.keys).toEqual([]);
  });

  it('an absent binding fails OPEN — config is on every app’s launch path', async () => {
    const { kv, get } = harness({ omit: true, allowCeiling: false });
    const res = await get('subscriptiontracker', cf);
    expect(res.status).toBe(200);
    expect(kv.reads).toEqual(['config:subscriptiontracker']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O-UPDATE-FLOOR-HAS-NO-CHANNEL — `?channel=<id>` picks the channel's floor and
// update destination. Measured at the base commit: the route ignored the query
// string, so a KV override raising `min_supported_version` to 9.0.0 served 9.0.0
// to EVERY build — the web build reloads itself, a store build waits on review,
// and both were walled at once. A KV override is the fixture here because it is
// the runtime lever the owner actually pulls; config.test.ts drives the same
// resolution through the value document.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /config/:app?channel= serves that channel’s floor and exit', () => {
  type Body = { app_id: string; min_supported_version: unknown; update_url: unknown };
  const WEB_RAISED = JSON.stringify({ min_supported_version: { web: '9.0.0' } });

  it('RC1 — the closes’ control: web raised to 9.0.0 does not wall android-play', async () => {
    const { get } = harness({ kvValue: WEB_RAISED });
    const play = await get('subscriptiontracker', undefined, '?channel=android-play');
    expect(play.status).toBe(200);
    expect(((await play.json()) as Body).min_supported_version).toBe('1.0.0');
    const web = await get('subscriptiontracker', undefined, '?channel=web');
    expect(web.status).toBe(200);
    expect(((await web.json()) as Body).min_supported_version).toBe('9.0.0');
  });

  it('RC2 — an unknown channel is a 400 decided before the ceiling and before KV', async () => {
    const { kv, ceiling, get } = harness({ kvValue: WEB_RAISED });
    const res = await get('subscriptiontracker', { colo: 'MAA', asn: 24560 }, '?channel=nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_channel' });
    expect(kv.reads).toEqual([]);
    expect(ceiling.keys).toEqual([]);
  });

  it('the fallback key and an empty value are not channels either', async () => {
    const { kv, get } = harness();
    expect((await get('subscriptiontracker', undefined, '?channel=default')).status).toBe(400);
    expect((await get('subscriptiontracker', undefined, '?channel=')).status).toBe(400);
    expect(kv.reads).toEqual([]);
  });

  it('an unknown APP is still the 404 first, whatever the channel says', async () => {
    const { kv, get } = harness();
    const res = await get('nope', undefined, '?channel=nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_app' });
    expect(kv.reads).toEqual([]);
  });

  it('a SCALAR KV override still means every channel — the override shape written before maps', async () => {
    const { get } = harness({ kvValue: JSON.stringify({ min_supported_version: '2.0.0' }) });
    const play = (await (await get('subscriptiontracker', undefined, '?channel=android-play')).json()) as Body;
    const web = (await (await get('subscriptiontracker', undefined, '?channel=web')).json()) as Body;
    expect(play.min_supported_version).toBe('2.0.0');
    expect(web.min_supported_version).toBe('2.0.0');
  });

  it('no channel is served `default`, with the KV map applied', async () => {
    const { kv, get } = harness({ kvValue: WEB_RAISED });
    const res = await get('subscriptiontracker');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.min_supported_version).toBe('1.0.0');
    expect(body.update_url).toBeNull();
    expect(kv.reads).toEqual(['config:subscriptiontracker']);
  });

  it('a known channel reads one KV key, charges the ceiling once, and keeps the edge cache header', async () => {
    const { kv, ceiling, get } = harness();
    const res = await get('subscriptiontracker', { colo: 'MAA', asn: 24560 }, '?channel=web');
    expect(res.status).toBe(200);
    expect(kv.reads).toEqual(['config:subscriptiontracker']);
    expect(ceiling.keys).toEqual(['edge:MAA:24560']);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('the wire stays scalar: a KV map naming a channel still serves that channel a string', async () => {
    const { get } = harness({
      kvValue: JSON.stringify({ update_url: { 'windows-direct': 'https://dl.example.invalid/win' } }),
    });
    const direct = (await (await get('subscriptiontracker', undefined, '?channel=windows-direct')).json()) as Body;
    const web = (await (await get('subscriptiontracker', undefined, '?channel=web')).json()) as Body;
    expect(direct.update_url).toBe('https://dl.example.invalid/win');
    expect(web.update_url).toBeNull();
    expect(typeof direct.min_supported_version).toBe('string');
  });
});
