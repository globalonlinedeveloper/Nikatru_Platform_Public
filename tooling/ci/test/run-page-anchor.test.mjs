// ─────────────────────────────────────────────────────────────────────────────
// run-page-anchor.test.mjs — a stale page of GitHub Actions run history must
// read as UNREADABLE, never as a verdict, even when every read of it agrees.
//
// The three pages measured on 2026-09-18 are the fixtures, with their real run
// ids and times; each has a GREEN CONTROL (the current page) beside it, without
// which every refusal here would be consistent with an anchor that refuses all.
// The node-side readers are exercised THROUGH their callers —
// assert-ops-register.mjs `anchoredBranchPage` and
// assert-platform-proof-fresh.mjs `anchoredRuns` — so a caller that stopped
// applying the anchor reds here, not only the module.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANCHOR_RACE_MS,
  HEAD_RUN_GRACE_MS,
  STALE_PAGE,
  judgeRunPage,
  selfRunFloor,
  headAnchor,
  pushTriggersBranch,
  needsCrossRead,
  crossReadTerm,
  maxRunId,
} from '../run-page-anchor.mjs';
import { anchoredBranchPage } from '../assert-ops-register.mjs';
import { anchoredRuns } from '../assert-platform-proof-fresh.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
const workflow = (f) => readFileSync(join(REPO_ROOT, '.github', 'workflows', f), 'utf8');
const run = (id, created, updated, extra = {}) => ({ id, created_at: created, updated_at: updated ?? created, head_branch: 'main', ...extra });

// ── (1) ops-watch run 35369631763, 2026-09-18 16:38Z ────────────────────────
// ops-watch.yml's history on main ended at scheduled success 33228655039 of
// 2026-08-29 while successes existed at 12:17, 13:10 and 14:44Z.
const C1_NOW = Date.parse('2026-09-18T16:40:00Z');
const C1_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '35369631763',
  GITHUB_REPOSITORY: REPO,
  GITHUB_WORKFLOW_REF: `${REPO}/.github/workflows/ops-watch.yml@refs/heads/main`,
  GITHUB_REF: 'refs/heads/main',
};
const C1_STALE = [run(33228655039, '2026-08-29T02:19:16Z', '2026-08-29T02:20:03Z', { event: 'schedule', status: 'completed', conclusion: 'success' })];
const C1_SELF = run(35369631763, '2026-09-18T16:38:06Z', '2026-09-18T16:38:10Z', { event: 'schedule', status: 'in_progress', conclusion: null });
const C1_1444 = run(35362000000, '2026-09-18T14:44:00Z', '2026-09-18T14:50:00Z', { event: 'schedule', status: 'completed', conclusion: 'success', path: '.github/workflows/ops-watch.yml' });
const C1_FRESH = [C1_SELF, C1_1444, ...C1_STALE];

/** The I/O anchoredBranchPage needs, served from fixtures. */
function io({ env = C1_ENV, nowMs = C1_NOW, cross = [], head = null } = {}) {
  const asked = [];
  return {
    asked,
    env,
    nowMs,
    readWorkflow: (f) => workflow(f),
    branchHead: async () => head,
    repoRunsPage: async (repo, branch) => {
      asked.push(`${repo}|${branch}`);
      return { workflow_runs: cross };
    },
  };
}

// ── (2) PR #806 CI, attempt 1 started 2026-09-18T14:56:40Z ──────────────────
// build-platforms.yml ?status=success&per_page=100 ended at scheduled success
// 32003607931 (updated 2026-08-17T07:07:59Z, 32.3 days) while 35215254802 of
// 2026-09-17 existed.
const C2_NOW = Date.parse('2026-09-18T14:57:00Z');
const C2_URL = `https://api.github.com/repos/${REPO}/actions/workflows/build-platforms.yml/runs?status=success&per_page=100`;
const C2_STALE = [
  run(32003607931, '2026-08-17T06:55:35Z', '2026-08-17T07:07:59Z', { event: 'schedule', conclusion: 'success' }),
  run(31366937403, '2026-08-10T07:42:11Z', '2026-08-10T08:00:00Z', { event: 'schedule', conclusion: 'success' }),
];
const C2_NEW = run(35215254802, '2026-09-17T11:21:32Z', '2026-09-17T11:37:48Z', { event: 'schedule', conclusion: 'success' });

// ── (3) the platform Worker's watchdog, 2026-09-18 12:00Z ───────────────────
// ci.yml's history on main ended at 35117703012 (head 8f2af054, 2026-09-16)
// while 35340873024 existed — the push run of main HEAD 553e814a (11:41:23Z).
const C3_NOW = Date.parse('2026-09-18T12:00:00Z');
const C3_HEAD = { sha: '553e814a395420fecf637c95816b751aafcff1d3', commit: { message: 'feat(platform): ops watchdog (#802)', committer: { date: '2026-09-18T11:41:23Z' } } };
const C3_STALE = [run(35117703012, '2026-09-16T15:47:32Z', '2026-09-16T15:54:47Z', { head_sha: '8f2af054ee7473f09c1c997fb9981ebae7e23c34', status: 'completed', conclusion: 'success' })];
const C3_FRESH = [run(35340873024, '2026-09-18T11:41:25Z', '2026-09-18T11:48:02Z', { head_sha: C3_HEAD.sha, status: 'completed', conclusion: 'success' }), ...C3_STALE];

describe('(1) ops-watch 35369631763 — the SELF-RUN anchor, through assert-ops-register', () => {
  test('GREEN CONTROL — the current ops-watch.yml page holds the running run and is believed', async () => {
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C1_FRESH, false, io());
    assert.equal(got.runs, C1_FRESH);
  });

  test('🔴 THE MEASURED PAGE — ends at 33228655039, below the running run 35369631763: THROWS stale page', async () => {
    await assert.rejects(anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C1_STALE, false, io()), (e) => {
      assert.ok(e.message.startsWith(STALE_PAGE), e.message);
      assert.match(e.message, /ends at run 33228655039/);
      assert.match(e.message, /inside run 35369631763 of ops-watch\.yml on main/);
      assert.match(e.message, /not a pass, not a finding/);
      return true;
    });
  });

  test('🔴 and with no self-run (a laptop run), the repository-wide CROSS-READ catches the same page', async () => {
    const i = io({ env: {}, cross: [C1_1444] });
    await assert.rejects(anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C1_STALE, false, i), /stale page .*repository-wide run list on main answered run 35362000000/);
    assert.deepEqual(i.asked, [`${REPO}|main`]);
  });

  test('the repository-wide cross-read judges a workflow only by ITS runs — another workflow\'s newer run proves nothing', async () => {
    const other = { ...C1_1444, path: '.github/workflows/ci.yml' };
    await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C1_STALE, false, io({ env: {}, cross: [other] }));
  });

  test('selfRunFloor applies only to the running workflow on the running ref', () => {
    assert.equal(selfRunFloor(C1_ENV, { repo: REPO, workflow: 'ops-watch.yml', branch: 'main' }).id, 35369631763);
    assert.equal(selfRunFloor(C1_ENV, { repo: REPO, workflow: 'ci.yml', branch: 'main' }), null, 'another workflow');
    assert.equal(selfRunFloor({ ...C1_ENV, GITHUB_REF: 'refs/pull/806/merge' }, { repo: REPO, workflow: 'ops-watch.yml', branch: 'main' }), null, 'a PR ref');
    assert.equal(selfRunFloor({ ...C1_ENV, GITHUB_ACTIONS: undefined }, { repo: REPO, workflow: 'ops-watch.yml', branch: 'main' }), null, 'off-runner');
    assert.equal(selfRunFloor(C1_ENV, { repo: 'someone/else', workflow: 'ops-watch.yml', branch: 'main' }), null, 'another repo');
  });
});

describe('(2) PR #806 — the CROSS-READ anchor, through assert-platform-proof-fresh', () => {
  test('GREEN CONTROL — a cross-read that knows nothing newer leaves the page believed', async () => {
    const cur = [C2_NEW, ...C2_STALE];
    const got = await anchoredRuns(REPO, C2_URL, cur, 't', C2_NOW, async () => ({ workflow_runs: [C2_NEW] }));
    assert.equal(got, cur);
  });

  test('🔴 THE MEASURED PAGE — newest green 32003607931, cross-read answers 35215254802: THROWS stale page', async () => {
    let asked = null;
    await assert.rejects(
      anchoredRuns(REPO, C2_URL, C2_STALE, 't', C2_NOW, async (u) => {
        asked = u;
        return { workflow_runs: [C2_NEW] };
      }),
      (e) => {
        assert.ok(e.message.startsWith(STALE_PAGE), e.message);
        assert.match(e.message, /ends at run 32003607931/);
        assert.match(e.message, /answered run 35215254802/);
        return true;
      },
    );
    assert.equal(asked, C2_URL.replace('per_page=100', 'created=%3E%3D2026-08-17T06%3A55%3A35Z&per_page=10'));
  });

  test('a page whose newest run is recent is not cross-read at all — the budget holds', async () => {
    const recent = [run(1, new Date(C2_NOW - 3_600_000).toISOString())];
    await anchoredRuns(REPO, C2_URL, recent, 't', C2_NOW, async () => assert.fail('a recent page must not spend a cross-read'));
  });

  test('🔴 a cross-read without a workflow_runs array throws — an unread anchor is not an absent one', async () => {
    await assert.rejects(anchoredRuns(REPO, C2_URL, C2_STALE, 't', C2_NOW, async () => ({ message: 'x' })), /cross-read came back without/);
  });
});

describe('(3) the Worker watchdog 12:00Z — the BRANCH HEAD anchor', () => {
  test('GREEN CONTROL — the page holding main HEAD 553e814a is believed', () => {
    assert.equal(judgeRunPage(C3_FRESH, { head: headAnchor(C3_HEAD, C3_NOW), nowMs: C3_NOW }).ok, true);
  });

  test('🔴 THE MEASURED PAGE — ends at 35117703012 with no run of 553e814a: stale page', () => {
    const v = judgeRunPage(C3_STALE, { what: 'the run history of ci.yml on main', head: headAnchor(C3_HEAD, C3_NOW), nowMs: C3_NOW });
    assert.equal(v.ok, false);
    assert.match(v.why, /^stale page — the run history of ci\.yml on main ends at run 35117703012, but main HEAD 553e814a landed/);
  });

  test('🔴 and through assert-ops-register: ci.yml is push-triggered on main, so its branch page carries the anchor', async () => {
    const i = io({ env: {}, nowMs: C3_NOW, head: C3_HEAD });
    await assert.rejects(anchoredBranchPage(REPO, 'ci.yml', 'main', C3_STALE, false, i), /stale page .*553e814a/);
    await anchoredBranchPage(REPO, 'ci.yml', 'main', C3_FRESH, false, io({ env: {}, nowMs: C3_NOW, head: C3_HEAD }));
  });

  test('headAnchor — too young, or a skip marker, anchors nothing; a malformed body throws', () => {
    const at = (ms) => ({ ...C3_HEAD, commit: { ...C3_HEAD.commit, committer: { date: new Date(C3_NOW - ms).toISOString() } } });
    assert.equal(headAnchor(at(HEAD_RUN_GRACE_MS), C3_NOW).sha, C3_HEAD.sha);
    assert.equal(headAnchor(at(HEAD_RUN_GRACE_MS - 1), C3_NOW), null);
    assert.equal(headAnchor({ ...C3_HEAD, commit: { ...C3_HEAD.commit, message: 'x [skip ci]' } }, C3_NOW), null);
    assert.throws(() => headAnchor({ sha: 'abc' }, C3_NOW), /40-hex sha/);
  });

  test('pushTriggersBranch reads the REAL workflows: ci.yml yes; ops-watch.yml and build-platforms.yml no', () => {
    assert.equal(pushTriggersBranch(workflow('ci.yml'), 'main'), true);
    assert.equal(pushTriggersBranch(workflow('ops-watch.yml'), 'main'), false);
    assert.equal(pushTriggersBranch(workflow('build-platforms.yml'), 'main'), false);
    assert.equal(pushTriggersBranch('on:\n  push:\n    branches: [main]\n    paths: [x]\n', 'main'), false, 'a path filter withholds it');
    assert.equal(pushTriggersBranch('on:\n  push:\n    branches:\n      - main\n', 'main'), true, 'the list form');
    assert.equal(pushTriggersBranch('on: [push]\n', 'main'), false, 'a form it cannot read plainly answers false');
  });
});

describe('judgeRunPage — the pure edges', () => {
  const page = [run(100, '2026-09-01T00:00:00Z')];
  const NOW = Date.parse('2026-09-18T12:00:00Z');
  test('no anchor at all is a pass that says so', () => {
    assert.deepEqual(judgeRunPage(page, { nowMs: NOW }), { ok: true, anchored: [] });
  });
  test('a cross-read run that landed inside the race window is a race, one ms past it is staleness', () => {
    const edge = run(101, new Date(NOW - ANCHOR_RACE_MS).toISOString());
    assert.equal(judgeRunPage(page, { cross: { runs: [edge] }, nowMs: NOW }).ok, true);
    const over = run(101, new Date(NOW - ANCHOR_RACE_MS - 1).toISOString());
    assert.equal(judgeRunPage(page, { cross: { runs: [over] }, nowMs: NOW }).ok, false);
  });
  test('a cross-read that is STALER than the page can never make it stale (one-way)', () => {
    assert.equal(judgeRunPage(page, { cross: { runs: [run(50, '2026-08-01T00:00:00Z')] }, nowMs: NOW }).ok, true);
  });
  test('an empty page under a floor is stale; the floor is by id, not by position', () => {
    assert.equal(judgeRunPage([], { floor: { id: 5, why: 'w' }, nowMs: NOW }).ok, false);
    assert.equal(maxRunId([run(3, 'x'), run(9, 'x'), run(4, 'x')]), 9);
  });
  test('needsCrossRead / crossReadTerm', () => {
    assert.equal(needsCrossRead(page, NOW), true);
    assert.equal(needsCrossRead([run(1, new Date(NOW - 60_000).toISOString())], NOW), false);
    assert.equal(needsCrossRead([], NOW), false);
    assert.equal(crossReadTerm(page), 'created=%3E%3D2026-09-01T00%3A00%3A00Z');
    assert.equal(crossReadTerm([]), null);
  });
});

describe('the anchor is WIRED into both readers, not merely available to them', () => {
  // The cases above call anchoredBranchPage / anchoredRuns directly, so they
  // cannot see a reader that stopped calling them. These two can: the one
  // call each reader's live path makes, read from its CODE (comments stripped).
  const code = (f) => stripSourceComments(readFileSync(join(REPO_ROOT, 'tooling', 'ci', f), 'utf8'), '.mjs');
  test('assert-ops-register.mjs — the shared branch page returns through anchoredBranchPage', () => {
    assert.match(code('assert-ops-register.mjs'), /return anchoredBranchPage\(repo, workflow, branch, runs, /);
  });
  test('assert-platform-proof-fresh.mjs — fetchRuns returns through anchoredRuns', () => {
    assert.match(code('assert-platform-proof-fresh.mjs'), /return anchoredRuns\(repo, url, body\?\.workflow_runs, token, Date\.now\(\)\);/);
  });
});
