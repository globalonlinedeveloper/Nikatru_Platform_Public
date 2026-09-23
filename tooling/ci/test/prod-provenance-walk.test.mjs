// ─────────────────────────────────────────────────────────────────────────────
// prod-provenance-walk.test.mjs — the WALK and the POINT READ of
// tooling/ops/check-prod-provenance.mjs ([pipeline B-17]'s monitor limb).
//
// A sibling of prod-provenance.test.mjs, not a section of it: that file was
// already 1399 lines when these cases were written (2026-09-23), past the
// 800-line line this repository draws for a test file.
//
// 🔴 WHY THESE EXIST. Ops watch run 35843108090 (2026-09-23 09:28Z) went red
// on 42 REAL rows — 14 consent_artifacts, 28 events, every one from a deploy-web
// run that exists (365, 395, 421, 424, 428). Its own log said why, and nothing
// read it:
//
//     walk · listing runs of deploy-web.yml: total_count 384 · fetched 439 · distinct 384 · 5 page(s)
//
// `collectPaged` kept the SMALLEST total_count any page claimed and refused
// only when distinct < that claim. 384 distinct against a claim of 384 passed,
// while 55 of the 439 rows served were repeats and 55 real runs were never
// served at all. The trial that motivated collectPaged in the first place
// (row O-PROVENANCE-WALK-HAS-NO-COMPLETENESS-CHECK) recorded
// `total_count=222 fetched=425 distinct=337 dupes=88` — and 337 >= 222, so the
// shipped check PASSED ITS OWN MOTIVATING TRIAL. Cases (a) and (b) below are
// those two walks, at their real numbers.
//
// The fix has two halves, and so does this file:
//   · THE WALK is complete only when it is internally consistent: one claim,
//     no row served twice, and as many distinct rows as claimed. Otherwise it
//     is walked again from page 1, a bounded number of times, and a walk that
//     never comes back consistent is COVERAGE LOST (exit 2). (a)–(e).
//   · A ROW IS CONVICTED ONLY AFTER ITS BUILD WAS LOOKED FOR DIRECTLY. Absence
//     from a listing is not a finding: the sha7 is read back to a commit and the
//     lanes are asked for runs at that commit. Found → accepted, and printed as
//     a contradiction of the walk. Not found → exit 1, as before. The lookup
//     refused or capped → exit 2. (f)–(h) and the cap.
//
// Every monitor case here runs OFFLINE through --rows-file / --runs-file /
// --point-reads-file. Nothing in this file reads, and nothing may ever write,
// production.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backoffPlan } from '../../ops/bounded-retry.mjs';
// A NAMESPACE import on purpose: against the code this file was written to
// fail, the new names do not exist yet, and a named import would refuse the
// whole module instead of letting each case show what it catches.
import * as monitor from '../../ops/check-prod-provenance.mjs';

const { collectPaged, CouldNotLook, formatWalk, WALK_ATTEMPTS, WALK_PAUSE_MS, POINT_READ_CAP } = monitor;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MONITOR = join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs');

/** A listing served as a sequence of ids, cut into pages of `perPage`, each
 *  page carrying the claim `claimOf(pageIndex)`. */
function pagesOf(ids, perPage, claimOf) {
  const out = [];
  for (let i = 0; i < ids.length; i += perPage) out.push({ rows: ids.slice(i, i + perPage).map((id) => ({ id })), totalCount: claimOf(out.length) });
  return out;
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** One walk at the production shape (100 a page, 10 pages), with `byAttempt`
 *  choosing the pages each attempt is served, and the pauses recorded instead
 *  of slept. */
function walkAt(byAttempt, { perPage = 100, pageCap = 10 } = {}) {
  const log = [];
  const slept = [];
  const done = collectPaged({
    what: 'listing runs of deploy-web.yml',
    idOf: (r) => r.id,
    perPage,
    pageCap,
    log,
    sleep: async (ms) => { slept.push(ms); },
    fetchPage: async (page, { attempt } = { attempt: 1 }) => byAttempt(attempt)[page - 1] ?? { rows: [] },
  });
  return { log, slept, done };
}

// ── THE WALK ─────────────────────────────────────────────────────────────────
describe('the walk — complete only when it is internally consistent', () => {
  // (a) TRIAL 1 of O-PROVENANCE-WALK-HAS-NO-COMPLETENESS-CHECK, at its real
  // numbers: total_count=222 fetched=425 distinct=337 dupes=88.
  const TRIAL_1 = pagesOf([...range(1, 337), ...range(250, 337)], 100, (i) => (i === 0 ? 222 : 425));

  test('(a) 🔴 the trial-1 walk — claims 222 then 425, 88 repeats — does NOT pass', async () => {
    assert.equal(TRIAL_1.reduce((n, p) => n + p.rows.length, 0), 425, 'the fixture is the recorded fetched count');
    const { done } = walkAt(() => TRIAL_1);
    await assert.rejects(done, (e) => {
      assert.ok(e instanceof CouldNotLook, `expected COVERAGE LOST, got ${e}`);
      assert.match(e.message, /attempt 1: total_count 222 → 425, fetched 425, distinct 337/);
      return true;
    });
  });

  // (b) OPS WATCH 35843108090, 2026-09-23 09:28Z, at its real numbers: every
  // page claimed 384, 439 rows were served, 384 of them distinct.
  const RUN_0928 = pagesOf([...range(1, 384), ...range(330, 384)], 100, () => 384);

  test('(b) 🔴 the 09:28Z walk — every page claims 384, 439 fetched, 384 distinct — does NOT pass', async () => {
    assert.equal(RUN_0928.length, 5, 'five pages, as the log said');
    assert.equal(RUN_0928.reduce((n, p) => n + p.rows.length, 0), 439);
    const { done } = walkAt(() => RUN_0928);
    await assert.rejects(done, (e) => {
      assert.ok(e instanceof CouldNotLook, `expected COVERAGE LOST, got ${e}`);
      assert.match(e.message, /attempt 1: total_count 384, fetched 439, distinct 384, 5 page\(s\)/);
      assert.match(e.message, /55 row\(s\) were served twice/);
      return true;
    });
  });

  test('(c) inconsistent on attempt 1, consistent on attempt 2: the re-walk is returned, and BOTH attempts print', async () => {
    const shifted = [{ rows: range(1, 10).map((id) => ({ id })), totalCount: 12 }, { rows: [10, 11, 12].map((id) => ({ id })), totalCount: 12 }];
    const clean = [{ rows: range(1, 10).map((id) => ({ id })), totalCount: 12 }, { rows: [11, 12].map((id) => ({ id })), totalCount: 12 }];
    const { log, slept, done } = walkAt((attempt) => (attempt === 1 ? shifted : clean), { perPage: 10, pageCap: 3 });
    assert.deepEqual((await done).map((r) => r.id), range(1, 12));
    assert.equal(log.length, 2, 'one log entry per attempt, the refused one included');
    assert.equal(log[0].consistent, false);
    assert.equal(log[1].consistent, true);
    assert.equal(typeof formatWalk, 'function', 'the walk line is one exported formatter, the one main() prints with');
    assert.match(
      formatWalk(log[0]),
      new RegExp(`^walk · listing runs of deploy-web\\.yml: total_count 12 · fetched 13 · distinct 12 · 2 page\\(s\\) · attempt 1/${WALK_ATTEMPTS} · INCONSISTENT — `),
    );
    assert.match(
      formatWalk(log[1]),
      new RegExp(`^walk · listing runs of deploy-web\\.yml: total_count 12 · fetched 12 · distinct 12 · 2 page\\(s\\) · attempt 2/${WALK_ATTEMPTS} · consistent$`),
    );
    assert.deepEqual(slept, [WALK_PAUSE_MS], 'one pause, before the second walk, and none after it');
  });

  test('(d) 🔴 inconsistent on EVERY attempt: COVERAGE LOST, naming each attempt\'s claim, fetched and distinct', async () => {
    const shifted = [{ rows: range(1, 10).map((id) => ({ id })), totalCount: 12 }, { rows: [10, 11, 12].map((id) => ({ id })), totalCount: 12 }];
    const { log, slept, done } = walkAt(() => shifted, { perPage: 10, pageCap: 3 });
    await assert.rejects(done, (e) => {
      assert.ok(e instanceof CouldNotLook, `expected COVERAGE LOST, got ${e}`);
      for (let a = 1; a <= WALK_ATTEMPTS; a++) assert.match(e.message, new RegExp(`attempt ${a}: total_count 12, fetched 13, distinct 12, 2 page\\(s\\)`));
      assert.match(e.message, new RegExp(`${WALK_ATTEMPTS} walk\\(s\\) from page 1`));
      return true;
    });
    assert.equal(log.length, WALK_ATTEMPTS, 'every attempt left its numbers behind');
    assert.deepEqual(slept, backoffPlan(WALK_ATTEMPTS, WALK_PAUSE_MS), 'the pauses are the shared backoff plan at the walk\'s own base');
  });

  test('(e) growth mid-walk — claim 438 then 439, one repeat — is simply re-walked, and the re-walk is whole', async () => {
    // Newest first. A run completes between page 1 and page 2: page 1 was cut
    // from the 438-row list (ids 2..439), pages 2-5 from the 439-row list
    // (ids 1..439), so id 101 is served twice and id 1 is never served.
    const grew = [
      { rows: range(2, 101).map((id) => ({ id })), totalCount: 438 },
      ...pagesOf(range(101, 439), 100, () => 439),
    ];
    const settled = pagesOf(range(1, 439), 100, () => 439);
    const { log, done } = walkAt((attempt) => (attempt === 1 ? grew : settled));
    const got = await done;
    assert.equal(got.length, 439, 'the run that completed mid-walk is in the answer');
    assert.equal(got[0].id, 1);
    assert.deepEqual(log[0].claims, [438, 439]);
    assert.equal(log[0].consistent, false, 'growth is not special-cased: the first walk is refused like any other shift');
    assert.equal(log[1].consistent, true);
  });

  test('the attempt count and the pause are named ONCE, and are small', () => {
    assert.ok(Number.isInteger(WALK_ATTEMPTS) && WALK_ATTEMPTS >= 2 && WALK_ATTEMPTS <= 5, `WALK_ATTEMPTS = ${WALK_ATTEMPTS}`);
    assert.ok(Number.isFinite(WALK_PAUSE_MS) && WALK_PAUSE_MS > 0 && WALK_PAUSE_MS <= 10_000, `WALK_PAUSE_MS = ${WALK_PAUSE_MS}`);
  });
});

// ── THE POINT READ ───────────────────────────────────────────────────────────
describe('the point read — absence from a listing is not a finding', () => {
  const RUNS = [{ run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab', conclusion: 'success' }];
  const FULL_428 = '428beef'.padEnd(40, '0');
  const FULL_424 = '424cafe'.padEnd(40, '1');

  /** The lanes the monitor itself reads, from the monitor itself. */
  const LANES = spawnSync(process.execPath, [MONITOR, '--root', REPO, '--emit-release-lanes'], { cwd: REPO, encoding: 'utf8' })
    .stdout.trim()
    .split('\n')
    .map((l) => l.split('\t')[0]);
  const runsAt = (workflow, full) => `actions/workflows/${workflow}/runs?head_sha=${full}&status=completed&per_page=100`;
  const commitOf = (full) => ({ status: 200, body: { sha: full } });
  const listing = (runs) => ({ status: 200, body: { total_count: runs.length, workflow_runs: runs } });
  /** Every lane answers "no run at this commit". */
  const noLaneHas = (full) => Object.fromEntries(LANES.map((wf) => [runsAt(wf, full), listing([])]));

  function run(rowsByTable, pointReads) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-point-read-'));
    try {
      const f = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
      const argv = [MONITOR, '--root', REPO, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', RUNS)];
      if (pointReads !== undefined) argv.push('--point-reads-file', f('point-reads.json', pointReads));
      return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('the lanes were read from the monitor', () => {
    assert.ok(LANES.includes('deploy-web.yml') && LANES.length >= 2, `lanes: ${LANES.join(', ')}`);
  });

  test('(f) THE 09:28Z ROWS: builds absent from the walk but found by a point read are ACCEPTED, and printed as such', () => {
    // 14 consent_artifacts + 28 events, the incident's own split.
    const r = run(
      { consent_artifacts: [{ marker: '1.0.428+428beef', n: 14 }], events: [{ marker: '1.0.424+424cafe', n: 28 }] },
      {
        'commits/428beef': commitOf(FULL_428),
        [runsAt('deploy-web.yml', FULL_428)]: listing([{ id: 9000428, run_number: 428, head_sha: FULL_428, conclusion: 'success' }]),
        'commits/424cafe': commitOf(FULL_424),
        [runsAt('deploy-web.yml', FULL_424)]: listing([{ id: 9000424, run_number: 424, head_sha: FULL_424, conclusion: 'success' }]),
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+14 row\(s\), 0 unattributable/);
    assert.match(r.stdout, /events\s+28 row\(s\), 0 unattributable/);
    assert.match(r.stdout, /point read · 1\.0\.428\+428beef: .*deploy-web\.yml run 428/);
    assert.match(r.stdout, /found a build the walked runs did not include: 1\.0\.428\+428beef/);
    assert.match(r.stdout, /point reads: 2 build\(s\) looked up, 2 found/);
  });

  test('(g) 🔴 a build absent from the walk AND from every lane at its commit is still unattributable — exit 1', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.428+428beef', n: 1 }] }, { 'commits/428beef': commitOf(FULL_428), ...noLaneHas(FULL_428) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no run numbered 428 exists on any release lane/);
    assert.match(r.stderr, /looked up directly: commit 428beef exists, and no release lane has a completed run numbered 428 at it/);
    assert.match(r.stdout, /point reads: 1 build\(s\) looked up, 0 found/);
  });

  test('(g) a sha that is no commit at all is unattributable after its lookup says so', () => {
    const r = run({ events: [{ marker: '1.0.9999+deadbee', n: 3 }] }, {});
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /looked up directly: deadbee is not a commit on this repository/);
  });

  test('(g) the guidance printed with a finding never tells anyone to delete a row', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.428+428beef', n: 1 }] }, { 'commits/428beef': commitOf(FULL_428), ...noLaneHas(FULL_428) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /\bdelet/i, 'these could be real people\'s consent records');
    assert.match(r.stderr, /a consent artifact or an event from a real person's build is a record to keep/);
  });

  test('(h) 🔴 a point read the API REFUSES is COVERAGE LOST — exit 2, never a finding', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.428+428beef', n: 14 }] }, { 'commits/428beef': { status: 403, body: { message: 'API rate limit exceeded' } } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK — point read · 1\.0\.428\+428beef: GET commits\/428beef answered 403/);
  });

  test('(h) 🔴 a lane listing that errors mid-lookup is COVERAGE LOST too', () => {
    const r = run(
      { consent_artifacts: [{ marker: '1.0.428+428beef', n: 1 }] },
      { 'commits/428beef': commitOf(FULL_428), ...noLaneHas(FULL_428), [runsAt('deploy-web.yml', FULL_428)]: { status: 502, body: null } },
    );
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK — point read · 1\.0\.428\+428beef: GET actions\/workflows\/deploy-web\.yml\/runs\?head_sha=428beef0+&status=completed&per_page=100 answered 502/);
  });

  test('🔴 more distinct missing builds than the cap is COVERAGE LOST, not a pile of findings', () => {
    const cap = Number.isInteger(POINT_READ_CAP) ? POINT_READ_CAP : 10;
    const rows = Array.from({ length: cap + 1 }, (_, i) => ({ marker: `1.0.${5000 + i}+${(0xabc0000 + i).toString(16)}`, n: 1 }));
    const r = run({ events: rows }, {});
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`${cap + 1} distinct build\\(s\\).*more than the ${cap} this reader will look up`, 's'));
  });

  test('a build the walk DID serve costs no point read', () => {
    const r = run({ consent_artifacts: [{ marker: '1.0.101+e138f5b', n: 1 }] }, {});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /point read · /);
    assert.match(r.stdout, /point reads: 0 build\(s\) looked up/);
  });
});
