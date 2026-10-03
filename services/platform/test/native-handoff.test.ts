// ─────────────────────────────────────────────────────────────────────────────
// native-handoff.test.ts — THE SYSTEM-BROWSER HAND-OFF (⏱ 2026-10-01, ADR draft
// `native-sign-in-per-target`; lib/native-attest/handoff.ts, routes/native-handoff.ts,
// routes/native-auth.ts POST …/handoff/token).
//
// WHAT IS BEING PROVEN, each case the shape of a way this could be wrong:
//   · the happy path: a FRESH web session mints, the app exchanges, and GoTrue is
//     asked for the user by id, a magic-link token for THAT user's address (no
//     mail), and a /verify — and the session comes back with no cookie;
//   · 🔴 SINGLE-USE: the second exchange of one code is refused, GoTrue unasked;
//   · 🔴 EXPIRES: one second past the TTL the code is refused;
//   · 🔴 PKCE-BOUND: a wrong verifier is refused — and does NOT burn the code;
//   · 🔴 ANOTHER CLIENT: another app, or another redirect, is refused;
//   · 🔴 REVOKED (⏱ 2026-10-02): "sign out everywhere" after the mint, or a revoke
//     of the minting session, refuses the code;
//   · 🔴 A GoTrue FAULT after the redemption gives the code back for a retry;
//   · a forged or tampered code is refused, and every refusal is ONE body;
//   · the mint: no token is 401, a stale sign-in is 401 with its own code, a
//     redirect that is not the app's own is 400, `plain` is 400, an unknown app 404;
//   · a browser cannot exchange (Origin → 403), the route is fail-closed without
//     its key, and no code, verifier or token reaches a log line.
// GoTrue and the JWKS are fakes behind a stubbed `fetch`. Nothing reaches a network.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import { corsMiddleware } from '../src/middleware/cors';
import { createNativeAuth } from '../src/routes/native-auth';
import { createNativeHandoff, HANDOFF_NEEDS_FRESH_SIGNIN, signedInJustNow } from '../src/routes/native-handoff';
import { isHandoffRedirect, NATIVE_HANDOFF_CODE_TTL_SECONDS } from '../src/lib/native-attest/handoff';
import { app as realApp } from '../src/index';
import type { AppEnv, RateLimiterBinding } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://handoff-test.gotrue.example';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SERVICE_KEY = 'service-role-key-made-up-for-this-test';
const CHALLENGE_KEY = 'challenge-key-made-up-for-this-test-0123456789';
const APP = 'subscriptiontracker';
const OTHER = 'budgetbuddy';
const USER = '6f1c2a3b-0000-4000-8000-000000000001';
const DEEP = `com.nikatru.${APP}://auth-callback?nk_auth=handoff`;
const LOOP = 'http://127.0.0.1:53111/nk-auth-callback';
const HASH = 'ab'.repeat(28);
const SESSION = {
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: USER, email: 'person@example.com' },
};

let signingKey: CryptoKey;
let publicJwk: JWK;

type Seen = { method: string; path: string; headers: Headers; body: Record<string, unknown> | null };
const gotrue: { seen: Seen[]; user: () => Response; link: () => Response; verify: () => Response } = {
  seen: [],
  user: () => new Response('{}'),
  link: () => new Response('{}'),
  verify: () => new Response('{}'),
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin !== SUPABASE_URL) throw new Error(`unexpected fetch in test: ${url.href}`);
    if (url.pathname.endsWith('/.well-known/jwks.json')) return json(200, { keys: [publicJwk] });
    const path = url.pathname.replace('/auth/v1', '');
    gotrue.seen.push({
      method: init.method ?? 'GET',
      path,
      headers: new Headers(init.headers),
      body: init.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    if (path.startsWith('/admin/users/')) return gotrue.user();
    if (path === '/admin/generate_link') return gotrue.link();
    if (path === '/verify') return gotrue.verify();
    throw new Error(`unexpected GoTrue path in test: ${path}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

class FakeLimiter implements RateLimiterBinding {
  private n = 0;
  constructor(private readonly cap: number) {}
  async limit(): Promise<{ success: boolean }> {
    this.n += 1;
    return { success: this.n <= this.cap };
  }
}

let db: RealDb;
let logs: string[];
beforeEach(() => {
  db = realPlatformDb();
  gotrue.seen = [];
  gotrue.user = () => json(200, { id: USER, email: 'person@example.com' });
  gotrue.link = () => json(200, { id: USER, hashed_token: HASH, action_link: 'https://x.example/verify?token=secret' });
  gotrue.verify = () => json(200, SESSION, { 'Set-Cookie': 'sb=1; Path=/' });
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

function env(over: Partial<AppEnv['Bindings']> = {}): AppEnv['Bindings'] {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ALLOWED_ORIGINS: 'https://nikatru.com',
    JWKS_CACHE: KV,
    SESSION_REVOKED: KV,
    SESSIONS_LIMITER: new FakeLimiter(1000),
    NATIVE_AUTH_EDGE_LIMITER: new FakeLimiter(1000),
    NATIVE_ATTEST_CHALLENGE_KEY: CHALLENGE_KEY,
    PLATFORM_DB: db,
    ...over,
  } as AppEnv['Bindings'];
}

/** Both halves for two apps, behind the shipped CORS middleware — the second app is the "other client". */
function worker(): Hono<AppEnv> {
  const w = new Hono<AppEnv>();
  w.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  w.use('*', corsMiddleware);
  w.route('/v1', createNativeHandoff([APP, OTHER]));
  w.route('/v1', createNativeAuth([APP, OTHER]));
  return w;
}

const secs = (ms: number) => Math.floor(ms / 1000);

async function jwt(claims: Record<string, unknown> = {}) {
  return new SignJWT({ sub: USER, email: 'person@example.com', amr: [{ method: 'password', timestamp: secs(Date.now()) }], ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function mint(
  o: { app?: string; redirect_uri?: string; challenge: string; method?: string; claims?: Record<string, unknown>; authz?: string | null; origin?: string },
  e = env(),
) {
  const authz = o.authz === null ? undefined : (o.authz ?? `Bearer ${await jwt(o.claims)}`);
  return worker().request(
    `/v1/auth/handoff/${o.app ?? APP}/code`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authz === undefined ? {} : { Authorization: authz }),
        ...(o.origin === undefined ? {} : { Origin: o.origin }),
      },
      body: JSON.stringify({
        redirect_uri: o.redirect_uri ?? LOOP,
        code_challenge: o.challenge,
        ...(o.method === undefined ? {} : { code_challenge_method: o.method }),
      }),
    },
    e,
  );
}

function exchange(o: { app?: string; code: string; verifier: string; redirect_uri?: string; origin?: string }, e = env()) {
  return worker().request(
    `/v1/auth/native/${o.app ?? APP}/handoff/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(o.origin === undefined ? {} : { Origin: o.origin }) },
      body: JSON.stringify({ code: o.code, code_verifier: o.verifier, redirect_uri: o.redirect_uri ?? LOOP }),
    },
    e,
  );
}

/** A minted code for a fresh PKCE pair. */
async function minted(redirect_uri = LOOP, e = env()) {
  const p = await pkce();
  const res = await mint({ challenge: p.challenge, redirect_uri }, e);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string; redirect_uri: string; expires_in: number };
  return { ...p, ...body };
}

const INVALID = { code: 400, error_code: 'invalid_grant', msg: 'The sign-in code is invalid, expired or already used' };

describe('the hand-off: a fresh web sign-in mints, the app exchanges', () => {
  it('mints for the loopback and the deep link, and answers the redirect it was given', async () => {
    for (const r of [LOOP, DEEP]) {
      const m = await minted(r);
      expect(m.redirect_uri).toBe(r);
      expect(m.expires_in).toBe(NATIVE_HANDOFF_CODE_TTL_SECONDS);
      expect(m.code).toMatch(/^h1\./);
      // ENCRYPTED: the user id is not readable in the code that rides in a URL.
      expect(m.code).not.toContain(USER);
      expect(atob(m.code.split('.')[2]!.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain(USER);
    }
  });

  it('exchanges for a NEW GoTrue session: user by id, a magic-link token for that address, /verify — no cookie', async () => {
    const m = await minted();
    const res = await exchange({ code: m.code, verifier: m.verifier });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SESSION);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(gotrue.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /admin/users/${USER}`,
      'POST /admin/generate_link',
      'POST /verify',
    ]);
    expect(gotrue.seen[1]!.body).toEqual({ type: 'magiclink', email: 'person@example.com' });
    expect(gotrue.seen[2]!.body).toEqual({ type: 'magiclink', token_hash: HASH });
    for (const s of gotrue.seen) expect(s.headers.get('Authorization')).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('🔴 SINGLE-USE: the second exchange of one code is refused, and GoTrue is not asked again', async () => {
    const m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(200);
    const asked = gotrue.seen.length;
    const again = await exchange({ code: m.code, verifier: m.verifier });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual(INVALID);
    expect(gotrue.seen.length).toBe(asked);
  });

  it('🔴 SINGLE-USE under a race: two concurrent exchanges yield exactly one session', async () => {
    const m = await minted();
    const [a, b] = await Promise.all([exchange({ code: m.code, verifier: m.verifier }), exchange({ code: m.code, verifier: m.verifier })]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('🔴 EXPIRES: one second past the TTL the code is refused; one second inside it is not', async () => {
    const t0 = Date.parse('2026-10-01T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(t0);
    const late = await minted();
    const inTime = await minted();
    vi.setSystemTime(t0 + (NATIVE_HANDOFF_CODE_TTL_SECONDS + 1) * 1000);
    const res = await exchange({ code: late.code, verifier: late.verifier });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    vi.setSystemTime(t0 + (NATIVE_HANDOFF_CODE_TTL_SECONDS - 1) * 1000);
    expect((await exchange({ code: inTime.code, verifier: inTime.verifier })).status).toBe(200);
  });

  it('🔴 PKCE-BOUND: a wrong verifier is refused — and does not burn the code for its holder', async () => {
    const m = await minted();
    const other = await pkce();
    const res = await exchange({ code: m.code, verifier: other.verifier });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    expect(gotrue.seen).toEqual([]);
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(200);
  });

  it('🔴 PKCE-BOUND: a verifier outside RFC 7636 §4.1 is refused before anything is read', async () => {
    const m = await minted();
    for (const v of ['short', `${m.verifier}!`, 'a'.repeat(129)]) {
      const res = await exchange({ code: m.code, verifier: v });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
    // ⏱ 2026-10-02 (review of #1133, finding 4): every verifier above also fails the
    // PKCE comparison, so the shape limb was never what refused it. This one MATCHES
    // its challenge and is one character too long — only the shape limb refuses it,
    // and the code is not burned.
    const long = 'a'.repeat(129);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(long))));
    const res = await mint({ challenge });
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    const refused = await exchange({ code, verifier: long });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual(INVALID);
    expect(gotrue.seen).toEqual([]);
  });

  it('🔴 REVOKED: "sign out everywhere" after the mint refuses the code; one before the mint does not', async () => {
    const revokedWith = (record: unknown) => env({ SESSION_REVOKED: { get: async () => record, put: async () => undefined } as unknown as KVNamespace });
    const before = secs(Date.now()) - 5;
    const m = await minted();
    const after = secs(Date.now()) + 1;
    const res = await exchange({ code: m.code, verifier: m.verifier }, revokedWith({ before: after, sids: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    expect(gotrue.seen).toEqual([]);
    expect(logs.some((l) => l.includes('hand-off refused (revoked)'))).toBe(true);
    // a sign-out that happened before this sign-in does not reach it
    expect((await exchange({ code: m.code, verifier: m.verifier }, revokedWith({ before, sids: [] }))).status).toBe(200);
  });

  it('🔴 REVOKED: a revoke of the session that minted the code refuses it; another session\'s does not', async () => {
    const revokedWith = (sid: string) =>
      env({ SESSION_REVOKED: { get: async () => ({ before: null, sids: [[sid, secs(Date.now())]] }), put: async () => undefined } as unknown as KVNamespace });
    const p = await pkce();
    const res = await mint({ challenge: p.challenge, claims: { session_id: 'sess-that-minted' } });
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    expect((await exchange({ code, verifier: p.verifier }, revokedWith('sess-that-minted'))).status).toBe(400);
    expect(gotrue.seen).toEqual([]);
    expect((await exchange({ code, verifier: p.verifier }, revokedWith('sess-of-another-device'))).status).toBe(200);
  });

  it('🔴 A GoTrue FAULT AFTER THE REDEMPTION does not burn the code: the retry gets the session', async () => {
    for (const fault of ['user', 'link', 'verify'] as const) {
      gotrue[fault] = () => json(502, {});
      const m = await minted();
      expect((await exchange({ code: m.code, verifier: m.verifier })).status, fault).toBe(503);
      gotrue.user = () => json(200, { id: USER, email: 'person@example.com' });
      gotrue.link = () => json(200, { id: USER, hashed_token: HASH });
      gotrue.verify = () => json(200, SESSION);
      expect((await exchange({ code: m.code, verifier: m.verifier })).status, fault).toBe(200);
      expect((await exchange({ code: m.code, verifier: m.verifier })).status, fault).toBe(400);
    }
  });

  it('a fault AFTER /verify minted a session is no fault to retry: the code stays spent', async () => {
    gotrue.verify = () => new Response('not json', { status: 200 });
    const m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(503);
    gotrue.verify = () => json(200, SESSION);
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(400);
  });

  it('🔴 ANOTHER CLIENT: a code minted for one app is refused at another app', async () => {
    const m = await minted();
    const res = await exchange({ app: OTHER, code: m.code, verifier: m.verifier });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);
    expect(gotrue.seen).toEqual([]);
  });

  it('🔴 ANOTHER CLIENT: a code minted for one redirect is refused at any other, byte for byte', async () => {
    const m = await minted(LOOP);
    for (const r of [DEEP, 'http://127.0.0.1:53112/nk-auth-callback', `${LOOP}/`, 'http://localhost:53111/nk-auth-callback']) {
      const res = await exchange({ code: m.code, verifier: m.verifier, redirect_uri: r });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
    expect(gotrue.seen).toEqual([]);
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(200);
  });

  it('refuses a forged, tampered or foreign-key code with the same body', async () => {
    const m = await minted();
    const parts = m.code.split('.');
    const flipped = parts[2]!.startsWith('A') ? `B${parts[2]!.slice(1)}` : `A${parts[2]!.slice(1)}`;
    const otherKey = await minted(LOOP, env({ NATIVE_ATTEST_CHALLENGE_KEY: 'a-different-challenge-key-0123456789abcdef' }));
    for (const code of ['h1.nope', `${parts[0]}.${parts[1]}.${flipped}`, otherKey.code, '']) {
      const res = await exchange({ code, verifier: m.verifier });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
  });

  it('a browser cannot exchange: an Origin is 403 and no code is read', async () => {
    const m = await minted();
    const res = await exchange({ code: m.code, verifier: m.verifier, origin: 'https://nikatru.com' });
    expect(res.status).toBe(403);
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(200);
  });

  it('withholds the session when GoTrue answers for another user; refuses a deleted or banned account', async () => {
    gotrue.verify = () => json(200, { ...SESSION, user: { id: 'someone-else' } });
    let m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(503);
    // a session WAS minted, so this is no fault to retry: the code stays spent
    gotrue.verify = () => json(200, SESSION);
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(400);

    gotrue.user = () => json(404, { code: 404, msg: 'User not found' });
    m = await minted();
    let res = await exchange({ code: m.code, verifier: m.verifier });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID);

    gotrue.user = () => json(200, { id: USER, email: 'person@example.com', banned_until: '2999-01-01T00:00:00Z' });
    m = await minted();
    res = await exchange({ code: m.code, verifier: m.verifier });
    expect(res.status).toBe(400);
    expect(gotrue.seen.filter((s) => s.path === '/admin/generate_link')).toHaveLength(1);
  });

  it('is 503 when GoTrue is down or the magic-link answer carries no token', async () => {
    gotrue.link = () => json(200, { id: USER });
    let m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(503);
    gotrue.user = () => json(500, {});
    m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier })).status).toBe(503);
  });

  it('FAILS CLOSED without its key: the mint and the exchange are 503; without its limiter the exchange is 503', async () => {
    const p = await pkce();
    expect((await mint({ challenge: p.challenge }, env({ NATIVE_ATTEST_CHALLENGE_KEY: undefined }))).status).toBe(503);
    const m = await minted();
    expect((await exchange({ code: m.code, verifier: m.verifier }, env({ NATIVE_ATTEST_CHALLENGE_KEY: undefined }))).status).toBe(503);
    expect((await exchange({ code: m.code, verifier: m.verifier }, env({ NATIVE_AUTH_EDGE_LIMITER: undefined }))).status).toBe(503);
  });

  it('never logs a code, a verifier or a token', async () => {
    const m = await minted();
    await exchange({ code: m.code, verifier: m.verifier });
    await exchange({ code: m.code, verifier: m.verifier });
    const all = logs.join('\n');
    for (const secret of [m.code, m.verifier, m.challenge, SESSION.access_token, SESSION.refresh_token, HASH, USER, 'person@example.com']) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('the mint: who may ask, and for where', () => {
  it('no token is 401', async () => {
    const p = await pkce();
    expect((await mint({ challenge: p.challenge, authz: null })).status).toBe(401);
  });

  it('🔴 a session that did not sign in just now is 401 with its own code', async () => {
    const p = await pkce();
    const stale = await mint({ challenge: p.challenge, claims: { amr: [{ method: 'password', timestamp: secs(Date.now()) - 601 }] } });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual(HANDOFF_NEEDS_FRESH_SIGNIN);
    const none = await mint({ challenge: p.challenge, claims: { amr: undefined } });
    expect(none.status).toBe(401);
    expect(signedInJustNow(1000, 1000 + 600)).toBe(true);
    expect(signedInJustNow(1000, 1000 + 601)).toBe(false);
    expect(signedInJustNow(1061, 1000)).toBe(false);
    expect(signedInJustNow(null, 1000)).toBe(false);
  });

  it('a redirect that is not the app\'s own return address is 400', async () => {
    const p = await pkce();
    for (const r of [
      `com.nikatru.${OTHER}://auth-callback?nk_auth=handoff`,
      `com.nikatru.${APP}://auth-callback`,
      `com.nikatru.${APP}://auth-callback?nk_auth=oauth`,
      'https://evil.example/nk-auth-callback',
      'http://localhost:53111/nk-auth-callback',
      'http://127.0.0.1:80/nk-auth-callback',
      // ⏱ 2026-10-02 (review of #1133, finding 5): :80 never reaches the `port >= 1024`
      // limb (the 4-5 digit pattern refuses it); 1000-1023 are the only ports that do.
      'http://127.0.0.1:1023/nk-auth-callback',
      'http://127.0.0.1:053111/nk-auth-callback',
      'http://127.0.0.1:53111/nk-auth-callback?x=1',
      'http://127.0.0.1:70000/nk-auth-callback',
    ]) {
      const res = await mint({ challenge: p.challenge, redirect_uri: r });
      expect(res.status, r).toBe(400);
      expect(await res.json()).toEqual({ error: 'redirect_uri_mismatch' });
    }
    expect(isHandoffRedirect(APP, LOOP)).toBe(true);
    expect(isHandoffRedirect(APP, DEEP)).toBe(true);
    expect(isHandoffRedirect(APP, 'http://127.0.0.1:1024/nk-auth-callback')).toBe(true);
  });

  it('S256 only: `plain` and a malformed challenge are 400', async () => {
    const p = await pkce();
    expect((await mint({ challenge: p.challenge, method: 'plain' })).status).toBe(400);
    expect((await mint({ challenge: 'too-short' })).status).toBe(400);
    expect((await mint({ challenge: p.challenge, method: 'S256' })).status).toBe(200);
  });

  it('an app that is not a native app is 404', async () => {
    const p = await pkce();
    expect((await mint({ app: 'nosuchapp', challenge: p.challenge })).status).toBe(404);
    expect((await mint({ app: 'Bad_App', challenge: p.challenge })).status).toBe(404);
  });

  it('is mounted on the shipped Worker, and a browser on the allowed origin may call it', async () => {
    const p = await pkce();
    const res = await realApp.request(
      `/v1/auth/handoff/${APP}/code`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://nikatru.com', Authorization: `Bearer ${await jwt()}` },
        body: JSON.stringify({ redirect_uri: LOOP, code_challenge: p.challenge, code_challenge_method: 'S256' }),
      },
      env(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://nikatru.com');
  });
});
