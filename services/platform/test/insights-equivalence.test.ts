import { describe, it, expect, beforeAll } from 'vitest';

import { eventsRollup, rolledThrough } from '../src/scheduled';
import type { Env } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// insights-equivalence.test.ts — [11]E-11, [ADR 045]. THE CUTOVER CHANGED NO
// NUMBER, MEASURED — and this file exists because that sentence was already in
// the tree as a CLAIM before anything measured it.
//
// 🔴 THE DEFECT THIS PAYS OFF. `migrations/0007_events_rollup.sql` shipped
// saying the five insights queries "return BIT-IDENTICAL results from this table
// as from raw `events` across 45 (metric × app × window) combinations" and named
// `test/events-rollup.test.ts` as "that proof". That file contains ZERO
// references to the insights queries — it tests the interlock, idempotency,
// catch-up and the heartbeat, and reads no .sql at all. The claim was TRUE and
// the citation was to a proof that did not exist: the same [8]K-12 defect the
// same header had already been corrected for once. This file is the measurement,
// and 0007, `assert-rollup-lossless.mjs` and [ADR 045] §8.2 now cite it instead.
//
// ⚠️ WHAT MAKES THIS A PROOF RATHER THAN A RESTATEMENT. Both sides run against
// ONE seeded database:
//   · the RAW side is `test/baselines/insights-raw/*.sql` — the FROZEN
//     pre-cutover text, byte-identical below its banner to what shipped in
//     51bf1a2, reading `events`;
//   · the ROLLUP side is the SHIPPED `queries/insights/*.sql`, reading
//     `events_daily`, which is populated by calling the SHIPPED `eventsRollup`
//     from src/scheduled.ts — never by hand-INSERTing rollup rows, which would
//     declare the grain a second time and let the two drift silently.
// Neither side is written by this file. What this file supplies is the fixture
// and the comparison.
//
// 🔴 THE THREE WAYS THIS TEST COULD PASS WITHOUT CHECKING ANYTHING, AND WHAT
// STOPS EACH:
//   1. BOTH SIDES EMPTY. 75 comparisons of `[]` against `[]` is 75 green
//      assertions about nothing — and the empty case is the DEFAULT here, since
//      production holds 0 rows. → the last test in the comparison block requires
//      every metric to have produced at least one result carrying a non-zero
//      number. (Negative-tested: emptying `fixtureRows()` turns that test red.)
//   2. THE TWO TEXTS ARE THE SAME TEXT. If a baseline were ever "updated to
//      match" the shipped query, the comparison becomes a string against itself.
//      → the baselines must read `events` and never mention `events_daily` (in
//      CODE, not in prose — the banner mentions it), the shipped queries must be
//      the other way round, and the two bodies must differ.
//   3. THE ROLLUP NEVER RAN. `events_daily` empty makes every rollup-side answer
//      zeros and NULLs. → the rollup must have consumed through the last complete
//      day, and `events_daily` must hold FEWER rows than `events` (proving rows
//      actually collapsed rather than being copied one for one).
// ─────────────────────────────────────────────────────────────────────────────

const envOf = (db: RealDb) => ({ PLATFORM_DB: db }) as unknown as Env;

/**
 * The five, named independently of `insights-queries.test.ts`.
 *
 * A SECOND, DELIBERATE STATEMENT of the set. Importing that file's
 * REQUIRED_COVERAGE would mean one deletion silently shrinks both floors at
 * once; two independent lists that must agree with the directory make a
 * disappearing query fail in two places instead of none.
 */
const REQUIRED_IDS = [
  'activation_rate',
  'retention_d1_d7_d30',
  'paywall_conversion',
  'notification_lift',
  'feature_adoption',
] as const;

type NumberId = (typeof REQUIRED_IDS)[number];

const SHIPPED_MODULES = import.meta.glob('../queries/insights/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const BASELINE_MODULES = import.meta.glob('./baselines/insights-raw/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** `-- number: <id>` off a file's header — structural, never a body search. */
function declaredId(sql: string): string | null {
  return sql.match(/^--\s*number:\s*([a-z0-9_]+)\s*$/m)?.[1] ?? null;
}

/**
 * `--` comments out, STRING LITERALS PRESERVED.
 *
 * Written as a scanner rather than a regex for the reason this repo keeps
 * relearning: these files' comments are SQL-shaped — they quote the very
 * statements they explain, and the baseline banner names `events_daily` in
 * prose while the code beneath it must never mention it. A structural check
 * that read the prose would fail on the sentence describing the check.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      out += c;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Table names appearing after FROM/JOIN in the CODE. */
function baseTables(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripSqlComments(sql).matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/** Comments out AND string literals collapsed, so a `?2` quoted inside an
 *  explanatory literal could never be counted as a bound parameter. */
const reduceToCode = (sql: string): string => stripSqlComments(sql).replace(/'(?:[^']|'')*'/g, "''");

/**
 * Every `?N` reference in the CODE, in order of appearance.
 *
 * This is how "the caller contract did not change" stops being prose. The
 * cutover moved the comparison from `server_ts >= ?2` to
 * `day >= substr(?2, 1, 10)` — the parameter is wrapped in an expression now,
 * which is exactly the kind of edit that grows a fourth parameter or drops to an
 * unnumbered `?` without anyone noticing, because both still RUN.
 */
function paramRefs(sql: string): { indexes: number[]; refs: number; bare: number } {
  const code = reduceToCode(sql);
  const idx = [...code.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return {
    indexes: [...new Set(idx)].sort((a, b) => a - b),
    refs: idx.length,
    // A bare `?` is positional-by-appearance rather than by number, so mixing
    // the two silently re-orders every bind after it.
    bare: (code.match(/\?(?!\d)/g) ?? []).length,
  };
}

interface Pair {
  readonly id: string;
  readonly file: string;
  readonly shipped: string;
  readonly baseline: string;
}

function loadById(modules: Record<string, string>): Map<string, { file: string; sql: string }> {
  const out = new Map<string, { file: string; sql: string }>();
  for (const [path, sql] of Object.entries(modules)) {
    const id = declaredId(sql);
    if (id !== null) out.set(id, { file: path.split('/').pop() ?? path, sql });
  }
  return out;
}

const SHIPPED = loadById(SHIPPED_MODULES);
const BASELINES = loadById(BASELINE_MODULES);

const PAIRS: Pair[] = REQUIRED_IDS.filter((id) => SHIPPED.has(id) && BASELINES.has(id)).map((id) => ({
  id,
  file: SHIPPED.get(id)!.file,
  shipped: SHIPPED.get(id)!.sql,
  baseline: BASELINES.get(id)!.sql,
}));

// ─────────────────────────────────────────────────────────────────────────────
// THE FIXTURE.
//
// Not the fixture from insights-queries.test.ts. That one is tuned so every
// percentage is an exact binary fraction against ONE app and ONE window, and its
// job is to grade the queries against numbers a human computed by hand. THIS
// one's job is different: it is built to make the two forms DISAGREE if they can,
// so it carries the rows where a day-grain rollup is most likely to diverge from
// the raw table.
//
// THE ADVERSARIAL ROWS, and what each one would break:
//   A. TWO `first_launch` ROWS FOR ONE INSTALL ON ONE DAY (`s1`). They collapse
//      into a single `events_daily` row with `n_rows = 2`. Any count that reached
//      for `n_rows` instead of counting installs doubles the cohort here.
//   B. A SECOND `first_launch` ON A LATER DAY (`s2`, a reinstall onto the same
//      id). `MIN(day)` must pick the first, or every day offset measured from it
//      is wrong and D1/D7/D30 all move.
//   C. A `return_visit` EARLIER IN THE DAY THAN THE LAUNCH (`s4`, 08:00 against a
//      10:00 launch). The raw form compared INSTANTS and excluded it; the rollup
//      form compares DAYS and includes it with `day_n = 0`. Both must still
//      report the same three retention numbers — this is the one adversarial row
//      whose two forms genuinely see different SETS.
//   D. `feature_used` WITH `'{}'` PARAMS (`s6`). It must not become a feature
//      named NULL on the raw side nor a feature named `''` on the rollup side.
//   E. MULTI-ROW-PER-DAY REPEATS (`s1`'s three paywall views on one day, `s1`'s
//      two `budget_view` uses on one day, `s1`'s two notification opens on one
//      day). These are what `n_rows` is FOR, and #5's `uses` is the only metric
//      that must follow it. Anywhere else, following it is the bug.
//   F. AN INSTALL WITH NO LAUNCH AT ALL (`s7`, one `return_visit`). It is in the
//      ACTIVE population that #4 and #5 divide by, and in no cohort.
//   G. NEGATIVE CONTROLS: app `lingo` mirrors the shape, app `nope` has no rows,
//      and `s99` sits outside every window but inside the rolled-up range.
//
// ⚠️ WHAT IS DELIBERATELY *NOT* HERE: `{"name":""}` and `{"name":42}`. Those two
// are KNOWN DIVERGENCES, measured in their own describe block below rather than
// hidden inside a fixture that has to come out equal. Putting them here would
// have forced either a false claim or a weakened comparison.
// ─────────────────────────────────────────────────────────────────────────────

interface Row {
  app: string;
  anon: string;
  event: string;
  ts: string;
  params?: string;
}

function fixtureRows(): Row[] {
  const rows: Row[] = [];
  const add = (app: string, anon: string, event: string, ts: string, params = '{}') =>
    rows.push({ app, anon, event, ts, params });

  const COHORT = ['s1', 's2', 's3', 's4', 's5', 's6'];

  // ── subly ────────────────────────────────────────────────────────────────
  for (const a of COHORT) add('subly', a, 'first_launch', '2026-03-01T10:00:00.000Z');
  add('subly', 's1', 'first_launch', '2026-03-01T10:00:05.000Z'); // A · same day, twice
  add('subly', 's2', 'first_launch', '2026-03-05T08:00:00.000Z'); // B · reinstall, later day

  for (const a of ['s1', 's2', 's3']) add('subly', a, 'activation', '2026-03-01T10:05:00.000Z');
  add('subly', 's4', 'activation', '2026-03-20T11:00:00.000Z'); // activation days after the launch

  // retention: D1 = s1 s2 s3 · D7 = s1 s2 · D30 = s1 · s5 returns on day 3 (none)
  for (const a of ['s1', 's2', 's3']) add('subly', a, 'return_visit', '2026-03-02T09:00:00.000Z');
  for (const a of ['s1', 's2']) add('subly', a, 'return_visit', '2026-03-08T09:00:00.000Z');
  add('subly', 's1', 'return_visit', '2026-03-31T09:00:00.000Z');
  add('subly', 's5', 'return_visit', '2026-03-04T09:00:00.000Z');
  add('subly', 's4', 'return_visit', '2026-03-01T08:00:00.000Z'); // C · before its own launch

  // funnel, with E's repeats at the top of it
  for (const a of COHORT) add('subly', a, 'paywall_viewed', '2026-03-03T12:00:00.000Z');
  add('subly', 's1', 'paywall_viewed', '2026-03-03T12:05:00.000Z');
  add('subly', 's1', 'paywall_viewed', '2026-03-03T12:10:00.000Z');
  for (const a of ['s1', 's2', 's3']) add('subly', a, 'checkout_started', '2026-03-03T12:01:00.000Z');
  for (const a of ['s1', 's2']) add('subly', a, 'purchase_success', '2026-03-03T12:02:00.000Z');
  add('subly', 's3', 'purchase_failed', '2026-03-03T12:02:00.000Z');

  // notifications
  for (const a of ['s1', 's2', 's3']) add('subly', a, 'notification_opened', '2026-03-06T08:00:00.000Z');
  add('subly', 's1', 'notification_opened', '2026-03-06T08:30:00.000Z'); // E
  add('subly', 's6', 'notif_opt_out', '2026-03-06T08:30:00.000Z');

  // features
  const used = (app: string, a: string, name: string, ts: string) =>
    add(app, a, 'feature_used', ts, JSON.stringify({ name }));
  used('subly', 's1', 'budget_view', '2026-03-03T13:00:00.000Z');
  used('subly', 's1', 'budget_view', '2026-03-03T13:30:00.000Z'); // E · same day, same feature
  used('subly', 's2', 'budget_view', '2026-03-03T13:00:00.000Z');
  used('subly', 's3', 'budget_view', '2026-03-10T13:00:00.000Z');
  // G · SAME install, SAME feature, TWO DIFFERENT DAYS. Distinct from E above,
  // which is same-day. The rollup collapses per (day, install, feature), so a
  // same-day repeat becomes ONE `events_daily` row and `COUNT(anon_id)` over the
  // rollup equals `COUNT(DISTINCT anon_id)` — meaning that mutation to 05
  // SURVIVED the fixture (measured: `COUNT(DISTINCT anon_id)` -> `COUNT(anon_id)`
  // on 05:95 left all 87 tests green). Only a DAY-SPANNING repeat produces two
  // rollup rows for one install and makes the two forms disagree.
  used('subly', 's2', 'budget_view', '2026-03-10T13:00:00.000Z');
  used('subly', 's1', 'reminder_set', '2026-03-03T13:05:00.000Z');
  used('subly', 's4', 'reminder_set', '2026-03-03T13:05:00.000Z');
  used('subly', 's5', 'export_csv', '2026-03-12T13:10:00.000Z');
  add('subly', 's6', 'feature_used', '2026-03-03T13:10:00.000Z', '{}'); // D

  add('subly', 's7', 'return_visit', '2026-03-15T09:00:00.000Z'); // F · active, never launched

  // H · a `first_launch` sitting EXACTLY on a window END boundary day
  // (2026-04-01 is the `march` window's exclusive end). Every other install in
  // this fixture launches off-boundary — the out-of-window controls are at
  // 2026-02-10 and 2026-04-08 — so the cohort's end comparison was never
  // exercised at the one input where `<` and `<=` differ. Measured: changing
  // 01:63 `day <` to `day <=` left all 87 tests green before this row existed.
  add('subly', 's90', 'first_launch', '2026-04-01T10:00:00.000Z');

  // ── negative control · another app, same days ────────────────────────────
  for (const a of ['l1', 'l2']) {
    add('lingo', a, 'first_launch', '2026-03-01T10:00:00.000Z');
    add('lingo', a, 'activation', '2026-03-01T10:05:00.000Z');
    add('lingo', a, 'return_visit', '2026-03-02T09:00:00.000Z');
    add('lingo', a, 'paywall_viewed', '2026-03-03T12:00:00.000Z');
    add('lingo', a, 'checkout_started', '2026-03-03T12:01:00.000Z');
  }
  add('lingo', 'l1', 'purchase_success', '2026-03-03T12:02:00.000Z');
  add('lingo', 'l1', 'notification_opened', '2026-03-06T08:00:00.000Z');
  add('lingo', 'l2', 'notif_opt_out', '2026-03-06T08:30:00.000Z');
  used('lingo', 'l1', 'budget_view', '2026-03-03T13:00:00.000Z');
  used('lingo', 'l2', 'lingo_only', '2026-03-03T13:00:00.000Z');

  // ── negative control · same app, outside every window below ──────────────
  for (const [anon, day] of [
    ['s98', '2026-02-10'],
    ['s99', '2026-04-08'],
  ] as const) {
    add('subly', anon, 'first_launch', `${day}T10:00:00.000Z`);
    add('subly', anon, 'activation', `${day}T10:05:00.000Z`);
    add('subly', anon, 'paywall_viewed', `${day}T12:00:00.000Z`);
    add('subly', anon, 'notification_opened', `${day}T08:00:00.000Z`);
    used('subly', anon, 'legacy_feature', `${day}T13:00:00.000Z`);
  }

  return rows;
}

/** After the last fixture day, so every day carrying a row is COMPLETE. */
const ROLLUP_NOW = Date.parse('2026-04-10T00:00:00.000Z');
const LAST_COMPLETE_DAY = '2026-04-09';

/** Day-aligned windows only. A sub-day window is a different question and has
 *  its own describe block below, where the divergence is the SUBJECT. */
const WINDOWS = [
  { name: 'everything', start: '2026-02-01T00:00:00.000Z', end: '2026-05-01T00:00:00.000Z' },
  { name: 'march', start: '2026-03-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' },
  { name: 'first half of march', start: '2026-03-01T00:00:00.000Z', end: '2026-03-15T00:00:00.000Z' },
  { name: 'the single day 2026-03-03', start: '2026-03-03T00:00:00.000Z', end: '2026-03-04T00:00:00.000Z' },
  { name: 'a window with no data at all', start: '2026-05-01T00:00:00.000Z', end: '2026-06-01T00:00:00.000Z' },
] as const;

const APPS = ['subly', 'lingo', 'nope'] as const;

function insert(db: RealDb, rows: Row[]): void {
  const stmt = db.db.prepare(
    `INSERT INTO events (event_id, app_id, anon_id, event, params, server_ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((r, i) => {
    stmt.run(`eq-${String(i).padStart(4, '0')}`, r.app, r.anon, r.event, r.params ?? '{}', r.ts);
  });
}

/**
 * Drive the SHIPPED rollup until it has consumed everything, and PROVE it did.
 *
 * A loop rather than one call because `MAX_DAYS_PER_ROLLUP_RUN` is a shipped
 * constant this file must not silently depend on: a fixture that grew past it
 * would otherwise leave the last days unrolled and every comparison would still
 * be green — both sides would simply be comparing a smaller world. The loop
 * terminates on the watermark going still, and the caller asserts where it
 * stopped.
 */
async function rollUpFully(db: RealDb): Promise<string | null> {
  let previous: string | null = null;
  for (let i = 0; i < 12; i++) {
    await eventsRollup(envOf(db), ROLLUP_NOW);
    const wm = await rolledThrough(envOf(db));
    if (wm === previous) return wm;
    previous = wm;
  }
  return previous;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[pipeline 11]E-11 · the raw/rollup comparison is capable of failing', () => {
  it('both sides were found, for all five, in both directions', () => {
    expect(
      [...SHIPPED.keys()].sort(),
      'COVERAGE LOST — the shipped queries/insights/*.sql do not declare exactly the five ids this file compares.',
    ).toEqual([...REQUIRED_IDS].sort());
    expect(
      [...BASELINES.keys()].sort(),
      'COVERAGE LOST — test/baselines/insights-raw/*.sql do not declare exactly the five ids. A missing baseline ' +
        'silently removes a metric from the comparison, which is the shape of the incident this repo already has on ' +
        'record (a scanner that dropped from 5 files to 4 and reported PASS).',
    ).toEqual([...REQUIRED_IDS].sort());
    expect(PAIRS.length).toBe(REQUIRED_IDS.length);
  });

  it('🔴 the two sides are DIFFERENT SQL — a baseline "updated to match" is a string compared with itself', () => {
    for (const p of PAIRS) {
      const shipped = baseTables(p.shipped);
      const baseline = baseTables(p.baseline);

      expect(baseline.has('events'), `${p.file}: the baseline must read raw \`events\``).toBe(true);
      expect(
        baseline.has('events_daily'),
        `${p.file}: the FROZEN baseline reads \`events_daily\`. It was edited to match the shipped query, and the ` +
          'comparison below is now a query against itself — an assertion that cannot fail, which is worse than none ' +
          'because it inflates apparent coverage.',
      ).toBe(false);

      expect(
        shipped.has('events_daily'),
        `${p.file}: the shipped query does not read \`events_daily\`. The cutover was reverted, and the five numbers ` +
          'are back to being destroyed by the 400-day `events` sweep.',
      ).toBe(true);
      expect(shipped.has('events'), `${p.file}: the shipped query still reads raw \`events\``).toBe(false);

      expect(p.shipped, `${p.file}: the two texts are identical`).not.toBe(p.baseline);
    }
  });

  it('🔴 the CALLER CONTRACT is unchanged — same parameter indexes, same reference counts, no bare `?`', () => {
    // ⚠️ NEITHER `node:sqlite` NOR THIS SUITE WOULD CATCH A FOURTH PARAMETER BY
    // RUNNING. Measured: `stmt.all('subly', start)` against every one of these
    // five files SUCCEEDS on node:sqlite — an unbound `?3` is simply NULL. D1
    // rejects a bind-count mismatch, so the failure would appear in production
    // and nowhere else. The contract therefore has to be asserted STRUCTURALLY,
    // against the frozen pre-cutover text, rather than inferred from a green run.
    for (const p of PAIRS) {
      const before = paramRefs(p.baseline);
      const after = paramRefs(p.shipped);

      expect(after.indexes, `${p.file}: the set of bound parameters changed`).toEqual(before.indexes);
      expect(after.indexes, `${p.file}: the three positional parameters are ?1 ?2 ?3`).toEqual([1, 2, 3]);
      expect(
        after.refs,
        `${p.file}: the query references its parameters ${after.refs} time(s) where the pre-cutover text ` +
          `referenced them ${before.refs} time(s). Not fatal on its own — SQLite binds by NUMBER, so a repeat is ` +
          'free — but it is a change to a file whose whole claim is that nothing above it had to move, and it ' +
          'should be a deliberate one.',
      ).toBe(before.refs);
      expect(
        after.bare,
        `${p.file}: an unnumbered \`?\` appeared. Mixing \`?\` with \`?N\` re-orders every bind after it.`,
      ).toBe(0);
    }
  });
});

describe('[pipeline 11]E-11 · the five numbers are BIT-IDENTICAL from events_daily', () => {
  let db: RealDb;
  let watermark: string | null;

  beforeAll(async () => {
    db = realPlatformDb();
    insert(db, fixtureRows());
    watermark = await rollUpFully(db);
  });

  it('the rollup actually ran, and actually COLLAPSED rows rather than copying them', () => {
    expect(
      watermark,
      'the shipped rollup did not consume through the last complete day, so the comparison below would range over ' +
        'a rollup that is missing the tail of the fixture — and both sides would still agree about the part that is there.',
    ).toBe(LAST_COMPLETE_DAY);

    const raw = db.count('events');
    const daily = db.count('events_daily');
    expect(raw).toBe(fixtureRows().length);
    expect(daily).toBeGreaterThan(0);
    expect(
      daily,
      'events_daily has as many rows as events, so nothing collapsed — the multi-row-per-day fixture rows (E) are ' +
        'missing and `n_rows` is 1 everywhere, which is exactly the case where a wrong SUM(n_rows) would go unnoticed.',
    ).toBeLessThan(raw);

    // `n_rows` must ACCOUNT for every raw row in the rolled-up range, or the
    // rollup dropped rows and both sides are simply agreeing about less data.
    const summed = Number(
      (db.rows('SELECT COALESCE(SUM(n_rows), 0) AS n FROM events_daily')[0] as { n: number }).n,
    );
    expect(summed, 'SUM(n_rows) does not account for every raw event row').toBe(raw);
  });

  // 75 comparisons: 5 metrics × 3 apps × 5 day-aligned windows. Compared as
  // JSON, so COLUMN ORDER, COLUMN NAMES, VALUE TYPES and NULL-vs-0 all have to
  // match — not merely the numbers.
  const nonTrivial = new Map<string, number>();

  /**
   * Does this result carry a real, non-zero NUMBER?
   *
   * 🔴 THIS PREDICATE USED TO BE `/[1-9]/.test(JSON.stringify(rows))`, AND THAT
   * IS AN ASSERTION THAT CANNOT FAIL — the exact defect this whole describe
   * block exists to prevent, reintroduced inside the check that prevents it.
   * `JSON.stringify` includes the COLUMN NAMES, and `retention_d1_d7_d30`
   * returns `d1_retained`, `d7_retained`, `d30_retained`, `d1_pct`, `d7_pct`,
   * `d30_pct` — every one of them contains a digit 1-9. MEASURED, not reasoned:
   * against a COMPLETELY EMPTY database the old predicate scored retention
   * 15/15 "non-trivial" while the other four metrics scored 0/15, so
   * `expect(nonTrivial.get('retention_d1_d7_d30')).toBeGreaterThan(0)` was
   * unconditionally true and that metric's floor had been dead since it shipped.
   *
   * So: parse the ROWS and look at the VALUES only. A column name can never
   * again satisfy the floor that is supposed to prove the column had data.
   */
  function carriesRealNumber(rows: Array<Record<string, unknown>>): boolean {
    for (const row of rows) {
      for (const v of Object.values(row)) {
        if (typeof v === 'number' && v !== 0) return true;
        if (typeof v === 'bigint' && v !== 0n) return true;
      }
    }
    return false;
  }

  for (const id of REQUIRED_IDS) {
    for (const app of APPS) {
      for (const w of WINDOWS) {
        it(`${id} · app=${app} · ${w.name}`, () => {
          const pair = PAIRS.find((p) => p.id === id);
          expect(pair, `no baseline/shipped pair for ${id}`).toBeDefined();
          const params = [app, w.start, w.end] as const;

          const rollupRows = db.rows(pair!.shipped, ...params);
          const fromRaw = JSON.stringify(db.rows(pair!.baseline, ...params));
          const fromRollup = JSON.stringify(rollupRows);

          expect(
            fromRollup,
            `${id} disagrees between raw \`events\` and \`events_daily\` for app=${app} over ` +
              `[${w.start}, ${w.end}). A dashboard reading the rollup would print a different number from one ` +
              `reading the raw table.\n  raw    = ${fromRaw}\n  rollup = ${fromRollup}`,
          ).toBe(fromRaw);

          if (carriesRealNumber(rollupRows)) nonTrivial.set(id, (nonTrivial.get(id) ?? 0) + 1);
        });
      }
    }
  }

  it('🔴 every metric produced at least one NON-EMPTY comparison — otherwise 75 greens are 75 comparisons of nothing', () => {
    // Production holds 0 rows, so "both sides empty" is the DEFAULT state of
    // this whole subject. A comparison suite that is green because it compared
    // `[]` with `[]` seventy-five times is the exact shape of an assertion that
    // cannot fail, and it would survive deleting the fixture entirely.
    //
    // 🔴 COLLECTED, NOT THROWN PER-ID. `expect` throws on the FIRST failing
    // iteration, so a `for` loop that asserts inside itself only ever reports
    // metric #1 and never EVALUATES the rest. That is how the dead
    // `retention_d1_d7_d30` floor above survived its own negative test: emptying
    // `fixtureRows()` turned this test red naming ONLY `activation_rate` (first
    // in REQUIRED_IDS), the author saw the red they expected, and the fact that
    // one of the five checks could not fail was never surfaced. A checking loop
    // is itself a check. Build the full list, then assert once on the list.
    const dead = REQUIRED_IDS.filter((id) => (nonTrivial.get(id) ?? 0) === 0);
    expect(
      dead,
      `these metric(s) were each compared ${APPS.length * WINDOWS.length} times and EVERY result was empty or ` +
        `all-zero, so the comparison proved nothing about them: ${dead.join(', ')}\n` +
        `  per-metric non-trivial counts: ${REQUIRED_IDS.map((id) => `${id}=${nonTrivial.get(id) ?? 0}`).join(', ')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('[pipeline 11]E-11 · the day window is a REAL loss, and it is not a "widening"', () => {
  // 🔴 THE SENTENCE THIS BLOCK FALSIFIES. 0007's header, this guard's own
  // comments and [ADR 045] §8.2 all said a sub-day window is "silently WIDENED
  // to day bounds". Half right, and the wrong half is the one that loses data:
  // BOTH bounds floor, so the start widens and the end NARROWS. Measured here
  // rather than reasoned about, because a reader who trusts "widened" will
  // over-report and a reader who is told the truth can floor the bound.
  let db: RealDb;

  const PAYWALL = () => PAIRS.find((p) => p.id === 'paywall_conversion')!;

  beforeAll(async () => {
    db = realPlatformDb();
    insert(db, fixtureRows());
    await rollUpFully(db);
  });

  const both = (start: string, end: string) => {
    const p = PAYWALL();
    return {
      raw: db.rows(p.baseline, 'subly', start, end)[0],
      rollup: db.rows(p.shipped, 'subly', start, end)[0],
    };
  };

  it('a DAY-ALIGNED window over the funnel day is exact — the control for the three cases below', () => {
    const { raw, rollup } = both('2026-03-03T00:00:00.000Z', '2026-03-04T00:00:00.000Z');
    expect(raw.viewed_installs).toBe(6);
    expect(rollup).toEqual(raw);
  });

  it('a START inside the day FLOORS BACKWARDS — the rollup sees MORE than was asked for', () => {
    // The funnel rows are at 12:00/12:01/12:02; a 13:00 start excludes them from
    // the raw side and includes the whole day on the rollup side.
    const { raw, rollup } = both('2026-03-03T13:00:00.000Z', '2026-03-04T00:00:00.000Z');
    expect(raw.viewed_installs, 'the raw form honours the instant').toBe(0);
    expect(rollup.viewed_installs, 'the rollup form floored the start back to 00:00 and swept the whole day in').toBe(6);
  });

  it('an END inside the day ALSO FLOORS BACKWARDS — the rollup sees LESS, which is the half "widened" hides', () => {
    const { raw, rollup } = both('2026-03-03T00:00:00.000Z', '2026-03-03T13:00:00.000Z');
    expect(raw.viewed_installs, 'the raw form keeps the morning').toBe(6);
    expect(rollup.viewed_installs, 'the rollup floored the END back to 00:00 and dropped the whole day').toBe(0);
  });

  it('a window that OPENS AND CLOSES inside one day collapses to EMPTY, not to that day', () => {
    const { raw, rollup } = both('2026-03-03T11:00:00.000Z', '2026-03-03T23:00:00.000Z');
    expect(raw.viewed_installs).toBe(6);
    expect(rollup.viewed_installs, 'floor(start) == floor(end), so `day >= X AND day < X` matches nothing').toBe(0);
    expect(rollup.view_to_checkout_pct, 'and the rate is NULL, not a manufactured 0.0').toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('[pipeline 11]E-11 · known divergences, measured (05-feature-adoption only)', () => {
  // 0007's header said the day window was "the one and only fidelity loss". It
  // is one of THREE, and the other two are here. Both are out-of-taxonomy inputs
  // (`feature_used` is documented as carrying an enumerable NAME) and in both
  // the rollup's answer is arguably the better one — but "the one and only" was
  // false, and a wrong count of the known losses is how the next one is missed.
  const FEATURES = () => PAIRS.find((p) => p.id === 'feature_adoption')!;
  const WIN = ['subly', '2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'] as const;

  async function withParams(params: string[]): Promise<{ raw: unknown[]; rollup: unknown[] }> {
    const db = realPlatformDb();
    insert(
      db,
      params.map((p, i) => ({
        app: 'subly',
        anon: `d${i}`,
        event: 'feature_used',
        ts: '2026-03-03T13:00:00.000Z',
        params: p,
      })),
    );
    await rollUpFully(db);
    const f = FEATURES();
    return { raw: db.rows(f.baseline, ...WIN), rollup: db.rows(f.shipped, ...WIN) };
  }

  it('(a) a feature literally NAMED the empty string is DROPPED by the rollup form', async () => {
    // `json_extract('{"name":""}', '$.name')` is `''`, which IS NOT NULL, so the
    // raw form counted it as a real feature. In the rollup it is
    // indistinguishable from the `''` sentinel that means "this row had no
    // name", and `feature <> ''` drops it. A whole feature leaves the report.
    const { raw, rollup } = await withParams(['{"name":""}', '{"name":"real"}']);
    expect(raw).toEqual([
      { feature: '', installs: 1, uses: 1, adoption_pct: 50 },
      { feature: 'real', installs: 1, uses: 1, adoption_pct: 50 },
    ]);
    expect(rollup).toEqual([{ feature: 'real', installs: 1, uses: 1, adoption_pct: 50 }]);
  });

  it('(b) a NON-STRING name comes back as TEXT from the rollup and as its own type from raw', async () => {
    // `CAST(… AS TEXT)` in the rollup INSERT is load-bearing for the grain — an
    // INTEGER and its TEXT form are DISTINCT keys in the unique index, which is
    // the duplicate-row failure reached by a second route. The visible
    // consequence here is a column TYPE, not a count.
    const { raw, rollup } = await withParams(['{"name":42}']);
    expect(raw).toEqual([{ feature: 42, installs: 1, uses: 1, adoption_pct: 100 }]);
    expect(rollup).toEqual([{ feature: '42', installs: 1, uses: 1, adoption_pct: 100 }]);
  });

  it("(c) and the ordinary '{}' case is NOT a divergence — both forms drop it", async () => {
    // The control for the two above: the row that made `json_valid` + IS NOT
    // NULL a real filter in the first place behaves identically on both sides,
    // so (a) and (b) are about the EDGE of the parse, not about the filter.
    const { raw, rollup } = await withParams(['{}', '{"name":"real"}']);
    expect(raw).toEqual([{ feature: 'real', installs: 1, uses: 1, adoption_pct: 50 }]);
    expect(rollup).toEqual(raw);
  });
});
