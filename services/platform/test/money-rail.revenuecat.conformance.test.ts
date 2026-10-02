// ⏱ 2026-10-01 · port-pay-core · RevenueCat against the payments conformance suite.
//
// Signature: X-RevenueCat-Webhook-Signature `t=<s>,v1=<hex>`, HMAC-SHA256 over `${t}.${body}`
// (lib/mor/revenuecat.ts). Bodies follow
// https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields (read 2026-09-15):
// `api_version` at the root, every other field under `event`. A refund is a CANCELLATION whose
// `cancel_reason` is CUSTOMER_SUPPORT ([ADR 085] C), and the body names its own world
// (`environment`: PRODUCTION / SANDBOX). RevenueCat sends NO dispute and NO reversal event
// (contracts/entitlement/contract.js REVENUECAT_EVENT_REASONS: chargeback and chargeback_reversed
// are reachable from no RevenueCat event), so those two cases are PENDING in
// tooling/ports/payments.json under O-REVENUECAT-VERIFIER and print on every run.
import { describe, it } from 'vitest';
import './harness'; // the Workers-only crypto.subtle.timingSafeEqual shim the verifiers call
import { runPaymentsConformance, type EventSpec } from '../../_shared/test/conformance/payments';
import { revenueCatSignature, revenuecatVerifier } from '../src/lib/mor/revenuecat';
import { REVENUECAT_APP_IDS } from '../src/lib/mor/revenuecat-app-ids';
import { pendingFor } from './conformance-pending';

const SECRET = 'fixture_revenuecat_signing_secret_conformance';
/** A store app id the rendered routing table declares (apps/<app>/app.yaml billing.mobileIap.revenuecatAppIds). */
const RC_APP = Object.keys(REVENUECAT_APP_IDS)[0] ?? 'app_undeclared';
const ENV = { live: 'PRODUCTION', sandbox: 'SANDBOX' } as const;

function rcBody(spec: EventSpec): string | null {
  const head = { id: spec.eventId, event_timestamp_ms: Date.parse(spec.occurredAt), app_id: RC_APP, environment: ENV[spec.environment] };
  const owner = { original_app_user_id: '$RCAnonymousID:conformance', original_transaction_id: 'otx_conformance', transaction_id: 'tx_conformance', product_id: 'pro_monthly' };
  if (spec.kind === 'unknown') return JSON.stringify({ api_version: '1.0', event: { ...head, type: 'TEST' } });
  if (spec.kind === 'adjustment') {
    if (spec.action !== 'refund') return null; // no dispute / reversal event exists on this rail
    return JSON.stringify({
      api_version: '1.0',
      event: { ...head, ...owner, type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: 'user-conformance', expiration_at_ms: Date.parse('2027-01-01T00:00:00.000Z'), period_type: 'NORMAL' },
    });
  }
  const user = spec.userId ?? '$RCAnonymousID:conformance';
  const type = spec.status === 'canceled' ? 'CANCELLATION' : spec.status === 'trialing' ? 'INITIAL_PURCHASE' : 'RENEWAL';
  return JSON.stringify({
    api_version: '1.0',
    event: {
      ...head,
      ...owner,
      type,
      app_user_id: user,
      expiration_at_ms: Date.parse(spec.status === 'trialing' && spec.trialEnd !== null ? spec.trialEnd : spec.periodEnd),
      period_type: spec.status === 'trialing' ? 'TRIAL' : 'NORMAL',
      ...(spec.status === 'canceled' ? { cancel_reason: 'UNSUBSCRIBE' } : {}),
    },
  });
}

runPaymentsConformance(
  'revenuecat',
  () => ({ inbound: revenuecatVerifier, outbound: null, environment: 'live', pending: pendingFor('revenuecat') }),
  {
    secret: () => SECRET,
    async encode(spec, o) {
      const raw = rcBody(spec);
      if (raw === null) return null;
      const t = Math.floor(Date.now() / 1000);
      const v1 = o?.badSignature ? '0'.repeat(64) : await revenueCatSignature(SECRET, t, raw);
      return { raw, headers: new Headers({ 'X-RevenueCat-Webhook-Signature': `t=${t},v1=${v1}` }), nowMs: t * 1000 };
    },
    sellable: null,
    unsellable: null,
    checkoutHosts: [],
    subscriptionRef: null,
    purchaseRef: null,
  },
  { describe, it },
);
