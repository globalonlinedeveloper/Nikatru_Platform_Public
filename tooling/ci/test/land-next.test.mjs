// land-next.test.mjs — the merge orchestrator's decisions (tooling/ci/land-next.mjs)
// and the workflow shell around them (.github/workflows/land.yml), row
// O-MERGES-DEPEND-ON-THE-LAPTOP. Every rule has a red control: the input that
// would land the wrong thing, or the mutation of the real tree that breaks parity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  needsE2E,
  skewVerdict,
  deployUnitsOf,
  e2eVerdict,
  decidePr,
  mainWatch,
  plan,
  report,
  queueOrder,
  isDryRun,
  runMode,
  budgetProblem,
  performQueue,
  perform,
  workflowRunsOn,
  readSnapshot,
  parentBaseline,
  bindingOf,
  isUpdateCommit,
  diffPrint,
  sameDiff,
  dispatchParityProblems,
  HEAD_DISPATCH_CAP,
  API_BUDGET_FLOOR,
  LAND_LABEL,
  FREEZE_LABEL,
  MAIN_RUN_GRACE_MS,
  MAIN_DISPATCH_CAP,
  POST_MERGE_DISPATCH,
} from '../land-next.mjs';
import { parseWorkflow, workflowEvents } from '../workflow-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = resolve(HERE, '..', 'land-next.mjs');
const UNITS = JSON.parse(readFileSync(join(REPO, 'tooling/ci/lane-map.json'), 'utf8')).deployUnits;
const R = 'o/r';
const sha = (c) => c.repeat(40);
const MAIN = sha('a');
const PARENT = sha('b');
const HEAD = sha('c');
const H8 = HEAD.slice(0, 8);
const LABEL_AT = '2026-10-02T08:00:00Z';
/** A PR commit as readSnapshot normalises it (GET /pulls/N/commits). */
const commit = (s, parents = [PARENT], over = {}) => ({ sha: s, parents, committer: 'someone', verified: false, ...over });

// ── fixtures ────────────────────────────────────────────────────────────────
const gate = (run, conclusion = 'success', status = 'completed') => ({
  name: 'ci-gate',
  status,
  conclusion: status === 'completed' ? conclusion : null,
  details_url: `https://github.com/${R}/actions/runs/${run}/job/1`,
});
const ciRun = (id, over = {}) => ({ id, path: '.github/workflows/ci.yml', name: `CI on PR by @x`, status: 'completed', conclusion: 'success', head_sha: HEAD, ...over });
const e2eRun = (id, over = {}) => ({ id, path: '.github/workflows/e2e.yml', status: 'completed', conclusion: 'success', head_sha: HEAD, ...over });
const pr = (over = {}) => ({
  number: 7,
  state: 'open',
  draft: false,
  labels: [`${LAND_LABEL}:${H8}`],
  labeledAt: LABEL_AT,
  labelTimes: { [`${LAND_LABEL}:${H8}`]: LABEL_AT },
  forcePushes: [],
  commits: [commit(HEAD)],
  commitsComplete: true,
  baseRef: 'main',
  headSha: HEAD,
  headRef: 'feat/x',
  headRepo: R,
  headCommittedAt: '2026-10-02T07:00:00Z',
  mergeable: true,
  mergeableState: 'clean',
  checks: [gate(100)],
  runs: [ciRun(100)],
  e2eRuns: [],
  files: ['tooling/ci/x.mjs'],
  filesComplete: true,
  behindBy: 0,
  mainFiles: [],
  mainFilesComplete: true,
  ...over,
});
const mainCi = (id, over = {}) => ({ id, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: MAIN, status: 'completed', conclusion: 'success', html_url: `https://github.com/${R}/actions/runs/${id}`, ...over });
const OLD = '2026-10-02T08:00:00Z';
const NOW = Date.parse('2026-10-02T09:00:00Z');
const watch = (runs, extra = {}) => mainWatch({ main: { sha: MAIN, parentSha: PARENT, committedAt: OLD }, runs, now: NOW, ...extra });
const decide = (over) => decidePr(pr(over), { repo: R, units: UNITS, now: NOW });

describe('the E2E paths', () => {
  test('apps/*/(lib|integration_test|web|assets) and packages/*/lib need E2E', () => {
    for (const f of ['apps/st/lib/a.dart', 'apps/st/integration_test/x.dart', 'apps/st/web/index.html', 'apps/st/assets/i.png', 'packages/chassis/lib/c.dart']) {
      assert.equal(needsE2E([f]), true, f);
    }
  });
  test('🔴 a test, a tool or a package test does not', () => {
    for (const f of ['apps/st/test/a_test.dart', 'packages/chassis/test/c.dart', 'apps/st/pubspec.yaml', 'tooling/ci/x.mjs', 'apps/lib/x.dart']) {
      assert.equal(needsE2E([f]), false, f);
    }
  });
});

describe('the merge-skew rule (port of skew-disjoint.mjs)', () => {
  const v = (prFiles, mainFiles, over = {}) => skewVerdict({ prFiles, mainFiles, units: UNITS, ...over });
  test('disjoint paths in different deploy units are DISJOINT', () => {
    assert.equal(v(['services/edge-shield/src/a.ts'], ['sites/nikatru/index.html']).verdict, 'DISJOINT');
    assert.equal(v(['tooling/ci/x.mjs'], ['docs/ci/README.md']).verdict, 'DISJOINT');
    assert.equal(v(['tooling/ci/x.mjs'], []).verdict, 'DISJOINT');
  });
  test('🔴 main changing .github or a root lockfile is OVERLAP, whatever the PR touches', () => {
    assert.match(v(['docs/a.md'], ['.github/workflows/ci.yml']).why, /\.github\/workflows\/ci\.yml/);
    assert.equal(v(['docs/a.md'], ['pubspec.lock']).verdict, 'OVERLAP');
    assert.equal(v(['docs/a.md'], ['package-lock.json']).verdict, 'OVERLAP');
    assert.equal(v(['docs/a.md'], ['tooling/wrangler/package-lock.json']).verdict, 'DISJOINT', 'a nested lockfile is not the root one');
  });
  test('🔴 services/_shared on EITHER side is OVERLAP', () => {
    assert.equal(v(['services/_shared/a.ts'], ['docs/a.md']).verdict, 'OVERLAP');
    assert.equal(v(['docs/a.md'], ['services/_shared/a.ts']).verdict, 'OVERLAP');
  });
  test('🔴 the same path on both sides is OVERLAP', () => {
    assert.match(v(['docs/a.md'], ['docs/a.md']).why, /docs\/a\.md changed on both sides/);
  });
  test('🔴 a packages/ change against an apps/ or packages/ change is OVERLAP, both ways', () => {
    assert.equal(v(['apps/st/test/a.dart'], ['packages/core/lib/x.dart']).verdict, 'OVERLAP');
    assert.equal(v(['packages/core/lib/x.dart'], ['apps/st/test/a.dart']).verdict, 'OVERLAP');
    assert.equal(v(['packages/a/lib/x.dart'], ['packages/b/test/y.dart']).verdict, 'OVERLAP');
  });
  test('🔴 one deploy unit reached from both sides is OVERLAP', () => {
    const r = v(['services/platform/src/a.ts'], ['services/platform/src/b.ts']);
    assert.equal(r.verdict, 'OVERLAP');
    assert.match(r.why, /deploy unit platform/);
  });
  test('🔴 an unreadable or capped list, or an undecidable glob, is UNKNOWN — never DISJOINT', () => {
    assert.equal(v(null, ['docs/a.md']).verdict, 'UNKNOWN');
    assert.equal(v(['docs/a.md'], null).verdict, 'UNKNOWN');
    assert.equal(v(['docs/a.md'], ['docs/b.md'], { mainComplete: false }).verdict, 'UNKNOWN');
    assert.equal(skewVerdict({ prFiles: ['docs/a.md'], mainFiles: ['docs/b.md'], units: { u: ['docs/**/a.md'] } }).verdict, 'UNKNOWN');
    assert.deepEqual(deployUnitsOf(['docs/a.md'], { u: ['docs/**/a.md'] }).unknown, ['u: docs/**/a.md']);
  });
  test('🔴 COVERAGE LOST: no deploy units at all is UNKNOWN, never a DISJOINT that compared nothing', () => {
    for (const units of [{}, null, undefined]) {
      const r = skewVerdict({ prFiles: ['services/platform/a.ts'], mainFiles: ['services/platform/b.ts'.replace('b', 'c')], units });
      assert.equal(r.verdict, 'UNKNOWN', JSON.stringify(units));
      assert.match(r.why, /COVERAGE LOST/);
    }
  });
});

describe('E2E on a head', () => {
  test('the NEWEST E2E run on exactly this head decides', () => {
    assert.equal(e2eVerdict([e2eRun(1, { conclusion: 'failure' }), e2eRun(2)], HEAD).verdict, 'GREEN');
    assert.equal(e2eVerdict([e2eRun(2, { conclusion: 'failure' }), e2eRun(1)], HEAD).verdict, 'RED');
    assert.equal(e2eVerdict([e2eRun(3, { status: 'in_progress' })], HEAD).verdict, 'PENDING');
  });
  test('🔴 a green run on ANOTHER head, or a cancelled one, is no verdict', () => {
    assert.equal(e2eVerdict([e2eRun(1, { head_sha: sha('d') })], HEAD).verdict, 'NONE');
    assert.equal(e2eVerdict([e2eRun(1, { conclusion: 'cancelled' })], HEAD).verdict, 'NONE');
    assert.equal(e2eVerdict([{ ...e2eRun(1), path: '.github/workflows/ci.yml' }], HEAD).verdict, 'NONE');
  });
});

describe('one pull request', () => {
  test('green, mergeable, current and no E2E paths → MERGE', () => {
    assert.equal(decide({}).action, 'MERGE');
  });
  test('🔴 not eligible: closed, draft, no land-ok, another base → SKIP', () => {
    assert.match(decide({ state: 'closed' }).why, /state closed/);
    assert.equal(decide({ draft: true }).why, 'draft');
    assert.match(decide({ labels: ['other'] }).why, /no `land-ok` label/);
    assert.match(decide({ baseRef: 'release' }).why, /base is release/);
  });
  test('🔴 THE NEWEST RUN DECIDES (land-v15.1): a green gate of an older run while a newer run has no gate yet → WAIT', () => {
    const d = decide({ checks: [gate(100)], runs: [ciRun(100), ciRun(101, { status: 'in_progress', conclusion: null })] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /STALE/);
  });
  test('🔴 a red newest gate → SKIP; a running one → WAIT; none while its run runs → WAIT', () => {
    assert.equal(decide({ checks: [gate(100, 'failure')] }).action, 'SKIP');
    assert.equal(decide({ checks: [gate(100, null, 'in_progress')] }).action, 'WAIT');
    assert.equal(decide({ checks: [], runs: [ciRun(100, { status: 'in_progress', conclusion: null })] }).action, 'WAIT');
  });
  test('🔴 a conflict → SKIP; mergeability not computed → WAIT', () => {
    assert.equal(decide({ mergeable: false }).action, 'SKIP');
    assert.equal(decide({ mergeable: null }).action, 'WAIT');
  });
  test('🔴 an unreadable or capped file list → SKIP, never a guess', () => {
    assert.equal(decide({ files: null }).action, 'SKIP');
    assert.equal(decide({ filesComplete: false }).action, 'SKIP');
  });
  test('behind main: DISJOINT merges, OVERLAP and UNKNOWN update', () => {
    assert.equal(decide({ behindBy: 2, mainFiles: ['docs/b.md'] }).action, 'MERGE');
    assert.equal(decide({ behindBy: 2, mainFiles: ['.github/workflows/ci.yml'] }).action, 'UPDATE');
    assert.equal(decide({ behindBy: 2, mainFiles: ['docs/b.md'], mainFilesComplete: false }).action, 'UPDATE');
  });
  test('🔴 a fork behind main with OVERLAP is SKIPPED for a person: this token could not start its CI after an update', () => {
    const d = decide({ behindBy: 2, mainFiles: ['.github/workflows/ci.yml'], headRepo: 'someone/fork' });
    assert.equal(d.action, 'SKIP');
    assert.match(d.why, /update it by hand/);
  });
  test('E2E paths: green E2E on the head merges; none dispatches; running waits; red skips', () => {
    const files = ['apps/st/lib/a.dart'];
    assert.equal(decide({ files, e2eRuns: [e2eRun(5)] }).action, 'MERGE');
    assert.equal(decide({ files, e2eRuns: [] }).action, 'DISPATCH_E2E');
    assert.equal(decide({ files, e2eRuns: [e2eRun(5, { status: 'queued', conclusion: null })] }).action, 'WAIT');
    assert.equal(decide({ files, e2eRuns: [e2eRun(5, { conclusion: 'failure' })] }).action, 'SKIP');
  });
  test('🔴 a green E2E on an OLDER head does not license this one, and a fork is never dispatched', () => {
    const files = ['packages/chassis/lib/x.dart'];
    assert.equal(decide({ files, e2eRuns: [e2eRun(5, { head_sha: sha('d') })] }).action, 'DISPATCH_E2E');
    assert.equal(decide({ files, e2eRuns: [], headRepo: 'someone/fork' }).action, 'WAIT');
  });
  test('an update comes before the E2E: the head that merges is the head E2E ran on', () => {
    assert.equal(decide({ files: ['apps/st/lib/a.dart'], behindBy: 1, mainFiles: ['pubspec.lock'] }).action, 'UPDATE');
  });
});

describe("main after the last merge", () => {
  test('green CI (a dispatch of main) → GREEN', () => {
    assert.equal(watch([mainCi(9)]).state, 'GREEN');
    assert.equal(watch([mainCi(9, { event: 'push' })]).state, 'GREEN');
  });
  test('🔴 a CI run of main by any other event is not main\'s pipeline', () => {
    assert.equal(watch([mainCi(9, { event: 'schedule' })]).state, 'NO_RUN');
    assert.equal(watch([mainCi(9, { head_branch: 'feat' })]).state, 'NO_RUN');
  });
  test('no CI run: inside the grace it waits for the push run; past it, ci.yml is dispatched', () => {
    const fresh = mainWatch({ main: { sha: MAIN, committedAt: new Date(NOW - MAIN_RUN_GRACE_MS + 1000).toISOString() }, runs: [], now: NOW });
    assert.equal(fresh.state, 'RUNNING');
    const late = watch([]);
    assert.equal(late.state, 'NO_RUN');
    assert.deepEqual(late.act, { kind: 'dispatch-main' });
  });
  test('a running CI → RUNNING (one merge in flight); a running CodeQL alone does not hold the queue', () => {
    assert.equal(watch([mainCi(9, { status: 'in_progress', conclusion: null })]).state, 'RUNNING');
    const codeql = { ...mainCi(10, { status: 'in_progress', conclusion: null }), path: '.github/workflows/codeql.yml' };
    assert.equal(watch([mainCi(9), codeql]).state, 'GREEN');
  });
  test('a cancelled CI with no failed job is re-dispatched, but only up to the cap', () => {
    assert.equal(watch([mainCi(9, { conclusion: 'cancelled' })], { failedJobs: { 9: [] } }).state, 'NO_RUN');
    const many = Array.from({ length: MAIN_DISPATCH_CAP }, (_, i) => mainCi(9 + i, { conclusion: 'cancelled' }));
    assert.equal(watch(many, { failedJobs: Object.fromEntries(many.map((r) => [r.id, []])) }).state, 'HOLD');
  });
  test('🔴 a NEW failing job against the parent\'s run → FREEZE, naming the run and the job', () => {
    const w = watch([mainCi(9, { conclusion: 'failure' })], { failedJobs: { 9: ['deploy-web / deploy (st)'] }, baseline: { '.github/workflows/ci.yml': [] } });
    assert.equal(w.state, 'FREEZE');
    assert.match(w.freeze.title, /deploy-web \/ deploy \(st\)/);
    assert.match(w.freeze.body, /actions\/runs\/9/);
    assert.equal(w.freeze.marker, '<!-- land-freeze run=9 -->');
  });
  test('a red that was ALREADY red on the parent is not this merge\'s — RED, and merges continue', () => {
    const w = watch([mainCi(9, { conclusion: 'failure' })], { failedJobs: { 9: ['guards-legal'] }, baseline: { '.github/workflows/ci.yml': ['guards-legal'] } });
    assert.equal(w.state, 'RED');
  });
  test('🔴 no readable baseline, or unreadable jobs: every red is new (fail closed)', () => {
    assert.equal(watch([mainCi(9, { conclusion: 'failure' })], { failedJobs: { 9: ['x'] }, baseline: { '.github/workflows/ci.yml': null } }).state, 'FREEZE');
    assert.equal(watch([mainCi(9, { conclusion: 'failure' })], { failedJobs: {}, baseline: {} }).state, 'FREEZE');
  });
  test('🔴 attended dispatches never count: a red Rollback or Store submit run on main is not watched', () => {
    const rollback = { ...mainCi(11, { conclusion: 'failure' }), path: '.github/workflows/rollback.yml' };
    const store = { ...mainCi(12, { conclusion: 'failure' }), path: '.github/workflows/submit-play.yml' };
    assert.equal(watch([mainCi(9), rollback, store]).state, 'GREEN');
  });
});

describe('the run (one write, in queue order)', () => {
  const snap = (over = {}) => ({
    repo: R,
    now: new Date(NOW).toISOString(),
    main: { sha: MAIN, parentSha: PARENT, committedAt: OLD },
    mainRuns: [mainCi(9)],
    failedJobs: {},
    baseline: {},
    freezes: [],
    freezeMarkers: [],
    units: UNITS,
    prs: [pr({ number: 8, labeledAt: '2026-10-02T08:05:00Z' }), pr({ number: 7 })],
    ...over,
  });
  test('the earliest land-ok label merges first, and only it', () => {
    const p = plan(snap());
    assert.equal(p.act.kind, 'merge');
    assert.equal(p.act.pr.number, 7);
    assert.equal(p.decisions.length, 2);
  });
  test('the order is label time, then number; a PR with no label time is last', () => {
    const q = queueOrder([{ number: 3, labeledAt: null }, { number: 2, labeledAt: OLD }, { number: 1, labeledAt: OLD }]);
    assert.deepEqual(q.map((x) => x.number), [1, 2, 3]);
  });
  test('a waiting head of the queue does not block the next eligible PR', () => {
    const p = plan(snap({ prs: [pr({ number: 7, checks: [], runs: [ciRun(100, { status: 'in_progress', conclusion: null })] }), pr({ number: 8, labeledAt: '2026-10-02T08:05:00Z' })] }));
    assert.equal(p.act.pr.number, 8);
  });
  test('🔴 an OPEN land-freeze issue stops every merge', () => {
    const p = plan(snap({ freezes: [{ number: 50, state: 'open' }] }));
    assert.equal(p.act, null);
    assert.match(p.blocked, /FROZEN by #50/);
  });
  test('🔴 main running or unverified → no merge; unverified → ci.yml is dispatched instead', () => {
    assert.equal(plan(snap({ mainRuns: [mainCi(9, { status: 'queued', conclusion: null })] })).act, null);
    assert.equal(plan(snap({ mainRuns: [] })).act.kind, 'dispatch-main');
  });
  test('🔴 a NEW red opens the freeze issue ONCE: a run already named by an issue (open or closed) opens none', () => {
    const red = { mainRuns: [mainCi(9, { conclusion: 'failure' })], failedJobs: { 9: ['x'] }, baseline: { '.github/workflows/ci.yml': [] } };
    assert.equal(plan(snap(red)).act.kind, 'freeze');
    const named = plan(snap({ ...red, freezeMarkers: ['<!-- land-freeze run=9 -->'] }));
    assert.notEqual(named.act?.kind, 'freeze');
  });
  test('🔴 the lead CLOSING the freeze issue lifts it: the same red no longer stops the queue', () => {
    const red = { mainRuns: [mainCi(9, { conclusion: 'failure' })], failedJobs: { 9: ['x'] }, baseline: { '.github/workflows/ci.yml': [] } };
    const lifted = plan(snap({ ...red, freezeMarkers: ['<!-- land-freeze run=9 -->'] }));
    assert.equal(lifted.act.kind, 'merge', JSON.stringify(lifted.act));
    const stillOpen = plan(snap({ ...red, freezeMarkers: ['<!-- land-freeze run=9 -->'], freezes: [{ number: 51, state: 'open' }] }));
    assert.equal(stillOpen.act, null);
  });
  test('while main runs, a head may be readied (update, E2E dispatch) but never merged', () => {
    const busy = { mainRuns: [mainCi(9, { status: 'in_progress', conclusion: null })] };
    assert.equal(plan(snap({ ...busy })).act, null, 'the two PRs would MERGE: nothing');
    const p = plan(snap({ ...busy, prs: [pr({ number: 7 }), pr({ number: 8, files: ['apps/st/lib/a.dart'] })] }));
    assert.equal(p.act.kind, 'dispatch-e2e');
    assert.equal(p.act.pr.number, 8);
  });
  test('the report names every PR, its decision and the act, and says DRY RUN', () => {
    const lines = report(plan(snap()), { dryRun: true });
    assert.ok(lines.some((l) => /^#7 MERGE — /.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /^#8 MERGE — /.test(l)), lines.join('\n'));
    assert.match(lines.at(-1), /^DRY RUN, would act: merge #7 — /);
  });
  test('🔴 dry run unless LAND_DRY_RUN is exactly `false`', () => {
    for (const v of [undefined, '', 'true', 'False', 'no', '0']) assert.equal(isDryRun({ LAND_DRY_RUN: v }), true, String(v));
    assert.equal(isDryRun({ LAND_DRY_RUN: 'false' }), false);
  });
});

// ── FINDING 1 (review of #1158) + review of #1169 items 1 and 3: `land-ok:<sha8>` ──
// approves exactly that head; a GitHub update-branch merge of it carries the approval.
describe('land-ok:<sha8> is bound to the reviewed head, and the lander\'s update carries it', () => {
  const A = sha('1');
  const B = sha('2');
  const C = sha('3');
  const MAIN_NEW = sha('9');
  const A8 = A.slice(0, 8);
  const labelA = `${LAND_LABEL}:${A8}`;
  const update = (s, firstParent, over = {}) => commit(s, [firstParent, MAIN_NEW], { committer: 'web-flow', verified: true, ...over });
  // The PR's change to coverage-manifest.json, against old main (A) and after an update
  // from a main that added lines above it (B): the hunk header and context moved.
  const fileDiff = (patch) => diffPrint({ files: [{ status: 'modified', filename: 'tooling/ci/test/coverage-manifest.json', patch }] });
  const atA = fileDiff('@@ -522,7 +522,7 @@\n   "land-next.test.mjs":\n-    85,\n+    97,\n \n   "land-rules.test.mjs":');
  const atB = fileDiff('@@ -531,7 +531,7 @@\n   "land-next.test.mjs":\n-    85,\n+    97,\n \n   "landing.test.mjs":');
  const bound = (over) => decide({ labels: [labelA], labelTimes: { [labelA]: LABEL_AT }, commits: [commit(A)], headSha: A, ...over });
  test('`land-ok:<sha8>` on the head → MERGE', () => {
    const d = bound({});
    assert.equal(d.action, 'MERGE', d.why);
  });
  test('🔴 label at A → the lander updates to B, whose diff changed (hunk shift) → B is MERGE-able WITHOUT a re-label', () => {
    assert.equal(sameDiff(atA, atB), true, 'only hunk headers and context differ');
    const d = bound({ headSha: B, commits: [commit(A), update(B, A)], reviewedDiff: atA, headDiff: atB });
    assert.equal(d.action, 'MERGE', d.why);
    assert.match(d.why, /`land-ok:11111111` carried across 1 update-branch merge\(s\) from main with the approved changes unchanged/);
  });
  test('two update-branch merges in a row still carry it', () => {
    const D = sha('4');
    const d = bound({ headSha: D, commits: [commit(A), update(B, A), update(D, B)], reviewedDiff: atA, headDiff: atB });
    assert.equal(d.action, 'MERGE', d.why);
  });
  test('🔴 a person\'s push C after the label → WAIT naming `land-ok:<C8>`', () => {
    const d = bound({ headSha: C, commits: [commit(A), commit(C, [A])] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /head 33333333 is not `land-ok:11111111` nor a GitHub update-branch merge of it: apply `land-ok:33333333`/);
    const onUpdate = bound({ headSha: C, commits: [commit(A), update(B, A), commit(C, [B])] });
    assert.equal(onUpdate.action, 'WAIT', 'a push on top of the lander\'s update is a person\'s head too');
    assert.match(onUpdate.why, /apply `land-ok:33333333`/);
  });
  test('…and re-labelling `land-ok:<C8>` releases it: the remedy the WAIT names works', () => {
    const labelC = `${LAND_LABEL}:${C.slice(0, 8)}`;
    const d = bound({ headSha: C, labels: [labelA, labelC], labelTimes: { [labelA]: LABEL_AT, [labelC]: '2026-10-02T08:30:00Z' }, commits: [commit(A), commit(C, [A])] });
    assert.equal(d.action, 'MERGE', d.why);
  });
  test('🔴 what is NOT an update-branch merge never carries the binding', () => {
    const cases = {
      'not GitHub\'s committer': update(B, A, { committer: 'someone' }),
      'not verified': update(B, A, { verified: false }),
      'one parent': commit(B, [A], { committer: 'web-flow', verified: true }),
      'second parent a PR commit (a merge of another branch)': update(B, A, { parents: [A, C] }),
      'first parent not the bound head': update(B, C),
    };
    for (const [why, c] of Object.entries(cases)) {
      const d = bound({ headSha: B, commits: [commit(A), commit(C, [A]), c], reviewedDiff: atA, headDiff: atA });
      assert.equal(d.action, 'WAIT', why);
      assert.match(d.why, /apply `land-ok:22222222`/, why);
    }
    assert.equal(isUpdateCommit(update(B, A), new Map([[A, commit(A)]])), true);
  });
  test('🔴 an update-branch merge whose changes against main are NOT the approved ones (a web conflict edit) → WAIT', () => {
    const injected = fileDiff('@@ -531,7 +531,8 @@\n   "land-next.test.mjs":\n-    85,\n+    97,\n+  "evil": 1,\n \n');
    const d = bound({ headSha: B, commits: [commit(A), update(B, A)], reviewedDiff: atA, headDiff: injected });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /changes against main are not the approved ones: review 22222222 and apply `land-ok:22222222`/);
    assert.equal(bound({ headSha: B, commits: [commit(A), update(B, A)], reviewedDiff: null, headDiff: atB }).action, 'WAIT', 'uncomparable fails closed');
  });
  test('🔴 a bare `land-ok` binds to no head: WAIT with the label that would', () => {
    const d = decide({ labels: [LAND_LABEL] });
    assert.equal(d.action, 'WAIT');
    assert.match(d.why, /a bare `land-ok` binds to no head: apply `land-ok:cccccccc`/);
  });
  test('🔴 8 hex naming two commits, a force-push after the label, or an unreadable commit list → WAIT', () => {
    const twin = A8 + 'f'.repeat(32);
    assert.match(bound({ commits: [commit(A), commit(twin, [A])] }).why, /names 2 commits of this PR/);
    assert.match(bound({ forcePushes: ['2026-10-02T08:10:00Z'] }).why, /force-pushed after/);
    assert.equal(bound({ forcePushes: ['2026-10-02T07:10:00Z'] }).action, 'MERGE', 'a force-push BEFORE the label is what was reviewed');
    assert.equal(bound({ commitsComplete: false }).action, 'WAIT');
    assert.equal(bound({ commits: null }).action, 'WAIT');
    assert.equal(bound({ labelTimes: {} }).action, 'WAIT');
  });
  test('the binding names its label and hops', () => {
    assert.deepEqual(bindingOf({ headSha: B, labels: [labelA], labelTimes: { [labelA]: LABEL_AT }, commits: [commit(A), update(B, A)] }).sha, A);
    assert.equal(bindingOf({ headSha: B, labels: [labelA], labelTimes: { [labelA]: LABEL_AT }, commits: [commit(A), update(B, A)] }).hops, 1);
  });
  test('🔴 the fingerprint: changed lines only; a cut list is unreadable; a patchless file is its blob; order does not matter', () => {
    assert.equal(sameDiff(fileDiff('@@ -1 +1 @@\n-a\n+b'), fileDiff('@@ -1 +1 @@\n-a\n+EVIL')), false);
    assert.equal(sameDiff(fileDiff('@@ -1,2 +1,2 @@\n x\n-a\n+b'), fileDiff('@@ -9,2 +9,2 @@\n y\n-a\n+b')), true);
    assert.equal(diffPrint({ files: Array.from({ length: 300 }, (_, i) => ({ status: 'added', filename: `f${i}`, patch: '+' })) }), null);
    assert.equal(diffPrint({}), null);
    assert.notDeepEqual(diffPrint({ files: [{ status: 'modified', filename: 'a.png', sha: '1' }] }), diffPrint({ files: [{ status: 'modified', filename: 'a.png', sha: '2' }] }));
    const ab = diffPrint({ files: [{ status: 'added', filename: 'a', patch: '+1' }, { status: 'added', filename: 'b', patch: '+2' }] });
    const ba = diffPrint({ files: [{ status: 'added', filename: 'b', patch: '+2' }, { status: 'added', filename: 'a', patch: '+1' }] });
    assert.equal(sameDiff(ab, ba), true);
    assert.equal(sameDiff(ab, null), false);
  });
});

// ── FINDING 2: an update-branch by GITHUB_TOKEN starts no CI — never wait forever ──
describe('a head no CI run will grade gets ci.yml dispatched, up to a cap', () => {
  test('no ci-gate and no CI run on a head past the grace → DISPATCH_CI', () => {
    const d = decide({ checks: [], runs: [] });
    assert.equal(d.action, 'DISPATCH_CI', d.why);
  });
  test('inside the grace it waits for the push run', () => {
    assert.equal(decide({ checks: [], runs: [], headCommittedAt: new Date(NOW - 30_000).toISOString() }).action, 'WAIT');
  });
  test('🔴 a cancelled run that left the gate pending is re-dispatched; at the cap it is SKIPPED for a person, never a wait', () => {
    const cancelledGate = gate(100, 'cancelled');
    assert.equal(decide({ checks: [cancelledGate], runs: [ciRun(100, { conclusion: 'cancelled' })] }).action, 'DISPATCH_CI');
    const many = Array.from({ length: HEAD_DISPATCH_CAP }, (_, i) => ciRun(100 + i, { conclusion: 'cancelled' }));
    const d = decide({ checks: [gate(100 + HEAD_DISPATCH_CAP - 1, 'cancelled')], runs: many });
    assert.equal(d.action, 'SKIP');
    assert.match(d.why, /re-run its CI by hand/);
  });
  test('🔴 a fork head is never dispatched: SKIPPED for a person', () => {
    assert.equal(decide({ checks: [], runs: [], headRepo: 'someone/fork' }).action, 'SKIP');
  });
});

// ── FINDING 3: a red main ends `cancelled` under fail-fast ──
describe('a cancelled main run with a failed job is RED', () => {
  test('🔴 cancelled with a failed job → FREEZE, not a re-dispatch', () => {
    const w = watch([mainCi(9, { conclusion: 'cancelled' })], { failedJobs: { 9: ['guards-legal'] }, baseline: { '.github/workflows/ci.yml': [] } });
    assert.equal(w.state, 'FREEZE', w.why);
    assert.match(w.freeze.title, /guards-legal/);
  });
  test('🔴 cancelled with its jobs unread → FREEZE (fail closed)', () => {
    assert.equal(watch([mainCi(9, { conclusion: 'cancelled' })]).state, 'FREEZE');
  });
  test('cancelled with a failed job already red on the parent → RED, merges continue', () => {
    assert.equal(watch([mainCi(9, { conclusion: 'cancelled' })], { failedJobs: { 9: ['x'] }, baseline: { '.github/workflows/ci.yml': ['x'] } }).state, 'RED');
  });
});

// ── FINDING 4: main's run is read from ci.yml's own listing, on main, on the sha ──
describe("main's runs come from each workflow's own listing", () => {
  const fresh = (id, head) => ({ id, head_sha: head, created_at: new Date(NOW - 60_000).toISOString(), updated_at: new Date(NOW - 30_000).toISOString() });
  const on = (read, branch = 'main') => workflowRunsOn(read, { repo: R, workflowPath: '.github/workflows/ci.yml', sha: MAIN, branch, nowMs: NOW });
  test('the query names the workflow, the sha and the branch, read through the anchored reader', async () => {
    const asked = [];
    const rows = await on(async (u) => (asked.push(u), { workflow_runs: [fresh(1, MAIN)] }));
    assert.deepEqual(asked, [`https://api.github.com/repos/${R}/actions/workflows/ci.yml/runs?head_sha=${MAIN}&branch=main&per_page=100`]);
    assert.equal(rows[0].path, '.github/workflows/ci.yml');
  });
  test('🔴 a row on another sha, or no run array, is COULD NOT LOOK — never a verdict', async () => {
    await assert.rejects(on(async () => ({ workflow_runs: [fresh(2, PARENT)] })), /answered run 2 on bbbb/);
    await assert.rejects(on(async () => ({})), /without a workflow_runs array/);
  });
});

// ── review of #1169 item 5 (X7): a stale page is COULD NOT LOOK, never read as current ──
describe('a run listing proven stale is refused', () => {
  test('🔴 X7: the page ends at an old run while the cross-read holds a newer one → COULD NOT LOOK', async () => {
    const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
    const read = async (u) => ({ workflow_runs: /created=/.test(u) || !/branch=/.test(u) ? [{ id: 2, head_sha: MAIN, created_at: at(5), updated_at: at(5) }] : [{ id: 1, head_sha: MAIN, created_at: at(10), updated_at: at(10) }] });
    await assert.rejects(workflowRunsOn(read, { repo: R, workflowPath: '.github/workflows/ci.yml', sha: MAIN, branch: 'main', nowMs: NOW }), /stale page/);
  });
});

// ── review of #1169 items 2, 4 and 5 (X5): readSnapshot, through a stubbed fetch ──
describe('readSnapshot, against a stubbed GitHub', () => {
  const fresh = (iso = new Date(NOW - 60_000).toISOString()) => ({ created_at: iso, updated_at: iso });
  const stub = async (routes, fn) => {
    const asked = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      const path = u.pathname.replace(`/repos/${R}`, '') + u.search;
      asked.push(path);
      const hit = routes.find(([re]) => re.test(path));
      if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
      return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      return { r: await fn(), asked };
    } finally {
      globalThis.fetch = real;
    }
  };
  const labelC = `${LAND_LABEL}:${H8}`;
  const openPr = (labels) => ({ number: 7, title: 't', state: 'open', draft: false, labels: labels.map((name) => ({ name })), base: { ref: 'main' }, head: { sha: HEAD, ref: 'feat/x', repo: { full_name: R } } });
  const job = (name, conclusion) => ({ name, conclusion });
  const routes = ({ parentRuns }) => [
    [/^\/pulls\?state=open/, [openPr([labelC])]],
    [/^\/commits\/main$/, { sha: MAIN, parents: [{ sha: PARENT }], commit: { committer: { date: OLD } } }],
    [new RegExp(`^/actions/workflows/ci\\.yml/runs\\?head_sha=${MAIN}`), { workflow_runs: [{ ...mainCi(9, { conclusion: 'cancelled' }), ...fresh() }] }],
    [new RegExp(`^/actions/workflows/ci\\.yml/runs\\?head_sha=${PARENT}`), { workflow_runs: parentRuns }],
    [new RegExp(`^/actions/workflows/ci\\.yml/runs\\?head_sha=${HEAD}`), { workflow_runs: [{ ...ciRun(100), ...fresh() }] }],
    [/^\/actions\/workflows\/(codeql|e2e)\.yml\/runs/, { workflow_runs: [] }],
    [/^\/actions\/runs\/9\/jobs/, { jobs: [job('guards-legal', 'failure'), job('deploy', 'cancelled')] }],
    [/^\/actions\/runs\/5\/jobs/, { jobs: [job('guards-legal', 'failure'), job('deploy', 'cancelled')] }],
    [/^\/actions\/runs\/4\/jobs/, { jobs: [job('guards-legal', 'success')] }],
    [/^\/issues\?labels=land-freeze/, []],
    [/^\/pulls\/7$/, { mergeable: true, mergeable_state: 'clean' }],
    [/^\/issues\/7\/events/, [{ event: 'labeled', label: { name: labelC }, created_at: LABEL_AT }]],
    [/^\/commits\/c+\/check-runs/, { check_runs: [gate(100)] }],
    [/^\/pulls\/7\/commits/, [{ sha: HEAD, parents: [{ sha: PARENT }], committer: { login: 'someone' }, commit: { committer: { date: OLD }, verification: { verified: false } } }]],
    [/^\/pulls\/7\/files/, [{ filename: 'tooling/ci/x.mjs' }]],
    [/^\/compare\//, { ahead_by: 0, files: [] }],
  ];
  const parentRed = [
    { ...mainCi(5, { head_sha: PARENT, conclusion: 'cancelled' }), ...fresh() },
    { ...mainCi(4, { head_sha: PARENT, conclusion: 'success' }), ...fresh() },
  ];
  test('🔴 item 2 / X5: main cancelled with a failed job, its PARENT cancelled with the same failed job → RED, merges continue (not FREEZE)', async () => {
    const { r: snap } = await stub(routes({ parentRuns: parentRed }), () => readSnapshot({ repo: R, token: 't', now: new Date(NOW) }));
    assert.deepEqual(snap.failedJobs, { 9: ['guards-legal'] }, "X5: a cancelled main run's jobs are read");
    assert.deepEqual(snap.baseline, { '.github/workflows/ci.yml': ['guards-legal'] }, "the parent's cancelled red run is the baseline, not its older green one");
    const p = plan(snap);
    assert.equal(p.watch.state, 'RED', p.watch.why);
    assert.equal(p.act?.kind, 'merge', JSON.stringify(p.act));
  });
  test('…a new failing job against that baseline still FREEZEs', async () => {
    const r = routes({ parentRuns: parentRed });
    r.unshift([/^\/actions\/runs\/9\/jobs/, { jobs: [job('guards-legal', 'failure'), job('guards-platform', 'failure')] }]);
    const { r: snap } = await stub(r, () => readSnapshot({ repo: R, token: 't', now: new Date(NOW) }));
    assert.equal(plan(snap).watch.state, 'FREEZE');
  });
  test('parentBaseline passes over a cancel with no failed job, and is null with no verdict at all', async () => {
    const jobs = { 5: [], 4: ['x'] };
    const runs = [{ id: 5, status: 'completed', conclusion: 'cancelled' }, { id: 4, status: 'completed', conclusion: 'failure' }];
    assert.deepEqual(await parentBaseline(runs, async (r) => jobs[r.id]), ['x']);
    assert.equal(await parentBaseline([{ id: 5, status: 'completed', conclusion: 'cancelled' }], async () => []), null);
    assert.equal(await parentBaseline([], async () => []), null);
  });
  test('🔴 item 4: no open PR carries land-ok → it stops after the PR list: main\'s runs are never read', async () => {
    const r = routes({ parentRuns: parentRed });
    r.unshift([/^\/pulls\?state=open/, [openPr(['other']), { ...openPr([labelC]), number: 8, draft: true }]]);
    const { r: snap, asked } = await stub(r, () => readSnapshot({ repo: R, token: 't', now: new Date(NOW) }));
    assert.equal(snap.idle, true);
    assert.deepEqual(asked, ['/pulls?state=open&base=main&per_page=100&page=1']);
    const p = plan(snap);
    assert.equal(p.watch.state, 'IDLE');
    assert.equal(p.act, null);
    assert.deepEqual(p.decisions.map((d) => d.action), ['SKIP', 'SKIP']);
  });
});

// ── FINDING 5 (mutation M7): every write is pinned to the head the decision read ──
describe('the merge and the update are pinned to the head sha', () => {
  const capture = async (act, status) => {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      const answer = String(url).includes('/dispatches') ? 204 : status;
      return new Response(answer === 204 ? null : '{}', { status: answer });
    };
    try {
      return { r: await perform(act, { repo: R, token: 't' }), calls };
    } finally {
      globalThis.fetch = real;
    }
  };
  const act = (kind) => ({ kind, pr: { number: 7, headSha: HEAD, headRef: 'feat/x' }, why: 'test' });
  test('🔴 M7: the squash merge sends `sha` = the head read', async () => {
    const { r, calls } = await capture(act('merge'), 200);
    const merge = calls.find((c) => c.url.endsWith('/pulls/7/merge'));
    assert.deepEqual(merge.body, { merge_method: 'squash', sha: HEAD });
    assert.equal(r.wrote, true);
    assert.deepEqual(calls.filter((c) => c.url.includes('/dispatches')).map((c) => c.body), POST_MERGE_DISPATCH.map(() => ({ ref: 'main' })));
  });
  test('🔴 M7: update-branch sends `expected_head_sha` = the head read', async () => {
    const { r, calls } = await capture(act('update'), 202);
    assert.deepEqual(calls[0].body, { expected_head_sha: HEAD });
    assert.equal(r.wrote, true);
  });
  test('a CI dispatch names the PR branch; a refused merge wrote nothing', async () => {
    const { calls } = await capture(act('dispatch-ci'), 204);
    assert.match(calls[0].url, /\/actions\/workflows\/ci\.yml\/dispatches$/);
    assert.deepEqual(calls[0].body, { ref: 'feat/x' });
    const refused = await capture(act('merge'), 405);
    assert.equal(refused.r.wrote, false);
    assert.equal(refused.r.code, 1);
  });
});

// ── FINDING 6: one refused write does not block the queue ──
describe('a refused write skips that PR and tries the next', () => {
  const a = (n, kind = 'merge') => ({ kind, pr: { number: n, headSha: HEAD, headRef: 'x' }, why: '' });
  test('🔴 #7 refused → #8 is tried and merged; still exit 1, with the reason', async () => {
    const tried = [];
    const r = await performQueue([a(7), a(8)], async (act) => (tried.push(act.pr.number), act.pr.number === 7 ? { code: 1, lines: ['refused 7'], wrote: false } : { code: 0, lines: ['merged 8'], wrote: true }));
    assert.deepEqual(tried, [7, 8]);
    assert.equal(r.code, 1);
    assert.ok(r.lines.some((l) => /skipped #7: its merge was refused/.test(l)), r.lines.join('\n'));
  });
  test('only ONE write: the first that writes ends the run', async () => {
    const tried = [];
    const r = await performQueue([a(7), a(8)], async (act) => (tried.push(act.pr.number), { code: 0, lines: [], wrote: true }));
    assert.deepEqual(tried, [7]);
    assert.equal(r.code, 0);
  });
  test('🔴 a refused main write (freeze) stops the run: nothing passes it', async () => {
    const tried = [];
    await performQueue([{ kind: 'freeze', why: '' }, a(8)], async (act) => (tried.push(act.kind), { code: 1, lines: [], wrote: false }));
    assert.deepEqual(tried, ['freeze']);
  });
  test('the plan carries every PR write in queue order', () => {
    const p = plan({ repo: R, now: new Date(NOW).toISOString(), main: { sha: MAIN, parentSha: PARENT, committedAt: OLD }, mainRuns: [mainCi(9)], units: UNITS, prs: [pr({ number: 8, labeledAt: '2026-10-02T08:05:00Z' }), pr({ number: 7 })] });
    assert.deepEqual(p.candidates.map((c) => c.pr.number), [7, 8]);
    assert.equal(p.act, p.candidates[0]);
  });
});

// ── FINDING 7 / NIT 10: the budget floor, and a live dispatch during the dry period ──
describe('the run refuses to start without budget, and to act while the repository is dry', () => {
  test('🔴 below the floor, or unreadable, is a refusal', () => {
    assert.equal(budgetProblem({ remaining: API_BUDGET_FLOOR, limit: 1000 }), null);
    assert.match(budgetProblem({ remaining: API_BUDGET_FLOOR - 1, limit: 1000, reset: 0 }), /below the floor/);
    assert.match(budgetProblem(null), /unreadable/);
  });
  test('🔴 a `dry_run=false` dispatch while the variable is not `false` is REFUSED and runs dry', () => {
    for (const v of [undefined, '', 'true']) {
      const m = runMode({ LAND_DRY_RUN: v, LAND_DISPATCH_DRY_RUN: 'false' });
      assert.equal(m.dry, true, String(v));
      assert.match(m.refusal, /REFUSED while the repository is in its dry-run period/);
    }
  });
  test('a dispatch can only make a run drier', () => {
    assert.deepEqual(runMode({ LAND_DRY_RUN: 'false', LAND_DISPATCH_DRY_RUN: 'true' }), { dry: true, refusal: null });
    assert.deepEqual(runMode({ LAND_DRY_RUN: 'false', LAND_DISPATCH_DRY_RUN: 'false' }), { dry: false, refusal: null });
    assert.deepEqual(runMode({ LAND_DRY_RUN: 'false', LAND_DISPATCH_DRY_RUN: '' }), { dry: false, refusal: null });
  });
});

describe('the CLI', () => {
  const runCli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  test('--snapshot decides from a recorded snapshot and writes nothing (exit 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'land-next-'));
    try {
      const f = join(dir, 's.json');
      writeFileSync(f, JSON.stringify({ repo: R, now: new Date(NOW).toISOString(), main: { sha: MAIN, committedAt: OLD }, mainRuns: [mainCi(9)], units: UNITS, prs: [pr()] }));
      const r = runCli(['--snapshot', f], { LAND_DRY_RUN: 'false' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /^main: GREEN/m);
      assert.match(r.stdout, /DRY RUN, would act: merge #7/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('🔴 item 4: a live (dry) run with no land-ok PR prints its API budget lines and reads nothing of main', async () => {
    const asked = [];
    const server = createServer((req, res) => {
      asked.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-ratelimit-remaining', '897');
      if (req.url === '/rate_limit') return res.end(JSON.stringify({ resources: { core: { remaining: 900, limit: 1000, reset: 0 } } }));
      if (req.url.startsWith(`/repos/${R}/pulls?state=open`)) return res.end('[]');
      res.statusCode = 404;
      return res.end('{}');
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const child = spawn(process.execPath, [SCRIPT], { cwd: REPO, env: { PATH: process.env.PATH, GITHUB_REPOSITORY: R, GITHUB_TOKEN: 't', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      const code = await new Promise((ok) => child.on('close', ok));
      assert.equal(code, 0, out);
      assert.match(out, /^API budget: 900\/1000 remaining at the start \(floor 200\)$/m);
      assert.match(out, /^main: IDLE — no open pull request carries `land-ok`/m);
      assert.match(out, /^API budget: this run made 2 request\(s\); 897 remaining$/m);
      assert.deepEqual(asked, ['/rate_limit', `/repos/${R}/pulls?state=open&base=main&per_page=100&page=1`]);
    } finally {
      server.close();
    }
  });
  test('🔴 an unreadable snapshot, or no token, is COULD NOT LOOK (exit 2)', () => {
    assert.equal(runCli(['--snapshot', join(tmpdir(), 'no-such-land-snapshot.json')]).status, 2);
    const r = runCli([], { GITHUB_REPOSITORY: R });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /COULD NOT LOOK/);
  });
});

// ── THE PARITY: a dispatch of main is the same pipeline as a push to main ────
describe('a dispatch of ci.yml on main runs the same pipeline as a push', () => {
  const fromTree = (rel) => {
    try {
      return readFileSync(join(REPO, rel), 'utf8');
    } catch {
      return null;
    }
  };
  test('the committed tree has parity (P1-P4)', () => {
    assert.deepEqual(dispatchParityProblems(fromTree), []);
  });
  const mutated = (rel, from, to) => (r) => {
    const t = fromTree(r);
    if (r !== rel) return t;
    assert.ok(t.includes(from), `${rel} no longer carries ${JSON.stringify(from)} — re-aim this red control`);
    return t.replace(from, to);
  };
  test('🔴 P1: ci.yml without `workflow_dispatch` is red', () => {
    const p = dispatchParityProblems(mutated('.github/workflows/ci.yml', '  workflow_dispatch:\n', ''));
    assert.ok(p.some((x) => /^P1: /.test(x)), p.join('\n'));
  });
  test('🔴 P2: a deploy call job back on the push-only `if:` is red', () => {
    const p = dispatchParityProblems(
      mutated('.github/workflows/ci.yml', "    if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'\n    uses: ./.github/workflows/deploy-web.yml", "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n    uses: ./.github/workflows/deploy-web.yml"),
    );
    assert.ok(p.some((x) => /^P2: \.github\/workflows\/ci\.yml:\d+ /.test(x)), p.join('\n'));
  });
  test('🔴 P3: the secret scan without its dispatch base is red', () => {
    const p = dispatchParityProblems(mutated('.github/workflows/ci.yml', `          if [ "\${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then SCAN_BASE="$(git rev-parse --verify "\${SCAN_HEAD}^1")"; fi\n`, ''));
    assert.ok(p.some((x) => /^P3: \.github\/workflows\/ci\.yml:\d+ .*SCAN_BASE/.test(x)), p.join('\n'));
  });
  test('🔴 P3: the extensions discover step (a ci.yml callee) without its dispatch base is red', () => {
    const p = dispatchParityProblems(mutated('.github/workflows/extensions-ci.yml', '"workflow_dispatch "*/.github/workflows/ci.yml@refs/heads/main', '"never"'));
    assert.ok(p.some((x) => /^P3: \.github\/workflows\/extensions-ci\.yml:\d+ /.test(x)), p.join('\n'));
  });
  test('🔴 it refuses blind: a ci.yml whose call lines it cannot read, or no ci.yml, is a problem, never parity', () => {
    const noCalls = (r) => (r === '.github/workflows/ci.yml' ? fromTree(r).replace(/^ {4}uses: \.\//gm, '    uses: ././') : fromTree(r));
    assert.ok(dispatchParityProblems(noCalls).some((x) => /parity cannot be judged/.test(x)));
    assert.match(dispatchParityProblems(() => null)[0], /parity cannot be judged/);
  });
  test('🔴 P4: a post-merge dispatch target with a REQUIRED input is red', () => {
    const p = dispatchParityProblems(mutated('.github/workflows/ops-watch.yml', '        type: boolean\n        default: false\n', '        type: boolean\n        required: true\n        default: false\n'));
    assert.ok(p.some((x) => /^P4: \.github\/workflows\/ops-watch\.yml/.test(x)), p.join('\n'));
  });
  test('🔴 the parity reds against origin/main as it stood before this change, when the ref is there', (t) => {
    const show = (rel) => {
      try {
        return execFileSync('git', ['show', `${process.env.LAND_PARITY_BASE ?? 'origin/main'}:${rel}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return null;
      }
    };
    const ci = show('.github/workflows/ci.yml');
    if (ci === null || /^ {2}workflow_dispatch:/m.test(ci)) return t.skip('no pre-change ci.yml to replay (shallow clone, or main already carries the change)');
    assert.ok(dispatchParityProblems(show).length > 0);
  });
});

// ── THE SHELL: land.yml ──────────────────────────────────────────────────────
describe('.github/workflows/land.yml is a thin, least-privilege shell with one actor', () => {
  const rel = '.github/workflows/land.yml';
  const text = readFileSync(join(REPO, rel), 'utf8');
  const wf = parseWorkflow(REPO, rel);
  test('its triggers are the clock, CI completion, a land-ok label and a dry-run dispatch', () => {
    assert.deepEqual([...workflowEvents(wf)].sort(), ['pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run']);
    assert.match(text, /^ {4}- cron: '\*\/10 \* \* \* \*'$/m);
    assert.match(text, /^ {2}pull_request_target:\n {4}types: \[labeled\]$/m);
    assert.match(text, /^ {6}dry_run:\n(?: {8}.*\n)*? {8}default: true$/m, 'dry_run defaults to true');
  });
  test('the workflow_run names are the real workflows\' names: CI only, E2E\'s verdict is read over the API on each run', () => {
    const names = [...text.matchAll(/^ {4}workflows: \[([^\]]*)\]$/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const real = ['ci.yml'].map((f) => /^name:\s*(.+)$/m.exec(readFileSync(join(REPO, '.github/workflows', f), 'utf8'))[1].trim());
    assert.deepEqual(names, real);
  });
  test('🔴 exactly one merge actor: concurrency `land`, never cancelled', () => {
    assert.match(text, /^concurrency:\n(?: {2}#.*\n)* {2}group: land\n {2}cancel-in-progress: false$/m);
  });
  test('🔴 PR code is never checked out: every checkout names main, and no expression reads the PR head', () => {
    const checkouts = [...text.matchAll(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n((?: {8}.*\n)*)/g)];
    assert.ok(checkouts.length >= 1);
    for (const c of checkouts) assert.match(c[1], /^ {10}ref: main$/m, c[0]);
    assert.doesNotMatch(text, /github\.event\.pull_request\.head|github\.head_ref|github\.event\.workflow_run\.head/);
  });
  test('🔴 least privilege: an empty workflow block, and the job holds only the five scopes it uses', () => {
    assert.match(text, /^permissions: \{\}$/m);
    const block = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(text)[1];
    const scopes = [...block.matchAll(/^ {6}([a-z-]+): (\w+)$/gm)].map((m) => `${m[1]}: ${m[2]}`).sort();
    assert.deepEqual(scopes, ['actions: write', 'checks: read', 'contents: write', 'issues: write', 'pull-requests: write']);
    assert.doesNotMatch(text, /secrets\./, 'NO secret: the run\'s own GITHUB_TOKEN only');
  });
  test('🔴 every run is DRY until the variable says `false`; a dispatch\'s input is passed apart, never in its place', () => {
    assert.match(text, /^ {10}LAND_DRY_RUN: \$\{\{ vars\.LAND_DRY_RUN \|\| 'true' \}\}$/m);
    assert.match(text, /^ {10}LAND_DISPATCH_DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('\{0\}', inputs\.dry_run\) \|\| '' \}\}$/m);
    assert.match(text, /run: node tooling\/ci\/land-next\.mjs$/m);
  });
  test('the job runs only main\'s copy, and a labeled wake only for land-ok or land-ok:<sha8>', () => {
    assert.match(text, /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name != 'pull_request_target' \|\| startsWith\(github\.event\.label\.name, 'land-ok'\)\)/);
  });
  test('the labels it reads are the ones it names', () => {
    assert.equal(LAND_LABEL, 'land-ok');
    assert.equal(FREEZE_LABEL, 'land-freeze');
    assert.deepEqual([...POST_MERGE_DISPATCH], ['ci.yml', 'codeql.yml', 'ops-watch.yml']);
  });
});
