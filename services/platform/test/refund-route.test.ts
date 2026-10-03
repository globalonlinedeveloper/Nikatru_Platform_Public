// ─────────────────────────────────────────────────────────────────────────────
// refund-route.test.ts — POST /v1/plan/refund, the in-window refund refund.html
// promises (refund-finish, MF-5), over the real-SQL harness.
//
// The red controls of the brief, each a case below:
//   · a request one day past the window is refused, and nothing is recorded;
//   · a replay refunds ONCE (the same Idempotency-Key, and a second key for the
//     same charge, both answer the first record; the rail is asked once);
//   · a rail that declares `refund` carries it out through the port (the fake
//     rail, the conformance suite's own); a rail without `refund` gets the
//     manual route, never a 500 — and makes no network call;
//   · a store purchase is sent to the store's own refund page;
//   · the window is the PAGE's: refund.html is read, and its "within 30 days of
//     the charge" must equal REFUND_WINDOW_DAYS.
// ─────────────────────────────────────────────────────────────────────────────
// The PUBLISHED page, as a string (vite `?raw`, like the migrations in harness.ts).
import refundHtml from '../../../sites/nikatru/refund.html?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import type { RailOutbound } from '../../_shared/src/ports/payments';

// The composition root, with ONE change: provider `fake` binds to a fresh fake rail
// (the registry lists it for `test` only, so a deployed Worker can never reach it).
let fakeRail: RailOutbound;
let refundCalls = 0;
vi.mock('../src/ports', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ports')>();
  return {
    ...real,
    railFor: (provider: string | null, env: AppEnv['Bindings']) => (provider === 'fake' ? fakeRail : real.railFor(provider, env)),
  };
});
const { default: refund } = await import('../src/routes/refund');
const { REFUND_WINDOW_DAYS, withinRefundWindow } = await import('../src/lib/mor/refund');

const APP = 'subscriptiontracker';
const USER = 'u-refund';
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let netCalls: string[] = [];
beforeEach(() => {
  netCalls = [];
  refundCalls = 0;
  const base = makeFakeRail(() => true);
  fakeRail = {
    ...base,
    refund: async (req) => {
      refundCalls++;
      return base.refund!(req);
    },
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    netCalls.push(String(input));
    throw new Error(`unexpected fetch in test: ${String(input)}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

function seed(db: RealDb, o: { provider: string; txn: string; chargedMsAgo: number | null; store?: string | null; env?: string }) {
  db.db
    .prepare(
      `INSERT INTO entitlements (user_id, app_id, entitlement, is_active, expires_at, updated_at, provider, provider_environment, provider_status, provider_transaction_id, occurred_at, store)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(USER, APP, 'pro', 1, iso(-10 * DAY), iso(0), o.provider, o.env ?? 'live', 'active', o.txn, iso(DAY), o.store ?? null);
  if (o.chargedMsAgo !== null) {
    db.db
      .prepare('INSERT INTO provider_notifications (provider, provider_event_id, occurred_at, environment, received_at, payload) VALUES (?,?,?,?,?,?)')
      .run(o.provider, `evt-${o.txn}`, iso(o.chargedMsAgo), o.env ?? 'live', iso(o.chargedMsAgo), JSON.stringify({ data: { id: o.txn, status: 'completed' } }));
  }
}

async function post(db: RealDb, key: string | null, env: Record<string, unknown> = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', USER);
    c.set('requestId', 'rid-refund');
    await next();
  });
  app.route('/v1', refund);
  const res = await app.request(
    'http://x/v1/plan/refund',
    { method: 'POST', headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'Idempotency-Key': key }) }, body: JSON.stringify({ app_id: APP }) },
    { PLATFORM_DB: db, MONEY_ENVIRONMENT: 'live', PADDLE_API_KEY: `pdl_live_apikey_${'x'.repeat(24)}`, ...env } as unknown as AppEnv['Bindings'],
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('the window is the published page’s', () => {
  it('🔴 refund.html says "within N days of the charge" and N is REFUND_WINDOW_DAYS', () => {
    const page = refundHtml.replace(/<[^>]+>/g, '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ');
    const windows = [...page.matchAll(/within (\d+) days of the charge/g)].map((m) => Number(m[1]));
    expect(windows.length).toBeGreaterThanOrEqual(2); // section 2 (Paddle) and section 3 (Razorpay)
    for (const n of windows) expect(n).toBe(REFUND_WINDOW_DAYS);
  });

  it('inside on the last day, outside one millisecond later; a request before the charge is not inside', () => {
    const charged = '2026-09-01T00:00:00.000Z';
    expect(withinRefundWindow(charged, '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(withinRefundWindow(charged, '2026-10-01T00:00:00.001Z')).toBe(false);
    expect(withinRefundWindow(charged, '2026-08-31T23:59:59.000Z')).toBe(false);
    expect(withinRefundWindow('not a date', '2026-09-02T00:00:00.000Z')).toBe(false);
  });
});

describe('POST /v1/plan/refund', () => {
  it('🔴 one day past the window is refused, and nothing is recorded or sent', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_7', chargedMsAgo: (REFUND_WINDOW_DAYS + 1) * DAY });
    const r = await post(db, 'key-past-window-1');
    expect(r).toMatchObject({ status: 403, json: { error: 'outside_refund_window' } });
    expect(db.count('refund_requests')).toBe(0);
    expect(refundCalls).toBe(0);
  });

  it('a rail that declares refund carries it out through the port: 200, executed, the refund reference', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_7', chargedMsAgo: 2 * DAY });
    const r = await post(db, 'key-fake-refund-1');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ recorded: true, executed: true });
    expect(String(r.json.refund_ref)).toMatch(/^fake_rfd_/);
    expect(refundCalls).toBe(1);
    expect(db.rows('SELECT provider, purchase_ref, executed_at IS NOT NULL AS done, not_executed_reason FROM refund_requests')[0]).toMatchObject({
      provider: 'fake',
      purchase_ref: 'fake_txn_7',
      done: 1,
      not_executed_reason: null,
    });
  });

  it('🔴 a replay refunds ONCE: the same key and a new key for the same charge both answer the first record', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_9', chargedMsAgo: DAY });
    const first = await post(db, 'key-replay-aaaa');
    const again = await post(db, 'key-replay-aaaa');
    const other = await post(db, 'key-replay-bbbb');
    expect(again.json).toEqual(first.json);
    expect(other.json).toEqual(first.json);
    expect(refundCalls).toBe(1);
    expect(db.count('refund_requests')).toBe(1);
  });

  it('🔴 a rail WITHOUT refund (Paddle today) gets the manual route, never a 500, and no network call', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'paddle', txn: 'txn_01hpaddle', chargedMsAgo: 3 * DAY });
    const r = await post(db, 'key-paddle-0001');
    expect(r).toMatchObject({ status: 202, json: { recorded: true, executed: false, route: 'manual', reason: 'rail_has_no_refund' } });
    expect(netCalls).toEqual([]);
    expect(db.rows('SELECT not_executed_reason, charged_at FROM refund_requests')[0]?.not_executed_reason).toBe('rail_has_no_refund');
  });

  it('no stored notification names the charge: recorded for a human, never refunded on a guess', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_3', chargedMsAgo: null });
    const r = await post(db, 'key-unknown-charge');
    expect(r).toMatchObject({ status: 202, json: { executed: false, reason: 'charge_time_unknown' } });
    expect(refundCalls).toBe(0);
  });

  it('a store purchase is the store’s to refund: 409 with the page refund.html names, nothing recorded', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'revenuecat', txn: 'GPA.1234', chargedMsAgo: DAY, store: 'APP_STORE' });
    const r = await post(db, 'key-store-apple1');
    expect(r).toMatchObject({ status: 409, json: { route: 'store', refund_at: 'app_store', refund_url: 'https://reportaproblem.apple.com' } });
    expect(db.count('refund_requests')).toBe(0);
  });

  it('refuses without an Idempotency-Key, and with an unconfigured money world', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_1', chargedMsAgo: DAY });
    expect((await post(db, null)).status).toBe(400);
    expect((await post(db, 'short')).status).toBe(400);
    expect((await post(db, 'key-no-money-env', { MONEY_ENVIRONMENT: undefined })).status).toBe(503);
    expect(refundCalls).toBe(0);
  });

  it('a sandbox-world row is not this live deploy’s purchase: 404', async () => {
    const db = realPlatformDb();
    seed(db, { provider: 'fake', txn: 'fake_txn_2', chargedMsAgo: DAY, env: 'sandbox' });
    expect((await post(db, 'key-sandbox-row1')).status).toBe(404);
  });
});
