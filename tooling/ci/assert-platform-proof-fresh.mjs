#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-platform-proof-fresh.mjs — the six-platform build proof must be RECENT.
//
// [pipeline F-4] The factory claims a specific platform set, and build-platforms.yml
// proves that set builds. The proof half was real. The FRESHNESS half was not:
// the workflow ran only on `workflow_dispatch` or a `subly-v*` tag, so the green
// tick in the spec was undated. It was found EIGHT COMMITS STALE, and it was
// fresh again only because a human dispatched it by hand.
//
// An undated proof is the failure this whole stage exists to eliminate: the
// requirement as originally written COULD NOT FAIL. You would discover that iOS
// broke three weeks ago at the moment you try to ship to a store.
//
// TWO PIECES, and the second is the one that matters:
//   1. build-platforms.yml now runs on a weekly schedule.
//   2. THIS guard reads the age of the newest successful run and fails past a
//      ceiling. Piece 2 is what makes piece 1 honest — a schedule can quietly
//      stop (GitHub disables scheduled workflows in public repos after a long
//      inactive stretch; a renamed branch or a quota change does the same). If
//      the timer dies the proof ages, this goes red, and silence stops being
//      ambiguous. Without it we would be trusting a cron nobody watches, which
//      is the same class of bug as trusting a backup nobody restores.
//
// MAX_AGE_DAYS = 14 is ARBITRARY and recorded as arbitrary. Short enough that rot
// surfaces inside a sprint, long enough that a quiet fortnight does not nag. It
// is one constant; change it deliberately.
//
// FAILS CLOSED. No token, a non-200, malformed JSON, or zero successful runs are
// all failures. "I could not tell" must never read as "it is fine" — that is
// exactly how the original claim became unfalsifiable.
//
// THE REMEDY IS ONE COMMAND, and the failure message says so, because a guard
// whose fix is not obvious is a guard people disable.
//
// Offline testing: --runs-file <json> --now <iso> injects fixture data so the
// decision logic is genuinely exercised without network. It prints a loud banner
// so its presence in a real CI log is unmistakable.
//
// LANE-BOUND: build-platforms.yml — this guard's SUBJECT is that one workflow's run history, not a
// channel's artifact. There is exactly one 6-platform proof in this factory and build-platforms.yml IS
// it; a second lane would not dilute this check, it would be a second proof needing its own freshness
// row. Deriving the file from tooling/channel-register.json would be wrong twice over: two rows name
// this workflow as their lane, and the `web` row does not name it at all while this guard asserts a web
// build inside it. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-platform-proof-fresh.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = 'build-platforms.yml';
const BRANCH = 'main';
const MAX_AGE_DAYS = 14;
const DEFAULT_REPO = 'globalonlinedeveloper/Project_Cross_Platform_Apps';

// The six platforms the factory claims, as they appear in `flutter build <x>`.
// `apk` is Android — it cannot build on the owner's Windows box (a socket-layer
// fault, not Gradle), so CI is the ONLY place Android is ever compiled.
const REQUIRED_BUILDS = ['web', 'linux', 'apk', 'windows', 'macos', 'ios'];
const REQUIRED_JOBS = ['linux_web_android', 'windows', 'apple'];

// A hand-pressed run proves the workflow works. It does NOT prove the timer
// works, and freshness is a claim about the timer. All five runs to date are
// `workflow_dispatch` — the schedule has never once fired — so a dead cron has
// been indistinguishable from a healthy one, masked by any manual press.
//
// Failing outright today would block every PR for work that simply has not had
// a chance to happen yet (the cron landed 50 minutes after its own Monday slot;
// first possible fire 2026-08-03). So this is a DATED tripwire, not a permanent
// warning: printed loudly until the deadline, hard failure after it. A gap that
// only ever prints is one nobody closes.
const SCHEDULE_PROOF_DEADLINE = Date.parse('2026-08-10T00:00:00Z');

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That exact off-by-one shipped in assert-gate-passed.mjs and blocked both
// production deploys with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

// Strip full-line comments before scanning YAML. A grep for '"r2_buckets"' once
// matched the template comment explaining why there is no r2_buckets; the same
// trap applies to a `# schedule:` line that documents a schedule nobody enabled.
function stripComments(yaml) {
  return yaml
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

// COVERAGE SELF-CHECK. This guard reads a workflow by NAME over the network. If
// that workflow is renamed or deleted the API returns an empty list, which is
// indistinguishable from "never run" — and asserting on the cron additionally
// catches the CAUSE rather than waiting 14 days for the SYMPTOM.
export function assertWatchedWorkflowIntact(root = ROOT) {
  const path = resolve(root, '.github/workflows', WORKFLOW);
  if (!existsSync(path)) {
    return `COVERAGE LOST — ${WORKFLOW} does not exist. This guard is watching a workflow that is gone, so it can only ever report a stale proof for a build that no longer runs.`;
  }
  const yaml = stripComments(readFileSync(path, 'utf8'));
  if (!/\n\s+schedule:/.test(yaml)) {
    return `COVERAGE LOST — ${WORKFLOW} declares no 'schedule:' trigger. The freshness clause depends on it; without a timer the proof is guaranteed to go stale and this guard becomes a countdown, not a check.`;
  }
  if (!/\n\s+-\s*cron:\s*['"]/.test(yaml)) {
    return `COVERAGE LOST — ${WORKFLOW} has a 'schedule:' block with no cron entry.`;
  }

  // ⚠️ THE ABOVE CHECKS THE TIMER, NOT THE WORK. Until 2026-07-27 this function
  // stopped here: it asserted the file existed and carried a cron, and never
  // looked at what the workflow BUILDS. Deleting every macOS and iOS build step
  // returned null — pass. This is the only place anything compiles for macOS,
  // iOS, Windows or Linux (main CI runs analyze/test, which compile no native
  // target), so two of the six platforms could vanish from the factory's only
  // compile proof with ci-gate green and F-4 reading VERIFIED throughout.
  const missing = REQUIRED_BUILDS.filter((b) => !new RegExp(`flutter build ${b}\\b`).test(yaml));
  if (missing.length) {
    return (
      `COVERAGE LOST — ${WORKFLOW} no longer builds: ${missing.join(', ')}. ` +
      'The factory claims six platforms and this workflow is the only thing that compiles them, ' +
      'so a missing target means the claim is unproven rather than merely untested.'
    );
  }

  // A build job that exists but is not in the aggregator's `needs:` still runs
  // and can still fail without failing the workflow — a green tick over a red job.
  const needs = yaml.match(/needs:\s*\[([^\]]+)\]/)?.[1] ?? '';
  const unwired = REQUIRED_JOBS.filter((j) => !needs.includes(j));
  if (unwired.length) {
    return (
      `COVERAGE LOST — ${WORKFLOW}'s aggregator does not depend on: ${unwired.join(', ')}. ` +
      'A build job outside the aggregator can fail while the workflow still reports success.'
    );
  }
  return null;
}

// The decision, kept pure so it can be tested without network. This is where the
// real defects live — the API call is the boring half.
export function evaluateFreshness(runs, nowMs, maxAgeDays = MAX_AGE_DAYS) {
  if (!Array.isArray(runs)) {
    return { ok: false, reason: 'run list was not an array — treating an unreadable answer as a failure' };
  }
  const successes = runs.filter((r) => r && r.conclusion === 'success' && r.updated_at);
  if (successes.length === 0) {
    return { ok: false, reason: `no successful ${WORKFLOW} run found on ${BRANCH}` };
  }

  // FRESHNESS IS A CLAIM ABOUT THE TIMER, so only a scheduled run can satisfy
  // it. Counting manual runs is what let a never-firing cron look healthy.
  const scheduled = successes.filter((r) => r.event === 'schedule');
  if (scheduled.length === 0) {
    return {
      ok: false,
      neverScheduled: true,
      manualCount: successes.length,
      reason:
        `${successes.length} successful run(s), but NONE was triggered by the schedule — every one was manual. ` +
        'A dead cron is invisible behind a hand-press, which is exactly what freshness exists to detect.',
    };
  }
  const newest = scheduled.reduce((a, b) => (Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a));
  const stamp = Date.parse(newest.updated_at);
  if (Number.isNaN(stamp)) {
    return { ok: false, reason: `newest run has an unparseable timestamp: ${newest.updated_at}` };
  }
  const ageDays = (nowMs - stamp) / 86_400_000;
  return {
    ok: ageDays <= maxAgeDays,
    ageDays,
    runId: newest.id,
    updatedAt: newest.updated_at,
    reason: ageDays <= maxAgeDays ? null : `newest green run is ${ageDays.toFixed(1)} days old, ceiling is ${maxAgeDays}`,
  };
}

async function fetchRuns() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN / GH_TOKEN in the environment — cannot read run history, so this fails closed');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&status=success&per_page=20`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'nikatru-ci',
    },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${WORKFLOW} runs`);
  const body = await res.json();
  return body.workflow_runs;
}

async function main() {
  const coverage = assertWatchedWorkflowIntact();
  if (coverage) {
    fail(coverage);
    return;
  }

  const runsFile = flag('--runs-file');
  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    fail(`--now is not a parseable date: ${nowFlag}`);
    return;
  }

  let runs;
  if (runsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --runs-file is set. This must NEVER appear in a real CI log.');
    try {
      runs = JSON.parse(readFileSync(runsFile, 'utf8'));
    } catch (e) {
      fail(`could not read fixture ${runsFile}: ${e.message}`);
      return;
    }
  } else {
    try {
      runs = await fetchRuns();
    } catch (e) {
      fail(`${e.message}`);
      return;
    }
  }

  const verdict = evaluateFreshness(runs, nowMs);

  // The schedule has never fired yet — a "not proven" state, not a regression,
  // and it resolves itself the first Monday the cron runs. Printed loudly until
  // the deadline so it cannot be missed, then a hard failure so it cannot rot.
  if (verdict.neverScheduled) {
    const past = nowMs >= SCHEDULE_PROOF_DEADLINE;
    const line = past ? fail : (m) => console.log(`⬜  ${m}`);
    line(`platform proof has NEVER run on its schedule — ${verdict.reason}`);
    console[past ? 'error' : 'log'](
      past
        ? `      The deadline (2026-08-10) has passed and no scheduled run exists, so the timer is broken, not merely young. [pipeline F-4]`
        : `      ${verdict.manualCount} manual run(s) prove the BUILD works; none proves the TIMER does.\n` +
            '      This becomes a hard failure on 2026-08-10 if no scheduled run has landed by then.\n' +
            '      Do NOT satisfy it with `gh workflow run` — a manual press is what hid this. [pipeline F-4]',
    );
    return;
  }

  if (!verdict.ok) {
    fail(`platform proof is not fresh — ${verdict.reason}`);
    console.error('');
    console.error(`      The six-platform build has not gone green on ${BRANCH} recently enough.`);
    console.error('      ⚠️ A MANUAL RUN NO LONGER SATISFIES THIS. Freshness is a claim about the');
    console.error('      timer, so only a run triggered by `schedule` counts. If the cron is not');
    console.error('      firing, fix the cron — pressing the button just hides it again.');
    console.error('');
    console.error('      If it is failing rather than merely stale, that is the real signal —');
    console.error('      a platform we CLAIM to support has stopped building. [pipeline F-4]');
    return;
  }

  console.log(
    `ok  platform proof fresh — newest green ${WORKFLOW} run ${verdict.runId} is ${verdict.ageDays.toFixed(1)} day(s) old (ceiling ${MAX_AGE_DAYS})`,
  );
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
