// ─────────────────────────────────────────────────────────────────────────────
// guards.test.mjs — the guards must be able to FAIL.
//
// Every guard in tooling/ci runs on every build, but only ever against the real
// repository — which is, by definition, valid input. So CI exercises the passing
// path and nothing else. A guard that silently stops working still prints "ok",
// and the requirement it enforces silently stops being true while the pipeline
// spec still says VERIFIED.
//
// That is not hypothetical. Both have already happened here:
//   · check-migrations.mjs's own coverage assertion omits services/subly-api,
//     so a renamed directory would report "clean" over an incomplete set.
//   · assert-gate-passed.mjs shipped with an off-by-one that made it unable to
//     read its own SHA argument. It blocked both production deploys, and it was
//     found because the deploys broke — not because anything tested the guard.
//
// So: feed each guard KNOWN-BAD input and assert it fails; feed it KNOWN-GOOD
// input and assert it passes. Fixtures are built in a temp dir, never in the
// repo. No network — the two API-backed guards are covered for argument and
// decision handling only, which is exactly where the real defect was.
//
// Pipeline requirement: Private/requirements/ → F-10.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Run:  node --test "tooling/ci/test/*.test.mjs"   (glob, so every *.test.mjs runs;
//       a bare directory path is treated as a module on Windows and throws)
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// The shared blanker, never a hand-rolled rival. Used by exactly one case in
// this file (assert-workflow-hardening, "REFUSES when its own canaries fail"),
// which has to find a line of CODE in a guard that quotes its own source in
// prose — see the comment there for why a raw substring count is wrong.
import { stripSourceComments } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-guard-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Build a throwaway fixture tree. `files` maps relative path → contents. */
function fixture(name, files) {
  const dir = join(ROOT, name);
  for (const [rel, body] of Object.entries(files)) {
    // `null` means the file is ABSENT — the only way to fixture a COVERAGE LOST
    // case for a guard that reads a specific path.
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run a guard as CI runs it: a real subprocess, real exit code. */
function run(script, { cwd = ROOT, args = [], env } = {}) {
  const r = spawnSync(process.execPath, [join(CI_DIR, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: env === undefined ? process.env : env,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const pubspec = (name) => `name: ${name}\n`;
const rootPubspec = (members) =>
  `name: fixture\nworkspace:\n${members.map((m) => `  - ${m}\n`).join('')}`;

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-workspace-coverage', () => {
  const build = (name, onDisk, declared) => {
    const files = { 'pubspec.yaml': rootPubspec(declared) };
    for (const p of onDisk) files[`${p}/pubspec.yaml`] = pubspec(p.split('/').pop());
    return fixture(name, files);
  };
  const six = ['packages/a', 'packages/b', 'packages/c', 'packages/d', 'packages/e', 'apps/f'];

  test('PASSES when every package on disk is a workspace member', () => {
    const { code } = run('assert-workspace-coverage.mjs', { args: [build('wc-ok', six, six)] });
    assert.equal(code, 0);
  });

  test('FAILS when a package on disk is missing from the list, and names it', () => {
    const dir = build('wc-unlisted', six, six.slice(0, 5));
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /apps\/f/);
  });

  test('FAILS when a listed member does not exist on disk', () => {
    const dir = build('wc-stale', six, [...six, 'packages/ghost']);
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /ghost/);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const two = ['packages/a', 'packages/b'];
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [build('wc-cov', two, two)] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-migrations', () => {
  const ADDITIVE = 'CREATE TABLE IF NOT EXISTS t (id TEXT);\nALTER TABLE t ADD COLUMN x TEXT;\n';
  // 🔴 THE FIXTURE MUST MIRROR THE REAL TREE, OR IT ENCODES THE SAME BLIND SPOT.
  // Until 2026-08-01 this builder wrote ONLY services/platform + the brick and
  // asserted exit 0 — so "a tree with zero services/subly-api coverage" was
  // literally the suite's definition of clean, and the guard's REQUIRED_COVERAGE
  // omitted subly-api to match. A passing fixture that is missing what the real
  // tree has cannot ever notice the omission.
  /** A wrangler config declaring a `migrations_dir` — the DECLARATION that makes
   *  a migrations directory something wrangler will apply to a real database.
   *  The fixture needs these because the guard's second coverage limb derives
   *  the "a new migration set arrived" set from the deployable configs, not from
   *  folders on disk: a bare `migrations/` nothing is bound to applies to
   *  nothing. A fixture with SQL but no config would have made that limb range
   *  over an empty set in every test here. */
  const CFG = (dbName) =>
    JSON.stringify({
      name: dbName,
      d1_databases: [
        { binding: 'DB', database_name: dbName, database_id: 'id', migrations_dir: 'migrations' },
      ],
    });

  const build = (name, platformSql, brickSql = ADDITIVE, extra = {}) =>
    fixture(name, {
      'services/platform/migrations/0001_init.sql': platformSql,
      'services/platform/wrangler.jsonc': CFG('platform_db'),
      'services/subly-api/migrations/0001_init.sql': ADDITIVE,
      'services/subly-api/wrangler.jsonc': CFG('subly_db'),
      'tooling/bricks/app/__brick__/svc/migrations/0001_init.sql': brickSql,
      'tooling/bricks/app/__brick__/svc/wrangler.jsonc': CFG('app_db'),
      ...extra,
    });

  test('PASSES on additive-only migrations', () => {
    const { code } = run('check-migrations.mjs', { cwd: build('mig-ok', ADDITIVE) });
    assert.equal(code, 0);
  });

  for (const [label, sql, needle] of [
    ['DROP TABLE', 'DROP TABLE t;\n', /DROP TABLE/i],
    ['RENAME', 'ALTER TABLE t RENAME TO u;\n', /RENAME/i],
    ['NOT NULL with no DEFAULT', 'ALTER TABLE t ADD COLUMN y TEXT NOT NULL;\n', /NOT NULL/i],
  ]) {
    test(`FAILS on ${label}`, () => {
      const { code, out } = run('check-migrations.mjs', { cwd: build(`mig-${label.replace(/\W+/g, '')}`, sql) });
      assert.equal(code, 1);
      assert.match(out, needle);
    });
  }

  // 🔴 THE FINAL STATEMENT OF EVERY FILE WAS UNSCANNABLE. The NOT-NULL rule
  // matched `…NOT NULL…;` — the terminating semicolon was MANDATORY — so a
  // statement without one fell outside the pattern entirely. Mutation-proven
  // against the real tree 2026-08-01: `ALTER TABLE events ADD COLUMN tenant TEXT
  // NOT NULL` with no trailing `;` printed "7 migration file(s) clean", exit 0;
  // the identical statement WITH the `;` exited 1. A trailing semicolon is
  // optional in SQL and wrangler applies the statement either way — the guard
  // was the only thing that cared about the punctuation, and every migration has
  // a last statement.
  for (const [label, sql] of [
    ['at end of file with no trailing newline', 'ALTER TABLE t ADD COLUMN y TEXT NOT NULL'],
    ['at end of file with a trailing newline', 'ALTER TABLE t ADD COLUMN y TEXT NOT NULL\n'],
    ['after an earlier terminated statement', `${ADDITIVE}ALTER TABLE t ADD COLUMN y TEXT NOT NULL\n`],
  ]) {
    test(`FAILS on an UNTERMINATED NOT NULL column ${label}`, () => {
      const { code, out } = run('check-migrations.mjs', {
        cwd: build(`mig-unterm-${label.replace(/\W+/g, '')}`, sql),
      });
      assert.equal(code, 1, 'a missing semicolon is not a licence to skip the rule');
      assert.match(out, /BANNED ADD COLUMN … NOT NULL without DEFAULT/);
    });
  }

  // The false-alarm side: making the terminator optional must not start firing
  // on the legitimate form, terminated or not.
  for (const [label, sql] of [
    ['terminated', "ALTER TABLE t ADD COLUMN y TEXT NOT NULL DEFAULT '';\n"],
    ['unterminated', "ALTER TABLE t ADD COLUMN y TEXT NOT NULL DEFAULT ''"],
  ]) {
    test(`does NOT trip on a ${label} NOT NULL column that HAS a DEFAULT`, () => {
      const { code, out } = run('check-migrations.mjs', {
        cwd: build(`mig-default-${label}`, `${ADDITIVE}${sql}`),
      });
      assert.equal(code, 0, out);
    });
  }

  test('does NOT trip on a banned keyword inside a comment', () => {
    const sql = `-- we never DROP TABLE here, and never RENAME either\n${ADDITIVE}`;
    const { code } = run('check-migrations.mjs', { cwd: build('mig-comment', sql) });
    assert.equal(code, 0);
  });

  test('FAILS its own coverage check when a required migration set is absent', () => {
    const dir = fixture('mig-cov', { 'services/platform/migrations/0001_init.sql': ADDITIVE });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/i);
  });

  // 🔴 THE MIGRATION DIRECTORY THAT MOVES. This is not hypothetical: the brick's
  // move once shrank the scan 5 → 4 and reported PASS, which is what founded
  // REQUIRED_COVERAGE in the first place — and subly-api was then left out of it.
  // Mutation-proven on a copy of the real tree 2026-08-01: renaming
  // services/subly-api/migrations made the guard scan 4 files instead of 6 and
  // still print "clean", exit 0.
  test("FAILS when subly-api's migrations move out from under the glob", () => {
    const dir = fixture('mig-cov-sublyapi', {
      'services/platform/migrations/0001_init.sql': ADDITIVE,
      'services/subly-api/db-migrations/0001_init.sql': ADDITIVE, // renamed
      'tooling/bricks/app/__brick__/svc/migrations/0001_init.sql': ADDITIVE,
    });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1, 'the files did not become safe; the guard stopped looking at them');
    assert.match(out, /COVERAGE LOST/i);
    assert.match(out, /services\/subly-api/);
  });

  // ── [pipeline B-8] the coverage limb that points the OTHER way ────────────
  // The two tests above catch a migration set that VANISHED. Nothing caught one
  // that ARRIVED: `REQUIRED_COVERAGE` is a written list, and a written list
  // cannot know about the backend app #2 stamps. Mutation-proven against the
  // REAL tree 2026-08-03 — a `services/probe-api/wrangler.jsonc` carrying a
  // `migrations_dir`, dropped in beside the real ones, produced
  // "COVERAGE LOST — a wrangler config declares a `migrations_dir` that
  // REQUIRED_COVERAGE does not name: services/probe-api/wrangler.jsonc", exit 1;
  // removing it returned the guard to exit 0 over the real 3 configs.
  test('FAILS when a NEW service declares a migrations_dir nothing names', () => {
    const dir = build('mig-new-service', ADDITIVE, ADDITIVE, {
      'services/probe-api/wrangler.jsonc': CFG('probe_db'),
      'services/probe-api/migrations/0001_init.sql': ADDITIVE,
    });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1, 'a schema wrangler will apply that this scanner has never read');
    assert.match(out, /COVERAGE LOST/i);
    assert.match(out, /services\/probe-api/);
  });

  test('a new service with NO migrations_dir is not flagged — the limb is about applied schema', () => {
    // A Worker with no migrations of its own is a normal thing to add. Flagging
    // it would make the guard noise, and noise is how a real signal gets muted.
    const dir = build('mig-new-service-nomig', ADDITIVE, ADDITIVE, {
      'services/probe-api/wrangler.jsonc': JSON.stringify({
        name: 'probe',
        d1_databases: [{ binding: 'SHARED', database_name: 'platform_db', database_id: 'id' }],
      }),
    });
    const { code } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 0);
  });

  test('an UNPARSEABLE wrangler config is COVERAGE LOST, never a silent skip', () => {
    // A config the scanner cannot read is one whose migrations_dir it cannot
    // see — indistinguishable from one that has none, which reads as green.
    const dir = build('mig-badcfg', ADDITIVE, ADDITIVE, {
      'services/probe-api/wrangler.jsonc': '{ this is not json',
    });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/i);
    assert.match(out, /could not be parsed/);
  });

  test('COVERAGE LOST when NO wrangler config matches at all', () => {
    // The empty-domain failure: with no configs the arrival limb ranges over
    // nothing and cannot fail, which is exactly the shape this repo keeps
    // getting caught by.
    const dir = fixture('mig-nocfg', {
      'services/platform/migrations/0001_init.sql': ADDITIVE,
      'services/subly-api/migrations/0001_init.sql': ADDITIVE,
      'tooling/bricks/app/__brick__/svc/migrations/0001_init.sql': ADDITIVE,
    });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /ranges over NOTHING/);
  });

  // ── the destructive DML class ─────────────────────────────────────────────
  // Added 2026-08-01. Mutation-proven first: a migration containing
  // `DELETE FROM events;` + `UPDATE events SET app_id = NULL;` dropped into the
  // real services/platform/migrations produced
  // "check-migrations: 7 migration file(s) clean — additive-only holds.", exit 0.
  // deploy-workers.yml applies migrations --remote with no human in the loop.
  for (const [label, sql, needle] of [
    ['an unfiltered DELETE', 'DELETE FROM t;\n', /DELETE without WHERE/i],
    ['an unfiltered UPDATE that nulls a column', 'UPDATE t SET x = NULL;\n', /UPDATE .* without WHERE/i],
    ['a multi-line unfiltered UPDATE', 'UPDATE t\n   SET x = NULL;\n', /UPDATE .* without WHERE/i],
    ['TRUNCATE', 'TRUNCATE TABLE t;\n', /TRUNCATE/i],
    ['DROP DATABASE', 'DROP DATABASE app;\n', /DROP DATABASE/i],
    ['INSERT OR REPLACE', "INSERT OR REPLACE INTO t (id) VALUES ('a');\n", /INSERT OR REPLACE/i],
    ['REPLACE INTO', "REPLACE INTO t (id) VALUES ('a');\n", /REPLACE/i],
  ]) {
    test(`FAILS on ${label}`, () => {
      const { code, out } = run('check-migrations.mjs', {
        cwd: build(`mig-dml-${label.replace(/\W+/g, '')}`, `${ADDITIVE}${sql}`),
      });
      assert.equal(code, 1);
      assert.match(out, needle);
    });
  }

  // ── the shapes that must STAY green, or the rule gets weakened within a week ─
  test('does NOT trip on a WHERE-narrowed backfill — the shape the real tree already ships', () => {
    // services/subly-api/migrations/0002_schema_debt.sql carries two of these,
    // applied --remote. A blanket UPDATE ban would fail HEAD.
    const sql = `${ADDITIVE}UPDATE t\n   SET x = lower(hex(randomblob(16)))\n WHERE x IS NULL OR x = '';\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-backfill', sql) });
    assert.equal(code, 0, out);
  });

  test('does NOT trip on a WHERE-narrowed DELETE', () => {
    const sql = `${ADDITIVE}DELETE FROM t WHERE id = 'stale';\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-delwhere', sql) });
    assert.equal(code, 0, out);
  });

  test('does NOT trip on DELETE/TRUNCATE written in a comment', () => {
    const sql = `-- no DELETE FROM and no TRUNCATE here, ever\n${ADDITIVE}`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-comment', sql) });
    assert.equal(code, 0, out);
  });

  test('does NOT trip on the words inside a string literal', () => {
    const sql = `${ADDITIVE}INSERT INTO t (id) VALUES ('DELETE FROM t; TRUNCATE t;');\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-string', sql) });
    assert.equal(code, 0, out);
  });

  // ── the reviewed escape hatch ─────────────────────────────────────────────
  test('an approved unfiltered DELETE passes AND is printed, never silently waved through', () => {
    const sql =
      `${ADDITIVE}-- migration:destructive-approved ADR-999 drop the dry-run rows\nDELETE FROM t;\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-approved', sql) });
    assert.equal(code, 0, out);
    assert.match(out, /destructive statements running under an explicit approval marker/i);
    assert.match(out, /ADR-999 drop the dry-run rows/);
  });

  test('the marker on the statement’s own line also counts', () => {
    const sql = `${ADDITIVE}TRUNCATE t; -- migration:destructive-approved ADR-999 same repair\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-approved-inline', sql) });
    assert.equal(code, 0, out);
    assert.match(out, /TRUNCATE — approved: ADR-999 same repair/);
  });

  // The hatch must annotate ONE statement, not open a season. A marker parked at
  // the top of the file cannot bless everything below it.
  test('an approval marker does NOT travel past intervening SQL', () => {
    const sql =
      `-- migration:destructive-approved ADR-999 the one below only\nDELETE FROM t;\n\n` +
      `-- an unrelated note\nUPDATE t SET x = NULL;\n${ADDITIVE}`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-approval-scope', sql) });
    assert.equal(code, 1);
    assert.match(out, /BANNED UPDATE .* without WHERE/i);
    assert.doesNotMatch(out, /BANNED DELETE without WHERE/i);
  });

  test('a bare marker with no justification does not approve anything', () => {
    const sql = `${ADDITIVE}-- migration:destructive-approved\nDELETE FROM t;\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-dml-approval-bare', sql) });
    assert.equal(code, 1, 'the marker must carry a reason a reviewer can read');
    assert.match(out, /BANNED DELETE without WHERE/i);
  });

  test('the DDL bans have NO escape hatch — only the DML class is approvable', () => {
    const sql = `-- migration:destructive-approved ADR-999 please\nDROP TABLE t;\n`;
    const { code, out } = run('check-migrations.mjs', { cwd: build('mig-ddl-no-hatch', sql) });
    assert.equal(code, 1, 'there is no additive reading of a DROP TABLE');
    assert.match(out, /BANNED DROP TABLE/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 REGRESSION CONTEXT. This guard read ONE hardcoded file
// (services/platform/wrangler.jsonc) while tooling/capability-register.json
// claimed it guarded ALLOWED_ORIGINS generally. Emptying services/subly-api's
// allowlist produced byte-identical output and exit 0 — a live user-data API
// could go permissive with CI fully green. Every test below that names
// subly-api would have PASSED against the old guard, which is exactly why they
// are here: the fork must not be able to come back silently.
//
// The extension was mutation-proven against a scratch COPY of the real tree
// before these tests existed (a fixture I write encodes the same
// misunderstanding as the guard I write): 8 mutations, each failing with its
// intended message and each restoring to green.
describe('assert-cors-allowlist', () => {
  const PLATFORM = [
    'https://subly.nikatru.com',
    'https://subly-9cp.pages.dev',
    'http://localhost:3000',
  ];
  // No localhost here: the per-app Worker allows it by regex (recorded trade).
  const SUBLY = ['https://subly.nikatru.com', 'https://subly-9cp.pages.dev'];

  const config = (origins) =>
    `{\n  // a Worker\n  "vars": { "ALLOWED_ORIGINS": "${origins.join(',')}" }\n}\n`;

  /** The app catalogue every required origin is DERIVED from ([4]B-2, [3]S-11).
   *  Without it the guard reports COVERAGE LOST rather than checking anything,
   *  so every fixture below is a tree that has one. */
  const CATALOGUE = JSON.stringify(
    [{ slug: 'subly', name: 'Subly', url: 'https://subly.nikatru.com', status: 'live' }],
    null,
    2,
  );

  /** Both Workers, each overridable. Anything less is not a valid tree — the
   *  guard is supposed to insist that every service it knows about is present. */
  const build = (name, { platform = config(PLATFORM), subly = config(SUBLY), extra = {} } = {}) =>
    fixture(name, {
      'catalog/apps.json': CATALOGUE,
      'services/platform/wrangler.jsonc': platform,
      'services/subly-api/wrangler.jsonc': subly,
      ...extra,
    });

  test('PASSES when every required origin is listed for BOTH Workers', () => {
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: build('cors-ok') });
    assert.equal(code, 0);
    // The tally must show it read two configs, not one — a guard that checked
    // half the tree and said "ok" is the defect this replaced.
    assert.match(out, /2 Worker config\(s\) checked/);
  });

  test('FAILS when a required PLATFORM origin is dropped, and names it', () => {
    const dir = build('cors-missing-platform', { platform: config(PLATFORM.slice(0, 2)) });
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /localhost:3000/);
    assert.match(out, /services\/platform/);
  });

  test('FAILS when a required SUBLY-API origin is dropped — the old guard could not see this', () => {
    const dir = build('cors-missing-subly', { subly: config(SUBLY.slice(0, 1)) });
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /services\/subly-api/);
    assert.match(out, /subly-9cp\.pages\.dev/);
  });

  test('FAILS on an empty PLATFORM allowlist', () => {
    const { code } = run('assert-cors-allowlist.mjs', {
      cwd: build('cors-empty-platform', { platform: config([]) }),
    });
    assert.equal(code, 1);
  });

  test('FAILS on an empty SUBLY-API allowlist — the exact mutation that shipped green', () => {
    const { code, out } = run('assert-cors-allowlist.mjs', {
      cwd: build('cors-empty-subly', { subly: config([]) }),
    });
    assert.equal(code, 1);
    assert.match(out, /services\/subly-api/);
    assert.match(out, /EMPTY/);
  });

  test('FAILS when ALLOWED_ORIGINS is absent from a Worker entirely', () => {
    const { code, out } = run('assert-cors-allowlist.mjs', {
      cwd: build('cors-absent-subly', { subly: '{ "name": "subly-api" }\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /ALLOWED_ORIGINS is missing/);
  });

  test('is STRUCTURAL — an origin mentioned only in a comment does not satisfy it', () => {
    const subly = `{\n  // https://subly-9cp.pages.dev used to be here\n  "vars": { "ALLOWED_ORIGINS": "https://subly.nikatru.com" }\n}\n`;
    const { code, out } = run('assert-cors-allowlist.mjs', {
      cwd: build('cors-comment', { subly }),
    });
    assert.equal(code, 1);
    assert.match(out, /subly-9cp\.pages\.dev/);
  });

  test('FAILS on a Worker it was never TAUGHT about — a new service is untaught scope, not out of scope', () => {
    const dir = build('cors-untaught', {
      extra: { 'services/newthing/wrangler.jsonc': config(['https://x.test']) },
    });
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /never been taught about services\/newthing/);
  });

  test('FAILS its own coverage check when a Worker POLICY names is not on disk', () => {
    // The rename case: services/subly-api moves and the guard keeps printing a
    // healthy tally over whatever is left.
    const dir = fixture('cors-renamed', {
      'catalog/apps.json': CATALOGUE,
      'services/platform/wrangler.jsonc': config(PLATFORM),
      'services/subly-backend/wrangler.jsonc': config(SUBLY),
    });
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /services\/subly-api/);
  });

  test('FAILS its own coverage check when fewer Workers than expected are found', () => {
    const dir = fixture('cors-one-worker', {
      'catalog/apps.json': CATALOGUE,
      'services/platform/wrangler.jsonc': config(PLATFORM),
    });
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('a directory under services/ with no Worker config is skipped, not failed', () => {
    const dir = build('cors-nonworker', {
      extra: { 'services/_notes/README.md': 'not a Worker\n' },
    });
    assert.equal(run('assert-cors-allowlist.mjs', { cwd: dir }).code, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No network. These cover argument and precondition handling only — which is
// precisely where the defect that blocked both production deploys lived.
describe('assert-gate-passed (offline paths)', () => {
  const baseEnv = { ...process.env, GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };

  test('REGRESSION: a bare SHA with no flag is parsed, not discarded', () => {
    // The bug: indexOf returns -1 when --timeout-seconds is absent, so
    // `timeoutIdx + 1` was 0 and argv[0] — the SHA — was filtered out.
    // Proven without network: if the SHA is read, the run advances PAST the SHA
    // check and stops on the next missing precondition instead.
    const env = { ...process.env, GITHUB_TOKEN: 't' };
    delete env.GITHUB_REPOSITORY;
    delete env.GH_TOKEN;
    const { code, out } = run('assert-gate-passed.mjs', { args: ['abc1234'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_REPOSITORY is not set/);
    assert.doesNotMatch(out, /no commit SHA given/);
  });

  test('FAILS with a named cause when no SHA is given', () => {
    const { code, out } = run('assert-gate-passed.mjs', { args: [], env: baseEnv });
    assert.equal(code, 1);
    assert.match(out, /no commit SHA given/);
  });

  test('does not mistake a flag VALUE for the SHA', () => {
    const { code, out } = run('assert-gate-passed.mjs', { args: ['--timeout-seconds', '10'], env: baseEnv });
    assert.equal(code, 1);
    assert.match(out, /no commit SHA given/);
  });

  test('FAILS when no token is available', () => {
    const env = { ...process.env, GITHUB_REPOSITORY: 'o/r' };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const { code, out } = run('assert-gate-passed.mjs', { args: ['abc1234'], env });
    assert.equal(code, 1);
    assert.match(out, /TOKEN/);
  });

  test('FAILS on a non-numeric timeout rather than waiting forever', () => {
    const { code, out } = run('assert-gate-passed.mjs', {
      args: ['abc1234', '--timeout-seconds', 'soon'],
      env: baseEnv,
    });
    assert.equal(code, 1);
    assert.match(out, /positive number/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-lane-coverage', () => {
  const EIGHT_DART = Array.from({ length: 8 }, (_, i) => `packages/p${i}`);
  const workflow = (paths) =>
    `name: CI\njobs:\n  a:\n    steps:\n${paths.map((p) => `      - run: build ${p}\n`).join('')}`;

  /** `dart` members go in the workspace list; everything else must be named in a workflow. */
  const build = (name, { dart = EIGHT_DART, declared = EIGHT_DART, workers = [], sites = [], named = [] } = {}) => {
    const files = {
      'pubspec.yaml': rootPubspec(declared),
      '.github/workflows/ci.yml': workflow(named),
    };
    for (const d of dart) files[`${d}/pubspec.yaml`] = pubspec(d.split('/').pop());
    for (const w of workers) files[`${w}/wrangler.jsonc`] = '{}\n';
    for (const s of sites) files[`${s}/index.html`] = '<html></html>\n';
    return fixture(name, files);
  };

  test('PASSES when every unit is claimed by the right mechanism', () => {
    const dir = build('lc-ok', { workers: ['services/w'], sites: ['sites/s'], named: ['services/w', 'sites/s'] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
    assert.match(out, /all claimed/);
  });

  test('FAILS when a Worker is named in no workflow', () => {
    const dir = build('lc-worker', { workers: ['services/w'], named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /services\/w/);
  });

  test('FAILS when a site is named in no workflow — the real F-9 gap', () => {
    const dir = build('lc-site', { sites: ['sites/nikatru'], named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /sites\/nikatru/);
  });

  test('FAILS when a dart package is outside the workspace', () => {
    const dir = build('lc-dart', { declared: EIGHT_DART.slice(0, 7) });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /packages\/p7/);
  });

  test('does NOT demand that dart packages be named in a workflow', () => {
    // The false-alarm case. melos covers members collectively and never names
    // them, so a naive path grep would report all eight as uncovered — and a
    // guard that cries wolf on eight packages is a guard someone switches off.
    const dir = build('lc-dart-ok', { named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const dir = build('lc-cov', { dart: ['packages/only'], declared: ['packages/only'] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── 🔴 A COMMENT IS NOT A LANE (2026-08-01 full-corpus review) ──────────────
  // isClaimed() was a raw substring match over the concatenated workflow text,
  // so any mention counted. That was not hypothetical: `sites/nikatru` and
  // `sites/rajasekarselvam` appeared in .github/workflows ONLY inside the prose
  // comment above the Site-integrity step, so gutting that step to `echo
  // skipped` left the Pages Function with its live KV binding checked by
  // nothing while this guard printed "all claimed". Reproduced on the real tree
  // both directions: gutted-step-plus-comment -> exit 0; comment reworded with
  // the real checks untouched -> exit 1. The claimable text is now
  // comment-stripped, `paths-ignore:` blocks are blanked, and the two sites'
  // claim became structural (ci.yml passes them as arguments to
  // check-site-integrity.mjs, which fails if a claimed root is not scanned).
  const commentWorkflow = (paths) =>
    `name: CI\njobs:\n  a:\n    steps:\n${paths.map((p) => `      # ${p} is deployed by Cloudflare's own Git integration\n`).join('')}      - run: echo skipped\n`;

  test('FAILS when a unit is named ONLY in a workflow comment', () => {
    const dir = build('lc-comment', { sites: ['sites/nikatru'], named: [] });
    writeFileSync(join(dir, '.github/workflows/ci.yml'), commentWorkflow(['sites/nikatru']));
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1, 'prose describing a lane is not a lane');
    assert.match(out, /sites\/nikatru/);
    assert.match(out, /claimed by no CI lane/);
  });

  test('FAILS when a unit appears only under paths-ignore — a path named so CI will NOT run', () => {
    const dir = build('lc-pathsignore', { workers: ['services/w'], named: [] });
    writeFileSync(
      join(dir, '.github/workflows/ci.yml'),
      "name: CI\non:\n  pull_request:\n    paths-ignore:\n      - 'services/w/**'\njobs:\n  a:\n    steps:\n      - run: echo hi\n",
    );
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1, 'an exclusion is the opposite of a claim');
    assert.match(out, /services\/w/);
  });

  // The false-alarm side: stripping comments must not strip the real claim, and
  // a path that is BOTH commented and genuinely run is still claimed.
  test('a real run line still claims the unit even when a comment repeats it', () => {
    const dir = build('lc-both', { sites: ['sites/nikatru'], named: [] });
    writeFileSync(
      join(dir, '.github/workflows/ci.yml'),
      "name: CI\njobs:\n  a:\n    steps:\n      # sites/nikatru is deployed by Cloudflare\n      - run: node tooling/ci/check-site-integrity.mjs . sites/nikatru\n",
    );
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
    assert.match(out, /all claimed/);
  });

  // paths-ignore blanking is indentation-scoped: the block ends at the first
  // line that dedents, so a `paths:` claim after it must survive intact.
  test('paths-ignore blanking stops at the end of its own block', () => {
    const dir = build('lc-pathsignore-scope', { workers: ['services/w'], named: [] });
    writeFileSync(
      join(dir, '.github/workflows/ci.yml'),
      "name: CI\non:\n  pull_request:\n    paths-ignore:\n      - 'docs/**'\n    paths:\n      - 'services/w/**'\njobs:\n  a:\n    steps:\n      - run: echo hi\n",
    );
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity', () => {
  // Tracks REQUIRED_FILES in the guard. `sitemap.xml` and `llms.txt` joined it
  // for [pipeline 12]W-3b: deleting either used to pass this lane and ship.
  const REQUIRED = ['index.html', '404.html', 'robots.txt', '_headers', 'sitemap.xml', 'llms.txt'];
  const ESM_FN = 'export async function onRequestPost({ request, env }) {\n  return new Response("ok");\n}\n';

  const build = (name, { sites = ['a', 'b'], omit = null, fnBody = ESM_FN, fnCount = 1 } = {}) => {
    const files = {};
    for (const s of sites) {
      for (const f of REQUIRED) {
        if (omit && omit.site === s && omit.file === f) continue;
        files[`sites/${s}/${f}`] = f.endsWith('.html') ? '<html></html>\n' : 'x\n';
      }
    }
    if (fnCount > 0) files[`sites/${sites[0]}/functions/api/handler.js`] = fnBody;
    return fixture(name, files);
  };

  test('PASSES on healthy sites — and accepts ESM syntax in a .js Function', () => {
    // `node --check` treats .js as CommonJS and would reject `export`. If the
    // .mjs probe ever regresses, this test fails and every real Function would
    // otherwise be reported broken.
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /2 deploy root\(s\)/);
  });

  test('FAILS when a required file is missing, and names it', () => {
    const dir = build('si-missing', { omit: { site: 'b', file: '404.html' } });
    const { code, out } = run('check-site-integrity.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /404\.html/);
  });

  test('FAILS when a Pages Function does not parse', () => {
    const dir = build('si-syntax', { fnBody: 'export async function onRequestPost( {\n' });
    const { code, out } = run('check-site-integrity.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /does not parse/);
  });

  test('FAILS its own coverage check when a deploy root disappears', () => {
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-onesite', { sites: ['a'] })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS its own coverage check when server-side code stops being found', () => {
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-nofn', { fnCount: 0 })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── claimed roots (2026-08-01) ─────────────────────────────────────────────
  // The Cloudflare-Git sites had no structural claim to CI coverage at all —
  // assert-lane-coverage.mjs was accepting a workflow COMMENT as proof. ci.yml
  // now names them as ARGUMENTS here, which makes the claim load-bearing at
  // both ends: it is the text the lane guard matches, and this script fails if
  // a claimed root is not really among the deploy roots it scans. Without this
  // check the argument would be decoration again — a claim that outlives the
  // thing it claims.
  test('PASSES when every claimed root is really a scanned deploy root', () => {
    const dir = build('si-claim-ok');
    const { code, out } = run('check-site-integrity.mjs', { args: [dir, 'sites/a', 'sites/b'] });
    assert.equal(code, 0, out);
  });

  test('FAILS when a claimed root is not a deploy root at all', () => {
    const dir = build('si-claim-ghost');
    const { code, out } = run('check-site-integrity.mjs', { args: [dir, 'sites/a', 'sites/ghost'] });
    assert.equal(code, 1, 'the caller promises coverage the scan does not deliver');
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /sites\/ghost/);
  });

  // Checked against the DISCOVERED roots, not the filesystem: a directory that
  // still exists but lost its index.html is exactly a site this script has
  // stopped checking, and is the shape the real mutation took.
  test('FAILS when a claimed directory survives but stops being a deploy root', () => {
    const dir = build('si-claim-noindex', { omit: { site: 'b', file: 'index.html' } });
    const { code, out } = run('check-site-integrity.mjs', { args: [dir, 'sites/a', 'sites/b'] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /sites\/b/);
  });

  test('a trailing slash on a claimed root is not a false alarm', () => {
    const dir = build('si-claim-slash');
    const { code, out } = run('check-site-integrity.mjs', { args: [dir, 'sites/a/', 'sites/b'] });
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures deliberately contain no .git, so the tracked-ness check self-disables
// and these exercise the lockfile-presence and install-command rules.
describe('assert-lockfile-discipline', () => {
  const UNITS = ['services/w1', 'services/w2', 'packages/n1'];
  const build = (name, { units = UNITS, omitLockFor = null, workflow = null } = {}) => {
    const files = {
      '.github/workflows/ci.yml': workflow ?? 'jobs:\n  a:\n    steps:\n      - run: npm ci\n',
    };
    for (const u of units) {
      files[`${u}/package.json`] = '{"name":"x"}\n';
      if (u !== omitLockFor) files[`${u}/package-lock.json`] = '{"lockfileVersion":3}\n';
    }
    return fixture(name, files);
  };

  test('PASSES when every node unit is locked and installs are reproducible', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /every workflow install is reproducible/);
  });

  test('FAILS when a node unit has no lockfile, and names it', () => {
    const dir = build('ld-nolock', { omitLockFor: 'services/w2' });
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /services\/w2/);
  });

  test('FAILS on a bare npm install in a workflow, with file and line', () => {
    const wf = 'jobs:\n  a:\n    steps:\n      - run: npm ci\n  b:\n    steps:\n      - run: npm install\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-install', { workflow: wf })] });
    assert.equal(code, 1);
    assert.match(out, /ci\.yml:7/);
    assert.match(out, /npm ci/);
  });

  test('ALLOWS npm install for a mason-stamped app — the one deliberate exception', () => {
    const wf =
      'jobs:\n  a:\n    steps:\n      - name: stamped service\n        working-directory: services/probeapi-api\n        run: |\n          npm install\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-excused', { workflow: wf })] });
    assert.equal(code, 0, out);
  });

  test('does NOT trip on npm install mentioned in a comment', () => {
    const wf = 'jobs:\n  a:\n    steps:\n      # we used to run npm install here\n      - run: npm ci\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-comment', { workflow: wf })] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-cov', { units: ['services/only'] })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE HOLE THIS GUARD SHIPPED WITH — mutation-proven on a scratch COPY of
  // the real tree, 2026-08-01, SIX mutations, every restore re-verified green:
  //
  //   ML1 the root pnpm-lock.yaml deleted        -> caught: "and no pnpm-lock.yaml"
  //   ML2 root packageManager pnpm -> npm        -> caught: "and no package-lock.json"
  //   ML3 a workflow runs a bare `pnpm install`  -> caught: "--frozen-lockfile"
  //   ML4 `pnpm install --frozen-lockfile`       -> correctly SILENT (no false positive)
  //   ML5 a workflow runs a bare `yarn install`  -> caught: "--immutable"
  //   ML6 services/platform loses its lockfile   -> caught (the original limb still works)
  //
  // And the RED it recorded on the tree as it stood: this repo pins
  // `"packageManager": "pnpm@9.15.0"` at the root with a pnpm-workspace.yaml,
  // `pnpm install` there writes a 1,030-line pnpm-lock.yaml — and that file was
  // NEVER COMMITTED, while this guard printed "3 node unit(s) locked" and exited
  // 0. Two independent reasons: the unit scan globbed services/packages/sites
  // and never considered the ROOT, and the only lockfile name it knew was
  // `package-lock.json`, which pnpm does not write. F-8's own failure mode,
  // inside the guard for F-8.
  const buildRoot = (name, { manager = 'pnpm@9.15.0', lock = 'pnpm-lock.yaml', workflow = null } = {}) => {
    const files = {
      '.github/workflows/ci.yml': workflow ?? 'jobs:\n  a:\n    steps:\n      - run: npm ci\n',
      'package.json': `{"name":"ws","private":true,"packageManager":"${manager}"}\n`,
    };
    for (const u of UNITS) {
      files[`${u}/package.json`] = '{"name":"x"}\n';
      files[`${u}/package-lock.json`] = '{"lockfileVersion":3}\n';
    }
    if (lock) files[lock] = lock.endsWith('.yaml') ? "lockfileVersion: '9.0'\n" : '{"lockfileVersion":3}\n';
    return fixture(name, files);
  };

  test('the REPO ROOT is a node unit, and its declared manager decides the lockfile', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-root-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /repo root included/);
    assert.match(out, /1 pnpm/);
  });

  test('FAILS when the root declares pnpm and no pnpm-lock.yaml is committed [ML1]', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-root-nolock', { lock: null })] });
    assert.equal(code, 1);
    assert.match(out, /<repo root>/);
    assert.match(out, /no pnpm-lock\.yaml/);
  });

  test('a package-lock.json does NOT satisfy a root that declares pnpm [ML2 inverse]', () => {
    // The second half of the original hole: one hardcoded filename. A repo with
    // the WRONG lockfile is exactly as unreproducible as one with none, and it
    // looks more locked than it is.
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-root-wronglock', { lock: 'package-lock.json' })] });
    assert.equal(code, 1);
    assert.match(out, /no pnpm-lock\.yaml/);
  });

  test('FAILS on a bare `pnpm install` in a workflow [ML3]', () => {
    const wf = 'jobs:\n  a:\n    steps:\n      - run: pnpm install\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-pnpm-loose', { workflow: wf })] });
    assert.equal(code, 1);
    assert.match(out, /--frozen-lockfile/);
  });

  test('does NOT flag `pnpm install --frozen-lockfile` [ML4]', () => {
    // An assertion that fires on CORRECT input is worse than none.
    const wf = 'jobs:\n  a:\n    steps:\n      - run: pnpm install --frozen-lockfile\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-pnpm-frozen', { workflow: wf })] });
    assert.equal(code, 0, out);
  });

  test('FAILS on a bare `yarn install`, and accepts `--immutable` [ML5]', () => {
    const loose = 'jobs:\n  a:\n    steps:\n      - run: yarn install\n';
    const r1 = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-yarn-loose', { workflow: loose })] });
    assert.equal(r1.code, 1);
    assert.match(r1.out, /--immutable/);
    const frozen = 'jobs:\n  a:\n    steps:\n      - run: yarn install --immutable\n';
    const r2 = run('assert-lockfile-discipline.mjs', { args: [buildRoot('ld-yarn-frozen', { workflow: frozen })] });
    assert.equal(r2.code, 0, r2.out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-workflow-hardening', () => {
  const SHA = 'a'.repeat(40);
  /** ⚠️ THE JOB CARRIES `runs-on:` AND `timeout-minutes:` BECAUSE A REAL ONE DOES.
   *  These fixtures used to be `jobs:\n  j:\n    steps:` — a job shape GitHub
   *  would reject outright — and the timeout limb REFUSES (exit 2) on a job it
   *  cannot classify, which is how the omission surfaced. A fixture that is not
   *  a legal workflow tests the guard against input the guard will never see. */
  const wf = (uses, { withPermissions = true } = {}) =>
    `name: X\non: push\n${withPermissions ? 'permissions:\n  contents: read\n' : ''}jobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
    uses.map((u) => `      - uses: ${u}\n`).join('');

  /** 12 refs across 3 files clears the scan's own MIN_USES / MIN_WORKFLOWS floor. */
  const build = (name, { bad = null, noPermsIn = null } = {}) => {
    const files = {};
    for (const f of ['a', 'b', 'c']) {
      const refs = Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`);
      if (bad && bad.file === f) refs[bad.index] = bad.ref;
      files[`.github/workflows/${f}.yml`] = wf(refs, { withPermissions: noPermsIn !== f });
    }
    return fixture(name, files);
  };

  test('PASSES when every action is SHA-pinned and every workflow declares permissions', () => {
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [build('wh-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /all SHA-pinned/);
  });

  test('FAILS on a movable tag reference, naming file and line', () => {
    const dir = build('wh-tag', { bad: { file: 'b', index: 2, ref: 'actions/checkout@v4' } });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /b\.yml:\d+/);
    assert.match(out, /movable reference/);
  });

  test('FAILS on a branch reference, not only on version tags', () => {
    const dir = build('wh-branch', { bad: { file: 'a', index: 0, ref: 'some/action@main' } });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /@main/);
  });

  test('FAILS when a workflow declares no permissions block', () => {
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [build('wh-perms', { noPermsIn: 'c' })] });
    assert.equal(code, 1);
    assert.match(out, /c\.yml declares no/);
  });

  test('does NOT trip on a tag reference inside a comment', () => {
    const dir = fixture('wh-comment', {
      '.github/workflows/a.yml':
        `name: X\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      # was uses: actions/checkout@v4\n` +
        Array.from({ length: 12 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      '.github/workflows/b.yml': wf([`actions/x@${SHA}`]),
      '.github/workflows/c.yml': wf([`actions/y@${SHA}`]),
    });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const dir = fixture('wh-cov', { '.github/workflows/a.yml': wf([`actions/x@${SHA}`]) });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── corpus triage 2026-08-01 (#29) ─────────────────────────────────────────
  // 🔴 REPRODUCED ON THE REAL TREE FIRST. `MIN_WORKFLOWS = 3` / `MIN_USES = 10`
  // stood against NINE workflows and FIFTY-SEVEN `uses:` references, so moving
  // six workflows aside — every deploy and every store submission — printed
  // `ok  workflow hardening — 3 workflow(s), 30 action(s) all SHA-pinned` and
  // exited 0. The repair is not a bigger number (a floor at reality goes red on
  // the next honest merge); it is two relationships computed from the tree.
  describe('the coverage floors are relationships, not numbers', () => {
    /** git init + add, so `git ls-files` has a manifest to disagree with. */
    const gitFixture = (name, files) => {
      const dir = fixture(name, files);
      for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['add', '-A']]) {
        spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
      }
      return dir;
    };

    const three = () => {
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      return files;
    };

    test('the manifest control: every tracked workflow scanned, and it says so', () => {
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [gitFixture('wh-git-ok', three())] });
      assert.equal(code, 0, out);
      assert.match(out, /all 3 git tracks/);
    });

    test('FAILS when a workflow git tracks was never opened by the scan', () => {
      // The shape of the real mutation: files leave the directory while the
      // committed manifest still lists them. A count floor cannot see this at
      // all; scanned-vs-tracked names the missing file.
      const dir = gitFixture('wh-git-thin', three());
      rmSync(join(dir, '.github', 'workflows', 'c.yml'));
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — git tracks 3 workflow\(s\) and this scan opened 2; it never saw: c\.yml/);
    });

    test('FAILS when the strict `uses:` matcher under-reads what the loose one sees', () => {
      // `uses : x` is YAML-legal and the strict matcher cannot read it. This is
      // what replaces MIN_USES: it fires at ANY size of tree, where a floor only
      // fires below a number — so `usesCount` can no longer drift toward zero
      // while every action reads as pinned.
      const files = three();
      files['.github/workflows/b.yml'] = files['.github/workflows/b.yml'].replace(
        `      - uses: actions/act0@${SHA}\n`,
        `      - uses : actions/act0@${SHA}\n`,
      );
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-uses-acct', files)] });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — 12 `uses:` line\(s\) are present but only 11 were accounted for/);
    });

    test('FAILS on a `uses:` reference it cannot parse, instead of ignoring it', () => {
      const files = three();
      files['.github/workflows/a.yml'] = files['.github/workflows/a.yml'].replace(
        `actions/act0@${SHA}`,
        `notanaction@${SHA}`,
      );
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-uses-odd', files)] });
      assert.equal(code, 1);
      assert.match(out, /is a reference this scan cannot parse, so it cannot be proven pinned/);
    });

    test('FAILS when not one `uses:` survives — a dead matcher, not an action-free CI', () => {
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] =
          'name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: echo hi\n';
      }
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-uses-none', files)] });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — not one `uses:` reference in 3 workflow\(s\)/);
    });
  });

  // ── the permissions limb checks its CONTENT, not just its presence ─────────
  // ci.yml's step is named "Workflows are SHA-pinned and least-privilege" while
  // the check was `/^permissions:/m` — which `permissions: write-all`, the worst
  // possible value, satisfies perfectly. Mutation-proven on the real ci.yml.
  describe('permissions is read, not merely counted', () => {
    const three = (over = {}) => {
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = over[f] ?? wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      return files;
    };

    test('FAILS on workflow-level `permissions: write-all`', () => {
      const files = three({
        b: `name: X\non: push\npermissions: write-all\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-writeall', files)] });
      assert.equal(code, 1);
      assert.match(out, /b\.yml sets `permissions: write-all` at the workflow level/);
      assert.match(out, /b\.yml:3 `permissions: write-all` grants every scope/);
    });

    test('FAILS on JOB-level `permissions: write-all` too — the same blast radius, one indent in', () => {
      const files = three({
        // `permissions: write-all` stays on line 7 — the runner keys go AFTER it,
        // so the line number this test asserts still points at the real defect.
        c: `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    permissions: write-all\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-writeall-job', files)] });
      assert.equal(code, 1);
      assert.match(out, /c\.yml:7 `permissions: write-all` grants every scope/);
    });

    test('`read-all` is least-privilege enough to pass', () => {
      const files = three({
        a: `name: X\non: push\npermissions: read-all\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-readall', files)] });
      assert.equal(code, 0, out);
    });

    test('a workflow-level WRITE scope is PRINTED, not blocked — deploy-web.yml needs one today', () => {
      // Printed rather than pretended-checked: blocking it would make the build
      // red on arrival, and a rule added red gets deleted rather than fixed.
      const files = three({
        a: `name: X\non: push\npermissions:\n  contents: read\n  deployments: write\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-write-scope', files)] });
      assert.equal(code, 0, out);
      assert.match(out, /a\.yml grants `deployments: write` at the WORKFLOW level/);
    });
  });

  // ── limb 4: every job bounds itself ────────────────────────────────────────
  // 2026-08-17. 29 of this tree's 42 jobs declared no `timeout-minutes`, so each
  // of them inherited GitHub's 360-minute default. Every case below was
  // FIRST proven against the real .github/workflows — green at 42 jobs, one
  // `timeout-minutes:` line removed from ops-watch.yml's `alert`, the guard
  // naming that exact job and exiting 1, then a byte-exact restore back to
  // green — because a fixture written by whoever wrote the guard encodes the
  // same misunderstanding as the guard. These re-run that evidence on every
  // build, cheaply and without mutating the tree.
  describe('every job bounds its own runtime', () => {
    const three = (over = {}) => {
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = over[f] ?? wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      return files;
    };
    /** One job, written out, so a test can change exactly one of its keys. */
    const job = (keys) =>
      `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n${keys}    steps:\n` +
      Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join('');

    test('the control: three bounded jobs pass, and the ok line SAYS three', () => {
      // The count is the point — but a printed count is only evidence once
      // something else derives it too, which is the JOB ACCOUNTING block below.
      // (Real tree on 2026-08-17: `42 job(s)`, both derivations agreeing.)
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-ok', three())] });
      assert.equal(code, 0, out);
      assert.match(out, /3 job\(s\) all bounded by `timeout-minutes`/);
      assert.match(out, /two independent job-id counts agree per file, 3 = 3/);
    });

    test('FAILS naming the exact job that declares none', () => {
      const files = three({ b: job('    runs-on: ubuntu-24.04\n') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-missing', files)] });
      assert.equal(code, 1);
      assert.match(out, /b\.yml job `j` declares no `timeout-minutes:`/);
      assert.match(out, /360-minute default/);
    });

    test('a STEP-level `timeout-minutes` does NOT bound the job', () => {
      // 🔴 THE ` {4}` ANCHOR, TESTED. A step timeout bounds one step and leaves
      // the other forty unbounded, and it is the single likeliest thing to be
      // mistaken for a bounded job — the job below has one and is still wrong.
      const files = three({
        b:
          `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-24.04\n    steps:\n` +
          `      - uses: actions/act0@${SHA}\n        timeout-minutes: 5\n` +
          Array.from({ length: 3 }, (_, i) => `      - uses: actions/act${i + 1}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-step', files)] });
      assert.equal(code, 1);
      assert.match(out, /b\.yml job `j` declares no `timeout-minutes:`/);
    });

    test('a COMMENTED-OUT declaration does not satisfy it — the whole reason this is parsed', () => {
      // `grep -c timeout-minutes` on this fixture answers 3 and would pass it.
      // The corpus has paid for that once already: a `grep '"r2_buckets"'` that
      // matched the comment explaining why there is no `r2_buckets`.
      const files = three({ b: job('    runs-on: ubuntu-24.04\n    # timeout-minutes: 5\n') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-comment', files)] });
      assert.equal(code, 1);
      assert.match(out, /b\.yml job `j` declares no `timeout-minutes:`/);
    });

    test('FAILS on a value that bounds nothing, naming the line', () => {
      const files = three({ b: job('    runs-on: ubuntu-24.04\n    timeout-minutes: 0\n') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-zero', files)] });
      assert.equal(code, 1);
      // Line 8, asserted exactly: the reported number must still point into the
      // real file, which is only true because comments are BLANKED, not deleted.
      assert.match(out, /b\.yml:8 job `j` sets `timeout-minutes: 0`, which bounds nothing/);
    });

    test('an expression GitHub resolves is accepted — a rule that fires on right input gets deleted', () => {
      const files = three({ b: job('    runs-on: ubuntu-24.04\n    timeout-minutes: ${{ matrix.timeout }}\n') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-expr', files)] });
      assert.equal(code, 0, out);
    });

    // ── the four REFUSALS, exit 2 ──────────────────────────────────────────
    // A different code from a defect on purpose: "I looked and found nothing
    // wrong" and "I could not look" must not be the same signal, because the
    // second one reading as the first is how a scan over an empty subject
    // becomes a pass.
    test('REFUSES (exit 2) on a job it cannot classify, rather than demanding the impossible', () => {
      // The shape braced for: a job that DELEGATES to a reusable workflow.
      // GitHub rejects `timeout-minutes` there, so demanding one would be an
      // unsatisfiable red — and silently skipping it would be an unadvertised
      // hole. There is NO exemption list here; the guard says it cannot tell.
      const files = three({ b: job('    uses: ./.github/workflows/a.yml\n') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-nounsonjob', files)] });
      assert.equal(code, 2);
      assert.match(out, /REFUSING TO REPORT — 1 job\(s\) this limb cannot classify/);
      assert.match(out, /b\.yml job `j` declares no `runs-on:`/);
    });

    test('REFUSES (exit 2) when a workflow parses to ZERO jobs', () => {
      const files = three({ b: wf([`actions/x@${SHA}`]).replace(/^jobs:\n/m, '') });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-to-nojobs', files)] });
      assert.equal(code, 2);
      assert.match(out, /REFUSING TO REPORT — 1 workflow\(s\) parsed to ZERO jobs: b\.yml/);
    });

    test('REFUSES (exit 2) when the directory holds not one workflow', () => {
      // The directory EXISTS and is empty of workflows — distinct from "no
      // .github/workflows at all", and the shape that prints ok over nothing.
      const dir = fixture('wh-to-nowf', { '.github/workflows/README.md': '# not a workflow\n' });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
      assert.equal(code, 2);
      assert.match(out, /REFUSING TO REPORT — not one workflow file under/);
    });
  });

  // ── JOB ACCOUNTING: the printed count derived twice ────────────────────────
  // 🔴 REPRODUCED ON THE REAL TREE FIRST, and the mutation is the verifier's,
  // not one invented to suit the fix. Quote ONE job id in `.github/workflows/
  // ops-watch.yml` — `  "digest":`, legal YAML naming the identical job GitHub
  // already runs — and the shared reader's ` {2}<id>:` matcher stops seeing it:
  //
  //   before  ok  … 42 job(s) all bounded by `timeout-minutes`      exit 0
  //   mutated ok  … 41 job(s) all bounded by `timeout-minutes`      exit 0   ⟵
  //
  // A job left limb 4 entirely — never checked for a bound — and the only trace
  // was a digit nobody diffs. Since the second derivation landed, the same
  // mutation prints `REFUSING TO REPORT — 1 workflow(s) where two independent
  // job-id counts disagree · ops-watch.yml: the shared reader found 7 job id(s),
  // an independent scan of the same file found 8`, exit 2; `git checkout` back
  // to a byte-identical file returns it to exit 0 at 42. That is the same
  // two-derivations doctrine the `uses:` accounting already uses, one nesting
  // level in — a count is not evidence until something else computes it too.
  describe('the job count is derived twice and the two must agree', () => {
    const three = (over = {}) => {
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = over[f] ?? wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      return files;
    };

    test('REFUSES (exit 2) on a QUOTED job id — the mutation that silently shrank the count', () => {
      const files = three();
      files['.github/workflows/b.yml'] = files['.github/workflows/b.yml'].replace('\njobs:\n  j:\n', '\njobs:\n  "j":\n');
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-jobs-quoted', files)] });
      assert.equal(code, 2);
      assert.match(out, /two independent job-id counts disagree/);
      assert.match(out, /b\.yml: the shared reader found 0 job id\(s\), an independent scan of the same file found 1/);
    });

    test('names EVERY file that disagrees, not just a bottom-line total', () => {
      // The comparison is per FILE and the report names each one, because
      // "41 vs 42" tells a reader a job vanished and nothing about where. It is
      // also the honest reason the loop is written per file rather than as one
      // subtraction at the end: the loose matcher is a SUPERSET of the reader by
      // construction today, so the totals could not cancel — but that is a
      // property of two regexes somebody may edit, not a guarantee, and a
      // per-file comparison does not depend on it holding.
      const files = three();
      for (const f of ['b', 'c']) {
        files[`.github/workflows/${f}.yml`] = files[`.github/workflows/${f}.yml`].replace('\njobs:\n  j:\n', '\njobs:\n  "j":\n');
      }
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-jobs-two', files)] });
      assert.equal(code, 2);
      assert.match(out, /2 workflow\(s\) where two independent job-id counts disagree/);
      assert.match(out, /b\.yml: the shared reader found 0 job id\(s\), an independent scan of the same file found 1/);
      assert.match(out, /c\.yml: the shared reader found 0 job id\(s\), an independent scan of the same file found 1/);
      assert.match(out, /Totals: 1 vs 3 across 3 workflow\(s\)/);
    });

    test('does NOT fire on a legal tree — a check that reddens correct input gets deleted', () => {
      // 🔴 THE NEGATIVE HALF, AND IT CAUGHT A REAL DEFECT IN THE VERY CHECK IT
      // TESTS. The first `looseJobIds` tested the block end (`/^\S/`) BEFORE
      // skipping comments, so the column-0 `# ── the build lane ──` below ended
      // its scan there and every job under it went uncounted — the guard refused
      // on a workflow GitHub runs happily. Four legal shapes, all of them things
      // the two matchers read by different routes: a trailing comment on `jobs:`,
      // a comment at column 0 BETWEEN jobs, a dashed job id, and a commented-out
      // id at job indent.
      const files = three({
        b:
          `name: X\non: push\npermissions:\n  contents: read\njobs:  # the block\n  build-and-test:\n` +
          `    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n  #  retired-job:\n    steps:\n` +
          Array.from({ length: 2 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join('') +
          `# ── the build lane ──\n  second:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n` +
          Array.from({ length: 2 }, (_, i) => `      - uses: actions/act${i + 2}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-jobs-legal', files)] });
      assert.equal(code, 0, out);
      assert.match(out, /two independent job-id counts agree per file, 4 = 4/);
      assert.match(out, /4 job\(s\) all bounded by `timeout-minutes`/);
    });
  });

  // ── a stop must not swallow what was already found ────────────────────────
  // 🔴 THE VERIFIER'S EXACT SCENARIO. Both stop paths called `process.exit` with
  // `problems` still in memory — the report block sits at the BOTTOM of the
  // guard — so a limb-4 refusal deleted every limb-1/2/3 finding on its way out.
  // Measured before the fix: this fixture printed the refusal alone, exit 2, and
  // not one word about `actions/checkout@v4` in b.yml. A movable action
  // reference is the single thing this guard was written for, and a parse
  // complaint about a different file was silently outranking it.
  describe('findings survive a stop', () => {
    test('a limb-1 movable reference is PRINTED even when limb 4 refuses', () => {
      const SHA40 = SHA;
      const files = {
        '.github/workflows/a.yml': wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA40}`)),
        // the finding: an unpinned action, in a file the parse reads fine
        '.github/workflows/b.yml': wf([`actions/checkout@v4`, `actions/act1@${SHA40}`, `actions/act2@${SHA40}`, `actions/act3@${SHA40}`]),
        // the stop: a job with no `runs-on:`, which limb 4 refuses to classify
        '.github/workflows/c.yml':
          `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    uses: ./.github/workflows/a.yml\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA40}\n`).join(''),
      };
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-stop-keeps-findings', files)] });
      assert.equal(code, 2, out);
      assert.match(out, /ALREADY established before this stop/);
      assert.match(out, /b\.yml:\d+ `actions\/checkout@v4` is a movable reference/);
      assert.match(out, /REFUSING TO REPORT — 1 job\(s\) this limb cannot classify/);
    });

    test('a COVERAGE LOST exit keeps them too — same defect, same fix, both paths', () => {
      // The `uses:` accounting stop, with a real movable reference already
      // found. `uses : x` is YAML-legal and the strict matcher cannot read it.
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      files['.github/workflows/a.yml'] = files['.github/workflows/a.yml'].replace(`actions/act0@${SHA}`, 'actions/checkout@v4');
      files['.github/workflows/b.yml'] = files['.github/workflows/b.yml'].replace(
        `      - uses: actions/act0@${SHA}\n`,
        `      - uses : actions/act0@${SHA}\n`,
      );
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-stop-coverage', files)] });
      assert.equal(code, 1);
      assert.match(out, /ALREADY established before this stop/);
      assert.match(out, /`actions\/checkout@v4` is a movable reference/);
      assert.match(out, /COVERAGE LOST — 12 `uses:` line\(s\) are present but only 11 were accounted for/);
    });

    test('a CLEAN stop prints no findings block — an empty list is not printed as evidence', () => {
      // The negative half: `printPending` must stay silent when there is nothing
      // to say, or every refusal grows a header claiming findings it does not
      // have — which is the false-claim shape this corpus keeps paying for.
      const files = {};
      for (const f of ['a', 'b', 'c']) {
        files[`.github/workflows/${f}.yml`] = wf(Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`));
      }
      files['.github/workflows/b.yml'] =
        `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    uses: ./.github/workflows/a.yml\n    steps:\n` +
        Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join('');
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-stop-clean', files)] });
      assert.equal(code, 2);
      assert.doesNotMatch(out, /ALREADY established before this stop/);
      assert.match(out, /REFUSING TO REPORT — 1 job\(s\) this limb cannot classify/);
    });
  });

  // ── limb 5: the live workflow list, and the dispatch that reaches it ───────
  // 🔴 ADDED 2026-08-24, AND IT IS EXACTLY THE CLOSURE THAT GUARD FILE HAS BEEN
  // NAMING IN ITS OWN COMMENTS SINCE 2026-08-21 ("guards.test.mjs cases that
  // invoke this script with `--live-workflows=<fixture>` and with a mistyped
  // flag"). Every case above passes a fixture ROOT and no flag, so the whole
  // dispatch behind that flag had NO input in the committed tree: the branch
  // choosing between NOT CONSULTED and consulting, the refusal on a mistyped
  // flag, the refusal on an unreadable file, and the one line that TAKES the
  // coverage-lost stop. The guard carries in-file canaries (C1-C16) for the pure
  // engine behind those decisions and says so; a canary cannot reach a
  // `process.exit` path, and three of these were measured as SILENT false
  // greens — disabled, the guard printed ok and exited 0 over two real orphans.
  describe('limb 5 — the live workflow list', () => {
    const liveEntry = (base) => ({ id: 1, name: base, path: `.github/workflows/${base}`, state: 'active' });
    /** The three workflows `build()` writes, as GitHub would list them. */
    const THREE = ['a.yml', 'b.yml', 'c.yml'].map(liveEntry);
    /** A three-workflow root with a `gh api` page written beside it. */
    const withPage = (name, page) => {
      const dir = build(name);
      const at = join(dir, 'live.json');
      writeFileSync(at, JSON.stringify(page));
      return { dir, at };
    };

    test('CONSULTS the live workflow list when one is supplied, and says so in the ok line', () => {
      const { dir, at } = withPage('wh-live-ok', { total_count: 3, workflows: THREE });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir, `--live-workflows=${at}`] });
      assert.equal(code, 0, out);
      assert.match(out, /list consulted — 3 on GitHub under \.github\/workflows\/, 0 of them absent/);
      assert.doesNotMatch(out, /NOT CONSULTED/);
    });

    // THE ORDER IS PART OF THE ASSERTION. Positionals and flags are separated by
    // predicate, not by index, so a root AFTER the flag must still be the root —
    // and the separation is the only thing that makes that true.
    test('accepts the flag BEFORE the root, and the root is still the root', () => {
      const { dir, at } = withPage('wh-live-order', { total_count: 3, workflows: THREE });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [`--live-workflows=${at}`, dir] });
      assert.equal(code, 0, out);
      assert.match(out, /3 workflow\(s\)/);
      assert.match(out, /list consulted/);
    });

    test('FAILS COVERAGE LOST on a workflow GitHub lists that this checkout has not, naming it', () => {
      const { dir, at } = withPage('wh-live-orphan', {
        total_count: 4,
        workflows: [...THREE, { id: 320102035, name: 'media-probe (throwaway)', path: '.github/workflows/media-probe.yml', state: 'active' }],
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir, `--live-workflows=${at}`] });
      assert.equal(code, 1, out);
      assert.match(out, /COVERAGE LOST/);
      assert.match(out, /media-probe\.yml \(id 320102035, "media-probe \(throwaway\)", state `active`\)/);
    });

    // 🔴 THE SINGULAR TYPO IS THE WHOLE POINT. `--live-workflow=` silently not
    // running is the one failure a limb like this actually has, and it exits 0
    // with a NOT CONSULTED line that looks exactly like a run nobody asked to
    // consult a list.
    test('REFUSES a mistyped flag instead of silently not consulting the list', () => {
      const { dir, at } = withPage('wh-live-typo', { total_count: 3, workflows: THREE });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir, `--live-workflow=${at}`] });
      assert.equal(code, 2, out);
      assert.match(out, /unrecognised argument\(s\): --live-workflow=/);
      assert.doesNotMatch(out, /NOT CONSULTED/);
    });

    // A missing list is not an empty list, and an empty list is zero orphans.
    // The WORDING is the assertion: without the read's own catch the body lands
    // on the not-readable-JSON refusal instead, same exit code, different claim.
    test('REFUSES when the named list cannot be read, naming the flag and the path', () => {
      const dir = build('wh-live-missing');
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir, `--live-workflows=${join(dir, 'absent.json')}`] });
      assert.equal(code, 2, out);
      assert.match(out, /--live-workflows=.*absent\.json could not be read/);
      assert.doesNotMatch(out, /is not readable JSON/);
    });

    test('REFUSES a page that does not account for itself', () => {
      const { dir, at } = withPage('wh-live-partial', { total_count: 13, workflows: THREE });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir, `--live-workflows=${at}`] });
      assert.equal(code, 2, out);
      assert.match(out, /PARTIAL page — it reports total_count 13 and carries 3 entr/);
    });

    // NO POSITIONAL ROOT IS CI'S OWN INVOCATION, and it is a different, stricter
    // situation: the git manifest that anchors the scan MUST be readable. Every
    // other case in this file hands the guard a fixture root, so that branch had
    // no input either.
    test('treats NO positional root as the real repository, where the manifest must be readable', () => {
      const dir = build('wh-noroot');
      const { code, out } = run('assert-workflow-hardening.mjs', { cwd: dir, args: [] });
      assert.equal(code, 1, out);
      assert.match(out, /returned no tracked workflow/);
    });

    // 🔴 THE CANARIES MUST BE WIRED TO THE EXIT, NOT ONLY PRESENT. Sixteen
    // canaries run inside that guard on every invocation, and every one of them
    // reaches the process through ONE `if (selfTestFailures.length)`. Disabled,
    // all sixteen become decoration and nothing in this file could tell — which
    // is this repository's own definition of an assertion worse than none. This
    // proves the wire by breaking a SUBJECT (limb 5's prefix filter, which C3
    // holds) in a COPY of the guard, never in the tree. The copy needs only its
    // two local imports; both pull nothing but node builtins.
    test('REFUSES when its own canaries fail, so the canaries are not decoration', () => {
      const src = readFileSync(join(CI_DIR, 'assert-workflow-hardening.mjs'), 'utf8');
      const SUBJECT = 'if (!path.startsWith(WF_PREFIX)) continue;';
      // 🔴 COMMENTS ARE BLANKED BEFORE COUNTING, AND ONLY FOR COUNTING. That
      // guard quotes its own source in prose, and a quotation is not a subject:
      // the first draft of this case counted raw bytes and went red the moment a
      // comment there named the very line it mutates — measured, not foreseen.
      // `stripSourceComments` blanks in place, so an offset in the blanked copy
      // is the same offset in the real bytes, which is where the cut is made.
      // If the anchor ever stops matching exactly once, this fails LOUDLY rather
      // than quietly running an unmutated copy and passing for the wrong reason.
      const code = stripSourceComments(src, '.mjs');
      assert.equal(code.split(SUBJECT).length - 1, 1, 'the C3 subject line must appear exactly once outside comments');
      const at = code.indexOf(SUBJECT);
      const mutate = () => `${src.slice(0, at)}if (false) continue;${src.slice(at + SUBJECT.length)}`;
      const modules = {};
      for (const m of ['tree-walk.mjs', 'workflow-scan.mjs']) modules[m] = readFileSync(join(CI_DIR, m), 'utf8');
      const root = build('wh-canary-root');
      const copy = (name, body) => join(fixture(name, { ...modules, 'g.mjs': body }), 'g.mjs');
      const exec = (at) => {
        const r = spawnSync(process.execPath, [at, root], { cwd: ROOT, encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
      };
      // THE CONTROL FIRST: an unmutated copy in the same place must still pass,
      // or the case below would go green on a broken copy mechanism.
      const control = exec(copy('wh-canary-control', src));
      assert.equal(control.code, 0, control.out);
      const broken = exec(copy('wh-canary-off', mutate()));
      assert.equal(broken.code, 2, broken.out);
      assert.match(broken.out, /canaries failed \(\d+\)/);
      assert.match(broken.out, /C3 NON-WORKFLOW PATH/);
    });
  });

  // ── limb 6: an Actions expression opens with TWO braces ───────────────────
  // 🔴 EVERY CASE HERE IS MUTATED FROM THE REAL `.github/workflows/submit-snap.yml`
  // AND NOT ONE OF THEM IS HAND-WRITTEN, because the defect this limb exists for
  // was invisible precisely to the kind of fixture whoever writes the guard
  // would invent. On 2026-08-26 that file's line 352 read
  // `flutter-version: ${ env.FLUTTER_VERSION }` — ONE brace — while line 142,
  // the dry-run lane's byte-identical step, read `${{ … }}`. GitHub does not
  // interpolate a single brace, so the Snap Store PUBLISH job handed
  // `subosito/flutter-action` the literal string as a Flutter version, and it
  // survived a merge and five days of green CI because nothing in this tree had
  // ever looked at expression syntax.
  //
  // THE HARD HALF IS THE PASSING DIRECTION, WHICH IS WHY IT IS TESTED FIRST AND
  // TESTED FROM THE SAME FILE. Measured over all twelve workflows the same day:
  // 70 lines carry a `${` that is not `${{`, and 69 of them are legal SHELL
  // inside a `run:` body (`${deps}`, `${RUNNER_TEMP}`, `${GITHUB_SHA::7}`). A
  // naive scan reddens all 70 — the false red that gets a guard switched off
  // before it has ever caught anything — so a fixture that only ever proves the
  // failing direction proves the wrong half.
  describe('Actions expressions open with two braces', () => {
    const SNAP_REL = '.github/workflows/submit-snap.yml';
    const REAL_SNAP = readFileSync(resolve(CI_DIR, '..', '..', SNAP_REL), 'utf8');
    /** RE-ANCHORED 2026-09-05, and why is written here rather than left to a
     *  commit message. The anchor WAS `flutter-version: ${{ env.FLUTTER_VERSION }}`
     *  — the literal line the 2026-08-26 defect shipped on — and it stopped
     *  existing when the flutter-action block moved into
     *  .github/actions/setup-flutter and the five FLUTTER_VERSION declarations
     *  went with it. The control then failed for the one reason a control must
     *  never fail: its SUBJECT moved, not its property. The replacement keeps
     *  every property the old anchor was chosen for — it is real rather than
     *  hand-written; it is a JUDGED line (an `env:` value, where limb 6 looks,
     *  not a `run:` body, which it deliberately does not judge); it appears
     *  BYTE-IDENTICALLY IN BOTH LANES, so an anchor taken at the FIRST
     *  occurrence still mutates the dry-run job instead of the publish one; and
     *  a single brace there is the same class of defect, handing snapcraft the
     *  literal text of a credential expression instead of the credential.
     *  ⚠️ It is NOT the line the bug shipped on. That is a real loss and it is
     *  recorded rather than papered over; what the limb catches is unchanged. */
    const GOOD = '          SNAPCRAFT_STORE_CREDENTIALS: ${{ secrets.SNAPCRAFT_STORE_CREDENTIALS }}\n';
    const BAD = '          SNAPCRAFT_STORE_CREDENTIALS: ${ secrets.SNAPCRAFT_STORE_CREDENTIALS }\n';

    /** The real snap workflow beside two ordinary ones — three files, which is
     *  what clears the scan's own no-manifest floor. */
    const withSnap = (name, snap) =>
      fixture(name, {
        [SNAP_REL]: snap,
        '.github/workflows/b.yml': wf([`actions/x@${SHA}`]),
        '.github/workflows/c.yml': wf([`actions/y@${SHA}`]),
      });

    test('the control: the REAL submit-snap.yml passes, and BOTH lanes read `${{ … }}`', () => {
      // The byte assertions are the regression: they fail if either lane ever
      // loses its second brace again, whatever this guard happens to do.
      assert.equal(REAL_SNAP.split(GOOD).length - 1, 2, 'both snapcraft steps must read `${{ secrets.SNAPCRAFT_STORE_CREDENTIALS }}`');
      assert.equal(REAL_SNAP.includes(BAD), false, 'no lane may read the single-brace form');
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [withSnap('wh-expr-real', REAL_SNAP)] });
      assert.equal(code, 0, out);
      assert.match(out, /limb 6 — no single-brace/);
    });

    test('FAILS on the single-brace expression that actually shipped, naming file, line and literal', () => {
      // The publish lane put back the way it was. The reported line is DERIVED
      // from the mutated bytes rather than typed, so this stays a statement
      // about the limb after the workflow is next edited — it was 352 the day
      // the defect was found.
      const at = REAL_SNAP.lastIndexOf(GOOD);
      const broken = REAL_SNAP.slice(0, at) + BAD + REAL_SNAP.slice(at + GOOD.length);
      const line = broken.slice(0, at).split('\n').length;
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [withSnap('wh-expr-bug', broken)] });
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`submit-snap\\.yml:${line} \`\\$\\{ secrets\\.SNAPCRAFT_STORE_CREDENTIALS \\}\` opens with ONE brace`));
      assert.match(out, /reaches the step as the literal text/);
    });

    test('a `${VAR}` INSIDE a `run:` body passes — legal shell, and 69 lines of this tree are exactly that', () => {
      // ADDED TO THE REAL FILE'S OWN `run: |` BLOCK rather than fixtured beside
      // it, so the case exercises the fold `joinBlockScalars` performs on the
      // bytes CI actually runs. A function replacement, because `$` in a string
      // replacement is a substitution pattern and would eat the very braces
      // under test.
      const anchor = '          echo "installing: ${deps}"\n';
      assert.equal(REAL_SNAP.split(anchor).length - 1, 2, 'the run: body this case extends must still be there');
      const shellier = REAL_SNAP.replace(
        anchor,
        () => `${anchor}          echo "\${SNAP_NAME:-subly}" "\${RUNNER_TEMP}/x" "\${#deps}"\n`,
      );
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [withSnap('wh-expr-shell', shellier)] });
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /opens with ONE brace/);
    });

    // ── the two conditions a canary cannot reach ──────────────────────────────
    // A canary returns a value; it cannot take a `process.exit` path. Both cases
    // below therefore COPY the guard and its two local imports into a temp dir
    // and cut one line out of the copy. The repository is never mutated, and an
    // unmutated copy is run first as a control so a broken copy mechanism cannot
    // make either case pass for the wrong reason. Same mechanism, and the same
    // reasoning, as limb 5's canary-wiring case above.
    const copyHarness = () => {
      const src = readFileSync(join(CI_DIR, 'assert-workflow-hardening.mjs'), 'utf8');
      const modules = {};
      for (const m of ['tree-walk.mjs', 'workflow-scan.mjs']) modules[m] = readFileSync(join(CI_DIR, m), 'utf8');
      const root = build('wh-expr-harness-root');
      const copy = (name, body) => join(fixture(name, { ...modules, 'g.mjs': body }), 'g.mjs');
      const exec = (script) => {
        const r = spawnSync(process.execPath, [script, root], { cwd: ROOT, encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
      };
      /** 🔴 THE ANCHOR IS FOUND IN CODE, NEVER IN BYTES. That guard quotes its
       *  own source in prose — the coverage note names the very line this cuts —
       *  and a quotation is not a subject. `stripSourceComments` blanks in
       *  place, so an offset in the blanked copy is the same offset in the real
       *  bytes, which is where the cut is made. If an anchor ever stops matching
       *  exactly once this fails LOUDLY, rather than quietly running an
       *  unmutated copy and passing. */
      const cut = (subject, replacement) => {
        const code = stripSourceComments(src, '.mjs');
        assert.equal(code.split(subject).length - 1, 1, `the subject \`${subject}\` must appear exactly once outside comments`);
        const at = code.indexOf(subject);
        return `${src.slice(0, at)}${replacement}${src.slice(at + subject.length)}`;
      };
      return { src, copy, exec, cut };
    };

    test('COVERAGE LOST when limb 6 reaches no workflow at all, instead of certifying its own silence', () => {
      // "No single-brace expression" is a NEGATIVE, and a negative is worth
      // exactly what the subject behind it is worth. With the counter cut out,
      // the limb reads every file and certifies nothing — which is the shape
      // this whole guard's header spends forty lines on, one limb further down.
      const { src, copy, exec, cut } = copyHarness();
      const control = exec(copy('wh-expr-cov-control', src));
      assert.equal(control.code, 0, control.out);
      const broken = exec(copy('wh-expr-cov-off', cut('exprWorkflowsScanned++;', ';')));
      assert.equal(broken.code, 1, broken.out);
      assert.match(broken.out, /COVERAGE LOST — limb 6 judged \d+ line\(s\) across 0 of 3 workflow\(s\) — it reached nothing/);
    });

    test('REFUSES when limb 6\'s own canaries fail, so E1-E4 are not decoration', () => {
      // The subject broken here is the `run:` separation itself — the one thing
      // this limb has to get right in two opposite directions. Widened to match
      // every line, every line becomes "shell", nothing is judged, and a tree
      // with a live defect in it reads clean. Four canaries run inside that
      // guard on every invocation and all four reach the process through ONE
      // `if (exprSelfTestFailures.length)`; without this case they could all be
      // switched off and nothing here would notice.
      const { src, copy, exec, cut } = copyHarness();
      const control = exec(copy('wh-expr-canary-control', src));
      assert.equal(control.code, 0, control.out);
      const broken = exec(copy('wh-expr-canary-off', cut('const RUN_LINE = /^\\s*(?:-\\s+)?run:/;', 'const RUN_LINE = /^/;')));
      assert.equal(broken.code, 2, broken.out);
      assert.match(broken.out, /limb 6's own canaries failed \(\d+\)/);
      assert.match(broken.out, /E3 MIXED FILE/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-version-consistency', () => {
  const DECL = {
    flutter: '3.44.7',
    node: '24',
    java: '17',
    melos: '8.2.2',
    mason_cli: '0.1.3',
    wrangler: '4.114.0',
    runner_ubuntu: 'ubuntu-24.04',
    runner_windows: 'windows-2025',
    runner_macos: 'macos-26',
  };

  // The brick's stamped-service package.json — the ONLY target of the
  // "Wrangler (brick dep)" rule, so every fixture must carry it: its absence
  // is COVERAGE LOST by design (triage 2026-07-31 — the existsSync-gated
  // version let a renamed brick path silently delete the rule's whole scan
  // while a live caret drift sat on disk).
  const BRICK = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json';
  const brickPkg = (pin) => JSON.stringify({ devDependencies: { wrangler: pin } });

  /** 12 references clears the scan's own MIN_OCCURRENCES floor. */
  const wf = ({ flutter = DECL.flutter, node = DECL.node, mason = DECL.mason_cli, extra = '' } = {}) =>
    `name: X\njobs:\n  j:\n    steps:\n` +
    Array.from({ length: 5 }, () => `      - uses: x\n        with:\n          flutter-version: ${flutter}\n`).join('') +
    Array.from({ length: 5 }, () => `      - uses: y\n        with:\n          node-version: ${node}\n`).join('') +
    `      - run: dart pub global activate melos ${DECL.melos}\n` +
    `      - run: dart pub global activate mason_cli ${mason}\n` +
    extra;

  // ── the three targets the guard REFUSES to run without ─────────────────────
  // Each of these is required rather than existsSync-gated, so every fixture
  // must carry one. That is the property, not an inconvenience: the gated
  // version let hiding a file make the guard pass having scanned LESS, measured
  // 2026-08-17 at `ok … 85 reference(s) across 14 file(s)` with the Android
  // module moved aside. A fixture set that could omit them could not test it.

  /** The workspace root manifest — the melos `melos run gate` resolves. Named
   *  `rootManifest` and not `pubspec` because a module-level `pubspec` helper
   *  already exists above and means something else. */
  const rootManifest = (melos = DECL.melos) =>
    `name: ws\nworkspace:\n  - packages/core\n\ndev_dependencies:\n  melos: ${melos}\n\n` +
    `melos:\n  scripts:\n    gate:\n      run: melos run analyze && melos run test\n`;

  /** README's copy-paste build block — a real call site, read by the same rule
   *  that reads ci.yml. A human installs whatever this line says. */
  const readmeDoc = (melos = DECL.melos) =>
    `# ws\n\n## Building it\n\n\`\`\`bash\ndart pub global activate melos ${melos}\nflutter pub get\nmelos run gate\n\`\`\`\n`;

  /** An app's Android module: the Gradle pair fixes the class-file version the
   *  build EMITS, the Kotlin one fixes the JVM target of the Kotlin half. The
   *  workflow `java-version:` input only chooses which JDK is INSTALLED. */
  const androidModule = (java = DECL.java, extra = '') =>
    `android {\n` +
    `    compileOptions {\n` +
    `        sourceCompatibility = JavaVersion.VERSION_${java}\n` +
    `        targetCompatibility = JavaVersion.VERSION_${java}\n` +
    `    }\n` +
    `    kotlin {\n` +
    `        compilerOptions {\n` +
    `            jvmTarget = JvmTarget.JVM_${java}\n` +
    `        }\n` +
    `    }\n` +
    `}\n` +
    extra;

  const ANDROID = 'apps/demo/android/app/build.gradle.kts';

  const build = (name, opts = {}) => {
    const {
      wranglerPin = DECL.wrangler,
      brick = true,
      melosPin = DECL.melos,
      manifestBody,
      readmeMelos = DECL.melos,
      readmeBody,
      java = DECL.java,
      gradleExtra = '',
      android = true,
      ...wfOpts
    } = opts;
    const files = {
      'tooling/versions.json': JSON.stringify(DECL),
      '.github/workflows/ci.yml': wf(wfOpts),
      // `null` is fixture()'s "this file is ABSENT" — the only way to reach the
      // guard's required-target refusals.
      'pubspec.yaml': manifestBody === undefined ? rootManifest(melosPin) : manifestBody,
      'README.md': readmeBody === undefined ? readmeDoc(readmeMelos) : readmeBody,
    };
    if (android) files[ANDROID] = androidModule(java, gradleExtra);
    if (brick) files[BRICK] = brickPkg(wranglerPin);
    return fixture(name, files);
  };

  test('PASSES when every literal matches the declaration', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /all match versions\.json/);
  });

  test('FAILS on a drifted Flutter version, naming file, line and both values', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-flutter', { flutter: '3.40.0' })] });
    assert.equal(code, 1);
    assert.match(out, /ci\.yml:\d+/);
    assert.match(out, /"3\.40\.0".*"3\.44\.7"/);
  });

  test('FAILS on a drifted Node version', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-node', { node: '22' })] });
    assert.equal(code, 1);
    assert.match(out, /Node is "22"/);
  });

  test('FAILS when mason_cli is UNPINNED — the real defect this found', () => {
    // `dart pub global activate mason_cli` with no version takes whatever is
    // newest. Mason stamps apps, so an unpinned mason means the factory's own
    // product can differ between runs.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-mason', { mason: '' })] });
    assert.equal(code, 1);
    assert.match(out, /mason_cli is UNPINNED/);
  });

  test('compares PARSED values, so a commented-out version cannot mask a drift', () => {
    const dir = build('vc-comment', { extra: '      # flutter-version: 9.9.9\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS on a `-latest` runner label, which is a moving target', () => {
    const dir = build('vc-runner', { extra: '  k:\n    runs-on: macos-latest\n    steps: []\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /macOS runner is "macos-latest"/);
  });

  test('PASSES on pinned runner labels', () => {
    const dir = build('vc-runner-ok', {
      extra: '  k:\n    runs-on: ubuntu-24.04\n    steps: []\n  l:\n    runs-on: windows-2025\n    steps: []\n',
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    // Every REQUIRED target is present and yielding (their absence is a
    // DIFFERENT COVERAGE LOST, tested below), so the only failure here is the
    // global MIN_OCCURRENCES floor itself. The 6 it does find are the brick's
    // wrangler pin, melos in pubspec.yaml and README.md, and the Android
    // module's three java literals — the workflow contributes nothing.
    const dir = fixture('vc-cov', {
      'tooling/versions.json': JSON.stringify(DECL),
      '.github/workflows/ci.yml': `name: X\njobs:\n  j:\n    steps:\n      - run: echo hi\n`,
      'pubspec.yaml': rootManifest(),
      'README.md': readmeDoc(),
      [ANDROID]: androidModule(),
      [BRICK]: brickPkg(DECL.wrangler),
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — matched 6 version reference\(s\), expected at least 10/);
  });

  // ── the two rules PR #79 added, untested until triage 2026-07-31 ───────────
  test('PASSES when the brick wrangler pin exactly matches the declaration', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-brick-ok')] });
    assert.equal(code, 0, out);
  });

  test('FAILS when the brick wrangler pin grows a caret — the PR #79 incident', () => {
    // Locks the PR #83 whole-string-capture fix: the first regex put `\^?`
    // OUTSIDE the capture, so "^4.114.0" captured "4.114.0", equalled the pin
    // and PASSED — the caret floated silently while the guard claimed the
    // opposite. Any range operator must make the captured string unequal.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-brick-caret', { wranglerPin: '^4.114.0' })] });
    assert.equal(code, 1);
    assert.match(out, /Wrangler \(brick dep\) is "\^4\.114\.0" but versions\.json declares "4\.114\.0"/);
  });

  test('FAILS on a drifted brick wrangler pin, naming the rule and both values', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-brick-drift', { wranglerPin: '4.100.0' })] });
    assert.equal(code, 1);
    assert.match(out, /Wrangler \(brick dep\) is "4\.100\.0" but versions\.json declares "4\.114\.0"/);
  });

  test('COVERAGE: the brick package.json going missing is LOUD, not a silent shrink', () => {
    // Pre-fix this test could not be written: the target was existsSync-gated,
    // so a renamed brick path deleted the rule's only target and the guard
    // printed "ok" behind the workflows' 40+ other matches.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-brick-gone', { brick: false })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the brick's stamped-service package\.json is gone/);
  });

  test('FAILS when a workflow uses cloudflare/wrangler-action WITHOUT wranglerVersion', () => {
    // Deleting the wranglerVersion: line produces NO literal for the value
    // loop to compare — the action falls back to the version compiled into
    // its own bundle (production ran 3.90.0 while the repo declared 4.114.0).
    const dir = build('vc-action-unpinned', {
      extra: '      - uses: cloudflare/wrangler-action@9f5885d\n        with:\n          command: deploy\n',
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /uses cloudflare\/wrangler-action WITHOUT a wranglerVersion:/);
  });

  test('PASSES when the wrangler-action step pins wranglerVersion to the declaration', () => {
    const dir = build('vc-action-pinned', {
      extra:
        '      - uses: cloudflare/wrangler-action@9f5885d\n        with:\n' +
        `          wranglerVersion: '${DECL.wrangler}'\n          command: deploy\n`,
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS when there is no declaration to check against', () => {
    const dir = fixture('vc-nodecl', { '.github/workflows/ci.yml': wf() });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /no tooling\/versions\.json/);
  });

  // ── the melos dev_dependency rule, added 2026-08-17 and shipped untested ───
  test('PASSES when the workspace pubspec pins melos exactly to the declaration', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-melos-ok')] });
    assert.equal(code, 0, out);
  });

  test('FAILS when the workspace melos pin grows a caret — the pin CI installs and the pin `melos run gate` resolves may not float apart', () => {
    // The same defect class as the brick's `^4.0.0`: a caret wrapping the
    // current version is unequal to an exact pin only if the rule captures the
    // range operator INSIDE the group. Put it outside and "^8.2.2" captures
    // "8.2.2", equals the declaration, and passes while floating.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-melos-caret', { melosPin: '^8.2.2' })] });
    assert.equal(code, 1);
    assert.match(out, /Melos \(workspace dev_dependency\) is "\^8\.2\.2" but versions\.json declares "8\.2\.2"/);
  });

  test('FAILS on a drifted workspace melos pin, naming the rule and both values', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-melos-drift', { melosPin: '8.1.0' })] });
    assert.equal(code, 1);
    assert.match(out, /Melos \(workspace dev_dependency\) is "8\.1\.0" but versions\.json declares "8\.2\.2"/);
  });

  test('COVERAGE LOST when the melos key is rewritten past the rule instead of drifting', () => {
    // Quoting the value is enough: the rule requires the first character to be a
    // digit or a range operator, so `melos: "8.2.2"` yields NOTHING. The file
    // still declares a version; the rule simply stopped seeing it — which reads
    // exactly like agreement, and is what REQUIRED_YIELD exists for.
    const dir = build('vc-melos-renamed', { manifestBody: rootManifest().replace('melos: 8.2.2', 'melos: "8.2.2"') });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — pubspec\.yaml yielded 0 `melos` reference\(s\), expected at least 1/);
  });

  test("COVERAGE LOST when melos moves out of the root manifest's dev_dependencies entirely", () => {
    const dir = build('vc-melos-moved', { manifestBody: 'name: ws\nworkspace:\n  - packages/core\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — pubspec\.yaml yielded 0 `melos`/);
  });

  test('REFUSES when the root pubspec.yaml is missing — a required target may not vanish quietly', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-nopubspec', { manifestBody: null })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — required target pubspec\.yaml is missing/);
  });

  // ── README.md is a real call site: a human copy-pastes its activate line ───
  test("FAILS when README's build block installs a melos the declaration does not name", () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-readme-drift', { readmeMelos: '8.1.0' })] });
    assert.equal(code, 1);
    assert.match(out, /README\.md:\d+ Melos is "8\.1\.0" but versions\.json declares "8\.2\.2"/);
  });

  test('COVERAGE LOST when README stops carrying an activate line at all', () => {
    const dir = build('vc-readme-quiet', { readmeBody: '# ws\n\nBuild it however you like.\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — README\.md yielded 0 `melos` reference\(s\), expected at least 1/);
  });

  test('REFUSES when README.md is missing', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-noreadme', { readmeBody: null })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — required target README\.md is missing/);
  });

  // ── the Android module: what the build EMITS, not what CI INSTALLS ─────────
  test('PASSES when the Android module compiles to the declared Java', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-android-ok')] });
    assert.equal(code, 0, out);
  });

  test('FAILS when the Android module targets a Java the declaration does not name', () => {
    // VERSION_21 against a declared 17: the workflow `java-version:` input still
    // says 17 and still agrees with versions.json, so nothing outside this file
    // can see it. The class-file version every APK carries is decided here.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-android-21', { java: '21' })] });
    assert.equal(code, 1);
    assert.match(out, /build\.gradle\.kts:\d+ Java \(Gradle compileOptions\) is "21" but versions\.json declares "17"/);
    assert.match(out, /Java \(Kotlin jvmTarget\) is "21"/);
  });

  test('reports the LITERAL somebody wrote — Gradle\'s legacy VERSION_1_8 comes back as "1_8", never truncated to "1"', () => {
    const dir = build('vc-android-legacy', { java: '1_8' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /Java \(Gradle compileOptions\) is "1_8"/);
    assert.doesNotMatch(out, /Java \(Gradle compileOptions\) is "1"/);
  });

  test('strips Kotlin `//` comments, so a sentence about a PAST pin is not a drift', () => {
    // The very first run against the real Android module reported
    // `build.gradle.kts:132 Flutter is "3.44.8`"` — produced entirely by prose
    // inside a `//` comment. A guard that reddens on documentation teaches
    // people to stop writing it.
    const dir = build('vc-android-comment', {
      gradleExtra: '// we were on JavaVersion.VERSION_11 until the AGP bump; flutter-version: 9.9.9\n',
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('COVERAGE LOST when the Gradle java literals are rewritten past the rules', () => {
    // Gradle's call syntax — `sourceCompatibility(JavaVersion.VERSION_17)` — is
    // valid, does the same thing, and matches neither rule. The file still pins
    // Java; the guard just stopped reading it.
    const dir = build('vc-android-rewritten', {
      android: true,
      gradleExtra: '',
      java: DECL.java,
    });
    // Rebuild the module in call syntax rather than assignment syntax.
    const alt = fixture('vc-android-callsyntax', {
      'tooling/versions.json': JSON.stringify(DECL),
      '.github/workflows/ci.yml': wf(),
      'pubspec.yaml': rootManifest(),
      'README.md': readmeDoc(),
      [ANDROID]: 'android {\n    compileOptions {\n        sourceCompatibility(JavaVersion.VERSION_17)\n    }\n}\n',
      [BRICK]: brickPkg(DECL.wrangler),
    });
    assert.equal(run('assert-version-consistency.mjs', { args: [dir] }).code, 0);
    const { code, out } = run('assert-version-consistency.mjs', { args: [alt] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — .*build\.gradle\.kts yielded 0 `java` reference\(s\), expected at least 3/);
  });

  test('REFUSES when not one Android module is discovered — discovery finding nothing is a silent shrink', () => {
    // Mutation-proven on the REAL tree 2026-08-17: with
    // apps/subly/android/app/build.gradle.kts moved aside the existsSync-gated
    // version printed `ok  version consistency — 85 reference(s) across 14
    // file(s)` and exited 0, against 88/15 with it present. It passed having
    // checked LESS. MIN_OCCURRENCES could not see it: that floor is GLOBAL and
    // the workflows clear it alone.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-noandroid', { android: false })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — not one apps\/\*\/android\/app\/build\.gradle\.kts was found/);
  });

  // ── the report is ONE report ───────────────────────────────────────────────
  test('a coverage loss does NOT conceal a real drift found in the same run', () => {
    // The first REQUIRED_YIELD implementation called process.exit(1) the moment
    // an entry came up short, throwing away every `problems` entry already
    // accumulated. Measured on the real tree: quoting the melos pin AND drifting
    // wsl-setup.sh's openjdk pin printed the coverage loss alone — the live java
    // drift was found, held, and never shown. One real finding suppressing
    // another is this guard's own failure mode, one level up.
    const dir = build('vc-both', {
      manifestBody: rootManifest().replace('melos: 8.2.2', 'melos: "8.2.2"'),
      java: '21',
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — pubspec\.yaml yielded 0 `melos`/, 'coverage loss must be reported');
    assert.match(out, /Java \(Gradle compileOptions\) is "21"/, 'the drift found in the same run must ALSO be reported');
    assert.match(out, /version drift problem\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The behaviour that matters most is "the wrapper FAILS when the scanner stops
// detecting" — which cannot be exercised with the real binary, because a working
// gitleaks always detects. These substitute stub scanners with known behaviour.
describe('scan-secrets', () => {
  const PEM = 'BEGIN RSA PRIVATE KEY';

  /** A faithful stub: exits 1 (finding) iff the scanned dir holds one of the
   *  shapes the REAL rule set detects, and writes a gitleaks-shaped JSON report
   *  naming the RULE THAT FIRED.
   *
   *  🔴 IT PARSES THE CONFIG IT IS GIVEN RATHER THAN HARD-CODING THE SHAPES, and
   *  that change is the point of this rewrite. The previous stub carried its own
   *  hand-written SHAPES list and the fixture carried a hand-written copy of the
   *  rule ids — so THREE places had to be edited in lockstep whenever a rule was
   *  added, and on 2026-08-05 they were not: three Indian-PII rules landed in the
   *  real config and this test broke on a rule COUNT it could not have known.
   *  The count check caught it loudly, which is the system working — but a
   *  duplicated list that must be hand-synchronised is the defect, not the alarm.
   *  Now: the fixture writes the REAL .gitleaks.toml and the stub reads it, so a
   *  new rule needs a canary in scan-secrets.mjs and nothing here.
   *
   *  It also honours [rules.allowlist] regexes, because scan-secrets now plants
   *  NEGATIVE canaries — ordinary source that must NOT be flagged — and a stub
   *  blind to allowlists would report a leak for the documented placeholders. */
  const HONEST = `
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-stub'); process.exit(0); }
const src = a[a.indexOf('--source') + 1];
const cfgPath = a[a.indexOf('--config') + 1];
const reportIdx = a.indexOf('--report-path');
const reportPath = reportIdx === -1 ? null : a[reportIdx + 1];

// A deliberately small TOML reader: enough for [[rules]] id/regex/secretGroup and
// [rules.allowlist] regexes, which is the whole shape this config uses.
const cfg = readFileSync(cfgPath, 'utf8');
const RULES = [];
let cur = null, inAllow = false;
for (const raw of cfg.split(/\\r?\\n/)) {
  const line = raw.trim();
  if (line === '[[rules]]') { cur = { id: null, re: null, group: 0, allow: [] }; RULES.push(cur); inAllow = false; continue; }
  if (line === '[rules.allowlist]') { inAllow = true; continue; }
  if (!cur) continue;
  let m;
  if ((m = line.match(/^id = "(.+)"$/))) { cur.id = m[1]; continue; }
  if ((m = line.match(/^secretGroup = (\\d+)$/))) { cur.group = Number(m[1]); continue; }
  if ((m = line.match(/^regex = '''(.*)'''$/))) { if (!inAllow) cur.re = m[1]; continue; }
  if ((m = line.match(/^regexes = \\[(.*)\\]$/))) {
    if (inAllow) for (const r of m[1].split(/''',\\s*'''/)) cur.allow.push(r.replace(/'''/g, ''));
    continue;
  }
}
// [extend] useDefault = true pulls in gitleaks' own private-key rule, which is
// not written in this config but IS what the PEM canary proves.
if (/useDefault\\s*=\\s*true/.test(cfg)) RULES.unshift({ id: 'private-key', re: '${PEM}', group: 0, allow: [] });

const walk = (d) => readdirSync(d).flatMap((e) => {
  const p = join(d, e);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const findings = [];
let scannedBytes = 0;
for (const f of walk(src)) {
  let t;
  try { t = readFileSync(f, 'utf8'); } catch { continue; }
  scannedBytes += Buffer.byteLength(t);
  for (const r of RULES) {
    if (!r.re || !r.id) continue;
    let re;
    try { re = new RegExp(r.re, 'g'); } catch { continue; }
    for (const hit of t.matchAll(re)) {
      const secret = r.group ? hit[r.group] : hit[0];
      if (secret === undefined) continue;
      if (r.allow.some((p) => { try { return new RegExp(p).test(secret); } catch { return false; } })) continue;
      findings.push({ RuleID: r.id, File: f, StartLine: 1, Description: r.id });
    }
  }
}
if (reportPath) writeFileSync(reportPath, JSON.stringify(findings));
// Real gitleaks reports its volume on STDERR ("scanned ~14172 bytes (14.17 KB)
// in 354ms", measured against 8.30.1), and scan-secrets now reads that number to
// prove the scan actually arrived. A stub that stayed silent would leave the
// guard's volume floor permanently unexercised — the coverage line would report
// "volume unreported" in every test and no fixture could ever reach the check.
console.error('INF scanned ~' + scannedBytes + ' bytes (' + scannedBytes + ') in 1ms');
if (findings.length) { console.log('finding: a known secret shape'); process.exit(1); }
process.exit(0);
`;

  /** A scanner that has silently stopped detecting — always reports clean. */
  const BLIND = `
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-blind'); process.exit(0); }
process.exit(0);
`;

  /** A scanner that RUNS, DETECTS CORRECTLY, and reaches NOTHING — the shape an
   *  over-broad `[allowlist] paths`, or a `--source` that resolves to some other
   *  directory which exists and holds nothing, actually produces. Exit 0, no
   *  findings, zero volume: byte-for-byte a clean result.
   *
   *  ⚠️ THIS LIST NAMED `.gitleaksignore` FIRST UNTIL IT WAS MEASURED, and that
   *  was wrong — it filters findings by fingerprint after the bytes have been
   *  read, and the ignore file is itself scanned, so it RAISES the byte count
   *  rather than zeroing it (gitleaks 8.30.1, one 133-byte planted key: 133
   *  bytes/exit 1 without it, 334 bytes/exit 0 with it). The full measurement is
   *  recorded at step 5 of scan-secrets.mjs. Naming a cause that cannot produce
   *  the symptom is the same defect as a guard that passes on prose: it reads
   *  like knowledge and sends the next reader somewhere there is nothing to find.
   *
   *  🔴 DERIVED FROM `HONEST`, NOT WRITTEN AGAIN. It must still pass all ten
   *  planted-canary self-tests — those run over their own temp directories,
   *  which do have content — so a hand-written stub would have to re-implement
   *  the whole config parser and would drift from it exactly as the previous
   *  hand-written SHAPES list did on 2026-08-05. The only behaviour changed is
   *  the one under test: over a tree carrying the repository's four marker
   *  directories, report that nothing was read. */
  const EMPTY_SCAN = HONEST.replace(
    'const reportPath = reportIdx === -1 ? null : a[reportIdx + 1];',
    `const reportPath = reportIdx === -1 ? null : a[reportIdx + 1];
const __isRepo = ['.github', 'tooling', 'packages', 'apps'].every((m) => {
  try { return statSync(join(src, m)).isDirectory(); } catch { return false; }
});
if (__isRepo) {
  if (reportPath) writeFileSync(reportPath, '[]');
  console.error('INF scanned ~0 bytes (0) in 1ms');
  process.exit(0);
}`,
  );
  // `String.replace` returns the subject UNCHANGED when the anchor is absent, so
  // a renamed line in HONEST would silently make EMPTY_SCAN a second copy of it
  // — and the volume-floor test below would then pass while exercising nothing.
  assert.notEqual(EMPTY_SCAN, HONEST, 'the EMPTY_SCAN derivation did not apply: its anchor line is gone from HONEST');

  /** The stub lives OUTSIDE the scanned tree — both because a real scanner binary
   *  is not in the repo, and because the stub's own source contains the PEM
   *  literal it looks for, which would otherwise be found as a "leak" in itself. */
  const build = (name, stub, files = {}) => {
    const root = fixture(name, {
      'bin/stub.mjs': stub,
      'repo/README.md': 'nothing secret here\n',
      // The fixture carries the same marker paths the real tree has, because
      // scan-secrets now asserts its scan actually reached a repository before
      // believing a clean result — gitleaks over an empty directory exits 0 with
      // no findings, byte-for-byte identical to a clean repo. [pipeline F-10]
      'repo/.github/workflows/ci.yml': 'name: ci\n',
      'repo/tooling/ci/placeholder.mjs': '// guard\n',
      'repo/packages/.keep': '',
      'repo/apps/.keep': '',
      // The real tree carries .gitleaks.toml, and scan-secrets refuses to run
      // without it — default rules are blind to Cloudflare and Supabase tokens,
      // which is two of this repo's three vendors.
      //
      // 🔴 THE REAL CONFIG, VERBATIM, NOT A HAND-WRITTEN LOOKALIKE. scan-secrets
      // asserts one canary per rule, so a transcribed copy has to be edited in
      // lockstep with the real file — and when three Indian-PII rules were added
      // on 2026-08-05 it was not, and this test failed on a count it could not
      // have known about. Reading the real file makes that class of break
      // impossible: the fixture is now DERIVED, like every other list in this
      // repo that used to be typed.
      'repo/.gitleaks.toml': readFileSync(join(CI_DIR, '..', '..', '.gitleaks.toml'), 'utf8'),
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`repo/${k}`, v])),
    });
    return { repo: join(root, 'repo'), stub: join(root, 'bin', 'stub.mjs'), root };
  };

  test('PASSES on a clean tree, after proving the scanner still detects', () => {
    const { repo, stub } = build('ss-clean', HONEST);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 0, out);
    assert.match(out, /self-test — a planted secret is still detected/);
    assert.match(out, /no findings/);
    // The passing line must say HOW MUCH was read, not merely that nothing was
    // found — "no findings" is the identical sentence over a scan that reached
    // nothing. A bare `ok` here is the defect the next test exercises.
    assert.match(out, /\d[\d,]* bytes scanned/);
    assert.doesNotMatch(out, /volume unreported/);
  });

  test('COVERAGE: a scan that reaches NOTHING FAILS, though every self-test passed', () => {
    // 🔴 THE MARKER CHECK ABOVE DOES NOT CATCH THIS, WHICH IS WHY THIS TEST IS
    // SEPARATE FROM ITS NEIGHBOUR. There the root was wrong and the four marker
    // directories were absent. Here the root is RIGHT — every marker is present,
    // the config is real, the scanner runs and passes all ten planted-canary
    // self-tests — and it still reads zero bytes of the tree. Until 2026-08-17
    // that combination printed "ok  secret scan — no findings in the working
    // tree" and exited 0.
    //
    // Proven against the real thing before this fixture existed: gitleaks 8.30.1
    // over a directory holding only the four marker dirs and .gitleaks.toml
    // reports `scanned ~0 bytes (0)` and exits 0, and the committed guard called
    // that repository clean.
    const { repo, stub } = build('ss-empty-scan', EMPTY_SCAN);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 1, out);
    // The self-tests must have PASSED — otherwise this is testing a blind
    // scanner, which the next test already covers, and the coverage limb would
    // never be reached.
    assert.match(out, /self-test — a planted secret is still detected/);
    assert.match(out, /COVERAGE LOST — gitleaks scanned 0 bytes/);
    assert.match(out, /This is NOT a clean repository/);
    assert.doesNotMatch(out, /ok {2}secret scan/);
  });

  test('COVERAGE: a tree that is not the repo FAILS instead of reporting clean', () => {
    // The self-test proves the SCANNER detects. It says nothing about whether
    // the scanner was pointed at anything. A mistyped path, a checkout that did
    // not happen, or a relocated working directory all yield exit 0 and no
    // findings — identical to success. [pipeline F-10]
    const { repo, stub, root } = build('ss-wrong-root', HONEST);
    void repo;
    const { code, out } = run('scan-secrets.mjs', { args: [join(root, 'bin'), '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /The scan is broken, not the tree/);
  });

  test('FAILS when the scanner has silently stopped detecting — the whole point', () => {
    const { repo, stub } = build('ss-blind', BLIND);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /SELF-TEST FAILED/);
    assert.match(out, /would have reported this repository "clean"/);
  });

  test('FAILS when the tree actually contains a secret', () => {
    const { repo, stub } = build('ss-leak', HONEST, { 'config/leaked.key': `-----${PEM}-----\nAAAA\n` });
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /secret scan found something/);
  });

  test('FAILS with a named cause when the scanner is not installed', () => {
    const { repo, root } = build('ss-missing', HONEST);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', join(root, 'nope.mjs')] });
    assert.equal(code, 1);
    assert.match(out, /not runnable/);
  });

  // 🔴 CORPUS TRIAGE 2026-08-01 (#28), the same off-by-one as scan-workflows.mjs.
  // `positional` excluded index `zIdx + 1` unconditionally; with no `--gitleaks`
  // flag indexOf returns -1 and -1 + 1 is 0 — the repoRoot's own index — so the
  // documented no-flag form scanned process.cwd() instead. Reproduced against a
  // locally compiled gitleaks stub: aimed at an empty directory it cleared the
  // marker check against the tree it was standing in and printed "ok secret scan
  // — no findings in the working tree" about a tree it never opened.
  //
  // The assertion is on the PATH IN THE MESSAGE, deliberately. Asserting only
  // "COVERAGE LOST" would pass against the broken version too, which reports the
  // same failure about a different directory — the wrong answer for the wrong
  // reason still looks like a catch.
  test('the positional repoRoot is honoured with NO --gitleaks flag', () => {
    const { root } = build('ss-argbare', HONEST);
    const { code, out } = run('scan-secrets.mjs', { args: [join(root, 'bin')] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /bin" is missing/, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('record-deployment (offline paths)', () => {
  test('FAILS when no environment is given', () => {
    const { code, out } = run('record-deployment.mjs', { args: [], env: { ...process.env } });
    assert.equal(code, 1);
    assert.match(out, /no environment given/);
  });

  test('FAILS when the repository is unknown', () => {
    const env = { ...process.env, GITHUB_SHA: 'abc', GH_TOKEN: 't' };
    delete env.GITHUB_REPOSITORY;
    const { code, out } = run('record-deployment.mjs', { args: ['staging'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_REPOSITORY/);
  });

  test('FAILS when there is no SHA to record', () => {
    const env = { ...process.env, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
    delete env.GITHUB_SHA;
    const { code, out } = run('record-deployment.mjs', { args: ['staging'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_SHA/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-6] assert-seams-wired — the guard that makes a fail-closed seam
// prove it has an on-switch. Every check below has a recorded failing case,
// because a guard nobody has watched fail is a guard nobody should trust (F-10).
describe('assert-seams-wired', () => {
  // 🔴 TWO NEEDS SINCE 2026-08-10, AND THE SECOND LINE IS THE WHOLE POINT OF
  // THE FIRST STILL MEANING ANYTHING. research/44 rung 4 turned the purpose into
  // a PARAMETER of `applyConsentDecision` so the Art 21 objection reuses one
  // decision path rather than forking it ([C-3]). That made `.record(purpose,`
  // an acceptable shape — and a chassis that had quietly stopped recording
  // ANALYTICS consent would then satisfy "a real record() call" with a path that
  // records something else entirely. The seam gained a second need, "the
  // parameter still DEFAULTS to analytics", so the fixture carries it.
  const PURPOSE_DEFAULT = 'core.ConsentPurpose purpose = core.ConsentPurpose.analytics,';
  const RECORD_CALL = `
final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
  );
};
Future<void> applyConsentDecision({
  ${PURPOSE_DEFAULT}
}) async {}
const String kPrivacyPolicyVersion = '2026-07-26';
`;
  const UI_CALLER = `onPressed: () => recordAnalyticsConsent(ref, granted: true),`;
  const POLICY = (v) => `<p class="updated" data-policy-version="${v}">x</p>`;

  // 12 files minimum, else the guard reports COVERAGE LOST rather than passing.
  const filler = (n) => {
    const out = {};
    for (let i = 0; i < n; i++) out[`apps/subly/lib/filler_${i}.dart`] = '// filler\n';
    return out;
  };

  // The DECLARATION must be present in the fixture's provider file, exactly as
  // it is in the real repo. Without it these tests pass against a guard whose
  // caller check is satisfied by the declaration itself — which is the bug that
  // was live here, invisible to a fixture that omitted the declaration and
  // caught only by mutating the real tree.
  const DECLARATION = `
Future<void> recordAnalyticsConsent(
  WidgetRef ref, {
  required bool granted,
}) async {}
`;

  // The guard checks several seams in one run, so a fixture that omits the
  // pack-verifier files fails for a reason unrelated to what the test is about.
  // Kept realistic rather than minimal — the same correction the caller-vs-
  // declaration bug forced.
  // The brick template also declares kPrivacyPolicyVersion, so the guard checks
  // BOTH files. A fixture missing it fails for a reason unrelated to the test —
  // fixtures must mirror the real tree.
  // [pipeline C-6] The reminders seam, added 2026-08-01 after it was found dead:
  // the brick's toggle called requestPermission() and persisted the answer, and
  // `scheduleDaily` had zero call sites in the whole template. The DECLARATION
  // of applyReminderChoice lives in the provider file exactly as it does in the
  // real tree, so the caller check cannot be satisfied by the declaration — the
  // trap that was live in this guard once already.
  const BRICK_SCHEDULES = `
Future<bool> applyReminderChoice({
  required bool on,
  required String title,
  required String body,
}) async {
  await svc.init();
  await svc.scheduleDaily(core.DailyReminder(id: kDailyReminderId));
  return true;
}
`;
  const BRICK_TOGGLE_CALLS = 'onChanged: (bool on) => c.applyReminderChoice(on: on),\n';

  // [pipeline 12]W-7b — the review prompt is an EXCLUSIVE trigger: exactly one
  // caller, no more and no fewer. iOS silently DISCARDS requests past its quota,
  // so a second call site is not a second prompt — it is the one prompt the app
  // ever gets, spent wherever that second caller happened to fire, with no error
  // anywhere. The fixture carries the single legitimate call site so the cases
  // below can add a second one, or take this one away.
  const BRICK_REVIEW = `
Future<void> maybeAsk() async {
  final decision = gate.decide(state);
  if (decision.shouldAsk) {
    await prompter.requestReview();
  }
}
`;

  // [pipeline 5]M-5 — the ENTITLEMENTS seam, wired 2026-08-01. It had read
  // `wired: false, deferred: 'stage 5'` with no `needs` array at all, and its
  // three needs are scoped to the brick: the FETCH must happen, the answer must
  // reach a GATE, and there must be a CHECKOUT the gate can be got past.
  // Fixtured here for the same reason the reminder seam is — a fixture missing
  // them fails for a reason unrelated to whatever each test is about.
  const BRICK_MONEY = `
final FutureProvider<core.Entitlements> entitlementsProvider =
    FutureProvider<core.Entitlements>((ref) async {
      final core.Result<core.Entitlements> fresh = await ref
          .watch(entitlementTransportProvider)
          .fetch(
            appId: AppConfig.appId,
            accessToken: await ref.read(authRepositoryProvider).currentAccessToken(),
          );
      return fresh.fold((core.Entitlements e) => e, (core.Failure _) => core.Entitlements.none);
    });
`;
  const BRICK_GATE = `
Widget build(BuildContext context) => PaywallGate(
  locked: ref.watch(paywallLockedProvider),
  child: const SizedBox.shrink(),
);
`;
  const BRICK_CHECKOUT = `
Future<void> _buy(Offering offering) async {
  final CheckoutStart start = await rail.startCheckout(offering);
}
`;

  // [pipeline 7]P-9 consumer half · [8]K-9 — the CONTENT-PACK rail, wired
  // 2026-08-03. `pack_verifier` had read `wired: false, deferred:` and the
  // separate check below proved only that an implementation existed and was
  // exported; both were true for months while `ContentPackLoader` had zero
  // non-test call sites anywhere. The seam now carries two `needs` scoped to
  // the brick, so the fixture has to carry BOTH halves — the loader being
  // CONSTRUCTED with a real verifier, and something actually ASKING it for a
  // pack. Split into two constants rather than one blob precisely so the cases
  // below can remove either half on its own and prove each limb can fail.
  const BRICK_PACK_LOADER = `
final Provider<core.ContentPackLoader> contentPackLoaderProvider =
    Provider<core.ContentPackLoader>(
      (ref) =>
          core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),
    );
`;
  const BRICK_PACK_LOAD = `
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(expectPackId: AppConfig.appId, remote: source);
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });
`;

  // [research/44 §7 rung 3] — the PROMO_CARD seam, wired 2026-08-10. Three
  // brick-scoped needs, and the seam exists because its correct behaviour and
  // its dead behaviour are pixel-identical: `features.promo_card_enabled` is
  // absent from every served config, an absent key reads false, so the shipped
  // card draws the same collapsed `SizedBox.shrink()` a deleted card draws.
  //
  // Split into THREE constants rather than one blob for the same reason the
  // pack rail above is: the cases at the end of this describe delete each half
  // on its own, and a single case removing all three would still pass with two
  // of the needs neutered.
  const BRICK_PROMO_MOUNT = 'children: <Widget>[const UpgradePromoCard()],\n';
  // The ARGUMENT form — what the brick actually ships since the D2 signature
  // wired the render path through `PromoObjection` (research/44 rung 4). The
  // fixture follows the tree rather than the other way round; a fixture frozen
  // on a shape nothing ships is a test of history.
  const BRICK_PROMO_DECIDE = `
final core.PromoGateDecision decision = core.PromoObjection(consent)
    .decide(
      ref.watch(promoGateProvider),
      stored,
      now: DateTime.now(),
      featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
      hasContent: offerings.isNotEmpty,
    );
`;
  // The RECEIVER form — the pre-rung-4 shape, kept because an app stamped
  // before the objection landed still has it and must not read as "no decision
  // on the render path". Exercised by its own case below, or the second half of
  // that alternation would be a branch no test enters.
  const BRICK_PROMO_DECIDE_RECEIVER = `
final core.PromoGateDecision decision = ref
    .watch(promoGateProvider)
    .decide(
      stored,
      now: DateTime.now(),
      featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
      hasContent: offerings.isNotEmpty,
    );
`;
  const BRICK_PROMO_MARK =
    'ref.read(promoCardStateProvider.notifier).markShown(decision.state);\n';
  // 🔴 THE DECLARATION, AND IT IS LOAD-BEARING RATHER THAN SCENERY. The
  // `.markShown(` need carries a `declares:` filter, so the file holding
  // `Future<void> markShown(` is dropped from the candidate set. In the real
  // template that declaration lives in providers.dart and the CALL lives in the
  // home body — a fixture that omitted the declaration would leave the filter
  // with nothing to exclude and would agree with a guard whose caller check the
  // declaration could satisfy. That is the exact trap this file already records
  // for `recordAnalyticsConsent`, one seam later.
  const BRICK_PROMO_DECL = `
Future<void> markShown(core.PromoGateState decided) async {
  if (!_recordRead) return;
  await kv.write(_promoCardKey, decided.encode());
}
`;

  // [pipeline C-6] the USER_STATE_RESET seam, wired 2026-08-11 after
  // `EntitlementCache.clear()` was found with ZERO production call sites while
  // the cache honours a cached Pro answer offline for seven days — so the next
  // person to sign in on a shared device inherited the previous one's
  // subscription. Four needs, and the fixture splits into four pieces for the
  // usual reason: a single case that removed the lot would still pass with
  // three of them neutered.
  //
  // 🔴 THE `signOut()` CALL IN HERE IS LOAD-BEARING TWICE OVER. It satisfies
  // need (3)'s counterpart in the `session_end` EXCLUSIVE TRIGGER — the spine
  // is the only file permitted to end a session — and the trigger's
  // at-least-one half means a fixture with no call at all fails for a reason
  // unrelated to whatever each test is about.
  const BRICK_DROP_CACHE = '  ref.read(entitlementCacheProvider).clear,\n';
  const BRICK_DROP_SCHEDULE =
    '  ref.read(notificationServiceProvider).cancelAll,\n';
  // The DECLARATION of `signOutAndForgetUser` lives here, exactly as it does in
  // the real template, because need (3) carries a `declares:` filter that drops
  // the declaring file from the candidate set. A fixture that omitted it would
  // leave the filter nothing to exclude and would agree with a guard whose
  // caller check the declaration itself could satisfy — the trap this file
  // already records twice, for `recordAnalyticsConsent` and `markShown`.
  const brickForget = ({
    dropCache = BRICK_DROP_CACHE,
    dropSchedule = BRICK_DROP_SCHEDULE,
    spineSignOut = '  await auth.signOut();\n',
  } = {}) => `
List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[
${dropCache}${dropSchedule}];
Future<void> forgetSignedInUser(List<UserStateDrop> drops) async {
  for (final UserStateDrop drop in drops) {
    await drop();
  }
}
Future<void> signOutAndForgetUser(WidgetRef ref) async {
  final core.AuthRepository auth = ref.read(authRepositoryProvider);
  final List<UserStateDrop> drops = userStateDrops(ref);
${spineSignOut}  await forgetSignedInUser(drops);
}
`;
  // The CONTROL and the HANDLER are separate strings because need (4) exists
  // precisely because need (3) alone did not fail: reverting the tile to the
  // fire-and-forget call leaves `signOutAndForgetUser(` sitting in a `_signOut`
  // helper nothing calls, and the row printed three `ok`s. A case below removes
  // each on its own.
  const BRICK_SIGNOUT_TILE = 'onTap: () => _signOut(context, ref, l10n),\n';
  const BRICK_SIGNOUT_HANDLER = `
Future<void> _signOut(BuildContext context, WidgetRef ref, AppLocalizations l10n) async {
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  try {
    await signOutAndForgetUser(ref);
  } catch (_) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.signOutFailed)));
  }
}
`;

  const brickFiles = ({
    reminders = BRICK_SCHEDULES,
    toggle = BRICK_TOGGLE_CALLS,
    money = BRICK_MONEY,
    gate = BRICK_GATE,
    checkout = BRICK_CHECKOUT,
    review = BRICK_REVIEW,
    packLoader = BRICK_PACK_LOADER,
    packLoad = BRICK_PACK_LOAD,
    promoMount = BRICK_PROMO_MOUNT,
    promoDecide = BRICK_PROMO_DECIDE,
    promoMark = BRICK_PROMO_MARK,
    promoDecl = BRICK_PROMO_DECL,
    forget = brickForget(),
    signOutTile = BRICK_SIGNOUT_TILE,
    signOutHandler = BRICK_SIGNOUT_HANDLER,
    homeExtra = '',
    settingsExtra = '',
  } = {}) => ({
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart':
      `const String kPrivacyPolicyVersion = '2026-07-26';\n${reminders}${review}${packLoader}${packLoad}${promoDecl}${forget}`,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart':
      toggle + signOutTile + signOutHandler + settingsExtra,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/money_providers.dart': money,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/home/home_screen.dart':
      gate + promoMount + promoDecide + promoMark + homeExtra,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/monetization/paywall_screen.dart':
      checkout,
  });

  const PACK_FILES = {
    'packages/core/lib/src/content/ed25519_pack_verifier.dart':
      'class Ed25519PackVerifier implements PackVerifier {\n  verify() async { if (x == null) return false; return await _ed.verify(m); }\n}\n',
    'packages/core/lib/nikatru_core.dart': "export 'src/content/ed25519_pack_verifier.dart';\n",
    'packages/core/lib/src/content/pack_verifier.dart':
      'const Map<String, String> kContentPackPublicKeys = <String, String>{};\n',
  };

  // The crash sink is a seam like the others: TelemetryBootstrap falls back to a
  // NoOp client on an empty DSN, so "no crash reports" and "no crashes" look
  // identical. Both ends are fixtured because the guard asserts both — a deploy
  // that supplies a value nothing reads is as broken as an app reading a value
  // nothing supplies.
  const DEPLOY_WITH_DSN = 'run: flutter build web --release --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}\n';
  const MAIN_READS_DSN = "final dsn = String.fromEnvironment('GLITCHTIP_DSN');\n";

  // 🔴 THE SUPPLIER SIDE IS DERIVED FROM tooling/channel-register.json SINCE
  // 2026-08-02 ([pipeline 11]E-7 residue), so these fixtures now have to model a
  // workflow's JOB STRUCTURE rather than a bare `run:` line. The old check read
  // the filename `deploy-web.yml` and nothing else, and printed ok while
  // build-platforms.yml built all six platforms with ZERO `--dart-define`s —
  // and that workflow is the declared lane of BOTH the `android-play` and the
  // `windows-store` rows. Two artifact lanes with no crash sink, guard green.
  const jobWith = (name, body) =>
    `  ${name}:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: build\n        ${body
      .trimEnd()
      .split('\n')
      .join('\n        ')}\n`;
  const workflow = (...jobs) => `name: fixture\non: [push]\njobs:\n${jobs.join('')}`;
  /** FOUR lanes — the number the real register carries — because the guard
   *  floors the derived subject set at that number and a fixture below
   *  deliberately drops one to prove that floor can fail.
   *
   *  Three until 2026-08-09, when `linux-snap` gained a lane: submit-snap.yml's
   *  `dry-run` job now compiles a Linux bundle and packs a .snap, so it acquired
   *  the crash-sink obligation by BEING a lane — which is exactly the property
   *  the derivation exists for, and the reason this fixture moves with the
   *  register rather than pinning a number of its own. */
  const CHANNEL_REGISTER = JSON.stringify(
    {
      channels: [
        { id: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
        { id: 'android-play', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        { id: 'windows-store', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' } },
        { id: 'linux-snap', lane: { workflow: '.github/workflows/submit-snap.yml', job: 'dry-run' } },
      ],
    },
    null,
    2,
  );

  // [G-43] The secure-session seam. `initNikatruAuth` is the one call that keeps
  // the refresh token out of plaintext, and it had ZERO callers tree-wide while
  // this guard — whose entire subject is "does anything real call it" — did not
  // list it at all. The fixture carries a real call site so the mutations below
  // have something to remove.
  const BRICK_MAIN_INITS_AUTH = `
Future<void> main() async {
  if (AppConfig.isBackendLive) {
    await initNikatruAuth(
      url: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabaseAnonKey,
      secureStore: FlutterSecureStore(),
    );
  }
}
`;

  const build = (
    name,
    {
      record = RECORD_CALL,
      ui = UI_CALLER,
      decl = DECLARATION,
      htmlVersion = '2026-07-26',
      dartVersion = '2026-07-26',
      fillerCount = 14,
      deploy = DEPLOY_WITH_DSN,
      android = DEPLOY_WITH_DSN,
      windows = DEPLOY_WITH_DSN,
      snap = DEPLOY_WITH_DSN,
      register = CHANNEL_REGISTER,
      // [pipeline 11]E-10. The fixture's COMMENT deliberately explains the
      // setting in prose, so the passing case exercises the comment stripping
      // rather than assuming it — the whole file this models is prose about
      // exactly this line.
      bootstrap = '// enableAutoSessionTracking is left at its default here.\noptions.enableAutoSessionTracking = false;\n',
      mainDart = MAIN_READS_DSN,
      brickMain = BRICK_MAIN_INITS_AUTH,
      reminders = BRICK_SCHEDULES,
      toggle = BRICK_TOGGLE_CALLS,
      review = BRICK_REVIEW,
      packLoader = BRICK_PACK_LOADER,
      packLoad = BRICK_PACK_LOAD,
      promoMount = BRICK_PROMO_MOUNT,
      promoDecide = BRICK_PROMO_DECIDE,
      promoMark = BRICK_PROMO_MARK,
      promoDecl = BRICK_PROMO_DECL,
      forget = brickForget(),
      signOutTile = BRICK_SIGNOUT_TILE,
      signOutHandler = BRICK_SIGNOUT_HANDLER,
      homeExtra = '',
      settingsExtra = '',
    } = {},
  ) =>
    fixture(name, {
      ...filler(fillerCount),
      ...PACK_FILES,
      ...brickFiles({
        reminders,
        toggle,
        review,
        packLoader,
        packLoad,
        promoMount,
        promoDecide,
        promoMark,
        promoDecl,
        forget,
        signOutTile,
        signOutHandler,
        homeExtra,
        settingsExtra,
      }),
      'apps/subly/lib/state/analytics_providers.dart':
        `${record}\n${decl}\nconst String kPrivacyPolicyVersion = '${dartVersion}';\n`,
      'apps/subly/lib/features/consent/consent_prompt.dart': ui,
      'sites/nikatru/privacy.html': POLICY(htmlVersion),
      'tooling/channel-register.json': register,
      '.github/workflows/deploy-web.yml': workflow(jobWith('deploy-web', deploy)),
      '.github/workflows/build-platforms.yml': workflow(
        jobWith('linux_web_android', android),
        jobWith('windows', windows),
      ),
      '.github/workflows/submit-snap.yml': workflow(jobWith('dry-run', snap)),
      'apps/subly/lib/main.dart': mainDart,
      'packages/telemetry/lib/src/telemetry_bootstrap.dart': bootstrap,
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart': brickMain,
    });

  test('passes when the seam has a real call site and the policy matches', () => {
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('seams-ok') });
    assert.equal(code, 0);
    assert.match(out, /a real record\(\) call/);
    assert.match(out, /policy version pinned/);
  });

  // 🔴 THE RECORDED FAILING CASE FOR THE SECOND CONSENT NEED, added with the
  // need itself. r4 re-pointed this seam and shipped no case that could fail on
  // the new limb alone — and a limb with no failing case is the assertion this
  // repository refuses to trust. Here the record() call is untouched and only
  // the DEFAULT moves, so need (1) still passes and the row must still go red;
  // if it ever goes green, the parameterised path has stopped proving that
  // analytics is what a plain `applyConsentDecision()` records.
  test('FAILS when the purpose parameter stops defaulting to analytics', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-purpose-default-moved', {
        record: RECORD_CALL.replace(PURPOSE_DEFAULT, 'core.ConsentPurpose purpose = core.ConsentPurpose.promo,'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /analytics is still the purpose it defaults to/);
    // …and the FIRST need is untouched, or this case would be proving the
    // wrong thing — a fixture that broke both limbs would pass this assertion
    // while telling us nothing about the one under test.
    assert.match(out, /ok\s+consent — a real record\(\) call/);
  });

  test('FAILS when the deploy stops supplying GLITCHTIP_DSN — the original defect', () => {
    // This was live: no workflow passed the DSN, so the only shipping app
    // initialised a NoOp client and a real user's crash reached nobody.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-dsn', { deploy: 'run: flutter build web --release\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /does not pass --dart-define=GLITCHTIP_DSN/);
  });

  test('FAILS when the app stops reading the DSN the deploy supplies', () => {
    // The other end of the pipe. Checking only the workflow would keep passing.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-unread', { mainDart: '// telemetry removed\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /no longer reads/);
  });

  // ── 🔴 A DEFINE BEHIND A `#` IS PROSE (2026-08-01 full-corpus review) ───────
  // The check read the RAW workflow, so commenting the define out — one
  // character, the exact edit somebody makes while debugging build flags — still
  // counted as "supplied". Mutation-proven on the real deploy-web.yml: the
  // shipped guard printed `ok   crash sink wired` over a build that would have
  // initialised the NoOp client. Worse than a plain comment: the define sits in
  // a `run: >` folded scalar, where that `#` is a SHELL comment that ALSO
  // swallows the `--dart-define=APP_ENV=production` on the next folded line.
  test('FAILS when the DSN define is commented out rather than removed', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-commented', {
        deploy:
          'run: >\n  flutter build web --release\n  # --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}\n  --dart-define=APP_ENV=production\n',
      }),
    });
    assert.equal(code, 1, 'a flag behind a comment marker is not a flag');
    assert.match(out, /does not pass --dart-define=GLITCHTIP_DSN/);
  });

  test('FAILS when the whole build line is commented out', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-line-commented', {
        deploy: '# run: flutter build web --release --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}\nrun: echo skipped\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /does not pass --dart-define=GLITCHTIP_DSN/);
  });

  // The false-alarm side: only a `#` BEFORE the define disqualifies it. A real
  // define that happens to carry a trailing comment is still a real define, and
  // comments elsewhere in the file are none of this check's business.
  test('a comment AFTER the define, or anywhere else, is not a false alarm', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-trailing-comment', {
        deploy:
          '# build the web bundle\nrun: >\n  flutter build web --release\n  --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}  # crash sink\n',
      }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /crash sink wired/);
  });

  // ── [pipeline 12]W-7b · EXACTLY ONE CALLER, and zero is not "at most one" ──
  //
  // Everything above proves AT LEAST ONE caller. The review prompt needs the
  // other bound too: iOS silently DISCARDS requests past its quota, so a second
  // call site is not a second prompt — it is the one prompt the app ever gets,
  // spent wherever that second caller happened to fire, with no error anywhere.
  // The requirement's own wording ("exposes no public trigger a button could
  // call") is a claim about SOURCE SHAPE that no unit test can express, which is
  // precisely why it went unnoticed while `requestReview()` shipped public on
  // the interface, on the NoOp and on the adapter.
  //
  // Mutation-proven on the REAL tree first (2026-08-02, each restored from
  // memory and byte-compared, baseline re-verified green):
  //   1. a rate-us button added to the stamped settings screen  → caught
  //   2. a second caller added to apps/subly                    → caught
  //   3. the ONE permitted caller commented out                 → NOT CAUGHT at
  //      first. `hits()` matched the RAW source, so `// await prompter
  //      .requestReview();` still counted — and that hole was not specific to
  //      this new limb, it was live for EVERY seam in this file. Fixed by
  //      stripping Dart comments and string literals before matching, and
  //      re-proven by commenting out the reminders `scheduleDaily` call and the
  //      entitlement `fetch` call on the real brick: both now caught, both green
  //      before.
  //   4. the caller renamed to requestReviewLater()             → caught
  test('review_prompt — a permitted caller passes, and the guard names it', () => {
    // P2.6a widened `allowed` to per-spine-file (brick + each in-repo stamped
    // app), so the ok-line stopped claiming "exactly one caller" — the bound is
    // now "every caller is a permitted spine, at least one exists". This test
    // asserts the message that carries that bound; the two tests below still
    // prove both failure directions (extra caller / permitted-but-silent).
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('seams-review-ok') });
    assert.equal(code, 0, out);
    assert.match(out, /review_prompt — every caller is a permitted spine/);
  });

  test('review_prompt — an allowed file that does not EXIST is not a moved caller', () => {
    // The fixture tree has no apps/subly at all, while the real guard's
    // allowlist names apps/subly/lib/state/providers.dart. Before P2.6a's fix
    // this exact shape failed as "no longer calls it" — an allowlist entry for
    // a stamped app must be inert in trees where that app is not stamped.
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('seams-review-ok') });
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /no longer calls it/);
  });

  test('FAILS on a SECOND caller — the one prompt the app gets, spent elsewhere', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-review-two', {
        settingsExtra: 'onPressed: () => ref.read(p).requestReview(),\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /additional call site/);
  });

  // 🔴 ZERO SATISFIES "AT MOST ONE". Without this half, deleting the only caller
  // turns the bound GREEN — the most obvious way for a rule like this to stop
  // meaning anything.
  test('FAILS when the only caller is deleted — zero is not "at most one"', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-review-none', { review: '// the prompt is asked nowhere\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /review_prompt — NOTHING calls it/);
  });

  // The mutation that exposed the raw-source hole in `hits()`.
  test('a COMMENTED-OUT caller is not a caller — for this seam or any other', () => {
    const commented = run('assert-seams-wired.mjs', {
      cwd: build('seams-review-commented', {
        review: 'Future<void> maybeAsk() async {\n  // await prompter.requestReview();\n}\n',
      }),
    });
    assert.equal(commented.code, 1, 'a call behind a comment marker is not a call');
    assert.match(commented.out, /review_prompt — NOTHING calls it/);

    // …and the same edit against an OLDER limb, because the fix was to the
    // shared matcher rather than to the new rule.
    const seam = run('assert-seams-wired.mjs', {
      cwd: build('seams-sched-commented', {
        reminders:
          'Future<bool> applyReminderChoice({required bool on}) async {\n' +
          '  await svc.init();\n' +
          '  // await svc.scheduleDaily(core.DailyReminder(id: kDailyReminderId));\n' +
          '  return true;\n}\n',
      }),
    });
    assert.equal(seam.code, 1);
    assert.match(seam.out, /a real scheduleDaily call site in the stamped chassis NOT FOUND/);
  });

  // …and a STRING that merely contains the call is not a call either.
  test('the call name inside a string literal is not a caller', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-review-string', {
        review: "const help = 'call .requestReview() from the gate';\n",
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /review_prompt — NOTHING calls it/);
  });

  test('FAILS when the permitted caller MOVES without the allowlist moving', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-review-moved', {
        review: '// asked from the settings screen now\n',
        settingsExtra: 'onPressed: () => ref.read(p).requestReview(),\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /no longer calls it/);
  });

  // ── [pipeline 11]E-7 — the SUPPLIER SET IS DERIVED, and it is per-JOB ──────
  test('FAILS when an ARTIFACT lane other than the web deploy supplies no DSN', () => {
    // The residue this replaced: build-platforms.yml built all six platforms
    // with zero `--dart-define`s while the old check, which read the filename
    // `deploy-web.yml`, printed ok. Both non-web rows point at that workflow.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-android-no-dsn', { android: 'run: flutter build appbundle --release\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /job `linux_web_android` \(the lane of channel `android-play`\) does not pass --dart-define=GLITCHTIP_DSN/);
  });

  test('the define in a DIFFERENT job of the same workflow does not satisfy the check', () => {
    // The whole-file form would pass here: build-platforms.yml still contains
    // the string. Mutation-proven on the REAL tree first — the define moved from
    // the `windows` job to the `apple` job, five occurrences in the file, and the
    // guard still named `windows`.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-wrong-job', { windows: 'run: flutter build windows --release\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /job `windows` \(the lane of channel `windows-store`\)/);
  });

  // 🔴 THE OBLIGATION IS ACQUIRED BY BEING A LANE, and this is the proof for the
  // one added on 2026-08-09. Nothing in assert-seams-wired.mjs names
  // submit-snap.yml: the subject set is derived from the register, so the .snap
  // lane started owing a crash sink the moment it got a `lane` block — which is
  // the property the derivation exists for, stated as a failing case rather than
  // as a comment.
  test('FAILS when the SNAP lane supplies no DSN — a lane acquires the duty by existing', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-dsn-no-snap', { snap: 'run: flutter build linux --release\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /job `dry-run` \(the lane of channel `linux-snap`\)/);
  });

  test('COVERAGE LOST when the register stops declaring the lanes that exist', () => {
    const shrunk = JSON.parse(CHANNEL_REGISTER);
    shrunk.channels[2].lane = null;
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-lane-dropped', { register: JSON.stringify(shrunk, null, 2) }),
    });
    assert.equal(code, 1);
    assert.match(out, /only 3 channel row\(s\) declare a `lane\.workflow` \+ `lane\.job`/);
  });

  test('COVERAGE LOST when a lane names a job that is not in its workflow', () => {
    const renamed = JSON.parse(CHANNEL_REGISTER);
    renamed.channels[2].lane.job = 'windows_build';
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-lane-job-gone', { register: JSON.stringify(renamed, null, 2) }),
    });
    assert.equal(code, 1);
    assert.match(out, /names job `windows_build` .* and this scan could not find that job/);
  });

  // ── [pipeline 11]E-10 — the sink must not imply a metric the server cannot
  //    supply. sentry_flutter defaults enableAutoSessionTracking ON and
  //    GlitchTip does not implement release health, so the client shipped
  //    session envelopes nothing stored — and "crash-free sessions", the metric
  //    every crash-health conversation reaches for, read as available when it
  //    can never be computed here.
  test('FAILS when session tracking is left at the SDK default', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-sessions-on', { bootstrap: 'options.sendDefaultPii = false;\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /does not set `options\.enableAutoSessionTracking = false`/);
  });

  test('a COMMENT about session tracking does not satisfy the check', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-sessions-prose', {
        bootstrap: '// options.enableAutoSessionTracking = false; // TODO\noptions.sendDefaultPii = false;\n',
      }),
    });
    assert.equal(code, 1, 'a setting behind a comment marker is prose, not a setting');
    assert.match(out, /does not set `options\.enableAutoSessionTracking = false`/);
  });

  test('COVERAGE LOST when the telemetry bootstrap is gone', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-bootstrap-gone', { bootstrap: null }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — .*telemetry_bootstrap\.dart is gone/s);
  });

  test('COVERAGE LOST when the channel register cannot be read at all', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-register-broken', { register: '{ not json' }),
    });
    assert.equal(code, 1);
    assert.match(out, /channel-register\.json could not be read/);
  });

  test('FAILS when the record() call is deleted — the original defect', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-record', { record: '// nothing calls record any more\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real record\(\) call NOT FOUND/);
  });

  test('FAILS when the UI caller is deleted but the logic remains', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-ui', { ui: '// prompt removed\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a UI caller NOT FOUND/);
  });

  // [G-43] The secure-session seam, which was the fifth dead capability nobody
  // counted: `initNikatruAuth` shipped with zero callers while its own doc said
  // "the brick calls this". It was absent from REQUIRED_COVERAGE, so the guard
  // built to count dead capabilities could not see it.
  test('FAILS when nothing calls initNikatruAuth — the session goes back to plaintext', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-authinit', { brickMain: '// the brick initialises no identity at all\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real caller \(not a test\) NOT FOUND/);
  });

  // 🔴 A LOCALLY STAMPED apps/probe MUST NOT SATISFY A SEAM. It is gitignored —
  // present on a dev box, absent from a fresh CI checkout — so a guard that
  // counts it answers a different question depending on who runs it. Found by
  // mutation: with `initNikatruAuth` deleted from BOTH real call sites this
  // guard still printed ok, held up entirely by a throwaway stamp.
  test('a gitignored apps/probe stamp does NOT count as a caller', () => {
    const dir = fixture('seams-probe-only', {
      ...filler(14),
      ...PACK_FILES,
      ...brickFiles(),
      'apps/subly/lib/state/analytics_providers.dart':
        `${RECORD_CALL}\n${DECLARATION}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n`,
      'apps/subly/lib/features/consent/consent_prompt.dart': UI_CALLER,
      'sites/nikatru/privacy.html': POLICY('2026-07-26'),
      '.github/workflows/deploy-web.yml': DEPLOY_WITH_DSN,
      'apps/subly/lib/main.dart': MAIN_READS_DSN,
      // The ONLY call site is inside the throwaway stamp.
      'apps/probe/lib/main.dart': BRICK_MAIN_INITS_AUTH,
    });
    const { code, out } = run('assert-seams-wired.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /a real caller \(not a test\) NOT FOUND/);
  });

  // ── THE REMINDERS SEAM ─────────────────────────────────────────────────────
  // Recorded failing cases for the seam added 2026-08-01. Both mutations are the
  // state HEAD was actually in: the toggle existed, the flag persisted, and
  // nothing was ever scheduled.
  test('FAILS when the brick schedules nothing — the shipped defect', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-schedule', {
        reminders:
          '\nFuture<bool> applyReminderChoice({required bool on}) async {\n' +
          '  final bool granted = await svc.requestPermission();\n' +
          '  await set(granted);\n  return granted;\n}\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real scheduleDaily call site in the stamped chassis NOT FOUND/);
  });

  test('FAILS when the toggle no longer calls the scheduling path', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-toggle-caller', {
        toggle: 'onChanged: (bool on) => c.setRemindersFlag(on),\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a UI caller that turns the switch into a schedule NOT FOUND/);
  });

  // 🔴 THE DECLARATION IS NOT A CALLER, and the `scope` is not decoration:
  // without it a call in apps/ keeps the CHASSIS seam green while every stamped
  // app ships the dead toggle.
  test('a caller outside the brick does NOT satisfy a chassis seam', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-schedule-elsewhere', {
        reminders:
          '\nFuture<bool> applyReminderChoice({required bool on}) async => on;\n',
        toggle: 'onChanged: (bool on) => c.applyReminderChoice(on: on),\n',
        record: `${RECORD_CALL}\nawait service.scheduleDaily(reminder);\n`,
      }),
    });
    assert.equal(code, 1, 'apps/subly calling scheduleDaily says nothing about the brick');
    assert.match(out, /a real scheduleDaily call site in the stamped chassis NOT FOUND/);
  });

  test('FAILS when the caller passes no real platform secure store', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-securestore', {
        brickMain: BRICK_MAIN_INITS_AUTH.replace('      secureStore: FlutterSecureStore(),\n', ''),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real platform secure store handed to it NOT FOUND/);
  });

  // The regression test for the guard's own defect. A declaration is not a
  // caller; if this ever passes with no UI file, the caller check has stopped
  // discriminating and the rail can go dark with CI green.
  test('a DECLARATION alone does not count as a caller', () => {
    const dir = fixture('seams-decl-only', {
      ...filler(14),
      ...PACK_FILES,
      ...brickFiles(),
      'apps/subly/lib/state/analytics_providers.dart':
        `${RECORD_CALL}\n${DECLARATION}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n`,
      // no consent_prompt.dart, no settings caller — nothing calls it at all
      'sites/nikatru/privacy.html': POLICY('2026-07-26'),
      // Present so the ONLY thing missing is the consent caller: an unrelated
      // failure would make this test pass for the wrong reason.
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart': BRICK_MAIN_INITS_AUTH,
    });
    const { code, out } = run('assert-seams-wired.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /a UI caller NOT FOUND/);
  });

  test('FAILS on policy-version drift between app and published policy', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-drift', { htmlVersion: '2026-08-01', dartVersion: '2026-07-26' }),
    });
    assert.equal(code, 1);
    assert.match(out, /policy version DRIFT/);
  });

  test('FAILS when privacy.html carries no version at all', () => {
    const dir = fixture('seams-noversion', {
      ...filler(14),
      ...PACK_FILES,
      ...brickFiles(),
      'apps/subly/lib/state/analytics_providers.dart': `${RECORD_CALL}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n`,
      'apps/subly/lib/features/consent/consent_prompt.dart': UI_CALLER,
      'sites/nikatru/privacy.html': '<p class="updated">Last updated: whenever</p>',
    });
    const { code, out } = run('assert-seams-wired.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /no data-policy-version/);
  });

  // ── [research/44 §7 rung 3] THE PROMO_CARD SEAM, one limb at a time ────────
  //
  // 🔴 THE ONLY SEAM IN THIS FILE WHOSE DEAD STATE AND WHOSE CORRECT STATE ARE
  // THE SAME PIXELS. `features.promo_card_enabled` is absent from every config
  // the portfolio serves and an absent key reads false, so a correctly wired
  // card draws exactly the collapsed `SizedBox.shrink()` that an unmounted, an
  // unwired and a deleted card draw. Nothing about removing any one of these
  // three lines looks wrong from outside, and four capabilities in this repo
  // have already shipped in precisely that state with no test going red.
  //
  // So each half is deleted on its own below. A single case that removed all
  // three would still pass with two of the three needs neutered — which is the
  // shape that let `pack_verifier` certify a verifier nothing constructed.
  test('promo_card — FAILS when the card is no longer MOUNTED in the home body', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-promo-unmounted', { promoMount: '// the mount was deleted\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /the card MOUNTED in the stamped home body NOT FOUND/);
  });

  test('promo_card — FAILS when nothing consults the PromoGate', () => {
    // The mount survives, so the card is still on the screen — it has simply
    // stopped asking whether it may be. The frequency cap, the dismissal latch
    // and the Art 21 objection all come off the path together, and the surface
    // goes on rendering.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-promo-undecided', {
        promoDecide: '// the decision was deleted\n',
        promoMark: '// …and with it the state it returned\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real PromoGate decision on the render path NOT FOUND/);
  });

  test('promo_card — the PRE-RUNG-4 receiver form still counts as a decision', () => {
    // `promoGateProvider).decide(` is what an app stamped before the Art 21
    // objection landed still carries. The need is an alternation over both real
    // shapes, so this case enters the branch the default fixture no longer
    // does — otherwise half the regex would be code no test executes, which is
    // indistinguishable from a typo in it.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-promo-receiver-form', { promoDecide: BRICK_PROMO_DECIDE_RECEIVER }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /a real PromoGate decision on the render path/);
  });

  test('promo_card — FAILS when the impression is never PERSISTED', () => {
    // A cap nobody counts against never caps: the card would reappear on every
    // launch forever, which India's CCPA Dark Patterns Guidelines call Nagging.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-promo-unrecorded', { promoMark: '// the write was deleted\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /the impression persisted, so the frequency cap can ever bind NOT FOUND/);
  });

  // 🔴 AND THE `declares:` FILTER MUST STILL BITE. The need drops the file that
  // DECLARES `Future<void> markShown(` from the candidate set, so a tree whose
  // only `.markShown(` text is the declaration's own body — a method that calls
  // nothing, in the file that defines it — must NOT satisfy the need. Without
  // this case the filter is a line of configuration nothing exercises, and the
  // seam would certify a persistence rail with zero callers: the identical
  // caller-vs-declaration trap this guard already shipped once for
  // `recordAnalyticsConsent`.
  test('promo_card — the markShown DECLARATION alone is not a call site', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-promo-declonly', {
        promoMark: '// no caller anywhere outside the declaring file\n',
        promoDecl:
          '\nFuture<void> markShown(core.PromoGateState d) async {\n' +
          '  await other.markShown(d);\n}\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the impression persisted, so the frequency cap can ever bind NOT FOUND/);
  });

  // ── user_state_reset, one recorded failing case per limb ───────────────────
  // The row has four needs because the seam has four separable halves, and the
  // file's own rule is that every check carries a case that has been watched
  // fail. These four were missing when the row shipped: the row itself was
  // negative-tested against the real tree, but its unit suite was not run at
  // all — and adding the row without adding these fixture strings turned five
  // unrelated cases in this describe red for a reason none of them is about.

  test('user_state_reset — FAILS when the entitlement cache is no longer dropped', () => {
    // The inherited-Pro half. `EntitlementCache` honours a cached answer offline
    // for up to `kEntitlementStalenessCeiling` — seven days — so the next person
    // to sign in on a shared, borrowed or resold device gets the previous one's
    // subscription. Nothing goes red on its own: an uncleared cache and an empty
    // one are the same observation until a SECOND user appears.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-user-state-no-cache-drop', {
        forget: brickForget({ dropCache: '' }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the entitlement cache really dropped on the chassis reset path NOT FOUND/);
    // …and the other three limbs are untouched, or this case would be proving
    // the wrong thing.
    assert.match(out, /ok\s+user_state_reset — the notification schedule really cancelled with it/);
  });

  test('user_state_reset — FAILS when the notification schedule survives the sign-out', () => {
    // The other half of the same drop list: a deleted account went on reminding
    // the device about itself.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-user-state-no-schedule-drop', {
        forget: brickForget({ dropSchedule: '' }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the notification schedule really cancelled with it NOT FOUND/);
    assert.match(out, /ok\s+user_state_reset — the entitlement cache really dropped/);
  });

  test('user_state_reset — FAILS when nothing on a screen reaches the reset', () => {
    // The reset itself is intact here — both drops are present in the spine —
    // and no screen calls it. That is the exact state `EntitlementCache.clear()`
    // shipped in: written, documented ("e.g. on sign-out"), exported and
    // unit-tested, with zero production callers.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-user-state-no-ui-caller', { signOutHandler: '' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a UI caller that ends a session through it NOT FOUND/);
    assert.match(out, /ok\s+user_state_reset — the entitlement cache really dropped/);
  });

  // 🔴 THE CASE THE FOURTH NEED EXISTS FOR, and the one that proves the third
  // need alone is not enough. The tile goes back to the fire-and-forget
  // `signOut()` — the exact defect the increment fixes — and the handler stays
  // where it is, so `signOutAndForgetUser(` is still in a non-declaring file and
  // need (3) goes on printing `ok` over a helper nothing calls.
  test('user_state_reset — FAILS when the CONTROL is reverted to the fire-and-forget call', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-user-state-dead-handler', {
        signOutTile: 'onTap: () => ref.read(authRepositoryProvider).signOut(),\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the sign-out CONTROL routed through that awaited handler NOT FOUND/);
    assert.match(
      out,
      /ok\s+user_state_reset — a UI caller that ends a session through it/,
      'need (3) must still pass here, or this case is not showing why need (4) exists',
    );
  });

  // ── session_end, the EXCLUSIVE TRIGGER ─────────────────────────────────────
  // At-least-one is not the question here; at-most is. Two shipped controls
  // (`reaccept_terms_screen.dart`'s Decline and `verify_email_screen.dart`'s
  // "the only way OUT of the gate") ended a session with a bare `signOut()`
  // while every `user_state_reset` need printed `ok`, because those needs are
  // satisfied by the settings screen alone.
  test('session_end — FAILS when a screen ends a session outside the spine', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-session-end-bypass', {
        homeExtra: 'await ref.read(authRepositoryProvider).signOut();\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /session_end — 1 additional call site\(s\)/);
    assert.match(out, /home_screen\.dart/);
    // The `user_state_reset` row is entirely green in this fixture — which is
    // the point: an at-least-one check cannot see a caller that bypasses the
    // seam, and this is the only limb that can.
    assert.match(out, /ok\s+user_state_reset — the sign-out CONTROL routed through/);
  });

  test('session_end — FAILS when NOTHING ends a session at all', () => {
    // The at-most-one bound is satisfied by zero, which is the most obvious way
    // for a bound like this to stop meaning anything. The spine keeps its
    // `signOutAndForgetUser` declaration and its UI caller, so every
    // `user_state_reset` need still passes and only this clause can notice.
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-session-end-none', {
        forget: brickForget({ spineSignOut: '  // the session is never ended\n' }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /session_end — NOTHING calls it/);
  });

  // The self-check. A guard whose scan silently stops reaching the tree would
  // pass every seam by finding nothing to contradict — the exact failure mode
  // that let check-migrations.mjs report clean over an incomplete set.
  test('FAILS LOUDLY when its own scan stops reaching the app tree', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-coverage', { fillerCount: 0 }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-6 instance 2] The pack-verifier half of assert-seams-wired. Split
// from the consent suite because its two halves have DIFFERENT OWNERS: a missing
// implementation is a build failure, while unpinned production keys are owner
// work (OWNER_QUEUE S-3) that must be reported and must NOT block CI.
describe('assert-seams-wired — pack verifier', () => {
  const REAL_IMPL = `
class Ed25519PackVerifier implements PackVerifier {
  Future<bool> verify({required String keyId, required List<int> message, required List<int> signature}) async {
    final String? encoded = _keys[keyId];
    if (encoded == null) return false;
    return await _ed.verify(message, signature: Signature(signature));
  }
}
`;
  const BARREL = "export 'src/content/ed25519_pack_verifier.dart';\n";
  const keysFile = (entries) =>
    `/// Long doc comment mentioning 'k1' and keys and base64 at length.\nconst Map<String, String> kContentPackPublicKeys = <String, String>{${entries}};\n`;

  const filler = (n) => {
    const out = {};
    for (let i = 0; i < n; i++) out[`apps/subly/lib/f_${i}.dart`] = '// filler\n';
    return out;
  };
  // The OTHER seams must stay satisfied so these tests isolate the verifier —
  // consent, the policy pin, and the crash sink. A fixture that omits one fails
  // for a reason unrelated to what the test is about, which is how a fixture
  // starts lying about the guard it exercises.
  // The crash sink's supplier set is DERIVED from the channel register's lanes
  // since 2026-08-02 ([pipeline 11]E-7), so satisfying it needs the register and
  // both lane workflows — a bare deploy-web.yml no longer answers the question
  // the guard now asks.
  const laneJob = (name) =>
    `  ${name}:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: flutter build --release --dart-define=GLITCHTIP_DSN=\${{ secrets.GLITCHTIP_DSN }}\n`;
  // [pipeline 7]P-9 consumer half · [8]K-9. Since 2026-08-03 `pack_verifier` is
  // `wired: true` with two brick-scoped needs, so the consumer half belongs in
  // this fixture for the same "isolate the verifier" reason as everything else
  // here — without it every test below fails on the consumer, not on the key
  // pinning it is actually about. Kept as two separate strings so the cases at
  // the end can delete each half on its own.
  const PACK_LOADER_CONSTRUCTED =
    'final p = core.ContentPackLoader(verifier: ref.watch(packVerifierProvider));\n';
  const PACK_ASKED_FOR =
    'final r = await ref.watch(contentPackLoaderProvider).load(expectPackId: AppConfig.appId, remote: s);\n';
  const brickProviders = ({ packLoader = PACK_LOADER_CONSTRUCTED, packLoad = PACK_ASKED_FOR } = {}) =>
    "const String kPrivacyPolicyVersion = '2026-07-26';\n" +
    'Future<bool> applyReminderChoice({required bool on}) async {\n' +
    '  await svc.init();\n' +
    '  await svc.scheduleDaily(core.DailyReminder(id: 1));\n' +
    '  return on;\n}\n' +
    // [pipeline 12]W-7b: the review prompt is an EXCLUSIVE trigger — exactly
    // one caller, and "at most one" is satisfied by ZERO, so a fixture with no
    // caller at all fails for a reason unrelated to whatever it is testing.
    'Future<void> maybeAsk() async { await prompter.requestReview(); }\n' +
    // [research/44 §7 rung 3] the promo_card seam's DECLARATION half. It is in
    // this file, not the home body, because that is where the real template
    // declares it — and the `.markShown(` need carries a `declares:` filter, so
    // a fixture that declared it beside the call would model a tree the guard
    // is written to reject.
    'Future<void> markShown(core.PromoGateState decided) async {\n' +
    '  if (!_recordRead) return;\n' +
    '  await kv.write(_promoCardKey, decided.encode());\n}\n' +
    // …and the user_state_reset seam plus the session_end exclusive trigger
    // (2026-08-11), for the same "isolate the verifier" reason as everything
    // else in this file. The trigger has an at-least-one half, so a fixture with
    // no `signOut()` call anywhere fails on a clause these tests are not about.
    'List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[\n' +
    '  ref.read(entitlementCacheProvider).clear,\n' +
    '  ref.read(notificationServiceProvider).cancelAll,\n];\n' +
    'Future<void> forgetSignedInUser(List<UserStateDrop> drops) async {\n' +
    '  for (final UserStateDrop drop in drops) { await drop(); }\n}\n' +
    'Future<void> signOutAndForgetUser(WidgetRef ref) async {\n' +
    '  final core.AuthRepository auth = ref.read(authRepositoryProvider);\n' +
    '  final List<UserStateDrop> drops = userStateDrops(ref);\n' +
    '  await auth.signOut();\n  await forgetSignedInUser(drops);\n}\n' +
    packLoader +
    packLoad;

  const consentOk = {
    'tooling/channel-register.json': JSON.stringify({
      channels: [
        { id: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
        { id: 'android-play', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        { id: 'windows-store', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' } },
        // The fourth lane, from 2026-08-09: submit-snap.yml's `dry-run` job packs
        // a .snap and therefore carries the crash-sink obligation. The guard
        // floors its subject set at what the real register carries, so a fixture
        // one lane short fails on coverage rather than on the verifier these
        // tests are about.
        { id: 'linux-snap', lane: { workflow: '.github/workflows/submit-snap.yml', job: 'dry-run' } },
      ],
    }),
    '.github/workflows/deploy-web.yml': `name: f\njobs:\n${laneJob('deploy-web')}`,
    '.github/workflows/build-platforms.yml':
      `name: f\njobs:\n${laneJob('linux_web_android')}${laneJob('windows')}`,
    '.github/workflows/submit-snap.yml': `name: f\njobs:\n${laneJob('dry-run')}`,
    'apps/subly/lib/main.dart': "final dsn = String.fromEnvironment('GLITCHTIP_DSN');\n",
    // [pipeline 11]E-10 — another seam that must stay satisfied so these tests
    // isolate the verifier rather than failing for an unrelated reason.
    'packages/telemetry/lib/src/telemetry_bootstrap.dart':
      'options.enableAutoSessionTracking = false;\n',
    // 🔴 CARRIES THE PURPOSE-DEFAULT LINE SINCE 2026-08-10, and it is not
    // padding. research/44 rung 4 made the purpose a PARAMETER of
    // `applyConsentDecision` so the Art 21 objection reuses one decision path
    // ([C-3]) instead of forking it, and the consent seam gained a second need
    // in the same commit: not just "a record() call exists" but "the parameter
    // still DEFAULTS to analytics". Without the second, the first is satisfied
    // by a path that records some other purpose entirely. The fixture has to
    // carry the shape the guard now reads, or every test in this family fails
    // on the consent row while claiming to be about the verifier, the review
    // prompt or the pinned keys — which is precisely what happened when this
    // line was one need short.
    'apps/subly/lib/state/analytics_providers.dart':
      "await c.record(core.ConsentPurpose.analytics,\n granted: granted,\n);\nFuture<void> applyConsentDecision({\n  core.ConsentPurpose purpose = core.ConsentPurpose.analytics,\n}) async {}\nFuture<void> recordAnalyticsConsent(\n  WidgetRef ref, {\n  required bool granted,\n}) async {}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n",
    'apps/subly/lib/features/consent/consent_prompt.dart': 'recordAnalyticsConsent(ref, granted: true);',
    'sites/nikatru/privacy.html': '<p data-policy-version="2026-07-26">x</p>',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart': brickProviders(),
    // …and the reminders seam, and the secure-session seam, for the same reason.
    // The sign-out CONTROL and its handler are here too: `user_state_reset`
    // needs (3) and (4) read this file, and need (4) exists because need (3)
    // alone did not fail when the tile was reverted.
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart':
      'onChanged: (bool on) => c.applyReminderChoice(on: on),\n' +
      'onTap: () => _signOut(context, ref, l10n),\n' +
      'Future<void> _signOut(BuildContext context, WidgetRef ref, AppLocalizations l10n) async {\n' +
      '  await signOutAndForgetUser(ref);\n}\n',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart':
      'await initNikatruAuth(url: u, publishableKey: k, secureStore: FlutterSecureStore());\n',
    // …and the ENTITLEMENTS seam ([pipeline 5]M-5, wired 2026-08-01), whose
    // three needs are all scoped to the brick: the fetch, the gate that reads
    // its answer, and the checkout the gate can be got past.
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/money_providers.dart':
      'final x = await ref.watch(entitlementTransportProvider).fetch(\n  appId: AppConfig.appId,\n  accessToken: t,\n);\n',
    // …and the PROMO_CARD seam's other two halves — the mount and the decision —
    // which live in the home body in the real template, next to the paywall gate
    // they sit above. Same "isolate the verifier" reason as everything else in
    // this object: without them every case below fails on a seam these tests are
    // not about.
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/home/home_screen.dart':
      'Widget build(BuildContext c) => PaywallGate(\n  locked: ref.watch(paywallLockedProvider),\n  child: const SizedBox.shrink(),\n);\n' +
      'children: <Widget>[const UpgradePromoCard()],\n' +
      'final d = ref.watch(promoGateProvider).decide(stored, hasContent: o.isNotEmpty);\n' +
      'ref.read(promoCardStateProvider.notifier).markShown(d.state);\n',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/monetization/paywall_screen.dart':
      'final CheckoutStart s = await rail.startCheckout(offering);\n',
  };

  const build = (
    name,
    {
      impl = REAL_IMPL,
      barrel = BARREL,
      keys = keysFile(''),
      packLoader = PACK_LOADER_CONSTRUCTED,
      packLoad = PACK_ASKED_FOR,
    } = {},
  ) =>
    fixture(name, {
      ...filler(14),
      ...consentOk,
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart': brickProviders({
        packLoader,
        packLoad,
      }),
      'packages/core/lib/src/content/ed25519_pack_verifier.dart': impl,
      'packages/core/lib/nikatru_core.dart': barrel,
      'packages/core/lib/src/content/pack_verifier.dart': keys,
    });

  test('passes with a real impl exported, and REPORTS 0 pinned keys', () => {
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('pv-ok') });
    assert.equal(code, 0, 'unpinned production keys must NOT fail the build');
    assert.match(out, /a real PackVerifier implementation exists/);
    assert.match(out, /exported from the core barrel/);
    assert.match(out, /0 production keys pinned/);
    assert.match(out, /OWNER-GATED/);
  });

  test('FAILS when no PackVerifier implementation exists', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noimpl', { impl: '// the impl was deleted\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /declares no PackVerifier implementation/);
  });

  test('FAILS when the verifier is not exported — no app can reach it', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noexport', { barrel: "export 'src/result.dart';\n" }),
    });
    assert.equal(code, 1);
    assert.match(out, /does not export the verifier/);
  });

  // Proves the key count is PARSED out of the map, not grepped from the prose
  // around it. The fixture's doc comment deliberately mentions 'k1' and "keys";
  // a text search would report keys that the map does not contain — the exact
  // bug that made a CORS guard match a comment explaining the absence.
  test('counts pinned keys from the MAP, not the surrounding comment', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-prose', { keys: keysFile('') }),
    });
    assert.equal(code, 0);
    assert.match(out, /0 production keys pinned/);
  });

  test('reports the real count once keys ARE pinned', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-pinned', { keys: keysFile("'k1': 'AAAA', 'k2': 'BBBB'") }),
    });
    assert.equal(code, 0);
    assert.match(out, /2 production key\(s\) pinned/);
  });

  // ── THE CONSUMER HALF, which is the half that was missing for months. ─────
  // A perfect, exported, key-pinned verifier that nothing constructs verifies
  // nothing — the "fail-closed seam with no proven open path" shape. Each half
  // is deleted on its own here, because a single test that removes both would
  // still pass with one of the two `needs` neutered.
  test('FAILS when the loader is never CONSTRUCTED in the stamped chassis', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noloader', { packLoader: '// the construction was deleted\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real ContentPackLoader construction in the stamped chassis NOT FOUND/);
  });

  test('FAILS when nothing ever ASKS the loader for a pack', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noload', { packLoad: '// nothing calls load()\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /something that actually asks the loader for a pack NOT FOUND/);
  });

  // `expectPackId` is the limb that makes the load about THIS app's pack. A
  // signature says who MADE a pack, never which pack it is, so a load without
  // the identity binding accepts any pack the same key ever signed — including
  // one already retired for a rights complaint. Dropping just the named
  // argument leaves a perfectly valid `.load(...)` call behind.
  test('FAILS when the load drops the expectPackId identity binding', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noid', {
        packLoad: 'final r = await ref.watch(contentPackLoaderProvider).load(remote: s);\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /something that actually asks the loader for a pack NOT FOUND/);
  });

  // The anchor must not match the class's own DECLARATION. packages/ is outside
  // SCAN_ROOTS today, but an anchor that would accept a declaration if the scan
  // ever widened is an anchor that has stopped meaning "somebody calls this".
  test('a bare ContentPackLoader declaration is NOT a construction', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-decl-only', {
        packLoader: 'class ContentPackLoader {\n  ContentPackLoader({required this.verifier});\n}\n',
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real ContentPackLoader construction in the stamped chassis NOT FOUND/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-16] assert-stamp-properties — the rule that no chassis requirement
// lands without an assertion the STAMPED APP carries itself. The assertions live
// in the brick template (owner decision) so every app inherits them; this guard
// stops that file quietly vanishing, because vanishing looks exactly like passing.
describe('assert-stamp-properties', () => {
  const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
  const PROP = `${BRICK}/test/chassis_properties_test.dart`;
  const APP = `${BRICK}/lib/app.dart`;
  // The stamped web shell with the device-width viewport the 2026-08-08 anchor
  // demands — matched on the TAG (assert-stamp-properties.mjs WEB_INDEX anchor).
  // Group-scoped: `build` seeds it into the brick and `stampedApp` into each app.
  const BRICK_WEB_INDEX = `${BRICK}/web/index.html`;
  const webIndex = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title></head><body></body></html>\n';

  // Mirrors the real template: four declared properties and >= MIN_BLOCKS blocks.
  // A fixture thinner than the tree it stands for fails for reasons that have
  // nothing to do with the behaviour under test.
  const goodTest = `
group('property: paywall-gate-driven-by-server', () {
  test('m1', () {});
  test('m2', () {});
  testWidgets('m3', (t) async {});
});
group('property: theme-mode-persisted', () {
  test('a', () {});
  test('b', () {});
  test('c', () {});
  test('d', () {});
});
group('property: theme-triplet-supplied', () {
  testWidgets('e', (t) async {});
  test('f', () {});
  test('g', () {});
  test('h', () {});
});
group('property: brand-seed-drives-paint', () {
  test('n', () {});
  testWidgets('o', (t) async {});
  test('p', () {});
});
group('property: locale-actually-switches', () {
  test('gg', () {});
  test('hh', () {});
  testWidgets('ii', (t) async {});
});
group('property: reminder-intent-persisted', () {
  test('cc', () {});
  test('dd', () {});
  test('ee', () {});
  test('ff', () {});
});
group('property: reminders-resync-on-start', () {
  test('xx1', () {
    // [pipeline 13]T-4's RUNTIME limb, mirrored from the real template: the
    // static boot-path walk defers to this count, so the guard checks it is
    // still here and still compares against zero.
    expect(
      notes.requestPermissionCalls,
      0,
      reason: 'the boot path must never spend the OS ask',
    );
  });
  test('xx2', () {});
  test('xx3', () {});
});
// [pipeline T-8] The platform loop is an ANCHOR, not decoration: the guard
// requires the enumeration over TargetPlatform.values, because a hand-written
// list is a list somebody shortens back to Android.
group('property: no-silent-channel', () {
  testWidgets('yy1', (t) async {
    for (final TargetPlatform p in TargetPlatform.values) {
      expect(p, isNotNull);
    }
  });
  testWidgets('yy2', (t) async {});
});
// [13]T-9 The INBOUND half. The push through the fake seam below is an ANCHOR,
// not decoration: the real-classes limb of this property drives the adapter
// directly and stays perfectly green with the gate deleted from app.dart, so
// the limb that pushes a tap through the STAMPED APP ROOT is the only one that
// can tell an app which observes taps from one that merely could.
//
// ⚠️ THE ANCHOR TEXT APPEARS EXACTLY ONCE IN THIS FIXTURE, and that is
// deliberate rather than incidental: this guard reads its anchor sources RAW, so
// a comment that quoted the line would satisfy the anchor by itself — and the
// mutation case that removes it would replace the quote and leave the real call
// standing. Measured: written that way first, the case passed with the limb
// intact. The [pipeline F-10] prose-vs-structure lesson, one level down.
group('property: notification-tap-observed', () {
  test('zz1', () {});
  test('zz2', () {});
  testWidgets('zz3', (t) async {
    notes.taps.add(core.NotificationTap(id: 7, payload: 'reminder'));
    expect(events.sent, isNotEmpty);
  });
});
group('property: account-deletion-works', () {
  test('aa', () {});
  test('bb', () {});
});
group('property: auth-seam-wired', () {
  test('v', () {});
  test('w', () {});
  test('x', () {});
  test('y', () {});
  test('z', () {});
});
group('property: auth-redirect-follows-session', () {
  testWidgets('jj', (t) async {});
  testWidgets('kk', (t) async {});
});
group('property: legal-reacceptance-gated', () {
  testWidgets('lr1', (t) async {});
  testWidgets('lr2', (t) async {});
});
group('property: sessionless-signup-reaches-check-inbox', () {
  testWidgets('ci1', (t) async {});
  testWidgets('ci2', (t) async {});
});
group('property: profile-edit-works', () {
  test('ll', () {});
  test('mm', () {});
  test('nn', () {});
  test('oo', () {});
  testWidgets('pp', (t) async {});
});
group('property: review-prompt-gated', () {
  test('qq', () {});
  test('rr', () {});
  test('ss', () {});
  testWidgets('tt', (t) async {});
});
group('property: onboarding-shown-once', () {
  testWidgets('uu', (t) async {});
  testWidgets('vv', (t) async {});
  test('ww', () {});
});
group('property: ui-invariants-inherited', () {
  testWidgets('q', (t) async {});
  testWidgets('r', (t) async {});
  test('s', () {});
  testWidgets('u', (t) async {});
});
group('property: analytics-consent-gated', () {
  test('i', () {});
  test('j', () {});
  test('k', () {});
});
group('property: analytics-on-switch-mounted', () {
  testWidgets('l', (t) async {});
  test('m', () {});
});
group('property: content-pack-consumed', () {
  test('xx', () {});
  test('yy', () {});
  test('zz', () {});
});
// [pipeline 11]E-5 — the launch TRIO. Two runs, because one launch cannot tell
// a once-per-install flag from one that fires every time.
group('property: analytics-lifecycle-complete', () {
  testWidgets('run1', (t) async {});
  testWidgets('run2', (t) async {});
  test('bucketed', () {});
});
// [pipeline 11]E-6 — the four money events as a SET, not four calls. Nine
// anchors across the paywall, the shared funnel and the provider that puts them
// on the consented rail.
group('property: money-funnel-emitted-as-a-set', () {
  testWidgets('set', (t) async {});
  testWidgets('params', (t) async {});
});
// [research/44 §7 rung 3] — the promo card, whose OFF state and whose DEAD
// state are the same collapsed \`SizedBox.shrink()\`. Three blocks because the
// stamped app has to prove three separate things about itself: mounted and
// zero-height with the flag absent, a real card once it is served, and a
// dismissal that survives a relaunch over the same store.
group('property: promo-card-fails-closed', () {
  testWidgets('off', (t) async {});
  testWidgets('on', (t) async {});
  testWidgets('latched across a relaunch', (t) async {});
});
// [pipeline 10]D-8 — and the URL the update wall opens. \`kProbeUpdateUrl\` is
// parsed by the guard itself: the injected value must differ from every
// channel's compile-time default, or the property below passes with the runtime
// resolution deleted.
const String kProbeUpdateUrl = 'https://update.invalid/from-config';
group('property: update-url-resolved-from-config', () {
  testWidgets('resolved', (t) async {});
  testWidgets('fallback', (t) async {});
  test('empty', () {});
});
group('property: password-recovery-routes', () {
  testWidgets('a recovery arrival routes to the reset screen', (t) async {});
  testWidgets('a dead link lands on the explanation', (t) async {});
  test('an ordinary sign-in is not routed there', () {});
});
`;
  // [pipeline C-11] BOTH themes carry the seed. A fixture with only the light
  // one seeded would agree with the first version of that anchor, which passed
  // while `theme:` had been gutted because `darkTheme:` still matched.
  const goodApp = `
// [pipeline C-13] The review prompt's only call site.
void initState() {
  WidgetsBinding.instance.addPostFrameCallback((_) async {
    await review.recordLaunch();
    await review.maybeAsk();
    // [pipeline T-5/T-7] The reboot/DST repair path. set(false) alone used to
    // leave every schedule armed and there was no re-arm at all, so the anchor
    // is the CALL SITE — the declaration lives in providers.dart.
    await ref.read(remindersEnabledProvider.notifier)
        .resyncOnStart(title: l10n.reminderTitle, body: l10n.reminderBody);
  });
}

// [pipeline 10]D-8 The wall's destination, RESOLVED then wired. The resolution
// and the button are separate anchors because computing a value the button does
// not use reads exactly like a working feature.
final String updateUrl =
    ref.watch(appConfigProvider).valueOrNull?.updateUrl ??
    AppConfig.updateUrl;

return MaterialApp.router(
  theme: buildAppTheme(seed: const Color(0xFF6459F5)),
  darkTheme: buildAppTheme(
    seed: const Color(0xFF6459F5),
    brightness: Brightness.dark,
  ),
  themeMode: ref.watch(themeModeProvider),
  locale: ref.watch(localeProvider),
  builder: (c, child) => MediaQuery.withClampedTextScaling(
    minScaleFactor: 1.0,
    maxScaleFactor: 2.0,
    child: ForceUpdateGate(
      onUpdate: () => _openUpdate(updateUrl),
      child: AnalyticsGate(
        // [13]T-9 The MOUNT. \`class _NotificationTapGate\` would match with the
        // gate deleted from the tree it is supposed to be in — the
        // declaration-vs-caller trap this file keeps encoding — so the anchor is
        // the placement, not the declaration.
        child: _NotificationTapGate(child: child ?? const SizedBox.shrink()),
      ),
    ),
  ),
);

// [pipeline 11]E-5 The launch trio's ONLY call site, inside the consent-gated
// branch. The declaration lives in providers.dart and takes a WidgetRef, so it
// cannot satisfy this anchor — the declaration-vs-caller trap, again.
logLaunchLifecycle(ref);

// [13]T-9 …and the gate must really BUILD the observer over the notification
// seam. A gate that only forwards its child is a mount with nothing behind it:
// it satisfies the anchor above and observes exactly nothing.
class _NotificationTapGateState extends ConsumerState<_NotificationTapGate> {
  Future<void> _observe() async {
    final core.Analytics analytics = await ref.read(analyticsProvider.future);
    final NotificationTapObserver observer = NotificationTapObserver(
      service: ref.read(notificationServiceProvider),
      analytics: analytics,
    );
    _taps = observer;
    observer.start();
  }
}
`;
  // [pipeline C-14] The window-class anchors live in the design system, so the
  // fixture carries that file too — Material's exact 600 boundary and all FIVE
  // classes. 640 is not a Material breakpoint and was the live bug.
  const SCAFFOLD = 'packages/design_system/lib/src/widgets/app_scaffold.dart';
  const goodScaffold = `
class AppBreakpoints {
  static const double medium = 600;
  static const double expanded = 840;
  static const double large = 1200;
  static const double extraLarge = 1600;
}

enum WindowClass { compact, medium, expanded, large, extraLarge }
`;
  // ⚠️ THIS FIXTURE MUST MIRROR THE REAL TEMPLATE, and the reason is not tidiness.
  // It used to be a four-line stub holding only the record() call, which was fine
  // while the guard only looked for that one line. The moment "every" got a
  // tracked DOMAIN, a stub became a fixture that agrees with a broken guard: it
  // declares no providers, so a domain check that matched nothing would have
  // looked green here forever. The real-tree mutations came first (2026-07-28) and
  // this fixture was written afterwards to match what they showed — never the
  // other way round.
  //
  // All 23 chassis behaviours (C-15 added four), plus the two theme-persistence limbs and the
  // consent record() call the property anchors point at.
  // [pipeline 7]P-9 consumer half · [8]K-9 — the CONTENT-PACK rail. Both a
  // property (`content-pack-consumed`, three anchors all in this file) and four
  // rows of COVERED_BY, which the guard reconciles against the tree in BOTH
  // directions: a classified provider that no longer exists is a FAIL, so the
  // fixture has to declare all four by name as well as carry the three anchors.
  //
  // 🔴 `contentPack:` ALONE IS NOT THE ANCHOR — the anchor is a non-null
  // pointer. This value read the literal `null` in the brick and in apps/subly,
  // which is the empty antecedent that made every content-pack check vacuously
  // true, so the fixture models the pointer as well as the plumbing.
  const goodPackRail = `
final core.AppConfig kAppDefaultConfig = core.AppConfig(
  contentPack: 'https://packs.nikatru.com/\${AppConfig.appId}/latest',
);
final Provider<core.PackVerifier> packVerifierProvider =
    Provider<core.PackVerifier>((ref) => core.Ed25519PackVerifier());
final Provider<core.ContentPackSource?> contentPackSourceProvider =
    Provider<core.ContentPackSource?>((ref) => DioContentPackSource(packBaseUrl: p));
final Provider<core.ContentPackLoader> contentPackLoaderProvider =
    Provider<core.ContentPackLoader>(
      (ref) =>
          core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),
    );
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(expectPackId: AppConfig.appId, remote: source);
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });
`;

  const goodProviders = `
final Provider<core.ConfigTransport> configTransportProvider = X();
// [pipeline 2]C-13, 2026-08-06 — the offline banner's input. Present here because
// assert-stamp-properties checks its classification map in BOTH directions: a
// classification for a provider the scan cannot see is a stale claim and fails.
// So a new chassis provider has to arrive in this fixture too, or the guard is
// right and the fixture is lying.
final StateNotifierProvider<X, bool> networkUnreachableProvider = X();
final Provider<core.ConfigLoader> configLoaderProvider = X();
final FutureProvider<core.AppConfig> appConfigProvider = X();
final FutureProvider<String?> packageVersionProvider = X();
final Provider<bool> mustForceUpdateProvider = X();
final FutureProvider<core.KeyValueStore> keyValueStoreProvider = X();
final Provider<core.SecureStore> secureStoreProvider = X();
final FutureProvider<String> installIdProvider = X();
final FutureProvider<core.FeatureFlags> featureFlagsProvider = X();
final Provider<core.NotificationService> notificationServiceProvider = X();
final NotifierProvider<ThemeModeController, ThemeMode> themeModeProvider = X();
final Provider<core.EntitlementCache> entitlementCacheProvider = X();
final Provider<bool> analyticsEnabledProvider = X();
final FutureProvider<core.ConsentController> consentControllerProvider = X();
// [research/44 rung 4], 2026-08-10 — the GPC seam and the two reads of the
// Art 21 objection. Present here for the reason the networkUnreachableProvider
// comment above gives: assert-stamp-properties checks its classification map in
// BOTH directions, so a provider the real chassis carries and this fixture does
// not would make the fixture the thing being tested.
final Provider<core.PrivacySignal> privacySignalProvider = X();
final Provider<bool> promoObjectedProvider = X();
final Provider<bool> promoObjectionKnownProvider = X();
// [ADR 027] / [ADR 065] chassis step 2, 2026-09-04 — the deletion outcome, parked
// above the screen because the screen that asked for it is torn down by the
// sign-out before it can report. Present here for exactly the reason the
// privacySignalProvider comment above gives: assert-stamp-properties checks its
// classification map in BOTH directions, so a provider the real chassis carries
// and this fixture does not is reported as a STALE CLASSIFICATION — which makes
// the fixture, not the tree, the thing being tested. Measured: adding the two to
// COVERED_BY without adding them here failed eleven of this file's own cases.
final StateProvider<core.AccountDeletionOutcome?> lastAccountDeletionOutcomeProvider = X();
final StateProvider<String?> lastAccountDeletionDetailProvider = X();
final Provider<core.ConsentStatus> analyticsConsentProvider = X();
final Provider<bool> consentDecidedProvider = X();
// The legal gate's anchors, and all three are load-bearing for the
// legal-reacceptance-gated property: the controller declaration is what
// persists an acceptance at all, and the refresh listener must name the DERIVED
// provider the redirect reads -- listening to legalAcceptanceProvider
// underneath it re-runs the gate against a value Riverpod has not recomputed
// yet, which is a gate that never fires and never fails a test.
class LegalAcceptanceController extends Notifier<String?> {}
final NotifierProvider<LegalAcceptanceController, String?> legalAcceptanceProvider = X();
final Provider<bool?> legalReacceptanceNeededProvider = X();
final Provider<Listenable> routerRefreshLegalProbe = Provider<Listenable>((ref) {
  ref.listen<bool?>(
    legalReacceptanceNeededProvider,
    (bool? _, bool? __) => bump(),
  );
  return X();
});
final Provider<core.ConsentTransport> consentTransportProvider = X();
final Provider<core.EventTransport> eventTransportProvider = X();
final FutureProvider<core.Analytics> analyticsProvider = X();
final Provider<core.AuthRepository> authRepositoryProvider = Provider<core.AuthRepository>((ref) {
  if (!AppConfig.isBackendLive) return InMemoryAuthRepository();
  return SupabaseAuthRepository(
    requestServerDeletion: () => requestAccountDeletion(ref.read(restClientProvider)),
  );
});
final Provider<Future<String?> Function()> authTokenProvider = X();
final Provider<RestClient> restClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokenProvider: ref.watch(authTokenProvider),
    onUnauthorized: () => signOutOnlyIfSessionIsGone(ref.read(authRepositoryProvider)),
  ),
);

Future<void> signOutOnlyIfSessionIsGone(core.AuthRepository auth) async {
  if (await auth.currentAccessToken() == null) {
    await auth.signOut();
  }
}
final Provider<AuthCapabilities> authCapabilitiesProvider = X();
final Provider<AuthProviders> authProvidersProvider = X();
final Provider<AuthRefreshNotifier> authRefreshProvider = X();
final StreamProvider<core.AuthUser?> authUserProvider = X();
final Provider<core.ReviewPrompter> reviewPrompterProvider = X();
final Provider<core.ReviewGate> reviewGateProvider = X();
final NotifierProvider<ReviewPromptController, core.ReviewGateState> reviewPromptProvider = X();
final NotifierProvider<OnboardingSeenController, bool?> onboardingSeenProvider = X();
final Provider<Listenable> routerRefreshProvider = Provider<Listenable>((ref) {
  return Listenable.merge(<Listenable>[ref.watch(authRefreshProvider), onboarding]);
});

class OnboardingSeenController extends Notifier<bool?> {
  Future<void> set(bool seen) async {
    await kv.write(_onboardingSeenKey, seen ? 'true' : 'false');
  }
}

// [pipeline C-13] The review history plus the decision. The gate refuses on
// almost every launch by design, so a seam with no caller here would be
// invisible for the life of the app.
class ReviewPromptController extends Notifier<core.ReviewGateState> {
  Future<core.ReviewRequestOutcome> maybeAsk({DateTime? now}) async {
    final verdict = ref.read(reviewGateProvider).decide(state, now: now, platformCanAsk: canAsk);
  }
}
final NotifierProvider<RemindersEnabledController, bool> remindersEnabledProvider = X();
final NotifierProvider<LocaleController, Locale?> localeProvider = X();

// [pipeline C-13] The bridge from the auth stream to something GoRouter listens
// to. Without it the redirect never re-runs, so a stamped app signed the user
// in and went on showing them the form they had just completed.
class AuthRefreshNotifier extends ChangeNotifier {
  AuthRefreshNotifier(Stream<core.AuthUser?> changes) {
    _sub = changes.listen((core.AuthUser? _) => notifyListeners());
  }
}

class LocaleController extends Notifier<Locale?> {
  Future<void> set(Locale? locale) async {
    await kv.write(_localeKey, locale?.languageCode ?? '');
  }
}

class RemindersEnabledController extends Notifier<bool> {
  Future<void> _hydrate() async {
    final bool stored = (await kv.read(_remindersKey)) == 'true';
  }
  Future<void> set(bool on) async {
    await kv.write(_remindersKey, on ? 'true' : 'false');
    // [pipeline T-5] OFF is a promise about the OS, not about a boolean. With
    // the cancel only in applyReminderChoice, a settings sync or a restore left
    // every schedule armed behind a switch reading OFF.
    if (!on) await _cancelSchedules();
  }
  // 🔴 THE HALF THAT WAS MISSING UNTIL 2026-08-01. Persisting the flag was
  // always right and was never the feature; without these two lines the toggle
  // spends the one OS permission prompt and schedules nothing.
  Future<bool> applyReminderChoice({required bool on, required String title, required String body}) async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    await svc.init();
    // [pipeline 13]T-4 limb C — THE BRICK'S ENABLE-PATH ASK, mirrored from the
    // real template (providers.dart, applyReminderChoice). It is here and not in
    // main.dart because that is the whole property: reached from the switch, not
    // from the launch path. Without this line the fixture models a template whose
    // notification channel can never be turned on.
    final bool granted = await svc.requestPermission();
    await svc.scheduleDaily(core.DailyReminder(id: kDailyReminderId, title: title, body: body, hour: 20, minute: 0));
    return on && granted;
  }
  // [pipeline T-7] The reboot / DST / timezone-change repair path.
  Future<void> resyncOnStart({required String title, required String body}) async {
    await ref.read(notificationServiceProvider).init();
  }
}

// [pipeline T-8] The in-app catch-up nudge's persisted dismissal.
class CatchUpNudgeController extends Notifier<DateTime?> {
  Future<void> markShown(DateTime at) async {
    await kv.write(_lastNudgeShownKey, at.toUtc().toIso8601String());
  }
}
final NotifierProvider<CatchUpNudgeController, DateTime?> catchUpNudgeProvider = X();

// [research/44 §7 rung 3] The promo card's PURE governor and its persisted
// record. Both are in the fixture by name because this guard reconciles its
// classification map against the tree in BOTH directions — a classified
// provider the scan cannot see is a stale claim and fails — and because the
// domain floor moved with them.
final Provider<core.PromoGate> promoGateProvider = X();

// 🔴 THE TWO LINES BELOW ARE THE PROPERTY, NOT PLUMBING, and both were found by
// mutating the real tree rather than by reading it. Without the first, a
// dismissal or a GDPR Art 21 objection that arrived from storage while an
// impression was in flight is written straight back out as
// \`"suppressed":false\` — the objection erased from disk in one launch. Without
// the second, a record we FAILED to read is overwritten by an impression
// counter, which is the least important thing on that key destroying the most
// important one.
class PromoCardController extends AsyncNotifier<core.PromoGateState> {
  Future<void> markShown(core.PromoGateState decided) async {
    if (!_recordRead) return;
    final core.PromoGateState current = state.valueOrNull ?? decided;
    if (current.dismissed || current.suppressed) return;
    await kv.write(_promoCardKey, decided.encode());
  }

  Future<void> dismiss() async {
    if (!_recordRead) return;
    await kv.write(_promoCardKey, state.requireValue.dismissedNow().encode());
  }
}
final AsyncNotifierProvider<PromoCardController, core.PromoGateState>
    promoCardStateProvider = X();

class ThemeModeController extends Notifier<ThemeMode> {
  Future<void> _hydrate() async {
    final stored = _decode(await kv.read(_themeModeKey));
  }
  Future<void> set(ThemeMode mode) async {
    await kv.write(_themeModeKey, _encode(mode));
  }
}

final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
  );
};

// [pipeline 11]E-5 The chassis builds the SHARED trio over the SAME storage
// seam every other persisted chassis value uses — no app acquires a dependency
// to be measured, and there is one implementation for fifty stamps.
Future<void> logLaunchLifecycle(WidgetRef ref) async {
  final core.Analytics analytics = await ref.read(analyticsProvider.future);
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  await core.AnalyticsLifecycle(analytics: analytics, store: kv).onLaunch();
}

// [pipeline C-15] password-recovery-routes. The reason a reset link is not an
// ordinary sign-in exists ONLY at delivery, so it is held, and it is released
// on sign-out alone.
class PasswordRecoveryController extends Notifier<bool> {
  @override
  bool build() {
    ref.listen(authEventsProvider, (_, AsyncValue<core.AuthEvent> next) {
      final core.AuthEvent? event = next.valueOrNull;
      if (event == null) return;
      if (event.startsPasswordRecovery) state = true;
      if (event.kind == core.AuthEventKind.signedOut) { state = false; }
    });
    return false;
  }
}

class PasswordResetArrivalController extends Notifier<core.PasswordResetArrivalReport> {
  @override
  core.PasswordResetArrivalReport build() =>
      passwordResetArrivalOf(ref.watch(launchUriProvider));
}

// Overridable so the failure path is drivable at all: on a test VM the real
// launch URL is never a reset arrival.
final Provider<Uri> launchUriProvider = Provider<Uri>((ref) => Uri.base);

final NotifierProvider<PasswordRecoveryController, bool> passwordRecoveryProvider =
    NotifierProvider<PasswordRecoveryController, bool>(PasswordRecoveryController.new);
final NotifierProvider<PasswordResetArrivalController, core.PasswordResetArrivalReport>
    passwordResetArrivalProvider =
    NotifierProvider<PasswordResetArrivalController, core.PasswordResetArrivalReport>(
        PasswordResetArrivalController.new);

// The refresh signal lives HERE, with the other router signals, not in the
// router: the recovery event arrives while the user sits still, so nothing
// navigates and the redirect guard would never be consulted at all.
final Listenable routerRefreshRecovery = (WidgetRef ref) {
  ref.listen<bool>(passwordRecoveryProvider, (bool? _, bool __) {});
};
`;
  const BRICK_PROVIDERS =
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';

  // [pipeline C-11] The brand property also anchors into the design system, so
  // the fixture has to carry that file too — the tokens must be DERIVED from the
  // scheme, not const, or every stamp shares one gradient and one ramp.
  // [pipeline C-15] The session must land in the SECURE store — the Supabase
  // SDK defaults to plaintext shared_preferences for the access AND refresh
  // tokens, so this anchor is the one that keeps G-43 true.
  const AUTH_BARREL = 'packages/auth_supabase/lib/nikatru_auth_supabase.dart';
  // [pipeline C-15] password-recovery-routes anchors two sources in the ADAPTER,
  // not the brick: the seam maps `AuthState` down to `AuthUser?`, so the reason
  // an arrival is a recovery exists only here, at delivery. `handleError` is the
  // failure half — a failed exchange re-emits through the stream, and an
  // unhandled stream error is a fatal crash rather than a message to anybody
  // (GlitchTip SUBLY-8).
  const AUTH_ADAPTER = 'packages/auth_supabase/lib/src/supabase_auth_repository.dart';
  const goodAuthAdapter = `
core.AuthEvent _event(sb.AuthState s) => switch (s.event) {
  sb.AuthChangeEvent.passwordRecovery => core.AuthEventKind.passwordRecovery,
  _ => core.AuthEventKind.signedIn,
};

Stream<core.AuthEvent> authEvents() => _auth.onAuthStateChange.map(_event).transform(
      StreamTransformer<core.AuthEvent, core.AuthEvent>.fromHandlers(
        handleData: (e, sink) => sink.add(e),
        handleError: (Object error, StackTrace stack, EventSink<core.AuthEvent> sink) =>
            sink.add(core.AuthEvent(core.AuthEventKind.recoveryLinkFailed, null)),
      ),
    );
`;
  const goodAuthBarrel = `
Future<void> initNikatruAuth() async {
  await sb.Supabase.initialize(
    authOptions: sb.FlutterAuthClientOptions(
      localStorage: SecureSessionStorage(store: secureStore),
    ),
  );
}
`;

  // [pipeline C-13] The delete button used to be `Navigator.pop` and nothing
  // else, which looks exactly like a button that worked. The fixture carries a
  // working one so the mutation cases below have something real to break.
  const SETTINGS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart';
  const goodSettings = `
void _confirmDelete(BuildContext context, WidgetRef ref, AppLocalizations l10n) {
  showDialog<void>(
    context: context,
    builder: (c) => _DeleteAccountDialog(
      onConfirm: () => _deleteAccount(dialogContext, ref, l10n, password.text),
    ),
  );
}

final caps = NotificationCapabilities.forPlatform(defaultTargetPlatform, isWeb: kIsWeb);

// The switch must reach the path that SCHEDULES, not merely the persisted flag.
onChanged: (bool on) => ref.read(remindersEnabledProvider.notifier).applyReminderChoice(
  on: on,
  title: l10n.reminderTitle,
  body: l10n.reminderBody,
),

// [pipeline C-13] The profile editor. The tile watches the identity STREAM:
// a currentUser snapshot compiles, renders, and never rebuilds, so a saved
// name goes on showing the old value.
final user = ref.watch(authUserProvider).valueOrNull;

void _editProfile(BuildContext context, WidgetRef ref, AppLocalizations l10n, core.AuthUser user) {
  showDialog<void>(
    context: context,
    builder: (dialogContext) => _EditProfileDialog(
      onSave: () => _saveProfile(dialogContext, ref, l10n, name.text),
    ),
  );
}

Future<void> _saveProfile(...) async {
  await ref.read(authRepositoryProvider).updateProfile(displayName: displayName.trim());
}

Future<void> _deleteAccount(...) async {
  await auth.signInWithEmail(email: email, password: password);
  await auth.deleteAccount();
}

// [ADR 027] And the failure path must say WHICH refusal it was: a catch(_)
// printing one string tells a user whose data is already gone (502) that
// nothing happened.
messenger.showSnackBar(SnackBar(content: Text(
  deleteAccountFailureMessage(l10n, core.accountDeletionOutcomeOf(e)),
)));
`;

  // [pipeline C-13] A SECOND locale must exist. With one language file the
  // i18n seam can never be exercised — the state the chassis was in while
  // claiming internationalisation.
  const ARB_TA = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/l10n/app_ta.arb';
  const goodArbTa = '{\n  "@@locale": "ta",\n  "settingsTitle": "x"\n}\n';

  // 🔴 THE CALL SITE. Every anchor above lives in a file that DECLARES
  // something; this one is about who calls it. `initNikatruAuth` had zero
  // callers tree-wide while the property printed `ok`, so the stamped app both
  // died at launch on an uninitialised `Supabase.instance` and — in the one app
  // that did initialise — wrote its refresh token in plaintext.
  const BRICK_MAIN = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart';
  // [13]T-9 THE SINGLE-INSTANCE OVERRIDE, and it is in main.dart because that is
  // the only place early enough. `init()` is what registers the plugin's tap
  // callback, and taps arrive on THAT instance's own stream — so the default
  // provider body (`createLocalNotificationService()`) builds a second,
  // uninitialised adapter whose `notificationTaps()` is silent for the life of
  // the process. Nothing about that looks wrong: it compiles, it schedules, and
  // every outbound test stays green.
  const goodMain = `
Future<void> main() async {
  await TelemetryBootstrap.init(config, appRunner: () async {
    AppErrorScreen.install();
    final core.NotificationService notifications =
        createLocalNotificationService();
    await notifications.init();
    if (AppConfig.isBackendLive) {
      await initNikatruAuth(
        url: AppConfig.supabaseUrl,
        publishableKey: AppConfig.supabaseAnonKey,
        secureStore: FlutterSecureStore(),
      );
    }
    runApp(
      ProviderScope(
        overrides: <Override>[
          notificationServiceProvider.overrideWithValue(notifications),
        ],
        child: const ProbeApp(),
      ),
    );
  });
}
`;

  // [13]T-9 THE SUBSCRIPTION ITSELF — one file, and the whole inbound half.
  //
  // 🔴 THE GAP THIS FIXTURE STANDS FOR. The tap loop was wired into apps/subly
  // and nowhere else, so the template carried the entire OUTBOUND rail (schedule,
  // re-arm on boot, cancel, the platform matrix, the toggle) with NO subscriber
  // to `notificationTaps()` anywhere. Every stamped app could wake a user at
  // 09:00 and learn nothing when they tapped it — and nothing went red, because
  // a tap delivered to no listener is indistinguishable from no tap at all.
  //
  // BOTH lines are anchors: the `listen(` is the wire, and `kEvent` is the
  // taxonomy NAME. An observer that subscribes and then logs an app-invented
  // event name is a rail that collects rows no funnel is built on.
  const TAP_OBSERVER = `${BRICK}/lib/state/notification_tap_observer.dart`;
  const goodTapObserver = `
class NotificationTapObserver {
  static const String kEvent = 'notification_opened';

  void start() {
    if (_sub != null) return;
    _sub = _service.notificationTaps().listen(
      (core.NotificationTap tap) => _log(tap.kind),
      onError: (Object _) {},
      cancelOnError: false,
    );
  }

  Future<void> _log(String kind) async {
    await _analytics.log(kEvent, params: <String, Object?>{'kind': kind});
  }
}
`;

  // The SERVER half of G2. The client hook can be wired perfectly and the
  // deletion still be a lie: this route used to purge the app's rows and the
  // user's entitlements and leave the identity record alone, so the same
  // password still logged in afterwards.
  const ACCOUNT_ROUTE =
    'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/account.ts';
  const goodAccountRoute = `
account.delete('/', async (c) => {
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return c.json({ error: 'account_deletion_unconfigured' }, 501);
  const identityRes = await fetch(
    \`\${c.env.SUPABASE_URL}/auth/v1/admin/users/\${encodeURIComponent(userId)}\`,
    { method: 'DELETE', headers: { apikey: serviceRoleKey } },
  );
  if (!identityRes.ok && identityRes.status !== 404) return c.json({ error: 'identity_delete_failed' }, 502);
  return c.json({ ok: true, deleted });
});
`;

  // [pipeline C-13] The auth SEAM itself. The profile screen was refused on the
  // grounds that "there is no profile data model"; this method is the model, so
  // the property is anchored to its declaration and not only to the screen.
  const CORE_AUTH = 'packages/core/lib/src/auth/auth_repository.dart';
  const goodCoreAuth = `
abstract class AuthRepository {
  Future<AuthUser> updateProfile({required String displayName});
  Future<void> deleteAccount();
}
`;

  // [pipeline C-13] The router. `redirect:` was present the entire time the app
  // was unusable, so a fixture carrying only the guard would agree with a broken
  // check — the refresh signal is the limb that was missing.
  const ROUTER = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/router.dart';
  // The sign-up door, and the THIRD anchor of
  // `sessionless-signup-reaches-check-inbox`. App-relative for the same reason
  // as the paywall and the tap observer: the screen is stamped INTO each app,
  // so any one app can drop the no-session branch — and strand every new
  // registrant it serves — without touching the brick.
  //
  // ⚠️ THE `currentUser == null` TEST IS THE WHOLE POINT and the fixture carries
  // it verbatim. Navigating unconditionally races the redirect guard for the
  // session case, and not navigating at all is the stranding the property
  // exists to close; a fixture that merely mentioned `/check-inbox` would agree
  // with both of those broken shapes.
  const SIGN_UP = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_up_screen.dart';
  const goodSignUp = `
Future<void> _submit() async {
  final AuthUser? auth = await ref.read(authRepositoryProvider).signUp(email, password);
  if (!mounted) return;
  if (auth.currentUser == null) {
    context.go('/check-inbox', extra: email);
    return;
  }
}
`;
  // [pipeline C-13] The carousel. Its copy must fall back to the l10n string,
  // never to the key — AppConfig.text() returns the key itself when unset.
  const ONBOARDING = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/firstrun/onboarding_screen.dart';
  const goodOnboarding = `
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});
}

final pages = [
  (title: _copy(cfg, 'onboarding.1.title', l10n.onboarding1Title), body: x),
];
`;
  const goodRouter = `
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: ref.watch(routerRefreshProvider),
    routes: <RouteBase>[
      GoRoute(path: '/check-inbox', builder: (c, s) => const CheckInboxScreen()),
    ],
    redirect: (BuildContext context, GoRouterState state) {
      if (!onboarded) {
        return state.matchedLocation == '/onboarding' ? null : '/onboarding';
      }
      final bool signedOutMayStay =
          onAuthScreen ||
          state.matchedLocation == '/check-inbox' ||
          state.matchedLocation == '/reaccept-terms';
      if (!signedIn && !signedOutMayStay) return '/sign-in';
      final bool? mustReaccept = signedIn
          ? ref.read(legalReacceptanceNeededProvider)
          : false;
      if (mustReaccept == null) return null;
      if (mustReaccept) {
        return state.matchedLocation == '/reaccept-terms'
            ? null
            : '/reaccept-terms';
      }
      // [pipeline C-15] password-recovery-routes. The recovery event arrives
      // while the user sits still, so the gate is told rather than waited for.
      ref.listen<bool>(passwordRecoveryProvider, (_, __) {});
      if (ref.read(passwordRecoveryProvider) ||
          ref.read(passwordResetArrivalProvider).arrival !=
              core.PasswordResetArrival.none) {
        return state.matchedLocation == '/reset-password'
            ? null
            : '/reset-password';
      }
      return null;
    },
  );
});
`;

  // [pipeline 5]M-13's SECOND providers file, and the two anchors the money
  // property is fixed to outside it. The domain scan reads BOTH providers
  // files since 2026-08-01 — a fixture with only the first one would fail here
  // for a reason unrelated to whatever each test is about.
  const MONEY_PROVIDERS = `${BRICK}/lib/state/money_providers.dart`;
  const goodMoneyProviders = `
final Provider<RailConfig> railConfigProvider = X();
final Provider<core.EntitlementTransport> entitlementTransportProvider = X();
final Provider<core.CancellationTransport> cancellationTransportProvider = X();
final Provider<PurchaseRail> purchaseRailProvider = X();
final Provider<EntitlementConvergence> entitlementConvergenceProvider = X();
// [pipeline 11]E-6 The funnel rides the SAME recorder as every other event. A
// funnel handed its own Analytics emits four correct events belonging to nobody.
final FutureProvider<MoneyFunnel> moneyFunnelProvider =
    FutureProvider<MoneyFunnel>(
      (ref) async => MoneyFunnel(await ref.watch(analyticsProvider.future)),
    );
final FutureProvider<core.Entitlements> entitlementsProvider =
    FutureProvider<core.Entitlements>((ref) async {
      final core.Result<core.Entitlements> fresh = await ref
          .watch(entitlementTransportProvider)
          .fetch(appId: AppConfig.appId, accessToken: t);
      await cache.saveVerified(server);
      return server;
    });
final Provider<bool> paywallLockedProvider = X();
`;
  const HOME = `${BRICK}/lib/features/home/home_screen.dart`;
  // [pipeline T-8] The nudge is anchored to its MOUNT and to the shared
  // predicate: a widget declared and never placed is the dead-control shape, and
  // on Web/Windows/Linux it is the only delivery mechanism there is.
  const goodHome = `
Widget build(BuildContext context) => Column(
  children: <Widget>[
    const CatchUpNudgeBanner(),
    const UpgradePromoCard(),
    Expanded(child: PaywallGate(
      locked: ref.watch(paywallLockedProvider),
      child: const SizedBox.shrink(),
    )),
  ],
);

// [research/44 §7 rung 3] THE PROMO CARD, and every line below is an anchor
// rather than scenery. Its off state and its dead state are pixel-identical, so
// each limb was found by MUTATING THE REAL TREE and watching both suites stay
// green: the paid-user check, the hydration barrier and the record-read latch
// all survived deletion with all 18 surface rows and all 7 property rows
// passing. The mount above and these six lines are what a stamped app has to
// carry for this surface to be tellable-apart from a deleted one.
class _UpgradePromoCardState extends ConsumerState<UpgradePromoCard> {
  Widget build(BuildContext context) {
    final core.PromoGateState? stored =
        ref.watch(promoCardStateProvider).valueOrNull;
    // 🔴 THE HYDRATION BARRIER, anchored on the NULL TEST and not on
    // \`valueOrNull\`: \`?? const PromoGateState()\` also contains \`valueOrNull\`
    // and is precisely the mutation that puts the card in front of a user whose
    // Art 21 objection has not been read off disk yet.
    if (stored == null) return const SizedBox.shrink();
    if (stored.dismissed || stored.suppressed) return const SizedBox.shrink();
    // A user who has already paid is not promoted to.
    if ((cfg?.paywall.enabled ?? false) && !ref.watch(paywallLockedProvider)) {
      return const SizedBox.shrink();
    }
    final core.PromoGateDecision decision = ref
        .watch(promoGateProvider)
        .decide(
          stored,
          now: (widget.clock ?? DateTime.now)(),
          featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
          hasContent: offerings.isNotEmpty,
        );
    if (!decision.show) return const SizedBox.shrink();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(promoCardStateProvider.notifier).markShown(decision.state);
    });
    return PromoCard(
      // ROSCA parity: the cancel entry rides on the SAME surface as the offer.
      onManageAction: () => context.go('/manage-plan'),
      onBuyAction: () => context.go('/paywall'),
    );
  }
}

class CatchUpNudgeBanner extends ConsumerWidget {
  Widget build(BuildContext context, WidgetRef ref) {
    final core.CatchUpNudgeVerdict verdict = const core.CatchUpNudge().decide(
      now: now,
      lastShownAt: ref.watch(catchUpNudgeProvider),
      reminderHour: AppConfig.reminderHour,
      reminderMinute: AppConfig.reminderMinute,
      remindersEnabled: ref.watch(remindersEnabledProvider),
      platformCanSchedule: caps.canSchedule,
    );
    return const SizedBox.shrink();
  }
}
`;
  const CORE_CACHE = 'packages/core/lib/src/entitlement_cache.dart';
  const goodCoreCache = 'const Duration kEntitlementStalenessCeiling = Duration(days: 7);\n';

  // [pipeline 11]E-5 · THE LAUNCH TRIO LIVES IN A SHARED TREE, and that is the
  // requirement rather than a tidiness preference: `first_launch` and
  // `return_visit` used to live in apps/subly's own funnel, so every stamped app
  // emitted `app_open` and nothing else — 1 of 3 — while the lane went green.
  // The fixture carries all three names so the mutation cases below can remove
  // one at a time.
  const CORE_LIFECYCLE = 'packages/core/lib/src/analytics/analytics_lifecycle.dart';
  const goodCoreLifecycle = `
class AnalyticsLifecycle {
  Future<void> onLaunch() async {
    if (isFirst) {
      await _analytics.log('first_launch');
      await _store.write(kFirstLaunchEmittedKey, '1');
    }
    await _analytics.log('app_open');
    if (!isFirst && last != null) {
      await _analytics.log(
        'return_visit',
        params: <String, Object?>{'days_since_last': bucketDaysSinceLast(n)},
      );
    }
  }
}
`;

  const THEME_X = 'packages/design_system/lib/src/theme/app_theme_x.dart';
  const goodThemeX = `
class AppThemeX extends ThemeExtension<AppThemeX> {
  factory AppThemeX.fromScheme(ColorScheme scheme, {Brightness brightness = Brightness.light}) {
    return AppThemeX(muted: scheme.onSurfaceVariant);
  }
}
`;

  // 🔴 [pipeline N-4 clause 7] THE FIXTURE MUST CARRY A WORKSPACE BLOCK, because
  // the guard's domain is no longer "the brick" — it is the brick PLUS every
  // non-exempt `apps/*` member of the root pubspec's `workspace:` list. A stamped
  // app could previously delete its own inherited property test with one `rm` and
  // every guard in the tree stayed green, so the guard now reads `apps/` too and
  // refuses to run at all when that list is unreadable (an unreadable list would
  // silently shrink the domain back to the brick alone, which is the whole hole).
  //
  // The default here lists only `apps/subly` — exempt by name under 39-CHASSIS §4
  // cut 1 — so these cases still exercise exactly the brick-only path they were
  // written for, and the per-app path is exercised by the stamped-app cases below.
  const WORKSPACE = 'pubspec.yaml';
  const goodWorkspace = 'name: nikatru_workspace\nworkspace:\n  - packages/core\n  - apps/subly\n';

  // ── [pipeline 13]T-4 · THE BOOT PATH NEVER SPENDS THE OS PERMISSION ASK ────
  //
  // The shared adapter that actually asks the OS. The guard points its pattern
  // at this file on every run to prove the pattern still RECOGNISES an ask — a
  // regex that has gone stale reports every app's launch path clean forever, and
  // an absence assertion whose scanner has gone blind is indistinguishable from
  // compliance.
  const PERMISSION_PROBE = 'packages/notifications/lib/src/local_notification_service_io.dart';
  const goodPermissionProbe = `
class LocalNotificationService {
  Future<bool> requestPermission() async {
    return (await ios.requestPermissions(alert: true, badge: true, sound: true)) ?? false;
  }
}
`;
  // An app that ships. The workspace above lists apps/subly, which is EXEMPT
  // from carrying the inherited property test and deliberately NOT exempt from
  // this: the exempt app is the one that shipped the defect.
  const SUBLY_MAIN = 'apps/subly/lib/main.dart';
  const SUBLY_NOTIFS = 'apps/subly/lib/services/notifications/notification_service.dart';
  const goodSublyMain = `
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.instance.init();
  runApp(const ProviderScope(child: SublyApp()));
}
`;
  // \`init()\` and \`requestPermissions()\` SEPARATE, which is the whole property.
  // The declaration of the ask lives here in the passing fixture too — a guard
  // that fired on the declaration rather than on a reachable call site would be
  // red on this input, which is the mistake assert-seams-wired.mjs already made.
  const goodSublyNotifs = `
class NotificationService {
  Future<void> init() async {
    await _plugin.initialize(settings);
    _ready = true;
  }

  Future<bool> requestPermissions() async {
    if (!_ready) return false;
    return (await ios.requestPermissions(alert: true, badge: true, sound: true)) ?? false;
  }

  Future<void> toggleReminders(bool on) async {
    if (on) await requestPermissions();
  }
}
`;

  // ── [pipeline 8]K-6 · THE IN-APP LEGAL SET vs THE PUBLISHED LEGAL SET ──────
  //
  // 🔴 The defect: the brick declared TWO legal URLs, the site publishes FOUR,
  // and nothing compared the lists — so every stamped app shipped without the
  // refund policy, the page a store reviewer opens first on a disputed charge.
  // The guard now reconciles them in BOTH directions plus "a constant is not a
  // link", so the fixture needs three artefacts: the published list, the
  // chassis constants, and the settings screen that opens them.
  //
  // The published list is PARSED off the `LEGAL_PAGES` declaration, never
  // grepped, so this fixture deliberately carries prose naming `pricing.html`
  // and `refund.html` OUTSIDE the array — a text search would "find" both and
  // report a set that does not exist. That is the recorded [pipeline F-10]
  // lesson, and the case below turns it into a failing input.
  const SITE_INTEGRITY = 'tooling/ci/check-site-integrity.mjs';
  const legalPages = (pages) =>
    `// Prose that names pricing.html and refund.html while explaining that\n` +
    `// pricing.html is deliberately NOT one of the LEGAL_PAGES below.\n` +
    `const LEGAL_PAGES = [${pages.map((p) => `'${p}'`).join(', ')}];\n`;
  const goodSiteIntegrity = legalPages(['privacy.html', 'terms.html', 'refund.html', 'delete-account.html']);

  // Only `nikatru.com/<page>.html` constants count as legal links. `companyUrl`
  // is the site root and `apiBaseUrl` is not a page at all — both are in the
  // fixture so the parser has to discriminate rather than match any URL.
  const APP_CONFIG = `${BRICK}/lib/core/app_config.dart`;
  // [pipeline 10]D-8 also parses `updateUrl` out of this file — and follows the
  // IDENTIFIER, so `defaultValue: companyUrl` is compared as the URL it really
  // is rather than as the word "companyUrl". The fixture keeps that indirection
  // because the real template has it, and a fixture that inlined the literal
  // would agree with a guard that never resolved the name.
  const goodAppConfig = `
class AppConfig {
  static const String companyUrl = 'https://nikatru.com';
  static const String apiBaseUrl = 'https://api.nikatru.com';
  static const String privacyUrl = 'https://nikatru.com/privacy';
  static const String termsUrl = 'https://nikatru.com/terms';
  static const String refundUrl = 'https://nikatru.com/refund';
  static const String updateUrl = String.fromEnvironment(
    'UPDATE_URL',
    defaultValue: companyUrl,
  );
}
`;

  // ── [pipeline 11]E-6 · the funnel's three files ───────────────────────────
  // The CALL SITES and the NAMES are deliberately in different fixtures: the
  // screen can call a funnel that logs nothing, and the package can emit perfect
  // names nobody calls, and each looks healthy from the other's file.
  const PAYWALL = `${BRICK}/lib/features/monetization/paywall_screen.dart`;
  const goodPaywall = `
void initState() {
  WidgetsBinding.instance.addPostFrameCallback((_) async {
    final MoneyFunnel funnel = await ref.read(moneyFunnelProvider.future);
    await funnel.onPaywallViewed(widget.trigger.code);
  });
}

Future<void> _buy(Offering offering) async {
  await funnel.onCheckoutStarted(offering.productId);
  if (start is CheckoutRefused) {
    await funnel.onPurchaseFailed(start.reason.name);
    return;
  }
  if (result.isUnlocked) {
    await funnel.onPurchaseSuccess(offering.productId);
  }
}
`;
  const MONEY_FUNNEL = 'packages/purchases/lib/src/money_funnel.dart';
  const goodMoneyFunnel = `
class MoneyFunnel {
  Future<void> onPaywallViewed(String trigger) =>
      _log('paywall_viewed', <String, Object?>{'trigger': trigger});
  Future<void> onCheckoutStarted(String sku) =>
      _log('checkout_started', <String, Object?>{'sku': sku});
  Future<void> onPurchaseSuccess(String sku) =>
      _log('purchase_success', <String, Object?>{'sku': sku});
  Future<void> onPurchaseFailed(String reason) =>
      _log('purchase_failed', <String, Object?>{'reason': reason});
}
`;

  // ── [pipeline 10]D-8 · the server halves ──────────────────────────────────
  // The wire contract, and the registry that serves it. The config fixture
  // carries PROSE naming a URL identical to the compiled-in default outside the
  // registry — a text search would "find" it and fail on a comment, which is the
  // recorded [pipeline F-10] lesson and is a failing input below.
  const PLATFORM_TYPES = 'services/platform/src/types.ts';
  const goodPlatformTypes = `
export interface AppConfig {
  /** Where the force-update wall sends users. See config.ts for why it is null. */
  update_url: string | null;
}
`;
  // [pipeline 4]B-2 — THE REGISTRY MOVED, AND SO DID THIS FIXTURE. It used to be
  // `services/platform/src/config.ts` holding an object literal `DEFAULT_CONFIGS`,
  // which is what assert-stamp-properties.mjs sliced with a regex. The served set
  // is DATA now — WHICH apps from the public catalogue the stamp writes, WHAT each
  // is served from the value document — so the guard `JSON.parse`s both and this
  // fixture is the pair.
  //
  // 🔴 THE PROSE TRAP IS KEPT, DELIBERATELY. `_readme` names a URL identical to
  // the compiled-in default while explaining that `update_url` is NOT that value.
  // A text search would "find" it and fail on a comment — the recorded
  // [pipeline F-10] lesson — and there is a passing case below that proves it
  // does not, which is only true because the guard reads parsed structure.
  const PLATFORM_CATALOGUE = 'catalog/apps.json';
  const goodPlatformCatalogue = JSON.stringify([
    { slug: 'subly', name: 'Subly', api: 'https://api.nikatru.com', platforms: ['web'], status: 'live' },
  ]);
  const PLATFORM_CONFIG_DATA = 'services/platform/src/app-config-data.json';
  const platformConfigData = (updateUrl = null) =>
    JSON.stringify({
      _readme: [
        'Prose that names https://nikatru.com while explaining why update_url is NOT that value.',
      ],
      sharedApiBaseUrl: 'https://platform.nikatru.com/v1',
      defaults: { min_supported_version: '1.0.0', update_url: updateUrl },
      apps: { subly: {} },
    });
  const goodPlatformConfigData = platformConfigData();
  // The channel set the comparison ranges over. Two rows with a lane and one
  // without, because a null lane is the common case in the real register and
  // must fall back to the template's default rather than be skipped.
  //
  // 🔴 THE ROWS CARRY `kind` / `served` / `deferral` SINCE 2026-08-07, and that is
  // not tidying. The guard's null-tolerance is now DERIVED from those three fields
  // (see assert-stamp-properties.mjs limb (2a)), so a fixture that omitted them
  // was a fixture in which the coupling could not be exercised at all — the shape
  // that lets a check pass over a question it never asked. The default row set
  // mirrors the real register's convention: the served `web` row carries no
  // deferral, every non-web row carries one.
  const CHANNEL_REGISTER = 'tooling/channel-register.json';
  const channelRegister = (appimage = { kind: 'direct', served: false, deferral: { reason: '[ADR 015] §2' } }) =>
    JSON.stringify({
      channels: [
        { id: 'web', kind: 'web', served: true, lane: { workflow: '.github/workflows/deploy-web.yml' } },
        {
          id: 'windows-store',
          kind: 'store',
          served: false,
          deferral: { reason: '39-CHASSIS §4 cut 5' },
          lane: { workflow: '.github/workflows/build-platforms.yml' },
        },
        { id: 'linux-appimage', lane: null, ...appimage },
      ],
    });
  const goodChannelRegister = channelRegister();
  // …and the LEGAL section that actually opens them. A declared constant no
  // screen links leaves the page exactly as unreachable as never declaring it,
  // while making the set equality above go green.
  const goodLegalLinks = `
onTap: () => _openUrl(AppConfig.privacyUrl),
onTap: () => _openUrl(AppConfig.termsUrl),
onTap: () => _openUrl(AppConfig.refundUrl),
`;

  const build = (name, { propTest = goodTest, app = goodApp, providers = goodProviders, packRail = goodPackRail, themeX = goodThemeX, scaffold = goodScaffold, authBarrel = goodAuthBarrel, authAdapter = goodAuthAdapter, settings = goodSettings, router = goodRouter, signUp = goodSignUp, onboarding = goodOnboarding, coreAuth = goodCoreAuth, arbTa = goodArbTa, brickMain = goodMain, tapObserver = goodTapObserver, accountRoute = goodAccountRoute, moneyProviders = goodMoneyProviders, home = goodHome, coreCache = goodCoreCache, coreLifecycle = goodCoreLifecycle, workspace = goodWorkspace, appConfig = goodAppConfig, siteIntegrity = goodSiteIntegrity, legalLinks = goodLegalLinks, permissionProbe = goodPermissionProbe, sublyMain = goodSublyMain, sublyNotifs = goodSublyNotifs, paywall = goodPaywall, moneyFunnel = goodMoneyFunnel, platformTypes = goodPlatformTypes, platformCatalogue = goodPlatformCatalogue, platformConfigData = goodPlatformConfigData, channelRegister = goodChannelRegister, extra = {}, omitArbTa = false, omitProp = false, omitTapObserver = false } = {}) => {
    // The pack rail is APPENDED rather than folded into `goodProviders` so the
    // many cases that replace `providers` wholesale keep satisfying it — and so
    // the cases that are ABOUT the pack rail can drop it on its own.
    const files = { [APP]: app, [BRICK_WEB_INDEX]: webIndex, [BRICK_PROVIDERS]: providers + packRail, [THEME_X]: themeX, [SCAFFOLD]: scaffold, [AUTH_BARREL]: authBarrel, [AUTH_ADAPTER]: authAdapter, [SETTINGS]: settings + legalLinks, [ROUTER]: router, [SIGN_UP]: signUp, [ONBOARDING]: onboarding, [CORE_AUTH]: coreAuth, [BRICK_MAIN]: brickMain, [ACCOUNT_ROUTE]: accountRoute, [MONEY_PROVIDERS]: moneyProviders, [HOME]: home, [CORE_CACHE]: coreCache, [CORE_LIFECYCLE]: coreLifecycle, [WORKSPACE]: workspace, [APP_CONFIG]: appConfig, [SITE_INTEGRITY]: siteIntegrity, [PERMISSION_PROBE]: permissionProbe, [SUBLY_MAIN]: sublyMain, [SUBLY_NOTIFS]: sublyNotifs, [PAYWALL]: paywall, [MONEY_FUNNEL]: moneyFunnel, [PLATFORM_TYPES]: platformTypes, [PLATFORM_CATALOGUE]: platformCatalogue, [PLATFORM_CONFIG_DATA]: platformConfigData, [CHANNEL_REGISTER]: channelRegister, ...extra };
    if (!omitArbTa) files[ARB_TA] = arbTa;
    if (!omitProp) files[PROP] = propTest;
    // [13]T-9 Omittable on its own, because "the observer file is not there at
    // all" is a DIFFERENT input from "it is there and no longer subscribes" —
    // the guard reports the first as an unreadable anchor and the second as a
    // missing implementation, and only one case each proves both messages exist.
    if (!omitTapObserver) files[TAP_OBSERVER] = tapObserver;
    return fixture(name, files);
  };

  // ── brand-seed-drives-paint LIMB (c) · THE THIRD LINK OF A THREE-LINK CHAIN ──
  //
  // The three original anchors assert the seed reaches both themes and that
  // `AppThemeX.fromScheme` derives tokens from the scheme. All three were TRUE on
  // the real tree while NOTHING SHIPPED READ THE TOKENS BACK OUT — measured
  // 2026-08-21: 0 of 159 Dart files across 10 lib trees call
  // `.extension<AppThemeX>()`, so the visible colour came from hardcoded
  // `AppColors.*` and the stamp seed moved nothing a clone detector can see.
  // A guard named for the whole chain was green on two links of it.
  //
  // Limb (c) MEASURES the third link and PRINTS — it must never fail, because
  // resolving it is a brand-vs-seed judgement only the owner can make, and
  // failing would block CI on owner work [CLAUDE.md C-6].
  //
  // Case (c) below is the one that matters: the real `apps/subly/lib` carries
  // FOUR mentions of `extension<AppThemeX>` and ZERO calls, because every one of
  // them sits in a doc comment ARGUING the code deliberately does not read it.
  // A limb that grepped would have reported 4 and called the chain live.

  test('limb (c) PRINTS the dead third link and does not fail the build', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
    assert.equal(code, 0, 'an owner-gated gap prints; it must not block CI');
    assert.match(out, /brand-seed-drives-paint limb \(c\): ZERO of/);
  });

  test('limb (c) counts a REAL read, and reports it as live', () => {
    // Uses the STAMPED-APP fixture, not `build('sp-ok')`: the latter creates no
    // `apps/*/lib` tree at all, so the limb would have nothing to scan and would
    // report ZERO for the wrong reason — a green assertion measuring an absence.
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-reads-x', {
        workspace: WS_WITH_PROBE,
        extra: stampedApp('apps/probe', {
          home: goodHome + '\nfinal x = Theme.of(context).extension<AppThemeX>()!.muted;\n',
        }),
      }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /brand-seed limb \(c\) — \d+ of \d+ shipped lib file\(s\)/);
  });

  test('🔴 limb (c) counts CALLS, not mentions — a doc comment is still ZERO', () => {
    // The case that separates a measurement from a grep, and the shape the REAL
    // apps/subly/lib is in today: four mentions of `extension<AppThemeX>`, every
    // one inside a doc comment ARGUING the code deliberately does not read it,
    // and zero calls. A limb that grepped would have reported 4 and called the
    // chain live.
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-mentions-x', {
        workspace: WS_WITH_PROBE,
        extra: stampedApp('apps/probe', {
          home: goodHome + '\n/// `Theme.of(context).extension<AppThemeX>()` is NOT read here, on purpose.\n',
        }),
      }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /brand-seed-drives-paint limb \(c\): ZERO of/);
  });

  test('passes when both properties are asserted and implemented', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
    assert.equal(code, 0);
    assert.match(out, /theme-mode-persisted' asserted/);
    assert.match(out, /theme-triplet-supplied' asserted and implemented/);
    assert.match(out, /analytics-consent-gated' asserted and implemented/);
    assert.match(out, /analytics-on-switch-mounted' asserted and implemented/);
    assert.match(out, /analytics-lifecycle-complete' asserted and implemented/);
  });

  // ── [pipeline 11]E-5 · THE LAUNCH TRIO. Five anchors in three files, and each
  // case below removes exactly one — because any one of them alone leaves the
  // other four looking perfectly healthy while a stamped app emits less than the
  // taxonomy requires. The real-tree mutations came first; these encode them.
  test('FAILS when the launch call site is deleted from app.dart', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-lifecycle-uncalled', { app: goodApp.replace('logLaunchLifecycle(ref);', '') }),
    });
    assert.equal(code, 1);
    assert.match(out, /'analytics-lifecycle-complete' is asserted but its IMPLEMENTATION is gone/);
    assert.match(out, /lib\/app\.dart/);
  });

  // The regression that made this key necessary: app_open alone, which is
  // exactly the state a stamped app shipped in while the lane reported green.
  test('FAILS when core stops emitting first_launch', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-lifecycle-no-first', {
        coreLifecycle: goodCoreLifecycle.replace("log('first_launch')", "log('app_open')"),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the denominator every activation and retention ratio is divided by/);
  });

  test('FAILS when core stops emitting return_visit', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-lifecycle-no-return', {
        coreLifecycle: goodCoreLifecycle.replace("'return_visit',", "'engaged',"),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the D1\/D7\/D30 curve cannot be drawn at all/);
  });

  // 🔴 THE FORK CASE. An app that re-implements the trio inline satisfies the
  // call site and the event names would still be findable somewhere — but the
  // shared construction is what makes it ONE implementation for fifty stamps,
  // which is the sentence the requirement is made of.
  test('FAILS when the chassis stops building the SHARED lifecycle', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-lifecycle-forked', {
        providers: goodProviders.replace('core.AnalyticsLifecycle(', '_MyOwnPrivateFunnel('),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /re-implementing the trio per app is the fork this requirement exists to prevent/);
  });

  test('FAILS when the property group itself is dropped', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-lifecycle-unasserted', {
        propTest: goodTest.replace('analytics-lifecycle-complete', 'analytics-lifecycle-ish'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /'analytics-lifecycle-complete' is NOT asserted/);
  });

  // ── [pipeline 11]E-6 · THE FUNNEL AS A SET ─────────────────────────────────
  //
  // Every case below was FIRST run as a mutation of the REAL tree against a
  // freshly stamped `apps/probe`, with `flutter analyze` clean before each run
  // so a compile error could not be mistaken for a catch. The recorded results:
  //   · deleting `await funnel.onCheckoutStarted(...)` from the brick's paywall
  //     → `flutter test` red on the set assertion (`{paywall_viewed,
  //     purchase_failed, purchase_success}` is not the four), and this guard red
  //     on the call-site anchor.
  //   · making `AnalyticsRecorder.sessionId` mint a fresh uuid on every read —
  //     four individually correct events under four session ids — → the set
  //     assertion still passed and the SESSION assertion went red, which is the
  //     whole distinction this requirement is about.
  test('FAILS when the paywall drops one stage of the funnel', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-funnel-stage', {
        paywall: goodPaywall.replace('funnel.onCheckoutStarted(', 'debugPrint('),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the drop-off between seeing a price and trying to pay is invisible/);
  });

  // A RENAMED EVENT IS A SILENTLY EMPTY COLUMN, never an error: the app keeps
  // logging, the sink keeps accepting, and one row of the funnel is simply
  // always zero.
  test('FAILS when the shared funnel renames an event', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-funnel-rename', {
        moneyFunnel: goodMoneyFunnel.replace("'purchase_success'", "'purchase_ok'"),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the shared funnel must emit 'purchase_success'/);
  });

  // THE JOIN. A funnel built over its own recorder emits four perfectly correct
  // events under a second session and a second anon id — the failure this
  // property exists for, and the one that looks healthiest from every other file.
  test('FAILS when the funnel is built off the consented recorder', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-funnel-join', {
        moneyProviders: goodMoneyProviders.replace(
          'MoneyFunnel(await ref.watch(analyticsProvider.future))',
          'MoneyFunnel(core.AnalyticsRecorder(anonId: uuidV4()))',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a second one mints a second session and a second anon id/);
  });

  // ── [pipeline 10]D-8 · THE UPDATE DESTINATION ──────────────────────────────
  //
  // Real-tree mutations first, `flutter analyze` clean each time:
  //   · `final String updateUrl = AppConfig.updateUrl;` in the brick's app.dart
  //     — the compile-time default, wired to the button → `flutter test` red
  //     (`https://nikatru.com` where the served value was expected) and this
  //     guard red on the resolution anchor.
  //   · `update_url: 'https://nikatru.com'` in services/platform/src/config.ts
  //     — a served value identical to the fallback → limb (c) red on all eight
  //     channels, `flutter test` still green, which is the point of limb (c).
  test('FAILS when the wall stops resolving the url at runtime', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-compiled', {
        app: goodApp.replace(
          'ref.watch(appConfigProvider).valueOrNull?.updateUrl ??\n    AppConfig.updateUrl',
          'AppConfig.updateUrl',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /dropping the runtime half restores the circular kill-switch/);
  });

  // The resolution can be perfect and unused. Computing a value the button does
  // not open reads exactly like a working feature in review.
  test('FAILS when the button is wired to the compile-time default', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-button', {
        app: goodApp.replace('_openUpdate(updateUrl)', '_openUpdate(AppConfig.updateUrl)'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /wiring it to AppConfig\.updateUrl leaves the resolution above computed and unused/);
  });

  test('FAILS when the wire contract stops carrying update_url', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-wire', {
        platformTypes: goodPlatformTypes.replace('update_url: string | null;', 'legacy_url?: string;'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /there is nothing for the client to resolve/);
  });

  // ── limb (c). The two ways a resolved URL becomes indistinguishable from the
  //    fallback, and neither can be caught by the widget test itself.
  test('limb (c) FAILS when a served update_url equals the compiled-in default', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-same', { platformConfigData: platformConfigData('https://nikatru.com') }),
    });
    assert.equal(code, 1);
    assert.match(out, /which is EXACTLY what a 'web' build already compiles in/);
    // Every channel, not the first one that matched.
    assert.match(out, /a 'linux-appimage' build already compiles in/);
  });

  test('limb (c) FAILS when the probe injects the compile-time default', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-probe-same', {
        propTest: goodTest.replace(
          "kProbeUpdateUrl = 'https://update.invalid/from-config'",
          "kProbeUpdateUrl = 'https://nikatru.com'",
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /would then pass with the runtime resolution deleted/);
  });

  test('limb (c) FAILS when the probe constant is deleted outright', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-probe-gone', {
        propTest: goodTest.replace('const String kProbeUpdateUrl', 'const String kSomethingElse'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /declares no `kProbeUpdateUrl`/);
  });

  // 🔴 A CHANNEL'S OWN DEFINE COUNTS. A release lane can compile a different
  // destination into its artifact, so "the compile-time default" has one answer
  // per channel — and a check against the template's alone would pass while a
  // channel's build made the two indistinguishable.
  test('limb (c) reads the UPDATE_URL a release lane compiles in', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-lane-define', {
        platformConfigData: platformConfigData('https://dl.nikatru.com/win'),
        extra: {
          '.github/workflows/build-platforms.yml':
            '# a comment naming --dart-define=UPDATE_URL=https://commented.invalid is not a stamp\n' +
            'jobs:\n  b:\n    steps:\n      - run: flutter build windows --dart-define=UPDATE_URL=https://dl.nikatru.com/win\n',
        },
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a 'windows-store' build already compiles in/);
    // …and NOT the web channel, whose lane stamps no UPDATE_URL and therefore
    // still falls back to the template's default.
    assert.doesNotMatch(out, /a 'web' build already compiles in/);
  });

  // COVERAGE SELF-CHECK. A served set that parses as empty makes every
  // comparison above vacuously true — the failure this whole file is about.
  test('limb (c) refuses a served set it cannot parse', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-noreg', { platformCatalogue: '[]' }),
    });
    assert.equal(code, 1);
    assert.match(out, /parsed 0 app\(s\) out of catalog\/apps\.json/);
  });

  test('limb (c) refuses a value document with no `defaults`', () => {
    // [pipeline 4]B-2. An app with no entry of its own resolves to `defaults`,
    // so without it NO app's served update_url can be resolved — and "resolved
    // to nothing" must not read as "resolved to null", which is a real value
    // this limb treats as compliant.
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-nodefaults', {
        platformConfigData: JSON.stringify({ sharedApiBaseUrl: 'x', apps: { subly: {} } }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /has no `defaults`/);
  });

  test('limb (c) PASSES when the value document is prose-trapped but structurally clean', () => {
    // 🔴 THE F-10 LESSON, still live after the registry moved. `_readme` names
    // `https://nikatru.com` — byte-identical to the web channel's compiled-in
    // default — while `update_url` is null. A text search fails here and calls a
    // comment a violation; a parse does not. The guard reads parsed structure,
    // so this is the passing case, and it is the reason the trap stays in the
    // fixture rather than being tidied out of it.
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-d8-prose') });
    assert.doesNotMatch(out, /already compiles in/);
    assert.equal(code, 0, out);
  });

  test('limb (c) refuses an unparseable compile-time default', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-nodefault', {
        appConfig: goodAppConfig.replace("'UPDATE_URL',", "'UPDATE_URL_V2',"),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /could not parse the compile-time default/);
  });

  // 🔴 PROSE IS NOT A VALUE — [pipeline F-10]'s recorded lesson. The good config
  // fixture NAMES `https://nikatru.com` in a comment while serving null; a text
  // search would call that a violation, and the guard must not.
  test('limb (c) does not fire on a comment naming the default url', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-d8-prose') });
    assert.equal(code, 0);
    assert.match(out, /\[10\]D-8 update destination: 3 channel\(s\) × 1 served app\(s\)/);
    assert.match(out, /1 app\(s\) serve null/);
  });

  // ── limb (2a) · NULL IS TOLERATED BY THE REGISTER, NOT BY A SENTENCE ────────
  //
  // 🔴 WHAT WAS WRONG, MEASURED ON THE REAL TREE BEFORE THESE CASES EXISTED. The
  // passing line printed "…which is the recorded state while no non-store channel
  // is served" while NOTHING derived that clause: `nullServed` was counted,
  // printed, and compared against nothing. Flipping `linux-appimage` to
  // `"served": true, "deferral": null` in the real tooling/channel-register.json,
  // with services/platform/src/app-config-data.json untouched at
  // `defaults.update_url: null`, left the guard at EXIT 0 reprinting that exact
  // sentence about a tree that had just falsified it. Restored byte-identical
  // (md5 9a57515477aa830d1eae9b81df322f97) and re-run green before the fix landed.
  //
  // The fixture cases below encode that mutation; the real-tree run came first,
  // because a fixture its own author wrote encodes the same misunderstanding as
  // the guard its own author wrote — assert-seams-wired.mjs shipped broken with
  // all six of its fixture tests passing.
  test('limb (2a) FAILS when a SERVED non-web channel is served a null update_url', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-live-null', {
        channelRegister: channelRegister({ kind: 'direct', served: true, deferral: null }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /an update_url of null while/);
    // The row is NAMED, with the two fields the decision was made on. A failure
    // that says "some channel" sends the reader back to the register to guess.
    assert.match(out, /linux-appimage \(kind=direct, served=true, deferral=none\)/);
  });

  // A DEFERRAL IS THE ONLY THING TOLERATING THE NULL, so deleting the key must
  // not be the cheap way out. `deferral: null` and no `deferral` key are the same
  // claim — nothing holds this channel back — and the register's own convention
  // is that the served row is the one without one.
  test('limb (2a) FAILS when a non-web channel declares no deferral at all', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-nodeferral', {
        channelRegister: channelRegister({ kind: 'direct', served: false }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /linux-appimage \(kind=direct, served=false, deferral=none\)/);
  });

  // THE CONTROL, and it is the whole reason this limb is a coupling rather than a
  // ban on null: the recorded state — every non-web row deferred — must stay
  // green, and the passing line must PRINT the derived number it is tolerating on.
  test('limb (2a) tolerates a null update_url while every non-web channel is deferred', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-d8-prose') });
    assert.equal(code, 0, out);
    assert.match(out, /1 app\(s\) serve null, 0 live non-web channel\(s\)/);
    assert.doesNotMatch(out, /an update_url of null while/);
  });

  // WIDER THAN "AppImage", ON PURPOSE. A served STORE row with a null destination
  // fails too — the force-update wall is compiled into that build as well, and
  // with null served it opens the company home page instead of the listing.
  test('limb (2a) fires on a served STORE row too, not only a direct one', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-d8-live-store', {
        channelRegister: JSON.stringify({
          channels: [
            { id: 'web', kind: 'web', served: true, lane: null },
            { id: 'android-play', kind: 'store', served: true, deferral: null, lane: null },
          ],
        }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /android-play \(kind=store, served=true, deferral=none\)/);
  });

  // ── [13]T-9 · A NOTIFICATION TAP IS OBSERVABLE END TO END ──────────────────
  //
  // THE SENTENCE: *"A stamped app records `notification_opened` when a user taps
  // one of its reminders."* The observation that makes it FALSE: tapping a
  // reminder on a freshly stamped app records nothing, ever.
  //
  // 🔴 WHAT THIS PROPERTY IS A RESPONSE TO. The tap loop was wired into
  // apps/subly and STOPPED THERE. The template carried the entire outbound rail
  // — schedule, re-arm on boot, cancel, the platform matrix, the settings toggle
  // — and had no subscriber to `notificationTaps()` anywhere, so app #2 through
  // #50 were born able to wake a user at 09:00 and unable to notice they
  // answered. Nothing went red, because a tap delivered to no listener is
  // indistinguishable from no tap at all.
  //
  // ⚠️ AND `assert-capability-register.mjs` COULD NOT SAY SO: its emitter for
  // that surface is pinned to `apps/subly/lib/state/analytics_funnel.dart` — a
  // real file with a real caller — so the register stayed green about a
  // capability the template did not have. A guard pointed at one app cannot
  // answer a question about the factory. That is why every anchor here is
  // APP-RELATIVE and re-checked for each stamped root.
  //
  // Every case below was FIRST run as a mutation of a REAL app stamped from the
  // edited brick (`flutter analyze` clean on each — no case is a compile error
  // masquerading as a catch), and the split is the point:
  //   · gate UNMOUNTED in app.dart        → 13 of 14 tests still PASS. The
  //     real-classes limb drives the adapter directly and cannot see it.
  //   · `observer.start()` deleted        → same 13/14. Same reason.
  //   · event name drifted to
  //     `notification_tapped`             → 5/14, both limbs red.
  // The first two are exactly why the `notes.taps.add(` anchor exists: without
  // the stamped-app limb, a template whose gate is missing has a fully green
  // property test.
  test('passes when the tap loop is mounted, wired and named', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-t9-ok') });
    assert.equal(code, 0, out);
    assert.match(out, /notification-tap-observed' asserted and implemented \(6 anchors\)/);
  });

  test('FAILS when the tap gate is declared but never MOUNTED', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-unmounted', {
        app: goodApp.replace(
          'child: _NotificationTapGate(child: child ?? const SizedBox.shrink()),',
          'child: child ?? const SizedBox.shrink(),',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /'notification-tap-observed' is asserted but its IMPLEMENTATION is gone/);
    assert.match(out, /must MOUNT the tap gate/);
  });

  // The gate is mounted and forwards its child — a wrapper that observes
  // nothing. It satisfies the mount anchor above perfectly.
  test('FAILS when the mounted gate never CONSTRUCTS the observer', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-hollow-gate', {
        app: goodApp.replace('service: ref.read(notificationServiceProvider),', ''),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /a gate that only forwards its child is a mount with nothing behind it/);
  });

  // 🔴 THE FAMILY THE WHOLE PROPERTY IS NAMED AFTER: an observer subscribed to a
  // stream that is not the seam's. It compiles, it listens, it is silent for the
  // life of the process — the same shape as `main.dart` handing the tree a
  // second, uninitialised adapter.
  test('FAILS when the observer subscribes to something other than the seam', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-wrong-stream', {
        tapObserver: goodTapObserver.replace(
          '_service.notificationTaps().listen(',
          '_ownTaps.stream.listen(',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the observer must SUBSCRIBE/);
  });

  test('FAILS when the emitted event name drifts off the taxonomy', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-event-name', {
        tapObserver: goodTapObserver.replace(
          "kEvent = 'notification_opened'",
          "kEvent = 'notification_tapped'",
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /must be `notification_opened`/);
  });

  // main.dart's override is the difference between the tree holding the adapter
  // that registered with the OS and the tree holding a fresh one whose stream is
  // silent forever. NOTHING at runtime distinguishes them.
  test('FAILS when main.dart drops the single-instance override', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-no-override', {
        brickMain: goodMain.replace(
          'notificationServiceProvider.overrideWithValue(notifications),',
          '',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /must hand the tree the adapter it INITIALISED/);
  });

  // The property test reduced to its unit chain. This is the mutation that
  // matters most, because it is the one a green `flutter test` cannot see: with
  // the stamped-app limb gone, deleting the gate from app.dart leaves the whole
  // property passing.
  test('FAILS when the property drops its stamped-app limb', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-unit-only', {
        propTest: goodTest.replace('notes.taps.add(', 'plugin.simulateTap('),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /must push a tap through the STAMPED APP ROOT/);
  });

  test('FAILS when the observer file is not there at all', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-no-observer', { omitTapObserver: true }),
    });
    assert.equal(code, 1);
    assert.match(out, /property 'notification-tap-observed': .*notification_tap_observer\.dart could not be read/);
  });

  // (The per-app limb of this property lives with the other stamped-app cases
  // below, where `stampedApp` and `WS_WITH_PROBE` are defined.)

  // ── [pipeline 13]T-4 · THE BOOT PATH NEVER SPENDS THE OS PERMISSION ASK ────
  //
  // THE SENTENCE: *"Notification permission is never requested on the launch
  // path."* The observation that makes it FALSE: booting the app issues an OS
  // permission request with no user action.
  //
  // Every case below was FIRST run as a mutation of the REAL tree, because a
  // fixture the guard's author also wrote encodes the same misunderstanding as
  // the guard. The recorded real-tree results, `flutter analyze` clean each time
  // (21 info, 0 errors — identical to baseline, so no case is a compile error
  // masquerading as a catch):
  //   · apps/subly SHIPPED the violation. The very first run of this limb was
  //     red on the untouched tree: `main() → init() → _requestPermissions()`.
  //   · a direct `await NotificationService.instance.requestPermissions();` in
  //     apps/subly/lib/main.dart          → red at `main()`.
  //   · the ask moved into ScanScreen's `initState`  → red at limb B.
  //   · the brick's runtime count weakened from `0` to `greaterThanOrEqualTo(0)`
  //     — a mutation `flutter test` stays GREEN on → red at the runtime anchor.
  test('passes when init() and the permission ask are separate', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-t4-ok') });
    assert.equal(code, 0);
    assert.match(out, /\[13\]T-4 apps\/subly — launch path asks for no OS permission/);
    // The EXEMPT app is covered. That exemption is about the inherited property
    // test, and it cannot excuse an app from the boot path — it is the one that
    // shipped the defect.
    assert.match(out, /boot-path walk covered 2 app root\(s\)/);
  });

  test('FAILS when main() itself asks for permission', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-main-asks', {
        sublyMain: goodSublyMain.replace(
          'await NotificationService.instance.init();',
          'await NotificationService.instance.init();\n  await NotificationService.instance.requestPermissions();',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /THE LAUNCH PATH SPENDS THE OS PERMISSION ASK — main\(\)/);
    assert.match(out, /apps\/subly\/lib\/main\.dart/);
  });

  // 🔴 THE ONE THAT ACTUALLY SHIPPED, and the reason a one-file scan of
  // main.dart would not have been enough: the ask is two hops away, in a file
  // main.dart only names through a method call.
  test('FAILS when the ask is TRANSITIVELY reachable from main()', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-transitive', {
        sublyNotifs: goodSublyNotifs.replace(
          'await _plugin.initialize(settings);',
          'await _plugin.initialize(settings);\n    await requestPermissions();',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /main\(\) → init\(\)/);
  });

  // Limb B. `initState` has no call site anywhere — the framework calls it — so
  // limb A cannot see it, and "moved into an initState" is the named way this
  // property regresses without main.dart changing at all.
  test('FAILS when the ask sits in an ungestured lifecycle hook', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-initstate', {
        extra: {
          'apps/subly/lib/features/scan/scan_screen.dart':
            'class _S extends State<S> {\n  @override\n  void initState() {\n    super.initState();\n    NotificationService.instance.requestPermissions();\n  }\n}\n',
        },
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /initState\(\) \[first frame, no gesture\]/);
  });

  // The BARRIER. Everything in an app is transitively reachable from `runApp`,
  // so a walk that descended through the widget tree would call every gesture
  // handler "launch path" and be useless. Constructors stop the walk — and this
  // input proves the stop is real rather than asserted.
  test('passes when the ask is behind a gesture handler in the widget tree', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-gesture', {
        extra: {
          'apps/subly/lib/features/settings/toggle.dart':
            'class ReminderTile extends StatelessWidget {\n  Widget build(BuildContext c) => SwitchListTile(\n    onChanged: (bool on) => _onToggle(on),\n  );\n  Future<void> _onToggle(bool on) async {\n    if (on) await NotificationService.instance.requestPermissions();\n  }\n}\n',
        },
      }),
    });
    assert.equal(code, 0);
    assert.match(out, /\[13\]T-4 apps\/subly — launch path asks for no OS permission/);
  });

  // A guard that has stopped seeing an OS ask reports every app clean forever,
  // and that is indistinguishable from compliance. The pattern is pointed at the
  // real adapter on every run so a plugin rename reddens the build.
  test('FAILS when the permission pattern no longer matches the real adapter', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-blind-regex', {
        permissionProbe: goodPermissionProbe.replace(/requestPermissions?/g, 'askTheUserNicely'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /the \[13\]T-4 permission pattern no longer matches any call/);
  });

  // The RUNTIME limb this static walk defers to. Weakening the matcher leaves
  // `flutter test` green — the classic gate-weakening move — so the guard
  // compares against the literal zero, not merely the identifier's presence.
  test('FAILS when the brick stops counting the boot-path asks', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-runtime-limb-weakened', {
        propTest: goodTest.replace(
          'notes.requestPermissionCalls,\n      0,',
          'notes.requestPermissionCalls,\n      greaterThanOrEqualTo(0),',
        ),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /no longer asserts `requestPermissionCalls == 0` after a boot/);
  });

  // ── limb C · THE ENABLE PATH ASKS AT ALL ───────────────────────────────────
  //
  // Added 2026-08-07. Everything above is an ABSENCE assertion, so deleting
  // every call site made this property report GREENER than the real tree while
  // restoring the defect from the other side: a notification channel that can
  // never be enabled, because nothing ever asks.
  //
  // Real-tree mutations, run BEFORE these fixtures existed (a fixture the
  // guard's author also wrote encodes the same misunderstanding as the guard),
  // `flutter analyze` 21 issues / 0 errors on each — identical to baseline, so
  // no case below is a compile error masquerading as a catch:
  //   · baseline: apps/subly 2 call site(s) — settings_controller.dart:139,
  //     subscriptions_controller.dart:104; brick 1 — providers.dart:1045.
  //   · BOTH real call sites replaced with `.init()` → limb C red at apps/subly,
  //     while limb A/B printed the SAME `ok` line as baseline ("2 function(s)
  //     reached from main() across 45 lib file(s); initState/… clean") and the
  //     runtime `requestPermissionCalls == 0` limb also stayed ok. 2 → 0 asks,
  //     every pre-existing limb green: the hole, measured.
  //   · that same tree + `unawaited(NotificationService.instance
  //     .requestPermissions())` in ScanScreen's real `initState` → limb B AND
  //     limb C both red. One call site, satisfying NEITHER half. That is the
  //     disjointness of D⁻ and D⁺ demonstrated on the real tree, and it is
  //     exactly the input a naive "the symbol appears somewhere" positive check
  //     would have called compliant.
  test('passes when an ask exists on the enable path, and names the call sites', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-t4-enable-ok') });
    assert.equal(code, 0);
    // Both roots, not just the stamped one: the brick's ask lives in
    // applyReminderChoice, the app's in a controller the walk never reaches.
    assert.match(out, /apps\/subly — the enable path asks: 1 call site\(s\)/);
    assert.match(out, /\{\{app_id\}\} — the enable path asks: 1 call site\(s\)/);
  });

  // 🔴 THE ONE THIS LIMB EXISTS FOR, and the one every other limb goes GREENER
  // on: the call site is gone and the app still reads clean everywhere else.
  //
  // The fixture deliberately KEEPS `Future<bool> requestPermissions() async {
  // … ios.requestPermissions(…) }` — so the symbol still occurs THREE times
  // under lib/ with nothing calling it. A positive check written as "the symbol
  // appears somewhere" is green on this input; so is one that forgot to strip
  // the declaration, which is the recorded assert-seams-wired.mjs defect.
  test('FAILS when the enable-path call site is deleted but the declaration stays', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-enable-deleted', {
        sublyNotifs: goodSublyNotifs.replace('if (on) await requestPermissions();', 'if (on) await init();'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /apps\/subly: THE ENABLE PATH NEVER ASKS/);
    // The proof that the two halves point opposite ways: the same input leaves
    // the launch-path limb printing ok.
    assert.match(out, /\[13\]T-4 apps\/subly — launch path asks for no OS permission/);
  });

  // DISJOINTNESS. Exactly ONE ask in the app, sitting in an ungestured hook. It
  // must satisfy NEITHER limb — "never at launch" and "somewhere on the enable
  // path" cannot both be paid for by the same call site.
  test('FAILS on BOTH limbs when the only ask sits in an ungestured hook', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-enable-vs-firstframe', {
        sublyNotifs: goodSublyNotifs.replace('if (on) await requestPermissions();', 'if (on) await init();'),
        extra: {
          'apps/subly/lib/features/scan/scan_screen.dart':
            'class _S extends State<S> {\n  @override\n  void initState() {\n    super.initState();\n    NotificationService.instance.requestPermissions();\n  }\n}\n',
        },
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /initState\(\) \[first frame, no gesture\]/);
    assert.match(out, /apps\/subly: THE ENABLE PATH NEVER ASKS/);
  });

  // The other direction of the same barrier: an ask inside a function the walk
  // DID reach from main() is limb A's violation and must not double as limb C's
  // evidence, or a launch-time ask would "prove" the enable path works.
  test('an ask reachable from main() does not satisfy the enable-path limb', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-enable-not-paid-by-main', {
        sublyNotifs: goodSublyNotifs
          .replace('if (on) await requestPermissions();', 'if (on) await init();')
          .replace('await _plugin.initialize(settings);', 'await _plugin.initialize(settings);\n    await requestPermissions();'),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /main\(\) → init\(\)/);
    assert.match(out, /apps\/subly: THE ENABLE PATH NEVER ASKS/);
  });

  // COVERAGE SELF-CHECK. A main.dart the walk cannot parse would start the whole
  // check from nothing and report a clean launch path for any code at all.
  test('FAILS when main() cannot be parsed out of an app that has a main.dart', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t4-unparseable-main', { sublyMain: '// everything commented out\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /no `main\(\)` DECLARATION could be parsed/);
  });

  test('FAILS when the inherited property test is deleted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-missing', { omitProp: true }) });
    assert.equal(code, 1);
    assert.match(out, /is MISSING/);
  });

  // A file that still exists but has been emptied of assertions is the sneaky
  // case: "the file is there" would pass while it asserts nothing.
  test('FAILS its own coverage check when the file is gutted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-gutted', { propTest: `test('only one', () {});` }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS when a declared property stops being asserted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-renamed', { propTest: goodTest.replace('theme-mode-persisted', 'something-else') }),
    });
    assert.equal(code, 1);
    assert.match(out, /'theme-mode-persisted' is NOT asserted/);
  });

  // ── 🔴 COMMENTED OUT IS EMPTIED (2026-08-01 full-corpus review) ─────────────
  // The header promises the build fails if this file is "deleted, emptied, or
  // stops covering a declared property". It was false on "emptied": the source
  // was scanned RAW, so `// testWidgets(` counted toward the block floor and
  // every `group('property: …')` regex matched inside a comment. Mutation-proven
  // on the real brick template — the whole file commented out plus a stub `void
  // main() {}` (so the app_brick lane still compiles and trivially passes) left
  // the shipped guard printing `ok — 14 property/properties enforced`.
  test('FAILS when the whole property test is commented out line by line', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-slashed', {
        propTest: goodTest.split('\n').map((l) => `// ${l}`).join('\n') + '\nvoid main() {}\n',
      }),
    });
    assert.equal(code, 1, 'a commented-out assertion asserts nothing');
    assert.match(out, /COVERAGE LOST/);
  });

  // The realistic triage edit: /* */ around ONE flaky group while chasing a red
  // lane. Nothing else in the file moves, so only the property-level check can
  // notice — which is precisely what this guard exists to make loud.
  test('FAILS when a single property group is wrapped in a block comment', () => {
    const marker = "group('property: locale-actually-switches', () {";
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-blocked', {
        propTest: goodTest.replace(
          marker,
          `/* quarantined 2026-08-01 — flaky\n${marker}`,
        ).replace("  testWidgets('ii', (t) async {});\n});", "  testWidgets('ii', (t) async {});\n});\n*/"),
      }),
    });
    assert.equal(code, 1, 'a quarantined group is a property that stopped being enforced');
    assert.match(out, /'locale-actually-switches' is NOT asserted/);
  });

  // The false-alarm side, and the reason the stripper is hand-rolled rather than
  // the sibling guard's strip-comments-AND-strings scanner: the group markers
  // this guard matches ARE string literals, so blanking strings would erase the
  // very evidence being looked for. A `//` inside a string must survive.
  test('a `//` inside a string literal is not a comment', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-url-string', {
        propTest: `const docs = 'https://nikatru.com/chassis#properties';\n${goodTest}`,
      }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /theme-mode-persisted' asserted/);
  });

  // The hollow-test case: the assertion is still there but the thing it asserts
  // has been deleted from the app. A test-name check alone would pass.
  test('FAILS when the assertion survives but the IMPLEMENTATION is gone', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-hollow', { app: 'return MaterialApp.router(theme: buildAppTheme());' }),
    });
    assert.equal(code, 1);
    assert.match(out, /IMPLEMENTATION is gone/);
  });

  // ── [pipeline N-4 clause 7 / N-7 clause 4] THE GUARD READS `apps/` TOO ──────
  // Until 2026-08-01 every path above was hardcoded to the brick, so a STAMPED
  // app could delete its own `test/chassis_properties_test.dart` — one `rm`, no
  // lint suppression, no `skip:` — and drop every inherited property assertion
  // with every guard in the tree still green. That is the single
  // highest-leverage gate-weakening move available, and N-4 as drafted did not
  // name it. Proven first by stamping a REAL `apps/probe` with mason into a
  // short-path clone and deleting the file there; these fixtures encode what
  // that run showed.
  //
  // The app's own copy of every app-relative anchor, so the stamped root is a
  // real subject rather than a directory with one test file in it.
  const stampedApp = (dir, over = {}) => ({
    [`${dir}/test/chassis_properties_test.dart`]: over.propTest ?? goodTest,
    [`${dir}/lib/app.dart`]: over.app ?? goodApp,
    // The pack rail is appended for the same reason it is in `build`: a stamped
    // app inherits it from the chassis, so a fixture without it fails on the
    // consumer rather than on whatever the case is about.
    [`${dir}/lib/state/providers.dart`]: (over.providers ?? goodProviders) + (over.packRail ?? goodPackRail),
    [`${dir}/lib/state/money_providers.dart`]: over.moneyProviders ?? goodMoneyProviders,
    [`${dir}/lib/features/settings/settings_screen.dart`]:
      (over.settings ?? goodSettings) + (over.legalLinks ?? goodLegalLinks),
    [`${dir}/lib/features/home/home_screen.dart`]: over.home ?? goodHome,
    [`${dir}/lib/core/router.dart`]: over.router ?? goodRouter,
    // The sign-up door, app-relative for the same reason as the paywall below:
    // a stamped app can drop its own no-session branch and strand every new
    // registrant it serves without the brick changing at all.
    [`${dir}/lib/features/auth/sign_up_screen.dart`]: over.signUp ?? goodSignUp,
    [`${dir}/lib/main.dart`]: over.brickMain ?? goodMain,
    // [13]T-9. App-relative for the same reason as the paywall entry below: the
    // tap loop is stamped INTO each app, so any one app can sever its own
    // subscription — or drop main.dart's single-instance override — without
    // touching the brick, and be a stamped app whose reminders open nothing.
    [`${dir}/lib/state/notification_tap_observer.dart`]: over.tapObserver ?? goodTapObserver,
    [`${dir}/lib/features/firstrun/onboarding_screen.dart`]: over.onboarding ?? goodOnboarding,
    // [pipeline 11]E-6. App-relative on purpose: every stamped app carries its
    // OWN paywall, so any one of them can drop a stage from the funnel without
    // touching the brick — which is exactly the per-app hole clause 7 closed for
    // the property test itself.
    [`${dir}/lib/features/monetization/paywall_screen.dart`]: over.paywall ?? goodPaywall,
    [`${dir}/lib/l10n/app_ta.arb`]: over.arbTa ?? goodArbTa,
    // The viewport-bearing web shell every app carries (2026-08-08 anchor) —
    // app-relative for the same reason as the paywall entry above.
    [`${dir}/web/index.html`]: over.webIndex ?? webIndex,
  });
  const WS_WITH_PROBE = 'name: nikatru_workspace\nworkspace:\n  - packages/core\n  - apps/subly\n  - apps/probe\n';

  test('audits a stamped app on the workspace list, not only the brick', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-app-ok', { workspace: WS_WITH_PROBE, extra: stampedApp('apps/probe') }),
    });
    assert.equal(code, 0, out);
    assert.match(out, /apps\/probe — property 'account-deletion-works' asserted/);
    assert.match(out, /across 2 root\(s\)/);
  });

  test('FAILS when a stamped app deletes its inherited property test', () => {
    const files = stampedApp('apps/probe');
    delete files['apps/probe/test/chassis_properties_test.dart'];
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-app-rm', { workspace: WS_WITH_PROBE, extra: files }),
    });
    assert.equal(code, 1, 'one `rm` must not drop every inherited property silently');
    assert.match(out, /apps\/probe\/test\/chassis_properties_test\.dart is MISSING/);
  });

  test('FAILS naming the app when its copy drops one property group', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-app-group', {
        workspace: WS_WITH_PROBE,
        extra: stampedApp('apps/probe', {
          propTest: goodTest.replace('account-deletion-works', 'account-deletion-works-ish'),
        }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /apps\/probe: property 'account-deletion-works' is NOT asserted/);
  });

  test('FAILS naming the app when its own implementation anchor is gone', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-app-impl', {
        workspace: WS_WITH_PROBE,
        extra: stampedApp('apps/probe', {
          settings: goodSettings.replace('onConfirm: () => _deleteAccount(', 'onConfirm: () => Navigator.pop('),
        }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /apps\/probe: property 'account-deletion-works' is asserted but its IMPLEMENTATION is gone/);
  });

  // [13]T-9's per-app limb. The tap loop is stamped INTO each app — the observer,
  // the gate and main.dart's single-instance override are all app-relative — so
  // one app can sever its own subscription while the brick stays perfect, and be
  // a shipped app whose reminders open nothing. Anchoring this property only at
  // the brick would have been the exact hole clause 7 closed for the property
  // test itself.
  test('FAILS naming the app when its copy severs the tap loop', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-t9-app', {
        workspace: WS_WITH_PROBE,
        extra: stampedApp('apps/probe', {
          tapObserver: goodTapObserver.replace(
            '_service.notificationTaps().listen(',
            '_ownTaps.stream.listen(',
          ),
        }),
      }),
    });
    assert.equal(code, 1);
    assert.match(out, /apps\/probe: property 'notification-tap-observed' is asserted but its IMPLEMENTATION is gone/);
  });

  // apps/subly is the frozen legacy rail-prover (39-CHASSIS §4 cut 1): it
  // predates the brick, was never stamped, and has no inherited property test to
  // keep. Exempting it BY NAME is what stops this guard demanding a retrofit the
  // freeze forbids — and this case is what stops the exemption being silently
  // widened to every app.
  //
  // ⚠️ NARROWED 2026-08-06 ([pipeline 13]T-4). This read
  // `doesNotMatch(out, /apps\/subly/)` — an assertion far broader than its own
  // title, which said "does NOT demand a property TEST". Read literally it made
  // apps/subly unmentionable by this guard for ANY reason, and so it would have
  // blocked the T-4 boot-path limb — a check the frozen app is deliberately NOT
  // exempt from, and the one whose defect it was shipping. The exemption covers
  // the inherited property test; it never covered the launch path. Both
  // directions are now asserted, so neither can be quietly widened.
  test('does NOT demand a property test from the frozen apps/subly', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-subly-exempt') });
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /apps\/subly: property/);
    assert.doesNotMatch(out, /apps\/subly\/test\/chassis_properties_test\.dart/);
    // …and it IS held to the boot path.
    assert.match(out, /\[13\]T-4 apps\/subly — launch path asks for no OS permission/);
  });

  // The domain itself. An unreadable workspace list silently shrinks the scan
  // back to the brick alone, which is exactly the hole these cases close — so it
  // must be COVERAGE LOST rather than a quieter pass over the template.
  test('COVERAGE LOST when the workspace list cannot be read', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-no-workspace', { workspace: 'name: nikatru_workspace\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the root pubspec\.yaml has no readable `workspace:` block/);
  });

  // ── C-16 narrowed lock, 2026-07-28. Every case below was FIRST reproduced by
  //    mutating the real brick template and watching the old guard print `ok`.
  //    These fixtures encode what those runs showed. ──────────────────────────
  describe('theme-mode-persisted is anchored to persistence itself', () => {
    // THE ORIGINAL HOLE. 'persisted' was the only property with no source anchor,
    // so deleting the write — turning a saved setting into one that resets at
    // every launch, the exact defect the property is named after — was green.
    test('FAILS when the choice is no longer WRITTEN', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nowrite', {
          providers: goodProviders.replace('await kv.write(_themeModeKey, _encode(mode));', 'state = mode;'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must WRITE the choice/);
    });

    // The other half. A write nobody reads back restores nothing, and from the
    // user's chair that is indistinguishable from never having saved at all.
    test('FAILS when the stored choice is no longer READ at launch', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noread', {
          providers: goodProviders.replace('await kv.read(_themeModeKey)', 'null'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must READ the stored choice back/);
    });
  });

  // [pipeline C-11] The brand seed must reach BOTH themes. This pair exists
  // because the first version of the anchor was a single `buildAppTheme(\s*seed:`
  // match, and it PASSED against the real template with the seed deleted from
  // `theme:` — `darkTheme:` still matched. An app could have shipped a branded
  // dark theme and a generic light one with the guard green. Found by mutating
  // the real tree; no fixture I wrote first would have shown it.
  describe('the brand seed reaches both themes', () => {
    test('FAILS when the LIGHT theme loses its seed', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-lightseed', { app: goodApp.replace('theme: buildAppTheme(seed: const Color(0xFF6459F5))', 'theme: buildAppTheme()') }),
      });
      assert.equal(code, 1);
      assert.match(out, /seed to the LIGHT theme/);
    });

    test('FAILS when the DARK theme loses its seed', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-darkseed', { app: goodApp.replace('    seed: const Color(0xFF6459F5),\n', '') }),
      });
      assert.equal(code, 1);
      assert.match(out, /seed to the DARK theme too/);
    });

    // A const AppThemeX is the other half of the same defect: the scheme can be
    // seeded perfectly and every app still shares one gradient and one ramp.
    test('FAILS when brand tokens stop being derived from the scheme', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-consttokens', { themeX: 'class AppThemeX { static const AppThemeX light = AppThemeX(); }\n' }),
      });
      assert.equal(code, 1);
      assert.match(out, /brand tokens must be DERIVED from the scheme/);
    });
  });

  // [pipeline C-14] The UI invariants MASTER_PLAN §4 tagged `[CI]` while no CI
  // lane had ever touched them: Semantics 0 occurrences, TextScaler 0, and three
  // window classes where the standard and DoD §4-C both say five.
  describe('the un-retrofittable UI invariants', () => {
    test('FAILS when text scaling is no longer clamped at the root', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noclamp', { app: goodApp.replace('MediaQuery.withClampedTextScaling(', 'MediaQuery.nothing(') }),
      });
      assert.equal(code, 1);
      assert.match(out, /must clamp text scaling at the root/);
    });

    // THE LIVE BUG. 640 is not a Material breakpoint, so windows 600–639 got
    // the phone layout — a bottom bar on a device wide enough for a rail.
    test('FAILS when the 640 breakpoint comes back', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-640', { scaffold: goodScaffold.replace('medium = 600', 'medium = 640') }),
      });
      assert.equal(code, 1);
      assert.match(out, /must use Material’s 600 boundary/);
    });

    test('FAILS when a window class is dropped from the set', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-4classes', {
          scaffold: goodScaffold.replace('enum WindowClass { compact, medium, expanded, large, extraLarge }', 'enum WindowClass { compact, medium, expanded, large }'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /all FIVE Material window classes must exist/);
    });
  });

  // [pipeline C-15] The auth seam had no home: the only implementations lived
  // inside apps/subly, so the brick wired no auth and no tokenProvider — every
  // stamped app was born unable to sign anyone in.
  describe('the auth seam is wired into the stamp', () => {
    test('FAILS when the brick wires no AuthRepository', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noauth', {
          providers: goodProviders.replace(
            /final Provider<core\.AuthRepository> authRepositoryProvider = Provider<core\.AuthRepository>\(\(ref\) \{[\s\S]*?\n\}\);\n/,
            '',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must wire an AuthRepository/);
    });

    // The seam can be perfect and every request still anonymous.
    test('FAILS when the token never reaches the shared REST client', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-notoken', { providers: goodProviders.replace('tokenProvider: ref.watch(authTokenProvider),', 'tokenProvider: () async => null,') }),
      });
      assert.equal(code, 1);
      assert.match(out, /token provider must reach the shared RestClient/);
    });

    // [G-43] The SDK's default writes the access AND refresh tokens as plaintext.
    test('FAILS when the session falls back to plaintext storage', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-plaintext', { authBarrel: 'Future<void> initNikatruAuth() async { await sb.Supabase.initialize(); }\n' }),
      });
      assert.equal(code, 1);
      assert.match(out, /session must go in the SECURE store/);
    });

    // 🔴 THE HOLE THIS PROPERTY SHIPPED WITH. The anchor above matches text
    // inside `initNikatruAuth` — the DECLARATION — and that function had ZERO
    // callers in the whole tree. HEAD already was the mutant the plaintext test
    // above pretends to catch, and this guard printed `ok`. Both cases below
    // mutate the CALL SITE, which is the only thing that could ever have said
    // whether the SDK gets initialised at all.
    test('FAILS when nothing calls initNikatruAuth — the defect that shipped', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noauthinit', {
          brickMain: goodMain.replace(/      await initNikatruAuth\([\s\S]*?\);\n/, ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must CALL initNikatruAuth/);
    });

    // Initialising WITHOUT a real secure store is the plaintext defect with
    // extra steps: the call is present, the session still lands on disk in the
    // clear.
    test('FAILS when the launch call is handed no platform secure store', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nosecurestore', {
          brickMain: goodMain.replace('        secureStore: FlutterSecureStore(),\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /REAL platform secure store/);
    });

    // A 401 is not proof the session is gone. Signing out on ANY 401 turned the
    // ordinary act of resuming the app — where the SDK's refresh ticker has been
    // stopped and restarts asynchronously — into a forced logout.
    test('FAILS when any 401 goes straight back to signing the user out', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-401logout', {
          providers: goodProviders.replace(
            'onUnauthorized: () => signOutOnlyIfSessionIsGone(ref.read(authRepositoryProvider)),',
            'onUnauthorized: () => ref.read(authRepositoryProvider).signOut(),',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must go through signOutOnlyIfSessionIsGone/);
    });

    // The named function is only worth anything if it still ASKS. Gutting the
    // check leaves an unconditional sign-out wearing a reassuring name — which
    // the anchor above would happily pass.
    test('FAILS when the named check stops consulting the seam', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-401nocheck', {
          providers: goodProviders.replace('await auth.currentAccessToken() == null', 'true'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must ASK the seam for a token first/);
    });
  });

  // [pipeline C-13] Both stores require a WORKING in-app deletion path. This
  // button passed every check the repo had while doing nothing at all.
  describe('the account-deletion button actually acts', () => {
    test('FAILS when confirm goes back to just popping the dialog', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-deadbutton', {
          settings: goodSettings.replace('onConfirm: () => _deleteAccount(dialogContext, ref, l10n, password.text),', 'onConfirm: () => Navigator.pop(dialogContext),'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /it used to call Navigator\.pop and nothing else/);
    });

    test('FAILS when the flow never reaches the seam', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noseam', { settings: goodSettings.replace('  await auth.deleteAccount();\n', '') }),
      });
      assert.equal(code, 1);
      assert.match(out, /must reach AuthRepository\.deleteAccount/);
    });

    // Deletion is irreversible: a borrowed or unattended device must not be
    // enough to destroy an account.
    test('FAILS when the reauth step is dropped', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noreauth', { settings: goodSettings.replace('  await auth.signInWithEmail(email: email, password: password);\n', '') }),
      });
      assert.equal(code, 1);
      assert.match(out, /must REAUTH first/);
    });

    // 🔴 THE THREE ABOVE ALL LIVE IN settings_screen.dart, and all three passed
    // while providers.dart hard-coded `requestServerDeletion: null` — so the
    // repository took the refusal branch on every press and the user was signed
    // out without ever being deleted. Presence of a call chain says nothing
    // about its terminal branch.
    test('FAILS when the deletion request is hard-coded back to null', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nullhook', {
          providers: goodProviders.replace(
            'requestServerDeletion: () => requestAccountDeletion(ref.read(restClientProvider)),',
            'requestServerDeletion: null,',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must be WIRED to the server route/);
    });

    // [ADR 027] …and wiring it to a BARE delete() is the same defect one layer
    // out. `ApiException` carries the status; `deleteAccount` flattens it into
    // an `AuthFailure`, so by the time the screen catches it 501 (nothing was
    // deleted) and 502 (the data is gone, the login is not) are the same object.
    test('FAILS when the deletion bypasses the helper that keeps the status', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-barehook', {
          providers: goodProviders.replace(
            'requestServerDeletion: () => requestAccountDeletion(ref.read(restClientProvider)),',
            "requestServerDeletion: () => ref.read(restClientProvider).delete('/account'),",
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must go through requestAccountDeletion/);
    });

    // 🔴 AND THE MESSAGE ITSELF. Every anchor above was satisfied by a
    // `catch (_)` printing ONE string for every refusal the route can give —
    // including 502, where "your account has NOT been deleted" is simply false.
    test('FAILS when the failure path collapses back to one message', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-onemessage', {
          settings: goodSettings.replace(
            'deleteAccountFailureMessage(l10n, core.accountDeletionOutcomeOf(e)),',
            'l10n.deleteAccountFailed,',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must resolve WHICH refusal it was/);
    });

    // …and wiring it to a route that leaves the identity behind is WORSE than
    // the refusal: the user is told they are deleted and their login still
    // works, which is the one failure they can never detect.
    test('FAILS when the server route stops deleting the identity record', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noidentity', {
          accountRoute: goodAccountRoute.replace('/auth/v1/admin/users/', '/rest/v1/records/'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must delete the IDENTITY record too/);
    });

    test('FAILS when the route stops requiring the service-role credential', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nosvcrole', {
          accountRoute: goodAccountRoute.replaceAll('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /needs the service-role credential/);
    });
  });

  // [pipeline C-13] FIRST-RUN ONBOARDING.
  //
  // 🔬 O3 on the real tree is the one to remember: making `_copy` fall back the
  // way `AppConfig.text()` does — TO THE KEY — left this guard green and failed
  // exactly one limb of the property. A fresh stamp has no overrides, so that
  // mutation ships `onboarding.1.title` to a real user, and it looks entirely
  // deliberate in review.
  describe('onboarding is reachable and does not leak config keys', () => {
    test('FAILS when the router stops sending a fresh install there', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noonboard', {
          router: goodRouter.replace("      if (!onboarded) {\n        return state.matchedLocation == '/onboarding' ? null : '/onboarding';\n      }\n", ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /exempt it from the auth gate/);
    });

    test('FAILS when the copy falls back to the raw key', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-rawkey', {
          onboarding: goodOnboarding.replace("_copy(cfg, 'onboarding.1.title', l10n.onboarding1Title)", "cfg.text('onboarding.1.title')"),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /NEVER to the key/);
    });

    test('FAILS when the choice is never written', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nowrite', {
          providers: goodProviders.replace("await kv.write(_onboardingSeenKey, seen ? 'true' : 'false');", ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /onboarding returns at every launch forever/);
    });
  });

  // [pipeline C-13] THE STORE-REVIEW PROMPT, and its call site.
  //
  // 🔬 R1 on the real tree — deleting `await review.maybeAsk()` from app.dart —
  // left every stamped-app test GREEN until the widget limb was rebuilt, so for
  // a while this anchor was the ONLY thing standing between the chassis and a
  // review seam that never asked anybody. The gate refuses on almost every
  // launch by design, which makes "nothing happened" the correct outcome nearly
  // always: the best camouflage a dead feature has had here yet.
  describe('the review prompt has a caller', () => {
    test('FAILS when the app never asks', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noask', {
          app: goodApp.replace('    await review.maybeAsk();\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /app\.dart must actually ask/);
    });

    test('FAILS when the launch is never counted', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nocount', {
          app: goodApp.replace('    await review.recordLaunch();\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must count the launch/);
    });

    test('FAILS when the ask stops going through the gate', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nogate', {
          providers: goodProviders.replace('ref.read(reviewGateProvider).decide(state, now: now, platformCanAsk: canAsk)', 'true'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must go through ReviewGate\.decide/);
    });
  });

  // [pipeline C-13] EDIT DISPLAY NAME — the screen refused on the grounds that
  // "there is no profile data model", which described a field nothing wrote and
  // concluded it could never be written.
  //
  // 🔬 REAL-TREE MUTATIONS FIRST (2026-07-29, four, each grep-verified). Two of
  // them are invisible to this guard by construction, and that is asserted below
  // rather than left implied — an anchor cannot see behaviour.
  describe('the profile editor is wired to the seam', () => {
    // The dead-button shape, exactly as account deletion shipped it.
    test('FAILS when the save button only closes the dialog', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-deadsave', {
          settings: goodSettings.replace('onSave: () => _saveProfile(dialogContext, ref, l10n, name.text),', 'onSave: () => Navigator.pop(dialogContext),'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /a dialog whose action only pops looks exactly like one that worked/);
    });

    test('FAILS when the save flow never reaches the seam', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noupdate', {
          settings: goodSettings.replace('  await ref.read(authRepositoryProvider).updateProfile(displayName: displayName.trim());\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must reach AuthRepository\.updateProfile/);
    });

    // THE INVISIBLE SAVE. Compiles, renders the right name on entry, and never
    // rebuilds — so a saved name goes on showing the old value. Nothing about
    // this looks wrong in review, which is why it is anchored.
    test('FAILS when the tile reads the snapshot instead of the stream', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-snapshot', {
          settings: goodSettings.replace('ref.watch(authUserProvider).valueOrNull;', 'ref.watch(authRepositoryProvider).currentUser;'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must watch the identity STREAM/);
    });

    // The seam method itself. A screen calling a method the contract does not
    // declare is a compile error in the app and a silent pass here.
    test('FAILS when the seam stops declaring updateProfile', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-noseammethod', {
          coreAuth: goodCoreAuth.replace('Future<AuthUser> updateProfile({required String displayName});', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /the seam must declare updateProfile/);
    });

    // 🔴 THE HONEST LIMIT, demonstrated with a mutation the ANCHOR STILL
    // MATCHES. `\.updateProfile\(displayName:` matches both the correct call and
    // this broken one, so the guard passes while the behaviour differs. On the
    // real tree the same shape appeared twice — deleting the seam's EMIT, and
    // storing '' instead of clearing the name — and both left this guard green
    // while the property test went red.
    //
    // Anchors see TEXT; only the property sees BEHAVIOUR. If this ever goes red
    // the guard got smarter, and this comment plus the property test header are
    // stale.
    test('does NOT catch a call that matches the anchor but misbehaves', () => {
      const { code } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-notrim', {
          settings: goodSettings.replace('updateProfile(displayName: displayName.trim());', 'updateProfile(displayName: displayName);'),
        }),
      });
      assert.equal(code, 0, 'if this goes red, update the property test header and this comment');
    });
  });

  // [pipeline C-13] A user who signs in must END UP SOMEWHERE ELSE.
  //
  // 🔬 THE REAL-TREE MUTATIONS CAME FIRST (2026-07-29, four of them, each
  // grep-verified to have landed) and this fixture was written afterwards to
  // match what they showed — never the other way round. The mutation this guard
  // deliberately does NOT catch is recorded below, because a fixture that
  // pretended otherwise would inflate what this file appears to prove.
  describe('the sign-in screen can be LEFT', () => {
    test('FAILS when the router is never told the session changed', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-norefresh', {
          router: goodRouter.replace('    refreshListenable: ref.watch(routerRefreshProvider),\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /the router must be TOLD when the session changes/);
    });

    // The bridge itself. `refreshListenable:` pointing at a notifier that does
    // not exist is a compile error in the app and a silent pass here.
    test('FAILS when the notifier class is gone', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nonotifier', {
          providers: goodProviders.replace('class AuthRefreshNotifier extends ChangeNotifier {', 'class AuthRefreshNotifierGone extends ChangeNotifier {'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must be bridged to a Listenable/);
    });

    test('FAILS when the notifier stops subscribing to the auth stream', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nosub', {
          providers: goodProviders.replace('    _sub = changes.listen((core.AuthUser? _) => notifyListeners());\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must actually SUBSCRIBE/);
    });

    // 🔴 THE HONEST LIMIT OF THIS GUARD, asserted rather than left implied.
    // On the real tree, replacing the listener body with `{}` — subscribing and
    // never notifying — left every anchor matching and this guard GREEN, while
    // both limbs of the property test went red. That is the correct division of
    // labour (the guard stops the property VANISHING; only the property stops
    // the BEHAVIOUR vanishing), but it is worth a failing-if-it-changes test so
    // nobody reads the guard as proving more than it does.
    test('does NOT catch a notifier that fires nothing — the property does', () => {
      const { code } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-silentnotifier', {
          providers: goodProviders.replace('_sub = changes.listen((core.AuthUser? _) => notifyListeners());', '_sub = changes.listen((core.AuthUser? _) {});'),
        }),
      });
      assert.equal(code, 0, 'if this ever goes red the guard got smarter — update the comment above, and the property test header');
    });
  });

  // A REGISTRATION THAT PRODUCES NO SESSION MUST LAND SOMEWHERE.
  //
  // With Supabase "Confirm email" on, `signUp` returns a user and no session, so
  // every gate reads the new registrant as signed OUT — including the
  // verification gate, whose test is `sessionIsUnverified` and which answers
  // false for a null user by design. The screen, the gate and the router were
  // each correct; nobody owned the gap between them.
  //
  // 🔴 THREE ANCHORS, THREE CASES, BECAUSE EACH ONE RESTORES THE STRANDING
  // ALONE AND THE PROPERTY TEST CANNOT SAY WHICH WENT. The real-tree mutations
  // came first; these encode them at fixture level so the requirement stays
  // falsifiable here too — a property whose anchors no case can break is a
  // heading that survives its own feature's deletion.
  describe('a sessionless sign-up reaches /check-inbox', () => {
    test('FAILS when the property is not asserted at all', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-ci-noprop', {
          propTest: goodTest.replace("group('property: sessionless-signup-reaches-check-inbox', () {\n  testWidgets('ci1', (t) async {});\n  testWidgets('ci2', (t) async {});\n});\n", ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /property 'sessionless-signup-reaches-check-inbox' is NOT asserted/);
    });

    // The mutation that looks harmless: navigate every time. It races the
    // redirect guard for the session case, which is why the condition — not the
    // navigation — is what the anchor pins.
    test('FAILS when the sign-up screen navigates UNCONDITIONALLY', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-ci-uncond', {
          signUp: goodSignUp.replace("  if (auth.currentUser == null) {\n    context.go('/check-inbox', extra: email);\n    return;\n  }\n", "  context.go('/check-inbox', extra: email);\n"),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /IMPLEMENTATION is gone/);
      assert.match(out, /NO-SESSION case specifically/);
    });

    test('FAILS when the destination is not MOUNTED', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-ci-unrouted', {
          router: goodRouter.replace("path: '/check-inbox'", "path: '/inbox-check'"),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /IMPLEMENTATION is gone/);
      assert.match(out, /must be MOUNTED/);
    });

    // The subtlest of the three: the route exists and the screen is reachable in
    // principle, but its whole audience has no session — so without the
    // allowlist entry the auth rule bounces them to /sign-in the instant the
    // sign-up screen sends them there, and the stranding is back with the route
    // still present.
    test('FAILS when the destination is off the SIGNED-OUT allowlist', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-ci-notallowed', {
          router: goodRouter.replace("          state.matchedLocation == '/check-inbox' ||\n", ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /IMPLEMENTATION is gone/);
      assert.match(out, /SIGNED-OUT allowlist/);
    });
  });

  // [pipeline C-13] The chassis claimed internationalisation while shipping ONE
  // locale, so the seam had never once run — the fail-closed-with-no-open-path
  // shape, in a corner nobody had looked at.
  describe('the i18n seam can actually open', () => {
    // Deleting the file outright.
    test('FAILS when the second locale file is deleted', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-onelocale', { omitArbTa: true }),
      });
      assert.equal(code, 1);
      assert.match(out, /could not be read/);
    });

    // The sneakier case: the file is still THERE, but is no longer a second
    // locale — copied from English, or its `@@locale` quietly changed. "A file
    // exists at that path" is not "a second language ships".
    test('FAILS when the file exists but is not a second locale', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-fakelocale', { arbTa: '{\n  "@@locale": "en",\n  "settingsTitle": "Settings"\n}\n' }),
      });
      assert.equal(code, 1);
      assert.match(out, /a second locale must exist/);
    });

    test('FAILS when MaterialApp stops reading the override', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nolocale', { app: goodApp.replace('  locale: ref.watch(localeProvider),\n', '') }),
      });
      assert.equal(code, 1);
      assert.match(out, /must READ the override/);
    });

    test('FAILS when the language choice is not persisted', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-nolocalewrite', { providers: goodProviders.replace("    await kv.write(_localeKey, locale?.languageCode ?? '');\n", '') }),
      });
      assert.equal(code, 1);
      assert.match(out, /choice must be written/);
    });
  });

  describe('"every property" has a tracked domain', () => {
    test('the domain is read from the template, and the gaps are named', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-domain') });
      assert.equal(code, 0);
      // 40 since 2026-08-01: the domain reads BOTH providers files, and
      // [pipeline 5]M-13's money_providers.dart carries eight. 41 since
      // 2026-08-03: [pipeline 13]T-8 added catchUpNudgeProvider to the first of
      // them. 45 since 2026-08-03: the content-pack rail added four more, all
      // four DRIVEN by the `content-pack-consumed` property rather than
      // admitted as gaps. 46 since 2026-08-06: [pipeline 2]C-13 wired
      // `OfflineNotice`, which had ZERO consumers, and its
      // `networkUnreachableProvider` joined the domain as an admitted gap —
      // reachable is not the same claim as behaviourally proven.
      // 48 since 2026-08-10: the cut-1 reversal's legal-gate riders added
      // `legalAcceptanceProvider` and `legalReacceptanceNeededProvider`. They
      // landed as ADMITTED GAPS on the stated ground that the stamped-app shape
      // "could not be made green" — the bump fires and the router does not
      // move. That was not a gap, it was the bug: the refresh signal was taken
      // from the source provider instead of the derived one the redirect reads,
      // so the gate never fired on a real launch. Fixed, and BOTH are now
      // COVERED_BY `legal-reacceptance-gated`.
      // 50 since 2026-08-10 (the merge): research/44 §7 rung 3 added
      // `promoGateProvider` and `promoCardStateProvider`, both DRIVEN by
      // `promo-card-fails-closed` rather than admitted — which is why the gap
      // count below does NOT move. Both raises were computed as 46+2 on separate
      // branches on the same day; the merged tree carries all four.
      // 53 since 2026-08-10: research/44 rung 4 added `privacySignalProvider`
      // (the GPC seam), `promoObjectedProvider` (DRIVEN — the stamped home
      // screen renders through PromoSurface(objected: …) since the D2
      // signature) and `promoObjectionKnownProvider` (an admitted gap: no
      // chassis property pumps Settings). So the gap count below moves by TWO
      // and the domain by three.
      // 55 since 2026-08-11: password-reset completion added `launchUriProvider`
      // (overridable so the FAILURE path is drivable at all), plus the recovery
      // flag and the arrival report. All three are classified, so the domain and
      // the classification move together — which is the point of the pair of
      // assertions below.
      // 56 since 2026-08-11 (later the same day): `authProvidersProvider` — the
      // server-side half of the OAuth question, whose absence let a disabled
      // provider's button ship on every platform. Classified under
      // `auth-seam-wired`, so the domain and the classification move together here
      // too, and MIN_DOMAIN went 56 → 57 in the same commit.
      // 59 since 2026-09-04: [ADR 065] chassis step 2 added
      // `lastAccountDeletionOutcomeProvider` and `lastAccountDeletionDetailProvider`
      // — the deletion outcome, parked above the screen the sign-out tears down.
      // Both are CLASSIFIED (under `account-deletion-works`, DRIVEN through the
      // real router), so the domain moves by two and the gap count below does not.
      assert.match(out, /tracked domain: 59 chassis behaviour\(s\)/);
      // The admitted gaps must PRINT. An inventory nobody sees is a list that
      // quietly grows; this is the same reasoning as the owner-gated residual.
      // 9, not 10: [pipeline C-13] moved notificationServiceProvider out of the
      // admitted-gap list when the reminder toggle started driving it. 10 since
      // 2026-08-01: the money rail closed two gaps (entitlementCacheProvider and
      // secureStoreProvider, both DRIVEN by the paywall property now) and
      // admitted three of its own.
      //
      // 8 since 2026-08-07: three gaps closed at once, and the number moving
      // DOWN is the event worth asserting. [11]E-6 drove `moneyFunnelProvider`
      // and `entitlementConvergenceProvider` — the second was admitted on the
      // grounds that "a checkout cannot be opened in a widget test", which was
      // simply untrue: the rail is an interface precisely so a test can open
      // one. [10]D-8 drove `mustForceUpdateProvider`, the switch that had been
      // inert for 55 builds with nothing able to say so.
      //
      // 8 since 2026-08-10, and DOWN again for the same reason as the last two
      // moves: the legal pair was reclassified out of the gap list once the
      // defect its "gap" described was fixed. Both directions of the count are
      // asserted over time on purpose — a number that only ever goes up is a
      // list nobody is closing.
      //
      // 10 since 2026-08-10 (rung 4), and this one goes UP honestly rather than
      // being talked down. `privacySignalProvider` and
      // `promoObjectionKnownProvider` are both really asserted — in
      // promo_objection_surface_test.dart, in both roots — and neither is
      // reached by a CHASSIS property, because the property suite never
      // overrides the GPC seam and never pumps the Settings screen. Counting
      // them as covered because a test somewhere touches them is exactly the
      // inflation the two moves above were corrections FOR. The third addition,
      // `promoObjectedProvider`, is genuinely driven and does not appear here.
      assert.match(out, /10 chassis behaviour\(s\) a stamped app does NOT prove/);
      // A gap that is STILL a gap, named — so this assertion cannot be
      // satisfied by the list going empty.
      assert.match(out, /featureFlagsProvider/);
    });

    // HOLE 2. Adding a provider to the real template changed nothing before this.
    test('FAILS on a NEW chassis behaviour that is classified nowhere', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-newcap', {
          providers: `${goodProviders}\nfinal Provider<bool> darkPatternDetectorProvider = X();\n`,
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /NEW CHASSIS BEHAVIOUR 'darkPatternDetectorProvider'/);
    });

    // The other direction: a classification for something that no longer exists
    // inflates apparent coverage exactly like an assertion that cannot fail.
    test('FAILS on a stale classification when a behaviour is deleted', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-stale', {
          providers: goodProviders.replace(
            'final Provider<core.SecureStore> secureStoreProvider = X();\n',
            '',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /'secureStoreProvider' is classified in this guard but no longer exists/);
      // …and the domain's own floor catches the same edit from the other side.
      // The number is (what the fixture carries) − (the one this case deletes),
      // and it moves with MIN_DOMAIN by construction: left behind, it would pass
      // over a floor with slack, which is the drift this pair of assertions
      // exists to make impossible.
      // 2026-08-11: 55 → 56, because `authProvidersProvider` was added to BOTH
      // the real tree and this fixture and MIN_DOMAIN went 56 → 57. THIS IS THE
      // THIRD FILE OF A THREE-FILE ACT — the provider, the floor, and this
      // expectation — and skipping it is not a red herring: with the fixture
      // bumped and the floor left alone, the deletion measured 56 ≥ 56, the
      // floor did not trip, and `COVERAGE LOST` silently stopped firing. The
      // negative test passes BY LOSING THE THING IT TESTS, exactly as the note
      // on MIN_DOMAIN describes. It was caught here by the suite, not by a
      // human reading it.
      // 2026-09-04: 56 → 58, the same three-file act one more time. [ADR 065]
      // chassis step 2 added `lastAccountDeletionOutcomeProvider` and
      // `lastAccountDeletionDetailProvider` to the real tree AND to
      // `goodProviders` above, and MIN_DOMAIN went 57 → 59 in the same commit.
      // The fixture now carries 59; this case deletes one, so the parse finds 58
      // and the floor of 59 trips. Left at 56 the assertion would simply not
      // match and the case would fail loudly — which is the good outcome, and is
      // how it was caught this time too.
      assert.match(out, /COVERAGE LOST — the domain parse found 58/);
    });

    // The scanner-stopped-scanning case, which is how this repo has been bitten
    // repeatedly: a domain regex that matches nothing must not read as "clean".
    test('FAILS rather than reporting clean when the domain parse finds nothing', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        // BOTH providers files, or the surviving one carries the domain over
        // the floor and the blindness this case is about stays invisible.
        cwd: build('sp-blind', {
          providers: '// every provider declaration gone\n',
          moneyProviders: '// …and the money ones too\n',
          // …including the content-pack rail, which `build` otherwise appends.
          packRail: '',
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — the domain parse found 0/);
    });
  });

  // ── [pipeline 7]P-9 · [8]K-9 — the CONTENT-PACK property. ─────────────────
  // The shape this replaced was "fail if any app declares the chassis live
  // while its config has no consumer" — an antecedent NO app could satisfy,
  // because `contentPack` was the literal `null` everywhere. Vacuously true,
  // and greener the less was built. Each of the three anchors is broken on its
  // own below, because a single case that breaks all three would still pass
  // with two of them neutered.
  describe('content-pack-consumed', () => {
    test('FAILS when the pointer goes back to null — the empty antecedent', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-null', {
          packRail: goodPackRail.replace(
            "contentPack: 'https://packs.nikatru.com/${AppConfig.appId}/latest',",
            'contentPack: null,',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /the brick must NAME a pack/);
    });

    test('FAILS when the loader is no longer constructed', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-noloader', {
          packRail: goodPackRail.replace(
            'core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),',
            'throw UnimplementedError(),',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /the loader must be CONSTRUCTED in the stamped chassis/);
    });

    test('FAILS when the load drops expectPackId — a signature is not an identity', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-noid', {
          packRail: goodPackRail.replace('.load(expectPackId: AppConfig.appId, remote: source)', '.load(remote: source)'),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /something must actually ASK for a pack/);
    });

    test('FAILS when the inherited assertion group is dropped', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-nogroup', {
          propTest: goodTest.replace("group('property: content-pack-consumed'", "group('property: something-else'"),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /'content-pack-consumed' is NOT asserted/);
    });
  });

  // ── 2026-08-21 · SOURCE ANCHORS ARE READ COMMENT-STRIPPED ─────────────────
  //
  // 🔴 THE HOLE. `assert-stamp-properties.mjs` strips comments before every
  // scan it makes — seven call sites — EXCEPT the one that read a source anchor
  // file, which was raw. So an anchor regex could be satisfied by a `///` line,
  // which is the "assert on parsed structure, never by grepping prose" rule
  // failing inside the guard that exists to enforce it.
  //
  // NOT HYPOTHETICAL, and the real-tree case is what these fixtures encode:
  // `apps/subly/lib/state/providers.dart:158` is a doc comment quoting
  // "`contentPack: 'https://packs…/latest'`" while that app's real config reads
  // `contentPack: null` on :172. MEASURED 2026-08-21 by running every anchor of
  // every property over both roots raw and stripped and diffing: exactly ONE
  // result flips, that one. It was latent rather than live only because
  // `apps/subly` is in EXEMPT_APPS — dropping the exemption on a copy of the
  // guard printed 9 FAIL lines with the raw read and 10 with the stripped one.
  //
  // MUTATION-TESTED, which is the only thing that makes these cases tests:
  // reverting the read in assert-stamp-properties.mjs to a bare
  // `readFileSync(join(repo, path), 'utf8')` turns the three prose cases below
  // GREEN (exit 0). Re-run that mutation before trusting them again.
  describe('source anchors are read COMMENT-STRIPPED', () => {
    // The `///` form — the shape the real tree is in.
    test('🔴 a DOC COMMENT cannot satisfy a source anchor', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-prose', {
          packRail: goodPackRail.replace(
            "contentPack: 'https://packs.nikatru.com/${AppConfig.appId}/latest',",
            "contentPack: null,\n  /// A live app would read `contentPack: 'https://packs.example.com/x/latest',` here.",
          ),
        }),
      });
      assert.equal(code, 1, out);
      assert.match(out, /'content-pack-consumed' is asserted but its IMPLEMENTATION is gone/);
      assert.match(out, /the brick must NAME a pack/);
    });

    // The `/* */` form, separately: the stripper walks the two comment kinds
    // down different branches, and a case that only ever drove one of them
    // would leave the other unproven.
    test('🔴 a BLOCK COMMENT cannot satisfy a source anchor either', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-block-prose', {
          packRail: goodPackRail.replace(
            "contentPack: 'https://packs.nikatru.com/${AppConfig.appId}/latest',",
            "contentPack: null,\n  /* was contentPack: 'https://packs.example.com/x/latest', until the pointer was pulled */",
          ),
        }),
      });
      assert.equal(code, 1, out);
      assert.match(out, /'content-pack-consumed' is asserted but its IMPLEMENTATION is gone/);
    });

    // 🔴 THE HTML FORM, which `stripDartComments` alone CANNOT see — hence
    // `stripAnchorComments`. Also not hypothetical: `apps/subly/web/index.html:11`
    // reproduces the exact `<meta name="viewport" … content="…width=device-width…"`
    // shape inside an `<!-- -->` block while explaining the tag, so the one
    // anchor whose own comment says "Matched on the TAG, never on prose" was
    // satisfiable by prose. (The real tag is on :20 there, so what this would
    // have hidden is its deletion.)
    test('🔴 an HTML COMMENT cannot satisfy the viewport anchor', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-viewport-prose', {
          extra: {
            [BRICK_WEB_INDEX]:
              '<!DOCTYPE html><html><head>\n' +
              '<!-- The shell must carry <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
              '     or a mobile browser lays the app out at ~980px. -->\n' +
              '<title>x</title></head><body></body></html>\n',
          },
        }),
      });
      assert.equal(code, 1, out);
      assert.match(out, /'ui-invariants-inherited' is asserted but its IMPLEMENTATION is gone/);
      assert.match(out, /device-width viewport/);
    });

    // 🔴 THE OTHER DIRECTION, and it is the one an over-eager fix breaks.
    // `blankStrings` must stay OFF for this read: many anchors ARE string
    // literals. MEASURED 2026-08-21 on the real brick — turning it on breaks
    // SIXTEEN anchors, including these three. A stripper that erased string
    // contents would make every one of them unsatisfiable and the guard would
    // fail the healthy tree, so this case is what keeps the fix from becoming
    // its own outage.
    test('string literals SURVIVE the strip — route paths, event names and the ARB locale still anchor', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-strings-live') });
      assert.equal(code, 0, out);
      assert.match(out, /'sessionless-signup-reaches-check-inbox' asserted and implemented/);
      assert.match(out, /'locale-actually-switches' asserted and implemented/);
      assert.match(out, /'analytics-lifecycle-complete' asserted and implemented/);
      assert.match(out, /'ui-invariants-inherited' asserted and implemented/);
    });
  });

  // ── `content-pack-consumed` LIMB (d) · THE RAIL NOTHING SHIPPED READS ─────
  //
  // The property is named "consumed" and its third anchor's `what` says
  // "something must actually ASK for a pack". All three anchors are TRUE on the
  // real brick — and the `.load(expectPackId:)` call they find is the body of
  // `contentPackProvider`, a LAZY Riverpod FutureProvider that runs only when
  // something watches it. MEASURED 2026-08-21: `contentPackProvider` has ELEVEN
  // occurrences tree-wide — two declarations, three comment mentions, and six
  // ref-reads, every one of the six inside a `chassis_properties_test.dart`.
  // Zero shipped consumers. (The mentions are why the count must discriminate:
  // a grep would report eleven consumers of a rail with none.)
  //
  // The limb MEASURES and PRINTS. It must never fail the build, because the
  // repair is a brick-template widget edit. It reads BOTH owner gates rather
  // than the one it was pointed at: OWNER_QUEUE S-3's KEY half is OPEN (a key
  // is pinned), but the SHELF — an `r2_buckets` binding in the Worker — is
  // SHUT, so no pack has ever been published. Measuring one gate and concluding
  // about both was the first draft's mistake and is what these cases pin.
  describe('content-pack-consumed limb (d)', () => {
    const PACK_KEYS = 'packages/core/lib/src/content/pack_verifier.dart';
    /** A `kContentPackPublicKeys` map with `n` pinned keys, in the real shape. */
    const keyMap = (n) =>
      'const Map<String, String> kContentPackPublicKeys = <String, String>{\n' +
      Array.from({ length: n }, (_, i) => `  'k${i + 1}': 'zcrBolFZjWixE+0UF0Qbd6T2jUKGkWgAWtJVmYdK6dQ=',\n`).join('') +
      '};\n';

    test('limb (d) PRINTS the unconsumed rail and does not fail the build', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
      assert.equal(code, 0, 'a dead rail is reported, never used to red CI');
      assert.match(out, /content-pack-consumed limb \(d\): ZERO of \d+ Dart file\(s\)/);
    });

    test('limb (d) counts a REAL read and reports the rail consumed', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-read', {
          workspace: WS_WITH_PROBE,
          extra: stampedApp('apps/probe', {
            home: goodHome + '\nfinal pack = ref.watch(contentPackProvider).valueOrNull;\n',
          }),
        }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /content-pack limb \(d\) — 1 of \d+ app lib file\(s\)/);
      assert.match(out, /apps\/probe\/lib\/features\/home\/home_screen\.dart/);
    });

    // 🔴 The case that separates a measurement from a grep, and the shape the
    // real tree is in: the brick's own providers file MENTIONS
    // `contentPackProvider` in a doc comment three lines above declaring it.
    test('🔴 limb (d) counts READS, not mentions — a doc comment is still ZERO', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-mention', {
          workspace: WS_WITH_PROBE,
          extra: stampedApp('apps/probe', {
            home: goodHome + '\n/// `ref.watch(contentPackProvider)` is deliberately NOT called here.\n',
          }),
        }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /content-pack-consumed limb \(d\): ZERO of/);
    });

    // 🔴 …and the DECLARATION must not count as a read. `final
    // FutureProvider<core.ContentPack?> contentPackProvider =` is the line that
    // CREATES the rail; a scan that counted it would report every tree
    // consuming the pack, which is this limb's failure mode written backwards.
    // The fixture already carries that declaration in both providers files, so
    // the ZERO the first case asserts IS this assertion — pinned here by name
    // so a future widening of PACK_READ_RE cannot quietly swallow it.
    test('🔴 limb (d) does not mistake the DECLARATION for a consumer', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-decl-only', { workspace: WS_WITH_PROBE, extra: stampedApp('apps/probe') }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /content-pack-consumed limb \(d\): ZERO of/);
    });

    // ── THE TWO OWNER GATES, each in all three of its states. ────────────────
    //
    // 🔴 TWO, not one, and the first draft of this limb measured only the first
    // and concluded about both — a claim about EVERY gate derived from ONE
    // measurement. OWNER_QUEUE S-3's KEY half is OPEN (a key is pinned); the
    // SHELF — an `r2_buckets` binding in the Worker — is SHUT, so no pack has
    // ever been published. Getting either wrong is a lie about who owes the
    // work: calling an open gate shut blames the owner for agent work, and
    // calling an UNREAD gate shut blames them for a failed read.
    const PACK_SHELF = 'services/platform/wrangler.jsonc';
    /** A wrangler config whose `r2_buckets` array holds `n` bindings. */
    const shelfWith = (n) =>
      '{\n  "name": "platform",\n  "r2_buckets": [\n' +
      Array.from({ length: n }, (_, i) => `    { "binding": "PACKS${i}", "bucket_name": "nikatru-packs" },\n`).join('') +
      '  ]\n}\n';

    test('limb (d) reports the KEY gate OPEN when a key is pinned', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-key-open', { extra: { [PACK_KEYS]: keyMap(1) } }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /OWNER_QUEUE S-3's KEY half IS OPEN — 1 production pack-signing key\(s\) pinned/);
    });

    test('limb (d) reports the KEY gate SHUT when no key is pinned', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-key-shut', { extra: { [PACK_KEYS]: keyMap(0) } }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /OWNER_QUEUE S-3's KEY half IS STILL SHUT: 0 production pack-signing key\(s\)/);
    });

    // 🔴 …and the KEY gate's own prose trap, which is the same act as the shelf's
    // and needs the same kind of input to be a test at all: the real
    // pack_verifier.dart carries a long doc comment ABOUT the key map, and a
    // commented-out example map placed above the live one is what an unstripped
    // parse would read instead — `.match` takes the FIRST hit. Reported as one
    // pinned key over a build that pins none, which is a false OPEN in the
    // direction that blames nobody and lets a dead rail look ready.
    // MUTATION-PROVEN: without the blanking in `pinnedPackKeys` this case
    // reports the key gate OPEN.
    test('🔴 limb (d) reads the KEY gate as structure — a commented-out example map is still SHUT', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-key-prose', {
          extra: {
            [PACK_KEYS]:
              "/// When S-3 lands this becomes, for example:\n" +
              "///   const Map<String, String> kContentPackPublicKeys = <String, String>{\n" +
              "///     'k1': 'zcrBolFZjWixE+0UF0Qbd6T2jUKGkWgAWtJVmYdK6dQ=',\n" +
              '///   };\n' +
              keyMap(0),
          },
        }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /OWNER_QUEUE S-3's KEY half IS STILL SHUT: 0 production pack-signing key\(s\)/);
      assert.doesNotMatch(out, /KEY half IS OPEN/);
    });

    // 🔴 null IS NOT ZERO. An unreadable gate must report as unread, never as
    // shut — `sp-ok` carries no pack_verifier.dart at all, which is exactly
    // that input.
    test('🔴 limb (d) reports an UNREAD key gate as unread, not as shut', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
      assert.equal(code, 0, out);
      assert.match(out, /KEY gate could NOT be read/);
      assert.doesNotMatch(out, /KEY half IS STILL SHUT/);
      assert.doesNotMatch(out, /KEY half IS OPEN/);
    });

    test('limb (d) reports the SHELF OPEN when a bucket is bound — then nothing is owner work', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-shelf-open', { extra: { [PACK_KEYS]: keyMap(1), [PACK_SHELF]: shelfWith(1) } }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /SHELF IS OPEN: 1 R2 bucket\(s\) bound/);
      assert.match(out, /missing consumer, which is\s+agent work/);
    });

    // 🔴 THE PROSE TRAP — and the FIRST VERSION OF THIS CASE COULD NOT FAIL,
    // which is worth recording because it is the exact defect this whole change
    // is about. It fixtured the real file's closing sentence `NO "r2_buckets"
    // YET`, asserted SHUT, and passed. MUTATION-TESTED by stripping the
    // comment-blanking out of `boundPackBuckets`: STILL GREEN. Of course it was
    // — the anchor is `"r2_buckets"` followed by `:` and `[`, and that sentence
    // has neither, so the structural regex alone rejects it and the strip was
    // doing nothing. An assertion that cannot fail inflates apparent coverage.
    //
    // The input that makes the strip load-bearing is the OTHER shape the real
    // file's comment is one edit away from: a COMMENTED-OUT EXAMPLE BINDING.
    // wrangler.jsonc already says "WHEN one is needed: create ONE portfolio
    // bucket and bind it HERE" — the day someone pastes the snippet in as a
    // comment, an unstripped read finds a complete `"r2_buckets": [ { … } ]`
    // and reports the shelf OPEN over a Worker that binds nothing. Now
    // mutation-proven: without the blanking this case reports 1 bucket.
    test('🔴 limb (d) reads the SHELF as structure — a commented-out example binding is still SHUT', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-shelf-prose', {
          extra: {
            [PACK_KEYS]: keyMap(1),
            [PACK_SHELF]:
              '{\n  "name": "platform",\n' +
              '  // NO "r2_buckets" YET. WHEN one is needed it goes here, like this:\n' +
              '  //   "r2_buckets": [ { "binding": "PACKS", "bucket_name": "nikatru-packs" } ]\n' +
              '  "compatibility_date": "2026-08-01"\n}\n',
          },
        }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /SHELF IS SHUT: services\/platform\/wrangler\.jsonc binds 0 R2 bucket\(s\)/);
      assert.doesNotMatch(out, /SHELF IS OPEN/);
    });

    // …and a declared-but-empty array is shut too. A binding list nobody filled
    // in is not a shelf, and this is the input a "the key exists" check passes.
    test('limb (d) reads an EMPTY r2_buckets array as a shut shelf', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-pack-shelf-empty', { extra: { [PACK_KEYS]: keyMap(1), [PACK_SHELF]: shelfWith(0) } }),
      });
      assert.equal(code, 0, out);
      assert.match(out, /SHELF IS SHUT: services\/platform\/wrangler\.jsonc binds 0 R2 bucket\(s\)/);
    });

    // The shelf's own null-is-not-zero case: `sp-ok` carries no wrangler.jsonc.
    test('🔴 limb (d) reports an UNREAD shelf as unread, not as shut', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
      assert.equal(code, 0, out);
      assert.match(out, /SHELF gate could NOT be read/);
      assert.doesNotMatch(out, /SHELF IS SHUT/);
      assert.doesNotMatch(out, /SHELF IS OPEN/);
    });

    // The dead-scanner case, one level up: a count taken over no files at all
    // would print ZERO with the same confidence as a real measurement, and ZERO
    // is the answer this limb exists to interpret. Built with `fixture` rather
    // than `build` because `build` always writes a brick `lib/`, so this input
    // is unreachable through it.
    test('COVERAGE LOST when there is no app lib tree to count over', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: fixture('sp-pack-nolib', { [PROP]: goodTest }),
      });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — no brick `lib\/` and no `apps\/\*\/lib` exists/);
    });
  });

  // ── [research/44 §7 rung 3] — the PROMO CARD, whose off state and whose dead
  //    state are the same collapsed `SizedBox.shrink()`. ──────────────────────
  //
  // 🔴 EIGHT ANCHORS AND EIGHT CASES, and the count is not thoroughness for its
  // own sake: deleting any ONE of them leaves the other seven printing `ok`
  // while the surface stops being what the sworn description says it is. The
  // last three were added after an adversarial review MUTATED THE REAL TREE and
  // found three limbs nothing depended on — the paid-user check came out with
  // all 18 surface rows and all 7 property rows still green, the hydration
  // barrier did not exist at all, and a corrupt record was overwritten with
  // `"suppressed":false` in one launch. Each is broken on its own below,
  // because a case that broke several at once would pass with the rest neutered.
  describe('promo-card-fails-closed', () => {
    const home = (from, to) => ({ home: goodHome.replace(from, to) });
    const providers = (from, to) => ({ providers: goodProviders.replace(from, to) });

    test('FAILS when the card is declared but never MOUNTED', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        // The class survives; only the placement goes. A surface nothing mounts
        // cannot be turned on by a config edit and renders the same nothing.
        cwd: build('sp-promo-unmounted', home('    const UpgradePromoCard(),\n', '')),
      });
      assert.equal(code, 1);
      assert.match(out, /'promo-card-fails-closed' is asserted but its IMPLEMENTATION is gone/);
      assert.match(out, /MOUNTED in the stamped home body/);
    });

    test('FAILS when the on-switch stops being the CONFIG key', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        // `true` compiles, analyzes clean, and turns the card on for every
        // install in the portfolio at once with no config edit anywhere.
        cwd: build(
          'sp-promo-hardcoded',
          home('featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,', 'featureEnabled: true,'),
        ),
      });
      assert.equal(code, 1);
      assert.match(out, /the on-switch must be the CONFIG key/);
    });

    test('FAILS when an empty offer list stops being a refusal', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-promo-nocontent', home('hasContent: offerings.isNotEmpty,', 'hasContent: true,')),
      });
      assert.equal(code, 1);
      assert.match(out, /an eligible user and nothing to promote must be a REFUSAL/);
    });

    test('FAILS when the cancel entry leaves the offer surface — ROSCA parity', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build(
          'sp-promo-nomanage',
          home("onManageAction: () => context.go('/manage-plan'),", ''),
        ),
      });
      assert.equal(code, 1);
      assert.match(out, /ROSCA parity/);
    });

    // 🔴 THE MUTATION THE ANCHOR WAS WRITTEN AGAINST. `?? const PromoGateState()`
    // also contains `valueOrNull`, so an anchor pointed at the read rather than
    // at the NULL TEST would accept this — and it puts a promotional card in
    // front of a user holding an Art 21 objection for the whole duration of the
    // disk read, a window every `pumpAndSettle()` hides.
    test('FAILS when the hydration barrier degrades to a default record', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build(
          'sp-promo-nohydration',
          home(
            'if (stored == null) return const SizedBox.shrink();',
            'stored ??= const core.PromoGateState();',
          ),
        ),
      });
      assert.equal(code, 1);
      assert.match(out, /the HYDRATION BARRIER/);
    });

    test('FAILS when a user who has already PAID can still be promoted to', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        // Deleting the whole guard clause, which is how it survived: every
        // promo test in both suites stayed green, because the row carrying its
        // name asserted the card SHOWED, for an unpaid user.
        cwd: build(
          'sp-promo-paid',
          home(
            'if ((cfg?.paywall.enabled ?? false) && !ref.watch(paywallLockedProvider)) {\n      return const SizedBox.shrink();\n    }',
            '',
          ),
        ),
      });
      assert.equal(code, 1);
      assert.match(out, /a user who has ALREADY PAID must not be promoted to/);
    });

    test('FAILS when an arriving latch is overwritten by the impression', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        // Writing the decision through verbatim erases a GDPR Art 21 objection
        // that landed from storage while the impression was in flight.
        cwd: build(
          'sp-promo-latch',
          providers('    if (current.dismissed || current.suppressed) return;\n', ''),
        ),
      });
      assert.equal(code, 1);
      assert.match(out, /a latch that arrived from storage while an impression was in flight must WIN/);
    });

    // ⚠️ `replaceAll`, AND THE HONEST READING OF WHAT THAT MEANS. Both the real
    // controller and this fixture guard TWO writes with `if (!_recordRead)
    // return;`, and this is a PRESENCE anchor: it fails when no write is
    // guarded, not when one of the two loses its guard. That is the limit of
    // what a text anchor can claim here, and it is written down rather than
    // implied — an anchor whose stated reach exceeds its real one is the same
    // inflation as an assertion that cannot fail.
    test('FAILS when a write can land on a record we failed to READ', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-promo-unread', {
          providers: goodProviders.replaceAll('    if (!_recordRead) return;\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /no write may land on a record we failed to read/);
    });

    test('FAILS when the inherited assertion group is dropped', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('sp-promo-nogroup', {
          propTest: goodTest.replace(
            "group('property: promo-card-fails-closed'",
            "group('property: promo-card-ish'",
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /'promo-card-fails-closed' is NOT asserted/);
    });
  });

  // ── [pipeline 8]K-6 — the in-app legal set equals the published legal set. ─
  // The defect: two declared URLs against four published pages, with nothing
  // comparing them, so every stamped app shipped without the refund policy.
  // A RELATIONSHIP in both directions, never a count — so both directions get
  // a failing input here, as do all three COVERAGE-LOST self-checks.
  describe('the legal set is a relationship, not a count', () => {
    test('names the legal set on the happy path', () => {
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('legal-ok') });
      assert.equal(code, 0, out);
      assert.match(out, /\[8\]K-6 legal set: 3 published page\(s\) linked in the chassis/);
      assert.match(out, /1 reached by an in-app control instead/);
    });

    // DIRECTION 1 — the site publishes a page the chassis does not link. This
    // is the live defect, reproduced: refund.html published, no `refundUrl`.
    test('FAILS when the site publishes a legal page the chassis never links', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-unlinked', {
          appConfig: goodAppConfig.replace(
            "  static const String refundUrl = 'https://nikatru.com/refund';\n",
            '',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /publishes 'refund\.html' and .* declares no URL for it/);
    });

    // DIRECTION 2 — the chassis links a page the site does not publish, which
    // is a 404 in front of a user looking for the refund policy.
    test('FAILS when the chassis links a page the site does not publish', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-404', {
          siteIntegrity: legalPages(['privacy.html', 'terms.html', 'delete-account.html']),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /does not publish it\. Every stamped app would send a user to a 404/);
    });

    // A CONSTANT IS NOT A LINK. Declaring `refundUrl` and never putting it on a
    // screen leaves the page as unreachable as not declaring it, while making
    // both set-equality directions above go green.
    test('FAILS when a declared legal URL is never opened from settings', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-unlinked-ui', {
          legalLinks: goodLegalLinks.replace('onTap: () => _openUrl(AppConfig.refundUrl),\n', ''),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /declares 'refundUrl' for 'refund\.html' but .* never opens it/);
    });

    // The parse is off the DECLARATION. The fixture's prose names both
    // pricing.html and refund.html; a grep would "find" a set the array does
    // not contain, which is exactly how a CORS guard once matched a comment
    // explaining an absence.
    test('COVERAGE LOST when LEGAL_PAGES cannot be parsed, prose notwithstanding', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-unparseable', {
          siteIntegrity:
            '// LEGAL_PAGES used to be here and named privacy.html, terms.html,\n' +
            '// refund.html and delete-account.html in this very comment.\n' +
            'const PAGES_LEGAL = [];\n',
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — could not parse LEGAL_PAGES/);
    });

    test('COVERAGE LOST when LEGAL_PAGES parses as EMPTY', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-empty', { siteIntegrity: legalPages([]) }),
      });
      assert.equal(code, 1);
      assert.match(out, /LEGAL_PAGES parsed as EMPTY/);
    });

    // An exemption list that has eaten its own domain is the self-disabling
    // shape this whole guard exists to catch: every published page exempt means
    // the set equality ranges over nothing and reports clean.
    test('COVERAGE LOST when every published page is link-exempt', () => {
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-all-exempt', {
          siteIntegrity: legalPages(['delete-account.html']),
          // …and the chassis links nothing, or DIRECTION 2 fires first and this
          // case would pass for the wrong reason.
          appConfig: 'class AppConfig {\n  static const String companyUrl = 1;\n}\n',
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /every published legal page is on the link-exemption list/);
    });

    test('🔴 COVERAGE LOST when the URL FORM drifts and no constant parses', () => {
      // The exact regression this floor exists for. On 2026-08-21 the site's
      // canonical form went extension-less and the pattern that reads these
      // constants had to move with it. Had it not, it would have matched ZERO
      // constants against a brick still full of them, and the in-app half of the
      // set equality would have been silently empty while every line above it
      // went on printing a result.
      const { code, out } = run('assert-stamp-properties.mjs', {
        cwd: build('legal-form-drift', {
          appConfig: goodAppConfig
            .replace("nikatru.com/privacy'", "nikatru.com/privacy.html'")
            .replace("nikatru.com/terms'", "nikatru.com/terms.html'")
            .replace("nikatru.com/refund'", "nikatru.com/refund.html'"),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /the in-app half of the set equality below is EMPTY/);
    });

    test('COVERAGE LOST when the published list is unreadable at all', () => {
      const files = build('legal-gone');
      rmSync(join(files, SITE_INTEGRITY), { force: true });
      const { code, out } = run('assert-stamp-properties.mjs', { cwd: files });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — tooling\/ci\/check-site-integrity\.mjs unreadable/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-responsive-coverage', () => {
  const LIB = 'apps/subly/lib';
  const ROUTER = `${LIB}/core/router.dart`;
  const TEST = 'apps/subly/test';

  // 🔴 THE FIXTURE MIRRORS THE SHAPE OF THE REAL TREE, NOT A MINIATURE OF IT.
  // The guard carries a REQUIRED_COVERAGE floor of 19 surfaces and 16 width test
  // files, so a three-screen fixture would fail every case for a reason that has
  // nothing to do with the behaviour under test — and a case that passes for the
  // wrong reason is the same defect as one that cannot fail. Same reason the
  // check-migrations and assert-stamp-properties fixtures above are full-size.
  //
  // ⚠️ THIS TRACKS THE FLOOR AND MUST BE MOVED WITH IT. When the floor was
  // re-measured 17 → 18 on 2026-08-11, `N` went 14 → 15 and the fixture's
  // `responsive_width_test.dart` took a third subject, because every positive
  // case here trips COVERAGE LOST the moment the fixture has fewer surfaces
  // than the floor demands. A fixture sized to yesterday's floor fails for a
  // reason that has nothing to do with what any of these cases assert.
  //
  // 16 since later the same day: the floor moved 18 → 19 when `/reset-password`
  // landed, so `N` follows 15 → 16. This is the second half of the two-file act
  // — raising a REQUIRED_COVERAGE floor and leaving its fixture behind turns
  // every positive case in this block red for a reason unrelated to the case,
  // and that has now happened twice in one day (see the MIN_PRESENT 23 → 24
  // bump in screen-set.test.mjs, which cost four cases).
  //
  // 🔴 AND IT CARRIES A `PaywallScreen` AT THE REAL PATH, measured at two widths
  // and not three. WIDTH_EXEMPT names that surface, and an exemption's own
  // self-check is that the surface EXISTS in the covered set — so a fixture
  // without one would fail every case here on the guard's own bookkeeping. The
  // shape being modelled is the argued exemption, which is why the paywall
  // fixture pumps kPhone and kTablet and stops.
  const N = 16;
  const ids = Array.from({ length: N }, (_, i) => i + 1);
  const screenFile = (i, dir = `s${i}`) => `${LIB}/features/${dir}/s${i}_screen.dart`;
  const screenSrc = (i) => `class S${i}Screen extends StatelessWidget {\n  const S${i}Screen({super.key});\n}\n`;
  const sheetFile = (n) => `${LIB}/features/${n}/${n}_sheet.dart`;
  const sheetSrc = (fn) =>
    `Future<void> ${fn}(BuildContext context) {\n  return showModalBottomSheet<void>(context: context, builder: (_) => const SizedBox());\n}\n`;
  const PAYWALL = `${LIB}/features/monetization/paywall_screen.dart`;
  const HARNESS = `${TEST}/support/width_harness.dart`;

  /** The window vocabulary. The guard reads the required widths OUT of this file
   *  rather than restating them, so the fixture must declare it or every surface
   *  passes the width check by default — which is the empty-parse limb below. */
  const harnessSrc =
    `const Size kPhone = Size(375, 812);\n` +
    `const Size kTablet = Size(768, 1024);\n` +
    `const Size kDesktop = Size(1280, 900);\n` +
    `const Size kWide = Size(1920, 1080);\n`;

  /** A test file that imports feature paths and pumps the named subjects at
   *  every required window class, plus kWide. */
  const testSrc = (imports, uses, widths = ['kPhone', 'kTablet', 'kDesktop', 'kWide']) =>
    `${imports.map((p) => `import 'package:subly/${p}';`).join('\n')}\n\nimport 'support/width_harness.dart';\n\nvoid main() {\n` +
    `${uses
      .flatMap((u) => widths.map((w) => `  testWidgets('at ${w}', (t) async { await pumpAt(t, ${w}, ${u}); });`))
      .join('\n')}\n}\n`;

  /** The router. `extra` adds routes; `shell`/`error` model the two non-panes. */
  const routerSrc = ({ screens = ids, extra = '', shell = true, error = true, wrapped = [] } = {}) => {
    const imports = screens
      .map((i) => `import '../features/s${i}/s${i}_screen.dart';`)
      .concat(`import '../features/monetization/paywall_screen.dart';`)
      .join('\n');
    const plain = screens
      .filter((i) => !wrapped.includes(i))
      .map((i) => `    GoRoute(path: '/s${i}', builder: (_, __) => const S${i}Screen()),`)
      .join('\n');
    const gatedRoutes = wrapped
      .map((i) => `    GoRoute(path: '/s${i}', builder: (_, __) => const _Gated${i}()),`)
      .join('\n');
    const gatedClasses = wrapped
      .map(
        (i) =>
          `class _Gated${i} extends ConsumerWidget {\n  const _Gated${i}();\n  @override\n  Widget build(BuildContext context, WidgetRef ref) {\n    return PaywallGate(locked: false, child: const S${i}Screen());\n  }\n}\n`,
      )
      .join('\n');
    return (
      `${imports}\n\nfinal Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {\n  return GoRouter(\n` +
      (error ? `    errorBuilder: (BuildContext c, GoRouterState s) => NotFoundScreen(title: 'x'),\n` : '') +
      `    routes: <RouteBase>[\n      GoRoute(path: '/', redirect: (_, __) => '/s1'),\n` +
      `      GoRoute(path: '/paywall', builder: (_, __) => const PaywallScreen()),\n${plain}\n${gatedRoutes}\n${extra}\n` +
      (shell
        ? `      StatefulShellRoute.indexedStack(\n        builder: (_, __, StatefulNavigationShell n) => AppShell(navigationShell: n),\n        branches: <StatefulShellBranch>[],\n      ),\n`
        : '') +
      `    ],\n  );\n});\n\n${gatedClasses}`
    );
  };

  /** The whole app tree: N screens + the paywall, 2 sheets, and 16 width tests
   *  covering all 18. */
  const build = (name, over = {}, routerOpts = {}) => {
    const files = {
      'pubspec.yaml': 'name: nikatru_workspace\npublish_to: none\n\nworkspace:\n  - apps/subly\n',
      'apps/subly/pubspec.yaml': 'name: subly\n',
      [ROUTER]: routerSrc(routerOpts),
      [HARNESS]: harnessSrc,
      [sheetFile('add')]: sheetSrc('showAddSheet'),
      [sheetFile('cancel')]: sheetSrc('showCancelSheet'),
      [PAYWALL]: `class PaywallScreen extends StatelessWidget {\n  const PaywallScreen({super.key});\n}\n`,
      // Two widths, not three — the surface WIDTH_EXEMPT argues about.
      [`${TEST}/width_paywall_test.dart`]: testSrc(
        ['features/monetization/paywall_screen.dart'],
        ['const PaywallScreen()'],
        ['kPhone', 'kTablet'],
      ),
    };
    for (const i of ids) files[screenFile(i)] = screenSrc(i);
    // 13 single-subject files + one three-subject file + one sheets file + the
    // paywall file above = 16, which is the floor. It was 12 + s13/s14/s15 = 15
    // until 2026-08-11, when `/reset-password` moved the floor to 19/16: the
    // extra SURFACE comes from `N` and the extra FILE has to come from
    // somewhere, so s13 was promoted to its own file rather than the shared one
    // growing a fourth subject — the file COUNT is what the floor measures, and
    // a fourth subject in one file would have left it at 15.
    for (const i of ids.slice(0, 13)) {
      files[`${TEST}/width_s${i}_test.dart`] = testSrc([`features/s${i}/s${i}_screen.dart`], [`const S${i}Screen()`]);
    }
    files[`${TEST}/responsive_width_test.dart`] = testSrc(
      [`features/s14/s14_screen.dart`, `features/s15/s15_screen.dart`, `features/s16/s16_screen.dart`],
      ['const S14Screen()', 'const S15Screen()', 'const S16Screen()'],
    );
    files[`${TEST}/width_sheets_test.dart`] = testSrc(
      ['features/add/add_sheet.dart', 'features/cancel/cancel_sheet.dart'],
      ['showAddSheet(context)', 'showCancelSheet(context)'],
    );
    return fixture(name, { ...files, ...over });
  };

  test('PASSES when the routed set and the measured set are EQUAL', () => {
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-ok') });
    assert.equal(code, 0);
    assert.match(out, /apps\/subly: 19 surface\(s\) reachable, 19 measured/);
    assert.match(out, /the two sets are EQUAL/);
    assert.match(out, /apps\/subly: every measured surface is pumped at kPhone \(375\), kTablet \(768\), kDesktop \(1280\)/);
  });

  test('PRINTS its exclusions with reasons on a PASSING run, never silently', () => {
    // The whole point of an exclusion being printed: a green run still shows
    // what was left out, so it can be re-argued by anyone reading the log. An
    // unmet clause that produces no output is this corpus's named defect.
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-excl') });
    assert.equal(code, 0);
    assert.match(out, /DELIBERATELY OUTSIDE the domain/);
    assert.match(out, /AppShell — is the shell CHROME/);
    assert.match(out, /NotFoundScreen — is the errorBuilder surface/);
    assert.match(out, /REDIRECT-ONLY/);
  });

  test('FAILS naming the SCREEN when a routed screen has no width test', () => {
    // A 17th routed screen with no test. The floor is untouched (20 >= 19) and
    // the test-file count is untouched, so the ONLY failure is the uncovered one.
    //
    // ⚠️ 17, NOT 16, SINCE 2026-08-11. This index has to be the first one BEYOND
    // `ids`, and `N` moved 15 → 16 with the floor. Left at 16 it collided with a
    // real fixture screen and the guard reported AMBIGUOUS SURFACE — a genuine
    // finding about a duplicate import, but not the one this case exists to
    // prove, so the case passed its exit code and asserted the wrong message.
    const dir = build(
      'rc-uncovered',
      { [screenFile(17)]: screenSrc(17) },
      { screens: [...ids, 17] },
    );
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /UNCOVERED SURFACE — `S17Screen`/);
  });

  test('FAILS naming the SUBJECT when a width test measures an unrouted twin', () => {
    // 🔴 THE TWIN, VERBATIM. `features/firstrun/s1_screen.dart` declares a class
    // called `S1Screen` — the SAME NAME as the routed one — and a width test
    // pumps it. A guard comparing bare class names would find `S1Screen` in both
    // sets and report clean, writing the exact bug it exists to catch into its
    // own answer. Keying by `<file>#<Symbol>` is what makes this red.
    const dir = build('rc-twin', {
      [screenFile(1, 'firstrun')]: screenSrc(1),
      [`${TEST}/width_twin_test.dart`]: testSrc(['features/firstrun/s1_screen.dart'], ['const S1Screen()']),
    });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /DEAD COVERAGE — width_twin_test\.dart measures `S1Screen`/);
    assert.match(out, /features\/firstrun\/s1_screen\.dart/);
    // …and the routed original is still covered, so the ONLY complaint is the twin.
    assert.doesNotMatch(out, /UNCOVERED SURFACE/);
  });

  // ── THE WIDTHS THE MEASUREMENT ACTUALLY PUMPS ───────────────────────────────
  // Set equality asks whether a FILE exists. These ask what is in it, which is
  // the gap `width_home_test.dart` sat in: present in both sets, green, and
  // pumping neither 768 nor 1280.
  test('FAILS naming the SURFACE and the WINDOW when a required width is absent', () => {
    const dir = build('rc-width-gap', {
      // The subject and its file are untouched — only the 768 case goes. Both
      // sets still contain it, so the equality limb stays silent and this is
      // the only complaint.
      [`${TEST}/width_s3_test.dart`]: testSrc(
        ['features/s3/s3_screen.dart'],
        ['const S3Screen()'],
        ['kPhone', 'kDesktop', 'kWide'],
      ),
    });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /UNMEASURED WIDTH — `S3Screen`/);
    assert.match(out, /not one case pumps kTablet \(768\)/);
    assert.match(out, /widths it does pump are 375, 1280, 1920/);
    assert.doesNotMatch(out, /UNCOVERED SURFACE/);
    assert.doesNotMatch(out, /DEAD COVERAGE/);
  });

  test('a NAMED window class is not a PUMPED one — prose cannot satisfy the check', () => {
    // 🔴 THE `r2_buckets` SHAPE, ONE LEVEL UP. Two real width tests carry the
    // word `kTablet`/`kWide` inside an `expect` reason arguing why a case is
    // ABSENT. If string literals were not stripped, an explanation of a missing
    // measurement would count as the measurement.
    const dir = build('rc-width-prose', {
      [`${TEST}/width_s4_test.dart`]:
        `import 'package:subly/features/s4/s4_screen.dart';\n\nimport 'support/width_harness.dart';\n\n` +
        `void main() {\n` +
        `  // kTablet is deliberately omitted, see below.\n` +
        `  testWidgets('at kPhone', (t) async {\n` +
        `    await pumpAt(t, kPhone, const S4Screen());\n` +
        `    expect(x, y, reason: 'no kTablet case: pumpAt(t, kTablet, const S4Screen()) would be a no-op');\n` +
        `  });\n` +
        `  testWidgets('at kDesktop', (t) async { await pumpAt(t, kDesktop, const S4Screen()); });\n}\n`,
    });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /UNMEASURED WIDTH — `S4Screen`/);
    assert.match(out, /not one case pumps kTablet \(768\)/);
  });

  test('FAILS as STALE when an exempted surface starts pumping the width anyway', () => {
    // The exemption's own self-check, and the half that is easy to omit: an
    // exception nobody can retire is a permanent hole with a reason attached.
    const dir = build('rc-width-stale', {
      [`${TEST}/width_paywall_test.dart`]: testSrc(
        ['features/monetization/paywall_screen.dart'],
        ['const PaywallScreen()'],
        ['kPhone', 'kTablet', 'kDesktop'],
      ),
    });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /STALE EXEMPTION — `PaywallScreen`/);
    assert.match(out, /now pumps it/);
  });

  test('the argued width exemption is PRINTED on a passing run, never silently', () => {
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-width-excl') });
    assert.equal(code, 0);
    assert.match(out, /PaywallScreen is NOT required at kDesktop/);
  });

  test('COVERAGE LOST when the harness is gone — the required widths resolve to NOTHING', () => {
    // Without this limb an unreadable harness makes every surface pass the
    // width check by default, which prints as a clean run.
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-noharness', { [HARNESS]: null }) });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares NO .* window class/);
  });

  test('FAILS when the harness stops declaring a window class the floor requires', () => {
    const dir = build('rc-noclass', {
      [HARNESS]: harnessSrc.replace('const Size kDesktop = Size(1280, 900);\n', ''),
    });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /`kDesktop` is required of every responsive surface and `apps\/subly` declares it nowhere/);
  });

  test('COVERAGE LOST when the router is gone — the routed set parses EMPTY', () => {
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-norouter', { [ROUTER]: null }) });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /router\.dart does not exist/);
  });

  test('COVERAGE LOST when no width test is found — the covered set parses EMPTY', () => {
    // Every width test removed. Without this limb the equality check would say
    // "no dead coverage" and mean nothing by it.
    const over = {
      [`${TEST}/responsive_width_test.dart`]: null,
      [`${TEST}/width_sheets_test.dart`]: null,
      [`${TEST}/width_paywall_test.dart`]: null,
    };
    for (const i of ids.slice(0, 13)) over[`${TEST}/width_s${i}_test.dart`] = null;
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-notests', over) });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — `apps\/subly` has 0 measured surface\(s\) and its measured floor is 19/);
  });

  test('FAILS when a route builds something this guard cannot classify', () => {
    // Not a feature surface and not one of the two argued non-panes. The map is
    // a statement about known non-panes, NOT an allowlist screens can join, so
    // the honest answer to "what is this?" is to stop the build.
    const dir = build('rc-unknown', {}, { extra: `      GoRoute(path: '/x', builder: (_, __) => const MysteryPane()),` });
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /`MysteryPane` is built by a route/);
  });

  test('FAILS when NOT_A_PANE excuses something the router no longer builds', () => {
    // The exclusion map's own self-check: an exception for something that is not
    // there reports judgement over nothing.
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-staleexcl', {}, { shell: false }) });
    assert.equal(code, 1);
    assert.match(out, /`AppShell` is excluded in NOT_A_PANE for `apps\/subly` but no route/);
  });

  test('resolves a router-local wrapper to the SCREEN it gates, not to the wrapper', () => {
    // `_Gated3` is a gate declared in the router; the pane is `S3Screen`. The
    // covering test pumps the screen, so a guard that stopped at the wrapper
    // would report `_Gated3` uncovered on a tree that is fully measured.
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: build('rc-wrapper', {}, { wrapped: [3] }) });
    assert.equal(code, 0);
    assert.doesNotMatch(out, /_Gated3/);
  });

  test('FAILS when a router-local wrapper gates NO feature surface', () => {
    const dir = build('rc-wrapper-empty', {}, { wrapped: [] });
    // A wrapper that builds only design-system widgets: routed, and nothing
    // measurable can be pointed at.
    //
    // 🔴 THE REPLACEMENT IS ASSERTED. The first draft of this case used the
    // wrong indentation, so `.replace` matched nothing and returned the string
    // unchanged — the fixture then asserted a failure on a tree it had never
    // mutated, and read as "the guard does not catch this". A silent no-op
    // mutation is indistinguishable from a guard that missed it.
    const before = readFileSync(join(dir, ROUTER), 'utf8');
    const routed = `GoRoute(path: '/s4', builder: (_, __) => const S4Screen()),`;
    assert.ok(before.includes(routed), 'fixture anchor moved — the mutation would be a no-op');
    const src = before
      .replace(routed, `GoRoute(path: '/s4', builder: (_, __) => const _Hollow()),`)
      .concat(`\nclass _Hollow extends StatelessWidget {\n  const _Hollow();\n  @override\n  Widget build(BuildContext context) {\n    return const SizedBox();\n  }\n}\n`);
    writeFileSync(join(dir, ROUTER), src);
    const { code, out } = run('assert-responsive-coverage.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /`_Hollow` is a route builder declared inside/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A UNION FLOOR IS NOT A COVERAGE CHECK — assert-no-price-literals.mjs and
// assert-pseudonymity-firewall.mjs.
//
// Both guards floored ONE NUMBER over the union of their scan roots, so a root
// contributing nothing was absorbed by a sibling's count. Measured on a scratch
// copy of the tracked tree, 2026-08-26, with `apps/` DELETED:
//   · assert-no-price-literals    printed "scan reaches 128 non-test dart
//     file(s)" and "no price literals in shipping source", exit 0.
//   · assert-pseudonymity-firewall printed "ok  scan reaches 194 dart file(s)"
//     and resolved all four REQUIRED_EVENTS against the brick's copy of the
//     paywall, exit 0 — 121 of 315 dart files gone, nothing said.
// Both now assert PER ROOT, over roots derived from the `workspace:` block and
// from the directories present under each scan root.
// ─────────────────────────────────────────────────────────────────────────────
describe('per-root coverage — a root that contributes nothing is named', () => {
  const BRICK_PAYWALL =
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/monetization/paywall_screen.dart';

  const OFFERING = [
    'class Offering {',
    '  final int amountMinor;',
    '  final String currencyCode;',
    '',
    '  String get formattedPrice {',
    '    final String major = (amountMinor / 100).toStringAsFixed(2);',
    '    return _symbols[currencyCode] ?? major;',
    '  }',
    '',
    "  static const Map<String, String> _symbols = <String, String>{'USD': 'usd'};",
    '}',
  ].join('\n');

  const FUNNEL = [
    'class MoneyFunnel {',
    "  Future<void> onPaywallViewed(String trigger) => _log('paywall_viewed');",
    "  Future<void> onCheckoutStarted(String sku) => _log('checkout_started');",
    "  Future<void> onPurchaseSuccess(String sku) => _log('purchase_success');",
    "  Future<void> onPurchaseFailed(String reason) => _log('purchase_failed');",
    '}',
  ].join('\n');

  const CALLERS = [
    'class PaywallScreen extends StatelessWidget {',
    '  Future<void> buy(Offering offering) async {',
    "    await funnel.onPaywallViewed('gate');",
    "    await funnel.onCheckoutStarted('sku');",
    "    await funnel.onPurchaseSuccess('sku');",
    "    await funnel.onPurchaseFailed('declined');",
    '    render(offering.formattedPrice);',
    '  }',
    '}',
  ].join('\n');

  /** A tree that satisfies both guards' other limbs, so each case below is
   *  measuring per-root coverage and nothing else. `appDart` false is the
   *  mutation: `apps/subly` is still a declared workspace member and still the
   *  only thing under `apps/`, but it contributes no dart file. */
  function tree(name, { appDart = true, tokensDart = false } = {}) {
    const files = {
      'pubspec.yaml': rootPubspec(['packages/core', 'packages/purchases', 'apps/subly']),
      [BRICK_PAYWALL]: CALLERS,
      'packages/purchases/lib/src/offering.dart': OFFERING,
      'packages/purchases/lib/src/money_funnel.dart': FUNNEL,
      // A Node package under packages/ with no dart in it at all — the shape the
      // guards' NO_DART / NO_SOURCE declaration exists for.
      'packages/tokens/package.json': '{"name":"tokens"}\n',
    };
    // Enough filler to clear BOTH union floors (40 dart, 80 dart/ts/sql) from a
    // single root — which is precisely why the floors cannot see a quiet one.
    for (let i = 0; i < 70; i += 1) {
      files[`packages/core/lib/src/filler_${i}.dart`] = `class Filler${i} {}\n`;
    }
    for (let i = 0; i < 20; i += 1) {
      files[`services/platform/src/filler_${i}.ts`] = `export const f${i} = ${i};\n`;
    }
    if (appDart) files['apps/subly/lib/app.dart'] = CALLERS;
    if (tokensDart) files['packages/tokens/lib/generated.dart'] = 'class Tokens {}\n';
    return fixture(name, files);
  }

  for (const guard of ['assert-no-price-literals.mjs', 'assert-pseudonymity-firewall.mjs']) {
    const short = guard.replace('assert-', '').replace('.mjs', '');

    test(`${short} — PASSES when every derived root contributes`, () => {
      const { code, out } = run(guard, { args: [tree(`proot-ok-${short}`)] });
      assert.equal(code, 0, out);
      assert.match(out, /per root|per-root coverage/);
      assert.match(out, /apps\/subly \(1\)/);
    });

    test(`🔴 ${short} — COVERAGE LOST names apps/subly when it contributes nothing`, () => {
      const { code, out } = run(guard, { args: [tree(`proot-quiet-${short}`, { appDart: false })] });
      assert.equal(code, 1, out);
      assert.match(out, /COVERAGE LOST — apps\/subly contributed ZERO/);
      // The union floor stayed green throughout: that is the defect, not a
      // second symptom of it.
      assert.doesNotMatch(out, /COVERAGE LOST — scanned only/);
      assert.doesNotMatch(out, /COVERAGE LOST — the pairing scan reaches only/);
    });

    test(`${short} — a root DECLARED dart-free is not reported quiet`, () => {
      const { out } = run(guard, { args: [tree(`proot-declared-${short}`)] });
      assert.doesNotMatch(out, /packages\/tokens contributed ZERO/);
      assert.match(out, /declared (dart|source)-free: packages\/tokens/);
    });

    test(`🔴 ${short} — the dart-free declaration goes stale when the root grows dart`, () => {
      // An exemption for a root that no longer needs one inflates apparent
      // coverage, and hides the day that root starts mattering.
      const { code, out } = run(guard, {
        args: [tree(`proot-stale-${short}`, { tokensDart: true })],
      });
      assert.equal(code, 1, out);
      assert.match(out, /`packages\/tokens` is declared (dart|source)-free/);
    });
  }

  test('🔴 pseudonymity-firewall — a services root that contributes nothing is named', () => {
    // The 80-file floor is a union over dart AND ts AND sql, and the dart side
    // alone clears it many times over.
    const dir = tree('proot-svc');
    rmSync(join(dir, 'services', 'platform', 'src'), { recursive: true, force: true });
    mkdirSync(join(dir, 'services', 'platform', 'src'), { recursive: true });
    const { code, out } = run('assert-pseudonymity-firewall.mjs', { args: [dir] });
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — services\/platform contributed ZERO/);
  });
});
