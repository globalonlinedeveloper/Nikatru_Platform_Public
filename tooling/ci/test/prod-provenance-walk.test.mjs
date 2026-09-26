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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backoffPlan } from '../../ops/bounded-retry.mjs';
// A NAMESPACE import on purpose: against the code this file was written to
// fail, the new names do not exist yet, and a named import would refuse the
// whole module instead of letting each case show what it catches.
import * as monitor from '../../ops/check-prod-provenance.mjs';
import { databaseSources } from '../migration-tables.mjs';

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
  // ⏱ 2026-09-25 [ADR 095 §4]: a callee lane's stamp may carry its CALLER's run
  // number, so the point read also asks the caller (4th column), filtered to
  // push runs on main. "No lane has it" must answer every workflow read.
  const RUN_HOSTS = spawnSync(process.execPath, [MONITOR, '--root', REPO, '--emit-release-lanes'], { cwd: REPO, encoding: 'utf8' })
    .stdout.trim()
    .split('\n')
    .flatMap((l) => String(l.split('\t')[3] ?? '').split(',').slice(1));
  const callerRunsAt = (workflow, full) => `actions/workflows/${workflow}/runs?head_sha=${full}&branch=main&event=push&status=completed&per_page=100`;
  const noLaneHas = (full) => Object.fromEntries([
    ...LANES.map((wf) => [runsAt(wf, full), listing([])]),
    ...RUN_HOSTS.map((wf) => [callerRunsAt(wf, full), listing([])]),
  ]);

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

// ── ⏱ 2026-09-25 [ADR 095 §4] · A CALLEE LANE IS POINT-READ IN ITS CALLER TOO ──
// Once deploy-web.yml is `workflow_call`-only, a stamp's run number is ci.yml's,
// so the point read lists the lane's own file and then its caller's
// `branch=main&event=push` runs at the commit, and names the workflow it found
// the run in. A copy of the monitor's offline inputs carries that tree.
describe('the point read — a callee lane is looked up in its caller\'s runs', () => {
  const RUNS = [{ run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab', conclusion: 'success' }];
  const FULL_C = 'c1c2c3c4'.padEnd(40, '2');
  const CHANNELS = 'tooling/channel-register.json';
  const STUB = 'name: Stub\non:\n  workflow_dispatch:\njobs:\n  one:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: echo stub\n';
  const CI = [
    'name: CI', 'on:', '  push:', '    branches: [main]', '  pull_request:', 'jobs:',
    '  gate:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 5', '    steps:', '      - run: echo gate',
    '  deploy-web:', '    needs: gate', "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    '    uses: ./.github/workflows/deploy-web.yml', '',
  ].join('\n');
  const CALLEE = [
    'name: Deploy web', 'on:', '  workflow_call:', 'jobs:',
    '  deploy:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 5', '    steps:', '      - run: echo deploy', '',
  ].join('\n');
  const commitOf = (full) => ({ status: 200, body: { sha: full } });
  const listing = (runs) => ({ status: 200, body: { total_count: runs.length, workflow_runs: runs } });
  const ownAt = (workflow, full) => `actions/workflows/${workflow}/runs?head_sha=${full}&status=completed&per_page=100`;
  const ciAt = (full) => `actions/workflows/ci.yml/runs?head_sha=${full}&branch=main&event=push&status=completed&per_page=100`;

  function calleeRoot() {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-point-read-callee-'));
    mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
    mkdirSync(join(root, 'catalog'), { recursive: true });
    for (const f of ['tooling/prod-provenance.json', CHANNELS, 'tooling/legal/provider-register.json', 'catalog/apps.json']) {
      cpSync(join(REPO, f), join(root, f));
    }
    cpSync(join(REPO, 'services/platform/migrations'), join(root, 'services/platform/migrations'), { recursive: true });
    // ⏱ 2026-09-26 — the monitor derives its databases from the platform register and each Worker's
    // wrangler config, and enumerates every one of them (O-PROVENANCE-WALKS-ONE-DATABASE).
    for (const rel of databaseSources(REPO)) cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    cpSync(join(REPO, 'services/platform/src'), join(root, 'services/platform/src'), { recursive: true });
    for (const e of readdirSync(join(REPO, 'apps'), { withFileTypes: true })) {
      const src = join(REPO, 'apps', e.name, 'pubspec.yaml');
      if (!e.isDirectory() || !existsSync(src)) continue;
      mkdirSync(join(root, 'apps', e.name), { recursive: true });
      cpSync(src, join(root, 'apps', e.name, 'pubspec.yaml'));
    }
    const dir = join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    for (const c of JSON.parse(readFileSync(join(REPO, CHANNELS), 'utf8')).channels ?? []) {
      for (const p of [c?.lane?.workflow, c?.submission?.workflow]) if (typeof p === 'string') writeFileSync(join(dir, p.split('/').pop()), STUB);
    }
    writeFileSync(join(dir, 'deploy-web.yml'), CALLEE);
    writeFileSync(join(dir, 'ci.yml'), CI);
    return root;
  }

  function run(root, rowsByTable, pointReads) {
    const f = (name, v) => { const p = join(root, name); writeFileSync(p, JSON.stringify(v)); return p; };
    const argv = [MONITOR, '--root', root, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', RUNS)];
    argv.push('--point-reads-file', f('point-reads.json', pointReads));
    return spawnSync(process.execPath, argv, { cwd: REPO, encoding: 'utf8' });
  }

  /** Every lane but deploy-web answers "no run at this commit", in its own file. */
  function otherLanesEmpty(root, full) {
    const lanes = spawnSync(process.execPath, [MONITOR, '--root', root, '--emit-release-lanes'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(lanes.status, 0, lanes.stdout + lanes.stderr);
    const rows = lanes.stdout.trim().split('\n').map((l) => l.trim().split('\t'));
    assert.equal(rows.find((c) => c[0] === 'deploy-web.yml')?.[3], 'deploy-web.yml,ci.yml', lanes.stdout);
    return Object.fromEntries(rows.filter((c) => c[0] !== 'deploy-web.yml').map((c) => [ownAt(c[0], full), listing([])]));
  }

  test('(i) a stamp carrying ci.yml\'s run number is FOUND in ci.yml, after deploy-web.yml\'s own listing', () => {
    const root = calleeRoot();
    try {
      const r = run(root, { consent_artifacts: [{ marker: '1.0.3850+c1c2c3c', n: 1 }] }, {
        'commits/c1c2c3c': commitOf(FULL_C),
        [ownAt('deploy-web.yml', FULL_C)]: listing([]),
        [ciAt(FULL_C)]: listing([{ id: 38500000001, run_number: 3850, head_sha: FULL_C, conclusion: 'success' }]),
        ...otherLanesEmpty(root, FULL_C),
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(
        r.stdout,
        /point read · 1\.0\.3850\+c1c2c3c: GET commits\/c1c2c3c → 200 · GET actions\/workflows\/deploy-web\.yml\/runs\?[^ ]* → 200 · GET actions\/workflows\/ci\.yml\/runs\?head_sha=c1c2c3c4[0-9]*&branch=main&event=push&[^ ]* → 200 → FOUND ci\.yml run 3850/,
      );
      assert.match(r.stdout, /host-resolved build accepted: 1\.0\.3850\+c1c2c3c — resolved in ci\.yml run 3850/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('(i) 🔴 a ci.yml run 3850 at ANOTHER head is not the run — the stamp stays unattributable, exit 1', () => {
    const root = calleeRoot();
    try {
      const r = run(root, { consent_artifacts: [{ marker: '1.0.3850+c1c2c3c', n: 1 }] }, {
        'commits/c1c2c3c': commitOf(FULL_C),
        [ownAt('deploy-web.yml', FULL_C)]: listing([]),
        [ciAt(FULL_C)]: listing([{ id: 38500000009, run_number: 3850, head_sha: 'd1d2d3d4'.padEnd(40, '3'), conclusion: 'success' }]),
        ...otherLanesEmpty(root, FULL_C),
      });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /no release lane has a completed run numbered 3850 at it \(the completed runs at it: ci\.yml run 3850\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
