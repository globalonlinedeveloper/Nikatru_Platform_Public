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
//   /config/subly        200   1 KV read   (the real config)
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
    const res = await get('subly');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { app_id: string; paywall: { enabled: boolean } };
    expect(body.app_id).toBe('subly');
    expect(body.paywall.enabled).toBe(true); // the override was applied
    expect(kv.reads).toEqual(['config:subly']);
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
    await get('subly', cf);
    expect(ceiling.keys).toEqual(['edge:MAA:24560']);
    // Nothing the caller chose is in it — not the app id, not the IP header the
    // harness always sends.
    expect(ceiling.keys[0]).not.toContain('subly');
    expect(ceiling.keys[0]).not.toContain('203.0.113.9');
  });

  it('a denied ceiling sheds with 429 and never reaches KV', async () => {
    const { kv, get } = harness({ allowCeiling: false });
    const res = await get('subly', cf);
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
    for (let i = 0; i < 3; i++) await get('subly', cf, `?cb=${i}`);
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
    const res = await get('subly', cf);
    expect(res.status).toBe(200);
    expect(kv.reads).toEqual(['config:subly']);
  });
});
