// ─────────────────────────────────────────────────────────────────────────────
// supabaseAuth — the only thing standing between a public URL and every user's
// data. Every /v1 data route is mounted behind it.
//
// The primary (ES256/JWKS) path is exercised with `fetch` stubbed to REFUSE, so
// no test can silently depend on the network and so the HS256 fallback — the
// path an operator can actually configure — is the one under assertion. Two
// mutations from the 2026-07-31 triage are pinned here:
//   · deleting `issuer` from the HS256 options: the "correct secret, WRONG
//     Supabase project" case below goes red. (Signature alone does not catch it
//     — a shared secret is shared.)
//   · deleting the `if (!payload.sub)` guard: the no-sub case goes red. tsc also
//     rejects that one, which is worth knowing but is not a reason to leave the
//     behaviour untested.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { supabaseAuth } from '../src/middleware/auth';
import type { AppEnv } from '../src/types';

const SUPABASE_URL = 'https://project-a.supabase.co';
const OTHER_URL = 'https://project-b.supabase.co';
const SECRET = 'super-secret-hs256-key-for-tests-only';
const key = new TextEncoder().encode(SECRET);

beforeAll(() => {
  // No network from a unit test. The JWKS path must FAIL here, which is exactly
  // what a Worker sees when Supabase is unreachable — and the fallback is what
  // then decides. A test that quietly reached the internet would be a test that
  // passes or fails on someone else's uptime.
  vi.stubGlobal('fetch', async () => {
    throw new Error('network disabled in tests');
  });
});
afterAll(() => vi.unstubAllGlobals());

const KV = {
  get: async () => null,
  put: async () => undefined,
} as unknown as KVNamespace;

/** `null` means NO fallback secret configured. (An `undefined` default would be
 *  swallowed by the parameter default — which it silently was, first time.) */
function app(secret: string | null = SECRET) {
  const a = new Hono<AppEnv>();
  a.use('*', supabaseAuth);
  a.get('/me', (c) => c.json({ userId: c.get('userId'), email: c.get('userEmail') }));
  const env = {
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: secret ?? undefined,
    JWKS_CACHE: KV,
    APP_ID: 'subly',
    API_VERSION: 'v1',
  } as unknown as AppEnv['Bindings'];
  return (authz?: string) =>
    a.request('/me', { headers: authz === undefined ? {} : { Authorization: authz } }, env);
}

async function token(
  claims: Record<string, unknown>,
  { issuer = `${SUPABASE_URL}/auth/v1`, audience = 'authenticated', signWith = key } = {},
) {
  let t = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience);
  if (issuer) t = t.setIssuer(issuer);
  return t.sign(signWith);
}

describe('supabaseAuth ACCEPTS only a well-formed token from THIS project', () => {
  it('accepts a valid HS256 token and exposes sub + email', async () => {
    const res = await app()(`Bearer ${await token({ sub: 'user-a', email: 'a@test.dev' })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', email: 'a@test.dev' });
  });

  it('accepts a token with no email claim', async () => {
    const res = await app()(`Bearer ${await token({ sub: 'user-a' })}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a' });
  });
});

describe('supabaseAuth REJECTS', () => {
  const reject = async (label: string, authz: string | undefined, secret: string | null = SECRET) => {
    const res = await app(secret)(authz);
    expect(res.status, label).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  };

  it('a missing Authorization header', () => reject('missing', undefined));
  it('a blank Authorization header', () => reject('blank', ''));
  it('a bearer with no token', () => reject('no token', 'Bearer'));
  it('a bearer with only whitespace', () => reject('whitespace', 'Bearer    '));
  it('a non-bearer scheme', async () => reject('basic', `Basic ${await token({ sub: 'a' })}`));
  it('a garbage token', () => reject('garbage', 'Bearer not-a-jwt'));
  it('a structurally-valid but unsigned token', () =>
    reject('unsigned', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.'));

  it('a token signed with the WRONG secret', async () =>
    reject('wrong secret', `Bearer ${await token({ sub: 'a' }, { signWith: new TextEncoder().encode('other') })}`));

  it('a token from a DIFFERENT Supabase project — correct secret, wrong issuer', async () => {
    // The shared HS256 secret is shared: signature alone cannot tell these
    // apart. `issuer` in the verify options is what does, which is why deleting
    // it must not be a silent change.
    await reject(
      'wrong issuer',
      `Bearer ${await token({ sub: 'a' }, { issuer: `${OTHER_URL}/auth/v1` })}`,
    );
  });

  it('a token with no issuer at all', async () =>
    reject('no issuer', `Bearer ${await token({ sub: 'a' }, { issuer: '' })}`));

  it('a token for the wrong audience', async () =>
    reject('wrong aud', `Bearer ${await token({ sub: 'a' }, { audience: 'anon' })}`));

  it('a token with NO sub claim — there is no user to scope rows to', async () =>
    reject('no sub', `Bearer ${await token({ email: 'a@test.dev' })}`));

  it('an expired token', async () => {
    const stale = await new SignJWT({ sub: 'a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .sign(key);
    await reject('expired', `Bearer ${stale}`);
  });

  it('EVERY token when no fallback secret is configured and the JWKS is unreachable', async () => {
    // Fail closed: an unreachable identity provider must not become "allow".
    await reject('no secret', `Bearer ${await token({ sub: 'a' })}`, null);
  });
});
