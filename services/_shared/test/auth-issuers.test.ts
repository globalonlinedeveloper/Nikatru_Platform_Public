// ─────────────────────────────────────────────────────────────────────────────
// auth-issuers.test.ts — THE TRUSTED ISSUERS ARE CONFIG (port-auth, 2026-10-03).
//
// tooling/ports/auth.json `issuers` is rendered into src/generated/ports.ts
// (AUTH_ISSUERS) and resolved against a Worker's environment by
// `trustedIssuers` (src/auth.ts). A dual-issuer window — the 2026-09-24
// hosted-to-Box-C cutover — is a second row.
//
//   🔴 a token whose `iss` no row names is REFUSED, before any key set is fetched;
//   🔴 with two rows, a token of EACH verifies, each against its own key set;
//   🔴 a forged `iss` only chooses which key set refuses the token;
//   🔴 only the PRIMARY issuer may fall back to the KV copies of ITS key set.
// Each origin is unique to its test: the remote key-set memo is per URL for
// the isolate's life (trap auth-05). Every case asserts HOW the token was
// verified, not only that it was (trap auth-04).
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

import { AUTH_ISSUERS, type AuthIssuerRow } from '../src/generated/ports';
import { JWKS_KV_KEY, issuerAt, trustedIssuers, verifyOptions } from '../src/auth';
import { NO_SYMMETRIC_FALLBACK, verifyAsymmetric, verifySupabaseToken } from '../src/auth-middleware';
import { memoryKv } from '../src/ports/fakes/kv';

const PRIMARY = AUTH_ISSUERS[0]!;
const SECOND: AuthIssuerRow = { ...PRIMARY, id: 'next', originEnv: 'AUTH_ISSUER_NEXT_URL' };
const ROWS: readonly AuthIssuerRow[] = [PRIMARY, SECOND];

type Pair = { key: CryptoKey; jwk: JWK };
let a: Pair;
let b: Pair;
let n = 0;
/** A fresh origin pair per test (auth-05). */
const origins = () => {
  n++;
  return { first: `https://issuer-a-${n}.test`, second: `https://issuer-b-${n}.test` };
};

async function pair(kid: string): Promise<Pair> {
  const p = await generateKeyPair('ES256', { extractable: true });
  return { key: p.privateKey, jwk: { ...(await exportJWK(p.publicKey)), alg: 'ES256', kid } };
}

const sign = (p: Pair, iss: string) =>
  new SignJWT({ sub: 'user-1' })
    .setProtectedHeader({ alg: 'ES256', kid: p.jwk.kid! })
    .setIssuer(iss)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(p.key);

/** Serves each origin's key set; `down` origins throw the workerd transport shape. */
function jwksServer(sets: Record<string, JWK[]>, down: string[] = []) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const origin = new URL(url).origin;
    if (down.includes(origin)) throw new Error('Network connection lost');
    const keys = sets[origin];
    if (!keys || !url.endsWith('/.well-known/jwks.json')) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return seen;
}

beforeAll(async () => {
  a = await pair('key-a');
  b = await pair('key-b');
});
afterEach(() => vi.unstubAllGlobals());

describe('the rendered rows, resolved', () => {
  it('the primary row is the one issuer verifyOptions always pinned', () => {
    expect(PRIMARY).toMatchObject({ originEnv: 'SUPABASE_URL', algorithms: ['ES256'], audience: 'authenticated' });
    expect(verifyOptions('https://id.example')).toEqual({ issuer: 'https://id.example/auth/v1', audience: 'authenticated', algorithms: ['ES256'] });
    expect(issuerAt('https://id.example').jwksUrl).toBe('https://id.example/auth/v1/.well-known/jwks.json');
  });

  it('a row whose origin variable is unset is not trusted; set, it is — in row order', () => {
    expect(trustedIssuers({ SUPABASE_URL: 'https://one.test' }, ROWS).map((i) => i.issuer)).toEqual(['https://one.test/auth/v1']);
    expect(trustedIssuers({ SUPABASE_URL: 'https://one.test', AUTH_ISSUER_NEXT_URL: 'https://two.test' }, ROWS).map((i) => i.id)).toEqual(['gotrue', 'next']);
    expect(trustedIssuers({ SUPABASE_URL: '' }, ROWS)).toEqual([]);
  });
});

describe('verification against the list', () => {
  it('🔴 a token from an issuer NOT in the list is refused, and no key set is fetched', async () => {
    const o = origins();
    const seen = jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
    const issuers = trustedIssuers({ SUPABASE_URL: o.first }, ROWS);
    const stranger = await sign(b, `${o.second}/auth/v1`);
    await expect(verifyAsymmetric(stranger, o.first, undefined, issuers)).rejects.toMatchObject({ code: 'ERR_JWT_ISSUER_NOT_TRUSTED' });
    await expect(verifySupabaseToken(stranger, o.first, undefined, NO_SYMMETRIC_FALLBACK, issuers)).rejects.toMatchObject({ code: 'ERR_JWT_ISSUER_NOT_TRUSTED' });
    expect(seen.filter((u) => u.startsWith(o.second))).toEqual([]);
  });

  it('🔴 with TWO issuers, a token of each verifies — asymmetrically, against its own key set', async () => {
    const o = origins();
    const seen = jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
    const issuers = trustedIssuers({ SUPABASE_URL: o.first, AUTH_ISSUER_NEXT_URL: o.second }, ROWS);
    expect(issuers).toHaveLength(2);
    for (const [p, origin] of [[a, o.first], [b, o.second]] as const) {
      const r = await verifySupabaseToken(await sign(p, `${origin}/auth/v1`), o.first, undefined, NO_SYMMETRIC_FALLBACK, issuers);
      expect(r.assurance).toBe('asymmetric');
      expect(r.payload.iss).toBe(`${origin}/auth/v1`);
    }
    expect(seen.filter((u) => u === `${o.second}/auth/v1/.well-known/jwks.json`).length).toBeGreaterThan(0);
  });

  it("🔴 a forged iss only picks which key set refuses: key B claiming issuer A fails A's key set", async () => {
    const o = origins();
    jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
    const issuers = trustedIssuers({ SUPABASE_URL: o.first, AUTH_ISSUER_NEXT_URL: o.second }, ROWS);
    await expect(verifyAsymmetric(await sign(b, `${o.first}/auth/v1`), o.first, undefined, issuers)).rejects.toMatchObject({ code: 'ERR_JWKS_NO_MATCHING_KEY' });
  });

  it('🔴 in an outage, the primary falls back to its cached key set; a second issuer does NOT borrow it', async () => {
    const o = origins();
    jwksServer({}, [o.first, o.second]);
    const kv = memoryKv();
    // The KV copy is the PRIMARY's key set — and it happens to hold key A.
    await kv.put(JWKS_KV_KEY, JSON.stringify({ keys: [a.jwk] }));
    const issuers = trustedIssuers({ SUPABASE_URL: o.first, AUTH_ISSUER_NEXT_URL: o.second }, ROWS);
    expect((await verifyAsymmetric(await sign(a, `${o.first}/auth/v1`), o.first, kv, issuers)).iss).toBe(`${o.first}/auth/v1`);
    await expect(verifyAsymmetric(await sign(a, `${o.second}/auth/v1`), o.first, kv, issuers)).rejects.toThrow('Network connection lost');
  });

  it('with the default list (no issuers passed), a carrier verifies exactly as before the list existed', async () => {
    const o = origins();
    jwksServer({ [o.first]: [a.jwk] });
    const r = await verifySupabaseToken(await sign(a, `${o.first}/auth/v1`), o.first, undefined, NO_SYMMETRIC_FALLBACK);
    expect(r.assurance).toBe('asymmetric');
    await expect(verifySupabaseToken(await sign(a, `${o.second}/auth/v1`), o.first, undefined, NO_SYMMETRIC_FALLBACK)).rejects.toMatchObject({ code: 'ERR_JWT_ISSUER_NOT_TRUSTED' });
  });
});
