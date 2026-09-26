#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// guard-sweep.mjs — run EVERY guard in tooling/ci, and prove the sweep reached
// every one of them.
//
// 🔴 WHY THIS EXISTS, AND IT IS A PROCESS DEFECT RATHER THAN A CODE ONE.
// Sessions swept the guards by hand with
//
//     for g in tooling/ci/assert-*.mjs tooling/ci/check-*.mjs; do node "$g"; done
//
// A NAME PATTERN. It silently excluded `scan-secrets.mjs`, `scan-workflows.mjs`,
// `record-deployment.mjs`, `release-manifest.mjs` and `android-signing.mjs` —
// five runnable files, one of which is the SECRET SCANNER. On 2026-08-06 a
// secret-scan failure reached CI that a complete local sweep would have caught,
// and every "guards red: N" figure reported that day was over an incomplete
// domain. The loop printed the same reassuring output either way.
//
// ⚠️ THE HANDOFF NOTE THAT PRESCRIBED THE FIX WAS ITSELF WRONG, WHICH IS THE
// WHOLE ARGUMENT FOR A SCRIPT. It named the four excluded files and one of them,
// `workflow-scan.mjs`, is a LIBRARY with no entry point at all, while the
// runnable guard beside it — `scan-workflows.mjs`, a different file with the
// words reversed — went unnamed, as did `android-signing.mjs`. A prose list of
// exceptions is a second copy of the tree, and the second copy was wrong within
// one day of being written.
//
// ── WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
// It asserts COMPLETENESS, not greenness. Completeness is what failed.
//
//   Every `tooling/ci/*.mjs` (minus `test/`) is either
//     RUN        — with the arguments a workflow really passes it, read from the
//                  workflow YAML so they cannot drift from CI, or
//     EXPLAINED  — classified by a MECHANISM, never by a hand-kept list of names.
//
// Exit 1 means a file was neither run nor explained. A guard that runs and fails
// is REPORTED, not an exit-1 here: several fail locally for correct reasons
// (`assert-ops-register.mjs` is red today because two real duties have no
// successful run), and a sweep that conflated "this guard found something" with
// "the sweep is broken" would train its reader to ignore both.
//
// ── THE THREE MECHANISMS, each derived rather than declared ──────────────────
//   LIBRARY        no `process.exit` / `process.argv` anywhere in the file. It is
//                  imported, not executed. `assert-guard-coverage.mjs` already
//                  proves the import chain reaches a workflow.
//   NEEDS-CI       its workflow invocation carries an unresolved `${{ … }}`
//                  expansion, or the guard's own output names an environment
//                  variable it could not read. Read from the YAML, not guessed.
//   MUTATES        it is invoked by a PUBLISHING lane (deploy-*, submit-*,
//                  build-platforms) rather than by `ci.yml`. These write outside
//                  the repo — a GitHub Deployment, a Release, a materialised
//                  keystore — so running one locally is an outward-facing act,
//                  not a check. Derived from which workflow file names it.
//
// ── 2026-09-19 — `--json <path>`, BECAUSE "REPORTED, NOT AN EXIT 1" LET A REAL
//    REGRESSION THROUGH PREFLIGHT ─────────────────────────────────────────────
// PR #818 went red in CI on "Guards — the guards can still fail": ci.yml runs
// `node tooling/ci/assert-walks-bounded.mjs` bare, and it exited 1 on a new
// `readdirSync` in assert-ungraded-baseline-doc.mjs. Locally this sweep had
// printed `✗ assert-walks-bounded.mjs RED(1) no invocation passes here` — and
// exited 0, as designed above — and preflight.mjs read only that exit code, so it
// closed with "CI should agree". A deterministic, tree-only regression looked
// exactly like the environmental reds (assert-ops-register, assert-store-matrix
// --registry-only, the assert-stamp-* guards that need a stamped app).
//
// The fix is NOT to make this sweep exit 1 on a red: that would conflate the two
// again, and the environmental reds would make it red on every run. It is to hand
// the per-guard verdicts to a reader that can tell the two apart. `--json <path>`
// writes every row with its verdict, its exit status and EVERY invocation tried
// (script arguments, node flags, status, first and last output line), plus the
// full output of a red. preflight.mjs re-runs each RED against a clean checkout
// of the merge-base with origin/main and fails only on a red that main does not
// have. This file's exit code is unchanged: completeness, never greenness.
//
// ── 2026-09-24 — `job`, `--budget-ms <n>` AND `--times`, FOR A SMOKE THAT SAYS
//    WHAT IT DID NOT RUN (O-PRE-PUSH-RUNS-NO-CI-GATE-LEG) ─────────────────────
// The pre-push hook ran the spec guards and nothing of ci-gate, so a guard red
// on the pushed commit was first seen ~6 minutes later in CI. `preflight.mjs
// --smoke` closes that with THIS sweep, run lock-free on the pushed SHA inside a
// time budget — and a budgeted run is only honest if it says what the budget
// cut. So:
//   · every invocation records the `job` that makes it, and every --json row
//     carries `jobs` ({ wf, job } for each workflow job that invokes the guard),
//     which is what lets a reader say which of ci-gate's `needs` a run reached;
//   · `--budget-ms <n>` starts no guard once n ms have passed since the first
//     one could have started. A guard it does not start is a BUDGET row: never
//     executed, never red, and counted. A guard already running finishes, so the
//     wall time is the budget plus at most one guard. Only a row that WOULD run
//     can be BUDGET — NEEDS-CI and MUTATES are classified exactly as before;
//   · `--times` prints each executed row's wall time and a median / p90 line.
//     The --json rows carry `ms` either way (null when nothing ran).
// With neither flag the sweep runs, classifies and exits exactly as it did.
//
// Usage:  node tooling/scripts/guard-sweep.mjs [--verbose] [--scan-only] [--json <path>] [--ceilings]
//                                              [--budget-ms <n>] [--times]
// Exit:   0 = every file run or explained · 1 = a file the sweep could not reach
//         2 = a usage error (`--json` without a path, `--budget-ms` without a
//             non-negative number)
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// The ONE workflow parse in this repository — see the dated block above `invocations`.
import { parseAllWorkflows, shellSegments } from '../ci/workflow-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CI_DIR = join(ROOT, 'tooling', 'ci');
const WF_DIR = join(ROOT, '.github', 'workflows');
const VERBOSE = process.argv.includes('--verbose');
/** Classify from the workflow scan and STOP — no guard is executed. The scan is
 *  what decides UNREACHED (the only thing this sweep exits non-zero on), so the
 *  verdict it exists for is fully determined without running anything. It is here
 *  so test/guard-sweep-invocations.test.mjs can assert that classification against
 *  the REAL workflows in about a second instead of executing 148 guards. */
const SCAN_ONLY = process.argv.includes('--scan-only');
/** `--json <path>`: also write the rows, machine-readable. A flag that takes a
 *  value REFUSES a missing one, or one that looks like the next flag (trap
 *  shell-13: a hand-rolled argv loop that silently eats the next argument). */
const JSON_OUT = (() => {
  const i = process.argv.indexOf('--json');
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('-')) {
    console.error('✗ --json needs a file path after it (got ' + (v === undefined ? 'nothing' : `\`${v}\``) + ').');
    process.exit(2);
  }
  return resolve(v);
})();
/** `--budget-ms <n>`: start no guard once n ms have passed (see the header).
 *  Refuses a missing value or one that is not a non-negative number, like --json. */
const BUDGET_MS = (() => {
  const i = process.argv.indexOf('--budget-ms');
  if (i === -1) return null;
  const v = process.argv[i + 1];
  const n = Number(v);
  if (v === undefined || v.startsWith('-') || v.trim() === '' || !Number.isFinite(n) || n < 0) {
    console.error('✗ --budget-ms needs a non-negative number of milliseconds after it (got ' + (v === undefined ? 'nothing' : `\`${v}\``) + ').');
    process.exit(2);
  }
  return n;
})();
const TIMES = process.argv.includes('--times');
/** Keep at most this much of a RED guard's output in the JSON — enough for a
 *  reader to compare it with the same guard's output on another tree. */
const OUT_CAP = 64 * 1024;
const nonEmptyLines = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());

/** Lanes that write outside the repository. Membership is a property of the
 *  workflow, so a new publishing lane inherits this without an edit here. */
const PUBLISHING = /^(deploy-|submit-|build-platforms|release)/;

// ── the domain: every .mjs directly under tooling/ci, `test/` excluded ────────
const files = readdirSync(CI_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
  .map((e) => e.name)
  .sort();

if (files.length === 0) {
  console.error('✗ COVERAGE LOST — no .mjs found in tooling/ci. The sweep would report a clean empty domain.');
  process.exit(1);
}

// ── 2026-09-25 — ONE DECLARED PER-GUARD CEILING, NOT A RAISED FLAT ONE ────────
// Every guard is spawned with DEFAULT_CEILING_MS. A guard named in CEILINGS gets
// its own, and the entry carries the runtime it was measured at and the date.
// The flat 300 s stays for every other guard: raising it for all of them would
// hide the next guard that slows down, which is the thing a ceiling is for.
// When the spawn times out, `r.status` is null, and the row reads RED(null) for
// a guard CI passes. A key naming no file in tooling/ci is refused, because a
// stale key is a ceiling that applies to nothing.
const DEFAULT_CEILING_MS = 300_000;
const CEILINGS = {
  // ard2r: the ink floor is computed from the committed calibration set (24 frames).
  'assert-listing-assets.mjs': {
    ms: 600_000,
    measured: '298 s on the laptop with ~12 other node processes, 2026-09-25 (release train W3); 316 s loaded, 2026-09-24 (the ard2r reviewer); 7 s before the calibration set',
  },
};
const staleCeilings = Object.keys(CEILINGS).filter((n) => !files.includes(n));
if (staleCeilings.length) {
  console.error(`✗ CEILINGS names ${staleCeilings.join(', ')}, which is not a file in tooling/ci. Remove the entry or fix the name.`);
  process.exit(1);
}
const ceilingFor = (name) => CEILINGS[name]?.ms ?? DEFAULT_CEILING_MS;

/** `--ceilings`: print the spawn timeout every file in the domain would get, as
 *  JSON, and stop. test/guard-sweep-invocations.test.mjs reads it to prove that a
 *  guard NOT in CEILINGS still gets DEFAULT_CEILING_MS. */
if (process.argv.includes('--ceilings')) {
  console.log(JSON.stringify(Object.fromEntries(files.map((n) => [n, ceilingFor(n)])), null, 2));
  process.exit(0);
}

// ── every workflow invocation, with its real arguments ───────────────────────
// basename -> [{ wf, raw, flags }] · `raw` is the SCRIPT arguments and `flags`
// the node flags that precede the path. Two producers build this shape and both
// must carry all three: the scan below, and the synthetic fallback call further
// down — which did not, and crashed the spawn on a clean tree.
//
// ⏱ 2026-09-14 — READ THROUGH tooling/ci/workflow-scan.mjs, NOT A PRIVATE LINE
// LOOP (O-GUARD-SWEEP-HAS-A-RIVAL-PARSER). This file split each workflow on
// newlines and matched one physical line, a fifth copy of the parse that module
// exists to be the only one of. The measurable cost was the thing that module's
// header names first: which lines it can see. A folded `run: >` puts the
// arguments on the lines AFTER `node tooling/ci/<guard>.mjs`, so nine guards were
// recorded with EMPTY arguments. Measured against origin/main 05b78777:
// 42 invocations sit inside a block scalar (20 in folded `run: >`, 22 in literal
// `run: |`) across 19 guards. The old matcher run against this reader changed the
// recorded invocation of 9 of them (assert-android-vapt-manifest,
// assert-artifact-shape, assert-artifact-signed, -apple, -msix,
// assert-elf-page-alignment, assert-snapcraft-generable, release-manifest,
// windows-signing), with 163 guards invoked either way. No guard's classification
// class changed: seven are MUTATES either way, and the two RUN guards keep the
// same shortest candidate. `parseWorkflow` blanks comments, joins block scalars
// into logical lines, and `shellSegments` ends a command at `&&`, `||`, `;` and
// `|` — the same stops the old `[^|&;#\n]*` tail made by hand.
const invocations = new Map();
const parsedWorkflows = parseAllWorkflows(ROOT);
const workflows = parsedWorkflows.map((p) => p.rel.split('/').pop());
if (workflows.length === 0) {
  console.error(`✗ COVERAGE LOST — no workflow files under ${WF_DIR}, so no invocation could be read and every guard would look unreferenced.`);
  process.exit(1);
}
const logicalSegments = [];
for (const parsed of parsedWorkflows) {
  const wf = parsed.rel.split('/').pop();
  for (const job of parsed.jobs.values()) {
    for (const line of job.logical) {
      for (const segment of shellSegments(line.text)) logicalSegments.push({ wf, job: job.name, segment });
    }
  }
}
/** basename -> every { wf, job } that invokes it. Kept apart from `invocations`,
 *  whose dedupe (arguments, workflow, flags) decides what EXECUTES and must not
 *  change: one call made identically by two jobs runs once, and is in both. */
const jobsOf = new Map();
if (logicalSegments.length === 0) {
  console.error('✗ COVERAGE LOST — the workflows parsed to ZERO job lines, so no invocation could be read and every guard would look unreferenced.');
  process.exit(1);
}
for (const { wf, job, segment } of logicalSegments) {
  {
    const code = segment;
    // 🔴 NODE FLAGS SIT BETWEEN `node` AND THE PATH, AND IGNORING THEM MADE FOUR
    // INVOKED GUARDS LOOK ORPHANED. This pattern required `node` then WHITESPACE
    // then the path until 2026-09-12, so `node --single-threaded tooling/ci/x.mjs`
    // matched nothing. That is how CI really invokes four of them — ci.yml:361 and
    // :723, store-screenshots.yml:91 — because a guard that prints its verdict and
    // then deadlocks at exit needs V8 background tasks off (nodejs/node#54918),
    // which arrived on those lines on 2026-09-11. The scanner that parses those
    // lines was not re-read, so preflight exited 1 on a clean main with five false
    // "invoked by no workflow" findings, and a local gate that cries wolf on every
    // run is a local gate nobody reads. THE INVERSE of `moved-code-silences-guards`:
    // a refactor did not silence a guard here, it made a scanner shout.
    //
    // The flags are captured rather than skipped because this sweep EXECUTES what
    // it finds: dropping `--single-threaded` would run those four guards in the one
    // configuration the flag exists to avoid. They are kept OUT of the argv below —
    // a node flag is not a script argument, and `blocker()` reads argv to decide
    // whether this machine can satisfy a call.
    const m = code.match(/node\s+((?:-[^\s]+\s+)*)tooling\/ci\/([a-z0-9._-]+\.mjs)(.*)$/i);
    if (!m) continue;
    const [, flagText, name, tail] = m;
    const flags = flagText.trim() ? flagText.trim().split(/\s+/) : [];
    // Cut the shell furniture, not just some of it. The first version of this
    // stripped `2>` only when it was preceded by whitespace and left `)"` behind
    // on an invocation nested in `$( … )`, so two guards were "run" with garbage
    // arguments and reported RED for a reason that was mine. A diagnostic is a
    // claim and needs the same evidence as a finding.
    const raw = tail
      .replace(/\s*\d?>[>&].*$/, '')   // 2>&1, >>, 2>/dev/null
      .replace(/\s*\d?>\s*\S*.*$/, '') // `> file`, and a bare trailing `2>` left
                                       //  behind when the capture stopped at `&`
      .replace(/\)+["']?\s*$/, '')     // trailing $( … ) / "$( … )" furniture
      .trim();
    if (!invocations.has(name)) invocations.set(name, []);
    const list = invocations.get(name);
    // `flags` joins the dedupe key: two calls that differ only in how node is
    // started are two different invocations, and collapsing them would hide the
    // one this machine cannot reproduce.
    const key = flags.join(' ');
    if (!list.some((x) => x.raw === raw && x.wf === wf && x.flags.join(' ') === key)) list.push({ wf, job, raw, flags });
    if (!jobsOf.has(name)) jobsOf.set(name, []);
    const where = jobsOf.get(name);
    if (!where.some((x) => x.wf === wf && x.job === job)) where.push({ wf, job });
  }
}

/** `--invocations`: print what the scan recorded, as JSON, and stop. The
 *  classification below is a function of this map, so a test can pin the READ
 *  (including arguments folded onto a `run: >` continuation line) without
 *  executing anything. */
if (process.argv.includes('--invocations')) {
  console.log(JSON.stringify(Object.fromEntries([...invocations.entries()].sort(([a], [b]) => a.localeCompare(b))), null, 2));
  process.exit(0);
}

const isLibrary = (name) => {
  const src = readFileSync(join(CI_DIR, name), 'utf8');
  return !/process\.(exit|argv)/.test(src);
};


// 🔴 THE TWO MECHANISMS assert-guard-coverage.mjs HAS AND THIS SWEEP DID NOT.
// Until 2026-08-20 this file exited 1 with three UNREACHED entries while
// assert-guard-coverage reported the same tree fully accounted for. Both read
// correctly; they answered DIFFERENT questions with the same word. A file can
// fail to be invoked by a workflow for three different reasons:
//
//   a LIBRARY            no entry point at all.            Handled above.
//   IMPORTED             CI does reach it, through the import graph of an
//                        invoked guard, which a per-file invocation scan
//                        cannot see.
//   NOT-CI-RUNNABLE      a deliberate exemption with a written reason.
//
// Only the fourth case is a finding. Calling all four UNREACHED is what made
// this sweep disagree with the guard that owns the question, and a sweep that
// cries orphan over an explained file teaches its reader to skip the line.
//
// ⚠️ BOTH ARE DERIVED FROM assert-guard-coverage.mjs ITSELF, never re-declared
// here. A second copy of an exemption list is the drift this repository keeps
// deleting: two lists agree today and diverge silently later, which is exactly
// the state being fixed. build-enforcement-index.mjs reads the same declaration
// the same way, for the same reason.
const COVERAGE_GUARD = 'assert-guard-coverage.mjs';

/** The names assert-guard-coverage.mjs records as NOT CI-runnable, read out of
 *  its own NOT_CI_RUNNABLE map. null when the declaration cannot be found, which
 *  is COVERAGE LOST rather than an empty exemption set. */
function readNotCiRunnable() {
  if (!files.includes(COVERAGE_GUARD)) return null;
  const lines = readFileSync(join(CI_DIR, COVERAGE_GUARD), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^const NOT_CI_RUNNABLE = new Map\(\[/.test(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^\]\);/.test(l));
  if (end === -1) return null;
  const names = new Set();
  for (const l of lines.slice(start + 1, end)) {
    const m = /^\s*(?:\[\s*)?'([A-Za-z0-9._-]+\.mjs)',?\s*$/.exec(l);
    if (m) names.add(m[1]);
  }
  return names;
}

const notCiRunnable = readNotCiRunnable();
if (notCiRunnable === null || notCiRunnable.size === 0) {
  console.error(`\u2717 COVERAGE LOST \u2014 ${COVERAGE_GUARD}'s NOT_CI_RUNNABLE declaration could not be read ` +
    `(${notCiRunnable === null ? 'absent' : 'parsed to ZERO names'}).`);
  console.error('  Every deliberately-exempt file would then be reported as an orphan, and this sweep would');
  console.error('  disagree with the guard that owns the question \u2014 loudly, and wrongly.');
  process.exit(1);
}

/** Everything reachable from an invoked file through relative imports. Comments
 *  are stripped first: an import named only in prose is not an edge. */
function reachableByImport() {
  const importsOf = (name) => {
    const src = readFileSync(join(CI_DIR, name), 'utf8')
      .split('\n').filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      }).join('\n');
    const out = new Set();
    for (const m of src.matchAll(/from\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)) out.add(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]\s*\)/g)) out.add(m[1]);
    return [...out];
  };
  const seen = new Set();
  const queue = files.filter((f) => (invocations.get(f) ?? []).length > 0);
  while (queue.length) {
    for (const dep of importsOf(queue.pop())) {
      if (files.includes(dep) && !seen.has(dep)) { seen.add(dep); queue.push(dep); }
    }
  }
  return seen;
}
const importReached = reachableByImport();

const rows = [];
let unreached = 0;
let ran = 0;
let red = 0;
let budgetCut = 0;
/** The budget's clock: from the first moment a guard could start, so the scan
 *  above (the same for every run) is not charged to it. */
const loopStarted = Date.now();

for (const name of files) {
  const calls = invocations.get(name) ?? [];
  const publishing = calls.length > 0 && calls.every((c) => PUBLISHING.test(c.wf));

  if (calls.length === 0) {
    if (isLibrary(name)) {
      rows.push({ name, verdict: 'LIBRARY', note: 'no process.exit/argv — imported, not executed' });
      continue;
    }
    if (importReached.has(name)) {
      rows.push({ name, verdict: 'IMPORTED',
        note: 'no workflow names it; CI reaches it through the import graph of one that is' });
      continue;
    }
    if (notCiRunnable.has(name)) {
      rows.push({ name, verdict: 'NOT-CI-RUNNABLE',
        note: `recorded in ${COVERAGE_GUARD}'s NOT_CI_RUNNABLE with a stated reason — explained, not orphaned` });
      continue;
    }
    unreached++;
    rows.push({ name, verdict: 'UNREACHED', note: '🔴 runnable, invoked by NO workflow, reached by no import, and carrying no recorded exemption' });
    continue;
  }

  if (publishing) {
    rows.push({
      name,
      verdict: 'MUTATES',
      note: `only ${[...new Set(calls.map((c) => c.wf))].join(', ')} invokes it — a publishing lane writes outside the repo, so running it here is an act, not a check`,
    });
    continue;
  }

  // Everything below this line EXECUTES something. `--scan-only` stops here: the
  // UNREACHED count is already settled by the scan above, so the exit code this
  // sweep is read for is unchanged, and nothing is spawned.
  if (SCAN_ONLY) {
    rows.push({
      name,
      verdict: 'SCAN',
      note: `invoked by ${calls.length} call(s) in ${[...new Set(calls.map((c) => c.wf))].join(', ')}` +
        `${calls.some((c) => c.flags.length) ? ` · node flag(s) ${[...new Set(calls.flatMap((c) => c.flags))].join(' ')}` : ''}`,
    });
    continue;
  }

  // ── WHICH INVOCATION TO RUN ────────────────────────────────────────────────
  // Not "the richest". Several guards have both a bare call and one whose
  // SUBJECT is CI-ephemeral — `apps/probe`, `services/probeapi-api`, a built web
  // bundle — none of which exist in a working tree. Picking the longest ran
  // those and reported RED for a missing fixture, which is a sweep defect
  // wearing a finding's clothes. So: keep only the invocations this machine can
  // actually satisfy, and run the richest of THOSE.
  const blocker = (raw) => {
    if (/\$\{\{/.test(raw)) return `a CI expression: \`${raw}\``;
    if (/\$\{?\w+\}?/.test(raw)) return `a runner environment variable: \`${raw}\``;
    for (const tok of raw.split(/\s+/)) {
      if (!tok || tok.startsWith('-') || tok === '.') continue;
      const bare = tok.replace(/^["']|["']$/g, '');
      if (!bare.includes('/')) continue;
      if (!existsSync(join(ROOT, bare))) return `its subject does not exist here: \`${bare}\` (CI-ephemeral)`;
    }
    return null;
  };

  let runnable = calls.filter((c) => blocker(c.raw) === null);

  // ── THE BARE-INVOCATION FALLBACK, AND IT WAS ADDED BECAUSE THIS SWEEP MISSED A
  //    REAL SECURITY FINDING ────────────────────────────────────────────────────
  // 🔴 2026-08-07: `scan-workflows.mjs` and `scan-secrets.mjs` are each invoked
  // exactly once, and that invocation carries `--zizmor "${RUNNER_TEMP}/zizmor"`
  // / `--gitleaks "${RUNNER_TEMP}/gitleaks"`. `${RUNNER_TEMP}` is a runner env
  // var, so `blocker` refused every invocation and both were filed NEEDS-CI —
  // meaning THE SECRET SCANNER AND THE WORKFLOW SCANNER NEVER RAN in a sweep
  // whose entire purpose is that no guard is skipped. A `deployments: write`
  // that a job split had silently widened reached CI because of it, and CI
  // caught what this was supposed to catch first.
  //
  // Both tools are installed on this machine and both scripts resolve their own
  // binary from PATH when the flag is absent. So when every invocation is
  // blocked ONLY by an argument the script can supply itself, fall back to the
  // bare call and SAY SO — a sweep that reports "could not run" while a perfectly
  // runnable form exists is the same silent gap in a politer voice.
  let usedFallback = false;
  if (runnable.length === 0 && !calls.some((c) => /\$\{\{/.test(c.raw))) {
    // 🔴 CARRY THE NODE FLAGS ONTO THE SYNTHETIC CALL. This record stands in for
    // a real invocation, so it needs the real invocation's SHAPE — and it is the
    // one place a call object is built rather than scanned. Omitting `flags` here
    // crashed the sweep at the spawn below with "call.flags is not iterable" on a
    // clean tree (2026-09-12), because `--scan-only` returns before the spawn and
    // so never exercises it: the fix looked proven by a path that could not see
    // the line it changed.
    runnable = [{ wf: calls[0].wf, job: calls[0].job, raw: '', flags: calls[0].flags ?? [] }];
    usedFallback = true;
  }

  // ── THE BUDGET (--budget-ms, 2026-09-24): only a guard that WOULD run is cut.
  // `runnable.length > 0` is exactly "not NEEDS-CI" below, so a guard CI alone can
  // run keeps that verdict and a cut guard is never mistaken for one. Checked
  // before the archive a tree scanner needs, so a cut guard costs nothing.
  if (runnable.length > 0 && BUDGET_MS !== null && Date.now() - loopStarted >= BUDGET_MS) {
    budgetCut++;
    rows.push({ name, verdict: 'BUDGET', note: `not started — the --budget-ms ${BUDGET_MS} ceiling was spent before its turn; NOT run, NOT judged` });
    continue;
  }

  // ── A GUARD THAT SCANS THE WORKING TREE MUST BE GIVEN CI'S TREE, NOT THIS ONE ──
  // 🔴 `scan-secrets.mjs` walks the working tree and shells out to gitleaks, which
  // knows nothing of `tree-walk.mjs`. Locally that tree contains `.claude/worktrees/
  // agent-*` — OTHER CHECKOUTS, belonging to agents — plus `build/` output CI never
  // produces. So it reported findings in files that are not this repository, and
  // took long enough doing it to time out. The nested-checkout defect, reaching the
  // one guard that cannot use `listDir`.
  //
  // The sweep's job is to reproduce CI, so give it what CI checks out: a clean
  // `git archive HEAD` extract. Detected by BEHAVIOUR — the script takes a repo
  // root as its first positional — not by a hardcoded file name.
  // ⚠️ NO SHELL PIPE. `git archive HEAD | tar -x` via execSync ran under cmd.exe
  // on this host, failed, and the `catch` set scanRoot back to null — so the
  // scanner silently went back to walking the live tree and timed out. The
  // failure looked like a slow guard, not a broken setup. Two plain commands,
  // no pipe, no shell dependency; and if either fails the row says COULD-NOT-
  // ARCHIVE rather than quietly scanning the wrong tree.
  // ⚠️ ONLY `scan-secrets`. `scan-workflows` reads `.github/workflows/` — a small
  // fixed directory that holds no nested checkout and no build output — so the
  // live tree IS its correct subject. Giving it the archive instead scans HEAD,
  // which silently ignores an uncommitted workflow fix and reports the OLD
  // finding: a sweep telling you a thing you just fixed is still broken. The
  // archive is a remedy for one specific disease, not a general improvement.
  const TREE_SCANNERS = /^scan-secrets\.mjs$/;
  let scanRoot = null;
  let archiveFailed = false;
  if (TREE_SCANNERS.test(name)) {
    const dir = mkdtempSync(join(tmpdir(), 'nikatru-sweep-'));
    const tar = join(dir, 'head.tar');
    const dest = join(dir, 'tree');
    const a = spawnSync('git', ['archive', '--format=tar', '--output', tar, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    if (a.status === 0) {
      mkdirSync(dest, { recursive: true });
      // ⚠️ NO ABSOLUTE PATHS IN tar's ARGUMENTS ON WINDOWS. GNU tar reads any
      // argument containing a colon as `host:path`, so `-xf C:\…\head.tar` fails
      // with "Cannot connect to C: resolve failed" — it tries to reach a host
      // called "C". `--force-local` fixes `-f` and then breaks `-C` the same way.
      // So: run WITH cwd set to the destination and name the archive relatively.
      // No colon reaches tar at all, and no flag has to paper over one.
      const x = spawnSync('tar', ['-xf', '../head.tar'], { cwd: dest, encoding: 'utf8' });
      if (x.status === 0) scanRoot = dest; else archiveFailed = true;
    } else archiveFailed = true;
    if (!scanRoot) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  }
  if (archiveFailed) {
    rows.push({ name, verdict: 'NO-ARCHIVE', note: 'scans a tree, and `git archive HEAD` could not be extracted — refusing to scan the LIVE tree, which here holds agent worktrees CI never sees' });
    continue;
  }

  if (runnable.length === 0) {
    const why = blocker(calls.slice().sort((a, b) => a.raw.length - b.raw.length)[0].raw);
    rows.push({ name, verdict: 'NEEDS-CI', note: why });
    continue;
  }
  // TRY EVERY runnable invocation, shortest first, and pass if ANY exits 0.
  // A guard often has a bare self-scan plus a richer call whose subject only
  // exists in CI; taking one arbitrarily reported the other's absence as a
  // finding. "No invocation of this guard passes here" is the honest red.
  let last = null;
  let passed = null;
  const tried = [];
  const guardStarted = Date.now();
  for (const call of runnable.slice().sort((a, b) => a.raw.length - b.raw.length)) {
    const scriptArgs = call.raw.length ? call.raw.split(/\s+/) : [];
    const argv = scanRoot ? [scanRoot, ...scriptArgs] : [...scriptArgs];
    // The node flags CI starts this guard with go BEFORE the script path, exactly
    // where CI puts them. Four guards are invoked `--single-threaded` because they
    // deadlock at exit without it (nodejs/node#54918); running them here without
    // the flag would reproduce the hang this sweep is supposed to pre-empt.
    const r = spawnSync(process.execPath, [...call.flags, join(CI_DIR, name), ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: ceilingFor(name),
    });
    ran++;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const ol = nonEmptyLines(out);
    last = { status: r.status, argv, tail: out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? '', full: out };
    // `args` is the SCRIPT arguments only — never the throwaway archive path,
    // which is gone by the time anybody reads this. `treeScanner` says a tree
    // root was put in front of them, so a re-run elsewhere can supply its own.
    tried.push({ args: scriptArgs, flags: call.flags, status: r.status, head: ol[0] ?? '', tail: ol[ol.length - 1] ?? '' });
    if (r.status === 0) { passed = last; break; }
  }
  if (scanRoot) { try { rmSync(scanRoot, { recursive: true, force: true }); } catch {} }
  const ms = Date.now() - guardStarted;

  if (passed) {
    rows.push({
      name,
      verdict: 'ok',
      note: (passed.argv.length ? `args: ${passed.argv.join(' ')}` : '') +
        (usedFallback ? ' [bare fallback — CI passes a runner-env tool path this machine resolves from PATH]' : ''),
      out: passed.tail,
      status: 0,
      tried,
      treeScanner: Boolean(scanRoot),
      ms,
    });
  } else {
    red++;
    rows.push({
      name,
      verdict: `RED(${last.status})`,
      note: `no invocation passes here (${runnable.length} tried, last: ${last.argv.join(' ') || '(no args)'})`,
      out: last.tail,
      showOut: true,
      status: last.status,
      tried,
      treeScanner: Boolean(scanRoot),
      fullOut: last.full.length > OUT_CAP ? last.full.slice(0, OUT_CAP) : last.full,
      ms,
    });
  }
}
const loopMs = Date.now() - loopStarted;

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = r.verdict === 'ok' ? 'ok ' : r.verdict.startsWith('RED') ? '✗  ' : '⬜ ';
  const line = `${mark} ${r.name.padEnd(width)}  ${r.verdict.padEnd(9)} ${r.note}${TIMES && r.ms !== undefined ? `  (${r.ms} ms)` : ''}`;
  console.log(line);
  // A red always shows WHY, without a second run. A sweep whose reader has to
  // re-invoke each failure to learn anything is a sweep that gets skimmed.
  if ((VERBOSE || r.showOut) && r.out) console.log(`      ↳ ${r.out.slice(0, 220)}`);
}

const counts = rows.reduce((a, r) => {
  const k = r.verdict.startsWith('RED') ? 'RED' : r.verdict;
  a[k] = (a[k] ?? 0) + 1;
  return a;
}, {});
console.log('');
console.log(
  `⬜ guard sweep — ${files.length} file(s) in tooling/ci, ${ran} executed with the arguments ${workflows.length} workflow(s) really pass them: ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · '),
);
console.log(
  '   This asserts COMPLETENESS, not greenness. A RED above is a guard reporting a finding — read it. ' +
    'Exit 1 here means a file was neither run nor explained, which is the failure a name-pattern sweep produced silently.',
);
if (BUDGET_MS !== null) {
  console.log(`⬜ --budget-ms ${BUDGET_MS}: ${budgetCut} guard(s) that would have run were NOT started (BUDGET above); ` +
    `the guards that did run took ${loopMs} ms.`);
}
/** Nearest-rank percentile over executed rows' wall times. */
const timed = rows.filter((r) => typeof r.ms === 'number').map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => (timed.length ? timed[Math.max(0, Math.ceil(p * timed.length) - 1)] : null);
if (TIMES) {
  const slowest = rows.filter((r) => typeof r.ms === 'number').sort((a, b) => b.ms - a.ms).slice(0, 5)
    .map((r) => `${r.name} ${r.ms} ms`).join(', ');
  console.log(timed.length
    ? `⏱ --times: ${timed.length} guard(s) executed in ${loopMs} ms · median ${pct(0.5)} ms · p90 ${pct(0.9)} ms · slowest: ${slowest}`
    : `⏱ --times: no guard executed (${loopMs} ms).`);
}

// ── the machine-readable copy (2026-09-19, see the header) ──────────────────
// Written BEFORE the exit decision and never able to change it. A write that
// fails is said out loud; preflight.mjs names a path in a FRESH temp directory
// and refuses when nothing is there, so neither a stale copy nor an absent one
// can stand in for this run.
if (JSON_OUT) {
  const doc = {
    schema: 'guard-sweep/1',
    root: ROOT,
    scanOnly: SCAN_ONLY,
    files: files.length,
    executed: ran,
    unreached,
    counts,
    budgetMs: BUDGET_MS,
    budgetCut,
    elapsedMs: loopMs,
    medianMs: pct(0.5),
    p90Ms: pct(0.9),
    rows: rows.map((r) => ({
      name: r.name,
      verdict: r.verdict,
      red: r.verdict.startsWith('RED'),
      status: r.status ?? null,
      note: r.note,
      jobs: jobsOf.get(r.name) ?? [],
      ms: r.ms ?? null,
      treeScanner: r.treeScanner ?? false,
      tried: r.tried ?? [],
      ...(r.fullOut !== undefined ? { out: r.fullOut } : {}),
    })),
  };
  try {
    writeFileSync(JSON_OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error(`✗ --json: could not write ${JSON_OUT} (${e?.code ?? e?.message ?? e}). The sweep verdict above stands; no machine-readable copy exists.`);
  }
}

if (unreached > 0) {
  console.error(`\n✗ ${unreached} runnable file(s) in tooling/ci are invoked by no workflow — the sweep cannot reach them and neither can CI.`);
  process.exit(1);
}
process.exit(0);
