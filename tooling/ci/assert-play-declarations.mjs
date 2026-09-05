#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-play-declarations.mjs — the Data safety form and the content rating
// questionnaire are SWORN DECLARATIONS ABOUT WHAT THE CODE DOES, so they are
// compared to the code.
//
// [pipeline K-8 / G-32] (absent from origins.lock.json by construction — G-32 is a MASTER_PLAN §3 chassis-gap id, a different register from the pipeline ids; see Private/MASTER_PLAN.md) Two Play Console artefacts had NO representation in this
// repository at all until 2026-08-04, and the store README said so in prose:
// "⬜ Data safety form — a Play Console questionnaire. Blocking, and it has no
// repo representation." The Play organisation account verified the same day,
// which put both on the critical path to the first submission.
//
// 🔴 WHY A GUARD AND NOT JUST A FILE. A hand-written JSON of answers that nobody
// checks is worth almost nothing — it is true the afternoon it is typed and
// silently false three commits later, because no store console watches a
// repository. Google's own User Data policy puts the accuracy on us: "All
// developers must complete a clear and accurate Data safety section for every
// app… The developer is responsible for the accuracy of the label"
// (support.google.com/googleplay/android-developer/answer/10144311, fetched
// 2026-08-04). A Data safety label that contradicts the app's behaviour is a
// policy violation that gets apps removed, and it is also the artefact every
// DPDP consent claim ultimately rests on.
//
// So every answer that CAN be derived from the tree is derived, and the ones
// that cannot are named as a human's — by id, printed on every run. There is no
// third category, and a claim with neither a derivation nor an owner fails.
//
// ── THE LIMBS THAT ACTUALLY BITE, IN THE ORDER THEY WOULD CATCH A REAL DRIFT ──
//
//  (A) THE POSTURE. The .aab lane passes ONE dart-define (GLITCHTIP_DSN), and
//      AppConfig's isSupabaseConfigured/isApiConfigured/isBackendLive are
//      COMPILE-TIME constants over those defines. So the bundle Play would
//      receive today runs MockAuthRepository, SeedApiClient and NoOpAnalytics
//      and collects almost nothing — and adding `--dart-define=SUPABASE_URL` to
//      that one step silently turns the whole declaration into a lie. The
//      define set on the `flutter build appbundle` step is PARSED and compared.
//      This is the limb that made the whole file worth writing.
//
//  (B) THE TELLS. Nobody adds ACCESS_FINE_LOCATION to a manifest by hand; they
//      add `geolocator` to a pubspec and Gradle merges the permission in from a
//      file this repository does not contain. So each "not collected" answer
//      names the permissions, packages and iOS usage-description keys that
//      would contradict it, and the derived sets are compared against them.
//      Add a location permission or a location package and the Location answers
//      fail. MUTATION-PROVEN AGAINST THE REAL TREE — see the test header.
//
//  (C) THE INVENTORY RELATION, BOTH DIRECTIONS. tooling/legal/data-inventory.json
//      already enumerates every store this factory can put data in and already
//      fails when a table appears with no row. This guard makes the Data safety
//      form the SAME system rather than a second document that happens to agree
//      today: every `personalData: true` row is either mapped to a declared
//      Play data type or excluded BY NAME with a reason. A new personal-data
//      table therefore fails two guards, and neither takes prose for an answer.
//
//  (D) EQUALITY, NOT SUBSET, on the Android permission set and on the direct
//      dependency set. A subset check answers "did anything forbidden appear";
//      an equality answers "did anything appear AT ALL", which is the question
//      that matters when the forbidden list can never be complete. A new
//      dependency fails with "nobody said what data it can collect".
//
//  (E) THE CROSS-FILE CONTRADICTION. The Data safety form and the content
//      rating questionnaire ask the same question twice, on different screens,
//      months apart: does the app share personal info, and is it for children.
//      Answering them inconsistently is invisible to a human and obvious to a
//      comparison, so the content-rating answers are DERIVED from the Data
//      safety ones rather than written independently.
//
// ── WHAT THIS GUARD CANNOT SEE, PRINTED ON EVERY RUN ─────────────────────────
// Stated out loud because green must not be mistaken for "the form is right":
//   · WHICH LIBRARY CONTRIBUTED EACH MERGED PERMISSION. 🔴 This entry said the
//     merged manifest had never been read at all — true until 2026-08-26, when
//     it was read off the signed .aab of a CI run and recorded in
//     androidPermissions.merged. Limb 7a asserts that reading. What remains
//     unseen is narrower: no AAR manifest is in this repository or on the
//     measuring host, so INTERNET is a named finding rather than an attribution
//     and one row is graded `inferred`. The manifest-merger report from the
//     Android lane would settle every row at once.
//   · WHAT THE CRASH SDK ACTUALLY SENDS. `contexts.device` and the Sentry
//     Android installation id are assembled inside a vendored SDK at runtime.
//     That is why "Device or other IDs" is `null` under the demo posture.
//   · SUPABASE'S OWN auth.users. External project, no migrations in this repo.
//   · WHETHER PLAY HAS CHANGED ITS VOCABULARY since the fetch date recorded in
//     the declaration. Nothing in CI can notice a Google page being edited.
//   · TRANSITIVE Dart dependencies. (D) is over DIRECT ones on purpose: an
//     equality over the resolved graph would fire on every Renovate bump and be
//     switched off within a week.
//   · THE RESULTING IARC RATING. It is assigned by the rating authorities from
//     the submitted questionnaire, and this guard FAILS if one is written down
//     without a certificate and a citation beside it.
//
// 🔬 NO INVENTED NUMBERS ANYWHERE. Every external requirement quoted by the
// declarations carries a URL, a fetch date and a quote, and the host must be
// one that WROTE or ENFORCES the rule — the same rule tooling/legal/duty-matrix
// .json already uses. A citation that fails it is a build failure, because a
// limit sourced to a blog cannot be re-verified and this repo has already
// deleted one invented store limit for firing on correct input.
//
// ── THE DOMAIN, AND WHY THE BRICK IS A ROOT OF A DIFFERENT KIND ─────────────
//
// 🔴 UNTIL 2026-09-05 THIS GUARD CHECKED ONE APP, AND THE APP WAS A STRING
// LITERAL. `row.storeMetadataDir.replace('{app}', 'subly')` and
// `const APP_DIR = 'apps/subly'` meant the Data safety form, the permission
// equality and the content-rating questionnaire were compared to the code of
// exactly one app, by name. Stamp app #2 and its sworn declarations sit outside
// every limb in this file while it goes on printing `ok` — and the penalty
// Google attaches to a Data safety label that contradicts the code is app
// REMOVAL, not a warning. A guard that says nothing about the app that is
// actually wrong is worse than no guard, because the green is read as coverage.
//
// The app set is DERIVED: every `apps/*` on the root pubspec.yaml `workspace:`
// list, plus the brick app template. A directory listing is refused for the
// reason assert-app-dod.mjs states — the brick lane stamps `apps/probe` and
// never removes it, so a listing differs between a maintainer's box and CI, and
// a domain that differs between the two is one nobody can reason about from
// either.
//
// 🔴 ONE FLOOR PER ROOT, NEVER A UNION FLOOR. Every root carries its own floor,
// every floor is a measurement of this tree dated beside it, and the floors are
// applied only over a full checkout — detected by this guard's own file, a
// sentinel outside every subject tree that therefore survives any mutation OF a
// subject. Which branch was taken PRINTS. And the derivation itself is floored,
// because A ROOT NEVER DERIVED IS NEVER EMPTY: the workspace block must be
// readable, it must name at least one apps/ member, and the brick directory must
// exist. A limb watching for an EMPTIED root cannot see an UNLISTED one.
//
// ── THE BRICK SHIPS PLAY DECLARATIONS, AND THEY ARE DELIBERATELY UNANSWERED ──
// MEASURED 2026-09-05 rather than assumed, because "add the brick as a root"
// creates an EMPTY root if it ships nothing, and an empty root reporting ok is
// this repository's most repeated failure. It ships two:
//   tooling/bricks/app/__brick__/apps/{{app_id}}/store/android-play/data-safety.json     3493 bytes
//   tooling/bricks/app/__brick__/apps/{{app_id}}/store/android-play/content-rating.json  2824 bytes
// So the root is not empty. But they are STAMPED UNANSWERED: no `vocabulary`,
// no `answers`, every question literally `null`, `sources.cited` an empty array,
// and an `unresolved` list saying why. Their own _readme gives the reason — a
// template cannot know what an app it was generated before does, and a
// confidently wrong sworn declaration is worse than an obviously incomplete one.
//
// Grading that file against the nine limbs below would fail on nearly every one
// of them, for a state that is CORRECT, and the only way to clear the build
// would be to invent answers in the template — the exact defect the template
// was written to prevent, multiplied by every app the factory will ever stamp.
// The claim is also already guarded: tooling/ci/assert-sworn-store-files.mjs
// derives the sworn set from the same channel-register contract and its inverse
// limb FAILS if the template stops being blank. Measured on this tree
// 2026-09-05, that guard prints `4 brick template(s) still blank`. A second copy
// of the rule here would be a rival scanner, not coverage.
//
// So the brick is a root with a DIFFERENT CONTRACT — the same split
// assert-store-metadata.mjs already makes between the hand-made apps/subly/store
// and THE FACTORY. What this file asserts over it:
//   · ITS DECLARATIONS EXIST AND PARSE. Absence is COVERAGE LOST, so the root
//     cannot go quietly missing — the failure mode every root added "for
//     completeness" eventually has.
//   · THEY ARE STILL UNANSWERED. Grow an `answers` array, a `vocabulary` or a
//     `claims` list, or lose the `unresolved` list, and this guard says so
//     rather than starting to grade a template as an app.
//   · THE FACTORY DEPENDENCY SWEEP, WHICH IS NEW AND IS THE TEETH. Every Dart
//     package any answered declaration names as a tell is looked for in the
//     TEMPLATE's own pubspec. `geolocator` added to apps/subly makes one label
//     false and limb 5 catches it; `geolocator` added to the template makes
//     every future stamped app collect location while the declaration stamped
//     beside it answers `null` for that type — and nothing in this repository
//     looked at that until today. Measured 2026-09-05: 50 watched packages,
//     15 direct dependencies in the template, zero overlap. The needle list is
//     DERIVED from the declarations, so a tell removed there stops being swept
//     here in the same edit.
//   · WHAT IT CANNOT SWEEP, PRINTED ON EVERY RUN. The template carries no
//     android/, ios/ or macos/ tree — `flutter create` writes those after the
//     stamp — so the watched Android permissions have no haystack there. The
//     manifest walk is over whatever exists rather than a fixed path, so the
//     limb starts working by itself the day the template gains a native tree,
//     and the count found (0 today) is printed rather than implied.
//
// ── MEASURED BY MUTATION, 2026-09-05, GREEN CONTROL FIRST ───────────────────
// Every mutation was applied to the REAL tree in an isolated worktree, the exit
// code captured on ITS OWN LINE (`$?` after a pipe is the last stage's status,
// which has produced a fake EXIT 0 in this repository before), and the tree
// restored and `git status --porcelain` confirmed empty at the end. The controls
// are the rows that make the rest mean anything: without a green baseline an
// exit 1 later is indistinguishable from the guard dying on load.
//
// 🔴 THE `pre` COLUMN IS NOT A SIMULATION. Every mutation was run twice — once
// against the guard as it stood on main, once against this one. Ten of the
// thirteen were INVISIBLE to the version this replaces, and they are the ten
// about the derived domain and the template. That is the size of the hole, in
// exit codes rather than in prose.
//
//   #    mutation                                                     pre  post
//   ───  ──────────────────────────────────────────────────────────   ───  ────
//   G0   CONTROL — unmutated tree                                       0    0
//   M1   root pubspec: apps/subly dropped from the `workspace:` list    0    1
//   M2   root pubspec: the `workspace:` block renamed away              0    1
//   M3   the brick app template directory renamed                      0    1
//   M4   brick store/android-play/data-safety.json deleted             0    1
//   M5   brick pubspec.yaml deleted — the sweep's haystack             0    1
//   M6   brick pubspec: `geolocator` added                             0    1
//   M7   brick pubspec: `google_mobile_ads` added                      0    1
//   M8   a template AndroidManifest declaring ACCESS_FINE_LOCATION     0    1
//   M9   brick data-safety.json grew an `answers` array                0    1
//   M10  brick content-rating.json `unresolved` list emptied           0    1
//   M11  apps/subly pubspec: `geolocator` added (the app-side limb)    1    1
//   M12  apps/subly data-safety.json deleted                          1    1
//   M13  apps/subly `answers` cut from 38 to 15 — the per-root floor   1    1
//
// M11-M13 are the rows that prove the widening did not COST anything: the
// limbs that already bit still bite, now through a loop. And the pass line is
// unchanged in every count it reported before — 38/38 types, 118 tells, 30
// client-absence tells, 3 manifests, 21 dependencies, 29 evidence paths, 11
// citations, 4 merged rows, 13 inventory rows, 187 Dart files, 9 claims — which
// is what says the refactor moved the code and not the measurements.
//
// ⚠️ THE HARNESS DESTROYED THIS FILE ONCE, AND IT IS WORTH THE LINE. Its
// restore step was `git checkout -- .` in the worktree that held the
// uncommitted change, so run 1 measured MAIN'S guard for every row and reported
// ten NOT CAUGHT that were really "the mutation was never run against this
// code". A no-op or misplaced mutation is a broken test, not a weak guard —
// the same lesson the test file's header already records from a `.replace` that
// hit the wrong workflow step — and the difference is invisible unless you go
// and look. The run was redone against a committed baseline. It also, by
// accident, produced the honest `pre` column above.
//
// Usage:  node tooling/ci/assert-play-declarations.mjs [repoRoot]
// Exit 0 = EVERY app's declarations still describe its own tree, and the
//          template has not started collecting on all of their behalf.
//      1 = they do not, or a root stopped delivering a subject to check.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripInert, stripSourceComments } from './text-reductions.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const INVENTORY_REL = 'tooling/legal/data-inventory.json';
const CHANNEL = 'android-play';

const problems = [];
const prints = [];

const abs = (rel) => join(ROOT, ...rel.split('/'));
const exists = (rel) => existsSync(abs(rel));
const read = (rel) => (exists(rel) ? readFileSync(abs(rel), 'utf8') : null);
const isDir = (rel) => exists(rel) && statSync(abs(rel)).isDirectory();

/** Every file under `relDir`, skipping generated output and package caches.
 *
 *  🔴 MODULE-LEVEL, NOT PER APP. It walks the app trees for manifests and
 *  plists AND the brick template for the factory sweep. A second copy inside
 *  the per-app function would be a second set of skip rules to get subtly wrong
 *  while both kept reporting green — which is the argument parseLockVersions()
 *  below already makes for itself. */
function walk(relDir, out = []) {
  if (!isDir(relDir)) return out;
  for (const e of listDir(abs(relDir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name === '.dart_tool') continue;
    const child = `${relDir}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

/** Which root is being checked, so a COVERAGE LOST names it.
 *
 *  🔴 THIS EXISTS BECAUSE THE GUARD NOW LOOPS. Before, every message was about
 *  the one hard-coded app and the reader could not be sent to the wrong tree.
 *  A message reading "no AndroidManifest.xml was found" over a two-app tree,
 *  with no app named, is a diagnosis that costs more than it gives. */
let CURRENT_ROOT = null;

/** Structural failure: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — this repository's single most
 *  repeated defect, reproduced inside the guard meant to prevent it. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST${CURRENT_ROOT ? ` [${CURRENT_ROOT}]` : ''} — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-play-declarations: FAILED');
  process.exit(1);
}

/** The RESOLVED package versions out of a pubspec.lock.
 *
 *  Structure, not a grep: `version:` appears under every one of ~200 packages,
 *  so the walk is anchored on the package heading and stops at the next one.
 *
 *  Shared because TWO limbs pin against the lock — limb 7a, which ties the
 *  MERGED-MANIFEST measurement to the plugin versions whose own manifests were
 *  read to attribute it, and limb 7b, which ties the device-identifier answer to
 *  the crash-SDK version whose source was read. A second copy of this parse would
 *  be a second thing to get subtly wrong while both kept reporting green.
 *
 *  ⚠️ THIS COMMENT DESCRIBED CODE THAT DID NOT EXIST FOR THE LENGTH OF ONE
 *  UNIT OF WORK. The extraction landed first, naming limb 7a in the present
 *  tense, and limb 7a was not written until the follow-up — the same defect the
 *  block it serves had (a sentence attached to a measurement where only the
 *  measurement was checked), reproduced in the refactor meant to support it.
 *  Both limbs exist now, and both are exercised by
 *  tooling/ci/test/play-declarations.test.mjs.
 *
 *  Returns an empty Map if the format moves; both callers treat that as
 *  COVERAGE LOST rather than as "no pins drifted". */
function parseLockVersions(lockText) {
  const lockVersions = new Map();
  let current = null;
  for (const line of lockText.split('\n')) {
    const head = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*$/);
    if (head) {
      current = head[1];
      continue;
    }
    if (current === null) continue;
    if (/^ {0,2}\S/.test(line)) current = null;
    const v = line.match(/^ {4}version:\s*"?([^"\s]+)"?\s*$/);
    if (v && current !== null) {
      lockVersions.set(current, v[1]);
      current = null;
    }
  }
  return lockVersions;
}

function parseJson(rel, whyItMatters) {
  const text = read(rel);
  if (text === null) coverageLost([`${rel} does not exist.`, ...whyItMatters]);
  try {
    return JSON.parse(text);
  } catch (e) {
    coverageLost([`${rel} is not valid JSON — ${e.message}`, ...whyItMatters]);
  }
  return null;
}

// ── the register tells us where the tree is, and whether it is being enforced ─
const register = parseJson(REGISTER_REL, [
  'It declares the store channels and the per-channel file contract. Without it this guard cannot',
  'locate the metadata tree and every check below ranges over nothing.',
]);
const row = (Array.isArray(register.channels) ? register.channels : []).find((c) => c && c.id === CHANNEL);
if (!row || typeof row.storeMetadataDir !== 'string') {
  coverageLost([
    `${REGISTER_REL} declares no \`${CHANNEL}\` channel with a \`storeMetadataDir\`.`,
    'The declarations live inside that tree. With no row there is no tree to check.',
  ]);
}


// 🔴 SELF-CHECK ON THE ENFORCEMENT PATH, NOT JUST ON THE FILES. Existence and
// non-emptiness of these two files is assert-store-metadata.mjs's job, via the
// contract's `additionalFiles`. If they are NOT listed there, deleting one would
// leave that guard silent and this one would simply COVERAGE LOST with a message
// pointing at the wrong file. Two guards, one relationship, declared once.
const additional = register.storeMetadataContract?.perChannel?.[CHANNEL]?.additionalFiles ?? [];
for (const f of ['data-safety.json', 'content-rating.json']) {
  if (!additional.includes(f)) {
    coverageLost([
      `${REGISTER_REL} storeMetadataContract.perChannel["${CHANNEL}"].additionalFiles does not list "${f}".`,
      'That list is what makes assert-store-metadata.mjs (and tooling/release/submit-play.mjs) require the',
      'file to be present and non-empty. Off it, the declaration can be deleted or emptied and the only',
      'guard that would notice is this one — which is exactly one guard too few for a sworn declaration.',
    ]);
  }
}

const inventory = parseJson(INVENTORY_REL, [
  'The personal-data inventory is the right-hand side of the mapping limb below. Absent, "every store',
  'holding personal data is mapped to a Play data type" ranges over an empty set and prints ok.',
]);


// ─────────────────────────────────────────────────────────────────────────────
// 0 · THE DOMAIN. Derived from the tree, never listed — and floored, because a
//     root that was never derived is a root that can never look empty.
// ─────────────────────────────────────────────────────────────────────────────
/** The template every future app is stamped from. A root of a DIFFERENT KIND —
 *  see the header: its declarations exist, they are deliberately UNANSWERED,
 *  and what this guard asserts over it is the factory dependency sweep. */
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

/** The floors. Every number is a measurement of THIS repository on 2026-09-05,
 *  recorded beside the thing it was measured on, and every one is applied PER
 *  ROOT. A single floor over the union of the roots is not a floor: with
 *  `apps/subly` contributing 38 answers and 118 tells, a combined floor of any
 *  size this tree satisfies would still be satisfied by apps/subly alone after
 *  a second app had lost its declaration entirely. That is not hypothetical —
 *  assert-workspace-coverage.mjs:130-136 records a union floor staying green
 *  over an emptied `apps/`, and assert-no-tls-pinning.mjs:75-93 records the
 *  same failure with the measurement that proved it. */
const REQUIRED_COVERAGE = {
  app: {
    // apps/subly, measured 2026-09-05: 38 answers, 118 tells, 3 manifests,
    // 21 direct dependencies. The floors sit well under every one of those so
    // ordinary editing never trips them, and well over a stub so a declaration
    // collapsing to three rows is COVERAGE LOST rather than a quiet `ok`.
    answers: 20,
    tells: 40,
    manifests: 1,
    directDeps: 5,
    label: 'an app whose .aab can reach Play — the Data safety label Google holds the developer to',
  },
  brick: {
    // The template, measured 2026-09-05: 15 direct dependencies, and 50 Dart
    // packages watched by the answered declarations. Both floors are on the
    // INSTRUMENT: the sweep is an ABSENCE claim, and an absence over an empty
    // haystack or an empty needle-list is true of every tree including one
    // where the parse just broke.
    directDeps: 5,
    watchedPackages: 10,
    label: 'the template every stamped app is born from — one dependency here reaches all fifty at once',
  },
};

/**
 * The floors above are measurements of THIS repository and mean nothing over a
 * synthetic root: the unit tests below model one app with three data types in
 * it. So they are applied only when ROOT is a full checkout, detected by this
 * guard's OWN file being present under it — a sentinel that sits outside every
 * subject tree (`apps/*` and the brick) and therefore survives any mutation OF
 * a subject, which a sentinel inside one of them would not. Which branch was
 * taken is PRINTED on every run rather than implied.
 */
const IS_FULL_CHECKOUT = exists('tooling/ci/assert-play-declarations.mjs');

/** Every `apps/*` on the root pubspec `workspace:` list. A directory listing is
 *  refused for the reason assert-app-dod.mjs states: the brick lane stamps
 *  `apps/probe` and never removes it, so a listing differs between a
 *  maintainer's box and CI — and a domain that differs between the two is a
 *  domain nobody can reason about from either. */
const apps = [];
let workspaceRead = false;
{
  const text = read('pubspec.yaml');
  if (text === null) {
    coverageLost([
      'the root pubspec.yaml does not exist.',
      'It is where the set of apps comes from. With none, every limb in this file ranges over nothing —',
      'and this guard spent its whole life ranging over ONE app named in a string literal, which is the',
      'defect being repaired here. Silently ranging over zero would be strictly worse.',
    ]);
  }
  const lines = text.replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m && m[1].startsWith('apps/')) apps.push(m[1].replace(/^apps\//, ''));
    }
  }
}
if (!workspaceRead) {
  coverageLost([
    'the root pubspec.yaml has no readable `workspace:` block.',
    'That block IS the app set. Unreadable, this guard would check no Data safety declaration at all while',
    'every limb below reported the absence of a problem it had no subject for.',
  ]);
}
if (apps.length === 0) {
  coverageLost([
    'the root pubspec.yaml `workspace:` block names no apps/ member.',
    'A guard over zero apps prints ok. Google attaches app REMOVAL to an inaccurate Data safety label, so',
    'the one outcome this file must never produce is a green run over nothing.',
  ]);
}
// 🔴 THE BRICK ROOT'S ABSENCE FAILS. It is added as a root because it really
// carries Play declarations (measured — see the header), and a root that can go
// missing without a word is the failure every "added for completeness" root has.
if (!isDir(BRICK)) {
  coverageLost([
    `${BRICK} is not a directory under ${ROOT} — ${REQUIRED_COVERAGE.brick.label}.`,
    'The factory dependency sweep below is the only limb in this repository that asks whether a',
    'data-collection package has entered the TEMPLATE. Off the walk, adding `geolocator` there would make',
    'every future stamped app collect location with nothing anywhere saying so — and this guard would',
    'still print the same `ok` it prints today. If the template genuinely moved, move this constant with',
    'it in the same change.',
  ]);
}

/**
 * ONE ANSWERED APP ROOT: its Data safety declaration, its content-rating
 * questionnaire, and the tree they are both compared to.
 *
 * 🔴 `cleanSoFar()` REPLACED `problems.length === 0`, AND THE DIFFERENCE IS THE
 * WHOLE POINT OF A LOOP. Every "NOT ONE x was checked" limb below is suppressed
 * when there are already real failures to report, so the reader is not sent to
 * chase an empty domain that is empty because an earlier limb rejected the file.
 * Against a MODULE-level `problems.length`, app #2's coverage-loss checks would
 * be silenced by app #1's ordinary failures — a limb going quiet for a reason
 * that has nothing to do with its own subject, which is this repository's
 * signature defect wearing the fix for it as a disguise. The baseline is taken
 * per app.
 */
function checkApp(app) {
  const problemsAtEntry = problems.length;
  const cleanSoFar = () => problems.length === problemsAtEntry;
  /** Shadows the module-level array on purpose: a print is about ONE app and a
   *  shared list would print thirty lines with no way to tell whose they are. */
  const prints = [];

  const DIR = row.storeMetadataDir.replace('{app}', app);
  const DS_REL = posix.join(DIR, 'data-safety.json');
  const CR_REL = posix.join(DIR, 'content-rating.json');

  const ds = parseJson(DS_REL, [
    'This IS the Data safety declaration. Absent, there is nothing to compare to the code and the answers',
    'typed into the Play Console are whatever somebody remembered on the day.',
  ]);
  const cr = parseJson(CR_REL, [
    'This IS the content rating questionnaire record. Absent, the answers submitted to IARC exist nowhere',
    'that can be reviewed or re-derived.',
  ]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1 · CITATIONS. Every external requirement carries a URL, a fetch date and a
  //     quote, and the host must be one that WROTE or ENFORCES the rule.
  // ─────────────────────────────────────────────────────────────────────────────
  let citationsChecked = 0;
  function checkCitations(doc, docRel) {
    const sources = doc.sources;
    if (!sources || typeof sources !== 'object') {
      problems.push(
        `${docRel} carries no \`sources\` block. Every external requirement this declaration rests on needs a URL and a fetch date; without them a rule cannot be re-verified later, and an unverifiable compliance rule is one nobody can tell has changed.`,
      );
      return;
    }
    const allowed = Array.isArray(sources.allowedHosts) ? sources.allowedHosts : [];
    if (allowed.length === 0) {
      problems.push(`${docRel} sources.allowedHosts is missing or empty, so every citation below would be accepted from any host at all.`);
      return;
    }
    for (const [key, cite] of Object.entries(sources)) {
      if (key === 'allowedHosts' || key.startsWith('_')) continue;
      if (!cite || typeof cite !== 'object') {
        problems.push(`${docRel} sources.${key} is not a citation object.`);
        continue;
      }
      for (const field of ['url', 'fetched', 'quote']) {
        if (typeof cite[field] !== 'string' || cite[field].trim() === '') {
          problems.push(
            `${docRel} sources.${key} has no \`${field}\`. A cited rule needs all three — the page, the day it said this, and what it said. Two of the three is a claim nobody can re-check.`,
          );
        }
      }
      if (typeof cite.url !== 'string') continue;
      let host;
      try {
        host = new URL(cite.url).host;
      } catch {
        problems.push(`${docRel} sources.${key}.url is not a URL: ${JSON.stringify(cite.url)}`);
        continue;
      }
      if (!allowed.includes(host)) {
        problems.push(
          `${docRel} sources.${key} cites ${host}, which is not in sources.allowedHosts. The test a host passes is that it is the body that WROTE the rule or the platform that ENFORCES it — a summary, a client alert or a checklist site cannot be re-verified, and a compliance corpus is worth exactly its ability to be re-checked.`,
        );
        continue;
      }
      if (typeof cite.fetched === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(cite.fetched)) {
        problems.push(`${docRel} sources.${key}.fetched is not an ISO date (YYYY-MM-DD): ${JSON.stringify(cite.fetched)}`);
        continue;
      }
      citationsChecked++;
    }
  }
  checkCitations(ds, DS_REL);
  checkCitations(cr, CR_REL);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2 · VOCABULARY TOTALITY. Play's type list, as STRUCTURE, in bijection with the
  //     answer rows. A forgotten question and an invented Play type both fail.
  // ─────────────────────────────────────────────────────────────────────────────
  const vocab = ds.vocabulary?.categories;
  if (!vocab || typeof vocab !== 'object' || Object.keys(vocab).length === 0) {
    coverageLost([
      `${DS_REL} declares no \`vocabulary.categories\`.`,
      'That map is the domain of the totality check: with it empty, "every Play data type has an answer"',
      'is vacuously true and a declaration with ZERO answers would pass.',
    ]);
  }
  const vocabTypes = new Map(); // "Category|Type" -> {category,type}
  for (const [category, types] of Object.entries(vocab)) {
    if (category.startsWith('_')) continue;
    if (!Array.isArray(types) || types.length === 0) {
      problems.push(`${DS_REL} vocabulary.categories["${category}"] declares no types, so that whole category contributes no question.`);
      continue;
    }
    for (const t of types) vocabTypes.set(`${category}|${t}`, { category, type: t });
  }
  if (vocabTypes.size === 0) {
    coverageLost([`${DS_REL} vocabulary.categories yielded ZERO data types.`, 'The totality check below has no domain.']);
  }

  const answers = Array.isArray(ds.answers) ? ds.answers : [];
  if (answers.length === 0) {
    coverageLost([`${DS_REL} declares no \`answers\`.`, 'Every limb below iterates them; with none, all of them pass by measuring nothing.']);
  }
  const answerByKey = new Map();
  for (const a of answers) {
    const key = `${a.category}|${a.type}`;
    if (answerByKey.has(key)) {
      problems.push(`${DS_REL} declares TWO answers for ${key}. One data type, one answer — Play's form has one row per type and two rows here means one of them is not the submitted one.`);
      continue;
    }
    answerByKey.set(key, a);
    if (!vocabTypes.has(key)) {
      problems.push(
        `${DS_REL} answers ${JSON.stringify(key)}, which is not a type in \`vocabulary.categories\`. Either the type name was typed from memory and does not exist on the form, or the vocabulary was re-fetched and this row was left behind describing a question Play no longer asks.`,
      );
    }
  }
  for (const [key] of vocabTypes) {
    if (!answerByKey.has(key)) {
      problems.push(
        `${DS_REL} has NO answer for ${JSON.stringify(key)}. Play asks about every type in the form; a type with no row here is a question that gets answered in the console from memory, by whoever is filling it in, with nothing recording what they said.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3 · THE POSTURE. Which artefact does Play actually receive?
  // ─────────────────────────────────────────────────────────────────────────────
  const bp = ds.buildPosture ?? {};
  const POSTURES = Object.keys(bp.postures ?? {});
  if (POSTURES.length === 0) {
    coverageLost([
      `${DS_REL} buildPosture.postures is missing or empty.`,
      'Every answer is keyed by posture. With no postures declared, the per-answer shape check below has no',
      'keys to require and an answer object of `{}` would satisfy it.',
    ]);
  }
  if (!POSTURES.includes(bp.current)) {
    problems.push(
      `${DS_REL} buildPosture.current is ${JSON.stringify(bp.current)}, which is not one of the declared postures (${POSTURES.join(', ')}). The "which column do I type into the console" question has no answer.`,
    );
  }

  let laneDefines = null;
  if (typeof bp.lane === 'string' && typeof bp.buildCommandContains === 'string') {
    const wf = parseWorkflow(ROOT, bp.lane);
    if (wf === null) {
      coverageLost([
        `${DS_REL} buildPosture.lane names ${bp.lane}, which does not exist.`,
        'That workflow is the only place the shipped artefact\'s dart-defines are declared. Unreadable, the',
        'posture limb — the one that catches the whole declaration silently becoming false — checks nothing.',
      ]);
    }
    const hits = [];
    for (const job of wf.jobs.values()) {
      for (const l of job.logical) {
        if (l.text.includes(bp.buildCommandContains)) hits.push(l);
      }
    }
    if (hits.length === 0) {
      coverageLost([
        `no step in ${bp.lane} contains ${JSON.stringify(bp.buildCommandContains)}.`,
        'The Play artefact build step could not be found, so the dart-define comparison below ranged over',
        'nothing and would have reported the declared posture correct whatever the workflow says. Either the',
        'lane stopped building an .aab, or the command was rewritten and buildPosture.buildCommandContains',
        'was not — and the second is silent under-coverage, which is the failure this repository keeps hitting.',
      ]);
    }
    laneDefines = new Set();
    for (const l of hits) {
      for (const m of l.text.matchAll(/--dart-define(?:-from-file)?[= ]([A-Za-z_][A-Za-z0-9_]*)/g)) laneDefines.add(m[1]);
    }

    const expected = new Set(Array.isArray(bp.expectedDefines) ? bp.expectedDefines : []);
    const extra = [...laneDefines].filter((d) => !expected.has(d)).sort();
    const missing = [...expected].filter((d) => !laneDefines.has(d)).sort();
    const identity = new Set(Array.isArray(bp.identityDefines) ? bp.identityDefines : []);

    for (const d of extra) {
      const isIdentity = identity.has(d);
      problems.push(
        isIdentity
          ? `🔴 ${bp.lane} now passes --dart-define=${d} to the Play artefact, and ${DS_REL} declares posture "${bp.current}". ${d} is one of buildPosture.identityDefines, so this build is NO LONGER the one the declaration describes: AppConfig.isBackendLive is a compile-time constant over exactly these defines, and flipping it turns on the account, the server sync and the analytics rail. Every answer's "${bp.current}" column now understates what the shipped bundle collects. Re-declare the posture before this artefact reaches a store.`
          : `${bp.lane} passes --dart-define=${d} to the Play artefact and ${DS_REL} buildPosture.expectedDefines does not list it. A define is a compile-time switch over app behaviour; an undeclared one is behaviour this declaration has not been checked against.`,
      );
    }
    for (const d of missing) {
      problems.push(
        `${DS_REL} buildPosture.expectedDefines lists ${d} and ${bp.lane} does not pass it to the Play artefact. If it was removed, the answers derived from it are now wrong in the other direction — e.g. dropping GLITCHTIP_DSN makes TelemetryConfig.enabled false and the crash-log answers OVERSTATE what ships. An overstated declaration is still an inaccurate one.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4 · THE DERIVED TREE FACTS. Permissions, direct dependencies, iOS usage keys.
  //     Parsed, never grepped: an XML comment naming a permission is not a
  //     permission, and this repository has already shipped a guard that matched
  //     the comment explaining why a binding did NOT exist.
  // ─────────────────────────────────────────────────────────────────────────────
  const APP_DIR = `apps/${app}`;

  // (a) Android permissions, per manifest. `walk()` is module-level — see there.
  const manifestFiles = walk(`${APP_DIR}/android`).filter((f) => f.endsWith('/AndroidManifest.xml')).sort();
  if (manifestFiles.length === 0) {
    coverageLost([
      `no AndroidManifest.xml was found under ${APP_DIR}/android.`,
      'The permission walk is the loudest single tell that a data type has started being collected. Reaching',
      'zero manifests makes every "this permission is absent" claim vacuously true while printing ok.',
    ]);
  }
  const permsByFile = new Map();
  const allPerms = new Set();
  for (const f of manifestFiles) {
    // XML comments out FIRST. The debug manifest's own comment explains why
    // INTERNET is there; a raw scan of the release manifest would be reading prose.
    const xml = stripInert(read(f) ?? '');
    const found = [...xml.matchAll(/<uses-permission[^>]*android:name\s*=\s*"([^"]+)"/g)].map((m) => m[1]).sort();
    permsByFile.set(f, found);
    for (const p of found) allPerms.add(p);
  }

  // (b) DIRECT dependencies of the app, from its pubspec. `#` comments blanked, so
  //     a commented-out dependency is not read as one.
  const pubspecRel = `${APP_DIR}/pubspec.yaml`;
  const pubspecText = read(pubspecRel);
  if (pubspecText === null) {
    coverageLost([`${pubspecRel} does not exist.`, 'The dependency-equality limb — the mitigation for not being able to read the merged manifest — has no subject.']);
  }
  const pubspecLines = stripSourceComments(pubspecText, '.yaml').split('\n');
  const directDeps = new Set();
  {
    const at = pubspecLines.findIndex((l) => /^dependencies:\s*$/.test(l));
    if (at === -1) {
      coverageLost([
        `${pubspecRel} has no top-level \`dependencies:\` block that this parse can find.`,
        'The direct-dependency set would be empty, so a newly added SDK would produce no "undeclared',
        'dependency" failure and the equality would instead complain about every declared entry — reporting',
        'the wrong fault, which is the diagnosis failure this repository keeps recording.',
      ]);
    }
    for (let i = at + 1; i < pubspecLines.length; i++) {
      if (/^\S/.test(pubspecLines[i])) break;
      const m = pubspecLines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
      if (m) directDeps.add(m[1]);
    }
  }
  if (directDeps.size === 0) {
    coverageLost([`${pubspecRel} \`dependencies:\` parsed to ZERO entries.`, 'See above: an empty set makes the equality check report the opposite of the truth.']);
  }

  // (c) iOS/macOS usage-description keys — the Apple-side equivalent of a
  //     permission, and a second independent tell for the same capabilities.
  const plistFiles = [...walk(`${APP_DIR}/ios`), ...walk(`${APP_DIR}/macos`)].filter((f) => f.endsWith('Info.plist')).sort();
  const usageKeys = new Set();
  const plistKeysRead = new Map();
  for (const f of plistFiles) {
    const plist = stripInert(read(f) ?? '');
    plistKeysRead.set(f, (plist.match(/<key>/g) ?? []).length);
    for (const m of plist.matchAll(/<key>\s*(NS[A-Za-z]+UsageDescription)\s*<\/key>/g)) usageKeys.add(m[1]);
  }

  // 🔴 THE FLOOR ON THIS HAYSTACK, AND IT GOES ON THE INSTRUMENT, NOT THE RESULT.
  //
  // This is the ONE tell-haystack that is legitimately EMPTY: usageKeys.size is 0
  // today and that is correct — no native Apple capability is used, iOS/macOS are
  // CI-only here, and nothing has shipped to either store. Meanwhile the
  // declaration carries 17 distinct iOS usage-description keys across 18 tell
  // entries (measured on apps/subly; this block runs PER APP now, and the count
  // it prints is that app's own), every one of which is therefore comparing
  // against an empty Set and can only ever answer "absent". The permission
  // haystack and the dependency haystack are both floored above; this one was
  // not, and it is the empty one.
  //
  // So a floor of `usageKeys.size > 0` would be WRONG — it would fail the build on
  // a true and acceptable state, every day, with no code change able to clear it,
  // which is how an alarm gets muted rather than fixed. The question that CAN go
  // wrong is not "how many keys did the files contain" but "were the files found
  // and read at all": if walk() narrows, or the plists move, or stripInert stops
  // yielding plist structure, those 18 tells stay constant-false FOREVER while the
  // summary keeps printing `0 iOS usage key(s)` — a line that reads identically in
  // the working case and the broken one. That is a false "never collected" on a
  // sworn store declaration, i.e. a takedown, not a red build.
  //
  // Hence: assert the instrument. Files located ⊇ REQUIRED_PLISTS, and each of
  // those still parses to at least one <key> element after the same reduction the
  // key scan uses. The zero itself is PRINTED, loudly, with the count of tells it
  // silences — the property the other empty domains in this repo have and this one
  // did not: it declares its own emptiness instead of hiding inside an ok line.
  const REQUIRED_PLISTS = [`${APP_DIR}/ios/Runner/Info.plist`, `${APP_DIR}/macos/Runner/Info.plist`];
  if (plistFiles.length === 0) {
    coverageLost([
      `the walk over ${APP_DIR}/ios and ${APP_DIR}/macos found NO Info.plist at all.`,
      'Every iOS-usage-key tell below compares against a set built only from those files. With no file read,',
      'the set is empty for a reason that has nothing to do with the app, and every one of those tells becomes',
      'permanently constant-false while the summary still prints "0 iOS usage key(s)" — the same words it',
      'prints when the instrument is working. An absence that is indistinguishable from a broken reading is',
      'not evidence of absence.',
    ]);
  }
  for (const req of REQUIRED_PLISTS) {
    if (!plistFiles.includes(req)) {
      coverageLost([
        `${req} is REQUIRED_COVERAGE for the iOS usage-key haystack and the walk did not reach it (it found: ${plistFiles.join(', ') || 'nothing'}).`,
        'A usage-description key can only ever be written into a Runner Info.plist, so this is the only file',
        'whose contents can ever make an iOS tell fire. Off the walked list, the tells are quantifying over a',
        'set that no longer has any way to become non-empty. If the file genuinely moved, move this entry with',
        'it in the same change; if it did not, walk() or the .endsWith filter just got narrower.',
      ]);
    }
    if ((plistKeysRead.get(req) ?? 0) === 0) {
      coverageLost([
        `${req} was found but yielded ZERO <key> elements after stripInert().`,
        'The key scan runs on exactly this reduced text, so a plist that reduces to nothing contributes nothing',
        'and looks exactly like a plist that declares no usage keys. Either the file stopped being a plist, or',
        'its body is now inside a comment, or the reduction started eating it — in all three cases the tells',
        'below are reading a blank page and reporting it as a clean bill of health.',
      ]);
    }
  }
  // The honest zero, said out loud rather than left to be inferred from an ok line.
  {
    const iosTellEntries = answers.reduce(
      (n, a) =>
        n +
        (a?.tells?.iosUsageDescriptionKeys?.length ?? 0) +
        (a?.clientAbsence?.iosUsageDescriptionKeys?.length ?? 0),
      0,
    );
    const totalKeysRead = [...plistKeysRead.values()].reduce((n, v) => n + v, 0);
    if (usageKeys.size === 0) {
      prints.push(
        `iOS USAGE-KEY HAYSTACK IS EMPTY, AND THAT IS CURRENTLY TRUE — ${plistFiles.length} Info.plist file(s) located ` +
          `(${plistFiles.join(', ')}), ${totalKeysRead} <key> element(s) read, and NOT ONE is an NS…UsageDescription. ` +
          `So all ${iosTellEntries} declared iOS-usage-key tell(s) are constant-false today: they cannot fail, and they ` +
          `are not evidence for any "not collected" answer — the Android permission and Dart package tells are. ` +
          `They become load-bearing the day a native Apple capability is used. The floor above is what keeps this a ` +
          `TRUE zero rather than a broken reading.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5 · PER-ANSWER SHAPE, and THE TELLS.
  // ─────────────────────────────────────────────────────────────────────────────
  const VALID_PURPOSES = new Set(Array.isArray(ds.vocabulary?.purposes) ? ds.vocabulary.purposes : []);
  const unresolvedById = new Map(
    (Array.isArray(ds.unresolved) ? ds.unresolved : []).filter((u) => u && typeof u.id === 'string').map((u) => [u.id, u]),
  );

  let answersChecked = 0;
  let tellsChecked = 0;
  let clientAbsenceChecked = 0;
  let evidenceChecked = 0;
  const unresolvedReferenced = new Set();
  const anyShared = [];
  const mappedInventoryRows = new Set();

  const tri = (v) => v === true || v === false || v === null;

  for (const a of answers) {
    const where = `${DS_REL} answer ${JSON.stringify(`${a.category}|${a.type}`)}`;

    for (const field of ['collected', 'shared']) {
      const block = a[field];
      if (!block || typeof block !== 'object') {
        problems.push(`${where} has no \`${field}\` object keyed by posture. The answer depends on which artefact ships; one value cannot express that.`);
        continue;
      }
      for (const p of POSTURES) {
        if (!Object.prototype.hasOwnProperty.call(block, p)) {
          problems.push(`${where} \`${field}\` has no entry for posture "${p}". A posture with no answer is a form field left blank for whichever build ships.`);
        } else if (!tri(block[p])) {
          problems.push(`${where} \`${field}.${p}\` is ${JSON.stringify(block[p])}; it must be true, false, or null for "not established yet".`);
        }
      }
    }
    if (!a.collected || typeof a.collected !== 'object') continue;
    answersChecked++;

    const collectedValues = POSTURES.map((p) => a.collected[p]);
    const sharedValues = POSTURES.map((p) => (a.shared ?? {})[p]);
    const everCollected = collectedValues.some((v) => v === true);
    const everNull = collectedValues.some((v) => v === null) || sharedValues.some((v) => v === null);
    const neverCollected = collectedValues.every((v) => v === false);

    if (sharedValues.some((v) => v === true)) anyShared.push(`${a.category}|${a.type}`);

    // `null` is a legitimate answer and it is EXACTLY as legitimate as the write-up
    // behind it. An unattached null is "we did not think about it" wearing the
    // costume of "we thought hard and could not tell".
    if (everNull) {
      if (typeof a.unresolved !== 'string' || !unresolvedById.has(a.unresolved)) {
        problems.push(
          `${where} answers \`null\` for at least one posture and names no entry in the declaration's own \`unresolved\` list. A null with nothing recording the question, who owns it and how it would be settled is an unanswered form field with no plan to answer it — and it will be filled in from memory by whoever opens the console.`,
        );
      } else {
        unresolvedReferenced.add(a.unresolved);
      }
    }

    if (everCollected) {
      if (!Array.isArray(a.purposes) || a.purposes.length === 0) {
        problems.push(`${where} is collected and declares no \`purposes\`. Play requires at least one purpose per collected type.`);
      } else {
        for (const p of a.purposes) {
          if (VALID_PURPOSES.size > 0 && !VALID_PURPOSES.has(p)) {
            problems.push(`${where} declares purpose ${JSON.stringify(p)}, which is not one of the purposes Play offers (vocabulary.purposes).`);
          }
        }
      }
      if (typeof a.required !== 'boolean') {
        problems.push(
          `${where} is collected and \`required\` is ${JSON.stringify(a.required)}. Play asks required-or-optional for every collected type, and "optional" is a claim that the app works without it — it needs a deliberate answer, not an absent one.`,
        );
      }
      if (!Array.isArray(a.evidence) || a.evidence.length === 0) {
        problems.push(`${where} is collected and names no \`evidence\`. A declared collection nobody can point at the code for cannot be reviewed when it changes.`);
      }
    } else if (neverCollected && a.required !== null && a.required !== undefined) {
      problems.push(`${where} is not collected in any posture and still declares \`required: ${JSON.stringify(a.required)}\`. Required-or-optional is only asked about collected types; a value here is an answer to a question Play does not ask.`);
    }

    for (const rel of Array.isArray(a.evidence) ? a.evidence : []) {
      if (!exists(rel)) {
        problems.push(`${where} names evidence ${rel}, which does not exist. The row is pointing at a file that moved or was deleted, so nothing connects the declared answer to the code behind it.`);
      } else evidenceChecked++;
    }
    for (const id of Array.isArray(a.inventoryRows) ? a.inventoryRows : []) mappedInventoryRows.add(id);

    if (typeof a.basis !== 'string' || a.basis.trim() === '') {
      problems.push(`${where} records no \`basis\`. An answer with no stated reasoning cannot be re-checked by the next person, who will re-derive it from scratch or, more likely, trust it.`);
    }

    // ── CLIENT-SIDE ABSENCE, ASSERTED WHATEVER THE ANSWER IS ─────────────────
    // 🔴 THE GAP THIS CLOSES IS THIS REPOSITORY'S SIGNATURE DEFECT: A CHECK THAT
    // STOPPED CHECKING. `tells` below are evaluated ONLY for a row claiming
    // "never collected in any posture". The moment a row answers `true` — or
    // `null` — for one posture, its whole tell list goes silent while still
    // sitting in the file looking like coverage. When this limb was written that
    // was true of 24 tells across four rows, including EVERY location tell,
    // because a `null` is not a `false`.
    //
    // `clientAbsence` is the half of the claim that SURVIVES collection: "this
    // type is collected, but the device still contributes nothing to it". For
    // Approximate location that is the entire answer — the geo is inferred at the
    // Cloudflare edge, and if `geolocator` ever appeared the row would become
    // device location, with different purposes and a different `required`.
    const ca = a.clientAbsence;
    if (ca !== undefined) {
      if (!ca || typeof ca !== 'object' || Array.isArray(ca)) {
        problems.push(`${where} has a \`clientAbsence\` that is not an object.`);
      } else {
        const caPerms = ca.androidPermissions ?? [];
        const caPkgs = ca.dartPackages ?? [];
        const caKeys = ca.iosUsageDescriptionKeys ?? [];
        if (caPerms.length + caPkgs.length + caKeys.length === 0) {
          coverageLost([
            `${where} declares \`clientAbsence\` with ZERO tells in it.`,
            'This block exists to keep asserting "the device contributes nothing" at exactly the point where the',
            'ordinary tells limb goes quiet. Empty, it asserts nothing while looking precisely like the thing that',
            'does — and an assertion that cannot fail is worse than none, because it inflates apparent coverage.',
            'Give it tells, or delete the block and stop implying the claim is checked.',
          ]);
        }
        if (typeof ca.claim !== 'string' || ca.claim.trim() === '') {
          problems.push(
            `${where} declares \`clientAbsence\` with no \`claim\`. The tells only mean something against a stated sentence — what exactly becomes false if one of them appears — and without it the next person cannot tell whether a hit means "change the answer" or "remove the dependency".`,
          );
        }
        const broke = `The device can now supply this type DIRECTLY, so this row's purposes, its \`required\` answer, its \`shared\` answer and its basis are all describing an app that no longer exists.`;
        for (const perm of caPerms) {
          clientAbsenceChecked++;
          if (allPerms.has(perm)) {
            problems.push(
              `🔴 ${where} declares clientAbsence and ${perm} is now declared in ${[...permsByFile].filter(([, v]) => v.includes(perm)).map(([f]) => f).join(', ')}. ${broke} The claim it breaks: ${ca.claim ?? '(none stated)'}`,
            );
          }
        }
        for (const pkg of caPkgs) {
          clientAbsenceChecked++;
          if (directDeps.has(pkg)) {
            problems.push(
              `🔴 ${where} declares clientAbsence and \`${pkg}\` is now a direct dependency in ${pubspecRel}. ${broke} The claim it breaks: ${ca.claim ?? '(none stated)'}`,
            );
          }
        }
        for (const key of caKeys) {
          clientAbsenceChecked++;
          if (usageKeys.has(key)) {
            problems.push(
              `🔴 ${where} declares clientAbsence and ${key} now appears in an Info.plist. Apple requires that key only when the capability is actually used, so its presence is a positive statement that the device does the thing this claim denies. ${broke}`,
            );
          }
        }
      }
    }

    // ── THE TELLS ────────────────────────────────────────────────────────────
    // Only meaningful for a claim of ABSENCE. A tell present while the widest
    // claim says "never collected" is the declaration having become false.
    const tells = a.tells ?? {};
    const hasTells =
      (tells.androidPermissions?.length ?? 0) + (tells.dartPackages?.length ?? 0) + (tells.iosUsageDescriptionKeys?.length ?? 0) > 0;

    // 🔬 DEAD TELLS. The general half of the rule above, needing no list: a
    // `tells` block on a row that is collected (or unresolved) in ANY posture can
    // never be reached by the loop below, so it is an assertion that cannot fire.
    // The repository's own rule is that such a thing is worse than none — it is
    // read as coverage by everyone who greps the file. Re-point it at
    // `clientAbsence`, which is evaluated unconditionally, or delete it.
    if (!neverCollected && hasTells) {
      problems.push(
        `${where} carries a \`tells\` block and is not "never collected" in every posture (collected: ${JSON.stringify(a.collected)}). The tells limb only evaluates never-collected rows, so every tell in that block is UNREACHABLE — it looks like coverage and can never fire. Move it to \`clientAbsence\` if the claim survives the row being collected (it usually does: "collected, but never from the device"), or delete it.`,
      );
    }

    if (neverCollected && !hasTells && a.derivationNote === undefined) {
      // Not a failure: several types genuinely have no mechanical tell (Race and
      // ethnicity is a form field, not a permission). What WOULD be dishonest is
      // pretending otherwise, so it prints instead — a tell-less absence claim is
      // a human's word, and the count is printed so nobody reads the pass line as
      // "every absence was verified".
      prints.push(`NO MECHANICAL TELL — ${a.category} > ${a.type} is declared never collected and nothing in the tree could contradict it. Human-owned by construction.`);
    }
    if (!neverCollected) continue;

    for (const perm of tells.androidPermissions ?? []) {
      tellsChecked++;
      if (allPerms.has(perm)) {
        problems.push(
          `🔴 ${where} declares this type is NEVER collected, and ${perm} is now declared in ${[...permsByFile].filter(([, v]) => v.includes(perm)).map(([f]) => f).join(', ')}. The declaration has become FALSE. Either the permission is a mistake, or the Data safety answer must change before this build reaches Play — a label that contradicts the manifest is the exact case Google's User Data policy enforces on.`,
        );
      }
    }
    for (const pkg of tells.dartPackages ?? []) {
      tellsChecked++;
      if (directDeps.has(pkg)) {
        problems.push(
          `🔴 ${where} declares this type is NEVER collected, and \`${pkg}\` is now a direct dependency in ${pubspecRel}. That package exists to do the thing this answer says the app does not do. Update the answer, or remove the dependency.`,
        );
      }
    }
    for (const key of tells.iosUsageDescriptionKeys ?? []) {
      tellsChecked++;
      if (usageKeys.has(key)) {
        problems.push(
          `🔴 ${where} declares this type is NEVER collected, and ${key} now appears in an Info.plist. Apple requires that key only when the capability is actually used, so its presence is a positive statement that the app does the thing this answer denies.`,
        );
      }
    }
  }

  if (answersChecked === 0 && cleanSoFar()) {
    coverageLost(['NOT ONE answer was shape-checked.', 'Every per-answer limb above ran over an empty set.']);
  }
  if (tellsChecked === 0 && cleanSoFar()) {
    coverageLost([
      'NOT ONE tell was evaluated against the tree.',
      'The tells are the whole reason this declaration is checkable rather than asserted: with none',
      'evaluated, adding a location permission or a location package would change nothing here and the',
      '"not collected" answers would be believed forever. Either every answer lost its `tells` block, or',
      'the walks above stopped reaching the manifests and the pubspec.',
    ]);
  }

  // ── REQUIRED_COVERAGE for the clientAbsence limb ─────────────────────────────
  // 🔴 THE LIMB ABOVE IS OPTIONAL PER ROW, WHICH MEANS IT CAN BE DELETED PER ROW
  // AND NOTHING WOULD SAY SO. The rows where "collected, but never from the
  // device" is the load-bearing sentence are named in the declaration, and a named
  // row that has lost its block fails here. This is the same shape as
  // check-migrations.mjs's REQUIRED_COVERAGE, and it exists for the same recorded
  // reason: a scanner that quietly stopped covering the thing it was written for
  // still prints "clean".
  const caRequired = ds.clientAbsenceRequiredFor?.types;
  if (!Array.isArray(caRequired) || caRequired.length === 0) {
    coverageLost([
      `${DS_REL} clientAbsenceRequiredFor.types is missing or empty.`,
      'That list is the only thing making the `clientAbsence` limb non-deletable per row. Empty, every row',
      'could drop its block and this guard would report the same green it reports now — which is precisely',
      'the failure mode the block was added to close.',
    ]);
  }
  for (const key of caRequired) {
    const a = answerByKey.get(key);
    if (!a) {
      problems.push(
        `${DS_REL} clientAbsenceRequiredFor names ${JSON.stringify(key)} and there is no answer with that "Category|Type". Either the type was renamed on one side only, or the row was removed and this requirement outlived it.`,
      );
    } else if (a.clientAbsence === undefined) {
      problems.push(
        `🔴 ${DS_REL} answer ${JSON.stringify(key)} is required to carry a \`clientAbsence\` block and does not. That row's answer depends on the DEVICE contributing nothing to the data type — a claim the ordinary tells limb stops checking the moment the row is collected. Without the block, adding a location package, an ads SDK or a third-party analytics SDK would change nothing in this guard.`,
      );
    }
  }
  if (clientAbsenceChecked === 0 && cleanSoFar()) {
    coverageLost([
      'NOT ONE clientAbsence tell was evaluated against the tree.',
      'Every row named in clientAbsenceRequiredFor either lost its block or lost its tells, so the claim that',
      'the device contributes nothing to Approximate location, the email address, app interactions and the',
      'device identifiers is now asserted by nobody and checked by nothing.',
    ]);
  }

  // ── the resolved list: a settled question keeps its write-up, AND its answer ──
  // 🔴 A RESOLVED ENTRY IS A CHECK, NOT A SCRAPBOOK. Both of this declaration's
  // open questions were settled on 2026-08-04 and both write-ups were kept, because
  // the first thing anyone re-deriving a sworn declaration asks is why the value is
  // what it is. But a kept write-up that nothing verifies is just prose: the limb
  // below requires every type a resolved entry claims to have settled to be
  // NON-NULL in every posture. Re-null an answer while leaving it listed as
  // resolved — the exact shape of backsliding — and the build fails.
  const resolved = Array.isArray(ds.resolved) ? ds.resolved : [];
  let resolvedChecked = 0;
  for (const r of resolved) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.trim() === '') {
      problems.push(`${DS_REL} carries a \`resolved\` entry with no \`id\`.`);
      continue;
    }
    const where = `${DS_REL} resolved "${r.id}"`;
    if (unresolvedById.has(r.id)) {
      problems.push(
        `${where} is ALSO listed in \`unresolved\`. One question cannot be both open and settled, and whichever of the two a reader happens to hit first becomes the answer they act on.`,
      );
    }
    for (const field of ['question', 'answer', 'settledOn', 'settledBy', 'ownerItem']) {
      if (typeof r[field] !== 'string' || r[field].trim() === '') {
        problems.push(
          `${where} has no \`${field}\`. A settled question needs the question, the answer, the day, who or what settled it and whose item it was — anything less is a value with no provenance, which is what this whole file exists not to be.`,
        );
      }
    }
    if (typeof r.settledOn === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(r.settledOn)) {
      problems.push(`${where}.settledOn is not an ISO date (YYYY-MM-DD): ${JSON.stringify(r.settledOn)}`);
    }
    const affects = Array.isArray(r.affects) ? r.affects : [];
    if (affects.length === 0) {
      problems.push(`${where} names no \`affects\`. A resolution that points at no Play data type cannot be checked against any answer, so nothing stops the answer drifting back.`);
    }
    for (const t of affects) {
      const hit = [...vocabTypes.values()].find((v) => v.type === t);
      if (!hit) {
        problems.push(`${where} says it affects ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
        continue;
      }
      const a = answerByKey.get(`${hit.category}|${hit.type}`);
      if (!a) continue;
      resolvedChecked++;
      const stillNull = POSTURES.filter((p) => a.collected?.[p] === null || (a.shared ?? {})[p] === null);
      if (stillNull.length > 0) {
        problems.push(
          `🔴 ${where} claims to have settled ${JSON.stringify(t)} on ${r.settledOn}, and that answer is STILL null for posture(s) ${stillNull.join(', ')}. Either the answer was re-opened and this entry was not moved back to \`unresolved\`, or it was never actually filled in. A question recorded as settled while the form field it settles is blank is worse than an open one: the open list is what the guard prints as blocking, and this row is not on it.`,
        );
      }
    }
  }
  if (resolved.length > 0 && resolvedChecked === 0 && cleanSoFar()) {
    coverageLost([
      `${DS_REL} declares ${resolved.length} \`resolved\` entr(ies) and NOT ONE was matched to an answer row.`,
      'The backslide check ranges over those matches, so it measured nothing while reporting ok — and the',
      'entries would sit there asserting that two blocking questions are closed, which is the one claim in',
      'this file nobody should take on trust.',
    ]);
  }

  // ── the unresolved list, in both directions ──────────────────────────────────
  for (const [id, u] of unresolvedById) {
    for (const field of ['question', 'ownerItem', 'howToResolve', 'status']) {
      if (typeof u[field] !== 'string' || u[field].trim() === '') {
        problems.push(`${DS_REL} unresolved "${id}" has no \`${field}\`. An open question with no owner and no procedure to settle it is a permanent exemption with a polite label.`);
      }
    }
    for (const t of Array.isArray(u.affects) ? u.affects : []) {
      if (![...vocabTypes.values()].some((v) => v.type === t)) {
        problems.push(`${DS_REL} unresolved "${id}" says it affects ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
      }
    }
    if (!unresolvedReferenced.has(id)) {
      problems.push(
        `${DS_REL} unresolved "${id}" is referenced by NO answer. Either the answer it belonged to was resolved and this entry outlived it — leaving a question that looks open about something already settled — or an answer lost its \`unresolved\` pointer and its null is now unattached.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6 · THE INVENTORY RELATION, BOTH DIRECTIONS.
  // ─────────────────────────────────────────────────────────────────────────────
  const stores = Array.isArray(inventory.stores) ? inventory.stores : [];
  if (stores.length === 0) {
    coverageLost([`${INVENTORY_REL} declares no \`stores\`.`, 'The mapping limb has no right-hand side and would pass by comparing against nothing.']);
  }
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const personalRows = stores.filter((s) => s.personalData === true);
  if (personalRows.length === 0) {
    coverageLost([
      `${INVENTORY_REL} has NO row marked \`personalData: true\`.`,
      'The mapping limb ranges over those rows. With none, "every store holding personal data is mapped to',
      'a Play data type" is vacuously true — and it is precisely the rows holding personal data that a Data',
      'safety declaration exists to describe.',
    ]);
  }
  const excluded = ds.inventory?.notFromThisApp ?? {};
  let mappingChecked = 0;
  for (const s of personalRows) {
    mappingChecked++;
    const isMapped = mappedInventoryRows.has(s.id);
    const isExcluded = Object.prototype.hasOwnProperty.call(excluded, s.id);
    if (isMapped && isExcluded) {
      problems.push(
        `${DS_REL} both MAPS ${s.id} to a Play data type and lists it in inventory.notFromThisApp. One of the two is wrong and both are in this file: either this app puts data there, or it does not.`,
      );
    } else if (!isMapped && !isExcluded) {
      problems.push(
        `🔴 ${INVENTORY_REL} row ${s.id} (${s.name}) holds personal data and ${DS_REL} neither maps it to a Play data type nor excludes it in inventory.notFromThisApp with a reason. A store holding something about a person that the Data safety declaration is silent about is the gap this guard exists to close — the same shape as a store with no inventory row at all.`,
      );
    } else if (isExcluded && (typeof excluded[s.id] !== 'string' || excluded[s.id].trim() === '')) {
      problems.push(`${DS_REL} inventory.notFromThisApp["${s.id}"] carries no reason. An exclusion with no argument is a row somebody decided not to think about.`);
    }
  }
  for (const id of Object.keys(excluded)) {
    if (!storeById.has(id)) {
      problems.push(
        `${DS_REL} inventory.notFromThisApp names ${JSON.stringify(id)} and ${INVENTORY_REL} has no such row. Either the store was renamed and this exclusion still describes the old one, or it was removed and the exclusion outlived it — the direction that stops this becoming a list that always looks complete.`,
      );
    }
  }
  for (const id of mappedInventoryRows) {
    if (!storeById.has(id)) {
      problems.push(`${DS_REL} maps a Play data type to inventory row ${JSON.stringify(id)}, which does not exist in ${INVENTORY_REL}.`);
    }
  }
  if (mappingChecked === 0 && cleanSoFar()) {
    coverageLost(['NOT ONE personal-data inventory row was compared to the declaration.']);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7 · EQUALITY: the declared permission set and the declared dependency set.
  // ─────────────────────────────────────────────────────────────────────────────
  const declaredPerms = ds.androidPermissions?.declaredInRepo ?? {};
  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  let permFilesChecked = 0;
  for (const [f, found] of permsByFile) {
    if (!Object.prototype.hasOwnProperty.call(declaredPerms, f)) {
      problems.push(
        `${DS_REL} androidPermissions.declaredInRepo has no entry for ${f}, and that manifest exists. An unlisted manifest is a set of permissions this declaration has never been compared against.`,
      );
      continue;
    }
    permFilesChecked++;
    const declared = [...(declaredPerms[f] ?? [])].sort();
    if (!sameSet(declared, found)) {
      problems.push(
        `🔴 ${f} declares [${found.join(', ') || '(none)'}] and ${DS_REL} says [${declared.join(', ') || '(none)'}]. A permission is the loudest single tell that a data type has started being collected — say which Play data type this changes, in the same commit.`,
      );
    }
  }
  for (const f of Object.keys(declaredPerms)) {
    if (!permsByFile.has(f)) {
      problems.push(`${DS_REL} androidPermissions.declaredInRepo names ${f}, which does not exist. The declaration is describing a manifest that is gone.`);
    }
  }
  if (permFilesChecked === 0 && cleanSoFar()) {
    coverageLost(['NOT ONE manifest was compared to the declared permission set.']);
  }
  if (typeof ds.androidPermissions?.cannotSee !== 'string' || ds.androidPermissions.cannotSee.trim() === '') {
    problems.push(
      `${DS_REL} androidPermissions carries no \`cannotSee\`. This walk reads only the manifests in this repository and Gradle merges more in from every plugin; a declaration that does not say so invites the permission set above to be read as complete, which it is not.`,
    );
  }

  const declaredDeps = ds.dependencySurface?.direct ?? {};
  let depsChecked = 0;
  for (const dep of [...directDeps].sort()) {
    const entry = declaredDeps[dep];
    if (entry === undefined) {
      problems.push(
        `🔴 ${pubspecRel} depends on \`${dep}\` and ${DS_REL} dependencySurface.direct has no entry for it. A new dependency arrived and nobody said what data it can collect. This is the mechanism by which a permission-bearing SDK actually enters an app — the manifest change happens inside a package this repository does not contain — so it is a build failure, not a note.`,
      );
      continue;
    }
    depsChecked++;
    if (!Array.isArray(entry.introduces)) {
      problems.push(`${DS_REL} dependencySurface.direct["${dep}"] has no \`introduces\` array (use [] for "collects nothing").`);
    } else {
      for (const t of entry.introduces) {
        const hit = [...vocabTypes.values()].find((v) => v.type === t);
        if (!hit) {
          problems.push(`${DS_REL} dependencySurface.direct["${dep}"].introduces names ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
          continue;
        }
        const a = answerByKey.get(`${hit.category}|${hit.type}`);
        if (a && POSTURES.every((p) => a.collected?.[p] === false)) {
          problems.push(
            `${DS_REL} says \`${dep}\` introduces ${JSON.stringify(t)} and the answer for that type declares it NEVER collected in any posture. The dependency map and the answer contradict each other, and both are in this file.`,
          );
        }
      }
    }
    if (typeof entry.why !== 'string' || entry.why.trim() === '') {
      problems.push(`${DS_REL} dependencySurface.direct["${dep}"] carries no \`why\`. "Introduces nothing" is a claim, and a claim with no argument is the one nobody re-checks.`);
    }
  }
  for (const dep of Object.keys(declaredDeps)) {
    if (!directDeps.has(dep)) {
      problems.push(
        `${DS_REL} dependencySurface.direct names \`${dep}\` and ${pubspecRel} no longer depends on it. Either it was removed and this entry outlived it, or it was renamed on one side only — the direction that stops this map looking complete while describing a graph that is gone.`,
      );
    }
  }
  if (depsChecked === 0 && cleanSoFar()) {
    coverageLost(['NOT ONE direct dependency was compared to the declared dependency surface.']);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7a · THE MERGED ANDROID MANIFEST, AS MEASURED OFF A BUILT ARTEFACT.
  //
  // 🔴 THE BLOCK THIS LIMB READS SPENT ITS FIRST DAY PROMISING A GUARD NOBODY HAD
  // WRITTEN — this corpus's signature defect wearing a measurement as a disguise.
  // androidPermissions.merged records the union Gradle actually produced, read off
  // the signed .aab of run 32869814582 and cross-decoded twice, and then says two
  // things about ITSELF in prose: that `expectedButAbsent` is "an equality with
  // teeth … a re-measurement finds this key contradicting the permission list and
  // FAILS", and that `pinned` is what stops the reading "going quietly stale".
  // Neither sentence was true the day it was written: NOTHING READ EITHER KEY. A
  // measurement is a fact; a sentence about what happens when the fact moves is a
  // claim, and an unchecked claim sitting beside a correct number is exactly the
  // shape of defect this whole file exists to catch. This limb is those two
  // sentences becoming true.
  //
  // WHAT IT ASSERTS — every one a promise the block makes about itself, not an
  // obligation invented here:
  //   · THE PINS RESOLVE. Every package in `merged.pinned` still resolves to that
  //     exact version in the lock. A version bump is the ONE way this reading can
  //     rot with no other file in the repository changing: the manifest equality
  //     in limb 7 cannot see it, and the dependency equality cannot either,
  //     because the package is already declared and its RANGE has not moved. That
  //     is the whole argument `_pinned_why` makes for the pin existing.
  //   · WHAT WAS PREDICTED AND MEASURED ABSENT IS STILL ABSENT. No key in
  //     `expectedButAbsent` may appear in `merged.permissions`. If a later
  //     sentry-android brings ACCESS_NETWORK_STATE in, the block lands a key that
  //     contradicts its own receipt, and somebody has to say what the new
  //     permission changes instead of appending it silently.
  //   · THE BLOCK IS INTERNALLY HONEST. A row graded `read` or `inferred` carries
  //     the evidence it claims; an `inferred` row carries the residual that is the
  //     entire difference between the two grades; an `unattributed` row names
  //     nobody AND has a matching named finding under `merged.unattributed` — both
  //     directions, so neither a blank quietly filled in nor a finding whose row
  //     went away can pass.
  //   · THE "IT ALL CAME FROM DEPENDENCIES" SENTENCE. `merged._why` asserts that
  //     not one of these permissions is declared in this repository; the release
  //     manifest it names is compared, so the day somebody hand-declares one of
  //     them that sentence fails instead of quietly becoming false.
  //
  // COVERAGE. `merged` absent, `merged.permissions` empty, or a lock that parses
  // to zero versions are each COVERAGE LOST and never ok: a limb ranging over
  // nothing certifies nothing, and "the merged set has been read" is precisely the
  // claim a silent pass would be forging.
  // ─────────────────────────────────────────────────────────────────────────────
  const merged = ds.androidPermissions?.merged;
  let mergedPermsChecked = 0;
  let mergedPinsChecked = 0;
  let mergedAbsencesChecked = 0;

  if (!merged || typeof merged !== 'object' || Array.isArray(merged)) {
    coverageLost([
      `${DS_REL} androidPermissions carries no \`merged\` block.`,
      'It is the only reading of the permission set Google actually sees — the union Gradle produces from',
      'plugin manifests that are not in this repository. Without it every check below ranges over nothing,',
      'and this guard would go back to reporting ok on the in-repo manifest equality alone while the printed',
      'CANNOT-SEE list still said the merged set had never been read. Delete the measurement and the guard',
      'must say so, not shrug.',
    ]);
  }

  const mergedPerms = Array.isArray(merged.permissions) ? merged.permissions : [];
  if (mergedPerms.length === 0) {
    coverageLost([
      `${DS_REL} androidPermissions.merged.permissions is empty or not an array.`,
      'Every assertion in this limb quantifies over it: the absence check would find nothing to contradict,',
      'the attribution checks would grade nothing, and the guard would certify a measurement of zero',
      'permissions as a clean reading of a real .aab.',
    ]);
  }

  // ── the provenance. A measurement with no receipt is a number somebody typed ──
  const mf = merged.measuredFrom;
  if (!mf || typeof mf !== 'object') {
    problems.push(
      `${DS_REL} androidPermissions.merged carries no \`measuredFrom\`. The permission list is a reading of a specific artefact of a specific run, or it is a guess with better formatting — and this file's rule is that a value carries where it came from.`,
    );
  } else {
    for (const field of ['runId', 'commit', 'artifact', 'entry', 'method', 'measuredOn']) {
      if (typeof mf[field] !== 'string' || mf[field].trim() === '') {
        problems.push(
          `${DS_REL} androidPermissions.merged.measuredFrom has no \`${field}\`. Re-taking this reading means finding the artefact again; a receipt missing the run, the commit, the file inside it or how it was decoded cannot be followed back.`,
        );
      }
    }
    if (typeof mf.measuredOn === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(mf.measuredOn)) {
      problems.push(`${DS_REL} androidPermissions.merged.measuredFrom.measuredOn is not an ISO date (YYYY-MM-DD): ${JSON.stringify(mf.measuredOn)}`);
    }
  }

  // ── the rows, and what each grade obliges ────────────────────────────────────
  const VALID_ATTRIBUTION = new Set(['direct', 'transitive', 'unattributed']);
  const VALID_GRADE = new Set(['read', 'inferred']);
  const unattributedFindings = merged.unattributed && typeof merged.unattributed === 'object' ? merged.unattributed : {};
  const mergedNames = new Set();
  for (const p of mergedPerms) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || p.name.trim() === '') {
      problems.push(`${DS_REL} androidPermissions.merged.permissions carries an entry with no \`name\`. A permission with no name cannot be compared to anything.`);
      continue;
    }
    const where = `${DS_REL} androidPermissions.merged.permissions["${p.name}"]`;
    if (mergedNames.has(p.name)) {
      problems.push(`${where} appears TWICE. A merged manifest is a SET; two rows for one permission are two places to record an attribution, and the second is always the one nobody updates.`);
      continue;
    }
    mergedNames.add(p.name);
    mergedPermsChecked++;

    if (!VALID_ATTRIBUTION.has(p.attribution)) {
      problems.push(
        `${where} has \`attribution\` ${JSON.stringify(p.attribution ?? null)}, which is not one of ${[...VALID_ATTRIBUTION].join(', ')}. That word is how a reader knows whether the source was established or admitted to be unknown.`,
      );
      continue;
    }
    if (typeof p.why !== 'string' || p.why.trim() === '') {
      problems.push(`${where} carries no \`why\`. "This permission moves no Play data type" is a claim on a sworn declaration, and a claim with no argument is the one nobody re-checks.`);
    }
    if (typeof p.collectionSignal !== 'boolean') {
      problems.push(
        `${where} has no boolean \`collectionSignal\`. Whether a permission is a collection tell is the single question the Data safety form turns on; left unstated it reads as "no" without anybody having said so.`,
      );
    }

    if (p.attribution === 'unattributed') {
      if (p.attributedTo !== null || p.evidenceGrade !== null || p.evidence !== null) {
        problems.push(
          `${where} is graded \`unattributed\` while still carrying an attributedTo/evidenceGrade/evidence. Unattributed means nothing here says who put it in the merged set; a row that half-names a source is a guess dressed as a reading, which is the exact failure this block was written against.`,
        );
      }
      if (typeof unattributedFindings[p.name] !== 'string' || unattributedFindings[p.name].trim() === '') {
        problems.push(
          `🔴 ${where} is graded \`unattributed\` and \`merged.unattributed\` carries no finding for it. An unattributed permission on a sworn declaration is a NAMED FINDING — what was ruled out, what would settle it — or it is a blank quietly filled in with silence.`,
        );
      }
      continue;
    }

    if (typeof p.attributedTo !== 'string' || p.attributedTo.trim() === '') {
      problems.push(
        `${where} is graded \`${p.attribution}\` and names no \`attributedTo\`. That is the worst of both states: it is not an unattributed finding either, so nobody is looking for its source.`,
      );
    }
    if (!VALID_GRADE.has(p.evidenceGrade)) {
      problems.push(
        `${where} has \`evidenceGrade\` ${JSON.stringify(p.evidenceGrade ?? null)}, which is not one of ${[...VALID_GRADE].join(', ')}. "read" and "inferred" are different epistemic states, and collapsing them is how an inference becomes a reading in somebody's summary.`,
      );
      continue;
    }
    if (typeof p.evidence !== 'string' || p.evidence.trim() === '') {
      problems.push(
        `🔴 ${where} is graded \`${p.evidenceGrade}\` and carries no \`evidence\`. The grade IS the promise that a file was opened or a tell was found; with nothing beside it, the grade is a word.`,
      );
    }
    if (p.evidenceGrade === 'inferred' && (typeof p.residual !== 'string' || p.residual.trim() === '')) {
      problems.push(
        `${where} is graded \`inferred\` and carries no \`residual\`. The entire difference between \`read\` and \`inferred\` in this block is that the source file was NOT opened; the residual is what says so and what would settle it. An inference with no route to being settled quietly becomes a reading.`,
      );
    }
  }

  // The other direction: a finding whose row has gone.
  for (const name of Object.keys(unattributedFindings)) {
    if (name.startsWith('_')) continue;
    const row = mergedPerms.find((p) => p && p.name === name);
    if (!row) {
      problems.push(
        `${DS_REL} androidPermissions.merged.unattributed names \`${name}\`, which is in no \`permissions\` row. Either the permission left the merged set and this open finding outlived it — an unanswered question about something that is gone — or the row was renamed on one side only.`,
      );
    } else if (row.attribution !== 'unattributed') {
      problems.push(
        `${DS_REL} androidPermissions.merged.unattributed still carries an open finding for \`${name}\` while its row is now attributed to \`${row.attributedTo}\`. The question was answered and the finding was left standing; a reader who hits the finding first acts on the wrong one.`,
      );
    }
  }

  // ── expectedButAbsent: the receipt with teeth ────────────────────────────────
  const expectedButAbsent = merged.expectedButAbsent && typeof merged.expectedButAbsent === 'object' ? merged.expectedButAbsent : {};
  for (const [name, why] of Object.entries(expectedButAbsent)) {
    if (name.startsWith('_')) continue;
    mergedAbsencesChecked++;
    if (typeof why !== 'string' || why.trim() === '') {
      problems.push(
        `${DS_REL} androidPermissions.merged.expectedButAbsent["${name}"] carries no reason. It is kept as the receipt of what careful reasoning about a plugin list got wrong; without the write-up it is a bare string nobody can act on.`,
      );
    }
    if (mergedNames.has(name)) {
      problems.push(
        `🔴 ${DS_REL} androidPermissions.merged lists \`${name}\` under \`expectedButAbsent\` AND carries it in \`permissions\`. It was predicted, measured absent, and has now arrived — the precise event that block exists to catch. Do NOT append it silently: re-take the reading from a fresh .aab, say which Play data type it changes (or that it changes none, with the argument), move it out of expectedButAbsent, and update \`measuredFrom\` in the same commit.`,
      );
    }
  }

  // ── the sentence about where the merged set came from ────────────────────────
  const releaseManifestRel = typeof merged.releaseManifest === 'string' ? merged.releaseManifest : null;
  if (releaseManifestRel === null) {
    problems.push(
      `${DS_REL} androidPermissions.merged names no \`releaseManifest\`. Its \`_why\` asserts that NOT ONE of the merged permissions is declared in this repository; with no manifest named, that sentence is unchecked.`,
    );
  } else if (!permsByFile.has(releaseManifestRel)) {
    problems.push(
      `${DS_REL} androidPermissions.merged.releaseManifest names ${releaseManifestRel}, which is not one of the manifests this walk found. The claim that the whole merged set arrived from dependencies rests on that file declaring nothing, and the file is not being read.`,
    );
  } else {
    for (const name of permsByFile.get(releaseManifestRel) ?? []) {
      if (mergedNames.has(name)) {
        problems.push(
          `${DS_REL} androidPermissions.merged._why says not one of these permissions is declared in this repository, and ${releaseManifestRel} now declares \`${name}\`. The merged set no longer arrived wholly from dependencies — which changes what \`dependencySurface\` is able to watch, and changes who has to answer for the permission.`,
        );
      }
    }
  }

  // ── the pins, against the same lock limb 7b reads ────────────────────────────
  const mergedLockRel = typeof merged.lockfile === 'string' ? merged.lockfile : 'pubspec.lock';
  const mergedLockText = read(mergedLockRel);
  if (mergedLockText === null) {
    coverageLost([
      `${DS_REL} androidPermissions.merged.lockfile names ${mergedLockRel}, which does not exist.`,
      'The version comparison below is the only thing tying this reading of a built artefact to the packages',
      'it was taken against. With no lockfile it would range over nothing and report the pins confirmed.',
    ]);
  }
  const mergedLockVersions = parseLockVersions(mergedLockText);
  if (mergedLockVersions.size === 0) {
    coverageLost([
      `${mergedLockRel} parsed to ZERO resolved package versions (androidPermissions.merged.pinned).`,
      'Either the lockfile format moved or the shared parse is wrong. Every pin would then be "not found" and',
      'this limb would fail for the wrong reason. Fix the parse before trusting either outcome.',
    ]);
  }
  const mergedPinned = merged.pinned;
  if (!mergedPinned || typeof mergedPinned !== 'object' || Object.keys(mergedPinned).length === 0) {
    coverageLost([
      `${DS_REL} androidPermissions.merged.pinned is missing or empty.`,
      'It names the packages whose plugin manifests were actually read to attribute the rows above. Empty, the',
      'loop below compares nothing — and the one drift this measurement cannot otherwise survive, a version bump',
      'that changes the merged set with no other file in this repository moving, goes unwatched while the block',
      'above still says the pin is what stops it rotting in silence.',
    ]);
  }
  for (const [pkg, declaredVersion] of Object.entries(mergedPinned)) {
    if (pkg.startsWith('_')) continue;
    const actual = mergedLockVersions.get(pkg);
    if (actual === undefined) {
      problems.push(
        `🔴 ${DS_REL} androidPermissions.merged.pinned names \`${pkg}\` and ${mergedLockRel} resolves no such package. The package whose plugin manifest was read to attribute a merged permission is not in the dependency graph at all — so either it left (and the rows attributed to it describe permissions that are no longer merged) or it was renamed and this pin was left behind. Re-take the reading from a fresh .aab.`,
      );
      continue;
    }
    mergedPinsChecked++;
    if (actual !== declaredVersion) {
      problems.push(
        `🔴 ${mergedLockRel} resolves \`${pkg}\` to ${actual} and ${DS_REL} androidPermissions.merged.pinned records ${declaredVersion}. The merged permission set was measured against ${declaredVersion}, and the rows above were attributed by READING that version's own AndroidManifest.xml. A bump is the one way this measurement rots with no other file in this repository changing — the manifest equality above cannot see it, and neither can the dependency equality, because the dependency did not move, only its resolution did. Re-take the reading from a fresh .aab, then update this pin in the same commit.`,
      );
    }
  }
  if (mergedPinsChecked === 0 && cleanSoFar()) {
    coverageLost([
      'NOT ONE merged-manifest version pin was compared to the lockfile.',
      'The measurement is version-scoped by construction; with no pin compared, the versions it was scoped to',
      'are a comment sitting beside a number nobody can re-derive.',
    ]);
  }
  if (mergedPermsChecked === 0 && cleanSoFar()) {
    coverageLost([
      'NOT ONE merged permission row was graded.',
      'The attribution, evidence and absence limbs above all ran over an empty set.',
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7b · THE CRASH SDK VERSION PIN.
  //
  // 🔴 "DEVICE OR OTHER IDS = TRUE" IS A FACT ABOUT A VERSION, NOT AN ETERNAL ONE.
  // It was established by reading sentry_flutter 9.26.0 and the sentry-android
  // 8.51.0 it carries: DeviceInfoUtil sets contexts.device.id to a UUID persisted
  // for the life of the install, ungated by sendDefaultPii, and the Dart layer
  // passes the unmodelled key straight through. Sentry ships often and Renovate
  // bumps this repository automatically, so the single most likely way that answer
  // silently becomes wrong — in EITHER direction — is a dependency bump nobody
  // connected to a store declaration.
  //
  // The pin is compared to the COMMITTED pubspec.lock, not to the pubspec range: a
  // `^9.26.0` constraint is satisfied by 9.99.0, so the constraint is not what was
  // read. The lock is the resolved version CI actually builds.
  // ─────────────────────────────────────────────────────────────────────────────
  const css = ds.crashSdkSurface;
  let pinsChecked = 0;
  if (!css || typeof css !== 'object') {
    problems.push(
      `${DS_REL} carries no \`crashSdkSurface\`. The Device-or-other-IDs answer rests entirely on what a specific version of the crash SDK does; with no pin recorded, a Renovate bump changes the behaviour behind a sworn declaration and nothing anywhere notices.`,
    );
  } else {
    const lockRel = typeof css.lockfile === 'string' ? css.lockfile : 'pubspec.lock';
    const lockText = read(lockRel);
    if (lockText === null) {
      coverageLost([
        `${DS_REL} crashSdkSurface.lockfile names ${lockRel}, which does not exist.`,
        'The version comparison below is the only thing tying the device-identifier answer to the code that',
        'was actually read. With no lockfile it would range over nothing and report the pin confirmed.',
      ]);
    }
    // The resolved versions. The parse lives in parseLockVersions() at the top of
    // this file because limb 7a pins against the same lock for a different reason.
    const lockVersions = parseLockVersions(lockText);
    if (lockVersions.size === 0) {
      coverageLost([
        `${lockRel} parsed to ZERO resolved package versions.`,
        'Either the lockfile format moved or this parse is wrong. Every pin below would then be "not found"',
        'and the limb would fail for the wrong reason — or, if the loop were written the other way round,',
        'pass by comparing nothing. Fix the parse before trusting either outcome.',
      ]);
    }
    const pinned = css.pinned;
    if (!pinned || typeof pinned !== 'object' || Object.keys(pinned).length === 0) {
      coverageLost([
        `${DS_REL} crashSdkSurface.pinned is missing or empty.`,
        'It names the packages whose source was actually read. Empty, the loop below compares nothing and the',
        'declaration silently stops being tied to any particular SDK behaviour.',
      ]);
    }
    for (const [pkg, declaredVersion] of Object.entries(pinned)) {
      const actual = lockVersions.get(pkg);
      if (actual === undefined) {
        problems.push(
          `🔴 ${DS_REL} crashSdkSurface.pinned names \`${pkg}\` and ${lockRel} resolves no such package. The crash SDK the declaration was written against is not in the dependency graph at all — so either it was removed (and the crash-log, diagnostics and device-identifier answers all now overstate what ships) or it was renamed and this pin was left behind.`,
        );
        continue;
      }
      pinsChecked++;
      if (actual !== declaredVersion) {
        problems.push(
          `🔴 ${lockRel} resolves \`${pkg}\` to ${actual} and ${DS_REL} crashSdkSurface.pinned records ${declaredVersion}. The "Device or other IDs" answer was derived by READING THAT SDK's source — specifically that it attaches a persistent per-install id to contexts.device and that sendDefaultPii does not suppress it. A different version is a different program, and the answer on a sworn declaration must not survive a bump on the strength of it having been true once. Re-read the SDK, then update this pin in the same commit.`,
        );
      }
    }
    if (typeof css.cannotSee !== 'string' || css.cannotSee.trim() === '') {
      problems.push(
        `${DS_REL} crashSdkSurface carries no \`cannotSee\`. Reading the SDK settles what LEAVES THE DEVICE and says nothing about what the receiving GlitchTip instance does with it. A block that does not say so invites the pin above to be read as a complete answer about the crash rail, which it is not.`,
      );
    }
  }
  if (pinsChecked === 0 && cleanSoFar()) {
    coverageLost([
      'NOT ONE crash-SDK version pin was compared to the lockfile.',
      'The device-identifier answer is version-scoped by construction; with no pin compared, the version it',
      'was scoped to is a comment.',
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8 · DATA SECURITY: encryption in transit, and the deletion route.
  // ─────────────────────────────────────────────────────────────────────────────
  const sec = ds.dataSecurity ?? {};

  // (a) Encrypted in transit — proven by there being no plaintext endpoint in the
  //     shipped client, not by asserting TLS. `https://` does not contain
  //     `http://`, so the match is exact without a lookahead.
  const enc = sec.encryptedInTransit ?? {};
  let dartScanned = 0;
  if (enc.answer === true) {
    const roots = Array.isArray(enc.clientRoots) ? enc.clientRoots : [];
    if (roots.length === 0) {
      problems.push(`${DS_REL} dataSecurity.encryptedInTransit declares true and names no \`clientRoots\` to prove it over. The answer would be an assertion with nothing behind it.`);
    }
    const offenders = [];
    for (const rootRel of roots) {
      for (const f of walk(rootRel)) {
        if (!f.endsWith('.dart') || /\/test\//.test(f) || f.endsWith('_test.dart')) continue;
        dartScanned++;
        const src = stripSourceComments(read(f) ?? '', '.dart');
        if (src.includes('http://')) offenders.push(f);
      }
    }
    if (dartScanned === 0) {
      coverageLost([
        `dataSecurity.encryptedInTransit declares true and ZERO Dart files were scanned under ${roots.join(', ')}.`,
        '"No plaintext endpoint" would be true by having read nothing, which is the shape of every silent',
        'under-coverage this repository has recorded.',
      ]);
    }
    for (const f of offenders) {
      problems.push(
        `🔴 ${f} contains a \`http://\` URL in shipped client code, and ${DS_REL} declares all data encrypted in transit. One plaintext endpoint makes that answer false for every data type at once.`,
      );
    }
  }

  // (b) Deletion. Play requires BOTH an in-app path and a web link, and the web
  //     link is submitted on this very form.
  const del = sec.deletionRequestSupported ?? {};
  let erasureRoutesChecked = 0;
  if (del.answer === true) {
    if (typeof del.webDeletionUrl !== 'string' || !/^https:\/\/\S+$/.test(del.webDeletionUrl)) {
      problems.push(
        `${DS_REL} declares deletion supported and \`webDeletionUrl\` is not a single absolute https URL. Play requires a "web link resource where users can request app account deletion and associated data deletion", submitted in this form and functional.`,
      );
    }
    for (const [field, label] of [
      ['sitePage', 'the page the web deletion URL resolves to'],
      ['inAppControl', 'the in-app deletion control'],
    ]) {
      const rel = del[field];
      if (typeof rel !== 'string' || rel.trim() === '') {
        problems.push(`${DS_REL} declares deletion supported and names no \`${field}\` (${label}).`);
      } else if (!exists(rel)) {
        problems.push(
          `🔴 ${DS_REL} names ${rel} as ${label} and it does not exist. The declaration promises Google a deletion path that is not in the tree — and a user told their data is deleted stops asking, which is why a broken deletion route is worse than none.`,
        );
      }
    }
    for (const g of Array.isArray(del.guards) ? del.guards : []) {
      if (!exists(g)) problems.push(`${DS_REL} names ${g} as a guard behind the deletion answer and it does not exist.`);
    }

    // 🔴 THE ROUTES ARE DERIVED, NOT LISTED. Every inventory row this declaration
    // maps to a Play data type carries its own erasure story, and the rows whose
    // story is `purge`/`unlink` name the route that performs it. Taking the route
    // set from there means renaming or deleting a route fails HERE too, and there
    // is no second list of routes to drift from the first.
    const routes = new Set();
    for (const id of mappedInventoryRows) {
      const s = storeById.get(id);
      if (s?.erasure && typeof s.erasure.route === 'string') routes.add(s.erasure.route);
    }
    for (const r of [...routes].sort()) {
      erasureRoutesChecked++;
      if (!exists(r)) {
        problems.push(
          `🔴 ${INVENTORY_REL} says an erasure request reaches a store this declaration maps, via ${r}, and that file does not exist. "Users can request that their data is deleted" is answered YES on this form; the route answering it is gone.`,
        );
      }
    }
    if (routes.size === 0) {
      problems.push(
        `${DS_REL} declares deletion supported and NOT ONE mapped inventory row names an erasure route. Either no row with a route is mapped — in which case the deletion answer covers nothing this app writes — or the mapping lost its \`inventoryRows\`. Both make the answer unbacked.`,
      );
    }
  } else if (del.answer !== false) {
    problems.push(`${DS_REL} dataSecurity.deletionRequestSupported.answer is ${JSON.stringify(del.answer)}; Play asks a yes/no question.`);
  }

  for (const [k, label] of [['playFamiliesPolicy', 'Play Families Policy badge'], ['independentSecurityReview', 'Independent Security Review badge']]) {
    const block = sec[k];
    if (!block || typeof block.answer !== 'boolean') {
      problems.push(`${DS_REL} dataSecurity.${k} has no boolean \`answer\`. The ${label} is a question on the form and an absent answer is one somebody fills in from memory.`);
    } else if (typeof block.basis !== 'string' || block.basis.trim() === '') {
      problems.push(`${DS_REL} dataSecurity.${k} records no \`basis\`.`);
    } else if (block.humanOwned === true) {
      prints.push(`HUMAN-OWNED — dataSecurity.${k} = ${block.answer}. ${block.basis}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9 · THE CONTENT RATING RECORD.
  // ─────────────────────────────────────────────────────────────────────────────
  // 🔴 NO INVENTED RATING. Google: "Your app's content ratings are assigned by
  // separate rating authorities and determined by your questionnaire responses."
  // A rating in this file before the questionnaire is submitted is a value nobody
  // computed, and it would be read as authoritative by the next person.
  if (cr.assignedRating !== null && cr.assignedRating !== undefined) {
    const cert = cr.iarcCertificate;
    const ok = cert && typeof cert.id === 'string' && cert.id.trim() !== '' && cert.source && typeof cert.source.url === 'string' && typeof cert.source.fetched === 'string';
    if (!ok) {
      problems.push(
        `🔴 ${CR_REL} records assignedRating ${JSON.stringify(cr.assignedRating)} with no \`iarcCertificate\` carrying an id and a source. Ratings are ASSIGNED by the rating authorities from the submitted questionnaire — they are not chosen. A rating written here without the certificate that issued it is a guess wearing the costume of a result.`,
      );
    }
  } else if (cr.status !== 'pending-questionnaire-submission') {
    problems.push(
      `${CR_REL} has no assignedRating and \`status\` is ${JSON.stringify(cr.status)}. When there is no rating the status must say so — "pending-questionnaire-submission" — so that "we do not have one" is distinguishable from "nobody filled this in".`,
    );
  } else if (typeof cr.statusReason !== 'string' || cr.statusReason.trim() === '') {
    problems.push(`${CR_REL} is pending and records no \`statusReason\`.`);
  } else {
    prints.push(`CONTENT RATING PENDING — ${cr.statusReason}`);
  }

  const claims = Array.isArray(cr.claims) ? cr.claims : [];
  if (claims.length === 0) {
    coverageLost([`${CR_REL} declares no \`claims\`.`, 'Every content-rating limb below iterates them.']);
  }
  const DERIVATIONS = new Set(['listing-category', 'dependency-tells', 'cross-check', 'human-owned']);
  const claimById = new Map();
  let claimsChecked = 0;
  for (const c of claims) {
    const where = `${CR_REL} claim "${c.id}"`;
    if (typeof c.id !== 'string' || c.id.trim() === '') {
      problems.push(`${CR_REL} carries a claim with no \`id\`.`);
      continue;
    }
    claimById.set(c.id, c);
    if (typeof c.answer !== 'boolean') {
      problems.push(`${where} has no boolean \`answer\`.`);
    }
    if (typeof c.basis !== 'string' || c.basis.trim() === '') {
      problems.push(`${where} records no \`basis\`.`);
    }
    if (!DERIVATIONS.has(c.derivation)) {
      problems.push(
        `${where} declares derivation ${JSON.stringify(c.derivation)}, which is not one of ${[...DERIVATIONS].join(', ')}. Every claim is either derived from the tree or owned by a human — there is no third category, and a claim with neither is one nobody checks and nobody owns.`,
      );
      continue;
    }
    claimsChecked++;

    if (c.derivation === 'human-owned') {
      if (!Array.isArray(c.surfaces) || c.surfaces.length === 0) {
        problems.push(`${where} is human-owned and names no \`surfaces\` for a reviewer to re-read. "Somebody checked" with no scope is not a check.`);
      } else {
        for (const s of c.surfaces) {
          if (!exists(s)) problems.push(`${where} names surface ${s}, which does not exist.`);
        }
        prints.push(`HUMAN-OWNED — content rating "${c.id}" = ${c.answer}. Re-read: ${c.surfaces.join(', ')}`);
      }
    }

    if (c.derivation === 'listing-category') {
      const f = c.categoryFile;
      const text = typeof f === 'string' ? read(f) : null;
      if (text === null) {
        problems.push(`${where} names categoryFile ${JSON.stringify(f)}, which does not exist.`);
      } else if (text.trim() !== c.categoryValue) {
        problems.push(
          `🔴 ${where} records categoryValue ${JSON.stringify(c.categoryValue)} and ${f} says ${JSON.stringify(text.trim())}. The questionnaire branches on app-vs-game at its first question; a listing filed under one and a questionnaire answered as the other is the misrepresentation Google removes apps for.`,
        );
      } else if (Array.isArray(c.gameCategories) && c.gameCategories.some((g) => g.toLowerCase() === text.trim().toLowerCase())) {
        problems.push(`🔴 ${where} answers "not a game" and ${f} names a game category (${text.trim()}).`);
      }
    }

    if (c.derivation === 'dependency-tells') {
      const t = c.tells ?? {};
      const n = (t.dartPackages?.length ?? 0) + (t.androidPermissions?.length ?? 0);
      if (n === 0) {
        problems.push(
          `${where} claims derivation "dependency-tells" and declares no tells. An assertion that cannot fail is worse than none — it inflates apparent coverage. Give it tells, or mark it human-owned honestly.`,
        );
        continue;
      }
      for (const pkg of t.dartPackages ?? []) {
        tellsChecked++;
        if (directDeps.has(pkg) !== (c.answer === true)) {
          if (directDeps.has(pkg)) {
            problems.push(
              `🔴 ${where} answers ${c.answer} and \`${pkg}\` is a direct dependency in ${pubspecRel}. That package exists to do the thing this questionnaire answer denies.`,
            );
          }
        }
      }
      for (const perm of t.androidPermissions ?? []) {
        tellsChecked++;
        if (allPerms.has(perm) && c.answer !== true) {
          problems.push(`🔴 ${where} answers ${c.answer} and ${perm} is declared in a manifest in this repository.`);
        }
      }
    }

    if (c.derivation === 'cross-check') {
      const rule = c.crossCheck?.rule;
      if (rule === 'no-answer-declares-shared') {
        const expected = anyShared.length > 0;
        if (c.answer !== expected) {
          problems.push(
            `🔴 ${where} answers ${c.answer} and ${DS_REL} declares shared:true for ${anyShared.length} data type(s)${anyShared.length ? ` (${anyShared.join(', ')})` : ''}. The Data safety form and the content rating questionnaire are asking the same question on two different screens, and they now give Google two different answers.`,
          );
        }
      } else if (rule === 'equals-play-families-policy') {
        const expected = sec.playFamiliesPolicy?.answer;
        if (typeof expected !== 'boolean') {
          problems.push(`${where} cross-checks dataSecurity.playFamiliesPolicy and that answer is not a boolean, so the comparison has nothing to compare to.`);
        } else if (c.answer !== expected) {
          problems.push(
            `🔴 ${where} answers ${c.answer} and ${DS_REL} dataSecurity.playFamiliesPolicy.answer is ${expected}. "Is this app for children" is asked on both forms; answering it two ways is a contradiction a human filling them in weeks apart will not catch.`,
          );
        }
      } else {
        problems.push(`${where} declares crossCheck.rule ${JSON.stringify(rule)}, which this guard does not implement — so the claim reads as checked and is not.`);
      }
    }
  }
  if (claimsChecked === 0 && cleanSoFar()) {
    coverageLost([`NOT ONE content-rating claim was checked.`]);
  }
  const humanOwned = cr.humanOwned ?? {};
  for (const [k, v] of Object.entries(humanOwned)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`${CR_REL} humanOwned.${k} carries no description of what the human must actually do.`);
    } else prints.push(`HUMAN-OWNED — ${k}: ${v}`);
  }
  if (typeof cr.questionnaireWording?.status !== 'string') {
    problems.push(`${CR_REL} carries no \`questionnaireWording.status\`. The console's actual question text was either fetched and cited or it was not, and which of the two is load-bearing: a file that silently implies it mirrors the form is one nobody re-reads.`);
  } else if (cr.questionnaireWording.status === 'UNVERIFIED') {
    prints.push(`UNVERIFIED — the IARC questionnaire's exact console wording was not fetched. ${cr.questionnaireWording.why ?? ''}`);
  }


  // ── what this root contributes to the FACTORY sweep ──────────────────────
  // Derived from the declarations rather than written out again: a tell removed
  // above stops being swept over the template in the same edit.
  //
  // 🔴 ONLY TELLS THAT BELONG TO AN ABSENCE CLAIM, AND THAT WAS MEASURED, NOT
  // REASONED. The first version of this harvest took every `tells.dartPackages`
  // it could find, and the first run over the real tree failed on
  // `nikatru_purchases` in the brick's pubspec. That was the harvest being
  // wrong, not the template: the package is a tell of the content-rating
  // `digital-purchases` claim, whose answer is TRUE, so its PRESENCE is what
  // the claim predicts. Firing there is a rule that fires on correct input,
  // which is how an alarm gets switched off within a week rather than fixed.
  //
  // The two sides differ, and the difference is the guard's own semantics:
  //   · a data-safety `tells` block is only ever evaluated for a row that is
  //     never collected in ANY posture — the dead-tells limb above FAILS one
  //     that is not — so every package there is already an absence needle;
  //   · `clientAbsence` is an absence claim by construction;
  //   · a content-rating tell fires only when the claim's answer is NOT true,
  //     so a claim answering true contributes NO needle.
  const watchedPackages = new Set();
  const watchedPermissions = new Set();
  for (const a of answers) {
    for (const p of a.tells?.dartPackages ?? []) watchedPackages.add(p);
    for (const p of a.clientAbsence?.dartPackages ?? []) watchedPackages.add(p);
    for (const p of a.tells?.androidPermissions ?? []) watchedPermissions.add(p);
    for (const p of a.clientAbsence?.androidPermissions ?? []) watchedPermissions.add(p);
  }
  for (const c of Array.isArray(cr.claims) ? cr.claims : []) {
    if (c?.answer === true) continue;
    for (const p of c.tells?.dartPackages ?? []) watchedPackages.add(p);
    for (const p of c.tells?.androidPermissions ?? []) watchedPermissions.add(p);
  }

  return {
    app,
    answersChecked,
    vocabTypes: vocabTypes.size,
    postures: POSTURES.length,
    current: bp.current,
    lane: bp.lane,
    laneDefines: laneDefines ? [...laneDefines].sort().join(', ') : 'n/a',
    tellsChecked,
    clientAbsenceChecked,
    manifests: permsByFile.size,
    directDeps: directDeps.size,
    usageKeys: usageKeys.size,
    evidenceChecked,
    citationsChecked,
    pinsChecked,
    crashLock: ds.crashSdkSurface?.lockfile ?? 'pubspec.lock',
    resolvedChecked,
    mergedPermsChecked,
    mergedRunId: merged.measuredFrom?.runId ?? '?',
    mergedOn: merged.measuredFrom?.measuredOn ?? '?',
    mergedPinsChecked,
    mergedLockRel,
    mergedAbsencesChecked,
    mappingChecked,
    erasureRoutesChecked,
    dartScanned,
    claimsChecked,
    assignedRating: cr.assignedRating ?? null,
    nulls: answers
      .filter((a) => POSTURES.some((p) => a.collected?.[p] === null))
      .map((a) => ({ category: a.category, type: a.type, unresolved: a.unresolved, u: unresolvedById.get(a.unresolved) ?? null })),
    watchedPackages,
    watchedPermissions,
    prints,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN, ONE ANSWERED ROOT PER APP.
// ─────────────────────────────────────────────────────────────────────────────
const summaries = [];
for (const app of apps) {
  CURRENT_ROOT = `apps/${app}`;
  summaries.push(checkApp(app));
}
CURRENT_ROOT = null;

/** Every Dart package and Android permission ANY answered declaration watches.
 *  The needle-list for the factory sweep below is DERIVED from the declarations
 *  rather than written out a second time: a tell removed from a declaration
 *  stops being swept here in the same edit, and there is no second list to
 *  drift from the first. */
const watchedPackages = new Set();
const watchedPermissions = new Set();
for (const s of summaries) {
  for (const p of s.watchedPackages) watchedPackages.add(p);
  for (const p of s.watchedPermissions) watchedPermissions.add(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FACTORY. The brick is a root of a DIFFERENT KIND — see the header.
//
// 🔴 WHAT IT IS NOT: an answered declaration. The template's data-safety.json
// and content-rating.json are STAMPED UNANSWERED on purpose (no `vocabulary`,
// no `answers`, every question `null`), and tooling/ci/assert-sworn-store-files
// .mjs already fails if they stop being blank. Grading them against the nine
// limbs above would fail on a CORRECT state and the only way to clear it would
// be to invent answers in the template — the exact defect the template exists
// to prevent, multiplied by every app the factory will ever stamp.
//
// 🔴 WHAT IT IS: the one place a data-collection dependency can arrive for all
// fifty apps at once. `geolocator` added to apps/subly makes ONE label false and
// limb 5 above catches it. `geolocator` added HERE makes every future stamped
// app collect location while the declaration stamped beside it still answers
// `null` — nothing in this repository looked at that until 2026-09-05.
// ─────────────────────────────────────────────────────────────────────────────
CURRENT_ROOT = BRICK;
const brick = (() => {
  const dir = `${BRICK}/store/android-play`;
  const dsRel = `${dir}/data-safety.json`;
  const crRel = `${dir}/content-rating.json`;

  // (a) The declarations exist and parse. A root that can go missing in silence
  //     is not a root, and this one was added precisely because it is not empty.
  const bds = parseJson(dsRel, [
    'The template IS a Play declaration — it is what every stamped app starts from, and the sweep below',
    'derives its subject from the template tree. Absent, this root contributes nothing while still being',
    'named in the passing line, which is the shape of every silent under-coverage recorded in this repo.',
  ]);
  const bcr = parseJson(crRel, [
    'The template content-rating questionnaire. Same reasoning as its sibling above.',
  ]);

  // (b) It must STILL be a template. If it grows an `answers` array it has
  //     stopped being one, and this guard refuses to grade a template as an app.
  const answeredKeys = [];
  if (Array.isArray(bds.answers) && bds.answers.length > 0) answeredKeys.push(`${dsRel} carries an \`answers\` array`);
  if (bds.vocabulary && typeof bds.vocabulary === 'object') answeredKeys.push(`${dsRel} carries a \`vocabulary\` block`);
  if (Array.isArray(bcr.claims) && bcr.claims.length > 0) answeredKeys.push(`${crRel} carries a \`claims\` array`);
  for (const [rel, doc] of [[dsRel, bds], [crRel, bcr]]) {
    if (!Array.isArray(doc.unresolved) || doc.unresolved.length === 0) {
      answeredKeys.push(`${rel} carries no non-empty \`unresolved\` list`);
    }
  }
  if (answeredKeys.length > 0) {
    problems.push(
      `🔴 the brick's Play declarations have stopped being STAMPED UNANSWERED (${answeredKeys.join('; ')}). A template cannot know what an app it was stamped before does, so a filled-in answer there is a sworn declaration about an app nobody has written — copied into every app the factory stamps from now on. tooling/ci/assert-sworn-store-files.mjs is the guard that specs template-ness and it fails on this too; this guard refuses to grade the template as an app, so if the template really is meant to become an answered declaration, that decision belongs in BOTH files and in the same commit.`,
    );
  }

  // (c) THE SWEEP. The template's own direct dependencies against every tell
  //     any answered declaration names. Floored on the instrument, both sides.
  const pubspecRel = `${BRICK}/pubspec.yaml`;
  const pubspecText = read(pubspecRel);
  if (pubspecText === null) {
    coverageLost([
      `${pubspecRel} does not exist.`,
      'It is the haystack of the factory dependency sweep. With no pubspec the sweep would find nothing and',
      'report the template clean — an absence established by having read nothing, which is true of every',
      'tree including one where the walk is broken.',
    ]);
  }
  const lines = stripSourceComments(pubspecText, '.yaml').split('\n');
  const at = lines.findIndex((l) => /^dependencies:\s*$/.test(l));
  if (at === -1) {
    coverageLost([
      `${pubspecRel} has no top-level \`dependencies:\` block that this parse can find.`,
      'Same reasoning as the app-side parse above: an empty dependency set makes the sweep report the',
      'opposite of the truth — it finds no watched package because it found no package at all.',
    ]);
  }
  const deps = new Set();
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const m = lines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) deps.add(m[1]);
  }
  if (deps.size === 0) {
    coverageLost([
      `${pubspecRel} \`dependencies:\` parsed to ZERO entries.`,
      'See above. The sweep would be an absence over an empty haystack.',
    ]);
  }
  for (const pkg of [...deps].sort()) {
    if (watchedPackages.has(pkg)) {
      problems.push(
        `🔴 ${pubspecRel} declares \`${pkg}\` as a direct dependency of the APP TEMPLATE, and an answered Play declaration in this tree names it as a tell — the package exists to do a thing some Data safety answer says an app does not do. In the template this is not one app's label going false: every app stamped from here inherits the package, while the declaration stamped beside it answers \`null\` for the type it collects. Either the dependency does not belong in the chassis, or the tell is wrong in every declaration that names it. Both are decisions, and neither is silent.`,
      );
    }
  }

  // (d) The permission haystack the template does NOT have, said out loud.
  //     The walk is over whatever manifests exist rather than over a fixed path,
  //     so the limb starts working by itself the day the template gains one.
  const manifests = walk(BRICK).filter((f) => f.endsWith('/AndroidManifest.xml')).sort();
  const perms = new Set();
  for (const f of manifests) {
    for (const m of stripInert(read(f) ?? '').matchAll(/<uses-permission[^>]*android:name\s*=\s*"([^"]+)"/g)) perms.add(m[1]);
  }
  for (const p of [...perms].sort()) {
    if (watchedPermissions.has(p)) {
      problems.push(
        `🔴 the app template declares ${p} in a manifest under ${BRICK}, and an answered Play declaration names it as a tell. A permission in the TEMPLATE is a permission in every app the factory stamps.`,
      );
    }
  }

  return { deps: deps.size, manifests: manifests.length, perms: perms.size, templateIntact: answeredKeys.length === 0 };
})();
CURRENT_ROOT = null;

// ─────────────────────────────────────────────────────────────────────────────
// THE COVERAGE FLOOR, ONE PER ROOT. Reported TOGETHER: a tree can lose two roots
// for two different reasons, and naming only the first sends the reader to fix
// half of it.
// ─────────────────────────────────────────────────────────────────────────────
{
  const lost = [];
  const F = REQUIRED_COVERAGE.app;
  for (const s of summaries) {
    const dir = `apps/${s.app}`;
    if (!IS_FULL_CHECKOUT) continue;
    if (s.answersChecked < F.answers) lost.push(`\`${dir}\` shape-checked only ${s.answersChecked} answer(s), below its floor of ${F.answers} — ${F.label}.`);
    if (s.tellsChecked < F.tells) lost.push(`\`${dir}\` evaluated only ${s.tellsChecked} code tell(s), below its floor of ${F.tells} — the tells are the whole reason the declaration is checkable rather than asserted.`);
    if (s.manifests < F.manifests) lost.push(`\`${dir}\` compared only ${s.manifests} manifest(s), below its floor of ${F.manifests}.`);
    if (s.directDeps < F.directDeps) lost.push(`\`${dir}\` parsed only ${s.directDeps} direct dependenc(ies), below its floor of ${F.directDeps} — the equality that catches an SDK arriving.`);
  }
  const B = REQUIRED_COVERAGE.brick;
  if (IS_FULL_CHECKOUT) {
    if (brick.deps < B.directDeps) lost.push(`\`${BRICK}\` parsed only ${brick.deps} direct dependenc(ies), below its floor of ${B.directDeps} — ${B.label}.`);
    if (watchedPackages.size < B.watchedPackages) {
      lost.push(
        `the answered declarations name only ${watchedPackages.size} watched Dart package(s), below the factory sweep's floor of ${B.watchedPackages} — the sweep's NEEDLE list, not its haystack, and an absence found with no needles is not an absence.`,
      );
    }
  }
  if (lost.length) {
    coverageLost([
      `${lost.length} root-level floor(s) were not met:`,
      ...lost.map((l) => `· ${l}`),
      '',
      'Each root carries its OWN floor deliberately. A single floor over the union of the roots stays',
      'satisfied while a root empties beside a large neighbour — measured on this repository for the TLS',
      'guard, where two of three roots could go to zero under a combined floor the brick alone held up.',
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
for (const s of summaries) {
  if (!s.prints.length) continue;
  console.log('');
  console.log(`   ── apps/${s.app} · printed, not failed (a human owns these; a gap nobody sees becomes permanent) ──`);
  for (const p of s.prints) console.log(`   ⬜ ${p}`);
}
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
for (const s of summaries) {
  if (!s.nulls.length) continue;
  console.log('');
  console.log(`   ── 🔴 apps/${s.app}: THE FORM CANNOT BE SUBMITTED YET ──`);
  for (const n of s.nulls) {
    console.log(`   ❓ ${n.category} > ${n.type} is UNANSWERED (${n.unresolved})`);
    if (n.u) {
      console.log(`      owner: ${n.u.ownerItem} — ${n.u.question}`);
      console.log(`      settle it by: ${n.u.howToResolve}`);
    }
  }
  console.log('   An obviously incomplete declaration is recoverable; a confidently wrong one is a policy');
  console.log('   violation. These stay null until somebody observes the answer.');
}

console.log('');
console.log('   ── what this guard CANNOT see (green is not "the form is right") ──');
console.log('   · WHO CONTRIBUTED EACH MERGED PERMISSION. 🔴 This line said the merged Android manifest had never');
console.log('     been read at all until 2026-08-26; it has been, off the signed .aab of a CI run, and limb 7a');
console.log('     now asserts that reading against pubspec.lock on every run. What is STILL not visible from');
console.log('     here is narrower: no AAR manifest is in this repository or on the measuring host, so one');
console.log('     permission (INTERNET) is carried as a named finding under merged.unattributed and one row is');
console.log('     graded `inferred` rather than `read`. Settle both by having the Android lane upload');
console.log('     build/outputs/logs/manifest-merger-release-report.txt, which names the contributing file for');
console.log('     every merged node. And the reading is ONE BUILD\'S SNAPSHOT: nothing in CI re-downloads its');
console.log('     own .aab, so merged.pinned and merged.expectedButAbsent are what make it fail rather than rot.');
console.log('   · WHAT THE GLITCHTIP SERVER DOES AFTER RECEIPT. What the crash SDK PUTS ON THE WIRE is settled —');
console.log('     it was read from the pinned SDK source (contexts.device.id is a persistent per-install UUID on');
console.log('     Android, ungated by sendDefaultPii) and the pin is compared to pubspec.lock above. What is NOT');
console.log('     visible from here is enrichment on ingest: a Sentry-protocol server can infer geo from the');
console.log('     connecting address, and the instance is self-hosted with no configuration in this repository.');
console.log('     That is why Approximate location under the `demo` posture rests on the analytics rail being off');
console.log('     and nothing else. It cannot change the shipping answer — buildPosture.current is backend-live,');
console.log('     where Approximate location is already true.');
console.log("   · sentry-cocoa's VERSION. It arrives through sentry_flutter's podspec, which is not a file in this");
console.log('     repository, and iOS was out of scope for the 2026-08-21 pass — it stays a dated observation.');
console.log('     🔴 The sentry-ANDROID half of this line said the same thing until 2026-08-21 and is now SOURCED,');
console.log('     so it has moved OUT of this list; only the cocoa half above is still unseen. The source, read');
console.log("     that day: `api 'io.sentry:sentry-android:8.51.0'` at android/build.gradle:65 inside the pinned");
console.log('     sentry_flutter-9.26.0 pub-cache directory, reached through the pub-WORKSPACE');
console.log('     .dart_tool/package_config.json at the REPO ROOT (there is none under apps/subly — Melos 8');
console.log('     resolves the whole tree once). Reading it settles the VERSION and nothing further: whether the');
console.log('     sentry-android AAR itself declares INTERNET was NOT read here — the AAR is not on this host (no');
console.log("     gradle cache; Android builds in WSL) — and sentry_flutter's own android/src/main/");
console.log('     AndroidManifest.xml declares no <uses-permission> of any kind. The Dart pin that drags both');
console.log('     natives in IS asserted.');
console.log("   · Supabase's own auth.users — external project, no migrations in this repo.");
console.log('   · whether Play has changed its data-type vocabulary since the fetch date in the declaration.');
console.log('   · TRANSITIVE Dart dependencies — the equality is over DIRECT ones deliberately.');
console.log('   · the IARC rating — assigned by the rating authorities, never derived here.');
console.log(
  `   · THE TEMPLATE'S NATIVE PERMISSIONS AND iOS USAGE KEYS. ${BRICK} carries no android/, ios/ or macos/ ` +
    'tree — `flutter create` writes those after the stamp — so the factory sweep found ' +
    `${brick.manifests} manifest(s) there and could test NONE of the ${watchedPermissions.size} watched Android ` +
    'permission(s) against it. The dependency half of the sweep IS asserted, and the manifest walk is over ' +
    'whatever exists rather than a fixed path, so this limb starts working by itself the day the template ' +
    'gains a native tree. Said out loud rather than left to be inferred from an ok line.',
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  [pipeline K-8 / G-32] The Data safety label is a sworn declaration about what the code does.');  // G-32: (absent from origins.lock.json by construction — a MASTER_PLAN §3 gap id, never a pipeline heading). Kept out of the printed string: CI output is for the failure, not for citation bookkeeping.
  console.error('  Google: "The developer is responsible for the accuracy of the label."');
  console.error('\nassert-play-declarations: FAILED');
  process.exitCode = 1;
} else {
  console.log('');
  console.log(
    `ok   play declarations — ${summaries.length} answered app root(s) + the brick template` +
      (IS_FULL_CHECKOUT ? '' : ' (this root is NOT a checkout of this repository, so the per-root floors were NOT applied — only the structural "every root delivered a subject" checks ran)'),
  );
  for (const s of summaries) {
    const dir = `apps/${s.app}`;
    console.log(
      `ok   ${dir} — ${s.answersChecked}/${s.vocabTypes} Play data type(s) answered across ${s.postures} build posture(s); ` +
        `lane posture "${s.current}" confirmed against ${s.lane} (defines: ${s.laneDefines})`,
    );
    console.log(
      `ok   ${dir} — ${s.tellsChecked} code tell(s) + ${s.clientAbsenceChecked} client-absence tell(s) evaluated against ` +
        `${s.manifests} manifest(s), ${s.directDeps} direct dependenc(ies) and ${s.usageKeys} iOS usage key(s); ` +
        `${s.evidenceChecked} evidence path(s) resolve; ${s.citationsChecked} citation(s) sourced to an allowed host` +
        (IS_FULL_CHECKOUT
          ? ` [floors: answers ${s.answersChecked}/${REQUIRED_COVERAGE.app.answers}, tells ${s.tellsChecked}/${REQUIRED_COVERAGE.app.tells}, manifests ${s.manifests}/${REQUIRED_COVERAGE.app.manifests}, deps ${s.directDeps}/${REQUIRED_COVERAGE.app.directDeps}]`
          : ''),
    );
    console.log(
      `ok   ${dir} — ${s.pinsChecked} crash-SDK version pin(s) match ${s.crashLock}; ` +
        `${s.resolvedChecked} settled question(s) re-checked against their answer rows (none has drifted back to null)`,
    );
    console.log(
      `ok   ${dir} — ${s.mergedPermsChecked} MERGED manifest permission(s) graded (measured from run ${s.mergedRunId}, ` +
        `${s.mergedOn}); ${s.mergedPinsChecked} merged-manifest version pin(s) match ${s.mergedLockRel}; ` +
        `${s.mergedAbsencesChecked} predicted-but-absent permission(s) still absent`,
    );
    console.log(
      `ok   ${dir} — ${s.mappingChecked} personal-data inventory row(s) each mapped to a Play data type or excluded with a reason; ` +
        `${s.erasureRoutesChecked} erasure route(s) derived from the inventory still exist; ${s.dartScanned} client Dart file(s) carry no plaintext endpoint`,
    );
    console.log(`ok   ${dir} — ${s.claimsChecked} content-rating claim(s) checked; assignedRating is ${JSON.stringify(s.assignedRating)}`);
  }
  console.log(
    `ok   THE FACTORY — ${BRICK} still stamps UNANSWERED declarations; its ${brick.deps} direct dependenc(ies)` +
      (IS_FULL_CHECKOUT ? ` (floor ${REQUIRED_COVERAGE.brick.directDeps})` : '') +
      ` and ${brick.perms} template permission(s) across ${brick.manifests} manifest(s) carry NONE of the ` +
      `${watchedPackages.size} watched package(s)` +
      (IS_FULL_CHECKOUT ? ` (floor ${REQUIRED_COVERAGE.brick.watchedPackages})` : '') +
      ` or ${watchedPermissions.size} watched permission(s) the answered declarations name`,
  );
  console.log('\nassert-play-declarations: ok');
}
