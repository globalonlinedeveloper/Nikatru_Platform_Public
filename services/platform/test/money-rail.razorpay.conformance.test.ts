// ⏱ 2026-10-01 · port-pay-core · Razorpay against the payments conformance suite. Its `verify` rests
// on https://razorpay.com/docs/webhooks/validate-test/ (read 2026-09-12); its `parse` refuses every
// event (O-RAZORPAY-CHECKOUT-ADAPTER), so every case past the signature is PENDING in
// tooling/ports/payments.json and prints on every run. The bad-signature case runs today.
import { describe, it } from 'vitest';
import './harness'; // the Workers-only crypto.subtle.timingSafeEqual shim the verifiers call
import { runPaymentsConformance } from '../../_shared/test/conformance/payments';
import { razorpaySignature, razorpayVerifier } from '../src/lib/mor/razorpay';
import { pendingFor } from './conformance-pending';

const SECRET = 'fixture_razorpay_webhook_secret_conformance';

runPaymentsConformance(
  'razorpay',
  () => ({ inbound: razorpayVerifier, outbound: null, environment: 'live', pending: pendingFor('razorpay') }),
  {
    secret: () => SECRET,
    async encode(spec, o) {
      const raw = JSON.stringify({ entity: 'event', event: 'subscription.activated', created_at: Math.floor(Date.parse(spec.occurredAt) / 1000), payload: {} });
      const sig = o?.badSignature ? '0'.repeat(64) : await razorpaySignature(SECRET, raw);
      return { raw, headers: new Headers({ 'x-razorpay-signature': sig, 'x-razorpay-event-id': spec.eventId }), nowMs: Date.now() };
    },
    sellable: null,
    unsellable: null,
    checkoutHosts: [],
    subscriptionRef: null,
    purchaseRef: null,
  },
  { describe, it },
);
