import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import money, { grantDepsFor } from '../src/routes/money';
import type { AppEnv } from '../src/types';
import {
  PADDLE_CUSTOM_DATA_APP_ID,
  PADDLE_CUSTOM_DATA_USER_ID,
  PADDLE_SECRET_PREFIX,
  paddleSignature,
  paddleVerifier,
} from '../src/lib/mor/paddle';
import { makeRevenuecatVerifier } from '../src/lib/mor/revenuecat';
import { deriveAndApply, persistNotification } from '../src/lib/mor/store';
import { type GrantDeps, grantFromVerifiedEvent, storeSkuFor } from '../src/lib/mor/grant';
import { STORE_SKUS, type StoreSku } from '../src/lib/mor/store-skus';
import { isAttributableProduct, isKnownProduct } from '../src/config';
import { PADDLE_PRICE_IDS, RAIL_PRICE_PENDING, oneTimeOfferingFor } from '../src/routes/checkout';
import { mintFeatureSetFromRegister } from '../src/routes/receipts';
import { allRows } from '../src/lib/d1';
import { isMoneyEnvironment } from '../src/lib/mor/contract';
import { readProductEntitlement } from '../../_shared/src/entitlement-read';
import { realPlatformDb, type RealDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// grant.test.ts — src/lib/mor/grant.ts, THE ONE ENTRY FROM A VERIFIED MONEY EVENT
// TO A GRANT (O-ONE-TIME-GRANT-UNBUILT, O-IAP-BUNDLE-SALE-UNLOCKS-ONE-APP).
//
// Four things are held here, each through the REAL writers on a platform_db built
// from the migrations:
//   1 · a Paddle ONE-TIME purchase, posted through the real route and read back
//       through the real entitlement read, grants with no end date (RC8: with
//       grant.ts bypassed, the read answers is_pro false);
//   2 · a lifetime is not overwritten or revoked by ANOTHER purchase's event;
//   3 · a RevenueCat BUNDLE SKU is written to bundle_grants and unlocks the
//       bundle's other member, while an app SKU keeps the single-app path (RC9);
//   4 · the re-point is BYTE-EQUAL: every existing-fixture shape reaches the same
//       rows through grant.ts as through store.ts `deriveAndApply` alone.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = `${PADDLE_SECRET_PREFIX}01test_grant_destination_secret`;
const USER = 'user-grant-1';
const APP = 'subscriptiontracker';
/** Read back from Paddle at 2026-09-26T23:43:12Z (routes/checkout.ts PADDLE_PRICE_IDS). */
const LIFETIME_PRICE = 'pri_01m346p14yzeqjjwj153thx8p2';
const MONTHLY_PRICE = 'pri_01m346p0fjtaffk6waj5x5vz1c';
const TXN = 'txn_01hv8wptq8987qeep44cyrewp9';

let seq = 0;
const nextEventId = () => `evt_grant_${(seq += 1).toString().padStart(22, '0')}`;

// ── THE PADDLE ONE-TIME FIXTURE ──────────────────────────────────────────────
// SOURCE: developer.paddle.com/webhooks/transactions/transaction-completed — the
// page's own example `transaction.completed` payload, read 2026-09-26 (~23:55Z).
// Its envelope and its data entity are kept field for field, with its THIRD item,
// the sample's own non-recurring price ("One-time addon", `billing_cycle: null`),
// as the one item. Substituted, each a field the page documents:
//   · `data.subscription_id` → null: "Paddle ID of the subscription that this
//     transaction is for" — a one-time purchase is for none;
//   · `items[0].price.id` → our read-back lifetime price;
//   · `data.custom_data` → our checkout's two keys ("Your own structured
//     key-value data"; routes/checkout.ts sets them).
// Fields the adapter never reads (`details`, `payments`, `checkout`, the invoice
// and address ids, `billing_period`) are left out rather than restated.
function oneTimeBody(o: {
  eventId?: string;
  occurredAt?: string;
  priceIds?: readonly string[];
  billingCycle?: null | Record<string, unknown>;
  subscriptionId?: string | null;
  userId?: string | null;
  appId?: string | null;
  transactionId?: string;
}): string {
  const custom: Record<string, string> = {};
  if (o.userId !== null) custom[PADDLE_CUSTOM_DATA_USER_ID] = o.userId ?? USER;
  if (o.appId !== null) custom[PADDLE_CUSTOM_DATA_APP_ID] = o.appId ?? APP;
  return JSON.stringify({
    event_id: o.eventId ?? nextEventId(),
    event_type: 'transaction.completed',
    occurred_at: o.occurredAt ?? '2026-09-20T10:18:50.155553Z',
    notification_id: 'ntf_01hv8x2azy7scaan4s0eb0273x',
    data: {
      id: o.transactionId ?? TXN,
      items: (o.priceIds ?? [LIFETIME_PRICE]).map((id) => ({
        price: {
          id,
          name: 'One-time addon',
          type: 'standard',
          status: 'active',
          quantity: { maximum: 1, minimum: 1 },
          tax_mode: 'account_setting',
          created_at: '2023-02-23T14:01:28.391712Z',
          product_id: 'pro_01gsz97mq9pa4fkyy0wqenepkz',
          unit_price: { amount: '19900', currency_code: 'USD' },
          updated_at: '2024-04-09T07:23:10.921392Z',
          custom_data: null,
          description: 'One-time addon',
          trial_period: null,
          billing_cycle: o.billingCycle === undefined ? null : o.billingCycle,
          unit_price_overrides: [],
          import_meta: null,
        },
        quantity: 1,
        proration: null,
      })),
      origin: 'web',
      status: 'completed',
      billed_at: '2024-04-12T10:18:48.294633Z',
      created_at: '2024-04-12T10:12:33.2014Z',
      updated_at: '2024-04-12T10:18:49.738971238Z',
      revised_at: null,
      business_id: null,
      custom_data: custom,
      customer_id: 'ctm_01hv6y1jedq4p1n0yqn5ba3ky4',
      discount_id: null,
      currency_code: 'USD',
      collection_mode: 'automatic',
      subscription_id: o.subscriptionId === undefined ? null : o.subscriptionId,
    },
  });
}

/** The subscription and adjustment shapes of test/money.test.ts (V9/V10 in paddle.ts). */
function subscriptionBody(o: { occurredAt: string; status: string; periodEnd: string | null; userId?: string | null }): string {
  const custom: Record<string, string> = {};
  if (o.userId !== null) {
    custom[PADDLE_CUSTOM_DATA_USER_ID] = o.userId ?? USER;
    custom[PADDLE_CUSTOM_DATA_APP_ID] = APP;
  }
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: 'ntf_01',
    event_type: 'subscription.updated',
    occurred_at: o.occurredAt,
    data: {
      id: 'sub_0000000000000000000000001',
      status: o.status,
      current_billing_period: o.periodEnd === null ? null : { starts_at: '2026-07-01T00:00:00.000Z', ends_at: o.periodEnd },
      items: [],
      custom_data: custom,
      customer_id: 'ctm_0000000000000000000000001',
      customer: {},
    },
  });
}

function adjustmentBody(o: { occurredAt: string; action: string; transactionId: string; subscriptionId: string | null }): string {
  return JSON.stringify({
    event_id: nextEventId(),
    notification_id: 'ntf_02',
    event_type: 'adjustment.created',
    occurred_at: o.occurredAt,
    data: {
      id: 'adj_0000000000000000000000001',
      action: o.action,
      status: 'approved',
      transaction_id: o.transactionId,
      subscription_id: o.subscriptionId,
    },
  });
}

// ── the RevenueCat shape of test/revenuecat-money.test.ts ([ADR 085], sourced in revenuecat.ts) ──
const NOW_MS = Date.parse('2026-09-26T06:00:00.000Z');
const RC_APP = 'app_rc_grant_ios';
const rcVerifier = makeRevenuecatVerifier({ [RC_APP]: APP });
function rcBody(over: Record<string, unknown> = {}): string {
  seq += 1;
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: `evt_rc_grant_${seq}`,
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: NOW_MS - 60_000 + seq,
      app_id: RC_APP,
      app_user_id: USER,
      environment: 'PRODUCTION',
      original_transaction_id: 'otx_grant_1',
      transaction_id: `tx_${seq}`,
      expiration_at_ms: NOW_MS + 30 * 86_400_000,
      period_type: 'NORMAL',
      product_id: 'pro_monthly',
      store: 'APP_STORE',
      ...over,
    },
  });
}

// ── plumbing ─────────────────────────────────────────────────────────────────
const d1 = (db: RealDb) => db as unknown as D1Database;

function routeHarness(db: RealDb = realPlatformDb()) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-rid');
    await next();
  });
  app.route('/v1/money', money);
  const env = {
    PLATFORM_DB: db,
    MONEY_CEILING_LIMITER: { limit: async () => ({ success: true }) },
    MONEY_ENVIRONMENT: 'live',
    PADDLE_NOTIFICATION_SECRET: SECRET,
  } as unknown as AppEnv['Bindings'];
  const send = async (raw: string) => {
    const ts = Math.floor(Date.now() / 1000);
    return app.fetch(
      new Request('https://x/v1/money/paddle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${await paddleSignature(SECRET, ts, raw)}` },
        body: raw,
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
  };
  return { db, send };
}

async function readPro(db: RealDb, productId: string, userId = USER) {
  const read = await readProductEntitlement(
    { db: d1(db), allRows, isMoneyEnvironment, isKnownProduct, warn: () => {}, error: () => {}, nowMs: () => NOW_MS },
    { userId, productId, environment: 'live', rid: 'test-rid' },
  );
  if (read.kind !== 'ok') throw new Error(`read answered ${read.kind}`);
  return read;
}

const entRow = (db: RealDb) => db.rows('SELECT * FROM entitlements WHERE user_id = ? AND app_id = ?', USER, APP)[0];

/** A sellable register row for the bundle tests — the committed nikatru_all@1 is `draft`. */
const SELLABLE = [
  { featureSet: 'nikatru_all', version: 1, status: 'sellable', members: [{ slug: 'subscriptiontracker' }, { slug: 'fullshot' }] },
];

function grantDeps(db: RealDb, over: Partial<GrantDeps> = {}): GrantDeps {
  return {
    db: d1(db),
    environment: 'live',
    nowMs: NOW_MS,
    isKnownProduct: isAttributableProduct,
    oneTimeOffering: oneTimeOfferingFor,
    mintFeatureSet: (fs, v) => mintFeatureSetFromRegister(d1(db), fs, v, SELLABLE),
    ...over,
  };
}

async function deliverRc(db: RealDb, raw: string, over: Partial<GrantDeps> = {}) {
  const parsed = rcVerifier.parse(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const deps = grantDeps(db, over);
  await persistNotification(deps, parsed.notification, raw);
  return grantFromVerifiedEvent(deps, parsed.notification);
}

const BUNDLE_SKUS: readonly StoreSku[] = [
  ...STORE_SKUS,
  { app: APP, productId: 'nikatru_all_monthly', kind: 'bundle', plan: 'bundle-monthly', term: 'subscription', store: 'apple-iap', featureSet: 'nikatru_all', version: 1 },
  { app: APP, productId: 'nikatru_all_play', kind: 'bundle', plan: 'bundle-yearly', term: 'one_time', store: 'play-billing', featureSet: 'nikatru_all', version: 1 },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('RC8 · a Paddle one-time purchase grants for life, through the real route and the real read', () => {
  it('the sourced transaction.completed fixture writes a row with NO end date, and the derivation honours it', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true, derived: 'applied' });
    const row = entRow(db);
    expect(row).toMatchObject({
      is_active: 1,
      expires_at: null,
      provider: 'paddle',
      provider_subscription_id: null,
      provider_transaction_id: TXN,
      provider_status: 'completed',
    });
    const read = await readPro(db, APP);
    expect(read.is_pro).toBe(true);
    expect(read.granted_via).toBe('app');
  });

  it('the checkout maps the lifetime price to a one_time offering, and a recurring price to none', () => {
    expect(oneTimeOfferingFor('paddle', LIFETIME_PRICE)).toEqual({ appId: APP, offeringId: 'pro_lifetime' });
    expect(oneTimeOfferingFor('paddle', MONTHLY_PRICE)).toBeNull();
    expect(oneTimeOfferingFor('razorpay', LIFETIME_PRICE)).toBeNull();
    expect(PADDLE_PRICE_IDS[APP]?.pro_lifetime).toBe(LIFETIME_PRICE);
    expect(Object.keys(RAIL_PRICE_PENDING[APP] ?? {})).toEqual([]);
  });

  it('a non-recurring price that sells no one_time offering grants nothing, and says so', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ priceIds: [MONTHLY_PRICE] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db)).toBeUndefined();
    const stored = db.rows('SELECT derive_error FROM provider_notifications')[0] as { derive_error: string };
    expect(stored.derive_error).toMatch(/sells no one_time offering/);
  });

  it('a transaction a subscription stands behind stays unknown — the subscription entity grants it', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ subscriptionId: 'sub_01hv8x29kz0t586xy6zn1a62ny' }));
    expect(await res.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db)).toBeUndefined();
    const stored = db.rows('SELECT derive_error FROM provider_notifications')[0] as { derive_error: string };
    expect(stored.derive_error).toMatch(/no subscription or adjustment entity/);
  });

  it('a transaction carrying a recurring price is not a one-time purchase', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ billingCycle: { interval: 'month', frequency: 1 } }));
    expect(await res.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db)).toBeUndefined();
  });

  it('a purchase of two prices is refused — 503, retried, nothing written', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ priceIds: [LIFETIME_PRICE, LIFETIME_PRICE] }));
    expect(res.status).toBe(503);
    expect(entRow(db)).toBeUndefined();
  });

  it('a purchase with no metadata is recorded unclaimed, never dropped', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ userId: null, appId: null }));
    expect(await res.json()).toMatchObject({ derived: 'unclaimed' });
    expect(db.count('unclaimed_payments')).toBe(1);
    expect(db.count('entitlements')).toBe(0);
  });

  it('a lifetime price carrying another product\'s metadata is refused, never granted to either', async () => {
    const { db, send } = routeHarness();
    const res = await send(oneTimeBody({ appId: 'fullshot' }));
    expect(res.status).toBe(503);
    expect(db.count('entitlements')).toBe(0);
    // …and no owner record is written from the mismatched metadata: on this rail
    // the first link wins forever.
    expect(db.count('provider_accounts')).toBe(0);
  });
});

describe('a lifetime is not ended by ANOTHER purchase', () => {
  it('a later subscription cancellation, and that subscription\'s refund, leave the lifetime standing; its own refund ends it', async () => {
    const { db, send } = routeHarness();
    // The person held a monthly subscription, then bought the lifetime.
    await send(subscriptionBody({ occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2026-10-01T00:00:00.000Z' }));
    expect(entRow(db)).toMatchObject({ provider_subscription_id: 'sub_0000000000000000000000001' });
    await send(oneTimeBody({ occurredAt: '2026-09-20T00:00:00.000Z' }));
    expect(entRow(db)).toMatchObject({ expires_at: null, is_active: 1, provider_transaction_id: TXN });

    const cancel = await send(subscriptionBody({ occurredAt: '2026-09-21T00:00:00.000Z', status: 'canceled', periodEnd: '2026-10-01T00:00:00.000Z' }));
    expect(await cancel.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db)).toMatchObject({ expires_at: null, is_active: 1, provider_transaction_id: TXN });

    const otherRefund = await send(
      adjustmentBody({ occurredAt: '2026-09-22T00:00:00.000Z', action: 'refund', transactionId: 'txn_0000000000000000000000009', subscriptionId: 'sub_0000000000000000000000001' }),
    );
    expect(await otherRefund.json()).toMatchObject({ derived: 'ignored' });
    expect(entRow(db)).toMatchObject({ expires_at: null, is_active: 1 });

    const ownRefund = await send(adjustmentBody({ occurredAt: '2026-09-23T00:00:00.000Z', action: 'refund', transactionId: TXN, subscriptionId: null }));
    expect(await ownRefund.json()).toMatchObject({ derived: 'applied' });
    expect(entRow(db)).toMatchObject({ is_active: 0, revocation_reason: 'refund_approved' });
  });

  it('a lifetime delivered AFTER a newer event of another purchase is refused by name, never silently stale', async () => {
    const { db, send } = routeHarness();
    await send(subscriptionBody({ occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2026-10-01T00:00:00.000Z' }));
    // Bought the lifetime on 09-20, cancelled the monthly on 09-21 — and the
    // cancellation is delivered first (Paddle does not order deliveries).
    await send(subscriptionBody({ occurredAt: '2026-09-21T00:00:00.000Z', status: 'canceled', periodEnd: '2026-10-01T00:00:00.000Z' }));
    const res = await send(oneTimeBody({ occurredAt: '2026-09-20T00:00:00.000Z' }));
    expect(res.status).toBe(503);
    expect(entRow(db)).toMatchObject({ provider_subscription_id: 'sub_0000000000000000000000001' });
    const stored = db.rows("SELECT derive_error FROM provider_notifications WHERE derive_error LIKE '%one_time_behind_newer_event%'");
    expect(stored).toHaveLength(1);
  });
});

describe('RC9 · a RevenueCat bundle SKU is a bundle grant; an app SKU keeps the single-app path', () => {
  it('a bundle SKU writes bundle_grants through upsertBundleGrant — and unlocks the bundle\'s other member', async () => {
    const db = realPlatformDb();
    const r = await deliverRc(db, rcBody({ product_id: 'nikatru_all_monthly' }), { storeSkus: BUNDLE_SKUS });
    expect(r.outcome).toBe('applied');
    expect(db.count('entitlements')).toBe(0);
    expect(db.rows('SELECT source, term, provider, feature_set_name, feature_set_version, user_id FROM bundle_grants')).toEqual([
      { source: 'revenuecat', term: 'subscription', provider: 'revenuecat', feature_set_name: 'nikatru_all', feature_set_version: 1, user_id: USER },
    ]);
    const read = await readPro(db, 'fullshot');
    expect(read.is_pro).toBe(true);
    expect(read.granted_via).toBe('bundle');
  });

  it('a Play bundle SKU matches RevenueCat\'s `<subscription>:<base plan>` form, and carries its one_time term', async () => {
    const db = realPlatformDb();
    const r = await deliverRc(db, rcBody({ product_id: 'nikatru_all_play:yearly', store: 'PLAY_STORE' }), { storeSkus: BUNDLE_SKUS });
    expect(r.outcome).toBe('applied');
    expect(db.rows('SELECT source, term FROM bundle_grants')).toEqual([{ source: 'revenuecat', term: 'one_time' }]);
  });

  it('an app SKU writes the single-app row and no bundle grant', async () => {
    const db = realPlatformDb();
    const r = await deliverRc(db, rcBody({ product_id: 'pro_monthly' }), { storeSkus: BUNDLE_SKUS });
    expect(r.outcome).toBe('applied');
    expect(db.count('bundle_grants')).toBe(0);
    expect(entRow(db)).toMatchObject({ is_active: 1, product_id: 'pro_monthly', provider: 'revenuecat' });
  });

  it('a bundle SKU whose version the register does not call sellable mints nothing and writes nothing', async () => {
    const db = realPlatformDb();
    await expect(
      deliverRc(db, rcBody({ product_id: 'nikatru_all_monthly' }), {
        storeSkus: BUNDLE_SKUS,
        mintFeatureSet: (fs, v) => mintFeatureSetFromRegister(d1(db), fs, v),
      }),
    ).rejects.toThrow(/only a `sellable` version may be minted/);
    expect(db.count('bundle_grants')).toBe(0);
    expect(db.count('feature_sets')).toBe(0);
  });

  it('storeSkuFor: an exact id under the routed app; a Play id also by its `:` form; never another app\'s', () => {
    expect(storeSkuFor(BUNDLE_SKUS, APP, 'nikatru_all_monthly')?.kind).toBe('bundle');
    expect(storeSkuFor(BUNDLE_SKUS, APP, 'nikatru_all_monthly:monthly')).toBeNull();
    expect(storeSkuFor(BUNDLE_SKUS, APP, 'nikatru_all_play:yearly')?.term).toBe('one_time');
    expect(storeSkuFor(BUNDLE_SKUS, 'fullshot', 'nikatru_all_monthly')).toBeNull();
    expect(storeSkuFor(BUNDLE_SKUS, APP, null)).toBeNull();
  });

  it('the rendered map holds app #1\'s two SKUs as `app` and no bundle SKU until owner step O-D3', () => {
    expect(STORE_SKUS.map((s) => [s.app, s.productId, s.kind, s.term])).toEqual([
      [APP, 'pro_monthly', 'app', 'subscription'],
      [APP, 'pro_yearly', 'app', 'subscription'],
    ]);
  });
});

describe('the re-point is BYTE-EQUAL on the existing fixtures', () => {
  /** Every table either path writes, with the wall-clock columns (ours, not the rail's) masked. */
  const snapshot = (db: RealDb) => {
    const mask = (rows: Record<string, unknown>[], cols: string[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))));
    return {
      entitlements: mask(db.rows('SELECT * FROM entitlements ORDER BY user_id, app_id'), ['updated_at']),
      notifications: mask(db.rows('SELECT * FROM provider_notifications ORDER BY provider_event_id'), ['received_at', 'derived_at']),
      accounts: mask(db.rows('SELECT * FROM provider_accounts ORDER BY provider_subscription_id'), ['linked_at']),
      unclaimed: mask(db.rows('SELECT * FROM unclaimed_payments ORDER BY provider_event_id'), ['received_at']),
      bundles: db.count('bundle_grants'),
    };
  };

  /** The same raw bodies, in the same order, through store.ts alone and through grant.ts. */
  async function both(bodies: readonly { provider: 'paddle' | 'revenuecat'; raw: string }[]) {
    const viaStore = realPlatformDb();
    const viaGrant = realPlatformDb();
    const outcomes: [string, string][] = [];
    for (const { provider, raw } of bodies) {
      const parsed = provider === 'paddle' ? paddleVerifier.parse(raw) : rcVerifier.parse(raw);
      if (!parsed.ok) throw new Error(parsed.reason);
      const storeDeps = { db: d1(viaStore), environment: 'live' as const, nowMs: NOW_MS, isKnownProduct: isAttributableProduct };
      await persistNotification(storeDeps, parsed.notification, raw);
      const a = await deriveAndApply(storeDeps, parsed.notification);
      const gDeps = grantDeps(viaGrant);
      await persistNotification(gDeps, parsed.notification, raw);
      const b = await grantFromVerifiedEvent(gDeps, parsed.notification);
      outcomes.push([a.outcome, b.outcome]);
    }
    return { outcomes, a: snapshot(viaStore), b: snapshot(viaGrant) };
  }

  it('Paddle: a grant, a cancel, a refund, a payment nobody can be found for', async () => {
    const { outcomes, a, b } = await both([
      { provider: 'paddle', raw: subscriptionBody({ occurredAt: '2026-09-01T00:00:00.000Z', status: 'active', periodEnd: '2026-10-01T00:00:00.000Z' }) },
      { provider: 'paddle', raw: subscriptionBody({ occurredAt: '2026-09-02T00:00:00.000Z', status: 'canceled', periodEnd: '2026-10-01T00:00:00.000Z' }) },
      { provider: 'paddle', raw: adjustmentBody({ occurredAt: '2026-09-03T00:00:00.000Z', action: 'refund', transactionId: 'txn_0000000000000000000000001', subscriptionId: 'sub_0000000000000000000000001' }) },
      { provider: 'paddle', raw: adjustmentBody({ occurredAt: '2026-09-04T00:00:00.000Z', action: 'refund', transactionId: 'txn_0000000000000000000000002', subscriptionId: null }) },
    ]);
    expect(outcomes.map(([x]) => x)).toEqual(['applied', 'applied', 'applied', 'unclaimed']);
    expect(outcomes.every(([x, y]) => x === y)).toBe(true);
    expect(b).toEqual(a);
    expect(a.entitlements).toHaveLength(1);
  });

  it('RevenueCat: an app SKU, a SKU no map holds, a cancellation, an expiration', async () => {
    const { outcomes, a, b } = await both([
      { provider: 'revenuecat', raw: rcBody({ product_id: 'pro_monthly' }) },
      { provider: 'revenuecat', raw: rcBody({ product_id: 'some_unlisted_sku' }) },
      { provider: 'revenuecat', raw: rcBody({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', product_id: 'pro_monthly' }) },
      { provider: 'revenuecat', raw: rcBody({ type: 'EXPIRATION', expiration_reason: 'UNSUBSCRIBE', expiration_at_ms: NOW_MS - 1000, product_id: 'pro_monthly' }) },
    ]);
    expect(outcomes.every(([x, y]) => x === y)).toBe(true);
    expect(b).toEqual(a);
    expect(a.bundles).toBe(0);
    expect(a.entitlements).toHaveLength(1);
  });

  it('the route answers through grant.ts: the money door\'s deps carry both maps', () => {
    const deps = grantDepsFor(d1(realPlatformDb()), 'live', NOW_MS);
    expect(deps.oneTimeOffering).toBe(oneTimeOfferingFor);
    expect(typeof deps.mintFeatureSet).toBe('function');
    expect(deps.isKnownProduct).toBe(isAttributableProduct);
  });
});
