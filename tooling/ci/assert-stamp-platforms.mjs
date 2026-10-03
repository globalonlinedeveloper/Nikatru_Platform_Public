#!/usr/bin/env node
// [pipeline S-3 · S-4] A STAMPED APP BUILDS ON EVERY PLATFORM IT CLAIMS, AND
// JOINS THE WORKSPACE THAT CHECKS IT.
//
// ── WHY BOTH DIRECTIONS, AND WHY A FLOOR ───────────────────────────────────
// The acceptance criterion S-3 shipped with iterated the app's `platforms`
// array and built each entry. `post_gen.dart` hardcodes that array to
// `['web']` — so SHRINKING IT TO `[]` MADE ZERO BUILDS RUN, GREEN. A
// requirement about building was satisfied by building nothing.
//
// That is the empty-domain shape, and one direction cannot catch it. So:
//   · every CLAIMED platform must have a stamped folder AND a CI build step
//   · every STAMPED platform folder must appear in the claim
//   · the claim must name at least one platform — an empty claim is a failure,
//     not a vacuous pass
//
// ── WHY S-4 LIVES HERE TOO ─────────────────────────────────────────────────
// They are the same failure seen twice: a check that ranges over something the
// stamp never populated. `melos run gate` iterates the root `workspace:` list,
// `apps/subscriptiontracker` is on it because a human typed it there, and the stamper added
// nothing — so the newest and least-tested app in the repo was the one thing the
// one-command check did not check. Green tick, nothing examined.
//
// ── O-BRICK-STAMPS-WEB-ONLY (D30): THE NATIVE TARGETS, AND THE APP SET ─────
// The claim above is where an app is PUBLISHED (app.yaml `platforms`), and a
// stamp publishes on web only. What it BUILDS for is a second question, and the
// one that turned red on nobody's watch: build-platforms.yml's matrix is every
// `apps/` workspace member with no platform filter, so an app #2 stamped web-only
// red-lines every native job of the weekly proof the day it is committed. Three
// limbs, each a relationship:
//   · N1 the stamp WRITES every platform build-platforms.yml compiles: post_gen
//     calls `_stampNativePlatforms`, and tooling/kit/stamp-native.mjs's
//     NATIVE_PLATFORMS plus the template's own folders cover the set that
//     workflow builds (derived from its `flutter build` census, never typed);
//   · N2 the brick lane's callee (lane-map.json `lanes.brick.callee`, today
//     lane-brick.yml) BUILDS at least one native target on the fresh stamp, so
//     a stamp is proven native by a compiler and not by file presence;
//   · N3 every app in the workspace set (tooling/ci/app-set.mjs) carries a folder
//     for each platform build-platforms.yml compiles — the weekly proof's red,
//     moved onto the pull request that causes it.
//
// LANE-BOUND: build-platforms.yml — N1 and N3's subject is the one workflow whose matrix is every
// workspace app built on every platform with no filter; that unfiltered matrix IS the defect they
// guard. Another lane that builds a stamped app (the brick callee, lane-brick.yml) is graded by N2 and
// direction 1 by name.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, flutterBuilds, workflowSteps as jobSteps, shellSegments, COMPOSER_CALL, BUILD_TARGET_PLATFORM } from './workflow-scan.mjs';
import { appSet, nestedIds } from './app-set.mjs';
import { NATIVE_PLATFORMS } from '../kit/stamp-native.mjs';

const ROOT = process.cwd();
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const POST_GEN = 'tooling/bricks/app/hooks/post_gen.dart';
const LANE_MAP = 'tooling/ci/lane-map.json';
const BUILD_PLATFORMS = '.github/workflows/build-platforms.yml';
const PROBE_VARS = 'tooling/bricks/app/_probe_vars.json';
const problems = [];
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
const ok = (m) => console.log(`ok   ${m}`);

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

// ⏱ CHANGED 2026-10-02 (ci-path-scope): the stamp jobs left ci.yml for the brick
// lane's callee (ADR 095), and this guard kept reading ci.yml, where no stamp is
// built any more, so it went red on a tree that builds the stamp. The workflow
// read is now the one lane-map.json names as `lanes.brick.callee`, never typed
// here: move the lane again and this follows it. No callee named is COVERAGE
// LOST, not a fallback to ci.yml, which would grade a file that builds nothing.
function brickCallee() {
  try {
    const callee = JSON.parse(read(LANE_MAP) ?? 'null')?.lanes?.brick?.callee;
    return typeof callee === 'string' && callee.trim() ? callee.trim() : null;
  } catch {
    return null;
  }
}
const CI = brickCallee();
if (CI === null) {
  coverageLost(`${LANE_MAP} names no \`lanes.brick.callee\`, so there is no workflow to ask whether CI builds the stamp.`);
}

/** Flutter's platform folder names. A folder outside this set is not a platform. */
const PLATFORM_DIRS = ['android', 'ios', 'linux', 'macos', 'web', 'windows'];

const postGen = read(POST_GEN);
// 🔴 STRIP COMMENTS BEFORE SCANNING. Found by mutation 2026-07-29: deleting the
// real `flutter build web` step left this guard GREEN, because the explanatory
// comment ABOVE that step says the words "flutter build web". The guard matched
// the prose describing the check instead of the check. That is this repo's own
// recorded rule — assert on structure, never by grepping prose — reproduced by
// the person writing it down.
//
// 🔴 AND THAT FIX WAS HALF A FIX (2026-08-01 full-corpus review). It stripped
// FULL-LINE comments only, then tested bare presence anywhere in the file — so a
// TRAILING comment (`run: echo skip  # flutter build web disabled`), a step
// `name:` containing the phrase, or an `echo "flutter build web"` all still
// satisfied "CI builds this platform". Mutation-proven: gutting the real build
// step to an echo-plus-comment left this guard printing ok. The check now ranges
// over RUN-BLOCK STRUCTURE: only the command text of `run:` scalars, with shell
// comments and quoted strings removed, and the phrase must sit in COMMAND
// position — the same prose-vs-structure rule, applied to where the match is
// allowed to happen, not only to what is stripped first.
const ciRaw = CI === null ? null : read(CI);
const ci = ciRaw === null ? null : ciRaw.replace(/^\s*#.*$/gm, '');

/** A step's `working-directory:`, read at the step's own mapping indent so a
 *  string inside a block scalar cannot supply one. `null` = the repo root.
 *  ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): the step is
 *  workflow-scan's `workflowSteps` line range of the parsed job, not a split of the
 *  raw text this file used to make; its lines are read the same way. */
function stepWorkdir(job, step) {
  const lines = job.lines.filter((l) => l.n >= step.first && l.n <= step.last);
  const indent = (lines[0]?.text.match(/^(\s*)-\s/)?.[1].length ?? 0) + 2;
  const re = new RegExp(`^\\s{${indent}}working-directory:\\s*(.+)$`);
  for (const { text } of lines) {
    const m = text.match(re);
    if (m) {
      return m[1].replace(/\s#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\/+$/, '');
    }
  }
  return null;
}

/** Every place CI actually INVOKES `flutter build <p>` — in command position,
 *  not inside a quoted string, a shell comment, or an argument to `echo` —
 *  paired with the directory that invocation runs in.
 *
 *  🔴 AND THE DIRECTORY IS THE POINT (2026-08-01 corpus triage). Scoping the
 *  match to command position was still only half the check: the guard asked
 *  WHETHER the command exists and never WHICH APP it builds. Mutation-proven on
 *  the real workflow — flipping this step's `working-directory` from the freshly
 *  stamped probe to `apps/subscriptiontracker` left the guard printing `ok every claimed
 *  platform is stamped and built in CI`, while the thing being built was the
 *  hand-maintained legacy app that has compiled for a year. "A fresh stamp
 *  really builds" was then proven by building something that was never stamped.
 *
 *  ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): the builds
 *  are workflow-scan's flutterBuilds census of ci.yml, every mode, so a build a
 *  step asks tooling/ci/flutter-release-build.mjs to make is one. This file's own
 *  step split and `run:`-block reader walked past it. The census matches
 *  `flutter build` anywhere in a segment, so each record still has to put it in
 *  COMMAND position once quoted strings are blanked, and a segment left holding
 *  a quote is the tail of a quoted string the census split at a `;`: prose, not
 *  a command. parseWorkflow has already blanked `#` comments, full-line and
 *  trailing. A composed build runs where the composer runs `flutter`, which is
 *  apps/<app>, whatever the step's `working-directory` says; a line with more
 *  than one composer call names no single app, so its builds anchor nowhere. */
function buildInvocations(p) {
  const wf = parseWorkflow(ROOT, CI);
  if (wf === null) return [];
  const invoke = new RegExp(`^\\s*flutter\\s+build\\s+${p}\\b`);
  const unRun = (s) => s.replace(/^\s*(?:-\s+)?run:\s*/, '');
  const found = [];
  for (const b of flutterBuilds(ROOT, [wf])) {
    const seg = unRun(b.segment).replace(/'[^'\n]*'/g, ' ').replace(/"[^"\n]*"/g, ' ');
    if (/["']/.test(seg) || !invoke.test(seg)) continue;
    const job = wf.jobs.get(b.job);
    const line = job.logical.find((l) => l.n === b.runLine);
    const segments = shellSegments(line.text).map(unRun);
    let workdir = null;
    if (segments.includes(unRun(b.segment))) {
      const step = jobSteps(job).find((s) => s.first <= b.runLine && b.runLine <= s.last);
      if (step !== undefined) workdir = stepWorkdir(job, step);
    } else {
      const calls = segments.map((s) => COMPOSER_CALL.exec(s)).filter((m) => m !== null);
      const app = calls.length === 1 ? calls[0][1].trim().split(/\s+/).find((t) => !t.startsWith('-')) : undefined;
      if (app !== undefined) workdir = `apps/${app}`;
    }
    found.push({ workdir, segments });
  }
  return found;
}

/** Is this invocation anchored to the stamped app? Either the step declares it
 *  as its `working-directory`, or the same command chain `cd`s there first —
 *  both are shapes this repo's workflows legitimately use. */
function anchoredTo(inv, dir) {
  if (inv.workdir === dir) return true;
  const cd = new RegExp(`^\\s*cd\\s+\\.?/?${dir}/?\\s*$`);
  return inv.segments.some((seg) => cd.test(seg));
}
if (postGen === null) problems.push(`${POST_GEN} is missing — nothing writes the platform claim.`);
if (CI !== null && ciRaw === null) problems.push(`${CI} is missing — nothing builds a stamp.`);

// The directory a stamped-app build has to run in, DERIVED from the vars file
// the stamp lane actually feeds mason — never typed here. Rename the probe and
// the anchor follows it; there is no constant to go stale. If it cannot be
// derived the anchor test would silently become vacuous, so that is a coverage
// failure rather than a skip.
let stampDir = null;
const probeVars = read(PROBE_VARS);
if (probeVars !== null) {
  try {
    const id = JSON.parse(probeVars).app_id;
    if (typeof id === 'string' && id.trim()) stampDir = `apps/${id.trim()}`;
  } catch { /* reported immediately below */ }
}
if (stampDir === null) {
  coverageLost(
    `${PROBE_VARS} yields no \`app_id\`, so there is no directory to anchor "CI builds the STAMPED app" to. Without it the build check credits \`flutter build\` run against any app in the tree, including one that was never stamped.`,
  );
}

if (postGen !== null && ci !== null) {
  // ── the CLAIM ─────────────────────────────────────────────────────────────
  // Parsed structurally from the literal post_gen writes, not grepped from
  // prose: this file's comments name platforms repeatedly, and matching those
  // would read the explanation instead of the code.
  const m = postGen.match(/'platforms':\s*<String>\[([^\]]*)\]/);
  let claimed = [];
  if (!m) {
    problems.push(
      `${POST_GEN} does not write a \`'platforms': <String>[...]\` array, so a stamped app makes no platform claim at all and nothing can be checked against it.`,
    );
  } else {
    claimed = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  }

  // 🔴 THE FLOOR. This is the limb that catches the original defect: an empty
  // claim made every "for each claimed platform" check pass by having nothing
  // to iterate.
  if (m && claimed.length < 1) {
    problems.push(
      `the platform claim is EMPTY. Every per-platform check below would then range over nothing and pass — which is exactly how "a stamped app builds on every platform it claims" was satisfied by building none.`,
    );
  } else if (claimed.length) {
    ok(`the stamp claims ${claimed.length} platform(s): ${claimed.join(', ')}`);
  }

  // ── direction 1: every CLAIMED platform is stamped and built ──────────────
  for (const p of claimed) {
    if (!existsSync(join(ROOT, BRICK_APP, p))) {
      problems.push(
        `the stamp CLAIMS "${p}" but the brick stamps no \`${p}/\` folder. \`flutter build ${p}\` fails immediately on a fresh stamp, and its error suggests \`flutter create . --platforms ${p}\` — the hand-repair a stamper exists to make unnecessary.`,
      );
    }
    const builds = buildInvocations(p);
    if (builds.length === 0) {
      problems.push(
        `the stamp CLAIMS "${p}" but ${CI} never runs \`flutter build ${p}\` against a stamped app. A claim nothing builds is a promise made to a public catalogue and never kept.`,
      );
    } else if (stampDir !== null && !builds.some((b) => anchoredTo(b, stampDir))) {
      const where = builds.map((b) => `\`${b.workdir ?? '<repo root>'}\``).join(', ');
      problems.push(
        `${CI} runs \`flutter build ${p}\`, but not in \`${stampDir}\` — it runs in ${where}. The claim is about a FRESH STAMP: building an app that a human has maintained for a year proves the toolchain works, not that the brick produces a buildable app. Point the step's \`working-directory\` at the stamped app.`,
      );
    }
  }
  if (claimed.length && !problems.length) {
    ok(`every claimed platform is stamped and built in CI`);
  }

  // ── COVERAGE SELF-CHECK on this guard's own scans ─────────────────────────
  // [pipeline F-10] Everything above reads two files. If the comment stripper
  // ever eats more than comments, every "does CI run X" check below is asked of
  // an empty string and passes.
  //
  // 🔴 A RELATIONSHIP, NOT A MAGIC NUMBER. The first version was "at least 20
  // steps", which fired on this guard's own test fixture — a fixture has three
  // steps by design — and the fix I reached for first was a marker saying "only
  // enforce on the real file", which the fixture then also matched. Both are the
  // same mistake: a floor that has to be tuned is a floor somebody eventually
  // lowers. So the check compares the two scans to each other. It holds for a
  // three-step fixture and a sixty-step workflow alike, and needs no tuning.
  // 🔴 FIXED 2026-07-31: this pair was written `/^\\s*-\\s+…/` — in a regex
  // LITERAL `\\s` matches a literal backslash + s, so both counts were always 0
  // and NEITHER branch below could ever run. The check satisfied
  // assert-guard-coverage's "carries a COVERAGE LOST self-check" requirement
  // while asserting nothing — an assertion that cannot fail, inside the guard
  // whose own header records the comment-stripping lesson. The ok-line below is
  // now the testable half: stamp-platforms.test.mjs asserts it prints with a
  // sane count, which fails against the broken regex.
  const rawSteps = (ciRaw.match(/^\s*-\s+(name|run):/gm) ?? []).length;
  const ciSteps = (ci.match(/^\s*-\s+(name|run):/gm) ?? []).length;
  if (rawSteps > 0 && ciSteps === 0) {
    coverageLost(
      `${CI} has ${rawSteps} step(s), and none survived comment stripping. The stripper has eaten the file, so every check about what CI runs is being asked of an empty string.`,
    );
  } else if (ciSteps > 0) {
    ok(`${ciSteps} of ${rawSteps} CI step(s) survived comment stripping`);
  } else {
    // rawSteps === 0: the workflow parser found no steps AT ALL, which is its
    // own coverage failure — a ci.yml with zero steps builds nothing.
    coverageLost(
      `${CI} contains ZERO recognisable steps. Either the file was emptied or this scan's step pattern no longer matches real workflow syntax.`,
    );
  }

  // ── direction 2: every STAMPED platform folder is claimed ─────────────────
  // Without this, adding `windows/` to the template quietly ships a platform the
  // catalogue never mentions and CI never builds.
  let stamped = [];
  try {
    stamped = listDir(join(ROOT, BRICK_APP))
      .filter((e) => PLATFORM_DIRS.includes(e))
      .filter((e) => statSync(join(ROOT, BRICK_APP, e)).isDirectory());
  } catch {
    problems.push(`${BRICK_APP} could not be read — the brick's app template is missing.`);
  }
  for (const p of stamped) {
    if (!claimed.includes(p)) {
      problems.push(
        `the brick stamps a \`${p}/\` folder that the platform claim does not name. The app would ship platform code nobody builds and no catalogue entry mentions.`,
      );
    }
  }
  if (stamped.length) ok(`${stamped.length} stamped platform folder(s), all claimed`);

  // ── [pipeline S-4] the workspace ─────────────────────────────────────────
  // 🔴 A CALL, NOT THE NAME. Deleting the call left this green because the
  // FUNCTION DECLARATION still matched `_registerInWorkspace`. That is the
  // declaration-vs-usage trap for the sixth time in this repo — a dead function
  // nobody invokes looks identical to a working one from a bare word match.
  const registerCalls = [...postGen.matchAll(/(^|[^\w])_registerInWorkspace\s*\(/g)]
    .filter((mm) => !/void\s*$/.test(postGen.slice(0, mm.index + mm[0].length - '_registerInWorkspace('.length)));
  if (registerCalls.length === 0) {
    problems.push(
      `${POST_GEN} never adds the app to the root \`workspace:\` list. \`melos run gate\` iterates that list, so a freshly stamped app — the newest and least-tested thing in the repository — is the one thing the one-command check skips.`,
    );
  } else {
    ok('the stamp registers the app in the workspace');
  }

  // The registration must be IDEMPOTENT, or a re-stamp under the CI escape
  // hatch duplicates the entry and the resolver refuses to load the workspace.
  // Scoped to the FUNCTION BODY. The first version tested `already lists`
  // against the whole file and passed on a gutted registration, because
  // `_appendToAppsJson` prints the same phrase — a right answer read off the
  // wrong function.
  const fnStart = postGen.indexOf('void _registerInWorkspace(');
  // Bounded by the NEXT top-level declaration, not by a `\n}` — the first
  // version looked for that closing brace and returned an EMPTY body when the
  // function happened to be formatted differently, which made the check pass
  // by examining nothing. A guard must not depend on how its subject is laid out.
  const after = postGen.slice(fnStart + 1);
  const nextDecl = after.search(/\n(?:void|String|Future|class)\s/);
  const fnBody = fnStart === -1
    ? ''
    : after.slice(0, nextDecl === -1 ? undefined : nextDecl);
  if (fnStart !== -1 && !/already lists/.test(fnBody)) {
    problems.push(
      `${POST_GEN}'s workspace registration is not idempotent — re-stamping would add a second \`apps/<id>\` line, and a duplicated workspace entry makes the whole workspace fail to resolve.`,
    );
  }
}

// ── O-BRICK-STAMPS-WEB-ONLY (D30): N1 · N2 · N3 ──────────────────────────────
// Outside the `postGen && ci` block for the reason the S-4 block below is: N3
// asks about the workspace and build-platforms.yml, and must not stop running
// when post_gen or ci.yml goes missing.
{
  /** The platforms build-platforms.yml compiles for its matrix app — every
   *  `flutter build` it runs, typed or composed, mapped through workflow-scan's
   *  one target→platform table. Empty when the workflow cannot be read. */
  const bpPlatforms = new Set();
  let bpRead = false;
  try {
    const wf = parseWorkflow(ROOT, BUILD_PLATFORMS);
    if (wf !== null) {
      bpRead = true;
      for (const b of flutterBuilds(ROOT, [wf])) if (b.platform) bpPlatforms.add(b.platform);
    }
  } catch (e) {
    coverageLost(`${BUILD_PLATFORMS} could not be parsed (${e.message}), so which platforms the weekly proof compiles for every app is unknown.`);
  }
  if (bpRead && bpPlatforms.size === 0) {
    coverageLost(
      `${BUILD_PLATFORMS} yielded ZERO \`flutter build\` platforms. Either the proof builds nothing or the census no longer reads it; N1 and N3 would range over an empty set and pass.`,
    );
  } else if (!bpRead && !problems.some((p) => p.includes(BUILD_PLATFORMS))) {
    coverageLost(`${BUILD_PLATFORMS} is missing, so which platforms the weekly proof compiles for every app is unknown.`);
  }
  const bp = [...bpPlatforms].sort();

  // ── N1: the stamp writes every platform the weekly proof compiles ──────────
  let templateDirs = [];
  try {
    templateDirs = listDir(join(ROOT, BRICK_APP)).filter((e) => PLATFORM_DIRS.includes(e));
  } catch {
    /* reported by direction 2 above when post_gen and ci.yml are readable */
  }
  // A CALL, not the name: the declaration-vs-usage trap the S-4 limb records.
  const nativeCalls =
    postGen === null
      ? []
      : [...postGen.matchAll(/(^|[^\w])_stampNativePlatforms\s*\(/g)].filter(
          (mm) => !/void\s*$/.test(postGen.slice(0, mm.index + mm[0].length - '_stampNativePlatforms('.length)),
        );
  if (postGen !== null && nativeCalls.length === 0) {
    problems.push(
      `${POST_GEN} never calls \`_stampNativePlatforms\`, so a stamp writes no native folder and app #2 inherits web alone. ${BUILD_PLATFORMS} builds every workspace app on ${bp.join(', ') || 'its platforms'}, so the first commit of that app turns the weekly proof red.`,
    );
  } else if (postGen !== null) {
    ok('the stamp calls `_stampNativePlatforms` (tooling/kit/stamp-native.mjs)');
  }
  const stampable = new Set([...templateDirs, ...NATIVE_PLATFORMS]);
  const unstamped = bp.filter((p) => !stampable.has(p));
  if (unstamped.length) {
    problems.push(
      `${BUILD_PLATFORMS} compiles every workspace app for ${unstamped.join(', ')}, and neither the brick's template nor tooling/kit/stamp-native.mjs's NATIVE_PLATFORMS stamps ${unstamped.length === 1 ? 'that folder' : 'those folders'}. A freshly stamped app is then red on that job from its first commit.`,
    );
  } else if (bp.length) {
    ok(`every platform ${BUILD_PLATFORMS} compiles (${bp.join(', ')}) is one the stamp writes`);
  }

  // ── N2: a native target is BUILT on the fresh stamp ────────────────────────
  if (ci !== null && stampDir !== null) {
    const nativeTargets = [...BUILD_TARGET_PLATFORM].filter(([, platform]) => NATIVE_PLATFORMS.includes(platform));
    const built = nativeTargets
      .filter(([target]) => buildInvocations(target).some((b) => anchoredTo(b, stampDir)))
      .map(([target]) => target);
    if (built.length === 0) {
      problems.push(
        `${CI} builds no native target (${nativeTargets.map(([t]) => t).join(', ')}) in \`${stampDir}\`. The stamp writes ${NATIVE_PLATFORMS.join(', ')}, and without one native build on the fresh stamp it is proven native by file presence alone — the exact gap D30's first red control left open.`,
      );
    } else {
      ok(`${CI} builds the fresh stamp natively: flutter build ${built.join(', ')} in ${stampDir}`);
    }
  }

  // ── N3: every workspace app carries every platform the proof compiles ──────
  const set = appSet(ROOT);
  if (set === null) {
    coverageLost('pubspec.yaml has no readable `workspace:` block, so the app set build-platforms.yml iterates could not be graded.');
  } else if (set.length === 0) {
    coverageLost('pubspec.yaml declares no `workspace:` entry under apps/, so N3 ranged over no app.');
  } else if (nestedIds(set.map((a) => a.dir)).length) {
    coverageLost(`pubspec.yaml declares ${nestedIds(set.map((a) => a.dir)).join(', ')}, nested below apps/<id>; no per-app path can address it.`);
  } else if (bp.length) {
    let missing = 0;
    for (const { id, dir } of set) {
      const lacks = bp.filter((p) => !existsSync(join(ROOT, dir, p)));
      for (const p of lacks) {
        missing++;
        problems.push(
          `${dir} is in the workspace app set and has no \`${p}/\` folder, and ${BUILD_PLATFORMS} builds every app of that set for ${p} with no platform filter. The weekly proof goes red on the day this lands. Stamp it: node tooling/kit/stamp-native.mjs --app ${id}`,
        );
      }
    }
    if (missing === 0) ok(`apps=${set.length}: every workspace app carries ${bp.join(', ')}`);
  }
}

// ── [pipeline S-4] JOINING THE WORKSPACE IS TWO HALVES, AND ONLY ONE WAS BUILT ─
// 🔴 THIS BLOCK IS DELIBERATELY OUTSIDE THE `postGen && ci` GUARD ABOVE. It asks
// about pubspecs, not about post_gen or the workflow, and a check that quietly
// stops running when an unrelated file goes missing is this repo's most repeated
// failure shape.
//
// The defect it exists for: `_registerInWorkspace` adds `apps/<id>` to the root
// `workspace:` list, and the stamped pubspec never said `resolution: workspace`.
// Dart's resolver then refuses THE WHOLE WORKSPACE — every package at once, not
// just the offending member:
//
//   apps\<id>\pubspec.yaml is included in the workspace from .\pubspec.yaml,
//   but does not have `resolution: workspace`.
//
// So `melos run gate` — the one command that defines green here — would have
// stopped resolving on the day app #2 was committed. Measured on the real tree
// with Dart 3.12.2 (stamp the probe, `flutter pub get` at the root: exit 1).
//
// 🔴 AND IT WAS INVISIBLE TO CI BY CONSTRUCTION, which is why a guard alone is
// not the fix. The `app_brick` lane resolves INSIDE `apps/probe`, which resolves
// standalone and never consults the root; `workspace_gate` runs on a clean
// checkout that has no stamp. Neither lane could see it. ci.yml now resolves
// from the repo ROOT after the stamp, so the real resolver has to accept the
// stamp too — this guard is the second line, not the only one.
{
  const BRICK_PUBSPEC = `${BRICK_APP}/pubspec.yaml`;
  const ROOT_PUBSPEC = 'pubspec.yaml';

  /** Does this pubspec declare `resolution: workspace` as a TOP-LEVEL key?
   *
   *  🔴 COMMENT-STRIPPED AND COLUMN-ANCHORED, because the words are in the
   *  template's own explanatory comment — the exact prose-vs-structure trap this
   *  file has already been fooled by twice (a comment saying "flutter build web",
   *  then a comment saying there is no `r2_buckets` in the sibling guard). A bare
   *  `includes('resolution: workspace')` stays GREEN after the real line is
   *  deleted, because the comment explaining why the line matters survives it.
   *  Column 0 also matters: a nested `resolution:` under some other key is a
   *  different setting, and the resolver only honours the top-level one. */
  const declaresWorkspaceResolution = (text) =>
    text
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trimEnd())
      .some((l) => /^resolution:[ \t]+workspace$/.test(l));

  // ── direction 1: the TEMPLATE must declare it ──────────────────────────────
  const tmpl = read(BRICK_PUBSPEC);
  if (tmpl === null) {
    coverageLost(
      `${BRICK_PUBSPEC} could not be read, so "the stamped app declares \`resolution: workspace\`" was asked of nothing. A stamped app that omits it kills root resolution for the ENTIRE repository, so this must be a failure and never a skip.`,
    );
  } else if (!declaresWorkspaceResolution(tmpl)) {
    problems.push(
      `${BRICK_PUBSPEC} does not declare \`resolution: workspace\`, but the stamp adds \`apps/<id>\` to the root \`workspace:\` list. Dart refuses the whole workspace when a listed member omits it — \`flutter pub get\` at the repo root exits 1 for EVERY package, so \`melos run gate\` stops working the day the first stamped app is committed. Add the line beside \`publish_to\`, matching apps/subscriptiontracker/pubspec.yaml.`,
    );
  } else {
    ok('the stamped pubspec declares `resolution: workspace`');
  }

  // ── direction 2: the reciprocal — every member on the root list declares it ─
  // One direction cannot catch this. Direction 1 alone passes if the stamper
  // starts registering some OTHER path; direction 2 alone passes for as long as
  // nothing stamped is committed — which is precisely the state that hid the
  // defect for the whole life of the brick. The list is parsed the same way
  // `_registerInWorkspace` writes it (`^  - <path>`), so the guard ranges over
  // exactly what the stamper edits rather than over a second idea of the format.
  const rootRaw = read(ROOT_PUBSPEC);
  const members = [];
  if (rootRaw !== null) {
    const lines = rootRaw.split('\n');
    const start = lines.findIndex((l) => l.trimEnd() === 'workspace:');
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i++) {
        const mm = lines[i].match(/^ {2}- (\S+)[ \t]*$/);
        if (!mm) break;
        members.push(mm[1]);
      }
    }
  }
  if (rootRaw === null) {
    coverageLost(
      `${ROOT_PUBSPEC} could not be read, so the reciprocal workspace check ranged over nothing. That file IS the workspace; without it there is no list to verify the stamp against.`,
    );
  } else if (members.length === 0) {
    coverageLost(
      `${ROOT_PUBSPEC} yielded ZERO \`workspace:\` members. Either the block is gone (in which case the stamper's registration writes into nothing) or this parse no longer matches the format \`_registerInWorkspace\` writes. A reciprocal check over an empty list passes by examining nothing.`,
    );
  } else {
    const bad = [];
    for (const mem of members) {
      const mp = read(`${mem}/pubspec.yaml`);
      if (mp === null) {
        bad.push(
          `\`${mem}\` is on the root \`workspace:\` list but has no ${mem}/pubspec.yaml — the resolver fails on the missing member before it reaches any of the real ones`,
        );
      } else if (!declaresWorkspaceResolution(mp)) {
        bad.push(
          `\`${mem}\` is on the root \`workspace:\` list but ${mem}/pubspec.yaml does not declare \`resolution: workspace\``,
        );
      }
    }
    if (bad.length) {
      for (const b of bad) {
        problems.push(
          `${b}. Root resolution then fails for the WHOLE repository, not just that member, and \`melos run gate\` cannot run at all.`,
        );
      }
    } else {
      ok(`all ${members.length} workspace member(s) declare \`resolution: workspace\``);
    }
  }
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-stamp-platforms: FAILED');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
} else {
  console.log('\nassert-stamp-platforms: ok');
}
