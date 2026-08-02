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
// Pipeline requirement: company/pipeline/01-foundation.md → F-10.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"   (glob, so every *.test.mjs runs;
//       a bare directory path is treated as a module on Windows and throws)
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
  const build = (name, platformSql, brickSql = ADDITIVE, extra = {}) =>
    fixture(name, {
      'services/platform/migrations/0001_init.sql': platformSql,
      'services/subly-api/migrations/0001_init.sql': ADDITIVE,
      'tooling/bricks/app/__brick__/svc/migrations/0001_init.sql': brickSql,
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

  /** Both Workers, each overridable. Anything less is not a valid tree — the
   *  guard is supposed to insist that every service it knows about is present. */
  const build = (name, { platform = config(PLATFORM), subly = config(SUBLY), extra = {} } = {}) =>
    fixture(name, {
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
  const REQUIRED = ['index.html', '404.html', 'robots.txt', '_headers'];
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
  const wf = (uses, { withPermissions = true } = {}) =>
    `name: X\non: push\n${withPermissions ? 'permissions:\n  contents: read\n' : ''}jobs:\n  j:\n    steps:\n` +
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
        `name: X\npermissions:\n  contents: read\njobs:\n  j:\n    steps:\n      # was uses: actions/checkout@v4\n` +
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
        files[`.github/workflows/${f}.yml`] = 'name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    steps:\n      - run: echo hi\n';
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
        b: `name: X\non: push\npermissions: write-all\njobs:\n  j:\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-writeall', files)] });
      assert.equal(code, 1);
      assert.match(out, /b\.yml sets `permissions: write-all` at the workflow level/);
      assert.match(out, /b\.yml:3 `permissions: write-all` grants every scope/);
    });

    test('FAILS on JOB-level `permissions: write-all` too — the same blast radius, one indent in', () => {
      const files = three({
        c: `name: X\non: push\npermissions:\n  contents: read\njobs:\n  j:\n    permissions: write-all\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-writeall-job', files)] });
      assert.equal(code, 1);
      assert.match(out, /c\.yml:7 `permissions: write-all` grants every scope/);
    });

    test('`read-all` is least-privilege enough to pass', () => {
      const files = three({
        a: `name: X\non: push\npermissions: read-all\njobs:\n  j:\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-readall', files)] });
      assert.equal(code, 0, out);
    });

    test('a workflow-level WRITE scope is PRINTED, not blocked — deploy-web.yml needs one today', () => {
      // Printed rather than pretended-checked: blocking it would make the build
      // red on arrival, and a rule added red gets deleted rather than fixed.
      const files = three({
        a: `name: X\non: push\npermissions:\n  contents: read\n  deployments: write\njobs:\n  j:\n    steps:\n` +
          Array.from({ length: 4 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      });
      const { code, out } = run('assert-workflow-hardening.mjs', { args: [fixture('wh-write-scope', files)] });
      assert.equal(code, 0, out);
      assert.match(out, /a\.yml grants `deployments: write` at the WORKFLOW level/);
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

  const build = (name, opts = {}) => {
    const { wranglerPin = DECL.wrangler, brick = true, ...wfOpts } = opts;
    const files = { 'tooling/versions.json': JSON.stringify(DECL), '.github/workflows/ci.yml': wf(wfOpts) };
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
    // The brick is present (its absence is a DIFFERENT COVERAGE LOST, tested
    // below), so the only failure here is the MIN_OCCURRENCES floor itself.
    const dir = fixture('vc-cov', {
      'tooling/versions.json': JSON.stringify(DECL),
      '.github/workflows/ci.yml': `name: X\njobs:\n  j:\n    steps:\n      - run: echo hi\n`,
      [BRICK]: brickPkg(DECL.wrangler),
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — matched 1 version reference/);
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
});

// ─────────────────────────────────────────────────────────────────────────────
// The behaviour that matters most is "the wrapper FAILS when the scanner stops
// detecting" — which cannot be exercised with the real binary, because a working
// gitleaks always detects. These substitute stub scanners with known behaviour.
describe('scan-secrets', () => {
  const PEM = 'BEGIN RSA PRIVATE KEY';

  /** A faithful stub: exits 1 (finding) iff the scanned dir holds one of the
   *  shapes the REAL rule set detects. It must know all of them — the wrapper now
   *  plants one canary per rule, so a stub that only understands PEM would report
   *  "clean" for the Cloudflare and Supabase canaries and the self-test would fail
   *  for a reason that has nothing to do with the code under test.
   *
   *  Matched by REGEX WITH A LENGTH FLOOR, not by substring, for the same reason
   *  the real rules are prefix-anchored: the fixture's own .gitleaks.toml contains
   *  the bare prefixes inside its regex strings, and a substring stub would find
   *  those and report a "leak" in a clean tree. */
  const HONEST = `
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-stub'); process.exit(0); }
const src = a[a.indexOf('--source') + 1];
const walk = (d) => readdirSync(d).flatMap((e) => {
  const p = join(d, e);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const SHAPES = [
  /${PEM}/,
  /\\b(cfut|cfat|cfk)_[A-Za-z0-9_-]{30,}/,
  /\\bsbp_[A-Za-z0-9]{36,}/,
  /\\bsb_secret_[A-Za-z0-9_-]{20,}/,
  /\\bpdl_ntfset_[A-Za-z0-9]{20,}/,
  /\\bpdl_live_apikey_[A-Za-z0-9]{20,}/,
  /\\bpdl_sdbx_apikey_[A-Za-z0-9]{20,}/,
];
let hit = false;
for (const f of walk(src)) {
  try { const t = readFileSync(f, 'utf8'); if (SHAPES.some((r) => r.test(t))) hit = true; } catch {}
}
if (hit) { console.log('finding: a known secret shape'); process.exit(1); }
process.exit(0);
`;

  /** A scanner that has silently stopped detecting — always reports clean. */
  const BLIND = `
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-blind'); process.exit(0); }
process.exit(0);
`;

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
      // which is two of this repo's three vendors. It also asserts one canary per
      // rule, so the rule COUNT here must match the wrapper's custom canaries.
      'repo/.gitleaks.toml': [
        'title = "fixture"',
        '[extend]',
        'useDefault = true',
        '[[rules]]',
        'id = "nikatru-cloudflare-api-token"',
        "regex = '''\\b(cfut|cfat|cfk)_[A-Za-z0-9_-]{30,}'''",
        '[[rules]]',
        'id = "nikatru-supabase-pat"',
        "regex = '''\\bsbp_[A-Za-z0-9]{36,}'''",
        '[[rules]]',
        'id = "nikatru-supabase-secret-key"',
        "regex = '''\\bsb_secret_[A-Za-z0-9_-]{20,}'''",
        // The money rail's three credential shapes ([pipeline 5]M-1/M-12). The
        // COUNT here has to match the wrapper's custom canaries: scan-secrets
        // refuses to run when a rule has no canary, because a rule nobody plants
        // a secret for is never proven to fire.
        '[[rules]]',
        'id = "nikatru-paddle-notification-secret"',
        "regex = '''\\bpdl_ntfset_[A-Za-z0-9]{20,}'''",
        '[[rules]]',
        'id = "nikatru-paddle-live-api-key"',
        "regex = '''\\bpdl_live_apikey_[A-Za-z0-9]{20,}'''",
        '[[rules]]',
        'id = "nikatru-paddle-sandbox-api-key"',
        "regex = '''\\bpdl_sdbx_apikey_[A-Za-z0-9]{20,}'''",
        '',
      ].join('\n'),
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
  const RECORD_CALL = `
final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
  );
};
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

  const brickFiles = ({
    reminders = BRICK_SCHEDULES,
    toggle = BRICK_TOGGLE_CALLS,
    money = BRICK_MONEY,
    gate = BRICK_GATE,
    checkout = BRICK_CHECKOUT,
  } = {}) => ({
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart':
      `const String kPrivacyPolicyVersion = '2026-07-26';\n${reminders}`,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart':
      toggle,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/money_providers.dart': money,
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/home/home_screen.dart': gate,
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
  /** Three lanes — the number the real register carries — because the guard
   *  floors the derived subject set at 3 and a fixture below deliberately
   *  drops one to prove that floor can fail. */
  const CHANNEL_REGISTER = JSON.stringify(
    {
      channels: [
        { id: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
        { id: 'android-play', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        { id: 'windows-store', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' } },
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
      register = CHANNEL_REGISTER,
      mainDart = MAIN_READS_DSN,
      brickMain = BRICK_MAIN_INITS_AUTH,
      reminders = BRICK_SCHEDULES,
      toggle = BRICK_TOGGLE_CALLS,
    } = {},
  ) =>
    fixture(name, {
      ...filler(fillerCount),
      ...PACK_FILES,
      ...brickFiles({ reminders, toggle }),
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
      'apps/subly/lib/main.dart': mainDart,
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart': brickMain,
    });

  test('passes when the seam has a real call site and the policy matches', () => {
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('seams-ok') });
    assert.equal(code, 0);
    assert.match(out, /a real record\(\) call/);
    assert.match(out, /policy version pinned/);
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

  test('COVERAGE LOST when the register stops declaring the lanes that exist', () => {
    const shrunk = JSON.parse(CHANNEL_REGISTER);
    shrunk.channels[2].lane = null;
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-lane-dropped', { register: JSON.stringify(shrunk, null, 2) }),
    });
    assert.equal(code, 1);
    assert.match(out, /only 2 channel row\(s\) declare a `lane\.workflow` \+ `lane\.job`/);
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
  const consentOk = {
    'tooling/channel-register.json': JSON.stringify({
      channels: [
        { id: 'web', lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' } },
        { id: 'android-play', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        { id: 'windows-store', lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' } },
      ],
    }),
    '.github/workflows/deploy-web.yml': `name: f\njobs:\n${laneJob('deploy-web')}`,
    '.github/workflows/build-platforms.yml':
      `name: f\njobs:\n${laneJob('linux_web_android')}${laneJob('windows')}`,
    'apps/subly/lib/main.dart': "final dsn = String.fromEnvironment('GLITCHTIP_DSN');\n",
    'apps/subly/lib/state/analytics_providers.dart':
      "await c.record(core.ConsentPurpose.analytics,\n granted: granted,\n);\nFuture<void> recordAnalyticsConsent(\n  WidgetRef ref, {\n  required bool granted,\n}) async {}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n",
    'apps/subly/lib/features/consent/consent_prompt.dart': 'recordAnalyticsConsent(ref, granted: true);',
    'sites/nikatru/privacy.html': '<p data-policy-version="2026-07-26">x</p>',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart':
      "const String kPrivacyPolicyVersion = '2026-07-26';\n" +
      'Future<bool> applyReminderChoice({required bool on}) async {\n' +
      '  await svc.init();\n' +
      '  await svc.scheduleDaily(core.DailyReminder(id: 1));\n' +
      '  return on;\n}\n',
    // …and the reminders seam, and the secure-session seam, for the same reason.
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart':
      'onChanged: (bool on) => c.applyReminderChoice(on: on),\n',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/main.dart':
      'await initNikatruAuth(url: u, publishableKey: k, secureStore: FlutterSecureStore());\n',
    // …and the ENTITLEMENTS seam ([pipeline 5]M-5, wired 2026-08-01), whose
    // three needs are all scoped to the brick: the fetch, the gate that reads
    // its answer, and the checkout the gate can be got past.
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/money_providers.dart':
      'final x = await ref.watch(entitlementTransportProvider).fetch(\n  appId: AppConfig.appId,\n  accessToken: t,\n);\n',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/home/home_screen.dart':
      'Widget build(BuildContext c) => PaywallGate(\n  locked: ref.watch(paywallLockedProvider),\n  child: const SizedBox.shrink(),\n);\n',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/monetization/paywall_screen.dart':
      'final CheckoutStart s = await rail.startCheckout(offering);\n',
  };

  const build = (name, { impl = REAL_IMPL, barrel = BARREL, keys = keysFile('') } = {}) =>
    fixture(name, {
      ...filler(14),
      ...consentOk,
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
  });
}

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
      child: AnalyticsGate(child: child ?? const SizedBox.shrink()),
    ),
  ),
);
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
  const goodProviders = `
final Provider<core.ConfigTransport> configTransportProvider = X();
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
final Provider<core.ConsentStatus> analyticsConsentProvider = X();
final Provider<bool> consentDecidedProvider = X();
final Provider<core.ConsentTransport> consentTransportProvider = X();
final Provider<core.EventTransport> eventTransportProvider = X();
final FutureProvider<core.Analytics> analyticsProvider = X();
final Provider<core.AuthRepository> authRepositoryProvider = Provider<core.AuthRepository>((ref) {
  if (!AppConfig.isBackendLive) return InMemoryAuthRepository();
  return SupabaseAuthRepository(
    requestServerDeletion: () => ref.read(restClientProvider).delete('/account'),
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
  }
  // 🔴 THE HALF THAT WAS MISSING UNTIL 2026-08-01. Persisting the flag was
  // always right and was never the feature; without these two lines the toggle
  // spends the one OS permission prompt and schedules nothing.
  Future<bool> applyReminderChoice({required bool on, required String title, required String body}) async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    await svc.init();
    await svc.scheduleDaily(core.DailyReminder(id: kDailyReminderId, title: title, body: body, hour: 20, minute: 0));
    return on;
  }
}

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
  const goodMain = `
Future<void> main() async {
  await TelemetryBootstrap.init(config, appRunner: () async {
    AppErrorScreen.install();
    if (AppConfig.isBackendLive) {
      await initNikatruAuth(
        url: AppConfig.supabaseUrl,
        publishableKey: AppConfig.supabaseAnonKey,
        secureStore: FlutterSecureStore(),
      );
    }
    runApp(const ProviderScope(child: ProbeApp()));
  });
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
    redirect: (BuildContext context, GoRouterState state) {
      if (!onboarded) {
        return state.matchedLocation == '/onboarding' ? null : '/onboarding';
      }
      if (!signedIn && !onAuthScreen) return '/sign-in';
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
final FutureProvider<MoneyFunnel> moneyFunnelProvider = X();
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
  const goodHome = `
Widget build(BuildContext context) => PaywallGate(
  locked: ref.watch(paywallLockedProvider),
  child: const SizedBox.shrink(),
);
`;
  const CORE_CACHE = 'packages/core/lib/src/entitlement_cache.dart';
  const goodCoreCache = 'const Duration kEntitlementStalenessCeiling = Duration(days: 7);\n';

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

  const build = (name, { propTest = goodTest, app = goodApp, providers = goodProviders, themeX = goodThemeX, scaffold = goodScaffold, authBarrel = goodAuthBarrel, settings = goodSettings, router = goodRouter, onboarding = goodOnboarding, coreAuth = goodCoreAuth, arbTa = goodArbTa, brickMain = goodMain, accountRoute = goodAccountRoute, moneyProviders = goodMoneyProviders, home = goodHome, coreCache = goodCoreCache, workspace = goodWorkspace, extra = {}, omitArbTa = false, omitProp = false } = {}) => {
    const files = { [APP]: app, [BRICK_PROVIDERS]: providers, [THEME_X]: themeX, [SCAFFOLD]: scaffold, [AUTH_BARREL]: authBarrel, [SETTINGS]: settings, [ROUTER]: router, [ONBOARDING]: onboarding, [CORE_AUTH]: coreAuth, [BRICK_MAIN]: brickMain, [ACCOUNT_ROUTE]: accountRoute, [MONEY_PROVIDERS]: moneyProviders, [HOME]: home, [CORE_CACHE]: coreCache, [WORKSPACE]: workspace, ...extra };
    if (!omitArbTa) files[ARB_TA] = arbTa;
    if (!omitProp) files[PROP] = propTest;
    return fixture(name, files);
  };

  test('passes when both properties are asserted and implemented', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
    assert.equal(code, 0);
    assert.match(out, /theme-mode-persisted' asserted/);
    assert.match(out, /theme-triplet-supplied' asserted and implemented/);
    assert.match(out, /analytics-consent-gated' asserted and implemented/);
    assert.match(out, /analytics-on-switch-mounted' asserted and implemented/);
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
    [`${dir}/lib/state/providers.dart`]: over.providers ?? goodProviders,
    [`${dir}/lib/state/money_providers.dart`]: over.moneyProviders ?? goodMoneyProviders,
    [`${dir}/lib/features/settings/settings_screen.dart`]: over.settings ?? goodSettings,
    [`${dir}/lib/features/home/home_screen.dart`]: over.home ?? goodHome,
    [`${dir}/lib/core/router.dart`]: over.router ?? goodRouter,
    [`${dir}/lib/main.dart`]: over.brickMain ?? goodMain,
    [`${dir}/lib/features/firstrun/onboarding_screen.dart`]: over.onboarding ?? goodOnboarding,
    [`${dir}/lib/l10n/app_ta.arb`]: over.arbTa ?? goodArbTa,
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

  // apps/subly is the frozen legacy rail-prover (39-CHASSIS §4 cut 1): it
  // predates the brick, was never stamped, and has no inherited property test to
  // keep. Exempting it BY NAME is what stops this guard demanding a retrofit the
  // freeze forbids — and this case is what stops the exemption being silently
  // widened to every app.
  test('does NOT demand a property test from the frozen apps/subly', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-subly-exempt') });
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /apps\/subly/);
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
            "requestServerDeletion: () => ref.read(restClientProvider).delete('/account'),",
            'requestServerDeletion: null,',
          ),
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /must be WIRED to the server route/);
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
      // [pipeline 5]M-13's money_providers.dart carries eight.
      assert.match(out, /tracked domain: 40 chassis behaviour\(s\)/);
      // The admitted gaps must PRINT. An inventory nobody sees is a list that
      // quietly grows; this is the same reasoning as the owner-gated residual.
      // 9, not 10: [pipeline C-13] moved notificationServiceProvider out of the
      // admitted-gap list when the reminder toggle started driving it. 10 since
      // 2026-08-01: the money rail closed two gaps (entitlementCacheProvider and
      // secureStoreProvider, both DRIVEN by the paywall property now) and
      // admitted three of its own.
      assert.match(out, /10 chassis behaviour\(s\) a stamped app does NOT prove/);
      assert.match(out, /mustForceUpdateProvider/);
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
      assert.match(out, /COVERAGE LOST — the domain parse found 39/);
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
        }),
      });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — the domain parse found 0/);
    });
  });
});
