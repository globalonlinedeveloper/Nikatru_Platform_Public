// ─────────────────────────────────────────────────────────────────────────────
// workflow-timeouts.test.mjs — the negative cases for
// assert-workflow-timeouts.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL `.github/workflows`, never a
// hand-built fixture. The guard's whole subject is a graph — which jobs are in
// the `needs` closure of ci.yml `ci-gate`, followed through its call job into
// extensions-ci.yml (⏱ 2026-09-24; extensions.yml `ci-required` until then) — and
// a hand-built two-job workflow would encode whatever the author believed that
// graph looked like and then agree with itself. The real tree is the only
// fixture that can disagree.
//
// 🟢 THE GREEN CONTROL RUNS FIRST, and it is not a formality: every case below
// asserts a NON-zero exit, and a guard that had stopped reading the tree
// entirely would satisfy all of them. The control is what separates "the
// mutation was caught" from "nothing was ever green".
//
// 🔬 EVERY MUTATION IS LAND-CHECKED BEFORE ITS EXIT CODE IS READ (`agents-05`,
// `flutter-10`): `mutateJobTimeout` re-reads the file it wrote and asserts the
// text actually changed, because a mutation that silently failed to apply
// reports a passing guard and reads exactly like the guard working.
//
// ⚠️ THE DUPLICATE-KEY CASE IS THE ONE THIS SUITE EXISTS FOR. A duplicate
// mapping key is merged in silence by every loader that reads a workflow
// locally — PyYAML, @action-validator/cli and zizmor all called the offending
// file clean on 2026-09-05 — and REFUSED by GitHub, which runs zero jobs and
// reports no reason (`traps.json` ci-33). So `sees two keys where a YAML load
// would see one` asserts BOTH halves in one case: that a structural load of the
// mutated file collapses the pair to a single value, and that the guard's
// line-level limb still counts two.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeoutLines, timeoutValue, isBoundedValue, needsClosure, gatingThroughCalls, GATE_ANCHORS, GATING_CAP, DEFAULT_CAP } from '../assert-workflow-timeouts.mjs';
import { parseAllWorkflows } from '../workflow-scan.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-workflow-timeouts.mjs');
const WF = '.github/workflows';

/** A job inside the `ci-gate` closure — capped at 30. */
const GATING = { file: 'ci.yml', job: 'guards-platform' };
/** A job outside every closure — capped at 60. It is also the one job whose
 *  value this change moved (75 → 60), so a case here is a case on the seam. */
const NON_GATING = { file: 'extensions.yml', job: 'e2e-suite' };

/** A copy of the real workflow directory, and nothing else. The guard reads
 *  `<root>/.github/workflows` and no other part of a checkout. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-wf-timeouts-'));
  mkdirSync(join(root, WF), { recursive: true });
  cpSync(join(REPO, WF), join(root, WF), { recursive: true });
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const read = (root, file) => readFileSync(join(root, WF, file), 'utf8');
const write = (root, file, text) => writeFileSync(join(root, WF, file), text);

/** The index of the line holding `job`'s own `timeout-minutes:`, found by
 *  walking from the job key to the next job key — never by a global search,
 *  which would hit whichever job happens to come first in the file. */
function timeoutLineIndex(lines, job) {
  const start = lines.findIndex((l) => l === `  ${job}:`);
  assert.notEqual(start, -1, `the fixture has no job \`${job}\` — the workflow was renamed under this test`);
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break;
    if (/^ {4}timeout-minutes:/.test(lines[i])) return i;
  }
  assert.fail(`job \`${job}\` carries no job-level timeout-minutes in the fixture`);
}

/**
 * Rewrite one job's `timeout-minutes:` and PROVE the rewrite landed.
 * `replacement` is an array of lines: `[]` deletes the key, one line replaces
 * it, two lines duplicate it.
 */
function mutateJobTimeout(root, { file, job }, replacement) {
  const before = read(root, file);
  const lines = before.split('\n');
  const at = timeoutLineIndex(lines, job);
  const was = lines[at];
  lines.splice(at, 1, ...replacement);
  const after = lines.join('\n');
  write(root, file, after);
  // Land-check: the exit code below is worthless if the edit did not apply.
  assert.notEqual(after, before, `the mutation of ${file}#${job} changed nothing`);
  const reread = read(root, file).split('\n');
  assert.deepEqual(reread.slice(at, at + replacement.length), replacement, `the mutation of ${file}#${job} did not land as written (was: ${was})`);
  return was;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-workflow-timeouts — the control', () => {
  test('the unmodified tree is green, and says what it graded', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, `expected 0 on the real tree, got ${r.status}\n${r.stdout}${r.stderr}`);
        assert.match(r.stdout, /workflow\(s\), \d+ job\(s\), 0 unbounded, 0 over cap/);
      },
    );
  });

  test('the real repository itself is green', () => {
    const r = spawnSync(process.execPath, [GUARD, REPO], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});

describe('assert-workflow-timeouts — an unbounded job', () => {
  test('a job with no timeout-minutes is a finding', () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, []),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, new RegExp(`job \`${GATING.job}\` declares no job-level`));
        assert.match(r.stderr, /360-minute default/);
      },
    );
  });

  test('a STEP-level timeout-minutes does not bound the job', () => {
    withTree(
      (root) => {
        // Replace the job key with a step-level one at six spaces: present in
        // the file, invisible to GitHub's job budget, and exactly what a
        // widened `\s*` anchor would wrongly accept.
        mutateJobTimeout(root, GATING, ['      timeout-minutes: 25']);
      },
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, new RegExp(`job \`${GATING.job}\` declares no job-level`));
      },
    );
  });
});

describe('assert-workflow-timeouts — a duplicate key', () => {
  test('two timeout-minutes in one job is a finding, with both line numbers', () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, ['    timeout-minutes: 25', '    timeout-minutes: 25']),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, new RegExp(`job \`${GATING.job}\` declares \`timeout-minutes:\` 2 times`));
        assert.match(r.stderr, /lines \d+, \d+/);
        assert.match(r.stderr, /ci-33/);
      },
    );
  });

  test('the limb sees two keys where a structural load sees one value', () => {
    // 🔴 THE POINT OF THE WHOLE FILE, ASSERTED RATHER THAN ASSUMED. The shared
    // reader is line-level, but nothing stops a later "simplification" from
    // asking a parsed object for `timeout-minutes` — which can only ever answer
    // once. This case fails the moment that happens.
    const root = realTree();
    try {
      mutateJobTimeout(root, GATING, ['    timeout-minutes: 25', '    timeout-minutes: 99']);
      const wfs = parseAllWorkflows(root);
      const job = wfs.find((w) => w.rel === `${WF}/${GATING.file}`).jobs.get(GATING.job);
      const hits = timeoutLines(job.lines);
      assert.equal(hits.length, 2, 'the line-level limb must see BOTH keys');
      // A last-key-wins collapse — what every lenient loader in this tree's
      // history did — reduces those two lines to exactly one value.
      const collapsed = new Map(hits.map((h) => ['timeout-minutes', timeoutValue(h)]));
      assert.equal(collapsed.size, 1);
      assert.equal(collapsed.get('timeout-minutes'), '99');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('assert-workflow-timeouts — a value that bounds nothing', () => {
  test('timeout-minutes: 0 is a finding', () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, ['    timeout-minutes: 0']),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /timeout-minutes: 0`, which is not a positive integer/);
      },
    );
  });

  test('timeout-minutes: abc is a finding', () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, ['    timeout-minutes: abc']),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /timeout-minutes: abc`, which is not a positive integer/);
      },
    );
  });

  test('the value predicate refuses what parseInt would accept', () => {
    assert.equal(isBoundedValue('30'), true);
    assert.equal(isBoundedValue('1'), true);
    assert.equal(isBoundedValue('0'), false);
    assert.equal(isBoundedValue('abc'), false);
    assert.equal(isBoundedValue('1.5'), false);
    assert.equal(isBoundedValue('30min'), false);
    assert.equal(isBoundedValue('${{ inputs.t }}'), false);
    assert.equal(isBoundedValue(''), false);
  });
});

describe('assert-workflow-timeouts — the two caps', () => {
  test(`${GATING_CAP + 1} on a job in the ci-gate closure is a finding`, () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, [`    timeout-minutes: ${GATING_CAP + 1}`]),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, new RegExp(`job \`${GATING.job}\` sets \`timeout-minutes: ${GATING_CAP + 1}\`, over its cap of ${GATING_CAP}`));
        assert.match(r.stderr, /holds every merge behind it/);
      },
    );
  });

  test(`${GATING_CAP} on that same job is fine — the cap is a ceiling, not a target`, () => {
    withTree(
      (root) => mutateJobTimeout(root, GATING, [`    timeout-minutes: ${GATING_CAP}`]),
      (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`),
    );
  });

  test(`${DEFAULT_CAP + 1} on a job outside every closure is a finding`, () => {
    withTree(
      (root) => mutateJobTimeout(root, NON_GATING, [`    timeout-minutes: ${DEFAULT_CAP + 1}`]),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, new RegExp(`job \`${NON_GATING.job}\` sets \`timeout-minutes: ${DEFAULT_CAP + 1}\`, over its cap of ${DEFAULT_CAP}`));
        assert.match(r.stderr, /blocks no merge/);
        assert.match(r.stderr, /no per-job exemption/);
      },
    );
  });

  test(`${GATING_CAP + 1} on a job outside every closure is NOT a finding`, () => {
    // The two caps are two different rules and this is what proves they are not
    // one rule applied twice: the same number that reddens the gating job above
    // is legitimate here.
    withTree(
      (root) => mutateJobTimeout(root, NON_GATING, [`    timeout-minutes: ${GATING_CAP + 1}`]),
      (r) => assert.equal(r.status, 0, `${r.stdout}${r.stderr}`),
    );
  });

  test('the closure is derived from `needs`, not from a list', () => {
    const wfs = parseAllWorkflows(REPO);
    const ci = wfs.find((w) => w.rel === `${WF}/ci.yml`);
    const closure = needsClosure(ci, 'ci-gate');
    assert.ok(closure.has('ci-gate'), 'the anchor is in its own closure');
    assert.ok(closure.has(GATING.job), `${GATING.job} is a direct need of ci-gate`);
    // `guard-meta` is reached through ci-gate's own needs list; the assertion
    // that matters is that the walk reaches MORE than the anchor.
    assert.ok(closure.size > 1, 'a closure of one means the `needs:` walk read nothing');

    // ⏱ 2026-09-24: the extensions CI lane holds a merge only THROUGH ci.yml's
    // `extensions` call job, so its closure is ci-gate's, followed one level.
    assert.equal(GATE_ANCHORS.length, 1, 'ci-gate is the one required check and the one anchor');
    const { gating, refusal } = gatingThroughCalls(wfs, GATE_ANCHORS[0]);
    assert.equal(refusal, null);
    assert.ok(gating.get(`${WF}/ci.yml`).has('extensions'), 'the call job is a direct need of ci-gate');
    const callee = gating.get(`${WF}/extensions-ci.yml`);
    assert.ok(callee && callee.has('ci-required') && callee.has('sims') && callee.has('build-free'), 'every callee job is merge-blocking through the call');
    assert.equal(gating.has(`${WF}/extensions.yml`), false, 'e2e-suite and release block no merge — that is why they are graded at the default cap');
  });
});

describe('assert-workflow-timeouts — COVERAGE LOST', () => {
  test('an empty workflow directory refuses with 2', () => {
    withTree(
      (root) => {
        for (const f of readdirSync(join(root, WF))) unlinkSync(join(root, WF, f));
      },
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /holds no \.yml/);
      },
    );
  });

  test('no workflow directory at all refuses with 2', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-wf-timeouts-bare-'));
    try {
      const r = spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.match(r.stderr, /there is no \.github\/workflows/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a workflow whose jobs this scan cannot read refuses with 2', () => {
    withTree(
      (root) => write(root, 'trufflehog.yml', 'name: x\non: push\npermissions:\n  contents: read\njobs:\n'),
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /parsed to 0 jobs/);
      },
    );
  });

  test('a renamed gate anchor refuses with 2 rather than widening every cap', () => {
    withTree(
      (root) => {
        const text = read(root, 'ci.yml');
        assert.match(text, /^ {2}ci-gate:$/m);
        write(root, 'ci.yml', text.replace(/^ {2}ci-gate:$/m, '  ci-gate-renamed:'));
      },
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /has no job `ci-gate`/);
        assert.match(r.stderr, /silently drops to the 60-minute cap/);
      },
    );
  });
});

// ⏱ 2026-09-24 — the closure followed THROUGH ci.yml's `extensions` call job.
describe('assert-workflow-timeouts — through a reusable-workflow call', () => {
  const CALLEE = { file: 'extensions-ci.yml', job: 'sims' };

  test('a callee job over the gating cap is a finding: the call puts it in ci-gate\'s closure', () => {
    withTree(
      (root) => mutateJobTimeout(root, CALLEE, [`    timeout-minutes: ${GATING_CAP + 15}`]),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /extensions-ci\.yml:\d+ job `sims` sets `timeout-minutes: 45`, over its cap of 30 — it is in the `needs` closure of ci-gate, through a call/);
      },
    );
  });

  test('a callee job with no timeout is a finding', () => {
    withTree(
      (root) => mutateJobTimeout(root, CALLEE, []),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /extensions-ci\.yml job `sims` declares no job-level `timeout-minutes:`/);
      },
    );
  });

  test('a call to a callee that is not in the tree refuses with 2', () => {
    withTree(
      (root) => {
        const text = read(root, 'ci.yml');
        const next = text.replace('uses: ./.github/workflows/extensions-ci.yml', 'uses: ./.github/workflows/extensions-cii.yml');
        assert.notEqual(next, text, 'the call job moved under this test');
        write(root, 'ci.yml', next);
      },
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /COVERAGE LOST — \.github\/workflows\/ci\.yml job `extensions` \(line \d+\) is in the ci-gate closure and calls \.github\/workflows\/extensions-cii\.yml, which this scan cannot follow \(missing\)/);
      },
    );
  });
});
