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
// Run:  node --test tooling/ci/test/
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
  const build = (name, platformSql, brickSql = ADDITIVE, extra = {}) =>
    fixture(name, {
      'services/platform/migrations/0001_init.sql': platformSql,
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
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-cors-allowlist', () => {
  const ALL = [
    'https://subly.nikatru.com',
    'https://subly-9cp.pages.dev',
    'http://localhost:3000',
  ];
  const build = (name, body) =>
    fixture(name, { 'services/platform/wrangler.jsonc': body });
  const config = (origins, trailer = '') =>
    `{\n  // the shared platform Worker\n  "vars": { "ALLOWED_ORIGINS": "${origins.join(',')}" }${trailer}\n}\n`;

  test('PASSES when every required origin is listed', () => {
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-ok', config(ALL)) });
    assert.equal(code, 0);
  });

  test('FAILS when a required origin is dropped, and names it', () => {
    const dir = build('cors-missing', config(ALL.slice(0, 2)));
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /localhost:3000/);
  });

  test('FAILS on an empty allowlist — which would deny every browser origin', () => {
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-empty', config([])) });
    assert.equal(code, 1);
  });

  test('is STRUCTURAL — an origin mentioned only in a comment does not satisfy it', () => {
    const body = `{\n  // https://subly-9cp.pages.dev and http://localhost:3000 used to be here\n  "vars": { "ALLOWED_ORIGINS": "https://subly.nikatru.com" }\n}\n`;
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-comment', body) });
    assert.equal(code, 1);
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
