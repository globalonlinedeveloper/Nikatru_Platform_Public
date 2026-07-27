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
  const newest = successes.reduce((a, b) => (Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a));
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
  if (!verdict.ok) {
    fail(`platform proof is not fresh — ${verdict.reason}`);
    console.error('');
    console.error(`      The six-platform build has not gone green on ${BRANCH} recently enough.`);
    console.error('      Refresh it with ONE command, then re-run this job:');
    console.error('');
    console.error(`          gh workflow run ${WORKFLOW} --ref ${BRANCH}`);
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
