// ─────────────────────────────────────────────────────────────────────────────
// ungraded-baseline-doc.test.mjs — assert-ungraded-baseline-doc.mjs must FAIL on
// each limb, must refuse when it cannot read the workflow's arrays, and must go
// red on the REAL README put back into the stale shape it had until 2026-09-16.
//
// Register row O-FULLSHOT-CLAIM-SUITES-STALE.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-ungraded-baseline-doc.mjs');
const WF = '.github/workflows/extensions.yml';
const DIR = 'Extension/Tool';
const README = `extensions/${DIR}/test/e2e/README.md`;

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ungraded-doc-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const workflow = ({ quarantine = QUARANTINE, baseline = BASELINE } = {}) => `name: Extensions
jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - name: Run every suite
        run: |
          node -e '
            /* a retired entry, kept verbatim in a comment:
              { dir: "${DIR}", file: "retired.mjs",
                why: "gone" },
            */
            const QUARANTINE = [
${quarantine}
            ];
            const UNGRADED_BASELINE = [
${baseline}
            ];
          '
`;
const QUARANTINE = `              { dir: "${DIR}", file: "claim.mjs",
                why: "2026-08-25, exit 1" },
              { dir: "Extension/Other", file: "other.mjs",
                why: "elsewhere" },`;
const BASELINE = `              /* fixtures/ — the one suite is quarantined */
              { dir: "${DIR}", id: "fixtures/a.html" },
              { dir: "${DIR}", id: "fixtures/b.html" },
              /* { dir: "${DIR}", id: "fixtures/commented.html" }, */`;

const ROW_A = '| `fixtures/a.html` | `claim.mjs` | quarantined | **GRADEABLE** — needs a row |';
const ROW_B = '| `fixtures/b.html` | `claim.mjs` | quarantined, unrepairable | **NOT YET** |';
const readme = ({ count = '**2 shapes reach no graded suite.**', rows = [ROW_A, ROW_B], dir = DIR, end = true } = {}) => [
  '# e2e',
  '',
  'Prose before the block names `fixtures/zzz.html` and `wired.mjs` and is not read.',
  '',
  `<!-- ungraded-baseline:begin ${dir} -->`,
  `${count} Both run only under a quarantined suite:`,
  '',
  '| shape | only suite that runs it | state | what would close it |',
  '|---|---|---|---|',
  ...rows,
  ...(end ? ['<!-- ungraded-baseline:end -->'] : []),
  '',
].join('\n');

function fixture({ wf = workflow(), doc = readme(), extra = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = { [WF]: wf, [README]: doc, ...extra };
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  mkdirSync(join(root, 'extensions'), { recursive: true });
  return root;
}
const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-ungraded-baseline-doc — the happy path', () => {
  test('a block that matches both arrays passes', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 baseline row\(s\) over 1 dir\(s\), 2 quarantined suite\(s\); 1 README block\(s\) read/);
  });

  test('a baseline row inside a block comment is not a row', () => {
    const r = run(fixture());
    assert.doesNotMatch(r.out, /commented\.html/);
    assert.equal(r.code, 0, r.out);
  });

  test('a dir with no baseline rows and no README is not a finding', () => {
    // Extension/Other is on QUARANTINE only and has no README in the fixture.
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /Extension\/Other/);
  });

  test('an emptied baseline passes when the block says 0 and lists nothing', () => {
    const r = run(fixture({ wf: workflow({ baseline: '' }), doc: readme({ count: '**0 shapes reach no graded suite.**', rows: [] }) }));
    assert.equal(r.code, 0, r.out);
  });
});

describe('assert-ungraded-baseline-doc — the limbs fail', () => {
  test('U1: a baseline row the table does not list is red', () => {
    const r = run(fixture({ doc: readme({ count: '**2 shapes reach no graded suite.**', rows: [ROW_A] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U1 .* does not list fixtures\/b\.html/);
  });

  test('U1: a table row that is not on the baseline is red (a shape that got wired)', () => {
    const extra = '| `fixtures/c.html` | `claim.mjs` | quarantined | x |';
    const r = run(fixture({ doc: readme({ rows: [ROW_A, ROW_B, extra] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U1 .* lists fixtures\/c\.html, which is NOT on UNGRADED_BASELINE/);
  });

  test('U1: a shape listed twice is red', () => {
    const r = run(fixture({ doc: readme({ rows: [ROW_A, ROW_B, ROW_A] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U1 .* lists fixtures\/a\.html 2 times/);
  });

  test('U2: a row naming a suite that is no longer quarantined is red (the privacy-verify staleness)', () => {
    const wired = '| `fixtures/a.html` | `wired.mjs` | quarantined | **WIREABLE** |';
    const r = run(fixture({ doc: readme({ rows: [wired, ROW_B] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U2 .* names wired\.mjs, which is NOT on QUARANTINE for Extension\/Tool/);
  });

  test('U2: a suite quarantined only for ANOTHER dir does not count', () => {
    const other = '| `fixtures/a.html` | `other.mjs` | quarantined | x |';
    const r = run(fixture({ doc: readme({ rows: [other, ROW_B] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U2 .* names other\.mjs/);
  });

  test('U2: a quarantined suite whose row calls it wired is red', () => {
    const says = '| `fixtures/a.html` | `claim.mjs` | wired | x |';
    const r = run(fixture({ doc: readme({ rows: [says, ROW_B] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U2 .* gives claim\.mjs the state "wired"/);
  });

  test('U2: a row with no backticked suite is red', () => {
    const bare = '| `fixtures/a.html` | claim.mjs | quarantined | x |';
    const r = run(fixture({ doc: readme({ rows: [bare, ROW_B] }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U2 .* row fixtures\/a\.html names no suite/);
  });

  test('U3: a stated count that disagrees with the baseline is red', () => {
    const r = run(fixture({ doc: readme({ count: '**3 shapes reach no graded suite.**' }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U3 .* says 3 shapes reach no graded suite; UNGRADED_BASELINE holds 2/);
  });

  test('U3: a block with no stated count is red', () => {
    const r = run(fixture({ doc: readme({ count: 'Two shapes reach no graded suite.' }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U3 .* states its count 0 times/);
  });

  test('U0: a README with no block, for a dir with baseline rows, is red', () => {
    const r = run(fixture({ doc: '# e2e\n\n**2 shapes reach no graded suite.**\n' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U0 .* carries no <!-- ungraded-baseline:begin Extension\/Tool --> block/);
  });

  test('U0: a missing README, for a dir with baseline rows, is red', () => {
    const r = run(fixture({ doc: null }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U0 Extension\/Tool has 2 UNGRADED_BASELINE row\(s\) and .* does not exist/);
  });

  test('U0: a block for a different dir is red', () => {
    const r = run(fixture({ doc: readme({ dir: 'Extension/Other' }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U0 .* is a block for "Extension\/Other", but the README sits in Extension\/Tool/);
  });

  test('U0: a block with no end marker is red', () => {
    const r = run(fixture({ doc: readme({ end: false }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U0 .* opens a block with no <!-- ungraded-baseline:end -->/);
  });
});

describe('assert-ungraded-baseline-doc — COVERAGE LOST', () => {
  test('no workflow is exit 2', () => {
    const r = run(fixture({ wf: null }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*extensions\.yml does not exist/);
  });

  test('a workflow without the arrays is exit 2', () => {
    const r = run(fixture({ wf: 'name: Extensions\njobs:\n  e2e:\n    runs-on: ubuntu-24.04\n' }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no readable `const QUARANTINE[\s\S]*no readable `const UNGRADED_BASELINE/);
  });

  test('a baseline entry in a shape the reader cannot parse is exit 2, not a smaller baseline', () => {
    const changed = `${BASELINE}\n              { dir: "${DIR}", id: 'fixtures/single-quoted.html' },`;
    const r = run(fixture({ wf: workflow({ baseline: changed }) }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /has 3 `\{ dir:` entries but only 2 read/);
  });

  test('a quarantine entry in a shape the reader cannot parse is exit 2', () => {
    const changed = `${QUARANTINE}\n              { dir: "${DIR}", suite: "renamed-key.mjs", why: "x" },`;
    const r = run(fixture({ wf: workflow({ quarantine: changed }) }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /QUARANTINE in .* has 3 `\{ dir:` entries but 2 distinct/);
  });
});

describe('assert-ungraded-baseline-doc — the REAL tree', () => {
  const REAL_README = 'extensions/Extension/Full_Screen_Shot/test/e2e/README.md';
  const realRoot = (mutate) => {
    const root = join(TMP, `real${seq++}`);
    for (const rel of [WF, REAL_README]) {
      let body = readFileSync(join(REPO, rel), 'utf8');
      if (rel === REAL_README && mutate) body = mutate(body);
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  };

  test('the checked-in README matches the checked-in workflow (green control)', () => {
    const r = run(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 README block\(s\) read/);
  });

  test('the real README with the pre-2026-09-16 privacy-verify row put back is red on U1, U2 and U3', () => {
    const r = run(realRoot((s) => s
      .replace(/\*\*\d+ shapes reach no graded suite\.\*\*/, '**15 shapes reach no graded suite.**')
      .replace('|---|---|---|---|\n', '|---|---|---|---|\n| `fixtures-verify/race-pii.html` | `privacy-verify.mjs` | quarantined | **WIREABLE** |\n')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U1 .* lists fixtures-verify\/race-pii\.html/);
    assert.match(r.out, /U2 .* names privacy-verify\.mjs, which is NOT on QUARANTINE/);
    assert.match(r.out, /U3 .* says 15 shapes/);
  });

  test('the real README with one real row deleted is red', () => {
    const r = run(realRoot((s) => s.replace(/^\| `fixtures-adv\/honest-pii\.html` .*\n/m, '')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /U1 .* does not list fixtures-adv\/honest-pii\.html/);
  });
});
