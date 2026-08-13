#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EVERY SURFACE A USER CAN REACH EITHER CARRIES AN A11Y SWEEP OR IS NAMED, OUT
// LOUD, ON EVERY RUN, AS ONE THAT DOES NOT. AND EVERY A11Y SWEEP POINTS AT A
// SURFACE A USER CAN REACH.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// P5 shipped `apps/subly/test/a11y_semantics_test.dart` and it found two real
// defects while it was being written — the calendar's hand-rolled renewal rows
// (a twin of `RowCard` that never inherited the fix) and the shell's FAB, whose
// `Tooltip` filled the `tooltip` slot and left `isButton` unset. It swept FIVE
// surfaces. The app has NINETEEN, and until this file existed nothing in the
// repository said which fourteen were unswept — or noticed if the five became
// four.
//
// A control a reader cannot identify raises no exception, clips no pixel and
// fails no existing assertion. It is only ever visible to a measurement,
// exactly like a width. So an unswept surface is an unpoliced one, and the
// accounting has to be mechanical.
//
// 🔴 THIS GUARD PRINTS THE GAP; IT DOES NOT FAIL ON IT. Fourteen of nineteen
// surfaces are unswept today. A guard that reddened CI over work nobody has
// started would block every unrelated change on it — the standing [pipeline
// C-6] rule, recorded when four fail-closed seams shipped with no proven open
// path. What it DOES fail on is the other three things:
//   · COVERAGE LOST — the scan reached no router, no surfaces, no a11y file, no
//     case, or no sweep at all. An empty set makes every statement below either
//     vacuously true or confidently wrong, and it reports as a pass.
//   · REGRESSION — a surface listed in SWEPT_FLOOR, measured as swept on a
//     stated date, is not swept any more. Work leaving the tree is a legitimate
//     move; it may not be a QUIET one.
//   · DEAD COVERAGE — a sweep whose subject nothing routes to (see below).
// The distinction is the whole design: NEVER DONE prints, WAS DONE AND IS GONE
// fails.
//
// ── THE DOMAIN RULE, AND WHY IT IS THE SAME ONE ────────────────────────────
// The domain is the REACHABLE SURFACES of apps/subly, derived from the SAME
// SOURCE `assert-responsive-coverage.mjs` derives it from — the router and the
// feature tree — and deliberately not one word differently:
//
//   (1) ROUTED SCREENS — every widget a `builder:` in `lib/core/router.dart`
//       returns, INCLUDING the routes inside the StatefulShellRoute branches. A
//       builder target declared IN the router itself (a private `_Wrapper`,
//       e.g. `_GatedInsights`) is resolved ONE LEVEL to the feature screen it
//       builds, because the wrapper is a gate and the pane is what the user is
//       handed.
//   (2) MODAL SHEETS — every `show*Sheet` function declared under
//       `lib/features/**`. A sheet is a surface a reader has to traverse, and
//       nothing about being modal changes that.
//
// 🔴 THERE IS NO SECOND HARDCODED LIST OF SCREENS HERE, AND THAT IS THE POINT.
// A checked-in enumeration of the nineteen would be the copy that silently
// stops matching the first. The only checked-in sets in this file are
// NOT_A_PANE (two argued non-panes) and SWEPT_FLOOR (five measured sweeps), and
// BOTH are self-checked against the derived domain in both directions below —
// an entry the tree no longer contains fails, and an entry the tree contradicts
// fails.
//
// 🔴 TWO GUARDS, ONE DOMAIN, TWO COPIES OF THE PARSE — SAID OUT LOUD RATHER
// THAN LEFT TO BE DISCOVERED. This repository's rule is to extract a shared
// parse the moment a second consumer appears (`workflow-scan.mjs` was pulled
// out of assert-release-provenance for exactly that reason: four copies of a
// workflow parser drift in the one way that reports clean, which is WHICH LINES
// THEY CAN SEE). That extraction was NOT taken in the change that added this
// file, and the reason is stated rather than assumed: the extraction edits
// assert-responsive-coverage.mjs, a 756-line guard with fifteen recorded
// failing cases, and this change could not verify that rewrite. The drift here
// cannot be silent in the meantime — each copy carries its own MEASURED
// `surfaces` floor over the SAME tree, so a copy that stops reaching a route
// falls under its own floor and fails by name instead of reporting a smaller
// domain as fully accounted for. The two floors agreeing is the expected
// reading; a DISAGREEMENT is the signal that one parse has drifted.
// ⚠️ EXTRACT WHEN A THIRD CONSUMER APPEARS.
//
// Everything else a `builder:` returns is an EXCLUSION, and exclusions are
// PRINTED ON EVERY RUN with their reason — never dropped silently. The same two
// shapes the responsive guard argues, restated here because this guard has to
// be readable on its own:
//   · the SHELL WRAPPER (`AppShell`) — chrome, not a pane;
//   · the DIALOG/ERROR surface (`NotFoundScreen`) — declared in
//     packages/design_system, so the design system owns its semantics.
// A redirect-only `GoRoute` has no builder and therefore no surface; printed
// too, for the same reason.
//
// 🔴 AN UNKNOWN BUILDER TARGET IS A FAILURE, NOT AN EXCLUSION. NOT_A_PANE is a
// statement about two known non-panes, not an allowlist screens can be added
// to.
//
// ── HOW A SWEEP IS ESTABLISHED, AND WHY A FILE IS NOT ONE ──────────────────
// 🔴 THE HALF THAT DOES THE WORK. A surface is SWEPT when an `a11y_*_test.dart`
// file IMPORTS its feature file (`package:subly/features/…`) AND SOME
// `testWidgets` BLOCK IN THAT FILE both CONSTRUCTS the symbol AND CALLS AN A11Y
// SWEEP. All three halves are load-bearing:
//   · the IMPORT gives provenance — which file the symbol came from;
//   · the CONSTRUCTION gives evidence the case actually pumps it;
//   · the SWEEP CALL is what distinguishes a measurement from a mention.
//
// The BLOCK is the unit, NOT the file, and that is the limb this guard exists
// for. Set equality over files would credit `a11y_semantics_test.dart` with
// every screen it so much as names — and MEASURED ON THE TREE OF 2026-08-12,
// EIGHT of its 24 cases name a surface while asserting one label on it and
// never sweeping it. "[en] the chart announces the total AND every category" is
// a real assertion and it says nothing whatever about whether that screen
// carries a control a user can activate and cannot identify. That is the
// `width_home_test.dart` defect one domain over: present in both sets, green,
// and measuring neither of the two window classes between a phone and an
// ultra-wide display. A test file is not a measurement.
//
// ── WHAT COUNTS AS A SWEEP, AND WHY THREE FAMILIES ─────────────────────────
// A sweep is a call that ranges over the WHOLE surface and can fail on a
// control added tomorrow, as opposed to an assertion about one label somebody
// already thought of. Three families are recognised, and each is a real
// mechanism rather than an aspiration:
//   · NAKED CONTROLS — `expectNothingNaked(` / `nakedControls(`, the walk this
//     app wrote: every node with a tap action that announces no role or no
//     name. Five surfaces have it today.
//   · TAP TARGET — flutter_test's own `meetsGuideline(androidTapTargetGuideline)`
//     / `iOSTapTargetGuideline` / `labeledTapTargetGuideline`.
//   · CONTRAST — flutter_test's `meetsGuideline(textContrastGuideline)`.
// ⚠️ MEASURED, NOT ASSUMED: on 2026-08-12 the guideline matchers appear in ZERO
// source files in this repository — the only hits are inside compiled
// `build/test_cache/*.dill` artefacts, i.e. the framework's own bundle. The
// per-family tally is PRINTED on every run precisely so "tap targets and
// contrast are checked nowhere" is a number a reader sees rather than a claim
// this header makes. They are recognised so that the work, when it is done,
// counts — not to imply it has been.
//
// 🔴 AND BOTH SETS ARE KEYED BY `<file>#<Symbol>`, NEVER BY THE BARE CLASS
// NAME. Subly has already shipped two different classes called
// `OnboardingScreen` — the routed carousel and an unrouted STAMPED twin that
// `responsive_width_test.dart` spent its life measuring. A name-keyed guard
// finds the twin's name in the covered set and writes the exact bug it exists
// to catch into its own answer. The file is what distinguishes a twin from its
// original, so the file is part of the identity.
//
// ── WHY THE CORPUS IS `a11y_*_test.dart` AND NOT "ANY FILE THAT TAKES A
//    SemanticsHandle" ──────────────────────────────────────────────────────
// Three other files under apps/subly/test call `ensureSemantics()` —
// chassis_properties, consent_scrim_layout and dark_group_detail — and each
// asserts one targeted fact (an icon's label, a scrim's reading order, a Tamil
// back button). None sweeps a surface. Counting them would credit a surface
// with a sweep it never received, which is DEAD COVERAGE wearing a friendlier
// face. The cost of the naming rule is real and is stated rather than hidden:
// a11y work written into some other file does not count here. Name the file
// `a11y_<surface>_test.dart` and it does.
//
// ── COMMENTS ARE STRIPPED, AND SO ARE STRING LITERALS ──────────────────────
// Comments via tooling/ci/text-reductions.mjs, the reduction nine guards share.
// The header you are reading names `InsightsScreen`, `expectNothingNaked`,
// `AppShell` and `meetsGuideline`; unstripped, this file's own prose would
// parse as a router and a test suite at once.
//
// ⚠️ STRING LITERALS ARE STRIPPED TOO, BEFORE ANY CONSTRUCTION OR SWEEP MATCH,
// and that is not belt-and-braces. `expectNothingNaked`'s own failure text and
// several `expect` reasons in the real file discuss controls and screens by
// name; one domain over, `width_scan_test.dart` and `width_insights_test.dart`
// carry the word `kWide` inside a reason explaining why they need NO such case,
// and comment-stripping alone would have let a prose explanation of an ABSENT
// case satisfy the check for it — the `r2_buckets` defect, in a file arguing
// the opposite of what it would be credited with. (Imports are matched BEFORE
// that stripping, because an import path IS a string literal.)
//
// ── NEGATIVE TESTS, RUN AGAINST A COPY OF THE REAL TREE ────────────────────
// Recorded here because a guard whose failing path was never exercised is not a
// guard, and because all six fixtures of `assert-seams-wired.mjs` passed
// against a broken version — only mutating the REAL tree exposed it. Every
// mutation below was applied to a byte copy of the live repo, run, and
// restored. tooling/ci/test/a11y-coverage.test.mjs re-applies each one.
//   M1  delete the `expectNothingNaked` call from the insights sweep
//       → InsightsScreen moves out of SWEPT and into the printed list, AND
//         REGRESSION fires by name (SWEPT_FLOOR). exit 1.
//   M2  replace that call with a STRING mentioning `expectNothingNaked`
//       → identical to M1: prose does not sweep.
//   M3  delete every `GoRoute` from the router
//       → COVERAGE LOST, the reachable set parsed EMPTY.
//   M4  rename `a11y_semantics_test.dart` out of the `a11y_*` corpus
//       → COVERAGE LOST, no a11y file matched.
//   M5  rename BOTH sweep helpers app-wide inside the test file
//       → COVERAGE LOST, 24 cases parsed and not one sweeps.
//   M6  point a sweep at an unrouted twin screen
//       → DEAD COVERAGE, named.
//   M7  delete one route AND its screen file
//       → COVERAGE LOST on the `surfaces` floor (18 < 19), which is the only
//         thing that sees a domain being emptied wholesale.
//   M8  delete four of the 24 cases, keeping every sweep
//       → COVERAGE LOST on the `cases` floor: every set above is byte-identical
//         and real assertions left the tree in silence.
//   M9  delete a NOT_A_PANE entry's route (AppShell)
//       → the exclusion self-check fires: judgement over nothing.
//   M10 add a `HomeScreen` sweep (the positive control)
//       → 6 swept, 13 printed, exit 0. Without this one, every result above is
//         consistent with a guard that can only ever say "unswept".
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = process.argv[2] ?? process.cwd();
const APP = 'apps/subly';
const ROUTER_REL = `${APP}/lib/core/router.dart`;
const FEATURES_REL = `${APP}/lib/features`;
const TEST_REL = `${APP}/test`;

const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

const read = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart');

// ── THE TWO NON-PANES, ARGUED ──────────────────────────────────────────────
// Not an allowlist. Each entry is a claim about WHAT KIND OF THING the symbol
// is, and each is self-checked twice at the bottom of this file: an entry the
// router no longer builds fails (an exception for something that is not there
// reports judgement over nothing), and an entry that turns out to be a feature
// surface after all fails (it scans as a pane; the exclusion is wrong).
const NOT_A_PANE = new Map([
  [
    'AppShell',
    'is the shell CHROME, not a pane — it hosts the bottom nav and an IndexedStack of the five branch ' +
      'routes, each of which is in this domain on its own account. Its OWN semantics are not unmeasured: ' +
      'the `shell ·` group pumps the REAL router and sweeps what it lands on, which is why the tally ' +
      'below reports a sweeping case that attributes to no surface rather than pretending there is none.',
  ],
  [
    'NotFoundScreen',
    'is the errorBuilder surface and it is DECLARED IN packages/design_system, not in this app — the ' +
      'design system owns its semantics and every stamped app inherits that decision, so a Subly-local ' +
      'a11y sweep would assert a property Subly does not control.',
  ],
]);

// ── SURFACE VOCABULARY ─────────────────────────────────────────────────────
// A surface is a `…Screen` class or a `show…Sheet` function. Deliberately the
// SAME vocabulary on both sides and the same one assert-responsive-coverage
// uses: the reachable set and the swept set must agree about what counts as a
// surface, or the accounting below compares two different questions.
const SCREEN_DECL = /\bclass\s+([A-Za-z_$][\w$]*Screen)\b/g;
const SHEET_DECL = /^[ \t]*(?:Future<[^>]*>|void)\s+(show[A-Z][\w$]*Sheet)\s*\(/gm;

// ── WHAT MAKES A CASE A SWEEP RATHER THAN A LABEL ASSERTION ────────────────
// See the header. Each family is matched on the literal-stripped BODY of one
// `testWidgets` block.
const SWEEP_FAMILIES = [
  {
    kind: 'naked-controls',
    re: /\b(?:expectNothingNaked|nakedControls)\s*\(/,
    what: 'every node with a tap action that announces no role or no name',
  },
  {
    kind: 'tap-target',
    re: /\bmeetsGuideline\s*\(\s*(?:android|iOS|labeled)TapTargetGuideline\b/,
    what: "flutter_test's own minimum tap-target sweep",
  },
  {
    kind: 'contrast',
    re: /\bmeetsGuideline\s*\(\s*textContrastGuideline\b/,
    what: "flutter_test's own text-contrast sweep",
  },
];

const surfaceCache = new Map();
/** The surfaces a feature file DECLARES, as bare symbol names. */
function surfacesIn(rel) {
  if (surfaceCache.has(rel)) return surfaceCache.get(rel);
  let out = [];
  if (existsSync(join(ROOT, rel))) {
    const code = read(rel);
    out = [
      ...[...code.matchAll(SCREEN_DECL)].map((m) => m[1]),
      ...[...code.matchAll(SHEET_DECL)].map((m) => m[1]),
    ];
  }
  surfaceCache.set(rel, out);
  return out;
}

/** Every .dart file under lib/features, relative to ROOT. */
function featureFiles() {
  const out = [];
  const walk = (rel) => {
    for (const entry of listDir(join(ROOT, rel))) {
      const child = `${rel}/${entry}`;
      if (entry.endsWith('.dart')) out.push(child);
      else if (!entry.includes('.')) walk(child);
    }
  };
  try {
    walk(FEATURES_REL);
  } catch {
    /* absent — reported by the caller */
  }
  return out.sort();
}

/** The inner text of the balanced run opening at `open`, quotes respected.
 *
 *  Used for a route's argument list, a router-local class body and a
 *  `testWidgets(` argument list. Returning null rather than guessing is the
 *  point: a block this parse cannot close is REPORTED, never skipped, because a
 *  block dropped by a parser looks exactly like a block that was never there —
 *  and here it would look like it in the direction that reports LESS work than
 *  was done, quietly moving a swept surface onto the printed list. */
function sliceBalanced(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      // Skip the literal. Dart escapes with a backslash; an unterminated quote
      // means we mis-read the opener, so bail rather than run to end of file.
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\') j++;
        j++;
      }
      if (j >= text.length || text[j] === '\n') return null;
      i = j;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}
const sliceCall = (text, open) => sliceBalanced(text, open, '(', ')');

// ═══════════════════════════════════════════════════════════════════════════
// (A) THE REACHABLE SET
// ═══════════════════════════════════════════════════════════════════════════
if (!existsSync(join(ROOT, ROUTER_REL))) {
  coverageLost(
    `${ROUTER_REL} does not exist, so the reachable-surface half of this check ranged over NOTHING and ` +
      'would have reported every a11y sweep as dead coverage. The router is the domain; without it there ' +
      'is no question to ask.',
  );
}

const reachable = new Map(); // "<featureFile>#<Symbol>" → { file, symbol, via, kind }
const excluded = []; // { what, why }
const routerTargets = new Set();

if (problems.length === 0) {
  const router = read(ROUTER_REL);

  // Which feature file each symbol the router imports comes from. Relative
  // imports, because that is how the router spells them (`../features/…`).
  const importedFeature = new Map(); // Symbol → [file, …]
  for (const m of router.matchAll(/import\s+'(?:\.\.\/)+(features\/[^']+\.dart)'/g)) {
    const rel = `${APP}/lib/${m[1]}`;
    for (const symbol of surfacesIn(rel)) {
      if (!importedFeature.has(symbol)) importedFeature.set(symbol, []);
      importedFeature.get(symbol).push(rel);
    }
  }
  for (const [symbol, files] of importedFeature) {
    if (files.length > 1) {
      problems.push(
        `AMBIGUOUS SURFACE — the router imports ${files.length} feature files that each declare \`${symbol}\` ` +
          `(${files.join(', ')}), so a \`${symbol}(\` in the router cannot be attributed to one of them. ` +
          'That is the twin shape this guard keys by file to catch; resolve the collision rather than guessing.',
      );
    }
  }

  // ── Every GoRoute is accounted for: a builder target, or a redirect ──────
  // Walked route by route rather than by a bare `builder:` regex, so a route
  // this parse cannot classify FAILS instead of vanishing.
  let goRoutes = 0;
  let redirectOnly = 0;
  const unparsed = [];
  for (const m of router.matchAll(/\bGoRoute\s*\(/g)) {
    goRoutes++;
    const open = m.index + m[0].length - 1;
    const inner = sliceCall(router, open);
    if (inner === null) {
      unparsed.push(`a GoRoute( at offset ${m.index} whose argument list this parse could not close`);
      continue;
    }
    if (/\bbuilder\s*:/.test(inner)) continue; // handled by the builder pass below
    if (/\bredirect\s*:/.test(inner)) {
      redirectOnly++;
      const path = /\bpath\s*:\s*'([^']*)'/.exec(inner)?.[1] ?? '(unnamed)';
      excluded.push({
        what: `GoRoute ${path}`,
        why: 'is REDIRECT-ONLY — it declares no builder, so it renders nothing and there is no surface for a reader to traverse.',
      });
      continue;
    }
    unparsed.push(`a GoRoute( at offset ${m.index} with neither a builder: nor a redirect:`);
  }
  if (unparsed.length) {
    coverageLost(
      `${unparsed.length} route(s) in ${ROUTER_REL} could not be classified: ${unparsed.join('; ')}. ` +
        'An unclassified route is a screen this guard cannot see, and an invisible screen reads exactly ' +
        'like a swept one.',
    );
  }

  // Builder targets. `errorBuilder` is captured too so the 404 surface is
  // EXCLUDED WITH A REASON rather than never noticed.
  const BUILDER = /\b(errorBuilder|builder)\s*:\s*\([^)]*\)\s*=>\s*(?:const\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  const builderKeys = [...router.matchAll(/\b(?:errorBuilder|builder)\s*:/g)].length;
  const matches = [...router.matchAll(BUILDER)];
  if (matches.length !== builderKeys) {
    coverageLost(
      `${ROUTER_REL} has ${builderKeys} builder key(s) and this parse resolved ${matches.length} of them. ` +
        'The unresolved ones build SOMETHING and this guard does not know what — a builder with a block ' +
        'body or a non-constructor expression slips past the arrow form. Widen the parse; do not let a ' +
        'screen be invisible.',
    );
  }

  for (const [, , target] of matches) {
    routerTargets.add(target);

    // A router-local private wrapper (`_GatedInsights`) is a gate, not a pane.
    // Resolve ONE level to the feature surface it builds.
    let symbol = target;
    let via = null;
    if (target.startsWith('_')) {
      const decl = new RegExp(`\\bclass\\s+${target}\\b`).exec(router);
      const brace = decl ? router.indexOf('{', decl.index) : -1;
      const body = brace === -1 ? '' : (sliceBalanced(router, brace, '{', '}') ?? '');
      const inner = [...body.matchAll(/\b(?:const\s+)?([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((x) => x[1])
        .find((name) => importedFeature.has(name));
      if (!inner) {
        problems.push(
          `\`${target}\` is a route builder declared inside ${ROUTER_REL} and it resolves to NO feature ` +
            'surface. A wrapper that wraps nothing is a route whose surface nothing can be pointed at; ' +
            'name the screen it builds or stop routing to it.',
        );
        continue;
      }
      symbol = inner;
      via = target;
    }

    const files = importedFeature.get(symbol);
    if (!files) {
      const why = NOT_A_PANE.get(symbol);
      if (why) {
        excluded.push({ what: symbol, why });
      } else {
        problems.push(
          `\`${symbol}\` is built by a route in ${ROUTER_REL} but is neither a screen declared under ` +
            `${FEATURES_REL} nor one of the ${NOT_A_PANE.size} argued non-panes. This guard will not guess: ` +
            'a builder target it cannot classify is a surface that would silently leave the domain. Either ' +
            'it is a surface (sweep it, or let it print as unswept) or it is not (say why, in NOT_A_PANE).',
        );
      }
      continue;
    }
    reachable.set(`${files[0]}#${symbol}`, { file: files[0], symbol, via, kind: 'routed screen' });
  }

  if (goRoutes > 0) {
    ok(`${goRoutes} GoRoute(s) parsed — ${goRoutes - redirectOnly} with a builder, ${redirectOnly} redirect-only`);
  }
}

// ── MODAL SHEETS — the other half of the domain ────────────────────────────
const featureDartFiles = featureFiles();
if (featureDartFiles.length === 0) {
  coverageLost(
    `no .dart file was found under ${FEATURES_REL}, so the modal-sheet half of the domain is empty and a ` +
      'sheet sweep would read as dead coverage. The scan is pointed at the wrong tree.',
  );
}
for (const rel of featureDartFiles) {
  for (const symbol of surfacesIn(rel)) {
    if (!symbol.startsWith('show')) continue; // screens enter the domain via the router, not the disk
    reachable.set(`${rel}#${symbol}`, { file: rel, symbol, via: null, kind: 'modal sheet' });
  }
}
const sheetCount = [...reachable.values()].filter((s) => s.kind === 'modal sheet').length;

// ═══════════════════════════════════════════════════════════════════════════
// (B) THE SWEPT SET — per testWidgets BLOCK, not per file
// ═══════════════════════════════════════════════════════════════════════════
const A11Y_TEST = /^a11y_.*_test\.dart$/;
let a11yFiles = [];
try {
  a11yFiles = listDir(join(ROOT, TEST_REL)).filter((f) => A11Y_TEST.test(f)).sort();
} catch {
  /* absent — the empty-parse checks below are the report */
}

const swept = new Map(); // "<file>#<Symbol>" → { files:Set, kinds:Set }
const namedOnly = new Map(); // "<file>#<Symbol>" → Set of test files that name it in a NON-sweeping case
const kindTally = new Map(SWEEP_FAMILIES.map((f) => [f.kind, 0]));
let a11yCases = 0;
let sweepingBlocks = 0;
let unattributedSweeps = 0;

for (const name of a11yFiles) {
  const rel = `${TEST_REL}/${name}`;
  const code = read(rel);

  // Imports FIRST, on comment-stripped text ONLY: an import path IS a string
  // literal, so stripping literals before this would erase the provenance half
  // and every surface would fall to the printed list with nothing to say why.
  const declaredHere = new Map(); // Symbol → [feature file, …]
  for (const m of code.matchAll(/import\s+'package:subly\/(features\/[^']+\.dart)'/g)) {
    const featureRel = `${APP}/lib/${m[1]}`;
    for (const symbol of surfacesIn(featureRel)) {
      if (!declaredHere.has(symbol)) declaredHere.set(symbol, []);
      declaredHere.get(symbol).push(featureRel);
    }
  }
  for (const [symbol, files] of declaredHere) {
    if (files.length > 1) {
      problems.push(
        `AMBIGUOUS SUBJECT — ${rel} imports ${files.length} feature files that each declare \`${symbol}\` ` +
          `(${files.join(', ')}), so this guard cannot tell WHICH of them a case pumps. Keying by file is ` +
          'exactly what catches an unrouted twin, and a collision inside one file defeats it.',
      );
    }
  }

  const blocks = [...code.matchAll(/\btestWidgets\s*\(/g)];
  a11yCases += blocks.length;
  const unclosed = [];
  for (const m of blocks) {
    const open = m.index + m[0].length - 1;
    const inner = sliceCall(code, open);
    if (inner === null) {
      unclosed.push(`a testWidgets( at offset ${m.index}`);
      continue;
    }
    // Literals out for the construction and sweep match. A case's own prose
    // must not be able to claim a sweep it does not perform.
    const body = stripStringLiterals(inner);
    const kinds = SWEEP_FAMILIES.filter((f) => f.re.test(body)).map((f) => f.kind);
    if (kinds.length) sweepingBlocks++;
    for (const kind of kinds) kindTally.set(kind, kindTally.get(kind) + 1);

    let attributed = 0;
    for (const [symbol, files] of declaredHere) {
      if (files.length !== 1) continue; // already reported as AMBIGUOUS
      // Construction/invocation, not a bare mention: `find.byType(HomeScreen)`
      // names a widget without pumping one.
      if (!new RegExp(`\\b${symbol}\\s*\\(`).test(body)) continue;
      const key = `${files[0]}#${symbol}`;
      if (!kinds.length) {
        if (!namedOnly.has(key)) namedOnly.set(key, new Set());
        namedOnly.get(key).add(name);
        continue;
      }
      attributed++;
      if (!swept.has(key)) swept.set(key, { files: new Set(), kinds: new Set() });
      swept.get(key).files.add(name);
      for (const kind of kinds) swept.get(key).kinds.add(kind);
    }
    if (kinds.length && attributed === 0) unattributedSweeps++;
  }
  if (unclosed.length) {
    coverageLost(
      `${unclosed.length} testWidgets block(s) in ${rel} could not be closed by this parse ` +
        `(${unclosed.join('; ')}). A block this guard cannot read is a sweep it cannot see, and an ` +
        'invisible sweep reads exactly like an absent one — in the direction that reports LESS work than ' +
        'was done, silently moving a swept surface onto the printed list.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (C) EMPTY PARSE ⇒ COVERAGE LOST
//     Every statement below reads these two sets. Either one empty makes the
//     accounting vacuous in one direction and catastrophically wrong in the
//     other, and it reports as a pass. The marker string is what
//     assert-guard-coverage.mjs looks for.
// ═══════════════════════════════════════════════════════════════════════════
if (reachable.size === 0) {
  coverageLost(
    'the REACHABLE set parsed EMPTY. Nothing was found to require a sweep, so every existing a11y case ' +
      'would be reported as dead coverage and a router full of screens would be reported as fully ' +
      'accounted for. The router parse has stopped reaching the tree.',
  );
}
if (a11yFiles.length === 0) {
  coverageLost(
    `no file under ${TEST_REL} matched \`a11y_*_test.dart\`, so the swept set is empty by construction ` +
      'and every surface in the app would print as unswept — nineteen confident statements derived from ' +
      'having read nothing. The suite moved, or it was renamed out of this scan.',
  );
}
if (a11yFiles.length > 0 && a11yCases === 0) {
  coverageLost(
    `${a11yFiles.length} a11y test file(s) were read and NOT ONE \`testWidgets(\` block was parsed out of ` +
      'them. The block is this guard\'s unit of evidence; with none, the swept set is empty for a reason ' +
      'that has nothing to do with the app.',
  );
}
if (a11yCases > 0 && sweepingBlocks === 0) {
  coverageLost(
    `${a11yCases} a11y case(s) were parsed across ${a11yFiles.length} file(s) and NOT ONE of them calls a ` +
      `sweep (${SWEEP_FAMILIES.map((f) => f.kind).join(', ')}). Either the sweep was deleted, or it was ` +
      'renamed and this parse did not follow — and a renamed sweep reports as EVERY surface being unswept, ' +
      'which is nineteen confident statements about the wrong thing.',
  );
}

// Both sets are now built. Everything below reads them rather than the tree, so
// one parse failure above must not be reported as nineteen findings here.
const parsedCleanly = problems.length === 0;

// ═══════════════════════════════════════════════════════════════════════════
// (D) DEAD COVERAGE — a sweep whose subject nothing reaches
//
// The direction this repository paid for. `responsive_width_test.dart` spent
// its life measuring `features/firstrun/onboarding_screen.dart`, the STAMPED
// twin of the carousel — an unrouted copy no Subly user could ever open. The
// screen with the coverage had no user and the screen with the user had no
// coverage, and the suite was green the entire time. A sweep that audits a
// widget nobody can open reports coverage it does not have, and it is worse
// than no sweep because it makes the gap invisible.
// ═══════════════════════════════════════════════════════════════════════════
if (parsedCleanly) {
  for (const key of [...swept.keys()].filter((k) => !reachable.has(k)).sort()) {
    const [file, symbol] = key.split('#');
    problems.push(
      `DEAD COVERAGE — ${[...swept.get(key).files].join(', ')} sweeps \`${symbol}\` from \`${file}\`, and ` +
        'NOTHING REACHES IT. The sweep is green and it is auditing a widget no user can open. This is the ' +
        'unrouted-twin defect verbatim — Subly has already shipped two classes called `OnboardingScreen`, ' +
        'and the one with the coverage had no user. Re-point the case at the reachable surface, or route ' +
        'to this one.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (E) SWEPT_FLOOR — what WAS swept, by name
//
// 🔴 A COUNT WOULD NOT DO, AND THE MUTATION THAT PROVES IT IS: delete the
// insights sweep and add a home sweep in the same change. A `sweptSurfaces: 5`
// number stays satisfied, the printed list still has fourteen entries, and
// insights lost its coverage in silence. The floor is therefore a SET, and it
// names what it loses.
//
// It is NOT an allowlist and nothing can be added to it to silence anything —
// it is a measurement of work already done, and it is self-checked: an entry
// the domain no longer contains FAILS, because a floor over a surface that is
// not there is judgement over nothing.
//
// ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. It has no way to notice
// the tree growing past it, so ADDING to it belongs in the same change that
// adds the sweep — the step #280 skipped one domain over, which left
// assert-responsive-coverage's floor two surfaces under its tree for a week.
//
// MEASURED 2026-08-12 by running this guard against the working tree: these
// five `<file>#<Symbol>` keys were reported swept, each by a `nothing on … is
// naked` case in apps/subly/test/a11y_semantics_test.dart.
// ═══════════════════════════════════════════════════════════════════════════
const SWEPT_FLOOR = new Set([
  `${APP}/lib/features/insights/insights_screen.dart#InsightsScreen`,
  `${APP}/lib/features/budget/budget_screen.dart#BudgetScreen`,
  `${APP}/lib/features/scan/scan_screen.dart#ScanScreen`,
  `${APP}/lib/features/calendar/calendar_screen.dart#CalendarScreen`,
  `${APP}/lib/features/detail/subscription_detail_screen.dart#SubscriptionDetailScreen`,
  `${APP}/lib/features/auth/check_inbox_screen.dart#CheckInboxScreen`,
  `${APP}/lib/features/auth/verify_email_screen.dart#VerifyEmailScreen`,
  `${APP}/lib/features/auth/reaccept_terms_screen.dart#ReacceptTermsScreen`,
  `${APP}/lib/features/auth/login_screen.dart#LoginScreen`,
  `${APP}/lib/features/auth/sign_up_screen.dart#SignUpScreen`,
  `${APP}/lib/features/auth/reset_password_screen.dart#ResetPasswordScreen`,
  `${APP}/lib/features/home/home_screen.dart#HomeScreen`,
  `${APP}/lib/features/settings/settings_screen.dart#SettingsScreen`,
  `${APP}/lib/features/notifications/notifications_screen.dart#NotificationsScreen`,
  `${APP}/lib/features/monetization/paywall_screen.dart#PaywallScreen`,
  `${APP}/lib/features/monetization/manage_plan_screen.dart#ManagePlanScreen`,
  `${APP}/lib/features/onboarding/onboarding_screen.dart#OnboardingScreen`,
  `${APP}/lib/features/add/add_subscription_sheet.dart#showAddSubscriptionSheet`,
  `${APP}/lib/features/cancel/cancel_sheet.dart#showCancelSheet`,
]);

if (parsedCleanly) {
  for (const key of [...SWEPT_FLOOR].sort()) {
    if (!reachable.has(key)) {
      problems.push(
        `FLOOR OVER NOTHING — \`${key}\` is recorded in SWEPT_FLOOR as a surface this app sweeps, and ` +
          'nothing in the app reaches it any more. Either it moved and the floor did not follow, or it is ' +
          'retired and the entry should have gone with it. An entry for something that is not there ' +
          'reports judgement over nothing, and it makes the floor below it unfalsifiable.',
      );
      continue;
    }
    if (!swept.has(key)) {
      const [file, symbol] = key.split('#');
      const alsoNamed = namedOnly.get(key);
      problems.push(
        `REGRESSION — \`${symbol}\` (${file}) was swept when this floor was measured (2026-08-12) and NO ` +
          'a11y case sweeps it now. ' +
          (alsoNamed
            ? `${[...alsoNamed].join(', ')} still NAMES it, and naming is not sweeping: a case that ` +
              'asserts one label says nothing about whether the screen carries a tap action with no role ' +
              'or no name. '
            : '') +
          'Work leaving the tree is a legitimate move and it may not be a quiet one — restore the sweep, ' +
          'or remove this entry in the same change with the reason written beside it.',
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (F) REQUIRED_COVERAGE — the floors set membership cannot see
//
// 🔴 NEITHER IS REDUNDANT WITH ANYTHING ABOVE, AND EACH HAS THE MUTATION THAT
// PROVES IT:
//   surfaces  delete a route AND its screen file in one change. The reachable
//             set shrinks, nothing above says a word — a surface that is gone
//             is not unswept, it is absent — and the printed list gets SHORTER,
//             which reads like progress. This floor is the only thing that sees
//             a domain being emptied wholesale.
//   cases     delete the `[ta]` Tamil donut case. InsightsScreen is still
//             constructed and still swept by its own case, so every set above
//             is byte-identical and a real assertion left the tree in silence.
//             P5 shipped 24; a smaller number is coverage leaving, not tidying.
//
// 🔴 THIS FLOOR WENT BLIND FOR THE LENGTH OF ONE COMMIT, AND THE CAUSE IS THE
// EXACT SHAPE THIS FILE'S HEADER WARNS ABOUT. The 2026-08-13 sweep moved
// SWEPT_FLOOR 5 → 19 and left `cases` at 24 while the suite grew 24 → 60. Both
// numbers were measured on the same day from the same file; only one was
// carried. Measured consequence, not a worry: **36 cases could be deleted
// before this limb said one word** — and since exactly 36 of the 60 are
// non-sweeping, the floor could no longer fire AT ALL without a sweep also
// being deleted, which the sets above already catch. A floor that can only
// fire when something else fires first is not a floor.
// 📌 A guard extended in one dimension must be re-measured in EVERY dimension
// it carries. Raising the membership set is not raising the count.
// ═══════════════════════════════════════════════════════════════════════════
const REQUIRED_COVERAGE = {
  // MEASURED on the working tree of 2026-08-13, not set from ambition:
  //   19 reachable surfaces — 17 routed screens + 2 modal sheets
  //   60 testWidgets cases in 1 file (a11y_semantics_test.dart), of which 24
  //      call a sweep helper and 36 assert a single label without sweeping
  //
  // ⚠️ `surfaces: 19` IS THE SAME NUMBER assert-responsive-coverage.mjs CARRIES
  // and that is a MEASUREMENT, not a copy. The two guards range over the same
  // domain by design, so agreement is the expected reading and a DISAGREEMENT
  // is the signal that one of the two parses has drifted from the other. If you
  // change one, RE-MEASURE the other rather than mirroring the edit.
  surfaces: 19,
  cases: 60,
};
if (reachable.size > 0 && reachable.size < REQUIRED_COVERAGE.surfaces) {
  coverageLost(
    `only ${reachable.size} reachable surface(s) are in the domain, and the checked-in floor is ` +
      `${REQUIRED_COVERAGE.surfaces}. Nothing else here can see this: a surface that is GONE is not ` +
      'unswept, it is absent, and the printed list below merely gets shorter — which reads like progress. ' +
      'Lower the floor deliberately in the same change that removes the surface, with the reason beside it.',
  );
}
if (a11yCases > 0 && a11yCases < REQUIRED_COVERAGE.cases) {
  coverageLost(
    `only ${a11yCases} a11y case(s) were found across ${a11yFiles.length} file(s), and the checked-in ` +
      `floor is ${REQUIRED_COVERAGE.cases}. Cases can be deleted without changing either set above — the ` +
      'screen stays swept by one surviving case while every label, locale and falsifier assertion around ' +
      'it goes. P5 shipped 24; a smaller number is coverage leaving the tree, not a tidy-up.',
  );
}

// ── THE EXCLUSION SELF-CHECKS ──────────────────────────────────────────────
for (const [symbol, why] of NOT_A_PANE) {
  if (!routerTargets.has(symbol)) {
    problems.push(
      `\`${symbol}\` is excluded in NOT_A_PANE but no route in ${ROUTER_REL} builds it. Either it moved ` +
        'and the entry did not follow, or it is retired and the entry should have gone with it — an ' +
        'exception for something that is not there reports judgement over nothing.',
    );
  }
  const declaredAsSurface = featureDartFiles.find((f) => surfacesIn(f).includes(symbol));
  if (declaredAsSurface) {
    problems.push(
      `\`${symbol}\` is excluded in NOT_A_PANE but \`${declaredAsSurface}\` declares it as a feature ` +
        'surface. It is a surface after all; remove the exclusion and let it be swept or printed like ' +
        'every other one.',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (G) THE REPORT — swept, unswept, excluded. ALL OF IT PRINTED, EVERY RUN.
//
// Counted is not enough. The failure this repository keeps recording is an
// unmet clause that produced NO OUTPUT AT ALL, so the fourteen unswept surfaces
// are read aloud on a GREEN run and stay uncomfortable to read. There is no
// deferral list to add a screen to and no reason field to fill in: the list is
// DERIVED from the domain minus the sweeps, so it cannot drift from either, and
// a surface added tomorrow joins it by existing rather than by somebody
// remembering.
// ═══════════════════════════════════════════════════════════════════════════
const unswept = [...reachable.keys()].filter((k) => !swept.has(k)).sort();

if (parsedCleanly && problems.length === 0) {
  ok(
    `${swept.size} of ${reachable.size} reachable surface(s) carry an a11y sweep, from ` +
      `${a11yFiles.length} a11y test file(s) across ${a11yCases} case(s)`,
  );
}

if (swept.size) {
  notes.push(`✅ ${swept.size} surface(s) SWEPT — the sweep is what can fail on a control added tomorrow:`);
  for (const key of [...swept.keys()].sort()) {
    const { files, kinds } = swept.get(key);
    notes.push(`   · ${key.split('#')[1]} — ${[...kinds].sort().join(' + ')} (${[...files].sort().join(', ')})`);
  }
}
notes.push(
  `   sweep families used: ${SWEEP_FAMILIES.map((f) => `${f.kind} ×${kindTally.get(f.kind)}`).join(', ')}` +
    `${unattributedSweeps ? `; ${unattributedSweeps} sweeping case(s) construct no domain surface directly (the shell case pumps the real router)` : ''}`,
);

if (unswept.length) {
  notes.push(
    `⬜ ${unswept.length} of ${reachable.size} reachable surface(s) carry NO a11y sweep. Printed, not ` +
      'failed: this is work nobody has started, and reddening CI over it would block every unrelated ' +
      'change. It is still owed —',
  );
  for (const key of unswept) {
    const { file, symbol, via, kind } = reachable.get(key);
    const alsoNamed = namedOnly.get(key);
    notes.push(
      `   · ${symbol} (${kind}, ${file}${via ? `, via ${via}` : ''})` +
        (alsoNamed
          ? ` — ${[...alsoNamed].sort().join(', ')} NAMES it but never sweeps it; a case asserting one ` +
            'label says nothing about a tap action with no role or no name'
          : ''),
    );
  }
  notes.push(
    `   → add a case to ${TEST_REL}/a11y_*_test.dart that pumps the surface and calls ` +
      '`expectNothingNaked(tester, …)`, and add its key to SWEPT_FLOOR in the same change.',
  );
}

if (excluded.length) {
  notes.push(`⬜ ${excluded.length} builder target(s) DELIBERATELY OUTSIDE the domain, printed not hidden:`);
  for (const e of excluded.sort((a, b) => a.what.localeCompare(b.what))) notes.push(`   · ${e.what} — ${e.why}`);
}
if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-a11y-coverage: FAILED');
  process.exit(1);
}

console.log(
  `\nassert-a11y-coverage: ok — ${reachable.size} reachable surface(s) (${reachable.size - sheetCount} routed ` +
    `screens, ${sheetCount} modal sheets); ${swept.size} swept by ${a11yFiles.length} a11y test file(s) ` +
    `across ${a11yCases} case(s); ${unswept.length} unswept and PRINTED; ${excluded.length} exclusion(s) printed`,
);
