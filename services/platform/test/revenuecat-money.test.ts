import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import money from '../src/routes/money';
import type { AppEnv } from '../src/types';
import { deriveAndApply, persistNotification } from '../src/lib/mor/store';
import { makeRevenuecatVerifier, revenueCatSignature } from '../src/lib/mor/revenuecat';
import { isKnownProduct } from '../src/config';
import { realPlatformDb, type RealDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// revenuecat-money.test.ts — [ADR 085] through the REAL store and the REAL route.
//
// ⏱ 2026-09-15. revenuecat-verifier.test.ts pins what `parse` concludes; this file
// pins what the money rail DOES with it, on a real platform_db built from the
// migrations: a decided event writes the entitlement row, and every refusal (an
// undeclared app id, an anonymous user, a money-world mismatch) writes NO
// entitlement, is stored verbatim with `derive_error` `refused: …` (which is what
// the nightly `money_rederive` heartbeat counts), and is answered 503 — never a
// silent 200.
// ─────────────────────────────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-09-15T06:00:00.000Z');
const RC_APP = 'app_rc_money_android';
const USER = '0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const verifier = makeRevenuecatVerifier({ [RC_APP]: 'subscriptiontracker' });

let seq = 0;
function rcBody(over: Record<string, unknown> = {}): string {
  seq += 1;
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: `evt_rc_money_${seq}`,
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: NOW_MS - 60_000 + seq,
      app_id: RC_APP,
      app_user_id: USER,
      environment: 'PRODUCTION',
      original_transaction_id: 'otx_money_1',
      transaction_id: `tx_${seq}`,
      expiration_at_ms: NOW_MS + 30 * 86_400_000,
      period_type: 'NORMAL',
      ...over,
    },
  });
}

async function deliver(db: RealDb, raw: string, environment: 'live' | 'sandbox' = 'live') {
  const parsed = verifier.parse(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const deps = { db: db as unknown as D1Database, environment, nowMs: NOW_MS, isKnownProduct };
  await persistNotification(deps, parsed.notification, raw);
  return deriveAndApply(deps, parsed.notification);
}

const count = async (db: RealDb, sql: string) =>
  ((await (db as unknown as D1Database).prepare(sql).first<{ n: number }>()) ?? { n: -1 }).n;

describe('RevenueCat through the store — decided events write, refusals do not', () => {
  it('INITIAL_PURCHASE for a declared app and a logged-in user grants Pro', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcBody());
    expect(r.outcome).toBe('applied');
    const row = await (db as unknown as D1Database)
      .prepare('SELECT is_active, provider, provider_subscription_id FROM entitlements WHERE user_id = ? AND app_id = ?')
      .bind(USER, 'subscriptiontracker')
      .first<{ is_active: number; provider: string; provider_subscription_id: string }>();
    expect(row).toEqual({ is_active: 1, provider: 'revenuecat', provider_subscription_id: 'otx_money_1' });
  });

  it('C · a CUSTOMER_SUPPORT CANCELLATION after the purchase revokes now as refund_approved', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody());
    const r = await deliver(db, rcBody({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }));
    expect(r.outcome).toBe('applied');
    const row = await (db as unknown as D1Database)
      .prepare('SELECT is_active, revocation_reason FROM entitlements WHERE user_id = ?')
      .bind(USER)
      .first<{ is_active: number; revocation_reason: string }>();
    expect(row).toEqual({ is_active: 0, revocation_reason: 'refund_approved' });
  });

  it('D · a lapsed BILLING_ISSUE revokes as payment_failed_final rather than refusing forever', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody());
    const r = await deliver(db, rcBody({ type: 'BILLING_ISSUE', expiration_at_ms: NOW_MS - 1000 }));
    expect(r.outcome).toBe('applied');
    const row = await (db as unknown as D1Database)
      .prepare('SELECT is_active, revocation_reason FROM entitlements WHERE user_id = ?')
      .bind(USER)
      .first<{ is_active: number; revocation_reason: string }>();
    expect(row).toEqual({ is_active: 0, revocation_reason: 'payment_failed_final' });
  });

  it('A · an undeclared app id is REFUSED: stored, marked refused, no entitlement, no link', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcBody({ app_id: 'app_nobody_declared' }));
    expect(r.outcome).toBe('refused');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM provider_accounts')).toBe(0);
    expect(
      await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE derive_error LIKE 'refused:%ADR 085 A%'"),
    ).toBe(1);
  });

  it('B · an anonymous app user id is REFUSED the same way', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcBody({ app_user_id: '$RCAnonymousID:1234' }));
    expect(r.outcome).toBe('refused');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE derive_error LIKE 'refused:%anonymous%'")).toBe(1);
  });

  it('[5]M-12 · a SANDBOX event at a live destination is refused before any account is linked', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcBody({ environment: 'SANDBOX' }), 'live');
    expect(r.outcome).toBe('refused');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM provider_accounts')).toBe(0);
  });
});

describe('RevenueCat through the route — the shipped verifier refuses on A, loudly', () => {
  it('a genuinely signed, well-formed event is 503 (refused, recorded), never a silent 200', async () => {
    const db = realPlatformDb();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'rc-rid');
      await next();
    });
    app.route('/v1/money', money);
    const secret = 'rc_route_signing_secret';
    const env = {
      PLATFORM_DB: db,
      MONEY_CEILING_LIMITER: { limit: async () => ({ success: true }) },
      MONEY_ENVIRONMENT: 'live',
      REVENUECAT_WEBHOOK_SIGNING_SECRET: secret,
    } as unknown as AppEnv['Bindings'];
    const raw = rcBody();
    const t = Math.floor(Date.now() / 1000);
    const res = await app.fetch(
      new Request('https://x/v1/money/revenuecat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-RevenueCat-Webhook-Signature': `t=${t},v1=${await revenueCatSignature(secret, t, raw)}`,
        },
        body: raw,
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ recorded: true, derived: 'refused' });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE provider = 'revenuecat' AND derive_error LIKE 'refused:%'")).toBe(1);
  });
});
