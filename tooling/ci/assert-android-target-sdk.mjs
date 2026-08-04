#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-android-target-sdk.mjs — every Android module PINS its `targetSdk`,
// and the pinned value meets Google Play's floor.
//
// 🔴 WHY THIS EXISTS — the state it was written against, 2026-08-04.
//
// `apps/subly/android/app/build.gradle.kts` read:
//
//     targetSdk = flutter.targetSdkVersion
//
// which is a property on the FlutterExtension supplied by the INSTALLED Flutter
// SDK (`packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt`).
// Flutter 3.44.7 on the owner's box declares 36, so the app met Play's floor —
// BY ACCIDENT OF WHICH TOOLCHAIN WAS INSTALLED. Nothing in this repository
// asserted it, and nothing would have noticed it change:
//
//   · a Flutter downgrade drops `targetSdk` with NO diff in the Gradle file;
//   · Gradle does not error — a lower targetSdk is a perfectly valid build;
//   · no test covers it, and no test could, because the value is not in the tree;
//   · CI goes GREEN, the artifact builds, and the FIRST symptom is Google Play
//     rejecting the upload — after the build, after the gate, after the merge.
//
// Pinning `flutter-version:` in the workflows does not fix this. It MOVES the
// dependency (one pin now decides two unrelated things) rather than removing it,
// and it says nothing about a local build or a future SDK bump.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔒 THE NUMBER IS NOT IN THIS FILE, AND THAT IS THE POINT.
//
// A guard that enforces a limit nobody sourced fires on CORRECT input while
// looking authoritative — the sin `assert-store-metadata.mjs` refuses and
// `assert-ceiling-budget.mjs` enforces ("a value with NO `source` https URL").
// So the floor is read from the `play-target-api-level` duty row in
// `tooling/legal/duty-matrix.json`, where it sits beside the
// developer.android.com URL it came from and the date that URL was read.
//
// `assert-legal-tripwires.mjs` independently holds that row to the
// primary-source ALLOWLIST (the body that wrote the rule or the platform that
// enforces it) and to a `fetched` date. This guard does NOT trust that: it
// re-checks that the row carries an https `source.url` and an ISO `fetched`
// before it will enforce anything, because "delegated" only means something if
// the delegate is verified rather than assumed. A row with the number and no
// citation is COVERAGE LOST here, not a pass.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ WHAT THIS GUARD CANNOT SEE. Stated, not papered over.
//
//   · IT DOES NOT RUN GRADLE. It reads the declared literal. A value injected by
//     an AGP plugin, a `productFlavors` block overriding `defaultConfig`, or a
//     project-level script mutating the extension is outside its reach. Android
//     CANNOT be built on the owner's machine at all — `java.nio.channels.
//     Selector.open()` fails process-wide from a Windows socket-layer defect
//     (CLAUDE.md) — so "just run the build and read the merged manifest" is not
//     available here and would make every CI run depend on the Android SDK.
//     Refusing anything that is not a plain integer literal is what makes the
//     static read sound: the guard fails rather than guesses.
//   · IT CANNOT SEE GOOGLE CHANGING THE POLICY. The floor is only as current as
//     the `fetched` date on the duty row, which is printed on every run.
//   · IT CANNOT SEE AN APP THAT HAS NO ANDROID MODULE YET. `tooling/bricks/app`
//     ships no `android/` template — a stamped app gets one from `flutter
//     create`, which writes `targetSdk = flutter.targetSdkVersion`. That app
//     arrives RED here on its first CI run, which is the intended outcome: an
//     unclassified new module fails rather than inheriting the toolchain
//     silently. It is called out because "the brick is covered" would be false.
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE, in the two directions that have burned this repo:
//
//   scanned  ≡  every `apps/*/android/app/build.gradle.kts` on disk, AND
//   scanned  ⊇  REQUIRED_COVERAGE — the flagship module, named literally, so a
//               regex that stops matching is COVERAGE LOST rather than "0
//               problems". `check-migrations.mjs` silently dropped from five
//               files to four and printed PASS; that is the shape.
//   every `apps/*/android/` directory MUST yield a module. An Android module
//   that exists in a layout this scan does not reach is invisible, and invisible
//   reads exactly like compliant.
//
// And the reduction is checked rather than trusted: `stripSourceComments`
// returns its input UNCHANGED for an unknown extension, so before `.kts` was
// added to its map this guard would have been reading header prose as code and
// reporting clean. It asserts the strip actually stripped.
//
// Usage:  node tooling/ci/assert-android-target-sdk.mjs [repoRoot]
// Exit 0 = every Android module pins targetSdk at or above the sourced floor.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOT readdirSync — assert-walks-bounded.mjs rejects it. A raw listing descends
// into a nested checkout (a git worktree, a submodule, a stray clone) and reads
// another repository's Gradle files as this tree's.
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const MATRIX_REL = 'tooling/legal/duty-matrix.json';
const DUTY_ID = 'play-target-api-level';
const APPS_REL = 'apps';

/** No argument means CI's own invocation against the real repository, where the
 *  flagship module MUST be present. A fixture root is a weaker situation and
 *  says so instead of silently skipping the named-coverage assertion. */
const scanningRealRepo = process.argv[2] === undefined;

/** Named literally, because "0 problems over 0 files" and "0 problems over the
 *  file that matters" print identically. */
const REQUIRED_COVERAGE = [
  { path: 'apps/subly/android/app/build.gradle.kts', label: 'the flagship app — the only Android module that exists today' },
];

const problems = [];
const prints = [];

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`    ${d}`);
  process.exit(1);
};

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOOR, AND ITS CITATION. Read together or not at all.
// ─────────────────────────────────────────────────────────────────────────────
const matrixPath = join(ROOT, MATRIX_REL);
if (!existsSync(matrixPath)) {
  coverageLost(
    `${MATRIX_REL} does not exist under ${ROOT}.`,
    'It carries the floor AND the primary source it came from. Without it this guard has no number to',
    'enforce, and enforcing a hard-coded one would be a limit nobody cited — which is how an invented',
    'threshold ends up rejecting correct input while looking authoritative.',
  );
}

let matrix;
try {
  matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
} catch (e) {
  coverageLost(`${MATRIX_REL} could not be parsed (${e.message}). An unreadable matrix is an absent one.`);
}

const duty = (matrix?.duties ?? []).find((d) => d?.id === DUTY_ID);
if (!duty) {
  coverageLost(
    `${MATRIX_REL} has no duty row \`${DUTY_ID}\`.`,
    'Deleting the row would delete the floor, and every module below would then be compared against',
    'nothing at all while this guard still printed a result. The row IS the requirement.',
  );
}

// The citation is a precondition of enforcement, not decoration beside it.
const srcUrl = duty.source?.url;
const fetched = duty.source?.fetched;
if (typeof srcUrl !== 'string' || !/^https:\/\/\S+$/.test(srcUrl)) {
  coverageLost(
    `duty \`${DUTY_ID}\` declares a limit with no https \`source.url\`.`,
    'A guard that enforces a number nobody sourced fires on CORRECT input while looking authoritative.',
    'Cite the primary source, or remove the enforced value and say why it could not be established.',
  );
}
if (typeof fetched !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fetched)) {
  coverageLost(
    `duty \`${DUTY_ID}\` cites ${srcUrl} with no ISO \`source.fetched\` date.`,
    'A store policy read at an unknown time cannot be known to be current, and store policies change',
    'without notice. The date is what makes the number re-checkable by whoever reads this next.',
  );
}

const floor = duty.enforced?.targetSdkAtLeast;
if (!Number.isInteger(floor) || floor <= 0) {
  coverageLost(
    `duty \`${DUTY_ID}\` has no integer \`enforced.targetSdkAtLeast\` (got ${JSON.stringify(floor)}).`,
    'The comparison below would range over a non-number and every module would pass it. The value is',
    'structured on purpose: parsing it out of the human-readable `quote` would be asserting on prose,',
    "which is how a grep for '\"r2_buckets\"' once matched the comment explaining there is no r2_buckets.",
  );
}

const inForceFrom = duty.enforced?.inForceFrom;
if (typeof inForceFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(inForceFrom)) {
  coverageLost(
    `duty \`${DUTY_ID}\` has no ISO \`enforced.inForceFrom\` date (got ${JSON.stringify(inForceFrom)}).`,
    'A floor with no date attached cannot be reported with lead time, and a deadline nobody counts down',
    'to is one that arrives as a rejected upload.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MODULES. Derived from the tree, both directions.
// ─────────────────────────────────────────────────────────────────────────────
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

const appsDir = join(ROOT, APPS_REL);
if (!isDir(appsDir)) {
  coverageLost(`${APPS_REL}/ does not exist under ${ROOT}, so the module set was derived from nothing.`);
}

const modules = [];
const androidDirsWithoutModule = [];
for (const entry of listDir(appsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const androidDir = join(appsDir, entry.name, 'android');
  if (!isDir(androidDir)) continue;
  const rel = `${APPS_REL}/${entry.name}/android/app/build.gradle.kts`;
  const relGroovy = `${APPS_REL}/${entry.name}/android/app/build.gradle`;
  if (existsSync(join(ROOT, rel))) modules.push(rel);
  else if (existsSync(join(ROOT, relGroovy))) modules.push(relGroovy);
  // ⚠️ THE DIRECTION THAT GETS FORGOTTEN. An `android/` directory whose app
  // module this scan cannot find is an Android module nobody checks, and
  // "not found" prints identically to "compliant". Deriving the set ONLY from
  // files that match would make MOVING the module the way to pass.
  else androidDirsWithoutModule.push(`${APPS_REL}/${entry.name}/android`);
}

if (androidDirsWithoutModule.length) {
  coverageLost(
    `${androidDirsWithoutModule.length} app(s) have an android/ directory whose app module this scan did not find:`,
    ...androidDirsWithoutModule.map((d) => `${d} — expected ${d}/app/build.gradle[.kts]`),
    'An Android module in a layout the scan does not reach is invisible, and invisible reads as compliant.',
  );
}

if (modules.length === 0) {
  coverageLost(
    `no Android app module found under ${APPS_REL}/*/android/app/.`,
    'Zero modules means every assertion below ranges over the empty set and this guard reports clean',
    'while checking nothing — this repository\'s single most repeated defect.',
  );
}

if (scanningRealRepo) {
  for (const { path, label } of REQUIRED_COVERAGE) {
    if (!modules.includes(path)) {
      coverageLost(
        `${path} (${label}) is not in the ${modules.length} module(s) this scan reached.`,
        'The module did not become compliant; the guard stopped looking at it.',
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSING THE REAL GRADLE CONFIG.
//
// Comments are stripped first: a `// targetSdk = 36` in a header would
// otherwise satisfy a check about the value the build actually uses. Braces are
// then matched with string-awareness so a `{` inside a Kotlin string or a
// `${...}` template cannot close a block early.
// ─────────────────────────────────────────────────────────────────────────────

/** End of the `{ … }` block whose opening brace is at `open`, or -1. Quoted runs
 *  (including `"""raw"""`) are skipped whole. */
export function matchBrace(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c + c + c, i);
      if (triple) {
        const e = text.indexOf(c + c + c, i + 3);
        if (e === -1) return -1;
        i = e + 3;
        continue;
      }
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '\n') break;
        if (text[j] === c) { closed = true; j++; break; }
        j++;
      }
      // An unterminated quote means we mis-read the opener. Err towards reading
      // the character as ordinary rather than swallowing the rest of the file —
      // the same direction-of-error rule text-reductions.mjs is built on.
      i = closed ? j : i + 1;
      continue;
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; if (depth === 0) return i; continue; }
    i++;
  }
  return -1;
}

/** The body of the FIRST top-level `name { … }` block in `text`, or null. */
export function blockBody(text, name) {
  const re = new RegExp(String.raw`(^|[^\w.])${name}\s*\{`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(text, open);
  if (close === -1) return null;
  return text.slice(open + 1, close - 1);
}

/**
 * The right-hand side of `name = <expr>` in `body`, as
 * `{ literal: <int> } | { expression: '<text>' } | null`.
 *
 * ⚠️ A NON-LITERAL IS NOT A PARSE FAILURE — it is the defect. Returning null for
 * `flutter.targetSdkVersion` would make an unpinned module indistinguishable
 * from an unreadable one, and the unreadable case is COVERAGE LOST while the
 * unpinned case is the thing this guard was written about. They must not share
 * an outcome.
 */
export function assignment(body, name) {
  const re = new RegExp(String.raw`(^|[^\w.])${name}\s*=\s*([^\r\n]+)`, 'm');
  const m = re.exec(body);
  if (!m) return null;
  const rhs = m[2].trim().replace(/\s*(\/\/.*)?$/, '').trim();
  return /^\d+$/.test(rhs) ? { literal: Number(rhs), raw: rhs } : { expression: rhs, raw: rhs };
}

let checked = 0;

for (const rel of modules) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const ext = rel.endsWith('.kts') ? '.kts' : '.kt';
  const src = stripSourceComments(raw, ext);

  // THE REDUCTION IS ASSERTED, NOT ASSUMED. `stripSourceComments` returns its
  // input unchanged for an extension it does not know, silently — so if `.kts`
  // ever leaves its map, every check below would be reading comments as code.
  // This file's own header is the test input: it contains `//`, so a working
  // strip MUST shorten the comment text.
  if (raw.includes('//') && src === raw) {
    coverageLost(
      `the comment reduction did not reduce ${rel}.`,
      'stripSourceComments returned its input unchanged, which is what it does for an extension missing',
      'from COMMENT_STYLES in tooling/ci/text-reductions.mjs. Every assertion below would then be reading',
      'commented-out code and header prose as if the build used it.',
    );
  }

  const androidBody = blockBody(src, 'android');
  if (androidBody === null) {
    coverageLost(
      `${rel} — no \`android { … }\` block found after comment stripping.`,
      'The values this guard exists to read live inside it. Not finding the block means the scan reached',
      'the file and understood none of it, which must never print as "no problems".',
    );
  }
  const defaultConfigBody = blockBody(androidBody, 'defaultConfig');
  if (defaultConfigBody === null) {
    coverageLost(
      `${rel} — no \`defaultConfig { … }\` block inside \`android { … }\`.`,
      '`targetSdk` is declared there. An unparsed block is a value nobody compared to the floor.',
    );
  }

  const target = assignment(defaultConfigBody, 'targetSdk');
  if (target === null) {
    coverageLost(
      `${rel} — \`defaultConfig\` declares no \`targetSdk\`.`,
      'Omitting it does not mean "compliant": AGP falls back to compileSdk, which is a value this guard',
      'is not reading as the target and which moves for entirely unrelated reasons.',
    );
  }

  checked += 1;

  if (target.expression !== undefined) {
    problems.push(
      `${rel} — \`targetSdk = ${target.expression}\` is NOT PINNED. It resolves at configuration time from ` +
        'the installed toolchain (`flutter.targetSdkVersion` comes out of the Flutter SDK\'s FlutterExtension.kt), ' +
        'so the value that reaches Google Play is decided by which SDK happens to be on the build machine. ' +
        'A downgrade lowers it with no diff, no Gradle error and no failing test — the first symptom is a ' +
        'rejected upload. Write an integer literal.',
    );
    continue;
  }

  if (target.literal < floor) {
    problems.push(
      `${rel} — \`targetSdk = ${target.literal}\`, below Google Play's floor of ${floor}. ` +
        `Source: ${srcUrl} (read ${fetched}), in force from ${inForceFrom}. ` +
        'Play REJECTS the upload; nothing earlier in the pipeline says so.',
    );
  }

  // AGP requires compileSdk >= targetSdk. A DERIVED relationship between two
  // values in the same file, not a threshold this guard invented — which is why
  // it is allowed to be build-failing.
  const compile = assignment(androidBody, 'compileSdk');
  if (compile === null) {
    problems.push(`${rel} — the \`android\` block declares no \`compileSdk\`.`);
  } else if (compile.expression !== undefined) {
    // Stated, not asserted. A toolchain-resolved compileSdk beside a pinned
    // targetSdk breaks the BUILD (loudly, at AGP) rather than shipping a wrong
    // artifact, so failing here would be inventing a rule Google does not have.
    prints.push(
      `${rel} — compileSdk is \`${compile.expression}\`, resolved from the toolchain, so compileSdk >= targetSdk ` +
        'CANNOT be checked statically here. AGP fails the build if it is violated.',
    );
  } else if (compile.literal < target.literal) {
    problems.push(
      `${rel} — \`compileSdk = ${compile.literal}\` is below \`targetSdk = ${target.literal}\`. AGP rejects this ` +
        'combination, so the module cannot build at all — and Android cannot be built on the owner\'s machine ' +
        '(CLAUDE.md: java.nio Selector.open() fails process-wide), which means CI is the first place it would surface.',
    );
  }

  prints.push(`${rel} — targetSdk ${target.literal} (pinned)${compile?.literal !== undefined ? `, compileSdk ${compile.literal}` : ''}`);
}

if (checked === 0) {
  coverageLost('zero modules were evaluated. A guard that checked nothing must never be green.');
}

// ── the deadline, with lead time ────────────────────────────────────────────
const daysLeft = Math.floor((Date.parse(`${inForceFrom}T00:00:00Z`) - Date.now()) / 86_400_000);
prints.push(
  daysLeft >= 0
    ? `Play floor ${floor} is IN FORCE in ${daysLeft} day(s), on ${inForceFrom}. Source ${srcUrl} read ${fetched}.`
    : `Play floor ${floor} has been IN FORCE since ${inForceFrom} (${-daysLeft} day(s)). Source ${srcUrl} read ${fetched}.`,
);
prints.push(
  'NOT CHECKED HERE: Gradle is never run, so a flavour override, an AGP plugin or a project-level script ' +
    'mutating the value is outside this scan; and nothing here can see Google changing the policy after ' +
    `${fetched}.`,
);

if (problems.length) {
  console.error(`assert-android-target-sdk: FAIL — ${problems.length} problem(s) across ${checked} module(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error(`  The floor and its citation live in ${MATRIX_REL}, duty \`${DUTY_ID}\`.`);
  process.exit(1);
}

console.log(`assert-android-target-sdk: OK — ${checked} Android module(s) pin targetSdk at or above ${floor}`);
for (const p of prints) console.log(`  · ${p}`);
