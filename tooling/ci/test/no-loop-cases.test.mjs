// ─────────────────────────────────────────────────────────────────────────────
// no-loop-cases.test.mjs — assert-no-loop-cases.mjs must be able to FAIL on each
// limb, must not mistake a loop written INTO a fixture string for a loop, and must
// refuse when it cannot see the suites or its baseline.
//
// Register row O-COVERAGE-MANIFEST-LOOP-CASES, option (2).
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
const GUARD = join(CI_DIR, 'assert-no-loop-cases.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-loopcases-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const TABLE_SUITE =
  "import { test } from 'node:test';\n" +
  "const ROWS = [['a', 1], ['b', 2]];\n" +
  'for (const [name, n] of ROWS) {\n' +
  '  test(`row ${name}`, () => {});\n' +
  '}\n' +
  "test('a declared case', () => {});\n";
const PLAIN_SUITE = "import { test } from 'node:test';\ntest('one', () => {});\ntest('two', () => {});\n";

function fixture({ suites = { 'table.test.mjs': TABLE_SUITE, 'plain.test.mjs': PLAIN_SUITE }, baseline = { suites: { 'table.test.mjs': 1 } } } = {}) {
  const root = join(TMP, `r${seq++}`);
  const dir = join(root, 'tooling', 'ci', 'test');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(suites)) writeFileSync(join(dir, name), body);
  if (baseline !== null) {
    writeFileSync(join(dir, 'loop-case-baseline.json'), typeof baseline === 'string' ? baseline : JSON.stringify(baseline, null, 2));
  }
  return root;
}
const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-no-loop-cases', () => {
  test('passes when every loop-wrapped case is in the baseline, and says what it counted', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no new loop cases — 1 loop-wrapped case declaration\(s\) across 1 of 2 suite\(s\)/);
  });

  test('L1: a suite NOT in the baseline that wraps a test in a for loop fails, naming the line', () => {
    const { code, out } = run(fixture({ suites: { 'table.test.mjs': TABLE_SUITE, 'new.test.mjs': TABLE_SUITE } }));
    assert.equal(code, 1, out);
    assert.match(out, /L1 tooling\/ci\/test\/new\.test\.mjs declares test cases inside 1 loop\(s\) \(for at :3\) and its baseline allows 0/);
  });

  test('L1: a listed suite that gains a SECOND loop fails', () => {
    const more = `${TABLE_SUITE}for (const x of [1, 2]) test(\`x\${x}\`, () => {});\n`;
    const { code, out } = run(fixture({ suites: { 'table.test.mjs': more } }));
    assert.equal(code, 1, out);
    assert.match(out, /table\.test\.mjs declares test cases inside 2 loop\(s\) .* baseline allows 1/);
  });

  test('L1: `.forEach(` and `.map(` around a case count, and so does `describe(` inside a loop', () => {
    const shapes = {
      'each.test.mjs': "import { test } from 'node:test';\n['a', 'b'].forEach((n) => test(n, () => {}));\n",
      'map.test.mjs': "import { it } from 'node:test';\n['a'].map((n) => { it(n, () => {}); });\n",
      'desc.test.mjs': "import { describe, test } from 'node:test';\nfor (const g of ['x']) {\n  describe(g, () => {});\n}\n",
    };
    const { code, out } = run(fixture({ suites: shapes, baseline: { suites: {} } }));
    assert.equal(code, 1, out);
    assert.match(out, /each\.test\.mjs declares test cases inside 1 loop\(s\) \(forEach at :2\)/);
    assert.match(out, /map\.test\.mjs declares test cases inside 1 loop\(s\) \(map at :2\)/);
    assert.match(out, /desc\.test\.mjs declares test cases inside 1 loop\(s\) \(for at :2\)/);
  });

  test('a loop that declares NO case, and a loop written INTO a fixture string or a comment, are not loop cases', () => {
    const innocent =
      "import { test } from 'node:test';\n" +
      'for (const x of [1, 2]) { assert.ok(x); }\n' +
      "const FIXTURE = 'for (const r of ROWS) { test(r, () => {}); }';\n" +
      'const TPL = `for (const r of ROWS) {\n  test(r, () => {});\n}`;\n' +
      '// for (const r of ROWS) { test(r, () => {}); }\n' +
      "const RE = /for \\(x\\) \\{ test\\(/;\n" +
      "test('the only case', () => { for (const y of [1]) assert.ok(y); });\n";
    const { code, out } = run(fixture({ suites: { 'innocent.test.mjs': innocent }, baseline: { suites: {} } }));
    assert.equal(code, 0, out);
    assert.match(out, /0 loop-wrapped case declaration\(s\) across 0 of 1 suite\(s\)/);
  });

  test('L2: a listed suite whose loop was rewritten as declared cases fails until its row is lowered', () => {
    const { code, out } = run(fixture({ suites: { 'table.test.mjs': PLAIN_SUITE, 'other.test.mjs': TABLE_SUITE }, baseline: { suites: { 'table.test.mjs': 1, 'other.test.mjs': 1 } } }));
    assert.equal(code, 1, out);
    assert.match(out, /L2 tooling\/ci\/test\/table\.test\.mjs now has 0 loop-wrapped case declaration\(s\) and its baseline says 1\. The baseline may only shrink — lower the row to 0 by removing it/);
  });

  test('L3: a baseline row for a suite that is gone fails', () => {
    const { code, out } = run(fixture({ baseline: { suites: { 'table.test.mjs': 1, 'gone.test.mjs': 2 } } }));
    assert.equal(code, 1, out);
    assert.match(out, /L3 tooling\/ci\/test\/loop-case-baseline\.json names gone\.test\.mjs, which is not a suite/);
  });

  test('COVERAGE LOST: no baseline file', () => {
    const { code, out } = run(fixture({ baseline: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/ci\/test\/loop-case-baseline\.json does not exist/);
  });

  test('COVERAGE LOST: a baseline that is not JSON, or has no suites object, or a non-positive row', () => {
    assert.equal(run(fixture({ baseline: '{ not json' })).code, 2);
    assert.match(run(fixture({ baseline: { rows: {} } })).out, /has no `suites` object/);
    const zero = run(fixture({ baseline: { suites: { 'table.test.mjs': 0 } } }));
    assert.equal(zero.code, 2, zero.out);
    assert.match(zero.out, /suites\["table\.test\.mjs"\] is 0; a row is a positive integer, or it is removed/);
  });

  test('COVERAGE LOST: no suites at all', () => {
    const { code, out } = run(fixture({ suites: {}, baseline: { suites: {} } }));
    assert.equal(code, 2, out);
    assert.match(out, /holds ZERO \*\.test\.mjs files/);
  });

  test('COVERAGE LOST: the baseline records loops and the detector finds none — it stopped matching', () => {
    const { code, out } = run(fixture({ suites: { 'table.test.mjs': PLAIN_SUITE }, baseline: { suites: { 'table.test.mjs': 1 } } }));
    assert.equal(code, 2, out);
    assert.match(out, /found ZERO loop-wrapped case declarations, while tooling\/ci\/test\/loop-case-baseline\.json records 1/);
  });
});
