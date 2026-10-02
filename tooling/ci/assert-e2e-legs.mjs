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
// ── PER APP (⏱ 2026-10-01, rv2-newproduct-005, O-BRICK-STAMPS-NO-E2E-SUITE) ──
// The six legs are `apps.<id>.legs` and every entry is graded against its own
// suite, workflow and lib/; every finding names the app. Every app of the
// workspace set needs an entry (exit 1 without one); the stamp writes it
// (tooling/kit/stamp-shared.mjs). The native axis stays one app's,
// `nativeTargets.app`.
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
 *  Each reads COMMENT-STRIPPED source, for the reason in this file's header.
 *
 *  ⏱ 2026-10-01 (rv2-newproduct-005): each predicate reads ONE app's sources —
 *  `src.app` (its lib/), `src.suite` (its app_test.dart) and `src.e2eSurface`
 *  (its suite plus the harness). A key spelled with `apps/{app}` serves every
 *  app: a leg's `blockedBy` naming its own directory (`[5] apps/<id> sells
 *  nothing`) resolves to it, and is evaluated over that app alone. */
const APP_PLACEHOLDER = 'apps/{app}';
const BLOCKERS_STILL_REAL = {
  // The app declares `PaywallConfig(enabled: false)` — the app sells nothing,
  // so there is nothing to purchase, no entitlement to flip and no feature to
  // unlock. Three legs share this one blocker because they share one cause.
  //
  // The signal is the app's OWN declaration rather than an absence, deliberately:
  // "no paywall widget appears anywhere" is satisfied by a typo, whereas this
  // line has to be edited to `true` by somebody switching the rail on — and on
  // that day all three legs stop being excusable in the same run.
  '[5] apps/{app} sells nothing': (src) => /PaywallConfig\(\s*enabled:\s*false/.test(src.app),

  // ⏱ 2026-10-01 · a STAMPED app's account-delete leg. The brick's suite signs in
  // and opens the paywall; it walks no deletion, and the erasure half of the leg
  // (verify_purged.mjs, delete_headless.mjs) is app #1's harness. The excuse is
  // the app's OWN suite: the day it gains a delete-account step, this goes false
  // and the leg must be promoted with anchors, not left excused.
  '[7] apps/{app}/integration_test/app_test.dart walks no account deletion': (src) =>
    !/delete_?account|deleteAccount|accountDeletion/i.test(src.suite),

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

// ── the apps under test, each graded against its OWN suite ──────────────────
// ⏱ 2026-09-25 (O-E2E-LANE-WIRED-TO-ONE-APP) the register was keyed by app, but
// the six legs stayed one top-level list and exactly one entry was graded; a
// second `apps.<id>` row was COVERAGE LOST. ⏱ 2026-10-01 (rv2-newproduct-005,
// O-BRICK-STAMPS-NO-E2E-SUITE): the legs are `apps.<id>.legs`, and EVERY entry is
// graded — its six legs, against its own suite, its own workflow and its own
// lib/ — so a leg one app's suite proves is never credited to another, and every
// finding names the app (`apps/<id>`). tooling/kit/stamp-shared.mjs writes a
// stamped app's entry; the workspace-set limb below requires one per app.
const appEntries =
  reg.apps && typeof reg.apps === 'object' && !Array.isArray(reg.apps) ? Object.entries(reg.apps) : [];
if (appEntries.length === 0) {
  coverageLost([
    `${REGISTER_REL} names no app under \`apps\`.`,
    "The six legs are each app's, anchored in its own suite. With no app there is no suite to resolve them against.",
  ]);
}
if (Object.hasOwn(reg, 'legs')) {
  coverageLost([
    `${REGISTER_REL} still carries a top-level \`legs\`.`,
    'The legs are `apps.<id>.legs`, one set per app; a top-level list would be graded against no suite and read as coverage.',
  ]);
}

/** THE E2E HARNESS — the nightly scripts under tooling/e2e/, read once. With an
 *  app's suite it is that app's E2E SURFACE: everything that could carry a
 *  delete-account step.
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
const harness = harnessFiles.map((f) => stripSourceComments(readFileSync(join(harnessDir, f), 'utf8'), '.js'));

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

/** Grade one `apps.<id>` entry: its suite, its workflow, its six legs. */
function gradeApp(id, E2E) {
  const where = typeof E2E?.app === 'string' ? E2E.app : `apps/${id}`;
  const lost = (lines) => coverageLost([`[${where}] ${lines[0]}`, ...lines.slice(1)]);
  if (E2E?.app !== `apps/${id}`) {
    lost([`${REGISTER_REL} apps.${id}.app is ${JSON.stringify(E2E?.app ?? null)}, not "apps/${id}".`, 'An entry grades the app it is keyed by.']);
  }

  const legs = Array.isArray(E2E?.legs) ? E2E.legs : [];
  const ids = legs.map((l) => l && l.id);
  const missing = REQUIRED_LEGS.filter((r) => !ids.includes(r));
  const extra = ids.filter((i) => !REQUIRED_LEGS.includes(i));
  if (missing.length || extra.length) {
    lost([
      `${REGISTER_REL} apps.${id}.legs does not declare N-6's six legs exactly.`,
      ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
      ...(extra.length ? [`unexpected: ${extra.join(', ')}`] : []),
      'The requirement names six and only six. Trimming the list is how a coverage relationship becomes',
      'a tautology — the four uncovered legs are exactly the ones it would be convenient to delete.',
    ]);
  }

  // ── the suite under test ──────────────────────────────────────────────────
  const testRel = E2E?.test;
  if (typeof testRel !== 'string' || testRel.length === 0) {
    lost([`${REGISTER_REL} names no \`apps.${id}.test\`, so there is no suite to resolve anchors against.`]);
  }
  const testPath = join(ROOT, testRel);
  if (!existsSync(testPath)) {
    lost([
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
    lost([
      `${testRel} declares no \`testWidgets(\` once comments are stripped.`,
      'The named E2E is not a suite any more. Anchors cannot be resolved against a file that runs',
      'nothing, and a green nightly over it would prove only that Flutter started.',
    ]);
  }

  // The workflow must still be the one that runs this suite. The register names
  // both; if they have drifted, "the leg is proven nightly" is proven by nothing.
  const wfRel = E2E?.workflow;
  if (typeof wfRel !== 'string' || !existsSync(join(ROOT, wfRel))) {
    lost([
      `${REGISTER_REL} names workflow ${JSON.stringify(wfRel)}, which does not exist.`,
      'The legs below are only proven if something runs them on a schedule.',
    ]);
  }
  const workflow = readFileSync(join(ROOT, wfRel), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  if (!workflow.includes(testRel.split('/').slice(-2).join('/'))) {
    lost([
      `${wfRel} does not name ${testRel}.`,
      'The register claims this workflow runs this suite. It does not, so every leg marked asserted is',
      'proven by a test nothing schedules.',
    ]);
  }

  // ── the blocker predicates' inputs: THIS app's ──────────────────────────────
  const sources = { app: readDartTree(join(where, 'lib')), suite, e2eSurface: [suite, ...harness].join('\n') };
  if (sources.app.trim().length === 0) {
    lost([
      `no Dart source was read under ${where}/lib.`,
      'Every blocker predicate below reads that tree, and a predicate over an empty string answers',
      '"still blocked" for reasons that have nothing to do with the blocker. A scan over nothing prints',
      'ok — this repo\'s single most repeated failure.',
    ]);
  }

  // ── the equality ──────────────────────────────────────────────────────────
  let proven = 0;
  const asserted = [];
  const blocked = [];
  const tag = `[${where}]`;
  for (const leg of legs) {
    if (leg.status === 'asserted') {
      asserted.push(leg);
      const anchors = Array.isArray(leg.anchors) ? leg.anchors : [];
      if (anchors.length === 0) {
        problems.push(
          `${tag} \`${leg.id}\` is marked asserted with no anchors. An unanchored claim is exactly the "the record ` +
            'names an E2E" acceptance that N-6 already had and that could not fail.',
        );
        continue;
      }
      const unresolved = anchors.filter((a) => !suite.includes(a));
      if (unresolved.length) {
        problems.push(
          `${tag} \`${leg.id}\` claims to be asserted, but ${unresolved.length} of its ${anchors.length} anchor(s) ` +
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
        problems.push(`${tag} \`${leg.id}\` is BLOCKED with no \`blockedBy\`. An unexplained block is indistinguishable from work nobody did.`);
        continue;
      }
      // A blocker that names THIS app's directory is keyed by `apps/{app}`, so one
      // predicate serves every app and is evaluated over that app's own sources.
      const stillReal = BLOCKERS_STILL_REAL[String(leg.blockedBy).split(where).join(APP_PLACEHOLDER)];
      if (typeof stillReal !== 'function') {
        problems.push(
          `${tag} \`${leg.id}\` claims to be blocked by "${leg.blockedBy}", which has no predicate in ` +
            'BLOCKERS_STILL_REAL. A blocker nothing evaluates is a sentence, and it would sit here looking ' +
            'checked forever.',
        );
        continue;
      }
      if (!stillReal(sources)) {
        problems.push(
          `${tag} \`${leg.id}\` claims to be blocked by "${leg.blockedBy}", but that blocker has SHIPPED. ` +
            'Cover the leg in the E2E or restate the block — otherwise the excuse outlives its reason.',
        );
      }
    } else {
      problems.push(
        `${tag} \`${leg.id}\` has unknown status ${JSON.stringify(leg.status)} (expected asserted / blocked). ` +
          'A third state is a third place for a leg to hide.',
      );
    }
  }
  return { id, where, E2E, legs, testRel, suite, wfRel, workflow, asserted, proven, blocked };
}

const graded = appEntries.map(([id, entry]) => gradeApp(id, entry));

// ── every app in the workspace set carries the suite (10b) ──────────────────
// ⏱ 2026-09-27 (O-BRICK-STAMPS-NO-E2E-SUITE, 10b). The legs above are one app's,
// graded against the register's one `apps.<id>` entry. The SUITE is every app's:
// the brick stamps `integration_test/app_test.dart`, and the e2e lane drives each
// app of tooling/ci/app-set.mjs's set by `E2E_APP_ID`. An app of the set without
// it is a leg nobody can run for that app — exit 1, naming the file. An empty or
// unreadable set is COVERAGE LOST.
// ⏱ 2026-10-01 (rv2-newproduct-005): and every app of the set has an
// `apps.<id>` entry, so its six legs are graded against that suite. Without one
// the suite exists and nothing says which legs it proves — exit 1, naming the app.
const APP_SET = requireAppSet(ROOT, 'assert-e2e-legs');
for (const { dir } of APP_SET) {
  const rel = `${dir}/integration_test/app_test.dart`;
  if (!existsSync(join(ROOT, rel))) {
    problems.push(
      `${rel} is missing. ${dir} is in the workspace app set, and the e2e lane drives every app of the set ` +
        'with its own suite: without it this app has no e2e leg at all. The brick stamps one; restore it.',
    );
  }
  if (!graded.some((g) => g.where === dir)) {
    problems.push(
      `[${dir}] is in the workspace app set and ${REGISTER_REL} has no \`apps.${dir.split('/').pop()}\` entry, so its six ` +
        'golden-path legs are graded against no suite. The stamp writes it:  node tooling/kit/stamp-shared.mjs',
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
// ⏱ 2026-10-01: an app's suite is held to ITS entry's workflow, and the brick's
// template to every workflow an entry names (a stamped app is driven by one).
const brickSuiteRel = 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/app_test.dart';
const workflowText = new Map(graded.map((g) => [g.wfRel, g.workflow]));
const workflowsOf = (rel) => {
  const g = graded.find((x) => rel === `${x.where}/integration_test/app_test.dart`);
  return g ? [g.wfRel] : [...workflowText.keys()];
};
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
const definesPassedBy = new Map(
  [...workflowText].map(([rel, text]) => [rel, new Set([...text.matchAll(/--dart-define=(E2E_[A-Z0-9_]+)=/g)].map((m) => m[1]))]),
);
for (const [name, readers] of [...definesRead.entries()].sort()) {
  const unpassedBy = [...new Set(readers.flatMap(workflowsOf))].filter((w) => !definesPassedBy.get(w)?.has(name));
  if (unpassedBy.length) {
    problems.push(
      `${readers.join(', ')} read(s) --dart-define ${name}, and ${unpassedBy.join(', ')} never passes it: the suite would read '' ` +
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

// ⏱ 2026-10-01: the native axis is ONE app's, and the register names which —
// `nativeTargets.app` — rather than this limb taking whichever entry came first.
const NATIVE_APP = graded.find((g) => g.id === NT.app);
if (!NATIVE_APP) {
  coverageLost([
    `${REGISTER_REL} nativeTargets.app is ${JSON.stringify(NT.app ?? null)}, which names no \`apps.<id>\` entry.`,
    'The native legs and their web equivalents are one app\'s; without the app they are graded against nothing.',
  ]);
}
const { legs, where: APP_DIR, testRel, suite } = NATIVE_APP;

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

// THE EQUALITY, STATED. It follows from the per-leg checks above, and it is
// computed and printed anyway: the two numbers are what N-6 actually asks for,
// and a relationship nobody prints is one nobody can audit from a log.
for (const g of graded) {
  if (g.proven !== g.asserted.length) {
    problems.push(
      `[${g.where}] leg equality broken — ${g.asserted.length} leg(s) marked asserted, ${g.proven} proven by ${g.testRel}.`,
    );
  }
}

if (problems.length) {
  console.error(`✗ assert-e2e-legs — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-6] The golden path is proven end to end only for the legs the suite really');
  console.error('  walks. A green nightly over a suite that skips four of six is not the requirement.');
  process.exit(1);
}

for (const g of graded) {
  if (g.blocked.length === 0) continue;
  notes.push(
    `⬜ [${g.where}] ${g.blocked.length} of ${REQUIRED_LEGS.length} golden-path leg(s) are NOT proven by the nightly. ` +
      'Each blocker is re-evaluated every run, so the excuse cannot outlive its reason:',
  );
  for (const l of g.blocked) notes.push(`   · ${l.id} — ${l.blockedBy} (declared ${l.declaredOn ?? 'undated'})`);
}
notes.push(
  `⬜ the money legs are web only, by policy, dated ${NATIVE_APP.E2E?.declaredOn ?? 'undated'} — Apple 3.1.1 / Play billing make a web ` +
    'checkout structurally invalid as the unlock path on iOS and Android. (Guideline numbers COULD-NOT-ESTABLISH — ' +
    'carried from research, not re-read.)',
);
notes.push(
  `⬜ native targets (${nativeTargets.join(', ')}): ${legTargets.length} run the anonymous/sign-in legs in ` +
    `${NT.workflow} job \`${NT.job}\` on ${nativeJobCrons.join(', ') || 'no named cron'}; account delete is declared ` +
    `proven on web (${eqLegs.join(', ') || 'none'}), declared ${NT.declaredOn ?? 'undated'} — graded for ${APP_DIR} (nativeTargets.app).`,
);
for (const n of notes) console.log(n);

console.log(
  `ok  e2e legs — ${graded
    .map(
      (g) =>
        `[${g.where}] ${g.asserted.length} of ${REQUIRED_LEGS.length} golden-path leg(s) claimed asserted and ` +
        `${g.proven} proven by ${g.testRel} (equality holds); ${g.blocked.length} blocked with a live blocker`,
    )
    .join('; ')}; ` +
    `every app of the workspace set carries integration_test/app_test.dart and an apps.<id> entry (apps=${APP_SET.length}); ` +
    `${definesRead.size} E2E_ define(s) the suites read, every one passed by ${[...workflowText.keys()].join(', ')}; ` +
    `${nativeTargets.length} native catalog target(s), each leg run or declared equivalent`,
);
