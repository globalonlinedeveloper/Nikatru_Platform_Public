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
import { decryptToken, tokenKey } from '../src/lib/token-crypto';
import type { AppEnv } from '../src/types';
import { realPlatformDb, TEST_TOKEN_ENC_KEY, type RealDb } from './harness';

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

function harness(envOverrides: Record<string, unknown> = {}) {
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
  const env = {
    PLATFORM_DB: db,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY,
    ...envOverrides,
  } as unknown as AppEnv['Bindings'];
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

/** Each row with its token DECRYPTED under the test key (⏱ 2026-09-30,
 *  migration 0023) — and 🔴 the plain-text column asserted empty on every read. */
const rowsFor = async (db: RealDb, subject: string) => {
  const out: { provider: string; app_id: string; refresh_token: string }[] = [];
  for (const r of db.rows(
    'SELECT provider, app_id, refresh_token, token_ct, token_key_id FROM provider_tokens WHERE subject_ref = ? ORDER BY provider',
    subject,
  )) {
    expect(String(r.refresh_token), 'the plain-text column is never written').toBe('');
    const key = await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, String(r.token_key_id));
    if ('refused' in key) throw new Error(key.refused);
    const token = await decryptToken(key.key, String(r.token_key_id), { subjectRef: subject, provider: String(r.provider) }, String(r.token_ct));
    out.push({ provider: String(r.provider), app_id: String(r.app_id), refresh_token: String(token) });
  }
  return out;
};

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
    expect(await rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('🔴 a token whose providers claim is missing links nothing: 400, nothing stored', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(undefined)}`,
    );
    expect(res.status).toBe(400);
    expect(await rowsFor(h.db, 'user-p')).toEqual([]);
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
    expect(await rowsFor(h.db, 'user-p')).toEqual([
      { provider: 'google', app_id: 'subscriptiontracker', refresh_token: 'g-token-value' },
    ]);
    expect(await rowsFor(h.db, 'someone-else')).toEqual([]);
  });

  it('one account keeps ONE row per provider: Apple and Google side by side, a second Google replaces the first', async () => {
    const h = harness();
    const authz = `Bearer ${await userLinking(['apple', 'google'])}`;
    await h.put('/v1/account/provider-token', { provider: 'apple', refreshToken: 'a-token-value', appId: 'subscriptiontracker' }, authz);
    await h.put('/v1/account/provider-token', { provider: 'google', refreshToken: 'g-first-value', appId: 'subscriptiontracker' }, authz);
    await h.put('/v1/account/provider-token', { provider: 'google', refreshToken: 'g-second-value', appId: 'subscriptiontracker' }, authz);
    expect(await rowsFor(h.db, 'user-p')).toEqual([
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
    expect(await rowsFor(h.db, 'user-p')).toEqual([]);
  });

  it('no provider in the body is 400 invalid_provider', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/provider-token',
      { refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['google'])}`,
    );
    expect(res.status).toBe(400);
    expect(await rowsFor(h.db, 'user-p')).toEqual([]);
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
    expect(await rowsFor(h.db, 'user-p')).toEqual([
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
    expect((await rowsFor(h.db, 'user-p')).map((r) => r.provider)).toEqual(['apple']);
  });

  it('🔴 is cross-checked too: an account that has not linked apple is 400', async () => {
    const h = harness();
    const res = await h.put(
      '/v1/account/apple-token',
      { refreshToken: 'a-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['email'])}`,
    );
    expect(res.status).toBe(400);
    expect(await rowsFor(h.db, 'user-p')).toEqual([]);
  });
});

// ── ⏱ 2026-09-30 · review round 2 (security) — STORED ENCRYPTED OR NOT AT ALL ──
// The finding: "provider refresh tokens are plain text in D1". Every case above
// reads the row back through `rowsFor`, which decrypts it and fails on a
// non-empty plain-text column. These are the refusals: a key that cannot be
// used means NOTHING is stored — a 503 the client retries — never a plain-text
// row "for now".
describe('the token is stored encrypted, or the store is refused', () => {
  it('🔴 TOKEN_ENC_KEY_V1 absent: 503 google_token_store_failed, and no row at all', async () => {
    const h = harness({ TOKEN_ENC_KEY_V1: undefined });
    const res = await h.put(
      '/v1/account/provider-token',
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['google'])}`,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'google_token_store_failed' });
    expect(h.db.count('provider_tokens'), 'no row, and so no plain text').toBe(0);
  });

  it('🔴 TOKEN_ENC_KEY_V1 malformed (not 32 bytes of base64): the alias answers its 503 too, and no row', async () => {
    for (const bad of ['not-base64!', btoa('sixteen-bytes-ok'), `${TEST_TOKEN_ENC_KEY}AAAA`]) {
      const h = harness({ TOKEN_ENC_KEY_V1: bad });
      const res = await h.put(
        '/v1/account/apple-token',
        { refreshToken: 'a-token-value', appId: 'subscriptiontracker' },
        `Bearer ${await userLinking(['apple'])}`,
      );
      expect(res.status, `key ${JSON.stringify(bad)}`).toBe(503);
      expect(await res.json()).toEqual({ error: 'apple_token_store_failed' });
      expect(h.db.count('provider_tokens')).toBe(0);
    }
  });

  it('the stored bytes are not the token: the ciphertext column neither equals nor contains it, and names key v1', async () => {
    const h = harness();
    await h.put(
      '/v1/account/provider-token',
      { provider: 'google', refreshToken: 'g-token-value', appId: 'subscriptiontracker' },
      `Bearer ${await userLinking(['google'])}`,
    );
    const [row] = h.db.rows('SELECT refresh_token, token_ct, token_key_id FROM provider_tokens');
    expect(row.refresh_token).toBe('');
    expect(row.token_key_id).toBe('v1');
    expect(String(row.token_ct)).not.toContain('g-token-value');
    expect(JSON.stringify(h.db.rows('SELECT * FROM provider_tokens'))).not.toContain('g-token-value');
  });
});
