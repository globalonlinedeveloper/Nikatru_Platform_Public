// ─────────────────────────────────────────────────────────────────────────────
// auth-issuers-wiring.test.ts — THE PLATFORM WORKER'S BOUNDARY (`platformAuth`,
// src/middleware/auth.ts) PASSES ITS ENVIRONMENT'S TRUSTED ISSUERS.
//
// ⏱ 2026-10-03 · review of #1182, finding 4 — the platform half of
// services/_shared/test/auth-issuers-wiring.test.ts (which holds the two
// app-Worker boundaries). The rendered rows are given a SECOND row (the module
// mock below), its variable is set in the env, and a token of the second issuer
// must reach the route. Remove `trustedIssuers(c.env)` from `platformAuth` and
// the verifier falls back to the primary alone: that case goes red (401).
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

vi.mock('../../_shared/src/generated/ports', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../_shared/src/generated/ports')>();
  const primary = real.AUTH_ISSUERS[0]!;
  return { ...real, AUTH_ISSUERS: [primary, { ...primary, id: 'next', originEnv: 'AUTH_ISSUER_NEXT_URL' }] };
});

import { platformAuth } from '../src/middleware/auth';
import type { AppEnv } from '../src/types';

type Pair = { key: CryptoKey; jwk: JWK };
let a: Pair;
let b: Pair;
let n = 0;
/** A fresh origin pair per test: the remote key-set memo is per URL (trap auth-05). */
const origins = () => {
  n++;
  return { first: `https://platform-wiring-a-${n}.test`, second: `https://platform-wiring-b-${n}.test` };
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

function app() {
  const h = new Hono<AppEnv>();
  h.get('/who', platformAuth, (c) => c.json({ user: c.get('userId') }));
  return h;
}

const ask = async (token: string, env: Record<string, unknown>) =>
  app().request('/who', { headers: { Authorization: `Bearer ${token}` } }, { APP_ID: 'platform', ...env } as unknown as AppEnv['Bindings']);

beforeAll(async () => {
  a = await pair('platform-wiring-a');
  b = await pair('platform-wiring-b');
});
afterEach(() => vi.unstubAllGlobals());

describe('🔴 platformAuth trusts the issuers its environment sets', () => {
  it('a token of the SECOND issuer is admitted once its variable is set', async () => {
    const o = origins();
    jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
    const res = await ask(await sign(b, `${o.second}/auth/v1`), { SUPABASE_URL: o.first, AUTH_ISSUER_NEXT_URL: o.second });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: 'user-1' });
  });

  it('with the variable unset, the same token is refused (401)', async () => {
    const o = origins();
    jwksServer({ [o.first]: [a.jwk], [o.second]: [b.jwk] });
    const res = await ask(await sign(b, `${o.second}/auth/v1`), { SUPABASE_URL: o.first });
    expect(res.status).toBe(401);
  });
});
