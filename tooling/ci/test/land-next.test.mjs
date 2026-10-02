// land-next.test.mjs — the merge orchestrator's decisions (tooling/ci/land-next.mjs)
// and the workflow shell around them (.github/workflows/land.yml), row
// O-MERGES-DEPEND-ON-THE-LAPTOP. Every rule has a red control: the input that
// would land the wrong thing, or the mutation of the real tree that breaks parity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
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
  dispatchParityProblems,
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
  labels: [LAND_LABEL],
  labeledAt: '2026-10-02T08:00:00Z',
  baseRef: 'main',
  headSha: HEAD,
  headRef: 'feat/x',
  headRepo: R,
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
const decide = (over) => decidePr(pr(over), { repo: R, units: UNITS });

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
  test('🔴 a red newest gate → SKIP; a running one → WAIT; none → WAIT', () => {
    assert.equal(decide({ checks: [gate(100, 'failure')] }).action, 'SKIP');
    assert.equal(decide({ checks: [gate(100, null, 'in_progress')] }).action, 'WAIT');
    assert.equal(decide({ checks: [] }).action, 'WAIT');
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
  test('a cancelled CI is re-dispatched, but only up to the cap', () => {
    assert.equal(watch([mainCi(9, { conclusion: 'cancelled' })]).state, 'NO_RUN');
    const many = Array.from({ length: MAIN_DISPATCH_CAP }, (_, i) => mainCi(9 + i, { conclusion: 'cancelled' }));
    assert.equal(watch(many).state, 'HOLD');
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
    const p = plan(snap({ prs: [pr({ number: 7, checks: [] }), pr({ number: 8, labeledAt: '2026-10-02T08:05:00Z' })] }));
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
  test('its triggers are the clock, CI/E2E completion, a land-ok label and a dry-run dispatch', () => {
    assert.deepEqual([...workflowEvents(wf)].sort(), ['pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run']);
    assert.match(text, /^ {4}- cron: '\*\/10 \* \* \* \*'$/m);
    assert.match(text, /^ {2}pull_request_target:\n {4}types: \[labeled\]$/m);
    assert.match(text, /^ {6}dry_run:\n(?: {8}.*\n)*? {8}default: true$/m, 'dry_run defaults to true');
  });
  test('the workflow_run names are the real workflows\' names', () => {
    const names = [...text.matchAll(/^ {4}workflows: \[([^\]]*)\]$/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const real = ['ci.yml', 'e2e.yml'].map((f) => /^name:\s*(.+)$/m.exec(readFileSync(join(REPO, '.github/workflows', f), 'utf8'))[1].trim());
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
  test('🔴 an unattended run is DRY until the variable says `false`', () => {
    assert.match(text, /LAND_DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('\{0\}', inputs\.dry_run\) \|\| vars\.LAND_DRY_RUN \|\| 'true' \}\}/);
    assert.match(text, /run: node tooling\/ci\/land-next\.mjs$/m);
  });
  test('the job runs only main\'s copy, and a labeled wake only for land-ok', () => {
    assert.match(text, /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name != 'pull_request_target' \|\| github\.event\.label\.name == 'land-ok'\)/);
  });
  test('the labels it reads are the ones it names', () => {
    assert.equal(LAND_LABEL, 'land-ok');
    assert.equal(FREEZE_LABEL, 'land-freeze');
    assert.deepEqual([...POST_MERGE_DISPATCH], ['ci.yml', 'codeql.yml', 'ops-watch.yml']);
  });
});
