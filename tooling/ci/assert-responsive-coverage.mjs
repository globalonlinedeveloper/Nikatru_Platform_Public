#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// EVERY SURFACE A USER CAN REACH HAS A WIDTH MEASUREMENT, AND EVERY WIDTH
// MEASUREMENT POINTS AT A SURFACE A USER CAN REACH.
//
// ── THE DOMAIN RULE, STATED ONCE ───────────────────────────────────────────
// The domain is the RESPONSIVE SURFACES of apps/subly, and it is exactly two
// things:
//
//   (1) ROUTED SCREENS — every widget a `builder:` in `lib/core/router.dart`
//       returns, INCLUDING the routes inside the StatefulShellRoute branches.
//       A builder target declared IN the router itself (a private `_Wrapper`,
//       e.g. `_GatedInsights`) is resolved ONE LEVEL to the feature screen it
//       builds, because the wrapper is a gate and the pane is what the user
//       looks at.
//   (2) MODAL SHEETS — every `show*Sheet` function declared under
//       `lib/features/**`. A bottom sheet is a full surface on a 1920 px
//       display and nothing about being modal caps its width.
//
// Everything else a `builder:` returns is an EXCLUSION, and exclusions are
// PRINTED ON EVERY RUN with their reason — never dropped silently. There are
// two shapes of them and both are argued below in NOT_A_PANE:
//   · the SHELL WRAPPER (`AppShell`) — chrome, not a pane; its five branch
//     routes are each in the domain on their own account;
//   · the DIALOG/ERROR surface (`NotFoundScreen`) — declared in
//     packages/design_system, so the design system owns its width, not Subly.
// A redirect-only `GoRoute` (there is one, `/`) has no builder and therefore
// no pane; it is printed too, for the same reason.
//
// 🔴 AN UNKNOWN BUILDER TARGET IS A FAILURE, NOT AN EXCLUSION. The map is a
// statement about two known non-panes, not an allowlist screens can be added
// to. Anything the router builds that is neither a feature surface nor one of
// those two named non-panes fails the build by name. There is NO subly
// exemption here and no way to add one: `assert-stamp-properties.mjs` carries
// an EXEMPT_APPS list and Subly sat in it; this guard deliberately has no
// equivalent, because the app with the most screens is the one that most needs
// the check.
//
// ── WHY BOTH DIRECTIONS ────────────────────────────────────────────────────
// Set equality, not containment, and the second direction is the one this
// repository paid for:
//
//   · a ROUTED SCREEN WITH NO WIDTH TEST fails naming the screen. "The content
//     grew to fill a 1920 px display" throws no exception, clips no pixel and
//     fails no existing assertion — it is only ever visible to a measurement,
//     so an unmeasured pane is an unpoliced one.
//   · a WIDTH TEST WHOSE SUBJECT IS NOT ROUTED fails naming the subject. This
//     is DEAD COVERAGE, and it is not hypothetical: `responsive_width_test.dart`
//     spent its life measuring `features/firstrun/onboarding_screen.dart`, the
//     STAMPED twin of the carousel — an unrouted copy no Subly user could ever
//     reach. `core/router.dart` sends a fresh install to `features/onboarding/`.
//     The screen with the width cap had no user and the screen with the user
//     had no width cap, and the suite was green the entire time. A test that
//     measures a widget nobody can open reports coverage it does not have, and
//     it is worse than no test because it makes the gap invisible.
//
// 🔴 WHICH IS WHY BOTH SETS ARE KEYED BY `<file>#<Symbol>`, NEVER BY THE BARE
// CLASS NAME. Both onboarding screens were called `OnboardingScreen`. A guard
// comparing names would have found the routed `OnboardingScreen` present in the
// covered set and reported clean — it would have written the exact bug it
// exists to catch into its own answer. The file is what distinguishes a twin
// from its original, so the file is part of the identity.
//
// ── HOW A SUBJECT IS ESTABLISHED ───────────────────────────────────────────
// A width test covers `<file>#<Symbol>` when it IMPORTS that feature file
// (`package:subly/features/…`) AND CONSTRUCTS/INVOKES that symbol (`Symbol(`).
// Both halves are required: the import gives provenance (which file the symbol
// came from) and the construction gives evidence (the test actually pumps it).
// An import alone proves nothing — `width_cancel_sheet_test.dart` imports
// `features/shared/widgets.dart` for its row primitives and that file is not a
// surface — and a bare name alone is the twin trap above.
//
// ── COMMENTS ARE STRIPPED BEFORE ANY MATCHING ──────────────────────────────
// Via tooling/ci/text-reductions.mjs, the one reduction nine guards share. The
// header you are reading names `OnboardingScreen`, `AppShell`, `showCancelSheet`
// and `features/firstrun/onboarding_screen.dart`; unstripped, this file's own
// prose would be a parse of a router. A guard that greps prose reports the
// opposite of the truth exactly when the code is right.
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
const HARNESS_REL = `${TEST_REL}/support/width_harness.dart`;

const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

const read = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart');

// ── THE TWO NON-PANES, ARGUED ──────────────────────────────────────────────
// Not an allowlist. Each entry is a claim about WHAT KIND OF THING the symbol
// is, and each is self-checked twice below: an entry the router no longer
// builds fails (an exception for something that is not there reports judgement
// over nothing), and an entry that turns out to be a feature surface after all
// fails (it scans as a pane; the exclusion is wrong).
const NOT_A_PANE = new Map([
  [
    'AppShell',
    'is the shell CHROME, not a pane — it hosts the bottom nav and an IndexedStack of the five branch ' +
      'routes, each of which is in this domain on its own account (home, calendar, insights, budget, ' +
      'settings). Measuring the shell would measure the display, since the nav bar is meant to span it.',
  ],
  [
    'NotFoundScreen',
    'is the errorBuilder surface and it is DECLARED IN packages/design_system, not in this app — the ' +
      'design system owns its width and every stamped app inherits that decision, so a Subly-local width ' +
      'test would assert a property Subly does not control.',
  ],
]);

// ── SURFACE VOCABULARY ─────────────────────────────────────────────────────
// A surface is a `…Screen` class or a `show…Sheet` function. Deliberately the
// SAME vocabulary on both sides: the routed set and the covered set must agree
// about what counts as a surface, or the equality below compares two different
// questions.
const SCREEN_DECL = /\bclass\s+([A-Za-z_$][\w$]*Screen)\b/g;
const SHEET_DECL = /^[ \t]*(?:Future<[^>]*>|void)\s+(show[A-Z][\w$]*Sheet)\s*\(/gm;

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
 *  Used for BOTH an argument list and a class body, and the bound matters in
 *  each: an unbounded `slice(start)` for a class body would let the wrapper
 *  resolution below read symbols from every line AFTER the class, which happens
 *  to be correct today only because `_GatedInsights` is the last declaration in
 *  the file. A parse that is right by file order is a parse waiting to be wrong. */
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
// (A) THE ROUTED SET
// ═══════════════════════════════════════════════════════════════════════════
if (!existsSync(join(ROOT, ROUTER_REL))) {
  coverageLost(
    `${ROUTER_REL} does not exist, so the routed-screen half of this check ranged over NOTHING and would ` +
      'have reported every width test as dead coverage. The router is the domain; without it there is no question.',
  );
}

const routed = new Map(); // "<featureFile>#<Symbol>" → { file, symbol, via }
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
  // this parse cannot classify FAILS instead of vanishing. A screen dropped by
  // a parser looks exactly like a screen that was never there.
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
        why: 'is REDIRECT-ONLY — it declares no builder, so it renders nothing and there is no pane to measure.',
      });
      continue;
    }
    unparsed.push(`a GoRoute( at offset ${m.index} with neither a builder: nor a redirect:`);
  }
  if (unparsed.length) {
    coverageLost(
      `${unparsed.length} route(s) in ${ROUTER_REL} could not be classified: ${unparsed.join('; ')}. ` +
        'An unclassified route is a screen this guard cannot see, and an invisible screen reads exactly ' +
        'like a covered one.',
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
            'surface. A wrapper that wraps nothing measurable is a route whose pane nothing can be ' +
            'pointed at; name the screen it builds or stop routing to it.',
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
            'it is a pane (give it a width test) or it is not (say why, in NOT_A_PANE).',
        );
      }
      continue;
    }
    const file = files[0];
    routed.set(`${file}#${symbol}`, { file, symbol, via });
  }

  if (goRoutes > 0) {
    ok(`${goRoutes} GoRoute(s) parsed — ${goRoutes - redirectOnly} with a builder, ${redirectOnly} redirect-only`);
  }
}

// ── MODAL SHEETS — the other half of the domain ────────────────────────────
const featureDartFiles = featureFiles();
if (featureDartFiles.length === 0) {
  coverageLost(
    `no .dart file was found under ${FEATURES_REL}, so the modal-sheet half of the domain is empty and ` +
      'every sheet width test would read as dead coverage. The scan is pointed at the wrong tree.',
  );
}
for (const rel of featureDartFiles) {
  for (const symbol of surfacesIn(rel)) {
    if (!symbol.startsWith('show')) continue; // screens enter the domain via the router, not the disk
    routed.set(`${rel}#${symbol}`, { file: rel, symbol, via: null });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (B) THE COVERED SET
// ═══════════════════════════════════════════════════════════════════════════
const WIDTH_TEST = /^(?:width_.*_test|responsive_width_test)\.dart$/;
let testFiles = [];
try {
  testFiles = listDir(join(ROOT, TEST_REL)).filter((f) => WIDTH_TEST.test(f)).sort();
} catch {
  /* absent — the empty-parse check below is the report */
}

const covered = new Map(); // "<featureFile>#<Symbol>" → [test file, …]
for (const name of testFiles) {
  const rel = `${TEST_REL}/${name}`;
  const code = read(rel);

  const declaredHere = new Map(); // Symbol → [feature file, …]
  for (const m of code.matchAll(/import\s+'package:subly\/(features\/[^']+\.dart)'/g)) {
    const featureRel = `${APP}/lib/${m[1]}`;
    for (const symbol of surfacesIn(featureRel)) {
      if (!declaredHere.has(symbol)) declaredHere.set(symbol, []);
      declaredHere.get(symbol).push(featureRel);
    }
  }

  for (const [symbol, files] of declaredHere) {
    // Construction/invocation, not a bare mention: `find.byType(HomeScreen)`
    // names a widget without pumping one, and a name in an argument list is
    // not a measurement.
    if (!new RegExp(`\\b${symbol}\\s*\\(`).test(code)) continue;
    if (files.length > 1) {
      problems.push(
        `AMBIGUOUS SUBJECT — ${rel} imports ${files.length} feature files that each declare \`${symbol}\` ` +
          `(${files.join(', ')}), so this guard cannot tell WHICH of them the test pumps. Keying by file is ` +
          'exactly what catches an unrouted twin, and a collision inside one test defeats it.',
      );
      continue;
    }
    const key = `${files[0]}#${symbol}`;
    if (!covered.has(key)) covered.set(key, []);
    covered.get(key).push(name);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (D) EMPTY PARSE ⇒ COVERAGE LOST
//     Either set empty makes the equality below TRIVIALLY TRUE in one
//     direction and catastrophically wrong in the other, and it reports as a
//     pass. The marker string is what assert-guard-coverage.mjs looks for.
// ═══════════════════════════════════════════════════════════════════════════
if (routed.size === 0) {
  coverageLost(
    'the ROUTED set parsed EMPTY. Nothing was found to require a width test, so every existing width test ' +
      'would be reported as dead coverage and a router full of screens would be reported as fully covered. ' +
      'The router parse has stopped reaching the tree.',
  );
}
if (covered.size === 0) {
  coverageLost(
    `the COVERED set parsed EMPTY — ${testFiles.length} width test file(s) were read and not one subject was ` +
      'established. Either the tests moved, or the way they name their subject changed and this parse did ' +
      'not follow. An empty covered set makes "no dead coverage" vacuously true.',
  );
}

// Both sets are now built. Everything below reads them rather than the tree,
// so one parse failure above must not be reported as seventeen findings here.
const parsedCleanly = problems.length === 0;

// ═══════════════════════════════════════════════════════════════════════════
// (C) SET EQUALITY, BOTH DIRECTIONS
// ═══════════════════════════════════════════════════════════════════════════
if (parsedCleanly) {
  const uncovered = [...routed.keys()].filter((k) => !covered.has(k)).sort();
  for (const key of uncovered) {
    const { file, symbol, via } = routed.get(key);
    problems.push(
      `UNCOVERED SURFACE — \`${symbol}\` (${file}${via ? `, routed via ${via}` : ''}) is reachable and NO ` +
        'width test measures it. "The content grew to fill a 1920 px display" raises no exception and ' +
        'clips no pixel; a pane with no measurement is a pane with no width decision. Add ' +
        `\`${TEST_REL}/width_*_test.dart\` pumping it at kWide.`,
    );
  }

  const dead = [...covered.keys()].filter((k) => !routed.has(k)).sort();
  for (const key of dead) {
    const [file, symbol] = key.split('#');
    problems.push(
      `DEAD COVERAGE — ${covered.get(key).join(', ')} measures \`${symbol}\` from \`${file}\`, and NOTHING ` +
        'ROUTES TO IT. The measurement is green and it is measuring a widget no user can open. This is the ' +
        'unrouted-twin defect verbatim: the screen with the width cap had no user and the screen with the ' +
        'user had no width cap. Re-point the test at the routed surface, or route to this one.',
    );
  }

  if (uncovered.length === 0 && dead.length === 0) {
    ok(`${routed.size} surface(s) routed, ${covered.size} measured — the two sets are EQUAL`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (E) WHICH WINDOWS THE MEASUREMENT ACTUALLY PUMPS
//
// 🔴 SET EQUALITY ONLY ASKS WHETHER A FILE EXISTS, AND A FILE IS NOT A
// MEASUREMENT. `width_home_test.dart` shipped with three cases — 375, 1500,
// 1920 — and NO 768 and NO 1280, the only surface in the app measured at
// neither. Both sets contained `home_screen.dart#HomeScreen`, the equality
// printed EQUAL, and the two window classes between a phone and an ultra-wide
// display went unmeasured inside a green tree. `home` was excluded from the
// Phase-3 port (`knowledge/plans/p3-portspecs/MANIFEST.md`) and its width test
// was backfilled later at one width; nothing downstream noticed the difference
// between "ported" and "backfilled" because nothing downstream read the widths.
//
// So the covered set is re-read for WHAT IT PUMPS, and the required widths are
// the harness's own named window classes — [kPhone], [kTablet], [kDesktop].
// Not [kWide]: 1920 is the case that can go red for a `kMaxBodyWidth` screen and
// is meaningless for one capped at `pane`, so requiring it would force an
// assertion that cannot fail onto half the domain. The three required ones are
// the CLASSES a layout branches on, and a surface unmeasured in one of them has
// no width decision there whatever its file count says.
//
// 🔴 THE NUMBERS ARE READ OUT OF THE HARNESS, NEVER RESTATED HERE. If this file
// carried its own 375/768/1280 and the harness moved `kTablet` to 800, the
// requirement would go on being satisfied by a constant nothing pumps. The
// harness is the vocabulary; this guard quotes it.
//
// ⚠️ STRING LITERALS ARE STRIPPED AS WELL AS COMMENTS, and that is not
// belt-and-braces: `width_scan_test.dart` and `width_insights_test.dart` both
// carry the word `kWide` inside an `expect` REASON explaining why the screen
// needs no such case. Comment-stripping alone leaves those, so a prose
// explanation of an ABSENT case would have satisfied the check for it — the
// `r2_buckets` defect verbatim, in a file arguing the opposite of what it was
// credited with.
// ═══════════════════════════════════════════════════════════════════════════

/** Window class → width, read from the harness's own `const Size` declarations. */
const windowClasses = new Map();
if (existsSync(join(ROOT, HARNESS_REL))) {
  for (const m of read(HARNESS_REL).matchAll(
    /\bconst\s+Size\s+(k[A-Za-z0-9_$]*)\s*=\s*(?:const\s+)?Size\(\s*(\d+(?:\.\d+)?)\s*,/g,
  )) {
    windowClasses.set(m[1], Number(m[2]));
  }
}
const REQUIRED_WIDTHS = ['kPhone', 'kTablet', 'kDesktop'];

// ── THE ONE ARGUED EXEMPTION ───────────────────────────────────────────────
// Same shape and same discipline as NOT_A_PANE: a claim about a specific
// surface, printed every run, and self-checked twice below — an entry for a
// surface that is not covered fails, and an entry for a width the test DOES
// pump fails as stale.
const WIDTH_EXEMPT = new Map([
  [
    `${APP}/lib/features/monetization/paywall_screen.dart#PaywallScreen`,
    new Map([
      [
        'kDesktop',
        'is capped at `AppBreakpoints.pane` (480), not at `kMaxBodyWidth` — so the cap has ALREADY engaged ' +
          'at 768 and the file asserts the flat 480 there and again at 1920. 1280 is not a boundary for a ' +
          '480 cap the way it is for a 1280 one; a case there would assert the same constant, bound the ' +
          'same way, between two surfaces that already bracket it.',
      ],
    ]),
  ],
]);

const pumpedCache = new Map();
/** The surface widths a width test file actually pumps.
 *
 *  A size reaches a case one of two ways — a harness window constant in an
 *  argument position (`pumpAt(tester, kTablet, …)`, `setSurface(tester, kPhone)`,
 *  and this app's own `_openSheetAt(tester, kDesktop)`), or a `Size(w, h)`
 *  written inline (`home`'s 1500). Both are counted; the argument-position bound
 *  is what keeps a constant merely NAMED from counting as one pumped. */
function widthsPumpedBy(name) {
  if (pumpedCache.has(name)) return pumpedCache.get(name);
  const code = stripStringLiterals(read(`${TEST_REL}/${name}`));
  const out = new Set();
  for (const [windowClass, width] of windowClasses) {
    if (new RegExp(`[(,]\\s*${windowClass}\\s*[,)]`).test(code)) out.add(width);
  }
  // `\bSize\(` and not `Size\(`: `tester.getSize(...)` is not a size literal.
  for (const m of code.matchAll(/\bSize\(\s*(\d+(?:\.\d+)?)\s*,/g)) out.add(Number(m[1]));
  pumpedCache.set(name, out);
  return out;
}

if (windowClasses.size === 0) {
  coverageLost(
    `no \`const Size k… = Size(w, h)\` declaration was found in ${HARNESS_REL}, so the required widths ` +
      'resolved to NOTHING and every surface would have passed the width check by default. The harness ' +
      'moved, or its window classes are now spelled some other way.',
  );
}
for (const windowClass of REQUIRED_WIDTHS) {
  if (!windowClasses.has(windowClass)) {
    problems.push(
      `\`${windowClass}\` is required of every responsive surface and ${HARNESS_REL} no longer declares it. ` +
        'A requirement naming a constant that does not exist ranges over nothing and reports clean.',
    );
  }
}

if (parsedCleanly && windowClasses.size > 0) {
  for (const key of WIDTH_EXEMPT.keys()) {
    if (!covered.has(key)) {
      problems.push(
        `\`${key}\` is exempted from a required width but it is not in the covered set at all. An exemption ` +
          'for a surface nothing measures reports judgement over nothing — it moved, or it is gone.',
      );
    }
  }

  for (const key of [...covered.keys()].sort()) {
    const [file, symbol] = key.split('#');
    const pumped = new Set();
    for (const name of covered.get(key)) for (const w of widthsPumpedBy(name)) pumped.add(w);
    const exempt = WIDTH_EXEMPT.get(key) ?? new Map();

    for (const windowClass of REQUIRED_WIDTHS) {
      const width = windowClasses.get(windowClass);
      if (pumped.has(width)) continue;
      if (exempt.has(windowClass)) continue;
      problems.push(
        `UNMEASURED WIDTH — \`${symbol}\` (${file}) is measured by ${covered.get(key).join(', ')}, and not ` +
          `one case pumps ${windowClass} (${width}). The widths it does pump are ` +
          `${[...pumped].sort((a, b) => a - b).join(', ') || '(none this parse could read)'}. A width test ` +
          'file is not a width measurement: the set equality above sees the file and cannot see which ' +
          'windows it opens. Add the case, or argue the omission in WIDTH_EXEMPT.',
      );
    }

    for (const [windowClass, why] of exempt) {
      if (!windowClasses.has(windowClass)) continue; // already reported above
      if (pumped.has(windowClasses.get(windowClass))) {
        problems.push(
          `STALE EXEMPTION — \`${symbol}\` (${file}) is exempted from ${windowClass} on the grounds that it ` +
            `${why} — but ${covered.get(key).join(', ')} now pumps it. The case exists; delete the ` +
            'exemption so the width is required of it like every other surface.',
        );
      }
    }
  }

  if (problems.length === 0) {
    ok(
      `every surface is pumped at ${REQUIRED_WIDTHS.map((w) => `${w} (${windowClasses.get(w)})`).join(', ')}` +
        `${WIDTH_EXEMPT.size ? ` — ${WIDTH_EXEMPT.size} argued exemption(s), printed below` : ''}`,
    );
  }
}

for (const [key, widths] of WIDTH_EXEMPT) {
  for (const [windowClass, why] of widths) {
    notes.push(`⬜ ${key.split('#')[1]} is NOT required at ${windowClass} — it ${why}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (F) REQUIRED_COVERAGE — the floor set equality cannot see
//
// 🔴 THIS IS NOT REDUNDANT WITH THE EQUALITY ABOVE, AND THE MUTATION THAT
// PROVES IT IS: delete a screen from the router AND delete its width test in
// the same change. Both sets shrink by one, they stay EQUAL, and every message
// above still says "the two sets are EQUAL". Coverage left the tree and the
// guard applauded. The floor is the only thing that sees a domain being
// emptied wholesale — the same idiom as check-migrations.mjs's REQUIRED_COVERAGE
// and assert-screen-set.mjs's MIN_PRESENT: a checked-in number that only ever
// moves with a reason written beside it.
//
// A pane genuinely leaving the app is a legitimate move. It may not be a QUIET
// one.
// ═══════════════════════════════════════════════════════════════════════════
const REQUIRED_COVERAGE = {
  // 15 routed screens + 2 modal sheets, measured on the tree of 2026-08-11.
  //
  // 🔴 RAISED 15 → 17 AND 14 → 15 ON 2026-08-11 — NOT BECAUSE ANYTHING WAS ADDED
  // TODAY, BUT BECAUSE THE FLOOR HAD STOPPED BEING ONE. #280 landed
  // `verify_email_screen.dart` and `reaccept_terms_screen.dart` with their
  // `width_legal_gates_test.dart`; this file last moved in #275 and did not
  // follow. A floor two under the tree is exactly the mutation the clause below
  // describes and cannot catch: those two screens AND their test could have been
  // deleted in one change today, both sets would have shrunk together, the
  // equality would have printed EQUAL and this number would have printed nothing
  // at all. Re-measured against the tree rather than incremented by hand.
  //
  // ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. It has no way to
  // notice the tree growing past it, so raising it belongs in the same change
  // that adds the surface — which is the step #280 skipped.
  //
  // 🔴 LOWERED 16 → 15 ON 2026-08-10, AND THIS IS THE REASON, WRITTEN BESIDE IT
  // AS THIS CLAUSE DEMANDS. `/sign-in` became the canonical auth route that day
  // and `/login` became a redirect onto it (owner decision; two URLs for one
  // gate is a fork every written link ages into). The canonical route builds
  // the LIVE `LoginScreen` — the surface carrying the ADR-027 deletion notice
  // and the `E2EKeys.login*` anchors — so the stamped `SignInScreen` twin was
  // left with no route at all and was DELETED rather than kept as an unopenable
  // pane. One surface genuinely left the app; the floor moves with it, once,
  // deliberately, and it is a floor again immediately.
  //
  // ⚠️ `widthTestFiles` DID NOT MOVE. `width_auth_test.dart` still exists — it
  // lost its sign-in group and kept its sign-up one. A file count and a surface
  // count answer different questions and only one of them changed.
  // ═════════════════════════════════════════════════════════════════════════
  // 🔴 SET TO THE TREE AS MEASURED ON 2026-08-11 — 18 SURFACES, 15 WIDTH TEST
  // FILES. Not incremented, not inherited: this is the number
  // `node tooling/ci/assert-responsive-coverage.mjs` printed on the merged tree
  // on that date —
  //
  //     18 reachable surface(s) (16 routed screens, 2 modal sheets),
  //     all measured by 15 width test file(s) at 375/768/1280
  //
  // WHY IT IS A MEASUREMENT AND NOT AN INCREMENT. The floor had fallen two
  // surfaces and one file behind the tree and nobody noticed, because a floor
  // BELOW the tree is silent by construction — the clause below fires only when
  // the tree drops under it. #280 landed `verify_email_screen.dart` and
  // `reaccept_terms_screen.dart` with their `width_legal_gates_test.dart`;
  // this file last moved in #275 and did not follow. So the slack was real:
  // those two screens AND their test could have been deleted in one change,
  // both sets would have shrunk together, the equality above would have printed
  // EQUAL, and this number would have printed nothing at all.
  //
  // ⚠️ TWO CHANGES CROSSED HERE AND THE ARITHMETIC IS WRITTEN DOWN RATHER THAN
  // TRUSTED. #286 (`/check-inbox`) raised `surfaces` 15 → 16 for the one
  // surface it added, and recorded that it was deliberately NOT closing the
  // rest — a change does not get to re-pin a floor to whatever the tree happens
  // to measure when it did not add the things being counted. This change was
  // measured separately, against a tree WITHOUT `/check-inbox`, and read 17/15.
  // NEITHER number is the answer for the merged tree, and taking the higher of
  // the two on faith would have left the floor one surface short with nothing
  // to say so. The tree was re-measured after both had landed; 18/15 is that
  // reading.
  //
  // ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. It cannot notice the
  // tree growing past it, so raising it belongs in the same change that adds
  // the surface — which is the step #280 skipped and the reason this block
  // exists.
  // ═════════════════════════════════════════════════════════════════════════
  surfaces: 18,
  // 14 `width_*_test.dart` + `responsive_width_test.dart`.
  widthTestFiles: 15,
};
if (routed.size > 0 && routed.size < REQUIRED_COVERAGE.surfaces) {
  coverageLost(
    `only ${routed.size} responsive surface(s) are in the domain, and the checked-in floor is ` +
      `${REQUIRED_COVERAGE.surfaces}. Set equality cannot see this: a screen and its width test deleted ` +
      'together keep the two sets equal while the domain shrinks. Raise the floor deliberately in the same ' +
      'change that removes the surface, with the reason beside it.',
  );
}
if (testFiles.length < REQUIRED_COVERAGE.widthTestFiles) {
  coverageLost(
    `only ${testFiles.length} width test file(s) matched \`width_*_test.dart\`/\`responsive_width_test.dart\` ` +
      `under ${TEST_REL}, and the checked-in floor is ${REQUIRED_COVERAGE.widthTestFiles}. The files did not ` +
      'become correct; the scan stopped reaching them.',
  );
}

// ── EXCLUSIONS, PRINTED EVERY RUN ──────────────────────────────────────────
// Counted is not enough. The failure this repo keeps recording is an unmet
// clause that produced NO OUTPUT AT ALL, so each exclusion is read aloud on
// every green run and can be re-argued by anyone reading the log.
for (const [symbol, why] of NOT_A_PANE) {
  if (!routerTargets.has(symbol)) {
    problems.push(
      `\`${symbol}\` is excluded in NOT_A_PANE but no route in ${ROUTER_REL} builds it. Either it moved and ` +
        'the entry did not follow, or it is retired and the entry should have gone with it — an exception ' +
        'for something that is not there reports judgement over nothing.',
    );
  }
  const declaredAsSurface = featureDartFiles.find((f) => surfacesIn(f).includes(symbol));
  if (declaredAsSurface) {
    problems.push(
      `\`${symbol}\` is excluded in NOT_A_PANE but \`${declaredAsSurface}\` declares it as a feature surface. ` +
        'It is a pane after all; remove the exclusion and measure it.',
    );
  }
}
if (excluded.length) {
  notes.push(`⬜ ${excluded.length} builder target(s) DELIBERATELY OUTSIDE the domain, printed not hidden:`);
  for (const e of excluded.sort((a, b) => a.what.localeCompare(b.what))) notes.push(`   · ${e.what} — ${e.why}`);
}
if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-responsive-coverage: FAILED');
  process.exit(1);
}

console.log(
  `\nassert-responsive-coverage: ok — ${routed.size} reachable surface(s) (${routed.size - featureDartFiles.filter((f) => surfacesIn(f).some((s) => s.startsWith('show'))).length} routed screens, ` +
    `${featureDartFiles.filter((f) => surfacesIn(f).some((s) => s.startsWith('show'))).length} modal sheets), ` +
    `all measured by ${testFiles.length} width test file(s) at ${REQUIRED_WIDTHS.map((w) => windowClasses.get(w)).join('/')}; ` +
    `${excluded.length} exclusion(s) printed`,
);
