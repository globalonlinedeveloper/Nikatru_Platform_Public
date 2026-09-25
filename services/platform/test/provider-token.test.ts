// ─────────────────────────────────────────────────────────────────────────────
// provider-token.test.ts — PUT /v1/account/provider-token and its Apple-only
// alias PUT /v1/account/apple-token (O-GOOGLE-SIGN-IN-NOT-BUILT, the server half).
//
// WHAT IS BEING PROVEN, and each case is the shape of a way this could be wrong:
//   · 🔴 a token for a provider the account has NOT linked (per the VERIFIED
//     JWT's `app_metadata.providers`) is refused with 400 and stores nothing —
//     stored, it would be revoked at the wrong provider and hold the deletion
//     pending on a revoke that can never succeed;
//   · the subject is the JWT's, never a body field;
//   · the provider is one of the two the revoke path knows, or 400;
//   · the alias the 2026-09-22 web client sends to still answers 2xx and writes
//     `provider = 'apple'` — and writes nothing to the old 0012 table.
// Every assertion reads the ROW (or its absence), not only the status (auth-04).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import providerToken from '../src/routes/provider-token';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://provider-token-test.supabase.co';
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
    // Storing a token calls nobody: a revoke from this route would be a defect.
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

/** A token whose verified `app_metadata.providers` is exactly `providers`. */
const userLinking = (providers: unknown, sub = 'user-p') =>
  new SignJWT({ sub, app_metadata: { providers } })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);

function harness() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/account/*', platformAuth);
  app.route('/v1', providerToken);
  const env = { PLATFORM_DB: db, SUPABASE_URL, APP_ID: 'platform', API_VERSION: 'v1' } as unknown as AppEnv['Bindings'];
  return {
    db,
    put: (path: string, body: unknown, authz?: string) =>
      app.request(
        path,
        {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json', ...(authz === undefined ? {} : { Authorization: authz }) },
        },
        env,
      ),
  };
}

const rowsFor = (db: RealDb, subject: string) =>
  db
    .rows('SELECT provider, app_id, refresh_token FROM provider_tokens WHERE subject_ref = ? ORDER BY provider', subject)
    .map((r) => ({ provider: String(r.provider), app_id: String(r.app_id), refresh_token: String(r.refresh_token) }));

describe('PUT /v1/account/provider-token — the provider is cross-checked against the JWT', () => {
  it('🔴 a Google token from an account whose providers lack google is 400, and nothing is stored', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['apple'])}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'provider_not_linked' });
    expect(rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('🔴 a token whose providers claim is missing links nothing: 400, nothing stored', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(undefined)}`,
    );
    expect(res.status).toBe(400);
    expect(rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('a Google token from an account that linked google is stored under the JWT subject, provider google', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      // A `subject_ref` in the body is not a field the route reads: the JWT decides.
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker', subject_ref: 'someone-else' },
      `Bearer ${await userLinking(['email', 'google'])}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    expect(rowsFor(h.db, 'user-p')).toEqual([
      { provider: 'google', app_id: 'subscriptiontracker', refresh_token: 'g-token-value' },
    ]);
    expect(rowsFor(h.db, 'someone-else')).toEqual([]);
  });

  it('one account keeps ONE row per provider: Apple and Google side by side, a second Google replaces the first', async () => {
    const h = harness();
    const authz = `Bearer ${await userLinking(['apple', 'google'])}`;
    await h.put('/v1/account/provider-token', { provider: 'apple', refreshToken: 'a-token-value', appId: 'subscriptiontracker' }, authz);
    await h.put('/v1/account/provider-token', { provider: 'google', refreshToken: 'g-first-value', appId: 'subscriptiontracker' }, authz);
    await h.put('/v1/account/provider-token', { provider: 'google', refreshToken: 'g-second-value', appId: 'subscriptiontracker' }, authz);
    expect(rowsFor(h.db, 'user-p')).toEqual([
      { provider: 'apple', app_id: 'subscriptiontracker', refresh_token: 'a-token-value' },
      { provider: 'google', app_id: 'subscriptiontracker', refresh_token: 'g-second-value' },
    ]);
  });

  it('a provider outside the enum is 400 invalid_provider, even when the JWT lists it', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { provider: 'github', refreshToken: 'gh-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['github'])}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_provider' });
    expect(rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('no provider in the body is 400 invalid_provider', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['google'])}`,
    );
    expect(res.status).toBe(400);
    expect(rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('unauthenticated is 401, not a row keyed by nothing', async () => {
    const h = harness();
    const res = await h.put('/v1/account/provider-token', { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' });
    expect(res.status).toBe(401);
    expect(h.db.count('provider_tokens')).toBe(0);
  });
});

describe('PUT /v1/account/apple-token — the shipped web client\'s path, kept as an alias', () => {
  it('still answers 2xx and writes provider = apple, and nothing to the old 0012 table', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/apple-token',
      { refreshToken: 'a-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['apple'])}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    expect(rowsFor(h.db, 'user-p')).toEqual([
      { provider: 'apple', app_id: 'subscriptiontracker', refresh_token: 'a-token-value' },
    ]);
    expect(h.db.count('apple_provider_tokens'), 'no code writes the old table after 0016').toBe(0);
  });

  it('ignores a `provider` in the body: the alias path IS the provider', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/apple-token',
      { provider: 'google', refreshToken: 'a-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['apple'])}`,
    );
    expect(res.status).toBe(200);
    expect(rowsFor(h.db, 'user-p').map((r) => r.provider)).toEqual(['apple']);
  });

  it('🔴 is cross-checked too: an account that has not linked apple is 400', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/apple-token',
      { refreshToken: 'a-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['email'])}`,
    );
    expect(res.status).toBe(400);
    expect(rowsFor(h.db, 'user-p')).toEqual([]);
  });
});
