import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { app } from '../src/index';
import type { AppEnv } from '../src/types';
import { TEST_ENV, realAppDb, realPlatformDb, type SqliteD1 } from './harness';
import { es256Issuer, goTrueClaims, jwksFetch } from '../../_shared/test/mount-auth';
import { WRITE_LIMITER_BINDING, WRITE_RETRY_AFTER_SECONDS } from '../src/middleware/write-limit';

// ─────────────────────────────────────────────────────────────────────────────
// THE PER-ACCOUNT WRITE LIMITER, THROUGH THE REAL APP (rv2-services-008).
//
// Driven through src/index.ts with a real ES256 token, so what is under test is
// the MOUNT — after `supabaseAuth`, keyed on the subject it verified — not the
// middleware on its own. The limiter is a stub of the Rate Limiting binding's
// one method; the deployed binding is asserted by test/wrangler-config.test.ts.
//
// Red control (run at authoring): `api.use('*', writeLimit)` removed from
// src/index.ts → the first test answers 201 and writes the row.
// ─────────────────────────────────────────────────────────────────────────────

const SUB = 'user-limited';

let appDb: SqliteD1;
let token: string;
let keys: string[];

// ONE issuer for the file: the kit caches the JWKS per isolate, so a key minted
// per test would be verified against the first test's cached document.
const issuer = es256Issuer();

beforeEach(async () => {
  appDb = realAppDb();
  keys = [];
  const { jwks, sign } = await issuer;
  vi.stubGlobal('fetch', jwksFetch(TEST_ENV.SUPABASE_URL, jwks));
  token = await sign(goTrueClaims(TEST_ENV.SUPABASE_URL, SUB));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const limiter = (success: boolean) => ({
  async limit({ key }: { key: string }) {
    keys.push(key);
    return { success };
  },
});

const call = (method: string, path: string, success: boolean | undefined, body?: unknown) =>
  app.request(
    path,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    {
      ...TEST_ENV,
      APP_DB: appDb,
      PLATFORM_DB: realPlatformDb(),
      ...(success === undefined ? {} : { WRITE_LIMITER: limiter(success) }),
    } as unknown as AppEnv['Bindings'],
  );

const rows = () => appDb.rows('SELECT id FROM subscriptions');

describe('WRITE_LIMITER bounds every write, per verified account', () => {
  it('🔴 over the limit: POST is 429 with Retry-After, and no row is written', async () => {
    const res = await call('POST', '/v1/subscriptions', false, { name: 'Netflix', price: 9.99 });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe(String(WRITE_RETRY_AFTER_SECONDS));
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
    expect(rows()).toEqual([]);
  });

  it('is keyed on the VERIFIED subject, never on anything the caller sends', async () => {
    await call('POST', '/v1/subscriptions', true, { name: 'Netflix', price: 9.99, user_id: 'someone-else' });
    expect(keys).toEqual([`st:${SUB}`]);
  });

  it('within the limit: POST is 201 and the row is written', async () => {
    const res = await call('POST', '/v1/subscriptions', true, { name: 'Netflix', price: 9.99 });
    expect(res.status).toBe(201);
    expect(rows()).toHaveLength(1);
  });

  it('PATCH, PUT and DELETE are limited too; a GET is not asked about at all', async () => {
    expect((await call('PATCH', '/v1/subscriptions/x', false, { name: 'n' })).status).toBe(429);
    expect((await call('PUT', '/v1/budget', false, { monthly_budget: 1 })).status).toBe(429);
    expect((await call('DELETE', '/v1/subscriptions/x', false)).status).toBe(429);
    keys = [];
    expect((await call('GET', '/v1/subscriptions', false)).status).toBe(200);
    expect(keys, 'a read must not spend the write budget').toEqual([]);
  });

  it('an anonymous write is a 401 from supabaseAuth BEFORE the limiter is asked', async () => {
    const res = await app.request(
      '/v1/subscriptions',
      { method: 'POST', body: '{}' },
      { ...TEST_ENV, APP_DB: appDb, PLATFORM_DB: realPlatformDb(), WRITE_LIMITER: limiter(false) } as unknown as AppEnv['Bindings'],
    );
    expect(res.status).toBe(401);
    expect(keys).toEqual([]);
  });

  it('an ABSENT binding fails open and says so once (the kit’s withinRateLimit)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call('POST', '/v1/subscriptions', undefined, { name: 'A' })).status).toBe(201);
    expect((await call('POST', '/v1/subscriptions', undefined, { name: 'B' })).status).toBe(201);
    const lines = err.mock.calls.filter((c) => String(c[0]).includes(WRITE_LIMITER_BINDING));
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});
