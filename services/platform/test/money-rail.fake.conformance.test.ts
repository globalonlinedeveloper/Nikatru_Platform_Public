// ⏱ 2026-10-01 · port-pay-core · the fake rail against the payments conformance suite.
import { describe, it, expect } from 'vitest';
import './harness'; // the Workers-only crypto.subtle.timingSafeEqual shim the verifiers call
import { ReferenceLedger, runPaymentsConformance, type EventSpec } from '../../_shared/test/conformance/payments';
import { FAKE_CHECKOUT_HOST, FAKE_RAIL_TEST_SECRET, FAKE_SIGNATURE_HEADER, fakeSignature, fakeVerifier, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { pendingFor } from './conformance-pending';

const STATUS: Record<string, string> = { active: 'active', trialing: 'trialing', canceled: 'canceled' };
const ACTION: Record<string, string> = { refund: 'refund', dispute: 'dispute', restore: 'dispute_won' };

export function fakeBody(spec: EventSpec): string {
  if (spec.kind === 'subscription') {
    return JSON.stringify({
      event_id: spec.eventId, type: 'subscription.updated', occurred_at: spec.occurredAt, environment: spec.environment,
      subscription: { id: spec.subscriptionId, status: STATUS[spec.status], current_period_end: spec.periodEnd, trial_end: spec.trialEnd, user_id: spec.userId, app_id: spec.appId },
    });
  }
  if (spec.kind === 'adjustment') {
    return JSON.stringify({
      event_id: spec.eventId, type: 'adjustment.created', occurred_at: spec.occurredAt, environment: spec.environment,
      adjustment: { action: ACTION[spec.action], subscription_id: spec.subscriptionId, transaction_id: 'fake_txn_1' },
    });
  }
  return JSON.stringify({ event_id: spec.eventId, type: 'catalogue.updated', occurred_at: spec.occurredAt, environment: spec.environment });
}

runPaymentsConformance(
  'fake',
  () => ({
    inbound: fakeVerifier,
    outbound: makeFakeRail((app, offering) => app === 'subscriptiontracker' && offering === 'pro_monthly'),
    environment: 'sandbox',
    pending: pendingFor('fake'),
  }),
  {
    secret: () => FAKE_RAIL_TEST_SECRET,
    async encode(spec, o) {
      const raw = fakeBody(spec);
      const sig = o?.badSignature ? '0'.repeat(64) : await fakeSignature(raw, FAKE_RAIL_TEST_SECRET);
      return { raw, headers: new Headers({ [FAKE_SIGNATURE_HEADER]: sig }), nowMs: Date.now() };
    },
    sellable: { appId: 'subscriptiontracker', offeringId: 'pro_monthly' },
    unsellable: { appId: 'subscriptiontracker', offeringId: 'not_sold_here' },
    checkoutHosts: [FAKE_CHECKOUT_HOST],
    subscriptionRef: 'fake_sub_conformance',
    purchaseRef: 'fake_txn_1',
  },
  { describe, it },
);

// ── THE RECORDED MUTATION (vacuous-03), beside its green control ─────────────
// A fake whose parse stamps its own ARRIVAL clock instead of the body's `occurred_at` makes
// an older event look newer — and re-grants a subscription a newer event ended. The suite's
// "an older event after a newer one cannot re-grant" case is the one that reddens on it
// (measured 2026-10-01: exactly that case fails, 17 pass); this pins why, on the suite's own ledger.
describe('recorded mutation: a fake that ignores occurred_at re-grants an older event', () => {
  const newer = fakeBody({ kind: 'subscription', eventId: 'evt_mut_newer', occurredAt: '2026-08-31T00:05:00.000Z', status: 'canceled', subscriptionId: 'fake_sub_mut', periodEnd: '2026-08-01T00:00:00.000Z', trialEnd: null, userId: 'user-mut', appId: 'subscriptiontracker', environment: 'sandbox' });
  const older = fakeBody({ kind: 'subscription', eventId: 'evt_mut_older', occurredAt: '2026-08-31T00:01:00.000Z', status: 'active', subscriptionId: 'fake_sub_mut', periodEnd: '2027-01-01T00:00:00.000Z', trialEnd: null, userId: 'user-mut', appId: 'subscriptiontracker', environment: 'sandbox' });
  const replay = (parse: (raw: string) => ReturnType<typeof fakeVerifier.parse>) => {
    const ledger = new ReferenceLedger('sandbox', Date.parse('2026-09-01T00:00:00.000Z'));
    const out: string[] = [];
    for (const raw of [newer, older]) {
      const p = parse(raw);
      if (!p.ok) throw new Error(p.reason);
      out.push(ledger.apply(p.notification));
    }
    return out;
  };
  it('green control: the real fake orders by occurred_at — the older event is stale', () => {
    expect(replay((raw) => fakeVerifier.parse(raw))).toEqual(['revoked', 'stale']);
  });
  it('red: stamped with the arrival clock, the older event RE-GRANTS', () => {
    let tick = Date.parse('2026-09-01T00:00:00.000Z');
    const arrival = (raw: string) => {
      const p = fakeVerifier.parse(raw);
      return p.ok ? { ok: true as const, notification: { ...p.notification, occurredAt: new Date((tick += 1000)).toISOString() } } : p;
    };
    expect(replay(arrival)).toEqual(['revoked', 'granted']);
  });
});
