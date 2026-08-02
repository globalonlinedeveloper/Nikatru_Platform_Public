// ─────────────────────────────────────────────────────────────────────────────
// workflow-scan.test.mjs — tooling/ci/workflow-scan.mjs must be able to get it
// WRONG, and these cases are the ones it has already got wrong once.
//
// The module is not a guard — it is the single parse of a GitHub workflow that
// four guards read the tree through. It owns no coverage claim, and that
// exemption is recorded by name and reason in assert-guard-coverage.mjs's
// NOT_A_SCANNER map. What it DOES owe is a recorded failing case, because every
// question those four guards ask is asked of ITS output: if the parse narrows,
// each of them reports "clean" over a smaller tree.
//
// Every case below is a defect this parser absorbed before it was shared,
// recorded in its header:
//   · `run: >` is ONE command — folded with SPACES, or a line-anchored matcher
//     sees `--build-number=${{` and nothing else.
//   · `run: |` is MANY commands — joined with ` ; `, or line one's `--dry-run`
//     exonerates line two's real deploy.
//   · `needs:` has THREE forms and quotes in all three. Missing the scalar form
//     made a correctly-gated production workflow look ungated.
//   · comments are BLANKED, not deleted, so a reported line number still points
//     at the real file.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, parseAllWorkflows, joinBlockScalars, shellSegments } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(CI_DIR.endsWith(join('tooling', 'ci')), 'the module under test must be the real one');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-wfscan-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function fixture(files) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  return root;
}

const textOf = (job) => job.logical.map((l) => l.text).join('\n');

describe('workflow-scan', () => {
  test('a `run: >` block folds into ONE line with SPACES', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: >
          flutter build web --release
          --build-name=1.0.7
          --build-number=7
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    const t = textOf(wf.jobs.get('build'));
    assert.match(t, /flutter build web --release --build-name=1\.0\.7 --build-number=7/);
  });

  test('a `run: |` block joins with ` ; ` so one segment cannot exonerate the next', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  deploy:
    runs-on: ubuntu-24.04
    steps:
      - run: |
          wrangler deploy --dry-run
          wrangler deploy
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    const line = textOf(wf.jobs.get('deploy'));
    const segs = shellSegments(line).map((s) => s.trim()).filter(Boolean);
    assert.ok(segs.some((s) => s === 'wrangler deploy'), `a real deploy segment must survive: ${JSON.stringify(segs)}`);
    assert.ok(segs.some((s) => s.includes('--dry-run')));
  });

  // ── `needs:`, all three forms, quoted and not ─────────────────────────────
  for (const [label, body] of [
    ['flow', '    needs: [gate, other]'],
    ['flow, quoted', '    needs: ["gate", \'other\']'],
    ['block', '    needs:\n      - gate\n      - other'],
  ]) {
    test(`\`needs:\` in ${label} form yields the real edges`, () => {
      const root = fixture({
        'a.yml': `name: A
jobs:
  gate:
    runs-on: ubuntu-24.04
    steps:
      - run: echo gate
  other:
    runs-on: ubuntu-24.04
    steps:
      - run: echo other
  build:
    runs-on: ubuntu-24.04
${body}
    steps:
      - run: echo build
`,
      });
      const wf = parseWorkflow(root, '.github/workflows/a.yml');
      assert.deepEqual(wf.jobs.get('build').needs, ['gate', 'other']);
    });
  }

  test('the SCALAR form — the one the first version missed, on a real production workflow', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  detect:
    runs-on: ubuntu-24.04
    steps:
      - run: echo detect
  deploy:
    runs-on: ubuntu-24.04
    needs: detect
    steps:
      - run: echo deploy
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.deepEqual(wf.jobs.get('deploy').needs, ['detect']);
  });

  test('a quoted SCALAR `needs: "gate"` is the same edge', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  gate:
    runs-on: ubuntu-24.04
    steps:
      - run: echo gate
  deploy:
    runs-on: ubuntu-24.04
    needs: "gate"
    steps:
      - run: echo deploy
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.deepEqual(wf.jobs.get('deploy').needs, ['gate']);
  });

  // ── comments ──────────────────────────────────────────────────────────────
  test('comments are BLANKED, not deleted — line numbers still point at the real file', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      # we never pass --obfuscate here
      - run: flutter build web --release
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    const job = wf.jobs.get('build');
    const build = job.logical.find((l) => /flutter build/.test(l.text));
    assert.equal(build.n, 7, 'the run: line is line 7 of the file');
    assert.ok(!textOf(job).includes('--obfuscate'), 'the comment must not survive as code');
  });

  test('a trailing `# …` on a real line is stripped and the code before it is kept', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter build web --release # the only shipped target
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    const t = textOf(wf.jobs.get('build'));
    assert.match(t, /flutter build web --release/);
    assert.ok(!t.includes('only shipped target'));
  });

  // The pair `rawStepCount` / `strippedStepCount` is a self-check ON THE
  // STRIPPER that the four callers turn into COVERAGE LOST. Its failing input
  // is a BROKEN STRIPPER, not a workflow — a line comment cannot make the two
  // diverge, because a commented step is not a step in either count. So what is
  // asserted here is that both numbers are real and that a commented-out step
  // is counted by NEITHER; the divergence case is exercised where it can be, in
  // the callers' own fixtures.
  test('the strip-count pair is real, and a commented-out step counts in neither', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter build web --release
#      - run: flutter build linux --release
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.equal(wf.rawStepCount, 1);
    assert.equal(wf.strippedStepCount, 1);
    assert.ok(!textOf(wf.jobs.get('build')).includes('build linux'));
  });

  // ── job-level keys, at the right depth ────────────────────────────────────
  test('a job-level `if:` is read and a STEP-level `if:` is not mistaken for one', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - if: \${{ always() }}
        run: echo step
  aggregate:
    runs-on: ubuntu-24.04
    if: always()
    steps:
      - run: echo agg
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.equal(wf.jobs.get('build').jobIf, null, "a step's if: is not the job's");
    assert.match(wf.jobs.get('aggregate').jobIf.cond, /always\(\)/);
  });

  test('`continue-on-error: true` is taken at ANY depth — either placement disarms an edge', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  gate:
    runs-on: ubuntu-24.04
    steps:
      - run: node gate.mjs
        continue-on-error: true
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.ok(wf.jobs.get('gate').continueOnError);
  });

  // ── the absences a caller has to be able to see ───────────────────────────
  test('a workflow with no `jobs:` key yields an EMPTY job map, never a throw', () => {
    const root = fixture({ 'a.yml': 'name: A\non:\n  workflow_dispatch:\n' });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.equal(wf.jobs.size, 0);
  });

  test('a missing file returns null so the caller decides what that means', () => {
    const root = fixture({ 'a.yml': 'name: A\n' });
    assert.equal(parseWorkflow(root, '.github/workflows/gone.yml'), null);
  });

  test('parseAllWorkflows over a root with no workflow directory returns []', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    assert.deepEqual(parseAllWorkflows(root), []);
  });

  test('parseAllWorkflows reads every .yml and .yaml, sorted', () => {
    const root = fixture({ 'b.yml': 'name: B\n', 'a.yaml': 'name: A\n' });
    assert.deepEqual(parseAllWorkflows(root).map((w) => w.rel), [
      '.github/workflows/a.yaml',
      '.github/workflows/b.yml',
    ]);
  });

  test('joinBlockScalars leaves a plain `run:` line untouched', () => {
    const out = joinBlockScalars([{ n: 1, text: '      - run: echo hi' }, { n: 2, text: '      - run: echo bye' }]);
    assert.deepEqual(out.map((l) => l.text), ['      - run: echo hi', '      - run: echo bye']);
  });

  test('a folded block STOPS at the next key — a later step is not swallowed', () => {
    const root = fixture({
      'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: >
          flutter build web
          --release
      - run: echo after
`,
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    const lines = wf.jobs.get('build').logical.map((l) => l.text.trim()).filter(Boolean);
    assert.ok(lines.some((l) => l === '- run: flutter build web --release'), JSON.stringify(lines));
    assert.ok(lines.some((l) => l === '- run: echo after'));
  });
});
