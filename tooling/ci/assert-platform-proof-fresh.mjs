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
// ── 🔴 AND FRESHNESS WAS THE AGE OF THE PROOF, NEVER THE AGE OF WHAT IT PROVED ─
// Added 2026-08-11. Everything above grades a TIMESTAMP. Nothing graded the
// COMMIT, and the two came apart in exactly the way that matters:
//
//   the only six-platform proof was produced on 255265b — SEVENTEEN commits
//   behind main, and behind BOTH the Flutter 3.44.8→3.44.9 pin bump (ba6f0d8,
//   which rewrote `tooling/versions.json` and this very workflow) and the cut-1
//   auth reversal (a6a0646, which added a package to the compile). Every clause
//   above was satisfied and the ops register read GREEN, because 255265b's own
//   commit date was ONE DAY OLD. A dispatch pinned to an old ref produces a
//   young run over old code, and age cannot see the difference.
//
// So the run's `head_sha` is now graded too, in two clauses that fail for two
// genuinely different reasons:
//
//   · IDENTITY (hard, immediately). The sha must exist, be a 40-hex commit, and
//     be an ANCESTOR OF OR EQUAL TO the commit being graded. A proof produced on
//     a commit that is not in this history proves nothing about this history —
//     a force-pushed main, a rebased branch, a run against a ref that never
//     landed. When git cannot decide (no repository, a shallow clone, an object
//     this checkout never fetched) the fallback is the strictest thing still
//     derivable — the sha must EQUAL the graded commit — and anything short of
//     that PRINTS THE GAP rather than passing quietly. "I could not tell" is the
//     one answer this file has always refused to let read as "it is fine".
//
//   · INPUT CURRENCY (⬜ PRINTS, NEVER FAILS). A proof is evidence about the
//     code it compiled. It stops being evidence the moment the build's own
//     INPUTS change under it — the workflow, the toolchain pins, the pubspecs.
//     Not every source commit: main moves daily and the proof runs weekly, so
//     source drift is the accepted price of not compiling six platforms per
//     merge, and failing on it would block every PR on a build nobody can run in
//     time. A pubspec or an SDK pin is different in kind and rare in practice.
//
// ⚠️ AND THIS CLAUSE DOES NOT BITE ON ANY DATE. It shipped as a dated tripwire
// — print until 2026-08-25, hard failure after — and the date was REMOVED ON
// REVIEW before merge. Measured on the real history since 2026-07-01: 38 of 592
// commits touched `tooling/versions.json` / `build-platforms.yml` and 38 touched
// a tracked pubspec, so about one PR in eight would have started failing on a
// day nobody chose deliberately, with nothing in the tree explaining why —
// dependabot and pin-bump PRs first. The remedy is a SIX-PLATFORM compile
// (owner runner budget, [L11]), and this repo's rule for an owner-gated gap is
// to print it on every run rather than block CI on it. The full reasoning, the
// measurement and the exact way to RE-ARM it are in the block above
// `PROOF_INPUT_PATHS`. Escalating it is an OPEN OWNER DECISION, and the printed
// notice says so on every run so it cannot become invisible.
//
// THE REMEDY IS DISCHARGEABLE, which is what would make a hard failure
// legitimate if that decision is ever taken:
// `gh workflow run build-platforms.yml --ref <branch>` compiles the current
// inputs, and the run history query below is NO LONGER FILTERED TO main so that
// run counts. Freshness is untouched by that widening — it selects on
// `event === 'schedule'`, and GitHub fires schedules only on the default branch,
// so the branch filter was never what made freshness a claim about main.
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
import { spawnSync } from 'node:child_process';
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

/** A full commit id. Abbreviations are refused rather than resolved: the API
 *  always returns 40 hex, so a short one means the field was written by
 *  something other than GitHub and the guard should say so, not guess. */
const SHA_RE = /^[0-9a-f]{40}$/;

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

/**
 * THE INPUTS THE SIX-PLATFORM BUILD CONSUMES — the files whose change between
 * the proof's commit and the graded commit makes the proof evidence about
 * something else.
 *
 * 🔴 DELIBERATELY NOT "ANY SOURCE FILE". A rule that fires on every commit is a
 * rule that gets switched off: main lands changes daily and this proof runs
 * weekly, so ordinary source drift is the accepted price of not compiling six
 * platforms on every merge, and the age ceiling above is what bounds it. These
 * three are a different kind of change — they alter WHAT is compiled and WITH
 * WHAT, they land in dedicated commits, and each one has already broken a
 * platform build in this repo's history (`tooling/versions.json` carries a
 * multi-paragraph note about a macOS AOT crash pinned to one Flutter release).
 *
 * `__brick__` is excluded, and the exclusion is load-bearing rather than tidy:
 * the brick's pubspec is a TEMPLATE that no lane in build-platforms.yml
 * compiles. Counting it would red the build for editing a file the proof never
 * read, which is the fastest way to make this clause look wrong.
 */
export const PROOF_INPUT_PATHS = [
  { re: /^\.github\/workflows\/build-platforms\.yml$/, why: 'the workflow that IS the proof — a changed lane is an unproven lane' },
  { re: /^tooling\/versions\.json$/, why: 'the single declaration of the Flutter/Dart SDK every lane compiles with' },
  { re: /(^|\/)pubspec\.(yaml|lock)$/, why: 'what the app compiles against — a new package or a bumped constraint is new code in the binary' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ⬜ THE INPUT-CURRENCY CLAUSE PRINTS. IT DOES NOT FAIL, AND THAT IS A DECISION
//    RATHER THAN A DEFAULT.
//
// It shipped as a DATED tripwire — print until 2026-08-25, hard failure after —
// modelled on SCHEDULE_PROOF_DEADLINE above. The date was removed before merge,
// on review, and the reason is this repository's own owner-gated rule:
//
//    "When a capability's on-switch is owner-gated, the guard must PRINT the gap
//     on every run rather than fail the build — otherwise it blocks all CI on
//     work only the owner can do."  (CLAUDE.md, verification discipline)
//
// The remedy for this clause is `gh workflow run build-platforms.yml --ref
// <branch>` — a SIX-PLATFORM compile, tens of minutes of runner budget, on a
// branch, before the merge. Whether that is spent on every pin bump is a
// budget decision belonging to the owner ([L11] zero-cost stack), not something
// a guard should start enforcing on a date nobody chose deliberately.
//
// MEASURED BLAST RADIUS, on the real history since 2026-07-01 (592 commits):
// 38 touched `tooling/versions.json` / `build-platforms.yml`, and 38 touched a
// tracked pubspec — roughly one PR in eight. Dependabot bumps and Flutter pin
// commits are exactly the population, so on the switch-over day the PRs that
// would have gone red are the ones this repo merges most mechanically, with
// nothing in the tree explaining why. That is the ambush this file exists to
// prevent one class of, reproduced in a second class.
//
// 🔴 SO THE PRINT HAS TO BE UNMISSABLE, or "a gap that only ever prints is one
// nobody closes" (this file's own header) becomes true here. It names the
// inputs, names the remedy, and says in terms that the escalation is an OPEN
// OWNER DECISION rather than a thing that will happen by itself.
//
// TO RE-ARM IT: restore a `const INPUT_CURRENCY_DEADLINE = Date.parse(…)` and
// the `nowMs >= INPUT_CURRENCY_DEADLINE` branch in `reportProvenance`, WITH an
// ADR recording the runner-budget decision and an OWNER_QUEUE line, and narrow
// it to `versions.json` + `build-platforms.yml` first if the pubspec half is
// what makes it too noisy — the three inputs are separable and their `why`
// strings already say which is which.
// ─────────────────────────────────────────────────────────────────────────────

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

/** The build inputs among a list of changed paths, each with the reason its
 *  change makes the proof stale. Pure, so the classification is testable without
 *  a repository. */
export function changedProofInputs(files) {
  const out = [];
  for (const raw of files ?? []) {
    const f = String(raw ?? '').replace(/\\/g, '/').trim();
    if (f === '' || f.includes('__brick__')) continue;
    const hit = PROOF_INPUT_PATHS.find(({ re }) => re.test(f));
    if (hit) out.push({ file: f, why: hit.why });
  }
  return out;
}

const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/**
 * WHERE THE PROOF'S COMMIT SITS RELATIVE TO THE COMMIT BEING GRADED.
 *
 * Returns `{ decidable: false, why }` whenever git cannot answer — no
 * repository, a shallow clone, an object this checkout never fetched. That is a
 * THIRD state and it is kept separate from "no" on purpose: the caller prints it
 * rather than failing or, worse, treating it as a pass. A guard that cannot tell
 * and says nothing is the shape this whole file exists to remove.
 *
 * `merge-base --is-ancestor X X` exits 0, so ANCESTOR-OR-EQUAL is one call and
 * not two with a boundary between them to get wrong.
 */
export function gitAncestry(proofSha, gradedSha, root = ROOT) {
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) {
    return { decidable: false, why: `git could not read a repository at ${root}` };
  }
  for (const [label, sha] of [['proof', proofSha], ['graded', gradedSha]]) {
    if (git(root, ['cat-file', '-e', `${sha}^{commit}`]).status !== 0) {
      return {
        decidable: false,
        why: `the ${label} commit ${sha.slice(0, 7)} is not in this clone's object store — a shallow checkout, or a commit this ref never fetched`,
      };
    }
  }
  const ancestor = git(root, ['merge-base', '--is-ancestor', proofSha, gradedSha]).status === 0;
  const drift = Number(git(root, ['rev-list', '--count', `${proofSha}..${gradedSha}`]).stdout.trim());
  const changed = git(root, ['diff', '--name-only', proofSha, gradedSha])
    .stdout.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { decidable: true, ancestor, drift: Number.isFinite(drift) ? drift : null, inputs: changedProofInputs(changed) };
}

/**
 * DOES THE NEWEST PROOF DESCRIBE THE CODE BEING GRADED?
 *
 * Pure apart from the injected `ancestryOf(sha)` resolver, so every branch below
 * is exercisable without a repository AND against the real one.
 *
 * Candidates are EVERY successful run, not only the scheduled ones — the two
 * clauses ask different questions. Freshness asks whether the timer is alive, so
 * it may only count `schedule`. Provenance asks whether some green six-platform
 * build compiled these inputs, and a `workflow_dispatch` on the current branch
 * answers that perfectly. Refusing it here would leave the failure with no
 * remedy, which is how a guard earns an exemption and then an off switch.
 *
 * Newest first, and the search stops at the first candidate with nothing to
 * report: an exact match cannot be improved on, and each candidate costs four
 * `git` processes.
 */
export function evaluateProvenance(runs, gradedSha, ancestryOf) {
  if (!Array.isArray(runs)) {
    return { kind: 'unreadable', reason: 'run list was not an array — treating an unreadable answer as a failure' };
  }
  const successes = runs.filter((r) => r && r.conclusion === 'success');
  if (successes.length === 0) {
    return { kind: 'unreadable', reason: `no successful ${WORKFLOW} run to take a commit from` };
  }
  const ordered = [...successes].sort((a, b) => Date.parse(b.updated_at ?? 0) - Date.parse(a.updated_at ?? 0));
  const seen = new Set();
  const candidates = [];
  for (const r of ordered) {
    const sha = String(r.head_sha ?? '').toLowerCase();
    if (!SHA_RE.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    candidates.push({ sha, run: r });
  }
  if (candidates.length === 0) {
    return {
      kind: 'unreadable',
      reason:
        `${successes.length} successful run(s) and NOT ONE carries a 40-hex \`head_sha\`. ` +
        'A proof that does not record WHICH commit it compiled can only ever be aged against the clock, ' +
        'and a dispatch pinned to an old ref produces a young run over old code.',
    };
  }

  let undecidable = null;
  let best = null;
  for (const { sha, run } of candidates) {
    const rel = ancestryOf(sha);
    if (!rel.decidable) {
      undecidable ??= { sha, run, why: rel.why };
      continue;
    }
    if (!rel.ancestor) continue;
    const verdict = { kind: rel.inputs.length === 0 ? 'current' : 'inputsChanged', sha, run, drift: rel.drift, inputs: rel.inputs };
    if (verdict.kind === 'current') return verdict;
    if (best === null || verdict.inputs.length < best.inputs.length) best = verdict;
  }
  if (best) return best;

  // Nothing was decidable. The strictest thing still derivable without git is
  // string equality with the graded commit — which is exactly the fallback the
  // requirement names, and it is a real pass rather than a shrug.
  if (undecidable) {
    if (candidates.some((c) => c.sha === String(gradedSha).toLowerCase())) {
      return { kind: 'current', sha: gradedSha, run: undecidable.run, drift: 0, inputs: [], viaEquality: true };
    }
    return { kind: 'undecidable', sha: undecidable.sha, run: undecidable.run, why: undecidable.why };
  }
  return {
    kind: 'foreign',
    shas: candidates.slice(0, 5).map((c) => c.sha),
    reason:
      `not one of the ${candidates.length} green run commit(s) is an ancestor of, or equal to, ${String(gradedSha).slice(0, 7)}. ` +
      'The proof was produced on a commit that is not in this history — a force-pushed branch, a rebase, or a ref that never landed — ' +
      'so it is evidence about code nobody is shipping.',
  };
}

async function fetchRuns() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN / GH_TOKEN in the environment — cannot read run history, so this fails closed');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  // ⚠️ NO `branch=` FILTER, and freshness is not weakened by its absence.
  // Freshness selects on `event === 'schedule'`, and GitHub fires a schedule
  // only on the default branch, so the filter never carried that claim. What it
  // DID do was hide the one run that can discharge an input-currency failure:
  // a `workflow_dispatch` on the branch that changed the inputs. A guard whose
  // failure has no reachable remedy is a guard that gets switched off.
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=success&per_page=100`;
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

  reportFreshness(evaluateFreshness(runs, nowMs), nowMs);
  reportProvenance(runs, nowMs, runsFile !== null);
}

function reportFreshness(verdict, nowMs) {
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

/**
 * ⚠️ RUNS EVEN WHEN FRESHNESS FAILED. They are two independent claims about the
 * same run history — "the timer is alive" and "the proof describes this code" —
 * and returning early on the first would mean a stale timer permanently hid the
 * commit clause behind it. One red is not a reason to stop measuring.
 *
 * 🔴 EXPORTED SO THE `offline` CONDITIONAL BELOW IS TESTABLE AT ALL. The claim
 * "`--graded` is inert without `--runs-file`" cannot be reached through the
 * process: `main()` dies at `fetchRuns()`'s token check long before provenance,
 * so a subprocess case that clears GITHUB_TOKEN asserts only that the token
 * check works — it passes identically with the `offline ?` guard DELETED. That
 * is an assertion that cannot fail, which this repository deletes or re-points.
 * Calling this function directly with `offline: false` reaches the real branch
 * with no network and no token. See the pair of cases in
 * `test/platform-proof-fresh.test.mjs`.
 */
export function reportProvenance(runs, nowMs, offline) {
  // `--graded` is honoured ONLY alongside `--runs-file`. A flag that can retarget
  // the commit under test is a flag that can silence this clause in CI, and the
  // offline banner is already the one place this file admits to being driven by
  // fixtures rather than by the world.
  const gradedFlag = offline ? flag('--graded') : null;
  const graded = (gradedFlag ?? git(ROOT, ['rev-parse', 'HEAD']).stdout).trim().toLowerCase();
  if (!SHA_RE.test(graded)) {
    fail(`could not resolve the commit being graded (\`git rev-parse HEAD\` gave "${graded}"), so the proof's commit has nothing to be compared against`);
    return;
  }

  const verdict = evaluateProvenance(runs, graded, (sha) => gitAncestry(sha, graded, ROOT));

  if (verdict.kind === 'unreadable') {
    fail(`platform proof provenance unreadable — ${verdict.reason} [pipeline F-4]`);
    return;
  }

  if (verdict.kind === 'foreign') {
    fail(`platform proof was NOT produced on this history — ${verdict.reason}`);
    console.error('');
    console.error(`      Green run commits seen: ${verdict.shas.map((s) => s.slice(0, 7)).join(', ')}`);
    console.error(`      Graded commit:          ${graded.slice(0, 7)}`);
    console.error('      Re-run the six-platform build on a ref that is actually in this history:');
    console.error(`      gh workflow run ${WORKFLOW} --ref <branch>  [pipeline F-4]`);
    return;
  }

  if (verdict.kind === 'undecidable') {
    console.log(`⬜  platform proof COMMIT could not be graded — ${verdict.why}`);
    console.log(`      The newest green run compiled ${verdict.sha.slice(0, 7)}; the graded commit is ${graded.slice(0, 7)}.`);
    console.log('      Neither ancestry nor equality could be established, so this run says NOTHING');
    console.log('      about whether the proof describes the code being graded — which is different');
    console.log('      from saying it does. Give this job a full-history checkout (`fetch-depth: 0`)');
    console.log('      and the clause becomes decidable. [pipeline F-4]');
    return;
  }

  if (verdict.kind === 'inputsChanged') {
    // ⬜ NEVER `fail`. See the block above INPUT-CURRENCY at the top of this
    // file: the remedy is a six-platform dispatch, which is owner budget, so
    // this prints on every run and escalating it is an open decision rather
    // than a dated event. `nowMs` is still taken so the signature and every
    // caller stay unchanged if it is ever re-armed.
    console.log(
      `⬜  platform proof PREDATES a change to the build's own inputs — run ${verdict.run?.id} compiled ${verdict.sha.slice(0, 7)}, ` +
        `${verdict.drift} commit(s) behind ${graded.slice(0, 7)}, and ${verdict.inputs.length} build input(s) changed since`,
    );
    for (const { file, why } of verdict.inputs) console.log(`      · ${file} — ${why}`);
    console.log('      The six platforms are claimed against inputs no green build has ever compiled.');
    console.log(`      Remedy: gh workflow run ${WORKFLOW} --ref <branch>`);
    console.log(
      '      ⚠️ THIS PRINTS AND WILL GO ON PRINTING. It is NOT scheduled to become a failure:' +
        '\n      the dated tripwire it shipped with was removed on review because the remedy is a' +
        '\n      six-platform compile, i.e. owner runner budget, and a guard must print an' +
        "\n      owner-gated gap rather than block CI on it. Escalating it is an OPEN DECISION" +
        '\n      (measured: ~1 PR in 8 touches a build input). [pipeline F-4]',
    );
    return;
  }

  console.log(
    `ok  platform proof provenance — run ${verdict.run?.id} compiled ${verdict.sha.slice(0, 7)}, ` +
      (verdict.viaEquality
        ? 'which IS the graded commit (established by equality; git could not walk the history)'
        : `${verdict.drift} commit(s) behind ${graded.slice(0, 7)}, with no build input changed since`),
  );
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
