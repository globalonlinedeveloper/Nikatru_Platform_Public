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
import { fileURLToPath } from 'node:url';

import {
  evaluateFreshness,
  assertWatchedWorkflowIntact,
  isDailyCron,
  cronExpressions,
  REQUIRED_WORK,
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

const run = (name, ...args) => {
  const file = join(TMP, name);
  return spawnSync(process.execPath, [GUARD, '--runs-file', file, '--now', NOW, ...args], {
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
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }], NOW_MS);
    assert.equal(v.ok, true);
    assert.ok(Math.abs(v.ageDays - 1) < 0.01);
  });

  test('a run past the ceiling FAILS — this is the whole requirement', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(4) }], NOW_MS);
    assert.equal(v.ok, false);
    assert.match(v.reason, /4\.0 days old/);
  });

  test('exactly at the ceiling passes — the boundary is inclusive and pinned at 3', () => {
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(3) }], NOW_MS);
    assert.equal(v.ok, true);
  });

  test('ONE tolerated bad night — the derivation`s middle term, pinned', () => {
    // The ceiling is 1 (cadence) + 1 (a tolerated bad night) + 1 (jitter margin).
    // If someone re-derives it down to the bare cadence, a single red nightly
    // starts blocking every merge in the repo, which is how guards get deleted.
    const v = evaluateFreshness([{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(2) }], NOW_MS);
    assert.equal(v.ok, true);
  });

  test('failed runs do not count as proof, however recent', () => {
    const v = evaluateFreshness(
      [
        { id: 1, conclusion: 'failure', event: 'schedule', updated_at: daysAgo(0) },
        { id: 2, conclusion: 'cancelled', event: 'schedule', updated_at: daysAgo(0) },
      ],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /no successful/);
  });

  test('THE REAL 2026-08-01 DEFECT — two green manual runs inside a six-night outage', () => {
    // Not hypothetical. On 2026-08-01, mid-outage, two `workflow_dispatch` runs
    // went green while every scheduled run was red. A guard that counted them
    // would have called the nightly healthy on the worst night it ever had.
    const v = evaluateFreshness(
      [
        { id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(7) },
        { id: 2, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(1) },
        { id: 3, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(1) },
      ],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /7\.0 days old/);
  });

  test('manual-only history FAILS here — the deliberate divergence from F-4', () => {
    // assert-platform-proof-fresh.mjs treats this as a dated tripwire that only
    // PRINTS, because its cron had genuinely never fired. This workflow's cron
    // has fired every night from 2026-07-24 to 2026-08-02, so the same state is
    // a stopped timer, not a young one, and it must fail immediately.
    const v = evaluateFreshness(
      [{ id: 1, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(0) }],
      NOW_MS,
    );
    assert.equal(v.ok, false);
    assert.equal(v.manualCount, 1);
    assert.match(v.reason, /NONE was triggered by the schedule/);
  });

  test('an unreadable answer is a failure, never a pass', () => {
    assert.equal(evaluateFreshness(null, NOW_MS).ok, false);
    assert.equal(evaluateFreshness(undefined, NOW_MS).ok, false);
    assert.equal(evaluateFreshness('{}', NOW_MS).ok, false);
  });

  test('an unparseable timestamp fails rather than reading as epoch 0', () => {
    const v = evaluateFreshness(
      [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: 'yesterday-ish' }],
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
    const f = fixture('fresh.json', [{ id: 999, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nightly golden-path proof fresh/);
    assert.match(r.stdout, /999/);
  });

  test('stale proof exits 1 and REFUSES to recommend raising the ceiling', () => {
    const f = fixture('stale.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(30) }]);
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not fresh/);
    assert.match(r.stderr, /THE REMEDY IS NOT TO RAISE MAX_AGE_DAYS/);
    // …and it must point at the signals PR #111 added, not at the raw log.
    assert.match(r.stderr, /e2e-screenshots/);
  });

  test('a manual run cannot mask a stale scheduled one, through the CLI too', () => {
    const f = fixture('masked.json', [
      { id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(60) },
      { id: 2, conclusion: 'success', event: 'workflow_dispatch', updated_at: daysAgo(0) },
    ]);
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /60\.0 days old/);
    assert.match(r.stderr, /A MANUAL RUN DOES NOT SATISFY THIS/);
  });

  test('a missing fixture file fails rather than passing silently', () => {
    const r = run('does-not-exist.json');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not read fixture/);
  });

  test('offline mode announces itself so it cannot hide in a CI log', () => {
    const f = fixture('announce.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = run(f);
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });

  test('a bad --now is rejected, not silently treated as epoch 0', () => {
    const f = fixture('now.json', [{ id: 1, conclusion: 'success', event: 'schedule', updated_at: daysAgo(1) }]);
    const r = spawnSync(process.execPath, [GUARD, '--runs-file', join(TMP, f), '--now', 'not-a-date'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a parseable date/);
  });

  test('NO TOKEN IS A FAILURE — the fail-closed path, exercised', () => {
    // Without --runs-file the guard must reach the network, and with the token
    // stripped from the environment it must exit non-zero rather than skip.
    // This is why the guard is expected to be red in a local guard sweep.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8', env });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /fails closed/);
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

  test('dropping the live-D1 verification is COVERAGE LOST', () => {
    // Without it a green run proves the UI moved and proves nothing landed.
    //
    // ⚠️ The path is taken from REQUIRED_WORK rather than written out, and that
    // is not style. assert-guard-coverage.mjs counts a workflow-invoked script
    // outside tooling/ci as "covered" when its BASENAME appears anywhere in an
    // executable line of the suite — a weak proxy its own header admits to. That
    // script is deliberately listed in NO_NEGATIVE_TEST_NEEDED because the live
    // nightly exercises it and no fixture can; spelling its name here would flip
    // it to "covered" on the strength of this string alone and quietly retire an
    // honest exemption. Inflating apparent coverage is the one thing this repo
    // deletes on sight.
    const verifyStep = REQUIRED_WORK[2];
    withRoot(
      (s) => s.split(verifyStep).join('true'),
      (v) => assert.ok(v && v.includes(verifyStep), `expected COVERAGE LOST naming ${verifyStep}, got: ${v}`),
    );
  });

  test('🔴 the work check reads the BODY, never the prose describing it', () => {
    // The r2_buckets trap: a scan satisfied by the COMMENT explaining the thing
    // rather than by the thing. Here the three work strings are deleted from
    // every real step and re-stated in a comment, with the schedule left intact.
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
        // Built from REQUIRED_WORK, so the prose names all three exactly — and
        // so this file never spells the harness path out (see the note on the
        // live-D1 test below).
        return [`# This workflow used to run: ${REQUIRED_WORK.join(' , ')}`, body].join('\n');
      },
      (v) => assert.match(v, /no longer contains/),
    );
  });
});
