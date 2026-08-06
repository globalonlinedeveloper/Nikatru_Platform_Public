import { describe, it, expect } from 'vitest';
import { realPlatformDb, RealDb } from './harness';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose
// (see raw-modules.d.ts). Same trick analytics-contract.test.ts uses to read the
// Dart source across the language boundary.
import insightsReadme from '../queries/insights/README.md?raw';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 11]E-11 — THE FIVE DECISION NUMBERS ARE COMPUTABLE FROM CHECKED-IN,
// TESTED SQL.
//
// The taxonomy exists to produce five numbers. Until this file, nothing in the
// tree could produce ONE of them: `services/platform/src/routes/` holds
// `config.ts` and `events.ts` only, so nothing reads the `events` table, and the
// four indexes shipped in advance for these very queries
// (`migrations/0002_analytics.sql:58-63` — the comment there literally says "the
// ~5 dashboard numbers") had never served a single one.
//
// ✅ THIS IS A GATE, NOT A MONITOR, AND IT IS THE RARE LARGE ITEM THAT CAN BE.
// `ci.yml` triggers on `pull_request` and is deliberately secretless — a fork PR
// gets no credentials — so any requirement whose falsifier lives in production
// can only ever be watched, never gated. E-11's falsifier lives entirely inside
// the repository: a seeded in-memory fixture, the real migrations, zero rows of
// production data and zero credentials. It fails the build or it is satisfied.
//
// 🔴 AND A GREEN RUN HERE IS A STATEMENT ABOUT CORRECTNESS, NOT ABOUT TRUTH.
// `platform_db.events` holds 0 ROWS IN PRODUCTION (E-4a). These queries are
// proven against a fixture whose every row this file wrote; that proves the SQL
// computes what a human computed by hand from the same rows, and proves nothing
// whatever about whether the resulting number describes any user. Getting rows
// onto the rail is E-4a; noticing when the rail goes quiet is E-13. The one
// concession this file makes to that fact is deliberate and load-bearing: the
// EMPTY-FIXTURE case is asserted first and every rate is `NULL` there, because
// `0.0%` from an empty table is a real-looking bad number that no downstream
// reader could distinguish from a real one.
//
// THE COVERAGE FLOOR IS A RELATIONSHIP, NOT A CONSTANT. There is no literal `5`
// in this file. The floor is `REQUIRED_COVERAGE.length`, and REQUIRED_COVERAGE
// is checked, in order and in both directions, against the numbered list in
// `queries/insights/README.md` — which is itself checked against the SSoT list
// in `company/requirements/analytics-events.md` § "The ~5 numbers" on every
// machine that has the private tree. This repo has already shipped a scanner
// that silently dropped from 5 files to 4 and reported PASS; four numbers and a
// fifth quietly absent is COVERAGE LOST here, not a smaller green run.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE FIVE, in the order and with the titles that
 * `company/requirements/analytics-events.md` § "The ~5 numbers these roll up
 * into (the actual dashboard)" uses.
 *
 * Written out rather than derived from the directory: a set derived from the
 * files it is meant to police loses an entry at exactly the moment the file it
 * names disappears, which is the failure this exists to catch. Derivation runs
 * in the OTHER direction — the documents are parsed and compared against this.
 */
const REQUIRED_COVERAGE = [
  { id: 'activation_rate', title: 'Activation rate' },
  { id: 'retention_d1_d7_d30', title: 'Retention' },
  { id: 'paywall_conversion', title: 'Paywall conversion' },
  { id: 'notification_lift', title: 'Notification lift' },
  { id: 'feature_adoption', title: 'Feature adoption' },
] as const;

type NumberId = (typeof REQUIRED_COVERAGE)[number]['id'];

// ── the query set, discovered from the directory ────────────────────────────
// A glob, not five imports: deleting a file AND its import line is one edit, and
// the suite would then pass over four queries while the requirement says five.
const SQL_MODULES = import.meta.glob('../queries/insights/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface Query {
  readonly file: string;
  readonly id: string;
  readonly sql: string;
}

/** `-- number: <id>` out of a file's header. Structural (a declared key on its
 *  own line), never a search of the body — the body is full of the words. */
function declaredId(sql: string): string | null {
  return sql.match(/^--\s*number:\s*([a-z0-9_]+)\s*$/m)?.[1] ?? null;
}

const QUERIES = new Map<string, Query>();
const UNDECLARED: string[] = [];
for (const [path, sql] of Object.entries(SQL_MODULES)) {
  const file = path.split('/').pop() ?? path;
  const id = declaredId(sql);
  if (id === null) UNDECLARED.push(file);
  else QUERIES.set(id, { file, id, sql });
}

// ── the two documents the floor is derived from ─────────────────────────────

/** The body of a `##` section, from its heading to the next one. */
function section(markdown: string, headingContains: string): string | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes(headingContains));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Numbered list items, each joined back into ONE string.
 *
 *  Items wrap across lines in the README, so a per-line regex would read a
 *  prefix of item 2 and call it the whole — and the machine-readable
 *  `(`id`)` suffix lives on the continuation line. A blank line, a heading or a
 *  blockquote ends an item. */
function numberedItems(body: string): string[] {
  const out: string[] = [];
  let cur: string | null = null;
  for (const line of body.split('\n')) {
    if (/^\s*\d+\.\s/.test(line)) {
      if (cur !== null) out.push(cur);
      cur = line.trim();
    } else if (cur !== null) {
      if (/^\s*$/.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line)) {
        out.push(cur);
        cur = null;
      } else {
        cur += ` ${line.trim()}`;
      }
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

const boldTitle = (item: string): string | null => item.match(/\*\*(.+?)\*\*/)?.[1]?.trim() ?? null;
const trailingId = (item: string): string | null => item.match(/\(`([a-z0-9_]+)`\)\s*$/)?.[1] ?? null;
const sqlFileName = (item: string): string | null => item.match(/`(\d{2}-[a-z0-9-]+\.sql)`/)?.[1] ?? null;

// ── the private SSoT, read only if the private tree is here at all ──────────
// `company/` is gitignored and NEVER reaches a CI runner, so this limb cannot be
// the enforcement — the README mirror above is. What it does is stop the mirror
// from drifting away from the document it mirrors, on every machine that holds
// the document. `process.getBuiltinModule` rather than `import 'node:fs'` for
// the same reason harness.ts uses it for node:sqlite: no module resolution, no
// widening of this project's `types` array.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      getBuiltinModule(id: 'node:fs'): {
        existsSync(p: string): boolean;
        readFileSync(p: string, enc: 'utf8'): string;
      };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

const SSOT_REL = 'company/requirements/analytics-events.md';
/** The first ancestor of the cwd that holds a `company/` tree, or null. */
function privateTreeRoot(): string | null {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    const root = `${cwd}${up}`;
    if (fs.existsSync(`${root}/company`)) return root;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SEEDED FIXTURE.
//
// Every expected number below was computed BY HAND from these rows before the
// query was run, and the numbers are chosen so that every percentage is an exact
// binary fraction (a cohort of 8 → 12.5 % steps). "Close enough" is not a
// property this file is willing to have: a rounding tolerance would let a query
// that double-counted one install in a hundred pass forever.
//
// TWO NEGATIVE CONTROLS, and they are what make the WHERE clauses testable:
//   · app `lingo` mirrors the whole fixture inside the same window, so deleting
//     any `app_id = ?1` moves a number;
//   · install `s99` mirrors it inside app `subly` but BEFORE the window, so
//     deleting any `server_ts` bound moves a number.
// Without them every filter in all five files would be an assertion that cannot
// fail, and the suite would certify a portfolio-wide all-time total as a
// per-app windowed one.
// ─────────────────────────────────────────────────────────────────────────────
const APP = 'subly';
const WINDOW_START = '2026-01-01T00:00:00.000Z';
const WINDOW_END = '2026-02-01T00:00:00.000Z';
const PARAMS = [APP, WINDOW_START, WINDOW_END] as const;

const LAUNCH = '2026-01-01T10:00:00.000Z'; // day 0 for the whole cohort
const COHORT = ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08'];

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

  // ── subly · the cohort ────────────────────────────────────────────────────
  for (const a of COHORT) add(APP, a, 'first_launch', LAUNCH);

  // activation: 3 of 8 → 37.5 %
  for (const a of ['s01', 's02', 's03']) add(APP, a, 'activation', '2026-01-01T10:05:00.000Z');

  // return_visit, by EXACT day offset from 2026-01-01:
  //   D1  (01-02): s01 s02 s03 s04 → 4 of 8 = 50.0 %
  //   D7  (01-08): s01 s02         → 2 of 8 = 25.0 %
  //   D30 (01-31): s01             → 1 of 8 = 12.5 %
  //   day 3 (01-04): s05 — noise that must count toward NONE of the three. A
  //   query written as "returned on or after day n" scores it as D1 and turns
  //   the whole curve into a monotone artifact.
  for (const a of ['s01', 's02', 's03', 's04']) add(APP, a, 'return_visit', '2026-01-02T09:00:00.000Z');
  for (const a of ['s01', 's02']) add(APP, a, 'return_visit', '2026-01-08T09:00:00.000Z');
  add(APP, 's01', 'return_visit', '2026-01-31T09:00:00.000Z');
  add(APP, 's05', 'return_visit', '2026-01-04T09:00:00.000Z');

  // funnel: 8 viewed → 4 checkout → 2 purchased.
  for (const a of COHORT) add(APP, a, 'paywall_viewed', '2026-01-03T12:00:00.000Z');
  // A second view by s01: the funnel counts INSTALLS, so this must not move it.
  add(APP, 's01', 'paywall_viewed', '2026-01-05T12:00:00.000Z');
  for (const a of ['s01', 's02', 's03', 's04']) add(APP, a, 'checkout_started', '2026-01-03T12:01:00.000Z');
  for (const a of ['s01', 's02']) add(APP, a, 'purchase_success', '2026-01-03T12:02:00.000Z');
  // A failure is not a stage of the funnel.
  add(APP, 's03', 'purchase_failed', '2026-01-03T12:02:00.000Z');

  // notifications: opened = s01 s02 s03 s07 (3 of them returned → 75.0 %);
  //                not opened = s04 s05 s06 s08 (2 returned → 50.0 %);
  //                lift = +25.0 points. s08 opted out.
  for (const a of ['s01', 's02', 's03', 's07']) add(APP, a, 'notification_opened', '2026-01-06T08:00:00.000Z');
  add(APP, 's08', 'notif_opt_out', '2026-01-06T08:30:00.000Z');

  // feature_used{name}: budget_view 4 installs / 5 uses · reminder_set 2/2 ·
  // export_csv 1/1, over 8 active installs → 50.0 / 25.0 / 12.5 %.
  const used = (a: string, name: string, ts: string) =>
    add(APP, a, 'feature_used', ts, JSON.stringify({ name }));
  for (const a of ['s01', 's02', 's03', 's04']) used(a, 'budget_view', '2026-01-03T13:00:00.000Z');
  used('s01', 'budget_view', '2026-01-09T13:00:00.000Z'); // 2nd use, same install
  for (const a of ['s01', 's02']) used(a, 'reminder_set', '2026-01-03T13:05:00.000Z');
  used('s01', 'export_csv', '2026-01-03T13:10:00.000Z');
  // `params` DEFAULTs to '{}' in the DDL, so an emitter that forgot `name`
  // produces exactly this row. It must not become a feature called NULL.
  add(APP, 's06', 'feature_used', '2026-01-03T13:10:00.000Z', '{}');

  // ── negative control A · another app, same window ─────────────────────────
  for (const a of ['l01', 'l02']) {
    add('lingo', a, 'first_launch', LAUNCH);
    add('lingo', a, 'activation', '2026-01-01T10:05:00.000Z');
    add('lingo', a, 'return_visit', '2026-01-02T09:00:00.000Z');
    add('lingo', a, 'paywall_viewed', '2026-01-03T12:00:00.000Z');
    add('lingo', a, 'checkout_started', '2026-01-03T12:01:00.000Z');
    add('lingo', a, 'purchase_success', '2026-01-03T12:02:00.000Z');
  }
  add('lingo', 'l01', 'notification_opened', '2026-01-06T08:00:00.000Z');
  add('lingo', 'l02', 'notif_opt_out', '2026-01-06T08:30:00.000Z');
  add('lingo', 'l01', 'feature_used', '2026-01-03T13:00:00.000Z', JSON.stringify({ name: 'budget_view' }));
  add('lingo', 'l02', 'feature_used', '2026-01-03T13:00:00.000Z', JSON.stringify({ name: 'lingo_only' }));

  // ── negative control B · same app, BEFORE the window ──────────────────────
  add(APP, 's99', 'first_launch', '2025-12-15T10:00:00.000Z');
  add(APP, 's99', 'activation', '2025-12-15T10:05:00.000Z');
  add(APP, 's99', 'return_visit', '2025-12-16T09:00:00.000Z');
  add(APP, 's99', 'paywall_viewed', '2025-12-15T12:00:00.000Z');
  add(APP, 's99', 'checkout_started', '2025-12-15T12:01:00.000Z');
  add(APP, 's99', 'purchase_success', '2025-12-15T12:02:00.000Z');
  add(APP, 's99', 'notification_opened', '2025-12-16T08:00:00.000Z');
  add(APP, 's99', 'feature_used', '2025-12-15T13:00:00.000Z', JSON.stringify({ name: 'legacy_feature' }));

  return rows;
}

/** The real migrations on a real engine, plus the fixture. `event_id` is
 *  synthesised per row because the UNIQUE INDEX shipped before the first row
 *  ever landed and a fixture that violated it would fail as a constraint error
 *  rather than as a wrong number. */
function seeded(rows: Row[] = fixtureRows()): RealDb {
  const db = realPlatformDb();
  const stmt = db.db.prepare(
    `INSERT INTO events (event_id, app_id, anon_id, event, params, server_ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((r, i) => {
    stmt.run(`evt-${String(i).padStart(4, '0')}`, r.app, r.anon, r.event, r.params ?? '{}', r.ts);
  });
  return db;
}

function run(db: RealDb, id: NumberId): Array<Record<string, unknown>> {
  const q = QUERIES.get(id);
  if (!q) throw new Error(`COVERAGE LOST — no checked-in .sql declares \`-- number: ${id}\``);
  return db.rows(q.sql, ...PARAMS);
}

const one = (rows: Array<Record<string, unknown>>): Record<string, unknown> => {
  expect(rows.length, 'these four queries are single-row by construction').toBe(1);
  return rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────

describe('[pipeline 11]E-11 · coverage — the five numbers exist as checked-in SQL', () => {
  it('the glob reached the query directory at all', () => {
    // Without this, an empty glob makes every set comparison below range over
    // the empty set on BOTH sides in the degenerate case where REQUIRED_COVERAGE
    // is also emptied — and, more realistically, produces a pile of confusing
    // per-id failures instead of one legible cause.
    expect(
      Object.keys(SQL_MODULES).length,
      'COVERAGE LOST — `import.meta.glob(\'../queries/insights/*.sql\')` matched nothing. ' +
        'The directory moved or the glob pattern rotted; the queries did not become correct.',
    ).toBeGreaterThan(0);
  });

  it('every checked-in .sql declares a `-- number:` id', () => {
    expect(
      UNDECLARED,
      `COVERAGE LOST — ${UNDECLARED.join(', ')} carries no \`-- number: <id>\` header line, so it is ` +
        'invisible to this test. A query file nothing runs is worse than no query file: it looks like coverage.',
    ).toEqual([]);
  });

  it(`the declared ids are exactly REQUIRED_COVERAGE, in both directions`, () => {
    const declared = [...QUERIES.keys()].sort();
    const required = REQUIRED_COVERAGE.map((n) => n.id).sort();
    const missing = required.filter((id) => !declared.includes(id));
    const extra = declared.filter((id) => !required.includes(id as NumberId));

    expect(
      missing,
      `COVERAGE LOST — REQUIRED_COVERAGE names ${missing.join(', ')} and no .sql declares it. ` +
        'Four numbers returning values and a fifth silently absent is exactly the shape of the incident this ' +
        'repo already has on record (a scanner that dropped from 5 files to 4 and reported PASS).',
    ).toEqual([]);
    expect(
      extra,
      `a .sql declares ${extra.join(', ')}, which REQUIRED_COVERAGE does not name — so it is never run and ` +
        'never asserted. Add it to REQUIRED_COVERAGE and to the README list, or delete the file.',
    ).toEqual([]);
    // The floor is a LENGTH, never a literal. A number typed here is a number
    // somebody can lower.
    expect(QUERIES.size).toBe(REQUIRED_COVERAGE.length);
  });

  it('queries/insights/README.md lists exactly the same five, in the same order', () => {
    const body = section(insightsReadme, 'The five decision numbers');
    expect(
      body,
      'COVERAGE LOST — queries/insights/README.md no longer has a `## The five decision numbers` section, ' +
        'so the list REQUIRED_COVERAGE is derived from was not read and this check passed over nothing.',
    ).not.toBeNull();

    const items = numberedItems(body as string);
    expect(
      items.length,
      `README lists ${items.length} numbered item(s); REQUIRED_COVERAGE holds ${REQUIRED_COVERAGE.length}. ` +
        'The floor is the length of that list — shrinking the document is how the requirement gets quietly reduced.',
    ).toBe(REQUIRED_COVERAGE.length);

    REQUIRED_COVERAGE.forEach((n, i) => {
      const item = items[i];
      expect(boldTitle(item), `README item ${i + 1} title`).toBe(n.title);
      expect(trailingId(item), `README item ${i + 1} must end with (\`${n.id}\`)`).toBe(n.id);
      expect(
        sqlFileName(item),
        `README item ${i + 1} must name the .sql file that answers it`,
      ).toBe(QUERIES.get(n.id)?.file);
    });
  });

  it('the private SSoT (analytics-events.md) still lists the same five, in the same order', () => {
    const root = privateTreeRoot();
    if (root === null) {
      // The honest CI state, printed rather than skipped silently. `company/` is
      // gitignored and never reaches a runner, so on CI the enforcement is the
      // README mirror above and this limb has nothing to read.
      console.log(
        `NOTICE [E-11] no \`company/\` tree above ${nodeProcess.cwd()} — the SSoT list in ${SSOT_REL} was NOT ` +
          'compared. On CI this is expected and correct (company/ is gitignored); the enforced floor there is the ' +
          'README mirror. On a developer machine it means the private tree is missing, not that the lists agree.',
      );
      return;
    }
    const docPath = `${root}/${SSOT_REL}`;
    expect(
      fs.existsSync(docPath),
      `COVERAGE LOST — a \`company/\` tree exists at ${root} but ${SSOT_REL} is not in it. The SSoT moved or was ` +
        'renamed, so the README mirror is now mirroring nothing and REQUIRED_COVERAGE has no upstream.',
    ).toBe(true);

    const body = section(fs.readFileSync(docPath, 'utf8'), 'The ~5 numbers');
    expect(
      body,
      `COVERAGE LOST — ${SSOT_REL} no longer has a \`## The ~5 numbers …\` section.`,
    ).not.toBeNull();

    const titles = numberedItems(body as string).map(boldTitle);
    expect(
      titles.length,
      `${SSOT_REL} now lists ${titles.length} number(s); REQUIRED_COVERAGE holds ${REQUIRED_COVERAGE.length}. ` +
        'The set of questions changed upstream and the query set did not follow.',
    ).toBe(REQUIRED_COVERAGE.length);
    expect(titles).toEqual(REQUIRED_COVERAGE.map((n) => n.title));
  });

  it('every number in REQUIRED_COVERAGE has an asserted expected value below', () => {
    // A query that runs and is never graded is coverage theatre. This is the
    // third direction of the same relationship: files ↔ REQUIRED_COVERAGE ↔
    // assertions.
    const asserted = Object.keys(ASSERTIONS).sort();
    expect(
      asserted,
      'COVERAGE LOST — the ASSERTIONS map and REQUIRED_COVERAGE disagree, so a number is being run without ' +
        'being checked against a hand-computed value (or checked without being run).',
    ).toEqual(REQUIRED_COVERAGE.map((n) => n.id).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE NUMBERS. Every expectation is an exact value derived by hand from
// fixtureRows() — never `toBeGreaterThan`, never a tolerance.
// ─────────────────────────────────────────────────────────────────────────────
const ASSERTIONS: Record<NumberId, (db: RealDb) => void> = {
  // 8 installs launched in the window; s01 s02 s03 activated → 3/8 = 37.5 %.
  activation_rate: (db) => {
    const r = one(run(db, 'activation_rate'));
    expect(r.new_installs, 'the 8-install cohort — s99 launched before the window, lingo is another app').toBe(8);
    expect(r.activated_installs).toBe(3);
    expect(r.activation_rate_pct).toBe(37.5);
  },

  // Cohort 8. D1 = s01 s02 s03 s04 (4) · D7 = s01 s02 (2) · D30 = s01 (1).
  // s05's day-3 return counts toward none of them.
  retention_d1_d7_d30: (db) => {
    const r = one(run(db, 'retention_d1_d7_d30'));
    expect(r.cohort_size).toBe(8);
    expect(r.d1_retained, 'exact day 1 — s05 returned on day 3 and must not count').toBe(4);
    expect(r.d7_retained).toBe(2);
    expect(r.d30_retained).toBe(1);
    expect(r.d1_pct).toBe(50);
    expect(r.d7_pct).toBe(25);
    expect(r.d30_pct).toBe(12.5);
  },

  // 8 viewed (s01 viewed twice — installs, not rows) → 4 checkout → 2 purchased.
  paywall_conversion: (db) => {
    const r = one(run(db, 'paywall_conversion'));
    expect(r.viewed_installs, "s01's second view must not inflate the top of the funnel").toBe(8);
    expect(r.checkout_installs).toBe(4);
    expect(r.purchased_installs, "s03's purchase_failed is not a purchase").toBe(2);
    expect(r.view_to_checkout_pct).toBe(50);
    expect(r.checkout_to_purchase_pct).toBe(50);
    expect(r.view_to_purchase_pct).toBe(25);
  },

  // opened s01 s02 s03 s07 → 3 of 4 returned = 75 %.
  // not opened s04 s05 s06 s08 → 2 of 4 returned (s04 D1, s05 day 3) = 50 %.
  // lift = +25.0 points. s08 opted out.
  notification_lift: (db) => {
    const r = one(run(db, 'notification_lift'));
    expect(r.opened_installs).toBe(4);
    expect(r.opened_returned).toBe(3);
    expect(r.not_opened_installs, 'the control is ACTIVE-and-did-not-open, so it is 8 − 4').toBe(4);
    expect(r.not_opened_returned).toBe(2);
    expect(r.opted_out_installs).toBe(1);
    expect(r.opened_return_pct).toBe(75);
    expect(r.not_opened_return_pct).toBe(50);
    expect(r.lift_pct_points, 'percentage POINTS, signed — 75 − 50').toBe(25);
  },

  // 8 active installs. budget_view 4 installs / 5 uses · reminder_set 2/2 ·
  // export_csv 1/1. s06's `{}` params contribute no feature at all.
  feature_adoption: (db) => {
    const rows = run(db, 'feature_adoption');
    expect(
      rows.length,
      "3 features, not 4 — the `feature_used` row with params '{}' must not become a feature named NULL",
    ).toBe(3);
    expect(rows).toEqual([
      { feature: 'budget_view', installs: 4, uses: 5, adoption_pct: 50 },
      { feature: 'reminder_set', installs: 2, uses: 2, adoption_pct: 25 },
      { feature: 'export_csv', installs: 1, uses: 1, adoption_pct: 12.5 },
    ]);
  },
};

describe('[pipeline 11]E-11 · the five numbers, against a seeded fixture', () => {
  it('the fixture actually landed in the real schema', () => {
    // Every assertion below expects a NON-zero number, so an empty fixture would
    // already fail — but it would fail five times with five confusing messages
    // instead of once with the cause.
    const db = seeded();
    expect(db.count('events')).toBe(fixtureRows().length);
    expect(db.count('events', 'app_id = ?', APP)).toBeGreaterThan(0);
    expect(db.count('events', 'app_id = ?', 'lingo')).toBeGreaterThan(0);
  });

  for (const n of REQUIRED_COVERAGE) {
    it(`${n.id} — ${n.title}`, () => {
      ASSERTIONS[n.id](seeded());
    });
  }
});

describe('[pipeline 11]E-11 · against production as it is TODAY (0 rows)', () => {
  // 🔴 THIS IS THE REAL PRODUCTION STATE, NOT AN EDGE CASE. `events` holds 0
  // rows (E-4a). Every rate must be NULL and every count 0, because "0.0 %
  // activation" is the claim that a cohort existed and none of it activated —
  // a false, plausible-looking number that a dashboard would render in red and
  // an owner would act on.
  const empty = () => realPlatformDb();

  it('the table really is empty, so what follows is about an empty table', () => {
    expect(empty().count('events')).toBe(0);
  });

  it('activation_rate — 0 installs, rate NULL not 0.0', () => {
    const r = one(run(empty(), 'activation_rate'));
    expect(r.new_installs).toBe(0);
    expect(r.activated_installs).toBe(0);
    expect(r.activation_rate_pct).toBeNull();
  });

  it('retention_d1_d7_d30 — empty cohort, curve NULL not a flat 0 % line', () => {
    const r = one(run(empty(), 'retention_d1_d7_d30'));
    expect(r.cohort_size).toBe(0);
    expect(r.d1_retained).toBe(0);
    expect(r.d7_retained).toBe(0);
    expect(r.d30_retained).toBe(0);
    expect(r.d1_pct).toBeNull();
    expect(r.d7_pct).toBeNull();
    expect(r.d30_pct).toBeNull();
  });

  it('paywall_conversion — empty funnel, rates NULL not a 0 % conversion crisis', () => {
    const r = one(run(empty(), 'paywall_conversion'));
    expect(r.viewed_installs).toBe(0);
    expect(r.checkout_installs).toBe(0);
    expect(r.purchased_installs).toBe(0);
    expect(r.view_to_checkout_pct).toBeNull();
    expect(r.checkout_to_purchase_pct).toBeNull();
    expect(r.view_to_purchase_pct).toBeNull();
  });

  it('notification_lift — counts 0 (a fact), rates and lift NULL (no value)', () => {
    const r = one(run(empty(), 'notification_lift'));
    expect(r.opened_installs).toBe(0);
    expect(r.opened_returned).toBe(0);
    expect(r.not_opened_installs).toBe(0);
    expect(r.not_opened_returned).toBe(0);
    expect(r.opted_out_installs).toBe(0);
    expect(r.opened_return_pct).toBeNull();
    expect(r.not_opened_return_pct).toBeNull();
    expect(r.lift_pct_points).toBeNull();
  });

  it('feature_adoption — no rows at all, not a row of zeroes', () => {
    expect(run(empty(), 'feature_adoption')).toEqual([]);
  });
});
