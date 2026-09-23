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
import { parseWorkflow, parseAllWorkflows, joinBlockScalars, shellSegments, workflowEvents, dispatchInputs, stepShell } from '../workflow-scan.mjs';

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

  /* ⏱ ADDED 2026-09-08 with `workflowEvents`, which moved here out of
     assert-app-dod.mjs's own parser. It reads the region ABOVE `jobs:` off the
     parse's `lines`, and the failure it has to be able to make is the one that
     matters to its caller: an `on:` GitHub honours that this function cannot see
     reads as "this lane does not run on push", which turns a gated guard into an
     ungated one in the report. */
  describe('workflowEvents', () => {
    test('the BLOCK form yields every event key', () => {
      const root = fixture({
        'a.yml': `name: A
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      const ev = workflowEvents(parseWorkflow(root, '.github/workflows/a.yml'));
      assert.deepEqual([...ev].sort(), ['pull_request', 'push', 'workflow_dispatch']);
    });

    test('the FLOW form yields every event, and stops at the bracket', () => {
      const root = fixture({
        'a.yml': `name: A
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      const ev = workflowEvents(parseWorkflow(root, '.github/workflows/a.yml'));
      assert.deepEqual([...ev].sort(), ['pull_request', 'push']);
    });

    test("a nested key is NOT an event — `branches:` under `push:` sits deeper than two spaces", () => {
      const root = fixture({
        'a.yml': `name: A
on:
  push:
    branches: [main]
    paths:
      - 'apps/**'
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      const ev = workflowEvents(parseWorkflow(root, '.github/workflows/a.yml'));
      assert.deepEqual([...ev], ['push'], 'branches/paths are the event\'s OPTIONS; counting them as events would make every paths-filtered workflow claim triggers it does not have');
    });

    test("the block ENDS at the next top-level key — `jobs:` is not an event", () => {
      const root = fixture({
        'a.yml': `name: A
on:
  schedule:
    - cron: '0 3 * * *'
env:
  NODE_VERSION: '24'
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      const ev = workflowEvents(parseWorkflow(root, '.github/workflows/a.yml'));
      assert.deepEqual([...ev], ['schedule'], 'the walk must stop at the first unindented line, or every top-level key becomes an event');
    });

    test('a COMMENTED-OUT event is not an event — comments are blanked before this reads', () => {
      const root = fixture({
        'a.yml': `name: A
on:
  push:
  # pull_request:
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      const ev = workflowEvents(parseWorkflow(root, '.github/workflows/a.yml'));
      assert.deepEqual([...ev], ['push'], 'a commented trigger does not run; reading it as one is the "reports clean" direction this module exists to stop');
    });

    test('a workflow with no `on:` yields an EMPTY set, and a missing file does too', () => {
      const root = fixture({
        'a.yml': `name: A
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      });
      assert.equal(workflowEvents(parseWorkflow(root, '.github/workflows/a.yml')).size, 0);
      /* null in, empty out — the caller's `.has('push')` must not throw on a
         workflow that is not there, because the ABSENCE is already somebody
         else's COVERAGE LOST and two refusals for one fact help nobody. */
      assert.equal(workflowEvents(parseWorkflow(root, '.github/workflows/nope.yml')).size, 0);
    });
  });

  /* ⏱ ADDED 2026-09-23 with `dispatchInputs`, for tooling/ops/redeploy-stranded.mjs:
     a lane whose dispatch takes inputs is never reproduced by a bare {ref:'main'}
     POST, and inputs are how a store publish takes the owner's word. The failure
     that matters is reading "no inputs" off a lane that has them, so the case is
     the three shapes that could hide them: the event's own child, a key of the
     same name one level deeper, and `inputs:` under a DIFFERENT event. */
  test('dispatchInputs reads the `inputs:` child of `workflow_dispatch:` and nothing else', () => {
    const root = fixture({
      'with.yml': `name: W
on:
  workflow_dispatch:
    inputs:
      lane:
        type: choice
jobs:
  build:
    runs-on: ubuntu-24.04
`,
      'bare.yml': `name: B
on:
  workflow_dispatch:
  workflow_call:
    inputs:
      lane:
        type: string
  schedule:
    - cron: '0 6 * * 1'
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: echo inputs:
`,
      'flow.yml': `name: F
on: [push, workflow_dispatch]
jobs:
  build:
    runs-on: ubuntu-24.04
`,
    });
    assert.equal(dispatchInputs(parseWorkflow(root, '.github/workflows/with.yml')), 4);
    assert.equal(dispatchInputs(parseWorkflow(root, '.github/workflows/bare.yml')), null, 'workflow_call inputs are not the dispatch ones');
    assert.equal(dispatchInputs(parseWorkflow(root, '.github/workflows/flow.yml')), null);
  });

  /* ⏱ ADDED 2026-09-23 with `stepShell`, for the [10]D-9 recorder step in
     submit-windows-store.yml: no `shell:` in a windows-2025 job, so it ran under
     pwsh and its bash-written "$LISTING_URL" expanded to nothing. The failure
     that matters is naming the wrong shell, so each case is one link of GitHub's
     order — step, job defaults, workflow defaults, runner — plus the shapes that
     must come back UNKNOWN rather than guessed. */
  describe('stepShell', () => {
    const shellAt = (body, needle) => {
      const root = fixture({ 'a.yml': body });
      const wf = parseWorkflow(root, '.github/workflows/a.yml');
      const n = wf.lines.find((l) => l.text.includes(needle)).n;
      return stepShell(wf, n);
    };

    test('a Windows runner with no shell declared anywhere runs PWSH — the default the Store recorder fell into', () => {
      const sh = shellAt(`name: A
jobs:
  submit:
    runs-on: windows-2025
    steps:
      - name: record
        env:
          LISTING_URL: x
        run: node record.mjs --listing-url "$LISTING_URL"
`, 'record.mjs');
      assert.deepEqual(sh, { shell: 'pwsh', family: 'pwsh', from: 'runner default, runs-on: windows-2025', n: 4 });
    });

    test('a Linux runner with no shell declared runs bash', () => {
      const sh = shellAt(`name: A
jobs:
  submit:
    runs-on: ubuntu-24.04
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.equal(sh.family, 'bash');
      assert.equal(sh.from, 'runner default, runs-on: ubuntu-24.04');
    });

    test('the STEP\'s own `shell:` beats the job defaults and the runner, and its family is the first word', () => {
      const sh = shellAt(`name: A
jobs:
  submit:
    runs-on: windows-2025
    defaults:
      run:
        shell: pwsh
    steps:
      - name: record
        shell: bash -e {0}
        run: node record.mjs
`, 'record.mjs');
      assert.deepEqual(sh, { shell: 'bash -e {0}', family: 'bash', from: 'step', n: 10 });
    });

    test('a JOB `defaults.run.shell` beats the workflow defaults and the runner', () => {
      const sh = shellAt(`name: A
defaults:
  run:
    shell: pwsh
jobs:
  submit:
    runs-on: windows-2025
    defaults:
      run:
        shell: bash
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.deepEqual(sh, { shell: 'bash', family: 'bash', from: 'job defaults', n: 10 });
    });

    test('a WORKFLOW `defaults.run.shell` applies to a job that declares none', () => {
      const sh = shellAt(`name: A
defaults:
  run:
    shell: bash
jobs:
  submit:
    runs-on: windows-2025
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.deepEqual(sh, { shell: 'bash', family: 'bash', from: 'workflow defaults', n: 4 });
    });

    test('a `defaults.run` that sets only `working-directory` declares NO shell — the runner still decides', () => {
      const sh = shellAt(`name: A
defaults:
  run:
    working-directory: extensions
jobs:
  submit:
    runs-on: windows-2025
    defaults:
      run:
        working-directory: .
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.equal(sh.family, 'pwsh', 'extensions.yml writes exactly this shape; reading it as a shell declaration would hide a pwsh default');
    });

    test('a line inside a `run: |` block resolves to the step that runs it, never to a later step', () => {
      const sh = shellAt(`name: A
jobs:
  release:
    runs-on: windows-2025
    steps:
      - name: record every environment
        shell: bash
        run: |
          for environment in a b; do
            node record.mjs "$environment"
          done
      - name: later
        shell: pwsh
        run: echo later
`, 'record.mjs');
      assert.deepEqual(sh, { shell: 'bash', family: 'bash', from: 'step', n: 7 });
    });

    test('a runs-on EXPRESSION with no declared shell is UNKNOWN, never guessed', () => {
      const sh = shellAt(`name: A
jobs:
  capture:
    runs-on: \${{ inputs.channel == 'windows-store' && 'windows-2025' || 'macos-26' }}
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.equal(sh.shell, null);
      assert.equal(sh.from, 'unknown');
      assert.match(sh.why, /names its runner only at run time/);
    });

    test('a runs-on label set that names NO OS, with no declared shell, is UNKNOWN, never guessed', () => {
      const sh = shellAt(`name: A
jobs:
  submit:
    runs-on: [self-hosted, x64]
    steps:
      - run: node record.mjs
`, 'record.mjs');
      assert.equal(sh.shell, null);
      assert.equal(sh.from, 'unknown');
      assert.match(sh.why, /names no OS/);
    });

    test('a line outside every job is UNKNOWN', () => {
      const sh = shellAt(`name: A
env:
  RECORD: record.mjs
jobs:
  build:
    runs-on: ubuntu-24.04
`, 'record.mjs');
      assert.equal(sh.shell, null);
      assert.match(sh.why, /is in no job/);
    });
  });
});
