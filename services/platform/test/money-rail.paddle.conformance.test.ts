// ⏱ 2026-10-01 · port-pay-core · Paddle against the payments conformance suite.
//
// The wire bodies are Paddle's documented notification shapes, the same ones test/money.test.ts
// builds (V7/V9/V10 in lib/mor/paddle.ts, read 2026-08-01 from
// https://developer.paddle.com/webhooks/signature-verification and the subscription / adjustment
// entity pages). Paddle's body names no money world, so "sandbox and live never cross" is held by
// the destination secret: a body signed under the other world's secret is refused at verify.
import { describe, it, vi } from 'vitest';
import './harness'; // the Workers-only crypto.subtle.timingSafeEqual shim the verifiers call
import { runPaymentsConformance, type EventSpec } from '../../_shared/test/conformance/payments';
import { PADDLE_CUSTOM_DATA_APP_ID, PADDLE_CUSTOM_DATA_USER_ID, PADDLE_SECRET_PREFIX, paddleSignature, paddleVerifier } from '../src/lib/mor/paddle';
import { paddleRail } from '../src/lib/mor/paddle-rail';
import type { MoneyEnvironment } from '../src/lib/mor/contract';
import { pendingFor } from './conformance-pending';

const SECRET: Record<MoneyEnvironment, string> = {
  live: `${PADDLE_SECRET_PREFIX}01conformance_live_destination`,
  sandbox: `${PADDLE_SECRET_PREFIX}01conformance_sandbox_destination`,
};
const ACTION = { refund: 'refund', dispute: 'chargeback', restore: 'chargeback_reverse' } as const;

function paddleBody(spec: EventSpec): string {
  if (spec.kind === 'subscription') {
    const custom: Record<string, string> = { [PADDLE_CUSTOM_DATA_APP_ID]: spec.appId };
    if (spec.userId !== null) custom[PADDLE_CUSTOM_DATA_USER_ID] = spec.userId;
    return JSON.stringify({
      event_id: spec.eventId, notification_id: 'ntf_01', event_type: 'subscription.updated', occurred_at: spec.occurredAt,
      data: {
        id: 'sub_01conformance', status: spec.status,
        current_billing_period: { starts_at: '2026-07-01T00:00:00.000Z', ends_at: spec.periodEnd },
        items: spec.trialEnd ? [{ trial_dates: { starts_at: '2026-07-01T00:00:00.000Z', ends_at: spec.trialEnd } }] : [],
        custom_data: custom, customer_id: 'ctm_01conformance', customer: {},
      },
    });
  }
  if (spec.kind === 'adjustment') {
    return JSON.stringify({
      event_id: spec.eventId, notification_id: 'ntf_02', event_type: 'adjustment.created', occurred_at: spec.occurredAt,
      data: { id: 'adj_01conformance', action: ACTION[spec.action], status: 'approved', transaction_id: 'txn_01conformance', subscription_id: 'sub_01conformance' },
    });
  }
  return JSON.stringify({ event_id: spec.eventId, notification_id: 'ntf_03', event_type: 'product.updated', occurred_at: spec.occurredAt, data: { id: 'pro_01conformance', name: 'x' } });
}

runPaymentsConformance(
  'paddle',
  () => ({
    inbound: paddleVerifier,
    outbound: paddleRail((name) => (name === 'PADDLE_API_KEY' ? `pdl_live_apikey_${'c'.repeat(24)}` : undefined)),
    environment: 'live',
    pending: pendingFor('paddle'),
  }),
  {
    secret: (env) => SECRET[env],
    async encode(spec, o) {
      const raw = paddleBody(spec);
      const ts = Math.floor(Date.now() / 1000);
      const h1 = o?.badSignature ? '0'.repeat(64) : await paddleSignature(SECRET[spec.environment], ts, raw);
      return { raw, headers: new Headers({ 'paddle-signature': `ts=${ts};h1=${h1}` }), nowMs: ts * 1000 };
    },
    sellable: { appId: 'subscriptiontracker', offeringId: 'pro_monthly' },
    unsellable: { appId: 'subscriptiontracker', offeringId: 'not_sold_here' },
    checkoutHosts: ['nikatru.com'],
    subscriptionRef: 'sub_01conformance',
    purchaseRef: null,
    stubNetwork() {
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/transactions')) {
          const sent = JSON.parse(String(init?.body)) as { custom_data: Record<string, string> };
          return new Response(JSON.stringify({ data: { id: 'txn_01conformance', status: 'draft', custom_data: sent.custom_data, checkout: { url: 'https://nikatru.com/pricing.html?_ptxn=txn_01conformance' } } }), { status: 201 });
        }
        if (/\/subscriptions\/sub_[a-z0-9]+\/cancel$/.test(url)) {
          return new Response(JSON.stringify({ data: { id: 'sub_01conformance', scheduled_change: { action: 'cancel', effective_at: '2027-01-01T00:00:00.000Z' } } }), { status: 200 });
        }
        throw new Error(`unexpected fetch in conformance: ${url}`);
      });
      return () => vi.unstubAllGlobals();
    },
  },
  { describe, it },
);
