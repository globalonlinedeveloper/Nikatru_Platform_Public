// ─────────────────────────────────────────────────────────────────────────────
// rollup-lossless.test.mjs — assert-rollup-lossless.mjs must be able to FAIL.
//
// [11]E-11, [ADR 045]. The guard enforces:
//   "Every column each shipped insights query reads exists in events_daily; the
//    rollup's five grain columns are all NOT NULL and all five appear in
//    ux_events_daily_grain; and the retention sweep's `events` cutoff passes
//    through the rollup watermark rather than age alone."
//
// 🔴 EVERY TREE CASE MUTATES A BYTE-IDENTICAL COPY OF THE SHIPPED FILES, never a
// hand-built fixture. `assert-seams-wired.mjs` once shipped with a caller check
// that matched the function's own DECLARATION — deleting every real caller still
// passed — and ALL SIX of its fixtures were green against the broken version. A
// fixture you write encodes the same misunderstanding as the guard you write. So
// the inputs here are the real 0007_events_rollup.sql, the real scheduled.ts and
// the real queries/insights, each mutated in one place somebody could plausibly
// mutate in a diff.
//
// ⚠️ THE GUARD TAKES NO DIFFERENT CODE PATH ON A COPY. It has no
// `scanningRealRepo` branch: `ROOT` is `process.argv[2] ?? <repo root>` and
// nothing else reads it. The FIRST test below runs it against the true
// repository root with no argument at all, so nothing the copy does can hide a
// file the guard needs — and the second asserts the untouched copy is green, so
// every mutation is proven to fail for its OWN reason rather than for one the
// copy already had.
//
// ⚠️ EVERY MUTATION ASSERTS THAT IT ACTUALLY APPLIED. A regex that silently
// matched nothing produces a test that runs the guard against pristine input and
// passes for the opposite of the intended reason — which is the same shape as
// the `$?`-after-a-command-substitution loop that reported EXIT 0 for a guard
// exiting 1. `mutate()` throws if the text did not change.
//
//   M1 `feature` deleted from the DDL                  -> exit 1, R2 + R1 both name it
//   M2 `feature TEXT NOT NULL DEFAULT ''` -> `TEXT`    -> exit 1, NULLABLE + no default
//   M3 `feature` removed from ux_events_daily_grain    -> exit 1, index ≠ ON CONFLICT
//   M4 `rollupBoundedCutoff` deleted from scheduled.ts -> exit 1, "declares no"
//   M5 the cutoff reverted to bare `ageCutoff`         -> exit 1, "never produced by"
//   M6 the query directory emptied / removed           -> exit 1 COVERAGE LOST
//   M7 a query grows a column the grain cannot carry   -> exit 1, R1's own failing case
//
// M7 is the one that keeps R1 honest. The five queries still read raw `events`
// and R1 deliberately does NOT fail on that (the cutover is deferred), so
// without M7 R1 would be an assertion with no reachable failing input — worse
// than none, because it inflates apparent coverage.
//
// Run:  node --test "tooling/ci/test/rollup-lossless.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GRAIN_COVERAGE,
  REQUIRED_GRAIN,
  baseIdentifiers,
  blankTsStrings,
  declInitializer,
  functionBody,
  indexesOn,
  queryColumnRefs,
  readmeQueries,
  splitTopLevel,
  stripSqlComments,
  stripTsComments,
  tableColumns,
} from '../assert-rollup-lossless.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-rollup-lossless.mjs');

const MIGRATION = 'services/platform/migrations/0007_events_rollup.sql';
const SCHEDULED = 'services/platform/src/scheduled.ts';
const INSIGHTS = 'services/platform/queries/insights';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-rollup-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A copy of exactly the files the guard reads, byte-identical to the shipped
 *  ones. Trimming is safe here and is asserted safe by the first test, which
 *  runs the guard against the untrimmed repository. */
function copyOfRealTree() {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'services/platform/migrations'), { recursive: true });
  mkdirSync(join(root, 'services/platform/src'), { recursive: true });
  mkdirSync(join(root, 'services/platform/queries'), { recursive: true });
  copyFileSync(join(REPO, MIGRATION), join(root, MIGRATION));
  copyFileSync(join(REPO, SCHEDULED), join(root, SCHEDULED));
  cpSync(join(REPO, INSIGHTS), join(root, INSIGHTS), { recursive: true });
  return root;
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

/** Apply one textual mutation and PROVE it landed. A mutation that matched
 *  nothing leaves the guard running against pristine input, and the test then
 *  passes for the exact opposite of its intended reason. */
function mutate(root, rel, find, replace) {
  const before = read(root, rel);
  const after = before.replace(find, replace);
  assert.notEqual(after, before, `the mutation of ${rel} matched nothing — this test would have proven the opposite of what it claims`);
  writeFileSync(join(root, rel), after);
  return after;
}

const run = (root) => {
  const r = spawnSync(process.execPath, root ? [GUARD, root] : [GUARD], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless — the real tree and its copy must be green FIRST', () => {
  test('the true repository root, untrimmed and unmodified, passes', () => {
    const r = run(null);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the grain covers every column/);
  });

  test('an untouched COPY of the shipped files passes identically', () => {
    const r = run(copyOfRealTree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the grain covers every column/);
  });

  test('the LANDED cutover is printed — all five queries read `events_daily`, none reads raw `events`', () => {
    // This test asserted the OPPOSITE until PR-2 ("the deferred cutover is
    // PRINTED, not failed"), and that is the point of keeping it: the guard's
    // print is a statement about the tree, so when the tree moved the assertion
    // had to move with it or it would have gone on reassuring a reader about a
    // deferral that had ended.
    const r = run(null);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /5 of 5 quer\(ies\) READ `events_daily` — THE CUTOVER HAS LANDED/);
    assert.match(r.out, /0 still read raw `events`/);
  });

  test('R3 announces that it is a TRIPWIRE and names the behavioural proof', () => {
    const r = run(null);
    assert.match(r.out, /R3 IS A TRIPWIRE, NOT THE PROOF/);
    assert.match(r.out, /services\/platform\/test\/events-rollup\.test\.ts/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless [R2] — the idempotency the whole table rests on', () => {
  test('M1 — `feature` deleted from the DDL FAILS, and BOTH limbs name it', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /\n\s*feature\s+TEXT\s+NOT NULL DEFAULT '',[^\n]*/, '');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    // R2: the index and the INSERT still name a column the table does not have.
    assert.match(r.out, /grain column `feature` is not a column of events_daily/);
    // R1: 05-feature-adoption.sql reads `feature` straight off events_daily
    // since the cutover, so the DDL losing the column is caught directly rather
    // than through the GRAIN_COVERAGE map.
    assert.match(r.out, /05-feature-adoption\.sql reads `feature` off `events_daily` and the shipped DDL/);
  });

  test('M2 — `feature TEXT NOT NULL DEFAULT \'\'` weakened to `feature TEXT` FAILS', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /feature(\s+)TEXT\s+NOT NULL DEFAULT ''/, 'feature$1TEXT');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    // The measured failure: NULLs are DISTINCT in a unique index, so ON CONFLICT
    // stops firing for the ~90% of rows that are not `feature_used`.
    assert.match(r.out, /is NULLABLE/);
    assert.match(r.out, /three identical runs produced THREE rows with a NULL sentinel and ONE with ''/);
  });

  test("M2b — NOT NULL kept but the '' default removed still FAILS", () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /feature(\s+)TEXT\s+NOT NULL DEFAULT ''/, 'feature$1TEXT    NOT NULL');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no `DEFAULT ''`/);
  });

  test('M3 — `feature` removed from ux_events_daily_grain FAILS: the index and ON CONFLICT disagree', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /(ON events_daily \(day, app_id, anon_id, event), feature\)/, '$1)');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the grain is stated twice and the two disagree/);
    assert.match(r.out, /an upsert that never fires/);
  });

  test('M3b — the grain index dropped to non-UNIQUE FAILS', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /CREATE UNIQUE INDEX IF NOT EXISTS ux_events_daily_grain/, 'CREATE INDEX IF NOT EXISTS ux_events_daily_grain');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`ux_events_daily_grain` is not UNIQUE/);
  });

  test('M3c — the grain index renamed away FAILS rather than passing on a lookalike', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /ux_events_daily_grain/g, 'ux_events_daily_other');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no index named `ux_events_daily_grain`/);
  });

  test('M3d — the ON CONFLICT target in the CODE losing a column FAILS from the other side', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /ON CONFLICT \(day, app_id, anon_id, event, feature\)/, 'ON CONFLICT (day, app_id, anon_id, event)');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not in the rollup's ON CONFLICT target/);
  });

  test('M3e — a grain column made nullable in the DDL FAILS for every one of the five', () => {
    for (const col of REQUIRED_GRAIN) {
      const root = copyOfRealTree();
      mutate(root, MIGRATION, new RegExp(`(\\n\\s*${col}\\s+(?:TEXT|INTEGER))\\s+NOT NULL`), '$1');
      const r = run(root);
      assert.equal(r.code, 1, `${col}: ${r.out}`);
      assert.match(r.out, new RegExp(`\`${col} `), `${col} was made nullable and the guard did not name it`);
      assert.match(r.out, /is NULLABLE/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless [R3] — the fail-closed watermark wiring', () => {
  test('M4 — `rollupBoundedCutoff` deleted from scheduled.ts FAILS', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /export function rollupBoundedCutoff\([\s\S]*?\n\}\n/, '');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `rollupBoundedCutoff`/);
    assert.match(r.out, /deletes on age alone and destroys history the rollup has not consumed/);
  });

  test('M5 — the events cutoff reverted to bare `ageCutoff` FAILS, with the function still declared', () => {
    const root = copyOfRealTree();
    const after = mutate(
      root,
      SCHEDULED,
      /const bounded = store === 'events' \? rollupBoundedCutoff\(ageCutoff, watermark\) : ageCutoff;/,
      'const bounded = ageCutoff;',
    );
    // The declaration survives this mutation on purpose: a guard that only
    // checked "is it declared" would be green here, and this is the regression
    // that actually destroys data.
    assert.match(after, /export function rollupBoundedCutoff\(/);
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is never produced by `rollupBoundedCutoff\(…\)`/);
    assert.match(r.out, /It is therefore an AGE cutoff/);
  });

  test('M5b — the watermark read removed from retentionSweep FAILS', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /const watermark = await rolledThrough\(env\);/, 'const watermark = null;');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never calls `rolledThrough\(`/);
  });

  test('the cutoff is traced through the local declaration, and the passing run says which name', () => {
    const r = run(null);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /passes through `rollupBoundedCutoff` via `bounded`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless [R1] — the grain covers what the queries read', () => {
  test('M6 — an EMPTY query directory is COVERAGE LOST, never a smaller green run', () => {
    const root = copyOfRealTree();
    for (const f of ['01-activation-rate.sql', '02-retention-d1-d7-d30.sql', '03-paywall-conversion.sql', '04-notification-lift.sql', '05-feature-adoption.sql']) {
      rmSync(join(root, INSIGHTS, f));
    }
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /contains no \.sql file/);
  });

  test('M6b — the query directory removed entirely is COVERAGE LOST', () => {
    const root = copyOfRealTree();
    rmSync(join(root, INSIGHTS), { recursive: true, force: true });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /R1 would range over zero queries/);
  });

  test('M6c — ONE query deleted while README still documents five is COVERAGE LOST, naming the count', () => {
    const root = copyOfRealTree();
    rmSync(join(root, INSIGHTS, '05-feature-adoption.sql'));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /documents 5 quer\(ies\) and only 4 \.sql file\(s\) are present — 1 MISSING: 05-feature-adoption\.sql/);
  });

  test('M7 — a query that grows a column events_daily does not have FAILS', () => {
    const root = copyOfRealTree();
    mutate(
      root,
      join(INSIGHTS, '01-activation-rate.sql'),
      /AND event = 'first_launch'/,
      "AND event = 'first_launch'\n    AND geo_country = 'IN'",
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reads `geo_country` off `events_daily` and the shipped DDL/);
  });

  test('M8 — a query REVERTED to raw `events` FAILS: the cutover is a ratchet, not a preference', () => {
    // Until PR-2 this was a PRINT, and deliberately so — the queries had not
    // moved. They have. A query back on the raw table is a number the 400-day
    // sweep eats, one night at a time, while the query goes on answering.
    const root = copyOfRealTree();
    mutate(root, join(INSIGHTS, '03-paywall-conversion.sql'), /FROM events_daily/, 'FROM events');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /03-paywall-conversion\.sql READS THE RAW `events` TABLE/);
    assert.match(r.out, /the 400-day `events` sweep DESTROYS/);
  });

  test('M8b — GRAIN_COVERAGE still has a reachable failing case: a raw-reverted query reading an uncovered column', () => {
    // 🔴 WHY THIS EXISTS. After the cutover NO shipped query reaches the
    // GRAIN_COVERAGE branch, so that branch would have no reachable failing
    // input — an assertion that cannot fail, which is worse than none because it
    // inflates apparent coverage. This is the input that reaches it.
    const root = copyOfRealTree();
    mutate(root, join(INSIGHTS, '03-paywall-conversion.sql'), /FROM events_daily/, 'FROM events');
    mutate(
      root,
      join(INSIGHTS, '03-paywall-conversion.sql'),
      /AND day >= substr\(\?2, 1, 10\)/,
      "AND geo_country = 'IN'\n    AND day >= substr(?2, 1, 10)",
    );
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reads `geo_country` off the raw `events` table and the rollup grain carries no counterpart/);
  });

  test('M8c — a query reading NEITHER table is COVERAGE LOST, not a question R1 quietly skips', () => {
    const root = copyOfRealTree();
    mutate(root, join(INSIGHTS, '04-notification-lift.sql'), /FROM events_daily/g, 'FROM events_hourly');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /names neither `events_daily` nor `events` after FROM\/JOIN/);
  });

  test('M7b — the SAME new reference inside a COMMENT does NOT fail: structure, not prose', () => {
    const root = copyOfRealTree();
    mutate(
      root,
      join(INSIGHTS, '01-activation-rate.sql'),
      /AND event = 'first_launch'/,
      "AND event = 'first_launch' -- and never geo_country, which the grain drops",
    );
    const r = run(root);
    assert.equal(r.code, 0, r.out);
  });

  test('a query file that parses to zero columns is COVERAGE LOST, not a simple query', () => {
    const root = copyOfRealTree();
    writeFileSync(join(root, INSIGHTS, '01-activation-rate.sql'), '-- every line a comment\n-- SELECT anon_id FROM events;\n');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /parsed to ZERO column references/);
  });

  test('an undocumented query file FAILS — coverage this guard cannot see is coverage it cannot keep', () => {
    const root = copyOfRealTree();
    writeFileSync(join(root, INSIGHTS, '06-orphan.sql'), 'SELECT anon_id FROM events WHERE app_id = ?1;\n');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /06-orphan\.sql is not in README\.md's numbered list/);
  });

  test("an unparseable README list is COVERAGE LOST — the floor is gone while the count still prints", () => {
    const root = copyOfRealTree();
    writeFileSync(join(root, INSIGHTS, 'README.md'), '# five numbers\n\nNo machine-read list here any more.\n');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /machine-read list parsed to ZERO entries/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless — structural failures of the scan itself', () => {
  test('a missing migration is COVERAGE LOST', () => {
    const root = copyOfRealTree();
    rmSync(join(root, MIGRATION));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not exist, so events_daily's shape was read from nothing/);
  });

  test('a missing scheduled.ts is COVERAGE LOST', () => {
    const root = copyOfRealTree();
    rmSync(join(root, SCHEDULED));
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /neither the rollup INSERT nor the sweep wiring can be read/);
  });

  test('the CREATE TABLE renamed away is COVERAGE LOST, not an empty column set that passes', () => {
    const root = copyOfRealTree();
    mutate(root, MIGRATION, /CREATE TABLE IF NOT EXISTS events_daily/, 'CREATE TABLE IF NOT EXISTS events_rollup');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `CREATE TABLE events_daily` body could be parsed/);
  });

  test('the rollup INSERT literal removed is COVERAGE LOST — the grain would come from the index it checks', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /INSERT INTO events_daily \(day, app_id, anon_id, event, feature, n_rows\)/, 'INSERT INTO events_hourly (day, app_id, anon_id, event, feature, n_rows)');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no string literal in .* contains `INSERT INTO events_daily`/);
    assert.match(r.out, /an assertion that cannot fail/);
  });

  test('retentionSweep renamed away is COVERAGE LOST', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /export async function retentionSweep\(/, 'export async function retentionSweepV2(');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`retentionSweep` could not be located/);
  });

  test('the deleteOlderThan call removed from the sweep is COVERAGE LOST', () => {
    const root = copyOfRealTree();
    mutate(root, SCHEDULED, /const n = await deleteOlderThan\(env, store, store === 'events_daily' \? bounded\.slice\(0, 10\) : bounded\);/, 'const n = 0;');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `deleteOlderThan\(env, store, cutoff\)` call with three arguments/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reductions, unit-tested. Each one below has already been the shape of a
// real bug in this repository: a grep that matched the comment explaining an
// absence, and a block-comment regex that ate its own file's imports.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-rollup-lossless — the SQL reduction reads structure, not prose', () => {
  test("stripSqlComments keeps `DEFAULT ''` and drops a comment that contains quotes", () => {
    const out = stripSqlComments("feature TEXT NOT NULL DEFAULT '', -- 'YYYY-MM-DD' UTC\n");
    assert.match(out, /DEFAULT ''/);
    assert.doesNotMatch(out, /YYYY-MM-DD/);
  });

  test('a CREATE TABLE inside a comment is not a table', () => {
    assert.equal(tableColumns('-- CREATE TABLE events_daily (ghost TEXT);\n', 'events_daily'), null);
  });

  test('tableColumns keeps each column definition intact, and drops table-level constraints', () => {
    const cols = tableColumns("CREATE TABLE t (a TEXT NOT NULL DEFAULT '', b INTEGER, UNIQUE (a, b));", 't');
    assert.deepEqual([...cols.keys()], ['a', 'b']);
    assert.equal(cols.get('a'), "TEXT NOT NULL DEFAULT ''");
  });

  test('indexesOn reports uniqueness and the ordered column list', () => {
    const ix = indexesOn('CREATE UNIQUE INDEX IF NOT EXISTS ux ON t (a, b);\nCREATE INDEX i2 ON t (b, a);', 't');
    assert.deepEqual(ix.map((x) => [x.name, x.unique, x.columns.join(',')]), [
      ['ux', true, 'a,b'],
      ['i2', false, 'b,a'],
    ]);
  });

  test('splitTopLevel does not split inside parens or string literals', () => {
    assert.deepEqual(splitTopLevel("a TEXT DEFAULT 'x,y', b INTEGER, CHECK (b IN (1, 2))"), [
      "a TEXT DEFAULT 'x,y'",
      'b INTEGER',
      'CHECK (b IN (1, 2))',
    ]);
  });

  test('queryColumnRefs excludes CTE names, table aliases, AS aliases and SQL vocabulary', () => {
    const { columns, ctes, baseTables } = queryColumnRefs(
      "WITH cohort AS (SELECT DISTINCT anon_id FROM events WHERE app_id = ?1 AND server_ts >= ?2)\n" +
        'SELECT COUNT(*) AS n FROM cohort c JOIN events e ON e.anon_id = c.anon_id;',
    );
    assert.deepEqual([...columns].sort(), ['anon_id', 'app_id', 'server_ts']);
    assert.deepEqual([...ctes], ['cohort']);
    assert.deepEqual([...baseTables], ['events']);
  });

  test('a string literal is never a column reference', () => {
    const { columns } = queryColumnRefs("SELECT anon_id FROM events WHERE event = 'first_launch';");
    assert.deepEqual([...columns].sort(), ['anon_id', 'event']);
  });

  test('a qualified reference contributes the COLUMN, not the alias', () => {
    const { columns } = queryColumnRefs('SELECT e.server_ts FROM events e;');
    assert.deepEqual([...columns], ['server_ts']);
  });

  test('every GRAIN_COVERAGE target is a real events_daily column in the shipped DDL', () => {
    const cols = tableColumns(readFileSync(join(REPO, MIGRATION), 'utf8'), 'events_daily');
    for (const [raw, target] of GRAIN_COVERAGE) {
      assert.ok(cols.has(target), `GRAIN_COVERAGE maps ${raw} → ${target}, which is not in the DDL`);
    }
  });

  test('readmeQueries parses the machine-read trailing shape', () => {
    assert.deepEqual(readmeQueries('1. **Activation** — blah. → `01-a.sql` (`activation_rate`)\n'), [
      { file: '01-a.sql', id: 'activation_rate' },
    ]);
  });

  test('the shipped README still yields exactly the five numbers', () => {
    const found = readmeQueries(readFileSync(join(REPO, INSIGHTS, 'README.md'), 'utf8'));
    assert.equal(found.length, 5);
  });
});

describe('assert-rollup-lossless — the TypeScript reduction', () => {
  test('stripTsComments removes comments and keeps string literals', () => {
    const out = stripTsComments("const a = 'ON CONFLICT (x)'; // ON CONFLICT (y)\n/* ON CONFLICT (z) */");
    assert.match(out, /ON CONFLICT \(x\)/);
    assert.doesNotMatch(out, /ON CONFLICT \(y\)/);
    assert.doesNotMatch(out, /ON CONFLICT \(z\)/);
  });

  test('stripTsComments does not treat a `//` inside a string as a comment', () => {
    assert.match(stripTsComments("const u = 'https://x/y'; const v = 1;"), /const v = 1/);
  });

  test('blankTsStrings preserves length, so brace matching stays aligned', () => {
    const src = 'const a = `x${1}y`; const b = 2;';
    assert.equal(blankTsStrings(src).length, src.length);
    assert.doesNotMatch(blankTsStrings(src), /\$\{/);
  });

  // 🔴 THE TRAP THIS ENCODES. `retentionSweep`'s second parameter has an OBJECT
  // LITERAL default, so the first `{` after the function name opens the DEFAULT,
  // not the body. A matcher that took it would return the three retention
  // constants, find no `deleteOlderThan`, and R3 would read as COVERAGE LOST
  // forever — a limb that never checks anything while never printing ok either.
  test('functionBody skips an object-literal DEFAULT PARAMETER and returns the real body', () => {
    const src = 'export async function f(\n  env: Env,\n  p: P = { a: 1, b: 2 },\n): Promise<void> {\n  const x = 1;\n}\n';
    assert.equal(functionBody(blankTsStrings(src), 'f').trim(), 'const x = 1;');
  });

  test('functionBody returns the real retentionSweep body from the shipped source', () => {
    const body = functionBody(blankTsStrings(stripTsComments(readFileSync(join(REPO, SCHEDULED), 'utf8'))), 'retentionSweep');
    assert.ok(body.includes('deleteOlderThan('), 'the sweep body did not contain its own DELETE call');
    assert.ok(body.includes('rollupBoundedCutoff('), 'the sweep body did not contain the interlock call');
  });

  test('declInitializer stops at the top-level semicolon', () => {
    assert.equal(declInitializer('const b = f(a, g(1; 2)) ? x : y; const c = 3;', 'b'), 'f(a, g(1; 2)) ? x : y');
  });

  test('baseIdentifiers ignores property access', () => {
    assert.deepEqual([...baseIdentifiers('store === 1 ? bounded.slice(0, 10) : bounded')].sort(), ['bounded', 'store']);
  });

  test('REQUIRED_GRAIN is exactly the five columns the acceptance sentence names', () => {
    assert.deepEqual(REQUIRED_GRAIN, ['day', 'app_id', 'anon_id', 'event', 'feature']);
  });
});
