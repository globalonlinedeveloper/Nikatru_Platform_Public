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
import { SignJWT, generateKeyPair, exportJWK, type KeyLike } from 'jose';
import { supabaseAuth, erasureAuth } from '../src/middleware/auth';
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

// -----------------------------------------------------------------------------
// THE JWKS OUTAGE, ON THE WORKER WHERE FAILING OPEN WAS THE WORSE OUTCOME.
//
// `services/platform` got the stale-JWKS fallback in #433. This file did not,
// and it is `api.nikatru.com`. Two DIFFERENT failures lived here, and the
// dangerous one was silent:
//
//   [supabaseAuth]  the asymmetric path threw, `verifySupabaseToken` caught it
//                   and tried the LEGACY HS256 SHARED SECRET. So with
//                   SUPABASE_JWT_SECRET configured, a Box A outage did not 401 —
//                   it DOWNGRADED every request from a signature to a shared
//                   string. The assertion that matters below is therefore not
//                   the status code, it is `tokenAssurance`.
//   [erasureAuth]   no fallback at all, so account deletion simply stopped.
//
// Both are asserted here, and so is the shape the FIRST version of the predicate
// missed: a non-200. Box A is reached through a Cloudflare Tunnel, and a tunnel
// with no origin answers 502/530 rather than refusing the connection.
// -----------------------------------------------------------------------------
describe('the JWKS outage does NOT downgrade this boundary to a shared secret', () => {
  let signingKey: KeyLike;
  let foreignKey: KeyLike;
  let publicJwk: Record<string, unknown>;
  let rotatedJwk: Record<string, unknown>;

  /** 'down' = unreachable host (workerd raises a PLAIN Error, not a TypeError —
   *  undici is Node and this does not run on Node). 'bad-gateway' = the tunnel
   *  answers badly. 'rotated' = reachable and healthy, but the signing key has
   *  moved past this token. */
  let mode: 'ok' | 'down' | 'bad-gateway' | 'rotated' = 'ok';

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    signingKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'sub-key-1' };
    foreignKey = (await generateKeyPair('ES256', { extractable: true })).privateKey;
    const rot = await generateKeyPair('ES256', { extractable: true });
    rotatedJwk = { ...(await exportJWK(rot.publicKey)), alg: 'ES256', kid: 'sub-key-2' };

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.endsWith('/.well-known/jwks.json')) {
        throw new Error(`unexpected fetch in test: ${url}`);
      }
      if (mode === 'down') throw new Error('Network connection lost');
      if (mode === 'bad-gateway') return new Response('no origin', { status: 502 });
      const keys = mode === 'rotated' ? [rotatedJwk] : [publicJwk];
      return new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  const cachedKv = (body: unknown) =>
    ({
      get: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      put: async () => undefined,
    }) as unknown as KVNamespace;

  /** A KV holding nothing, which is the pre-fallback world. */
  const emptyKv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;

  /** WHY `url` IS A PARAMETER: the key-set memo is keyed by it. `getRemoteJWKS`
   *  caches one `createRemoteJWKSet` per SUPABASE_URL for the life of the MODULE,
   *  and jose then keeps that set "fresh" for its own window — so a test that
   *  makes the endpoint publish a DIFFERENT key set would leave every later test
   *  verifying against it. That is order-dependence masquerading as coverage; a
   *  distinct URL gives each case its own memo, which is what a cold isolate has. */
  function api({
    secret = SECRET as string | null,
    kv = emptyKv,
    url = 'https://outage-a.test',
    middleware = supabaseAuth,
  } = {}) {
    const a = new Hono<AppEnv>();
    a.use('*', middleware);
    a.get('/me', (c) =>
      c.json({ userId: c.get('userId'), assurance: c.get('tokenAssurance') }),
    );
    const env = {
      SUPABASE_URL: url,
      SUPABASE_JWT_SECRET: secret ?? undefined,
      JWKS_CACHE: kv,
      APP_ID: 'subly',
      API_VERSION: 'v1',
    } as unknown as AppEnv['Bindings'];
    return (authz: string) => a.request('/me', { headers: { Authorization: authz } }, env);
  }

  const es256 = (url: string, { signer = null as KeyLike | null } = {}) =>
    new SignJWT({ sub: 'user-a' })
      .setProtectedHeader({ alg: 'ES256', kid: 'sub-key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(`${url}/auth/v1`)
      .setAudience('authenticated')
      .sign(signer ?? signingKey);

  it('UNREACHABLE + a populated cache => 200 AND STILL asymmetric — the downgrade does not happen', async () => {
    const url = 'https://outage-down.test';
    mode = 'down';
    const res = await api({ kv: cachedKv({ keys: [publicJwk] }), url })(
      `Bearer ${await es256(url)}`,
    );
    expect(res.status).toBe(200);
    // THE assertion. A 200 alone would also be produced by the HS256 fallback,
    // so the status code cannot distinguish "survived" from "downgraded".
    expect(await res.json()).toEqual({ userId: 'user-a', assurance: 'asymmetric' });
  });

  it('A NON-200 FROM THE JWKS ENDPOINT BEHAVES THE SAME — the shape the first predicate missed', async () => {
    const url = 'https://outage-502.test';
    mode = 'bad-gateway';
    const res = await api({ kv: cachedKv({ keys: [publicJwk] }), url })(
      `Bearer ${await es256(url)}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', assurance: 'asymmetric' });
  });

  it('ERASURE SURVIVES THE OUTAGE, and with no secret anywhere in its scope', async () => {
    const url = 'https://outage-erase.test';
    mode = 'down';
    const res = await api({
      kv: cachedKv({ keys: [publicJwk] }),
      url,
      middleware: erasureAuth,
      // No secret configured AT ALL, so the 200 below cannot have come from HS256.
      secret: null,
    })(`Bearer ${await es256(url)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', assurance: 'asymmetric' });
  });

  it('the HS256 fallback is NOT removed — an empty cache still reaches it, and says so', async () => {
    const url = 'https://outage-hs.test';
    mode = 'down';
    const hs = await new SignJWT({ sub: 'user-a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer(`${url}/auth/v1`)
      .setAudience('authenticated')
      .sign(key);
    const res = await api({ kv: emptyKv, url })(`Bearer ${hs}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', assurance: 'symmetric' });
  });

  it('unreachable + EMPTY cache + NO secret => 401, still fails closed', async () => {
    const url = 'https://outage-closed.test';
    mode = 'down';
    const res = await api({ kv: emptyKv, url, secret: null })(`Bearer ${await es256(url)}`);
    expect(res.status).toBe(401);
  });

  it('an EMPTY key set in the cache is not a usable fallback', async () => {
    const url = 'https://outage-emptyset.test';
    mode = 'down';
    const res = await api({ kv: cachedKv({ keys: [] }), url, secret: null })(
      `Bearer ${await es256(url)}`,
    );
    expect(res.status).toBe(401);
  });

  it('a corrupt cache is no cache', async () => {
    const url = 'https://outage-corrupt.test';
    mode = 'down';
    const res = await api({ kv: cachedKv('{not json'), url, secret: null })(
      `Bearer ${await es256(url)}`,
    );
    expect(res.status).toBe(401);
  });

  it('A ROTATED-OUT KEY IS REFUSED, NOT SERVED FROM THE STALE CACHE', async () => {
    // Why ERR_JWKS_NO_MATCHING_KEY was REMOVED from the predicate. The endpoint
    // is reachable and healthy; it just no longer publishes this token's key.
    // Serving it from the cache would mean a retired key keeps verifying.
    const url = 'https://outage-rotated.test';
    mode = 'rotated';
    const res = await api({ kv: cachedKv({ keys: [publicJwk] }), url, secret: null })(
      `Bearer ${await es256(url)}`,
    );
    expect(res.status).toBe(401);
  });

  it('the fallback does NOT widen — a FOREIGN ES256 key is still 401 against the cache', async () => {
    const url = 'https://outage-foreign.test';
    mode = 'down';
    const res = await api({ kv: cachedKv({ keys: [publicJwk] }), url, secret: null })(
      `Bearer ${await es256(url, { signer: foreignKey })}`,
    );
    expect(res.status).toBe(401);
  });

  it('the happy path verifies against the live JWKS, once', async () => {
    const url = 'https://outage-happy.test';
    mode = 'ok';
    const res = await api({ kv: emptyKv, url, secret: null })(`Bearer ${await es256(url)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-a', assurance: 'asymmetric' });
  });
});
