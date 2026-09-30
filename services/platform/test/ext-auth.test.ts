// ─────────────────────────────────────────────────────────────────────────────
// G9 — the extension device credential (O-EXTENSION-ACCOUNT-CHECK-UNBUILT).
//
// 🔴 STEP ONE IS A MEASUREMENT, NOT AN ASSUMPTION. Whether Hono's `/*` also
// matches the EXACT path decided the mount shape: if it does, a composite on
// `app.use('/v1/entitlements', …)` alone lets a device credential through that
// line and then `/v1/entitlements/*`'s `platformAuth` answers 401 anyway.
// MEASURED at 42acef7c against the real app (hono 4.13.8): `platformAuth` ran
// TWICE on `GET /v1/entitlements` (both mounts) and ONCE on `/subject`. So
// index.ts now mounts ONE path-aware `entitlementsAuth` on `/v1/entitlements/*`,
// and the first describe block pins both the library fact and the new shape.
//
// 🔴 EVERY ASSERTION BELOW GRADES THE REAL APP (`{ app }` from src/index), as
// test/cors.test.ts does — never a hand-built copy of its mounts. A copy is what
// test/bundle-entitlements.test.ts keeps, and a mutation of index.ts cannot turn
// a copy red (R8). The one substitution is lib/ext-redirects.ts: the shipped
// register holds `null` for every channel (the dark launch), so the flow is
// driven against a FIXTURE register with non-null redirect URIs, and a separate
// case proves the real register is still all-null.
//
// Real ES256 keys, a real SQL engine with the real migrations, and a stubbed
// JWKS fetch — the shape test/entitlements.test.ts established. No real key,
// token or store id appears here.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { app } from '../src/index';
import { platformAuth } from '../src/middleware/auth';
import { entitlementsAuth, extDeviceAuth, sha256Hex } from '../src/middleware/ext-device-auth';
import { EXT_CODE_TTL_MS } from '../src/routes/ext';
import { EXT_CHANNELS } from '../src/lib/ext-redirects';
import { EXT_LINK_IDLE_DAYS, EXT_LINK_MAX_AGE_DAYS } from '../src/lib/ext-links';
import { erasePlatformRows } from '../src/lib/platform-erasure';
import type { AppEnv } from '../src/types';
import { mountedEndpoints, probePath } from '../../_shared/test/preflight';
import { realPlatformDb, type RealDb } from './harness';

// ── the fixture register ─────────────────────────────────────────────────────
// Shapes only: 32 a-p characters for a Chromium id, a 40-hex host for Firefox.
// ⏱ 2026-09-30 · EXA-04: all three are non-null so the success path runs on
// EVERY channel; R12 nulls one inside its own case (`withNull`) and restores it.
const { FIXTURE } = vi.hoisted(() => ({
  FIXTURE: {
    'chrome-webstore': 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
    'edge-addons': 'https://ponmlkjihgfedcbaponmlkjihgfedcba.chromiumapp.org/',
    amo: 'https://0123456789abcdef0123456789abcdef01234567.extensions.allizom.org/',
  } as Record<string, string | null>,
}));
vi.mock('../src/lib/ext-redirects', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/ext-redirects')>();
  return { ...real, extensionRedirectUri: (channel: string) => FIXTURE[channel] ?? null };
});

const CHROME = FIXTURE['chrome-webstore'] as string;
const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: KeyLike;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

async function jwt(sub: string, claims: Record<string, unknown> = {}) {
  return new SignJWT({ sub, email: `${sub}@example.com`, ...claims })
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

/** A fresh PKCE pair: a 43-character verifier and its S256 challenge. */
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** The REAL app, over a real engine, with the env the shipped Worker has. */
function harness({ db = realPlatformDb() as RealDb | D1Database, limiter }: { db?: RealDb | D1Database; limiter?: AppEnv['Bindings']['EXT_TOKEN_CEILING_LIMITER'] } = {}) {
  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: 'live',
    ALLOWED_ORIGINS: 'https://nikatru.com',
    EXT_TOKEN_CEILING_LIMITER: limiter,
    // POST /v1/sessions/revoke-all (EXA-11) writes the KV record too; the
    // no-op store answers every read with null, so no token is refused by it.
    SESSION_REVOKED: KV,
    SESSIONS_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as AppEnv['Bindings'];
  const send = (method: string, path: string, init: { authz?: string; body?: unknown; origin?: string } = {}) =>
    app.request(
      path,
      {
        method,
        headers: {
          ...(init.authz === undefined ? {} : { Authorization: init.authz }),
          ...(init.origin === undefined ? {} : { Origin: init.origin }),
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      env,
    );
  return {
    db: db as RealDb,
    send,
    mint: async (sub: string, o: { channel?: string; redirect_uri?: string; challenge: string; method?: string; product?: string }) =>
      send('POST', '/v1/ext/codes', {
        authz: `Bearer ${await jwt(sub)}`,
        body: {
          product: o.product ?? 'fullshot',
          channel: o.channel ?? 'chrome-webstore',
          redirect_uri: o.redirect_uri ?? CHROME,
          code_challenge: o.challenge,
          ...(o.method === undefined ? {} : { code_challenge_method: o.method }),
        },
      }),
    devices: async (sub: string, claims: Record<string, unknown> = {}) =>
      send('GET', '/v1/ext/devices', { authz: `Bearer ${await jwt(sub, claims)}` }),
    unlink: async (sub: string, linkId: string) =>
      send('DELETE', `/v1/ext/devices/${linkId}`, { authz: `Bearer ${await jwt(sub)}` }),
    exchange: (code: string, verifier: string, redirect_uri = CHROME) =>
      send('POST', '/v1/ext/token', { body: { code, code_verifier: verifier, redirect_uri } }),
    read: (token: string, appId = 'fullshot') =>
      send('GET', `/v1/entitlements?app_id=${appId}`, { authz: `Bearer ${token}` }),
    revoke: (token: string) => send('POST', '/v1/ext/revoke', { authz: `Bearer ${token}` }),
  };
}
type H = ReturnType<typeof harness>;

/** Sign in, mint, exchange: a live device credential for `sub` on `channel`. */
async function connect(h: H, sub: string, channel = 'chrome-webstore') {
  const redirect = FIXTURE[channel] as string;
  const { verifier, challenge } = await pkce();
  const minted = await h.mint(sub, { challenge, channel, redirect_uri: redirect });
  expect(minted.status).toBe(200);
  const { code } = (await minted.json()) as { code: string };
  const res = await h.exchange(code, verifier, redirect);
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; link_id: string };
}

/** Runs `fn` with `channel`'s fixture redirect set to null — the dark state. */
async function withNull<T>(channel: string, fn: () => Promise<T>): Promise<T> {
  const was = FIXTURE[channel];
  FIXTURE[channel] = null;
  try {
    return await fn();
  } finally {
    FIXTURE[channel] = was;
  }
}

/** The handlers the REAL app's router matches for one request, in order. */
function matched(method: string, path: string): unknown[] {
  const [hits] = app.router.match(method, path) as unknown as [[[unknown, unknown], unknown][]];
  return hits.map(([[handler]]) => handler);
}

// ═════════════════════════════════════════════════════════════════════════════
describe('the Hono measurement (ruling 1) and the mount shape it chose', () => {
  it('hono: `/*` ALSO matches the exact path — the library fact the one-line mount rests on', () => {
    const probe = new Hono();
    const mw = async (_c: unknown, next: () => Promise<void>) => next();
    probe.use('/x/*', mw);
    probe.get('/x', (c) => c.text('ok'));
    const [hits] = probe.router.match('GET', '/x') as unknown as [[[unknown, unknown], unknown][]];
    // MEASURED 2026-09-24 (hono 4.13.8): 1. If a Hono upgrade makes this 0, the
    // one-line mount in index.ts would leave GET /v1/entitlements UNAUTHENTICATED.
    expect(hits.filter(([[h]]) => h === mw)).toHaveLength(1);
  });

  it('GET /v1/entitlements runs entitlementsAuth exactly once, and no bare platformAuth', () => {
    const hs = matched('GET', '/v1/entitlements');
    expect(hs.filter((h) => h === entitlementsAuth)).toHaveLength(1);
    expect(hs.filter((h) => h === platformAuth)).toHaveLength(0);
  });

  it('GET /v1/entitlements/subject runs entitlementsAuth exactly once (it hands every JWT path to platformAuth)', () => {
    const hs = matched('GET', '/v1/entitlements/subject');
    expect(hs.filter((h) => h === entitlementsAuth)).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('G9 — the device credential is accepted on EXACTLY two requests of the real app', () => {
  it('🔴 every mounted route that refuses an anonymous caller refuses the device credential too, except the two', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-g9');
    const endpoints = mountedEndpoints(app.routes);
    // The domain is non-trivial or the loop below proves nothing.
    expect(endpoints.length).toBeGreaterThan(10);
    const acceptedByDevice: string[] = [];
    const authenticated: string[] = [];
    for (const e of endpoints) {
      const path = probePath(e.path) + (e.path === '/v1/entitlements' ? '?app_id=fullshot' : '');
      const body = e.method === 'GET' || e.method === 'HEAD' ? undefined : {};
      const anon = await h.send(e.method, path, { body });
      if (anon.status !== 401) continue; // a public route: nothing to authenticate
      authenticated.push(`${e.method} ${e.path}`);
      const dev = await h.send(e.method, path, { authz: `Bearer ${token}`, body });
      if (dev.status !== 401) acceptedByDevice.push(`${e.method} ${e.path}`);
    }
    // MEASURED 2026-09-24: 10 authenticated routes. A floor, so a route table
    // that stopped answering 401 anonymously cannot empty this loop into a pass.
    expect(authenticated.length, authenticated.join(', ')).toBeGreaterThanOrEqual(10);
    expect(acceptedByDevice.sort()).toEqual(['GET /v1/entitlements', 'POST /v1/ext/revoke']);
  });

  it('R7 — an nkx1_ bearer on DELETE /v1/account is 401', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r7a');
    expect((await h.send('DELETE', '/v1/account', { authz: `Bearer ${token}` })).status).toBe(401);
  });

  it('R7 — an nkx1_ bearer on PUT /v1/account/apple-token (a /v1/account/* route) is 401', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r7b');
    const res = await h.send('PUT', '/v1/account/apple-token', { authz: `Bearer ${token}`, body: {} });
    expect(res.status).toBe(401);
  });

  it('R7 — an nkx1_ bearer on GET /v1/entitlements/subject is 401', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r7c');
    expect((await h.send('GET', '/v1/entitlements/subject', { authz: `Bearer ${token}` })).status).toBe(401);
  });

  it('a JWT still reads GET /v1/entitlements/subject — the composite hands it to platformAuth unchanged', async () => {
    const h = harness();
    const res = await h.send('GET', '/v1/entitlements/subject', { authz: `Bearer ${await jwt('user-jwt')}` });
    expect(res.status).toBe(200);
  });

  it('extDeviceAuth sets userId and NOTHING else — no userEmail, no authRecency', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-vars');
    const probe = new Hono<AppEnv>();
    probe.get('/p', extDeviceAuth, (c) =>
      c.json({ userId: c.get('userId'), userEmail: c.get('userEmail') ?? null, authRecency: c.get('authRecency') ?? null }),
    );
    const res = await probe.request('/p', { headers: { Authorization: `Bearer ${token}` } }, {
      PLATFORM_DB: h.db,
    } as unknown as AppEnv['Bindings']);
    expect(await res.json()).toEqual({ userId: 'user-vars', userEmail: null, authRecency: null });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the one-time code — minting (POST /v1/ext/codes)', () => {
  it('answers {code, redirect_uri} with the REGISTER value, and stores only the SHA-256 of the code', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-m1', { challenge });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { code: string; redirect_uri: string };
    expect(Object.keys(body).sort()).toEqual(['code', 'redirect_uri']);
    expect(body.redirect_uri).toBe(CHROME);
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const rows = h.db.rows('SELECT * FROM ext_codes');
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toBe(await sha256Hex(body.code));
    expect(JSON.stringify(rows)).not.toContain(body.code);
    // ONE clock read: expires_at is created_at + 120 000 ms, both ISO TEXT.
    expect(Date.parse(String(rows[0].expires_at)) - Date.parse(String(rows[0].created_at))).toBe(EXT_CODE_TTL_MS);
    expect(h.db.rows("SELECT typeof(expires_at) AS t FROM ext_codes")[0].t).toBe('text');
  });

  it('without a JWT it is 401', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.send('POST', '/v1/ext/codes', {
      body: { product: 'fullshot', channel: 'chrome-webstore', redirect_uri: CHROME, code_challenge: challenge },
    });
    expect(res.status).toBe(401);
  });

  it('refuses a product other than fullshot', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-m2', { challenge, product: 'subscriptiontracker' });
    expect(res.status).toBe(400);
    expect(h.db.count('ext_codes')).toBe(0);
  });

  it('refuses a channel that is not one of the three', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-m3', { challenge, channel: 'android-play' });
    expect(res.status).toBe(400);
    expect(h.db.count('ext_codes')).toBe(0);
  });

  it('R12 — refuses a channel whose extensionRedirectUri is null', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await withNull('edge-addons', () =>
      h.mint('user-r12', { challenge, channel: 'edge-addons', redirect_uri: 'https://x.example/' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'channel_not_enabled' });
    expect(h.db.count('ext_codes')).toBe(0);
  });

  it('R12 — the SHIPPED register is null on all three channels, so production mints nothing (the dark launch)', async () => {
    const real = await vi.importActual<typeof import('../src/lib/ext-redirects')>('../src/lib/ext-redirects');
    expect(real.EXT_CHANNELS.map((ch) => real.extensionRedirectUri(ch))).toEqual([null, null, null]);
  });

  it('R4 — refuses redirect_uri + "x" at mint (byte-for-byte, no prefix match)', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-r4a', { challenge, redirect_uri: `${CHROME}x` });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'redirect_uri_mismatch' });
  });

  it('refuses a redirect_uri without its trailing slash — no leniency either way', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-slash', { challenge, redirect_uri: CHROME.replace(/\/$/, '') });
    expect(res.status).toBe(400);
  });

  it('refuses code_challenge_method "plain" — S256 only', async () => {
    const h = harness();
    const { challenge } = await pkce();
    const res = await h.mint('user-plain', { challenge, method: 'plain' });
    expect(res.status).toBe(400);
    expect(h.db.count('ext_codes')).toBe(0);
  });

  it('refuses a challenge that is not an S256 digest (a verifier sent as its own challenge, i.e. plain)', async () => {
    const h = harness();
    const res = await h.mint('user-plain2', { challenge: 'a'.repeat(64) });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the one-time code — exchange (POST /v1/ext/token)', () => {
  it('answers {token, link_id} once; the token is nkx1_ + 43 base64url chars and only its hash is stored', async () => {
    const h = harness();
    const { token, link_id } = await connect(h, 'user-x1');
    expect(token).toMatch(/^nkx1_[A-Za-z0-9_-]{43}$/);
    const rows = h.db.rows('SELECT * FROM ext_devices');
    expect(rows).toHaveLength(1);
    expect(rows[0].link_id).toBe(link_id);
    expect(rows[0].user_id).toBe('user-x1');
    expect(rows[0].token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('R1 — the same code exchanged twice: the second is refused', async () => {
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-r1', { challenge })).json()) as { code: string };
    expect((await h.exchange(code, verifier)).status).toBe(200);
    const second = await h.exchange(code, verifier);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: 'invalid_grant' });
    expect(h.db.count('ext_devices')).toBe(1);
  });

  it('R1 — the same code exchanged twice CONCURRENTLY: exactly one 200', async () => {
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-r1c', { challenge })).json()) as { code: string };
    const statuses = (await Promise.all([h.exchange(code, verifier), h.exchange(code, verifier)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 400]);
    expect(h.db.count('ext_devices')).toBe(1);
  });

  it('R2 — at created + 119 999 ms the exchange succeeds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-24T12:00:00.000Z'));
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-r2a', { challenge })).json()) as { code: string };
    vi.setSystemTime(Date.parse('2026-09-24T12:00:00.000Z') + EXT_CODE_TTL_MS - 1);
    expect((await h.exchange(code, verifier)).status).toBe(200);
  });

  it('R2 — at created + 120 000 ms the exchange is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-24T12:00:00.000Z'));
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-r2b', { challenge })).json()) as { code: string };
    vi.setSystemTime(Date.parse('2026-09-24T12:00:00.000Z') + EXT_CODE_TTL_MS);
    const res = await h.exchange(code, verifier);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    expect(h.db.count('ext_devices')).toBe(0);
  });

  it('R3 — a code_verifier whose S256 does not match is refused (and the code is burned)', async () => {
    const h = harness();
    const { verifier, challenge } = await pkce();
    const other = await pkce();
    const { code } = (await (await h.mint('user-r3', { challenge })).json()) as { code: string };
    const res = await h.exchange(code, other.verifier);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    expect((await h.exchange(code, verifier)).status).toBe(400);
    expect(h.db.count('ext_devices')).toBe(0);
  });

  it('refuses a verifier shorter than 43 characters (RFC 7636 §4.1)', async () => {
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-short', { challenge })).json()) as { code: string };
    expect((await h.exchange(code, verifier.slice(0, 42))).status).toBe(400);
  });

  it('R4 — redirect_uri + "x" at exchange is refused, with the same generic body', async () => {
    const h = harness();
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-r4b', { challenge })).json()) as { code: string };
    const res = await h.exchange(code, verifier, `${CHROME}x`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    expect(h.db.count('ext_devices')).toBe(0);
  });

  it('an unknown code gets the SAME body as an expired, reused or mismatched one — no oracle', async () => {
    const h = harness();
    const { verifier } = await pkce();
    const res = await h.exchange('A'.repeat(22), verifier);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('the edge ceiling refuses with 429 BEFORE the code is touched', async () => {
    const h = harness({ limiter: { limit: async () => ({ success: false }) } });
    const { verifier, challenge } = await pkce();
    const { code } = (await (await h.mint('user-429', { challenge })).json()) as { code: string };
    expect((await h.exchange(code, verifier)).status).toBe(429);
    expect(h.db.count('ext_codes', 'used_at IS NULL')).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the device credential — read, revoke, and the status codes the extension relies on', () => {
  it('reads GET /v1/entitlements?app_id=fullshot with the unchanged envelope', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-read');
    const res = await h.read(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.app_id).toBe('fullshot');
    expect(body.is_pro).toBe(false);
  });

  it('R5 — revoke device A: A reads 401, B (same user) still reads 200', async () => {
    const h = harness();
    const a = await connect(h, 'user-r5');
    const b = await connect(h, 'user-r5');
    expect((await h.revoke(a.token)).status).toBe(200);
    expect((await h.read(a.token)).status).toBe(401);
    expect((await h.read(b.token)).status).toBe(200);
    expect(h.db.count('ext_devices', 'revoked_at IS NOT NULL')).toBe(1);
  });

  it('R6 — a fullshot device asking for another app is 403', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r6');
    const res = await h.read(token, 'subscriptiontracker');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'wrong_product' });
  });

  it('R9 — D1 throws during the device lookup: 503, NEVER 401', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r9');
    const real = h.db;
    const broken = {
      prepare(sql: string) {
        if (sql.includes('FROM ext_devices WHERE token_hash')) throw new Error('D1_ERROR: simulated outage');
        return real.prepare(sql);
      },
      batch: (s: never) => real.batch(s),
    } as unknown as D1Database;
    const res = await harness({ db: broken }).read(token);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'service_unavailable' });
  });

  it('an unknown nkx1_ credential is 401 — the extension deletes it', async () => {
    const h = harness();
    expect((await h.read(`nkx1_${'A'.repeat(43)}`)).status).toBe(401);
  });

  it('last_seen_at is written at most once per UTC day', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-seen');
    const writes = () => h.db.sql.filter((s) => s.startsWith('UPDATE ext_devices SET last_seen_at')).length;
    expect((await h.read(token)).status).toBe(200);
    expect((await h.read(token)).status).toBe(200);
    expect(writes()).toBe(1);
    expect(h.db.rows('SELECT last_seen_at FROM ext_devices')[0].last_seen_at).not.toBeNull();
  });

  it('R10 — Origin moz-extension://… on the device path gets NO Access-Control-Allow-Origin', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r10a');
    const res = await h.send('GET', '/v1/entitlements?app_id=fullshot', {
      authz: `Bearer ${token}`,
      origin: 'moz-extension://2b1a2d4e-0000-4000-8000-000000000000',
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('R10 — Origin chrome-extension://… on the device path gets NO Access-Control-Allow-Origin', async () => {
    const h = harness();
    const { token } = await connect(h, 'user-r10b');
    const res = await h.send('GET', '/v1/entitlements?app_id=fullshot', {
      authz: `Bearer ${token}`,
      origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('the connect page origin (https://nikatru.com) IS allowed on /v1/ext/codes — CORS unchanged', async () => {
    const h = harness();
    const res = await h.send('OPTIONS', '/v1/ext/codes', { origin: 'https://nikatru.com' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://nikatru.com');
  });

  it('account erasure removes every code and every device, so the credential dies with the account', async () => {
    // ⏱ 2026-09-30 · EXA-10 — THROUGH THE ERASURE CODE ITSELF. This case ran its
    // own DELETE until the round-2 review, which proved only that a missing row
    // reads 401. It now calls the walk DELETE /v1/account and the nightly retry
    // run (lib/platform-erasure.ts), so it goes red the day that walk's
    // schema derivation stops reaching ext_devices or ext_codes.
    const h = harness();
    const { token } = await connect(h, 'user-erase');
    const other = await connect(h, 'user-kept');
    const { challenge } = await pkce();
    expect((await h.mint('user-erase', { challenge })).status).toBe(200); // an unexchanged code too
    const erased = await erasePlatformRows(h.db as unknown as D1Database, 'user-erase');
    expect(erased.ok).toBe(true);
    if (!erased.ok) return;
    expect(erased.deleted.ext_devices).toBe(1);
    expect(erased.deleted.ext_codes).toBe(2);
    expect(h.db.count('ext_devices', "user_id = 'user-erase'")).toBe(0);
    expect(h.db.count('ext_codes', "user_id = 'user-erase'")).toBe(0);
    expect((await h.read(token)).status).toBe(401);
    expect((await h.read(other.token)).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⏱ 2026-09-30 · EXA-04 — THE SUCCESS PATH ON EVERY CHANNEL. It ran on
// chrome-webstore only, with the amo fixture declared and unused. The loop is
// over the REAL EXT_CHANNELS, so a fourth channel joins it by construction.
describe.each(EXT_CHANNELS.map((ch) => [ch]))('EXA-04 — mint, exchange, read, revoke on %s', (channel) => {
  it('links, reads 200, revokes itself, then reads 401 — and the link records its channel', async () => {
    const h = harness();
    const { token, link_id } = await connect(h, `user-ch-${channel}`, channel);
    expect(h.db.rows('SELECT channel FROM ext_devices WHERE link_id = ?', link_id)[0].channel).toBe(channel);
    expect((await h.read(token)).status).toBe(200);
    expect((await h.revoke(token)).status).toBe(200);
    expect((await h.read(token)).status).toBe(401);
  });

  it("🔴 a code minted for this channel is refused at exchange with ANOTHER channel's redirect_uri", async () => {
    const h = harness();
    const other = EXT_CHANNELS.find((c) => c !== channel) as string;
    const { verifier, challenge } = await pkce();
    const minted = await h.mint(`user-x-${channel}`, { challenge, channel, redirect_uri: FIXTURE[channel] as string });
    const { code } = (await minted.json()) as { code: string };
    const res = await h.exchange(code, verifier, FIXTURE[other] as string);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    expect(h.db.count('ext_devices')).toBe(0);
  });
});

describe('EXA-04 — the channel is bound at mint: a redirect_uri of another channel is refused there too', () => {
  it.each(EXT_CHANNELS.map((ch) => [ch]))("%s refuses every other channel's redirect_uri", async (channel) => {
    const h = harness();
    for (const other of EXT_CHANNELS.filter((c) => c !== channel)) {
      const { challenge } = await pkce();
      const res = await h.mint('user-bind', { challenge, channel, redirect_uri: FIXTURE[other] as string });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'redirect_uri_mismatch' });
    }
    expect(h.db.count('ext_codes')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ⏱ 2026-09-30 · EXA-11 — A LINK ENDS FROM THE ACCOUNT SIDE, AND ON ITS OWN.
// Red on the base: no route listed or revoked a link, revoke-all and a
// recovery session never touched ext_devices, and nothing read a link's age.
const T0 = Date.parse('2026-09-30T12:00:00.000Z');
const DAY = 86400000;

describe('EXA-11 — a password reset ends every browser linked before it', () => {
  it('🔴 a recovery session reaching the Worker revokes the earlier links; a link made after it survives', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const h = harness();
    const before = await connect(h, 'user-reset');
    expect((await h.read(before.token)).status).toBe(200);
    // The owner follows the reset link a minute later: GoTrue's token for that
    // session carries amr [{method: 'recovery', timestamp}].
    vi.setSystemTime(T0 + 60_000);
    const recoveryAmr = { amr: [{ method: 'recovery', timestamp: Math.floor((T0 + 60_000) / 1000) }] };
    expect((await h.devices('user-reset', recoveryAmr)).status).toBe(200);
    expect((await h.read(before.token)).status).toBe(401);
    // The owner re-links with the new password; the same recovery session's
    // later requests leave the new link alone.
    vi.setSystemTime(T0 + 120_000);
    const after = await connect(h, 'user-reset');
    expect((await h.devices('user-reset', recoveryAmr)).status).toBe(200);
    expect((await h.read(after.token)).status).toBe(200);
  });

  it('a password sign-in (amr password) revokes nothing', async () => {
    const h = harness();
    const link = await connect(h, 'user-pw');
    const amr = { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) + 60 }] };
    expect((await h.devices('user-pw', amr)).status).toBe(200);
    expect((await h.read(link.token)).status).toBe(200);
  });

  it("another account's recovery session leaves this account's links alone", async () => {
    const h = harness();
    const link = await connect(h, 'user-bystander');
    const amr = { amr: [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) + 60 }] };
    expect((await h.devices('user-resetter', amr)).status).toBe(200);
    expect((await h.read(link.token)).status).toBe(200);
  });
});

describe('EXA-11 — sign out everywhere (POST /v1/sessions/revoke-all) ends every link', () => {
  it("🔴 every link of the account reads 401 after it; another account's link reads 200", async () => {
    const h = harness();
    const a = await connect(h, 'user-all');
    const b = await connect(h, 'user-all', 'amo');
    const other = await connect(h, 'user-not-all');
    const res = await h.send('POST', '/v1/sessions/revoke-all', { authz: `Bearer ${await jwt('user-all')}` });
    expect(res.status).toBe(204);
    expect((await h.read(a.token)).status).toBe(401);
    expect((await h.read(b.token)).status).toBe(401);
    expect((await h.read(other.token)).status).toBe(200);
  });

  it('D1 fails ⇒ 503 revocation_unavailable, never a 204 while a link survives', async () => {
    const h = harness();
    const a = await connect(h, 'user-all-503');
    const real = h.db;
    const broken = {
      prepare(sql: string) {
        if (sql.startsWith('UPDATE ext_devices SET revoked_at')) throw new Error('D1_ERROR: simulated outage');
        return real.prepare(sql);
      },
      batch: (st: never) => real.batch(st),
    } as unknown as D1Database;
    const res = await harness({ db: broken }).send('POST', '/v1/sessions/revoke-all', {
      authz: `Bearer ${await jwt('user-all-503')}`,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'revocation_unavailable' });
    expect((await h.read(a.token)).status).toBe(200);
  });
});

describe('EXA-11 — the account lists its links and revokes ONE (GET / DELETE /v1/ext/devices)', () => {
  it('🔴 revoke B from the account: B reads 401, A still reads 200', async () => {
    const h = harness();
    const a = await connect(h, 'user-acct');
    const b = await connect(h, 'user-acct', 'edge-addons');
    const listed = await h.devices('user-acct');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('Cache-Control')).toBe('no-store');
    const { devices } = (await listed.json()) as { devices: Array<Record<string, unknown>> };
    expect(devices.map((d) => d.link_id).sort()).toEqual([a.link_id, b.link_id].sort());
    // Nothing that could authenticate or identify leaves: exactly five keys.
    for (const d of devices) expect(Object.keys(d).sort()).toEqual(['channel', 'created_at', 'last_seen_at', 'link_id', 'product']);
    expect(JSON.stringify(devices)).not.toContain('user-acct');
    expect((await h.unlink('user-acct', b.link_id)).status).toBe(204);
    expect((await h.read(b.token)).status).toBe(401);
    expect((await h.read(a.token)).status).toBe(200);
    const after = (await (await h.devices('user-acct')).json()) as { devices: Array<{ link_id: string }> };
    expect(after.devices.map((d) => d.link_id)).toEqual([a.link_id]);
  });

  it("🔴 another account's link id is a 404 that revokes nothing", async () => {
    const h = harness();
    const theirs = await connect(h, 'user-victim');
    expect((await h.unlink('user-attacker', theirs.link_id)).status).toBe(404);
    expect((await h.read(theirs.token)).status).toBe(200);
    const list = (await (await h.devices('user-attacker')).json()) as { devices: unknown[] };
    expect(list.devices).toEqual([]);
  });

  it('a malformed or already-revoked link id is a 404', async () => {
    const h = harness();
    const a = await connect(h, 'user-404');
    expect((await h.unlink('user-404', 'not-a-uuid')).status).toBe(404);
    expect((await h.unlink('user-404', a.link_id)).status).toBe(204);
    expect((await h.unlink('user-404', a.link_id)).status).toBe(404);
  });

  it('both routes refuse a device credential and an anonymous caller (401)', async () => {
    const h = harness();
    const a = await connect(h, 'user-dev');
    expect((await h.send('GET', '/v1/ext/devices', { authz: `Bearer ${a.token}` })).status).toBe(401);
    expect((await h.send('DELETE', `/v1/ext/devices/${a.link_id}`, { authz: `Bearer ${a.token}` })).status).toBe(401);
    expect((await h.send('GET', '/v1/ext/devices')).status).toBe(401);
  });
});

describe('EXA-11 — the credential expires on its own', () => {
  it(`🔴 unused for ${EXT_LINK_IDLE_DAYS} days: 401, stamped revoked, and no longer listed`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const h = harness();
    const a = await connect(h, 'user-idle');
    vi.setSystemTime(T0 + (EXT_LINK_IDLE_DAYS - 1) * DAY);
    expect(((await (await h.devices('user-idle')).json()) as { devices: unknown[] }).devices).toHaveLength(1);
    vi.setSystemTime(T0 + EXT_LINK_IDLE_DAYS * DAY);
    expect(((await (await h.devices('user-idle')).json()) as { devices: unknown[] }).devices).toHaveLength(0);
    expect((await h.read(a.token)).status).toBe(401);
    expect(h.db.count('ext_devices', 'revoked_at IS NOT NULL')).toBe(1);
  });

  it('a link read within every idle window stays alive — idleness counts from last_seen_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const h = harness();
    const a = await connect(h, 'user-busy');
    for (let d = 20; d < EXT_LINK_MAX_AGE_DAYS; d += 20) {
      vi.setSystemTime(T0 + d * DAY);
      expect((await h.read(a.token)).status, `day ${d}`).toBe(200);
    }
  });

  it(`🔴 older than ${EXT_LINK_MAX_AGE_DAYS} days: 401 however often it is used`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const h = harness();
    const a = await connect(h, 'user-old');
    for (let d = 20; d < EXT_LINK_MAX_AGE_DAYS; d += 20) {
      vi.setSystemTime(T0 + d * DAY);
      await h.read(a.token);
    }
    vi.setSystemTime(T0 + EXT_LINK_MAX_AGE_DAYS * DAY - 1);
    expect((await h.read(a.token)).status).toBe(200);
    vi.setSystemTime(T0 + EXT_LINK_MAX_AGE_DAYS * DAY);
    expect((await h.read(a.token)).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('log masking — no credential, code or verifier ever reaches a console line', () => {
  it('🔴 a full mint, exchange, read, revoke and re-read prints none of them', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : String(a))).join(' '));
      });
    }
    const h = harness();
    const { verifier, challenge } = await pkce();
    const minted = await h.mint('user-log', { challenge });
    const { code } = (await minted.json()) as { code: string };
    const exchanged = await h.exchange(code, verifier);
    const { token } = (await exchanged.json()) as { token: string };
    expect((await h.read(token)).status).toBe(200);
    expect((await h.revoke(token)).status).toBe(200);
    expect((await h.read(token)).status).toBe(401);
    // A failed exchange and a failed lookup print too — include both paths.
    expect((await h.exchange(code, verifier)).status).toBe(400);
    const everything = lines.join('\n');
    expect(everything).not.toContain('nkx1_');
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(verifier);
  });
});
