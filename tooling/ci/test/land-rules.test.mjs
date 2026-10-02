// land-rules.test.mjs — the three landing rules (tooling/ops/land-rules.mjs)
// against RECORDED check rollups, and the CLI and workflow that carry them.
//
// The fixtures under fixtures/land-rollup/ are `gh pr view <n> --json
// number,headRefOid,statusCheckRollup`, read 2026-09-30, with third-party URLs
// blanked. #1031 and #1029 each hold TWO CI runs on one head, the older one's
// ci-gate FAILED and listed first: the exact rollups land-v12 and land-v15
// stopped on (exit 5). Each red control below says which old reader it reds.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  GATE_CHECK,
  MAIN_WORKFLOW,
  MAIN_WORKFLOW_PATH,
  MAIN_HEALTH_CONTEXT,
  INFLIGHT_CAP,
  runIdOf,
  gateVerdict,
  redChecks,
  statusForRun,
  mainHealth,
  readFreeze,
  mayTakeLock,
  mainRunsFreeze,
  newReds,
  percentile,
  serialTiming,
} from '../../ops/land-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const FIX = join(HERE, 'fixtures', 'land-rollup');
const CLI = join(ROOT, 'tooling', 'ops', 'land-gate.mjs');
const load = (n) => JSON.parse(readFileSync(join(FIX, `pr-${n}.json`), 'utf8'));
const REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
const runUrl = (run, job = 1) => `https://github.com/${REPO}/actions/runs/${run}/job/${job}`;
const gateOf = (rs, run) => rs.find((c) => c.name === GATE_CHECK && runIdOf(c.detailsUrl) === run);

/** land-v12's reader, kept here as the red control: the FIRST ci-gate in the rollup. */
const firstEntryReader = (rs) => {
  const g = rs.find((c) => c.name === GATE_CHECK);
  return g ? `${g.status}/${g.conclusion ?? ''}` : 'none';
};

describe('rule (a): the gate is the ci-gate of the NEWEST run of its workflow on the head', () => {
  const twoRunsOneHead = (pr, older, newer) => {
    const rs = load(pr).statusCheckRollup;
    // The fixture still carries the shape it was recorded for, or this test proves nothing.
    assert.equal(gateOf(rs, older)?.conclusion, 'FAILURE');
    assert.equal(gateOf(rs, newer)?.conclusion, 'SUCCESS');
    assert.equal(firstEntryReader(rs), 'COMPLETED/FAILURE', 'red control: the first-entry reader (land-v12) reads this head as FAILED');
    const v = gateVerdict(rs);
    assert.equal(v.verdict, 'GREEN', v.why);
    assert.equal(v.gate.run, newer);
  };

  test("#1031 (recorded, body-edit second run): older run's gate FAILED and listed first, newer run green → GREEN", () => {
    twoRunsOneHead(1031, 36384843524, 36385974851);
  });

  test("#1029 (recorded, run cancelled by Renovate's rebase): older run's gate FAILED and listed first, newer run green → GREEN", () => {
    twoRunsOneHead(1029, 36523628152, 36523632923);
  });

  test('#1031 before the newer gate reported: the only gate is the OLDER run\'s FAILURE → STALE, never RED (v15.1)', () => {
    const rs = load(1031).statusCheckRollup.filter((c) => !(c.name === GATE_CHECK && runIdOf(c.detailsUrl) === 36385974851));
    // The newer run is still visible through its other checks.
    assert.ok(rs.some((c) => c.workflowName === 'CI' && runIdOf(c.detailsUrl) === 36385974851));
    const v = gateVerdict(rs);
    assert.equal(v.verdict, 'STALE', v.why);
    assert.equal(v.newestRun, 36385974851);
  });

  test('a newer run with NO check yet is known from the head\'s run list → STALE', () => {
    const rs = load(1066).statusCheckRollup;
    assert.equal(gateVerdict(rs).verdict, 'GREEN');
    const v = gateVerdict(rs, { runs: [{ id: 36640035226 + 9, name: 'CI', status: 'queued' }] });
    assert.equal(v.verdict, 'STALE', v.why);
  });

  test('older green, newer pending → PENDING (the green of a superseded run merges nothing)', () => {
    const rs = [
      ...load(1066).statusCheckRollup,
      { __typename: 'CheckRun', name: GATE_CHECK, workflowName: 'CI', detailsUrl: runUrl(36640035226 + 7), status: 'IN_PROGRESS', conclusion: '', startedAt: '2026-09-29T23:59:00Z' },
    ];
    const v = gateVerdict(rs);
    assert.equal(v.verdict, 'PENDING', v.why);
  });

  test('older red, newer green on one head → GREEN even when the red is listed LAST', () => {
    const rs = load(1031).statusCheckRollup;
    const reordered = [...rs.filter((c) => runIdOf(c.detailsUrl) !== 36384843524), ...rs.filter((c) => runIdOf(c.detailsUrl) === 36384843524)];
    assert.equal(gateVerdict(reordered).verdict, 'GREEN');
  });

  test('the newest gate FAILED → RED; its run CANCELLED (by the run list) → PENDING, not a verdict', () => {
    const rs = load(1066).statusCheckRollup.map((c) => (c.name === GATE_CHECK ? { ...c, conclusion: 'FAILURE' } : c));
    assert.equal(gateVerdict(rs).verdict, 'RED');
    assert.equal(gateVerdict(rs, { runs: [{ id: 36640035226, name: 'CI', status: 'completed', conclusion: 'cancelled' }] }).verdict, 'PENDING');
  });

  test('no ci-gate on the head → NONE; a REST check-run (no workflow name) is read by its run id', () => {
    assert.equal(gateVerdict([]).verdict, 'NONE');
    const rest = [
      { name: GATE_CHECK, status: 'completed', conclusion: 'failure', details_url: runUrl(10) },
      { name: GATE_CHECK, status: 'completed', conclusion: 'success', details_url: runUrl(12) },
    ];
    assert.equal(gateVerdict(rest).verdict, 'GREEN');
    assert.equal(gateVerdict(rest, { runs: [{ id: 13, name: MAIN_WORKFLOW }] }).verdict, 'STALE');
  });

  test('redChecks: a failed check of a SUPERSEDED run is history, not red (land-v14.2)', () => {
    const rs = load(1031).statusCheckRollup;
    const naive = rs.filter((c) => c.conclusion === 'FAILURE').map((c) => c.name);
    assert.ok(naive.length > 0, 'red control: the recorded rollup carries failures a naive reader stops on');
    assert.deepEqual(redChecks(rs), []);
    const now = rs.map((c) => (runIdOf(c.detailsUrl) === 36385974851 && c.name === GATE_CHECK ? { ...c, conclusion: 'FAILURE' } : c));
    assert.deepEqual(redChecks(now), [GATE_CHECK]);
  });
});

describe('rule (b): main is healthy when the newest CI run on the newest main sha is green', () => {
  const sha = 'a'.repeat(40);
  const run = (over = {}) => ({
    id: 500,
    // what GitHub actually sends: ci.yml's run-name, not the workflow name
    name: 'CI on main by @globalonlinedeveloper',
    path: MAIN_WORKFLOW_PATH,
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    html_url: `https://github.com/${REPO}/actions/runs/500`,
    head_repository: { full_name: REPO },
    ...over,
  });

  test('a completed push CI run on main posts its conclusion', () => {
    assert.equal(statusForRun(run(), { repo: REPO }).post.body.state, 'success');
    assert.equal(statusForRun(run({ conclusion: 'failure' }), { repo: REPO }).post.body.state, 'failure');
    assert.equal(statusForRun(run({ conclusion: 'timed_out' }), { repo: REPO }).post.body.state, 'failure');
    assert.equal(statusForRun(run(), { repo: REPO }).post.body.context, MAIN_HEALTH_CONTEXT);
  });

  // ⏱ 2026-10-02 (O-MERGES-DEPEND-ON-THE-LAPTOP): land.yml merges with GITHUB_TOKEN, whose
  // push starts no run, and dispatches ci.yml on main instead. That run is main's health too.
  test('a completed DISPATCH of CI on main (land.yml\'s post-merge start) posts its conclusion', () => {
    assert.equal(statusForRun(run({ event: 'workflow_dispatch' }), { repo: REPO }).post.body.state, 'success');
    assert.equal(statusForRun(run({ event: 'workflow_dispatch', conclusion: 'failure' }), { repo: REPO }).post.body.state, 'failure');
    assert.equal(statusForRun(run({ event: 'workflow_dispatch', head_branch: 'feature' }), { repo: REPO }).post, null, 'a dispatch on another branch is not main');
  });

  test('nothing is posted for a cancelled run, a PR run, a fork\'s `main`, another workflow or an unfinished run', () => {
    for (const over of [
      { conclusion: 'cancelled' },
      { event: 'pull_request' },
      { event: 'schedule' },
      { event: 'pull_request_target' },
      { head_repository: { full_name: 'someone/fork' } },
      { path: '.github/workflows/codeql.yml', name: 'CodeQL (push)' },
      { status: 'in_progress', conclusion: null },
      { head_branch: 'feature' },
      { head_sha: 'not-a-sha' },
    ]) {
      assert.equal(statusForRun(run(over), { repo: REPO }).post, null, JSON.stringify(over));
    }
  });

  test('the NEWEST RUN\'s status decides, not the newest post: an old run finishing late cannot overwrite', () => {
    const statuses = [
      { id: 9, context: MAIN_HEALTH_CONTEXT, state: 'failure', target_url: `https://github.com/${REPO}/actions/runs/400` },
      { id: 8, context: MAIN_HEALTH_CONTEXT, state: 'success', target_url: `https://github.com/${REPO}/actions/runs/401` },
      { id: 10, context: 'something-else', state: 'failure', target_url: '' },
    ];
    assert.equal(mainHealth({ mainSha: sha, statuses }).verdict, 'GREEN');
    assert.equal(mainHealth({ mainSha: sha, statuses: statuses.slice(0, 1) }).verdict, 'RED');
    assert.equal(mainHealth({ mainSha: sha, statuses: [] }).verdict, 'PENDING');
    assert.equal(mainHealth({ mainSha: '', statuses }).verdict, 'PENDING');
  });

  test('MAIN_WORKFLOW is ci.yml\'s own `name:` — a rename cannot leave main-healthy watching nothing', () => {
    const ci = readFileSync(join(ROOT, MAIN_WORKFLOW_PATH), 'utf8');
    assert.equal(/^name:\s*(.+)$/m.exec(ci)?.[1].trim(), MAIN_WORKFLOW);
  });

  test('a run is matched by its PATH: ci.yml sets run-name, so a run\'s `name` is never "CI"', () => {
    const ci = readFileSync(join(ROOT, MAIN_WORKFLOW_PATH), 'utf8');
    assert.match(ci, /^run-name:/m, 'red control: while ci.yml sets run-name, matching a run on name === "CI" posts nothing, ever');
    assert.equal(statusForRun(run({ path: `${MAIN_WORKFLOW_PATH}@refs/heads/main` }), { repo: REPO }).post.body.state, 'success');
    assert.equal(statusForRun(run({ name: 'CI', path: '.github/workflows/e2e.yml' }), { repo: REPO }).post, null);
  });

  test('main-healthy.yml posts on every completed CI run on main and runs the in-repo publisher', () => {
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'main-healthy.yml'), 'utf8');
    assert.match(wf, /^\s+workflow_run:\s*$/m);
    assert.match(wf, new RegExp(`^\\s+workflows: \\[${MAIN_WORKFLOW}\\]\\s*$`, 'm'));
    assert.match(wf, /^\s+types: \[completed\]\s*$/m);
    assert.match(wf, /^\s+branches: \[main\]\s*$/m);
    assert.match(wf, /^\s+statuses: write\s*$/m);
    assert.match(wf, /node tooling\/ops\/land-gate\.mjs publish-main-health/);
    assert.doesNotMatch(wf, /\$\{\{\s*github\.event\./, 'the event is read from GITHUB_EVENT_PATH by the script, never by an expression');
  });
});

describe('rule (c): the landing freeze', () => {
  test('any freeze file freezes, an empty one included; its first line is the reason', () => {
    assert.deepEqual(readFreeze(null), { frozen: false, reason: null });
    assert.equal(readFreeze('').frozen, true);
    assert.equal(readFreeze('\nmain red after #1066 on 5fff648c: CI=failure\nmore').reason, 'main red after #1066 on 5fff648c: CI=failure');
  });

  test('a lander holding the lock finishes; others wait; a fix-first PR merges under it; the in-flight cap holds', () => {
    const frozen = 'main red after #1 on deadbeef: CI=failure';
    assert.equal(mayTakeLock({ freezeText: frozen, holdsLock: true }).ok, true);
    assert.equal(mayTakeLock({ freezeText: frozen }).ok, false);
    assert.equal(mayTakeLock({ freezeText: frozen, fixFirst: true }).ok, true);
    assert.equal(mayTakeLock({ inflight: INFLIGHT_CAP }).ok, false);
    assert.equal(mayTakeLock({ inflight: INFLIGHT_CAP - 1 }).ok, true);
  });

  test('main runs: exempt dispatches are not main\'s red; cancelled-only is red only while main has not moved on', () => {
    const m = 'b'.repeat(40);
    const r = (name, conclusion, event = 'push') => ({ name, conclusion, event, status: 'completed', head_sha: m });
    assert.equal(mainRunsFreeze([r('CI', 'success'), r('Native auth proof', 'failure', 'workflow_dispatch'), r('Ops watch', 'failure', 'workflow_dispatch'), r('Store submit: Google Play', 'failure', 'workflow_dispatch')], { pr: 1, mainSha: m }), null);
    assert.equal(mainRunsFreeze([r('CI', 'cancelled')], { pr: 1, mainSha: m, newerMainSha: 'c'.repeat(40) }), null);
    assert.match(mainRunsFreeze([r('CI', 'cancelled')], { pr: 1, mainSha: m, newerMainSha: m }), /CI=cancelled/);
    assert.match(mainRunsFreeze([r('CI', 'failure'), r('CodeQL', 'success')], { pr: 7, mainSha: m }), /^main red after #7 on bbbbbbbb: CI=failure$/);
    assert.match(mainRunsFreeze([r('Native auth proof', 'failure', 'push')], { pr: 1, mainSha: m }), /Native auth proof=failure/, 'only a DISPATCHED proof is exempt');
  });

  test('ops-watch: only a job failing now and not before the merge is this merge\'s red', () => {
    assert.deepEqual(newReds(['pages', 'heartbeats'], ['heartbeats', 'pages']), []);
    assert.deepEqual(newReds(['pages'], ['pages', 'workers', 'workers']), ['workers']);
  });
});

describe('land-gate.mjs, the CLI a lander calls', () => {
  const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input, timeout: 60_000 });

  test('pr: GREEN exits 0, STALE exits 2, RED exits 1 — and the first line names the verdict', () => {
    const green = cli(['pr', '--file', join(FIX, 'pr-1031.json')]);
    assert.equal(green.status, 0, green.stdout + green.stderr);
    assert.match(green.stdout, /^GREEN /);
    const doc = load(1031);
    const stale = { ...doc, statusCheckRollup: doc.statusCheckRollup.filter((c) => !(c.name === GATE_CHECK && runIdOf(c.detailsUrl) === 36385974851)) };
    const s = cli(['pr'], JSON.stringify(stale));
    assert.equal(s.status, 2, s.stdout + s.stderr);
    assert.match(s.stdout, /^STALE /);
    const red = { ...doc, statusCheckRollup: doc.statusCheckRollup.map((c) => (c.name === GATE_CHECK && runIdOf(c.detailsUrl) === 36385974851 ? { ...c, conclusion: 'FAILURE' } : c)) };
    const rr = cli(['pr'], JSON.stringify(red));
    assert.equal(rr.status, 1, rr.stdout + rr.stderr);
    assert.match(rr.stdout, /^RED /);
  });

  test('pr: unreadable input is NONE, exit 2 — never a verdict', () => {
    const r = cli(['pr'], 'not json');
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^NONE /);
  });
});

describe('P-3: the serial minutes one landing costs', () => {
  const at = (m) => new Date(Date.parse('2026-09-28T00:00:00Z') + m * 60_000).toISOString();

  test('p50 gate→merge plus p50 merge→main green; a missing timestamp is left out, never a zero', () => {
    const t = serialTiming([
      { pr: 1, gateGreenAt: at(0), mergedAt: at(4), mainGreenAt: at(20) },
      { pr: 2, gateGreenAt: at(0), mergedAt: at(2), mainGreenAt: at(28) },
      { pr: 3, gateGreenAt: at(0), mergedAt: at(6), mainGreenAt: null },
      { pr: 4, gateGreenAt: null, mergedAt: at(0), mainGreenAt: at(10) },
    ]);
    assert.deepEqual(t.gateToMerge, { n: 3, p50: 4, p90: 6 });
    assert.deepEqual(t.mergeToMainGreen, { n: 3, p50: 16, p90: 26 });
    assert.equal(t.serialP50, 20);
    assert.equal(serialTiming([]).serialP50, null);
    assert.equal(percentile([5, 1, 3], 50), 3);
  });
});
