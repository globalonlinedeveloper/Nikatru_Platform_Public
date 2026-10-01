// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · port-pay-core · THE PAYMENTS CONFORMANCE SUITE — one scenario list
// every rail must pass (tooling/ports/README.md §3 "Conformance").
//
//   runPaymentsConformance(name, makeRail, encoder)
//
// is CALLED once per adapter from services/platform/test/money-rail.<id>.conformance.test.ts
// (assert-ports limb 6 matches that call). The encoder builds the adapter's OWN signed
// wire bytes for each scenario; a scenario the encoder has no fixture for THROWS — a
// missing fixture is never a skip. A case the adapter cannot pass today is `pending` in
// tooling/ports/payments.json with its O- row: the test file passes those in, and each
// prints as `PENDING <case> (<row>)` on every run.
//
// NO BARE IMPORT (services/_shared resolves no node_modules for anybody; see
// shared-home.test.ts): the caller hands in its runner's `describe` / `it` as `t`, and
// the checks below throw their own errors instead of importing an `expect`.
//
// INBOUND is graded at the port: verify → parse → the contract's own decision
// (lib/mor/contract.ts decideSubscription / decideAdjustment) through a reference
// ledger below that keeps the store's three rules — exactly-once per event id, a newer
// event is never overruled by an older one (by the rail's `occurredAt`), and a
// notification's world never crosses the configured one. The store's own tests hold
// store.ts to the same rules; this suite holds every ADAPTER to the inputs those rules need.
// ─────────────────────────────────────────────────────────────────────────────
import {
  decideAdjustment,
  decideSubscription,
  type EntitlementDecision,
} from '../../../platform/src/lib/mor/contract';
import {
  RAIL_CAPABILITIES,
  VERB_OF,
  railCan,
  type MoneyEnvironment,
  type RailCapability,
  type NormalizedNotification,
  type RailInbound,
  type RailOutbound,
} from '../../src/ports/payments';

export const INBOUND_SCENARIOS = [
  'purchase grants',
  'renewal extends',
  'trial grants as trialing',
  'cancel ends at the period end',
  'refund revokes',
  'dispute holds',
  'refund reversed or dispute won restores',
  'an older event after a newer one cannot re-grant',
  'a duplicate event id is stored once and acked',
  'a bad signature is refused',
  'an unknown event type is refused, not crashed',
  'an unlinked account is stored and not granted',
  'sandbox and live never cross',
] as const;
export const OUTBOUND_SCENARIOS = [
  'checkout returns a URL on an allowed host plus a reference',
  'an unsellable offering is refused',
  'cancel at the period end is idempotent',
  'refund wherever declared',
  'reconcile wherever declared',
] as const;
export type Scenario = (typeof INBOUND_SCENARIOS)[number] | (typeof OUTBOUND_SCENARIOS)[number];

/** One event, in the suite's vocabulary; the encoder turns it into the rail's bytes. */
export type EventSpec =
  | {
      kind: 'subscription';
      eventId: string;
      occurredAt: string;
      status: 'active' | 'trialing' | 'canceled';
      subscriptionId: string;
      periodEnd: string;
      trialEnd: string | null;
      userId: string | null;
      appId: string;
      environment: MoneyEnvironment;
    }
  | { kind: 'adjustment'; eventId: string; occurredAt: string; action: 'refund' | 'dispute' | 'restore'; subscriptionId: string; environment: MoneyEnvironment }
  | { kind: 'unknown'; eventId: string; occurredAt: string; environment: MoneyEnvironment };

export interface WireEvent {
  raw: string;
  headers: Headers;
  /** The clock `verify` is called with (a rail with a replay window signs a timestamp). */
  nowMs: number;
}

export interface PaymentsEncoder {
  /** The destination secret `verify` is handed, per configured world. */
  secret(environment: MoneyEnvironment): string;
  /** The rail's signed bytes for `spec`, or null when the adapter has no fixture for it. */
  encode(spec: EventSpec, o?: { badSignature?: boolean }): Promise<WireEvent | null>;
  /** Outbound: what the suite asks the rail to sell, and what it must refuse. */
  sellable: { appId: string; offeringId: string } | null;
  unsellable: { appId: string; offeringId: string } | null;
  /** Hosts a checkout URL may live on. */
  checkoutHosts: readonly string[];
  /** A subscription and a purchase reference the rail's cancel / refund accept. */
  subscriptionRef: string | null;
  purchaseRef: string | null;
  /** Stub the rail's network for an outbound call, when it makes one; returns a restore. */
  stubNetwork?: (scenario: Scenario) => () => void;
}

export interface RailUnderTest {
  inbound: RailInbound;
  outbound: RailOutbound | null;
  /** The world the deploy is configured for. */
  environment: MoneyEnvironment;
  /** Scenario → its O- row, for each case pending for this adapter in tooling/ports/payments.json. */
  pending: Readonly<Partial<Record<Scenario, string>>>;
}

/** The two runner primitives the suite needs, handed in by the caller's test file. */
export interface ConformanceTestApi {
  describe(name: string, fn: () => void): void;
  it: ((name: string, fn: () => Promise<void>) => void) & { todo(name: string): void };
}

class ConformanceFailure extends Error {}
const fmt = (v: unknown) => JSON.stringify(v);
function eq(actual: unknown, expected: unknown, what: string): void {
  if (!Object.is(actual, expected)) throw new ConformanceFailure(`${what}: expected ${fmt(expected)}, got ${fmt(actual)}`);
}
function ne(actual: unknown, unexpected: unknown, what: string): void {
  if (Object.is(actual, unexpected)) throw new ConformanceFailure(`${what}: must not be ${fmt(unexpected)}`);
}
function oneOf(actual: unknown, allowed: readonly unknown[], what: string): void {
  if (!allowed.some((a) => Object.is(a, actual))) throw new ConformanceFailure(`${what}: expected one of ${fmt(allowed)}, got ${fmt(actual)}`);
}
function truthy(cond: boolean, what: string): void {
  if (!cond) throw new ConformanceFailure(what);
}

// ── the reference ledger ────────────────────────────────────────────────────
interface Row {
  decision: EntitlementDecision;
  at: string;
}
export type Applied = 'granted' | 'revoked' | 'stale' | 'duplicate' | 'unlinked' | 'refused' | 'ignored';

/** The suite's reference ledger, exported so a test can record a mutation against it (vacuous-03). */
export class ReferenceLedger {
  readonly seen = new Set<string>();
  readonly rows = new Map<string, Row>();
  stored = 0;
  constructor(readonly environment: MoneyEnvironment, readonly nowMs: number) {}

  /** The one subscription row a scenario built (each scenario drives one subscription). */
  row(): Row['decision'] | undefined {
    if (this.rows.size > 1) throw new Error(`payments conformance: a scenario built ${this.rows.size} rows; it drives one subscription`);
    return [...this.rows.values()][0]?.decision;
  }

  apply(n: NormalizedNotification): Applied {
    if (this.seen.has(n.eventId)) return 'duplicate';
    this.seen.add(n.eventId);
    this.stored += 1;
    const s = n.subject;
    if (s.kind === 'subscription') {
      if (s.railEnvironment != null && s.railEnvironment !== this.environment) return 'refused';
      if (s.accountUserId === null) return 'unlinked';
      const prior = this.rows.get(s.subscriptionId);
      if (prior !== undefined && Date.parse(n.occurredAt) < Date.parse(prior.at)) return 'stale';
      const d = decideSubscription(s, this.nowMs);
      if (!d.ok) return 'refused';
      this.rows.set(s.subscriptionId, { decision: d.decision, at: n.occurredAt });
      return d.decision.isActive === 1 ? 'granted' : 'revoked';
    }
    if (s.kind === 'adjustment') {
      const prior = s.subscriptionId === null ? undefined : this.rows.get(s.subscriptionId);
      if (prior === undefined || s.subscriptionId === null) return 'refused';
      if (Date.parse(n.occurredAt) < Date.parse(prior.at)) return 'stale';
      const d = decideAdjustment(s, prior.decision, this.nowMs);
      if (!d.ok) return 'refused';
      this.rows.set(s.subscriptionId, { decision: d.decision, at: n.occurredAt });
      return d.decision.isActive === 1 ? 'granted' : 'revoked';
    }
    return s.kind === 'refused' ? 'refused' : 'ignored';
  }
}

const NOW = Date.parse('2026-09-01T00:00:00.000Z');
const FUTURE = '2027-01-01T00:00:00.000Z';
const LATER = '2027-06-01T00:00:00.000Z';
const PAST = '2026-08-01T00:00:00.000Z';
const at = (minutes: number) => new Date(NOW - 86_400_000 + minutes * 60_000).toISOString();

/** Run the whole suite for one adapter. */
export function runPaymentsConformance(
  name: string,
  makeRail: () => RailUnderTest,
  encoder: PaymentsEncoder,
  t: ConformanceTestApi,
): void {
  const { describe, it } = t;
  const fixture = async (spec: EventSpec, o?: { badSignature?: boolean }): Promise<WireEvent> => {
    const w = await encoder.encode(spec, o);
    if (w === null) throw new Error(`payments conformance: ${name} has no fixture for a ${spec.kind} event — a missing fixture is never a skip`);
    return w;
  };
  /** Verify, parse and apply one spec. Never throws for a refusal. */
  const deliver = async (rail: RailUnderTest, ledger: ReferenceLedger, spec: EventSpec, o?: { badSignature?: boolean }) => {
    const w = await fixture(spec, o);
    const v = await rail.inbound.verify(w.raw, w.headers, encoder.secret(rail.environment), w.nowMs);
    if (!v.ok) return { verified: false as const, applied: 'refused' as Applied, status: v.status };
    const p = rail.inbound.parse(w.raw, spec.eventId);
    if (!p.ok) return { verified: true as const, applied: 'refused' as Applied, status: 400 };
    return { verified: true as const, applied: ledger.apply(p.notification), notification: p.notification, status: 200 };
  };
  const sub = (o: Partial<Extract<EventSpec, { kind: 'subscription' }>> & { eventId: string; occurredAt: string }, env: MoneyEnvironment): EventSpec => ({
    kind: 'subscription',
    status: 'active',
    subscriptionId: 'sub_conformance1',
    periodEnd: FUTURE,
    trialEnd: null,
    userId: 'user-conformance',
    appId: 'subscriptiontracker',
    environment: env,
    ...o,
  });
  const adj = (eventId: string, occurredAt: string, action: 'refund' | 'dispute' | 'restore', env: MoneyEnvironment): EventSpec => ({
    kind: 'adjustment',
    eventId,
    occurredAt,
    action,
    subscriptionId: 'sub_conformance1',
    environment: env,
  });

  describe(`payments conformance · ${name}`, () => {
    const probe = makeRail();
    const pendingOf = (s: Scenario) => probe.pending[s];
    const scenario = (s: Scenario, body: (rail: RailUnderTest) => Promise<void>) => {
      const row = pendingOf(s);
      if (row !== undefined) {
        console.log(`PENDING payments/${name}: ${s} (${row})`);
        it.todo(`PENDING ${s} (${row})`);
        return;
      }
      it(s, async () => {
        const rail = makeRail();
        await body(rail);
      });
    };

    describe('inbound', () => {
      scenario('purchase grants', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, sub({ eventId: 'evt_c1', occurredAt: at(1) }, rail.environment));
        eq(r.applied, 'granted', 'r.applied');
      });
      scenario('renewal extends', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c2a', occurredAt: at(1) }, rail.environment));
        const r = await deliver(rail, l, sub({ eventId: 'evt_c2b', occurredAt: at(2), periodEnd: LATER }, rail.environment));
        eq(r.applied, 'granted', 'r.applied');
        eq(l.row()?.expiresAt, LATER, 'l.row()?.expiresAt');
      });
      scenario('trial grants as trialing', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, sub({ eventId: 'evt_c3', occurredAt: at(1), status: 'trialing', trialEnd: FUTURE }, rail.environment));
        eq(r.applied, 'granted', 'r.applied');
        eq(r.notification?.subject.kind === 'subscription' && r.notification.subject.access, 'trialing', 'r.notification?.subject.kind === \'subscription\' && r.notification.subject.access');
      });
      scenario('cancel ends at the period end', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c4a', occurredAt: at(1) }, rail.environment));
        const kept = await deliver(rail, l, sub({ eventId: 'evt_c4b', occurredAt: at(2), status: 'canceled' }, rail.environment));
        eq(kept.applied, 'granted', 'kept.applied'); // the paid period is kept
        const ended = await deliver(rail, l, sub({ eventId: 'evt_c4c', occurredAt: at(3), status: 'canceled', periodEnd: PAST }, rail.environment));
        eq(ended.applied, 'revoked', 'ended.applied');
        eq(l.row()?.revocationReason, 'cancelled_at_period_end', 'l.row()?.revocationReason');
      });
      scenario('refund revokes', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c5a', occurredAt: at(1) }, rail.environment));
        const r = await deliver(rail, l, adj('evt_c5b', at(2), 'refund', rail.environment));
        eq(r.applied, 'revoked', 'r.applied');
        eq(l.row()?.revocationReason, 'refund_approved', 'l.row()?.revocationReason');
      });
      scenario('dispute holds', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c6a', occurredAt: at(1) }, rail.environment));
        const r = await deliver(rail, l, adj('evt_c6b', at(2), 'dispute', rail.environment));
        eq(r.applied, 'revoked', 'r.applied');
        eq(l.row()?.revocationReason, 'chargeback', 'l.row()?.revocationReason');
      });
      scenario('refund reversed or dispute won restores', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c7a', occurredAt: at(1) }, rail.environment));
        await deliver(rail, l, adj('evt_c7b', at(2), 'dispute', rail.environment));
        const r = await deliver(rail, l, adj('evt_c7c', at(3), 'restore', rail.environment));
        eq(r.applied, 'granted', 'r.applied');
      });
      scenario('an older event after a newer one cannot re-grant', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        await deliver(rail, l, sub({ eventId: 'evt_c8a', occurredAt: at(5), status: 'canceled', periodEnd: PAST }, rail.environment));
        const r = await deliver(rail, l, sub({ eventId: 'evt_c8b', occurredAt: at(1) }, rail.environment));
        eq(r.applied, 'stale', 'r.applied');
        eq(l.row()?.isActive, 0, 'l.row()?.isActive');
      });
      scenario('a duplicate event id is stored once and acked', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const spec = sub({ eventId: 'evt_c9', occurredAt: at(1) }, rail.environment);
        await deliver(rail, l, spec);
        const again = await deliver(rail, l, spec);
        eq(again.verified, true, 'again.verified');
        eq(again.applied, 'duplicate', 'again.applied');
        eq(l.stored, 1, 'l.stored');
      });
      scenario('a bad signature is refused', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, sub({ eventId: 'evt_c10', occurredAt: at(1) }, rail.environment), { badSignature: true });
        eq(r.verified, false, 'r.verified');
        oneOf(r.status, [400, 401], 'r.status');
        eq(l.stored, 0, 'l.stored');
      });
      scenario('an unknown event type is refused, not crashed', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, { kind: 'unknown', eventId: 'evt_c11', occurredAt: at(1), environment: rail.environment });
        oneOf(r.applied, ['refused', 'ignored'], 'r.applied');
        eq(l.rows.size, 0, 'l.rows.size');
      });
      scenario('an unlinked account is stored and not granted', async (rail) => {
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, sub({ eventId: 'evt_c12', occurredAt: at(1), userId: null }, rail.environment));
        eq(r.verified, true, 'r.verified');
        // Stored, never granted: a rail that cannot name a NIKATRU account refuses the
        // attribution (RevenueCat's anonymous id, [ADR 085] B); one that can stores it unclaimed.
        oneOf(r.applied, ['unlinked', 'refused'], 'r.applied');
        eq(l.stored, 1, 'l.stored');
        eq(l.rows.size, 0, 'l.rows.size');
      });
      scenario('sandbox and live never cross', async (rail) => {
        const other: MoneyEnvironment = rail.environment === 'live' ? 'sandbox' : 'live';
        const l = new ReferenceLedger(rail.environment, NOW);
        const r = await deliver(rail, l, sub({ eventId: 'evt_c13', occurredAt: at(1) }, other));
        ne(r.applied, 'granted', 'r.applied');
        eq(l.rows.size, 0, 'l.rows.size');
      });
    });

    // A rail with no outbound half and nothing outbound pending has no outbound case to run.
    if (probe.outbound === null && OUTBOUND_SCENARIOS.every((s) => pendingOf(s) === undefined)) {
      for (const s of OUTBOUND_SCENARIOS) console.log(`N/A payments/${name}: ${s} — no outbound half (declares no ${RAIL_CAPABILITIES.join(', ')})`);
      return;
    }

    describe('outbound', () => {
      const withNet = async <T>(s: Scenario, f: () => Promise<T>): Promise<T> => {
        const restore = encoder.stubNetwork?.(s) ?? (() => undefined);
        try {
          return await f();
        } finally {
          restore();
        }
      };
      /**
       * An outbound case runs WHEREVER THE CAPABILITY IS DECLARED. A rail that declares it must
       * pass it; a rail that does not must not carry the verb either (declared and implemented,
       * never one without the other — `railCan`). A rail with no outbound half at all (a store
       * aggregator: only the store can sell or cancel) prints N/A and registers nothing.
       */
      const declared = (cap: RailCapability, s: Scenario, body: (rail: RailUnderTest, out: RailOutbound) => Promise<void>) => {
        const row = pendingOf(s);
        if (row !== undefined) {
          console.log(`PENDING payments/${name}: ${s} (${row})`);
          it.todo(`PENDING ${s} (${row})`);
          return;
        }
        if (probe.outbound === null) {
          console.log(`N/A payments/${name}: ${s} — no outbound half (declares no ${RAIL_CAPABILITIES.join(', ')})`);
          return;
        }
        if (!probe.outbound.capabilities.has(cap)) {
          it(`${s} — \`${cap}\` is not declared, and the rail carries no ${VERB_OF[cap]}`, async () => {
            const out = makeRail().outbound;
            truthy(out !== null && !railCan(out, cap), `${name} must not be able to ${cap}`);
            eq(typeof out?.[VERB_OF[cap]], 'undefined', `${name}.${VERB_OF[cap]} (undeclared)`);
          });
          return;
        }
        it(s, async () => {
          const rail = makeRail();
          if (rail.outbound === null) throw new ConformanceFailure(`${name} lost its outbound half between calls`);
          await body(rail, rail.outbound);
        });
      };
      declared('checkout', 'checkout returns a URL on an allowed host plus a reference', async (rail, out) => {
        if (!railCan(out, 'checkout') || encoder.sellable === null) throw new Error(`payments conformance: ${name} declares checkout and has no fixture`);
        const sellable = encoder.sellable;
        const r = await withNet('checkout returns a URL on an allowed host plus a reference', () =>
          out.createCheckout({ ...sellable, userId: 'user-conformance', market: null, environment: rail.environment }),
        );
        eq(r.ok, true, 'r.ok');
        if (!r.ok) return;
        const url = new URL(r.url);
        eq(url.protocol, 'https:', 'url.protocol');
        oneOf(url.host, encoder.checkoutHosts, 'url.host');
        truthy(r.reference.length > 0, 'r.reference.length > 0');
      });
      declared('checkout', 'an unsellable offering is refused', async (rail, out) => {
        if (!railCan(out, 'checkout') || encoder.unsellable === null) throw new Error(`payments conformance: ${name} declares checkout and has no unsellable fixture`);
        const unsellable = encoder.unsellable;
        const r = await out.createCheckout({ ...unsellable, userId: 'user-conformance', market: null, environment: rail.environment });
        eq(r.ok, false, 'r.ok');
        if (r.ok) return;
        eq(r.sent, false, 'r.sent');
        eq(r.kind, 'invalid', 'r.kind');
      });
      declared('cancel', 'cancel at the period end is idempotent', async (rail, out) => {
        if (!railCan(out, 'cancel') || encoder.subscriptionRef === null) throw new Error(`payments conformance: ${name} declares cancel and has no fixture`);
        const req = { subscriptionRef: encoder.subscriptionRef, when: 'period_end' as const, environment: rail.environment };
        const a = await withNet('cancel at the period end is idempotent', () => out.cancel(req));
        const b = await withNet('cancel at the period end is idempotent', () => out.cancel(req));
        eq(a.ok && b.ok, true, 'a.ok && b.ok');
        if (a.ok && b.ok) eq(b.effectiveAt, a.effectiveAt, 'the second cancel\'s effectiveAt');
      });
      declared('refund', 'refund wherever declared', async (rail, out) => {
        if (!railCan(out, 'refund') || encoder.purchaseRef === null) throw new Error(`payments conformance: ${name} declares refund and has no fixture`);
        const req = { purchaseRef: encoder.purchaseRef, amountMinor: null, environment: rail.environment };
        const a = await out.refund(req);
        const b = await out.refund(req);
        eq(a.ok && b.ok, true, 'a.ok && b.ok');
        if (a.ok && b.ok) eq(b.refundRef, a.refundRef, 'the second refund\'s refundRef');
      });
      declared('reconcile', 'reconcile wherever declared', async (rail, out) => {
        if (!railCan(out, 'reconcile') || encoder.subscriptionRef === null) throw new Error(`payments conformance: ${name} declares reconcile and has no fixture`);
        const r = await out.reconcile({ subscriptionRef: encoder.subscriptionRef, environment: rail.environment });
        eq(r.ok, true, 'r.ok');
        if (r.ok) truthy(r.status.length > 0, 'reconcile names a status');
      });
    });
  });
}
