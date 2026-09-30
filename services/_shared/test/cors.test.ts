import { describe, it, expect } from 'vitest';
import { allowlist, cors, resolveOrigin, type CorsContext, type CorsPolicy } from '../src/cors';

// ─────────────────────────────────────────────────────────────────────────────
// cors.test.ts — the ONE CORS middleware, tested once and run in every Worker's
// suite (`../_shared/test/**` is in each Worker's vitest `include`).
//
// 🔴 WHY THIS FILE HAS TO EXIST, MEASURED 2026-09-27 (O-SERVICE-KIT-UNBUILT,
// E-b1). Each Worker's own test/cors.test.ts pins ITS Worker's behaviour and was
// kept byte-for-byte when the three implementations became one. But the
// platform's suite never probes a localhost origin — while its middleware had no
// localhost code at all, there was nothing to probe. Once the localhost trade
// lives in a shared module behind a `scope`, one token decides it for every
// Worker: with the `scope === 'own-app'` test cut out of resolveOrigin, the
// platform suite, the twinned test and assert-cors-allowlist all stayed green
// (8 files, 92 tests, exit 0) while the shared Worker answered every localhost
// port. The `every-app` cases below are what turn that red.
//
// No `hono` here — nothing under services/_shared may carry a bare import
// (shared-home.test.ts). The middleware is driven through a structural context,
// which is also what it is typed against.
// ─────────────────────────────────────────────────────────────────────────────

const LISTED = 'https://nikatru.com';
const LOCALHOSTS = ['http://localhost:4000', 'http://localhost:59123', 'https://localhost', 'http://127.0.0.1:8080'];
const LOOKALIKES = ['http://localhost.evil.test', 'http://notlocalhost', 'http://127.0.0.1.evil.test', 'http://localhost:3000/path'];

const EVERY_APP: CorsPolicy = { scope: 'every-app', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] };
const OWN_APP: CorsPolicy = {
  scope: 'own-app',
  appId: 'probe',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};

/** One request through the middleware: the headers it set, and whether it
 *  answered the request itself or passed it on. */
async function answer(policy: CorsPolicy, method: string, origin: string | undefined, allowed = LISTED, path = '/v1/health') {
  const headers = new Map<string, string>();
  let passedOn = false;
  const c: CorsContext = {
    req: {
      header: (name) => (name.toLowerCase() === 'origin' ? origin : undefined),
      method,
      path,
    },
    env: { ALLOWED_ORIGINS: allowed },
    header: (name, value) => {
      headers.set(name, value);
    },
    body: (_data, status) => new Response(null, { status }),
  };
  const res = await cors(policy)(c, async () => {
    passedOn = true;
  });
  return { headers, passedOn, status: res instanceof Response ? res.status : undefined };
}

describe('the scope decides localhost, and nothing else does', () => {
  it('every-app — the shared Worker — refuses every localhost port, preflight or not', async () => {
    for (const o of LOCALHOSTS) {
      for (const method of ['GET', 'OPTIONS']) {
        const { headers } = await answer(EVERY_APP, method, o);
        expect(headers.get('Access-Control-Allow-Origin'), `${method} ${o}`).toBeUndefined();
      }
    }
  });

  it('own-app reflects any localhost port on top of the list, even an empty list', async () => {
    for (const o of LOCALHOSTS) {
      expect((await answer(OWN_APP, 'GET', o)).headers.get('Access-Control-Allow-Origin'), o).toBe(o);
      expect((await answer(OWN_APP, 'GET', o, '')).headers.get('Access-Control-Allow-Origin'), o).toBe(o);
    }
  });

  it('own-app does NOT extend the trade to lookalike hostnames', async () => {
    for (const o of LOOKALIKES) {
      expect((await answer(OWN_APP, 'GET', o)).headers.get('Access-Control-Allow-Origin'), o).toBeUndefined();
    }
  });

  it('resolveOrigin without a scope is the stricter one', () => {
    expect(resolveOrigin('http://localhost:4000', [])).toBeNull();
    expect(resolveOrigin('http://localhost:4000', [], 'own-app')).toBe('http://localhost:4000');
    expect(resolveOrigin(LISTED, [LISTED])).toBe(LISTED);
  });
});

describe('the exact list, for both scopes', () => {
  for (const policy of [EVERY_APP, OWN_APP]) {
    it(`${policy.scope}: reflects a listed origin exactly, refuses anything else, and an empty list is not a wildcard`, async () => {
      expect((await answer(policy, 'GET', LISTED)).headers.get('Access-Control-Allow-Origin')).toBe(LISTED);
      expect((await answer(policy, 'GET', LISTED)).headers.get('Vary')).toBe('Origin');
      for (const o of ['https://nikatru.com.evil.test', 'http://nikatru.com', 'https://nikatru.com/', 'https://evil.test']) {
        const { headers } = await answer(policy, 'GET', o);
        expect(headers.get('Access-Control-Allow-Origin'), o).toBeUndefined();
        expect(headers.size, `${o} got CORS headers`).toBe(0);
      }
      for (const empty of ['', ' , , ']) {
        expect((await answer(policy, 'GET', LISTED, empty)).headers.get('Access-Control-Allow-Origin')).toBeUndefined();
      }
    });
  }

  it('parses the var into exact origins', () => {
    expect(allowlist(' a , ,b ')).toEqual(['a', 'b']);
    expect(allowlist(undefined)).toEqual([]);
  });

  it('never resolves an origin to "*"', () => {
    for (const origin of ['', '*', 'https://evil.test']) {
      for (const scope of ['every-app', 'own-app'] as const) {
        expect(resolveOrigin(origin, [], scope)).not.toBe('*');
      }
    }
  });
});

describe('the mechanism the lead ruled for all three (rv-c15 §3, 2026-09-26)', () => {
  it('a caller with no Origin gets "*" — CORS is a browser mechanism (ruling 1, D3)', async () => {
    for (const policy of [EVERY_APP, OWN_APP]) {
      const { headers, passedOn } = await answer(policy, 'GET', undefined);
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(passedOn).toBe(true);
    }
  });

  it('an allowed answer carries the Worker\'s OWN methods and the one header list, on every response (rulings 1 and 3)', async () => {
    for (const policy of [EVERY_APP, OWN_APP]) {
      for (const method of ['GET', 'OPTIONS']) {
        const { headers } = await answer(policy, method, LISTED);
        expect(headers.get('Access-Control-Allow-Methods')).toBe(policy.methods.join(', '));
        expect(headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type, x-request-id, Idempotency-Key');
      }
    }
  });

  it('no answer carries Access-Control-Max-Age (ruling 2, D5)', async () => {
    for (const policy of [EVERY_APP, OWN_APP]) {
      for (const [method, origin] of [['OPTIONS', LISTED], ['OPTIONS', 'http://localhost:4000'], ['GET', undefined]] as const) {
        expect((await answer(policy, method, origin)).headers.has('Access-Control-Max-Age')).toBe(false);
      }
    }
  });

  it('a preflight is answered 204 here and never reaches a route; anything else is passed on', async () => {
    const pre = await answer(EVERY_APP, 'OPTIONS', 'https://evil.test');
    expect(pre.status).toBe(204);
    expect(pre.passedOn).toBe(false);
    const get = await answer(EVERY_APP, 'GET', LISTED);
    expect(get.passedOn).toBe(true);
  });
});

// ⏱ 2026-09-28 · ST-N1. The platform's captcha-free native sign-in must be
// unusable from a browser, listed origin or not; a native caller sends no Origin.
describe('refuseBrowsersOn: a path no browser may use, whatever the origin', () => {
  const NATIVE: CorsPolicy = { ...EVERY_APP, refuseBrowsersOn: ['/v1/auth/native/'] };
  const PATH = '/v1/auth/native/probe/token';

  it('refuses a request carrying Origin with 403 and no CORS header — even a LISTED origin — and never runs the route', async () => {
    for (const origin of [LISTED, 'https://evil.test']) {
      const r = await answer(NATIVE, 'POST', origin, LISTED, PATH);
      expect(r.status).toBe(403);
      expect(r.passedOn).toBe(false);
      expect([...r.headers.keys()].filter((k) => k.startsWith('Access-Control-'))).toEqual([]);
    }
  });

  it('refuses a preflight with 403, not 204', async () => {
    const r = await answer(NATIVE, 'OPTIONS', LISTED, LISTED, PATH);
    expect(r.status).toBe(403);
    expect(r.passedOn).toBe(false);
  });

  it('passes a native caller (no Origin) on untouched, and sets no CORS header', async () => {
    const r = await answer(NATIVE, 'POST', undefined, LISTED, PATH);
    expect(r.passedOn).toBe(true);
    expect(r.headers.size).toBe(0);
  });

  it('leaves every other path, and a policy without it, exactly as before', async () => {
    const other = await answer(NATIVE, 'POST', LISTED, LISTED, '/v1/events');
    expect(other.passedOn).toBe(true);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe(LISTED);
    const plain = await answer(EVERY_APP, 'POST', LISTED, LISTED, PATH);
    expect(plain.passedOn).toBe(true);
    expect(plain.headers.get('Access-Control-Allow-Origin')).toBe(LISTED);
  });
});
