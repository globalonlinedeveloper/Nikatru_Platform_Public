// ─────────────────────────────────────────────────────────────────────────────
// identity-change.test.ts — POST /v1/account/identity-change (⏱ 2026-10-02,
// review of #1155, finding 3): a sign-in method is linked or unlinked only by a
// session whose OWN `amr` says it authenticated recently — for every account,
// password accounts included. A stale session gets 403 `reauth_required`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import identityChange, { identityChangeRecencyRefusal } from '../src/routes/identity-change';
import { RECENT_AUTH_SECONDS } from '../../_shared/src/auth';
import type { AppEnv } from '../src/types';
import { realPlatformDb } from './harness';

const SUPABASE_URL = 'https://identity-change-test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

const now = () => Math.floor(Date.now() / 1000);

const tokenWith = (providers: string[], amr: unknown) =>
  new SignJWT({ sub: 'user-i', app_metadata: { providers }, ...(amr === undefined ? {} : { amr }) })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);

function post(authz?: string) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/account/*', platformAuth);
  app.route('/v1', identityChange);
  const env = { PLATFORM_DB: realPlatformDb(), SUPABASE_URL, APP_ID: 'platform', API_VERSION: 'v1' } as unknown as AppEnv['Bindings'];
  return app.request('/v1/account/identity-change', { method: 'POST', headers: authz === undefined ? {} : { Authorization: authz } }, env);
}

describe('POST /v1/account/identity-change', () => {
  it('a session that signed in a minute ago may change its sign-in methods', async () => {
    const res = await post(`Bearer ${await tokenWith(['apple'], [{ method: 'oauth', timestamp: now() - 60 }])}`);
    expect(res.status).toBe(200);
  });

  it('🔴 RED CONTROL: a STALE session cannot link or unlink — 403 reauth_required', async () => {
    const stale = [{ method: 'oauth', timestamp: now() - RECENT_AUTH_SECONDS - 120 }];
    const res = await post(`Bearer ${await tokenWith(['apple', 'google'], stale)}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'reauth_required' });
  });

  it('🔴 a PASSWORD account is held to it too (deletion is not; a new way in is)', async () => {
    const stale = [{ method: 'password', timestamp: now() - RECENT_AUTH_SECONDS - 120 }];
    expect((await post(`Bearer ${await tokenWith(['email'], stale)}`)).status).toBe(403);
    const fresh = [{ method: 'password', timestamp: now() - 30 }];
    expect((await post(`Bearer ${await tokenWith(['email'], fresh)}`)).status).toBe(200);
  });

  it('a token with no amr, or none at all, is refused', async () => {
    expect((await post(`Bearer ${await tokenWith(['apple'], undefined)}`)).status).toBe(403);
    expect((await post()).status).toBe(401);
  });

  it('the rule itself: missing recency, a future timestamp beyond the skew', () => {
    expect(identityChangeRecencyRefusal(undefined)).not.toBeNull();
    expect(identityChangeRecencyRefusal({ passwordless: false, lastAuthenticatedAt: 1000 }, 1000 + 5)).toBeNull();
    expect(identityChangeRecencyRefusal({ passwordless: false, lastAuthenticatedAt: 2000 }, 1000)).not.toBeNull();
  });
});
