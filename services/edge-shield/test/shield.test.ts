// ─────────────────────────────────────────────────────────────────────────────
// The edge shield, driven through its REAL fetch handler with a stub origin and
// stub Rate Limiting bindings. LEAD RULING SHIELD-R1, row
// O-BOXES-UNSHIELDED-FROM-SPIKES. What each block holds:
//   · pass-through fidelity — the origin receives the incoming request itself
//     (method, URL, headers incl. the client address Cloudflare set, body
//     stream), and the client receives the origin's status, headers and body
//     plus `x-nikatru-shield: 1`, or the deployed RELEASE when there is one;
//   · a refusal with Retry-After per class (429; 503 for the refresh grant) from
//     ONE global cap each (LEAD RULING SHIELD-R3), in the shape the client
//     behind each host understands — and the Worker reads no client address and
//     no Origin to get there;
//   · 🔴 one client cannot starve another's sign-in — the three credential
//     classes are separate buckets, so filling one refuses nothing in the others
//     (SYN-A2 / PB-01, row O-ONE-CLIENT-CAN-EXHAUST-THE-CREDENTIAL-CAP);
//   · fail OPEN — an absent, throwing or rejecting limiter admits and is counted;
//   · the JWKS edge cache — one origin read per TTL whatever the query string,
//     a stale copy (never a 504) for at most an hour when the origin fails, a
//     back-off after a failed read, and a clean canonical origin read whose
//     answer is stored only when it is a JWKS;
//   · classification — what is counted, what is not, and why.
// No test reaches the network: ../_shared/test/no-network.ts rejects any fetch
// a test did not stub.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, {
  JWKS_MAX_STALE_SECONDS,
  JWKS_RETRY_BACKOFF_SECONDS,
  JWKS_REVALIDATE_TIMEOUT_MS,
  JWKS_STORE_SECONDS,
  JWKS_TTL_SECONDS,
  ORIGIN_RETRY_BUDGET_MS,
  ORIGIN_RETRY_MIN_MS,
  RETRY_AT_HEADER,
  REVALIDATE_UA,
  STALE_HEADER,
  STORED_AT_HEADER,
  shieldMark,
} from '../src/index';
import { CLASSES, classify, normalisePath, type ShieldClass } from '../src/classify';
import { failOpenSeen } from '../src/limit';
import type { Env, RateLimiterBinding } from '../src/types';

const AUTH = 'https://auth-api.nikatru.com';
const GT = 'https://glitchtip.nikatru.com';

type Counting = RateLimiterBinding & { calls: string[] };
/** Every binding of Env, present, each recording the keys it was asked about. */
type TestEnv = { [K in Exclude<keyof Env, 'RELEASE'>]-?: Counting };

/** A limiter that admits the first `limit` calls per key, then refuses. */
function counting(limit: number): Counting {
  const seen = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
  };
}

function fullEnv(globalLimit = 1000): TestEnv {
  return {
    AUTH_PASSWORD_GLOBAL_LIMITER: counting(globalLimit),
    AUTH_SIGNUP_RECOVER_GLOBAL_LIMITER: counting(globalLimit),
    AUTH_FACTOR_GLOBAL_LIMITER: counting(globalLimit),
    AUTH_REFRESH_GLOBAL_LIMITER: counting(globalLimit),
    AUTH_OTHER_GLOBAL_LIMITER: counting(globalLimit),
    INTAKE_GLOBAL_LIMITER: counting(globalLimit),
  };
}

/** The ExecutionContext the runtime hands the handler; records what it was asked. */
function ctx(): ExecutionContext & { waits: Promise<unknown>[]; passedThrough: number } {
  const c = {
    waits: [] as Promise<unknown>[],
    passedThrough: 0,
    waitUntil(p: Promise<unknown>) {
      c.waits.push(p);
    },
    passThroughOnException() {
      c.passedThrough++;
    },
    props: {},
  };
  return c as unknown as ExecutionContext & { waits: Promise<unknown>[]; passedThrough: number };
}

/** The stub origin: records every request it receives and answers with `reply`. */
let originCalls: Request[] = [];
let reply: (req: Request) => Response | Promise<Response> = () => new Response('origin', { status: 200 });
beforeEach(() => {
  originCalls = [];
  reply = () => new Response('origin', { status: 200 });
  vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request && init === undefined ? input : new Request(input, init);
    originCalls.push(req);
    return reply(req);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A Cache API stand-in, installed per test as `caches.default`. */
function stubCache() {
  const store = new Map<string, Response>();
  const cache = {
    store,
    async match(req: Request) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req: Request, res: Response) {
      store.set(req.url, res);
    },
  };
  vi.stubGlobal('caches', { default: cache });
  return cache;
}

/** A request as Cloudflare hands it to the Worker: the edge sets the client's
 *  address header itself, so every test request carries one — which is what
 *  lets the tests below prove the Worker never READS it. */
function req(url: string, init: RequestInit & { ip?: string | null } = {}): Request {
  const { ip = '203.0.113.7', ...rest } = init;
  const headers = new Headers(rest.headers);
  if (ip !== null) headers.set('CF-Connecting-IP', ip);
  return new Request(url, { ...rest, headers });
}

const password = (ip?: string) =>
  req(`${AUTH}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
    headers: { 'content-type': 'application/json', apikey: 'anon' },
    ip,
  });
const signup = (ip?: string) =>
  req(`${AUTH}/auth/v1/signup`, {
    method: 'POST',
    body: JSON.stringify({ email: 'b@example.com', password: 'y' }),
    headers: { 'content-type': 'application/json', apikey: 'anon' },
    ip,
  });
const factorVerify = (ip?: string) =>
  req(`${AUTH}/auth/v1/factors/f1/verify`, {
    method: 'POST',
    body: JSON.stringify({ challenge_id: 'c1', code: '123456' }),
    headers: { 'content-type': 'application/json', apikey: 'anon', authorization: 'Bearer t' },
    ip,
  });

describe('pass-through fidelity', () => {
  it('forwards the incoming request itself — method, URL, headers, client address and body', async () => {
    const r = req(`${AUTH}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      body: '{"email":"a@example.com","password":"x"}',
      headers: { 'content-type': 'application/json', apikey: 'anon-key', authorization: 'Bearer t', 'x-real-ip': '203.0.113.7' },
    });
    await worker.fetch(r, fullEnv(), ctx());
    expect(originCalls).toHaveLength(1);
    const got = originCalls[0];
    expect(got).toBe(r); // the SAME object: nothing was rebuilt, re-read or re-encoded
    expect(got.method).toBe('POST');
    expect(got.url).toBe(`${AUTH}/auth/v1/token?grant_type=password`);
    expect(got.headers.get('apikey')).toBe('anon-key');
    expect(got.headers.get('authorization')).toBe('Bearer t');
    expect(got.headers.get('CF-Connecting-IP')).toBe('203.0.113.7');
    expect(got.headers.get('x-real-ip')).toBe('203.0.113.7');
    expect(got.bodyUsed).toBe(false); // the shield never read the body; the origin gets the stream
    expect(await got.text()).toBe('{"email":"a@example.com","password":"x"}');
  });

  it('returns the origin status, headers and body, adding only x-nikatru-shield', async () => {
    reply = () =>
      new Response('{"error":"invalid_grant"}', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json', 'x-sb-error-code': 'invalid_credentials', 'set-cookie': 'a=1' },
      });
    const res = await worker.fetch(password(), fullEnv(), ctx());
    expect(res.status).toBe(400);
    expect(res.statusText).toBe('Bad Request');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-sb-error-code')).toBe('invalid_credentials');
    expect(res.headers.get('set-cookie')).toBe('a=1');
    expect(res.headers.get('x-nikatru-shield')).toBe('1');
    expect(await res.text()).toBe('{"error":"invalid_grant"}');
  });

  it('streams the origin body through without buffering it', async () => {
    const enc = new TextEncoder();
    let pulled = 0;
    reply = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            pulled++;
            if (pulled > 3) c.close();
            else c.enqueue(enc.encode(`chunk${pulled};`));
          },
        }),
        { status: 200 },
      );
    const res = await worker.fetch(req(`${GT}/api/0/organizations/`), fullEnv(), ctx());
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe('chunk1;chunk2;chunk3;');
  });

  it('passes a redirect through as a redirect (GoTrue /authorize answers 302)', async () => {
    reply = () => new Response(null, { status: 302, headers: { location: 'https://accounts.example/o' } });
    const res = await worker.fetch(req(`${AUTH}/auth/v1/authorize?provider=google`), fullEnv(), ctx());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://accounts.example/o');
    expect(res.headers.get('x-nikatru-shield')).toBe('1');
  });

  it('carries the shield header on a response the origin refused (the probe relies on it)', async () => {
    reply = () => new Response('forbidden', { status: 403 });
    const res = await worker.fetch(req(`${GT}/api/1/envelope/`, { method: 'POST', body: '' }), fullEnv(), ctx());
    expect(res.status).toBe(403);
    expect(res.headers.get('x-nikatru-shield')).toBe('1');
  });

  // Row O-EDGE-SHIELD-SMOKE-NOT-JOINED-TO-SHA: the deploy smoke reads THIS commit off the header.
  it('echoes the deployed RELEASE as the shield header, on a pass-through and on the JWKS cache path', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const env = { ...fullEnv(), RELEASE: sha };
    const passed = await worker.fetch(password(), env, ctx());
    expect(passed.headers.get('x-nikatru-shield')).toBe(sha);
    stubCache();
    const jwksAnswer = await worker.fetch(req(`${AUTH}/auth/v1/.well-known/jwks.json`), env, ctx());
    expect(jwksAnswer.headers.get('x-nikatru-shield')).toBe(sha);
  });

  it('marks itself in path with `1` when the RELEASE is absent or is not a commit SHA', () => {
    expect(shieldMark(undefined)).toBe('1');
    expect(shieldMark({})).toBe('1');
    expect(shieldMark({ RELEASE: '' })).toBe('1');
    expect(shieldMark({ RELEASE: 'v1' })).toBe('1');
    expect(shieldMark({ RELEASE: '0123456789ABCDEF0123456789ABCDEF01234567' })).toBe('1');
    expect(shieldMark({ RELEASE: '0123456789abcdef0123456789abcdef01234567' })).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('asks the runtime to pass through on an exception, before doing anything else', async () => {
    const c = ctx();
    await worker.fetch(password(), fullEnv(), c);
    expect(c.passedThrough).toBe(1);
  });
});

describe('refused with Retry-After, per class', () => {
  const cases: Array<[ShieldClass, () => Request]> = [
    ['auth-password', () => password()],
    ['auth-signup-recover', () => signup()],
    ['auth-factor', () => factorVerify()],
    ['auth-refresh', () => req(`${AUTH}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{}' })],
    ['auth-other', () => req(`${AUTH}/auth/v1/user`)],
    ['intake', () => req(`${GT}/api/1/envelope/`, { method: 'POST', body: 'x' })],
  ];

  for (const [cls, make] of cases) {
    it(`${cls}: the global cap refuses across DIFFERENT clients, keyed global:${cls}, with Retry-After = the period, and the origin never sees it`, async () => {
      const env = fullEnv(2);
      const statuses: number[] = [];
      for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
        const r = make();
        const moved = new Request(r, { headers: new Headers(r.headers) });
        moved.headers.set('CF-Connecting-IP', ip);
        statuses.push((await worker.fetch(moved, env, ctx())).status);
      }
      expect(statuses).toEqual([200, 200, CLASSES[cls].refusal]);
      expect(originCalls).toHaveLength(2);
      const used = (Object.keys(env) as Array<keyof TestEnv>).filter((k) => env[k].calls.length > 0);
      expect(used).toHaveLength(1);
      expect(new Set(env[used[0]].calls)).toEqual(new Set([`global:${cls}`]));
      const res = await worker.fetch(make(), env, ctx());
      expect(res.status).toBe(CLASSES[cls].refusal);
      expect(res.headers.get('Retry-After')).toBe(String(CLASSES[cls].period));
      expect(res.headers.get('x-nikatru-shield')).toBe('1');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  }

  it('🔴 reads NO client-address header and NO Origin, admitted or refused (LEAD RULING SHIELD-R3, rv-c21 SHIELD-F2)', async () => {
    // ADR no.011 / ADR no.020: no Worker reads a client-IP header. The request
    // still CARRIES one to the origin (the pass-through test holds that); the
    // Worker itself never asks for it, nor for the Origin.
    const asked: string[] = [];
    const get = Headers.prototype.get;
    vi.spyOn(Headers.prototype, 'get').mockImplementation(function (this: Headers, name: string) {
      asked.push(String(name).toLowerCase());
      return get.call(this, name);
    });
    for (const limit of [1000, 0]) {
      for (const [, make] of cases) {
        const r = make();
        const withOrigin = new Request(r, { headers: new Headers(r.headers) });
        withOrigin.headers.set('Origin', 'https://nikatru.com');
        withOrigin.headers.set('X-Forwarded-For', '198.51.100.9');
        asked.length = 0;
        await worker.fetch(withOrigin, fullEnv(limit), ctx());
        for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'origin', 'referer']) {
          expect(asked, `the Worker read ${h}`).not.toContain(h);
        }
      }
    }
  });

  it('every class but the refresh grant is refused 429; the refresh grant 503', () => {
    const by = Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.refusal]));
    expect(by).toEqual({
      'auth-password': 429,
      'auth-signup-recover': 429,
      'auth-factor': 429,
      'auth-refresh': 503,
      'auth-other': 429,
      intake: 429,
    });
  });

  it('auth: the refusal is GoTrue’s versioned over-limit shape, so the app shows "Too many attempts"', async () => {
    // gotrue-dart reads `code` when x-supabase-api-version is echoed and `error_code`
    // otherwise; packages/chassis_screens/lib/auth/auth_error_text.dart maps
    // over_request_rate_limit, or a message containing "rate limit", to authRateLimited.
    const env = fullEnv(0);
    const res = await worker.fetch(password(), env, ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get('x-sb-error-code')).toBe('over_request_rate_limit');
    expect(res.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = (await res.json()) as { message: string };
    expect(body).toEqual({
      code: 'over_request_rate_limit',
      error_code: 'over_request_rate_limit',
      msg: 'Request rate limit reached',
      message: 'Request rate limit reached',
    });
    expect(body.message.toLowerCase()).toContain('rate limit');
  });

  it('🔴 the refresh grant is refused 503, never 429: gotrue-dart signs the user out on a refresh 4xx', async () => {
    // gotrue-dart 2.26.0 _doRefresh: `error is! AuthRetryableFetchException` removes the
    // session and emits signedOut; only a 5xx or a network error is retryable. A 429
    // here would sign out every user whose hourly refresh landed in an over-limit minute.
    const env = fullEnv(0);
    const res = await worker.fetch(req(`${AUTH}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{}' }), env, ctx());
    expect(res.status).toBe(503);
    expect(res.status >= 500).toBe(true);
    expect(res.headers.get('Retry-After')).toBe(String(CLASSES['auth-refresh'].period));
    expect(((await res.json()) as { error_code: string }).error_code).toBe('over_request_rate_limit');
  });

  it('intake: the 429 carries X-Sentry-Rate-Limits, the Sentry protocol’s all-categories back-off', async () => {
    const env = fullEnv(0);
    const res = await worker.fetch(req(`${GT}/api/1/store/`, { method: 'POST', body: '{}' }), env, ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get('X-Sentry-Rate-Limits')).toBe(`${CLASSES.intake.period}::organization`);
    expect(res.headers.get('Retry-After')).toBe(String(CLASSES.intake.period));
    // an integer >= 1: a `0` is 0 s to sentry-dart and 60 s to sentry-cocoa
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('a browser can READ the refusal: `Access-Control-Allow-Origin: *`, never an echoed Origin, and Retry-After exposed', async () => {
    const env = fullEnv(0);
    const r = password();
    const withOrigin = new Request(r, { headers: new Headers(r.headers) });
    withOrigin.headers.set('Origin', 'https://nikatru.com');
    const res = await worker.fetch(withOrigin, env, ctx());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(res.headers.get('Vary')).toBeNull();
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
  });

  it('a PASSED-THROUGH answer keeps the origin’s own CORS headers, untouched', async () => {
    reply = () =>
      new Response('{}', {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': 'https://nikatru.com', 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' },
      });
    const res = await worker.fetch(req(`${AUTH}/auth/v1/user`), fullEnv(), ctx());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://nikatru.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toBe('Origin');
  });
});

describe('🔴 one client cannot starve another’s sign-in (SYN-A2 / PB-01, row O-ONE-CLIENT-CAN-EXHAUST-THE-CREDENTIAL-CAP)', () => {
  // Until 2026-10-01 every credential path shared ONE global bucket, and no
  // per-IP limit covered /token: one client's junk password posts filled it, and
  // every sign-up in the colo was refused here, before GoTrue could tell the two
  // clients apart. The deployed credential cap is 300/min (../wrangler.jsonc).
  const CAP = 300;

  /**
   * EVERY limiter the Worker asks for, each counting per key at `cap`, made on
   * the name the class table reads rather than from a fixed list. So this block
   * goes RED against the one shared bucket it replaced: a fixed list would leave
   * that bucket's binding absent, and the Worker would fail OPEN and admit.
   */
  function everyLimiter(cap: number): Env {
    const made = new Map<string, Counting>();
    return new Proxy({} as Env, {
      get: (_t, name) => {
        if (typeof name !== 'string' || !name.endsWith('_LIMITER')) return undefined;
        if (!made.has(name)) made.set(name, counting(cap));
        return made.get(name);
      },
    });
  }

  const refresh = (ip: string) => req(`${AUTH}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{}', ip });
  const user = (ip: string) => req(`${AUTH}/auth/v1/user`, { ip });
  const credential: Array<[ShieldClass, (ip: string) => Request]> = [
    ['auth-password', password],
    ['auth-signup-recover', signup],
    ['auth-factor', factorVerify],
  ];

  it('RED CONTROL: one client at 301 password posts does not 429 a second client’s POST /auth/v1/signup', async () => {
    const env = everyLimiter(CAP);
    const failedOpen = failOpenSeen();
    const flood: number[] = [];
    for (let i = 0; i <= CAP; i++) flood.push((await worker.fetch(password('198.51.100.1'), env, ctx())).status);
    // The flood DID fill its bucket — the limiter is live, not failing open.
    expect(flood.filter((st) => st === 200)).toHaveLength(CAP);
    expect(flood.at(-1)).toBe(429);
    const res = await worker.fetch(signup('198.51.100.2'), env, ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-nikatru-shield')).toBe('1');
    expect(originCalls.at(-1)?.url).toBe(`${AUTH}/auth/v1/signup`);
    expect(failOpenSeen()).toBe(failedOpen);
  });

  for (const [full, flood] of credential) {
    it(`${full} full refuses nothing in another credential class, the refresh grant or the backstop`, async () => {
      const env = everyLimiter(CAP);
      for (let i = 0; i < CAP; i++) await worker.fetch(flood('198.51.100.1'), env, ctx());
      expect((await worker.fetch(flood('198.51.100.1'), env, ctx())).status).toBe(429);
      const others = [...credential.filter(([cls]) => cls !== full).map(([, make]) => make), refresh, user];
      expect(others).toHaveLength(4);
      for (const make of others) {
        const r = make('198.51.100.2');
        expect((await worker.fetch(r, env, ctx())).status, new URL(r.url).pathname).toBe(200);
      }
    });
  }
});

describe('fail OPEN — the shield is never the reason auth is down', () => {
  it('a limiter that THROWS admits the request, logs shield_fail_open and counts it', async () => {
    const env = fullEnv();
    env.AUTH_PASSWORD_GLOBAL_LIMITER = {
      calls: [],
      async limit() {
        throw new Error('rate limiting service unavailable');
      },
    } as unknown as Counting;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = failOpenSeen();
    const res = await worker.fetch(password(), env, ctx());
    expect(res.status).toBe(200);
    expect(originCalls).toHaveLength(1);
    expect(failOpenSeen()).toBe(before + 1);
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(line).toMatchObject({ event: 'shield_fail_open', class: 'auth-password', isolateCount: before + 1 });
    expect(line.reason).toContain('rate limiting service unavailable');
    // the line carries the class, the reason and the count — nothing about the client
    expect(Object.keys(line).sort()).toEqual(['class', 'event', 'isolateCount', 'reason']);
  });

  it('a limiter that REJECTS its promise admits the request and is counted', async () => {
    const env = fullEnv();
    env.INTAKE_GLOBAL_LIMITER = {
      calls: [],
      limit: () => Promise.reject(new TypeError('network')),
    } as unknown as Counting;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = failOpenSeen();
    const res = await worker.fetch(req(`${GT}/api/1/envelope/`, { method: 'POST', body: 'x' }), env, ctx());
    expect(res.status).toBe(200);
    expect(failOpenSeen()).toBe(before + 1);
  });

  it('an ABSENT binding admits the request and is counted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = failOpenSeen();
    const res = await worker.fetch(password(), {}, ctx());
    expect(res.status).toBe(200);
    expect(failOpenSeen()).toBe(before + 1); // the one global limiter of the class
  });

  it('a limiter answering without a boolean admits and is counted', async () => {
    const env = fullEnv();
    env.AUTH_REFRESH_GLOBAL_LIMITER = { calls: [], limit: async () => ({}) } as unknown as Counting;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = failOpenSeen();
    const res = await worker.fetch(req(`${AUTH}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' }), env, ctx());
    expect(res.status).toBe(200);
    expect(failOpenSeen()).toBe(before + 1);
  });

});

describe('JWKS at the edge', () => {
  const jwks = '{"keys":[{"kty":"EC","kid":"k1"}]}';
  const CANONICAL = `${AUTH}/auth/v1/.well-known/jwks.json`;
  const MIN = 60;

  /** A cache already holding a copy read from the origin `ageS` seconds ago (a negative age is a stamp in the future). */
  function heldFor(ageS: number, body = '{"keys":[{"kty":"EC","kid":"old"}]}', extra: Record<string, string> = {}) {
    const cache = stubCache();
    cache.store.set(
      CANONICAL,
      new Response(body, {
        status: 200,
        headers: {
          'Cache-Control': `public, max-age=${JWKS_STORE_SECONDS}`,
          [STORED_AT_HEADER]: String(Date.now() - ageS * 1000),
          ...extra,
        },
      }),
    );
    return { cache, body };
  }
  const read = async (url = CANONICAL, init: Parameters<typeof req>[1] = {}) => {
    const c = ctx();
    const res = await worker.fetch(req(url, init), fullEnv(), c);
    await Promise.all(c.waits);
    return res;
  };
  const quietErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('reads the origin once per TTL and serves the rest from the cache, whatever the query string', async () => {
    const cache = stubCache();
    reply = () => new Response(jwks, { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 's=1' } });
    const first = await read();
    const second = await read(`${CANONICAL}?cb=123`);
    expect(originCalls).toHaveLength(1);
    expect(first.headers.get('x-nikatru-shield-cache')).toBe('MISS');
    expect(second.headers.get('x-nikatru-shield-cache')).toBe('HIT');
    expect(await second.text()).toBe(jwks);
    expect(second.headers.get('x-nikatru-shield')).toBe('1');
    const stored = [...cache.store.values()][0];
    // Stored for the storage lifetime, so the CACHE never expires it (an expired
    // lookup is the phantom 504). Freshness is judged from the stamp instead.
    expect(stored.headers.get('Cache-Control')).toBe(`public, max-age=${JWKS_STORE_SECONDS}`);
    expect(Number(stored.headers.get(STORED_AT_HEADER))).toBeGreaterThan(0);
    expect(stored.headers.get('set-cookie')).toBeNull();
    expect(first.headers.get('set-cookie')).toBeNull();
    expect(first.headers.get('Cache-Control')).toBe(`public, max-age=${JWKS_TTL_SECONDS}`);
    for (const r of [first, second]) {
      expect(r.headers.get(STORED_AT_HEADER)).toBeNull();
      expect(r.headers.get(RETRY_AT_HEADER)).toBeNull();
      expect(r.headers.get(STALE_HEADER)).toBeNull();
    }
    expect([...cache.store.keys()]).toEqual([CANONICAL]);
  });

  it('caches for exactly 300 s (the ruling’s bound)', () => {
    expect(JWKS_TTL_SECONDS).toBe(300);
  });

  it('a HIT tells downstream caches only the REMAINING freshness, never a fresh 300 s', async () => {
    // ONE instant for the stamp and the read: two wall-clock reads a millisecond
    // apart floor the remainder to 199 (review 2, finding 1).
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    heldFor(100);
    const res = await read();
    expect(originCalls).toHaveLength(0);
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('HIT');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${JWKS_TTL_SECONDS - 100}`);
  });

  it('🔴 the origin read is a CLEAN GET of the canonical URL: no client path variant, query or header', async () => {
    stubCache();
    reply = () => new Response(jwks, { status: 200 });
    await read(`${AUTH}/auth/v1//.well-known/JWKS.json/?cb=1`, {
      headers: { cookie: 'sb=secret', authorization: 'Bearer client', apikey: 'anon', 'user-agent': 'GlitchTip/6.2.6' },
    });
    expect(originCalls).toHaveLength(1);
    const sent = originCalls[0];
    expect(sent.url).toBe(CANONICAL);
    expect(sent.method).toBe('GET');
    expect(sent.headers.get('user-agent')).toBe(REVALIDATE_UA);
    for (const h of ['cookie', 'authorization', 'apikey', 'cf-connecting-ip']) expect(sent.headers.get(h)).toBeNull();
  });

  it('🔴 a path variant answered with a 200 that is NOT a JWKS is never cached, so the canonical read is never served it', async () => {
    const cache = stubCache();
    reply = () => new Response('<html>not a jwks</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const variant = await read(`${AUTH}/auth/v1//.well-known/JWKS.json/`);
    expect(variant.status).toBe(200);
    expect(cache.store.size).toBe(0);
    reply = () => new Response(jwks, { status: 200 });
    const canonical = await read();
    expect(canonical.headers.get('x-nikatru-shield-cache')).toBe('MISS');
    expect(await canonical.text()).toBe(jwks);
  });

  it.each(['<html>error</html>', '{"keys":[]}', '{}', 'null', ''])('🔴 a 200 whose body is %j is never stored', async (body) => {
    const cache = stubCache();
    reply = () => new Response(body, { status: 200 });
    await read();
    expect(cache.store.size).toBe(0);
  });

  it('never caches a non-200 answer', async () => {
    const cache = stubCache();
    reply = () => new Response('bad gateway', { status: 502 });
    const res = await read();
    expect(res.status).toBe(502);
    expect(cache.store.size).toBe(0);
  });

  it('a copy older than the TTL is revalidated, under a deadline, and a usable 200 replaces it', async () => {
    const { cache } = heldFor(JWKS_TTL_SECONDS + 1);
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    reply = () => new Response(jwks, { status: 200 });
    const res = await read();
    expect(originCalls).toHaveLength(1);
    expect(deadline).toHaveBeenCalledWith(JWKS_REVALIDATE_TIMEOUT_MS);
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('MISS');
    expect(await res.text()).toBe(jwks);
    expect(await [...cache.store.values()][0].clone().text()).toBe(jwks);
  });

  it('🔴 an origin outage of 59 minutes past freshness serves the stale copy, marked with its age', async () => {
    const age = JWKS_TTL_SECONDS + 59 * MIN;
    const { body } = heldFor(age);
    quietErrors();
    reply = () => new Response('down', { status: 503 });
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    expect(Number(res.headers.get(STALE_HEADER))).toBeGreaterThanOrEqual(age);
    expect(Number(res.headers.get(STALE_HEADER))).toBeLessThan(age + 5);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toBe(body);
  });

  it('🔴 an origin outage of 61 minutes past freshness returns the ORIGIN’S ERROR: a stale copy never hides an outage for long', async () => {
    heldFor(JWKS_TTL_SECONDS + 61 * MIN);
    reply = () => new Response('down', { status: 503 });
    const res = await read();
    expect(res.status).toBe(503);
    expect(res.headers.get(STALE_HEADER)).toBeNull();
    expect(JWKS_MAX_STALE_SECONDS).toBe(60 * MIN);
  });

  it('🔴 the 1 h bound holds DURING a back-off: a copy past it is never served stale, even with a live retry-at', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    heldFor(JWKS_TTL_SECONDS + JWKS_MAX_STALE_SECONDS + 1, undefined, { [RETRY_AT_HEADER]: String(1_700_000_000_000 + 30_000) });
    reply = () => new Response('down', { status: 503 });
    const res = await read();
    expect(originCalls).toHaveLength(1);
    expect(res.status).toBe(503);
    expect(res.headers.get(STALE_HEADER)).toBeNull();
  });

  it('🔴 a failed read never puts the old copy back over a FRESHER one another request stored meanwhile', async () => {
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    const { cache } = heldFor(JWKS_TTL_SECONDS + 60);
    quietErrors();
    // While this request waits on the origin, another one revalidates and stores.
    reply = () => {
      cache.store.set(
        CANONICAL,
        new Response(jwks, { status: 200, headers: { [STORED_AT_HEADER]: String(t0 + 1) } }),
      );
      return new Response('down', { status: 503 });
    };
    const res = await read();
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    const kept = [...cache.store.values()][0];
    expect(kept.headers.get(STORED_AT_HEADER)).toBe(String(t0 + 1));
    expect(kept.headers.get(RETRY_AT_HEADER)).toBeNull();
    expect(await kept.clone().text()).toBe(jwks);
  });

  it('🔴 an origin TIMEOUT with a stale copy held serves the copy — 200, never a 504', async () => {
    const { body } = heldFor(JWKS_TTL_SECONDS + 60);
    const err = quietErrors();
    reply = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    expect(res.headers.get(STALE_HEADER)).not.toBeNull();
    expect(res.headers.get(STORED_AT_HEADER)).toBeNull();
    expect(res.headers.get(RETRY_AT_HEADER)).toBeNull();
    expect(await res.text()).toBe(body);
    expect(err.mock.calls.flat().join(' ')).toContain('shield_jwks_stale');
  });

  it.each([500, 502, 504, 520, 530])('🔴 an origin %i with a stale copy held serves the copy, and keeps it', async (status) => {
    const { cache, body } = heldFor(JWKS_TTL_SECONDS + 60);
    quietErrors();
    reply = () => new Response('upstream', { status });
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    expect(await res.text()).toBe(body);
    expect(await [...cache.store.values()][0].clone().text()).toBe(body);
  });

  it('a 200 that is not a JWKS, with a stale copy held, serves the copy and stores nothing new', async () => {
    const { cache, body } = heldFor(JWKS_TTL_SECONDS + 60);
    quietErrors();
    reply = () => new Response('<html>maintenance</html>', { status: 200 });
    const res = await read();
    expect(res.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    expect(await res.text()).toBe(body);
    expect(await [...cache.store.values()][0].clone().text()).toBe(body);
  });

  it('🔴 after a failed revalidation the origin is NOT asked again for the back-off, then it is', async () => {
    const t0 = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    heldFor(JWKS_TTL_SECONDS + 60);
    quietErrors();
    reply = () => new Response('down', { status: 503 });
    await read();
    expect(originCalls).toHaveLength(1);

    clock.mockReturnValue(t0 + (JWKS_RETRY_BACKOFF_SECONDS - 1) * 1000);
    const during = await read();
    expect(originCalls).toHaveLength(1);
    expect(during.headers.get('x-nikatru-shield-cache')).toBe('STALE');
    expect(during.headers.get(RETRY_AT_HEADER)).toBeNull();

    clock.mockReturnValue(t0 + (JWKS_RETRY_BACKOFF_SECONDS + 1) * 1000);
    reply = () => new Response(jwks, { status: 200 });
    const after = await read();
    expect(originCalls).toHaveLength(2);
    expect(after.headers.get('x-nikatru-shield-cache')).toBe('MISS');
    expect(JWKS_RETRY_BACKOFF_SECONDS).toBeGreaterThanOrEqual(30);
    expect(JWKS_RETRY_BACKOFF_SECONDS).toBeLessThanOrEqual(60);
  });

  it('an origin 4xx passes through even with a copy held: a definite answer, not an outage', async () => {
    heldFor(JWKS_TTL_SECONDS + 60);
    reply = () => new Response('not found', { status: 404 });
    const res = await read();
    expect(res.status).toBe(404);
  });

  it('🔴 a copy stamped in the FUTURE is neither fresh nor a stale fallback: the origin is asked, and its error stands', async () => {
    heldFor(-60);
    reply = () => new Response('down', { status: 503 });
    const res = await read();
    expect(originCalls).toHaveLength(1);
    expect(res.status).toBe(503);
  });

  it('an entry with no stamp (stored before the stamp existed) is revalidated, not trusted', async () => {
    const cache = stubCache();
    cache.store.set(CANONICAL, new Response('{"keys":[{"kid":"legacy"}]}', { status: 200 }));
    reply = () => new Response(jwks, { status: 200 });
    const res = await read();
    expect(originCalls).toHaveLength(1);
    expect(await res.text()).toBe(jwks);
  });

  it('with NOTHING stored the origin read has no deadline: a slow success is never cut short', async () => {
    stubCache();
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    reply = () => new Response(jwks, { status: 200 });
    await read();
    expect(originCalls).toHaveLength(1);
    expect(deadline).not.toHaveBeenCalled();
  });

  it('a cache fault is a miss, never an outage', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: () => Promise.reject(new Error('cache down')),
        put: () => Promise.reject(new Error('cache down')),
      },
    });
    quietErrors();
    reply = () => new Response(jwks, { status: 200 });
    const res = await worker.fetch(req(CANONICAL), fullEnv(), ctx());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(jwks);
  });

  it('is not rate limited: a cached JWKS costs no limiter call', async () => {
    stubCache();
    reply = () => new Response(jwks, { status: 200 });
    const env = fullEnv(0);
    const res = await worker.fetch(req(CANONICAL), env, ctx());
    expect(res.status).toBe(200);
    for (const b of Object.values(env)) expect(b.calls).toHaveLength(0);
  });
});

describe('one retry on an origin fault (520/522), only where a repeat is safe', () => {
  // 2026-09-30 15:30:59Z POST /logout and 2026-10-01 15:00:51Z POST
  // /admin/generate_link: 520s with no line in Box C's logs — lost in transit.
  const faultThenOk = (status: number) => {
    let n = 0;
    reply = () => (++n === 1 ? new Response('origin fault', { status }) : new Response('ok', { status: 200 }));
  };

  for (const status of [520, 522]) {
    it(`a GET answered ${status} is asked once more, and the client gets the second answer`, async () => {
      faultThenOk(status);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = await worker.fetch(req(`${AUTH}/auth/v1/user`, { headers: { authorization: 'Bearer t' } }), fullEnv(), ctx());
      expect(originCalls).toHaveLength(2);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
      expect(res.headers.get('x-nikatru-shield')).toBe('1');
      expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/"event":"shield_origin_retry".*"first":/);
    });
  }

  it('POST /logout and POST /admin/generate_link are retried, with the SAME body on both attempts', async () => {
    for (const path of ['/auth/v1/logout', '/auth/v1/admin/generate_link']) {
      originCalls = [];
      faultThenOk(520);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const body = '{"type":"magiclink","email":"e2e@example.com"}';
      const res = await worker.fetch(req(`${AUTH}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } }), fullEnv(), ctx());
      expect(res.status).toBe(200);
      expect(originCalls).toHaveLength(2);
      expect(await originCalls[0].text()).toBe(body);
      expect(await originCalls[1].text()).toBe(body);
    }
  });

  it('🔴 never retried: the refresh grant, a password sign-in, /verify, /otp, /signup, /recover, and the crash intake', async () => {
    const posts = [
      `${AUTH}/auth/v1/token?grant_type=refresh_token`,
      `${AUTH}/auth/v1/token?grant_type=password`,
      `${AUTH}/auth/v1/verify`,
      `${AUTH}/auth/v1/otp`,
      `${AUTH}/auth/v1/signup`,
      `${AUTH}/auth/v1/recover`,
      `${GT}/api/1/envelope/`,
    ];
    for (const url of posts) {
      originCalls = [];
      reply = () => new Response('origin fault', { status: 520 });
      const res = await worker.fetch(req(url, { method: 'POST', body: '{}' }), fullEnv(), ctx());
      expect({ url, calls: originCalls.length, status: res.status }).toEqual({ url, calls: 1, status: 520 });
    }
  });

  // ⏱ 2026-10-02 · review 1 of #1140, finding 6: 524 joined this list. It
  // arrives after ~100 s, past the 30 s budget, and the origin had the request.
  // ⏱ 2026-10-02 · review 1 of #1140, finding 5 — the e-mail link and the OAuth
  // return are GETs that SPEND a one-time code; the never-retried case above
  // covered POST /verify only.
  it('🔴 never retried: GET /verify (an e-mail link) and GET /callback (an OAuth return), in any spelling', async () => {
    for (const url of [
      `${AUTH}/auth/v1/verify?token=x&type=signup&redirect_to=https://nikatru.com/`,
      `${AUTH}//AUTH/v1/Verify/?token=x&type=recovery`,
      `${AUTH}/auth/v1/callback?code=x&state=y`,
    ]) {
      for (const method of ['GET', 'HEAD']) {
        originCalls = [];
        reply = () => new Response('origin fault', { status: 520 });
        const res = await worker.fetch(req(url, { method }), fullEnv(), ctx());
        expect({ url, method, calls: originCalls.length, status: res.status }).toEqual({ url, method, calls: 1, status: 520 });
      }
    }
  });

  it('a definite answer is never retried: 500, 502, 503, 524 and 404 reach the client after ONE request', async () => {
    for (const status of [500, 502, 503, 524, 404]) {
      originCalls = [];
      reply = () => new Response('no', { status });
      const res = await worker.fetch(req(`${AUTH}/auth/v1/user`), fullEnv(), ctx());
      expect(res.status).toBe(status);
      expect(originCalls).toHaveLength(1);
    }
  });

  it('a second fault returns the FIRST answer, after exactly two requests', async () => {
    let n = 0;
    reply = () => new Response(`fault ${++n}`, { status: n === 1 ? 520 : 522 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await worker.fetch(req(`${AUTH}/auth/v1/user`), fullEnv(), ctx());
    expect(originCalls).toHaveLength(2);
    expect(res.status).toBe(520);
    expect(await res.text()).toBe('fault 1');
  });

  it('🔴 bounded: no retry once the budget is spent, and the retry is cut at what is left', async () => {
    expect(ORIGIN_RETRY_BUDGET_MS).toBe(30_000);
    const t0 = 1_000_000;
    const now = vi.spyOn(Date, 'now');
    // The first attempt "took" the whole budget less a second: below the floor, no retry.
    now.mockReturnValueOnce(t0).mockReturnValue(t0 + ORIGIN_RETRY_BUDGET_MS - 1_000);
    reply = () => new Response('fault', { status: 520 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await worker.fetch(req(`${AUTH}/auth/v1/user`), fullEnv(), ctx());
    expect(res.status).toBe(520);
    expect(originCalls).toHaveLength(1);
    expect(ORIGIN_RETRY_MIN_MS).toBeGreaterThan(1_000);
  });

  it('a retry that THROWS (its deadline, or the network) returns the first answer', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const r = input instanceof Request && init === undefined ? input : new Request(input, init);
      originCalls.push(r);
      if (++n === 1) return new Response('fault', { status: 522 });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await worker.fetch(req(`${AUTH}/auth/v1/user`), fullEnv(), ctx());
    expect(res.status).toBe(522);
    expect(originCalls).toHaveLength(2);
  });

  it('the retry log names a route, never an account id', async () => {
    faultThenOk(520);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.fetch(req(`${AUTH}/auth/v1/admin/users/0f8fad5b-d9cb-469f-a165-70867728950e`), fullEnv(), ctx());
    const line = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('/auth/v1/admin/users/<id>');
    expect(line).not.toContain('0f8fad5b');
  });
});

describe('classification', () => {
  const at = (u: string, m = 'POST') => classify(new URL(u), m);

  it('password: every /token grant but refresh_token, and a missing or repeated grant_type', () => {
    for (const u of [
      `${AUTH}/auth/v1/token?grant_type=password`,
      `${AUTH}/auth/v1/token?grant_type=pkce`,
      `${AUTH}/auth/v1/token?grant_type=id_token`,
      `${AUTH}/auth/v1/token`,
      `${AUTH}/auth/v1/token?grant_type=refresh_token&grant_type=password`,
      `${AUTH}/auth/v1/token?grant_type=`,
      `${AUTH}//auth/v1//TOKEN/?grant_type=password`,
    ]) {
      expect(at(u), u).toEqual({ kind: 'limit', cls: 'auth-password' });
    }
  });

  it('signup-recover: each path that mints an account, mails a credential or redeems what was mailed', () => {
    for (const u of [
      `${AUTH}/auth/v1/signup`,
      `${AUTH}/auth/v1/otp`,
      `${AUTH}/auth/v1/recover`,
      `${AUTH}/auth/v1/resend`,
      `${AUTH}/auth/v1/verify?token=x&type=signup`,
      `${AUTH}/auth/v1/magiclink`,
      `${AUTH}//auth/v1//SIGNUP/`,
    ]) {
      expect(at(u), u).toEqual({ kind: 'limit', cls: 'auth-signup-recover' });
    }
    expect(at(`${AUTH}/auth/v1/verify?token=x`, 'GET')).toEqual({ kind: 'limit', cls: 'auth-signup-recover' });
  });

  it('factor: MFA verify and challenge on any factor id, and reauthenticate', () => {
    for (const u of [
      `${AUTH}/auth/v1/factors/abc/verify`,
      `${AUTH}/auth/v1/factors/abc/challenge`,
      `${AUTH}/auth/v1/factors/0b6f2a1c-1d2e-4f50-8a9b-0c1d2e3f4a5b/verify/`,
      `${AUTH}/auth/v1/reauthenticate`,
    ]) {
      expect(at(u), u).toEqual({ kind: 'limit', cls: 'auth-factor' });
    }
    expect(at(`${AUTH}/auth/v1/reauthenticate`, 'GET')).toEqual({ kind: 'limit', cls: 'auth-factor' });
    // Enrolling, listing or removing a factor proves nothing: the wide backstop.
    for (const u of [`${AUTH}/auth/v1/factors`, `${AUTH}/auth/v1/factors/abc`]) {
      expect(at(u), u).toEqual({ kind: 'limit', cls: 'auth-other' });
    }
  });

  it('refresh: exactly one grant_type, and it is refresh_token', () => {
    expect(at(`${AUTH}/auth/v1/token?grant_type=refresh_token`)).toEqual({ kind: 'limit', cls: 'auth-refresh' });
  });

  it('other: every remaining /auth/v1 path is bounded by the wide backstop', () => {
    for (const u of [`${AUTH}/auth/v1/user`, `${AUTH}/auth/v1/logout`, `${AUTH}/auth/v1/settings`, `${AUTH}/auth/v1/admin/users`, `${AUTH}/auth/v1/health`]) {
      expect(at(u, 'GET'), u).toEqual({ kind: 'limit', cls: 'auth-other' });
    }
    expect(at(`${AUTH}/auth/v1/.well-known/jwks.json`, 'HEAD')).toEqual({ kind: 'limit', cls: 'auth-other' });
  });

  it('intake: envelope and store, any project id, with or without the trailing slash', () => {
    for (const u of [`${GT}/api/1/envelope/`, `${GT}/api/1/store/`, `${GT}/api/42/envelope`, `${GT}//api/7/STORE/`]) {
      expect(at(u), u).toEqual({ kind: 'limit', cls: 'intake' });
    }
  });

  it('pass: CORS preflights, the GlitchTip API, and anything off the two routes', () => {
    expect(at(`${AUTH}/auth/v1/token?grant_type=password`, 'OPTIONS')).toEqual({ kind: 'pass' });
    expect(at(`${GT}/api/1/envelope/`, 'OPTIONS')).toEqual({ kind: 'pass' });
    expect(at(`${GT}/api/0/organizations/nikatru/releases/`)).toEqual({ kind: 'pass' });
    expect(at(`${GT}/api/0/projects/nikatru/app/files/dsyms/`)).toEqual({ kind: 'pass' });
    expect(at(`${AUTH}/rest/v1/x`, 'GET')).toEqual({ kind: 'pass' });
    expect(at('https://example.com/auth/v1/token?grant_type=password')).toEqual({ kind: 'pass' });
  });

  it('JWKS: only a GET of the exact path is served from the cache', () => {
    expect(at(`${AUTH}/auth/v1/.well-known/jwks.json`, 'GET')).toEqual({ kind: 'jwks' });
    expect(at(`${AUTH}/auth/v1/.well-known/jwks.json?x=1`, 'get')).toEqual({ kind: 'jwks' });
  });

  it('normalisePath only ever moves a variant INTO a class', () => {
    expect(normalisePath('//Auth//v1///Token/')).toBe('/auth/v1/token');
    expect(normalisePath('/')).toBe('/');
  });
});
