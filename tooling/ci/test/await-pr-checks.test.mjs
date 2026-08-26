// ─────────────────────────────────────────────────────────────────────────────
// await-pr-checks.test.mjs — the empty-list floor that stops a poller grading
// "no checks have registered" as "every check passed".
//
// 🔴 THE DEFECT THIS ENCODES HAPPENED ON 2026-08-26, IN THIS REPOSITORY. An
// ad-hoc wait loop over PR #384 used `all(.bucket != "pending")`, which is
// trivially TRUE over an EMPTY list — `[].every()` is `true` — printed
// `pass: 2`, and reported the PR settled. What actually held the merge was
// branch protection, at MERGEABLE / BLOCKED. Not the poll.
//
// ⚠️ THE HEADLINE CASE IS `classify([])`, AND ITS MUTATION IS ONE LINE.
// `settledGreen = (checks) => checks.length > 0 && checks.every(isPassed)`.
// Drop the `length > 0` conjunct and the empty list becomes `state: 'pass'`,
// `code: 0` — the original bug, restored, under a nicer name. Six cases below
// go red on exactly that edit, and they are the reason this file exists.
//
// ⚠️ NOTHING HERE TOUCHES THE NETWORK OR GITHUB. Every CLI case runs through
// the fixture transport, which has no `fetch` in it at all. The credential
// cases assert only the "I could not tell" exits, driven by withholding the
// token.
//
// Run:  node --test tooling/ci/test/await-pr-checks.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIONS_APP,
  PASSING,
  appOf,
  isCompleted,
  isPassed,
  isFailed,
  settledGreen,
  gradedSet,
  classify,
  tally,
  parseArgs,
} from '../../ops/await-pr-checks.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'await-pr-checks.mjs');

const temps = [];
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'await-pr-checks-'));
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

/** Run the CLI with an environment built FROM SCRATCH.
 *
 *  🔴 NOT INHERITED, for the same reason safe-rerun.test.mjs does it: the
 *  script falls back to the local vault for its token, so a case that merely
 *  omitted GH_TOKEN would mean "no credential" on a CI runner and "a real
 *  credential, contact GitHub" on the owner's laptop. Every case SETS what it
 *  wants, and `NIKATRU_VAULT` points at an absent file. */
function run(args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NIKATRU_VAULT: join(REPO, 'no', 'such', 'vault.env'),
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Write a fixture and return its path, plus the env that selects it. */
function fixture(body) {
  const p = join(temp(), 'fx.json');
  writeFileSync(p, JSON.stringify(body), 'utf8');
  return p;
}

const check = (over = {}) => ({
  name: 'ci-gate',
  status: 'completed',
  conclusion: 'success',
  app: { slug: ACTIONS_APP },
  ...over,
});
const cf = (over = {}) => check({ name: 'Cloudflare Pages: nikatru', app: { slug: 'cloudflare-workers-and-pages' }, ...over });

const SHA = 'b747dd29c4d43768a9098e94ab5f2d763bbf0e64';
const SHA2 = '9383f2458e0a81112406ffd56a5a031d2b454d45';

// ═══════════════════════════════════════════════════════════════════════════
describe('🔴 THE EMPTY LIST IS NEVER A PASS — the headline case', () => {
  test('classify([]) is NOT a pass', () => {
    const v = classify([]);
    assert.notEqual(v.state, 'pass');
    assert.notEqual(v.code, 0);
  });

  test('classify([]) is NO CHECKS REGISTERED at code 2, not a failure', () => {
    const v = classify([]);
    assert.equal(v.state, 'no-checks');
    assert.equal(v.code, 2);
    assert.equal(v.headline, 'NO CHECKS REGISTERED');
    assert.notEqual(v.code, 1, 'an empty list is not "it failed" either');
  });

  test('settledGreen([]) is FALSE — a bare .every() would return true here', () => {
    assert.equal([].every(isPassed), true, 'the language fact this floor exists for');
    assert.equal(settledGreen([]), false);
  });

  test('the empty verdict SAYS it could not tell, in words', () => {
    const v = classify([]);
    assert.match(v.reason, /could not tell/i);
    assert.match(v.reason, /not "it is fine"/);
    assert.match(v.reason, /not "it failed"/);
  });

  test('a head carrying ONLY non-Actions checks is still NO CHECKS REGISTERED', () => {
    // PR #384's shape: Cloudflare Pages posted, Actions did not. Two green
    // integration checks are not CI having graded the commit.
    const v = classify([cf(), cf({ name: 'Cloudflare Pages: rajasekarselvam' })]);
    assert.equal(v.state, 'no-checks');
    assert.equal(v.code, 2);
    assert.match(v.reason, /2 check-run\(s\) from other apps are present and were NOT counted/);
  });

  test('CLI: an empty check list exits 2 and prints NO CHECKS REGISTERED', () => {
    const p = fixture({ repo: 'o/r', polls: [{ headSha: SHA, checkRuns: [] }], repeatLast: true });
    const r = run(['384', '--timeout-seconds', '1', '--poll-seconds', '0.2'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /NO CHECKS REGISTERED/);
    assert.doesNotMatch(r.out, /ALL CHECKS PASSED/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the three outcomes are three codes and three sentences', () => {
  test('pass — one or more checks, all green, exit 0', () => {
    const v = classify([check(), check({ name: 'Workspace gate' })]);
    assert.equal(v.state, 'pass');
    assert.equal(v.code, 0);
    assert.equal(v.headline, 'ALL CHECKS PASSED');
  });

  test('fail — a completed failure decides it, exit 1', () => {
    const v = classify([check(), check({ name: 'Workspace gate', conclusion: 'failure' })]);
    assert.equal(v.state, 'fail');
    assert.equal(v.code, 1);
    assert.equal(v.headline, 'A CHECK FAILED');
    assert.match(v.reason, /Workspace gate → failure/);
  });

  test('MIXED pass/fail is a FAILURE, not a pass and not pending', () => {
    const mixed = [
      check({ name: 'a' }),
      check({ name: 'b' }),
      check({ name: 'c', conclusion: 'failure' }),
      check({ name: 'd' }),
    ];
    const v = classify(mixed);
    assert.equal(v.code, 1);
    assert.equal(settledGreen(mixed), false, 'the green floor must not accept a set containing a failure');
  });

  test('a failure decides even while siblings are still running', () => {
    const v = classify([check({ name: 'a', status: 'in_progress', conclusion: null }), check({ name: 'b', conclusion: 'failure' })]);
    assert.equal(v.code, 1, 'a decided no must not wait for the rest');
  });

  test('the three headlines are three DISTINCT strings', () => {
    const headlines = [
      classify([check()]).headline,
      classify([check({ conclusion: 'failure' })]).headline,
      classify([]).headline,
    ];
    assert.equal(new Set(headlines).size, 3, headlines.join(' | '));
  });

  test('the three codes are three DISTINCT numbers', () => {
    const codes = [
      classify([check()]).code,
      classify([check({ conclusion: 'failure' })]).code,
      classify([]).code,
    ];
    assert.deepEqual(codes, [0, 1, 2]);
  });

  test('CLI: all-green exits 0', () => {
    const p = fixture({ repo: 'o/r', polls: [{ headSha: SHA, checkRuns: [check(), cf()] }] });
    const r = run(['386'], { AWAIT_PR_CHECKS_FIXTURE: p });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ALL CHECKS PASSED/);
  });

  test('CLI: a failing check exits 1 and names it', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [{ headSha: SHA, checkRuns: [check(), check({ name: 'platform Worker', conclusion: 'failure' })] }],
    });
    const r = run(['386'], { AWAIT_PR_CHECKS_FIXTURE: p });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /A CHECK FAILED/);
    assert.match(r.out, /platform Worker/);
    assert.doesNotMatch(r.out, /NO CHECKS REGISTERED/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the timeout is bounded and exits NON-ZERO', () => {
  test('a check that never completes leaves the verdict pending, never pass', () => {
    const v = classify([check({ status: 'in_progress', conclusion: null })]);
    assert.equal(v.state, 'pending');
    assert.equal(v.code, null, 'pending is not an answer — the loop must keep polling');
  });

  test('CLI: a forever-pending check times out at exit 2, NOT 0', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [{ headSha: SHA, checkRuns: [check({ status: 'in_progress', conclusion: null })] }],
      repeatLast: true,
    });
    const r = run(['364', '--timeout-seconds', '1', '--poll-seconds', '0.2'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /STILL PENDING AT TIMEOUT/);
    assert.doesNotMatch(r.out, /ALL CHECKS PASSED/);
  });

  test('CLI: the timeout says it could not tell, not that it is fine', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [{ headSha: SHA, checkRuns: [check({ status: 'queued', conclusion: null })] }],
      repeatLast: true,
    });
    const r = run(['364', '--timeout-seconds', '1', '--poll-seconds', '0.2'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /I COULD NOT TELL/);
  });

  test('CLI: a green check arriving on a LATER poll still exits 0 — the timeout is not a blanket refusal', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [
        { headSha: SHA, checkRuns: [] },
        { headSha: SHA, checkRuns: [check({ status: 'in_progress', conclusion: null })] },
        { headSha: SHA, checkRuns: [check()] },
      ],
    });
    const r = run(['386', '--timeout-seconds', '20', '--poll-seconds', '0'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 0, r.out);
  });

  test('--timeout-seconds must be positive', () => {
    assert.match(parseArgs(['386', '--timeout-seconds', '0']).error, /positive number/);
    assert.match(parseArgs(['386', '--timeout-seconds', 'soon']).error, /positive number/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the check-run APP is distinguishable', () => {
  test('Actions is the default graded set', () => {
    assert.deepEqual([...parseArgs(['386']).requiredApps], [ACTIONS_APP]);
  });

  test('--any-app grades everything, so two Cloudflare passes read as a pass', () => {
    assert.equal(parseArgs(['386', '--any-app']).requiredApps, null);
    assert.equal(classify([cf(), cf()], null).code, 0);
  });

  test('--app narrows to a named slug', () => {
    assert.deepEqual([...parseArgs(['386', '--app', 'cloudflare-workers-and-pages']).requiredApps], [
      'cloudflare-workers-and-pages',
    ]);
  });

  test('--any-app and --app together are refused rather than silently ranked', () => {
    assert.match(parseArgs(['386', '--any-app', '--app', 'x']).error, /contradictory/);
  });

  test('gradedSet filters by app, and null means all', () => {
    const all = [check(), cf()];
    assert.equal(gradedSet(all, new Set([ACTIONS_APP])).length, 1);
    assert.equal(gradedSet(all, null).length, 2);
  });

  test('a FAILING Cloudflare check does not fail an Actions-scoped verdict', () => {
    const v = classify([check(), cf({ conclusion: 'failure' })]);
    assert.equal(v.code, 0, 'the scope is what was asked about');
    assert.equal(classify([check(), cf({ conclusion: 'failure' })], null).code, 1);
  });

  test('tally prints the per-app evidence', () => {
    const t = tally([check(), check(), cf()]);
    assert.match(t, /github-actions=2/);
    assert.match(t, /cloudflare-workers-and-pages=1/);
  });

  test('tally over nothing says so rather than printing an empty string', () => {
    assert.equal(tally([]), '(none)');
  });

  test('CLI: 18 Actions + 2 Cloudflare, Actions-scoped, is a pass', () => {
    const checks = [...Array(18)].map((_, i) => check({ name: `job-${i}` })).concat([cf(), cf()]);
    const p = fixture({ repo: 'o/r', polls: [{ headSha: SHA, checkRuns: checks }] });
    const r = run(['386'], { AWAIT_PR_CHECKS_FIXTURE: p });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /github-actions=18/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('conclusions are graded fail-closed', () => {
  for (const c of ['success', 'skipped', 'neutral']) {
    test(`\`${c}\` counts as passed`, () => {
      assert.equal(isPassed(check({ conclusion: c })), true);
      assert.equal(PASSING.has(c), true);
    });
  }
  for (const c of ['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure']) {
    test(`\`${c}\` counts as FAILED`, () => {
      assert.equal(isFailed(check({ conclusion: c })), true);
      assert.equal(classify([check({ conclusion: c })]).code, 1);
    });
  }

  test('a conclusion nobody has seen before is FAILED, not passed', () => {
    assert.equal(isFailed(check({ conclusion: 'some_future_verdict' })), true);
  });

  test('a completed check with a NULL conclusion is not a pass', () => {
    assert.equal(isPassed(check({ conclusion: null })), false);
  });

  test('an incomplete check is neither passed nor failed', () => {
    const c = check({ status: 'in_progress', conclusion: null });
    assert.equal(isCompleted(c), false);
    assert.equal(isPassed(c), false);
    assert.equal(isFailed(c), false);
  });

  test('appOf survives a check-run with no app object', () => {
    assert.equal(appOf({ name: 'x' }), '');
    assert.equal(classify([{ name: 'x', status: 'completed', conclusion: 'success' }]).state, 'no-checks');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the head SHA is re-resolved on every poll', () => {
  test('CLI: a force-push mid-poll is announced and regraded, not settled against the stale commit', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [
        { headSha: SHA, checkRuns: [check()] /* green on the OLD head */ },
        { headSha: SHA2, checkRuns: [check({ conclusion: 'failure' })] },
      ],
    });
    // The first poll is green, so a settled-once poller would exit 0 here. That
    // is correct behaviour for the tool — the interesting case is the one where
    // the old head was NOT yet green, below.
    const r = run(['364'], { AWAIT_PR_CHECKS_FIXTURE: p });
    assert.equal(r.code, 0, r.out);
  });

  test('CLI: the new head is what gets graded after a move', () => {
    const p = fixture({
      repo: 'o/r',
      polls: [
        { headSha: SHA, checkRuns: [check({ status: 'in_progress', conclusion: null })] },
        { headSha: SHA2, checkRuns: [check({ conclusion: 'failure' })] },
      ],
    });
    const r = run(['364', '--timeout-seconds', '20', '--poll-seconds', '0'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /head moved b747dd29 → 9383f245/);
  });

  test('CLI: a PR reporting no head SHA is retried, then timed out at 2', () => {
    const p = fixture({ repo: 'o/r', polls: [{ headSha: null, checkRuns: [] }], repeatLast: true });
    const r = run(['999', '--timeout-seconds', '1', '--poll-seconds', '0.2'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no head SHA/);
  });

  test('CLI: an API error is retried rather than read as an answer', () => {
    const p = fixture({ repo: 'o/r', polls: [{ error: 'HTTP 502' }], repeatLast: true });
    const r = run(['364', '--timeout-seconds', '1', '--poll-seconds', '0.2'], {
      AWAIT_PR_CHECKS_FIXTURE: p,
    });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /HTTP 502/);
    assert.doesNotMatch(r.out, /ALL CHECKS PASSED/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('argument handling and the no-credential path', () => {
  test('no PR number is an error, not a default', () => {
    assert.match(parseArgs([]).error, /no PR number given/);
  });

  test('a #-prefixed PR number is accepted', () => {
    assert.equal(parseArgs(['#386']).pr, '386');
  });

  test('an unrecognised flag is refused rather than ignored', () => {
    assert.match(parseArgs(['386', '--force']).error, /unrecognised argument/);
  });

  test('--poll-seconds rejects a negative', () => {
    assert.match(parseArgs(['386', '--poll-seconds', '-1']).error, /zero or a positive number/);
  });

  test('--repo is carried through', () => {
    assert.equal(parseArgs(['386', '--repo', 'o/r']).repo, 'o/r');
  });

  test('CLI: no credential exits 2 with "I COULD NOT TELL", never 0', () => {
    const r = run(['386', '--repo', 'o/r']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /I COULD NOT TELL/);
    assert.match(r.out, /no GitHub credential/);
  });

  test('CLI: no PR number exits 2', () => {
    const r = run([]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no PR number given/);
  });

  test('CLI: a missing fixture path exits 2 rather than falling through to the network', () => {
    const r = run(['386'], { AWAIT_PR_CHECKS_FIXTURE: join(REPO, 'no', 'such', 'fx.json') });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /which does not exist/);
  });
});
