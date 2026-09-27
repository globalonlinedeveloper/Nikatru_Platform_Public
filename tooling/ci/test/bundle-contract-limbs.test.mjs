// ─────────────────────────────────────────────────────────────────────────────
// bundle-contract-limbs.test.mjs — limbs 8, 9 and 10 of
// assert-entitlement-contract.mjs must be able to FAIL.
//
// The bundle half of the money schema ([ADR 057], landed 2026-09-09 by
// services/platform/migrations/0009_bundle_grants.sql). A separate file from
// entitlement-contract.test.mjs because these cases mutate the REAL tree's
// subject files rather than the synthetic migration that file builds — the
// bundle DDL is 300 lines of load-bearing shape, and a fixture I hand-wrote
// would encode my reading of it rather than the shipping one.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-09, eight, on
// the real worktree; every restore re-verified green). The cases below encode
// the same failing inputs.
//
//   BC1  `feature_set_version` deleted from the migration      -> exit 1
//   BC2  `bundle_grants.user_id` made NULLABLE                 -> exit 1
//   BC3  a source seeded in SQL and absent from bundle.js      -> exit 1
//   BC4  `requiresReceipt` flipped in bundle.js only           -> exit 1
//   BC5  the seed INSERT retargeted at another table           -> exit 1
//   BC6  ONE writer carrying the ordering clause               -> exit 0  ← accept
//   BC7  a SECOND writer into bundle_grants                    -> exit 1
//   BC8  the ordering clause deleted from the one writer       -> exit 1
//
// 🔴 TWO DEFECTS THE MUTATION RUN FOUND IN THE LIMBS THEMSELVES, and both were
// SILENT PASSES — the shape this whole file exists to catch:
//
//   (a) THE LIMBS WERE PLACED AFTER THE GUARD'S TERMINAL EXIT. The file ends with
//       `if (problems.length) { … process.exit(1) }` and then a success line. The
//       new limbs were appended below that check, so every `fail()` they raised
//       was pushed onto an array nobody read again, and ALL FIVE of BC1–BC5 came
//       back exit 0. Moved to before the terminal block.
//
//   (b) LIMB 10 SCANNED `blankSpans`, WHICH ERASES STRING LITERALS. The SQL lives
//       inside a template literal, so the view being searched had the subject
//       blanked out of it: the sweep found nothing, reported "no writer yet", and
//       printed clean over a real second writer. BC6, BC7 and BC8 all came back
//       exit 0. Limb 5 has iterated `stringSpans` since it was written, for
//       exactly this reason; limb 10 now does too.
//
// Neither defect is visible by reading. Both are the reason a guard without a
// mutation run is a guard nobody has tested.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-entitlement-contract.mjs');

const MIGRATION = 'services/platform/migrations/0009_bundle_grants.sql';
/** ⏱ 2026-09-27 · the second statement that seeds `bundle_sources` (`paddle_one_time`). */
const ONE_TIME_MIGRATION = 'services/platform/migrations/0019_one_time_source.sql';
const BUNDLE_JS = 'contracts/entitlement/bundle.js';
const BUNDLE_JSON = 'contracts/entitlement/bundle.json';
const WRITER = 'services/platform/src/lib/mor/__probe_bundle_writer.ts';

/**
 * Everything the guard reads. Copied from the real tree, not authored — a
 * fixture I write encodes my own reading of the schema, and a copy of the
 * shipping files encodes theirs. The mutation is then the ONLY difference
 * between a green run and a red one, which is what makes the red attributable.
 */
const SUBJECT_DIRS = [
  'services/platform/migrations',
  'services/platform/src',
  'services/subscriptiontracker-api/src',
  'contracts/entitlement',
  'extensions/core/v1',
  'packages/purchases/lib/src/generated',
];

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-bc-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

function tree(mutate = () => {}) {
  const dir = join(TMP, `t${seq++}`);
  for (const rel of SUBJECT_DIRS) {
    const from = join(REPO, rel);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    cpSync(from, join(dir, rel), { recursive: true });
  }
  mutate(dir);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function editText(dir, rel, fn) {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

/** The SHIPPING writer — the module the Worker really deploys. */
const REAL_WRITER = 'services/platform/src/lib/mor/bundle-store.ts';

/**
 * Remove the shipping writer from a fixture tree.
 *
 * 🔴 EACH CASE MUST TEST ONE PROPERTY. Until `bundle-store.ts` existed, the cases
 * below wrote a probe writer into an otherwise writer-less tree. Once it existed,
 * BC6 ("one writer is accepted") was adding a probe ON TOP of it and therefore
 * exercising TWO writers, and BC8 ("a deleted clause is refused") was going red
 * for the COUNT rather than for the CLAUSE. A red for the wrong reason is a case
 * that keeps passing after the property it names has broken.
 */
const withoutRealWriter = (d) => rmSync(join(d, REAL_WRITER), { force: true });

/** A writer that is CORRECT — one INSERT, carrying the ordering clause verbatim. */
const GOOD_WRITER = [
  'export const upsertBundleGrant = `',
  'INSERT INTO bundle_grants (grant_id, user_id) VALUES (?,?)',
  '  ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET updated_at = excluded.updated_at',
  '  WHERE bundle_grants.occurred_at IS NULL OR excluded.occurred_at > bundle_grants.occurred_at`;',
].join('\n');

describe('limb 8 — the bundle tables, their columns and their NOT NULLs', () => {
  // ── THE GREEN CONTROL, FIRST. Without it every red below is unattributable.
  test('GREEN CONTROL — the real tree passes', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok  entitlement contract/);
  });

  test('BC1 — deleting `feature_set_version` from the migration is refused', () => {
    // 🔴 THE ONE COLUMN THIS LIMB EXISTS FOR. A grant that records only a feature
    // set NAME resolves against whatever the register says today, so editing a
    // config file silently changes a stranger's purchased rights. [ADR 057] §4.
    const r = run(
      tree((d) => editText(d, MIGRATION, (s) => s.replace('  feature_set_version      INTEGER NOT NULL,', ''))),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /bundle_grants\.feature_set_version — MISSING/);
  });

  test('BC2 — making `bundle_grants.user_id` nullable is refused', () => {
    // The [ADR 057] NULL trap, measured on the real DDL: three identical inserts
    // with a NULL key column produced THREE ROWS, no error — an upsert silently
    // became an append.
    const r = run(
      tree((d) =>
        editText(d, MIGRATION, (s) =>
          s.replace('  user_id                  TEXT NOT NULL,', '  user_id                  TEXT,'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /bundle_grants\.user_id is NULLABLE/);
  });
});

describe('limb 9 — the bundle source enum equals its runtime copies, BOTH ways', () => {
  test('BC3 — a source seeded in SQL and missing from the runtime copy is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, MIGRATION, (s) =>
          s.replace("  ('owner_comp',            0,", "  ('owner_comp2',           0, 'drift'),\n  ('owner_comp',            0,"),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'owner_comp2' is seeded in SQL but missing from/);
  });

  test('BC3b — a source in the runtime copy that the migration never seeds is refused', () => {
    // 🔴 THE OTHER DIRECTION. A one-way check passes a copy carrying every seeded
    // member PLUS an invented one — a provenance the database will never
    // classify, which a reader would render as if it were real.
    const r = run(
      tree((d) => {
        editText(d, BUNDLE_JS, (s) =>
          s.replace(
            "  { source: 'promo_code', requiresReceipt: false },",
            "  { source: 'invented_rail', requiresReceipt: true },\n  { source: 'promo_code', requiresReceipt: false },",
          ),
        );
        editText(d, BUNDLE_JSON, (s) =>
          s.replace(
            '    {\n      "source": "promo_code",',
            '    {\n      "source": "invented_rail",\n      "requiresReceipt": true\n    },\n    {\n      "source": "promo_code",',
          ),
        );
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares bundle source 'invented_rail', which is NOT seeded/);
  });

  test('BC4 — flipping `requiresReceipt` in one copy only is refused', () => {
    // THE FIELD THAT MATTERS. Every name still agrees; the flag decides whether a
    // grant from this source is legitimate with no receipt behind it, and a copy
    // that flips it turns a paid rail into one that mints access from nothing.
    const r = run(
      tree((d) =>
        editText(d, BUNDLE_JS, (s) =>
          s.replace(
            "{ source: 'paddle_subscription', requiresReceipt: true }",
            "{ source: 'paddle_subscription', requiresReceipt: false }",
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THIS IS THE FIELD THAT MATTERS/);
  });

  test('BC3c — a source seeded by a LATER migration and missing from the runtime copy is refused', () => {
    // ⏱ 2026-09-27 · migration 0019 seeds `paddle_one_time` in a SECOND
    // statement. Until this date the limb read the first statement only, so a
    // copy that left the later source out read as complete — the OLD guard exits
    // 0 on exactly this tree (lane draft-npdb-r2, red control RC-L9).
    const r = run(
      tree((d) => {
        editText(d, BUNDLE_JS, (s) => s.replace("  { source: 'paddle_one_time', requiresReceipt: true },\n", ''));
        editText(d, BUNDLE_JSON, (s) =>
          s.replace('    {\n      "source": "paddle_one_time",\n      "requiresReceipt": true\n    },\n', ''),
        );
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /'paddle_one_time' is seeded in SQL but missing from contracts\/entitlement\/bundle\.js/);
  });

  test('BC5 — retargeting EVERY seed INSERT at another table is COVERAGE LOST, not a pass', () => {
    // Both statements: 0009's seed and 0019's. Retargeting only the first now
    // leaves a real seed for the limb to read, which is the point of BC3c.
    const r = run(
      tree((d) => {
        editText(d, MIGRATION, (s) => s.replace(/INSERT INTO bundle_sources/, 'INSERT INTO bundle_sources_x'));
        editText(d, ONE_TIME_MIGRATION, (s) => s.replace(/INSERT INTO bundle_sources/, 'INSERT INTO bundle_sources_x'));
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `INSERT INTO bundle_sources/);
  });
});

describe('limb 10 — exactly ONE writer into bundle_grants, carrying the ordering clause', () => {
  test('a schema with NO writer PRINTS the gap and does not fail — the schema may land first', () => {
    // ⏱ RE-POINTED 2026-09-09. This case ran against the REAL tree while no
    // writer existed. `services/platform/src/lib/mor/bundle-store.ts` now exists,
    // so the real tree no longer produces the print — and a case asserting a
    // print that can never appear again is a case that tests nothing.
    //
    // The PROPERTY is still worth holding: a schema that lands before its writer
    // must PRINT rather than fail, or the guard would have to be waived on the
    // day the migration merged — which is how a repository learns that guards are
    // things you waive. So the fixture removes the writer instead of the tree
    // being expected not to have one.
    const r = run(tree((d) => rmSync(join(d, 'services/platform/src/lib/mor/bundle-store.ts'), { force: true })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb 10 — NO writer into `bundle_grants` exists yet/);
  });

  test('…and the REAL tree now has one, so the limb is load-bearing rather than printing', () => {
    // The other half, and without it the case above is satisfied by a limb that
    // can only ever print.
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /NO writer into `bundle_grants` exists yet/);
  });

  test('BC6 — ONE writer carrying the clause is ACCEPTED', () => {
    // 🔴 THE ACCEPT CASE, and without it the two reds below prove nothing: a limb
    // that refused every writer would "catch" both mutations and be useless.
    const r = run(
      tree((d) => {
        withoutRealWriter(d);
        writeFileSync(join(d, WRITER), GOOD_WRITER);
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /NO writer into `bundle_grants` exists yet/);
  });

  test('BC7 — a SECOND writer is refused', () => {
    const r = run(
      tree((d) => {
        writeFileSync(join(d, WRITER), GOOD_WRITER);
        writeFileSync(join(d, WRITER.replace('__probe_bundle_writer', '__probe_bundle_writer_two')), GOOD_WRITER);
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ONE WRITER PER TABLE/);
  });

  test('BC8 — deleting the ordering clause from the one writer is refused', () => {
    const r = run(
      tree((d) => {
        // The shipping writer goes first, or this case would go red for the
        // COUNT (two writers) rather than for the CLAUSE — and a red for the
        // wrong reason keeps passing after the property it names has broken.
        withoutRealWriter(d);
        writeFileSync(
          join(d, WRITER),
          GOOD_WRITER.replace('\n  WHERE bundle_grants.occurred_at IS NULL OR excluded.occurred_at > bundle_grants.occurred_at', ''),
        );
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not carry the ordering clause verbatim/);
  });

  test('BC9 — the SHIPPING writer carries the clause, checked on the file that really runs', () => {
    // 🔴 THE CASE THE OTHERS CANNOT REPLACE. BC6 and BC8 grade a writer this file
    // wrote; only this one grades `services/platform/src/lib/mor/bundle-store.ts`.
    // A fixture writer that satisfies the limb says nothing about the module the
    // Worker actually deploys.
    const r = run(
      tree((d) =>
        writeFileSync(
          join(d, REAL_WRITER),
          readFileSync(join(REPO, REAL_WRITER), 'utf8').replace(
            /WHERE bundle_grants\.occurred_at IS NULL[\s\S]*?bundle_grants\.occurred_at/,
            'WHERE 1 = 1',
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not carry the ordering clause verbatim/);
  });
});

describe('the shared seed parser survives the three traps it was extracted with', () => {
  test('a description containing parentheses and commas does not desynchronise the scanner', async () => {
    const { parseSeededRows } = await import('../sql-seed.mjs');
    const sql = [
      "INSERT INTO t (a, b) VALUES",
      "  ('one', 'a sentence with (parentheses, commas) inside it'),",
      "  ('two', 'plain')",
      "ON CONFLICT(a) DO NOTHING;",
    ].join('\n');
    const r = parseSeededRows(sql, 't');
    assert.equal(r.ok, true);
    // 🔴 TWO ROWS, NOT THREE. The `ON CONFLICT(a)` tail is a parenthesised column
    // list that a naive tuple scanner reads as one more VALUES tuple — and then
    // the guard "finds" a seeded member called `a` and reports it as drift.
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.rows.map((x) => x.a), ['one', 'two']);
  });

  test("a doubled quote is one string, not the end of one", async () => {
    const { parseSeededRows } = await import('../sql-seed.mjs');
    const sql = "INSERT INTO t (a, b) VALUES ('x', 'Apple''s cert chain, verified'), ('y', 'z');";
    const r = parseSeededRows(sql, 't');
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.rows.map((x) => x.a), ['x', 'y']);
  });

  test('a missing seed is reported, never silently read as an empty set', async () => {
    const { parseSeededRows } = await import('../sql-seed.mjs');
    const r = parseSeededRows('CREATE TABLE t (a TEXT);', 't');
    assert.equal(r.ok, false);
    assert.match(r.why, /no `INSERT INTO t/);
  });

  test('parseAllSeededRows reads EVERY seeding statement, a later one with an extra column included', async () => {
    const { parseAllSeededRows, parseSeededRows } = await import('../sql-seed.mjs');
    const sql = [
      "INSERT INTO t (a, b) VALUES ('one', 'x (y, z)'), ('two', 'plain') ON CONFLICT(a) DO NOTHING;",
      'ALTER TABLE t ADD COLUMN c TEXT;',
      "INSERT INTO t (a, b, c) VALUES ('three', 'later', 'one_time') ON CONFLICT(a) DO NOTHING;",
    ].join('\n');
    const all = parseAllSeededRows(sql, 't');
    assert.equal(all.ok, true);
    assert.equal(all.statements, 2);
    assert.deepEqual(all.rows.map((x) => x.a), ['one', 'two', 'three']);
    assert.deepEqual(all.columns, ['a', 'b', 'c']);
    assert.equal(all.rows[2].c, 'one_time');
    // The first-statement reader, on the same text, never sees the third row.
    assert.deepEqual(parseSeededRows(sql, 't').rows.map((x) => x.a), ['one', 'two']);
    assert.equal(parseAllSeededRows('CREATE TABLE t (a TEXT);', 't').ok, false);
  });
});
