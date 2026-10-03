// ─────────────────────────────────────────────────────────────────────────────
// auth-issuers-wiring.test.ts — THE TWO APP-WORKER BOUNDARIES PASS THEIR
// ENVIRONMENT'S TRUSTED ISSUERS (`trustedIssuers(c.env)`, src/auth-middleware.ts).
//
// ⏱ 2026-10-03 · review of #1182, finding 4. auth-issuers.test.ts drives
// `verifyAsymmetric` and `verifySupabaseToken` with explicit lists; nothing drove
// a MIDDLEWARE with a second issuer set. With one rendered row,
// `trustedIssuers(env)` equals the default `[issuerAt(SUPABASE_URL)]`, so deleting
// the argument at a call site stayed green — and the dual-issuer window would
// silently not open in that boundary. Here the rendered rows are given a SECOND
// row (the module mock below), its variable is set in `c.env`, and a token of the
// second issuer must be ADMITTED by `supabaseAuthWith` and by `erasureAuth`.
// Remove `trustedIssuers(c.env)` from either and that case goes red (401).
// The platform Worker's own boundary has the same case in
// services/platform/test/auth-issuers-wiring.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

vi.mock('../src/generated/ports', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/generated/ports')>();
  const primary = real.AUTH_ISSUERS[0]!;
  return { ...real, AUTH_ISSUERS: [primary, { ...primary, id: 'next', originEnv: 'AUTH_ISSUER_NEXT_URL' }] };
});

import { erasureAuth, supabaseAuthWith, type AuthContext } from '../src/auth-middleware';

type Pair = { key: CryptoKey; jwk: JWK };
let a: Pair;
let b: Pair;
let n = 0;
/** A fresh origin pair per test: the remote key-set memo is per URL (trap auth-05). */
const origins = () => {
  n++;
  return { first: `https://wiring-a-${n}.test`, second: `https://wiring-b-${n}.test` };
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

function jwksServer(sets: Record<string, JWK[]>) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    const keys = sets[new URL(url).origin];
    if (!keys || !url.endsWith('/.well-known/jwks.json')) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

/** The smallest context the boundaries read: a header, the env, get/set and json. */
function context(token: string, env: Record<string, unknown>) {
  const vars: Record<string, unknown> = {};
  const c = {
    req: { header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) },
    env: { APP_ID: 'wiring', ...env },
    get: (k: string) => vars[k],
    set: (k: string, v: unknown) => {
      vars[k] = v;
    },
    json: (o: unknown, status: number) => new Response(JSON.stringify(o), { status }),
  };
  return { c: c as unknown as AuthContext, vars };
}

const BOUNDARIES = [
  ['supabaseAuthWith (permissive)', supabaseAuthWith({ legacyHs256Secret: () => undefined })],
  ['erasureAuth (irreversible)', erasureAuth],
] as const;

beforeAll(async () => {
  a = await pair('wiring-a');
  b = await pair('wiring-b');
});
afterEach(() => vi.unstubAllGlobals());

describe('🔴 each app-Worker boundary trusts the issuers its environment sets', () => {
  for (const [name, boundary] of BOUNDARIES) {
    it(`${name}: a token of the SECOND issuer is admitted once its variable is set`, async () => {
      const o = origins();
      jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
      const { c, vars } = context(await sign(b, `${o.second}/auth/v1`), { SUPABASE_URL: o.first, AUTH_ISSUER_NEXT_URL: o.second });
      let reached = false;
      const res = await boundary(c, async () => {
        reached = true;
      });
      expect(res).toBeUndefined();
      expect(reached).toBe(true);
      expect(vars.userId).toBe('user-1');
    });

    it(`${name}: with the variable unset, the same token is refused (401)`, async () => {
      const o = origins();
      jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
      const { c } = context(await sign(b, `${o.second}/auth/v1`), { SUPABASE_URL: o.first });
      let reached = false;
      const res = await boundary(c, async () => {
        reached = true;
      });
      expect(res instanceof Response ? res.status : null).toBe(401);
      expect(reached).toBe(false);
    });
  }
});
