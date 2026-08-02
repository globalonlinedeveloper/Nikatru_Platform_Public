// ─────────────────────────────────────────────────────────────────────────────
// obfuscation-coupled.test.mjs — assert-obfuscation-coupled.mjs must be able to
// FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST AND THESE FIXTURES ENCODE WHAT IT SHOWED.
// Six mutations were run against a full COPY of this repository on 2026-08-03,
// all six caught, all six restored byte-identically and re-run green:
//
//   1. `flutter build linux --release --obfuscate --split-debug-info=build/
//      symbols` in build-platforms.yml with no retention anywhere in the job
//      ⇒ exit 1 naming the directory and the job.
//   2. `--obfuscate` with NO `--split-debug-info` ⇒ exit 1 with the different,
//      sharper message: Flutter writes no mapping at all, so there is nothing
//      to upload and nothing to recover.
//   3. the same obfuscating build PLUS `sentry-cli debug-files upload` in the
//      same job ⇒ exit 0. Written before (1), because a guard that rejects the
//      unfamiliar is not a guard.
//   4. the same obfuscating build PLUS an `actions/upload-artifact` whose
//      `path:` names `build/symbols` ⇒ exit 0.
//   5. the `flutter build` matcher broken to `flutterr` ⇒ COVERAGE LOST, not a
//      pass — the 13 real build commands are what this guard speaks about.
//   6. a COMMENT reading "we deliberately do not pass --obfuscate
//      --split-debug-info=build/symbols here" ⇒ exit 0. This is the case the
//      repo has lost twice before ([1]F-10, assert-stamp-platforms.mjs:37-42).
//
// The fixtures below re-state those in a form that runs on every push, plus the
// two false-alarm surfaces that live in this tree and would fire a naive
// matcher: `apps/subly/.gitignore`'s `app.*.symbols` line and the word
// "obfuscated" in a doc comment.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-obfuscation-coupled.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-obf-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

function fixture(workflows) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A build job in the shape build-platforms.yml really has: a folded `run: >`
 *  command, then an upload-artifact step. */
const wf = ({ buildFlags = '', extraSteps = '', uploadPaths = 'apps/subly/build/linux/x64/release/bundle', comment = '' } = {}) => `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
${comment}      - name: Build linux
        working-directory: apps/subly
        run: >
          flutter build linux --release${buildFlags}
          --dart-define=GLITCHTIP_DSN=x
${extraSteps}      - uses: actions/upload-artifact@v4
        with:
          name: subly-linux
          path: |
            ${uploadPaths}
          retention-days: 7
`;

describe('assert-obfuscation-coupled', () => {
  test('passes on a tree whose builds obfuscate nothing — the state today', () => {
    const { code, out } = run(fixture({ 'build.yml': wf() }));
    assert.equal(code, 0, out);
    assert.match(out, /0 obfuscating/);
  });

  // ── the failing case the guard exists for ─────────────────────────────────
  test('FAILS when a build obfuscates and nothing in its job retains the symbols', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' }) }));
    assert.equal(code, 1);
    assert.match(out, /obfuscates into "build\/symbols" and nothing in job "linux" retains it/);
    assert.match(out, /A rebuild produces a DIFFERENT mapping/);
  });

  test('FAILS differently when --obfuscate carries no --split-debug-info at all', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --obfuscate' }) }));
    assert.equal(code, 1);
    assert.match(out, /passes --obfuscate with no --split-debug-info/);
    assert.match(out, /nothing to upload and nothing to recover/);
  });

  // ── the false-alarm cases, written FIRST ──────────────────────────────────
  test('a symbol upload to the crash sink in the SAME job satisfies it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        extraSteps: '      - name: Upload symbols\n        run: sentry-cli debug-files upload --include-sources build/symbols\n',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /1 obfuscating/);
  });

  test('an upload-artifact naming the SAME directory satisfies it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            build/symbols',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('an upload-artifact naming a DIFFERENT directory does NOT satisfy it', () => {
    const root = fixture({
      'build.yml': wf({
        buildFlags: ' --obfuscate --split-debug-info=build/symbols',
        uploadPaths: 'apps/subly/build/linux/x64/release/bundle\n            build/coverage',
      }),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /nothing in job "linux" retains it/);
  });

  test('a symbol upload in a DIFFERENT job does not count — the mapping never leaves its runner', () => {
    const root = fixture({
      'build.yml': `${wf({ buildFlags: ' --obfuscate --split-debug-info=build/symbols' })}
  publish:
    runs-on: ubuntu-24.04
    steps:
      - run: sentry-cli debug-files upload build/symbols
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /job "linux"/);
  });

  test('a COMMENT naming the flags cannot make a build look obfuscated', () => {
    const root = fixture({
      'build.yml': wf({ comment: '      # never pass --obfuscate --split-debug-info=build/symbols on this lane\n' }),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /0 obfuscating/);
  });

  test('--split-debug-info WITHOUT --obfuscate is a printed note, not a failure', () => {
    const { code, out } = run(fixture({ 'build.yml': wf({ buildFlags: ' --split-debug-info=build/symbols' }) }));
    assert.equal(code, 0, out);
    assert.match(out, /doing less than it looks like/);
  });

  // ── the coverage self-check ───────────────────────────────────────────────
  test('COVERAGE LOST when no workflow directory exists at all', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the workflows carry no `flutter build` at all', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
      - run: echo nothing to build
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /found ZERO `flutter build` commands/);
  });

  test('COVERAGE LOST when comment stripping eats every step', () => {
    const root = fixture({
      'build.yml': `name: Build
on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: ubuntu-24.04
    steps:
#      - run: flutter build linux --release
`,
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── the two false-alarm surfaces that really live in this tree ────────────
  test('`app.*.symbols` in a .gitignore is not a build command', () => {
    const root = fixture({ 'build.yml': wf() });
    mkdirSync(join(root, 'apps', 'subly'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', '.gitignore'), 'app.*.symbols\napp.*.map.json\n');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('the word "obfuscated" in Dart prose is not a build command', () => {
    const root = fixture({ 'build.yml': wf() });
    mkdirSync(join(root, 'packages', 'platform_storage', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'platform_storage', 'lib', 'storage_capabilities.dart'),
      '/// Web storage is obfuscated, not encrypted.\nclass StorageCapabilities {}\n',
    );
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });
});
