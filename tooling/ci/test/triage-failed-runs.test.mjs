// ─────────────────────────────────────────────────────────────────────────────
// triage-failed-runs.test.mjs — the ledger's UNEXPLAINED count moves when the
// classifier loses a signature, and only then.
//
// 🔴 THE CLAIM UNDER TEST IS "UNEXPLAINED: 0 MEANS EVERY RUN WAS ACCOUNTED
// FOR", and a ledger that printed 0 over a fixture where nothing could match
// would be consistent with a classifier that explains everything by never
// looking. So the proof is a PAIR: the same fixture through the real signature
// table answers 0 (the green control), and through a table with ONE known
// signature removed — first in-process, then as a textual mutation of a COPY
// of the script — answers 1, naming the exact run that lost its group. The
// original file is asserted untouched afterwards: the mutation is restored by
// never having been applied to it.
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. Every CLI case runs through
// the fixture transport, which has no `fetch` in it. The live-shaped cases
// assert exits that come before any transport is built: "no credential"
// (the token withheld, the vault pointed at an absent file), and the
// merge-base refusal (its child process has `fetch` replaced by a thrower).
//
// Run:  node --test tooling/ci/test/triage-failed-runs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  NON_GREEN,
  GATE_STEP,
  SIGNATURES,
  CAUSES_REL,
  stripPrefix,
  scopeToStep,
  errorBlock,
  signatureOf,
  normalise,
  classifyRun,
  newerRunDuring,
  loadCauses,
  validateCauses,
  FIXED_BY_FIELDS,
  mergeShas,
  checkFixesOnMain,
  causeFor,
  proofFor,
  isExplained,
  groupRows,
  renderTable,
  parseArgs,
  ledger,
  fixtureApi,
  CoverageLost,
  readThroughCache,
  isValidGithubToken,
  credentialShape,
  isValidRepoSlug,
  isAllowedApiPath,
  liveApi,
  quotaFloor,
  QUOTA_FLOOR,
  DEFAULT_MAX_REQUESTS,
  newestCompleted,
  selfRunIdFrom,
} from '../../ops/triage-failed-runs.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'triage-failed-runs.mjs');
const SAFE_RERUN = join(REPO, 'tooling', 'ops', 'safe-rerun.mjs');
// A COPY of the script lives in a temp dir, so both sibling imports are
// re-pointed at the real files.
const BOUNDED_RETRY = join(REPO, 'tooling', 'ops', 'bounded-retry.mjs');

const temps = [];
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'triage-failed-runs-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* a leaked temp dir must never fail a suite */
    }
  }
});

/** Run a script with an environment built FROM SCRATCH — same reason as
 *  await-pr-checks.test.mjs: the script falls back to the local vault for a
 *  token, so an inherited environment would mean "no credential" on CI and
 *  "a real credential" on the owner's laptop. */
function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NIKATRU_VAULT: join(temp(), 'absent.env'),
      ...env,
    },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FIXTURE — four runs, four shapes, every one explained by the real table
// ═══════════════════════════════════════════════════════════════════════════
const CI = '.github/workflows/ci.yml';
const OPS = '.github/workflows/ops-watch.yml';
const T = (s) => `2026-09-09T${s}Z`;
const line = (ts, text) => `${T(ts)} ${text}`;

const step = (name, conclusion, a, b) => ({ name, conclusion, started_at: T(a), completed_at: T(b) });

function fixture(dir, { causes = CAUSES, signatureMutation = null } = {}) {
  const runs = [
    // R1 — a guard caught START-HERE drift on a feature branch, since merged.
    { id: 1001, path: CI, workflow_id: 1, head_branch: 'feat-a', head_sha: 'aaaaaaaa1', event: 'pull_request', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:06:00') },
    // R2 — ops-watch on main, the RED-SINCE livelock.
    { id: 1002, path: OPS, workflow_id: 2, head_branch: 'main', head_sha: 'bbbbbbbb2', event: 'schedule', conclusion: 'failure', created_at: T('11:00:00'), updated_at: T('11:03:00') },
    // R3 — cancelled by a newer push to the same ref while still running.
    { id: 1003, path: CI, workflow_id: 1, head_branch: 'feat-b', head_sha: 'cccccccc3', event: 'pull_request', conclusion: 'cancelled', created_at: T('12:00:00'), updated_at: T('12:03:00') },
    // R4 — the newer push: dart format, then fixed, then green (R5, in newest.json).
    { id: 1004, path: CI, workflow_id: 1, head_branch: 'feat-b', head_sha: 'dddddddd4', event: 'pull_request', conclusion: 'failure', created_at: T('12:01:00'), updated_at: T('12:07:00') },
  ];
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(join(dir, 'repo.json'), JSON.stringify({ repo: 'fixture/fixture' }));

  // R1 jobs: one guard lane red at START-HERE, ci-gate red downstream.
  writeFileSync(
    join(dir, '1001.jobs.json'),
    JSON.stringify({
      total_count: 2,
      jobs: [
        { id: 51, name: 'Guards — platform, data and ops', conclusion: 'failure', steps: [step('Checkout', 'success', '10:00:10', '10:00:20'), step('The guards must be able to fail', 'success', '10:00:20', '10:01:00'), step('START-HERE.md is what the tree generates', 'failure', '10:01:00', '10:01:30')] },
        { id: 52, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '10:05:00', '10:05:10')] },
      ],
    }),
  );
  writeFileSync(
    join(dir, '1001.job-51.log'),
    [
      line('10:00:30.0000000', '  ✔ a NON-ZERO exit prints the guard output unfiltered — the filter drops every `✗` line (0.2ms)'),
      line('10:00:40.0000000', '  ✗ COVERAGE LOST — a fixture printed by a PASSING negative test, which must NOT be read as the failure'),
      line('10:01:05.0000000', 'gen-start-here — 2118 tracked file(s), 9 top dir(s), 165 guard(s), ci-gate needs 14 job(s)'),
      line('10:01:06.0000000', '  START-HERE.md would be 3713 bytes (cap 4096)'),
      line('10:01:07.0000000', '  START-HERE.md is STALE: regenerate it with node tooling/scripts/gen-start-here.mjs'),
      line('10:01:08.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );
  writeFileSync(join(dir, '1001.job-52.log'), line('10:05:05.0000000', '##[error]One or more CI lanes failed'));

  // R2 jobs: the register reader.
  writeFileSync(
    join(dir, '1002.jobs.json'),
    JSON.stringify({
      total_count: 1,
      jobs: [{ id: 61, name: 'The register', conclusion: 'failure', steps: [step('The whole ops register — every duty, not just the heartbeat-backed ones', 'failure', '11:00:10', '11:02:00')] }],
    }),
  );
  writeFileSync(
    join(dir, '1002.job-61.log'),
    [
      line('11:01:00.0000000', '✗ tooling/ops/register.json — 1 problem(s):'),
      line('11:01:00.0000000', ''),
      line('11:01:00.0000000', '    duty.workflow.ops-watch.yml — RED SINCE 2026-09-09T09:58:00Z: ops-watch.yml on main run 34330000000 FAILED, and the newest SUCCESSFUL run on that branch is run 34320000000 at 2026-09-09T05:50:00Z, 4.1h EARLIER.'),
      line('11:01:01.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );

  // R3 jobs: every lane cancelled a few seconds in, no logs at all.
  writeFileSync(
    join(dir, '1003.jobs.json'),
    JSON.stringify({
      total_count: 2,
      jobs: [
        { id: 71, name: 'Workspace gate', conclusion: 'cancelled', steps: [step('Run actions/checkout', 'cancelled', '12:00:10', '12:00:16')] },
        { id: 72, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '12:02:00', '12:02:05')] },
      ],
    }),
  );

  // R4 jobs: dart format.
  writeFileSync(
    join(dir, '1004.jobs.json'),
    JSON.stringify({
      total_count: 1,
      jobs: [{ id: 81, name: 'Workspace gate (melos analyze + test)', conclusion: 'failure', steps: [step('The shipping app is dart format-clean', 'failure', '12:03:00', '12:03:30')] }],
    }),
  );
  writeFileSync(
    join(dir, '1004.job-81.log'),
    [
      line('12:03:10.0000000', 'Changed apps/subly/lib/state/analytics_providers.dart'),
      line('12:03:11.0000000', 'Formatted 154 files (1 changed) in 0.69 seconds.'),
      line('12:03:12.0000000', '##[error]Process completed with exit code 1.'),
    ].join('\n'),
  );

  writeFileSync(
    join(dir, 'newest.json'),
    JSON.stringify({
      [`${CI}|feat-a`]: runs[0],
      [`${OPS}|main`]: { id: 1099, conclusion: 'success', created_at: T('13:00:00') },
      [`${CI}|feat-b`]: { id: 1005, conclusion: 'success', created_at: T('12:30:00') },
    }),
  );
  // R4 is R3's successor in the concurrency group — and it is what the API
  // answers for "runs of ci.yml on feat-b created while R3 lived".
  writeFileSync(join(dir, 'between-1003.json'), JSON.stringify([runs[3]]));
  writeFileSync(join(dir, 'branches.json'), JSON.stringify(['main', 'feat-b']));
  writeFileSync(join(dir, 'prs.json'), JSON.stringify({ 'feat-a': { number: 606, merged_at: T('17:53:54'), merge_commit_sha: '74bf73d4deadbeef' } }));
  writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes }));
  return { dir, runs };
}

const CAUSES = [
  { signature: 'start-here:drift', rootCause: 'START-HERE.md counted whole-tree files, so any branch adding a test drifted it.', fix: 'PR #606 74bf73d4', fixedBy: { kind: 'merge', sha: '74bf73d4', pr: 606 } },
  { signature: 'ops-register:red-since:*', rootCause: 'The RED-SINCE verdict failed the gate its own remedy needed.', fix: 'PR #593 846d90a0', fixedBy: { kind: 'merge', sha: '846d90a0', pr: 593 } },
  { signature: 'cancelled:superseded-in-group', rootCause: 'A newer push to the same ref evicted the in-flight run (cancel-in-progress).', fix: 'not a defect; superseded by the newer run', fixedBy: { kind: 'not-a-defect', reason: 'superseded by the newer run' } },
  { signature: 'cancelled:by-hand-or-unknown', rootCause: 'Cancelled with no successor in its concurrency group.', fix: 'not a defect; no verdict rendered', fixedBy: { kind: 'not-a-defect', reason: 'no verdict rendered' } },
  { signature: 'dart:format', rootCause: 'A Dart file in the PR was not format-clean; the log names it.', fix: 'superseded: fixed on the branch before merge', fixedBy: { kind: 'superseded', by: 'fixed on the branch before merge' } },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('log reading', () => {
  test('stripPrefix removes the gh job/step prefix AND the bare API timestamp', () => {
    assert.equal(stripPrefix('ci-gate\tRequire all lanes green\t2026-09-09T10:00:00.1234567Z ##[error]x'), '##[error]x');
    assert.equal(stripPrefix('2026-09-09T10:00:00.1234567Z ✗ y'), '✗ y');
    assert.equal(stripPrefix('no prefix at all'), 'no prefix at all');
  });

  test('scopeToStep keeps only the lines inside the step window (API format)', () => {
    const lines = [line('10:00:40.0000000', '✗ earlier'), line('10:01:05.0000000', 'inside'), line('10:02:00.0000000', 'after')];
    const s = step('x', 'failure', '10:01:00', '10:01:30');
    assert.deepEqual(scopeToStep(lines, s).map(stripPrefix), ['inside']);
  });

  test('scopeToStep prefers the gh step-name prefix when present', () => {
    const lines = ['job\tother step\t2026-09-09T10:01:05Z ✗ no', 'job\tmine\t2026-09-09T10:01:06Z yes'];
    assert.deepEqual(scopeToStep(lines, { name: 'mine' }).map(stripPrefix), ['yes']);
  });

  test('scopeToStep of a step that never started is EMPTY, not the whole log', () => {
    assert.deepEqual(scopeToStep([line('10:00:00.0000000', 'x')], { name: 'never', started_at: null, completed_at: null }), []);
  });

  test('errorBlock: a ✔ line that MENTIONS ✗ is not the error; the ✗-at-start line is', () => {
    const eb = errorBlock(['  ✔ drops every `✗` line', '  ✗ COVERAGE LOST — real', '  detail']);
    assert.equal(eb.line, '✗ COVERAGE LOST — real');
    assert.match(eb.block, /detail/);
  });

  test('errorBlock: the generic exit line carries the three lines before it as context', () => {
    const eb = errorBlock(['a', 'b', 'Changed foo.dart', 'Formatted 3 files', '##[error]Process completed with exit code 1.']);
    assert.equal(eb.line, '##[error]Process completed with exit code 1.');
    assert.match(eb.block, /Changed foo\.dart/);
    assert.doesNotMatch(eb.block, /^a\n/);
  });

  test('errorBlock: a specific ##[error] beats a FAILED word that comes earlier', () => {
    const eb = errorBlock(['assert-x: FAILED', '##[error]API rate limit exceeded for installation']);
    assert.equal(eb.line, '##[error]API rate limit exceeded for installation');
  });

  test('errorBlock over nothing is "(no error line)"', () => {
    assert.equal(errorBlock([]).line, '(no error line)');
  });
});

describe('signatures', () => {
  test('the register header is NOT the signature — the duty on the next line is', () => {
    const block = '✗ tooling/ops/register.json — 2 problem(s):\n\n    duty.workflow.build-platforms.yml — RED SINCE 2026-09-08T00:00:00Z: …';
    assert.equal(signatureOf({ step: 'x', block }), 'ops-register:red-since:duty.workflow.build-platforms.yml');
  });

  test('an unregistered route groups per ROUTE', () => {
    const block = '✗ platform register — 1 problem(s):\n    GET /v1/entitlements/subject — MOUNTED by services/platform/src/routes/entitlements.ts and absent from the register.';
    assert.equal(signatureOf({ step: 'x', block }), 'platform-register:unregistered-route:GET /v1/entitlements/subject');
  });

  test('the shared quota 403 is one group whichever guard tripped on it', () => {
    assert.equal(signatureOf({ step: 'Analyze', block: '##[error]API rate limit exceeded for installation. If you reach out …' }), 'github-api:403-installation-quota');
    assert.equal(signatureOf({ step: 'weekly', block: '##[error]proof-fresh COVERAGE LOST — GitHub API returned 403 for /repos/x' }), 'github-api:403-installation-quota');
  });

  test('the alert-disposition 403 is its OWN group (it was graded as a finding, and that was the defect)', () => {
    const block = '✗ limb A — a declared firing history could not be enumerated: GitHub API returned 403 for /repos/x';
    assert.equal(signatureOf({ step: 'Every alerting firing has a recorded disposition', block }), 'ops-register:alert-disposition-403');
  });

  test('a step name alone can be the signature (START-HERE, OSV)', () => {
    assert.equal(signatureOf({ step: 'START-HERE.md is what the tree generates', block: 'gen-start-here — …' }), 'start-here:drift');
    assert.equal(signatureOf({ step: 'Known-vulnerable dependencies, INCLUDING the Dart ones', block: '| https://osv.dev/GHSA-x |' }), 'osv:known-vulnerable');
  });

  test('`<guard>: FAILED` groups per guard', () => {
    assert.equal(signatureOf({ step: 'x', block: 'assert-app-dod: FAILED' }), 'guard-failed:assert-app-dod');
  });

  test('nothing matched → `other:` carrying the normalised step and first line, so it can never be explained by accident', () => {
    const sig = signatureOf({ step: 'Some new step 42', block: 'boom at 2026-09-09T10:00:00Z in deadbeef12' });
    assert.match(sig, /^other:Some new step <n>:boom at <ts> in <sha>$/);
  });

  test('normalise folds shas, timestamps, durations and counts', () => {
    assert.equal(normalise('run 34330000000 at 2026-09-09T05:50:00Z, 4.1h EARLIER deadbeef1'), 'run <n> at <ts>, <dur> EARLIER <sha>');
  });

  // ⏱ 2026-09-26 (O-FAILURE-LEDGER-UNEXPLAINED-BEFORE-MONDAY): each block below
  // is the measured first lines of the run named beside it, which read as
  // `other:` (no cause may claim that) or as a quote before these entries.
  test('the 2026-09-26 signatures read the measured blocks of the runs that needed them', () => {
    const cases = [
      // 36206329284: a red ledger's block quotes a simulator refusal and a register duty.
      [
        'Every failed run of the last eight days, and the recorded cause it maps to',
        '##[error]The register names "iPhone <n> Pro Max" and this runner image has no available simulator by that name. Apple\'s  | 1 (1 UNEXPLAINED) | — NO CAUSE IN REGISTER — | — | OPEN\n✗ tooling/ops/register.json — 1 problem(s):\n      signature: ops-register:red-since:duty.workflow.ops-watch.yml · no later green\nUNEXPLAINED: 63',
        'failure-ledger:unexplained',
      ],
      ['Every failed run of the last eight days, and the recorded cause it maps to', '✗ COVERAGE LOST — the GitHub credential does not have the shape of a GitHub token (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_/40-hex), so it was not sent.', 'failure-ledger:credential-unshaped'],
      ['Count the rows whose provenance does not resolve', '✗ COULD NOT LOOK — listing runs of ci.yml (branch=main&event=push): all 10 pages of 100 came back full, so rows exist that this reader never asked for', 'provenance:run-listing-capped'],
      ['Probe every surface the register enumerates', '✗ COVERAGE LOST — 1 of 11 probed surface(s) NEVER ANSWERED, on any of the 3 attempts:', 'surfaces:never-answered'],
      ['Compare the live Supabase auth config against tooling/mail-transport.json', '✗ auth `sessions_timebox`: register says null, live says 0.\n  ✗ auth `sessions_inactivity_timeout`: register says null, live says 0.', 'supabase-auth:session-limit-null-read-as-drift'],
      ['Create and finalize the GlitchTip release', 'error: Failed to create release: POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522 <unknown status code>: error code: 522', 'glitchtip:release-create-5xx'],
      ['The captured frames carry drawn text', '✗ COVERAGE LOST — screenshots/00-consent.png is 1600x881; the floor in tooling/e2e-leg-register.json framesCarryText was measured on frames 430 wide.', 'e2e:frames-wrong-size'],
      ['Preflight — a rehearsal target may not run on the default branch', '##[error]auth_target=boxa is a REHEARSAL against a stack the deployed Workers deliberately refuse, and this dispatch is on main. duty.workflow.e2e.yml grades', 'e2e:rehearsal-refused-on-main'],
      ['The store service account is still powerless on GCP', '✗ 🔓 serviceusage — list enabled APIs SUCCEEDED. nikatru-free-api@nikatru-platform.iam.gserviceaccount.com can now read project state on GCP, so it has been granted an IAM role since 2026-08-05.', 'gcp-scope:store-account-holds-a-role'],
      [
        "Every Pages project's newest PRODUCTION deployment succeeded, at the commit main names",
        '✗ 1 project(s) RED, 0 NOT JUDGED.\n    ✗   rajasekarselvam (git) — the newest production deployment 973e96da-edd7-43d7-ba11-93e5e33ad1ae stopped at stage `build` with status `active`. Production is therefore still serving the PREVIOUS build',
        'pages-freshness:in-flight-read-as-failure',
      ],
      ["Every Pages project's newest PRODUCTION deployment succeeded, at the commit main names", '✗ 0 project(s) RED, 1 NOT JUDGED.\n    ?   nikatru (git) — TypeError: fetch failed\n    ok  rajasekarselvam (git) — deployment 4d6c5dfd succeeded', 'pages-freshness:read-dropped'],
      [
        "Every Pages project's newest PRODUCTION deployment succeeded, at the commit main names",
        '✗ 1 project(s) RED, 0 NOT JUDGED.\n    ✗   nikatru (git) — the newest production deployment 57e2d2f9-a0bc-45a4-bc97-1736e7941f21 stopped at stage `initialize` with status `failure`. Production is therefore',
        'pages-freshness:git-build-failed:initialize',
      ],
      ['Boot the simulators the register names', '##[error]The register names "iPhone 16 Pro Max" and this runner image has no available simulator by that name.', 'store-screenshots:simulator-aged-out'],
    ];
    for (const [step, block, want] of cases) assert.equal(signatureOf({ step, block }), want, `${step}\n${block}`);
    // The ledger's own verdict is read only on its own step: the same block
    // under any other step is never taken for a ledger verdict.
    assert.notEqual(signatureOf({ step: 'Boot the simulators the register names', block: cases[0][1] }), 'failure-ledger:unexplained');
    // A Pages build Cloudflare failed at a stage other than `initialize` is its own group.
    assert.equal(signatureOf({ step: cases[11][0], block: cases[11][1].replace('`initialize`', '`build`') }), 'pages-freshness:git-build-failed:build');
  });

  test('every signature id is unique and every pattern is a RegExp', () => {
    const ids = SIGNATURES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SIGNATURES) assert.ok(s.re instanceof RegExp, s.id);
  });
});

describe('rows', () => {
  test('NON_GREEN is exactly the four conclusions the ledger ranges over', () => {
    assert.deepEqual([...NON_GREEN].sort(), ['cancelled', 'failure', 'startup_failure', 'timed_out']);
  });

  test('the aggregator is dropped when a real lane failed; alone, it is `gate-only`', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:05:00') };
    const gate = { id: 2, name: 'ci-gate', conclusion: 'failure', steps: [step('Require all lanes green', 'failure', '10:04:00', '10:04:10')] };
    const lane = { id: 3, name: 'lane', conclusion: 'failure', steps: [step('START-HERE.md is what the tree generates', 'failure', '10:01:00', '10:01:30')] };
    assert.ok(GATE_STEP.test('Require all lanes green'));
    const withLane = classifyRun(run, [gate, lane], () => [line('10:01:05.0000000', 'gen-start-here — x')]);
    assert.equal(withLane.signature, 'start-here:drift');
    assert.equal(withLane.job, 'lane');
    const alone = classifyRun(run, [gate], () => [line('10:04:05.0000000', '##[error]One or more CI lanes failed')]);
    assert.equal(alone.signature, 'gate-only');
  });

  test('a cancelled run is `superseded-in-group` only when a newer run of the same workflow+ref began while it ran', () => {
    const a = { id: 1, path: CI, head_branch: 'b', created_at: T('10:00:00'), updated_at: T('10:03:00') };
    const during = { id: 2, path: CI, head_branch: 'b', created_at: T('10:01:00'), updated_at: T('10:08:00') };
    const later = { id: 3, path: CI, head_branch: 'b', created_at: T('10:30:00'), updated_at: T('10:38:00') };
    const otherRef = { id: 4, path: CI, head_branch: 'c', created_at: T('10:01:00'), updated_at: T('10:08:00') };
    assert.equal(newerRunDuring(a, [a, during]), true);
    assert.equal(newerRunDuring(a, [a, later]), false);
    assert.equal(newerRunDuring(a, [a, otherRef]), false);
    const run = { ...a, head_sha: 'x', conclusion: 'cancelled' };
    const job = { id: 9, name: 'lane', conclusion: 'cancelled', steps: [step('Run checkout', 'cancelled', '10:00:10', '10:00:16')] };
    assert.equal(classifyRun(run, [job], () => [], { newerRunExists: true }).signature, 'cancelled:superseded-in-group');
    assert.equal(classifyRun(run, [job], () => [], { newerRunExists: false }).signature, 'cancelled:by-hand-or-unknown');
  });

  test('a run with no failing job at all is `startup:<conclusion>` or a cancellation', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'startup_failure', created_at: T('10:00:00'), updated_at: T('10:00:01') };
    assert.equal(classifyRun(run, [], () => []).signature, 'startup:startup_failure');
    assert.equal(classifyRun({ ...run, conclusion: 'cancelled' }, [], () => []).signature, 'cancelled:by-hand-or-unknown');
  });

  test('several real lanes failing is ONE row, the others listed in alsoFailed', () => {
    const run = { id: 1, path: CI, head_branch: 'b', head_sha: 'x', conclusion: 'failure', created_at: T('10:00:00'), updated_at: T('10:05:00') };
    const j = (id, name, s) => ({ id, name, conclusion: 'failure', steps: [step(s, 'failure', '10:01:00', '10:01:30')] });
    const row = classifyRun(run, [j(1, 'A', 'Build windows'), j(2, 'B', 'Build macos'), j(3, 'C', 'Build linux')], () => []);
    assert.equal(row.job, 'A');
    assert.deepEqual(row.alsoFailed, ['B › Build macos', 'C › Build linux']);
  });
});

describe('causes and proof', () => {
  test('causeFor: exact beats prefix, longest prefix beats shorter', () => {
    const causes = [
      { signature: 'ops-register:*', rootCause: 'wide', fix: 'x' },
      { signature: 'ops-register:red-since:*', rootCause: 'narrow', fix: 'x' },
      { signature: 'ops-register:red-since:duty.workflow.e2e.yml', rootCause: 'exact', fix: 'x' },
    ];
    assert.equal(causeFor('ops-register:red-since:duty.workflow.e2e.yml', causes).rootCause, 'exact');
    assert.equal(causeFor('ops-register:red-since:duty.workflow.ci.yml', causes).rootCause, 'narrow');
    assert.equal(causeFor('ops-register:other', causes).rootCause, 'wide');
    assert.equal(causeFor('other:x', causes), null);
  });

  test('causeFor: a feature-branch-scoped cause never explains a red run ON main, and vice versa', () => {
    const causes = [
      { signature: 'dart:format', rootCause: 'fixed on the branch', fix: 'superseded', scope: 'feature-branches' },
      { signature: 'guard-test:*', rootCause: 'on main', fix: 'sha', scope: 'main' },
    ];
    assert.equal(causeFor('dart:format', causes, 'feat-x').rootCause, 'fixed on the branch');
    assert.equal(causeFor('dart:format', causes, 'main'), null);
    assert.equal(causeFor('guard-test:x', causes, 'main').rootCause, 'on main');
    assert.equal(causeFor('guard-test:x', causes, 'feat-x'), null);
  });

  test('a cancelled run with NO successor inside its window is by-hand, not superseded', () => {
    const { dir, runs } = fixture(temp());
    rmSync(join(dir, 'between-1003.json'));
    // R4 is itself in the non-green list; move it past R3's window so nothing
    // — neither the API answer nor the enumeration — started while R3 lived.
    runs[3].created_at = T('12:05:00');
    writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /cancelled:by-hand-or-unknown \| 1 \| /);
    assert.doesNotMatch(r.out, /cancelled:superseded-in-group/);
  });

  test('proofFor: later green > branch gone (with PR) > OPEN', () => {
    const row = { workflowPath: CI, workflow: 'ci.yml', branch: 'b' };
    const ctx = (newestRun, alive, pr) => ({ newest: new Map([[`${CI}|b`, newestRun]]), branches: new Set(alive ? ['b'] : []), prs: new Map(pr ? [['b', pr]] : []) });
    assert.equal(proofFor(row, ctx({ id: 9, conclusion: 'success', created_at: 't' }, true)).kind, 'later-green');
    const gone = proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, false, { number: 12, merged_at: 't', merge_commit_sha: 'abcdef1234' }));
    assert.equal(gone.kind, 'branch-gone');
    assert.match(gone.text, /PR #12 merged abcdef12/);
    assert.match(proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, false, { number: 13 })).text, /closed unmerged/);
    const open = proofFor(row, ctx({ id: 9, conclusion: 'failure', created_at: 't' }, true));
    assert.equal(open.kind, 'none');
    assert.match(open.text, /^OPEN/);
  });

  test('explained is a CONJUNCTION: a cause without proof is open, proof without a cause is unnamed', () => {
    const cause = { signature: 'x', rootCause: 'r', fix: 'f' };
    assert.equal(isExplained(cause, { kind: 'later-green' }), true);
    assert.equal(isExplained(cause, { kind: 'none' }), false);
    assert.equal(isExplained(null, { kind: 'later-green' }), false);
  });

  test('the REAL causes register parses and every entry names a signature, a root cause and a fix', () => {
    const causes = loadCauses();
    assert.ok(causes.length >= 20, `${CAUSES_REL} holds ${causes.length} cause(s)`);
    for (const c of causes) {
      // An id is the signature table's output verbatim: no surrounding
      // whitespace, a `*` only as the final character, never empty.
      assert.equal(c.signature, c.signature.trim(), c.signature);
      assert.doesNotMatch(c.signature, /\*./, `${c.signature}: a \`*\` is only readable as the last character`);
      assert.ok(c.rootCause.length > 20, c.signature);
      assert.ok(c.fix.length > 5, c.signature);
    }
    // A cause for `other:*` would explain the unexplainable. Refuse it.
    assert.equal(causes.find((c) => c.signature.startsWith('other')), undefined, 'no cause may claim the `other:` fallback');
  });

  test('every row of the REAL register carries a typed `fixedBy` that validateCauses accepts', () => {
    const raw = JSON.parse(readFileSync(join(REPO, CAUSES_REL), 'utf8')).causes;
    assert.deepEqual(validateCauses(raw), []);
    for (const c of raw) assert.ok(FIXED_BY_FIELDS.has(c.fixedBy.kind), `${c.signature}: ${c.fixedBy.kind}`);
    assert.ok(mergeShas(raw).length > 0, 'the real register names no merge commit, so the merge-base check would hold nothing');
  });

  test('renderTable marks a group with an unexplained member and a group without a cause', () => {
    const groups = [
      { signature: 's', count: 2, unexplained: 1, cause: { rootCause: 'r', fix: 'f' }, proofs: new Map([['p', 2]]) },
      { signature: 't', count: 1, unexplained: 1, cause: null, proofs: new Map([['q', 1]]) },
    ];
    const t = renderTable(groups);
    assert.match(t, /s \| 2 \(1 UNEXPLAINED\) \| r \| f \| p ×2/);
    assert.match(t, /t \| 1 \(1 UNEXPLAINED\) \| — NO CAUSE IN REGISTER — \| — \| q/);
  });
});

describe('the ledger, end to end (fixture transport, no network)', () => {
  test('GREEN CONTROL — the real signature table explains all four runs: exit 0, UNEXPLAINED: 0, and the arithmetic adds up', () => {
    const { dir } = fixture(temp());
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /COVERAGE: 4 non-green run\(s\)/);
    assert.match(r.out, /ARITHMETIC: 4 total = 4 explained across 4 group\(s\) \+ 0 unexplained/);
    assert.match(r.out, /\nUNEXPLAINED: 0\n?$/);
    assert.match(r.out, /start-here:drift \| 1 \| /);
    assert.match(r.out, /ops-register:red-since:duty\.workflow\.ops-watch\.yml \| 1 \| /);
    assert.match(r.out, /cancelled:superseded-in-group \| 1 \| /);
    assert.match(r.out, /dart:format \| 1 \| /);
    assert.match(r.out, /later green: run 1099 @ 2026-09-09T13:00:00Z/);
    assert.match(r.out, /branch deleted; PR #606 merged 74bf73d4/);
  });

  test('MUTATION (in-process) — drop ONE signature from the table and exactly ONE run loses its group', async () => {
    const { dir } = fixture(temp());
    const api = fixtureApi(dir);
    const control = await ledger(api, { causes: CAUSES });
    assert.equal(control.unexplained.length, 0);
    const mutated = await ledger(api, { causes: CAUSES, signatures: SIGNATURES.filter((s) => s.id !== 'start-here:drift') });
    assert.equal(mutated.unexplained.length, 1);
    assert.equal(mutated.unexplained[0].id, 1001);
    assert.match(mutated.unexplained[0].signature, /^other:START-HERE/);
    assert.equal(mutated.unexplained[0].why, 'no cause in register');
  });

  test('MUTATION (CLI, a textual copy of the script) — the same fixture flips to exit 1 and names run 1001; the original is untouched', () => {
    const { dir } = fixture(temp());
    const original = readFileSync(SCRIPT, 'utf8');
    const needle = "{ id: 'start-here:drift', re: /^START-HERE\\.md is what the tree generates/ },";
    assert.ok(original.includes(needle), 'the mutation target must be the line as written, or this proves nothing');
    const mutated = original
      .replace(needle, "{ id: 'start-here:drift', re: /^THIS-LINE-NEVER-MATCHES-ANYTHING/ },")
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`)
      .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(BOUNDED_RETRY).href)}`);
    assert.notEqual(mutated, original);
    const copy = join(dir, 'triage-failed-runs.mutated.mjs');
    writeFileSync(copy, mutated);
    const r = run(copy, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /\nUNEXPLAINED: 1\n?$/);
    assert.match(r.out, /run 1001 · ci\.yml · feat-a/);
    assert.match(r.out, /no cause in register/);
    assert.match(r.out, /ARITHMETIC: 4 total = 3 explained across 4 group\(s\) \+ 1 unexplained/);
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });

  test('a LATER GREEN that is missing turns a caused row into OPEN, and the exit is 1', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'newest.json'), JSON.stringify({ [`${CI}|feat-b`]: { id: 1004, conclusion: 'failure', created_at: T('12:01:00') } }));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 1, r.out + r.err);
    // feat-b is alive with a red newest: runs 1003 and 1004 are OPEN. main has no newest run recorded: 1002 is OPEN too.
    assert.match(r.out, /\nUNEXPLAINED: 3\n?$/);
    assert.match(r.out, /no later green and branch still alive/);
    assert.match(r.out, /OPEN — newest ci\.yml on feat-b is run 1004 \(failure\)/);
  });

  test('a run list CAPPED by the API is COVERAGE LOST (exit 2) even when every listed run is explained', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'capped.json'), JSON.stringify(['failure: 1000 of 1710']));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /COVERAGE LOST — the run list was CAPPED by the API: failure: 1000 of 1710/);
    assert.match(r.out, /\nUNEXPLAINED: 0\n?$/);
    assert.match(r.err, /COVERAGE LOST — the enumeration was capped/);
  });

  test('a jobs page shorter than total_count is COVERAGE LOST (exit 2)', () => {
    const { dir } = fixture(temp());
    const jobs = JSON.parse(readFileSync(join(dir, '1004.jobs.json'), 'utf8'));
    jobs.total_count = 7;
    writeFileSync(join(dir, '1004.jobs.json'), JSON.stringify(jobs));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /reports 7 job\(s\) but one page carried 1/);
  });

  test('an EMPTY causes register is COVERAGE LOST, not a pass', () => {
    const { dir } = fixture(temp());
    writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes: [] }));
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /carries no `causes` array/);
  });

  test('a missing fixture dir, and a fixture with no runs.json, are both COVERAGE LOST', () => {
    const d = temp();
    assert.equal(run(SCRIPT, ['--fixture-dir', join(d, 'nope')]).code, 2);
    const r = run(SCRIPT, ['--fixture-dir', d]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /fixture runs\.json is missing/);
  });

  test('--json writes every row and group', () => {
    const { dir } = fixture(temp());
    const out = join(dir, 'ledger.json');
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json'), '--json', out]);
    assert.equal(r.code, 0, r.out + r.err);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.rows.length, 4);
    assert.equal(j.groups.length, 4);
    assert.deepEqual(j.unexplained, []);
  });
});

describe('CLI contract', () => {
  test('parseArgs refuses an unknown flag and a non-ISO --since', () => {
    assert.match(parseArgs(['--bogus']).error, /unrecognised argument/);
    assert.match(parseArgs(['--since', 'yesterday']).error, /ISO instant/);
    assert.equal(parseArgs(['--since', '2026-09-08T00:00:00Z', '--no-prs']).prs, false);
  });

  test('no credential, no fixture → exit 2 "COVERAGE LOST", and nothing is fetched', () => {
    const r = run(SCRIPT, ['--repo', 'fixture/fixture'], { GH_TOKEN: '', GITHUB_TOKEN: '' });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /COVERAGE LOST — no GitHub credential/);
  });

  test('only ops-watch.yml invokes the script, and only from its failure-ledger job — never ci.yml, never a gate', () => {
    const wf = join(REPO, '.github', 'workflows');
    const invokers = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f) && /triage-failed-runs/.test(readFileSync(join(wf, f), 'utf8')));
    assert.deepEqual(invokers, ['ops-watch.yml']);
    const lines = readFileSync(join(wf, 'ops-watch.yml'), 'utf8').split(/\r?\n/);
    // The job a line belongs to is the nearest two-space `name:` key above it.
    const jobOf = (i) => {
      for (let j = i; j >= 0; j -= 1) {
        const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[j]);
        if (m) return m[1];
      }
      return null;
    };
    const runs = lines.flatMap((l, i) => (/node tooling\/ops\/triage-failed-runs\.mjs/.test(l) ? [jobOf(i)] : []));
    assert.deepEqual(runs, ['failure-ledger']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE TYPED FIX — `fixedBy` is a kind a machine can hold, and a `merge` is
// held to main. Every case is written out; none is generated.
// ═══════════════════════════════════════════════════════════════════════════
describe('validateCauses — the typed fix', () => {
  const row = (fixedBy) => ({ signature: 'x:y', rootCause: 'a root cause long enough', fix: 'prose', ...(fixedBy === undefined ? {} : { fixedBy }) });

  test('an empty register is one problem, not a pass', () => {
    assert.deepEqual(validateCauses([]), ['the register carries no causes']);
  });

  test('a row with a prose `fix` and no `fixedBy` is refused, naming the row', () => {
    assert.deepEqual(validateCauses([row(undefined)]), ['x:y — lacks `fixedBy`; the prose `fix` is not a kind a machine can hold']);
  });

  test('a `fixedBy` that is a string is refused', () => {
    assert.deepEqual(validateCauses([row('merge')]), ['x:y — `fixedBy` is not an object']);
  });

  test('an unknown kind is refused, and the six kinds are named', () => {
    assert.deepEqual(validateCauses([row({ kind: 'fixed' })]), [
      'x:y — `fixedBy.kind` "fixed" is not one of merge · superseded · infrastructure · not-a-defect · live-action · lost-race',
    ]);
  });

  test('each of the six kinds, well formed, is accepted', () => {
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '74bf73d4', pr: 606 })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'superseded', by: 'PR #587' })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'infrastructure' })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'not-a-defect', reason: 'cancelled' })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'live-action', what: 'the owner set the variable' })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'lost-race' })]), []);
  });

  test('a merge sha that is not 7-40 lowercase hex is refused', () => {
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '74BF73D4', pr: 606 })]), ['x:y — fixedBy.sha "74BF73D4" is not 7-40 lowercase hex']);
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '74bf73', pr: 606 })]), ['x:y — fixedBy.sha "74bf73" is not 7-40 lowercase hex']);
  });

  test('a merge pr of null is a direct push and accepted; zero, a string or a missing pr is refused', () => {
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '92414846', pr: null })]), []);
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '92414846', pr: 0 })]), [
      'x:y — fixedBy.pr 0 is not a pull request number (or null for a direct push)',
    ]);
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '92414846', pr: '606' })]), [
      'x:y — fixedBy.pr "606" is not a pull request number (or null for a direct push)',
    ]);
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: '92414846' })]), [
      'x:y — fixedBy.pr undefined is not a pull request number (or null for a direct push)',
    ]);
  });

  test('`also` must be a non-empty array, and a bad entry is named by its index', () => {
    assert.deepEqual(validateCauses([row({ kind: 'merge', sha: 'ddfc63d4', pr: 582, also: [] })]), ['x:y — `fixedBy.also` is not a non-empty array']);
    assert.deepEqual(
      validateCauses([row({ kind: 'merge', sha: 'ddfc63d4', pr: 582, also: [{ sha: '846d90a0', pr: 593 }, { sha: 'nothex!', pr: 1 }] })]),
      ['x:y — fixedBy.also[1].sha "nothex!" is not 7-40 lowercase hex'],
    );
  });

  test('a field that belongs to another kind is refused', () => {
    assert.deepEqual(validateCauses([row({ kind: 'infrastructure', by: 'x' })]), ['x:y — `fixedBy.by` is not a field of kind "infrastructure"']);
    assert.deepEqual(validateCauses([row({ kind: 'superseded', by: 'x', sha: '74bf73d4' })]), ['x:y — `fixedBy.sha` is not a field of kind "superseded"']);
  });

  test('a required string that is blank is refused', () => {
    assert.deepEqual(validateCauses([row({ kind: 'not-a-defect', reason: '   ' })]), ['x:y — `fixedBy.reason` is empty']);
    assert.deepEqual(validateCauses([row({ kind: 'live-action' })]), ['x:y — `fixedBy.what` is empty']);
  });

  test('mergeShas lists the head merge and every `also`, each with its row', () => {
    const causes = [
      { signature: 'a', fixedBy: { kind: 'merge', sha: 'ddfc63d4', pr: 582, also: [{ sha: '846d90a0', pr: 593 }] } },
      { signature: 'b', fixedBy: { kind: 'infrastructure' } },
      { signature: 'c', fixedBy: { kind: 'merge', sha: '92414846', pr: null } },
    ];
    assert.deepEqual(mergeShas(causes), [
      { signature: 'a', sha: 'ddfc63d4', pr: 582 },
      { signature: 'a', sha: '846d90a0', pr: 593 },
      { signature: 'c', sha: '92414846', pr: null },
    ]);
  });

  test('CLI — a causes file with one untyped row is COVERAGE LOST (exit 2), naming the row, before any transport', () => {
    const { dir } = fixture(temp(), { causes: [...CAUSES.slice(0, 4), { signature: 'dart:format', rootCause: 'not format-clean', fix: 'superseded' }] });
    const r = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json')]);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /1 problem\(s\) in 5 cause\(s\):\n {2}dart:format — lacks `fixedBy`/);
    assert.doesNotMatch(r.out, /FIXTURE TRANSPORT/);
  });
});

describe('checkFixesOnMain — a merge that never reached main is not a fix', () => {
  // A real repository: main (two commits, published as origin/main) and a
  // side branch whose commit is NOT on main.
  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const repo = () => {
    const d = temp();
    git(d, 'init', '-q', '-b', 'main');
    writeFileSync(join(d, 'f.txt'), 'one\n');
    git(d, 'add', 'f.txt');
    git(d, 'commit', '-q', '-m', 'one');
    writeFileSync(join(d, 'f.txt'), 'two\n');
    git(d, 'commit', '-q', '-am', 'two');
    git(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const [one, two] = git(d, 'rev-list', '--reverse', 'HEAD').split('\n');
    git(d, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(d, 'f.txt'), 'side\n');
    git(d, 'commit', '-q', '-am', 'side');
    const side = git(d, 'rev-parse', 'HEAD');
    return { d, one, two, side };
  };
  const merge = (signature, sha, pr, also) => ({ signature, rootCause: 'r', fix: 'f', fixedBy: { kind: 'merge', sha, pr, ...(also ? { also } : {}) } });

  test('GREEN CONTROL — every merge (and its `also`) on origin/main: nothing missing, three checked', () => {
    const { d, one, two } = repo();
    const r = checkFixesOnMain([merge('a', one.slice(0, 8), 1, [{ sha: two, pr: 2 }]), merge('b', two.slice(0, 12), null)], { cwd: d });
    assert.deepEqual(r, { lost: null, missing: [], checked: 3 });
  });

  test('R5 — a merge sha on a side branch only is missing, and the row is named', () => {
    const { d, one, side } = repo();
    const r = checkFixesOnMain([merge('a', one, 1), merge('dart:format', side.slice(0, 10), 7)], { cwd: d });
    assert.equal(r.lost, null);
    assert.deepEqual(r.missing, [{ signature: 'dart:format', sha: side.slice(0, 10), pr: 7, why: 'not an ancestor of origin/main' }]);
  });

  test('a sha this complete clone has never seen is missing too (git exits 128), not skipped', () => {
    const { d } = repo();
    const r = checkFixesOnMain([merge('ghost', '0123456789abcdef0123456789abcdef01234567', 9)], { cwd: d });
    assert.equal(r.lost, null);
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].signature, 'ghost');
    assert.match(r.missing[0].why, /^unknown to this clone \(git exited 128\), and the clone is complete$/);
  });

  test('a ref that does not resolve is COVERAGE LOST, not a pass', () => {
    const { d, one } = repo();
    const r = checkFixesOnMain([merge('a', one, 1)], { cwd: d, ref: 'origin/nope' });
    assert.equal(r.lost, 'origin/nope does not resolve in this clone, so no fix can be held to it');
  });

  test('a SHALLOW clone is COVERAGE LOST — a commit missing from it proves nothing', () => {
    const { d, one } = repo();
    const shallow = join(temp(), 'shallow');
    git(d, 'checkout', '-q', 'main');
    git(temp(), 'clone', '-q', '--depth', '1', pathToFileURL(d).href, shallow);
    assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
    const r = checkFixesOnMain([merge('a', one, 1)], { cwd: shallow });
    assert.match(r.lost, /^the clone is SHALLOW/);
  });

  test('a git that cannot answer is COVERAGE LOST (the seam)', () => {
    const r = checkFixesOnMain([merge('a', '74bf73d4', 606)], { cwd: 'x', git: () => ({ code: 128, out: '', err: 'not a git repository' }) });
    assert.match(r.lost, /^`git rev-parse` exited 128 in x: not a git repository$/);
  });

  test('CLI — a register naming a commit not on main exits 1 before any request, naming the row', () => {
    // fetch is replaced by a thrower in the child, so a regression that skipped
    // the check would fail this case rather than reach the network.
    const noNet = join(temp(), 'no-network.mjs');
    writeFileSync(noNet, "globalThis.fetch = () => { throw new Error('this test must never reach the network'); };\n");
    const dir = temp();
    const causes = [...CAUSES.slice(1), merge('start-here:drift', '0123456789abcdef0123456789abcdef01234567', 606)];
    writeFileSync(join(dir, 'causes.json'), JSON.stringify({ causes }));
    const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
    const hasMain = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], { cwd: REPO }).status === 0;
    const r = run(SCRIPT, ['--repo', 'fixture/fixture', '--causes', join(dir, 'causes.json')], {
      GH_TOKEN: `ghp_${'a'.repeat(36)}`,
      NODE_OPTIONS: `--import=${pathToFileURL(noNet).href}`,
    });
    assert.doesNotMatch(r.out, /triage-failed-runs — /, 'the live transport must not have been constructed');
    if (shallow === 'false' && hasMain) {
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.err, /1 fix commit\(s\) named in tooling\/ops\/failed-run-causes\.json are not on main/);
      assert.match(r.err, /start-here:drift — fixedBy 0123456789abcdef0123456789abcdef01234567 \(PR #606\): unknown to this clone/);
    } else {
      // A shallow CI checkout, or one with no origin/main: the check refuses.
      assert.equal(r.code, 2, r.out + r.err);
      assert.match(r.err, /COVERAGE LOST — the merge-base check could not run/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// groupRows — the grouping arithmetic, directly
// ═══════════════════════════════════════════════════════════════════════════
describe('groupRows', () => {
  test('groups by signature, counts each group, and names every unexplained row with its reason', () => {
    const causes = [{ signature: 'known:sig', rootCause: 'r', fix: 'f' }];
    const row = (id, signature) => ({
      id, signature, branch: 'feat-a', workflow: 'ci.yml', workflowPath: CI,
      job: 'j', step: 's', error: 'e', sha: 'abc', conclusion: 'failure', createdAt: T('10:00:00'),
    });
    const ctx = {
      newest: new Map([[`${CI}|feat-a`, { id: 9, conclusion: 'success', created_at: T('11:00:00') }]]),
      branches: new Set(['feat-a']),
      prs: new Map(),
    };
    const { groups, unexplained } = groupRows([row(1, 'known:sig'), row(2, 'known:sig'), row(3, 'unknown:sig')], causes, ctx);
    assert.deepEqual(groups.map((g) => [g.signature, g.count, g.unexplained]), [['known:sig', 2, 0], ['unknown:sig', 1, 1]]);
    assert.deepEqual(unexplained.map((u) => [u.id, u.why]), [[3, 'no cause in register']]);
    assert.match(groups[0].rows[0].proof, /later green: run 9/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT HARDENING — CodeQL js/file-system-race (#300) and
// js/file-access-to-http (#301), answered in code. No case here touches the
// network: the cache cases use a filesystem seam or a temp dir, and the
// credential/slug cases are refused before liveApi is ever built.
// ═══════════════════════════════════════════════════════════════════════════
describe('transport hardening', () => {
  const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });

  /** The race, made deterministic: the cache file EXISTS when checked and is
   *  GONE when read. Every operation is logged. */
  function vanishingFs(log) {
    return {
      existsSync: (p) => { log.push(['existsSync', p]); return true; },
      readFileSync: (p) => { log.push(['readFileSync', p]); throw enoent(p); },
      writeFileSync: (p, _data, opts) => { log.push(['writeFileSync', p, opts?.flag]); },
      mkdirSync: (p) => { log.push(['mkdirSync', p]); },
      renameSync: (a, b) => { log.push(['renameSync', a, b]); },
      rmSync: (p) => { log.push(['rmSync', p]); },
    };
  }

  test('a cache file removed between a check and the read is a MISS, not a crash — and no check is made', async () => {
    const log = [];
    let fetched = 0;
    const v = await readThroughCache('/cache', '1001.jobs.json', async () => { fetched++; return { total_count: 0, jobs: [] }; }, { fs: vanishingFs(log) });
    assert.deepEqual(v, { total_count: 0, jobs: [] });
    assert.equal(fetched, 1);
    assert.equal(log.filter(([op]) => op === 'existsSync').length, 0, 'the read must not be preceded by a check');
  });

  test('MUTATION: the check-then-read cache restored in a COPY of the script fails that same scenario', async () => {
    const original = readFileSync(SCRIPT, 'utf8');
    const block = "  let raw = null;\n  try {\n    raw = fs.readFileSync(p, 'utf8');\n  } catch (e) {\n    if (e?.code !== 'ENOENT') throw e;\n  }\n";
    assert.ok(original.replaceAll('\r\n', '\n').includes(block), 'the read block this mutation replaces is not in the script');
    const mutated = original
      .replaceAll('\r\n', '\n')
      .replace(block, "  let raw = null;\n  if (fs.existsSync(p)) raw = fs.readFileSync(p, 'utf8');\n")
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`)
      .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(BOUNDED_RETRY).href)}`);
    const copy = join(temp(), 'triage-failed-runs.race-mutated.mjs');
    writeFileSync(copy, mutated);
    const m = await import(pathToFileURL(copy).href);
    await assert.rejects(
      m.readThroughCache('/cache', '1001.jobs.json', async () => ({}), { fs: vanishingFs([]) }),
      (e) => e.code === 'ENOENT',
    );
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });

  test('a cache write lands by RENAME from an exclusively created temporary — the final name is never opened for writing', async () => {
    const log = [];
    await readThroughCache('/cache', 'newest-x.json', async () => ({ id: 7 }), { fs: vanishingFs(log) });
    const writes = log.filter(([op]) => op === 'writeFileSync');
    const renames = log.filter(([op]) => op === 'renameSync');
    const target = join('/cache', 'newest-x.json');
    assert.equal(writes.length, 1);
    assert.equal(renames.length, 1);
    assert.notEqual(writes[0][1], target);
    assert.equal(writes[0][2], 'wx');
    assert.deepEqual(renames[0].slice(1), [writes[0][1], target]);
  });

  test('a failed rename removes the temporary file and reports the original error', async () => {
    const log = [];
    const fs = { ...vanishingFs(log), renameSync: () => { throw Object.assign(new Error('EPERM: rename refused'), { code: 'EPERM' }); } };
    await assert.rejects(readThroughCache('/cache', 'a.json', async () => ({}), { fs }), /EPERM/);
    const tmp = log.find(([op]) => op === 'writeFileSync')[1];
    assert.ok(log.some(([op, p]) => op === 'rmSync' && p === tmp), 'the temporary must be removed');
  });

  test('on the real filesystem: one fetch, one file, no temporary left, and the second read is served from the cache', async () => {
    const dir = temp();
    let fetched = 0;
    const fetcher = async () => { fetched++; return 'log line\n'; };
    assert.equal(await readThroughCache(dir, '1001.job-5.log', fetcher, { text: true }), 'log line\n');
    assert.equal(await readThroughCache(dir, '1001.job-5.log', fetcher, { text: true }), 'log line\n');
    assert.equal(fetched, 1);
    assert.deepEqual(readdirSync(dir), ['1001.job-5.log']);
  });

  test('a cache name that is a PATH is refused before anything is read or fetched', async () => {
    for (const name of ['../escape.json', 'a/b.json', 'a\\b.json', '.hidden', '']) {
      let fetched = 0;
      await assert.rejects(readThroughCache(temp(), name, async () => { fetched++; return {}; }), (e) => e instanceof CoverageLost, name);
      assert.equal(fetched, 0, name);
    }
  });

  test('only GitHub token SHAPES are accepted as a credential', () => {
    const accepted = ['ghp_' + 'a'.repeat(36), 'ghs_' + 'A1'.repeat(20), 'github_pat_' + 'x_'.repeat(20), 'f'.repeat(40),
      // ⏱ 2026-09-26 · ops-watch #526 (run 36203215773): the live Actions job token failed the old 251-character,
      // alphanumeric-only body. A long job token, and one whose body carries `_`, `-` or `.`, are GitHub shapes too.
      'ghs_' + 'Ab9'.repeat(200), 'ghs_' + 'a_b-c.d'.repeat(10) + 'e'.repeat(10)];
    const refused = ['', 'Bearer ghp_' + 'a'.repeat(36), 'ghp_' + 'a'.repeat(36) + '\n', 'ghp_' + 'a'.repeat(36) + '\r\nx-evil: 1', 'ghp_short', 'not a token', null, undefined, 42,
      'ghs_' + 'a'.repeat(36) + ' x', 'ghs_' + 'a'.repeat(2049), 'ghs_' + 'a'.repeat(36) + '/x', 'ghs_' + 'a'.repeat(36) + ':x'];
    for (const t of accepted) assert.equal(isValidGithubToken(t), true, String(t).slice(0, 12));
    for (const t of refused) assert.equal(isValidGithubToken(t), false, String(t).slice(0, 12));
  });

  test('a refused credential is described by its SHAPE only: length, prefix family, character classes, no value', () => {
    const secret = 'pasted-by-mistake SECRETVALUE';
    const d = credentialShape(secret);
    assert.equal(d, 'length 29, no known prefix, characters: letters, hyphen, WHITESPACE');
    assert.doesNotMatch(d, /SECRETVALUE|pasted/);
    assert.equal(credentialShape('ghs_' + 'A'.repeat(300)), 'length 304, a gh?_ prefix, characters: letters, underscore');
    assert.equal(credentialShape(undefined), 'not a string (undefined)');
  });

  test('an UNSHAPED credential is COVERAGE LOST (exit 2), its value is not printed, and no transport is built', () => {
    const r = run(SCRIPT, ['--repo', 'fixture/fixture'], { GH_TOKEN: 'pasted-by-mistake SECRETVALUE', GITHUB_TOKEN: '' });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /COVERAGE LOST — the GitHub credential does not have the shape of a GitHub token/);
    assert.doesNotMatch(r.out + r.err, /SECRETVALUE/);
    assert.match(r.err, /its shape: length 29, no known prefix, characters: letters, hyphen, WHITESPACE\./);
    assert.doesNotMatch(r.out, /triage-failed-runs — /, 'the live transport must not have been constructed');
  });

  test('a repository that is not an owner/name slug is COVERAGE LOST (exit 2) before any transport is built', () => {
    assert.equal(isValidRepoSlug('globalonlinedeveloper/Nikatru_Platform_Public'), true);
    for (const bad of ['../../user', 'owner/..', 'owner/.x', 'a/b/c', 'owner', '', 'own er/x']) assert.equal(isValidRepoSlug(bad), false, bad);
    const r = run(SCRIPT, ['--repo', '../../user'], { GH_TOKEN: 'ghp_' + 'a'.repeat(36), GITHUB_TOKEN: '' });
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /is not an owner\/name repository slug/);
    assert.doesNotMatch(r.out, /triage-failed-runs — /);
  });

  test('only the seven request paths this reader builds may reach fetch — numeric ids only', () => {
    const R = 'globalonlinedeveloper/Nikatru_Platform_Public';
    const allowed = [
      `/repos/${R}/actions/runs?status=failure&per_page=100&created=${encodeURIComponent('2026-09-05..2026-09-10')}&page=1`,
      `/repos/${R}/actions/runs/34546423386/jobs?per_page=100&filter=all`,
      `/repos/${R}/actions/jobs/98765/logs`,
      `/repos/${R}/actions/workflows/123/runs?branch=${encodeURIComponent('feat/x')}&per_page=1`,
      `/repos/${R}/actions/workflows/123/runs?branch=main&status=completed&per_page=2`,
      `/repos/${R}/branches?per_page=100&page=2`,
      `/repos/${R}/pulls?head=${encodeURIComponent('globalonlinedeveloper:feat/x')}&state=all&per_page=5`,
      '/rate_limit',
    ];
    const refused = [
      `/repos/${R}/actions/jobs/12a/logs`,
      `/repos/${R}/actions/jobs/1/../../../../user`,
      `/repos/${R}/actions/runs/1/jobs/../../secrets`,
      `/repos/other/repo/actions/runs?page=1`,
      `/repos/${R}/actions/runs?page=1#frag`,
      `/repos/${R}/actions/runs?x=/etc/passwd`,
      `//evil.example/repos/${R}/actions/runs?page=1`,
      `/repos/${R}/actions/workflows/ci.yml/runs?per_page=1`,
      '/user',
      '/rate_limit?resource=core',
      '/rate_limit/../user',
    ];
    for (const p of allowed) assert.equal(isAllowedApiPath(R, p), true, p);
    for (const p of refused) assert.equal(isAllowedApiPath(R, p), false, p);
    assert.equal(isAllowedApiPath('../x', '/repos/../x/branches?page=1'), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A CACHE NEVER SERVES AN ANSWER THAT CHANGES. Measured 2026-09-11: a second
// pass with --cache-dir printed 88 UNEXPLAINED, 72 of them citing "newest
// ops-watch.yml on main is run 34443545094 (null) @ 2026-09-10T06:03:13Z" — the
// newest run as it was the DAY BEFORE, served from disk. `fetch` is stubbed here;
// nothing reaches the network.
// ═════════════════════════════════════════════════════════════════════════════
describe('a cache never serves an answer that changes', () => {
  const TOKEN = 'ghp_' + 'a'.repeat(36);
  const SLUG = 'owner/name';
  const KEY = '.github/workflows/ops-watch.yml|main';
  const STALE_NAME = 'newest-.github_workflows_ops-watch.yml_main.json';

  async function withFetch(routes, fn) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      for (const [needle, body] of routes) {
        if (u.includes(needle)) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    };
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = real;
    }
  }

  const staleDir = () => {
    const dir = temp();
    writeFileSync(join(dir, STALE_NAME), JSON.stringify({ id: 1, conclusion: null, created_at: '2026-09-10T06:03:13Z' }));
    return dir;
  };
  const today = { workflow_runs: [{ id: 2, status: 'completed', conclusion: 'success', created_at: '2026-09-11T09:00:00Z' }] };

  test("newestRun asks GitHub every time, even with yesterday's answer on disk", async () => {
    const dir = staleDir();
    await withFetch([['/actions/workflows/7/runs', today]], async (calls) => {
      const api = liveApi(SLUG, TOKEN, dir);
      assert.equal((await api.newestRun(7, 'main', KEY)).id, 2);
      assert.equal((await api.newestRun(7, 'main', KEY)).id, 2);
      assert.equal(calls.length, 2, 'each call must reach GitHub');
    });
  });

  test("a re-run attempt is not served the jobs of the attempt before it; a completed attempt still is", async () => {
    const dir = temp();
    writeFileSync(join(dir, '1001.jobs.json'), JSON.stringify({ total_count: 1, jobs: [{ id: 5, conclusion: 'failure' }] }));
    await withFetch([['/actions/runs/1001/jobs', { total_count: 1, jobs: [{ id: 6, conclusion: 'failure' }] }]], async (calls) => {
      const api = liveApi(SLUG, TOKEN, dir);
      assert.equal((await api.listJobs(1001, 1)).jobs[0].id, 5, 'attempt 1 is immutable and served from the cache');
      assert.equal((await api.listJobs(1001, 2)).jobs[0].id, 6, 'attempt 2 must be fetched');
      assert.equal((await api.listJobs(1001, 2)).jobs[0].id, 6, 'attempt 2 is then cached under its own name');
      assert.equal(calls.length, 1);
    });
  });

  test('MUTATION: newestRun re-wrapped in the cache, in a COPY of the script, serves the stale run', async () => {
    const original = readFileSync(SCRIPT, 'utf8');
    const line = '    newestRun: (workflowId, branch) => fetchNewest(workflowId, branch),\n';
    const flat = original.replaceAll('\r\n', '\n');
    assert.ok(flat.includes(line), 'the line this mutation replaces is not in the script');
    const mutated = flat
      .replace(line, "    newestRun: (workflowId, branch, key) => cached('newest-' + key.split('/').join('_').split('|').join('_') + '.json', () => fetchNewest(workflowId, branch)),\n")
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`)
      .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(BOUNDED_RETRY).href)}`);
    const copy = join(temp(), 'triage-failed-runs.newest-cached.mjs');
    writeFileSync(copy, mutated);
    const m = await import(pathToFileURL(copy).href);
    const dir = staleDir();
    await withFetch([['/actions/workflows/7/runs', today]], async (calls) => {
      const r = await m.liveApi(SLUG, TOKEN, dir).newestRun(7, 'main', KEY);
      assert.equal(r.id, 1, 'the mutated copy must serve the stale run — the defect this suite exists to catch');
      assert.equal(calls.length, 0);
    });
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });

  test('MUTATION: jobs keyed by run id alone, in a COPY of the script, serve attempt 1 for attempt 2', async () => {
    const original = readFileSync(SCRIPT, 'utf8');
    const flat = original.replaceAll('\r\n', '\n');
    const keyed = 'Number(attempt) > 1 ? `${id}.attempt-${Number(attempt)}.jobs.json` : `${id}.jobs.json`';
    assert.ok(flat.includes(keyed), 'the expression this mutation replaces is not in the script');
    const mutated = flat
      .replace(keyed, '`${id}.jobs.json`')
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`)
      .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(BOUNDED_RETRY).href)}`);
    const copy = join(temp(), 'triage-failed-runs.jobs-unkeyed.mjs');
    writeFileSync(copy, mutated);
    const m = await import(pathToFileURL(copy).href);
    const dir = temp();
    writeFileSync(join(dir, '1001.jobs.json'), JSON.stringify({ total_count: 1, jobs: [{ id: 5, conclusion: 'failure' }] }));
    await withFetch([['/actions/runs/1001/jobs', { total_count: 1, jobs: [{ id: 6, conclusion: 'failure' }] }]], async () => {
      assert.equal((await m.liveApi(SLUG, TOKEN, dir).listJobs(1001, 2)).jobs[0].id, 5);
    });
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D1 (2026-09-25) — THE QUOTA FLOOR AND THE HARD REQUEST CEILING. The ledger
// runs under the workflow token, whose quota other readers share, so it reads
// GET /rate_limit first and starts only when `remaining - ceiling >= 400`, and
// `--max-requests` (default 300) is never exceeded. `fetch` is stubbed in every
// case, in-process or in the child; nothing reaches the network. Every case is
// written out; none is generated.
// ═════════════════════════════════════════════════════════════════════════════
describe('D1 — the quota floor and the hard request ceiling', () => {
  const TOKEN = 'ghs_' + 'a'.repeat(36);
  const SLUG = 'owner/name';
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const core = (remaining) => ({ resources: { core: { limit: 1000, used: 1000 - remaining, remaining, reset: 1790000000 } } });

  /** Replace `fetch` for the length of `fn`; `answer(path)` returns the Response. */
  async function stubFetch(answer, fn) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      return answer(path);
    };
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = real;
    }
  }

  /** A COPY of the real script inside a temp git repository whose origin/main
   *  resolves, beside a one-row causes register that names no merge: the
   *  merge-base check then holds nothing and answers, so the quota read is the
   *  first request the live path makes. Its sibling imports point at the real
   *  files. The child's `fetch` is fetch-stub.mjs: /rate_limit answers
   *  STUB_REMAINING, the run lists answer the `runs` of the asked `status` (and,
   *  as GitHub does, of the asked `branch` when one is asked), a job list
   *  answers empty, a workflow's run list answers `workflowRuns` (empty unless
   *  given) kept to the asked `status` — a status or a conclusion, as GitHub
   *  reads it — and cut to the asked `per_page`, the branch list answers
   *  `branches` (empty unless given), and every path asked for is appended to
   *  STUB_LOG. `causes` replaces the one-row register; `mutate` rewrites the
   *  copy's source. */
  function liveCopy(remaining, runs = [], { workflowRuns = [], branches = [], causes = [CAUSES[3]], mutate = (src) => src } = {}) {
    const d = temp();
    const ops = join(d, 'tooling', 'ops');
    mkdirSync(ops, { recursive: true });
    const src = mutate(readFileSync(SCRIPT, 'utf8').replaceAll('\r\n', '\n'))
      .replace("from './safe-rerun.mjs'", `from ${JSON.stringify(pathToFileURL(SAFE_RERUN).href)}`)
      .replace("from './bounded-retry.mjs'", `from ${JSON.stringify(pathToFileURL(BOUNDED_RETRY).href)}`);
    writeFileSync(join(ops, 'triage-failed-runs.mjs'), src);
    writeFileSync(join(ops, 'failed-run-causes.json'), JSON.stringify({ causes }));
    // GIT_* is dropped: an inherited GIT_DIR (a hook sets one) would point this
    // fixture's commit and update-ref at the real repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    for (const args of [['init', '-q', '-b', 'main'], ['commit', '-q', '--allow-empty', '-m', 'fixture'], ['update-ref', 'refs/remotes/origin/main', 'HEAD']]) {
      const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: d, encoding: 'utf8', timeout: 30_000, env });
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    }
    const log = join(d, 'fetch-log.txt');
    writeFileSync(log, '');
    const stub = join(d, 'fetch-stub.mjs');
    writeFileSync(
      stub,
      [
        "import { appendFileSync } from 'node:fs';",
        "const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });",
        'globalThis.fetch = async (url) => {',
        '  const path = new URL(String(url)).pathname;',
        "  appendFileSync(process.env.STUB_LOG, path + '\\n');",
        '  const remaining = Number(process.env.STUB_REMAINING);',
        "  if (path === '/rate_limit') return json({ resources: { core: { limit: 5000, used: 5000 - remaining, remaining, reset: 1790000000 } } });",
        "  if (path.endsWith('/actions/runs')) {",
        '    const q = new URL(String(url)).searchParams;',
        "    const runs = JSON.parse(process.env.STUB_RUNS || '[]').filter((r) => r.conclusion === q.get('status') && (!q.has('branch') || r.head_branch === q.get('branch')));",
        '    return json({ total_count: runs.length, workflow_runs: runs });',
        '  }',
        "  if (path.endsWith('/jobs')) return json({ total_count: 0, jobs: [] });",
        "  if (path.includes('/actions/workflows/')) {",
        '    const q = new URL(String(url)).searchParams;',
        "    const listed = JSON.parse(process.env.STUB_WORKFLOW_RUNS || '[]').filter((r) => !q.has('status') || r.status === q.get('status') || r.conclusion === q.get('status'));",
        "    return json({ total_count: listed.length, workflow_runs: listed.slice(0, Number(q.get('per_page') || 30)) });",
        '  }',
        "  if (path.endsWith('/branches')) return json(JSON.parse(process.env.STUB_BRANCHES || '[]').map((name) => ({ name })));",
        "  return new Response('{}', { status: 404 });",
        '};',
        '',
      ].join('\n'),
    );
    return {
      script: join(ops, 'triage-failed-runs.mjs'),
      env: { GH_TOKEN: TOKEN, GITHUB_TOKEN: '', NODE_OPTIONS: `--import=${pathToFileURL(stub).href}`, STUB_LOG: log, STUB_REMAINING: String(remaining), STUB_RUNS: JSON.stringify(runs), STUB_WORKFLOW_RUNS: JSON.stringify(workflowRuns), STUB_BRANCHES: JSON.stringify(branches) },
      fetched: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
  }

  test('the floor is 400 and the default ceiling is 300, and parseArgs defaults to that ceiling', () => {
    assert.equal(QUOTA_FLOOR, 400);
    assert.equal(DEFAULT_MAX_REQUESTS, 300);
    assert.equal(parseArgs(['--since', '2026-09-17T00:00:00Z']).maxRequests, 300);
  });

  test('quotaFloor: 350 remaining against a ceiling of 300 is refused, naming the quota floor', () => {
    const v = quotaFloor({ remaining: 350, reset: 1790000000 }, 300);
    assert.equal(v.ok, false);
    assert.match(v.line, /^quota floor — 350 remaining - ceiling 300 = 50, under the floor of 400, so the walk did not start/);
    assert.match(v.line, /The quota resets at 2026-09-21T/);
  });

  test('quotaFloor: exactly at the floor (700 - 300 = 400) starts; one under (699) does not', () => {
    assert.deepEqual(quotaFloor({ remaining: 700 }, 300), { ok: true, line: 'quota floor: 700 remaining - ceiling 300 = 400 >= 400; the walk may start' });
    assert.equal(quotaFloor({ remaining: 699 }, 300).ok, false);
  });

  test('quotaFloor: a bucket with no integer `remaining` is a refusal, never a start', () => {
    assert.equal(quotaFloor(null, 300).ok, false);
    assert.equal(quotaFloor({}, 300).ok, false);
    assert.equal(quotaFloor({ remaining: '5000' }, 300).ok, false);
    assert.match(quotaFloor({ remaining: 4999.5 }, 300).line, /^quota floor — GET \/rate_limit carried no integer resources\.core\.remaining/);
  });

  test('parseArgs: --max-requests takes a whole number from 1, and refuses 0, a negative, a fraction, a word and a missing value', () => {
    assert.equal(parseArgs(['--max-requests', '50']).maxRequests, 50);
    assert.match(parseArgs(['--max-requests', '0']).error, /--max-requests must be a whole number from 1, got `0`/);
    assert.match(parseArgs(['--max-requests', '-5']).error, /--max-requests must be a whole number from 1/);
    assert.match(parseArgs(['--max-requests', '2.5']).error, /--max-requests must be a whole number from 1/);
    assert.match(parseArgs(['--max-requests', 'lots']).error, /--max-requests must be a whole number from 1/);
    assert.match(parseArgs(['--max-requests']).error, /--max-requests must be a whole number from 1, got `null`/);
  });

  test('liveApi refuses a ceiling that is not a positive whole number before anything is sent', async () => {
    await stubFetch(() => json({}), async (calls) => {
      assert.throws(() => liveApi(SLUG, TOKEN, null, { maxRequests: 0 }), (e) => e instanceof CoverageLost && /request ceiling 0 is not a positive whole number/.test(e.message));
      assert.throws(() => liveApi(SLUG, TOKEN, null, { maxRequests: '300' }), (e) => e instanceof CoverageLost);
      assert.deepEqual(calls, []);
    });
  });

  test('GET /rate_limit is not counted, and the request past the ceiling is refused UNSENT', async () => {
    const today = { workflow_runs: [{ id: 2, status: 'completed', conclusion: 'success', created_at: '2026-09-11T09:00:00Z' }] };
    await stubFetch((path) => (path === '/rate_limit' ? json(core(900)) : json(today)), async (calls) => {
      const api = liveApi(SLUG, TOKEN, null, { maxRequests: 2 });
      assert.equal((await api.rateLimit()).remaining, 900);
      assert.equal(api.requestsSent(), 0, 'the quota read is not a counted request');
      assert.equal((await api.newestRun(7, 'main')).id, 2);
      assert.equal((await api.newestRun(7, 'main')).id, 2);
      await assert.rejects(api.newestRun(7, 'main'), (e) => e instanceof CoverageLost && /^request ceiling — 2 of 2 request\(s\) sent, and GET \/repos\/owner\/name\/actions\/workflows\/7\/runs\?/.test(e.message));
      assert.equal(api.requestsSent(), 2);
      assert.deepEqual(calls, ['/rate_limit', '/repos/owner/name/actions/workflows/7/runs', '/repos/owner/name/actions/workflows/7/runs']);
    });
  });

  test('a RETRY is a request: with a ceiling of 1, a 503 is sent once and its retry is refused unsent, naming the ceiling', async () => {
    await stubFetch(() => json({ message: 'unavailable' }, 503), async (calls) => {
      const api = liveApi(SLUG, TOKEN, null, { maxRequests: 1 });
      await assert.rejects(api.newestRun(7, 'main'), (e) => e instanceof CoverageLost && /^request ceiling — 1 of 1 request\(s\) sent/.test(e.message));
      assert.equal(calls.length, 1, 'the retry must not have been sent');
    });
  });

  test('a 403 on a counted request is still COVERAGE LOST', async () => {
    await stubFetch(() => json({ message: 'API rate limit exceeded' }, 403), async () => {
      const api = liveApi(SLUG, TOKEN, null);
      await assert.rejects(api.newestRun(7, 'main'), (e) => e instanceof CoverageLost && /→ HTTP 403 — the quota or the credential refused/.test(e.message));
    });
  });

  test('a GET /rate_limit that is not a 200 is COVERAGE LOST, never a start', async () => {
    await stubFetch(() => json({ message: 'forbidden' }, 403), async () => {
      await assert.rejects(liveApi(SLUG, TOKEN, null).rateLimit(), (e) => e instanceof CoverageLost && /^GET \/rate_limit → HTTP 403$/.test(e.message));
    });
  });

  test('CLI — /rate_limit at 350 against the default ceiling of 300: exit 2 naming the quota floor, and the quota read is the only request', () => {
    const c = liveCopy(350);
    const r = run(c.script, ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs'], c.env);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /✗ COVERAGE LOST — quota floor — 350 remaining - ceiling 300 = 50, under the floor of 400/);
    assert.deepEqual(c.fetched(), ['/rate_limit']);
    assert.doesNotMatch(r.out, /triage-failed-runs — |UNEXPLAINED:/);
  });

  test('CLI — --max-requests 3 against a walk that needs 5: exit 2 naming the request ceiling, three counted requests, and no UNEXPLAINED line (never a partial pass)', () => {
    const c = liveCopy(5000);
    const r = run(c.script, ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs', '--max-requests', '3'], c.env);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /quota floor: 5000 remaining - ceiling 3 = 4997 >= 400; the walk may start/);
    assert.match(r.err, /✗ COVERAGE LOST — request ceiling — 3 of 3 request\(s\) sent, and GET \/repos\/fixture\/fixture\/actions\/runs\?/);
    assert.deepEqual(c.fetched(), ['/rate_limit', '/repos/fixture/fixture/actions/runs', '/repos/fixture/fixture/actions/runs', '/repos/fixture/fixture/actions/runs']);
    assert.doesNotMatch(r.out, /UNEXPLAINED:/);
  });

  test('CLI GREEN CONTROL — the same walk under the default ceiling: it starts, sends its five requests, and exits 0', () => {
    const c = liveCopy(5000);
    const r = run(c.script, ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs'], c.env);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /REQUESTS: 5 sent, ceiling 300/);
    assert.match(r.out, /UNEXPLAINED: 0/);
    assert.equal(c.fetched().length, 6);
  });

  // FIX-1 (C), 2026-09-25: the ops-watch job reads main's runs only, so the
  // walk fits under the ceiling; a PR's own reds belong to that PR.
  test('parseArgs: --branch takes a branch name (default: every branch), and refuses a missing, empty or whitespace name', () => {
    assert.equal(parseArgs(['--since', '2026-09-17T00:00:00Z']).branch, null);
    assert.equal(parseArgs(['--branch', 'main']).branch, 'main');
    assert.match(parseArgs(['--branch']).error, /--branch must be a branch name without whitespace, got `null`/);
    assert.match(parseArgs(['--branch', '']).error, /--branch must be a branch name without whitespace, got ``/);
    assert.match(parseArgs(['--branch', 'feat x']).error, /--branch must be a branch name without whitespace/);
  });

  test('CLI — --branch main grades only the failed run on main, live (the run lists ask for branch=main) and from a fixture; without it, every branch as before', () => {
    const failed = (id, branch) => ({ id, name: 'CI', path: CI, workflow_id: 7, head_branch: branch, head_sha: 'a'.repeat(40), event: 'push', conclusion: 'failure', run_attempt: 1, created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:05:00Z' });
    const runs = [failed(501, 'main'), failed(502, 'feat/x')];

    const main = liveCopy(5000, runs);
    const onMain = run(main.script, ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs', '--branch', 'main'], main.env);
    assert.equal(onMain.code, 1, onMain.out + onMain.err);
    assert.match(onMain.out, /COVERAGE: 1 non-green run\(s\)/);
    assert.match(onMain.out, /· run 501 · /);
    assert.doesNotMatch(onMain.out, /· run 502 · /);

    const every = liveCopy(5000, runs);
    const all = run(every.script, ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs'], every.env);
    assert.equal(all.code, 1, all.out + all.err);
    assert.match(all.out, /COVERAGE: 2 non-green run\(s\)/);
    assert.match(all.out, /· run 501 · /);
    assert.match(all.out, /· run 502 · /);

    // The fixture holds runs on feat-a, main and feat-b; only R2 is on main.
    const { dir } = fixture(temp());
    const fx = run(SCRIPT, ['--fixture-dir', dir, '--causes', join(dir, 'causes.json'), '--branch', 'main']);
    assert.equal(fx.code, 0, fx.out + fx.err);
    assert.match(fx.out, /COVERAGE: 1 non-green run\(s\)/);
    assert.match(fx.out, /ops-register:red-since:duty\.workflow\.ops-watch\.yml \| 1 \| /);
    assert.doesNotMatch(fx.out, /start-here:drift|dart:format/);
  });

  // ⏱ 2026-09-26 (O-FAILURE-LEDGER-CANNOT-CLEAR-OPS-WATCH): the ledger runs
  // INSIDE ops-watch, so ops-watch's newest run on main is the run executing the
  // ledger, still in progress. Read as the later-green proof, it held all 45
  // failed ops-watch.yml runs of run 36206329284 OPEN whatever cause was filed.
  test('newestCompleted: the first completed run, never one in flight and never the executing run; nothing completed is null', () => {
    const self = { id: 603, status: 'in_progress', conclusion: null };
    const green = { id: 602, status: 'completed', conclusion: 'success' };
    const red = { id: 601, status: 'completed', conclusion: 'failure' };
    assert.equal(newestCompleted([self, green, red]).id, 602);
    assert.equal(newestCompleted([{ ...self, status: 'queued' }, red]).id, 601);
    assert.equal(newestCompleted([green, red], { selfRunId: '602' }).id, 601, 'the executing run is never its own proof, whatever its status reads');
    assert.equal(newestCompleted([green, red], { selfRunId: 602 }).id, 601);
    assert.equal(newestCompleted([self]), null);
    assert.equal(newestCompleted([]), null);
    assert.equal(newestCompleted(undefined), null);
  });

  test('selfRunIdFrom: GITHUB_RUN_ID when it is a run id, else null', () => {
    assert.equal(selfRunIdFrom({ GITHUB_RUN_ID: '36206329284' }), '36206329284');
    assert.equal(selfRunIdFrom({}), null);
    assert.equal(selfRunIdFrom({ GITHUB_RUN_ID: '' }), null);
    assert.equal(selfRunIdFrom({ GITHUB_RUN_ID: '12a' }), null);
  });

  /** The Monday slot's shape: an ops-watch failure on main, a COMPLETED green
   *  after it, and the run executing the ledger (GITHUB_RUN_ID 603) in progress. */
  const opsWatch = (id, status, conclusion, day) => ({ id, name: 'ops-watch', path: OPS, workflow_id: 9, head_branch: 'main', head_sha: 'b'.repeat(40), event: 'schedule', status, conclusion, run_attempt: 1, created_at: `2026-09-${day}T07:45:00Z`, updated_at: `2026-09-${day}T07:55:00Z` });
  const failedOps = opsWatch(601, 'completed', 'failure', '20');
  const greenOps = opsWatch(602, 'completed', 'success', '21');
  const selfOps = opsWatch(603, 'in_progress', null, '28');
  const startupCause = { signature: 'startup:failure', rootCause: 'fixture: a failed run whose jobs the API withheld', fix: 'fixture', fixedBy: { kind: 'infrastructure' } };
  const LEDGER_ARGS = ['--repo', 'fixture/fixture', '--since', '2026-09-17T00:00:00Z', '--no-prs', '--branch', 'main'];
  const NEW_QUERY = [
    '    const body = await get(`/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=2`);',
    '    return newestCompleted(body.workflow_runs, { selfRunId });',
    '',
  ].join('\n');
  const OLD_QUERY = [
    '    const body = await get(`/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);',
    '    return body.workflow_runs?.[0] ?? null;',
    '',
  ].join('\n');

  test('CLI — an ops-watch failure followed by a COMPLETED green reads explained; the in-progress run executing the ledger is never its proof: exit 0', () => {
    const c = liveCopy(5000, [failedOps], { workflowRuns: [selfOps, greenOps, failedOps], branches: ['main'], causes: [startupCause] });
    const r = run(c.script, LEDGER_ARGS, { ...c.env, GITHUB_RUN_ID: '603' });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /later green: run 602 @ 2026-09-21T07:45:00Z/);
    assert.doesNotMatch(r.out, /run 603/);
    assert.match(r.out, /UNEXPLAINED: 0/);
    assert.ok(c.fetched().includes('/repos/fixture/fixture/actions/workflows/9/runs'), 'the proof must have been asked of GitHub');
  });

  test('MUTATION: the old unfiltered per_page=1 query restored, in a COPY of the script, takes the executing run as the proof — exit 1, OPEN', () => {
    const original = readFileSync(SCRIPT, 'utf8');
    const c = liveCopy(5000, [failedOps], {
      workflowRuns: [selfOps, greenOps, failedOps],
      branches: ['main'],
      causes: [startupCause],
      mutate: (src) => {
        assert.ok(src.includes(NEW_QUERY), 'the query this mutation replaces is not in the script');
        return src.replace(NEW_QUERY, OLD_QUERY);
      },
    });
    const r = run(c.script, LEDGER_ARGS, { ...c.env, GITHUB_RUN_ID: '603' });
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /OPEN — newest ops-watch\.yml on main is run 603 \(null\)/);
    assert.match(r.out, /UNEXPLAINED: 1/);
    assert.equal(readFileSync(SCRIPT, 'utf8'), original, 'the real script must not have been touched');
  });

  test('CLI — a listing that answers the executing run as completed still never makes it the proof: GITHUB_RUN_ID is skipped (exit 0); without GITHUB_RUN_ID it is read (exit 1)', () => {
    const staleSelf = { ...selfOps, status: 'completed', conclusion: 'failure' };
    const opts = { workflowRuns: [staleSelf, greenOps, failedOps], branches: ['main'], causes: [startupCause] };
    const inside = liveCopy(5000, [failedOps], opts);
    const r = run(inside.script, LEDGER_ARGS, { ...inside.env, GITHUB_RUN_ID: '603' });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /later green: run 602 @ /);
    const outside = liveCopy(5000, [failedOps], opts);
    const o = run(outside.script, LEDGER_ARGS, outside.env);
    assert.equal(o.code, 1, o.out + o.err);
    assert.match(o.out, /OPEN — newest ops-watch\.yml on main is run 603 \(failure\)/);
  });
});
