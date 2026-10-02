// ⏱ 2026-10-01 · fix-india-rail-tax-data · Razorpay-shaped wire fixtures, shared by
// money-rail.razorpay.conformance.test.ts and razorpay-rail.test.ts (a helper, not a test file).
// The envelopes follow lib/mor/razorpay.ts's header: the docs' published webhook payload examples,
// UNCONFIRMED until the first delivered test-mode event. Every key below is a fixture, never real.
import type { EventSpec } from '../../_shared/test/conformance/payments';
import { razorpaySignature } from '../src/lib/mor/razorpay';
import { RAZORPAY_KEY_ID_PREFIX } from '../src/lib/mor/razorpay-rail';

export const SECRET = 'fixture_razorpay_webhook_secret_conformance';
/** Fixture key pair, built so no literal in this file is key-shaped. Never a real key. */
export const FIXTURE_KEYS: Record<string, string> = {
  RAZORPAY_KEY_ID: `${RAZORPAY_KEY_ID_PREFIX.live}${'k'.repeat(14)}`,
  RAZORPAY_KEY_SECRET: 'fixture-key-secret-conformance',
};
/** A fixture plan for the one sellable offering — RAIL_PRICE_IDS.razorpay is empty until the plans exist. */
export const FIXTURE_PLAN = 'plan_conformance01';
export const planFor = (appId: string, offeringId: string) => (appId === 'subscriptiontracker' && offeringId === 'pro_monthly' ? FIXTURE_PLAN : undefined);

export const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const PAY_ID = 'pay_conformance1';

/** A Razorpay webhook envelope for one EventSpec. */
export function razorpayBody(spec: EventSpec): string {
  const created_at = unix(spec.occurredAt);
  if (spec.kind === 'subscription') {
    const notes: Record<string, string> = { app_id: spec.appId, offering_id: 'pro_monthly', env: spec.environment };
    if (spec.userId !== null) notes.user_id = spec.userId;
    const status = spec.status === 'active' ? 'active' : spec.status === 'trialing' ? 'authenticated' : 'cancelled';
    const event = spec.status === 'active' ? 'subscription.charged' : spec.status === 'trialing' ? 'subscription.authenticated' : 'subscription.cancelled';
    const entity = {
      id: spec.subscriptionId, entity: 'subscription', plan_id: FIXTURE_PLAN, customer_id: 'cust_conformance1', status,
      current_start: spec.status === 'trialing' ? null : created_at - 86_400,
      current_end: spec.status === 'trialing' ? null : unix(spec.periodEnd),
      start_at: spec.trialEnd !== null ? unix(spec.trialEnd) : created_at - 86_400,
      charge_at: spec.status === 'trialing' && spec.trialEnd !== null ? unix(spec.trialEnd) : unix(spec.periodEnd),
      total_count: 60, paid_count: spec.status === 'trialing' ? 0 : 1, notes, created_at: created_at - 86_400,
    };
    const contains = event === 'subscription.charged' ? ['subscription', 'payment'] : ['subscription'];
    const payload: Record<string, unknown> = { subscription: { entity } };
    if (event === 'subscription.charged') payload.payment = { entity: { id: PAY_ID, entity: 'payment', status: 'captured', invoice_id: 'inv_conformance1', notes: [] } };
    return JSON.stringify({ entity: 'event', account_id: 'acc_conformance1', event, contains, payload, created_at });
  }
  if (spec.kind === 'adjustment') {
    const bare = { id: PAY_ID, entity: 'payment', status: 'refunded', invoice_id: 'inv_conformance1', notes: [] };
    const payment = { ...bare, subscription_id: spec.subscriptionId };
    if (spec.action === 'refund') {
      // ⏱ 2026-10-02 · PR #1149 ruling item 2: the refund's payment entity names NO subscription — the docs'
      // payment entity names `invoice_id` — so only the store's `payment id → subscription id` link (written
      // at `subscription.charged`) can resolve it. The port-level `refund revokes` case is PENDING for it.
      return JSON.stringify({
        entity: 'event', account_id: 'acc_conformance1', event: 'refund.processed', contains: ['refund', 'payment'], created_at,
        payload: { refund: { entity: { id: 'rfnd_conformance1', entity: 'refund', payment_id: PAY_ID, status: 'processed', notes: [] } }, payment: { entity: bare } },
      });
    }
    const won = spec.action === 'restore';
    return JSON.stringify({
      entity: 'event', account_id: 'acc_conformance1', event: won ? 'payment.dispute.won' : 'payment.dispute.created', contains: ['payment', 'dispute'], created_at,
      payload: { payment: { entity: { ...payment, status: 'captured' } }, dispute: { entity: { id: 'disp_conformance1', entity: 'dispute', payment_id: PAY_ID, status: won ? 'won' : 'open', phase: 'chargeback' } } },
    });
  }
  return JSON.stringify({ entity: 'event', account_id: 'acc_conformance1', event: 'settlement.processed', contains: ['settlement'], payload: { settlement: { entity: { id: 'setl_1' } } }, created_at });
}

export async function razorpayWire(spec: EventSpec, o?: { badSignature?: boolean }) {
  const raw = razorpayBody(spec);
  const sig = o?.badSignature ? '0'.repeat(64) : await razorpaySignature(SECRET, raw);
  return { raw, headers: new Headers({ 'x-razorpay-signature': sig, 'x-razorpay-event-id': spec.eventId }), nowMs: Date.now() };
}

