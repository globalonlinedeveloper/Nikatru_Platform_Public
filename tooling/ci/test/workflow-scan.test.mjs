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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflow, parseAllWorkflows, joinBlockScalars, shellSegments, workflowEvents, dispatchInputs, stepShell,
  stepItemAround, workflowSteps, jobEnv, githubEnvWrites, joinShellContinuations, commandAt, flutterDrives,
  resolveLocalCalls, parseResolvedWorkflows, lineAt, placeOf, refusalText, jobEnvironment,
  ACTION_DIR, parseAllActions, workflowName, workflowUses, workflowSecrets,
  POST_GATE_IF, postGateClass, postGateJobs, laneRunHost, laneRefusalText,
  EMIT_RELEASE_JSON_MODE, emitOutputDir, emitInvocations,
  flutterBuilds, flutterReleaseBuilds, buildMode, RELEASE_MODES,
} from '../workflow-scan.mjs';

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

  test('workflowName, workflowUses and workflowSecrets read code lines only, and rawLines keeps the comments', () => {
    const root = fixture({
      'a.yml': [
        "name: 'Build it'",
        'on:',
        '  push:',
        'jobs:',
        '  one:',
        '    uses: owner/repo/.github/workflows/reusable.yml@v1',
        '  two:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      # - uses: commented/out@v1  ${{ secrets.COMMENTED }}',
        '      - uses: actions/checkout@abc # v4',
        '      - run: node tooling/ci/scan-secrets.mjs && echo "uses: not-a-key@v1"',
        '        env:',
        '          A: ${{ secrets.FIRST }}',
        '          B: ${{ secrets.SECOND }} ${{ secrets.FIRST }}',
        '',
      ].join('\n'),
    });
    const wf = parseWorkflow(root, '.github/workflows/a.yml');
    assert.equal(workflowName(wf), 'Build it');
    assert.deepEqual(workflowUses(wf).map((u) => u.uses), ['owner/repo/.github/workflows/reusable.yml@v1', 'actions/checkout@abc']);
    assert.deepEqual(workflowSecrets(wf).map((s) => [s.n, s.name]), [[14, 'FIRST'], [15, 'SECOND'], [15, 'FIRST']]);
    assert.match(wf.rawLines[9].text, /commented\/out/);
    assert.equal(wf.lines[9].text, '');
    assert.equal(workflowName(parseWorkflow(fixture({ 'b.yml': 'on:\n  push:\n' }), '.github/workflows/b.yml')), null);
  });

  test('parseAllActions reads each .github/actions/<name>/action.yml, sorted, and [] when there is none', () => {
    const root = fixture({ 'a.yml': 'name: A\n' });
    assert.deepEqual(parseAllActions(root), []);
    for (const [d, f] of [['setup-z', 'action.yml'], ['setup-a', 'action.yaml']]) {
      mkdirSync(join(root, ACTION_DIR, d), { recursive: true });
      writeFileSync(join(root, ACTION_DIR, d, f), `name: ${d}\nruns:\n  using: composite\n  steps:\n    - uses: x/${d}@v1\n`);
    }
    const actions = parseAllActions(root);
    assert.deepEqual(actions.map((a) => a.rel), ['.github/actions/setup-a/action.yaml', '.github/actions/setup-z/action.yml']);
    assert.deepEqual(actions.map((a) => workflowUses(a)[0].uses), ['x/setup-a@v1', 'x/setup-z@v1']);
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

// ⏱ ADDED 2026-09-23 — the step readers assert-live-writer-provenance.mjs reads the
// tree through. Each case is a way a step reader could hand that guard the wrong
// step, the wrong env or the wrong drive, and so a clean verdict over a wrong fact.
describe('workflow-scan: the step readers and the live-drive census', () => {
  const STEPS_YML = `name: A
env:
  TOP: 1
jobs:
  drive:
    runs-on: ubuntu-24.04
    env:
      E2E_APP_ID: subscriptiontracker
      QUOTED: "x y"
    steps:
      - name: Stamp
        id: stamp
        run: echo "E2E_APP_VERSION=e2e-\${{ github.run_number }}-\${GITHUB_SHA::7}" >> "$GITHUB_ENV"
      - name: Maybe
        if: failure()
        run: |
          echo "LATE=1" >> "$GITHUB_ENV"
          echo "OUT=1" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        with:
          token: abc
          FAKE_ENV: no
      - name: Drive
        env:
          E2E_DRIVE_LOG: \${{ runner.temp }}/drive.log
        run: |
          flutter drive \\
            --driver=test_driver/integration_test.dart \\
            --dart-define=APP_VERSION="$E2E_APP_VERSION" \\
            -d web-server 2>&1 | tee "$E2E_DRIVE_LOG"
  bare:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter drive --driver=test_driver/integration_test.dart -d web-server
`;
  const jobOf = (name) => parseWorkflow(fixture({ 'a.yml': STEPS_YML }), '.github/workflows/a.yml').jobs.get(name);
  const lineOf = (needle) => STEPS_YML.split('\n').findIndex((l) => l.includes(needle)) + 1;

  test('stepItemAround finds the `- ` item holding a nested line, and null outside every item', () => {
    const job = jobOf('drive');
    const at = job.lines.findIndex((l) => l.text.includes('token: abc'));
    const item = stepItemAround(job.lines, at);
    assert.equal(job.lines[item.start].n, lineOf('- uses: actions/checkout@v4'));
    assert.equal(job.lines[item.end].n, lineOf('- name: Drive'));
    assert.equal(stepItemAround(job.lines, job.lines.findIndex((l) => l.text.includes('runs-on:'))), null);
    assert.equal(stepItemAround(job.lines, job.lines.length), null);
  });

  test('workflowSteps reads each step\'s id, name, if: and run: at the lines the file has them', () => {
    const steps = workflowSteps(jobOf('drive'));
    assert.equal(steps.length, 4);
    assert.deepEqual(steps.map((s) => s.index), [0, 1, 2, 3]);
    assert.equal(steps[0].id, 'stamp');
    assert.equal(steps[0].name, 'Stamp');
    assert.equal(steps[0].cond, null);
    assert.equal(steps[0].first, lineOf('- name: Stamp'));
    assert.equal(steps[0].run.n, lineOf('run: echo "E2E_APP_VERSION'));
    assert.equal(steps[1].cond, 'failure()');
    assert.equal(steps[3].first, lineOf('- name: Drive'));
    assert.equal(steps[3].last, lineOf('-d web-server'));
    assert.match(steps[3].run.text, /flutter drive .* ; .*--dart-define=APP_VERSION/);
  });

  test('workflowSteps takes a step\'s env: and never its with: — a with: key is not an environment variable', () => {
    const steps = workflowSteps(jobOf('drive'));
    assert.equal(steps[2].env.size, 0);
    assert.equal(steps[2].run, null);
    assert.deepEqual([...steps[3].env.keys()], ['E2E_DRIVE_LOG']);
    assert.deepEqual(steps[3].env.get('E2E_DRIVE_LOG'), { n: lineOf('E2E_DRIVE_LOG: ${{'), value: '${{ runner.temp }}/drive.log' });
  });

  // ⏱ ADDED 2026-09-24 — `uses` and `with`, for assert-workflow-hardening.mjs limb 8.
  const WITH_YML = `name: W
jobs:
  up:
    runs-on: ubuntu-24.04
    steps:
      - name: Register
        id: reg
        run: echo "dir=x" >> "$GITHUB_OUTPUT"
      - name: Keep the frames
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: shots-\${{ github.run_id }}
          if-no-files-found: ignore
          path: |
            logs/
            \${{ steps.x.outputs.k }}/
          retention-days: 3
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, token: '\${{ secrets.T }}' }
      - uses: "some/action@v1"
        with:
          body: >
            one
            two
          wrapped: first
            second
`;
  const withJob = () => parseWorkflow(fixture({ 'w.yml': WITH_YML }), '.github/workflows/w.yml').jobs.get('up');
  const withLine = (needle) => WITH_YML.split('\n').findIndex((l) => l.includes(needle)) + 1;

  test('workflowSteps reads `uses:` from a `- uses:` item and from an indented key, and null on a run: step', () => {
    const steps = workflowSteps(withJob());
    assert.deepEqual(steps.map((s) => s.uses), [null, 'actions/upload-artifact@v4', 'actions/checkout@v4', 'some/action@v1']);
  });

  test('workflowSteps reads `with:` keys, hyphens included, each at its own line', () => {
    const up = workflowSteps(withJob())[1];
    assert.deepEqual([...up.with.keys()], ['name', 'if-no-files-found', 'path', 'retention-days']);
    assert.deepEqual(up.with.get('name'), { n: withLine('name: shots-'), value: 'shots-${{ github.run_id }}' });
    assert.deepEqual(up.with.get('if-no-files-found'), { n: withLine('if-no-files-found:'), value: 'ignore' });
    assert.deepEqual(up.with.get('retention-days'), { n: withLine('retention-days:'), value: '3' });
    assert.equal(up.env.size, 0, 'a with: key is still never an environment variable');
  });

  test('workflowSteps joins a `path: |` block\'s continuation lines into the key\'s value, at the key\'s line', () => {
    const up = workflowSteps(withJob())[1];
    assert.deepEqual(up.with.get('path'), { n: withLine('path: |'), value: 'logs/\n${{ steps.x.outputs.k }}/' });
  });

  test('workflowSteps folds a `>` block with spaces, joins a wrapped plain value, and reads a flow-mapping `with:`', () => {
    const steps = workflowSteps(withJob());
    assert.deepEqual(steps[2].with.get('fetch-depth'), { n: withLine('with: { fetch-depth'), value: '0' });
    assert.deepEqual(steps[2].with.get('token'), { n: withLine('with: { fetch-depth'), value: '${{ secrets.T }}' });
    assert.equal(steps[3].with.get('body').value, 'one two');
    assert.equal(steps[3].with.get('wrapped').value, 'first second');
    assert.equal(steps[0].with.size, 0);
  });

  test('jobEnv reads the job\'s own env: with quotes removed, and neither the workflow\'s nor a step\'s', () => {
    const env = jobEnv(jobOf('drive'));
    assert.deepEqual([...env.keys()], ['E2E_APP_ID', 'QUOTED']);
    assert.equal(env.get('QUOTED').value, 'x y');
    assert.equal(jobEnv(jobOf('bare')).size, 0);
  });

  test('githubEnvWrites takes every `>> "$GITHUB_ENV"` echo with its step and if:, and no $GITHUB_OUTPUT write', () => {
    const writes = githubEnvWrites(jobOf('drive'));
    assert.deepEqual(writes.map((w) => [w.name, w.expr, w.stepIndex, w.cond]), [
      ['E2E_APP_VERSION', 'e2e-${{ github.run_number }}-${GITHUB_SHA::7}', 0, null],
      ['LATE', '1', 1, 'failure()'],
    ]);
  });

  test('joinShellContinuations rejoins a `\\` continuation; commandAt reads command position through xvfb-run and assignments, never inside echo', () => {
    assert.equal(joinShellContinuations('flutter drive \\ ; --driver=x.dart \\ ; -d chrome'), 'flutter drive --driver=x.dart -d chrome');
    const cmd = 'node\\s+tooling/x\\.mjs';
    assert.equal(commandAt('xvfb-run -a -s "-screen 0 2560x1600x24" node tooling/x.mjs --app a', cmd), true);
    assert.equal(commandAt('FOO=1 BAR=2 node tooling/x.mjs', cmd), true);
    assert.equal(commandAt('echo "then run node tooling/x.mjs"', cmd), false);
  });

  test('flutterDrives reads a continued drive\'s defines, APP_VERSION and tee target, and a bare drive as null for both', () => {
    const root = fixture({ 'a.yml': STEPS_YML });
    const drives = flutterDrives(root);
    assert.equal(drives.length, 2);
    const [d, bare] = drives;
    assert.deepEqual([d.workflow, d.job, d.stepIndex, d.runLine], ['.github/workflows/a.yml', 'drive', 3, lineOf('- name: Drive') + 3]);
    assert.deepEqual([...d.defines], ['APP_VERSION']);
    assert.equal(d.appVersionExpr, '$E2E_APP_VERSION');
    assert.equal(d.teeTarget, '$E2E_DRIVE_LOG');
    assert.deepEqual([bare.job, bare.appVersionExpr, bare.teeTarget], ['bare', null, null]);
    assert.equal(bare.defines.size, 0);
  });
});

// ⏱ 2026-09-24 — resolveLocalCalls: a local call job followed ONE level, and the two refusals it
// returns instead of exiting (the calling guard turns either into its own COVERAGE LOST).
const CALLER_YML = `name: Caller
on: [push]
jobs:
  lint:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: echo lint
  lane:
    uses: ./.github/workflows/callee.yml
    permissions:
      contents: read
  pinned:
    uses: owner/repo/.github/workflows/x.yml@0123456789abcdef0123456789abcdef01234567
`;
const CALLEE_YML = `name: Callee
on:
  workflow_call:
jobs:
  core:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: ./.github/actions/setup-flutter
      - run: echo core
`;

describe('workflow-scan resolveLocalCalls', () => {
  test('one level resolves: the call job names its callee, a step-level ./ action is not a call, a remote ref is listed apart', () => {
    const root = fixture({ 'caller.yml': CALLER_YML, 'callee.yml': CALLEE_YML });
    const all = parseAllWorkflows(root);
    const r = resolveLocalCalls(all.find((w) => w.rel === '.github/workflows/caller.yml'), all);
    assert.equal(r.refusal, null);
    assert.deepEqual(r.calls.map((c) => [c.job, c.callee.rel]), [['lane', '.github/workflows/callee.yml']]);
    assert.equal(r.calls[0].n, CALLER_YML.split('\n').indexOf('    uses: ./.github/workflows/callee.yml') + 1);
    assert.deepEqual(r.remote.map((c) => c.job), ['pinned']);
    assert.deepEqual(resolveLocalCalls(all.find((w) => w.rel === '.github/workflows/callee.yml'), all).calls, []);
  });

  test('a missing callee is a refusal of kind `missing`, naming the callee path and the call job', () => {
    const root = fixture({ 'caller.yml': CALLER_YML });
    const all = parseAllWorkflows(root);
    const r = resolveLocalCalls(all[0], all);
    assert.deepEqual(r.refusal && [r.refusal.kind, r.refusal.job, r.refusal.callee], ['missing', 'lane', '.github/workflows/callee.yml']);
    assert.deepEqual(r.calls, []);
  });

  test('a callee that itself makes a local call is a refusal of kind `nested`: one level, never two', () => {
    const nested = CALLEE_YML + '  deeper:\n    uses: ./.github/workflows/third.yml\n';
    const root = fixture({ 'caller.yml': CALLER_YML, 'callee.yml': nested, 'third.yml': CALLEE_YML });
    const all = parseAllWorkflows(root);
    const r = resolveLocalCalls(all.find((w) => w.rel === '.github/workflows/caller.yml'), all);
    assert.deepEqual(r.refusal && [r.refusal.kind, r.refusal.job, r.refusal.callee], ['nested', 'lane', '.github/workflows/callee.yml']);
    assert.deepEqual(r.calls, []);
  });
});

// ⏱ 2026-09-24 — parseResolvedWorkflows (O-GUARDS-DO-NOT-FOLLOW-LOCAL-USES): a step behind
// `uses: ./.github/actions/<x>` and a job behind `uses: ./.github/workflows/<f>.yml` are read
// in place, each inlined line printing its real `<file>:<line>`, and the five references it
// cannot follow come back as a refusal (each reader's own COVERAGE LOST). One case per behaviour.
function actionFixture(workflows, actions) {
  const root = fixture(workflows);
  for (const [name, body] of Object.entries(actions)) {
    mkdirSync(join(root, '.github', 'actions', name), { recursive: true });
    writeFileSync(join(root, '.github', 'actions', name, 'action.yml'), body);
  }
  return root;
}

const PUB_ACTION = `name: Publish
inputs:
  target:
    description: where
    default: staging
  dry-run:
    default: 'false'
runs:
  using: composite
  steps:
    - name: Deploy
      shell: bash
      run: |
        wrangler pages deploy --branch \${{ inputs.target }}
        echo dry=\${{ inputs.dry-run }}
    - name: Record
      if: always()
      shell: bash
      run: node tooling/scripts/record.mjs
`;
const USES_YML = `name: Uses
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
      - name: Publish it
        if: github.ref == 'refs/heads/main'
        uses: ./.github/actions/pub
        with:
          target: production
      - run: echo after
`;
const RELEASE_YML = `name: Release
on:
  push:
    tags: ['v*']
jobs:
  gate:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: echo gate
  ship:
    needs: gate
    if: github.repository == 'o/r'
    uses: ./.github/workflows/ship.yml
`;
const SHIP_YML = `name: Ship
on:
  workflow_call:
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: echo build
  deploy:
    needs: build
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    environment: production
    steps:
      - uses: ./.github/actions/pub
`;

describe('workflow-scan parseResolvedWorkflows', () => {
  test('a composite step is replaced AT ITS INDEX by the composite\'s steps, and each inlined line prints its action.yml line', () => {
    const root = actionFixture({ 'uses.yml': USES_YML }, { pub: PUB_ACTION });
    const r = parseResolvedWorkflows(root);
    assert.equal(r.refusal, null);
    const wf = r.workflows[0];
    const job = wf.jobs.get('deploy');
    const steps = workflowSteps(job);
    assert.deepEqual(steps.map((s) => s.name ?? null), [null, 'Deploy', 'Record', null]);
    assert.equal(steps[3].run.text, 'echo after');
    assert.ok(steps[0].first < steps[1].first && steps[2].last < steps[3].first);
    assert.equal(placeOf(wf, steps[1].first), '.github/actions/pub/action.yml:11');
    assert.equal(lineAt(wf, steps[2].first), '.github/actions/pub/action.yml:16');
    assert.equal(lineAt(wf, steps[3].first), ':14');
    assert.equal(placeOf(wf, steps[3].first), '.github/workflows/uses.yml:14');
    assert.equal(job.lines.some((l) => l.text.includes('./.github/actions/pub')), false);
    assert.deepEqual(r.filesRead, ['.github/workflows/uses.yml', '.github/actions/pub/action.yml']);
  });

  test('`${{ inputs.X }}` becomes the calling step\'s `with: X`, or the action\'s `default:` when the caller passes none', () => {
    const root = actionFixture({ 'uses.yml': USES_YML }, { pub: PUB_ACTION });
    const wf = parseResolvedWorkflows(root).workflows[0];
    const deploy = workflowSteps(wf.jobs.get('deploy'))[1];
    assert.equal(deploy.run.text, 'wrangler pages deploy --branch production ; echo dry=false');
  });

  test('the calling step\'s `if:` gates each inlined step that has none, printed at the CALLER\'s line; a step\'s own `if:` stays', () => {
    const root = actionFixture({ 'uses.yml': USES_YML }, { pub: PUB_ACTION });
    const wf = parseResolvedWorkflows(root).workflows[0];
    const job = wf.jobs.get('deploy');
    const steps = workflowSteps(job);
    assert.equal(steps[1].cond, "github.ref == 'refs/heads/main'");
    assert.equal(steps[2].cond, 'always()');
    const injected = job.lines.find((l) => l.text.trim() === "if: github.ref == 'refs/heads/main'");
    assert.equal(placeOf(wf, injected.n), '.github/workflows/uses.yml:10');
  });

  test('a callee\'s jobs become `<caller>/<job>` children in the CALLER\'s workflow: its triggers, its `needs`, its `if:`', () => {
    const root = actionFixture({ 'release.yml': RELEASE_YML, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION });
    const r = parseResolvedWorkflows(root);
    assert.equal(r.refusal, null);
    assert.deepEqual(r.workflows.map((w) => w.rel), ['.github/workflows/release.yml']);
    const wf = r.workflows[0];
    assert.deepEqual([...wf.jobs.keys()], ['gate', 'ship', 'ship/build', 'ship/deploy']);
    assert.equal(workflowEvents(wf).has('push'), true);
    const child = wf.jobs.get('ship/deploy');
    assert.deepEqual(child.needs, ['gate', 'ship/build']);
    assert.equal(child.jobIf.cond, "github.repository == 'o/r'");
    assert.equal(child.calledBy, 'ship');
    assert.equal(child.callee, '.github/workflows/ship.yml');
    const env = child.lines.find((l) => l.text.trim() === 'environment: production');
    assert.equal(placeOf(wf, env.n), '.github/workflows/ship.yml:14');
    assert.deepEqual(r.filesRead, ['.github/workflows/release.yml', '.github/workflows/ship.yml', '.github/actions/pub/action.yml']);
  });

  test('a composite used INSIDE a callee job is inlined into the child too, still printing its action.yml line', () => {
    const root = actionFixture({ 'release.yml': RELEASE_YML, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION });
    const wf = parseResolvedWorkflows(root).workflows[0];
    const steps = workflowSteps(wf.jobs.get('ship/deploy'));
    assert.deepEqual(steps.map((s) => s.name), ['Deploy', 'Record']);
    assert.equal(steps[0].run.text, 'wrangler pages deploy --branch staging ; echo dry=false');
    assert.equal(placeOf(wf, steps[1].first), '.github/actions/pub/action.yml:16');
  });

  test('refusal `nested`: a composite that itself uses a local action — one level, never two', () => {
    const nested = PUB_ACTION + '    - uses: ./.github/actions/other\n';
    const root = actionFixture({ 'uses.yml': USES_YML }, { pub: nested, other: PUB_ACTION });
    const r = parseResolvedWorkflows(root);
    assert.deepEqual(r.refusal, { kind: 'nested', at: '.github/actions/pub/action.yml:20', path: './.github/actions/other' });
  });

  test('refusal `missing`: a local action that is not in the tree, and the sentence a reader prints for it', () => {
    const root = actionFixture({ 'uses.yml': USES_YML }, {});
    const r = parseResolvedWorkflows(root);
    assert.deepEqual(r.refusal, { kind: 'missing', at: '.github/workflows/uses.yml:11', path: '.github/actions/pub/action.yml' });
    assert.match(refusalText(r.refusal), /\(missing\) at \.github\/workflows\/uses\.yml:11: \.github\/actions\/pub\/action\.yml/);
  });

  test('refusal `remote`: a job-level `uses:` of another repository\'s workflow (a step\'s third-party action is not one)', () => {
    const remote = RELEASE_YML.replace('./.github/workflows/ship.yml', 'other/repo/.github/workflows/x.yml@0000000');
    const root = actionFixture({ 'release.yml': remote }, {});
    const r = parseResolvedWorkflows(root);
    assert.deepEqual(r.refusal, { kind: 'remote', at: '.github/workflows/release.yml:14', path: 'other/repo/.github/workflows/x.yml@0000000' });
  });

  test('refusal `not-composite`: a local action whose `runs.using` is not `composite` has no steps to read', () => {
    const js = 'name: Js\nruns:\n  using: node20\n  main: index.js\n';
    const root = actionFixture({ 'uses.yml': USES_YML }, { pub: js });
    const r = parseResolvedWorkflows(root);
    assert.deepEqual(r.refusal, { kind: 'not-composite', at: '.github/workflows/uses.yml:11', path: '.github/actions/pub/action.yml' });
  });

  test('refusal `orphan-callee`: a workflow_call-only workflow nobody here calls, and it is not returned on its own', () => {
    const root = actionFixture({ 'ship.yml': SHIP_YML }, { pub: PUB_ACTION });
    const r = parseResolvedWorkflows(root);
    assert.deepEqual(r.refusal, { kind: 'orphan-callee', at: '.github/workflows/ship.yml:1', path: '.github/workflows/ship.yml' });
    assert.deepEqual(r.workflows, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 [ADR 095 §4] — the post-gate class and a lane's run host, ONE
// definition each. assert-green-means-ran A9 and assert-ops-register import the
// class; every served-lane reader imports laneRunHost.
const POST_GATE_CI = `name: CI
on: [push, pull_request]
jobs:
  lane:
    runs-on: ubuntu-24.04
    steps:
      - run: echo lane
  ci-gate:
    needs: [lane]
    if: always()
    runs-on: ubuntu-24.04
    steps:
      - run: echo gate
  ship:
    needs: [ci-gate]
    if: ${POST_GATE_IF}
    uses: ./.github/workflows/ship.yml
  wide:
    needs: [ci-gate]
    if: always()
    runs-on: ubuntu-24.04
    steps:
      - run: echo wide
  loose:
    needs: [lane]
    if: ${POST_GATE_IF}
    runs-on: ubuntu-24.04
    steps:
      - run: echo loose
`;

describe('workflow-scan postGateClass / postGateJobs', () => {
  test('each job touching the class is named once, in file order: post, wide-if, ungated', () => {
    const wf = parseWorkflow(fixture({ 'ci.yml': POST_GATE_CI }), '.github/workflows/ci.yml');
    assert.deepEqual(postGateClass(wf, 'ci-gate'), [
      { id: 'ship', kind: 'post', cond: POST_GATE_IF },
      { id: 'wide', kind: 'wide-if', cond: 'always()' },
      { id: 'loose', kind: 'ungated', cond: POST_GATE_IF },
    ]);
    assert.deepEqual(postGateJobs(wf, 'ci-gate'), ['ship']);
  });

  test('RED CONTROL — the predicate is byte-equal: a wrapped or reordered `if:` is wide-if, never post', () => {
    for (const cond of [`\${{ ${POST_GATE_IF} }}`, "github.ref == 'refs/heads/main' && github.event_name == 'push'", "github.event_name == 'push'"]) {
      const wf = parseWorkflow(fixture({ 'ci.yml': POST_GATE_CI.replace(`if: ${POST_GATE_IF}\n    uses:`, `if: ${cond}\n    uses:`) }), '.github/workflows/ci.yml');
      assert.deepEqual(postGateJobs(wf, 'ci-gate'), [], cond);
      assert.equal(postGateClass(wf, 'ci-gate')[0].kind, 'wide-if', cond);
    }
  });

  test('in the RESOLVED view the call job is graded, never its `<call>/<job>` children', () => {
    const root = actionFixture({ 'ci.yml': POST_GATE_CI, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION });
    const wf = parseResolvedWorkflows(root).workflows.find((w) => w.rel === '.github/workflows/ci.yml');
    assert.ok(wf.jobs.has('ship/deploy'));
    assert.deepEqual(postGateJobs(wf, 'ci-gate'), ['ship']);
  });
});

describe('workflow-scan laneRunHost', () => {
  const second = RELEASE_YML.replace('name: Release', 'name: Again');

  test('a file with its own trigger runs as itself', () => {
    const scan = parseResolvedWorkflows(actionFixture({ 'release.yml': RELEASE_YML, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION }));
    assert.deepEqual(laneRunHost(scan, '.github/workflows/release.yml'), { workflow: '.github/workflows/release.yml', callJob: null, children: null });
  });

  test('a call-only file runs as its ONE caller\'s call job: the caller, the call job and its children', () => {
    const scan = parseResolvedWorkflows(actionFixture({ 'release.yml': RELEASE_YML, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION }));
    const host = laneRunHost(scan, '.github/workflows/ship.yml');
    assert.equal(host.workflow, '.github/workflows/release.yml');
    assert.equal(host.callJob, 'ship');
    assert.deepEqual(host.children.map((j) => j.name), ['ship/build', 'ship/deploy']);
  });

  test('RED CONTROL — two call jobs run it: `ambiguous-callee`, never the first one found', () => {
    const scan = parseResolvedWorkflows(actionFixture({ 'release.yml': RELEASE_YML, 'again.yml': second, 'ship.yml': SHIP_YML }, { pub: PUB_ACTION }));
    const { refusal } = laneRunHost(scan, '.github/workflows/ship.yml');
    assert.equal(refusal.kind, 'ambiguous-callee');
    assert.equal(refusal.hosts, 2);
    assert.match(laneRefusalText(refusal), /ship\.yml is `workflow_call`-only and 2 call job\(s\) run it \(\.github\/workflows\/again\.yml#ship, \.github\/workflows\/release\.yml#ship\)/);
  });

  test('RED CONTROL — no call job runs it: `orphan-callee`; no such file: `missing`', () => {
    const scan = parseResolvedWorkflows(actionFixture({ 'ship.yml': SHIP_YML }, { pub: PUB_ACTION }));
    assert.equal(laneRunHost(scan, '.github/workflows/ship.yml').refusal.kind, 'orphan-callee');
    assert.match(laneRefusalText(laneRunHost(scan, '.github/workflows/ship.yml').refusal), /no call job runs it \(orphan-callee\)/);
    assert.equal(laneRunHost(scan, '.github/workflows/gone.yml').refusal.kind, 'missing');
  });
});

// ⏱ 2026-09-25 · O-RELEASE-EMITTER-WRITES-UNCHECKED — the emitter's call sites,
// found once for assert-release-json.test.mjs and assert-release-durable.mjs.
const EMIT_YML = `name: E
on: push
jobs:
  release:
    runs-on: ubuntu-latest
    env:
      NOTE: --emit-release-json is named at job level and is no step
    steps:
      - run: echo build
      - name: Describe the release
        run: |
          set -eu
          node "$RM" --app a \\
            --emit-release-json dist \\
            --tag t
      - run: node tooling/ci/release-manifest.mjs --write dist
  other:
    runs-on: ubuntu-latest
    steps:
      - run: node tooling/ci/release-manifest.mjs --emit-release-json out/x --app b
`;

describe('workflow-scan emit-release-json call sites', () => {
  test('EMIT_RELEASE_JSON_MODE is the name release-manifest.mjs selects its mode by', () => {
    const src = readFileSync(join(CI_DIR, 'release-manifest.mjs'), 'utf8');
    assert.ok(src.includes(`has('${EMIT_RELEASE_JSON_MODE}')`), `release-manifest.mjs no longer selects has('${EMIT_RELEASE_JSON_MODE}')`);
  });

  test('emitOutputDir reads the token after the flag as the emitter does: across a continuation, never a following --flag', () => {
    assert.equal(emitOutputDir('node tooling/ci/release-manifest.mjs --emit-release-json dist --app a'), 'dist');
    assert.equal(emitOutputDir('node "$RM" --app a \\ ; --emit-release-json \\ ; extensions/dist \\ ; --tag t'), 'extensions/dist');
    assert.equal(emitOutputDir('node rm.mjs --emit-release-json --app a'), null);
    assert.equal(emitOutputDir('node rm.mjs --write dist'), null);
  });

  test('emitInvocations finds every step naming the mode, in any order, with its step, line and dir — and no job-level mention', () => {
    const root = fixture({ 'e.yml': EMIT_YML });
    const found = emitInvocations(root);
    const lines = EMIT_YML.split('\n');
    assert.deepEqual(
      found.map((f) => [f.job.name, f.step.name, f.step.first, f.n, f.dir]),
      [
        ['release', 'Describe the release', lines.indexOf('      - name: Describe the release') + 1, lines.indexOf('        run: |') + 1, 'dist'],
        ['other', null, lines.indexOf('      - run: node tooling/ci/release-manifest.mjs --emit-release-json out/x --app b') + 1, lines.indexOf('      - run: node tooling/ci/release-manifest.mjs --emit-release-json out/x --app b') + 1, 'out/x'],
      ],
    );
    assert.deepEqual(emitInvocations(root, []), []);
  });
});

describe('workflow-scan flutterBuilds: every build, and its mode', () => {
  const MODES_YML = `name: Modes
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter build web --pwa-strategy=none
      - run: |
          flutter build apk --release --dart-define=RELEASE_CHANNEL=android-play
          flutter build apk --debug
      - run: flutter build linux --profile
      - run: flutter build windows --release --profile
`;

  test('buildMode: no flag is default, --release is release, --debug/--profile is itself, --release beside one is contradictory', () => {
    assert.equal(buildMode('flutter build web --pwa-strategy=none'), 'default');
    assert.equal(buildMode('flutter build apk --release'), 'release');
    assert.equal(buildMode('flutter build apk --debug'), 'debug');
    assert.equal(buildMode('flutter build linux --profile'), 'profile');
    assert.equal(buildMode('flutter build windows --release --profile'), 'contradictory');
    assert.equal(buildMode('flutter build apk --debug --release'), 'contradictory');
    assert.equal(buildMode('flutter build apk --release-notes=x'), 'default');
  });

  test('flutterBuilds carries EVERY segment with its mode, a --debug beside a --release in one block included', () => {
    const root = fixture({ 'modes.yml': MODES_YML });
    const builds = flutterBuilds(root);
    assert.deepEqual(
      builds.map((b) => [b.target, b.mode, b.runLine]),
      [['web', 'default', 6], ['apk', 'release', 7], ['apk', 'debug', 7], ['linux', 'profile', 10], ['windows', 'contradictory', 11]],
    );
    assert.equal(builds[1].stamp, 'android-play');
    assert.equal(builds[2].stamp, null);
  });

  test('flutterReleaseBuilds is the RELEASE_MODES records of flutterBuilds, each without its mode', () => {
    const root = fixture({ 'modes.yml': MODES_YML });
    const full = flutterBuilds(root);
    const release = flutterReleaseBuilds(root);
    assert.deepEqual([...RELEASE_MODES].sort(), ['default', 'release']);
    assert.equal(release.length, 2);
    const withoutMode = ({ mode: _mode, ...record }) => record;
    assert.deepEqual(release[0], withoutMode(full[0]));
    assert.deepEqual(release[1], withoutMode(full[1]));
    assert.equal('mode' in release[0], false);
    assert.equal('mode' in release[1], false);
  });
});

// ⏱ 2026-09-25 — assert-channel-register §8c grades a job's secret reads by the
// environment NAME, where the other readers only ask whether the key is there.
describe('workflow-scan jobEnvironment', () => {
  const envRoot = () =>
    fixture({
      'e.yml': [
        'name: E',
        'jobs:',
        '  scalar:',
        '    runs-on: ubuntu-24.04',
        "    environment: 'store-publish'",
        '    steps:',
        '      - run: echo a',
        '  block:',
        '    runs-on: ubuntu-24.04',
        '    environment:',
        '      url: https://example.invalid',
        '      name: store-publish',
        '    steps:',
        '      - run: echo b',
        '  flow:',
        '    runs-on: ubuntu-24.04',
        '    environment: { url: https://example.invalid, name: "store-publish" }',
        '    steps:',
        '      - run: echo c',
        '  none:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - uses: some/action@v1',
        '        with:',
        '          environment: store-publish',
        '',
      ].join('\n'),
    });

  test('the scalar form, quotes removed, at the key\'s line', () => {
    const wf = parseWorkflow(envRoot(), '.github/workflows/e.yml');
    assert.deepEqual(jobEnvironment(wf.jobs.get('scalar')), { n: 5, name: 'store-publish' });
  });

  test('the block form reads the `name:` child wherever it sits among the others, at the child\'s line', () => {
    const wf = parseWorkflow(envRoot(), '.github/workflows/e.yml');
    assert.deepEqual(jobEnvironment(wf.jobs.get('block')), { n: 12, name: 'store-publish' });
  });

  test('the flow form reads `name` after another key, quotes removed', () => {
    const wf = parseWorkflow(envRoot(), '.github/workflows/e.yml');
    assert.deepEqual(jobEnvironment(wf.jobs.get('flow')), { n: 17, name: 'store-publish' });
  });

  test('a job with no `environment:` is null — a step input of that name is not the job\'s key', () => {
    const wf = parseWorkflow(envRoot(), '.github/workflows/e.yml');
    assert.equal(jobEnvironment(wf.jobs.get('none')), null);
  });
});
