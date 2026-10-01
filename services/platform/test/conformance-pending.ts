// ⏱ 2026-10-01 · port-pay-core · the PENDING cases tooling/ports/payments.json declares for one
// adapter, keyed by scenario, so a conformance test file never restates the registry.
import payments from '../../../tooling/ports/payments.json';
import type { Scenario } from '../../_shared/test/conformance/payments';

export function pendingFor(adapter: string): Partial<Record<Scenario, string>> {
  const out: Partial<Record<Scenario, string>> = {};
  for (const p of payments.conformance.pending) if (p.adapter === adapter) out[p.case as Scenario] = p.row;
  return out;
}
