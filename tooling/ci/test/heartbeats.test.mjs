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

import { evaluateJob, cronIntervalHours, deriveWatchedJobs } from '../../ops/check-heartbeats.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const READER = join(REPO, 'tooling/ops/check-heartbeats.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-hb-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const NOW = Date.parse('2026-08-02T09:00:00Z');
const row = (over = {}) => ({ job: 'j', target: 't', ok: 1, detail: '', ran_at: '2026-08-02T06:00:00Z', ...over });

describe('check-heartbeats — the three ways to be red, and the one that matters most', () => {
  test('a fresh row saying ok=1 is the only pass', () => {
    const v = evaluateJob('j', [row()], 24, NOW);
    assert.equal(v.ok, true);
  });

  test('ABSENT — no row at all is a failure, not an empty success', () => {
    const v = evaluateJob('j', [], 24, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'absent');
    assert.match(v.reason, /has ever been written/);
  });

  test('ABSENT — a row older than 1.5x the interval is a failure', () => {
    const v = evaluateJob('j', [row({ ran_at: '2026-07-30T06:00:00Z' })], 24, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'absent');
    assert.match(v.reason, /The timer has stopped/);
  });

  test('the 1.5x ceiling is applied, not the raw interval — a single late run is not an alarm', () => {
    // 30 hours old against a 24h interval: past the interval, inside 1.5x.
    const v = evaluateJob('j', [row({ ran_at: '2026-08-01T03:00:00Z' })], 24, NOW);
    assert.equal(v.ok, true);
  });

  test('RED — a FRESH row whose outcome column says FAILED is the case a presence check would pass', () => {
    const v = evaluateJob('j', [row({ ok: 0, detail: 'HTTP 401 — REJECTED' })], 24, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'red');
    assert.match(v.reason, /FRESH and says the job FAILED/);
    assert.match(v.reason, /would be green on exactly this/);
  });

  test('RED — the detail and target travel with the failure so the log names the cause', () => {
    const v = evaluateJob('j', [row({ ok: 0, detail: 'no SUPABASE_ANON_KEY configured', target: 'https://x' })], 24, NOW);
    assert.match(v.reason, /no SUPABASE_ANON_KEY configured/);
    assert.match(v.reason, /target https:\/\/x/);
  });

  test('UNKNOWN — a non-array result fails closed', () => {
    const v = evaluateJob('j', null, 24, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unknown');
  });

  test('UNKNOWN — an unparseable timestamp fails closed rather than being ignored', () => {
    const v = evaluateJob('j', [row({ ran_at: 'yesterday-ish' })], 24, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unknown');
  });

  test('the NEWEST row decides, not the first one the query happened to return', () => {
    const rows = [row({ ran_at: '2026-07-01T06:00:00Z', ok: 1 }), row({ ran_at: '2026-08-02T06:00:00Z', ok: 0 })];
    assert.equal(evaluateJob('j', rows, 24, NOW).kind, 'red');
  });

  test('ok arriving as a string "0" is still a failure — D1 JSON types are not guaranteed', () => {
    assert.equal(evaluateJob('j', [row({ ok: '0' })], 24, NOW).kind, 'red');
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
      source: "export const KEEPALIVE_JOB = 'demo_job';\n",
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
    assert.equal(jobs[0].intervalHours, 24);
    assert.equal(jobs[0].databaseId, 'abc');
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

  test('the real register derives a watched set, and a healthy fixture passes', () => {
    const f = fixture({ supabase_keepalive: [row({ job: 'supabase_keepalive' })] });
    const r = run(f, '2026-08-02T09:00:00Z');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /watching 1 cron job\(s\) derived from tooling\/ops\/register\.json/);
  });

  test('the fixture mode announces itself loudly, so it can never pass unnoticed in a real log', () => {
    const f = fixture({ supabase_keepalive: [row({ job: 'supabase_keepalive' })] });
    assert.match(run(f, '2026-08-02T09:00:00Z').stdout, /OFFLINE FIXTURE MODE/);
  });

  test('a fresh-but-failed row exits non-zero through the real derivation', () => {
    const f = fixture({ supabase_keepalive: [row({ job: 'supabase_keepalive', ok: 0, detail: 'HTTP 401' })] });
    const r = run(f, '2026-08-02T09:00:00Z');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not reporting healthy/);
  });

  test('an empty result set exits non-zero through the real derivation', () => {
    const f = fixture({ supabase_keepalive: [] });
    assert.equal(run(f, '2026-08-02T09:00:00Z').status, 1);
  });

  test('an unreadable --now is refused rather than silently becoming "now"', () => {
    const f = fixture({ supabase_keepalive: [row({ job: 'supabase_keepalive' })] });
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
