// ─────────────────────────────────────────────────────────────────────────────
// apple-revoke.test.ts — O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE, end to end against a
// REAL SQL ENGINE, a REAL ES256 key pair and a stubbed Apple.
//
// WHAT IS BEING PROVEN, and each case is the shape of a way this could be wrong:
//   · a deletion for a subject with a stored Apple token REVOKES it at Apple, with
//     the exact form fields Apple documents, and then forgets the token;
//   · a deletion for a subject WITHOUT one is unchanged (every account today);
//   · Apple unreachable / 5xx / 429 ⇒ 202 erasure_pending, identity KEPT, retried;
//   · 🔴 the owner's Sign in with Apple credentials missing ⇒ the SAME refusal, not
//     a silent skip. That is the case this row exists for: a deletion that reports
//     success while Apple still lists the app as connected is the defect;
//   · Apple 4xx (invalid_client) ⇒ blocked, kept pending, and said out loud;
//   · the token NEVER reaches a log line;
//   · the nightly retry runs the revoke itself and completes the erasure.
//
// The client secret is verified with `jose` against the public half of the key the
// test generated, so "we sign a JWT Apple would accept" is checked rather than
// asserted — header `alg`/`kid`, and the `iss`/`sub`/`aud`/`exp` Apple documents.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, importJWK, jwtVerify, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import account from '../src/routes/account';
import appleToken from '../src/routes/apple-token';
import { APPLE_REVOKE_STEP } from '../src/lib/erasure-ledger';
import { appleClientSecret, APPLE_AUD, pkcs8DerFromPem } from '../src/lib/apple-revoke';
import { erasureRetry } from '../src/scheduled';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://apple-revoke-test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP_ORIGIN = 'https://api.test';

let signingKey: KeyLike;
let publicJwk: JWK;
/** The owner's Sign in with Apple key, as a PKCS#8 PEM — the `.p8` shape. */
let applePrivatePem: string;
let applePublicJwk: JWK;

interface AppleCall {
  contentType: string | null;
  body: URLSearchParams;
}
let appleCalls: AppleCall[] = [];
let appleStatus = 200;
let appleThrows = false;
let identityCalls: string[] = [];
let logLines: string[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };

  const apple = await generateKeyPair('ES256', { extractable: true });
  applePrivatePem = await exportPKCS8(apple.privateKey);
  applePublicJwk = { ...(await exportJWK(apple.publicKey)), alg: 'ES256' };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://appleid.apple.com/auth/revoke') {
      if (appleThrows) throw new Error('Network connection lost');
      appleCalls.push({
        contentType: new Headers(init?.headers).get('Content-Type'),
        body: new URLSearchParams(String(init?.body ?? '')),
      });
      // Apple answers 200 with NO BODY on success, and cannot distinguish a
      // revoked token from one that was already invalid.
      return new Response(null, { status: appleStatus });
    }
    if (url.includes('/auth/v1/admin/users/') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ email: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/auth/v1/admin/users/')) {
      identityCalls.push(url);
      return new Response(null, { status: 204 });
    }
    if (url.startsWith(APP_ORIGIN)) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

afterAll(() => vi.unstubAllGlobals());

const token = async (claims: Record<string, unknown>) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);

/** A password-less Apple account whose last sign-in is fresh, so the recency
 *  check O-OAUTH-DELETE-REAUTH added lets the deletion through to the part under
 *  test here. */
const appleUser = (sub = 'user-a') =>
  token({
    sub,
    app_metadata: { provider: 'apple', providers: ['apple'] },
    amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) - 10 }],
  });

function appleEnv(db: RealDb, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    PLATFORM_DB: db,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    APP_ERASURE_ENDPOINTS: `subscriptiontracker=${APP_ORIGIN}`,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    APPLE_REVOKE_CLIENT_ID: 'com.nikatru.services',
    APPLE_REVOKE_TEAM_ID: 'TEAM123456',
    APPLE_REVOKE_KEY_ID: 'KEY7890123',
    APPLE_REVOKE_PRIVATE_KEY: applePrivatePem,
    ...overrides,
  } as unknown as AppEnv['Bindings'];
}

function harness(overrides: Partial<Record<string, unknown>> = {}) {
  appleCalls = [];
  appleStatus = 200;
  appleThrows = false;
  identityCalls = [];
  logLines = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logLines.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logLines.push(a.join(' ')));
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/account', platformAuth);
  app.use('/v1/account/*', platformAuth);
  app.route('/v1', account);
  app.route('/v1', appleToken);
  const env = appleEnv(db, overrides);
  return {
    db,
    env,
    put: (path: string, body: unknown, authz?: string) =>
      app.request(
        path,
        {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            ...(authz === undefined ? {} : { Authorization: authz }),
          },
        },
        env,
      ),
    del: (path: string, authz?: string) =>
      app.request(path, { method: 'DELETE', headers: authz === undefined ? {} : { Authorization: authz } }, env),
  };
}

const storedToken = (db: RealDb, subject: string) =>
  db.rows('SELECT refresh_token FROM apple_provider_tokens WHERE subject_ref = ?', subject).map((r) => String(r.refresh_token));
const pendingSteps = (db: RealDb, subject: string) =>
  db.rows('SELECT app_id FROM pending_erasures WHERE subject_ref = ? AND confirmed_at IS NULL', subject).map((r) => String(r.app_id));

describe('the client secret is a JWT Apple would accept', () => {
  it('carries the header and claims Apple documents, and verifies against the key', async () => {
    const nowS = 1_760_000_000;
    const secret = await appleClientSecret(
      { clientId: 'com.nikatru.services', teamId: 'TEAM123456', keyId: 'KEY7890123', privateKeyPem: applePrivatePem },
      nowS,
    );
    const { payload, protectedHeader } = await jwtVerify(secret, await importJWK(applePublicJwk, 'ES256'), {
      audience: APPLE_AUD,
      issuer: 'TEAM123456',
      // The claims are pinned to a FIXED instant, so the check is about the JWT
      // and not about how long this test took to run.
      currentDate: new Date(nowS * 1000),
    });
    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe('KEY7890123');
    expect(payload.sub).toBe('com.nikatru.services');
    expect(payload.iat).toBe(nowS);
    // Apple refuses a client secret whose expiry is more than six months out.
    expect((payload.exp as number) - nowS).toBeLessThanOrEqual(15_768_000);
    expect((payload.exp as number) - nowS).toBeGreaterThan(0);
  });

  it('refuses a key that is not a PKCS#8 PEM rather than signing something Apple will reject', () => {
    expect(() => pkcs8DerFromPem('not a key')).toThrow(/PKCS#8/);
    expect(() => pkcs8DerFromPem('')).toThrow(/PKCS#8/);
  });
});

describe('PUT /v1/account/apple-token', () => {
  it('stores the token for the CALLER, and never logs it', async () => {
    const h = harness();
    const res = await h.put('/v1/account/apple-token', { refreshToken: 'r-secret-token-value', appId: 'subscriptiontracker' }, `Bearer ${await appleUser()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    expect(storedToken(h.db, 'user-a')).toEqual(['r-secret-token-value']);
    expect(logLines.join('\n')).not.toContain('r-secret-token-value');
  });

  it('a second sign-in REPLACES the token rather than piling rows up', async () => {
    const h = harness();
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'first-token-value', appId: 'subscriptiontracker' }, authz);
    await h.put('/v1/account/apple-token', { refreshToken: 'second-token-value', appId: 'subscriptiontracker' }, authz);
    expect(storedToken(h.db, 'user-a')).toEqual(['second-token-value']);
  });

  it('refuses an empty, tiny or unauthenticated token', async () => {
    const h = harness();
    const authz = `Bearer ${await appleUser()}`;
    expect((await h.put('/v1/account/apple-token', { refreshToken: '', appId: 'subscriptiontracker' }, authz)).status).toBe(400);
    expect((await h.put('/v1/account/apple-token', { refreshToken: 'short', appId: 'subscriptiontracker' }, authz)).status).toBe(400);
    expect((await h.put('/v1/account/apple-token', { nope: 1 }, authz)).status).toBe(400);
    // 🔴 THE PROVENANCE MARKER IS REQUIRED AND SHAPED: a row nobody can attribute
    // is the shape where a monitor counts nothing and still prints clean.
    expect(
      (await h.put('/v1/account/apple-token', { refreshToken: 'r-token-value', appId: 'Not A Slug' }, authz)).status,
    ).toBe(400);
    expect(
      (await h.put('/v1/account/apple-token', { refreshToken: 'r-token-value' }, authz)).status,
    ).toBe(400);
    // 🔴 UNAUTHENTICATED IS A 401, NOT A ROW KEYED BY NOTHING.
    expect((await h.put('/v1/account/apple-token', { refreshToken: 'r-token-value', appId: 'subscriptiontracker' })).status).toBe(401);
    expect(storedToken(h.db, 'user-a')).toEqual([]);
  });
});

describe('DELETE /v1/account revokes the Apple token', () => {
  it('sends Apple the documented form fields, then forgets the token and deletes the identity', async () => {
    const h = harness();
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);

    const res = await h.del('/v1/account', authz);
    expect(res.status).toBe(200);
    expect(appleCalls).toHaveLength(1);
    expect(appleCalls[0].contentType).toBe('application/x-www-form-urlencoded');
    expect(appleCalls[0].body.get('client_id')).toBe('com.nikatru.services');
    expect(appleCalls[0].body.get('token')).toBe('r-live-token-value');
    expect(appleCalls[0].body.get('token_type_hint')).toBe('refresh_token');
    expect(appleCalls[0].body.get('client_secret')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(storedToken(h.db, 'user-a')).toEqual([]);
    expect(identityCalls).toHaveLength(1);
    expect(pendingSteps(h.db, 'user-a')).toEqual([]);
    expect(logLines.join('\n')).not.toContain('r-live-token-value');
  });

  it('an account with NO stored token is untouched by any of this', async () => {
    const h = harness();
    const res = await h.del('/v1/account', `Bearer ${await appleUser()}`);
    expect(res.status).toBe(200);
    expect(appleCalls).toHaveLength(0);
    expect(identityCalls).toHaveLength(1);
  });

  it('🔴 the owner credentials are NOT set: the deletion is refused loudly, not silently skipped', async () => {
    const h = harness({ APPLE_REVOKE_PRIVATE_KEY: undefined, APPLE_REVOKE_KEY_ID: undefined });
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);

    const res = await h.del('/v1/account', authz);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'erasure_pending', pending: [APPLE_REVOKE_STEP] });
    expect(identityCalls, 'the identity must NOT be deleted while Apple still lists this app').toHaveLength(0);
    expect(pendingSteps(h.db, 'user-a')).toEqual([APPLE_REVOKE_STEP]);
    expect(storedToken(h.db, 'user-a'), 'the token is what the retry revokes with').toEqual(['r-live-token-value']);
    // The refusal NAMES the missing secrets, so an operator does not have to guess.
    expect(logLines.join('\n')).toContain('APPLE_REVOKE_KEY_ID');
    expect(logLines.join('\n')).toContain('APPLE_REVOKE_PRIVATE_KEY');
    expect(logLines.join('\n')).not.toContain('r-live-token-value');
  });

  it('🔴 Apple unreachable is pending and retried, with the identity kept', async () => {
    const h = harness();
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);
    appleThrows = true;

    const res = await h.del('/v1/account', authz);
    expect(res.status).toBe(202);
    expect(pendingSteps(h.db, 'user-a')).toEqual([APPLE_REVOKE_STEP]);
    expect(identityCalls).toHaveLength(0);
  });

  it('🔴 Apple answering 500 is pending; answering 400 is pending AND said out loud', async () => {
    for (const [status, expectLog] of [
      [500, false],
      [400, true],
    ] as Array<[number, boolean]>) {
      const h = harness();
      const authz = `Bearer ${await appleUser()}`;
      await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);
      appleStatus = status;

      const res = await h.del('/v1/account', authz);
      expect(res.status, `apple ${status}`).toBe(202);
      expect(pendingSteps(h.db, 'user-a')).toEqual([APPLE_REVOKE_STEP]);
      expect(identityCalls).toHaveLength(0);
      if (expectLog) expect(logLines.join('\n')).toContain('Apple refused the revoke with 400');
    }
  });
});

describe('the nightly retry finishes what the deletion could not', () => {
  it('revokes on the retry, then deletes the identity and forgets the token', async () => {
    const h = harness();
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);
    appleThrows = true;
    expect((await h.del('/v1/account', authz)).status).toBe(202);
    expect(pendingSteps(h.db, 'user-a')).toEqual([APPLE_REVOKE_STEP]);

    // Apple comes back; the cron runs.
    appleThrows = false;
    await erasureRetry(h.env as never);

    expect(appleCalls).toHaveLength(1);
    expect(appleCalls[0].body.get('token')).toBe('r-live-token-value');
    expect(pendingSteps(h.db, 'user-a')).toEqual([]);
    expect(identityCalls, 'the identity goes LAST, once the revoke confirmed').toHaveLength(1);
    expect(storedToken(h.db, 'user-a')).toEqual([]);
  });

  it('🔴 while the credentials are still missing the retry keeps the order open and the identity alive', async () => {
    const h = harness({ APPLE_REVOKE_CLIENT_ID: undefined });
    const authz = `Bearer ${await appleUser()}`;
    await h.put('/v1/account/apple-token', { refreshToken: 'r-live-token-value', appId: 'subscriptiontracker' }, authz);
    expect((await h.del('/v1/account', authz)).status).toBe(202);

    await erasureRetry(h.env as never);

    expect(appleCalls).toHaveLength(0);
    expect(pendingSteps(h.db, 'user-a')).toEqual([APPLE_REVOKE_STEP]);
    expect(identityCalls).toHaveLength(0);
    expect(storedToken(h.db, 'user-a')).toEqual(['r-live-token-value']);
  });
});
