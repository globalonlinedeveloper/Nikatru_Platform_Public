// ─────────────────────────────────────────────────────────────────────────────
// failfast-coverage.test.mjs — the negative cases for assert-failfast-coverage.mjs
// (FF-1: a gate run cancels itself at its first red job).
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL `.github/workflows` AND
// `.github/actions`, never a hand-built fixture: the subject is which jobs of
// which workflows carry the step, and a two-job fixture would encode whatever
// its author believed that set was, then agree with itself.
//
// 🟢 THE GREEN CONTROL RUNS FIRST. Every other case asserts a non-zero exit,
// and a guard that had stopped reading the tree would satisfy all of them.
//
// 🔬 EVERY MUTATION IS LAND-CHECKED (`edit` asserts the text changed) before
// its exit code is read: a mutation that silently failed to apply reads exactly
// like the guard catching it.
//
// The two red controls the lane was briefed to prove, both LOCAL (the owner's
// rule is no deliberately red pull request):
//   (a) remove the step from one gate job → exit 1;
//   (b) add the step to deploy-web → exit 1.
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
  EXCEPTIONS,
  SCOPE,
  ACTION_REF,
  ACTION_REL,
  CONDITION,
} from '../assert-failfast-coverage.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-failfast-coverage.mjs');
const WF = '.github/workflows';
const STEP_NAME = 'A red job cancels the rest of this run (FF-1)';

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-failfast-'));
  for (const d of [WF, '.github/actions']) {
    mkdirSync(join(root, d), { recursive: true });
    cpSync(join(REPO, d), join(root, d), { recursive: true });
  }
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }), root);
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

/** The job's FF-1 step, as its three lines' indices. */
function stepAt(jobLines) {
  const i = jobLines.findIndex((l) => l.trim() === `- name: ${STEP_NAME}`);
  assert.notEqual(i, -1, 'this job no longer carries the FF-1 step — the fixture moved under this test');
  return i;
}
const removeStep = (jobLines) => {
  const i = stepAt(jobLines);
  return [...jobLines.slice(0, i), ...jobLines.slice(i + 3)];
};
const ffStep = (indent, cond) => [`${indent}- name: ${STEP_NAME}`, `${indent}  if: ${cond}`, `${indent}  uses: ${ACTION_REF}`];

const red = (r, pattern) => {
  assert.equal(r.status, 1, `expected exit 1 (a finding), got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, pattern);
};

describe('assert-failfast-coverage: the real tree', () => {
  test('GREEN CONTROL — the committed tree passes, and the ok line counts real jobs', () => {
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      const m = r.stdout.match(/(\d+) gate job\(s\) end with the cancel step \((\d+) in the tree\)/);
      assert.ok(m, r.stdout);
      assert.ok(Number(m[1]) >= 20, `only ${m[1]} gate jobs graded — the scan lost most of ci.yml`);
      assert.equal(m[1], m[2], 'every cancel in the tree belongs to a graded gate job');
    });
  });

  test('RED CONTROL (a) — removing the step from one gate job is a finding', () => {
    withTree((root) => editJob(root, 'ci.yml', 'guards-legal', removeStep), (r) => {
      red(r, /job `guards-legal` does not end with the FF-1 step/);
    });
  });

  test('RED CONTROL (b) — adding the step to deploy-web is a finding', () => {
    withTree(
      (root) =>
        editJob(root, 'deploy-web.yml', 'deploy-web', (jl) => {
          const steps = jl.findIndex((l) => /^ {4}steps:\s*$/.test(l));
          assert.notEqual(steps, -1);
          return [...jl, ...ffStep('      ', CONDITION.every)];
        }),
      (r) => red(r, /deploy-web\.yml:\d+ job `deploy-web` is deploy-type .* carries a cancel/),
    );
  });

  test('a cancel in a workflow outside SCOPE is a finding, whatever the job is called', () => {
    withTree((root) => editJob(root, 'ops-watch.yml', 'status', (jl) => [...jl, ...ffStep('      ', CONDITION.every)]), (r) => {
      red(r, /ops-watch\.yml:\d+ job `status` carries a cancel, and .* not in FF-1's SCOPE/);
    });
  });

  test('a gate job that declares an environment becomes deploy-type, and its cancel is refused', () => {
    withTree(
      (root) => editJob(root, 'ci.yml', 'sites', (jl) => jl.flatMap((l) => (/^ {4}timeout-minutes:/.test(l) ? [l, '    environment: production'] : [l]))),
      (r) => red(r, /job `sites` is deploy-type \(it declares `environment: production`\)/),
    );
  });

  test('the step must be the LAST step', () => {
    withTree(
      (root) =>
        editJob(root, 'ci.yml', 'guards-store', (jl) => {
          const i = stepAt(jl);
          const step = jl.slice(i, i + 3);
          const rest = [...jl.slice(0, i), ...jl.slice(i + 3)];
          const lastItem = rest.map((l, k) => (/^ {6}- /.test(l) ? k : -1)).filter((k) => k >= 0).at(-1);
          return [...rest.slice(0, lastItem), ...step, ...rest.slice(lastItem)];
        }),
      (r) => red(r, /job `guards-store`: the FF-1 step is step \d+ of \d+, not the last/),
    );
  });

  test('the condition is exact: `always()` would cancel every run that ends', () => {
    withTree((root) => editJob(root, 'ci.yml', 'site-shared', (jl) => jl.map((l) => (l === '        if: failure()' ? '        if: always()' : l))), (r) => {
      red(r, /job `site-shared`: the FF-1 step's `if:` is `always\(\)`/);
    });
  });

  test('in a publishing workflow a bare failure() is refused: only pull_request runs may cancel', () => {
    withTree(
      (root) => editJob(root, 'extensions.yml', 'e2e-suite', (jl) => jl.map((l) => (l === `        if: ${CONDITION.pull_request}` ? '        if: failure()' : l))),
      (r) => red(r, /extensions\.yml:\d+ job `e2e-suite`: the FF-1 step's `if:` is `failure\(\)`; in .* it must be exactly/),
    );
  });

  test('a carrying job that does not grant actions: write is a finding', () => {
    withTree((root) => editJob(root, 'ci.yml', 'guards-legal', (jl) => jl.map((l) => (l === '      actions: write' ? '      actions: read' : l))), (r) => {
      red(r, /job `guards-legal` carries the FF-1 step and grants `actions: read`/);
    });
  });

  test('a job-level block that drops contents: read is a finding (it replaces the workflow block)', () => {
    withTree((root) => editJob(root, 'lane-workers.yml', 'detect', (jl) => jl.filter((l) => l !== '      contents: read')), (r) => {
      red(r, /job `detect`: its job-level block drops `contents: read`/);
    });
  });

  test('C3 — a call job whose callee carries the step must grant actions: write', () => {
    withTree((root) => editJob(root, 'ci.yml', 'extensions', (jl) => jl.map((l) => (l === '      actions: write' ? '      actions: read' : l))), (r) => {
      red(r, /job `extensions` calls \.github\/workflows\/extensions-ci\.yml, whose jobs carry the FF-1 step, and grants `actions: read`/);
    });
  });

  test('C7 — actions: write at the workflow level of an in-scope file is a finding', () => {
    withTree((root) => edit(root, `${WF}/ci.yml`, (t) => t.replace(/^permissions:\n {2}contents: read\n/m, 'permissions:\n  contents: read\n  actions: write\n')), (r) => {
      red(r, /ci\.yml:\d+ grants `actions: write` at the WORKFLOW level/);
    });
  });

  test('C7 — an exception that grants actions: write is a finding', () => {
    withTree(
      (root) => editJob(root, 'ci.yml', 'ci-gate', (jl) => jl.flatMap((l) => (/^ {4}timeout-minutes:/.test(l) ? [l, '    permissions:', '      contents: read', '      actions: write'] : [l]))),
      (r) => red(r, /job `ci-gate` is a declared exception \(aggregator\) and grants `actions: write`/),
    );
  });

  test('C5 — the sole-job exception stops holding the moment codeql.yml gains a job', () => {
    withTree(
      (root) =>
        edit(root, `${WF}/codeql.yml`, (t) =>
          `${t.replace(/\n*$/, '\n')}\n  second:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: echo second\n`),
      (r) => {
        red(r, /EXCEPTION \.github\/workflows\/codeql\.yml#analyze \(sole-job\) no longer holds: .* now has 2 jobs/);
        assert.match(r.stderr, /job `second` does not end with the FF-1 step/);
      },
    );
  });

  test('C5 — an aggregator that stops running always() is no longer excused', () => {
    withTree((root) => editJob(root, 'ci.yml', 'ci-gate', (jl) => jl.map((l) => (l === '    if: always()' ? "    if: success()" : l))), (r) => {
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

  test('C1 form — a job with a checkout cancels through the composite, not inline', () => {
    withTree(
      (root) =>
        editJob(root, 'lane-workers.yml', 'detect', (jl) => {
          const i = stepAt(jl);
          return [
            ...jl.slice(0, i),
            `      - name: ${STEP_NAME}`,
            '        if: failure()',
            '        env:',
            '          GH_TOKEN: ${{ github.token }}',
            '        run: gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true',
            ...jl.slice(i + 3),
          ];
        }),
      (r) => red(r, /job `detect` has a checkout and cancels inline/),
    );
  });

  test('C1 form — a job with NO checkout must cancel inline, and the inline form is then green', () => {
    const dropCheckout = (jl) => {
      const i = jl.findIndex((l) => /^ {6}- uses: actions\/checkout@/.test(l));
      assert.notEqual(i, -1);
      let j = i + 1;
      while (j < jl.length && /^ {8}/.test(jl[j])) j++;
      return [...jl.slice(0, i), ...jl.slice(j)];
    };
    withTree((root) => editJob(root, 'lane-workers.yml', 'detect', dropCheckout), (r) => {
      red(r, /job `detect` has no checkout, so `\.\/\.github\/actions\/cancel-run-on-red` is not on disk/);
    });
    withTree(
      (root) =>
        editJob(root, 'lane-workers.yml', 'detect', (jl) => {
          const out = dropCheckout(jl);
          const i = stepAt(out);
          return [
            ...out.slice(0, i),
            `      - name: ${STEP_NAME}`,
            '        if: failure()',
            '        env:',
            '          GH_TOKEN: ${{ github.token }}',
            '        run: gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true',
            ...out.slice(i + 3),
          ];
        }),
      (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`),
    );
  });

  test('C6 — a composite that no longer cancels is a finding', () => {
    withTree((root) => edit(root, ACTION_REL, (t) => t.replace(/gh run cancel "\$GITHUB_RUN_ID" --repo "\$GITHUB_REPOSITORY" \|\| true/, 'true')), (r) => {
      red(r, /cancel-run-on-red\/action\.yml: no longer runs `gh run cancel/);
    });
  });

  test('C6 — a composite whose cancel can fail the job is a finding', () => {
    withTree((root) => edit(root, ACTION_REL, (t) => t.replace(/ \|\| true/, '')), (r) => {
      red(r, /no longer runs `gh run cancel .* \|\| true`/);
    });
  });

  test('COVERAGE LOST — the composite is gone', () => {
    withTree((root) => unlinkSync(join(root, ACTION_REL)), (r) => {
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST — .*cancel-run-on-red\/action\.yml is not in the tree/);
    });
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

  test('cancelKind and rawCancelLine agree on the shapes, and neither reads prose', () => {
    const step = (o) => ({ uses: null, run: null, ...o });
    assert.equal(cancelKind(step({ uses: ACTION_REF })), 'action');
    assert.equal(cancelKind(step({ uses: 'styfle/cancel-workflow-action@abc' })), 'foreign');
    assert.equal(cancelKind(step({ run: { text: 'gh run cancel "$GITHUB_RUN_ID" || true' } })), 'inline');
    assert.equal(cancelKind(step({ run: { text: 'curl -X POST "$API/repos/o/r/actions/runs/$ID/cancel"' } })), 'inline');
    assert.equal(cancelKind(step({ run: { text: 'echo "gh run cancelled nothing"' } })), null);
    assert.equal(cancelKind(step({ uses: './.github/actions/setup-node' })), null);
    assert.equal(rawCancelLine(`      - uses: ${ACTION_REF}`), true);
    assert.equal(rawCancelLine(`        uses: '${ACTION_REF}'`), true);
    assert.equal(rawCancelLine('          gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true'), true);
    assert.equal(rawCancelLine('          echo "gh run cancelled nothing"'), false);
    assert.equal(rawCancelLine('    uses: ./.github/workflows/cancel-things.yml'), false);
  });

  test('SCOPE and EXCEPTIONS name only workflows that exist, each with a why', () => {
    for (const s of SCOPE) {
      assert.ok(readFileSync(join(REPO, s.rel), 'utf8').length > 0, s.rel);
      assert.ok(s.why.trim(), `${s.rel} carries no why`);
      assert.ok(s.runs in CONDITION, `${s.rel} runs=${s.runs}`);
    }
    for (const e of EXCEPTIONS) assert.ok(SCOPE.some((s) => s.rel === e.rel) && e.why.trim(), `${e.rel}#${e.job}`);
  });
});
