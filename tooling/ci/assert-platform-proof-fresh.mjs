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
// ── 🔴 THE COVERAGE SELF-CHECK USED TO BE TWO GREPS, AND BOTH COULD BE FOOLED ─
// Repaired 2026-08-08 after an audit, and both defects were proven by mutating
// the real workflow before a line was touched.
//
//   · THE BUILD CLAUSE grepped comment-stripped YAML for `flutter build <x>`.
//     Replacing every real build step with `run: echo "flutter build ios
//     disabled"` returned null — PASS. The six-platform claim was being checked
//     against a string, and a string is exactly what a disabled step still
//     contains. It now reads the workflow through tooling/ci/workflow-scan.mjs
//     (the one parser four guards share) and requires the COMMAND WORD of a real
//     shell segment to be `flutter` with subcommand `build <target>`. An echo
//     about a build is no longer a build.
//   · THE TARGET LIST was a typed array — `['web','linux','apk',…]` — sitting
//     next to a register that already declares every platform this factory
//     claims. Two declarations of one fact, and the copy in the guard is the one
//     that goes stale when a seventh platform is added. It is now DERIVED from
//     the `platforms` of every row in tooling/channel-register.json, through a
//     platform→build-target table that FAILS on a platform it does not know
//     rather than skipping it.
//   · THE AGGREGATOR CLAUSE read `needs:` with a WHOLE-FILE
//     `/needs:\s*\[([^\]]+)\]/` — the first flow-form list anywhere in the file —
//     and then asked whether a job name was a SUBSTRING of it. Two workflow
//     comments in build-platforms.yml exist solely to warn the next editor about
//     that fragility. A decoy flow-form list above the aggregator, with the
//     aggregator itself stripped back to `needs: [gate, prepare]`, returned null
//     — PASS. It now reads the aggregator's OWN parsed job body, and the
//     aggregator is named by tooling/channel-register.json rather than typed here.
//
// RECORDED FAILING CASES (all three, in tooling/ci/test/platform-proof-fresh.test.mjs,
// mutated from the REAL workflow and not from a hand-written fixture):
//   1. every `flutter build <t>` rewritten to `echo "flutter build <t> disabled"` → red
//   2. the `apple` job's two build steps deleted                                  → red
//   3. a decoy `needs: [linux_web_android, windows, apple]` above an aggregator
//      whose own needs list drops all three                                       → red
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
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, shellSegments, WORKFLOW_DIR } from './workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = 'build-platforms.yml';
const WORKFLOW_REL = `${WORKFLOW_DIR}/${WORKFLOW}`;
const REGISTER_REL = 'tooling/channel-register.json';
const BRANCH = 'main';
const MAX_AGE_DAYS = 14;
const DEFAULT_REPO = 'globalonlinedeveloper/Project_Cross_Platform_Apps';

/**
 * 🔴 THE PLATFORM SET IS NOT TYPED HERE — this is the TRANSLATION, not the list.
 *
 * WHICH platforms the factory claims comes from the `platforms` of every row in
 * tooling/channel-register.json, which [9]R-5 already maintains and which
 * assert-channel-register.mjs already polices. What that register cannot say is
 * the SHELL COMMAND that compiles one, so this table maps a platform name to the
 * `flutter build <target>` subcommands that count as having built it.
 *
 * A platform in the register with no row here is a COVERAGE LOST, never a skip:
 * a seventh platform added to the register must arrive with the command that
 * proves it, or this guard would silently certify five out of six as "all".
 *
 * `android` accepts EITHER target. `apk` is the sideloadable build proof and
 * `appbundle` is the Play artifact; both compile the same Android target, and
 * which of them a lane emits is assert-channel-register.mjs's question (it
 * compares a row's artifactFormats against what its lane produces), not this
 * one's. This guard asks only "did Android compile".
 */
export const PLATFORM_BUILD_TARGETS = new Map([
  ['web', ['web']],
  ['linux', ['linux']],
  ['android', ['apk', 'appbundle']],
  ['windows', ['windows']],
  ['macos', ['macos']],
  ['ios', ['ios']],
]);

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

/**
 * Quoted string literals BLANKED before anything reads a command out of a shell
 * line. `echo "flutter build ios disabled"` becomes `echo ""`, so the words
 * survive in no position a command word can be read from — and a `;` or `&&`
 * inside a quoted string can no longer split one command into two.
 *
 * This is the house rule ("strip comments AND string literals before scanning")
 * applied to the exact defect it was written for: the previous version of this
 * guard grepped the raw YAML and an echo satisfied it.
 */
export function blankStringLiterals(text) {
  return String(text ?? '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * Every `flutter build <target>` the workflow really RUNS, by target.
 *
 * STRUCTURAL, not textual. It walks the parsed jobs from workflow-scan.mjs —
 * which folds `run: >` into one logical command and joins `run: |` lines with
 * ` ; ` so neither shape can hide or merge a command — splits each into shell
 * segments, and requires the segment's COMMAND WORD to be `flutter` and its
 * subcommand to be `build`. Leading `VAR=value` assignments, `env` and `sudo`
 * are stepped over because they precede a command word without being one.
 *
 * A `flutter build` inside an unquoted command substitution is deliberately NOT
 * matched: that direction fails CLOSED (a missing target, a red guard), which is
 * the safe way to be wrong here.
 */
export function flutterBuildTargets(wf) {
  const found = new Map();
  let runBlocks = 0;
  for (const job of wf.jobs.values()) {
    for (const line of job.logical) {
      const m = line.text.match(/^\s*(?:-\s+)?run:\s*(\S.*)$/);
      if (!m) continue;
      runBlocks++;
      for (const seg of shellSegments(blankStringLiterals(m[1]))) {
        const tokens = seg.trim().split(/\s+/).filter(Boolean);
        let i = 0;
        while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'env')) i++;
        const cmd = tokens[i];
        if (cmd === undefined) continue;
        if ((cmd.split('/').pop() ?? '').replace(/\.(exe|bat|cmd)$/i, '') !== 'flutter') continue;
        if (tokens[i + 1] !== 'build') continue;
        const target = tokens[i + 2];
        if (!target || target.startsWith('-')) continue;
        if (!found.has(target)) found.set(target, []);
        found.get(target).push({ job: job.name, n: line.n });
      }
    }
  }
  return { found, runBlocks };
}

/** The platforms this factory claims, and the build targets that prove each. */
export function requiredTargets(register) {
  const platforms = new Set();
  for (const c of register?.channels ?? []) {
    for (const p of c?.platforms ?? []) if (typeof p === 'string' && p !== '') platforms.add(p);
  }
  const unmapped = [...platforms].filter((p) => !PLATFORM_BUILD_TARGETS.has(p)).sort();
  const required = new Map();
  for (const p of [...platforms].sort()) if (PLATFORM_BUILD_TARGETS.has(p)) required.set(p, PLATFORM_BUILD_TARGETS.get(p));
  return { platforms: [...platforms].sort(), required, unmapped };
}

// COVERAGE SELF-CHECK. This guard reads a workflow by NAME over the network. If
// that workflow is renamed or deleted the API returns an empty list, which is
// indistinguishable from "never run" — and asserting on the cron additionally
// catches the CAUSE rather than waiting 14 days for the SYMPTOM.
//
// Returns `{ problem, summary }`. `problem` is a COVERAGE LOST sentence or null;
// `summary` is the REQUIRED_COVERAGE line printed on a pass, so a green run says
// WHAT it covered instead of only that it was happy.
export function platformProofCoverage(root = ROOT) {
  const lost = (problem) => ({ problem, summary: null });
  const path = resolve(root, WORKFLOW_DIR, WORKFLOW);
  if (!existsSync(path)) {
    return lost(
      `COVERAGE LOST — ${WORKFLOW} does not exist. This guard is watching a workflow that is gone, so it can only ever report a stale proof for a build that no longer runs.`,
    );
  }
  const wf = parseWorkflow(root, WORKFLOW_REL);
  if (!wf) return lost(`COVERAGE LOST — ${WORKFLOW} exists and could not be parsed, so every clause below would be asked of nothing.`);

  // Comments are BLANKED by parseWorkflow, not deleted, so a `# schedule:` line
  // documenting a schedule nobody enabled cannot satisfy the timer clause and
  // reported line numbers still point into the real file.
  const header = wf.lines
    .slice(0, wf.jobsAt === null ? wf.lines.length : wf.jobsAt)
    .map((l) => l.text)
    .join('\n');
  if (!/^\s+schedule:\s*$/m.test(header)) {
    return lost(
      `COVERAGE LOST — ${WORKFLOW} declares no 'schedule:' trigger. The freshness clause depends on it; without a timer the proof is guaranteed to go stale and this guard becomes a countdown, not a check.`,
    );
  }
  if (!/^\s+-\s*cron:\s*['"]/m.test(header)) {
    return lost(`COVERAGE LOST — ${WORKFLOW} has a 'schedule:' block with no cron entry.`);
  }

  // ── the platform set, DERIVED ──────────────────────────────────────────────
  const registerAbs = join(root, REGISTER_REL);
  if (!existsSync(registerAbs)) {
    return lost(
      `COVERAGE LOST — ${REGISTER_REL} does not exist under ${root}. The set of platforms this proof must cover is derived from it; ` +
        'without it this guard would range over an empty platform set and certify a workflow that builds nothing.',
    );
  }
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    return lost(`COVERAGE LOST — ${REGISTER_REL} is not valid JSON (${e.message}), so the required platform set has no source.`);
  }
  const { platforms, required, unmapped } = requiredTargets(register);
  if (platforms.length === 0) {
    return lost(
      `COVERAGE LOST — no row in ${REGISTER_REL} declares a \`platforms\` array, so "the factory claims N platforms" has no answer ` +
        'and the build clause below would be satisfied by a workflow that compiles nothing.',
    );
  }
  if (unmapped.length) {
    return lost(
      `COVERAGE LOST — ${REGISTER_REL} claims platform(s) this guard has no build command for: ${unmapped.join(', ')}. ` +
        'Add them to PLATFORM_BUILD_TARGETS in this file with the `flutter build <target>` that proves them. Skipping an unknown ' +
        'platform is how five out of six comes to read as "all".',
    );
  }

  // ── ⚠️ THE TIMER IS NOT THE WORK ───────────────────────────────────────────
  // Until 2026-07-27 this function stopped at the cron: it asserted the file
  // existed and carried a timer, and never looked at what the workflow BUILDS.
  // Deleting every macOS and iOS build step returned null — pass. This is the
  // only place anything compiles for macOS, iOS, Windows or Linux (main CI runs
  // analyze/test, which compile no native target), so two of six could vanish
  // from the factory's only compile proof with ci-gate green throughout.
  const { found, runBlocks } = flutterBuildTargets(wf);
  if (runBlocks === 0) {
    return lost(
      `COVERAGE LOST — the run-block parse found ZERO \`run:\` commands in ${WORKFLOW}'s ${wf.jobs.size} job(s). ` +
        'The structural scan has stopped reaching the file, and every build clause below would be answered over nothing.',
    );
  }
  if (found.size === 0) {
    return lost(
      `COVERAGE LOST — ${runBlocks} run block(s) were read in ${WORKFLOW} and NONE of them is a \`flutter build\` command. ` +
        'Either the workflow compiles nothing at all, or the command classifier has stopped matching — and both report the same clean tree.',
    );
  }
  const missing = [...required].filter(([, targets]) => !targets.some((t) => found.has(t)));
  if (missing.length) {
    return lost(
      `COVERAGE LOST — ${WORKFLOW} no longer builds: ${missing.map(([p, t]) => `${p} (needs \`flutter build ${t.join('` or `')}\`)`).join(', ')}. ` +
        `The factory claims ${platforms.length} platform(s) in ${REGISTER_REL} and this workflow is the only thing that compiles them, so a missing ` +
        'target means the claim is unproven rather than merely untested. ' +
        `Found instead: ${[...found.keys()].sort().join(', ') || '(nothing)'}.`,
    );
  }

  // ── the aggregator, read from ITS OWN parsed job body ──────────────────────
  // A build job that exists but is not in the aggregator's `needs:` still runs
  // and can still fail without failing the workflow — a green tick over a red
  // job. The aggregator is named by the register (assert-channel-register.mjs
  // holds the same declaration) rather than typed here, and its dependencies
  // come from workflow-scan.mjs's per-job parse — which handles the flow, block
  // and scalar forms and strips quotes in all three. The previous whole-file
  // regex read the FIRST flow list anywhere in the file, which two comments in
  // build-platforms.yml exist solely to warn the next editor about.
  const agg = register?.aggregatingJob;
  if (!agg || typeof agg.workflow !== 'string' || typeof agg.job !== 'string') {
    return lost(
      `COVERAGE LOST — ${REGISTER_REL} declares no \`aggregatingJob\` {workflow, job}. The wiring clause has no subject, so every ` +
        'build job in this workflow could sit outside the aggregate and fail without failing the run.',
    );
  }
  if (agg.workflow !== WORKFLOW_REL) {
    return lost(
      `COVERAGE LOST — ${REGISTER_REL}'s aggregatingJob names ${agg.workflow}, and this guard's subject is ${WORKFLOW_REL}. ` +
        "Two readings of 'which job aggregates the platform proof' have come apart, and this one would grade a job in another file.",
    );
  }
  const aggregator = wf.jobs.get(agg.job);
  if (!aggregator) {
    return lost(
      `COVERAGE LOST — ${REGISTER_REL} names ${agg.workflow}#${agg.job} as the aggregator and this parse did not resolve that job. ` +
        'The wiring clause would then be computed against an empty `needs` list and report every build job unwired, or nothing at all.',
    );
  }
  const buildJobs = [...new Set([...required.values()].flatMap((targets) => targets.flatMap((t) => (found.get(t) ?? []).map((h) => h.job))))].sort();
  if (buildJobs.length === 0) {
    return lost(`COVERAGE LOST — every required build was matched and none of them resolved to a job name; the job parse has stopped working.`);
  }
  const needs = new Set(aggregator.needs);
  const unwired = buildJobs.filter((j) => !needs.has(j));
  if (unwired.length) {
    return lost(
      `COVERAGE LOST — ${WORKFLOW}'s aggregator "${agg.job}" does not depend on: ${unwired.join(', ')}. ` +
        `Its \`needs\` reads [${[...needs].join(', ') || '(empty)'}]. ` +
        'A build job outside the aggregator can fail while the workflow still reports success.',
    );
  }

  return {
    problem: null,
    summary:
      `REQUIRED_COVERAGE — ${platforms.length} platform(s) from ${REGISTER_REL} {${platforms.join(' ')}} all built by a real ` +
      `\`flutter build\` command in ${WORKFLOW} (targets found: ${[...found.keys()].sort().join(' ')}); ` +
      `${buildJobs.length} build job(s) {${buildJobs.join(' ')}} all in aggregator "${agg.job}"'s needs`,
  };
}

/** The predicate form: the COVERAGE LOST sentence, or null when the scan is
 *  still reaching everything it claims. */
export function assertWatchedWorkflowIntact(root = ROOT) {
  return platformProofCoverage(root).problem;
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
  const coverage = platformProofCoverage();
  if (coverage.problem) {
    fail(coverage.problem);
    return;
  }
  console.log(`ok  ${coverage.summary}`);

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
