import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';
import { anonymousNotRefused, es256Issuer, goTrueClaims, hs256Token, jwksFetch, type Through } from '../../_shared/test/mount-auth';

// ─────────────────────────────────────────────────────────────────────────────
// mount-auth.test.ts — THIS WORKER'S AUTH BOUNDARIES RUN IN ITS OWN SUITE.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012).
// `supabaseAuth` and `erasureAuth` are the kit's (services/_shared/src/
// auth-middleware.ts), bound in src/middleware/auth.ts. Until this file nothing
// in a stamped Worker's suite executed either, so a binding that stopped
// verifying — or an index.ts that mounted the erasure route behind the wrong
// one — was green here. Driven through the REAL app, with a real ES256 key and
// the route set read from `app.routes`.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://id.example.test';
const SECRET = 'legacy-shared-secret-for-the-test-only';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = (over: Partial<Record<string, unknown>> = {}) =>
  ({ SUPABASE_URL, APP_ID: '{{app_id}}', SUPABASE_JWT_SECRET: SECRET, ...over }) as unknown as AppEnv['Bindings'];

const through =
  (bindings = env()): Through =>
  (path, init) =>
    app.request(path, init, bindings);

describe('every route that is not public refuses an anonymous caller', () => {
  it('derived from app.routes: everything but GET /v1/health answers 401 with no bearer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await anonymousNotRefused(app.routes, through(), [{ method: 'GET', path: '/v1/health' }], 1)).toEqual([]);
  });

  it('the /v1 group is behind supabaseAuth too: an unclaimed path is 401, not 404', async () => {
    expect((await through()('/v1/anything', { method: 'GET' })).status).toBe(401);
  });
});

describe('supabaseAuth admits a verified token, and erasureAuth refuses the legacy secret', () => {
  it('🔴 a GoTrue ES256 token passes supabaseAuth (the group answers 404, not 401)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { jwks, sign } = await es256Issuer();
    vi.stubGlobal('fetch', jwksFetch(SUPABASE_URL, jwks));
    const token = await sign(goTrueClaims(SUPABASE_URL, 'user-1'));
    const res = await through()('/v1/anything', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });

  it('a token for ANOTHER project is refused', async () => {
    const { jwks, sign } = await es256Issuer();
    vi.stubGlobal('fetch', jwksFetch(SUPABASE_URL, jwks));
    const token = await sign(goTrueClaims('https://other.example.test', 'user-1'));
    const res = await through()('/v1/anything', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('🔴 an HS256 token passes the permissive boundary and is a 401 on DELETE /v1/account', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The JWKS is unreachable for a non-transport reason (a 404 JSON body), so the
    // asymmetric path fails on the token and only the legacy secret can admit it.
    vi.stubGlobal('fetch', async () => Response.json({ keys: [] }));
    const token = await hs256Token(SECRET, goTrueClaims(SUPABASE_URL, 'user-1'));
    const headers = { Authorization: `Bearer ${token}` };
    expect((await through()('/v1/anything', { method: 'GET', headers })).status).toBe(404);
    expect((await through()('/v1/account', { method: 'DELETE', headers })).status).toBe(401);
  });
});
