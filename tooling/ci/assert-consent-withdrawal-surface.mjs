#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-consent-withdrawal-surface.mjs — WITHDRAWING CONSENT MUST BE AS EASY AS
// GIVING IT, AND THE PLACE THAT MAKES THAT TRUE IS SETTINGS.
//
// [pipeline C-6 / 8]K-11, DPDP §6(3), ADR 037 P2.7] — the measured false-green.
//
// ── THE HOLE, MEASURED, AND WHY IT IS NOT assert-seams-wired's FAULT ────────
// assert-seams-wired.mjs:171 requires *a* UI caller of `recordAnalyticsConsent(`
// somewhere other than its declaring file. That is exactly the right question
// for the seam it owns: "is the analytics on-switch dead code". It is the wrong
// question for withdrawal, and the difference is not academic —
//
//   · apps/subly/lib/app.dart's `_ConsentPrompt._answer` is a caller — the
//     FIRST-RUN prompt, shown once and never again.
//   · apps/subly/lib/features/settings/settings_screen.dart is another.
//     (Until 2026-08-10 the first example here was the dialog-shaped
//     `ConsentGate` in features/consent/consent_prompt.dart. That widget had
//     stopped being mounted months earlier and was deleted; the argument is
//     unchanged, because the app.dart prompt inherited its exact role — a
//     one-shot first-run surface — and satisfies seams-wired on its own.)
//
// Delete the SECOND one and seams-wired still prints ok, because the FIRST one
// satisfies it. Re-measured against main @ f90c546 while auditing the Subly
// re-stamp: the stamped settings screen carries `recordAnalyticsConsent(` ZERO
// times and `analyticsConsentProvider` ZERO times, so a wholesale apply of it
// deletes the only place a user can turn analytics OFF — and no guard goes red.
//
// 🔴 NO TEST CATCHES IT EITHER, which is the part that decided this guard.
// apps/subly/test/consent_withdrawal_test.dart looks like the protection and is
// not: at :59 it pumps its own two-button harness widget, never the real
// SettingsScreen. It would keep passing against an app with no settings row at
// all. (Contrast delete-account, which IS protected —
// delete_account_test.dart:144 pumps the real screen and drives Keys the
// stamped dialog lacks, so the same wholesale apply goes red there. The
// difference between the two is the whole argument for this file.)
//
// ── WHY SETTINGS SPECIFICALLY, AND THE ANCHOR THAT WAS REJECTED ─────────────
// The requirement is not "settings". It is "a withdrawal-capable surface a user
// can reach AFTER onboarding" — the first-run prompt is shown once and never
// again, so a caller that lives only there means consent is a one-way door.
//
// The general anchor was considered and NOT taken, for a reason worth writing
// down: "reachable post-onboarding" is a claim about the ROUTER, and deriving it
// means resolving route tables through a chassis that is mid-migration (ADR 037
// P2.5 is still de-duplicating `lib/core/router.dart` against
// `lib/core/router/`). A guard whose domain depends on a file that is being
// moved this month would be measuring its own scaffolding. Settings is a
// PROXY for the real property, and it is the proxy both app stores' reviewers
// already use — assert-deletion-control.mjs picked the same one, for the same
// reason, and states it as limb 2: "Both stores' reviewers look in the app's
// settings; a call site buried in a service nothing renders is the dead-seam
// shape again."
//
// ⚠️ SO THE PROXY'S FAILURE MODE IS NAMED HERE RATHER THAN DISCOVERED LATER: an
// app that moves withdrawal to a genuinely reachable NON-settings surface — a
// privacy centre, an account screen — fails this guard while doing the right
// thing. That is a deliberate trade. When it happens, widen the anchor to the
// declared surface set rather than adding an exemption; a per-app waiver here
// is a per-app permission to delete the row.
//
// ── 2026-08-10 · A SECOND RAIL, SAME HOLE: THE Art 21 OBJECTION ─────────────
// research/44 rung 4 adds `ConsentPurpose.promo` and a stop-offers control. It
// is NOT a consent gate — in-app first-party promotion runs on legitimate
// interest — but the deletion story is identical and slightly worse: an
// objection row that vanishes leaves a lawful basis with no way to refuse it,
// and GDPR Art 21(2)/(3) makes that refusal absolute. Worse, because the
// analytics row at least has a prompt as a second witness, whereas the promo
// control's only other home is the promotional card itself, which is precisely
// the thing a person who has objected never sees again.
//
// The promo limbs are DERIVED the same way and are silent on a tree that has no
// promo rail, so this guard keeps passing on any app or template that has not
// adopted rung 4. What it will not tolerate is HALF an adoption: a root that
// writes objections and offers nowhere to make one.
//
// ── THE LIMBS ───────────────────────────────────────────────────────────────
//   1. A CALL, NOT A DECLARATION, INSIDE lib/features/settings. The `declares`
//      exclusion is not sugar: assert-seams-wired.mjs shipped with its caller
//      check matching the function's own declaration, so deleting every real
//      caller still passed AND ALL SIX OF ITS FIXTURE TESTS WERE GREEN. Only
//      mutating the real tree exposed it.
//   2. WITHDRAWAL-CAPABLE. The `granted:` argument of at least one settings
//      call must not be the literal `true`. A row that can only ever GRANT is
//      not a withdrawal surface, and it satisfies limb 1 completely.
//   3. STATE-REFLECTING. The settings tree must read `analyticsConsentProvider`.
//      A toggle that cannot render "Off" is a button whose effect the user
//      cannot see, and the sworn Data safety record describes a control the
//      user can find and operate.
//   4. THE FIRST-RUN PROMPT IS SCROLLABLE — added 2026-08-10, and limb 4 is
//      about GRANTING, not withdrawing, which is why the reason is written out
//      rather than assumed:
//
//      the withdrawal row this guard protects is only reachable by a user who
//      got past the first-run question, and that question is a hit-test-opaque
//      modal. Measured on the real app root: `_ConsentPrompt`'s
//      `Column(mainAxisSize: min)` had no scroll view, so at 360×640 with text
//      scale 2.0 — a scale `app.dart` CLAMPS TO AND THEREFORE PERMITS — it
//      overflowed by 644 px in English and 1180 px in Tamil, laying "Allow" out
//      at y 1140→1220 on a 640-tall screen. Both answers below the fold, no
//      scroll, nothing behind the scrim tappable: the app is bricked on first
//      launch for a user on the largest text, and because the recorder is
//      fail-closed the silence looks exactly like someone who declined.
//
//      🔴 AND NO OTHER GUARD CAN ASK THIS. assert-responsive-coverage.mjs
//      states its domain in its own header as (1) what a `builder:` in
//      `lib/core/router.dart` returns and (2) `show*Sheet` under
//      `lib/features/**`. The consent scrim is neither: it is mounted by
//      `MaterialApp.router`'s builder, ABOVE the Navigator — the same fact that
//      forced it to be an inline scrim instead of a `showDialog`. So the one
//      surface every user must interact with before anything else sat outside
//      the guard whose doctrine is "an unmeasured pane is an unpoliced one".
//      This limb is that pane's floor, and it covers the BRICK too, so app #2
//      is not born with the defect.
//
//      DERIVED, NOT NAMED: the subject is "the widget class that renders
//      `consentPrivacy`", not a hardcoded `_ConsentPrompt`. A stamped app is
//      free to rename or restyle the card; it is not free to render the
//      sentence of record in something a large-text user cannot scroll. Finding
//      no such class at all is COVERAGE LOST, not a pass.
//
//   5. THE PROMOTIONAL DECISION GOES THROUGH THE RAIL — added 2026-08-10 with
//      rung 4's on-card half, because the on-card half is the one nothing could
//      enforce and a comment claimed to.
//
//      `PromoObjection.decide` projects the objection off the consent rail onto
//      `PromoGateState.suppressed` and only then consults the gate. Its own doc
//      calls itself *"the only sanctioned way"* to reach `PromoGate.decide` —
//      and NOTHING MADE THAT TRUE. `PromoGate.decide` is public, and a sibling
//      increment building the promo CARD did exactly the predicted thing:
//      `ref.watch(promoGateProvider).decide(stored, …)` against a record read
//      straight off disk, which is the two-stores defect the rail was chosen to
//      close. A person objects on the rail, the card keeps rendering off a stale
//      latch, and BOTH HALVES REPORT HEALTHY.
//
//      So: in an app root, every `.decide(` whose receiver is a promo gate must
//      have `PromoObjection` in the same expression. `CatchUpNudge().decide(` and
//      `ReviewGate.decide(` are untouched — the receiver is classified, not the
//      method name, or this limb would own three seams it knows nothing about.
//   6. AND IT RENDERS THROUGH THE FRAME. `PromoSurface` exists so the
//      promotional label (Apple 2.5.18 · Microsoft 10.10.4 · Play's native-ads
//      trigger · India's Disguised Advertisement) and the Art 21(4) on-card
//      objection cannot ship without the creative — there is no constructor
//      argument that switches either off. A card rendered outside it has neither,
//      and the widget test proving "the frame cannot omit the control" says
//      nothing about a creative that never entered the frame. So a file that
//      decides a promotion must also name `PromoSurface`.
//
//      🔴 THIS IS THE [pipeline C-6] RULE APPLIED TO ITS OWN AUTHOR. A
//      fail-closed seam with no proven open path reports healthy; so does an
//      invariant whose enforcement is a sentence in a doc comment. The claim was
//      written before the guard, the sibling chip violated it inside a day, and
//      the fix is not a stronger sentence.
//
// ── WHAT IS PRINTED RATHER THAN FAILED ──────────────────────────────────────
// 👤 The live prompt carries no link to the privacy policy — the retired dialog
// did. `consentReadPolicy` is therefore a reviewed, translated key with no
// consumer, held pending an owner/legal decision. Whether a consent surface
// links its notice is not a builder's call, so this guard REPORTS it on every
// run rather than failing the build on work only the owner can close — the same
// rule apple-signing.mjs follows for OWNER_QUEUE A-4. Derived from the tree (the
// key is declared by the generated accessors and referenced nowhere else), so it
// stops printing by itself on the day someone wires it up or deletes it.
//
// PARSED, NEVER GREPPED — comments AND string literals are blanked before any
// match. The repo rule ("assert on parsed structure, never by grepping prose")
// has a recorded instance in this exact guard family: seams-wired matched raw
// source until 2026-08-02, so commenting out a call with one `//` left it
// printing ok for a seam with no caller at all.
//
// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
// Roots = the brick app template PLUS every apps/* on the root pubspec
// `workspace:` list (a directory listing is refused: the brick lane stamps
// apps/probe and never removes it, so a listing differs between this box and
// CI). "Has a consent rail" is DERIVED from the root's own code declaring
// `recordAnalyticsConsent` — an app with no analytics owes no withdrawal
// surface, and saying so from the tree rather than from a list is what stops
// the filter becoming a waiver somebody adds themselves to. Every root's
// verdict PRINTS. Zero rail-bearing roots, a settings directory that cannot be
// read, or fewer than two roots is COVERAGE LOST, not a pass.
//
// Usage:  node tooling/ci/assert-consent-withdrawal-surface.mjs [repoRoot]
// Exit 0 = every app with an analytics rail lets a user switch it back off.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** Where a store reviewer looks, and therefore where the control must be. */
const SETTINGS_DIR = 'lib/features/settings';
/** The chassis's one consent writer. */
const RECORD = 'recordAnalyticsConsent';
/** The provider the row renders from. */
const STATE = 'analyticsConsentProvider';
/** The sentence of record — and therefore how limb 4 finds the prompt widget
 *  without knowing its class name. */
const PROMISE_KEY = 'consentPrivacy';
/** The policy link the live prompt does NOT have. Printed, never failed. */
const POLICY_LINK_KEY = 'consentReadPolicy';
/** Generated localisation accessors: they declare every key as a getter, so a
 *  class in here "references" the sentence without rendering anything. */
const GENERATED_L10N = 'lib/l10n/';
/** Any of these makes a card reachable when its content is taller than the
 *  viewport. Deliberately a set: `ListView` is as good an answer as
 *  `SingleChildScrollView`, and this limb is about the property, not the
 *  widget. */
const SCROLLERS = /\bSingleChildScrollView\s*\(|\bListView\s*[.(]|\bCustomScrollView\s*\(|\bScrollable\s*\(/;
/** The chassis's one Art 21 objection writer — research/44 rung 4. */
const PROMO_RECORD = 'recordPromoObjection';
/** The provider the stop-offers control renders from. */
const PROMO_STATE = 'promoObjectedProvider';
/** The only sanctioned road to `PromoGate.decide` — limb 5. */
const SANCTIONED = 'PromoObjection';
/** The frame that carries the label and the on-card objection — limb 6. */
const FRAME = 'PromoSurface';
/**
 * Does this expression reach a PROMO gate?
 *
 * Case-insensitive on purpose, and that is the whole classifier: it catches the
 * type (`core.PromoGate(`, `PromoGateState`) and the Riverpod provider that
 * holds one (`promoGateProvider`), which is the form the real bypass took. It
 * does NOT catch `CatchUpNudge().decide(` or `ReviewGate.decide(`, which is the
 * point — the method name `.decide(` is shared by three unrelated seams and
 * matching on it would make this limb the owner of two it knows nothing about.
 */
const PROMO_GATE_REF = /promogate/i;

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  console.error('');
  console.error('assert-consent-withdrawal-surface: FAILED');
  process.exit(1);
};

/**
 * Comments and string literals blanked, offsets preserved.
 *
 * Both, not one. Comments because `// recordAnalyticsConsent(ref, …)` is what a
 * person leaves behind while debugging and it must not read as a caller.
 * Strings because this repo's own prose — including the doc comment in
 * providers.dart that names the function — would otherwise satisfy the check,
 * and because a literal `'recordAnalyticsConsent('` in a log line is not a call.
 */
const reduce = (src) => stripStringLiterals(stripSourceComments(src, '.dart'));

/** [{ rel, body }] for every .dart file under `dir`, reduced. */
// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — THE WITHDRAWAL CONTROL FOLLOWS THE SCREEN INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2; the same resolver assert-a11y-coverage.mjs carries)
//
// [ADR 066] step 4 empties a brick screen into `package:nikatru_chassis_screens`
// and leaves an ADAPTER at the same path: same file, same route, same class
// name, and none of the body. The `recordConsent(` call, the `granted:` toggle expression and the state read all move with the body, out of `lib/features/settings/` and into the package — and read at the adapter alone this guard reports that there is nowhere in the app to turn analytics off. That is a DPDP §6(3) claim, and making it about a compliant tree is exactly as bad as missing a real one.
//
// So the scan below reads the adapter AND the chassis file it delegates to.
// This only ever ADDS text: a call site that was found is still found, and one
// that is genuinely absent is still absent. Nothing is removed from any domain
// and no floor is lowered.
//
// ONE LEVEL, ONE IMPORT, EVERY REFUSAL LOUD. Two different chassis imports in
// one adapter is ambiguous and refused; a target that is not on disk is
// COVERAGE LOST. A delegation this resolver cannot follow must never read as
// "no delegation" — that is the silent-pass shape.
// ─────────────────────────────────────────────────────────────────────────────
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_DIR = 'packages/chassis_screens';
const CHASSIS_IMPORT = new RegExp(`import\\s+'package:${CHASSIS_PKG}/([^']+\\.dart)'`, 'g');

/** The chassis file(s) an absolute path delegates to, resolved ONE level, as
 *  paths relative to the REPOSITORY root.
 *  `null` = no delegation · `{ lost }` = a delegation that could not be followed
 *  · `{ files }`. `null` and `{ lost }` stay different answers on purpose. */
function delegationOf(absFile, repoRoot) {
  if (!existsSync(absFile)) return null;
  CHASSIS_IMPORT.lastIndex = 0;
  const src = readFileSync(absFile, 'utf8');
  const paths = [...new Set([...src.matchAll(CHASSIS_IMPORT)].map((m) => m[1]))];
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return {
      lost: `imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths (${paths.join(', ')}), so the file that now carries the behaviour cannot be identified`,
    };
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(repoRoot, target))) {
    return { lost: `delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to \`${target}\` and that file is not on disk` };
  }
  const out = [target];
  for (const m of readFileSync(join(repoRoot, target), 'utf8').matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(repoRoot, t))) out.push(t);
  }
  return { files: out };
}

/** Every chassis file the .dart tree under `absDir` delegates to.
 *  `{ files, lost }` — `lost` is a list of refusals the caller must report. */
function chassisDelegationsUnder(absDir, repoRoot) {
  const files = [];
  const lost = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) {
        const dg = delegationOf(p, repoRoot);
        if (dg && dg.lost) {
          lost.push(`${p} — ${dg.lost}`);
        } else {
          for (const f of (dg && dg.files) || []) if (!files.includes(f)) files.push(f);
        }
      }
    }
  };
  walk(absDir);
  return { files, lost };
}

function readDartTree(rootAbs, relDir) {
  const out = [];
  const walk = (relPath) => {
    const absPath = join(rootAbs, relPath);
    if (!existsSync(absPath)) return;
    for (const e of listDir(absPath, { withFileTypes: true })) {
      const child = `${relPath}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.dart')) out.push({ rel: child, body: reduce(readFileSync(join(rootAbs, child), 'utf8')) });
    }
  };
  walk(relDir);
  return out;
}

/**
 * The arguments of every `name(` call in `body`, as raw text, by walking
 * balanced parentheses. A regex cannot do this: the live call spans four lines
 * and its `granted:` value contains its own parentheses.
 *
 * Declarations are excluded by the caller, not here — see `DECLARES`.
 */
function callArgs(body, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(body)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      i++;
    }
    if (depth === 0) out.push({ index: m.index, args: body.slice(start, i - 1) });
  }
  return out;
}

/** `Future<void> recordAnalyticsConsent(\n  WidgetRef ref, …` — the declaration,
 *  which reads identically to a call to a matcher that only looks for `name(`.
 *  Same anchor assert-seams-wired.mjs uses, for the same recorded reason. */
const DECLARES = new RegExp(`(?:Future<void>\\s+)?${RECORD}\\s*\\(\\s*\\n?\\s*WidgetRef`);

/**
 * `[{ name, body }]` for every `class X { … }` in `body`, by brace matching.
 *
 * A regex over the whole file cannot answer limb 4's question: "does the class
 * that renders the sentence also have a scroll view" is a claim about ONE class,
 * and `lib/app.dart` is 600 lines of other widgets that contain scroll views of
 * their own. Matching the file would pass on a prompt with no scroll view at all.
 */
function classBodies(body) {
  const out = [];
  const re = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const open = body.indexOf('{', m.index);
    if (open === -1) continue;
    let depth = 1;
    let i = open + 1;
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    if (depth === 0) out.push({ name: m[1], body: body.slice(open + 1, i - 1) });
  }
  return out;
}

/** Same shape, same reason, for the objection writer. */
const PROMO_DECLARES = new RegExp(`(?:Future<void>\\s+)?${PROMO_RECORD}\\s*\\(\\s*\\n?\\s*WidgetRef`);

/**
 * Every `.decide(` in `body`, with the expression that RECEIVES it.
 *
 * The receiver is everything back to the nearest statement boundary (`;`, `{` or
 * `}`), which is what makes this a claim about WHICH gate rather than about the
 * word "decide". The real bypass spans four lines —
 *
 *     ref
 *       .watch(promoGateProvider)
 *       .decide(
 *
 * — so a same-line regex would have classified it as "not a promo gate" and
 * printed ok. That is the failure this helper exists to not have.
 */
function decideReceivers(body) {
  const out = [];
  const re = /\.decide\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let i = m.index;
    while (i > 0 && !';{}'.includes(body[i - 1])) i--;
    out.push({ index: m.index, receiver: body.slice(i, m.index) });
  }
  return out;
}

/** The named argument's text, whitespace-collapsed, or null. */
function namedArg(args, label) {
  const at = args.indexOf(`${label}:`);
  if (at === -1) return null;
  let depth = 0;
  let i = at + label.length + 1;
  const start = i;
  for (; i < args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) break;
  }
  return args.slice(start, i).replace(/\s+/g, ' ').trim();
}

// ── the roots ───────────────────────────────────────────────────────────────
const roots = [];
if (existsSync(join(ROOT, BRICK))) roots.push(BRICK);
let workspaceRead = false;
try {
  const lines = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m && m[1].startsWith('apps/')) roots.push(m[1]);
    }
  }
} catch {
  /* handled by workspaceRead below */
}
if (!workspaceRead) {
  coverageLost([
    'the root pubspec.yaml has no readable `workspace:` block.',
    'The domain would then be the brick alone — and the brick was never the subject. The app in the field is',
    'the one whose settings row a re-stamp deletes.',
  ]);
}
if (roots.length < 2) {
  coverageLost([
    `only ${roots.length} root(s) resolved (${roots.join(', ') || 'none'}).`,
    'Expected the brick app template AND at least one apps/* workspace member. A guard over the template alone',
    'cannot see the app that ships.',
  ]);
}

// ── the run ─────────────────────────────────────────────────────────────────
let railBearing = 0;
let settingsFilesRead = 0;
let settingsCallsFound = 0;
let promptClassesFound = 0;
let promoRailBearing = 0;
let promoCallsFound = 0;
let promoGateRoots = 0;
let promoDecidesFound = 0;
const elsewhereCallers = [];

for (const root of roots) {
  // Is there an analytics consent rail in this root at all? DERIVED: the
  // chassis's writer is declared somewhere in the root's own lib/.
  const libFiles = readDartTree(join(ROOT, root), 'lib');
  if (!libFiles.length) {
    coverageLost([
      `${root} has no readable lib/ tree (0 .dart files).`,
      'Every judgement below is made from that tree, so a root with none is a root this scan cannot see —',
      'which is not the same as a root with no consent rail, and prints identically.',
    ]);
  }
  // ── limbs 5 + 6 · the promotional creative cannot bypass the rail ──────────
  // DELIBERATELY ABOVE THE ANALYTICS `continue` BELOW. A root can grow a promo
  // card before (or without) an analytics rail, and that root is the WORST case,
  // not the exempt one — skipping it is how the objection would go unchecked in
  // exactly the tree that needed checking.
  //
  // Silent on a root with no promo gate at all: an app that promotes nothing
  // owes nothing here, and saying so FROM THE TREE rather than from a list is
  // what stops the filter becoming a waiver somebody adds themselves to.
  const gateFiles = libFiles.filter((f) => PROMO_GATE_REF.test(f.body));
  if (gateFiles.length) {
    promoGateRoots++;
    let decidesHere = 0;
    for (const f of libFiles) {
      for (const d of decideReceivers(f.body)) {
        if (!PROMO_GATE_REF.test(d.receiver)) continue; // ReviewGate, CatchUpNudge…
        decidesHere++;
        promoDecidesFound++;
        if (!d.receiver.includes(SANCTIONED)) {
          problems.push(
            `🔴 ${root}/${f.rel} reaches PromoGate.decide WITHOUT ${SANCTIONED}. The objection lives on the ` +
              `consent rail (ConsentPurpose.promo) and \`PromoGateState.suppressed\` is a PROJECTION of it; a ` +
              'decision made straight off the persisted record is made against whatever was last written to ' +
              'disk. That is the two-stores defect: the person objects on the rail, this card keeps rendering ' +
              `off a stale latch, and both halves report healthy. Go through \`${SANCTIONED}(consent).decide(` +
              'gate, stored, …)`, which projects first and cannot be skipped. A GPC objection (Art 21(5)) writes ' +
              'no artifact at all and reaches the gate through no other route.',
          );
        }
        if (!new RegExp(`\\b${FRAME}\\b`).test(f.body)) {
          problems.push(
            `🔴 ${root}/${f.rel} decides a promotion and never names ${FRAME}. The creative must render as that ` +
              "frame's child: the frame is where the promotional label lives (Apple 2.5.18, Microsoft 10.10.4, " +
              "Play's native-ads trigger, India's Disguised Advertisement) and where the Art 21(4) on-card " +
              'objection lives, and it offers no constructor argument to switch either off. A card rendered ' +
              'beside it instead of inside it has neither, and the widget test proving the frame cannot omit ' +
              'the control says nothing about a creative that never entered the frame.',
          );
        }
      }
    }
    if (decidesHere === 0) {
      coverageLost([
        `${root} names a promo gate in ${gateFiles.length} lib file(s) and NOT ONE \`.decide(\` was classified as one.`,
        'Limbs 5 and 6 hang entirely off that classification, so zero matches means the classifier stopped',
        'matching rather than the tree being clean — the two print identically and only one of them is a fact',
        `about the app. Files that named it: ${gateFiles.map((f) => f.rel).join(', ')}.`,
      ]);
    }
  }

  const declaresRail = libFiles.some((f) => DECLARES.test(f.body));
  const declaresPromoRail = libFiles.some((f) => PROMO_DECLARES.test(f.body));
  if (!declaresRail) {
    if (declaresPromoRail) {
      coverageLost([
        `${root} declares ${PROMO_RECORD} but NOT ${RECORD}.`,
        'Every limb below hangs off the analytics derivation, so this root would be skipped entirely and its',
        'Art 21 objection row would go unchecked while the guard printed a reassuring note. That is a hole in',
        'the scan, not a fact about the app — split the derivations before shipping an app in this shape.',
      ]);
    }
    notes.push(`note ${root} declares no ${RECORD} — no analytics rail, so no withdrawal surface is owed (derived from ${libFiles.length} lib/ file(s), not from a list).`);
    continue;
  }
  railBearing++;
  if (declaresPromoRail) promoRailBearing++;

  // Every caller OUTSIDE the settings tree. Not asserted on — the first-run
  // prompt is a legitimate and necessary grant surface. Printed because it is
  // the exact witness that made assert-seams-wired.mjs green while the
  // withdrawal row was measured missing, and a reader of this output should be
  // able to see the distinction without re-deriving it.
  for (const f of libFiles) {
    if (f.rel.startsWith(`${SETTINGS_DIR}/`)) continue;
    if (DECLARES.test(f.body)) continue;
    if (callArgs(f.body, RECORD).length) elsewhereCallers.push(`${root}/${f.rel}`);
  }

  // ── limb 4 · the first-run prompt is scrollable ───────────────────────────
  // The subject is DERIVED: whichever widget class renders the sentence of
  // record IS the prompt. `Widget build(` is what separates a surface from the
  // generated `AppLocalizations` classes, which declare the same key as a
  // getter and render nothing — matching those would fail every app on a file
  // it has no business reading.
  const promptClasses = [];
  for (const f of libFiles) {
    if (f.rel.startsWith(`/${GENERATED_L10N}`) || f.rel.includes(GENERATED_L10N)) continue;
    for (const c of classBodies(f.body)) {
      if (!new RegExp(`\\b${PROMISE_KEY}\\b`).test(c.body)) continue;
      if (!/\bWidget\s+build\s*\(/.test(c.body)) continue;
      promptClasses.push({ file: `${root}/${f.rel}`, name: c.name, body: c.body });
    }
  }
  if (!promptClasses.length) {
    coverageLost([
      `${root} has an analytics rail and NOT ONE widget class renders ${PROMISE_KEY}.`,
      'Limb 4 is gated on finding the first-run prompt from the tree rather than from a hardcoded class name,',
      'so "no prompt found" means the derivation stopped working — the app cannot both have a consent rail and',
      'have nowhere that asks. Reported as a broken scan, never as a pass.',
    ]);
  }
  promptClassesFound += promptClasses.length;
  for (const p of promptClasses) {
    if (SCROLLERS.test(p.body)) continue;
    problems.push(
      `🔴 ${root}: ${p.name} (${p.file}) renders ${PROMISE_KEY} with NO scroll view. Measured on this exact ` +
        'widget before the scroll view landed: at 360×640 with text scale 2.0 — which app.dart CLAMPS TO, so it ' +
        'is a permitted scale and not an extreme — the column overflowed by 644 px in English and 1180 px in ' +
        'Tamil, and "Allow" was laid out at y 1140→1220 on a 640-tall screen. Both answers are then off-screen ' +
        'behind a hit-test-opaque scrim with no way to scroll to them, so first run is unanswerable and the app ' +
        'is unusable. Wrap the card in a SingleChildScrollView. assert-responsive-coverage.mjs cannot ask this: ' +
        "the scrim is mounted by MaterialApp.router's builder, outside that guard's routed-screen domain.",
    );
  }

  // 👤 OWNER GAP — PRINTED, NEVER FAILED. See the header: linking the policy
  // from a consent surface is an owner/legal call, and a guard that reddens CI
  // on work only the owner can do is a guard people switch off.
  // Declared = the TRACKED arb source carries the key — never the generated
  // getter. gen-l10n output is gitignored factory-wide (#214), so a probe that
  // read it answered one thing on a workstation (generated files present) and
  // another in a guard-only CI job (absent): the same fixture passed here and
  // failed there on an identical commit. The gen-l10n-untracked lesson, third
  // occurrence — the arb is the artifact both environments actually share.
  const l10nAbs = join(ROOT, root, 'lib', 'l10n');
  const linkDeclared =
    existsSync(l10nAbs) &&
    listDir(l10nAbs).some(
      (n) =>
        n.endsWith('.arb') &&
        new RegExp(`"${POLICY_LINK_KEY}"\\s*:`).test(readFileSync(join(l10nAbs, n), 'utf8')),
    );
  const linkUsed = libFiles.some(
    (f) => !f.rel.includes(GENERATED_L10N) && new RegExp(`\\b${POLICY_LINK_KEY}\\b`).test(f.body),
  );
  if (linkDeclared && !linkUsed) {
    notes.push(
      `👤 OWNER ${root} — ${POLICY_LINK_KEY} ("Read the privacy policy") is a translated, reviewed key that NO ` +
        'surface renders: the retired dialog-shaped prompt linked the policy and the live inline scrim does not. ' +
        'Whether a consent surface links its notice is an owner/legal decision, so this prints rather than fails. ' +
        'Wire it up or delete the key and its Tamil twin; either answer stops this line appearing.',
    );
  }

  const settingsAbs = join(ROOT, root, ...SETTINGS_DIR.split('/'));
  if (!existsSync(settingsAbs)) {
    coverageLost([
      `${root} has an analytics rail and NO ${SETTINGS_DIR} directory.`,
      'The anchor moved. "No withdrawal row found" and "the directory this guard reads is gone" are the same',
      'output from a text matcher and completely different facts, so the second one is reported as a broken',
      'scan rather than as a missing row.',
    ]);
  }
  const settingsFiles = readDartTree(join(ROOT, root), SETTINGS_DIR);
  // The chassis files the settings tree delegates to are read WITH it — see the
  // resolver above. Tagged `delegated` so every message can name the file it
  // really read: a finding printed against `${root}/${rel}` for a line that
  // lives in `packages/` sends the reader to the wrong tree.
  const settingsDelegations = chassisDelegationsUnder(
    join(ROOT, root, ...SETTINGS_DIR.split('/')),
    ROOT,
  );
  for (const why of settingsDelegations.lost) {
    coverageLost([
      `${root}: a settings file's chassis delegation could not be followed — ${why}.`,
      'Limbs 1-3 read the settings tree PLUS whatever it delegates to. A delegation this scan cannot',
      'follow is a withdrawal control it cannot see, and an unseen control reads exactly like an absent',
      'one — which here is a DPDP finding against a compliant app.',
    ]);
  }
  for (const f of settingsDelegations.files) {
    settingsFiles.push({ rel: f, body: reduce(readFileSync(join(ROOT, f), 'utf8')), delegated: true });
  }
  if (settingsDelegations.files.length) {
    notes.push(
      `⬜ ${root}: limbs 1-3 also read ${settingsDelegations.files.length} chassis file(s) the settings ` +
        `tree delegates to — ${settingsDelegations.files.join(', ')}`,
    );
  }
  if (!settingsFiles.length) {
    coverageLost([
      `${root}/${SETTINGS_DIR} contains no .dart files.`,
      'Same reason as above: an empty read is not evidence about the app.',
    ]);
  }
  settingsFilesRead += settingsFiles.length;

  // ── limb 1 · a CALL, not a declaration, inside settings ──────────────────
  const calls = [];
  for (const f of settingsFiles) {
    const where = f.delegated ? f.rel : `${root}/${f.rel}`;
    if (DECLARES.test(f.body)) {
      problems.push(
        `${where} DECLARES ${RECORD}. Moving the declaration into the settings tree would make limb 1 ` +
          'satisfied by the function\'s own signature — the precise defect assert-seams-wired.mjs shipped with, ' +
          'which all six of its fixture tests passed against.',
      );
      continue;
    }
    for (const c of callArgs(f.body, RECORD)) calls.push({ file: where, args: c.args });
  }
  settingsCallsFound += calls.length;

  if (!calls.length) {
    problems.push(
      `🔴 ${root}: NO call to ${RECORD}( in ${SETTINGS_DIR}. There is nowhere in this app for a user to turn ` +
        'analytics back OFF. ' +
        (elsewhereCallers.length
          ? `assert-seams-wired.mjs stays GREEN on this exact tree — ${elsewhereCallers[elsewhereCallers.length - 1]} ` +
            'satisfies it — which is why withdrawal needs its own anchor. '
          : '') +
        'privacy.html promises the user can turn it off in Settings without contacting us; DPDP §6(3) requires ' +
        'withdrawal to be as easy as consent. Neither is true without this row.',
    );
    continue;
  }

  // ── limb 2 · withdrawal-capable ──────────────────────────────────────────
  const grantedArgs = calls.map((c) => ({ file: c.file, granted: namedArg(c.args, 'granted') }));
  const missing = grantedArgs.filter((g) => g.granted === null);
  for (const g of missing) {
    problems.push(`${g.file} calls ${RECORD}( with no \`granted:\` argument. The call cannot be judged as granting or withdrawing, so limb 2 has nothing to read.`);
  }
  const withdrawable = grantedArgs.filter((g) => g.granted !== null && g.granted !== 'true');
  if (!withdrawable.length && grantedArgs.length) {
    problems.push(
      `🔴 ${root}: every ${RECORD}( call in ${SETTINGS_DIR} passes \`granted: true\` ` +
        `(${grantedArgs.map((g) => g.granted).join(' · ')}). A control that can only ever GRANT satisfies limb 1 ` +
        'completely and is not a withdrawal surface. The live row passes a toggle expression: ' +
        '`granted: ref.read(analyticsConsentProvider) != core.ConsentStatus.granted`.',
    );
  }

  // ── limb 3 · state-reflecting ────────────────────────────────────────────
  if (!settingsFiles.some((f) => new RegExp(`\\b${STATE}\\b`).test(f.body))) {
    problems.push(
      `${root}/${SETTINGS_DIR} never reads ${STATE}, so the control cannot render its current value. A toggle ` +
        'whose state the user cannot see is a button that appears to do nothing when consent is already off — ' +
        'and the Data safety record describes a control a user can find AND operate.',
    );
  }

  // ── the Art 21 objection, same three questions ───────────────────────────
  // Silent when the root has no promo rail: an app that promotes nothing owes
  // no objection surface, and saying so FROM THE TREE rather than from a list
  // is what stops the filter becoming a waiver somebody adds themselves to.
  if (declaresPromoRail) {
    const promoCalls = [];
    for (const f of settingsFiles) {
      if (PROMO_DECLARES.test(f.body)) {
        problems.push(
          `${root}/${f.rel} DECLARES ${PROMO_RECORD}. Moving the declaration into the settings tree satisfies the ` +
            "call check with the function's own signature — the defect assert-seams-wired.mjs shipped with, which " +
            'all six of its fixture tests passed against.',
        );
        continue;
      }
      for (const c of callArgs(f.body, PROMO_RECORD)) promoCalls.push({ file: `${root}/${f.rel}`, args: c.args });
    }
    promoCallsFound += promoCalls.length;

    if (!promoCalls.length) {
      problems.push(
        `🔴 ${root}: declares ${PROMO_RECORD} and there is NO call to it in ${SETTINGS_DIR}. GDPR Art 21(2)/(3) ` +
          'makes the objection to direct marketing ABSOLUTE — "the data subject shall have the right to object at ' +
          'any time" — and Art 21(4) wants it presented clearly and separately at the latest at the first ' +
          'communication. The promotional card carries the control too, but that one disappears the moment it is ' +
          'used: a person who objected never sees the card again, so the card can never be the way back. Without ' +
          'this row the objection is a one-way door and the withdrawal of it is unreachable.',
      );
    } else {
      // Both directions must be reachable. `objected:` fixed to a literal is
      // the promo twin of limb 2: a control that can only ever STOP satisfies
      // the call check and is not a toggle.
      const objectedArgs = promoCalls.map((c) => ({ file: c.file, objected: namedArg(c.args, 'objected') }));
      for (const g of objectedArgs.filter((g) => g.objected === null)) {
        problems.push(
          `${g.file} calls ${PROMO_RECORD}( with no \`objected:\` argument, so the call cannot be judged as ` +
            'objecting or withdrawing.',
        );
      }
      const reversible = objectedArgs.filter((g) => g.objected !== null && g.objected !== 'true');
      if (!reversible.length && objectedArgs.length) {
        problems.push(
          `🔴 ${root}: every ${PROMO_RECORD}( call in ${SETTINGS_DIR} passes \`objected: true\` ` +
            `(${objectedArgs.map((g) => g.objected).join(' · ')}). Art 21 gives a person the right to object, not ` +
            'a duty to stay objected; a control that only travels one way is a trap, not a control. The live row ' +
            'passes the control\'s own callback value.',
        );
      }
    }

    if (!settingsFiles.some((f) => new RegExp(`\\b${PROMO_STATE}\\b`).test(f.body))) {
      problems.push(
        `${root}/${SETTINGS_DIR} never reads ${PROMO_STATE}, so the stop-offers control cannot render its own ` +
          'state — and the objected state is exactly the one a user needs to see, because the promotional surface ' +
          'that would otherwise confirm it is gone.',
      );
    }
  }

  notes.push(
    `ok   ${root} — ${calls.length} withdrawal call site(s) in ${SETTINGS_DIR} across ${settingsFiles.length} file(s); ` +
      `granted: ${grantedArgs.map((g) => (g.granted ?? '(none)')).join(' · ')}; ` +
      `first-run prompt: ${promptClasses
        .map((p) => `${p.name} ${SCROLLERS.test(p.body) ? 'scrollable' : 'NOT SCROLLABLE'}`)
        .join(' · ')}`,
  );
}

// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
if (railBearing === 0) {
  coverageLost([
    `not one of the ${roots.length} root(s) was judged to carry an analytics consent rail.`,
    'Every limb is gated on that judgement, so a pass here would mean the scan stopped recognising the rail —',
    'not that no app has one. The chassis declares it in lib/state/providers.dart and Subly in',
    'lib/state/analytics_providers.dart; finding neither means the derivation, not the tree, changed.',
  ]);
}
if (railBearing < 2) {
  coverageLost([
    `only ${railBearing} root(s) carry a consent rail, and the domain must include BOTH the brick and a real app.`,
    'The brick is app #2 through #50 and the shipping app is the one a re-stamp overwrites; a guard that reaches',
    'only one of them re-creates half the hole it was written to close.',
  ]);
}
if (settingsFilesRead === 0) {
  coverageLost([`zero settings .dart files were read across ${railBearing} rail-bearing root(s).`]);
}
if (promptClassesFound < railBearing) {
  coverageLost([
    `limb 4 found ${promptClassesFound} first-run prompt class(es) across ${railBearing} rail-bearing root(s).`,
    'Every rail-bearing root must contribute at least one, because an app that asks for consent has somewhere',
    'that asks. Fewer means the derivation (a widget class that renders the sentence AND declares `Widget',
    'build(`) stopped matching — a scan that reaches nothing prints exactly like a tree with no defect.',
  ]);
}
if (settingsCallsFound === 0 && problems.length === 0) {
  coverageLost([
    'zero settings call sites were found AND no problem was recorded — the two cannot both be true.',
    'That combination means the call matcher stopped matching rather than the rows being present.',
  ]);
}
// The promo rail is OPTIONAL (a tree that has not adopted research/44 rung 4
// owes nothing), but a HALF adoption is not. The brick is app #2 through #50 and
// the shipping app is the one a re-stamp overwrites; reaching only one of them
// re-creates half the hole this file exists to close — the same argument the
// analytics floor above makes, applied to the rail that arrived later.
if (promoRailBearing === 1) {
  coverageLost([
    `exactly ONE root carries the Art 21 objection rail (${PROMO_RECORD}).`,
    'Adopting it in the brick alone leaves the app in the field without the control; adopting it in the app',
    'alone means every app the factory stamps from here is born without one. Land both, or neither.',
  ]);
}
if (promoRailBearing >= 2 && promoCallsFound === 0 && problems.length === 0) {
  coverageLost([
    'the objection rail is declared in every root, zero settings call sites were found, and NO problem was',
    'recorded — the three cannot all be true. The promo call matcher has stopped matching.',
  ]);
}

// ── 👤 OWNER · THE NOTICE BEHIND THE ARTIFACTS ──────────────────────────────
// PRINTED, NEVER FAILED. Every promo artifact is stamped with
// `kPrivacyPolicyVersion` so it says WHICH notice the person was objecting
// under — and the pinned notice does not describe promotional processing, the
// legitimate-interest basis, or the right to object. GDPR Art 13(1)(c)/(d) and
// Art 21(4) require both to be IN the notice.
//
// It fails nothing because publishing legal copy is ADR 031 class B — owner
// work — and a guard that reddens CI on work only the owner can do is a guard
// people switch off (the rule apple-signing.mjs follows for OWNER_QUEUE A-4).
//
// 🔬 IT IS DERIVED FROM THREE TREES, SO IT CLEARS ITSELF. The purposes come
// from core's `ConsentBasis.legitimateInterest`, the version from the app's own
// constant, the words from the published file. Publish a notice that describes
// the basis and this line stops appearing with no edit here — and if a future
// purpose is added on that basis, it starts appearing with no edit either.
// assert-policy-claims.mjs cannot ask this: it quantifies over `<b>` spans on
// published pages, never over the app's consent purposes.
try {
  const consentSrc = readFileSync(join(ROOT, 'packages/core/lib/src/analytics/consent.dart'), 'utf8');
  const liPurposes = [...consentSrc.matchAll(/ConsentPurpose\s*\(\s*'([a-z_]+)'[^)]*ConsentBasis\.legitimateInterest/g)].map((m) => m[1]);
  const versionSrc = readFileSync(join(ROOT, 'apps/subly/lib/state/analytics_providers.dart'), 'utf8');
  const version = versionSrc.match(/kPrivacyPolicyVersion\s*=\s*'([^']+)'/)?.[1];
  // The extractor losing its grip and the tree genuinely having no
  // legitimate-interest purpose print IDENTICALLY unless this is asked. The
  // file naming the basis while the extractor finds none is the first shape.
  if (!liPurposes.length && /ConsentBasis\.legitimateInterest/.test(consentSrc)) {
    console.log(
      '👤 OWNER consent.dart NAMES ConsentBasis.legitimateInterest and the purpose extractor matched none — the ' +
        'notice check below has stopped deriving its own subject. Fix the extractor; a silent zero here reads ' +
        'exactly like "no purpose needs a notice", which is the opposite claim.',
    );
  }
  if (liPurposes.length && version) {
    const policyPath = `sites/nikatru/legal/${version}/en/privacy.html`;
    const policy = existsSync(join(ROOT, policyPath))
      ? readFileSync(join(ROOT, policyPath), 'utf8').toLowerCase()
      : null;
    const describes = policy !== null && /legitimate interest/.test(policy) && /object/.test(policy);
    if (!describes) {
      console.log(
        `👤 OWNER the pinned notice ${policyPath}${policy === null ? ' DOES NOT EXIST' : ' describes neither a legitimate-interest basis nor a right to object'}, ` +
          `and ${liPurposes.length} purpose(s) run on that basis (${liPurposes.join(', ')}). Every artifact those ` +
          `purposes write is stamped policyVersion '${version}' so it records WHICH notice the person was objecting ` +
          'under — and that notice does not mention the processing. GDPR Art 13(1)(c)/(d) requires the basis to be ' +
          'stated and Art 21(4) requires the right to object to be brought to the reader\'s attention IN it. This is ' +
          'owner-editable legal copy (ADR 031 class B), so it prints rather than fails — but it must land before a ' +
          'real promotional card goes on screen, not before this machinery merges. Do NOT bump the version to fix ' +
          'this line: assert-seams-wired.mjs pins it to the PUBLISHED notice, and bumping without publishing makes ' +
          'every artifact cite a document that does not exist.',
      );
    }
  }
} catch {
  console.log(
    '👤 OWNER could not derive the notice check (core consent.dart or the app policy constant did not parse). ' +
      'Printed rather than swallowed: a check that silently stopped checking is this repository\'s recurring defect.',
  );
}

for (const n of notes) console.log(n);
console.log(
  `note ${elsewhereCallers.length} caller(s) of ${RECORD}( live OUTSIDE ${SETTINGS_DIR} and are NOT asserted on ` +
    `(${elsewhereCallers.join(', ') || 'none'}). They are the first-run GRANT surface, and they are also what ` +
    'keeps assert-seams-wired.mjs green when the withdrawal row is deleted — the measured false-green this guard exists for.',
);
console.log(
  'note the anchor is SETTINGS, a proxy for "a withdrawal-capable surface reachable after onboarding". An app ' +
    'that moves withdrawal to another reachable surface fails here while doing the right thing; widen the anchor ' +
    'in that change, never add a per-app exemption.',
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  Withdrawal must be as easy as granting (DPDP §6(3)); privacy.html promises it happens in');
  console.error('  Settings. assert-seams-wired.mjs asks whether the seam is dead, not whether it is reversible —');
  console.error('  measured 2026-08-08: deleting the settings row leaves it at exit 0.');
  console.error('\nassert-consent-withdrawal-surface: FAILED');
  process.exitCode = 1;
} else {
  console.log(
    `\nok   consent withdrawal — ${railBearing} of ${roots.length} root(s) carry an analytics rail and every one ` +
      `of them ships a state-reflecting, withdrawal-capable control in ${SETTINGS_DIR} ` +
      `(${settingsCallsFound} call site(s) across ${settingsFilesRead} settings file(s))`,
  );
  console.log(
    promoRailBearing === 0
      ? `ok   Art 21 objection — no root declares ${PROMO_RECORD}, so none owes a stop-offers control (research/44 rung 4 not adopted here)`
      : `ok   Art 21 objection — ${promoRailBearing} root(s) carry the promo rail and every one ships a ` +
          `state-reflecting, reversible stop-offers control in ${SETTINGS_DIR} (${promoCallsFound} call site(s))`,
  );
  console.log(
    promoGateRoots === 0
      ? `ok   promotional creative — no root names a promo gate, so none can bypass ${SANCTIONED} or ${FRAME} ` +
          '(rung 3 not adopted here; this line starts asserting by itself the day a card lands)'
      : `ok   promotional creative — ${promoGateRoots} root(s) decide a promotion, ${promoDecidesFound} call ` +
          `site(s), every one through ${SANCTIONED} and in a file that renders through ${FRAME}`,
  );
  console.log('\nassert-consent-withdrawal-surface: ok');
}
