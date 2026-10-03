// ─────────────────────────────────────────────────────────────────────────────
// failfast-coverage.test.mjs — the negative cases for assert-failfast-coverage.mjs
// (FF-2: a gate run cancels itself at its first red job, and that job keeps its
// own `failure`; only the others read cancelled).
//
// 🔴 EVERY TREE CASE MUTATES A COPY OF THE REAL `.github/workflows`, never a
// hand-built fixture: the subject is which jobs of which workflows have a
// follow-up, and a two-job fixture would encode whatever its author believed
// that set was, then agree with itself. The one small fixture below exercises
// simulateRedRun's three shapes by themselves; the same function is then run
// on the real tree.
//
// 🟢 THE GREEN CONTROL RUNS FIRST. Every other case asserts a non-zero exit,
// and a guard that had stopped reading the tree would satisfy all of them.
//
// 🔬 EVERY MUTATION IS LAND-CHECKED (`edit` asserts the text changed) before
// its exit code is read: a mutation that silently failed to apply reads exactly
// like the guard catching it.
//
// The red controls the lane was briefed to prove, all LOCAL:
//   (a) put FF-1's in-job cancel back into one gate job → exit 1, and the
//       simulated run reports that job `cancelled`, not `failure`;
//   (b) remove one gate job's follow-up → exit 1;
//   (c) add a cancel to deploy-web → exit 1.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gradeFailfast,
  readPermissions,
  levelOf,
  cancelKind,
  rawCancelLine,
  matrixFailFast,
  simulateRedRun,
  EXCEPTIONS,
  SCOPE,
  CONDITION,
  MATRIX_FAIL_FAST,
} from '../assert-failfast-coverage.mjs';
import { parseWorkflow, failFastLane } from '../workflow-scan.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-failfast-coverage.mjs');
const GREEN_MEANS_RAN = join(REPO, 'tooling', 'ci', 'assert-green-means-ran.mjs');
const WF = '.github/workflows';
const CANCEL = 'gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true';

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-failfast-'));
  mkdirSync(join(root, WF), { recursive: true });
  cpSync(join(REPO, WF), join(root, WF), { recursive: true });
  return root;
}

function withTree(mutate, fn, guard = GUARD) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [guard, root], { cwd: REPO, encoding: 'utf8' }), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Rewrite one file with `change(text)` and assert the text actually moved. */
function edit(root, rel, change) {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  assert.notEqual(after, before, `the mutation of ${rel} did not apply — the fixture moved under this test`);
  writeFileSync(path, after);
}

/** The [start, end) line range of job `job` in a workflow's text. */
function jobRange(lines, job) {
  const start = lines.findIndex((l) => l === `  ${job}:`);
  assert.notEqual(start, -1, `no job \`${job}\` — the workflow was renamed under this test`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}\S/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return [start, end];
}

/** Apply `fn(jobLines) -> jobLines` to one job of one workflow. */
function editJob(root, file, job, fn) {
  edit(root, `${WF}/${file}`, (text) => {
    const lines = text.split('\n');
    const [s, e] = jobRange(lines, job);
    return [...lines.slice(0, s), ...fn(lines.slice(s, e)), ...lines.slice(e)].join('\n');
  });
}

/** Replace one exact line of one job, asserting it was there. */
const swapLine = (from, to) => (jl) => {
  assert.ok(jl.includes(from), `no line \`${from}\` in this job — the fixture moved under this test`);
  return jl.flatMap((l) => (l === from ? (to === null ? [] : [to].flat()) : [l]));
};

/** FF-1's shape: the cancel as the red job's own last step. */
const inJobCancel = ['      - name: A red job cancels the rest of this run (FF-1)', '        if: failure()', '        env:', '          GH_TOKEN: ${{ github.token }}', `        run: ${CANCEL}`];

const red = (r, pattern) => {
  assert.equal(r.status, 1, `expected exit 1 (a finding), got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
};

describe('assert-failfast-coverage: the real tree', () => {
  test('GREEN CONTROL — the committed tree passes, and the ok line counts real jobs', () => {
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      const m = r.stdout.match(/(\d+) gate job\(s\), each with one follow-up \((\d+); (\d+) cancel\(s\) in the tree, none inside a red job\); (\d+) red run\(s\) simulated/);
      assert.ok(m, r.stdout);
      assert.ok(Number(m[1]) >= 30, `only ${m[1]} gate jobs graded — the scan lost most of ci.yml`);
      assert.equal(m[1], m[2], 'every graded gate job has a follow-up');
      assert.equal(m[2], m[3], 'every cancel in the tree belongs to a follow-up');
      assert.equal(m[1], m[4], 'every graded gate job had its red run simulated');
    });
  });

  test('THE RED RUN, SIMULATED ON THE REAL TREE — the red job reads failure, the rest cancelled, ci-gate red', () => {
    const wf = parseWorkflow(REPO, `${WF}/ci.yml`);
    for (const lane of ['web-artifacts', 'guards-chassis', 'sites', 'guards-legal', 'guard-meta', 'app-brick']) {
      // The six red jobs of the six runs measured 2026-09-28, every one reported cancelled under FF-1.
      const sim = simulateRedRun(wf, lane);
      assert.equal(sim.conclusion, 'failure', lane);
      assert.equal(sim.canceller, `ff-${lane}`, lane);
      assert.equal(sim.others.get('ci-gate'), 'failure', 'the aggregator still runs and reads the red');
      assert.equal(sim.others.get('guards-platform'), 'cancelled');
      assert.equal(sim.others.get(`ff-${lane === 'sites' ? 'guards-store' : 'sites'}`), 'skipped', "another lane's follow-up is skipped");
    }
  });

  test('RED CONTROL (a) — FF-1\'s in-job cancel put back into one gate job: the run reads it cancelled', () => {
    withTree(
      (root) => editJob(root, 'ci.yml', 'guards-legal', (jl) => {
        const end = jl.length - (jl.at(-1) === '' ? 1 : 0);
        return [...jl.slice(0, end), ...inJobCancel, ...jl.slice(end)];
      }),
      (r) => {
        red(r, /job `guards-legal` cancels the run from INSIDE itself — the FF-1 shape/);
        assert.match(r.stderr, /job `guards-legal`: a run in which it goes red reports it `cancelled`, not `failure`/);
      },
    );
  });

  test('RED CONTROL (b) — removing one gate job\'s follow-up is a finding', () => {
    withTree((root) => editJob(root, 'ci.yml', 'ff-guards-legal', () => []), (r) => {
      red(r, /job `guards-legal` has no FF-2 follow-up/);
    });
  });

  test('RED CONTROL (c) — adding a cancel to deploy-web is a finding', () => {
    withTree(
      (root) => editJob(root, 'deploy-web.yml', 'deploy-web', (jl) => [...jl, ...inJobCancel]),
      (r) => red(r, /deploy-web\.yml:\d+ job `deploy-web` is deploy-type .* carries a cancel/),
    );
  });

  test('a cancel in a workflow outside SCOPE is a finding, whatever the job is called', () => {
    withTree((root) => editJob(root, 'ops-watch.yml', 'status', (jl) => [...jl, ...inJobCancel]), (r) => {
      red(r, /ops-watch\.yml:\d+ job `status` carries a cancel, and .* not in FF-2's SCOPE/);
    });
  });

  test('a gate job that declares an environment becomes deploy-type, and its follow-up is refused', () => {
    withTree(
      (root) => editJob(root, 'ci.yml', 'sites', swapLine('    timeout-minutes: 20', ['    timeout-minutes: 20', '    environment: production'])),
      (r) => red(r, /job `ff-sites` follows `sites`, which FF-2 does not grade/),
    );
  });

  test('the follow-up\'s `if:` is exact: a bare failure() would fire again under every red ancestor', () => {
    withTree(
      (root) => editJob(root, 'ci.yml', 'ff-web-artifacts', swapLine("    if: failure() && needs.web-artifacts.result == 'failure'", "    if: failure() && needs.web-artifacts.result == 'failure' || always()")),
      (r) => red(r, /job `ff-web-artifacts`: its `if:` is .*; in \.github\/workflows\/ci\.yml it must be exactly/),
    );
    withTree((root) => editJob(root, 'ci.yml', 'ff-web-artifacts', swapLine("    if: failure() && needs.web-artifacts.result == 'failure'", '    if: failure()')), (r) => {
      red(r, /job `ff-web-artifacts` is named as an FF-2 follow-up and is not one/);
      assert.match(r.stderr, /job `web-artifacts` has no FF-2 follow-up/);
    });
  });

  test('in a publishing workflow the follow-up fires on pull_request runs only', () => {
    withTree(
      (root) => editJob(root, 'extensions.yml', 'ff-e2e-suite', swapLine(`    if: ${CONDITION.pull_request('e2e-suite')}`, `    if: ${CONDITION.every('e2e-suite')}`)),
      (r) => red(r, /extensions\.yml:\d+ job `ff-e2e-suite`: its `if:` is .*; in .* it must be exactly/),
    );
  });

  test('a follow-up that does anything but cancel is not one — and green-means-ran then grades it as a lane', () => {
    const mutate = (root) =>
      editJob(root, 'ci.yml', 'ff-guards-store', swapLine(`          ${CANCEL}`, ['          node tooling/ci/some-real-check.mjs', `          ${CANCEL}`]));
    withTree(mutate, (r) => red(r, /job `ff-guards-store` is named as an FF-2 follow-up and is not one/));
    withTree(mutate, (r) => red(r, /job "ci-gate" does not `need` "ff-guards-store"/), GREEN_MEANS_RAN);
  });

  test('green-means-ran exempts the follow-ups on the committed tree (the green control of the line above)', () => {
    withTree(() => {}, (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`), GREEN_MEANS_RAN);
  });

  test('a follow-up whose cancel can fail the job is not one', () => {
    withTree((root) => editJob(root, 'ci.yml', 'ff-prepare', swapLine(`          ${CANCEL}`, '          gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY"')), (r) => {
      red(r, /job `ff-prepare` is named as an FF-2 follow-up and is not one/);
    });
  });

  test('the follow-up\'s step: GH_TOKEN, RED_JOB and the notice', () => {
    withTree((root) => editJob(root, 'ci.yml', 'ff-sites', swapLine('          GH_TOKEN: ${{ github.token }}', null)), (r) => {
      red(r, /job `ff-sites`: the step must map `GH_TOKEN: \$\{\{ github\.token \}\}`/);
    });
    withTree((root) => editJob(root, 'ci.yml', 'ff-sites', swapLine('          RED_JOB: sites', '          RED_JOB: guards-store')), (r) => {
      red(r, /job `ff-sites`: the step must map `RED_JOB: sites`/);
    });
    withTree(
      (root) => editJob(root, 'ci.yml', 'ff-sites', (jl) => jl.filter((l) => !/^ {10}echo "::notice/.test(l))),
      (r) => red(r, /job `ff-sites`: the step no longer prints the ::notice naming \$RED_JOB/),
    );
  });

  test('a follow-up in a workflow whose default run directory is not `.` must override it (no checkout)', () => {
    withTree((root) => editJob(root, 'extensions-ci.yml', 'ff-build-free', swapLine('        working-directory: .', null)), (r) => {
      red(r, /job `ff-build-free`: its step runs in `extensions`, which a job with no checkout does not have/);
    });
  });

  test('C2 — a follow-up grants exactly actions: write', () => {
    withTree((root) => editJob(root, 'ci.yml', 'ff-guard-meta', swapLine('      actions: write', '      actions: read')), (r) => {
      red(r, /job `ff-guard-meta` grants `actions: read`; a follow-up grants exactly `actions: write`/);
    });
    withTree((root) => editJob(root, 'ci.yml', 'ff-guard-meta', swapLine('      actions: write', ['      contents: read', '      actions: write'])), (r) => {
      red(r, /job `ff-guard-meta` grants `contents: read, actions: write`/);
    });
  });

  test('C7 — a lane that grants actions: write is a finding (it cancels nothing now)', () => {
    withTree((root) => editJob(root, 'lane-workers.yml', 'detect', swapLine('      contents: read', ['      contents: read', '      actions: write'])), (r) => {
      red(r, /job `detect` grants `actions: write`\. Under FF-2 no lane cancels anything/);
    });
  });

  test('C3 — a call job whose callee holds follow-ups must grant actions: write', () => {
    withTree((root) => editJob(root, 'ci.yml', 'extensions', swapLine('      actions: write', '      actions: read')), (r) => {
      red(r, /job `extensions` calls \.github\/workflows\/extensions-ci\.yml, whose jobs have FF-2 follow-ups, and grants `actions: read`/);
    });
  });

  test('C7 — actions: write at the workflow level of an in-scope file is a finding', () => {
    withTree((root) => edit(root, `${WF}/ci.yml`, (t) => t.replace(/^permissions:\n {2}contents: read\n/m, 'permissions:\n  contents: read\n  actions: write\n')), (r) => {
      red(r, /ci\.yml:\d+ grants `actions: write` at the WORKFLOW level/);
    });
  });

  test('C8 — a matrix lane with fail-fast off is a finding (its follow-up would wait for every leg)', () => {
    withTree((root) => editJob(root, 'ci.yml', 'android-artifacts', swapLine('      fail-fast: true', '      fail-fast: false')), (r) => {
      red(r, /job `android-artifacts` is a matrix with `fail-fast: false`; in .* it must be `true`/);
    });
    withTree(
      (root) => editJob(root, 'extensions.yml', 'e2e-suite', swapLine(`      fail-fast: ${MATRIX_FAIL_FAST.pull_request}`, '      fail-fast: true')),
      (r) => red(r, /job `e2e-suite` is a matrix with `fail-fast: true`; in .*extensions\.yml it must be/),
    );
  });

  test('C5 — the sole-job exception stops holding the moment codeql.yml gains a job', () => {
    withTree(
      (root) =>
        edit(root, `${WF}/codeql.yml`, (t) =>
          `${t.replace(/\n*$/, '\n')}\n  second:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: echo second\n`),
      (r) => {
        red(r, /EXCEPTION \.github\/workflows\/codeql\.yml#analyze \(sole-job\) no longer holds: .* now has 2 jobs/);
        assert.match(r.stderr, /job `second` has no FF-2 follow-up/);
      },
    );
  });

  test('C5 — an aggregator that stops running always() is no longer excused', () => {
    // ⏱ 2026-10-03 — ci-gate's line carries the draft conjunct (assert-green-means-ran A10); the mutant keeps it and drops always().
    withTree((root) => editJob(root, 'ci.yml', 'ci-gate', swapLine('    if: always() && github.event.pull_request.draft != true', '    if: success() && github.event.pull_request.draft != true')), (r) => {
      red(r, /EXCEPTION \.github\/workflows\/ci\.yml#ci-gate \(aggregator\) no longer holds/);
    });
  });

  test('C5 — a stale exception (a job that no longer exists) is a finding', () => {
    const root = realTree();
    try {
      const { findings, lost } = gradeFailfast(root, { exceptions: [...EXCEPTIONS, { rel: '.github/workflows/ci.yml', job: 'no-such-job', kind: 'aggregator', why: 'x' }] });
      assert.deepEqual(lost, []);
      assert.ok(findings.some((f) => /EXCEPTION \.github\/workflows\/ci\.yml#no-such-job names a job that no longer exists/.test(f)), findings.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST — a SCOPE workflow is gone', () => {
    withTree((root) => unlinkSync(join(root, WF, 'codeql.yml')), (r) => {
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST — \.github\/workflows\/codeql\.yml is in SCOPE and not in the tree/);
    });
  });

  test('COVERAGE LOST — a cancel the step reader cannot see disagrees with the line count', () => {
    withTree(
      (root) => editJob(root, 'deploy-web.yml', 'deploy-web', (jl) => jl.flatMap((l) => (/^ {4}timeout-minutes:/.test(l) ? [l, '    env:', '      STOP: gh run cancel 1'] : [l]))),
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /the step reader found \d+ cancel step\(s\) and a line count found \d+/);
      },
    );
  });
});

describe('assert-failfast-coverage: the readers', () => {
  const asLines = (text) => text.split('\n').map((t, i) => ({ n: i + 1, text: t }));

  test('simulateRedRun — FF-1 reports the red job cancelled, FF-2 reports it failed, no cancel runs on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-ffsim-'));
    try {
      mkdirSync(join(dir, WF), { recursive: true });
      const step = (s) => `      - run: ${s}`;
      const follow = (lane) => [
        `  ff-${lane}:`,
        `    needs: ${lane}`,
        `    if: failure() && needs.${lane}.result == 'failure'`,
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - env:',
        '          GH_TOKEN: ${{ github.token }}',
        `          RED_JOB: ${lane}`,
        '        run: |',
        `          echo "::notice title=FF-2::job '\${RED_JOB}' is red"`,
        `          ${CANCEL}`,
      ];
      const lane = (id, extra = []) => [`  ${id}:`, '    runs-on: ubuntu-24.04', '    steps:', step('npm test'), ...extra];
      const gate = ['  gate:', '    needs: [a, b]', '    if: always()', '    runs-on: ubuntu-24.04', '    steps:', step('exit 1')];
      const write = (name, jobs) => {
        writeFileSync(join(dir, WF, name), ['on: pull_request', 'jobs:', ...jobs.flat(), ''].join('\n'));
        return parseWorkflow(dir, `${WF}/${name}`);
      };

      const ff1 = write('ff1.yml', [lane('a', inJobCancel), lane('b', inJobCancel), gate]);
      const s1 = simulateRedRun(ff1, 'a');
      assert.equal(s1.conclusion, 'cancelled', 'FF-1: the red job is still running when its own cancel lands');
      assert.equal(s1.canceller, 'a');

      const ff2 = write('ff2.yml', [lane('a'), follow('a'), lane('b'), follow('b'), gate]);
      assert.equal(failFastLane(ff2, 'ff-a'), 'a');
      const s2 = simulateRedRun(ff2, 'a');
      assert.deepEqual(
        { conclusion: s2.conclusion, canceller: s2.canceller, others: Object.fromEntries(s2.others) },
        { conclusion: 'failure', canceller: 'ff-a', others: { 'ff-a': 'success', b: 'cancelled', 'ff-b': 'skipped', gate: 'failure' } },
      );

      const none = write('none.yml', [lane('a'), lane('b'), gate]);
      const s3 = simulateRedRun(none, 'a');
      assert.equal(s3.conclusion, 'failure');
      assert.equal(s3.canceller, null, 'no cancel anywhere: the rest runs to the end');
      assert.equal(s3.others.get('b'), 'unaffected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('readPermissions reads block, flow, write-all and absence', () => {
    const block = readPermissions(asLines('    permissions:\n      contents: read\n      actions: write\n    steps:'), 4);
    assert.equal(levelOf(block, 'actions'), 'write');
    assert.equal(levelOf(block, 'contents'), 'read');
    assert.equal(levelOf(block, 'issues'), 'none');
    const flow = readPermissions(asLines('    permissions: { contents: read, actions: write }'), 4);
    assert.equal(levelOf(flow, 'actions'), 'write');
    assert.equal(levelOf(readPermissions(asLines('    permissions: write-all'), 4), 'actions'), 'write');
    assert.equal(levelOf(readPermissions(asLines('    permissions: {}'), 4), 'actions'), 'none');
    assert.equal(readPermissions(asLines('    runs-on: x\n    steps:'), 4), null);
    // A STEP's key is not the job's: six spaces is not four.
    assert.equal(readPermissions(asLines('    steps:\n      permissions:\n        actions: write'), 4), null);
  });

  test('matrixFailFast reads the value, the default and absence', () => {
    const job = (text) => ({ lines: asLines(text) });
    assert.equal(matrixFailFast(job('    strategy:\n      fail-fast: false\n      matrix:\n        a: [1]')), 'false');
    assert.equal(matrixFailFast(job('    strategy:\n      matrix:\n        a: [1]\n    steps:')), null);
    assert.equal(matrixFailFast(job('    runs-on: x\n    steps:')), undefined);
  });

  test('cancelKind and rawCancelLine agree on the shapes, and neither reads prose', () => {
    const step = (o) => ({ uses: null, run: null, ...o });
    // FF-1's composite is retired: a step that names it is a foreign cancel, refused like any other.
    assert.equal(cancelKind(step({ uses: './.github/actions/cancel-run-on-red' })), 'foreign');
    assert.equal(cancelKind(step({ uses: 'styfle/cancel-workflow-action@abc' })), 'foreign');
    assert.equal(cancelKind(step({ run: { text: 'gh run cancel "$GITHUB_RUN_ID" || true' } })), 'inline');
    assert.equal(cancelKind(step({ run: { text: 'curl -X POST "$API/repos/o/r/actions/runs/$ID/cancel"' } })), 'inline');
    assert.equal(cancelKind(step({ run: { text: 'echo "gh run cancelled nothing"' } })), null);
    assert.equal(cancelKind(step({ uses: './.github/actions/setup-node' })), null);
    assert.equal(rawCancelLine('      - uses: ./.github/actions/cancel-run-on-red'), true);
    assert.equal(rawCancelLine("        uses: './.github/actions/cancel-run-on-red'"), true);
    assert.equal(rawCancelLine(`          ${CANCEL}`), true);
    assert.equal(rawCancelLine('          echo "gh run cancelled nothing"'), false);
    assert.equal(rawCancelLine('    uses: ./.github/workflows/cancel-things.yml'), false);
  });

  test('SCOPE and EXCEPTIONS name only workflows that exist, each with a why', () => {
    for (const s of SCOPE) {
      assert.ok(readFileSync(join(REPO, s.rel), 'utf8').length > 0, s.rel);
      assert.ok(s.why.trim(), `${s.rel} carries no why`);
      assert.ok(s.runs in CONDITION && s.runs in MATRIX_FAIL_FAST, `${s.rel} runs=${s.runs}`);
    }
    for (const e of EXCEPTIONS) assert.ok(SCOPE.some((s) => s.rel === e.rel) && e.why.trim(), `${e.rel}#${e.job}`);
  });
});
