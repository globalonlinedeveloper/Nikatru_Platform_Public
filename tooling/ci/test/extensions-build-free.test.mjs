// ─────────────────────────────────────────────────────────────────────────────
// extensions-build-free.test.mjs — assert-extensions-build-free.mjs must be able
// to FAIL, and must be green on the tree it actually guards.
//
// [ADR 067] decision 1 — the extensions/ subtree is build-free. The guard is the
// only thing standing between "we don't build the extensions" as a habit and as
// an invariant, and report 16 §10.5 Risk 1 is explicit that the day it lands is
// the day to mutation-test it: "plant a package.json, confirm red, remove it,
// confirm green. Per the memory note 'a green guard after a refactor is evidence
// of nothing.'"
//
// ⚠️ THE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. Every case
// below was run against the REAL repository first, in this order: green control
// (exit 0, "542 file(s) … 1 tool(s)"), then a planted
// extensions/Extension/Full_Screen_Shot/vite.config.js (exit 1, naming the
// file), then its removal (exit 0 again). The fixtures exist so the next change
// to the guard is graded by something that runs in CI rather than by a session
// that remembers doing it.
//
// ⚠️ AND THEY ARE FIXTURES, NOT MUTATIONS OF THE TREE. A test that plants a file
// in the working repository races every other agent editing it, and a crash
// leaves the plant behind — the memory note "verify races live writers". Each
// case builds a minimal tree in a temp directory and points the guard at it with
// its repoRoot argument, which is the argument CI passes too.
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
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-extensions-build-free.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-extbuildfree-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The smallest tree the guard accepts as a real subject: one tool, one
 *  manifest, one package rule set that excludes node_modules. */
const BASE = {
  'extensions/Extension/Probe/tool.json': JSON.stringify({
    id: 'probe',
    surface: 'extension',
    package: { include: ['manifest.json'], exclude: ['test/**', 'node_modules/**'] },
  }),
  'extensions/Extension/Probe/manifest.json': JSON.stringify({ manifest_version: 3, name: 'Probe' }),
  'extensions/Extension/Probe/background.js': '// @ts-check\nexport const ok = true;\n',
};

function build(extra = {}) {
  const root = join(TMP, `t${++seq}`);
  for (const [rel, body] of Object.entries({ ...BASE, ...extra })) {
    if (body === null) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

describe('assert-extensions-build-free', () => {
  // ── THE GREEN CONTROL COMES FIRST, on both subjects ────────────────────────
  test('the real repository is build-free today', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}extensions build-free/);
  });

  test('a minimal build-free fixture passes', () => {
    const { code, out } = run(build());
    assert.equal(code, 0, out);
  });

  // ── THE MUTATION REPORT 16 §10.5 NAMES ────────────────────────────────────
  test('a vite.config.js reddens it, and removing it returns it to green', () => {
    const withConfig = build({ 'extensions/Extension/Probe/vite.config.js': 'export default {}\n' });
    const red = run(withConfig);
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /vite\.config\.js/);
    assert.match(red.out, /bundler\/framework configuration/);

    rmSync(join(withConfig, 'extensions/Extension/Probe/vite.config.js'));
    const green = run(withConfig);
    assert.equal(green.code, 0, green.out);
  });

  test('a package.json outside a test island reddens it', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/package.json': JSON.stringify({ name: 'probe' }),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /outside a test island/);
  });

  test('a Playwright test island is allowed, and its shape is not tool-specific', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/test/e2e/package.json': JSON.stringify({
        name: 'probe-e2e', private: true, devDependencies: { playwright: '^1.49.0' },
      }),
      'extensions/Extension/Probe/test/e2e/package-lock.json': '{}',
    }));
    assert.equal(code, 0, out);
  });

  test('a bundler smuggled into the island as a devDependency reddens it', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/test/e2e/package.json': JSON.stringify({
        devDependencies: { playwright: '^1.49.0', vite: '^6.0.0' },
      }),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /devDependency "vite"/);
  });

  test('a runtime dependency in the island reddens it even when the package is a harness one', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/test/e2e/package.json': JSON.stringify({
        dependencies: { playwright: '^1.49.0' },
      }),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /runtime dependency/);
  });

  test('a .ts source reddens it', () => {
    const { code, out } = run(build({ 'extensions/Extension/Probe/content/grab.ts': 'export const x = 1;\n' }));
    assert.equal(code, 1, out);
    assert.match(out, /TypeScript source file/);
  });

  test('a tsconfig.json that emits reddens it; one that does not is allowed', () => {
    const emitting = run(build({
      'extensions/Extension/Probe/tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true } }),
    }));
    assert.equal(emitting.code, 1, emitting.out);
    assert.match(emitting.out, /"noEmit": true/);

    const checking = run(build({
      'extensions/Extension/Probe/tsconfig.json': JSON.stringify({
        compilerOptions: { noEmit: true, allowJs: true, checkJs: true },
      }),
    }));
    assert.equal(checking.code, 0, checking.out);
  });

  test('`tsc` without --noEmit reddens it; `tsc --noEmit` does not', () => {
    const compiling = run(build({ 'extensions/scripts/build.mjs': "run('npx tsc -p .');\n" }));
    assert.equal(compiling.code, 1, compiling.out);
    assert.match(compiling.out, /without --noEmit/);

    const checking = run(build({ 'extensions/scripts/check.mjs': "run('npx tsc --noEmit --checkJs');\n" }));
    assert.equal(checking.code, 0, checking.out);
  });

  test('a committed node_modules file reddens it', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/node_modules/left-pad/index.js': 'module.exports = 1;\n',
    }));
    assert.equal(code, 1, out);
    assert.match(out, /node_modules outside a test island/);
  });

  test('a tool whose package rules forget node_modules reddens it', () => {
    const { code, out } = run(build({
      'extensions/Extension/Probe/tool.json': JSON.stringify({
        id: 'probe', surface: 'extension', package: { include: ['manifest.json'], exclude: ['test/**'] },
      }),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does not name node_modules/);
  });

  // ── THE VACUOUS PASS, WHICH IS THE FAILURE THIS CORPUS NAMES FIRST ────────
  test('an extensions/ with no tool is COVERAGE LOST, not a pass', () => {
    const root = join(TMP, `empty${++seq}`);
    mkdirSync(join(root, 'extensions', 'docs'), { recursive: true });
    writeFileSync(join(root, 'extensions', 'docs', 'README.md'), '# nothing here\n', 'utf8');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('no extensions/ at all is COVERAGE LOST, not a pass', () => {
    const root = join(TMP, `none${++seq}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });
});
