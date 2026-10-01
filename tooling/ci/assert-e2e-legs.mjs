#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-e2e-legs.mjs — the nightly must have EXERCISED the legs it claims.
//
// [pipeline N-6, clause 4] Private/requirements/ (was pipeline/06-app-build.md,
// folded into that JSON spec 2026-08-15)
//
// A green tick is not coverage. `assert-e2e-proof-fresh.mjs` (clause 1/3) proves
// the nightly RAN, recently, on its timer. It cannot prove the suite it ran walks
// the golden path, and on 2026-07-29 it demonstrably did not: N-6 names a
// SIX-LEG path — anonymous → sign in → purchase (sandbox) → entitlement flips →
// feature unlocks → account delete purges — and the only implementation of it in
// the tree, apps/subscriptiontracker/integration_test/app_test.dart, declares two tests and
// proves two legs. A green, non-skipped, FRESH run still would not mean what N-6
// says. So freshness and coverage are two guards, because they are two claims.
//
// ── THE RELATIONSHIP, NOT A COUNT ───────────────────────────────────────────
// A count is a number somebody types, and this repo has already shipped a
// scanner that counted a name inside a comment. What is checked instead is an
// EQUALITY between a claim and the tree:
//
//   for every leg the register marks `asserted`, every one of its `anchors`
//   must resolve in the E2E's COMMENT-STRIPPED source
//     ⇒ legs-claimed-asserted == legs-the-suite-actually-proves
//
// Delete the onboarding leg from the suite and the register still says two; the
// anchors stop resolving and the equality breaks. That is the direction that
// matters, because overclaiming is what N-6 was doing.
//
// 🔴 COMMENT-STRIPPING IS LOAD-BEARING, NOT HOUSEKEEPING. app_test.dart's own
// header narrates the six-night outage and contains the literal string
// `tap('Skip')` inside a `///` comment describing the bug. A raw `includes()`
// would resolve the onboarding anchor against THE PROSE ABOUT THE FAILURE and
// report the leg proven on a suite with every test deleted. That is not a
// hypothetical: `assert-clone-contract.mjs` matched a template comment explaining
// why there was no r2_buckets, and `assert-seams-wired.mjs` shipped with its
// caller check matching the function's own declaration. Same family, third time.
//
// ── A BLOCKED LEG'S EXCUSE IS ITSELF CHECKED ────────────────────────────────
// Copied in intent from `assert-screen-set.mjs`'s BLOCKERS_STILL_REAL. A leg that
// is not asserted must name a blocker, and the blocker is a PREDICATE evaluated
// against the real tree on every run — not a string. If it has shipped, the build
// fails, because "blocked by the money rail" must not outlive the money rail. The
// four blocked legs also PRINT on every run: a gap nobody sees is a gap nobody
// closes, and four sixths of this requirement is currently a gap.
//
// ⚠️ STATED LIMIT, so nobody reads this as more than it is. This guard proves
// that a leg the register CLAIMS is really exercised, and that an excuse is
// really still true. It cannot prove the converse — that a leg quietly covered by
// the suite has been promoted in the register — because the only signal for that
// would be anchors written for tests nobody has written, and an anchor guessed in
// advance is satisfied or missed by coincidence. The blocker predicates are what
// close that direction instead: they are tied to the RAIL, so the day apps/subscriptiontracker
// ships a paywall or a delete-account call site, the excuse dies and this guard
// demands the leg be covered or restated. An assertion that could only pass by
// luck would inflate apparent coverage, which this repo deletes on sight.
//
// ── THE TARGET AXIS (limb NATIVE, ⏱ 2026-09-29, AB-E2E-02) ──────────────────
// Every leg above is graded on web only, and until today nothing graded a
// target at all. The native targets are DERIVED — the platforms of every
// `surface: app` channel of tooling/channel-register.json, minus web — never
// listed here, so a target the catalog gains is ungraded by nobody's choice.
// For each, the register's `nativeTargets.targets` must say, for anonymous,
// sign-in AND account-delete-purges, either `leg` (e2e.yml's native job runs
// the native-auth-proof drive there on a declared schedule) or `equivalent`
// (a named web leg that is asserted, and why it carries over). A target with
// neither is COVERAGE LOST (exit 2): the golden path was not checked there at
// all. A `leg` nothing runs — the job gone, the target out of its matrix, the
// drive not called, or an `if:` naming a cron the workflow does not declare —
// is a finding (exit 1), as is an anchor that stopped resolving.
//
// Usage:  node tooling/ci/assert-e2e-legs.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { requireAppSet } from './app-set.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/e2e-leg-register.json';

/** N-6's golden path, verbatim, as an ORDERED FIXED SET.
 *
 *  Not a floor and not a minimum: the requirement names these six and only these
 *  six. A floor (`>= 2`) would let somebody delete the four inconvenient legs and
 *  pass; an exact set means a leg can only leave this file by the requirement
 *  changing. That is the `REQUIRED_COVERAGE` idea from `check-migrations.mjs`,
 *  which silently dropped from 5 files to 4 and reported PASS. */
const REQUIRED_LEGS = [
  'anonymous',
  'sign-in',
  'purchase-sandbox',
  'entitlement-flip',
  'feature-unlock',
  'account-delete-purges',
];

/** Blocker claims, each a PREDICATE over the real tree — never a string.
 *
 *  `true`  → the blocker is still real, the leg is legitimately uncovered.
 *  `false` → it has SHIPPED; the excuse is dead and any leg still claiming it
 *            fails the build.
 *
 *  Each reads COMMENT-STRIPPED source, for the reason in this file's header. */
const BLOCKERS_STILL_REAL = {
  // apps/subscriptiontracker declares `PaywallConfig(enabled: false)` — the app sells nothing,
  // so there is nothing to purchase, no entitlement to flip and no feature to
  // unlock. Three legs share this one blocker because they share one cause.
  //
  // The signal is the app's OWN declaration rather than an absence, deliberately:
  // "no paywall widget appears anywhere" is satisfied by a typo, whereas this
  // line has to be edited to `true` by somebody switching the rail on — and on
  // that day all three legs stop being excusable in the same run.
  '[5] apps/subscriptiontracker sells nothing': (src) => /PaywallConfig\(\s*enabled:\s*false/.test(src.subscriptiontracker),

  // 🔄 RESTATED 2026-08-04, AND THIS IS THE SECOND TIME THIS GUARD HAS KILLED ITS
  // OWN EXCUSE — which is the whole design working twice.
  //
  //   · v1 read "[6] apps/subscriptiontracker has no delete-account call site", predicate
  //     `!src.subscriptiontracker.includes('.deleteAccount(')`. [ADR 027] shipped the control,
  //     the predicate went false, the build failed, and it was replaced.
  //   · v2 read "[6] no deployed route erases apps/subscriptiontracker own database",
  //     predicate `no account route under services/subscriptiontracker-api/src/routes AND the
  //     platform route touches only PLATFORM_DB`. BOTH HALVES ARE NOW FALSE:
  //     services/subscriptiontracker-api ships DELETE /v1/account (behind an asymmetric-only
  //     boundary — the HS256 fallback that blocked it is refused by
  //     `erasureAuth` and by the route's own `tokenAssurance` check), and the
  //     shared route relays to it before deleting the identity. The four
  //     subly_db rows in tooling/legal/data-inventory.json are `purge`, and
  //     tooling/ci/assert-erasure-reach.mjs keeps them that way.
  //
  //   · v3 read "[7] no e2e step exercises the erasure route against the
  //     deployed API", predicate `nothing in the E2E surface names /v1/account`.
  //     IT WENT FALSE ON 2026-08-08 AND THE LEG WAS PROMOTED RATHER THAN
  //     RE-EXCUSED: app_test.dart's third test deletes a real account from
  //     inside the running app, and tooling/e2e/verify_purged.mjs re-reads live
  //     D1 and the GoTrue admin API afterwards. Three excuses, three deaths, and
  //     the third one is the leg actually shipping.
  //
  // 🔴 THE PREDICATE IS KEPT, AND IT IS NOT DEAD. No leg names it today, so it
  // is not consulted on a passing run — but it is one register edit away from
  // being consulted again, and that is exactly the input that must fail: marking
  // `account-delete-purges` blocked by this sentence, while the erasure step is
  // still in the tree, is how a shipped leg would be quietly demoted back to a
  // gap. `e2e-legs.test.mjs` mutates the real tree that way and requires a red
  // build. Deleting the entry instead would make that demotion pass with a
  // "blocker with no predicate" message about a sentence, rather than with the
  // truth, which is that the excuse is dead.
  //
  // ⚠️ NOT "the routes are not deployed yet", although that was also true when
  // this was written. A deploy is not readable from this tree, so it could never
  // be re-evaluated — and an excuse that cannot go false is the thing this table
  // exists to refuse.
  '[7] no e2e step exercises the erasure route against the deployed API': (src) =>
    !/\/v1\/account/.test(src.e2eSurface),
};

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
};

// ── the register ────────────────────────────────────────────────────────────
const registerPath = join(ROOT, REGISTER_REL);
if (!existsSync(registerPath)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the right-hand side of N-6\'s leg equality. Without it the requirement quantifies over',
    'nothing again, which is the state this guard was built to end.',
  ]);
}
let reg;
try {
  reg = JSON.parse(readFileSync(registerPath, 'utf8'));
} catch (e) {
  coverageLost([
    `${REGISTER_REL} could not be parsed (${e.message}).`,
    'An unreadable register is an undeclared one; every leg claim below would be checked against nothing.',
  ]);
}

const legs = Array.isArray(reg.legs) ? reg.legs : [];
const ids = legs.map((l) => l && l.id);
const missing = REQUIRED_LEGS.filter((r) => !ids.includes(r));
const extra = ids.filter((i) => !REQUIRED_LEGS.includes(i));
if (missing.length || extra.length) {
  coverageLost([
    `${REGISTER_REL} does not declare N-6's six legs exactly.`,
    ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
    ...(extra.length ? [`unexpected: ${extra.join(', ')}`] : []),
    'The requirement names six and only six. Trimming the list is how a coverage relationship becomes',
    'a tautology — the four uncovered legs are exactly the ones it would be convenient to delete.',
  ]);
}

// ── the app under test ──────────────────────────────────────────────────────
// ⏱ 2026-09-25 (O-E2E-LANE-WIRED-TO-ONE-APP): the register is keyed by app,
// `apps.<id>`. The legs above are still one app's six, so exactly one entry is
// graded; any other count is COVERAGE LOST, never a guess at which app they mean.
const appEntries =
  reg.apps && typeof reg.apps === 'object' && !Array.isArray(reg.apps) ? Object.entries(reg.apps) : [];
if (appEntries.length !== 1) {
  coverageLost([
    `${REGISTER_REL} names ${appEntries.length} app(s) under \`apps\`; this guard grades exactly one.`,
    "The six legs are one app's, anchored in one suite. With no app there is no suite to resolve them",
    "against; with two, a leg one app's suite proves would be credited to the other.",
  ]);
}
const [, E2E] = appEntries[0];

// ── the suite under test ────────────────────────────────────────────────────
const testRel = E2E?.test;
if (typeof testRel !== 'string' || testRel.length === 0) {
  coverageLost([`${REGISTER_REL} names no \`apps.<id>.test\`, so there is no suite to resolve anchors against.`]);
}
const testPath = join(ROOT, testRel);
if (!existsSync(testPath)) {
  coverageLost([
    `the named E2E ${testRel} does not exist.`,
    'Every anchor below would fail to resolve for the same reason, so the message would blame the',
    'register for a missing file. Named separately so the real cause is the one printed.',
  ]);
}
const suite = stripSourceComments(readFileSync(testPath, 'utf8'), '.dart');

// RESOLVE, DO NOT MATCH. A file of comments is not a test suite: after stripping,
// the source must still declare at least one real `testWidgets(`. Without this,
// gutting app_test.dart down to its header would leave anchors unresolvable and
// the failure would read as a register problem rather than as a deleted suite.
if (!/\btestWidgets\s*\(/.test(suite)) {
  coverageLost([
    `${testRel} declares no \`testWidgets(\` once comments are stripped.`,
    'The named E2E is not a suite any more. Anchors cannot be resolved against a file that runs',
    'nothing, and a green nightly over it would prove only that Flutter started.',
  ]);
}

// The workflow must still be the one that runs this suite. The register names
// both; if they have drifted, "the leg is proven nightly" is proven by nothing.
const wfRel = E2E?.workflow;
if (typeof wfRel !== 'string' || !existsSync(join(ROOT, wfRel))) {
  coverageLost([
    `${REGISTER_REL} names workflow ${JSON.stringify(wfRel)}, which does not exist.`,
    'The legs below are only proven if something runs them on a schedule.',
  ]);
}
const workflow = readFileSync(join(ROOT, wfRel), 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');
if (!workflow.includes(testRel.split('/').slice(-2).join('/'))) {
  coverageLost([
    `${wfRel} does not name ${testRel}.`,
    'The register claims this workflow runs this suite. It does not, so every leg marked asserted is',
    'proven by a test nothing schedules.',
  ]);
}

// ── the blocker predicates' inputs ──────────────────────────────────────────
// Read once, comment-stripped once, and handed to every predicate.
const APP_DIR = E2E?.app ?? 'apps/subscriptiontracker';
const readDartTree = (dir) => {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) out.push(stripSourceComments(readFileSync(p, 'utf8'), '.dart'));
    }
  };
  walk(join(ROOT, dir));
  return out.join('\n');
};

/** THE E2E SURFACE — everything that could carry a delete-account step: the
 *  named integration suite plus the whole nightly harness under tooling/e2e/.
 *
 *  🔴 IT REPLACED A SERVER-SIDE PAIR (`no account route under
 *  services/subscriptiontracker-api/src/routes` AND `the platform route touches only
 *  PLATFORM_DB`) WHEN BOTH WENT FALSE ON 2026-08-04. Those reads are gone rather
 *  than kept: an input no predicate consults is a COVERAGE LOST that guards
 *  nothing, and this repository deletes assertions that cannot fail on sight. The
 *  server gap they described is now held by
 *  tooling/ci/assert-erasure-reach.mjs, which fails the build if any table with a
 *  `user_id` stops being reachable — a stronger relation than the one this file
 *  was carrying on its behalf.
 *
 *  Comment-stripped for the same reason everything here is: app_test.dart's
 *  header narrates what the suite does NOT do, and a raw scan would resolve the
 *  blocker against the prose describing the gap. */
const E2E_HARNESS = 'tooling/e2e';
const harnessDir = join(ROOT, E2E_HARNESS);
if (!existsSync(harnessDir)) {
  coverageLost([
    `${E2E_HARNESS} does not exist.`,
    "The delete leg's blocker asks whether any nightly step exercises the erasure route. Over a missing",
    'directory the answer is "no step" for a reason that has nothing to do with erasure, and the excuse',
    'would outlive the harness being deleted.',
  ]);
}
const harnessFiles = listDir(harnessDir).filter((f) => /\.(mjs|js|ts|dart)$/.test(f));
if (harnessFiles.length === 0) {
  coverageLost([
    `${E2E_HARNESS} holds no script this scan can read.`,
    'A predicate over an empty string answers "still blocked" whatever the truth is — this repository\'s',
    'single most repeated failure.',
  ]);
}
const e2eSurface = [
  suite,
  ...harnessFiles.map((f) => stripSourceComments(readFileSync(join(harnessDir, f), 'utf8'), '.js')),
].join('\n');

const sources = {
  subscriptiontracker: readDartTree(join(APP_DIR, 'lib')),
  e2eSurface,
};
if (sources.subscriptiontracker.trim().length === 0) {
  coverageLost([
    `no Dart source was read under ${APP_DIR}/lib.`,
    'Every blocker predicate below reads that tree, and a predicate over an empty string answers',
    '"still blocked" for reasons that have nothing to do with the blocker. A scan over nothing prints',
    'ok — this repo\'s single most repeated failure.',
  ]);
}

// ── the equality ────────────────────────────────────────────────────────────
let proven = 0;
const asserted = [];
const blocked = [];

for (const leg of legs) {
  if (leg.status === 'asserted') {
    asserted.push(leg);
    const anchors = Array.isArray(leg.anchors) ? leg.anchors : [];
    if (anchors.length === 0) {
      problems.push(
        `\`${leg.id}\` is marked asserted with no anchors. An unanchored claim is exactly the "the record ` +
          'names an E2E" acceptance that N-6 already had and that could not fail.',
      );
      continue;
    }
    const unresolved = anchors.filter((a) => !suite.includes(a));
    if (unresolved.length) {
      problems.push(
        `\`${leg.id}\` claims to be asserted, but ${unresolved.length} of its ${anchors.length} anchor(s) ` +
          `no longer resolve in ${testRel} (comment-stripped): ${unresolved.map((u) => JSON.stringify(u)).join(', ')}. ` +
          'The register claims more coverage than the suite carries — either the suite lost the leg, or ' +
          'the anchors were never what proved it.',
      );
      continue;
    }
    proven++;
  } else if (leg.status === 'blocked') {
    blocked.push(leg);
    if (!leg.blockedBy) {
      problems.push(`\`${leg.id}\` is BLOCKED with no \`blockedBy\`. An unexplained block is indistinguishable from work nobody did.`);
      continue;
    }
    const stillReal = BLOCKERS_STILL_REAL[leg.blockedBy];
    if (typeof stillReal !== 'function') {
      problems.push(
        `\`${leg.id}\` claims to be blocked by "${leg.blockedBy}", which has no predicate in ` +
          'BLOCKERS_STILL_REAL. A blocker nothing evaluates is a sentence, and it would sit here looking ' +
          'checked forever.',
      );
      continue;
    }
    if (!stillReal(sources)) {
      problems.push(
        `\`${leg.id}\` claims to be blocked by "${leg.blockedBy}", but that blocker has SHIPPED. ` +
          'Cover the leg in the E2E or restate the block — otherwise the excuse outlives its reason.',
      );
    }
  } else {
    problems.push(
      `\`${leg.id}\` has unknown status ${JSON.stringify(leg.status)} (expected asserted / blocked). ` +
        'A third state is a third place for a leg to hide.',
    );
  }
}

// ── every app in the workspace set carries the suite (10b) ──────────────────
// ⏱ 2026-09-27 (O-BRICK-STAMPS-NO-E2E-SUITE, 10b). The legs above are one app's,
// graded against the register's one `apps.<id>` entry. The SUITE is every app's:
// the brick stamps `integration_test/app_test.dart`, and the e2e lane drives each
// app of tooling/ci/app-set.mjs's set by `E2E_APP_ID`. An app of the set without
// it is a leg nobody can run for that app — exit 1, naming the file. An empty or
// unreadable set is COVERAGE LOST.
const APP_SET = requireAppSet(ROOT, 'assert-e2e-legs');
for (const { dir } of APP_SET) {
  const rel = `${dir}/integration_test/app_test.dart`;
  if (!existsSync(join(ROOT, rel))) {
    problems.push(
      `${rel} is missing. ${dir} is in the workspace app set, and the e2e lane drives every app of the set ` +
        'with its own suite: without it this app has no e2e leg at all. The brick stamps one; restore it.',
    );
  }
}

// ── every E2E_ define a suite reads, the lane passes (LEAD RULING 34) ───────
// ⏱ 2026-09-28 (ST-T2 rider). A suite reads its inputs with
// `String.fromEnvironment('E2E_…')`, and a define the lane does not pass
// arrives as '' — silently. MEASURED: the brick's stamped suite asserts
// `E2E_APP_ID` names the binary it drives (the two-leg e2e confirm), and
// e2e.yml's `flutter drive` passed every other E2E_ define but not that one,
// so every stamped app's e2e would fail its first line with "passed no app at
// all". The subject is every suite of the app set plus the brick's template,
// comment-stripped; the passed set is the workflow's `--dart-define=NAME=`.
const brickSuiteRel = 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/app_test.dart';
const definesRead = new Map(); // name -> [suite rel]
for (const rel of [...APP_SET.map(({ dir }) => `${dir}/integration_test/app_test.dart`), brickSuiteRel]) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue; // a missing app suite is reported above; the brick is optional here
  const src = stripSourceComments(readFileSync(abs, 'utf8'), '.dart');
  for (const m of src.matchAll(/\b(?:String|bool|int)\.fromEnvironment\(\s*'(E2E_[A-Z0-9_]+)'/g)) {
    if (!definesRead.has(m[1])) definesRead.set(m[1], []);
    if (!definesRead.get(m[1]).includes(rel)) definesRead.get(m[1]).push(rel);
  }
}
const definesPassed = new Set([...workflow.matchAll(/--dart-define=(E2E_[A-Z0-9_]+)=/g)].map((m) => m[1]));
for (const [name, readers] of [...definesRead.entries()].sort()) {
  if (!definesPassed.has(name)) {
    problems.push(
      `${readers.join(', ')} read(s) --dart-define ${name}, and ${wfRel} never passes it: the suite would read '' ` +
        'and run against an input nobody set. Pass it on the flutter drive line (and declare it in ' +
        'tooling/publishable-inputs.json), or stop reading it.',
    );
  }
}

// ── limb NATIVE: every native catalog target, leg or declared equivalent ────
// (AB-E2E-02; see the header). Exit 2 for a target nothing declares, exit 1
// for a declaration the tree does not back.
const CHANNELS_REL = 'tooling/channel-register.json';
const NATIVE_LEGS = ['anonymous', 'sign-in', 'account-delete-purges'];
let channels;
try {
  channels = JSON.parse(readFileSync(join(ROOT, CHANNELS_REL), 'utf8')).channels;
} catch (e) {
  coverageLost([
    `${CHANNELS_REL} could not be read (${e.message}).`,
    'It is the catalog of targets the native legs are graded against. Without it there is no target axis.',
  ]);
}
const nativeTargets = [
  ...new Set(
    (Array.isArray(channels) ? channels : [])
      .filter((c) => c && c.surface === 'app')
      .flatMap((c) => (Array.isArray(c.platforms) ? c.platforms : []))
      .filter((p) => p !== 'web'),
  ),
].sort();
if (nativeTargets.length === 0) {
  coverageLost([
    `${CHANNELS_REL} names no native platform on any \`surface: app\` channel.`,
    'A target axis over nothing grades nothing, and would print ok over a catalog it never read.',
  ]);
}
const NT = reg.nativeTargets && typeof reg.nativeTargets === 'object' ? reg.nativeTargets : {};
const declaredTargets = NT.targets && typeof NT.targets === 'object' ? NT.targets : {};
const undeclared = [];
for (const t of nativeTargets) {
  const row = declaredTargets[t];
  const gaps = NATIVE_LEGS.filter((l) => !row || (row[l] !== 'leg' && row[l] !== 'equivalent'));
  if (gaps.length) undeclared.push(`${t}: ${gaps.join(', ')}`);
}
if (undeclared.length) {
  coverageLost([
    `${nativeTargets.length} native catalog target(s) (${nativeTargets.join(', ')}) and ${undeclared.length} with a golden-path leg that has neither a leg nor a declared equivalent:`,
    ...undeclared.map((u) => `  · ${u}`),
    `Declare each in ${REGISTER_REL} nativeTargets.targets as "leg" (e2e.yml's native job runs it there) or`,
    '"equivalent" (nativeTargets.equivalents names the asserted web leg that carries over, and why).',
    'Until then the target\'s golden path was not checked at all — that is not a pass.',
  ]);
}
for (const t of Object.keys(declaredTargets)) {
  if (!nativeTargets.includes(t)) {
    problems.push(
      `${REGISTER_REL} nativeTargets.targets declares "${t}", which no \`surface: app\` channel of ${CHANNELS_REL} ships to. ` +
        'A declaration for a target the catalog does not have is a leg graded against nothing.',
    );
  }
}

const legTargets = nativeTargets.filter((t) => NATIVE_LEGS.some((l) => declaredTargets[t][l] === 'leg'));
const eqLegs = [...new Set(nativeTargets.flatMap((t) => NATIVE_LEGS.filter((l) => declaredTargets[t][l] === 'equivalent')))];
for (const l of eqLegs) {
  const eq = NT.equivalents?.[l];
  const webLeg = legs.find((x) => x && x.id === l);
  if (!eq || eq.provenBy !== 'web' || !Array.isArray(eq.why) || eq.why.join('').trim() === '') {
    problems.push(
      `a native target declares "${l}" as an equivalent, and nativeTargets.equivalents["${l}"] does not name ` +
        '`provenBy: "web"` with a non-empty `why`. An equivalent nobody can trace is an excuse.',
    );
  } else if (!webLeg || (webLeg.status !== 'asserted' && webLeg.status !== 'blocked')) {
    problems.push(
      `a native target declares "${l}" as proven on web, and the web leg "${l}" is ${webLeg ? `\`${webLeg.status}\`` : 'absent'}, not asserted. ` +
        'An equivalent to a leg nobody proves is no proof on either target.',
    );
  } else if (webLeg.status === 'blocked') {
    // Graded by the leg loop above (its blocker must still be real); on every
    // target it is then the same gap, and it prints as one — never a pass.
    notes.push(`⬜ native targets inherit "${l}" from web, where it is BLOCKED (${webLeg.blockedBy}): unproven on every target.`);
  }
}

let nativeJobCrons = [];
if (legTargets.length) {
  const nwfRel = NT.workflow;
  const nwf = typeof nwfRel === 'string' ? parseWorkflow(ROOT, nwfRel) : null;
  const job = nwf?.jobs.get(NT.job);
  if (!nwf) {
    problems.push(`nativeTargets.workflow ${JSON.stringify(nwfRel)} does not exist, and ${legTargets.join(', ')} declare legs it would run.`);
  } else if (!job) {
    problems.push(`${nwfRel} has no job \`${NT.job}\`, and ${legTargets.join(', ')} declare native legs it runs: undeclared-by-the-tree legs nothing runs.`);
  } else {
    const body = job.lines.map((l) => l.text);
    // The matrix `target:` block list — `- android` items under a bare `target:`.
    const listed = [];
    const at = body.findIndex((l) => /^\s+target:\s*$/.test(l));
    if (at !== -1) {
      for (const l of body.slice(at + 1)) {
        const m = l.match(/^\s+-\s+([a-z0-9_-]+)\s*$/);
        if (!m) break;
        listed.push(m[1]);
      }
    }
    const notListed = legTargets.filter((t) => !listed.includes(t));
    if (notListed.length) {
      problems.push(
        `${nwfRel} job \`${NT.job}\` does not list ${notListed.join(', ')} in its matrix \`target:\`, and the register says ` +
          'a leg runs there. A leg the matrix never schedules is a leg that never runs.',
      );
    }
    const drive = typeof NT.drive === 'string' ? NT.drive : '';
    if (!drive || !job.logical.some((l) => l.text.includes(`node ${drive}`))) {
      problems.push(`${nwfRel} job \`${NT.job}\` does not run \`node ${drive || '(nativeTargets.drive unset)'}\` — the drive the register says proves the native legs.`);
    }
    const declaredCrons = [...nwf.lines.map((l) => l.text).join('\n').matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map((m) => m[1].trim());
    nativeJobCrons = [...(job.jobIf?.cond ?? '').matchAll(/github\.event\.schedule\s*==\s*'([^']+)'/g)].map((m) => m[1].trim());
    const cond = job.jobIf?.cond ?? null;
    const onTimer =
      cond === null ||
      /github\.event_name\s*==\s*'schedule'/.test(cond) ||
      (nativeJobCrons.length > 0 && nativeJobCrons.every((c) => declaredCrons.includes(c)));
    if (!onTimer) {
      problems.push(
        `${nwfRel} job \`${NT.job}\` starts only on \`${cond}\`, which no declared cron (${declaredCrons.join(', ') || 'none'}) satisfies. ` +
          'The native legs it carries never run: declared, and never run.',
      );
    }
  }
  // The anchors, in every graded app's native suite, comment-stripped.
  const suiteRel = `${APP_DIR}/${NT.suite}`;
  if (typeof NT.suite !== 'string' || !existsSync(join(ROOT, suiteRel))) {
    problems.push(`the native suite ${suiteRel} does not exist, and ${legTargets.join(', ')} declare legs it proves.`);
  } else {
    const nsuite = stripSourceComments(readFileSync(join(ROOT, suiteRel), 'utf8'), '.dart');
    const legIds = [...new Set(legTargets.flatMap((t) => NATIVE_LEGS.filter((l) => declaredTargets[t][l] === 'leg')))];
    for (const l of legIds) {
      const anchors = Array.isArray(NT.legAnchors?.[l]) ? NT.legAnchors[l] : [];
      const unresolved = anchors.filter((a) => !nsuite.includes(a));
      if (anchors.length === 0) problems.push(`native leg "${l}" has no nativeTargets.legAnchors: an unanchored native claim cannot fail.`);
      else if (unresolved.length) {
        problems.push(
          `native leg "${l}": ${unresolved.length} of ${anchors.length} anchor(s) no longer resolve in ${suiteRel} (comment-stripped): ` +
            `${unresolved.map((u) => JSON.stringify(u)).join(', ')}.`,
        );
      }
    }
    // AB-O1-05 — the offline read, on the native suite and the web suite.
    const off = NT.offlineRead;
    if (off) {
      for (const [where, src, list] of [[suiteRel, nsuite, off.anchors], [testRel, suite, off.webAnchors]]) {
        const a = Array.isArray(list) ? list : [];
        const miss = a.filter((x) => !src.includes(x));
        if (a.length === 0 || miss.length) {
          problems.push(
            `nativeTargets.offlineRead: ${a.length === 0 ? 'no anchors' : `${miss.map((m) => JSON.stringify(m)).join(', ')} no longer resolve`} in ${where} (comment-stripped). ` +
              'The list surviving with the network off is then proven on no real target.',
          );
        }
      }
    }
  }
}

// ── limb OAUTH-RETURN (⏱ 2026-10-01 · AB-A1-02) ────────────────────────────
// Every job of native-auth-proof.yml ran --expect-refusal after #1070, which
// starts no app, so the `--callback` they passed was never reached and no
// native build had been watched taking an auth callback. The OAuth return is
// its own leg now (nativeTargets.oauthReturn): per native catalog target, a
// job that runs the drive with `--oauth-return --target <t>`, or a named wait.
// assert-deletion-control.mjs reads the same block: a provider re-auth ships on
// a native target only where this leg runs.
const OR = NT.oauthReturn && typeof NT.oauthReturn === 'object' ? NT.oauthReturn : null;
const orRows = OR?.targets && typeof OR.targets === 'object' ? OR.targets : null;
if (!orRows) {
  coverageLost([
    `${REGISTER_REL} nativeTargets.oauthReturn.targets is absent.`,
    'It is the per-target record of where an OAuth return is proven to land in the app. Without it no native',
    'target\'s callback was checked at all — that is not a pass.',
  ]);
}
const orUngraded = nativeTargets.filter((t) => orRows[t]?.status !== 'leg' && orRows[t]?.status !== 'waits');
if (orUngraded.length) {
  coverageLost([
    `${orUngraded.length} native catalog target(s) with no OAuth-return grade in ${REGISTER_REL} nativeTargets.oauthReturn.targets: ${orUngraded.join(', ')}.`,
    'Declare each "leg" (with the native-auth-proof.yml `job` that runs it) or "waits" (with `waitsFor`).',
  ]);
}
const orLegs = nativeTargets.filter((t) => orRows[t].status === 'leg');
for (const t of nativeTargets.filter((x) => orRows[x].status === 'waits')) {
  if (typeof orRows[t].waitsFor !== 'string' || orRows[t].waitsFor.trim() === '') {
    problems.push(`nativeTargets.oauthReturn ${t} waits, and names no \`waitsFor\`: a wait nobody can trace is an excuse.`);
  }
}
if (orLegs.length) {
  const orWf = typeof OR.workflow === 'string' ? parseWorkflow(ROOT, OR.workflow) : null;
  const drive = typeof OR.drive === 'string' ? OR.drive : '';
  if (!orWf) {
    problems.push(`nativeTargets.oauthReturn.workflow ${JSON.stringify(OR.workflow)} does not exist, and ${orLegs.join(', ')} declare OAuth-return legs it would run.`);
  } else {
    for (const t of orLegs) {
      const job = orWf.jobs.get(orRows[t].job);
      const runs = job?.logical.some(
        (l) => drive && l.text.includes(`node ${drive}`) && l.text.includes('--oauth-return') && new RegExp(`--target ${t}(?![\\w-])`).test(l.text),
      );
      if (!runs) {
        problems.push(
          `${OR.workflow} job \`${orRows[t].job}\` ${job ? 'does not run' : 'does not exist to run'} \`node ${drive || '(oauthReturn.drive unset)'} … --target ${t} … --oauth-return\`, ` +
            `and the register says ${t}'s OAuth return is a leg. A leg nothing runs proves no return.`,
        );
      }
    }
  }
  const orSuiteRel = `${APP_DIR}/${OR.suite}`;
  if (typeof OR.suite !== 'string' || !existsSync(join(ROOT, orSuiteRel))) {
    problems.push(`the OAuth-return suite ${orSuiteRel} does not exist, and ${orLegs.join(', ')} declare legs it proves.`);
  } else {
    const orSuite = stripSourceComments(readFileSync(join(ROOT, orSuiteRel), 'utf8'), '.dart');
    const anchors = Array.isArray(OR.anchors) ? OR.anchors : [];
    const miss = anchors.filter((a) => !orSuite.includes(a));
    if (anchors.length === 0 || miss.length) {
      problems.push(
        `nativeTargets.oauthReturn: ${anchors.length === 0 ? 'no anchors' : `${miss.map((m) => JSON.stringify(m)).join(', ')} no longer resolve`} in ${orSuiteRel} (comment-stripped). ` +
          'An OAuth-return leg whose suite no longer waits for the return proves nothing on any target.',
      );
    }
  }
}
const orAwaiting = orLegs.filter((t) => !Number.isInteger(OR.proofRuns?.[t]));
notes.push(
  `⬜ OAuth return per native target: ${orLegs.length} leg(s) in ${OR.workflow} [${orLegs.join(', ')}]` +
    `${orLegs.length < nativeTargets.length ? `, ${nativeTargets.length - orLegs.length} waiting` : ''}; ` +
    `${orAwaiting.length ? `${orAwaiting.length} with no green run id recorded yet (${orAwaiting.join(', ')})` : 'every leg has a recorded run id'}.`,
);

// THE EQUALITY, STATED. It follows from the per-leg checks above, and it is
// computed and printed anyway: the two numbers are what N-6 actually asks for,
// and a relationship nobody prints is one nobody can audit from a log.
if (proven !== asserted.length) {
  problems.push(
    `leg equality broken — ${asserted.length} leg(s) marked asserted, ${proven} proven by ${testRel}.`,
  );
}

if (problems.length) {
  console.error(`✗ assert-e2e-legs — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-6] The golden path is proven end to end only for the legs the suite really');
  console.error('  walks. A green nightly over a suite that skips four of six is not the requirement.');
  process.exit(1);
}

if (blocked.length) {
  notes.push(
    `⬜ ${blocked.length} of ${REQUIRED_LEGS.length} golden-path leg(s) are NOT proven by the nightly. ` +
      'Each blocker is re-evaluated every run, so the excuse cannot outlive its reason:',
  );
  for (const l of blocked) notes.push(`   · ${l.id} — ${l.blockedBy} (declared ${l.declaredOn ?? 'undated'})`);
}
notes.push(
  `⬜ the money legs are web only, by policy, dated ${E2E?.declaredOn ?? 'undated'} — Apple 3.1.1 / Play billing make a web ` +
    'checkout structurally invalid as the unlock path on iOS and Android. (Guideline numbers COULD-NOT-ESTABLISH — ' +
    'carried from research, not re-read.)',
);
notes.push(
  `⬜ native targets (${nativeTargets.join(', ')}): ${legTargets.length} run the anonymous/sign-in legs in ` +
    `${NT.workflow} job \`${NT.job}\` on ${nativeJobCrons.join(', ') || 'no named cron'}; account delete is declared ` +
    `proven on web (${eqLegs.join(', ') || 'none'}), declared ${NT.declaredOn ?? 'undated'}.`,
);
for (const n of notes) console.log(n);

console.log(
  `ok  e2e legs — ${asserted.length} of ${REQUIRED_LEGS.length} golden-path leg(s) claimed asserted and ` +
    `${proven} proven by ${testRel} (equality holds); ${blocked.length} blocked with a live blocker; ` +
    `every app of the workspace set carries integration_test/app_test.dart (apps=${APP_SET.length}); ` +
    `${definesRead.size} E2E_ define(s) the suites read, every one passed by ${wfRel}; ` +
    `${nativeTargets.length} native catalog target(s), each leg run or declared equivalent`,
);
