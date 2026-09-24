// ─────────────────────────────────────────────────────────────────────────────
// e2e-proof-fresh.test.mjs — the nightly freshness guard must be able to FAIL.
//
// [pipeline N-6 / F-10] Built to the same shape as platform-proof-fresh.test.mjs:
// the DECISION half is exercised for real through a fixture run-list and a fixed
// clock, so every branch below runs the same code CI runs, with no network and no
// stubbing of the thing under test.
//
// The coverage self-check is exercised against a REAL MUTATED TREE — a temp copy
// of e2e.yml with its schedule removed, commented out, made weekly, or with the
// suite ripped out of it — never a hand-written fixture. assert-seams-wired.mjs
// shipped broken while all six of its fixture tests passed, because a fixture you
// write encodes the same misunderstanding as the guard you write.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { READ_ATTEMPTS, RETRY_CEILING_MS } from '../../ops/bounded-retry.mjs';

import {
  evaluateFreshness,
  assertWatchedWorkflowIntact,
  isDailyCron,
  cronExpressions,
  buildRunsUrl,
  REQUIRED_WORK,
  RUNS_PAGE_SIZE,
  evaluateTimer,
  assertTimerRecordDeclared,
  TIMER_JOB,
  TIMER_TARGET,
  TIMER_TABLE,
} from '../assert-e2e-proof-fresh.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-e2e-proof-fresh.mjs');
const NOW = '2026-08-02T12:00:00Z';
const NOW_MS = Date.parse(NOW);

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-n6-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// 🔴 EVERY CLI RUN SUPPLIES BOTH RECORDS, AND THE DEFAULT TIMER ROW IS FRESH.
// Since 2026-09-06 the guard grades a run list AND a D1 timer row and refuses a
// half-fixture outright, so a test about the run-list limb must not silently
// become a test about a missing heartbeat. The timer cases below pass their own
// `--timer-file` through `args`, and this helper stands aside when they do.
const timerRow = (opts = {}) => ({
  job: opts.job ?? 'github_dispatch',
  target: opts.target ?? 'Nikatru_Platform_Public/e2e.yml',
  ok: opts.ok ?? 1,
  detail: opts.detail ?? 'dispatched',
  ran_at: opts.ran_at ?? daysAgo(opts.days ?? 0),
});
const timerFixture = (name, rows) => {
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(rows));
  return p;
};
const run = (name, ...args) => {
  const file = join(TMP, name);
  const timer = args.includes('--timer-file') ? [] : ['--timer-file', timerFixture(`timer-for-${name}`, [timerRow()])];
  return spawnSync(process.execPath, [GUARD, '--runs-file', file, '--now', NOW, ...timer, ...args], {
    cwd: REPO,
    encoding: 'utf8',
  });
};
const fixture = (name, runs) => {
  writeFileSync(join(TMP, name), JSON.stringify(runs));
  return name;
};
const daysAgo = (n) => new Date(NOW_MS - n * 86_400_000).toISOString();

describe('evaluateFreshness — the decision', () => {
  test('a run inside the ceiling passes', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(1) }], NOW_MS);
    assert.equal(v.ok, true);
    assert.ok(Math.abs(v.ageDays - 1) < 0.01);
  });

  test('a run past the ceiling FAILS — this is the whole requirement', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(4) }], NOW_MS);
    assert.equal(v.ok, false);
    assert.match(v.reason, /4\.0 days old/);
  });

  test('exactly at the ceiling passes — the boundary is inclusive and pinned at 3', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(3) }], NOW_MS);
    assert.equal(v.ok, true);
  });

  test('ONE tolerated bad night — the derivation`s middle term, pinned', () => {
    // The ceiling is 1 (cadence) + 1 (a tolerated bad night) + 1 (jitter margin).
    // If someone re-derives it down to the bare cadence, a single red nightly
    // starts blocking every merge in the repo, which is how guards get deleted.
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(2) }], NOW_MS);
    assert.equal(v.ok, true);
  });

  test('failed runs do not count as proof, however recent', () => {
    const v = evaluateFreshness(
      [
        { id: 1, conclusion: 'failure', head_branch: 'main', event: 'schedule', updated_at: daysAgo(0) },
        { id: 2, conclusion: 'cancelled', head_branch: 'main', event: 'schedule', updated_at: daysAgo(0) },
      ],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /no successful/);
  });

  test('THE REAL 2026-08-01 DEFECT, AT THE RECORD THAT NOW CARRIES IT', () => {
    // Not hypothetical. On 2026-08-01, mid-outage, two `workflow_dispatch` runs
    // went green while every scheduled run was red, and until 2026-09-06 this
    // guard refused them HERE, in the run list.
    //
    // 🔴 IT CANNOT REFUSE THEM HERE ANY MORE, AND THAT IS THE CHANGE, NOT A
    // REGRESSION: the Cloudflare Worker dispatches this workflow, so a
    // legitimate nightly IS a `workflow_dispatch` now. The claim those two runs
    // must not satisfy moved to a record no hand-press can write. This test
    // therefore asserts BOTH halves of the split at once — that the outcome limb
    // accepts them, and that the duty is still not fresh.
    const runs = [
      { id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(7) },
      { id: 2, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(1) },
      { id: 3, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(1) },
    ];
    assert.equal(evaluateFreshness(runs, NOW_MS).ok, true, 'a green run on main is a green run on main');
    const t = evaluateTimer([{ job: TIMER_JOB, target: TIMER_TARGET, ok: 1, ran_at: daysAgo(7) }], NOW_MS);
    assert.equal(t.ok, false, 'the dispatcher has not fired in seven days — the duty is not fresh');
    assert.match(t.reason, /7\.0 days old/);
  });

  test('A GREEN RUN ON A SIDE BRANCH IS NOT THE NIGHTLY — the guarantee the event filter used to carry for free', () => {
    // GitHub fires schedules only on the default branch, so the old event filter
    // was ALSO a branch filter and nobody had to say so. Dropping it without
    // naming the branch would have widened this guard to "a green run anywhere",
    // and that is not hypothetical: measured 2026-09-04, this workflow held four
    // green runs on `feat/e2e-login-via-magic-link`.
    const v = evaluateFreshness(
      [{ id: 1, conclusion: 'success', head_branch: 'feat/e2e-login-via-magic-link', event: 'workflow_dispatch', updated_at: daysAgo(0) }],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.equal(v.offBranchCount, 1);
    assert.match(v.reason, /NONE has `head_branch: main`/);
  });

  test('a row carrying NO branch at all is DROPPED, not trusted', () => {
    // A missing field is not a matching one. If the API ever stops sending
    // `head_branch`, this guard must go red rather than certify every row.
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(0) }], NOW_MS);
    assert.equal(v.ok, false);
  });

  test('a green run on main passes WHATEVER FIRED IT — schedule and dispatch alike', () => {
    // The Worker dispatches this workflow, so refusing `workflow_dispatch` here
    // would refuse the real nightly. e2e.yml keeps its `schedule:` slot as the
    // rollback, so both events must satisfy the OUTCOME limb.
    for (const event of ['schedule', 'workflow_dispatch']) {
      const v = evaluateFreshness([{ id: 1, conclusion: 'success', head_branch: 'main', event, updated_at: daysAgo(1) }], NOW_MS);
      assert.equal(v.ok, true, `event ${event} should satisfy the outcome limb`);
    }
  });

  test('an unreadable answer is a failure, never a pass', () => {
    assert.equal(evaluateFreshness(null, NOW_MS).ok, false);
    assert.equal(evaluateFreshness(undefined, NOW_MS).ok, false);
    assert.equal(evaluateFreshness('{}', NOW_MS).ok, false);
  });

  test('an unparseable timestamp fails rather than reading as epoch 0', () => {
    const v = evaluateFreshness(
      [{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: 'yesterday-ish' }],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /unparseable timestamp/);
  });

  test('an empty history fails', () => {
    assert.equal(evaluateFreshness([], NOW_MS).ok, false);
  });
});

describe('isDailyCron — the derivation`s own check', () => {
  test('the real cron in e2e.yml is daily', () => {
    const yaml = readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8');
    const crons = cronExpressions(yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'));
    assert.ok(crons.length > 0, 'e2e.yml declares no cron at all');
    assert.ok(crons.some(isDailyCron), `no daily cron among ${JSON.stringify(crons)}`);
  });

  test('weekly, monthly and malformed crons are NOT daily', () => {
    assert.equal(isDailyCron('17 3 * * 1'), false); // Mondays
    assert.equal(isDailyCron('17 3 1 * *'), false); // monthly
    assert.equal(isDailyCron('17 3 * 6 *'), false); // June only
    assert.equal(isDailyCron('17 3 * *'), false); // four fields
    assert.equal(isDailyCron(''), false);
  });

  test('the hour and minute are irrelevant to a DAILY cadence', () => {
    assert.equal(isDailyCron('17 3 * * *'), true);
    assert.equal(isDailyCron('0 0 * * *'), true);
    assert.equal(isDailyCron('*/5 * * * *'), true); // more often than daily is still <= 1 day
  });
});

describe('the guard as CI runs it', () => {
  test('fresh proof exits 0 and names the run', () => {
    const f = fixture('fresh.json', [{ id: 999, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nightly golden-path proof fresh/);
    assert.match(r.stdout, /999/);
  });

  test('stale proof exits 1 and REFUSES to recommend raising the ceiling', () => {
    const f = fixture('stale.json', [{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(30) }]);
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not fresh/);
    assert.match(r.stderr, /THE REMEDY IS NOT TO RAISE MAX_AGE_DAYS/);
    // …and it must point at the signals PR #111 added, not at the raw log.
    assert.match(r.stderr, /e2e-screenshots/);
  });

  test('a hand-press cannot mask a stopped dispatcher, through the CLI too', () => {
    // The 2026-08-01 shape, one record along: the run list is spotless — a green
    // run on main from today — and the duty is still not fresh, because the
    // thing that has stopped is the alarm clock.
    const f = fixture('masked.json', [{ id: 2, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) }]);
    const t = timerFixture('masked-timer.json', [timerRow({ days: 60 })]);
    const r = run(f, '--timer-file', t);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /60\.0 days old/);
    assert.match(r.stderr, /A HAND-PRESSED RUN CANNOT SATISFY THIS EITHER/);
  });

  test('a missing fixture file is COVERAGE LOST (2), never a silent pass', () => {
    // A fixture that cannot be read is a record that was not read, which is the
    // same fact as a missing token — so it takes the same exit code. It used to
    // exit 1 alongside a genuinely stale proof; those are different findings and
    // now say so.
    const r = run('does-not-exist.json');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /could not read fixture/);
  });

  test('offline mode announces itself so it cannot hide in a CI log', () => {
    const f = fixture('announce.json', [{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });

  test('a bad --now is rejected, not silently treated as epoch 0', () => {
    const f = fixture('now.json', [{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = spawnSync(process.execPath, [GUARD, '--runs-file', join(TMP, f), '--now', 'not-a-date'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a parseable date/);
  });

  test('NO TOKEN IS COVERAGE LOST (2), NOT A FAILURE (1) AND NEVER A PASS', () => {
    // Without --runs-file the guard must reach BOTH networks, and with every
    // credential stripped it must say it could not read either record. 2, not 1:
    // nothing was graded, so the verdict is unknown rather than bad. This is why
    // the guard is expected to be red in a local guard sweep.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8', env });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /fails closed/);
    assert.match(r.stderr, /CLOUDFLARE_API_TOKEN/);
    assert.match(r.stderr, /COVERAGE LOST/);
  });

  test('HALF A FIXTURE IS COVERAGE LOST — one record offline and the other left unread', () => {
    const f = fixture('half.json', [{ id: 1, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = spawnSync(process.execPath, [GUARD, '--runs-file', join(TMP, f), '--now', NOW], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /Supply both, or neither/);
  });
});

describe('coverage self-check — against a MUTATED REAL workflow, not a fixture', () => {
  const mutate = (transform) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-n6-wf-'));
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    const real = readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8');
    writeFileSync(join(dir, 'e2e.yml'), transform(real));
    return root;
  };
  const withRoot = (transform, fn) => {
    const root = mutate(transform);
    try {
      fn(assertWatchedWorkflowIntact(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test('the real workflow, unmodified, passes', () => {
    withRoot((s) => s, (v) => assert.equal(v, null));
  });

  test('workflow deleted -> COVERAGE LOST, not a silent pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-n6-empty-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    assert.match(assertWatchedWorkflowIntact(root), /COVERAGE LOST.*does not exist/s);
    rmSync(root, { recursive: true, force: true });
  });

  test('schedule removed -> caught at the CAUSE, not 3 days later at the symptom', () => {
    withRoot(
      (s) => s.replace(/\n\s+schedule:\n\s+- cron:[^\n]*/, ''),
      (v) => assert.match(v, /declares no 'schedule:' trigger/),
    );
  });

  test('schedule COMMENTED OUT is not mistaken for a live one', () => {
    // This workflow's header is 40 lines of prose that NAMES the cron, so a raw
    // scan would resolve against the comment describing the schedule.
    withRoot(
      (s) => s.replace(/(\n\s+)(schedule:)/, '$1# $2').replace(/(\n\s+)(- cron:)/, '$1# $2'),
      (v) => assert.match(v, /COVERAGE LOST/),
    );
  });

  test('THE DERIVATION IS ENFORCED — a weekly cron is COVERAGE LOST, not a silent pass', () => {
    // MAX_AGE_DAYS = 3 is derived from a ONE-DAY cadence. Against a weekly cron
    // it is an unreachable target and the tempting repair is to raise it, which
    // is exactly the invented constant [plan R-9] forbids.
    withRoot(
      (s) => s.replace(/cron:\s*'17 3 \* \* \*'/, "cron: '17 3 * * 1'"),
      (v) => {
        assert.match(v, /no longer daily/);
        assert.match(v, /DERIVED from a one-day cadence/);
      },
    );
  });

  test('a monthly cron is caught by the same limb', () => {
    withRoot(
      (s) => s.replace(/cron:\s*'17 3 \* \* \*'/, "cron: '17 3 1 * *'"),
      (v) => assert.match(v, /no longer daily/),
    );
  });

  test('THE TIMER IS NOT THE WORK — dropping `flutter drive` is COVERAGE LOST', () => {
    // The hole assert-platform-proof-fresh.mjs had until 2026-07-27: it checked
    // that a cron existed and never looked at what the workflow did.
    withRoot(
      (s) => s.replace(/flutter drive/g, 'echo skipping'),
      (v) => assert.match(v, /no longer contains: flutter drive/),
    );
  });

  test('pointing the driver at a DIFFERENT target is COVERAGE LOST', () => {
    withRoot(
      (s) => s.replace(/integration_test\/app_test\.dart/g, 'integration_test/nothing_test.dart'),
      (v) => assert.match(v, /integration_test\/app_test\.dart/),
    );
  });

  test('dropping ANY harness verification step is COVERAGE LOST', () => {
    // Without the live-D1 read-back a green run proves the UI moved and proves
    // nothing landed; without the erasure audit it proves the app SAID an
    // account was deleted. Both are `tooling/e2e/…` entries in REQUIRED_WORK.
    //
    // 🔄 THIS ITERATES REQUIRED_WORK INSTEAD OF INDEXING IT. It used to read
    // `REQUIRED_WORK[2]` — one hand-picked index — so when a fourth entry was
    // added on 2026-08-08 the new step was in the guard and covered by nothing,
    // and the suite would have gone on reporting the same reassuring green. A
    // hand-picked index is a floor with one rung; a filter over the list means a
    // FUTURE entry acquires this test by existing.
    //
    // ⚠️ The paths are taken from REQUIRED_WORK rather than written out, and that
    // is not style. assert-guard-coverage.mjs counts a workflow-invoked script
    // outside tooling/ci as "covered" when its BASENAME appears anywhere in an
    // executable line of the suite — a weak proxy its own header admits to. Those
    // scripts are deliberately listed in NO_NEGATIVE_TEST_NEEDED because the live
    // nightly exercises them and no fixture can; spelling their names here would
    // flip them to "covered" on the strength of these strings alone and quietly
    // retire an honest exemption. Inflating apparent coverage is the one thing
    // this repo deletes on sight.
    const harnessSteps = REQUIRED_WORK.filter((w) => w.startsWith('tooling/e2e/'));
    assert.ok(
      harnessSteps.length >= 2,
      `REQUIRED_WORK names ${harnessSteps.length} harness step(s); this test would be checking almost nothing`,
    );
    for (const verifyStep of harnessSteps) {
      withRoot(
        (s) => s.split(verifyStep).join('true'),
        (v) => assert.ok(v && v.includes(verifyStep), `expected COVERAGE LOST naming ${verifyStep}, got: ${v}`),
      );
    }
  });

  test('🔴 the work check reads the BODY, never the prose describing it', () => {
    // The r2_buckets trap: a scan satisfied by the COMMENT explaining the thing
    // rather than by the thing. Here EVERY work string is deleted from every real
    // step and re-stated in a comment, with the schedule left intact.
    //
    // ⚠️ THIS TEST WAS WRONG WHEN FIRST WRITTEN, and that is recorded here rather
    // than quietly patched. It originally stripped EVERY non-comment line, which
    // also removed `schedule:` — so the guard returned COVERAGE LOST from the
    // SCHEDULE limb and the test went green while the work limb was never
    // reached. It therefore passed identically against a guard that scanned raw
    // YAML, and the mutation "scan raw YAML instead of comment-stripped" went
    // UNCAUGHT through the whole first mutation round. A fixture you write
    // encodes the same misunderstanding as the guard you write; only mutating
    // the real thing found it.
    withRoot(
      (s) => {
        const body = s
          .split('\n')
          .filter((l) => /^\s*#/.test(l) || !REQUIRED_WORK.some((w) => l.includes(w)))
          .join('\n');
        // Built from REQUIRED_WORK, so the prose names them all exactly — and
        // so this file never spells the harness path out (see the note on the
        // live-D1 test below).
        return [`# This workflow used to run: ${REQUIRED_WORK.join(' , ')}`, body].join('\n');
      },
      (v) => assert.match(v, /no longer contains/),
    );
  });
});

describe('the run window — `per_page` sizes a window over SUCCESSES, not over runs', () => {
  // 🔴 THE DEFECT THESE TESTS EXIST FOR LIVES IN THE FETCH, NOT IN THE DECISION.
  // `evaluateFreshness` can only ever see the rows the query left it, so a test
  // that hands it a whole history proves nothing about the window. Everything
  // below therefore models the truncation explicitly: build the history the API
  // holds, then hand over only the page the query would have asked for.

  // The exact shape the cliff has: a burst of green hand-presses sitting ON TOP
  // of the newest green SCHEDULED run, newest first, as the API returns them.
  // `deep` is the 1-based position of that scheduled success.
  const historyWith = (deep, length = 140) =>
    Array.from({ length }, (_, i) => ({
      id: 1000 + i,
      conclusion: 'success',
      // 🔄 RE-KEYED 2026-09-06 FROM `event` TO `head_branch`, SHAPE UNCHANGED.
      // The cliff these tests model is "the one row that can satisfy the guard
      // sits below the end of the page". Until today that row was the only
      // `schedule` row; today it is the only row on `main`. Same truncation,
      // same verdict, one discriminator — which is the point: the window
      // reasoning was never about the event, it was about what the page hides.
      event: 'workflow_dispatch',
      head_branch: i === deep - 1 ? 'main' : 'feat/e2e-login-via-magic-link',
      updated_at: daysAgo(i === deep - 1 ? 1 : 0),
    }));
  // What the API hands back for a given per_page: the newest N rows, oldest dropped.
  const pageOf = (history, n) => history.slice(0, n);

  test('🔴 THE CLIFF — through the OLD 20-row page a scheduled success at position 25 is INVISIBLE', () => {
    const history = historyWith(25);
    assert.equal(history[24].head_branch, 'main', 'fixture is not the shape this test claims');
    // …and that run went green YESTERDAY. The cron is perfect; the page was too
    // short. The resulting red is indistinguishable from a dead cron, which is
    // what made this worth fixing rather than tolerating.
    const v = evaluateFreshness(pageOf(history, 20), NOW_MS, undefined, 20);
    assert.equal(v.ok, false);
    assert.match(v.reason, /NONE has `head_branch: main`/);
  });

  test('🟢 …and VISIBLE through the shipped window. THIS TEST IS WHY RUNS_PAGE_SIZE IS 100.', () => {
    // Deliberately NOT `slice(0, 100)`. It slices by the guard's OWN constant, so
    // tidying that constant back down turns this red instead of leaving a green
    // suite sitting over a re-opened cliff.
    const v = evaluateFreshness(pageOf(historyWith(25), RUNS_PAGE_SIZE), NOW_MS);
    assert.equal(v.ok, true, `RUNS_PAGE_SIZE=${RUNS_PAGE_SIZE} cannot reach a scheduled success at position 25`);
    assert.ok(Math.abs(v.ageDays - 1) < 0.01);
  });

  test('the width is pinned to the query the guard ACTUALLY SENDS, not merely to a constant', () => {
    // A constant reading 100 beside a URL still reading 20 would look fixed
    // everywhere anybody reads and be unfixed in the one place it runs.
    const url = buildRunsUrl('owner/repo');
    assert.match(url, new RegExp(`per_page=${RUNS_PAGE_SIZE}(?:&|$)`));
    // `status=success` is the filter that makes the width load-bearing at all —
    // without it the page is a window over RUNS, where a red nightly still
    // occupies a slot and the scheduled run cannot be pushed out by hand-presses.
    assert.match(url, /status=success/);
    assert.match(url, /branch=main/);
    assert.equal(RUNS_PAGE_SIZE, 100, 'parity with assert-platform-proof-fresh.mjs, and the endpoint maximum');
  });

  test('⛔ A FULL PAGE STILL FAILS — the DIAGNOSIS splits, the VERDICT never does', () => {
    const v = evaluateFreshness(pageOf(historyWith(105), RUNS_PAGE_SIZE), NOW_MS);
    assert.equal(v.ok, false, 'a saturated window must never soften into a pass');
    assert.equal(v.windowSaturated, true);
    assert.match(v.reason, /THE PAGE WAS FULL/);
    assert.match(v.reason, /statement about the WINDOW/);
  });

  test('a SHORT page with no run on main is a statement about the WORKFLOW, and says exactly that', () => {
    const v = evaluateFreshness(
      [{ id: 1, conclusion: 'success', head_branch: 'feat/e2e-login-via-magic-link', event: 'workflow_dispatch', updated_at: daysAgo(0) }],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.equal(v.windowSaturated, false);
    assert.match(v.reason, /every green run is on a side branch/);
    assert.doesNotMatch(v.reason, /THE PAGE WAS FULL/);
  });

  // 🔴 THIS BLOCK REPLACES A TEST THAT ENCODED A FALSE LAW. Until 2026-08-26 it
  // asserted `windowSaturated === undefined` on an age verdict, under the
  // heading "a stale AGE is never a window artifact". The reasoning was that
  // truncation drops the OLDEST rows so the surviving scheduled run must be the
  // newest — which infers recency from PAGE POSITION. The page is ordered by
  // `created_at`; the guard grades by `updated_at`. A run created earlier can
  // update later, so the orderings can disagree and the "therefore" does not
  // follow. A test asserting the false law is worse than no test: it pins it.
  test('a stale age on a FULL page reports the window too — DIAGNOSIS only', () => {
    const history = historyWith(1);
    history[0].updated_at = daysAgo(30);
    const page = pageOf(history, RUNS_PAGE_SIZE);
    assert.equal(page.length, RUNS_PAGE_SIZE, 'fixture must be a saturated page for this test to mean anything');
    const v = evaluateFreshness(page, NOW_MS);
    // ⛔ THE VERDICT IS THE POINT: still false. The caveat must never soften it.
    assert.equal(v.ok, false, 'a saturated window must never turn a stale age into a pass');
    assert.match(v.reason, /30\.0 days old/);
    assert.equal(v.windowSaturated, true);
    assert.match(v.reason, /THE PAGE WAS FULL/);
    assert.match(v.reason, /created_at/);
    assert.match(v.reason, /updated_at/);
  });

  test('a stale age on a SHORT page is a plain stale age — no window caveat', () => {
    // The complement, and the reason the caveat is not simply printed always: a
    // short page IS the whole retained history, so nothing was truncated and
    // there is no window to blame. Saying otherwise would send an operator
    // hunting a pagination bug behind a genuinely stale nightly.
    const v = evaluateFreshness(
      [{ id: 7, conclusion: 'success', head_branch: 'main', event: 'schedule', updated_at: daysAgo(30) }],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /30\.0 days old/);
    assert.equal(v.windowSaturated, false);
    assert.doesNotMatch(v.reason, /THE PAGE WAS FULL/);
  });

  test('⛔ THE CAVEAT NEVER REACHES A PASSING VERDICT', () => {
    // A fresh scheduled run on a saturated page still passes clean, with no
    // saturation noise attached — the split is a diagnosis for FAILURES only.
    const v = evaluateFreshness(pageOf(historyWith(1), RUNS_PAGE_SIZE), NOW_MS);
    assert.equal(v.ok, true);
    assert.equal(v.windowSaturated, false);
    assert.equal(v.reason, null);
  });

  test('THE CLIFF AND THE FIX, THROUGH THE CLI — the two pages CI could have been handed', () => {
    const history = historyWith(25);

    // page20: what per_page=20 returned before 2026-08-26. The scheduled success
    // one day old at position 25 is off the end, so ci-gate goes red accusing a
    // cron that fired last night.
    const r20 = run(fixture('window-page20.json', pageOf(history, 20)));
    assert.equal(r20.status, 1);
    assert.match(r20.stderr, /NONE has `head_branch: main`/);

    // page100: the SAME history through the shipped window. Same repo, same
    // cron, same nightly — the only difference in the world is the page width.
    const r100 = run(fixture('window-page100.json', pageOf(history, RUNS_PAGE_SIZE)));
    assert.equal(r100.status, 0, r100.stderr);
    assert.match(r100.stdout, /nightly golden-path proof fresh/);
  });

  test('a genuinely saturated page tells the operator so — and still exits 1', () => {
    const r = run(fixture('window-saturated.json', pageOf(historyWith(105), RUNS_PAGE_SIZE)));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /THE RUN PAGE CAME BACK FULL/);
    assert.match(r.stderr, /LOOK AT THE RUN/);
    // …and it must not sell widening as the remedy a second time.
    assert.match(r.stderr, /paginating, not widening/);
  });
});

describe('THE TWO RECORDS — the four verdicts, through the CLI', () => {
  // 🔴 THE FOUR CASES THIS CHANGE EXISTS FOR, each exercised end to end rather
  // than against the pure halves alone. The pure tests above prove the decisions;
  // these prove the WIRING — that both records are actually read, that both
  // verdicts reach the exit code, and that the worst of the two wins.

  test('1. only dispatch runs on main + a fresh timer row → 0', () => {
    // This is the shape of a healthy night AFTER the move: the Cloudflare Worker
    // fired the workflow, so every run in the history is a `workflow_dispatch`,
    // and the cadence claim rests on the heartbeat the Worker wrote.
    const f = fixture('rec-ok.json', [
      { id: 4242, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const r = run(f, '--timer-file', timerFixture('rec-ok-timer.json', [timerRow({ days: 0 })]));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /proof fresh on BOTH records/);
    // BOTH LIMBS ARE PRINTED ON A PASS, not only on a failure. "The other record
    // is healthy" and "the other record was never looked at" must not read alike.
    assert.match(r.stdout, /OUTCOME \(GitHub run history\)/);
    assert.match(r.stdout, /TIMER   \(D1 cron_heartbeat\)/);
    // …and a green verdict says out loud what it does NOT prove.
    assert.match(r.stdout, /does not close O-E2E-UNPROVEN/);
  });

  test('2. a STALE timer row → 1, even with a spotless run list', () => {
    const f = fixture('rec-stale-timer.json', [
      { id: 1, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const r = run(f, '--timer-file', timerFixture('rec-stale-timer-rows.json', [timerRow({ days: 9 })]));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /9\.0 days old/);
    assert.match(r.stderr, /the Cloudflare alarm clock has stopped firing this workflow/);
    // A stale record is a FINDING, not an unread one — the codes must not blur.
    assert.doesNotMatch(r.stderr, /COVERAGE LOST  /);
  });

  test('3a. a MISSING timer row → 2, because an empty answer is not evidence', () => {
    // The Worker writes a row on every dispatch path INCLUDING its own failures,
    // so nothing at all is this guard failing to read the record — not the
    // dispatcher reporting bad news.
    const f = fixture('rec-no-timer.json', [
      { id: 1, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const r = run(f, '--timer-file', timerFixture('rec-no-timer-rows.json', []));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no cron_heartbeat row for job/);
  });

  test('3b. …and a row for the WRONG TARGET is the same absence', () => {
    // 🔴 THE MEASUREMENT THAT MAKES THIS NECESSARY. Live 2026-09-06, job
    // `github_dispatch` wrote `(dispatcher)` and `…/ops-watch.yml` on all four
    // daily firings and `…/e2e.yml` on ONE. Un-narrowed, the newest row for the
    // job is an ops-watch row three firings out of four — a healthy unrelated
    // dispatch vouching for a dispatcher that may not have fired in a week.
    const f = fixture('rec-wrong-target.json', [
      { id: 1, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const rows = [
      timerRow({ target: 'Nikatru_Platform_Public/ops-watch.yml', days: 0 }),
      timerRow({ target: '(dispatcher)', days: 0 }),
    ];
    const r = run(f, '--timer-file', timerFixture('rec-wrong-target-rows.json', rows));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no cron_heartbeat row for job/);
  });

  test('3c. …and a dispatcher row that records ok = 0 is a FINDING (1), not an absence (2)', () => {
    // The complement of 3a, and the reason the two codes are worth separating: a
    // row saying the dispatch FAILED is a record that WAS read and is bad news.
    const f = fixture('rec-ok0.json', [
      { id: 1, conclusion: 'success', head_branch: 'main', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const rows = [timerRow({ ok: 0, days: 0, detail: 'GITHUB_DISPATCH_TOKEN is not set on this Worker' })];
    const r = run(f, '--timer-file', timerFixture('rec-ok0-rows.json', rows));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /NONE records ok = 1/);
  });

  test('4. a green run whose branch is NOT main → 1, however fresh the timer is', () => {
    const f = fixture('rec-offbranch.json', [
      { id: 1, conclusion: 'success', head_branch: 'feat/e2e-login-via-magic-link', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const r = run(f, '--timer-file', timerFixture('rec-offbranch-timer.json', [timerRow({ days: 0 })]));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /NONE has `head_branch: main`/);
  });
});

describe('the timer record must be DECLARED, not assumed', () => {
  // The second coverage self-check, built the same way as the first: against a
  // MUTATED REAL register, never a hand-written fixture.
  const withRegister = (transform, fn) => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-n6-reg-'));
    mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
    mkdirSync(join(root, 'services', 'platform'), { recursive: true });
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling/ops/register.json'), 'utf8'));
    writeFileSync(join(root, 'tooling/ops/register.json'), JSON.stringify(transform(reg)));
    writeFileSync(
      join(root, 'services/platform/wrangler.jsonc'),
      readFileSync(join(REPO, 'services/platform/wrangler.jsonc'), 'utf8'),
    );
    try {
      fn(assertTimerRecordDeclared(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  const timerOf = (reg) => reg.rows.find((r) => r.id === 'duty.workflow.e2e.yml').mechanism.recordQuery.timer;

  test('GREEN CONTROL — the real register resolves the real database', () => {
    const v = assertTimerRecordDeclared();
    assert.equal(v.error, null, String(v.error));
    assert.ok(v.databaseId, 'the D1 database must resolve out of the wrangler config the register names');
    assert.equal(v.wrangler, 'services/platform/wrangler.jsonc');
  });

  test('the guard and the register name the SAME job, target, table and reader', () => {
    // The constants are not the source of truth on their own — this is the pair
    // being checked against each other, which is the whole point of the limb.
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling/ops/register.json'), 'utf8'));
    const t = timerOf(reg);
    assert.equal(t.reader, 'cloudflare-d1-heartbeat');
    assert.equal(t.table, TIMER_TABLE);
    assert.equal(t.job, TIMER_JOB);
    assert.equal(t.target, TIMER_TARGET);
  });

  test('MUTATION — the register renaming the target is COVERAGE LOST, not a silent pass', () => {
    withRegister(
      (reg) => {
        timerOf(reg).target = 'Nikatru_Platform_Public/build-platforms.yml';
        return reg;
      },
      (v) => {
        assert.match(v.error, /COVERAGE LOST/);
        assert.match(v.error, /target is/);
      },
    );
  });

  test('MUTATION — the timer limb deleted outright is COVERAGE LOST', () => {
    withRegister(
      (reg) => {
        delete reg.rows.find((r) => r.id === 'duty.workflow.e2e.yml').mechanism.recordQuery.timer;
        return reg;
      },
      (v) => assert.match(v.error, /declares no `recordQuery.timer`/),
    );
  });

  test('MUTATION — the whole row gone is COVERAGE LOST', () => {
    withRegister(
      (reg) => {
        reg.rows = reg.rows.filter((r) => r.id !== 'duty.workflow.e2e.yml');
        return reg;
      },
      (v) => assert.match(v.error, /declares no row/),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 TRAP ci-48 — PR #913 CI run 35967342865 attempt 1, ~2026-09-24T07:01Z.
// This guard failed "newest green scheduled run is 5.0 days old, ceiling is 3"
// while main carried 35962444367 (updated 06:06:58Z that day) and 35838102124
// (2026-09-23T08:43:34Z); the re-query at 07:05:34Z returned 73 rows, newest
// 35962444367. The trap does not record the stale page's own rows, so the page
// below is SYNTHETIC and dated to the measured 5.0 days; the two green runs are
// the measured ids and updated_at. Every case runs the guard as CI does, with
// `--runs-file` in its { "page", "cross" } form (decision E6).
// ─────────────────────────────────────────────────────────────────────────────
describe('THE STALE PAGE (trap ci-48) — the union, the read line and the ceiling, through the CLI', () => {
  const NOW_913 = '2026-09-24T07:01:00Z';
  const green = (id, created, updated, event = 'workflow_dispatch') => ({ id, conclusion: 'success', head_branch: 'main', event, created_at: created, updated_at: updated });
  const PAGE = [
    green(35500000001, '2026-09-19T06:41:00Z', '2026-09-19T07:01:00Z'),
    green(35400000001, '2026-09-18T06:41:00Z', '2026-09-18T07:01:00Z'),
  ];
  const DISPATCHED = green(35962444367, '2026-09-24T05:46:58Z', '2026-09-24T06:06:58Z');
  const SCHEDULED = green(35838102124, '2026-09-23T08:23:34Z', '2026-09-23T08:43:34Z', 'schedule');
  const at913 = (name, doc, env = process.env) => {
    const runsFile = join(TMP, name);
    writeFileSync(runsFile, JSON.stringify(doc));
    const timerFile = timerFixture(`timer-${name}`, [timerRow({ ran_at: '2026-09-24T06:00:00Z' })]);
    return spawnSync(process.execPath, [GUARD, '--runs-file', runsFile, '--timer-file', timerFile, '--now', NOW_913], { cwd: REPO, encoding: 'utf8', env });
  };

  test('🟢 RED CONTROL 1 — the PR #913 page with a cross-read holding 35962444367 is GREEN, and says the page was stale', () => {
    const r = at913('913-carried.json', { page: PAGE, cross: [DISPATCHED, SCHEDULED] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /^STALE PAGE, CROSS-READ CARRIED THE PROOF: the page's newest qualifying run is 35500000001 \(updated_at 2026-09-19T07:01:00Z\) over 2 row\(s\); the cross-read's is 35962444367 \(updated_at 2026-09-24T06:06:58Z\) over 2 row\(s\)/m,
    );
    assert.match(r.stdout, /green run 35962444367 on main, 0\.0 day\(s\) old \(ceiling 3\)/);
    assert.match(r.stdout, /nightly golden-path proof fresh on BOTH records/);
  });

  test('🔴 …CONTROL — the same page with an EMPTY cross-read is exit 1, and the reason names the run, updated_at, rows and query', () => {
    const r = at913('913-empty-cross.json', { page: PAGE, cross: [] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /OUTCOME \(GitHub run history\) : {2}newest green scheduled run is 5\.0 days old, ceiling is 3 — run 35500000001 \(updated_at 2026-09-19T07:01:00Z\) is the newest green run on main of 2 row\(s\) returned by GET \/repos\/[^/\s]+\/[^/\s]+\/actions\/workflows\/e2e\.yml\/runs\?branch=main&status=success&per_page=100 and 0 row\(s\) on its cross-read/,
    );
    assert.doesNotMatch(r.stdout + r.stderr, /STALE PAGE/);
  });

  test('🔴 RED CONTROL 2 — page proven stale, and the cross-read\'s newest is ALSO past the ceiling: exit 2, not 1', () => {
    const r = at913('913-both-stale.json', { page: PAGE, cross: [green(35700000001, '2026-09-20T06:41:00Z', '2026-09-20T07:01:00Z')] });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /OUTCOME \(GitHub run history\) : {2}stale page — the successful-run history of e2e\.yml on main ends at run 35500000001/);
    assert.match(r.stderr, /not fresh either \(newest green scheduled run is 4\.0 days old, ceiling is 3/);
    assert.match(r.stderr, /COVERAGE LOST {2}the nightly golden-path proof could not be graded/);
  });

  test('E6 — an ARRAY fixture is a page with no cross-read, and the READ line says so rather than reaching the network', () => {
    const r = at913('913-array.json', PAGE);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /READ {4}\(GitHub run history\) : {2}fixture standing in for GET \/repos\/\S+\/actions\/workflows\/e2e\.yml\/runs\?branch=main&status=success&per_page=100 · 2 row\(s\) returned, per_page 100, saturated no · newest qualifying run 35500000001 \(updated_at 2026-09-19T07:01:00Z\) · cross-read not run \(fixture has none\)$/m,
    );
  });

  test('E3 — the READ line is printed on a PASS too', () => {
    const r = at913('913-pass-read.json', { page: [DISPATCHED, ...PAGE], cross: [] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /READ {4}\(GitHub run history\) : {2}fixture standing in for GET .* · 3 row\(s\) returned, per_page 100, saturated no · newest qualifying run 35962444367 \(updated_at 2026-09-24T06:06:58Z\) · cross-read created=>=2026-09-24T05:46:58Z: 0 row\(s\), newest none$/m);
  });

  test('a fixture whose `cross` is not an array is COVERAGE LOST (2), never a page read without its anchor', () => {
    const r = at913('913-bad-cross.json', { page: PAGE, cross: { oops: true } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /could not read fixture .*`cross` that is not an array/);
  });

  test('🔴 RED CONTROL 4 — a GitHub API that never answers hits the SHARED ceiling and is exit 2, inside the bound', { timeout: 60_000 }, () => {
    // The guard's own fetch, answered by a preload that never resolves: no
    // fixture flag, no network. OPS_REQUEST_TIMEOUT_MS is bounded-retry.mjs's
    // test knob, which can only SHORTEN the ceiling. The D1 limb has no
    // Cloudflare credential here, so the assertion is on the RUN limb's words.
    const preload = join(TMP, 'never-answers.mjs');
    writeFileSync(preload, 'globalThis.fetch = () => new Promise(() => {});\n');
    const env = { ...process.env, GITHUB_TOKEN: 'fixture-token', GITHUB_REPOSITORY: 'o/r', OPS_REQUEST_TIMEOUT_MS: '200' };
    delete env.GH_TOKEN;
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, GUARD], { cwd: REPO, encoding: 'utf8', env });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /OUTCOME \(GitHub run history\) : {2}no answer within 0\.2s \(the per-request ceiling, attempt 3\) — and the same on all 3 attempt\(s\)/);
    assert.ok(elapsed >= READ_ATTEMPTS * 200 + RETRY_CEILING_MS - 50, `ended in ${elapsed}ms, faster than ${READ_ATTEMPTS} ceilings and the backoff`);
    assert.ok(elapsed < READ_ATTEMPTS * 200 + RETRY_CEILING_MS + 10_000, `took ${elapsed}ms, far past the shared bound`);
  });
});
