// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · AB-A5-02 (moneyflows MF-4) · DELETE /v1/account STOPS THE BILLING
// BEFORE IT ERASES THE PERSON, OR REFUSES WITH A SENTENCE.
//
// Red control on main 454dd415: a user with a live Paddle row was erased and the
// mocked Paddle saw NO cancel; a live Razorpay row was erased too, silently.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import account from '../src/routes/account';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SUPABASE_URL = 'https://account-billing-test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP_ORIGIN = 'https://api.test';
const LIVE_KEY = `pdl_live_apikey_${'x'.repeat(24)}`;
const USER = 'user-billing';

let signingKey: CryptoKey;
let publicJwk: JWK;
let paddleCalls: Array<{ url: string; body: string }> = [];
let razorpayCalls: Array<{ url: string; body: string }> = [];
let paddleStatus = 200;
let identityDeletes = 0;
let appPurges = 0;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://api.paddle.com/')) {
      paddleCalls.push({ url, body: String(init?.body ?? '') });
      return new Response(
        JSON.stringify({ data: { id: 'sub_01live', scheduled_change: { action: 'cancel', effective_at: '2026-10-29T00:00:00.000Z' } } }),
        { status: paddleStatus, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // ⏱ 2026-10-01 · fix-india-rail-tax-data: Razorpay has a cancel executor now (razorpay-rail.ts).
    if (url.startsWith('https://api.razorpay.com/')) {
      razorpayCalls.push({ url, body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ id: 'sub_RZPlive01', entity: 'subscription', status: 'active', current_end: 1824681600 }), { status: 200 });
    }
    if (url.includes('/auth/v1/admin/users/') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ email: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/auth/v1/admin/users/')) {
      identityDeletes += 1;
      return new Response(null, { status: 204 });
    }
    if (new URL(url).origin === APP_ORIGIN) {
      appPurges += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  paddleCalls = [];
  razorpayCalls = [];
  paddleStatus = 200;
  identityDeletes = 0;
  appPurges = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** A password account: the recency check admits it without an `amr` timestamp. */
const passwordUser = () =>
  new SignJWT({ sub: USER, app_metadata: { provider: 'email', providers: ['email'] } })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);

/** ⚠️ `null` means NO key; an `undefined` argument is swallowed by the default. */
function harness(paddleApiKey: string | null = LIVE_KEY, razorpayKeys: Record<string, string> = {}) {
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-billing');
    await next();
  });
  app.use('/v1/account', platformAuth);
  app.route('/v1', account);
  const env = {
    PLATFORM_DB: db,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    APP_ERASURE_ENDPOINTS: `subscriptiontracker=${APP_ORIGIN}`,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: 'live',
    PADDLE_API_KEY: paddleApiKey ?? undefined,
    ...razorpayKeys,
  } as unknown as AppEnv['Bindings'];
  return {
    db,
    del: async () =>
      app.request('/v1/account', { method: 'DELETE', headers: { Authorization: `Bearer ${await passwordUser()}` } }, env),
  };
}

function seedLive(db: RealDb, provider: string, subscriptionId: string, store: string | null = null) {
  db.db
    .prepare(
      `INSERT INTO entitlements
         (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at,
          provider, provider_environment, provider_subscription_id, provider_status)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`,
    )
    .run(USER, 'subscriptiontracker', 'pro', null, store, '2099-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', provider, 'live', subscriptionId, 'active');
}

const entitlementRows = (db: RealDb) => db.rows('SELECT user_id FROM entitlements WHERE user_id = ?', USER).length;

describe('AB-A5-02 · deleting a paying account stops its billing first', () => {
  it('a live PADDLE subscription is cancelled at the period end BEFORE the erasure, then the account is erased', async () => {
    const h = harness();
    seedLive(h.db, 'paddle', 'sub_01live');

    const res = await h.del();

    expect(res.status).toBe(200);
    expect(paddleCalls).toHaveLength(1);
    expect(paddleCalls[0].url).toBe('https://api.paddle.com/subscriptions/sub_01live/cancel');
    expect(JSON.parse(paddleCalls[0].body)).toEqual({ effective_from: 'next_billing_period' });
    expect(entitlementRows(h.db)).toBe(0);
    expect(identityDeletes).toBe(1);
  });

  it('Paddle not confirming REFUSES the deletion with a sentence, and NOTHING is erased', async () => {
    paddleStatus = 500;
    const h = harness();
    seedLive(h.db, 'paddle', 'sub_01live');

    const res = await h.del();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('subscription_still_billing');
    expect(body.message).toMatch(/not deleted/);
    expect(entitlementRows(h.db)).toBe(1);
    expect(identityDeletes).toBe(0);
    expect(appPurges).toBe(0);
  });

  it('no seller key on the deploy refuses too — never erase a person whose billing nobody stopped', async () => {
    const h = harness(null);
    seedLive(h.db, 'paddle', 'sub_01live');

    const res = await h.del();

    expect(res.status).toBe(503);
    expect(paddleCalls).toHaveLength(0);
    expect(identityDeletes).toBe(0);
  });

  // ⏱ 2026-10-01 · fix-india-rail-tax-data: MF-9's "no executor" closed in code — razorpay-rail.ts
  // declares `cancel` (POST /v1/subscriptions/<id>/cancel, cancel_at_cycle_end). The deletion still
  // FAILS CLOSED when this deploy holds no Razorpay key: nothing is erased, nothing is sent.
  it('a live RAZORPAY subscription on a deploy with no Razorpay key refuses (fail closed), sends nothing, erases nothing', async () => {
    const h = harness();
    seedLive(h.db, 'razorpay', 'sub_RZPlive01');

    const res = await h.del();

    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toMatch(/could not stop your subscription billing/);
    expect(razorpayCalls).toHaveLength(0);
    expect(identityDeletes).toBe(0);
  });

  it('a live RAZORPAY subscription is cancelled at the cycle end BEFORE the erasure when the key pair is set', async () => {
    const h = harness(LIVE_KEY, { RAZORPAY_KEY_ID: `rzp_live_${'k'.repeat(14)}`, RAZORPAY_KEY_SECRET: 'fixture-secret' });
    seedLive(h.db, 'razorpay', 'sub_RZPlive01');

    const res = await h.del();

    expect(res.status).toBe(200);
    expect(razorpayCalls).toHaveLength(1);
    expect(razorpayCalls[0].url).toBe('https://api.razorpay.com/v1/subscriptions/sub_RZPlive01/cancel');
    expect(JSON.parse(razorpayCalls[0].body)).toEqual({ cancel_at_cycle_end: 1 });
    expect(identityDeletes).toBe(1);
  });

  it('a STORE subscription does not block: the store bills its own account, and nothing is sent to Paddle', async () => {
    const h = harness();
    seedLive(h.db, 'revenuecat', 'otx_store', 'APP_STORE');

    const res = await h.del();

    expect(res.status).toBe(200);
    expect(paddleCalls).toHaveLength(0);
    expect(identityDeletes).toBe(1);
  });

  it('a retry after a confirmed cancel does not ask Paddle again', async () => {
    const h = harness();
    seedLive(h.db, 'paddle', 'sub_01live');
    h.db.db
      .prepare(
        `INSERT INTO cancellation_requests
           (request_id, user_id, app_id, environment, provider, provider_subscription_id, requested_at, executed_at, not_executed_reason)
         VALUES ('r1', ?, 'subscriptiontracker', 'live', 'paddle', 'sub_01live', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', NULL)`,
      )
      .run(USER);

    const res = await h.del();

    expect(res.status).toBe(200);
    expect(paddleCalls).toHaveLength(0);
  });

  it('no live subscription: the deletion is unchanged and Paddle is never called', async () => {
    const h = harness();
    const res = await h.del();
    expect(res.status).toBe(200);
    expect(paddleCalls).toHaveLength(0);
    expect(identityDeletes).toBe(1);
  });
});
