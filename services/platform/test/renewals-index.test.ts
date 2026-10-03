// ─────────────────────────────────────────────────────────────────────────────
// Train T11 · SV-02 — the nightly scans read an INDEX, not the table.
//
// `recomputeRenewals` selects every charging row whose `next_renewal` has
// passed, across ALL users. The only renewal index before subscriptiontracker-
// api's 0010 was (user_id, next_renewal), which a query with no user_id cannot
// use, so every night was a whole-table scan. 0010 adds partial indexes whose
// WHERE is each scan's own predicate — and SQLite uses a partial index only
// when the query carries its terms as written, so a reworded filter falls back
// to `SCAN subscriptions` with no error anywhere. This holds each plan.
//
// THE SQL GRADED IS THE SQL SENT: each pass runs against the real engine with
// `prepare` recorded, and the recorded statement is what EXPLAIN QUERY PLAN
// reads — never a copy of the query typed here, which would stay green while
// the code drifted.
//
// RED CONTROLS: on the tree before 0010 the renewals plan is
// `SCAN subscriptions` (the third test pins that). With 0010 applied, write
// renewals.ts's filter as `status IN ('trialing', 'active')` — the same set in
// the other order — and the first test reds the same way; drop
// `status = 'trialing' AND` from the trial statements and the second does.
// (Measured: SQLite rewrites `status = 'active' OR status = 'trialing'` into
// the IN form, so THAT rewording keeps the index and is not a red control.)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { recomputeRenewals } from '../src/renewals';
import { endTrials, probeHousekeepingSchema, purgeSoftDeleted } from '../src/subscription-housekeeping';
import { RealDb } from './harness';

const APP_MIGRATIONS = import.meta.glob('../../subscriptiontracker-api/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function appDb(): RealDb {
  const names = Object.keys(APP_MIGRATIONS).sort();
  expect(names.some((n) => n.endsWith('/0010_trial_price_still_using.sql'))).toBe(true);
  return new RealDb(names.map((n) => APP_MIGRATIONS[n]));
}

/** The plan SQLite chooses for `sql`, every `?` bound to a harmless value. */
function planOf(db: RealDb, sql: string): string[] {
  const holes = (sql.match(/\?/g) ?? []).length;
  return db.db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array.from({ length: holes }, () => '2026-10-01'))
    .map((r) => String((r as { detail: string }).detail));
}

/** The one recorded statement matching [pattern] — exactly one, or the test is about nothing. */
function sent(db: RealDb, pattern: RegExp): string {
  const hits = db.sql.filter((s) => pattern.test(s));
  expect(hits, `expected ONE statement matching ${pattern}, the pass sent ${hits.length}`).toHaveLength(1);
  return hits[0];
}

describe('SV-02 — the nightly scans use 0010’s partial indexes', () => {
  it('the renewals scan is SEARCH … USING INDEX idx_subscriptions_charging_renewal, never SCAN subscriptions', async () => {
    const db = appDb();
    const out = await recomputeRenewals(db as never, 'subscriptiontracker');
    expect(out.ok, out.detail).toBe(true);
    const plan = planOf(db, sent(db, /FROM subscriptions WHERE next_renewal IS NOT NULL/));
    expect(plan.join(' | ')).toContain('USING INDEX idx_subscriptions_charging_renewal');
    expect(plan.some((step) => /^SCAN subscriptions\b/.test(step)), plan.join(' | ')).toBe(false);
  });

  it('the trial-end and purge scans read their own partial indexes too', async () => {
    const db = appDb();
    const schema = await probeHousekeepingSchema(db as never);
    await endTrials(db as never, schema);
    await purgeSoftDeleted(db as never, schema);

    const trial = planOf(db, sent(db, /^UPDATE subscriptions\s+SET status = 'active',\s+updated_at = \?,\s+price =/));
    expect(trial.join(' | ')).toContain('USING INDEX idx_subscriptions_trial_end');
    const purge = planOf(db, sent(db, /^DELETE FROM subscriptions\s+WHERE/));
    expect(purge.join(' | ')).toContain('USING INDEX idx_subscriptions_deleted');
    for (const plan of [trial, purge]) {
      expect(plan.some((step) => /^SCAN subscriptions\b/.test(step)), plan.join(' | ')).toBe(false);
    }
  });

  it('control: the same renewals SQL on a schema WITHOUT 0010 scans the table', async () => {
    // Proves the assertion above can fail: the plan reader is not blind to a scan.
    const names = Object.keys(APP_MIGRATIONS)
      .sort()
      .filter((n) => !n.endsWith('/0010_trial_price_still_using.sql'));
    const db = new RealDb(names.map((n) => APP_MIGRATIONS[n]));
    await recomputeRenewals(db as never, 'subscriptiontracker');
    const plan = planOf(db, sent(db, /FROM subscriptions WHERE next_renewal IS NOT NULL/));
    expect(plan.some((step) => /^SCAN subscriptions\b/.test(step)), plan.join(' | ')).toBe(true);
  });
});
