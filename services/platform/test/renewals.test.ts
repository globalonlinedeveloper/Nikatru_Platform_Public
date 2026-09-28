import { describe, it, expect } from 'vitest';
import { advance, cadenceOfRow, rollForward, recomputeRenewals, RENEWAL_SOURCE } from '../src/renewals';
import vectors from '../../../contracts/renewals/vectors.json';
import { realPlatformDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// THE HAND-WRITTEN EXAMPLES THAT STOOD HERE LIVE IN contracts/renewals/vectors.json
// NOW — the month-end clamp that replaced the Mar-3 overflow, the 31st matrix,
// the 29th/30th into February, the leap day, the carried anchor, the DST week,
// and the rollForward regressions (a 31st crossing EVERY month, the leap-day
// recovery, the cross-run anchor residual). Each keeps its `why`. They moved so
// that packages/core's RenewalSchedule — what every app SHOWS between these
// nightly passes — is held to the SAME answers: its test iterates the same file.
// Flip one expected date and this suite and that one both go red.
// ─────────────────────────────────────────────────────────────────────────────
type Unit = 'day' | 'week' | 'month' | 'year';
interface AdvanceVector { from: string; every: number; unit: string; anchorDay?: number; to: string; why?: string }
interface RollVector {
  next: string; every: number; unit: string; anchorDay?: number; today: string;
  expectNext: string; crossings: string[]; why?: string;
}
const ADVANCE = vectors.advance as AdvanceVector[];
const ROLL = vectors.rollForward as RollVector[];
const label = (v: { every: number; unit: string; anchorDay?: number; why?: string }, from: string) =>
  `${from} +${v.every} ${v.unit}${v.anchorDay ? ` anchor ${v.anchorDay}` : ''}${v.why ? ` (${v.why})` : ''}`;

describe('renewals: every vector in contracts/renewals/vectors.json', () => {
  it('the vector file is not empty — a suite over nothing proves nothing', () => {
    expect(ADVANCE.length).toBeGreaterThanOrEqual(40);
    expect(ROLL.length).toBeGreaterThanOrEqual(10);
    const units = new Set([...ADVANCE, ...ROLL].map((v) => v.unit));
    expect([...units].sort()).toEqual(['day', 'month', 'week', 'year']);
  });

  for (const v of ADVANCE) {
    it(`advance ${label(v, v.from)}`, () => {
      expect(advance(v.from, { every: v.every, unit: v.unit as Unit }, v.anchorDay)).toBe(v.to);
    });
  }

  for (const v of ROLL) {
    it(`rollForward ${label(v, v.next)}`, () => {
      const r = rollForward(v.next, { every: v.every, unit: v.unit as Unit }, v.today, v.anchorDay);
      expect(r.next).toBe(v.expectNext);
      expect(r.crossings).toEqual(v.crossings);
    });
  }
});

describe('renewals date math (pure core)', () => {
  it('the legacy cycle strings still mean (1, month) and (1, year)', () => {
    // The pre-0003 call shape: every caller before ST-T3b passed a string.
    expect(advance('2026-01-31', 'monthly')).toBe(advance('2026-01-31', { every: 1, unit: 'month' }));
    expect(advance('2024-02-29', 'yearly')).toBe(advance('2024-02-29', { every: 1, unit: 'year' }));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EXHAUSTIVE MATRIX. The hand-written cases above name the interesting dates;
  // these two quantify over ALL of them, so a fix that happens to satisfy the
  // named cases and nothing else cannot pass. Both are properties, not examples.
  // ───────────────────────────────────────────────────────────────────────────
  it('EXHAUSTIVE: 12 monthly advances from any anchor land back on that anchor', () => {
    // The headline invariant. Pre-fix, Jan 31 x12 drifted to the 3rd of a month
    // and never came back; the "anchor" was destroyed on the very first step.
    // Quantified over every start month, every anchor day 1..31, in a common
    // year (2026) and a leap year (2024) — 2 x 12 x 31 = 744 chains.
    const failures: string[] = [];
    let checked = 0;
    for (const year of [2024, 2026]) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= 31; day++) {
          const start = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          // Skip start dates that do not exist (e.g. 2026-02-30).
          if (new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start) continue;
          checked++;
          let cur = start;
          for (let i = 0; i < 12; i++) cur = advance(cur, 'monthly', day);
          const want = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          // Feb 29 is the one honest exception: 12 months on from a leap day in
          // a common year is Feb 28, and clamping is the correct answer.
          const expected =
            new Date(`${want}T00:00:00Z`).toISOString().slice(0, 10) === want
              ? want
              : `${year + 1}-02-28`;
          if (cur !== expected) failures.push(`${start} x12 -> ${cur}, wanted ${expected}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // COVERAGE: 366 real dates in 2024 + 365 in 2026. Without this the whole
    // matrix could quietly iterate over nothing and still report PASS — the
    // exact failure mode this repo keeps hitting with its scanners.
    expect(checked).toBe(731);
  });

  it('EXHAUSTIVE: every single advance yields a REAL date, exactly one month on', () => {
    // Two properties at once, over every real date in a leap year and a common
    // year: (i) the result is a date that exists — the overflow produced "Feb
    // 31" and let JS silently renormalise it into March; (ii) the month always
    // moves by exactly one, so no cycle is ever skipped or repeated, which is
    // what dropped a payment_history row every month.
    const bad: string[] = [];
    let checked = 0;
    for (const year of [2024, 2026]) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= 31; day++) {
          const start = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          if (new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start) continue;
          checked++;
          const got = advance(start, 'monthly');
          if (new Date(`${got}T00:00:00Z`).toISOString().slice(0, 10) !== got) {
            bad.push(`${start} -> ${got} is not a real date`);
            continue;
          }
          const months = (y: string) => Number(y.slice(0, 4)) * 12 + Number(y.slice(5, 7));
          if (months(got) - months(start) !== 1) bad.push(`${start} -> ${got} moved ≠ 1 month`);
          if (got > start === false) bad.push(`${start} -> ${got} did not move forward`);
          // Never overshoots the anchor: the day is the anchor, or the clamp.
          if (Number(got.slice(8)) > day) bad.push(`${start} -> ${got} overshot day ${day}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBe(731); // see the coverage note above
  });

  it('rejects a date it cannot parse rather than inventing one', () => {
    expect(() => advance('not-a-date', 'monthly')).toThrow(RangeError);
    expect(() => advance('2026-13-01', 'monthly')).toThrow(RangeError);
    expect(() => advance('2026-00-10', 'monthly')).toThrow(RangeError);
  });

  it('rollForward: the backlog guard still caps a pathological gap', () => {
    const r = rollForward('1900-01-31', 'monthly', '2026-07-21');
    expect(r.crossings).toHaveLength(240);
  });

  it('rollForward: the final next is always >= today', () => {
    const r = rollForward('2020-01-01', 'monthly', '2026-07-21');
    expect(r.next >= '2026-07-21').toBe(true);
  });

  it('rollForward: a full year on the 31st never loses or repeats a month', () => {
    const r = rollForward('2026-01-31', 'monthly', '2027-01-31');
    expect(r.crossings).toHaveLength(12);
    expect(new Set(r.crossings.map((d) => d.slice(0, 7))).size).toBe(12);
    // Ends where it started: the anchor survives all four short months.
    expect(r.next).toBe('2027-01-31');
    expect(r.crossings.filter((d) => d.endsWith('-31'))).toHaveLength(7);
  });

  it('refuses a cadence it cannot read rather than guessing a month', () => {
    expect(() => advance('2026-01-01', { every: 0, unit: 'month' })).toThrow(RangeError);
    expect(() => advance('2026-01-01', { every: 1, unit: 'fortnight' as Unit })).toThrow(RangeError);
  });

  it('cadenceOfRow: the 0003 pair wins, the legacy cycle is the fallback, anything else is null', () => {
    expect(cadenceOfRow({ cycle: null, cycle_every: 1, cycle_unit: 'week' })).toEqual({ every: 1, unit: 'week' });
    expect(cadenceOfRow({ cycle: 'monthly', cycle_every: 1, cycle_unit: 'month' })).toEqual({ every: 1, unit: 'month' });
    expect(cadenceOfRow({ cycle: 'yearly' })).toEqual({ every: 1, unit: 'year' });
    expect(cadenceOfRow({ cycle: 'monthly', cycle_every: null, cycle_unit: null })).toEqual({ every: 1, unit: 'month' });
    expect(cadenceOfRow({ cycle: null, cycle_every: 1, cycle_unit: 'fortnight' })).toBeNull();
    expect(cadenceOfRow({ cycle: null, cycle_every: 0, cycle_unit: 'day' })).toBeNull();
    expect(cadenceOfRow({ cycle: null })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE NIGHTLY PASS OVER A 0003 DATABASE ([ADR no.077] §5, ST-M3 + ST-E3).
// Real SQL engine, so "rolled" is a date read back and "wrote its history" is a
// COUNT of payment_history rows — not a record of which methods a double saw.
// ─────────────────────────────────────────────────────────────────────────────
describe('recomputeRenewals over the 0003 columns', () => {
  /** subscriptiontracker_db's shape after 0003: the columns this pass reads. */
  function modelDb() {
    return realPlatformDb([
      `CREATE TABLE subscriptions (
         id TEXT PRIMARY KEY, user_id TEXT, price REAL, cycle TEXT, next_renewal TEXT, updated_at TEXT,
         currency TEXT, cycle_every INTEGER, cycle_unit TEXT,
         status TEXT NOT NULL DEFAULT 'active', deleted_at TEXT
       )`,
      `CREATE TABLE payment_history (
         id TEXT PRIMARY KEY, subscription_id TEXT, user_id TEXT, amount REAL, paid_at TEXT,
         updated_at TEXT, currency TEXT, source TEXT
       )`,
    ]);
  }
  const insert = (
    db: ReturnType<typeof modelDb>,
    id: string,
    cols: Record<string, string | number | null>,
  ) => {
    const all: Record<string, string | number | null> = { id, user_id: 'u1', price: 5, ...cols };
    const keys = Object.keys(all);
    db.db.prepare(`INSERT INTO subscriptions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
      ...keys.map((k) => all[k]),
    );
  };
  const nextOf = (db: ReturnType<typeof modelDb>, id: string) =>
    db.rows('SELECT next_renewal FROM subscriptions WHERE id = ?', id)[0].next_renewal;

  it('a WEEKLY row (cycle NULL) IS rolled, and writes one payment per week crossed', async () => {
    const db = modelDb();
    insert(db, 'w', { cycle: null, cycle_every: 1, cycle_unit: 'week', next_renewal: '2020-01-01', currency: 'INR' });
    const out = await recomputeRenewals(db as never, 'subscriptiontracker');
    expect(out.ok, out.detail).toBe(true);
    const next = String(nextOf(db, 'w'));
    expect(next > '2020-01-01').toBe(true);
    // Every crossing is a Wednesday like the first charge: 7-day steps, no month math.
    const paid = db.rows('SELECT paid_at, currency, source FROM payment_history WHERE subscription_id = ?', 'w');
    expect(paid.length).toBeGreaterThan(0);
    for (const p of paid) {
      expect(new Date(String(p.paid_at)).getUTCDay()).toBe(new Date('2020-01-01T00:00:00Z').getUTCDay());
      // ST-E3: the payment carries its own currency and who recorded it.
      expect(p).toMatchObject({ currency: 'INR', source: RENEWAL_SOURCE });
    }
  });

  it('every-10-days and quarterly rows roll by their own cadence', async () => {
    const db = modelDb();
    insert(db, 'd10', { cycle_every: 10, cycle_unit: 'day', next_renewal: '2020-01-01' });
    insert(db, 'q', { cycle_every: 3, cycle_unit: 'month', next_renewal: '2020-01-31' });
    await recomputeRenewals(db as never, 'subscriptiontracker');
    const d10 = db.rows("SELECT paid_at FROM payment_history WHERE subscription_id = 'd10' ORDER BY paid_at");
    expect(d10.slice(0, 3).map((r) => String(r.paid_at).slice(0, 10))).toEqual(['2020-01-01', '2020-01-11', '2020-01-21']);
    const q = db.rows("SELECT paid_at FROM payment_history WHERE subscription_id = 'q' ORDER BY paid_at");
    expect(q.slice(0, 3).map((r) => String(r.paid_at).slice(0, 10))).toEqual(['2020-01-31', '2020-04-30', '2020-07-31']);
  });

  it('a PAUSED, CANCELLED or DELETED row is not rolled and gets no payment', async () => {
    const db = modelDb();
    insert(db, 'paused', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'month', next_renewal: '2020-01-15', status: 'paused' });
    insert(db, 'cancelled', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'month', next_renewal: '2020-01-15', status: 'cancelled' });
    insert(db, 'deleted', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'month', next_renewal: '2020-01-15', deleted_at: '2026-09-01T00:00:00Z' });
    // The control: the same row, active, IS rolled — so "not rolled" above is
    // the filter and not a pass that rolled nothing at all.
    insert(db, 'active', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'month', next_renewal: '2020-01-15' });
    insert(db, 'trialing', { cycle: 'monthly', cycle_every: 1, cycle_unit: 'month', next_renewal: '2020-01-15', status: 'trialing' });
    await recomputeRenewals(db as never, 'subscriptiontracker');
    for (const id of ['paused', 'cancelled', 'deleted']) {
      expect(nextOf(db, id), id).toBe('2020-01-15');
      expect(db.count('payment_history', 'subscription_id = ?', id), id).toBe(0);
    }
    for (const id of ['active', 'trialing']) {
      expect(nextOf(db, id), id).not.toBe('2020-01-15');
      expect(db.count('payment_history', 'subscription_id = ?', id), id).toBeGreaterThan(0);
    }
  });

  it('a unit this build cannot read is SKIPPED and counted, never rolled as a month', async () => {
    const db = modelDb();
    insert(db, 'odd', { cycle: null, cycle_every: 1, cycle_unit: 'fortnight', next_renewal: '2020-01-15' });
    const out = await recomputeRenewals(db as never, 'subscriptiontracker');
    expect(out.ok).toBe(true);
    expect(out.detail).toMatch(/SKIPPED 1/);
    expect(nextOf(db, 'odd')).toBe('2020-01-15');
    expect(db.count('payment_history')).toBe(0);
  });
});
