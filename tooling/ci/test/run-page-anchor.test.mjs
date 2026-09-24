// ─────────────────────────────────────────────────────────────────────────────
// run-page-anchor.test.mjs — a stale page of GitHub Actions run history must
// read as UNREADABLE, never as a verdict, even when every read of it agrees.
//
// The three pages measured on 2026-09-18 are the fixtures, with their real run
// ids and times; each has a GREEN CONTROL (the current page) beside it, without
// which every refusal here would be consistent with an anchor that refuses all.
// The node-side readers are exercised THROUGH their callers —
// assert-ops-register.mjs `anchoredBranchPage`, and the three freshness guards'
// `readRunHistory`, which read through anchored-run-read.mjs — so a caller that
// stopped applying the anchor reds here, not only the module.
//
// ⏱ 2026-09-24 (trap ci-48): the fourth measured page, PR #913's, and the
// UNION rule (decision E2) — a page the cross-read proves stale is graded on
// the union of both reads, so the PR #806 page, which read COVERAGE LOST, now
// reads GREEN on the cross-read's run 35215254802. Page (1) and page (3) are
// unchanged: they reach the anchor through assert-ops-register.mjs, whose
// refusal is not a freshness claim and was deliberately left as it was.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
import * as platformGuard from '../assert-platform-proof-fresh.mjs';
import * as e2eGuard from '../assert-e2e-proof-fresh.mjs';
import {
  STALE_PAGE_CARRIED,
  anchoredRunRead,
  describeRead,
  fixtureReads,
  unionById,
  crossReadUrl,
} from '../anchored-run-read.mjs';
import { CouldNotLook, READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';
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

/** An injected `read(url)` for the shared reader: the page for the caller's
 *  own query, the cross-read for anything else, and every URL asked recorded. */
function served(page, cross) {
  const asked = [];
  return {
    asked,
    read: async (u) => {
      asked.push(u);
      if (asked.length === 1) return { workflow_runs: page };
      if (cross === undefined) assert.fail(`a second request was not expected: ${u}`);
      return typeof cross === 'function' ? cross(u) : { workflow_runs: cross };
    },
  };
}

describe('(2) PR #806 — the CROSS-READ anchor, through assert-platform-proof-fresh', () => {
  test('GREEN CONTROL — a cross-read that knows nothing newer leaves the page believed', async () => {
    const cur = [C2_NEW, ...C2_STALE];
    const s = served(cur, [C2_NEW]);
    const got = await platformGuard.readRunHistory({ repo: REPO, read: s.read, nowMs: C2_NOW });
    assert.equal(got.stale, false);
    assert.equal(got.page, cur);
    const v = platformGuard.gradeRunHistory(got, C2_NOW);
    assert.equal(v.ok, true);
    assert.equal(v.stalePageCarried, undefined, 'a page that is not stale carries no stale-page line');
  });

  test('🔴 THE MEASURED PAGE — newest green 32003607931, cross-read answers 35215254802: the anchor still says STALE', async () => {
    const s = served(C2_STALE, [C2_NEW]);
    const got = await platformGuard.readRunHistory({ repo: REPO, read: s.read, nowMs: C2_NOW });
    assert.equal(got.stale, true);
    assert.ok(got.verdict.why.startsWith(STALE_PAGE), got.verdict.why);
    assert.match(got.verdict.why, /ends at run 32003607931/);
    assert.match(got.verdict.why, /answered run 35215254802/);
    assert.deepEqual(s.asked, [C2_URL, C2_URL.replace('per_page=100', 'created=%3E%3D2026-08-17T06%3A55%3A35Z&per_page=10')]);
  });

  test('🟢 RE-GRADED UNDER THE UNION (E2) — VERDICT CHANGED: COVERAGE LOST before, GREEN now, on the cross-read\'s 35215254802', async () => {
    // The page alone graded 32.3 days against a 14-day ceiling. The cross-read
    // held 35215254802, a scheduled green of 2026-09-17T11:37:48Z — 1.1 days at
    // C2_NOW. A replica can omit runs, never invent one, so that run exists.
    const got = await platformGuard.readRunHistory({ repo: REPO, read: served(C2_STALE, [C2_NEW]).read, nowMs: C2_NOW });
    const v = platformGuard.gradeRunHistory(got, C2_NOW);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.runId, 35215254802);
    assert.ok(v.stalePageCarried.startsWith(STALE_PAGE_CARRIED), v.stalePageCarried);
    assert.match(v.stalePageCarried, /page's newest qualifying run is 32003607931 \(updated_at 2026-08-17T07:07:59Z\) over 2 row\(s\)/);
    assert.match(v.stalePageCarried, /cross-read's is 35215254802 \(updated_at 2026-09-17T11:37:48Z\) over 1 row\(s\)/);
  });

  test('🔴 the same stale page, and a cross-read whose newest is ALSO past the ceiling: COVERAGE LOST, never a finding', async () => {
    const old = run(33000000001, '2026-08-31T06:00:00Z', '2026-08-31T06:20:00Z', { event: 'schedule', conclusion: 'success' });
    const got = await platformGuard.readRunHistory({ repo: REPO, read: served(C2_STALE, [old]).read, nowMs: C2_NOW });
    assert.equal(got.stale, true);
    const v = platformGuard.gradeRunHistory(got, C2_NOW);
    assert.equal(v.ok, false);
    assert.equal(v.unreadable, true, 'the platform guard reports `unreadable` as COULD NOT LOOK, exit 2');
    assert.match(v.reason, /^stale page — .*not fresh either \(newest green run is 18\.4 days old, ceiling is 14\)/);
  });

  test('a page whose newest run is recent is not cross-read at all — the budget holds', async () => {
    const recent = [run(1, new Date(C2_NOW - 3_600_000).toISOString())];
    const got = await platformGuard.readRunHistory({ repo: REPO, read: served(recent).read, nowMs: C2_NOW });
    assert.equal(got.cross, null);
    assert.match(got.crossWhyNot, /^the page's newest run 1 is under 3h old$/);
  });

  test('🔴 a cross-read without a workflow_runs array throws — an unread anchor is not an absent one', async () => {
    await assert.rejects(
      platformGuard.readRunHistory({ repo: REPO, read: served(C2_STALE, () => ({ message: 'x' })).read, nowMs: C2_NOW }),
      (e) => e instanceof CouldNotLook && /cross-read came back without/.test(e.message),
    );
  });
});

// ── (4) PR #913 CI run 35967342865 attempt 1, ~2026-09-24T07:01Z ────────────
// assert-e2e-proof-fresh failed "newest green scheduled run is 5.0 days old,
// ceiling is 3" while main carried 35962444367 (updated 06:06:58Z, dispatched
// by the Worker cron, which the outcome limb counts) and 35838102124
// (2026-09-23T08:43:34Z, scheduled). The re-query at 07:05:34Z returned 73 rows,
// newest 35962444367; attempt 2 passed. The trap records neither the stale
// page's run id nor its rows, so the page below is SYNTHETIC (35500000001 and
// its neighbours) and dated to give exactly the measured 5.0 days; the two
// green runs and their updated_at are the measured ones, and their created_at
// (not recorded) is set twenty minutes before.
const C4_NOW = Date.parse('2026-09-24T07:01:00Z');
const C4_E2E_URL = e2eGuard.buildRunsUrl(REPO);
const C4_PAGE = [
  run(35500000001, '2026-09-19T06:41:00Z', '2026-09-19T07:01:00Z', { event: 'workflow_dispatch', conclusion: 'success' }),
  run(35400000001, '2026-09-18T06:41:00Z', '2026-09-18T07:01:00Z', { event: 'workflow_dispatch', conclusion: 'success' }),
];
const C4_DISPATCHED = run(35962444367, '2026-09-24T05:46:58Z', '2026-09-24T06:06:58Z', { event: 'workflow_dispatch', conclusion: 'success' });
const C4_SCHEDULED = run(35838102124, '2026-09-23T08:23:34Z', '2026-09-23T08:43:34Z', { event: 'schedule', conclusion: 'success' });

describe('(4) PR #913 — the e2e guard now reads through the shared anchored reader', () => {
  test('🟢 THE MEASURED SHAPE — the cross-read holds 35962444367, so the union is GREEN and says the page was stale', async () => {
    const s = served(C4_PAGE, [C4_DISPATCHED, C4_SCHEDULED]);
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: s.read, nowMs: C4_NOW });
    assert.deepEqual(s.asked, [C4_E2E_URL, C4_E2E_URL.replace('per_page=100', 'created=%3E%3D2026-09-19T06%3A41%3A00Z&per_page=10')]);
    assert.equal(got.stale, true);
    const v = e2eGuard.gradeRunHistory(got, C4_NOW);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.runId, 35962444367);
    assert.match(v.stalePageCarried, /^STALE PAGE, CROSS-READ CARRIED THE PROOF: the page's newest qualifying run is 35500000001 \(updated_at 2026-09-19T07:01:00Z\) over 2 row\(s\); the cross-read's is 35962444367 \(updated_at 2026-09-24T06:06:58Z\) over 2 row\(s\)/);
  });

  test('🔴 CONTROL — the same page with an EMPTY cross-read is the finding, and the reason NAMES what it read', async () => {
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: served(C4_PAGE, []).read, nowMs: C4_NOW });
    assert.equal(got.stale, false);
    const v = e2eGuard.gradeRunHistory(got, C4_NOW);
    assert.equal(v.ok, false);
    assert.notEqual(v.coverageLost, true, 'a page that is not proven stale is a finding (exit 1), as before');
    assert.equal(
      v.reason,
      'newest green scheduled run is 5.0 days old, ceiling is 3 — run 35500000001 (updated_at 2026-09-19T07:01:00Z) is the newest green run on main ' +
        `of 2 row(s) returned by GET /repos/${REPO}/actions/workflows/e2e.yml/runs?branch=main&status=success&per_page=100 and 0 row(s) on its cross-read`,
    );
  });

  test('🔴 page proven stale, and the cross-read\'s newest is ALSO past the ceiling: COVERAGE LOST (exit 2), not a finding', async () => {
    const fourDays = run(35700000001, '2026-09-20T06:41:00Z', '2026-09-20T07:01:00Z', { event: 'workflow_dispatch', conclusion: 'success' });
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: served(C4_PAGE, [fourDays]).read, nowMs: C4_NOW });
    const v = e2eGuard.gradeRunHistory(got, C4_NOW);
    assert.equal(v.ok, false);
    assert.equal(v.coverageLost, true);
    assert.match(v.reason, /^stale page — the successful-run history of e2e\.yml on main ends at run 35500000001, but .*answered run 35700000001/);
    assert.match(v.reason, /not fresh either \(newest green scheduled run is 4\.0 days old, ceiling is 3/);
  });

  test('describeRead — the query, rows, per_page, saturation, newest qualifying run and the cross-read, in one line', async () => {
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: served(C4_PAGE, [C4_DISPATCHED, C4_SCHEDULED]).read, nowMs: C4_NOW });
    assert.equal(
      describeRead(got, e2eGuard.newestGreenOnBranch),
      `GET /repos/${REPO}/actions/workflows/e2e.yml/runs?branch=main&status=success&per_page=100 · 2 row(s) returned, per_page 100, ` +
        'saturated no · newest qualifying run 35962444367 (updated_at 2026-09-24T06:06:58Z) · cross-read created=>=2026-09-19T06:41:00Z: ' +
        '2 row(s), newest 35962444367 · the page is PROVEN STALE',
    );
  });
});

describe('the per-request ceiling — a read that never answers is COVERAGE LOST inside the shared bound (E4)', () => {
  const never = () => new Promise(() => {});
  test('🔴 through the e2e guard: the ceiling fires on every attempt, and the whole read ends inside the bound', { timeout: 10_000 }, async () => {
    const TIMEOUT = 50;
    let calls = 0;
    const t0 = Date.now();
    await assert.rejects(
      e2eGuard.readRunHistory({ repo: REPO, read: () => { calls += 1; return never(); }, nowMs: C4_NOW, retry: { timeoutMs: TIMEOUT, sleep: async () => {} } }),
      (e) => e instanceof CouldNotLook && /no answer within 0\.05s/.test(e.message) && /COULD NOT LOOK/.test(e.message),
    );
    const elapsed = Date.now() - t0;
    assert.equal(calls, READ_ATTEMPTS, 'each attempt was made and each one hit the ceiling');
    assert.ok(elapsed >= READ_ATTEMPTS * TIMEOUT - 10, `ended in ${elapsed}ms — faster than the ceiling, so the ceiling did not fire`);
    assert.ok(elapsed < READ_ATTEMPTS * TIMEOUT + 1000, `took ${elapsed}ms, past ${READ_ATTEMPTS} x ${TIMEOUT}ms plus slack`);
  });

  test('🔴 through the platform guard: the same', { timeout: 10_000 }, async () => {
    const t0 = Date.now();
    await assert.rejects(
      platformGuard.readRunHistory({ repo: REPO, read: never, nowMs: C2_NOW, retry: { timeoutMs: 50, sleep: async () => {} } }),
      (e) => e instanceof CouldNotLook && /no answer within 0\.05s/.test(e.message),
    );
    assert.ok(Date.now() - t0 < READ_ATTEMPTS * 50 + 1000);
  });

  test('🔴 and the CROSS-READ is bounded too, not only the page', { timeout: 10_000 }, async () => {
    await assert.rejects(
      e2eGuard.readRunHistory({ repo: REPO, read: served(C4_PAGE, () => never()).read, nowMs: C4_NOW, retry: { timeoutMs: 50, sleep: async () => {} } }),
      (e) => e instanceof CouldNotLook && /no answer within 0\.05s/.test(e.message),
    );
  });
});

describe('anchored-run-read — the pure edges', () => {
  test('fixtureReads — an array is a page with no cross-read; {page, cross} carries both; anything else throws', () => {
    assert.deepEqual(fixtureReads([1]), { page: [1], cross: null });
    assert.deepEqual(fixtureReads({ page: [1], cross: [2] }), { page: [1], cross: [2] });
    assert.deepEqual(fixtureReads({ page: [1] }), { page: [1], cross: null });
    assert.throws(() => fixtureReads({ page: [1], cross: 'x' }), CouldNotLook);
    assert.throws(() => fixtureReads({ workflow_runs: [] }), /neither an array of runs/);
  });

  test('a fixture never reaches the network, and says so on its read line', async () => {
    const got = await anchoredRunRead({ workflow: 'e2e.yml', url: C4_E2E_URL, fixture: C4_PAGE, nowMs: C4_NOW, read: () => assert.fail('a fixture read must not fetch') });
    assert.equal(got.crossWhyNot, 'fixture has none');
    assert.match(describeRead(got, e2eGuard.newestGreenOnBranch), /fixture standing in for GET .* · cross-read not run \(fixture has none\)$/);
  });

  test('unionById — one row per id, the later updated_at wins, id-less rows kept', () => {
    const a = { id: 1, updated_at: '2026-09-01T00:00:00Z', v: 'page' };
    const b = { id: 1, updated_at: '2026-09-02T00:00:00Z', v: 'cross' };
    assert.deepEqual(unionById([a, { v: 'no id' }], [b, { id: 2 }]).map((r) => r.v ?? r.id), ['cross', 'no id', 2]);
  });

  test('crossReadUrl refuses a query with no per_page — the replace would re-send the SAME query', () => {
    assert.throws(() => crossReadUrl('https://api.github.com/x/runs?status=success', 'created=1'), /carries no per_page/);
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

  test('…and the three graded by the freshness readers carry no BRANCH HEAD anchor because none is pushed on main', () => {
    // anchored-run-read.mjs states, per caller, that the branch-head anchor fits
    // none of them. That is a MEASUREMENT of these three files; the day one of
    // them gains a push trigger on main this reds, and the anchor should be armed.
    assert.equal(pushTriggersBranch(workflow('e2e.yml'), 'main'), false, 'e2e.yml has no push trigger');
    assert.equal(pushTriggersBranch(workflow('build-platforms.yml'), 'main'), false, 'build-platforms.yml is pushed only by a tag');
    assert.equal(pushTriggersBranch(workflow('extensions.yml'), 'main'), false, 'extensions.yml is pushed only by a tag');
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

describe('the anchor is WIRED into every reader, not merely available to them', () => {
  // The cases above call anchoredBranchPage / readRunHistory directly, so they
  // cannot see a reader that stopped calling them. These can: the calls each
  // reader's live path makes, read from its CODE (comments stripped). For the
  // three freshness readers that is four links — the import, the reader built on
  // anchoredRunRead with the guard's own query, the live path reaching it, and
  // the verdict graded on what it returned — plus no bare `fetch(`, which would
  // be a request outside the shared ceiling (E4).
  const code = (rel) => stripSourceComments(readFileSync(join(REPO_ROOT, rel), 'utf8'), '.mjs');
  test('assert-ops-register.mjs — the shared branch page returns through anchoredBranchPage', () => {
    assert.match(code('tooling/ci/assert-ops-register.mjs'), /return anchoredBranchPage\(repo, workflow, branch, runs, /);
  });
  test('assert-platform-proof-fresh.mjs — the live read and the grade both go through the shared reader', () => {
    const c = code('tooling/ci/assert-platform-proof-fresh.mjs');
    assert.match(c, /import \{[^}]*\banchoredRunRead\b[^}]*\} from '\.\/anchored-run-read\.mjs';/);
    assert.match(c, /return anchoredRunRead\(\{\s*workflow: WORKFLOW,\s*url: buildRunsUrl\(repo\),/);
    assert.match(c, /read = await fetchRuns\(nowMs\);/);
    assert.match(c, /async function fetchRuns\(nowMs\) \{[^}]*return readRunHistory\(\{ repo, token, nowMs \}\);/);
    assert.match(c, /const verdict = gradeRunHistory\(read, nowMs\);/);
    assert.doesNotMatch(c, /\bfetch\s*\(/, 'a bare fetch is a request outside the shared ceiling');
  });
  test('tooling/ci/assert-e2e-proof-fresh.mjs — the live read and the grade both go through the shared reader', () => {
    const c = code('tooling/ci/assert-e2e-proof-fresh.mjs');
    assert.match(c, /import \{[^}]*\banchoredRunRead\b[^}]*\} from '\.\/anchored-run-read\.mjs';/);
    assert.match(c, /return anchoredRunRead\(\{\s*workflow: WORKFLOW,\s*url: buildRunsUrl\(repo\),/);
    assert.match(c, /read = await fetchRuns\(nowMs\);/);
    assert.match(c, /async function fetchRuns\(nowMs\) \{[^}]*return readRunHistory\(\{ repo, token, nowMs \}\);/);
    assert.match(c, /: gradeRunHistory\(read, nowMs\);/);
    assert.doesNotMatch(c, /\bfetch\s*\(/, 'a bare fetch is a request outside the shared ceiling');
  });
  test('extensions/scripts/assert-e2e-proof-fresh.mjs — the run history and the jobs both go through the shared reader', () => {
    const c = code('extensions/scripts/assert-e2e-proof-fresh.mjs');
    assert.match(c, /import \{[^}]*\banchoredRunRead\b[^}]*\} from '\.\.\/\.\.\/tooling\/ci\/anchored-run-read\.mjs';/);
    assert.match(c, /const read = await anchoredRunRead\(\{\s*workflow: WORKFLOW,\s*url: GITHUB_API \+ runsPath,/);
    assert.match(c, /const rows = read\.union;/);
    assert.match(c, /return githubJson\(GITHUB_API \+ p, token, /);
    assert.doesNotMatch(c, /\bfetch\s*\(/, 'a bare fetch is a request outside the shared ceiling');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E5 — THE CLASS CANNOT GROW A FOURTH UNANCHORED READER.
// Measured at 403d7716, `actions/workflows/…/runs` URLs are built in FIVE files
// under tooling/ci and extensions/scripts: the three freshness readers above,
// assert-alert-disposition.mjs:508 and assert-ops-register.mjs (:2617, :2664,
// :3114). tooling/ops readers (triage-failed-runs, check-prod-provenance,
// redeploy-stranded) are OUTSIDE this case: they are ops-watch and operator
// tools, not the CI guards this class is about. The set below is DERIVED from
// the tree; the exempt list is SHRINK-ONLY and every entry must still be true.
// ─────────────────────────────────────────────────────────────────────────────
describe('E5 — every run-history URL builder under tooling/ci and extensions/scripts reads through the shared reader, or is a named exemption', () => {
  const RUNS_URL = /actions\/workflows\/[^'"`\n]*\/runs\b/;
  const EXEMPT = new Map([
    ['tooling/ci/assert-alert-disposition.mjs', 'grades whether each FAILED run (a firing) was dispositioned, not how fresh a proof is; a stale page there hides firings, which is its own anchor question'],
    ['tooling/ci/assert-ops-register.mjs', 'its shared branch page is anchored through anchoredBranchPage (kept on purpose: red-since is not a freshness claim); the two targeted fallback reads (ghNewestRun, unitRunsPage) are reconciled at two widths, not yet anchored'],
  ]);
  const candidates = [];
  for (const dir of ['tooling/ci', 'extensions/scripts']) {
    for (const f of readdirSync(join(REPO_ROOT, dir)).filter((n) => n.endsWith('.mjs')).sort()) {
      const rel = `${dir}/${f}`;
      const c = stripSourceComments(readFileSync(join(REPO_ROOT, rel), 'utf8'), '.mjs');
      if (RUNS_URL.test(c)) candidates.push({ rel, code: c });
    }
  }

  test('the sweep reached the three freshness readers (anti-vacuity: a blind sweep would pass everything)', () => {
    const found = candidates.map((c) => c.rel);
    for (const must of ['tooling/ci/assert-e2e-proof-fresh.mjs', 'tooling/ci/assert-platform-proof-fresh.mjs', 'extensions/scripts/assert-e2e-proof-fresh.mjs']) {
      assert.ok(found.includes(must), `${must} builds a run-history URL and the sweep did not see it: ${found.join(', ')}`);
    }
  });

  test('🔴 every builder calls anchoredRunRead, or is on the exempt list with its reason', () => {
    const unanchored = candidates
      .filter(({ rel, code: c }) => !EXEMPT.has(rel) && !/\banchoredRunRead\s*\(\{/.test(c))
      .map(({ rel }) => rel);
    assert.deepEqual(unanchored, [], 'a run-history reader that grades freshness must read through tooling/ci/anchored-run-read.mjs');
  });

  test('the exempt list is LIVE — each entry still builds a run URL and still does not read through the shared reader', () => {
    for (const [rel, why] of EXEMPT) {
      const hit = candidates.find((c) => c.rel === rel);
      assert.ok(hit, `${rel}: no longer builds a run-history URL; remove its exemption (${why})`);
      assert.doesNotMatch(hit.code, /\banchoredRunRead\s*\(/, `${rel}: now reads through the shared reader; remove its exemption`);
    }
  });

  test('the exempt list only SHRINKS — two entries at 403d7716', () => {
    assert.ok(EXEMPT.size <= 2, `the exempt list grew to ${EXEMPT.size}; adopt the shared reader instead`);
  });
});
