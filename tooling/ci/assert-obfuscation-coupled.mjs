#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-obfuscation-coupled.mjs — obfuscation and symbol upload are ONE
// increment, or neither.
//
// [pipeline 9]R-7 "Release builds are obfuscated with split debug info, and the
//                  symbols are retained so a crash report can still be read."
// [ADR 067] decision 6 "--obfuscate --split-debug-info plus symbol upload on
//                  every release build." The FLOOR limb below is that decision;
//                  the COUPLING limb is R-7. ⏱ THIS CITATION MOVED UP HERE on
//                  2026-09-07 — it was first written at :93 and
//                  build-enforcement-index.mjs reads only HEADER_LINES = 60, so
//                  the index recorded the guard as claiming R-7 alone while the
//                  writer's report said otherwise (guard-integrity §4.1).
//
// ── WHY THIS IS A GUARD AND NOT A BUILD FLAG ─────────────────────────────────
// `--obfuscate --split-debug-info=<dir>` renames every Dart symbol in the AOT
// snapshot and writes the mapping to <dir>. The binary gets smaller and harder
// to read; so does every crash report it will ever produce. The mapping file is
// the ONLY thing that turns `_x12a` back into `SubscriptionRepository.refresh`,
// and it exists for exactly as long as the runner that produced it.
//
// So the failure this exists for is not "we forgot to obfuscate". It is the
// OTHER order: somebody adds `--obfuscate` because it is obviously good, the
// build goes green, nothing anywhere uploads the symbol directory, and the
// regression surfaces WEEKS LATER as a GlitchTip issue nobody can read — at
// which point the symbols for that release are gone and cannot be regenerated,
// because a rebuild produces a different mapping. There is no recovery, only a
// re-release. One flag, added in good faith, permanently blinds the crash sink
// for every build between it and the fix.
//
// The repository is currently on the safe side of that: zero build commands
// carry either flag (measured 2026-08-03). This guard exists so the day
// somebody adds one is the day they also add the upload, rather than the day
// six weeks later when a crash needs reading.
//
// ── WHAT COUNTS AS RETAINING THE SYMBOLS ─────────────────────────────────────
// Two shapes, both real, and the guard accepts either IN THE SAME JOB:
//   (a) a symbol upload to the crash sink — `sentry-cli … debug-files upload`,
//       `upload-dif`, `sentry_dart_plugin`, `upload-symbols`, an .dSYM upload;
//   (b) an `actions/upload-artifact` step whose `path:` names the SAME
//       directory the build passed to `--split-debug-info`.
// (b) is weaker than (a) — a 7-day retention is not an archive — but it is a
// real, checkable relationship, and refusing it would push the first honest
// implementation into disabling the guard. What is NOT accepted is an upload of
// some other directory, which is the shape that looks like coverage and is not.
//
// ── HOW IT MATCHES, AND WHY THAT IS THE CAREFUL PART ─────────────────────────
// 🔴 THE FLAG ON A BUILD COMMAND, NEVER THE BARE WORD. `.symbols` as a token
// matches `apps/subscriptiontracker/.gitignore:37`; the word "obfuscated" appears in a doc
// comment at `packages/platform_storage/lib/src/storage_capabilities.dart:43`.
// A guard that matched either would fire on correct input on day one and be
// switched off. Comments are blanked before anything is read — the
// `assert-stamp-platforms.mjs:43-48` lesson, where a comment kept a guard green
// after the real build step was deleted.
//
// ── CARRIED AS NOTES, NOT AS CODE ────────────────────────────────────────────
// · Breadcrumbs and `FlutterError.onError` belong BEFORE obfuscation, not after
//   — stage 11's to build. Obfuscating first makes the sink less useful, not
//   more.
// · Symbol upload targets the self-hosted GlitchTip whose DSN is already a
//   config key, so (a) needs no new credential surface — it needs an auth token,
//   which is owner work.
// · "Flutter Web has no symbol obfuscation at all" is UNVERIFIED — it rests on
//   a corpus summary, not a primary source — so NO web exemption is hard-coded
//   on it. If a web build ever passes `--obfuscate`, this guard asks the same
//   question it asks of every other target, and the answer can be "the flag was
//   a no-op, delete it".
//
// ── ➕ APPENDED 2026-09-03 · TWO OF THE NOTES ABOVE ARE NOW STALE, AND ONE ────
//    MEASUREMENT IS RE-TAKEN RATHER THAN ASSUMED TO HOLD.
//
// 🔬 RE-MEASURED TODAY: still ZERO. 16 `flutter build` commands across 13
// workflows, 0 of them carrying `--obfuscate` or `--split-debug-info` — the
// guard prints both numbers on every run, so the 2026-08-03 sentence above is
// re-confirmed rather than merely left standing. `.github/workflows/
// deploy-web.yml` gained `--source-maps` on this date and that is NEITHER flag:
// it makes the web build EMIT a mapping instead of renaming symbols, so it
// changes nothing this guard asks. Said explicitly because the next reader will
// see a symbol-adjacent flag land in a build command and wonder.
//
// ⚠️ "IT NEEDS AN AUTH TOKEN, WHICH IS OWNER WORK" IS DONE. `GLITCHTIP_TOKEN`
// exists as a repository secret and deploy-web.yml now uses it to upload the
// web bundle's SOURCE MAPS on every deploy. So shape (a) — an upload to the
// crash sink — is no longer hypothetical in this tree; it is live on one lane.
//
// ⛔ AND THAT UPLOAD IS NOT IN `SYMBOL_UPLOAD` BELOW, DELIBERATELY. Web source
// maps are not a split-debug-info directory, and this guard's question is
// strictly "did an obfuscating build retain ITS mapping". Adding the web lane's
// command to the accept list would widen what satisfies the guard without
// widening what it checks — a gate weakening dressed as coverage. What the next
// person WILL need: the day a mobile build starts obfuscating and uploads its
// symbols with `glitchtip-cli debug-files upload` or `dart-symbol-map` (both
// exist on that CLI, verified by running it), THOSE are the patterns to add
// here, and the addition is then load-bearing rather than cosmetic.
//
// ── ➕ APPENDED 2026-09-07 · THE GUARD GAINS A FLOOR, BECAUSE UNTIL TODAY IT ──
//    PASSED OVER AN EMPTY SET AND SAID SO.
//
// [ADR 067] decision 6 asks for `--obfuscate --split-debug-info` plus symbol
// upload on EVERY release build. The end-to-end audit of 2026-09-07 measured
// the result: 15 release `flutter build` commands across 7 workflows, **0**
// carrying either flag, and this guard printing
// `ok … 16 flutter build command(s), 0 obfuscating`, exit 0. Every sentence of
// that output was true and the obligation was entirely unmet — the coupling
// limb below asks "did an obfuscating build keep its mapping", and with nothing
// obfuscating it quantified over nothing. That is [C-COVERAGE-LOST-IS-NOT-PASS]
// exactly: an assertion that cannot fail, inflating apparent coverage.
//
// So there are now TWO limbs and they are different questions:
//
//   THE FLOOR (new)     every release build on a target Flutter can obfuscate
//                       MUST pass --obfuscate. Zero obfuscating release builds
//                       is exit 1, not ok. The count is printed either way.
//   THE COUPLING (old)  every build that DOES obfuscate must retain its mapping
//                       in its own job. Unchanged, and still the sharper of the
//                       two — the floor can be satisfied by a flag, the coupling
//                       cannot.
//
// ── WHY WEB IS EXEMPT, AND WHY THAT IS NOT AN ALLOWLIST ──────────────────────
// The 2026-08-03 note below left web unexempted because the claim "Flutter Web
// has no symbol obfuscation" rested on a corpus summary. It has since been read
// from the primary source: docs.flutter.dev/deployment/obfuscate lists the
// targets obfuscation applies to — `aar, apk, appbundle, ios, ios-framework,
// ipa, linux, macos, macos-framework, windows` — and states "Web apps don't
// support obfuscation. A web app can be minified…". So the exemption is not a
// judgement about web, it is the toolchain's own domain, and it is written here
// as that list rather than as a list of things to skip: a target outside BOTH
// sets is COVERAGE LOST naming the target, because a Flutter release that grows
// a new target must not fall silently outside this floor. `deploy-web.yml`
// carries web's own separate obligation (`--source-maps` plus an upload) and is
// not this guard's subject.
//
// ── ➕ AND `glitchtip-cli` IS NOW IN `SYMBOL_UPLOAD` ─────────────────────────
// The 2026-09-03 note below predicted the day: "the day a mobile build starts
// obfuscating and uploads its symbols with `glitchtip-cli debug-files upload`
// … THOSE are the patterns to add here, and the addition is then load-bearing
// rather than cosmetic." That day is today, so both the CLI call and this
// repository's wrapper for it (`tooling/ops/upload-native-symbols.mjs`, which
// exists because the CLI exits 0 over an empty directory, over failed chunks
// and over an assembly that never completed) are accepted. `dart-symbol-map
// upload` is deliberately NOT accepted: GlitchTip has no code that reads a Dart
// obfuscation map, so a lane doing only that would be retaining nothing.
//
// ── ➕ APPENDED 2026-09-07 · A THIRD LIMB, BECAUSE RETAINING IS NOT SENDING ──
//    unit `symbols-everywhere` · [ADR 067] decision 6 · programme.json P1-11.
//
// 🔴 THE COUPLING LIMB ABOVE ACCEPTS AN ARTIFACT, AND ELEVEN OF FOURTEEN LANES
// TOOK IT. That was the honest choice when shape (a) existed nowhere — see the
// 2026-08-03 note: "refusing it would push the first honest implementation into
// disabling the guard". But once ONE lane uploaded, the guard went green over a
// state nobody would have chosen: 3 of 14 release builds sent their symbols to
// the crash sink and 11 sent them to a 90-day workflow artifact that no
// symbolicator can read, and the printed sentence "every obfuscating build
// retains its symbol mapping in its own job" was TRUE of every one of them. The
// end-to-end audit of 2026-09-07 (§4, gap N9) had to count `grep -rn
// 'upload-native-symbols.mjs' .github/workflows/*.yml` by hand to see it.
//
// So there is now a limb that asks the OTHER question:
//
//   THE SINK (new)   every RELEASE build that obfuscates must be followed, in
//                    its OWN job and at a LATER line than the build, by a real
//                    symbol upload — SYMBOL_UPLOAD below, the same named list
//                    the coupling limb uses for shape (a). An artifact does not
//                    satisfy it. A job that cannot upload must be named in
//                    SINK_UPLOAD_EXEMPT with a written reason.
//
// ⚠️ WHY "AT A LATER LINE" AND NOT MERELY "IN THE SAME JOB". An upload step that
// runs BEFORE its build uploads whatever the previous run left on the runner, or
// nothing at all, and it does so at exit 0 — the shape this whole family exists
// to refuse. The line number is the `run:` line of the logical command, which
// workflow-scan.mjs preserves through block-scalar joining, so this compares
// step order and not text position inside a step.
//
// ⚠️ AND WHY THE EXEMPTION LIST IS A DECLARED TABLE RATHER THAN AN ALLOWLIST.
// It is graded in BOTH directions, exactly like tooling/versions.json's
// `$updateExemptions`: an entry naming a job that has no obfuscating release
// build, or one that DOES upload, is a stale excuse and fails the build. A
// waiver that outlives the thing it waived is how a list stops describing the
// tree. It is empty today, on purpose — all fourteen upload.
//
// ── ➕ APPENDED 2026-09-23 · THE FOURTH READER OF releaseBuildsNeverShipped ────
//    (O-BUILT-ARTIFACT-GUARDS-RUN-ONLY-AFTER-MERGE)
//
// ci.yml job `android-artifacts` builds the three Android release artifacts on
// every PR, obfuscated exactly as build-platforms.yml builds them, and throws
// them away with the runner. Holding those builds to COUPLING and SINK would mean
// uploading a PR's symbols somewhere; the build is never installed, so there is
// no crash report for them to read.
//
// So this guard now reads `releaseBuildsNeverShipped` from
// tooling/channel-register.json through workflow-scan.mjs `gradeDomain` — the same
// function, over the same parse, that splits the domain for
// assert-channel-register, assert-store-build-config and assert-seams-wired.
// Before today it was the one reader carrying its own idea of which builds count.
//
//   · THE FLOOR never reads the list. A listed build that drops --obfuscate is
//     red, exactly as a shipped one is.
//   · COUPLING and SINK read it ONLY where they would otherwise fail. A listed
//     build that retains or uploads its symbols is graded and counted like any
//     other: symbolication-proof.yml does both, and a blanket skip would silently
//     take it out of the SINK count.
//   · Every listed build is printed with its `why` on every run, pass or fail.
//   · A MISSING register means no exemptions: every build is graded (fail-closed).
//     A register that is not JSON is COVERAGE LOST, and so is a tree whose every
//     obfuscating release build is listed: the sink limb would grade nothing.
//
// Usage:  node tooling/ci/assert-obfuscation-coupled.mjs [repoRoot]
// Exit 0 = every release build obfuscates, no build obfuscates without
//          retaining its symbols, and every obfuscating release build sends
//          them to the crash sink from its own job — save a build listed in
//          releaseBuildsNeverShipped, printed with its reason.
// Exit 1 = a finding on the FLOOR, COUPLING or SINK limb.
// Exit 2 = COVERAGE LOST (nothing to grade, or the register unreadable).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAllWorkflows, flutterBuilds, flutterReleaseBuilds, gradeDomain, RELEASE_MODES, NOT_RELEASE_BUILD,
} from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

// ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): the builds
// this guard grades are workflow-scan's flutterBuilds census, every mode, one
// record per shell segment, a composer call composed. It kept a raw `flutter
// build` loop of its own because the release census dropped the --debug/--profile
// builds it must print; that loop walked past a composer call, so a composed
// release build was never held to the floor. The census's `web-server` exclusion,
// its target and its `mode` are the three regexes this file carried.

/** A release build. `--release` is Flutter's own word for it — but it is NOT
 *  the signal, because it is not required. `flutter build <target>` DEFAULTS to
 *  release mode (docs.flutter.dev/deployment/*: "flutter build … builds a
 *  release … by default"; `--debug` and `--profile` are the documented opt-outs
 *  and `flutter build --help` lists `--release` as the default build mode). So
 *  the flag is decoration on every line this repository ships, and keying the
 *  floor's domain on it left a silent escape hatch: deleting five characters
 *  from `flutter build apk --release` changed nothing about the artefact and
 *  removed a shipping build from the floor at exit 0. Measured 2026-09-07 by
 *  the guard-integrity reviewer — the count fell 13 → 12 and nothing named the
 *  build that left.
 *
 *  The rule is therefore INVERTED, in the same spirit as the target sets above:
 *  a build is a release build UNLESS it says otherwise in Flutter's own words.
 *  Only an explicit `--debug` or `--profile` takes a build out of the domain,
 *  and those exits are COUNTED AND PRINTED, never silent. A command carrying
 *  BOTH `--release` and `--debug`/`--profile` is contradictory and is COVERAGE
 *  LOST, not a guess. The census's `mode` is that rule: `release` and `default`
 *  are RELEASE_MODES, `debug`/`profile` the explicit exits, `contradictory` the
 *  command with both. */

/** DECLARED, from Flutter's own documentation rather than from taste:
 *  docs.flutter.dev/deployment/obfuscate — "Obfuscation is supported on these
 *  targets". A release build on one of these MUST obfuscate. */
const OBFUSCATABLE_TARGETS = new Set([
  'aar', 'apk', 'appbundle', 'ios', 'ios-framework', 'ipa',
  'linux', 'macos', 'macos-framework', 'windows',
]);

/** DECLARED. `web` is from the same source and the same sentence: "Web apps
 *  don't support obfuscation." `web-server` is Flutter's dev server rather than
 *  an artifact, which is why the census already refuses to see it; it is
 *  named here as well so the two lists read as one statement.
 *
 *  ⏱ CORRECTED 2026-09-07 — `bundle` WAS in this set and is now REMOVED. The
 *  header called both sets "DECLARED, from Flutter's own documentation", but
 *  the cited page says only that web is unsupported; `bundle` was an unsourced
 *  entry in an exemption set, which is exactly the shape the header argues
 *  against. It exempted nothing (`grep -rn "flutter build bundle" .github/
 *  tooling/` → no match), so removing it costs no coverage and hands the
 *  verdict back to the COVERAGE LOST limb, where an unsourced target belongs.
 *
 *  A target in NEITHER set is COVERAGE LOST — see the header. */
const NON_OBFUSCATABLE_TARGETS = new Set(['web', 'web-server']);

/** The two flags that make a build unreadable without its mapping file. */
const OBFUSCATE = /--obfuscate\b/;
const SPLIT_DEBUG = /--split-debug-info(?:=|\s+)(\S+)/;

/** (a) — a real symbol upload to a crash sink. Named, not heuristic: a
 *  heuristic that stops matching reports "clean", which is the failure mode
 *  this whole family of guards exists to remove. */
const SYMBOL_UPLOAD = [
  /sentry-cli[^\n]*\b(debug-files|difutil)\b[^\n]*\bupload\b/,
  /sentry-cli[^\n]*\bupload-dif\b/,
  /sentry-cli[^\n]*\bupload-dsym\b/,
  /sentry_dart_plugin/,
  /upload-symbols/,
  /getsentry\/action-release/,
  /symbol-collector/,
  // GlitchTip's own CLI, added 2026-09-07 when the first native lane started
  // uploading. `debug-files upload` is the DIF path the server implements;
  // `dart-symbol-map upload` is NOT here because GlitchTip stores nothing from
  // it. The wrapper is accepted alongside the bare call because it is what this
  // repository actually invokes, and it exists to make the CLI's exit code mean
  // what it says.
  /glitchtip-cli[^\n]*\bdebug-files\b[^\n]*\bupload\b/,
  /upload-native-symbols\.mjs/,
];

/** DECLARED EXEMPTIONS FROM THE SINK LIMB, and nothing else exempts.
 *
 *  A job that runs an obfuscating RELEASE build and does not send the mapping
 *  to the crash sink belongs here, named, with the reason written out — never
 *  silently outside the limb. Shape: `{ workflow, job, why }`, matched on the
 *  workflow's path relative to the repository root and the job's YAML key.
 *
 *  ⛔ THIS IS GRADED IN BOTH DIRECTIONS. An entry whose job has no obfuscating
 *  release build, or whose job DOES upload, fails the build as a stale excuse —
 *  the same rule tooling/versions.json's `$updateExemptions` is held to. An
 *  exemption that outlives its subject is how a list stops describing the tree.
 *
 *  EMPTY ON PURPOSE, 2026-09-07: all fourteen release builds upload. The four
 *  ubuntu-24.04 store lanes never needed a new pin at all — the linux-x86_64
 *  binary they run on was already pinned — and the windows and macOS lanes are
 *  wired against `glitchtip_cli_windows_x86_64_sha256` and
 *  `glitchtip_cli_macos_arm64_sha256`, two digests of the SAME pinned release.
 *  @type {{workflow: string, job: string, why: string}[]} */
const SINK_UPLOAD_EXEMPT = [];

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-obfuscation-coupled: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

const workflows = parseAllWorkflows(ROOT);
if (workflows.length === 0) {
  coverageLost([
    `no workflow files were parsed under ${ROOT}/.github/workflows.`,
    'Every question below is asked of build commands in workflows. With none read, the guard would',
    'report "no build obfuscates without retaining its symbols" over an empty set — the exact shape',
    'this repo has shipped twice.',
  ]);
}

// A stripper that ate the file makes every question below run over an empty
// string and answer "nothing to check".
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'The build-command scan below would then range over nothing and print ok.',
    ]);
  }
}

// ── THE BUILDS WHOSE OUTPUT NOBODY INSTALLS ─────────────────────────────────
// `releaseBuildsNeverShipped` in tooling/channel-register.json, split out by the
// SAME `gradeDomain` the three register readers use, over the SAME parse as the
// loop below — one list, one reading, one parse. See the header's 2026-09-23
// section for what it does and does not waive.
const REGISTER_PATH = join(ROOT, 'tooling', 'channel-register.json');
let register = null;
if (existsSync(REGISTER_PATH)) {
  try {
    register = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
  } catch (e) {
    coverageLost([
      `${REGISTER_PATH} exists and is not JSON (${e.message}).`,
      'releaseBuildsNeverShipped cannot be read, so this guard cannot tell a discarded build from a',
      'shipped one. Grading every build instead would be a verdict about a different register.',
    ]);
  }
}
const neverShippedKey = (workflow, runLine, segment) => JSON.stringify([workflow, runLine, segment]);
/** workflow + `run:` line + shell segment → the entry's `why`. */
const neverShipped = new Map();
for (const b of gradeDomain(flutterReleaseBuilds(ROOT, workflows), register).exempt) {
  if (typeof b.why !== 'string' || !b.why.trim()) {
    coverageLost([
      `a releaseBuildsNeverShipped entry matches ${b.workflow}:${b.runLine} (job "${b.job}") and carries no \`why\`.`,
      'An exemption with no written reason is a silent skip wearing a label.',
    ]);
  }
  neverShipped.set(neverShippedKey(b.workflow, b.runLine, b.segment), b.why);
}
/** Every never-shipped build the loop met, and every COUPLING or SINK finding one of
 *  them did not become. Both are printed on every run, pass or fail. */
const neverShippedSeen = new Map();
const waivedKeys = new Set();
const waived = [];
let couplingWaived = 0;

/** Every `path:` value inside a job, one per line — enough to answer "does an
 *  upload step name this directory" without a full YAML model. */
const uploadedPaths = (job) => {
  const out = [];
  let inUpload = false;
  for (const l of job.logical) {
    if (/^\s*-\s+(uses|name):/.test(l.text)) inUpload = false;
    if (/actions\/upload-artifact/.test(l.text)) inUpload = true;
    if (!inUpload) continue;
    const m = l.text.match(/^\s*(?:path:\s*)?(\S.*?)\s*$/);
    if (m && !/^(?:-\s+)?(uses|with|name|if|id):/.test(m[1])) out.push(m[1].replace(/^path:\s*/, '').replace(/^-\s*/, ''));
  }
  return out;
};

let buildsChecked = 0;
let obfuscating = 0;
let releaseBuilds = 0;
let webReleaseBuilds = 0;
const unknownTargets = [];
const contradictoryModes = [];
const nonReleaseBuilds = [];
/** THE SINK LIMB's subject set: one entry per obfuscating RELEASE build.
 *  @type {{wf: string, job: string, line: number, dir: string, sinkAfter: boolean,
 *          neverShippedWhy: string|null, nsKey: string}[]} */
const sinkSubjects = [];

/** workflow + job → that job's census records, in the census's walk order. */
const buildsByJob = new Map();
for (const b of flutterBuilds(ROOT, workflows)) {
  const key = `${b.workflow}\0${b.job}`;
  if (!buildsByJob.has(key)) buildsByJob.set(key, []);
  buildsByJob.get(key).push(b);
}

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    const jobText = job.logical.map((l) => l.text).join('\n');
    const hasSinkUpload = SYMBOL_UPLOAD.some((re) => re.test(jobText));
    // The `run:` line of every real symbol upload in this job. workflow-scan
    // keeps a folded or literal block's OWN `run:` line number, so these are
    // step positions, not offsets inside a step — which is what makes
    // "the upload comes after the build" a meaningful comparison.
    const sinkLines = job.logical
      .filter((l) => SYMBOL_UPLOAD.some((re) => re.test(l.text)))
      .map((l) => l.n);
    const paths = uploadedPaths(job);

    for (const b of buildsByJob.get(`${wf.rel}\0${job.name}`) ?? []) {
      const seg = b.segment;
      const line = b.runLine;
      buildsChecked++;
      const obf = OBFUSCATE.test(seg);
      const split = SPLIT_DEBUG.exec(seg);

      const at = `${wf.rel}:${line} (job "${job.name}")`;
      /** Non-null only for a build `releaseBuildsNeverShipped` lists. The FLOOR
       *  below never reads it; COUPLING and SINK read it only where they would
       *  otherwise fail. */
      const nsKey = neverShippedKey(wf.rel, line, seg);
      const neverShippedWhy = neverShipped.get(nsKey) ?? null;
      if (neverShippedWhy !== null) neverShippedSeen.set(nsKey, { at, why: neverShippedWhy });

      // ── THE FLOOR ─────────────────────────────────────────────────────
      // Its domain is a RELEASE build on a target Flutter can obfuscate.
      // A target in neither declared set is COVERAGE LOST, not a skip:
      // silently falling outside a floor is how a floor stops being one.
      // And "release" is decided by ABSENCE of --debug/--profile, not by the
      // presence of --release, because Flutter builds release by default —
      // see the census's `mode` above. Contradictory mode flags are COVERAGE LOST.
      const target = b.target;
      /** Set by the floor below: this command IS a release build on a target
       *  Flutter can obfuscate. The sink limb's domain is exactly that set
       *  intersected with "and it does obfuscate". */
      let inFloorDomain = false;
      if (!OBFUSCATABLE_TARGETS.has(target) && !NON_OBFUSCATABLE_TARGETS.has(target)) {
        unknownTargets.push(`${at} builds target "${target}"`);
      } else if (b.mode === 'contradictory') {
        contradictoryModes.push(
          `${at} passes --release AND ${(seg.match(NOT_RELEASE_BUILD) ?? [''])[0]} on the same command`,
        );
      } else if (RELEASE_MODES.has(b.mode)) {
        if (OBFUSCATABLE_TARGETS.has(target)) {
          releaseBuilds++;
          inFloorDomain = true;
          if (!obf) {
            problems.push(
              `${at} is a RELEASE build of "${target}" and does not pass --obfuscate. ` +
                '[ADR 067] decision 6: every release build is obfuscated with split debug info and its ' +
                'symbols retained. An un-obfuscated release ships every Dart symbol name in the binary, ' +
                'and the audit of 2026-09-07 found 15 of these and zero obfuscating — which this guard ' +
                'reported as "ok, 0 obfuscating" because it had no floor. Add ' +
                `--obfuscate --split-debug-info=<dir> and retain <dir> in job "${job.name}".`,
            );
          }
        } else {
          webReleaseBuilds++;
        }
      } else {
        // An EXPLICIT --debug/--profile. Counted and printed, never silent:
        // the whole point of inverting the rule was that a build must not be
        // able to leave the floor's domain without saying so out loud.
        nonReleaseBuilds.push(`${at} builds "${target}" in --${b.mode} mode`);
      }

      if (!obf && !split) continue;
      obfuscating++;

      // The two flags travel together or the build is broken in a way no
      // upload can repair: `--obfuscate` with no `--split-debug-info` writes
      // NO mapping file anywhere, so the symbols do not exist to be kept.
      if (obf && !split) {
        problems.push(
          `${at} passes --obfuscate with no --split-debug-info. Flutter then writes no symbol mapping ` +
            'at all, so every crash report from this build is permanently unreadable — there is nothing ' +
            'to upload and nothing to recover. The two flags are one flag.',
        );
        continue;
      }
      if (!obf && split) {
        // Harmless on its own (symbols split out of a non-obfuscated binary
        // are still readable in the binary), so this is a NOTE, not a failure.
        notes.push(`${at} passes --split-debug-info without --obfuscate — the binary is still readable, so nothing is lost; the flag is doing less than it looks like.`);
        continue;
      }

      const dir = split[1].replace(/^['"]|['"]$/g, '');

      // ── THE SINK ──────────────────────────────────────────────────────
      // Recorded here rather than judged here: the verdict needs the whole
      // set so a stale exemption can be found in the same pass.
      if (inFloorDomain) {
        sinkSubjects.push({
          wf: wf.rel,
          job: job.name,
          line,
          dir,
          sinkAfter: sinkLines.some((n) => n > line),
          neverShippedWhy,
          nsKey,
        });
      }

      const named = paths.some((p) => p.includes(dir) || dir.includes(p.replace(/\/\*+$/, '')));
      if (hasSinkUpload || named) continue;
      if (neverShippedWhy !== null) {
        waivedKeys.add(nsKey);
        couplingWaived++;
        waived.push(
          `${at} obfuscates into "${dir}" and nothing in job "${job.name}" retains it — COUPLING WAIVED, ` +
            `held to the FLOOR only; listed in releaseBuildsNeverShipped: ${neverShippedWhy}`,
        );
        continue;
      }

      problems.push(
        `${at} obfuscates into "${dir}" and nothing in job "${job.name}" retains it. ` +
          'A rebuild produces a DIFFERENT mapping, so the symbols for this release exist only on this ' +
          'runner and only until it is reclaimed — after that every crash report from the build is ' +
          'unreadable and cannot be made readable. Upload the symbols to the crash sink in the same ' +
          `job, or upload "${dir}" as an artifact in the same job, or drop --obfuscate.`,
      );
    }
  }
}

if (buildsChecked === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s) and found ZERO \`flutter build\` commands.`,
    'This guard only ever speaks about build commands, so with none found it has nothing to say and',
    'would say "ok" — indistinguishable from a matcher that has stopped matching. build-platforms.yml',
    'alone carries six.',
  ]);
}

if (unknownTargets.length) {
  coverageLost([
    `${unknownTargets.length} \`flutter build\` command(s) name a target this guard has no verdict for:`,
    ...unknownTargets,
    'The floor below asks "does every release build on an obfuscatable target obfuscate", and both',
    'sets are DECLARED from docs.flutter.dev/deployment/obfuscate. An unrecognised target is not a',
    'pass — it is a target that would fall outside the floor in silence. Put it in',
    'OBFUSCATABLE_TARGETS or NON_OBFUSCATABLE_TARGETS, with the doc line that says which.',
  ]);
}

if (contradictoryModes.length) {
  coverageLost([
    `${contradictoryModes.length} \`flutter build\` command(s) name TWO build modes at once:`,
    ...contradictoryModes,
    "This guard decides the floor's domain by the ABSENCE of --debug/--profile, because Flutter",
    'builds release by default. A command carrying both words does not have an answer, and guessing',
    'one would either exempt a shipping build or fail a debug build. Pick one mode on the command.',
  ]);
}

if (releaseBuilds === 0) {
  coverageLost([
    `parsed ${workflows.length} workflow file(s), found ${buildsChecked} \`flutter build\` command(s) and`,
    'ZERO of them a release build on a target Flutter can obfuscate — so the floor has no subject and',
    'would report "every release build obfuscates" over an empty set. That is precisely the shape this',
    'guard printed for a month while [ADR 067] decision 6 went unmet. build-platforms.yml alone carries',
    'six release builds across linux, android, windows, macOS and iOS.',
  ]);
}

// ── THE SINK LIMB'S VERDICT ─────────────────────────────────────────────────
// Its subject is every obfuscating release build. With none, it would report
// "every release build reaches the crash sink" over an empty set — the shape
// [C-COVERAGE-LOST-IS-NOT-PASS] names, and the shape the floor was added for.
//
// ⚠️ `problems.length === 0` IS PART OF THE CONDITION, NOT AN ESCAPE HATCH. When
// the floor has already found a build that does not obfuscate, "nothing
// obfuscates, so this limb had no subject" is a CONSEQUENCE of that finding, and
// printing it INSTEAD would replace the message naming the file, line, job and
// target with a vaguer one. The exit code is 1 either way; only the sharper
// sentence survives. A tree with NO floor finding and NO subject is the vacuous
// pass, and that is what this refuses.
if (sinkSubjects.length === 0 && problems.length === 0) {
  coverageLost([
    `counted ${releaseBuilds} release build(s) on an obfuscatable target and ZERO of them obfuscating,`,
    'so the sink limb has no subject and would report "every release build sends its symbols to the',
    'crash sink" over an empty set. The floor above should already have refused this; reaching here',
    'with no floor finding means the two limbs disagree about the same set, which is worse than',
    'either of them failing.',
  ]);
}

const exemptKey = (w, j) => `${w}#${j}`;
const sinkExempt = new Map();
for (const e of SINK_UPLOAD_EXEMPT) {
  if (!e?.workflow || !e?.job || !e?.why?.trim()) {
    coverageLost([
      'a SINK_UPLOAD_EXEMPT entry is missing `workflow`, `job` or `why`.',
      'An exemption with no written reason is a silent skip wearing a label, and this guard cannot',
      'tell which job it was meant to excuse.',
    ]);
  }
  sinkExempt.set(exemptKey(e.workflow, e.job), e.why);
}

const sinkExemptUsed = new Set();
let sinkWaived = 0;
for (const s of sinkSubjects) {
  const key = exemptKey(s.wf, s.job);
  if (s.sinkAfter) {
    if (sinkExempt.has(key)) sinkExemptUsed.add(`STALE:${key}`);
    continue;
  }
  if (sinkExempt.has(key)) {
    sinkExemptUsed.add(key);
    notes.push(
      `${s.wf}:${s.line} (job "${s.job}") obfuscates into "${s.dir}" and sends nothing to the crash sink — ` +
        `EXEMPT, declared: ${sinkExempt.get(key)}`,
    );
    continue;
  }
  if (s.neverShippedWhy !== null) {
    sinkWaived++;
    waivedKeys.add(s.nsKey);
    waived.push(
      `${s.wf}:${s.line} (job "${s.job}") obfuscates into "${s.dir}" and sends nothing to the crash sink — ` +
        `SINK WAIVED, held to the FLOOR only; listed in releaseBuildsNeverShipped: ${s.neverShippedWhy}`,
    );
    continue;
  }
  problems.push(
    `${s.wf}:${s.line} (job "${s.job}") is an obfuscating RELEASE build into "${s.dir}" and NOTHING LATER IN ` +
      `job "${s.job}" uploads those symbols to the crash sink. ` +
      '[ADR 067] decision 6 asks for --obfuscate --split-debug-info PLUS SYMBOL UPLOAD on every release ' +
      'build, and a retained workflow artifact is not an upload: no symbolicator reads it, it expires, ' +
      'and by then a rebuild produces a DIFFERENT mapping. This is exactly the state the audit of ' +
      '2026-09-07 found on 11 of 14 lanes while this guard printed ok. Add the ' +
      '`tooling/ops/upload-native-symbols.mjs` step AFTER the build and AFTER the retention artifact in ' +
      `this same job — or, if this job genuinely cannot, add {workflow, job, why} to SINK_UPLOAD_EXEMPT.`,
  );
}

// A tree whose every obfuscating release build is never-shipped would leave the
// sink limb grading nothing while it printed "SINK: all 0 of them upload" — the
// vacuous pass the check above refuses, reached by a different road.
if (sinkSubjects.length > 0 && sinkSubjects.length === sinkWaived && problems.length === 0) {
  coverageLost([
    `all ${sinkWaived} obfuscating release build(s) are listed in releaseBuildsNeverShipped, so the sink`,
    'limb graded none of them and would report "every release build sends its symbols to the crash',
    'sink" over an empty set. A tree that ships nothing obfuscated has lost this guard\'s subject.',
  ]);
}

for (const [key, why] of sinkExempt) {
  if (sinkExemptUsed.has(`STALE:${key}`)) {
    problems.push(
      `SINK_UPLOAD_EXEMPT names ${key}, and that job DOES upload its symbols to the crash sink. ` +
        `A waiver outliving the thing it waived is how a list stops describing the tree — delete it. Its ` +
        `stated reason was: ${why}`,
    );
    continue;
  }
  if (!sinkExemptUsed.has(key)) {
    problems.push(
      `SINK_UPLOAD_EXEMPT names ${key}, and no obfuscating release build was found in that job at all. ` +
        `Either the workflow or the job was renamed and the waiver did not follow, or it excuses nothing. ` +
        `Its stated reason was: ${why}`,
    );
  }
}

// Printed on EVERY run, pass or fail, before the verdict: a build this guard
// holds to less than all three limbs is named with its reason every time, and a
// listed build that needed no waiver is named too — an exemption nobody reads is
// indistinguishable from an omission (the register's own rule).
if (neverShippedSeen.size) {
  console.log(
    `⬜ releaseBuildsNeverShipped (tooling/channel-register.json) — ${neverShippedSeen.size} build(s) whose ` +
      'output nobody installs; the FLOOR grades every one on an obfuscatable target:',
  );
  for (const w of waived) console.log(`    ${w}`);
  for (const [k, { at, why }] of neverShippedSeen) {
    if (!waivedKeys.has(k)) {
      console.log(`    ${at} is listed and needed no waiver here — every limb that applies to it passed: ${why}`);
    }
  }
}

if (problems.length) {
  console.error(
    `✗ obfuscation — ${problems.length} problem(s) over ${releaseBuilds} release build(s), ${obfuscating} obfuscating:`,
  );
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-7 — obfuscation and symbol retention are one increment or neither.');
  console.error('  [ADR 067] decision 6 — every release build obfuscates and keeps its symbols.');
  console.error('  See the header of tooling/ci/assert-obfuscation-coupled.mjs for why the order matters.');
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  obfuscation — ${workflows.length} workflow(s), ${buildsChecked} \`flutter build\` command(s), ` +
    `${releaseBuilds} release build(s) on an obfuscatable target, ${obfuscating} obfuscating; ` +
    `FLOOR: all ${releaseBuilds} of them pass --obfuscate. COUPLING: every obfuscating build retains ` +
    `its symbol mapping in its own job` +
    (couplingWaived ? `, except ${couplingWaived} never-shipped build(s) printed above` : '') +
    `. SINK: all ${sinkSubjects.length - sinkWaived} of them upload those symbols to ` +
    `the crash sink from a later step of the same job` +
    (sinkExempt.size ? `, except ${sinkExempt.size} declared exemption(s) printed above` : ', with no declared exemption') +
    `. ${webReleaseBuilds} web release build(s) are outside the floor ` +
    'because Flutter does not support obfuscation on web' +
    (nonReleaseBuilds.length
      ? `; ${nonReleaseBuilds.length} build(s) are outside it on an EXPLICIT --debug/--profile: ` +
        nonReleaseBuilds.join(', ')
      : '; no build claims --debug or --profile, so nothing left the floor by opting out') +
    (sinkWaived
      ? `; ${sinkWaived} never-shipped obfuscating release build(s) are held to the FLOOR only and printed above`
      : ''),
);
