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
// `apps/subly` is on it because a human typed it there, and the stamper added
// nothing — so the newest and least-tested app in the repo was the one thing the
// one-command check did not check. Green tick, nothing examined.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const POST_GEN = 'tooling/bricks/app/hooks/post_gen.dart';
const CI = '.github/workflows/ci.yml';
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

/** Flutter's platform folder names. A folder outside this set is not a platform. */
const PLATFORM_DIRS = ['android', 'ios', 'linux', 'macos', 'web', 'windows'];

const postGen = read(POST_GEN);
// 🔴 STRIP COMMENTS BEFORE SCANNING. Found by mutation 2026-07-29: deleting the
// real `flutter build web` step left this guard GREEN, because the explanatory
// comment ABOVE that step says the words "flutter build web". The guard matched
// the prose describing the check instead of the check. That is this repo's own
// recorded rule — assert on structure, never by grepping prose — reproduced by
// the person writing it down.
const ciRaw = read(CI);
const ci = ciRaw === null ? null : ciRaw.replace(/^\s*#.*$/gm, '');
if (postGen === null) problems.push(`${POST_GEN} is missing — nothing writes the platform claim.`);
if (ciRaw === null) problems.push(`${CI} is missing — nothing builds a stamp.`);

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
    if (!new RegExp(`flutter build ${p}\\b`).test(ci)) {
      problems.push(
        `the stamp CLAIMS "${p}" but ${CI} never runs \`flutter build ${p}\` against a stamped app. A claim nothing builds is a promise made to a public catalogue and never kept.`,
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
    problems.push(
      `COVERAGE LOST — ${CI} has ${rawSteps} step(s), and none survived comment stripping. The stripper has eaten the file, so every check about what CI runs is being asked of an empty string.`,
    );
  } else if (ciSteps > 0) {
    ok(`${ciSteps} of ${rawSteps} CI step(s) survived comment stripping`);
  } else {
    // rawSteps === 0: the workflow parser found no steps AT ALL, which is its
    // own coverage failure — a ci.yml with zero steps builds nothing.
    problems.push(
      `COVERAGE LOST — ${CI} contains ZERO recognisable steps. Either the file was emptied or this scan's step pattern no longer matches real workflow syntax.`,
    );
  }

  // ── direction 2: every STAMPED platform folder is claimed ─────────────────
  // Without this, adding `windows/` to the template quietly ships a platform the
  // catalogue never mentions and CI never builds.
  let stamped = [];
  try {
    stamped = readdirSync(join(ROOT, BRICK_APP))
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

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-stamp-platforms: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-stamp-platforms: ok');
}
