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
  CROSS_READ_AFTER_MS,
  STALE_PAGE,
  judgeRunPage,
  selfRunFloor,
  headAnchor,
  pushTriggersBranch,
  needsCrossRead,
  crossReadTerm,
  maxRunId,
  runQueryPredicate,
  repoWideWindow,
  spliceFreshWindows,
  repoWideRunsPath,
} from '../run-page-anchor.mjs';
import { anchoredBranchPage, anchoredPage, anchoredNewest, gapCheckedScan, redSincePair, selectRuns, classifyRunHistoryAnswer } from '../assert-ops-register.mjs';
import * as alertGuard from '../assert-alert-disposition.mjs';
import * as platformGuard from '../assert-platform-proof-fresh.mjs';
import * as e2eGuard from '../assert-e2e-proof-fresh.mjs';
import {
  STALE_PAGE_CARRIED,
  anchoredRunRead,
  describeRead,
  fixtureReads,
  unionById,
  crossReadUrl,
  queryOf,
} from '../anchored-run-read.mjs';
import { CouldNotLook, READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';
import { stripSourceComments } from '../text-reductions.mjs';
// The platform Worker's copy of this rule — see "THE WORKER COPY" at the end.
// Node 24 strips its types; the file's one other import is `import type`.
import * as workerCopy from '../../../services/platform/src/ops-watchdog.ts';

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

/** The I/O anchoredBranchPage needs, served from fixtures. `cross` answers
 *  every repository-wide list; `lists` (⏱ 2026-09-28) answers each one by its
 *  branch (`null` = the unfiltered list) with a whole body. */
function io({ env = C1_ENV, nowMs = C1_NOW, cross = [], head = null, lists = null, branchless = null } = {}) {
  const asked = [];
  const notes = [];
  return {
    asked,
    notes,
    env,
    nowMs,
    readWorkflow: (f) => workflow(f),
    branchHead: async () => head,
    repoRunsPage: async (repo, branch) => {
      asked.push(`${repo}|${branch}`);
      if (lists) return lists[String(branch)];
      return { workflow_runs: cross };
    },
    note: (line) => notes.push(line),
    ...(branchless
      ? {
          branchlessPage: async (repo, wf, k) => {
            asked.push(`${repo}|${wf}|branchless|${k}`);
            return branchless[k] ?? { workflow_runs: [] };
          },
        }
      : {}),
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
    // ⏱ 2026-09-28 — VERDICT CHANGED: this THREW before; the page is now REPLACED
    // by the fresh window. The window holds only 35362000000 and reaches back no
    // further, so a question it cannot answer is still UNREAD (the gap below).
    const i = io({ env: {}, cross: [C1_1444] });
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C1_STALE, false, i);
    assert.deepEqual(got.runs.map((r) => r.id), [35362000000]);
    assert.equal(got.pageFull, true, 'a window with a gap below it is a truncated answer');
    assert.equal(got.gapBelow.floorId, 35362000000);
    assert.deepEqual(i.asked, [`${REPO}|main`, `${REPO}|null`]);
    assert.match(i.notes[0], /^⬜ {2}STALE PAGE, A FRESH WINDOW CARRIED THE READ: stale page — the run history of ops-watch\.yml on main ends at run 33228655039, but .*answered run 35362000000/);
    assert.throws(() => gapCheckedScan([], true, got.gapBelow), /^Error: stale page — .*reaches back only to run 35362000000/);
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
    assert.deepEqual(s.asked, [
      C2_URL,
      C2_URL.replace('per_page=100', 'created=%3E%3D2026-08-17T06%3A55%3A35Z&per_page=10'),
      `https://api.github.com${repoWideRunsPath(REPO)}`,
    ]);
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
    assert.deepEqual(s.asked, [
      C4_E2E_URL,
      C4_E2E_URL.replace('per_page=100', 'created=%3E%3D2026-09-19T06%3A41%3A00Z&per_page=10'),
      C4_E2E_URL.replace('branch=main&', ''),
    ]);
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
        '2 row(s), newest 35962444367 · the same query without `branch=`: 2 row(s), newest 35962444367 · the page is PROVEN STALE',
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
    assert.deepEqual(fixtureReads([1]), { page: [1], cross: null, repoWide: null });
    assert.deepEqual(fixtureReads({ page: [1], cross: [2] }), { page: [1], cross: [2], repoWide: null });
    assert.deepEqual(fixtureReads({ page: [1] }), { page: [1], cross: null, repoWide: null });
    assert.deepEqual(fixtureReads({ page: [1], repoWide: { workflow_runs: [3] } }), { page: [1], cross: null, repoWide: { workflow_runs: [3] } });
    assert.throws(() => fixtureReads({ page: [1], repoWide: [3] }), /`repoWide` that is not a run-list body/);
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

  test('🔴 queryOf strips GitHub\'s host only when a `/` follows it — a lookalike host is printed whole', () => {
    assert.equal(queryOf('https://api.github.com/repos/o/r/actions/runs?per_page=100'), '/repos/o/r/actions/runs?per_page=100');
    assert.equal(queryOf('https://api.github.com.example/repos/o/r/actions/runs'), 'https://api.github.com.example/repos/o/r/actions/runs');
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
  test('assert-ops-register.mjs — ⏱ 2026-09-28: BOTH fallbacks, the gap and the red-since pair are wired', () => {
    const c = code('tooling/ci/assert-ops-register.mjs');
    assert.match(c, /return anchoredNewest\(repo, workflow, qs, wide, reconcileRunReads\(/, 'ghNewestRun\'s fallback');
    assert.match(c, /return anchoredPage\(repo, q\.workflow, qs, runs, wide\.workflow_runs\.length >= UNIT_PAGE, what\);/, 'unitRunsPage\'s fallback');
    assert.match(c, /if \(hit \|\| !pageFull\) return hit; if \(gapBelow\) throw new StaleGap\(gapBelow\);/, 'ghNewestRun on the shared page');
    assert.match(c, /return \{ runs: selectRuns\(runs, \{ event, status \}\), all: runs, pageFull, gapBelow \};/, 'unitRunsPage passes the gap on, and the UNFILTERED page for the superseded read');
    // ⏱ 2026-10-02 — the loop moved into scanUnitRuns, its job-list read injected (#1115 review, finding 2); both halves are held.
    assert.match(c, /const c = unitConclusion\(q, run, await jobsFor\(run\.id\), wf, supersededBy\(run, all \?\? runs\)\);/, 'scanUnit reads a superseder off the unfiltered page (ops-watch 36445522260)');
    assert.match(c, /entries\.push\(\.\.\.await scanUnitRuns\(q, runs, all, wf, \(runId\) => jobsOfRun\(repo, runId, cache\), pages > 1 \? sinceMs : null\)\);/, 'scanUnit hands scanUnitRuns the unfiltered page and the live job-list read, page by page');
    // ⏱ 2026-10-03 · the scan now also returns how far back it read (ops-watch 37080147071); the gap check is unchanged.
    assert.match(c, /return \{ \.\.\.gapCheckedScan\(entries, pageFull, gapBelow\), reach \};/, 'scanUnit');
    assert.match(c, /const older = olderUnitPage\(await ghJson\(olderUnitPagePath\(repo, q\.workflow, q\.headBranch, next\.boundary\)\), /, 'scanUnit reads a deeper page only through the checked keyset read');
    assert.match(c, /return withQuotaCause\(await redSincePair\(newest\), repo, cache\);/, 'probeGithubRedSince');
    assert.match(c, /out\.push\(repoWideWindow\(await io\.repoRunsPage\(repo, null\), /, 'the unfiltered repository list is one of the windows');
    assert.match(c, /if \(branch && io\.branchlessPage\) out\.push\(repoWideWindow\(await io\.branchlessPage\(repo, workflow, 1\), /, 'the workflow\'s own branchless list is one of the windows');
    assert.match(c, /await Promise\.all\(\[branch \? branchlessPage\(repo, workflow, 1\) : ghJson\(path\(1\)\), ghJson\(path\(RUN_PAGE_WIDE\)\)\]\);/, 'branchPage\'s narrow read IS the branchless list');
    assert.match(c, /branchlessPage: \(repo, workflow, k\) => branchlessPage\(repo, workflow, k\),/, 'the live I/O hands it to the anchor');
  });
  test('assert-alert-disposition.mjs — ⏱ 2026-09-28: the firing history reads through the shared reader and grades the union', () => {
    const c = code('tooling/ci/assert-alert-disposition.mjs');
    assert.match(c, /import \{[^}]*\banchoredRunRead\b[^}]*\} from '\.\/anchored-run-read\.mjs';/);
    // ⏱ 2026-10-01: the query moved into firingHistoryUrl() and gained event=schedule (hand dispatches had pushed the
    // nightly run off an unfiltered page); the read still goes through the shared reader with that URL.
    assert.match(c, /const read = await anchoredRunRead\(\{ workflow: workflowFile, url: firingHistoryUrl\(repo, workflowFile\),/);
    assert.match(c, /return `\$\{GH_API\}\/repos\/\$\{repo\}\/actions\/workflows\/\$\{workflowFile\}\/runs\?event=schedule&per_page=\$\{RUN_SAMPLE\}`;/);
    assert.match(c, /return read\.union;/);
    assert.match(c, /runsByWorkflow\.set\(s\.workflow, await fetchRuns\(repo, /);
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
// assert-alert-disposition.mjs:512 and assert-ops-register.mjs (:2617, :2664,
// :3114). tooling/ops readers (triage-failed-runs, check-prod-provenance,
// redeploy-stranded) are OUTSIDE this case: they are ops-watch and operator
// tools, not the CI guards this class is about. The set below is DERIVED from
// the tree; the exempt list is SHRINK-ONLY and every entry must still be true.
// ─────────────────────────────────────────────────────────────────────────────
describe('E5 — every run-history URL builder under tooling/ci and extensions/scripts reads through the shared reader, or is a named exemption', () => {
  const RUNS_URL = /actions\/workflows\/[^'"`\n]*\/runs\b/;
  // ⏱ 2026-09-28: assert-alert-disposition.mjs left this list — it reads through
  // anchoredRunRead now — and assert-ops-register.mjs's two fallback reads are
  // anchored (anchoredNewest, anchoredPage), pinned by the wiring case below.
  const EXEMPT = new Map([
    ['tooling/ci/assert-ops-register.mjs', 'it reads MANY questions off ONE shared page per workflow, so it anchors through its own anchoredBranchPage / anchoredPage / anchoredNewest (run-page-anchor.mjs\'s windows and splice) rather than through the one-page reader'],
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

  test('the exempt list only SHRINKS — two entries at 403d7716, one since 2026-09-28', () => {
    assert.ok(EXEMPT.size <= 1, `the exempt list grew to ${EXEMPT.size}; adopt the shared reader instead`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (5) main CI 36409128416 attempt 2, 2026-09-28 ~10:35Z — THE CROSS-READ WAS
// STALE TOO. guards-platform went red on six duties, each reading ops-watch.yml's
// newest success as run 35422355154 (2026-09-19T04:52:07Z, 221.7h) while
// ops-watch had succeeded at 00:00Z, 01:04Z and 02:17Z. Measured by hand at
// ~10:40Z: `…/ops-watch.yml/runs?branch=main` → newest 2026-09-25 (stale);
// `…&status=success` → 02:17Z; the unfiltered `/actions/runs?per_page=100`
// filtered by name → 08:50Z. 35422355154 (the page's newest success, from the
// failing log), 36369228689 (the 02:17Z success) and 36399752579 (08:50Z) are
// the measured ids; the 2026-09-25 failure that tops the stale page and the
// other workflows' rows are SYNTHETIC, dated to the measured answers.
// ─────────────────────────────────────────────────────────────────────────────
const C5_NOW = Date.parse('2026-09-28T10:35:22Z');
const OW = '.github/workflows/ops-watch.yml';
const ow = (id, created, updated, conclusion, extra = {}) => run(id, created, updated, { event: 'schedule', status: 'completed', conclusion, path: OW, ...extra });
const C5_OK_0919 = ow(35422355154, '2026-09-19T04:40:00Z', '2026-09-19T04:52:07Z', 'success');
const C5_RED_0925 = ow(35950000001, '2026-09-25T06:00:00Z', '2026-09-25T06:10:00Z', 'failure');
const C5_OK_0217 = ow(36369228689, '2026-09-28T02:17:02Z', '2026-09-28T02:25:00Z', 'success');
const C5_RED_0850 = ow(36399752579, '2026-09-28T08:50:17Z', '2026-09-28T08:58:00Z', 'failure');
const other = (id, at) => run(id, at, at, { path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success' });
/** The STALE page of ops-watch.yml on main — every read of it agreed. */
const C5_PAGE = [C5_RED_0925, C5_OK_0919];
/** The repository-wide list on main, served from the SAME stale snapshot. */
const C5_BRANCH_LIST = { workflow_runs: [other(35950000500, '2026-09-25T07:00:00Z'), C5_RED_0925, other(35940000000, '2026-09-25T02:00:00Z')] };
/** The UNFILTERED repository list — fresh, its window from 36360000000 up. */
const C5_FRESH_LIST = { workflow_runs: [other(36409128416, '2026-09-28T10:20:00Z'), C5_RED_0850, C5_OK_0217, other(36360000000, '2026-09-28T01:00:00Z')] };
const C5_Q = { workflow: 'ops-watch.yml', headBranch: 'main', event: 'schedule' };
const ageH = (r) => ((C5_NOW - Date.parse(r.updated_at)) / 3_600_000).toFixed(1);

describe('(5) main CI 36409128416 — the stale page AND its stale cross-read, through assert-ops-register', () => {
  test('🟢 THE MEASURED ANSWERS — the unfiltered list carries 02:17Z: the duty reads FRESH, not 221.7h red', async () => {
    const i = io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: C5_FRESH_LIST } });
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, i);
    assert.deepEqual(i.asked, [`${REPO}|main`, `${REPO}|null`]);
    assert.deepEqual(got.runs.map((r) => r.id), [36399752579, 36369228689], 'the fresh window, newest first');
    assert.equal(got.gapBelow.floorId, 36360000000);
    const hit = selectRuns(got.runs, { event: 'schedule', status: 'success' })[0];
    const v = classifyRunHistoryAnswer(C5_Q, hit, REPO);
    assert.equal(hit.id, 36369228689);
    assert.equal(ageH(hit), '8.2', 'inside the 36h window, where the stale page read 221.7h');
    assert.equal(v.lastSuccessMs, Date.parse('2026-09-28T02:25:00Z'));
    assert.match(i.notes[0], /STALE PAGE, A FRESH WINDOW CARRIED THE READ: stale page — the run history of ops-watch\.yml on main ends at run 35950000001, but the repository-wide run list on main with the unfiltered repository-wide run list answered run 36399752579/);
    // …and a step/job unit scan that finds its success in the window is answered.
    assert.deepEqual(gapCheckedScan([{ run: C5_RED_0850, c: { verdict: 'failure' } }, { run: C5_OK_0217, c: { verdict: 'success' } }], true, got.gapBelow).entries.length, 2);
  });

  test('🔴 RED CONTROL — the SAME page with both lists agreeing that 35422355154 is the newest success: still 221.7h, the guard still bites', async () => {
    const agreeing = { workflow_runs: [C5_RED_0925, other(35940000000, '2026-09-25T02:00:00Z')] };
    const i = io({ env: {}, nowMs: C5_NOW, lists: { main: agreeing, null: agreeing } });
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, i);
    assert.equal(got.runs, C5_PAGE, 'not proven stale: the page itself, untouched');
    assert.equal(got.gapBelow, null);
    const hit = selectRuns(got.runs, { event: 'schedule', status: 'success' })[0];
    assert.equal(hit.id, 35422355154);
    assert.equal(ageH(hit), '221.7', 'the measured red, reproduced when nothing proves the page stale');
    assert.deepEqual(i.notes, []);
  });

  test('🔴 the fresh window holds no success: UNREAD (StaleGap), never FAILING — for the unit scan and for the whole-run read', async () => {
    const noOk = { workflow_runs: [other(36409128416, '2026-09-28T10:20:00Z'), C5_RED_0850, other(36360000000, '2026-09-28T01:00:00Z')] };
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: noOk } }));
    assert.throws(() => gapCheckedScan([{ run: C5_RED_0850, c: { verdict: 'failure' } }], true, got.gapBelow), /^Error: stale page — the run history of ops-watch\.yml on main ends at run 35950000001, and the fresh repository-wide window that proved it stale reaches back only to run 36360000000/);
    assert.equal(selectRuns(got.runs, { status: 'success' }).length, 0);
  });

  test('RED-SINCE — a fresh success above the gap needs no failure from it; with no fresh success the gap is UNREAD', async () => {
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: { workflow_runs: [C5_OK_0217, other(36360000000, '2026-09-28T01:00:00Z')] } } }));
    const newest = async (status) => {
      const hit = selectRuns(got.runs, { status })[0];
      if (!hit) gapCheckedScan([], true, got.gapBelow);
      return { id: hit.id, at: hit.updated_at };
    };
    assert.deepEqual(await redSincePair(newest), { success: { id: 36369228689, at: '2026-09-28T02:25:00Z' }, failure: null });
    const none = async () => gapCheckedScan([], true, got.gapBelow);
    await assert.rejects(redSincePair(none), /stale page/);
  });

  test('a window that reaches back to the page joins it: ONE contiguous history, the gap closed', async () => {
    const wide = { workflow_runs: [C5_OK_0217, C5_RED_0925, other(35940000000, '2026-09-25T02:00:00Z')] };
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: wide } }));
    assert.equal(got.gapBelow, null);
    assert.equal(got.pageFull, false, 'the page\'s own completeness is kept');
    assert.deepEqual(got.runs.map((r) => r.id), [36369228689, 35950000001, 35422355154]);
  });

  test('🟢 11:06Z — BOTH repository lists stale too; the workflow\'s own list WITHOUT branch= carries it, for free', async () => {
    // Measured 11:06Z: `/actions/runs?branch=main` ended 2026-09-20 like the page;
    // `ops-watch.yml/runs` (no branch) held 10:56Z. The unfiltered repository
    // list's ~9h window is modelled here as holding no ops-watch run at all.
    const stale = { workflow_runs: [C5_RED_0925] };
    const i = io({ env: {}, nowMs: C5_NOW, lists: { main: stale, null: { workflow_runs: [other(36409128416, '2026-09-28T10:20:00Z'), other(36400000000, '2026-09-28T02:00:00Z')] } }, branchless: { 1: { workflow_runs: [C5_RED_0850, C5_OK_0217, ow(36300000000, '2026-09-27T00:00:00Z', '2026-09-27T00:05:00Z', 'success', { head_branch: 'feat/x' })] } } });
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, i);
    assert.deepEqual(got.runs.map((r) => r.id), [36399752579, 36369228689], 'the feat/x run is not main\'s');
    assert.equal(selectRuns(got.runs, { event: 'schedule', status: 'success' })[0].id, 36369228689);
    assert.deepEqual(i.asked.slice(0, 3), [`${REPO}|ops-watch.yml|branchless|1`, `${REPO}|main`, `${REPO}|null`]);
    assert.match(i.notes[0], /ops-watch\.yml's own run list without `branch=`/);
  });

  test('a gap below the branchless window is closed by paging it deeper — stale days only, and at most BRANCHLESS_PAGES', async () => {
    // ci.yml's shape: the branchless listing is mostly OTHER branches' runs, so
    // 100 rows of it hold few runs on main and the window stays short of the page.
    const fill = (from, n) => Array.from({ length: n }, (_, j) => ow(from - j, '2026-09-27T00:00:00Z', '2026-09-27T00:05:00Z', 'failure', { head_branch: 'feat/x' }));
    const p1 = { workflow_runs: [C5_OK_0217, ...fill(36360000000, 99)] };
    const p2 = { workflow_runs: [...fill(36000000000, 99), C5_RED_0925] };
    const i = io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: { workflow_runs: [] } }, branchless: { 1: p1, 2: p2 } });
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, i);
    assert.equal(got.gapBelow, null, 'page 2 reaches 35950000001, the page\'s newest: one contiguous history');
    assert.ok(got.runs.some((r) => r.id === 35422355154), 'so the page\'s own older runs answer what the window cannot');
    assert.ok(i.asked.includes(`${REPO}|ops-watch.yml|branchless|2`));
    assert.ok(!i.asked.includes(`${REPO}|ops-watch.yml|branchless|3`), 'no page past the one that closed the gap');
    // RED CONTROL for the budget: a page that is NOT stale never pages at all.
    const j = io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: { workflow_runs: [] } }, branchless: { 1: { workflow_runs: [C5_RED_0925] } } });
    await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', C5_PAGE, false, j);
    assert.deepEqual(j.asked.filter((a) => a.includes('branchless')), [`${REPO}|ops-watch.yml|branchless|1`]);
  });

  test('🔴 11:20Z — the replacement is NEVER DEEPER than a fresh page: the newest 100, pageFull (the failure-ledger bootstrap regression)', async () => {
    // Measured: the joined history reached back 466.8h where a fresh page reaches
    // ~200h, and duty.failure-ledger (weekly, firstDue 2026-10-03) read "no
    // success in 466.8h" — a red no fresh page could produce.
    const main = (id) => ow(id, '2026-09-27T00:00:00Z', '2026-09-27T00:05:00Z', 'success');
    const fresh = Array.from({ length: 60 }, (_, j) => main(36399000000 - j));
    const stalePage = Array.from({ length: 100 }, (_, j) => main(35950000001 - j));
    const got = await anchoredBranchPage(REPO, 'ops-watch.yml', 'main', stalePage, true, io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: { workflow_runs: [] } }, branchless: { 1: { workflow_runs: [...fresh, ...stalePage.slice(0, 40)] } } }));
    assert.equal(got.runs.length, 100, 'the union held 160 runs; a fresh page holds 100');
    assert.equal(got.pageFull, true);
    assert.equal(got.gapBelow, null);
    assert.equal(Math.min(...got.runs.map((r) => r.id)), 35950000001 - 39, 'the newest 100 by id, and not one older');
  });

  test('a refused BRANCH-HEAD anchor is carried too when the fresh window holds HEAD\'s run; not, when it does not', async () => {
    const headRun = run(35340873024, '2026-09-18T11:41:25Z', '2026-09-18T11:48:02Z', { head_sha: C3_HEAD.sha, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml' });
    const carried = await anchoredBranchPage(REPO, 'ci.yml', 'main', C3_STALE, false, io({ env: {}, nowMs: C3_NOW, head: C3_HEAD, branchless: { 1: { workflow_runs: [headRun] } } }));
    assert.deepEqual(carried.runs.map((r) => r.id), [35340873024]);
    const without = { ...headRun, head_sha: '0'.repeat(40) };
    await assert.rejects(anchoredBranchPage(REPO, 'ci.yml', 'main', C3_STALE, false, io({ env: {}, nowMs: C3_NOW, head: C3_HEAD, branchless: { 1: { workflow_runs: [without] } } })), /^Error: stale page — .*553e814a/);
  });

  test('the targeted FALLBACK read is anchored the same way (ghNewestRun\'s anchoredNewest, unitRunsPage\'s anchoredPage)', async () => {
    const qs = 'event=schedule&branch=main&status=success';
    const i = io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: C5_FRESH_LIST } });
    const hit = await anchoredNewest(REPO, 'ops-watch.yml', qs, { workflow_runs: [C5_OK_0919] }, C5_OK_0919, 'x', i);
    assert.equal(hit.id, 36369228689);
    const page = await anchoredPage(REPO, 'ops-watch.yml', qs, [C5_OK_0919], true, 'x', io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: C5_FRESH_LIST } }));
    assert.deepEqual(page.runs.map((r) => r.id), [36369228689]);
    // RED CONTROL: nothing newer anywhere — the reconciled answer, untouched.
    const agreeing = { workflow_runs: [C5_OK_0919] };
    assert.equal(await anchoredNewest(REPO, 'ops-watch.yml', qs, agreeing, C5_OK_0919, 'x', io({ env: {}, nowMs: C5_NOW, lists: { main: agreeing, null: agreeing } })), C5_OK_0919);
    // A filter the window cannot apply is never guessed at: the page stands.
    const odd = await anchoredPage(REPO, 'ops-watch.yml', 'actor=someone', [C5_OK_0919], true, 'x', io({ env: {}, nowMs: C5_NOW, lists: { main: C5_BRANCH_LIST, null: C5_FRESH_LIST } }));
    assert.deepEqual(odd.runs, [C5_OK_0919]);
  });
});

describe('(5) the same answers, through the freshness readers (the second source in anchored-run-read.mjs)', () => {
  // e2e.yml, branch=main&status=success: a stale page, a creation-date cross-read
  // as stale as the page, and the unfiltered repository list carrying the green.
  const e2e = (id, at, extra = {}) => run(id, at, at, { event: 'schedule', status: 'completed', conclusion: 'success', path: '.github/workflows/e2e.yml', ...extra });
  const STALE = [e2e(35900000002, '2026-09-24T06:00:00Z')];
  const FRESH = e2e(36380000000, '2026-09-28T06:05:00Z');
  const routed = (second) => {
    const asked = [];
    return {
      asked,
      read: async (u) => {
        asked.push(u);
        if (!u.includes('branch=') && !u.includes('created=')) return second;
        return { workflow_runs: STALE };
      },
    };
  };

  test('🟢 the same query WITHOUT branch= carries the proof the stale cross-read could not: GREEN, and the carried line names it', async () => {
    const s = routed({ workflow_runs: [FRESH, e2e(36370000000, '2026-09-28T03:00:00Z', { head_branch: 'feat/x' }), ...STALE] });
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: s.read, nowMs: C5_NOW });
    assert.equal(s.asked.length, 3);
    assert.equal(s.asked[2], `https://api.github.com/repos/${REPO}/actions/workflows/e2e.yml/runs?status=success&per_page=100`);
    assert.equal(got.stale, true);
    assert.deepEqual(got.repoWide.runs.map((r) => r.id), [36380000000, 35900000002], 'the side-branch run is filtered out by the query\'s own branch=main');
    const v = e2eGuard.gradeRunHistory(got, C5_NOW);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.runId, 36380000000);
    assert.match(v.stalePageCarried, /the same query without `branch=` has 36380000000 \(updated_at 2026-09-28T06:05:00Z\) over 2 row\(s\)/);
  });

  test('a query with NO branch= asks the unfiltered repository list instead, filtered by path (the platform reader)', async () => {
    const asked = [];
    const bp = (id, at) => run(id, at, at, { event: 'schedule', status: 'completed', conclusion: 'success', path: '.github/workflows/build-platforms.yml' });
    const read = async (u) => {
      asked.push(u);
      if (u.includes('/actions/runs?')) return { workflow_runs: [other(36409128416, '2026-09-28T10:20:00Z'), bp(36390000000, '2026-09-28T07:00:00Z')] };
      return { workflow_runs: [bp(35900000003, '2026-09-20T07:00:00Z')] };
    };
    const got = await platformGuard.readRunHistory({ repo: REPO, read, nowMs: C5_NOW });
    assert.equal(asked[2], `https://api.github.com${repoWideRunsPath(REPO)}`);
    assert.deepEqual(got.repoWide.runs.map((r) => r.id), [36390000000], 'ci.yml\'s row is not build-platforms.yml\'s');
    assert.equal(platformGuard.gradeRunHistory(got, C5_NOW).ok, true);
  });

  test('🔴 RED CONTROL — every source agrees the green is 4 days old: the FINDING (exit 1), not coverage lost', async () => {
    const s = routed({ workflow_runs: [...STALE] });
    const got = await e2eGuard.readRunHistory({ repo: REPO, read: s.read, nowMs: C5_NOW });
    assert.equal(got.stale, false);
    const v = e2eGuard.gradeRunHistory(got, C5_NOW);
    assert.equal(v.ok, false);
    assert.notEqual(v.coverageLost, true);
    assert.match(v.reason, /^newest green scheduled run is 4\.2 days old, ceiling is 3/);
  });

  test('🔴 the repository list without a workflow_runs array is COULD NOT LOOK, never an empty window', async () => {
    await assert.rejects(e2eGuard.readRunHistory({ repo: REPO, read: routed({ message: 'x' }).read, nowMs: C5_NOW }), (e) => e instanceof CouldNotLook && /runs: the same query without `branch=` came back without a workflow_runs array/.test(e.message));
  });

  test('assert-alert-disposition grades the UNION: a stale page\'s red newest scheduled run no longer reads a cleared alarm as ACTIVE', () => {
    const page = [ow(35950000001, '2026-09-25T06:00:00Z', '2026-09-25T06:10:00Z', 'failure')];
    assert.equal(alertGuard.sourceHealth(page).state, 'red', 'the stale page alone');
    assert.equal(alertGuard.sourceHealth([...page, C5_OK_0217]).state, 'green', 'the union with the fresh window');
  });
});

describe('run-page-anchor — the 2026-09-28 pure edges', () => {
  test('runQueryPredicate applies branch, event, status (state vs conclusion) and head_sha; any other filter builds NO window', () => {
    const p = runQueryPredicate('/repos/o/r/actions/workflows/x.yml/runs?branch=main&event=schedule&status=success&per_page=100');
    assert.equal(p(ow(1, 'a', 'a', 'success')), true);
    assert.equal(p(ow(1, 'a', 'a', 'failure')), false);
    assert.equal(p(ow(1, 'a', 'a', 'success', { head_branch: 'dev' })), false);
    assert.equal(p(ow(1, 'a', 'a', 'success', { event: 'push' })), false);
    const done = runQueryPredicate('status=completed&branch=main');
    assert.equal(done(ow(1, 'a', 'a', 'failure')), true, '`completed` is a run STATE');
    assert.equal(done(ow(1, 'a', 'a', null, { status: 'in_progress' })), false);
    assert.equal(runQueryPredicate('per_page=5')(ow(1, 'a', 'a', 'success')), true);
    assert.equal(runQueryPredicate('actor=x&per_page=5'), null);
    assert.equal(runQueryPredicate('created=%3E%3D2026-01-01&per_page=5'), null);
    assert.equal(runQueryPredicate('branch=main&branch=dev'), null, 'a repeated filter is not guessed at');
  });

  test('repoWideWindow — the workflow\'s rows by path, and the id range of the WHOLE list', () => {
    const w = repoWideWindow(C5_FRESH_LIST, { workflow: 'ops-watch.yml', predicate: () => true });
    assert.deepEqual(w.runs.map((r) => r.id), [36399752579, 36369228689]);
    assert.equal(w.floorId, 36360000000);
    assert.equal(w.topId, 36409128416);
    assert.throws(() => repoWideWindow({}, { workflow: 'x.yml', predicate: () => true }), /without a workflow_runs array/);
  });

  test('spliceFreshWindows — windows chain downward only where they overlap; a staler window cannot bridge a gap', () => {
    const win = (floorId, topId, runs = []) => ({ floorId, topId, runs });
    const page = [run(100, 'a')];
    assert.equal(spliceFreshWindows(page, [win(300, 400), win(90, 310)]).gapBelow, null, '300..400 joined by 90..310 reaches the page');
    assert.equal(spliceFreshWindows(page, [win(300, 400), win(90, 250)]).gapBelow.floorId, 300, '90..250 does not reach 300');
    assert.equal(spliceFreshWindows(page, [win(100, 400, [run(150, 'b')])]).gapBelow, null, 'a window whose floor IS the page top joins it');
    assert.deepEqual(spliceFreshWindows(page, [win(100, 400, [run(150, 'b')])]).runs.map((r) => r.id).sort(), [100, 150]);
    assert.throws(() => spliceFreshWindows(page, []), /^Error: stale page — .*no fresh window came back/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-28 · THE WORKER COPY — one rule, two copies, held to the same answers.
//
// services/platform/src/ops-watchdog.ts cannot import this module (a Worker has
// no tooling/ at run time), so it keeps its own copy of the two anchors that
// apply off-runner and of the splice: `judgeMainPage` is `judgeRunPage`'s HEAD
// and CROSS-READ anchors (its refusal's `beyond` is the run this module's `why`
// names), and `spliceCrossRead` is `spliceFreshWindows` for its one window, the
// creation-date cross-read. MEASURED: Ops watch 36464466131 (18:20Z) went red on
// the Worker's row "main:ops-watch.yml: ok=0, unreadable: stale page: the page
// ends at run 35477612056 but a cross-read by creation date answered run
// 36455387316" — the copy had the anchor but not the splice, so the answer the
// cross-read held was thrown away. Every case below is asked of BOTH copies.
// This suite is guard-meta's, which no path filter skips, so a change to either
// copy alone meets it on its own pull request.
// ─────────────────────────────────────────────────────────────────────────────
describe('THE WORKER COPY — services/platform/src/ops-watchdog.ts answers every case as this module does', () => {
  const W_NOW = Date.parse('2026-09-28T18:00:00Z');
  const at = (ms) => new Date(W_NOW - ms).toISOString();
  const wr = (id, updated, extra = {}) => run(id, updated, updated, { status: 'completed', conclusion: 'success', ...extra });
  const PAGE = [wr(35477612056, '2026-09-20T00:02:29Z'), wr(35400000000, '2026-09-19T00:00:00Z')];
  const R_1703 = wr(36455387316, '2026-09-28T17:06:07Z');
  const R_1559 = wr(36447758185, '2026-09-28T16:03:11Z', { conclusion: 'failure' });
  const CASES = [
    ['the measured 18:00Z cross-read: newer runs, a gap below them', PAGE, [R_1703, R_1559]],
    ['two proving runs listed oldest first: the NEWEST is the one named', PAGE, [R_1559, R_1703]],
    ['ONE-WAY: a cross-read staler than the page', PAGE, [PAGE[1]]],
    ['a cross-read holding only the page\'s own newest run', PAGE, [PAGE[0]]],
    ['an empty cross-read', PAGE, []],
    ['RACE: a newer run exactly at the edge of the race window', PAGE, [wr(36455387316, at(ANCHOR_RACE_MS))]],
    ['RACE: one millisecond past it', PAGE, [wr(36455387316, at(ANCHOR_RACE_MS + 1))]],
    ['RACE: a racing newest run beside a proving older one — the racer does not prove, but it is in the window', PAGE, [wr(36455387316, at(1_000)), R_1559]],
    ['an undated newer run proves the page behind', PAGE, [{ id: 36455387316 }]],
    ['a window reaching back to the page top is ONE history with it', PAGE, [{ ...R_1703, status: 'in_progress', conclusion: null }, PAGE[0]]],
    ['a window whose floor is below the page top joins it too', PAGE, [R_1703, wr(35450000000, '2026-09-19T12:00:00Z')]],
    ['a run read twice keeps its later updated_at', PAGE, [{ ...R_1703, status: 'in_progress', updated_at: '2026-09-28T17:03:10Z' }, R_1703]],
    ['rows with no usable id are ignored by both', PAGE, [{ id: 0 }, { id: 'x' }, { id: 1.5 }, R_1703]],
    ['an empty page is behind any run', [], [R_1703]],
  ];
  const shape = (runs) => runs.map((r) => `${r.id}|${r.updated_at ?? ''}|${r.status ?? ''}`).sort();

  test('the constants are the same numbers', () => {
    assert.equal(workerCopy.OPS_ANCHOR_RACE_MS, ANCHOR_RACE_MS);
    assert.equal(workerCopy.OPS_HEAD_RUN_GRACE_MS, HEAD_RUN_GRACE_MS);
    assert.equal(workerCopy.OPS_CROSS_READ_AFTER_MS, CROSS_READ_AFTER_MS);
  });

  test('🔴 the CROSS-READ anchor: the same verdict, and the same proving run, on every case', () => {
    for (const [name, page, cross] of CASES) {
      const mine = judgeRunPage(page, { cross: { runs: cross }, nowMs: W_NOW });
      const theirs = workerCopy.judgeMainPage(page, { cross, nowMs: W_NOW });
      assert.equal(theirs.ok, mine.ok, name);
      if (!mine.ok) assert.equal(theirs.beyond?.id, Number(/answered run (\d+)/.exec(mine.why)?.[1]), name);
    }
  });

  test('🔴 the SPLICE: a page proven stale becomes the same fresh page, with the same gap, on every case', () => {
    let spliced = 0;
    for (const [name, page, cross] of CASES) {
      if (judgeRunPage(page, { cross: { runs: cross }, nowMs: W_NOW }).ok) continue;
      spliced++;
      const mine = spliceFreshWindows(page, [repoWideWindow({ workflow_runs: cross }, { predicate: () => true })]);
      const theirs = workerCopy.spliceCrossRead(page, cross);
      assert.deepEqual(shape(theirs.runs), shape(mine.runs), name);
      assert.equal(theirs.gapBelow, mine.gapBelow ? mine.gapBelow.floorId : null, name);
    }
    assert.equal(spliced, 10, 'anti-vacuity: ten of the fourteen cases are proven stale and spliced');
  });

  test('anti-vacuity — the table reaches every branch: fresh and stale verdicts, gapped and contiguous splices', () => {
    const verdicts = CASES.map(([, page, cross]) => judgeRunPage(page, { cross: { runs: cross }, nowMs: W_NOW }).ok);
    assert.ok(verdicts.includes(true) && verdicts.includes(false));
    const gaps = CASES.filter(([, page, cross]) => !judgeRunPage(page, { cross: { runs: cross }, nowMs: W_NOW }).ok)
      .map(([, page, cross]) => spliceFreshWindows(page, [repoWideWindow({ workflow_runs: cross }, { predicate: () => true })]).gapBelow);
    assert.ok(gaps.some((g) => g === null) && gaps.some((g) => g !== null));
  });

  test('🔴 the BRANCH HEAD anchor: the same verdict on a page with, and without, main HEAD\'s run; the same headAnchor edges', () => {
    const SHA = '553e814a395420fecf637c95816b751aafcff1d3';
    for (const page of [[wr(1, at(0), { head_sha: SHA })], [wr(1, at(0), { head_sha: 'f'.repeat(40) })], []]) {
      assert.equal(workerCopy.judgeMainPage(page, { headSha: SHA, nowMs: W_NOW }).ok, judgeRunPage(page, { head: { sha: SHA, why: 'HEAD' }, nowMs: W_NOW }).ok);
    }
    const body = (ms, message = 'm') => ({ sha: SHA, commit: { message, committer: { date: at(ms) } } });
    for (const b of [body(HEAD_RUN_GRACE_MS), body(HEAD_RUN_GRACE_MS - 1), body(HEAD_RUN_GRACE_MS * 10, 'docs [skip ci]')]) {
      assert.equal(workerCopy.mainHeadAnchor(b, W_NOW), headAnchor(b, W_NOW)?.sha ?? null);
    }
    assert.throws(() => workerCopy.mainHeadAnchor({ sha: 'nope', commit: {} }, W_NOW), /40-hex sha/);
    assert.throws(() => headAnchor({ sha: 'nope', commit: {} }, W_NOW), /40-hex sha/);
  });
});
