// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · fix-india-rail-tax-data · THE INDIA RAIL'S RED TESTS, through the REAL door.
//
// POST /v1/money/razorpay (routes/money.ts) over the real-SQL harness, with Razorpay-shaped signed
// bodies (test/razorpay-fixtures.ts — the docs' published payload examples, UNCONFIRMED until the
// first delivered test-mode event). Each 🔴 below has a recorded mutation of the REAL source:
//   (a) razorpay.ts `verify` skipping the digest compare → "a bad signature is refused" reddens;
//   (b) razorpay.ts mapping `refund.processed` to `unknown` → "a refund revokes" reddens.
// Plus the outbound rail (razorpay-rail.ts): a missing key fails closed, the vendor answer is
// validated, a timeout is `timeout`, a repeated cancel is the same receipt.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import money from '../src/routes/money';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';
import { razorpayVerifier } from '../src/lib/mor/razorpay';
import {
  RAZORPAY_KEY_ID_PREFIX,
  RAZORPAY_KEY_ID_VAR,
  RAZORPAY_KEY_SECRET_VAR,
  RAZORPAY_CHECKOUT_HOSTS,
  makeRazorpayRail,
  razorpayCheckoutUrl,
  razorpayRail,
} from '../src/lib/mor/razorpay-rail';
import type { EventSpec } from '../../_shared/test/conformance/payments';
import paymentsRegistry from '../../../tooling/ports/payments.json';
import { FIXTURE_KEYS, FIXTURE_PLAN, SECRET, planFor, razorpayBody, razorpayWire, unix } from './razorpay-fixtures';

const USER = 'user-rzp';
const APP = 'subscriptiontracker';
const SUB = 'sub_doorRZP01';
const FUTURE = '2027-01-01T00:00:00.000Z';
const PAST = '2026-08-01T00:00:00.000Z';
const at = (minute: number) => new Date(Date.parse('2026-09-30T00:00:00.000Z') + minute * 60_000).toISOString();

function door(db: RealDb = realPlatformDb()) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-rzp');
    await next();
  });
  app.route('/v1/money', money);
  const env = { PLATFORM_DB: db, MONEY_ENVIRONMENT: 'live', RAZORPAY_WEBHOOK_SECRET: SECRET } as unknown as AppEnv['Bindings'];
  const send = async (spec: EventSpec, o?: { badSignature?: boolean }) => {
    const w = await razorpayWire(spec, o);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    w.headers.forEach((v, k) => { headers[k] = v; });
    return app.fetch(new Request('https://x/v1/money/razorpay', { method: 'POST', headers, body: w.raw }), env, {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext);
  };
  const row = () => db.rows('SELECT is_active, revocation_reason, current_period_end FROM entitlements WHERE user_id = ? AND app_id = ?', USER, APP)[0] as
    | { is_active: number; revocation_reason: string | null; current_period_end: string | null }
    | undefined;
  return { db, send, row };
}

const sub = (eventId: string, occurredAt: string, o: Partial<Extract<EventSpec, { kind: 'subscription' }>> = {}): EventSpec => ({
  kind: 'subscription', eventId, occurredAt, status: 'active', subscriptionId: SUB, periodEnd: FUTURE, trialEnd: null, userId: USER, appId: APP, environment: 'live', ...o,
});
const adj = (eventId: string, occurredAt: string, action: 'refund' | 'dispute' | 'restore'): EventSpec => ({
  kind: 'adjustment', eventId, occurredAt, action, subscriptionId: SUB, environment: 'live',
});

describe('the Razorpay webhook door — red tests through routes/money.ts', () => {
  it('🔴 a bad signature is refused (401) and NOTHING is stored', async () => {
    const d = door();
    const res = await d.send(sub('evt_rzp_bad', at(1)), { badSignature: true });
    expect(res.status).toBe(401);
    expect(d.db.count('provider_notifications')).toBe(0);
    expect(d.row()).toBeUndefined();
  });

  it('green control: the same body correctly signed grants', async () => {
    const d = door();
    const res = await d.send(sub('evt_rzp_good', at(1)));
    expect(res.status).toBe(200);
    expect(d.row()?.is_active).toBe(1);
  });

  it('🔴 a replayed webhook (same signed body, same event id) is idempotent: stored once, acked as a duplicate', async () => {
    const d = door();
    const spec = sub('evt_rzp_replay', at(1));
    const first = await d.send(spec);
    const again = await d.send(spec);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(d.db.count('provider_notifications')).toBe(1);
    expect(d.row()?.is_active).toBe(1);
  });

  it('🔴 a refund revokes: refund.processed ends access now, as refund_approved', async () => {
    const d = door();
    expect((await d.send(sub('evt_rzp_r1', at(1)))).status).toBe(200);
    const res = await d.send(adj('evt_rzp_r2', at(2), 'refund'));
    expect(res.status).toBe(200);
    expect(d.row()).toMatchObject({ is_active: 0, revocation_reason: 'refund_approved' });
  });

  // ⏱ 2026-10-02 · PR #1149 ruling item 2 (option b). Red control, run on the REAL source: removing the
  // `linkPayment` call in store.ts applySubscription leaves the refund unclaimed and this test red.
  it('🔴 a refund whose payment entity names NO subscription still revokes, by the payment → subscription link written at subscription.charged', async () => {
    const d = door();
    expect((await d.send(sub('evt_rzp_l1', at(1)))).status).toBe(200);
    const links = d.db.rows('SELECT provider_payment_id, provider_subscription_id, user_id, environment FROM provider_payment_links');
    expect(links).toEqual([{ provider_payment_id: 'pay_conformance1', provider_subscription_id: SUB, user_id: USER, environment: 'live' }]);
    const refund = adj('evt_rzp_l2', at(2), 'refund');
    const body = JSON.parse(razorpayBody(refund)) as { payload: { payment: { entity: Record<string, unknown> }; subscription?: unknown } };
    // The body itself cannot name the subscription: no subscription entity, no subscription_id, no notes.
    expect(body.payload.subscription).toBeUndefined();
    expect(body.payload.payment.entity).not.toHaveProperty('subscription_id');
    expect(body.payload.payment.entity.notes).toEqual([]);
    const parsed = razorpayVerifier.parse(razorpayBody(refund), 'evt_rzp_l2');
    expect(parsed.ok && parsed.notification.subject).toMatchObject({ kind: 'adjustment', subscriptionId: null, transactionId: 'pay_conformance1' });
    const res = await d.send(refund);
    expect(res.status).toBe(200);
    expect(d.row()).toMatchObject({ is_active: 0, revocation_reason: 'refund_approved' });
  });

  it('a refund of a payment no charge linked changes no access (stored unclaimed, never a guess)', async () => {
    const d = door();
    // A trial (subscription.authenticated) names no payment, so no link is written.
    expect((await d.send(sub('evt_rzp_n1', at(1), { status: 'trialing', trialEnd: FUTURE }))).status).toBe(200);
    expect(d.db.count('provider_payment_links')).toBe(0);
    expect((await d.send(adj('evt_rzp_n2', at(2), 'refund'))).status).toBe(200);
    expect(d.row()?.is_active).toBe(1);
    expect(d.db.count('unclaimed_payments')).toBe(1);
  });

  it('🔴 a dispute holds: payment.dispute.created revokes as chargeback, and a won dispute restores', async () => {
    const d = door();
    await d.send(sub('evt_rzp_d1', at(1)));
    expect((await d.send(adj('evt_rzp_d2', at(2), 'dispute'))).status).toBe(200);
    expect(d.row()).toMatchObject({ is_active: 0, revocation_reason: 'chargeback' });
    expect((await d.send(adj('evt_rzp_d3', at(3), 'restore'))).status).toBe(200);
    expect(d.row()?.is_active).toBe(1);
  });

  it('🔴 a cancel ends at the period end: the paid period is kept, then access ends as cancelled_at_period_end', async () => {
    const d = door();
    await d.send(sub('evt_rzp_c1', at(1)));
    expect((await d.send(sub('evt_rzp_c2', at(2), { status: 'canceled' }))).status).toBe(200);
    expect(d.row()?.is_active).toBe(1); // still inside the paid period
    expect((await d.send(sub('evt_rzp_c3', at(3), { status: 'canceled', periodEnd: PAST }))).status).toBe(200);
    expect(d.row()).toMatchObject({ is_active: 0, revocation_reason: 'cancelled_at_period_end' });
  });

  it('a body of the OTHER money world (notes.env) is refused, never granted', async () => {
    const d = door();
    const res = await d.send(sub('evt_rzp_world', at(1), { environment: 'sandbox' }));
    expect(res.status).not.toBe(200);
    expect(d.row()).toBeUndefined();
  });

  it('a delivery with no x-razorpay-event-id is refused 400 before anything is stored', async () => {
    const d = door();
    const w = await razorpayWire(sub('evt_ignored', at(1)));
    const app = new Hono<AppEnv>();
    app.route('/v1/money', money);
    const env = { PLATFORM_DB: d.db, MONEY_ENVIRONMENT: 'live', RAZORPAY_WEBHOOK_SECRET: SECRET } as unknown as AppEnv['Bindings'];
    const res = await app.fetch(
      new Request('https://x/v1/money/razorpay', { method: 'POST', headers: { 'x-razorpay-signature': w.headers.get('x-razorpay-signature') ?? '' }, body: w.raw }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(400);
    expect(d.db.count('provider_notifications')).toBe(0);
  });
});

describe('razorpay parse — the mapping, case by case', () => {
  const envelope = (event: string, payload: Record<string, unknown>) => JSON.stringify({ entity: 'event', account_id: 'acc_1', event, contains: Object.keys(payload), payload, created_at: unix(at(1)) });
  const subEntity = (o: Record<string, unknown>) => ({ subscription: { entity: { id: SUB, entity: 'subscription', current_end: unix(FUTURE), notes: { user_id: USER, app_id: APP }, ...o } } });
  const subject = (raw: string) => {
    const p = razorpayVerifier.parse(raw, 'evt_case');
    if (!p.ok) throw new Error(p.reason);
    return p.notification.subject;
  };

  it('halted → suspended, payment_failed_final; paused → suspended, subscription_paused', () => {
    expect(subject(envelope('subscription.halted', subEntity({ status: 'halted' })))).toMatchObject({ access: 'suspended', endsWithReason: 'payment_failed_final' });
    expect(subject(envelope('subscription.paused', subEntity({ status: 'paused' })))).toMatchObject({ access: 'suspended', endsWithReason: 'subscription_paused' });
  });

  it('access is read from the ENTITY status, not the event name; an unmapped status is refused', () => {
    expect(subject(envelope('subscription.some_future_event', subEntity({ status: 'active' })))).toMatchObject({ access: 'granted' });
    expect(razorpayVerifier.parse(envelope('subscription.charged', subEntity({ status: 'mystery' })), 'evt_case').ok).toBe(false);
  });

  it('an active subscription with no current_end is REFUSED (a null end would read as lifetime)', () => {
    expect(razorpayVerifier.parse(envelope('subscription.activated', subEntity({ status: 'active', current_end: null })), 'evt_case').ok).toBe(false);
  });

  it('authenticated with no future start_at changes no access (unknown); with one it is trialing to start_at', () => {
    expect(subject(envelope('subscription.authenticated', subEntity({ status: 'authenticated', start_at: unix(at(0)) })))).toMatchObject({ kind: 'unknown' });
    expect(subject(envelope('subscription.authenticated', subEntity({ status: 'authenticated', current_end: null, start_at: unix(FUTURE) })))).toMatchObject({
      access: 'trialing', trialEnd: FUTURE, currentPeriodEnd: FUTURE,
    });
  });

  it('no notes → unlinked (accountUserId null); an unreadable notes.env is refused', () => {
    expect(subject(envelope('subscription.charged', subEntity({ status: 'active', notes: [] })))).toMatchObject({ accountUserId: null, railEnvironment: null });
    expect(razorpayVerifier.parse(envelope('subscription.charged', subEntity({ status: 'active', notes: { env: 'staging' } })), 'evt_case').ok).toBe(false);
  });

  it('unknown events, refund.created and an open-ended dispute.closed are `unknown`, never a crash', () => {
    expect(subject(envelope('order.paid', { order: { entity: { id: 'order_1' } } }))).toMatchObject({ kind: 'unknown' });
    expect(subject(envelope('refund.created', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', status: 'pending' } } }))).toMatchObject({ kind: 'unknown' });
    expect(subject(envelope('payment.dispute.closed', { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', status: 'closed' } } }))).toMatchObject({ kind: 'unknown' });
  });

  it('a dispute closed in our favour restores; a refund with no linkable subscription is stored unlinked (subscriptionId null)', () => {
    expect(subject(envelope('payment.dispute.closed', { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', status: 'won' } } }))).toMatchObject({ reason: 'chargeback_reversed', restores: true });
    expect(subject(envelope('refund.processed', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', status: 'processed' } }, payment: { entity: { id: 'pay_1', invoice_id: 'inv_1', notes: [] } } }))).toMatchObject({
      kind: 'adjustment', subscriptionId: null, transactionId: 'pay_1', reason: 'refund_approved', effective: true,
    });
  });

  it('occurredAt is the signed created_at, and the event id is the hint', () => {
    const raw = razorpayBody(sub('ignored', at(7)));
    const p = razorpayVerifier.parse(raw, 'evt_hint');
    expect(p.ok && p.notification.occurredAt).toBe(at(7));
    expect(p.ok && p.notification.eventId).toBe('evt_hint');
  });
});

describe('razorpayRail — outbound, fail closed', () => {
  afterEach(() => vi.unstubAllGlobals());
  const REQ = { appId: APP, offeringId: 'pro_monthly', userId: USER, market: 'IN', environment: 'live' as const };
  const counting = () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      throw new Error('no network in this test');
    });
    return calls;
  };

  it('🔴 a missing key fails closed: unavailable, nothing sent, no fetch', async () => {
    const calls = counting();
    for (const secrets of [() => undefined, (n: string) => (n === RAZORPAY_KEY_ID_VAR ? FIXTURE_KEYS[n] : undefined)]) {
      const rail = makeRazorpayRail(secrets, { planFor });
      const out = await rail.createCheckout!(REQ);
      expect(out).toMatchObject({ ok: false, kind: 'unavailable', sent: false });
      const c = await rail.cancel!({ subscriptionRef: 'sub_abc123', when: 'period_end', environment: 'live' });
      expect(c).toMatchObject({ ok: false, kind: 'unavailable', sent: false });
    }
    expect(calls).toHaveLength(0);
  });

  it('a key of the other money world is refused before anything is sent', async () => {
    const calls = counting();
    const rail = makeRazorpayRail((n) => (n === RAZORPAY_KEY_ID_VAR ? `${RAZORPAY_KEY_ID_PREFIX.sandbox}${'k'.repeat(14)}` : FIXTURE_KEYS[n]), { planFor });
    expect(await rail.createCheckout!(REQ)).toMatchObject({ ok: false, kind: 'unavailable', sent: false });
    expect(calls).toHaveLength(0);
  });

  it('the production factory sells only what RAIL_PRICE_IDS.razorpay prices: an unpriced offering is invalid, nothing sent', async () => {
    const calls = counting();
    const out = await razorpayRail((n) => FIXTURE_KEYS[n]).createCheckout!({ ...REQ, offeringId: 'not_sold_here' });
    expect(out).toMatchObject({ ok: false, kind: 'invalid', sent: false });
    expect(calls).toHaveLength(0);
  });

  // ⏱ 2026-10-02 · PR #1149 ruling item 3 (design.md §1.6): the checkout URL is OUR apex page, never the
  // vendor's hosted short_url — whatever short_url Razorpay answers, on whatever host, is not returned.
  it('creates a subscription with our notes and Basic auth, returns OUR apex checkout URL (never short_url), and refuses an answer without our notes or a sub_ id', async () => {
    let answer: (sent: { notes: Record<string, string> }) => unknown = (sent) => ({ id: 'sub_new1', status: 'created', notes: sent.notes, short_url: 'https://rzp.io/i/abc' });
    const seen: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { notes: Record<string, string> };
      seen.push({ url: String(input), auth: String((init?.headers as Record<string, string>).Authorization), body });
      return new Response(JSON.stringify(answer(body)), { status: 200 });
    });
    const rail = makeRazorpayRail((n) => FIXTURE_KEYS[n], { planFor });
    const apex = 'https://nikatru.com/checkout/?provider=razorpay&sub=sub_new1';
    expect(await rail.createCheckout!(REQ)).toEqual({ ok: true, url: apex, reference: 'sub_new1' });
    expect(seen[0].url).toBe('https://api.razorpay.com/v1/subscriptions');
    expect(seen[0].auth).toBe(`Basic ${btoa(`${FIXTURE_KEYS.RAZORPAY_KEY_ID}:${FIXTURE_KEYS.RAZORPAY_KEY_SECRET}`)}`);
    expect(seen[0].body).toMatchObject({ plan_id: FIXTURE_PLAN, customer_notify: 1, notes: { user_id: USER, app_id: APP, offering_id: 'pro_monthly', env: 'live' } });
    answer = (sent) => ({ id: 'sub_new1', status: 'created', notes: sent.notes, short_url: 'https://evil.example/i/abc' });
    expect(await rail.createCheckout!(REQ)).toEqual({ ok: true, url: apex, reference: 'sub_new1' });
    answer = (sent) => ({ id: 'sub_new1', status: 'created', notes: sent.notes });
    expect(await rail.createCheckout!(REQ)).toEqual({ ok: true, url: apex, reference: 'sub_new1' });
    answer = (sent) => ({ id: '../evil', status: 'created', notes: sent.notes, short_url: 'https://rzp.io/i/abc' });
    expect(await rail.createCheckout!(REQ)).toMatchObject({ ok: false, sent: true });
    answer = () => ({ id: 'sub_new1', status: 'created', notes: {}, short_url: 'https://rzp.io/i/abc' });
    expect(await rail.createCheckout!(REQ)).toMatchObject({ ok: false, sent: true });
  });

  it('the checkout host allow-list is the apex alone, and the URL is the apex /checkout/ page with provider and sub', () => {
    expect(RAZORPAY_CHECKOUT_HOSTS).toEqual(['nikatru.com']);
    const u = new URL(razorpayCheckoutUrl('sub_X1'));
    expect([u.protocol, u.host, u.pathname]).toEqual(['https:', 'nikatru.com', '/checkout/']);
    expect(Object.fromEntries(u.searchParams)).toEqual({ provider: 'razorpay', sub: 'sub_X1' });
  });

  it('a hung upstream is `timeout`, never a throw', async () => {
    const rail = makeRazorpayRail((n) => FIXTURE_KEYS[n], {
      planFor,
      timeoutMs: 5,
      fetchImpl: (_i, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    });
    expect(await rail.createCheckout!(REQ)).toMatchObject({ ok: false, kind: 'timeout', sent: true });
  });

  it('cancel is period-end only and idempotent: an already-cancelled subscription is the same receipt', async () => {
    let cancelled = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/cancel')) {
        expect(JSON.parse(String(init?.body))).toEqual({ cancel_at_cycle_end: 1 });
        if (cancelled) return new Response('{"error":{"code":"BAD_REQUEST_ERROR"}}', { status: 400 });
        cancelled = true;
        return new Response(JSON.stringify({ id: 'sub_abc123', status: 'active', current_end: unix(FUTURE) }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'sub_abc123', status: 'cancelled', current_end: unix(FUTURE) }), { status: 200 });
    });
    const rail = makeRazorpayRail((n) => FIXTURE_KEYS[n]);
    const req = { subscriptionRef: 'sub_abc123', when: 'period_end' as const, environment: 'live' as const };
    const a = await rail.cancel!(req);
    const b = await rail.cancel!(req);
    expect(a).toEqual({ ok: true, effectiveAt: FUTURE });
    expect(b).toEqual(a);
    expect(await rail.cancel!({ ...req, subscriptionRef: '../payments' })).toMatchObject({ ok: false, kind: 'invalid', sent: false });
  });

  it('declares checkout and cancel only, and reads the key pair the registry declares', () => {
    const rail = razorpayRail(() => undefined);
    expect([...rail.capabilities].sort()).toEqual(['cancel', 'checkout']);
    expect(rail.refund).toBeUndefined();
    expect(rail.reconcile).toBeUndefined();
    const row = paymentsRegistry.adapters.find((a) => a.id === 'razorpay');
    expect(row?.secrets).toEqual(expect.arrayContaining([RAZORPAY_KEY_ID_VAR, RAZORPAY_KEY_SECRET_VAR]));
    // ⏱ 2026-10-02 · PR #1149 ruling item 2: exactly ONE razorpay case stays pending — the refund's
    // payment → subscription link, unproven on a real test-mode event — so flip limb 5 stays red.
    expect(paymentsRegistry.conformance.pending.filter((p) => p.adapter === 'razorpay')).toEqual([
      { adapter: 'razorpay', case: 'refund revokes', row: 'O-RAZORPAY-CHECKOUT-ADAPTER' },
    ]);
  });
});
