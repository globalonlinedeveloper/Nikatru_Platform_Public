// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · AB-M3-01 · ONE PURCHASE, ON ANY RAIL, UNLOCKS PRO FOR THE PERSON
// WHO MADE IT — through the real doors, end to end.
//
// The design is one reader (services/_shared/src/entitlement-read.ts) behind
// GET /v1/entitlements, and every client reads that; the store SDK never
// unlocks. But until this file no test delivered a grant on a rail and then
// read `is_pro` for the same user through the route: the reader tests seed
// entitlement rows directly, and the money tests stop at the row. A writer and
// a reader that disagree on one column (the environment, the app id, the
// entitlement name) would pass both suites and lock out every payer.
//
// Each case below: a SIGNED notification into POST /v1/money/:provider (the real
// registry's verifier), then an AUTHENTICATED GET /v1/entitlements as the payer.
// The red control is the same grant made for SOMEONE ELSE: the payer must then
// read `is_pro: false` — a reader that ignored `user_id` would pass the grant
// case alone.
//
// Razorpay is registered and its `parse` refuses every body (no sourced sample,
// MF-9), so no Razorpay purchase can unlock anything today; that case pins the
// refusal, and it is an open precondition in tooling/paywall-flip.json.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import entitlements from '../src/routes/entitlements';
import money from '../src/routes/money';
import type { AppEnv } from '../src/types';
import {
  PADDLE_CUSTOM_DATA_APP_ID,
  PADDLE_CUSTOM_DATA_USER_ID,
  PADDLE_SECRET_PREFIX,
  paddleSignature,
} from '../src/lib/mor/paddle';
import { revenueCatSignature } from '../src/lib/mor/revenuecat';
import { razorpaySignature } from '../src/lib/mor/razorpay';
import { MOR_VERIFIERS } from '../src/lib/mor/registry';
import { realPlatformDb } from './harness';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP = 'subscriptiontracker';
const PAYER = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

const PADDLE_SECRET = `${PADDLE_SECRET_PREFIX}01cross_rail_destination_secret`;
const RC_SECRET = 'cross_rail_revenuecat_signing_secret';
const RAZORPAY_SECRET = 'cross_rail_razorpay_webhook_secret';
/** A RevenueCat app id apps/subscriptiontracker/app.yaml declares (revenuecat-app-ids.ts). */
const RC_APP_ID = 'app805d73cd44';

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
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());

const KV = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const CTX = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

async function token(sub: string) {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);
}

/** The two doors on one database, as the Worker mounts them. */
function worker() {
  const db = realPlatformDb();
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-cross-rail');
    await next();
  });
  app.route('/v1/money', money);
  app.use('/v1/entitlements', platformAuth);
  app.route('/v1', entitlements);
  const env = {
    PLATFORM_DB: db,
    JWKS_CACHE: KV,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: 'live',
    MONEY_CEILING_LIMITER: { limit: async () => ({ success: true }) },
    PADDLE_NOTIFICATION_SECRET: PADDLE_SECRET,
    REVENUECAT_WEBHOOK_SIGNING_SECRET: RC_SECRET,
    RAZORPAY_WEBHOOK_SECRET: RAZORPAY_SECRET,
  } as unknown as AppEnv['Bindings'];

  const deliver = (provider: string, raw: string, headers: Record<string, string>) =>
    app.fetch(
      new Request(`https://x/v1/money/${provider}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: raw,
      }),
      env,
      CTX,
    );

  const isPro = async (userId: string): Promise<boolean> => {
    const res = await app.fetch(
      new Request(`https://x/v1/entitlements?app_id=${APP}`, {
        headers: { Authorization: `Bearer ${await token(userId)}` },
      }),
      env,
      CTX,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_pro: boolean };
    return body.is_pro;
  };

  return { db, deliver, isPro };
}

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

/** The grant on each rail, signed as the rail signs it, for `userId`. */
const RAILS: Record<string, (w: ReturnType<typeof worker>, userId: string) => Promise<Response>> = {
  paddle: async (w, userId) => {
    const raw = JSON.stringify({
      event_id: `evt_cross_rail_paddle_${userId.slice(0, 8)}`,
      notification_id: 'ntf_cross_rail',
      event_type: 'subscription.created',
      occurred_at: iso(NOW - 60_000),
      data: {
        id: 'sub_01crossrail',
        status: 'active',
        current_billing_period: { starts_at: iso(NOW - DAY), ends_at: iso(NOW + 30 * DAY) },
        items: [],
        custom_data: { [PADDLE_CUSTOM_DATA_USER_ID]: userId, [PADDLE_CUSTOM_DATA_APP_ID]: APP },
        customer_id: 'ctm_01crossrail',
        customer: {},
      },
    });
    const ts = Math.floor(NOW / 1000);
    return w.deliver('paddle', raw, { 'Paddle-Signature': `ts=${ts};h1=${await paddleSignature(PADDLE_SECRET, ts, raw)}` });
  },
  revenuecat: async (w, userId) => {
    const raw = JSON.stringify({
      api_version: '1.0',
      event: {
        id: `evt_cross_rail_rc_${userId.slice(0, 8)}`,
        type: 'INITIAL_PURCHASE',
        event_timestamp_ms: NOW - 60_000,
        app_id: RC_APP_ID,
        app_user_id: userId,
        environment: 'PRODUCTION',
        original_transaction_id: 'otx_cross_rail',
        transaction_id: 'tx_cross_rail',
        expiration_at_ms: NOW + 30 * DAY,
        period_type: 'NORMAL',
      },
    });
    const t = Math.floor(NOW / 1000);
    return w.deliver('revenuecat', raw, {
      'X-RevenueCat-Webhook-Signature': `t=${t},v1=${await revenueCatSignature(RC_SECRET, t, raw)}`,
    });
  },
};

describe('AB-M3-01 · one purchase unlocks Pro for its payer on every rail that can sell', () => {
  it('every registered rail is either proven here or pinned as refusing — none is skipped silently', () => {
    const covered = [...Object.keys(RAILS), 'razorpay'].sort();
    expect(MOR_VERIFIERS.map((v) => v.provider).sort()).toEqual(covered);
  });

  for (const rail of Object.keys(RAILS)) {
    it(`${rail}: a signed grant for the payer reads is_pro=true for the payer`, async () => {
      const w = worker();
      expect(await w.isPro(PAYER)).toBe(false);
      const res = await RAILS[rail](w, PAYER);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, derived: 'applied' });
      expect(await w.isPro(PAYER)).toBe(true);
    });

    it(`${rail}: RED CONTROL — the same grant for someone else leaves the payer at is_pro=false`, async () => {
      const w = worker();
      const res = await RAILS[rail](w, SOMEONE_ELSE);
      expect(res.status).toBe(200);
      expect(await w.isPro(PAYER)).toBe(false);
      expect(await w.isPro(SOMEONE_ELSE)).toBe(true);
    });
  }

  it('razorpay: no body can grant today — the parse refuses it (400, no row) and nobody reads is_pro=true', async () => {
    const w = worker();
    const raw = JSON.stringify({
      entity: 'event',
      event: 'subscription.activated',
      payload: { subscription: { entity: { id: 'sub_cross_rail', notes: { user_id: PAYER, app_id: APP } } } },
      created_at: Math.floor(NOW / 1000),
    });
    const res = await w.deliver('razorpay', raw, {
      'x-razorpay-signature': await razorpaySignature(RAZORPAY_SECRET, raw),
      'x-razorpay-event-id': 'evt_cross_rail_rzp',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unparseable_notification' });
    expect(await w.isPro(PAYER)).toBe(false);
  });
});
