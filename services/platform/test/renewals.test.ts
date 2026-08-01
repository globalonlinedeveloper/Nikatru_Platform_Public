import { describe, it, expect } from 'vitest';
import { advance, rollForward } from '../src/renewals';

describe('renewals date math (pure core)', () => {
  it('advances one month in UTC', () => {
    expect(advance('2026-01-15', 'monthly')).toBe('2026-02-15');
    expect(advance('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('advances one year in UTC', () => {
    expect(advance('2026-03-10', 'yearly')).toBe('2027-03-10');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MONTH-END. This block replaces a test that asserted the BUG as the spec
  // ("Jan 31 + 1 month → Mar 3: stable + documented"). Determinism was never the
  // property that mattered: `setUTCMonth` overflowed Feb 31 into Mar 3, which
  // SKIPPED February's payment_history row and moved the renewal day to the 3rd
  // permanently. Every 29th/30th/31st anchor was affected.
  // ───────────────────────────────────────────────────────────────────────────
  it('month-end CLAMPS instead of overflowing into the next month', () => {
    // The exact case the old test blessed: Feb has 28 days in 2026, so the
    // clamp lands on the 28th — never Mar 3.
    expect(advance('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advance('2026-01-31', 'monthly')).not.toBe('2026-03-03');
  });

  it('the 31st edge matrix: every short month clamps, no month is skipped', () => {
    const cases: Array<[string, string]> = [
      ['2026-01-31', '2026-02-28'], // 31 → short Feb (common year)
      ['2026-03-31', '2026-04-30'], // 31 → 30-day month
      ['2026-04-30', '2026-05-30'], // 30 in a 31-day month stays 30
      ['2026-05-31', '2026-06-30'],
      ['2026-07-31', '2026-08-31'], // 31 → 31, untouched
      ['2026-08-31', '2026-09-30'],
      ['2026-10-31', '2026-11-30'],
      ['2026-12-31', '2027-01-31'], // year rollover
    ];
    for (const [from, to] of cases) expect(advance(from, 'monthly'), from).toBe(to);
  });

  it('the 30th and 29th anchors clamp to February, leap and common', () => {
    expect(advance('2026-01-30', 'monthly')).toBe('2026-02-28'); // common year
    expect(advance('2026-01-29', 'monthly')).toBe('2026-02-28');
    expect(advance('2024-01-30', 'monthly')).toBe('2024-02-29'); // leap year
    expect(advance('2024-01-29', 'monthly')).toBe('2024-02-29');
    expect(advance('2024-01-28', 'monthly')).toBe('2024-02-28'); // no clamp needed
  });

  it('leap-day yearly clamps to Feb 28, never spills into March', () => {
    expect(advance('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(advance('2024-02-29', 'yearly')).not.toBe('2025-03-01');
    // Centurial rule: 2100 is NOT a leap year, 2000 was.
    expect(advance('2099-02-28', 'yearly', 29)).toBe('2100-02-28');
    expect(advance('1999-02-28', 'yearly', 29)).toBe('2000-02-29');
  });

  it('the anchor day is a parameter, so a caller can carry it across a clamp', () => {
    // Feb 28 with a 31st anchor must return to the 31st in March.
    expect(advance('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    // …and without the anchor it stays on the 28th. Both are correct; which one
    // you get is exactly what rollForward's threading decides.
    expect(advance('2026-02-28', 'monthly')).toBe('2026-03-28');
  });

  it('is UTC-only: no local timezone or DST can move the result', () => {
    // Pure string→string arithmetic, no Date parsing of the input, so a runner
    // in any TZ gets the same answer. Asserted over a DST-transition window.
    for (const d of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01']) {
      expect(advance(d, 'monthly').slice(8)).toBe(d.slice(8));
    }
    expect(advance('2026-03-08', 'monthly')).toBe('2026-04-08');
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

  it('rollForward: nothing crossed when already today-or-future', () => {
    const r = rollForward('2026-07-25', 'monthly', '2026-07-21');
    expect(r.next).toBe('2026-07-25');
    expect(r.crossings).toEqual([]);
  });

  it('rollForward: rolls a past-due date to today-or-future, recording each crossing', () => {
    const r = rollForward('2026-05-10', 'monthly', '2026-07-21');
    // 2026-05-10 → 06-10 → 07-10 → 08-10 (first >= today)
    expect(r.next).toBe('2026-08-10');
    expect(r.crossings).toEqual(['2026-05-10', '2026-06-10', '2026-07-10']);
  });

  it('rollForward: yearly cadence', () => {
    const r = rollForward('2024-02-01', 'yearly', '2026-07-21');
    expect(r.crossings).toEqual(['2024-02-01', '2025-02-01', '2026-02-01']);
    expect(r.next).toBe('2027-02-01');
  });

  it('rollForward: the final next is always >= today', () => {
    const r = rollForward('2020-01-01', 'monthly', '2026-07-21');
    expect(r.next >= '2026-07-21').toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REGRESSION — the two user-visible wrongs the overflow caused. Before the
  // fix this call returned next='2026-08-03' with SIX crossings and NO February
  // one, so the nightly cron wrote one payment_history row too few (the user's
  // spend total was permanently short a charge) and reported the renewal day as
  // the 3rd forever.
  // ───────────────────────────────────────────────────────────────────────────
  it('rollForward: a 31st anchor crosses EVERY month and keeps the 31st', () => {
    const r = rollForward('2026-01-31', 'monthly', '2026-07-31');
    expect(r.crossings).toEqual([
      '2026-01-31',
      '2026-02-28', // present — the overflow skipped February entirely
      '2026-03-31', // and the anchor is BACK on the 31st, not stuck on the 28th
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(r.next).toBe('2026-07-31');
    // One crossing per calendar month, none skipped, none duplicated.
    expect(r.crossings.map((d) => d.slice(0, 7))).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('rollForward: a full year on the 31st never loses or repeats a month', () => {
    const r = rollForward('2026-01-31', 'monthly', '2027-01-31');
    expect(r.crossings).toHaveLength(12);
    expect(new Set(r.crossings.map((d) => d.slice(0, 7))).size).toBe(12);
    // Ends where it started: the anchor survives all four short months.
    expect(r.next).toBe('2027-01-31');
    expect(r.crossings.filter((d) => d.endsWith('-31'))).toHaveLength(7);
  });

  it('rollForward: yearly on a leap day clamps, then RECOVERS on the next leap year', () => {
    const r = rollForward('2024-02-29', 'yearly', '2028-01-01');
    expect(r.crossings).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
    expect(r.next).toBe('2028-02-29');
  });

  it('rollForward: the backlog guard still caps a pathological gap', () => {
    const r = rollForward('1900-01-31', 'monthly', '2026-07-21');
    expect(r.crossings).toHaveLength(240);
  });

  // ⬜ KNOWN RESIDUAL, pinned so it stays known. `subscriptions` has no anchor
  // column, so the anchor cannot survive BETWEEN nightly runs: the row stores
  // the clamped 2026-02-28 and the next pass reads a 28th anchor. That costs at
  // most three days once a year and skips no cycle — unlike the overflow, which
  // dropped a charge every single month. Recovering it needs an additive
  // `renewal_anchor_day` column in subly_db, which this Worker does not own.
  it('rollForward: documents the cross-run anchor limit (no schema for it yet)', () => {
    const r = rollForward('2026-02-28', 'monthly', '2026-03-01');
    expect(r.next).toBe('2026-03-28'); // not 2026-03-31 — see the note above
    expect(r.crossings).toEqual(['2026-02-28']);
  });
});
