// ─────────────────────────────────────────────────────────────────────────────
// lockfile-discipline.test.mjs — assert-lockfile-discipline.mjs limb 2b: WHERE a
// workflow install runs must be a directory the guard can grade.
// [rv2-security-020, O-BRICK-PROBE-INSTALLS-WITHOUT-ITS-LOCK]
//
// The guard's older cases live in guards.test.mjs's `assert-lockfile-discipline`
// describe; this file holds the working-directory limb and the retirement of the
// BOOTSTRAP_EXCEPTIONS list that excused ci.yml's app-brick `npm install`.
//
// 🔴 REAL-TREE RUN FIRST, 2026-09-30, green control first ("12 in the tree, 2
// stamp-produced, 6 named by a ${{ }} expression"), each mutation restored:
//   M0 tooling/ci/stamp-produced-dirs.json absent ⇒ EXIT 2, both app-brick installs
//      (ci.yml:1433, :1518) named as "installs in `services/probeapi-api`, which
//      does not exist in the tree";
//   M1 ci.yml:1433 back to `npm install --no-audit --no-fund` ⇒ EXIT 1,
//      "installs non-reproducibly — use `npm ci`" (the old list excused exactly this);
//   M2 the brick's package.json given a dependency its package-lock.json lacks ⇒
//      EXIT 1, "records dependencies that differ";
//   M3 a declared `services/gone-api` no install uses ⇒ EXIT 2 (stale).
//
// Fixtures carry no .git, so the tracked-ness checks self-disable.
// Run:  node --test tooling/ci/test/lockfile-discipline.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-lockfile-discipline.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-lockdisc-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

const TEMPLATE = 'tooling/bricks/app/__brick__/services/{{app_id}}-api';
const PKG = { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' }, devDependencies: { typescript: '^5.6.0' } };
const LOCK = {
  name: '{{app_id}}-api',
  lockfileVersion: 3,
  packages: { '': { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' }, devDependencies: { typescript: '^5.6.0' } } },
};
const DECL = {
  dirs: [{ dir: 'services/probeapi-api', template: TEMPLATE, why: 'fixture: the probe Worker, stamped in the job' }],
};
const STAMP_STEP = (install) =>
  'jobs:\n  a:\n    steps:\n      - run: npm ci\n' +
  `      - name: stamped service\n        working-directory: services/probeapi-api\n        run: |\n          ${install}\n          npx tsc --noEmit\n`;

function fixture({ workflow = STAMP_STEP('npm ci --no-audit --no-fund'), decl = DECL, pkg = PKG, lock = LOCK, extra = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  const files = { '.github/workflows/ci.yml': workflow, ...extra };
  for (const u of ['services/w1', 'services/w2', 'packages/n1']) {
    files[`${u}/package.json`] = '{"name":"x"}\n';
    files[`${u}/package-lock.json`] = '{"lockfileVersion":3}\n';
  }
  if (pkg) files[`${TEMPLATE}/package.json`] = JSON.stringify(pkg);
  if (lock) files[`${TEMPLATE}/package-lock.json`] = JSON.stringify(lock);
  if (decl) files['tooling/ci/stamp-produced-dirs.json'] = JSON.stringify(decl);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-lockfile-discipline · limb 2b, the install directory', () => {
  test('a declared stamp-produced directory installed with npm ci PASSES, graded against its template', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /1 in the tree, 1 stamp-produced \(graded against the template's lockfile/);
  });

  test('🔴 COVERAGE LOST (exit 2) when an install runs in a directory absent from the tree and undeclared', () => {
    const { code, out } = run(fixture({ decl: null }));
    assert.equal(code, 2, out);
    assert.match(out, /ci\.yml:8 installs in `services\/probeapi-api`, which does not exist in the tree/);
  });

  test('🔴 FAILS a bare npm install in the stamped directory — the retired BOOTSTRAP_EXCEPTIONS no longer excuse it', () => {
    const { code, out } = run(fixture({ workflow: STAMP_STEP('npm install --no-audit --no-fund') }));
    assert.equal(code, 1, out);
    assert.match(out, /ci\.yml:8 installs non-reproducibly — use `npm ci`/);
  });

  test('FAILS when the template ships no lockfile for the stamp to carry', () => {
    const { code, out } = run(fixture({ lock: null }));
    assert.equal(code, 1, out);
    assert.match(out, /does not carry both package\.json and package-lock\.json/);
  });

  test('FAILS when the template lockfile is out of step with its package.json — npm ci would refuse it', () => {
    const { code, out } = run(fixture({ pkg: { ...PKG, dependencies: { ...PKG.dependencies, jose: '^5.9.0' } } }));
    assert.equal(code, 1, out);
    assert.match(out, /records dependencies that differ from/);
    assert.equal((out.match(/records dependencies that differ/g) ?? []).length, 1, 'graded once per template, not once per install');
  });

  test('COVERAGE LOST (exit 2) when a declared directory is used by no install (stale)', () => {
    const decl = { dirs: [...DECL.dirs, { dir: 'services/gone-api', template: TEMPLATE, why: 'fixture: a stamp nobody installs any more' }] };
    const { code, out } = run(fixture({ decl }));
    assert.equal(code, 2, out);
    assert.match(out, /declares `services\/gone-api` stamp-produced, and no workflow install runs there/);
  });

  test('FAILS a declaration with no reason of at least 20 characters', () => {
    const { code, out } = run(fixture({ decl: { dirs: [{ ...DECL.dirs[0], why: 'stamped' }] } }));
    assert.equal(code, 1, out);
    assert.match(out, /needs "dir", "template" and a "why" of at least 20/);
  });

  test('the directory resolves through job defaults, workflow defaults and --prefix', () => {
    const workflow =
      'defaults:\n  run:\n    working-directory: services\n' +
      'jobs:\n  a:\n    defaults:\n      run:\n        working-directory: services/w1\n    steps:\n      - run: npm ci\n' +
      '  b:\n    steps:\n      - run: npm ci --prefix w2\n' +
      '  c:\n    steps:\n      - run: npm ci --prefix nope\n';
    const { code, out } = run(fixture({ workflow, decl: null }));
    assert.equal(code, 2, out);
    assert.match(out, /ci\.yml:16 installs in `services\/nope`/);
    assert.doesNotMatch(out, /ci\.yml:(10|13) installs in/);
  });

  test('a ${{ }} expression directory is counted and printed, not failed', () => {
    const workflow = 'jobs:\n  a:\n    defaults:\n      run:\n        working-directory: services/${{ matrix.worker }}\n    steps:\n      - run: npm ci\n';
    const { code, out } = run(fixture({ workflow, decl: null }));
    assert.equal(code, 0, out);
    assert.match(out, /1 named by a \$\{\{ \}\} expression/);
  });
});
