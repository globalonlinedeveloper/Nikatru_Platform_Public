// ─────────────────────────────────────────────────────────────────────────────
// heartbeats.test.mjs — tooling/ops/check-heartbeats.mjs must be able to FAIL.
//
// [pipeline O-4] "The absence or WRONGNESS of a run alarms, from OUTSIDE the
// system being watched."
//
// 🔴 THE RED THIS READER WAS BUILT TO RECORD, ON REAL PRODUCTION DATA — RUN
// AGAIN AND RE-MEASURED 2026-08-02 against the live `platform_db` over the D1
// REST API, exit 1, verbatim:
//
//   supabase_keepalive: the newest heartbeat is FRESH and says the job FAILED —
//   ok=0, detail: HTTP 401 — REJECTED (unauthenticated, no SUPABASE_ANON_KEY
//   configured). A rejected request is not proven activity.
//   (target https://<project>.supabase.co). A check that only asked "did a row
//   land today" would be green on exactly this.
//
// That is the whole reason the reader was written BEFORE the secret is pushed.
// A reader written AFTER the fix would only ever have been observed passing,
// which is precisely how assert-seams-wired.mjs shipped with a check that could
// not fail while all six of its fixture tests passed. The deploy step that
// supplies the secret ships in the same change; the red above is what it has to
// turn green, on the next 06:00 UTC cron, on real production data.
//
// ⚠️ REAL-TREE MUTATIONS, RE-RUN FROM SCRATCH ON 2026-08-02 against a COPY of
// this worktree (the earlier claim here was inherited from an agent that died
// before verifying anything). Five for the derivation half, each: baseline green
// -> mutate -> exit 1 with the intended message -> restore FROM MEMORY ->
// byte-compare -> re-verify green.
//
//   H1 the cron duty row loses `watchedJobs`             -> COVERAGE LOST
//   H2 the job constant is renamed in the Worker while
//      the register still names the old one              -> COVERAGE LOST (the
//                                                           reader would query a
//                                                           name nothing writes)
//   H3 `triggers.crons` emptied in the anchored config   -> COVERAGE LOST
//   H4 a cron expression the narrow parser cannot turn
//      into an interval                                  -> "failing closed rather
//                                                           than guessing"
//   H5 the D1 binding loses `migrations_dir`             -> COVERAGE LOST
//   5/5 caught, none crashed, every restore byte-identical and green again.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  evaluateJob,
  cronIntervalHours,
  lastExpectedFireMs,
  deriveWatchedJobs,
} from '../../ops/check-heartbeats.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const READER = join(REPO, 'tooling/ops/check-heartbeats.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-hb-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const NOW = Date.parse('2026-08-02T09:00:00Z');
const CRON = '0 6 * * *';
const row = (over = {}) => ({ job: 'j', target: 't', ok: 1, detail: '', ran_at: '2026-08-02T06:00:00Z', ...over });

describe('check-heartbeats — the three ways to be red, and the one that matters most', () => {
  test('a fresh row saying ok=1 is the only pass', () => {
    const v = evaluateJob('j', [row()], CRON, NOW);
    assert.equal(v.ok, true);
  });

  test('ABSENT — no row at all is a failure, not an empty success', () => {
    const v = evaluateJob('j', [], CRON, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'absent');
    assert.match(v.reason, /has ever been written/);
  });

  test('ABSENT — a row from before the last due occurrence is a failure', () => {
    const v = evaluateJob('j', [row({ ran_at: '2026-07-30T06:00:00Z' })], CRON, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'absent');
    assert.match(v.reason, /The timer did not fire/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE REGRESSION TEST FOR THE 2026-08-06 MISS. This is the case the old
  // `interval x 1.5` ceiling passed, and it is not a hypothetical shape: it is
  // the production data of that morning, to the hour.
  //
  // The assertion is deliberately TWO-SIDED — it asserts the new verdict AND
  // recomputes what the old rule would have said. Without the second half a
  // future "simplification" back to a staleness ceiling would leave this test
  // green, because a red verdict alone does not say WHICH limb produced it.
  // ───────────────────────────────────────────────────────────────────────────
  test('a SINGLE missed nightly run is red — the exact case the 1.5x ceiling passed on 2026-08-06', () => {
    const now = Date.parse('2026-08-06T10:06:00Z'); // ops-watch run 31091922078
    const lastGood = '2026-08-05T06:00:37Z'; // the real newest row that morning
    const v = evaluateJob('supabase_keepalive', [row({ ran_at: lastGood })], CRON, now);

    assert.equal(v.ok, false, 'a scheduled occurrence with no row must be red');
    assert.equal(v.kind, 'absent');
    assert.match(v.reason, /due at 2026-08-06T06:00:00\.000Z/);

    // And the old rule, recomputed here rather than trusted: 28.1h < 36h.
    const ageHours = (now - Date.parse(lastGood)) / 3_600_000;
    assert.ok(ageHours < 24 * 1.5, `the old ceiling would have passed this (age ${ageHours.toFixed(1)}h < 36h)`);
  });

  test('a LATE run inside the grace is still not an alarm — the property the ratio was really buying', () => {
    // 1h past due, no row for today yet. Late, not missed.
    const now = Date.parse('2026-08-02T07:00:00Z');
    const v = evaluateJob('j', [row({ ran_at: '2026-08-01T06:00:00Z' })], CRON, now);
    assert.equal(v.ok, true);
  });

  test('UNKNOWN — an expression with no computable occurrence fails closed, never falls back to staleness', () => {
    const v = evaluateJob('j', [row()], '*/5 * * * *', NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unknown');
    assert.match(v.reason, /no computable occurrence/);
  });

  test('RED — a FRESH row whose outcome column says FAILED is the case a presence check would pass', () => {
    const v = evaluateJob('j', [row({ ok: 0, detail: 'HTTP 401 — REJECTED' })], CRON, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'red');
    assert.match(v.reason, /FRESH and says the job FAILED/);
    assert.match(v.reason, /would be green on exactly this/);
  });

  test('RED — the detail and target travel with the failure so the log names the cause', () => {
    const v = evaluateJob('j', [row({ ok: 0, detail: 'no SUPABASE_ANON_KEY configured', target: 'https://x' })], CRON, NOW);
    assert.match(v.reason, /no SUPABASE_ANON_KEY configured/);
    assert.match(v.reason, /target https:\/\/x/);
  });

  test('UNKNOWN — a non-array result fails closed', () => {
    const v = evaluateJob('j', null, CRON, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unknown');
  });

  test('UNKNOWN — an unparseable timestamp fails closed rather than being ignored', () => {
    const v = evaluateJob('j', [row({ ran_at: 'yesterday-ish' })], CRON, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unknown');
  });

  test('the NEWEST row decides, not the first one the query happened to return', () => {
    const rows = [row({ ran_at: '2026-07-01T06:00:00Z', ok: 1 }), row({ ran_at: '2026-08-02T06:00:00Z', ok: 0 })];
    assert.equal(evaluateJob('j', rows, CRON, NOW).kind, 'red');
  });

  test('ok arriving as a string "0" is still a failure — D1 JSON types are not guaranteed', () => {
    assert.equal(evaluateJob('j', [row({ ok: '0' })], CRON, NOW).kind, 'red');
  });
});

describe('check-heartbeats — the cron parser is narrow ON PURPOSE', () => {
  test('a daily cron is 24 hours', () => {
    assert.equal(cronIntervalHours('0 6 * * *'), 24);
  });

  test('a weekly cron is 168 hours', () => {
    assert.equal(cronIntervalHours('0 6 * * 1'), 168);
  });

  test('a step expression returns null — a generous guess would be a window that cannot fire', () => {
    assert.equal(cronIntervalHours('*/5 * * * *'), null);
  });

  // ⚠️ ADDED AFTER A NEGATIVE TEST FOUND THE HOLE. Reverting the parser's FINAL
  // `return null` to `return 24` left the whole suite green, because every case
  // above returns from an EARLIER guard clause. Only a literal day-of-month
  // reaches the last line — so without these two the fallback was unprotected,
  // and a monthly cron would have been silently treated as daily, producing a
  // staleness ceiling 30x too tight and an alarm that fires every day.
  test('a day-of-month cron returns null — it reaches the parser\'s FINAL fallback', () => {
    assert.equal(cronIntervalHours('0 6 1 * *'), null);
  });

  test('a day-of-month AND day-of-week cron returns null too', () => {
    assert.equal(cronIntervalHours('0 6 1 * 1'), null);
  });

  test('a range, a list, a month field and a malformed expression all return null', () => {
    assert.equal(cronIntervalHours('0 1-5 * * *'), null);
    assert.equal(cronIntervalHours('0 6,18 * * *'), null);
    assert.equal(cronIntervalHours('0 6 * 1 *'), null);
    assert.equal(cronIntervalHours('0 6 * *'), null);
    assert.equal(cronIntervalHours(''), null);
    assert.equal(cronIntervalHours(undefined), null);
  });
});

describe('check-heartbeats — the occurrence parser, which decides whether a run was MISSED', () => {
  const iso = (ms) => new Date(ms).toISOString();

  test('a daily cron whose time has passed today is due TODAY', () => {
    assert.equal(iso(lastExpectedFireMs('0 6 * * *', Date.parse('2026-08-06T10:06:00Z'))), '2026-08-06T06:00:00.000Z');
  });

  test('a daily cron whose time has NOT yet come today is due YESTERDAY — never a future occurrence', () => {
    assert.equal(iso(lastExpectedFireMs('0 6 * * *', Date.parse('2026-08-06T05:59:00Z'))), '2026-08-05T06:00:00.000Z');
  });

  test('exactly at the scheduled minute counts as due, not as still-pending', () => {
    assert.equal(iso(lastExpectedFireMs('0 6 * * *', Date.parse('2026-08-06T06:00:00Z'))), '2026-08-06T06:00:00.000Z');
  });

  test('a weekly cron walks back to its own weekday, not to yesterday', () => {
    // 2026-08-06 is a Thursday; `dow=1` is Monday -> 2026-08-03.
    assert.equal(iso(lastExpectedFireMs('0 6 * * 1', Date.parse('2026-08-06T10:00:00Z'))), '2026-08-03T06:00:00.000Z');
  });

  test('a weekly cron ON its weekday but before the hour goes back a full week', () => {
    assert.equal(iso(lastExpectedFireMs('0 6 * * 1', Date.parse('2026-08-03T05:00:00Z'))), '2026-07-27T06:00:00.000Z');
  });

  test('month rollover is handled by UTC date arithmetic, not by subtracting 24h', () => {
    assert.equal(iso(lastExpectedFireMs('0 6 * * *', Date.parse('2026-09-01T05:00:00Z'))), '2026-08-31T06:00:00.000Z');
  });

  // ⚠️ THE PARSERS MUST REFUSE THE SAME GRAMMAR. `deriveWatchedJobs` now asserts
  // both accept an expression before building a job from it, so a shape either
  // one refuses must be refused here too — otherwise the reader could compute an
  // occurrence for a schedule the interval limb had already declined.
  test('every shape cronIntervalHours refuses, lastExpectedFireMs refuses too', () => {
    for (const bad of ['*/5 * * * *', '0 6 1 * *', '0 6 1 * 1', '0 1-5 * * *', '0 6,18 * * *', '0 6 * 1 *', '0 6 * *', '', undefined]) {
      assert.equal(cronIntervalHours(bad), null, `interval should refuse ${JSON.stringify(bad)}`);
      assert.equal(lastExpectedFireMs(bad, NOW), null, `occurrence should refuse ${JSON.stringify(bad)}`);
    }
  });

  test('out-of-range literals are refused rather than wrapped by Date.UTC', () => {
    assert.equal(lastExpectedFireMs('0 25 * * *', NOW), null);
    assert.equal(lastExpectedFireMs('60 6 * * *', NOW), null);
    assert.equal(lastExpectedFireMs('0 6 * * 9', NOW), null);
  });
});

describe('check-heartbeats — the watched set is DERIVED, and cannot silently empty', () => {
  /** A fixture repo whose derivation succeeds, so each mutation below is proven
   *  to fail for its own reason. */
  function makeRepo(mutate = () => {}) {
    const root = join(TMP, `h${seq++}`);
    mkdirSync(join(root, 'services/svc/src'), { recursive: true });
    mkdirSync(join(root, 'tooling/ops'), { recursive: true });
    const state = {
      wrangler: {
        name: 'svc',
        d1_databases: [{ binding: 'DB', database_name: 'demo', database_id: 'abc', migrations_dir: 'migrations' }],
        triggers: { crons: ['0 6 * * *'] },
      },
      // Declaration AND a call site. The declaration alone used to be enough
      // here, which is precisely the shape the [pipeline B-11] usage limb was
      // added to reject: an exported `*_JOB` constant nothing passes to
      // `recordHeartbeat` writes no rows, so watching it produces a permanent
      // "absent" that no code change can clear.
      source:
        "export const KEEPALIVE_JOB = 'demo_job';\n" +
        'await recordHeartbeat(env, rows, KEEPALIVE_JOB);\n',
      row: {
        id: 'duty.cron',
        kind: 'duty',
        cadence: '1d',
        watchedJobs: ['demo_job'],
        mechanism: { substrate: 'cloudflare-cron', anchor: 'services/svc/wrangler.jsonc' },
      },
    };
    mutate(state);
    writeFileSync(join(root, 'services/svc/wrangler.jsonc'), JSON.stringify(state.wrangler));
    writeFileSync(join(root, 'services/svc/src/scheduled.ts'), state.source);
    writeFileSync(join(root, 'tooling/ops/register.json'), JSON.stringify({ rows: state.row ? [state.row] : [] }));
    return root;
  }

  test('the fixture derives one watched job with no problems', () => {
    const { jobs, problems } = deriveWatchedJobs(makeRepo());
    assert.deepEqual(problems, []);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].job, 'demo_job');
    // The cron EXPRESSION travels with the job, not a derived interval: the
    // absence limb needs the occurrence, and carrying a number nothing reads is
    // how a stale second copy of the schedule gets created.
    assert.equal(jobs[0].cron, '0 6 * * *');
    assert.equal(jobs[0].intervalHours, undefined);
    assert.equal(jobs[0].databaseId, 'abc');
  });

  // ── [pipeline B-11] the OTHER direction: a job the scheduler runs that the
  //    register never learned about. This is the limb that stayed silent while
  //    `analytics_liveness` ran unwatched from the day it shipped.
  test('a job the SOURCE declares and uses but the register does NOT watch is COVERAGE LOST', () => {
    const { problems } = deriveWatchedJobs(
      makeRepo((s) => {
        s.source +=
          "export const SECOND_JOB = 'second_job';\n" +
          'await recordHeartbeat(env, rows, SECOND_JOB);\n';
      }),
    );
    assert.match(problems.join(' '), /declares and uses job "second_job".*does NOT name it/s);
  });

  test('…and that unwatched job is caught even when every WATCHED job is perfectly fine', () => {
    // The failure mode being excluded: an implementation that only reports the
    // gap when something else is already wrong. The watched job here is healthy
    // and correctly wired; the ONLY problem is the unwatched one.
    const { problems } = deriveWatchedJobs(
      makeRepo((s) => {
        s.source +=
          "export const SECOND_JOB = 'second_job';\n" +
          'await recordHeartbeat(env, rows, SECOND_JOB);\n';
      }),
    );
    assert.equal(problems.length, 1, problems.join('\n'));
  });

  test('an exported *_JOB constant that is NEVER USED is reported — a name nothing writes', () => {
    const { problems } = deriveWatchedJobs(
      makeRepo((s) => {
        // Declared, watched, and never passed to anything.
        s.source += "export const GHOST_JOB = 'ghost_job';\n";
        s.row.watchedJobs = ['demo_job', 'ghost_job'];
      }),
    );
    assert.match(problems.join(' '), /`GHOST_JOB` \(job "ghost_job"\) is declared .* and NEVER USED/s);
  });

  test('a usage must not be the declaration itself — the _registerInWorkspace trap', () => {
    // If the declaration line were not stripped before looking for a usage,
    // EVERY declared constant would resolve to itself and the limb above could
    // never fire. This asserts the stripping, by giving the constant nothing but
    // its own declaration and requiring the complaint anyway.
    const { problems } = deriveWatchedJobs(
      makeRepo((s) => {
        s.source = "export const KEEPALIVE_JOB = 'demo_job';\n";
      }),
    );
    assert.match(problems.join(' '), /NEVER USED/);
  });

  test('source with no *_JOB declaration at all is COVERAGE LOST, not an empty derived set', () => {
    const { problems } = deriveWatchedJobs(
      makeRepo((s) => {
        s.source = 'export const SOMETHING_ELSE = 1;\n';
        s.row.watchedJobs = ['demo_job'];
      }),
    );
    assert.match(problems.join(' '), /the derived job set is EMPTY/);
  });

  test('a job name that appears NOWHERE in the Worker source is COVERAGE LOST', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { s.source = "export const KEEPALIVE_JOB = 'renamed';\n"; }));
    assert.match(problems.join(' '), /COVERAGE LOST/);
    assert.match(problems.join(' '), /a name nothing writes/);
  });

  test('no watchedJobs is COVERAGE LOST — the reader would query nothing and exit 0', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { delete s.row.watchedJobs; }));
    assert.match(problems.join(' '), /declares no `watchedJobs`/);
  });

  test('an empty watchedJobs is COVERAGE LOST too', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { s.row.watchedJobs = []; }));
    assert.match(problems.join(' '), /declares no `watchedJobs`/);
  });

  test('no cloudflare-cron row at all is COVERAGE LOST', () => {
    const { jobs, problems } = deriveWatchedJobs(makeRepo((s) => { s.row = null; }));
    assert.equal(jobs.length, 0);
    assert.match(problems.join(' '), /declares no `cloudflare-cron` duty/);
  });

  test('a config that declares no crons is COVERAGE LOST — the register and the config disagree', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { s.wrangler.triggers = { crons: [] }; }));
    assert.match(problems.join(' '), /the register and the config disagree|declares no `triggers.crons`/);
  });

  test('a cron the parser cannot read fails closed rather than guessing a window', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { s.wrangler.triggers.crons = ['*/5 * * * *']; }));
    assert.match(problems.join(' '), /failing closed rather than guessing/);
  });

  test('a D1 binding with no migrations_dir is COVERAGE LOST — the heartbeat DB is unresolvable', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { delete s.wrangler.d1_databases[0].migrations_dir; }));
    assert.match(problems.join(' '), /no D1 binding carrying `migrations_dir`/);
  });

  test('an anchor that does not exist is COVERAGE LOST', () => {
    const { problems } = deriveWatchedJobs(makeRepo((s) => { s.row.mechanism.anchor = 'services/gone/wrangler.jsonc'; }));
    assert.match(problems.join(' '), /which does not exist/);
  });

  test('an absent register is COVERAGE LOST, not an empty watched set', () => {
    const root = join(TMP, `x${seq++}`);
    mkdirSync(root, { recursive: true });
    const { problems } = deriveWatchedJobs(root);
    assert.match(problems.join(' '), /does not exist, so there is no declared set of jobs/);
  });
});

describe('check-heartbeats — end to end through the real register', () => {
  const fixture = (rows) => {
    const p = join(TMP, `f${seq++}.json`);
    writeFileSync(p, JSON.stringify(rows));
    return p;
  };
  const run = (rowsFile, now) =>
    spawnSync(process.execPath, [READER, '--rows-file', rowsFile, '--now', now], { cwd: REPO, encoding: 'utf8' });

  // ⚠️ DERIVED FROM THE REAL REGISTER, NOT A LITERAL `{ supabase_keepalive: … }`.
  // These fixtures used to name the one job by hand and assert "watching 1 cron
  // job(s)". That made the END-TO-END test a hand-kept list of exactly the kind
  // the reader exists to replace: when `renewals` joined the watched set on
  // 2026-08-03 every test here went red, not because anything was wrong but
  // because the fixture had been written to a number. Worse, it had been GREEN
  // for the whole period `analytics_liveness` ran unwatched — a fixture naming
  // only the job it knew about cannot notice a job it does not.
  const WATCHED = deriveWatchedJobs(REPO).jobs.map((j) => j.job);
  /** A healthy row set covering EVERY watched job, whatever that set becomes. */
  const healthy = (over = {}) =>
    Object.fromEntries(WATCHED.map((job) => [job, [row({ job, ...over })]]));

  test('the real register derives a NON-EMPTY watched set — the floor every test below stands on', () => {
    // Without this, an accidentally-empty derivation makes `healthy()` an empty
    // object, the reader watches nothing, exits 0, and every assertion in this
    // describe block passes while checking nothing at all.
    assert.ok(WATCHED.length > 0, 'COVERAGE LOST — the real register derived ZERO watched jobs');
    // Every job the scheduler declares must be in it. Named explicitly because
    // this is the regression that hid for a whole stage.
    for (const expected of ['supabase_keepalive', 'analytics_liveness', 'renewals']) {
      assert.ok(WATCHED.includes(expected), `the watched set is missing "${expected}"`);
    }
  });

  test('the real register derives a watched set, and a healthy fixture passes', () => {
    const r = run(fixture(healthy()), '2026-08-02T09:00:00Z');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(
      r.stdout,
      new RegExp(`watching ${WATCHED.length} cron job\\(s\\) derived from tooling/ops/register\\.json`),
    );
  });

  test('the fixture mode announces itself loudly, so it can never pass unnoticed in a real log', () => {
    assert.match(run(fixture(healthy()), '2026-08-02T09:00:00Z').stdout, /OFFLINE FIXTURE MODE/);
  });

  test('a fresh-but-failed row exits non-zero through the real derivation', () => {
    const r = run(fixture(healthy({ ok: 0, detail: 'HTTP 401' })), '2026-08-02T09:00:00Z');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not reporting healthy/);
  });

  test('EVERY watched job is graded — a failure in ANY ONE of them is caught', () => {
    // The point of the derivation: with a hand-written fixture, a job added to
    // the register but never exercised by a test is watched on paper only. Here
    // each job in turn is the ONLY unhealthy one, and each must be caught.
    for (const job of WATCHED) {
      const rows = healthy();
      rows[job] = [row({ job, ok: 0, detail: 'broken' })];
      const r = run(fixture(rows), '2026-08-02T09:00:00Z');
      assert.equal(r.status, 1, `a failing "${job}" was NOT caught`);
      assert.match(r.stderr, new RegExp(job));
    }
  });

  test('an empty result set exits non-zero through the real derivation', () => {
    const empty = Object.fromEntries(WATCHED.map((job) => [job, []]));
    assert.equal(run(fixture(empty), '2026-08-02T09:00:00Z').status, 1);
  });

  test('an unreadable --now is refused rather than silently becoming "now"', () => {
    const f = fixture(healthy());
    const r = spawnSync(process.execPath, [READER, '--rows-file', f, '--now', 'lunchtime'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a parseable date/);
  });

  test('a missing fixture file is refused rather than treated as no rows', () => {
    const r = spawnSync(process.execPath, [READER, '--rows-file', join(TMP, 'nope.json'), '--now', '2026-08-02T09:00:00Z'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not read fixture/);
  });
});
