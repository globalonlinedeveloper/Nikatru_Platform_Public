// ⏱ 2026-10-01 · fix-india-rail-tax-data · Razorpay against the payments conformance suite — ONE case
// PENDING (O-RAZORPAY-CHECKOUT-ADAPTER's 15 cases cleared from tooling/ports/payments.json but one).
// ⏱ 2026-10-02 · PR #1149 ruling item 2: `refund revokes` stays pending. A Razorpay refund names a
// payment, its body names no subscription (test/razorpay-fixtures.ts), and only the STORE's
// `payment id → subscription id` link resolves it — test/razorpay-rail.test.ts proves that through the
// door; this port-level case cannot see the link, and the link is unproven on a real test-mode event.
//
// Its `verify` rests on https://razorpay.com/docs/webhooks/validate-test/ (read 2026-09-12). The wire
// bodies below are Razorpay-shaped webhook envelopes as lib/mor/razorpay.ts's header describes them
// (the docs' published payload examples — UNCONFIRMED until the first delivered test-mode event; the
// docs pages could not be fetched from the build sandbox on 2026-10-01). The event id travels in the
// `x-razorpay-event-id` header, exactly as the door hands it to `parse`.
//
// "sandbox and live never cross" is held by `notes.env`, which razorpay-rail.ts writes at creation
// and razorpay.ts maps to `railEnvironment`: the other world's event is refused, never granted.
import { describe, it, vi } from 'vitest';
import './harness'; // the Workers-only crypto.subtle.timingSafeEqual shim the verifiers call
import { runPaymentsConformance } from '../../_shared/test/conformance/payments';
import { razorpayVerifier } from '../src/lib/mor/razorpay';
import { RAZORPAY_CHECKOUT_HOSTS, makeRazorpayRail } from '../src/lib/mor/razorpay-rail';
import { pendingFor } from './conformance-pending';
import { FIXTURE_KEYS, FIXTURE_PLAN, SECRET, planFor, razorpayWire, unix } from './razorpay-fixtures';

runPaymentsConformance(
  'razorpay',
  () => ({
    inbound: razorpayVerifier,
    outbound: makeRazorpayRail((name) => FIXTURE_KEYS[name], { planFor }),
    environment: 'live',
    pending: pendingFor('razorpay'),
  }),
  {
    secret: () => SECRET,
    encode: (spec, o) => razorpayWire(spec, o),
    sellable: { appId: 'subscriptiontracker', offeringId: 'pro_monthly' },
    unsellable: { appId: 'subscriptiontracker', offeringId: 'not_sold_here' },
    checkoutHosts: RAZORPAY_CHECKOUT_HOSTS,
    subscriptionRef: 'sub_01conformance',
    purchaseRef: null,
    stubNetwork() {
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://api.razorpay.com/v1/subscriptions' && init?.method === 'POST') {
          const sent = JSON.parse(String(init?.body)) as { plan_id: string; notes: Record<string, string> };
          if (sent.plan_id !== FIXTURE_PLAN) return new Response('{"error":{"code":"BAD_REQUEST_ERROR"}}', { status: 400 });
          return new Response(JSON.stringify({ id: 'sub_01conformance', entity: 'subscription', plan_id: sent.plan_id, status: 'created', notes: sent.notes, short_url: 'https://rzp.io/i/conformance' }), { status: 200 });
        }
        if (/\/v1\/subscriptions\/sub_[A-Za-z0-9]+\/cancel$/.test(url)) {
          return new Response(JSON.stringify({ id: 'sub_01conformance', entity: 'subscription', status: 'active', current_end: unix('2027-01-01T00:00:00.000Z') }), { status: 200 });
        }
        throw new Error(`unexpected fetch in conformance: ${url}`);
      });
      return () => vi.unstubAllGlobals();
    },
  },
  { describe, it },
);
