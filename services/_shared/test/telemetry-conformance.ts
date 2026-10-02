// ─────────────────────────────────────────────────────────────────────────────
// telemetry-conformance.ts — THE WORKER HALF'S CONFORMANCE SCENARIOS for the
// telemetry port (services/_shared/src/ports/telemetry.ts). Not a test file: the
// adapters' tests CALL these runners (tooling/ports/README.md §3 "Conformance").
//
// A scenario list plus a PER-ADAPTER FIXTURE: the fixture builds the adapter in
// the world the scenario needs (a sink that accepts, one that is down, none
// configured) and says how many network requests that world saw. The runner
// THROWS when a scenario has no fixture for the adapter under test — a missing
// fixture is never a skip.
// ─────────────────────────────────────────────────────────────────────────────
import { expect, it } from 'vitest';
import type { ErrorSink, Notifier, OwnerAlert, SinkContext, TelemetryOutcome } from '../src/ports/telemetry';

export const TELEMETRY_SCENARIOS = ['accepts', 'outage', 'unconfigured'] as const;
export type TelemetryScenario = (typeof TELEMETRY_SCENARIOS)[number];

/** The adapter, built for one scenario, plus how many requests it made so far. */
export interface Arranged<T> {
  adapter: T;
  requests(): number;
}

export type TelemetryFixtures<T> = Partial<Record<TelemetryScenario, () => Arranged<T>>>;

const CTX: SinkContext = { service: 'conformance', release: 'cafe1234', requestId: 'rid-c', method: 'GET', path: '/v1/x' };
const ALERT: OwnerAlert = { severity: 'critical', title: 'Box B unreachable', body: 'https://ntfy.example.test/ — HTTP 530', dedupeKey: 'boxb_reachability' };

function fixtureFor<T>(name: string, fixtures: TelemetryFixtures<T>, s: TelemetryScenario): () => Arranged<T> {
  const f = fixtures[s];
  if (!f) throw new Error(`conformance: adapter \`${name}\` has no fixture for scenario \`${s}\`. A missing fixture is never a skip.`);
  return f;
}

async function expectGraded(run: () => Promise<TelemetryOutcome>, s: TelemetryScenario, requests: () => number): Promise<void> {
  let outcome: TelemetryOutcome | undefined;
  await expect((async () => { outcome = await run(); })(), 'the port never throws').resolves.toBeUndefined();
  if (s === 'accepts') {
    expect(outcome?.ok, JSON.stringify(outcome)).toBe(true);
    expect(requests()).toBe(1);
  } else if (s === 'outage') {
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) {
      expect(['unavailable', 'timeout']).toContain(outcome.kind);
      expect(outcome.retryable).toBe(true);
    }
    expect(requests()).toBe(1);
  } else {
    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) expect(outcome.kind).toBe('invalid');
    expect(requests(), 'an unconfigured adapter sends nothing').toBe(0);
  }
}

/** Every scenario, for one `ErrorSink` adapter. */
export function runErrorSinkConformance(name: string, fixtures: TelemetryFixtures<ErrorSink>): void {
  for (const s of TELEMETRY_SCENARIOS) fixtureFor(name, fixtures, s); // throws now, before any case is registered
  for (const s of TELEMETRY_SCENARIOS) {
    it(`ErrorSink conformance · ${name} · ${s}`, async () => {
      const { adapter, requests } = fixtureFor(name, fixtures, s)();
      await expectGraded(() => adapter.report(new TypeError('conformance'), CTX, new Date('2026-10-01T00:00:00Z')), s, requests);
    });
  }
}

/** Every scenario, for one `Notifier` adapter. */
export function runNotifierConformance(name: string, fixtures: TelemetryFixtures<Notifier>): void {
  for (const s of TELEMETRY_SCENARIOS) fixtureFor(name, fixtures, s); // throws now, before any case is registered
  for (const s of TELEMETRY_SCENARIOS) {
    it(`Notifier conformance · ${name} · ${s}`, async () => {
      const { adapter, requests } = fixtureFor(name, fixtures, s)();
      await expectGraded(() => adapter.notify(ALERT), s, requests);
    });
  }
}
