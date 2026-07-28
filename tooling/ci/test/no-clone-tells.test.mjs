// ─────────────────────────────────────────────────────────────────────────────
// no-clone-tells.test.mjs — assert-no-clone-tells.mjs must be able to FAIL.
//
// [pipeline C-10] shared code carries no app-specific vocabulary. Named by C-10
// as its enforcement and marked VERIFIED while it did not exist.
//
// ⚠️ Mutated against the REAL tree first: an app name in shared code, a domain
// noun in shared code, and an empty noun list were all caught; a mention inside
// a COMMENT correctly did not fire. That last one is the design's load-bearing
// choice — shared code names "Subly" 8 times today and all 8 are comments, so a
// guard that scanned them would raise 8 false alarms on day one and be switched
// off within a week.
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
const GUARD = join(CI_DIR, 'assert-no-clone-tells.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-tells-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** apps/subly + 12 clean shared files (the floor is 10), plus whatever `extra`
 *  the case needs. `nouns` overrides the domain list. */
function tree({ extra = {}, nouns = ['subscription', 'renewal'], omitTells = false } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  mkdirSync(join(root, 'apps', 'subly'), { recursive: true });
  for (let i = 0; i < 12; i++) files[join(root, `packages/core/lib/clean${i}.dart`)] = 'class A {}\n';

  const reg = { consumerRoots: [], capabilities: [] };
  if (!omitTells) reg.cloneTells = { domainNouns: nouns };
  files[join(root, 'tooling/capability-register.json')] = JSON.stringify(reg, null, 2);

  for (const [rel, body] of Object.entries(extra)) files[join(root, rel)] = body;
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the passing path', () => {
  test('app-neutral shared code passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no clone tells/);
  });
});

describe('limb 1 — the app name', () => {
  test('fails on an app name in shared CODE', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': "const k = 'subly';\n" } }));
    assert.equal(code, 1);
    assert.match(out, /shared code names the app "subly"/i);
  });

  test('fails on an app name in the BRICK TEMPLATE too', () => {
    const { code } = run(tree({ extra: { 'tooling/bricks/app/__brick__/x.dart': 'class SublyThing {}\n' } }));
    assert.equal(code, 1);
  });

  test('a string literal counts as code — a hardcoded config key was a real defect', () => {
    const { code } = run(tree({ extra: { 'packages/core/lib/x.dart': "final m = {'subly': 1};\n" } }));
    assert.equal(code, 1);
  });
});

describe('limb 2 — domain vocabulary', () => {
  test('fails on a banned domain noun in shared code', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': 'class X { void renewal() {} }\n' } }));
    assert.equal(code, 1);
    assert.match(out, /domain word "renewal"/i);
  });

  test('a word not on the list does not fire', () => {
    const { code } = run(tree({ extra: { 'packages/core/lib/x.dart': 'class X { void recipe() {} }\n' } }));
    assert.equal(code, 0);
  });
});

describe('🔴 comments are exempt — the choice the guard lives or dies by', () => {
  test('a line comment naming the app does NOT fire', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': '// Mirrors subly\'s proven config.\nclass A {}\n' } }));
    assert.equal(code, 0, out);
  });

  test('a block comment naming the app does NOT fire', () => {
    const { code, out } = run(tree({ extra: { 'packages/core/lib/x.dart': '/* subscription handling lived in subly */\nclass A {}\n' } }));
    assert.equal(code, 0, out);
  });

  test('a trailing comment does NOT fire, but code on the same line DOES', () => {
    const clean = run(tree({ extra: { 'packages/core/lib/x.dart': 'class A {} // was subly-specific\n' } }));
    assert.equal(clean.code, 0, clean.out);
    const dirty = run(tree({ extra: { 'packages/core/lib/x.dart': "const k = 'subly'; // note\n" } }));
    assert.equal(dirty.code, 1);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the domain list is empty — it would pass everything', () => {
    const { code, out } = run(tree({ nouns: [] }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /cannot fail is worse than none/);
  });

  test('COVERAGE LOST when cloneTells is absent entirely', () => {
    const { code, out } = run(tree({ omitTells: true }));
    assert.equal(code, 1);
    assert.match(out, /no non-empty `cloneTells.domainNouns`/);
  });

  test('COVERAGE LOST when too little shared source is found', () => {
    const root = tree();
    for (let i = 0; i < 12; i++) rmSync(join(root, `packages/core/lib/clean${i}.dart`));
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});
