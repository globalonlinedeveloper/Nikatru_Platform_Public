#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-xcode-floor.mjs — the Xcode this runner ACTUALLY has meets the floor
// tooling/versions.json declares.
//
// Pipeline requirement: Private/requirements/ → C-6.
//
// ── THE KEY WAS MISTAKEN FOR AN ENFORCER ─────────────────────────────────────
// 🔴 tooling/versions.json has declared `xcode: "26"` since the key landed, and
// UNTIL THIS FILE NOTHING COMPARED IT TO ANYTHING. Worse than nothing: adding
// the key SILENCED the one warning that named the risk. tooling/release/
// submit-appstore.mjs decided whether to print
//
//     XCODE FLOOR NOT PINNED — apps uploaded to App Store Connect "must be
//     built with Xcode 26 or later", in force since 28 April 2026
//
// with `hasOwnProperty('xcode')` — the KEY'S PRESENCE, nothing more. So the
// moment somebody wrote the pin down, the sentence describing the hazard
// stopped printing, and the hazard itself did not move an inch. A declaration
// is not an enforcement, and the gap between them is invisible precisely
// because the declaration reads like a fix.
//
// ── WHAT THIS ASSERTS THAT versions.json's OWN COMMENT DOES NOT ──────────────
// ⚠️ READ $xcode_comment BEFORE CHANGING THIS FILE. It records, correctly, that
// tooling/ci/assert-version-consistency.mjs carries NO rule for this key and
// compares it to no CALL SITE — because nothing in the tree selects an Xcode
// (`xcode-select -s`, setup-xcode), so a drift rule there would be an assertion
// with no target, which this repository deletes rather than counts.
//
// That reasoning is sound and this guard does not contradict it. A call-site
// rule asks "does some YAML line name the same string?" and there is no such
// line. THIS asks a different question with a real subject: what did
// `xcodebuild -version` REPORT on the machine that just built the artifact?
// The image label `macos-26` names an image FAMILY, not an immutable image, and
// $runners_comment records windows-2025 changing COMPILERS under an unchanged
// pin — the identical hazard one platform over. If that image ever selects an
// Xcode below the floor, every Apple artifact it produces violates a store
// policy ALREADY IN FORCE, and today nothing would say so.
//
// ── A FLOOR IS A MAJOR, AND THE COMPARISON IS `>=` ───────────────────────────
// Apple's sentence is "Xcode 26 or later". versions.json stores the major for
// that reason, spelled out in $xcode_comment: writing 26.6 would pin whatever
// the image happened to carry on the day somebody looked, and a floor that
// moves with the image is not a floor, it is the image restated. So 26.6 and 27
// both PASS against a floor of 26, and 25.4 fails.
//
// ── ABSENT xcodebuild IS COVERAGE LOST, NEVER A PASS ─────────────────────────
// This runs on macOS. Everywhere else — a Linux CI job, a Windows developer
// machine, the subject-free tree assert-guards-refuse-empty spawns — there is
// no `xcodebuild` to ask, and the honest answer is "this check did not run",
// which must never wear the same exit code as "the floor is met". That is why
// this guard is wired into build-platforms.yml's `apple` job and NOT into
// ci.yml: on ubuntu it would be permanently, correctly, COVERAGE LOST.
//
// Usage:  node tooling/ci/assert-xcode-floor.mjs [repoRoot]
// Exit 0 = the runner's Xcode major is >= the declared floor.
//      1 = it is not, or the question could not be asked.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSIONS_REL = 'tooling/versions.json';
export const FLOOR_KEY = 'xcode';

/**
 * The MAJOR of an `xcodebuild -version` report, or null.
 *
 * Pure, so the decision is unit-tested on Windows and Linux against captured
 * output — the same split assert-artifact-signed-apple.mjs uses, and for the
 * same reason: the only part of this job that needs a Mac is running the tool.
 *
 * Real output is two lines:  `Xcode 26.6\nBuild version 17F113`
 */
export function parseXcodeMajor(stdout) {
  if (typeof stdout !== 'string') return null;
  // Anchored to a LINE START so `Build version 17F113` and any prose mentioning
  // a version cannot be read as the answer.
  const m = /^\s*Xcode\s+(\d+)(?:\.\d+)*\s*$/m.exec(stdout);
  if (!m) return null;
  const major = Number(m[1]);
  return Number.isInteger(major) && major > 0 ? { major, reported: m[0].trim() } : null;
}

/** The declared floor as a major, or null when it is not a usable one. */
export function parseFloor(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw !== 'string') return null;
  const m = /^\s*(\d+)\s*$/.exec(raw);
  if (!m) return null;
  const major = Number(m[1]);
  return Number.isInteger(major) && major > 0 ? major : null;
}

/** Pure verdict, so both directions are testable without a Mac. */
export function meetsFloor(runnerMajor, floorMajor) {
  return runnerMajor >= floorMajor;
}

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  "The check could not run" must never share an exit code with "the floor is met".');
  console.error('assert-xcode-floor: FAILED');
  process.exit(1);
}

function main() {
  const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

  const versionsAbs = join(ROOT, VERSIONS_REL);
  if (!existsSync(versionsAbs)) {
    coverageLost(
      `${VERSIONS_REL} does not exist under ${ROOT}.`,
      'The floor is declared there and nowhere else. Falling back on a number typed into this file is the',
      'second declaration that goes stale while reporting ok.',
    );
  }
  let declared;
  try {
    declared = JSON.parse(readFileSync(versionsAbs, 'utf8'));
  } catch (e) {
    coverageLost(`${VERSIONS_REL} is not valid JSON (${e.message}), so no floor can be read.`);
  }

  // The key VANISHING must be loud. Its absence is what silenced the warning in
  // submit-appstore.mjs in the first place — one level up, and in reverse.
  if (!Object.prototype.hasOwnProperty.call(declared, FLOOR_KEY)) {
    coverageLost(
      `${VERSIONS_REL} declares no \`${FLOOR_KEY}\` key, so this guard has no floor to compare against.`,
      'App Store Connect requires Xcode 26 or later (developer.apple.com/news/upcoming-requirements/,',
      'fetched 2026-07-29; in force since 28 April 2026). A missing pin is an unanswered question, not a',
      'satisfied one.',
    );
  }
  const floor = parseFloor(declared[FLOOR_KEY]);
  if (floor === null) {
    coverageLost(
      `${VERSIONS_REL} declares \`${FLOOR_KEY}\`: ${JSON.stringify(declared[FLOOR_KEY])}, which is not a major version.`,
      'The floor is a MAJOR on purpose — see $xcode_comment. A value this guard cannot read as one would',
      'make every comparison below meaningless.',
    );
  }

  const probe = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    coverageLost(
      `\`xcodebuild -version\` could not be run (${probe.error ? probe.error.code ?? probe.error.message : `exit ${probe.status}`}).`,
      'This guard belongs to the Apple lane and asks a question only a macOS runner can answer. On any other',
      `platform that is the expected outcome — it is wired into build-platforms.yml's \`apple\` job and`,
      'deliberately not into ci.yml.',
    );
  }
  const seen = parseXcodeMajor(`${probe.stdout ?? ''}\n${probe.stderr ?? ''}`);
  if (seen === null) {
    coverageLost(
      '`xcodebuild -version` ran and this guard could not find an `Xcode <major>` line in its output.',
      `What it printed was: ${JSON.stringify(`${probe.stdout ?? ''}`.trim().slice(0, 200))}`,
      'An unparseable reading is not a low version and it is not a high one. Refusing beats guessing.',
    );
  }

  if (!meetsFloor(seen.major, floor)) {
    console.error(
      `✗ the runner reports ${JSON.stringify(seen.reported)} and ${VERSIONS_REL} declares a floor of ${floor}.`,
    );
    console.error(
      '  App Store Connect requires apps to be "built with Xcode 26 or later"' +
        ' (developer.apple.com/news/upcoming-requirements/, fetched 2026-07-29; in force since 28 April 2026).',
    );
    console.error(
      `  The runner LABEL (${JSON.stringify(declared.runner_macos ?? 'unknown')}) names an image FAMILY, not an` +
        ' immutable image, so the image moving its default Xcode is exactly the drift this guard exists to name.',
    );
    console.error('assert-xcode-floor: FAILED');
    process.exit(1);
  }

  console.log(
    `ok  xcode floor — the runner reports ${JSON.stringify(seen.reported)} and ${VERSIONS_REL} declares a floor of ` +
      `${floor}; ${seen.major} >= ${floor}, so every Apple artifact this job produces was built with a toolchain ` +
      'App Store Connect accepts. The floor is a MAJOR, so a later Xcode passes and is meant to [pipeline C-6]',
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
