import { describe, it, expect } from 'vitest';
import inventoryRaw from '../../../tooling/legal/data-inventory.json?raw';
import registerRaw from '../../../tooling/ops/register.json?raw';
import { FEEDBACK_RETENTION_DAYS } from '../src/lib/limits';

// ─────────────────────────────────────────────────────────────────────────────
// retention.test.ts — 🔴 [Do 7] ONE NUMBER, THREE HOMES, HELD EQUAL.
//
// The 90 days live in tooling/legal/data-inventory.json (the privacy notice's
// home), in tooling/ops/register.json (the retention rule
// assert-retention-coverage.mjs enumerates), and in FEEDBACK_RETENTION_DAYS
// (what the cron actually deletes at). assert-retention-coverage holds the first
// two equal; this holds the code to them, the way services/platform's
// retention-sweep.test.ts does for its own stores. Removing the register rows
// fails the coverage guard (the store set is enumerated from migrations).
// ─────────────────────────────────────────────────────────────────────────────

const inventory = JSON.parse(inventoryRaw) as { stores: Array<{ id: string; retention?: { kind?: string; periodDays?: number } }> };
const register = JSON.parse(registerRaw) as { rows: Array<{ id: string; rule?: string; periodDays?: number }> };

describe('the feedback retention period agrees in all three homes', () => {
  for (const [inv, reg] of [
    ['table:platform_db.feedback_reports', 'retention.d1.platform_db.feedback_reports'],
    ['r2:nikatru-feedback', 'retention.r2.feedback.SCREENSHOTS'],
  ] as const) {
    it(`${inv} — inventory, register and code all say ${FEEDBACK_RETENTION_DAYS} days`, () => {
      const i = inventory.stores.find((s) => s.id === inv);
      const r = register.rows.find((x) => x.id === reg);
      expect(i?.retention).toMatchObject({ kind: 'swept', periodDays: FEEDBACK_RETENTION_DAYS });
      expect(r).toMatchObject({ rule: 'period', periodDays: FEEDBACK_RETENTION_DAYS });
    });
  }

  it('the period is the brief’s: 90 days', () => {
    expect(FEEDBACK_RETENTION_DAYS).toBe(90);
  });
});
