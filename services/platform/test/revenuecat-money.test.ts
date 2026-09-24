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

// ⏱ 2026-09-24 · F912 (the #912 review, finding 5). This describe was titled "the
// shipped verifier refuses on A, loudly", and it stayed green only because its
// fixture app id is one no app declares: the shipped verifier routes both declared
// subscriptiontracker ids since #890. The case is unchanged; the title now says
// what it measures, and the describe after it drives the declared ids.
describe('RevenueCat through the route — an undeclared app id is refused on A, loudly', () => {
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

/** POST a genuinely signed body to the REAL route, which takes its verifier from
 *  the REAL registry (routes/money.ts → verifierFor): the shape of the case above. */
async function throughRoute(db: RealDb, raw: string) {
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
  const t = Math.floor(Date.now() / 1000);
  return app.fetch(
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
}

// ⏱ 2026-09-24 · F912 (the #912 review, findings 1 and 5, and M2). No case drove a
// DECLARED app id through the route, so a registry serving another instance than
// the one the verifier tests import would have passed. These do, on the registered
// verifier and its rendered app-id table (apps/subscriptiontracker/app.yaml).
describe('RevenueCat through the route — the registered verifier on the declared ids', () => {
  it('a declared App Store id (app805d73cd44) INITIAL_PURCHASE is 200 applied and writes one entitlement', async () => {
    const db = realPlatformDb();
    const res = await throughRoute(db, rcBody({ app_id: 'app805d73cd44' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true, derived: 'applied' });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(1);
    const row = await d1(db)
      .prepare('SELECT is_active, provider FROM entitlements WHERE user_id = ? AND app_id = ?')
      .bind(USER, 'subscriptiontracker')
      .first<{ is_active: number; provider: string }>();
    expect(row).toEqual({ is_active: 1, provider: 'revenuecat' });
  });

  it('M2 · EXPERIMENT_ENROLLMENT with NO app_id is 200 ignored: no entitlement, no refusal counted', async () => {
    const db = realPlatformDb();
    const res = await throughRoute(db, rcBody({ type: 'EXPERIMENT_ENROLLMENT', app_id: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: true, derived: 'ignored' });
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE derive_error LIKE 'refused:%'")).toBe(0);
    expect(
      await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE derive_error LIKE 'ignored:%acknowledged before routing%'"),
    ).toBe(1);
  });
});

// ── ⏱ 2026-09-22 · [ADR 092] §4.3, §4.4, §4.6 · ownership through the store ────
// A TRANSFER writes no entitlement and moves no link; the NEXT newer lifecycle
// event naming the new owner moves the link, and only when the current owner
// holds no live RevenueCat row on that purchase. Times are explicit here, on the
// provider's clock, because ordering is the whole subject.
const FROM_USER = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c';
const DAY = 86_400_000;
const T_BUY = NOW_MS - 10 * DAY;
const T_LAPSE = NOW_MS - 5 * DAY;
const T_TRANSFER = NOW_MS - DAY;
const T_REBUY = NOW_MS - 60_000;

function rcTransferBody(over: Record<string, unknown> = {}): string {
  seq += 1;
  return JSON.stringify({
    api_version: '1.0',
    event: {
      id: `evt_rc_transfer_${seq}`,
      type: 'TRANSFER',
      event_timestamp_ms: T_TRANSFER,
      app_id: RC_APP,
      environment: 'PRODUCTION',
      store: 'PLAY_STORE',
      transferred_from: [FROM_USER],
      transferred_to: [USER],
      ...over,
    },
  });
}

const d1 = (db: RealDb) => db as unknown as D1Database;
const linkOwner = async (db: RealDb) =>
  (await d1(db)
    .prepare("SELECT user_id FROM provider_accounts WHERE provider = 'revenuecat' AND provider_subscription_id = 'otx_money_1'")
    .first<{ user_id: string }>())?.user_id ?? null;
const activeFor = async (db: RealDb, userId: string) =>
  (await d1(db)
    .prepare('SELECT is_active FROM entitlements WHERE user_id = ? AND app_id = ?')
    .bind(userId, 'subscriptiontracker')
    .first<{ is_active: number }>())?.is_active ?? null;

/** FROM_USER bought, then the purchase lapsed: no live row is left on it. */
async function boughtThenLapsed(db: RealDb) {
  await deliver(db, rcBody({ app_user_id: FROM_USER, event_timestamp_ms: T_BUY }));
  await deliver(db, rcBody({ app_user_id: FROM_USER, type: 'EXPIRATION', event_timestamp_ms: T_LAPSE, expiration_at_ms: T_LAPSE - 1000 }));
  expect(await activeFor(db, FROM_USER)).toBe(0);
}

describe('RevenueCat TRANSFER through the store — an ownership fact, never a grant', () => {
  it('writes no entitlement and no link, and the notification names the DESTINATION', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcTransferBody());
    expect(r.outcome).toBe('ignored');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM provider_accounts')).toBe(0);
    const n = await d1(db)
      .prepare("SELECT user_id, derive_error FROM provider_notifications WHERE provider = 'revenuecat' AND payload LIKE '%\"TRANSFER\"%'")
      .first<{ user_id: string | null; derive_error: string | null }>();
    // Derived, attributed to the destination, and NOT counted as a refusal.
    expect(n?.user_id).toBe(USER);
    expect(n?.derive_error).toMatch(/^ignored: revenuecat TRANSFER concluded for subscriptiontracker: /);
  });

  it('a source that still holds a LIVE RevenueCat row is REFUSED as transfer_from_live_owner', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody({ app_user_id: FROM_USER, event_timestamp_ms: T_BUY }));
    const r = await deliver(db, rcTransferBody());
    expect(r.outcome).toBe('refused');
    expect(r.outcome === 'refused' && r.detail).toMatch(/^transfer_from_live_owner:/);
    expect(await activeFor(db, FROM_USER)).toBe(1);
    expect(await activeFor(db, USER)).toBeNull();
  });

  it('the tripwire reads RevenueCat rows only: a live Paddle row on the source does not trip it', async () => {
    const db = realPlatformDb();
    await d1(db)
      .prepare(
        `INSERT INTO entitlements (user_id, app_id, entitlement, is_active, expires_at, provider, provider_subscription_id)
         VALUES (?, 'subscriptiontracker', 'pro', 1, NULL, 'paddle', 'sub_paddle_1')`,
      )
      .bind(FROM_USER)
      .run();
    expect((await deliver(db, rcTransferBody())).outcome).toBe('ignored');
  });

  it('TEMPORARY_ENTITLEMENT_GRANT writes nothing (ADR 092 §4.6)', async () => {
    const db = realPlatformDb();
    const r = await deliver(db, rcBody({ type: 'TEMPORARY_ENTITLEMENT_GRANT', environment: undefined }));
    expect(r.outcome).toBe('ignored');
    expect(await count(db, 'SELECT COUNT(*) AS n FROM entitlements')).toBe(0);
  });

  it('REFUND_REVERSED is refused by name and writes nothing (ADR 092 §4.6)', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody({ event_timestamp_ms: T_BUY }));
    const r = await deliver(db, rcBody({ type: 'REFUND_REVERSED', store: 'APP_STORE', event_timestamp_ms: T_REBUY }));
    expect(r.outcome).toBe('refused');
    expect(await count(db, "SELECT COUNT(*) AS n FROM provider_notifications WHERE derive_error LIKE 'refused:%refund_reversed_undecided:%'")).toBe(1);
    // …and the purchase it names keeps its access: a refusal is never a suspension.
    expect(await activeFor(db, USER)).toBe(1);
  });
});

describe('RevenueCat link — the ONE provider whose purchase can change owner (ADR 092 §4.4)', () => {
  it('lapsed, transferred, re-bought: the newer event MOVES the link and the new owner has access', async () => {
    const db = realPlatformDb();
    await boughtThenLapsed(db);
    await deliver(db, rcTransferBody());
    const r = await deliver(db, rcBody({ type: 'RENEWAL', event_timestamp_ms: T_REBUY }));
    expect(r.outcome).toBe('applied');
    expect(await linkOwner(db)).toBe(USER);
    expect(await activeFor(db, USER)).toBe(1);
    expect(await activeFor(db, FROM_USER)).toBe(0);
  });

  it('while the current owner is LIVE, a newer event naming another account is REFUSED and moves nothing', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody({ app_user_id: FROM_USER, event_timestamp_ms: T_BUY }));
    const r = await deliver(db, rcBody({ type: 'RENEWAL', event_timestamp_ms: T_REBUY }));
    expect(r.outcome).toBe('refused');
    expect(r.outcome === 'refused' && r.detail).toMatch(/^owner_change_on_live_subscription:/);
    expect(await linkOwner(db)).toBe(FROM_USER);
    expect(await activeFor(db, USER)).toBeNull();
  });

  it('a LATE, OLDER event for the old owner does not move the link back and does not revoke the new owner', async () => {
    const db = realPlatformDb();
    await boughtThenLapsed(db);
    await deliver(db, rcBody({ type: 'RENEWAL', event_timestamp_ms: T_REBUY }));
    const late = await deliver(
      db,
      rcBody({ app_user_id: FROM_USER, type: 'EXPIRATION', event_timestamp_ms: T_LAPSE + 1, expiration_at_ms: T_LAPSE - 1000 }),
    );
    expect(late.outcome).toBe('stale');
    expect(await linkOwner(db)).toBe(USER);
    expect(await activeFor(db, USER)).toBe(1);
  });
});

describe('E1 · the store product id and the store survive onto the entitlement', () => {
  it('a RevenueCat purchase records product_id and store, and a later event without them keeps them', async () => {
    const db = realPlatformDb();
    await deliver(db, rcBody({ product_id: 'st_pro_monthly', store: 'PLAY_STORE', event_timestamp_ms: T_BUY }));
    await deliver(db, rcBody({ type: 'RENEWAL', event_timestamp_ms: T_REBUY }));
    const row = await d1(db)
      .prepare('SELECT product_id, store FROM entitlements WHERE user_id = ?')
      .bind(USER)
      .first<{ product_id: string | null; store: string | null }>();
    expect(row).toEqual({ product_id: 'st_pro_monthly', store: 'PLAY_STORE' });
  });
});
