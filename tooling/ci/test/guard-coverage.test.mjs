// ─────────────────────────────────────────────────────────────────────────────
// guard-coverage.test.mjs — assert-guard-coverage.mjs must be able to FAIL.
//
// [pipeline F-10] This is the guard that enforces F-10 on every other guard, so
// if it silently stops working the whole mechanism stops with it and every
// requirement in all fourteen stages goes back to resting on discipline.
//
// Fake trees, because the real tree is (by design) always compliant — which is
// exactly the blind spot F-10 exists to remove.
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
const GUARD = join(CI_DIR, 'assert-guard-coverage.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-gc-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/**
 * Build a fake repo.
 * @param guards  map of filename -> source text
 * @param tests   number of test files that mention every guard (0 = mention none)
 */
function repo(guards, { testFiles = 4, mentionAll = true } = {}) {
  const root = join(TMP, `r${seq++}`);
  const ci = join(root, 'tooling', 'ci');
  const t = join(ci, 'test');
  mkdirSync(t, { recursive: true });
  for (const [name, src] of Object.entries(guards)) writeFileSync(join(ci, name), src);
  const names = mentionAll ? Object.keys(guards).join('\n// ') : 'nothing-real.mjs';
  for (let i = 0; i < testFiles; i++) {
    writeFileSync(join(t, `t${i}.test.mjs`), `// ${names}\n`);
  }
  return root;
}

/** 15 compliant guards — enough to clear the floor. */
function compliant(extra = {}) {
  const g = {};
  for (let i = 0; i < 15; i++) g[`assert-thing-${i}.mjs`] = 'if (x) throw new Error("COVERAGE LOST");\n';
  return { ...g, ...extra };
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

describe('assert-guard-coverage', () => {
  test('a fully compliant tree passes', () => {
    const r = run(repo(compliant()));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /15 guard\(s\), all named in 4 test file\(s\)/);
  });

  test('a guard no test mentions FAILS', () => {
    const r = run(repo(compliant({ 'assert-lonely.mjs': 'COVERAGE LOST\n' }), { mentionAll: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no test file mentions it/);
  });

  test('a scanning guard with no coverage self-check FAILS', () => {
    const r = run(repo(compliant({ 'assert-blind.mjs': 'console.log("ok, scanned everything");\n' })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no "COVERAGE LOST" self-check/);
    // The message must offer the legitimate escape, or people invent a worse one.
    assert.match(r.stderr, /NOT_A_SCANNER with a reason/);
  });

  test('a named non-scanner is exempt, and the exemption is counted out loud', () => {
    const r = run(repo(compliant({ 'assert-gate-passed.mjs': 'const sha = process.argv[2];\n' })));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 exempt with a recorded reason/);
  });

  test('an exempt guard that GROWS a scan loses the exemption', () => {
    // Otherwise an exemption granted once quietly outlives the reason for it.
    const r = run(repo(compliant({ 'record-deployment.mjs': 'if (!ok) throw new Error("COVERAGE LOST");\n' })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /listed in NOT_A_SCANNER but now contains/);
  });

  test('COVERAGE: too few guards is "the scan is broken", not "all clear"', () => {
    const r = run(repo({ 'assert-one.mjs': 'COVERAGE LOST\n' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — found 1 guard\(s\)/);
    assert.match(r.stderr, /reports perfect coverage/);
  });

  test('COVERAGE: too few test files is caught', () => {
    const r = run(repo(compliant(), { testFiles: 1 }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /found 1 test file\(s\)/);
  });

  test('COVERAGE: a missing tooling/ci is caught rather than reported clean', () => {
    const root = join(TMP, 'bare');
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
});
