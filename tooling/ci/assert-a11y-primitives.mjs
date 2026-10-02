#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-a11y-primitives.mjs — THREE ACCESSIBILITY RULES THAT HOLD OVER EVERY
// FLUTTER TREE THIS FACTORY SHIPS, AND THAT NO SCREEN CAN SHOW YOU BROKEN.
//
// Each limb is a rule about a PRIMITIVE, not about a screen: it is true or false
// of every app at once, it is invisible in a screenshot, and no design choice
// changes it. That is what puts the three in one file (audit ST-T8a, the
// class-level half of the Subscription Tracker's WCAG 2.2 AA work).
//
// ── LIMB 1 · ST-Y2 · EVERY TAP TARGET TAKES THE KEYBOARD (audit B23 class, C17)
// A `GestureDetector(` (or `RawGestureDetector(`) with a tap callback — onTap,
// onTapUp, onTapDown, onDoubleTap, onLongPress — is a control a pointer can
// operate and a keyboard cannot: it takes no focus, answers no Enter or Space,
// and draws no focus ring (WCAG 2.1.1 Keyboard, 2.4.7 Focus Visible). Wrapping
// it in `Semantics(button: true)` makes it WORSE, not better: a screen reader
// now announces "button", and a keyboard user tabs straight past it. The fix is
// a primitive that is focusable by construction — `FocusableTap`
// (packages/design_system), `InkWell`, or a `SegmentedButton`.
//
//   Two exemptions, printed on every run, never silent:
//   (a) an enclosing `ExcludeSemantics(` — the detector is a pointer
//       convenience beside a focusable twin that owns the node (the clickwrap
//       sentence beside its real checkbox, in legal_consent_fields.dart);
//   (b) the primitive itself: `FocusableTap`'s own detector, which that widget
//       wraps in a `FocusableActionDetector`. Keyed by file + anchor + the
//       `FocusableActionDetector(` it depends on, so it lapses on its own the
//       day that wrapper goes.
//
//   🔬 WHY A STATIC LINT AND NOT ANOTHER WIDGET TEST. The app's
//   `test/a11y/keyboard_sweep_test.dart` walks the ROUTER — and a modal sheet is
//   not a route. The add-subscription sheet's service chips, cycle segments and
//   date field (B23) were keyboard-dead on the one surface every user opens
//   first, and the sweep never reached them. A rule over source reaches every
//   file, routed or not, in every app and in the brick.
//
// ── LIMB 2 · ST-Y3 (autofill slice) · EVERY PASSWORD FIELD AUTOFILLS (D15 class)
// WCAG 2.2 SC 3.3.8 Accessible Authentication (Minimum): a step that asks the
// user to RECALL a secret must let a password manager supply it. Every
// `obscureText:` or `obscure:` argument that is not the literal `false` must sit
// in a call that also passes `autofillHints:`. A passthrough counts — AuthField
// forwards its own `autofillHints` parameter, and its callers are read in their
// turn. The literal `null` does not: it is the one spelling that knowably does
// nothing.
//
// ── LIMB 3 · ST-Y5 · EVERY STAMPED WEB APP HAS A SCREEN-READER TREE (D26)
// Flutter web compiles the semantics DOM only once something asks for it; until
// then a screen reader finds a canvas and a hidden "Enable accessibility"
// button. `apps/subscriptiontracker` fixed that in its own `main()`, and nothing
// reached the brick, so every stamped web app shipped with no tree. The fix
// lives in `package:nikatru_chassis_screens/shell/web_semantics.dart`, and this
// limb holds the wiring:
//   · `bootstrapNikatru` (shell/bootstrap.dart) calls `enableWebSemantics()`
//     BEFORE `runGuarded(` — so the first frame, and the error screen, carry a
//     tree;
//   · every app's `lib/main.dart`, the brick's included, reaches it: through a
//     `bootstrapNikatru(` call, or through a direct `enableWebSemantics()` call
//     before `runApp(` (the flagship, until it moves onto bootstrap — ST-K1);
//   · every integration harness that boots an app's `main()` — under
//     `apps/*/integration_test/` and the brick's — calls `releaseWebSemantics()`.
//     On web `main()` now holds a SemanticsHandle for EVERY stamped app, and
//     flutter_test verifies handles right after each test body: a harness that
//     never hands it back fails its first test AFTER the body passed ("A
//     SemanticsHandle was active at the end of the test.", e2e run 34453685391
//     — the flagship's, before it gained the release). Turning the tree on in
//     `bootstrapNikatru` is what makes that true of the brick's e2e and store
//     capture too, so the same limb that holds the call holds its test-side
//     twin.
//
// ── THE BASELINE IS SHRINK-ONLY, AND EVERY ROW NAMES ITS OWNER ────────────────
// Seven known instances are owned by other trains, which edit those files. They
// sit in BASELINE below, keyed by FILE + ANCHOR TEXT, never a line number (a
// line number is re-pointed by any edit above it and keeps matching something).
// A NEW instance fails (exit 1). A row whose instance is gone — converted,
// moved, or now compliant — also fails (exit 1, "delete this row"), so the list
// cannot outlive the defects it names. It is not an allowlist that grows: the
// [pipeline C-6] rule prints known, owned gaps rather than reddening every
// unrelated change on them, and fails on everything else.
//
// ── THE DOMAIN IS DERIVED, NEVER WRITTEN DOWN ─────────────────────────────────
// `git ls-files` → every `apps/*/lib`, every `packages/*/lib`, and every `lib`
// under the brick template `tooling/bricks/app/__brick__/`. No app is named in
// the scan. Dart is read through ./dart-source.mjs — comments stripped, string
// contents blanked, byte offsets preserved — so a GestureDetector in a doc
// comment or a string is not a control, and a paren inside a string is not a
// paren.
//
// COVERAGE LOST (exit 2) — the run did not check enough to be evidence:
//   · no tracked .dart under the roots, or a root CLASS (apps, packages, the
//     brick) derived nothing — the brick has no Dart runner of its own, so this
//     static read is the only reading it gets;
//   · a file holding a gesture detector or an obscured field whose parentheses
//     do not balance after the reduction (a mis-parsed call would silently
//     satisfy limb 1 or 2);
//   · no gesture detector or no obscured field found anywhere (FocusableTap and
//     AuthField each carry one, so zero is a blind scan, not a clean tree);
//   · limb 3's anchors are missing: bootstrap.dart, its `bootstrapNikatru`
//     body, its `runGuarded(` call, or an app root's `lib/main.dart`;
//   · no integration harness that boots an app's `main()` found at all (the
//     brick carries two, so zero is a blind read, not a clean one).
// Findings (exit 1) outrank a blind limb when both occur.
//
// [ADR 067] decision 2 is why limb 3 anchors on the chassis bootstrap: it is
// the boot order every stamped app inherits.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripDartComments, blankDartStrings } from './dart-source.mjs';

// argv[2] overrides the tree, so the tests mutate a git-init'ed COPY of the real
// tree rather than the checkout. One enumeration (`git ls-files`), both callers.
const REPO = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BRICK_PREFIX = 'tooling/bricks/app/__brick__/';
const BOOTSTRAP = 'packages/chassis_screens/lib/shell/bootstrap.dart';

const TAP_CALLBACKS = new Set(['onTap', 'onTapUp', 'onTapDown', 'onDoubleTap', 'onLongPress']);
/** For a RawGestureDetector the callbacks live inside its `gestures:` map. */
const TAP_RECOGNIZERS = /\b(TapGestureRecognizer|DoubleTapGestureRecognizer|LongPressGestureRecognizer)\b/g;
const DETECTORS = new Set(['GestureDetector', 'RawGestureDetector']);
const OBSCURING = new Set(['obscureText', 'obscure']);
const FIX = 'FocusableTap (package:nikatru_design_system), InkWell, or SegmentedButton';

/** Limb 1 exemption (b). Each lapses when its `requires` leaves the file. */
const PRIMITIVES = [
  {
    file: 'packages/design_system/lib/src/widgets/focusable_tap.dart',
    anchor: 'Widget result = GestureDetector(',
    requires: 'FocusableActionDetector(',
    why: 'FocusableTap itself — the detector is the pointer half of a FocusableActionDetector',
  },
];

// ── THE BASELINE. SHRINK-ONLY. ────────────────────────────────────────────────
// Measured on main e0beeb14 and re-measured on aad5d670 (2026-09-28). A row goes when its owner converts the
// instance; this guard then fails until the row is deleted. Never add a row to
// make a new instance pass — convert it.
const BASELINE = [
  // The brick's two harnesses: the fix is two lines in each, and ST-T8a was
  // barred from brick files (they share tooling/chassis-ledger.json with W55 and
  // M5). Latent until a stamped app's web e2e or store capture first runs.
  {
    limb: 'ST-Y5',
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/app_test.dart',
    anchor: 'await app.main();',
    what: 'the brick e2e harness',
    owner: "D26 — the next brick train: import package:nikatru_chassis_screens/shell/web_semantics.dart, call releaseWebSemantics() on each body's last line",
  },
  {
    limb: 'ST-Y5',
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/store_screenshots_test.dart',
    anchor: 'await app.main();',
    what: 'the brick store-capture harness',
    owner: "D26 — the next brick train: import package:nikatru_chassis_screens/shell/web_semantics.dart, call releaseWebSemantics() on each body's last line",
  },
];

const problems = [];
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const finding = (m) => problems.push(m);
function exitIfProblems() {
  if (!problems.length) return;
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-a11y-primitives: FAILED');
  // Exit 2 only when EVERY problem is a COVERAGE LOST (the run was not evidence);
  // a proven finding outranks a blind limb. assert-guard-coverage.mjs reads this idiom.
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
}

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ── Dart reading ──────────────────────────────────────────────────────────────
/** Two length-preserving views of one file: `text` (comments gone, strings kept —
 *  anchors are matched here) and `code` (strings blanked too — structure is
 *  parsed here). Same offsets in both. */
function views(rel) {
  const raw = readFileSync(join(REPO, rel), 'utf8');
  const text = stripDartComments(raw);
  return { text, code: blankDartStrings(text) };
}

const lineOf = (s, index) => {
  let n = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/** The identifier immediately before the `(` at `open`, skipping whitespace
 *  and one balanced `<…>` type-argument list; null for a bare `(` (a closure's
 *  parameters, a parenthesised expression). */
function nameBefore(code, open) {
  let j = open - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  if (code[j] === '>') {
    let depth = 0;
    for (; j >= 0; j--) {
      if (code[j] === '>') depth++;
      else if (code[j] === '<' && --depth === 0) break;
    }
    j--;
    while (j >= 0 && /\s/.test(code[j])) j--;
  }
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(code[j])) j--;
  return end > j + 1 ? code.slice(j + 1, end) : null;
}

/** Every parenthesised call in `code`, with its parent — or null when the
 *  parentheses do not balance. */
function parseCalls(code) {
  const calls = [];
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(') {
      calls.push({ name: nameBefore(code, i), open: i, close: -1, parent: stack.length ? stack[stack.length - 1] : -1 });
      stack.push(calls.length - 1);
    } else if (c === ')') {
      if (!stack.length) return null;
      calls[stack.pop()].close = i;
    }
  }
  return stack.length ? null : calls;
}

/** The call's depth-0 NAMED arguments: [{ name, value, at }]. A ternary's
 *  `a ? b : c` never matches — its identifier is followed by `?`, not `:`. */
function namedArgs(code, call) {
  const out = [];
  let depth = 0;
  let start = call.open + 1;
  const take = (from, to) => {
    const seg = code.slice(from, to);
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:(?!:)/.exec(seg);
    if (m) out.push({ name: m[1], value: seg.slice(m[0].length).trim(), at: from + m[0].indexOf(m[1]) });
  };
  for (let i = call.open + 1; i < call.close; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      take(start, i);
      start = i + 1;
    }
  }
  take(start, call.close);
  return out;
}

function* ancestors(calls, call) {
  for (let p = call.parent; p !== -1; p = calls[p].parent) yield calls[p];
}

/** What an anchor is matched against: from the start of the call's first line
 *  to its closing paren, comments stripped, strings intact. */
const contextOf = (text, call) => text.slice(text.lastIndexOf('\n', call.open) + 1, call.close + 1);

// ── (0) THE ROOTS — DERIVED ──────────────────────────────────────────────────
let tracked = [];
try {
  tracked = git('ls-files', '--', '*.dart').split('\n').filter(Boolean);
} catch {
  tracked = [];
}

const rootOf = (p) => {
  const seg = p.split('/');
  if ((seg[0] === 'apps' || seg[0] === 'packages') && seg[2] === 'lib' && seg.length > 3) {
    return { root: seg.slice(0, 3).join('/'), kind: seg[0] };
  }
  if (p.startsWith(BRICK_PREFIX)) {
    const i = seg.indexOf('lib', 4);
    if (i !== -1 && i < seg.length - 1) return { root: seg.slice(0, i + 1).join('/'), kind: 'brick' };
  }
  return null;
};

const rootFiles = new Map(); // root → [files]
const rootKind = new Map();
for (const p of tracked) {
  const r = rootOf(p);
  if (!r) continue;
  if (!rootFiles.has(r.root)) rootFiles.set(r.root, []);
  rootFiles.get(r.root).push(p);
  rootKind.set(r.root, r.kind);
}
const roots = [...rootFiles.keys()].sort();

const KINDS = [
  ['apps', 'apps/*/lib — the shipped apps'],
  ['packages', 'packages/*/lib — the shared packages every app mounts (design_system, chassis_screens)'],
  ['brick', `${BRICK_PREFIX}**/lib — the template every future app is stamped from, which has no Dart runner of its own`],
];

if (roots.length === 0) {
  coverageLost(
    `no tracked .dart file under apps/*/lib, packages/*/lib or ${BRICK_PREFIX}**/lib in ${REPO}. ` +
      'An empty scan reads exactly like a compliant one.',
  );
} else {
  for (const [kind, label] of KINDS) {
    if (![...rootKind.values()].includes(kind)) {
      coverageLost(
        `the ${kind} root class derived NOTHING (${label}). The other ${roots.length} root(s) still scanned, ` +
          'so every count below would print healthy over a tree with that class gone.',
      );
    }
  }
}
// With NO root, every verdict below is about nothing: a baseline row or the
// primitive exemption would read "stale" over an empty tree, and a finding
// outranks COVERAGE LOST — so an empty tree would exit 1 as if it were a real
// regression. Stop here, blind and saying so.
if (roots.length === 0) exitIfProblems();

// ── (1) + (2) THE SCAN ───────────────────────────────────────────────────────
const detectors = []; // limb 1 instances with a tap callback
const obscured = []; // limb 2 instances
let detectorsSeen = 0;
let detectorsNoTap = 0;
const perRoot = [];

for (const root of roots) {
  let rootDetectors = 0;
  let rootObscured = 0;
  for (const file of rootFiles.get(root)) {
    const { text, code } = views(file);
    const hasDetector = /(?<![\w$])(?:Raw)?GestureDetector\s*\(/.test(code);
    const hasObscure = /(?<![\w$])(?:obscureText|obscure)\s*:/.test(code);
    if (!hasDetector && !hasObscure) continue;
    const calls = parseCalls(code);
    if (!calls) {
      coverageLost(
        `${file}: its parentheses do not balance after comments and strings are reduced, so no call in it can be ` +
          'read. A mis-parsed call would silently pass limb 1 or 2; this file is refused instead of scored.',
      );
      continue;
    }
    for (const call of calls) {
      const args = namedArgs(code, call);
      const at = `${file}:${lineOf(code, call.open)}`;

      if (DETECTORS.has(call.name)) {
        detectorsSeen++;
        rootDetectors++;
        const taps =
          call.name === 'GestureDetector'
            ? args.filter((a) => TAP_CALLBACKS.has(a.name) && a.value !== 'null').map((a) => a.name)
            : [...new Set([...code.slice(call.open, call.close).matchAll(TAP_RECOGNIZERS)].map((m) => m[1]))];
        if (taps.length === 0) {
          detectorsNoTap++;
          continue;
        }
        let excluded = null;
        let role = null;
        for (const a of ancestors(calls, call)) {
          const aArgs = () => namedArgs(code, a);
          if (!excluded && a.name === 'ExcludeSemantics') {
            // `excluding: false` (or a variable that may be false) excludes nothing.
            const ex = aArgs().find((x) => x.name === 'excluding');
            if (!ex || ex.value === 'true') excluded = `${file}:${lineOf(code, a.open)}`;
          }
          if (!role && a.name === 'Semantics') {
            const r = aArgs().find((x) => (x.name === 'button' || x.name === 'link') && x.value === 'true');
            role = { at: `${file}:${lineOf(code, a.open)}`, flag: r ? `${r.name}: true` : null };
          }
        }
        detectors.push({ file, at, name: call.name, taps, excluded, role, context: contextOf(text, call), text });
      }

      for (const a of args) {
        if (!OBSCURING.has(a.name) || a.value === 'false') continue;
        rootObscured++;
        const hints = args.find((x) => x.name === 'autofillHints');
        obscured.push({
          file,
          at: `${file}:${lineOf(code, a.at)}`,
          arg: a.name,
          call: call.name ?? '(anonymous call)',
          hinted: Boolean(hints && hints.value !== 'null'),
          nullHint: Boolean(hints && hints.value === 'null'),
          context: contextOf(text, call),
        });
      }
    }
  }
  perRoot.push({ root, files: rootFiles.get(root).length, detectors: rootDetectors, obscured: rootObscured });
}

if (roots.length && detectorsSeen === 0) {
  coverageLost(
    `no GestureDetector( or RawGestureDetector( found in ${roots.length} root(s). FocusableTap's own detector alone ` +
      'guarantees one, so zero means the scan went blind, not that the tree is clean.',
  );
}
if (roots.length && obscured.length === 0) {
  coverageLost(
    `no obscured field (obscureText: / obscure: not \`false\`) found in ${roots.length} root(s). AuthField alone ` +
      'carries one, so zero means the scan went blind, not that the tree has no password field.',
  );
}

// ── limb 1 verdicts ──────────────────────────────────────────────────────────
const exemptLines = [];
const refused1 = [];
const primitiveHits = new Map(PRIMITIVES.map((p) => [p, 0]));
for (const d of detectors) {
  if (d.excluded) {
    exemptLines.push(`exempt ${d.at} ${d.name}(${d.taps.join(', ')}) — under ExcludeSemantics at ${d.excluded}: a pointer convenience beside a focusable twin`);
    continue;
  }
  const prim = PRIMITIVES.find((p) => p.file === d.file && d.context.includes(p.anchor) && d.text.includes(p.requires));
  if (prim) {
    primitiveHits.set(prim, primitiveHits.get(prim) + 1);
    exemptLines.push(`exempt ${d.at} ${d.name}(${d.taps.join(', ')}) — ${prim.why}`);
    continue;
  }
  refused1.push(d);
}
for (const [p, n] of primitiveHits) {
  if (n === 0) {
    finding(
      `ST-Y2: the primitive exemption for ${p.file} (anchor \`${p.anchor}\`, requires \`${p.requires}\`) matched no ` +
        'detector. The primitive moved, was rewritten, or lost its FocusableActionDetector — update or delete the ' +
        'exemption in PRIMITIVES, never widen it.',
    );
  } else if (n > 1) {
    finding(`ST-Y2: the primitive exemption for ${p.file} matched ${n} detectors; its anchor must name exactly one.`);
  }
}

// ── limb 2 verdicts ──────────────────────────────────────────────────────────
const refused2 = obscured.filter((o) => !o.hinted);

// ── the baseline, matched against REFUSED instances only ─────────────────────
const baselined = new Set();
const baselineLines = [];
// A brick row is not judged while the brick root class is unreached: that run
// is already COVERAGE LOST, and "delete this row" would be a false finding.
const brickReached = [...rootKind.values()].includes('brick');
function matchBaseline(limb, pool) {
  for (const row of BASELINE.filter((r) => r.limb === limb && (brickReached || !r.file.startsWith(BRICK_PREFIX)))) {
    const hits = pool.filter((i) => i.file === row.file && i.context.includes(row.anchor));
    if (hits.length === 0) {
      finding(
        `${row.limb}: BASELINE row for ${row.what} (${row.file}, anchor \`${row.anchor}\`; owner ${row.owner}) matches ` +
          'no refused instance — it was converted, moved or made compliant. Delete this row: the baseline only shrinks.',
      );
    } else if (hits.length > 1) {
      finding(
        `${row.limb}: BASELINE row for ${row.what} (${row.file}, anchor \`${row.anchor}\`) matches ${hits.length} ` +
          `instances (${hits.map((h) => h.at).join(', ')}); an anchor must name exactly one.`,
      );
    } else {
      baselined.add(hits[0]);
      baselineLines.push(`known  ${hits[0].at} — ${row.what}; ${row.limb}; owner ${row.owner}`);
    }
  }
}
matchBaseline('ST-Y2', refused1);
matchBaseline('ST-Y3', refused2);

for (const d of refused1) {
  if (baselined.has(d)) continue;
  const wrap = d.role?.flag
    ? ` It is wrapped in Semantics(${d.role.flag}) at ${d.role.at}: a screen reader announces a control a keyboard can never reach.`
    : '';
  finding(
    `ST-Y2: ${d.at} — ${d.name}(${d.taps.join(', ')}) is a pointer-only control: no focus, no Enter/Space, no focus ` +
      `ring (WCAG 2.1.1, 2.4.7).${wrap} Fix: ${FIX}.`,
  );
}
for (const o of refused2) {
  if (baselined.has(o)) continue;
  finding(
    `ST-Y3: ${o.at} — ${o.call}(${o.arg}: …) is an obscured field ${o.nullHint ? 'whose autofillHints is the literal null' : 'with no autofillHints:'}, ` +
      'so a password manager cannot fill it and the user must recall the secret (WCAG 2.2 SC 3.3.8). Fix: pass ' +
      'autofillHints — AutofillHints.password to re-enter an existing secret, AutofillHints.newPassword to set one.',
  );
}

// ── (3) LIMB 3 · the web screen-reader tree ───────────────────────────────────
const call = (name) => new RegExp(`(?<![\\w$.])${name}\\s*\\(`);
let limb3Apps = 0;
if (roots.length) {
  if (!tracked.includes(BOOTSTRAP)) {
    coverageLost(`${BOOTSTRAP} is not tracked, so limb 3 cannot say whether a stamped app turns the web screen-reader tree on.`);
  } else {
    const { code } = views(BOOTSTRAP);
    const decl = /\bbootstrapNikatru\s*\(/g;
    let body = null;
    for (const m of code.matchAll(decl)) {
      const calls = parseCalls(code);
      const c = calls?.find((x) => x.open === m.index + m[0].length - 1);
      if (!c) continue;
      const after = /^\s*(?:async\s*)?\{/.exec(code.slice(c.close + 1));
      if (!after) continue;
      const open = c.close + 1 + after[0].length - 1;
      let depth = 0;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}' && --depth === 0) {
          body = { from: open, text: code.slice(open, i + 1) };
          break;
        }
      }
      if (body) break;
    }
    if (!body) {
      coverageLost(`${BOOTSTRAP} declares no \`bootstrapNikatru(…) { … }\` body limb 3 can read.`);
    } else {
      const runAt = body.text.search(call('runGuarded'));
      const enableAt = body.text.search(call('enableWebSemantics'));
      if (runAt === -1) {
        coverageLost(`${BOOTSTRAP}'s bootstrapNikatru body calls no runGuarded( — the anchor limb 3 orders against moved.`);
      } else if (enableAt === -1) {
        finding(
          `ST-Y5: ${BOOTSTRAP} never calls enableWebSemantics(): every stamped web app ships no screen-reader tree. ` +
            'Flutter web builds the semantics DOM only when asked; call it straight after ensureInitialized() and ' +
            'before runGuarded(, so the error screen is readable too.',
        );
      } else if (enableAt > runAt) {
        finding(
          `ST-Y5: ${BOOTSTRAP}:${lineOf(code, body.from + enableAt)} calls enableWebSemantics() AFTER runGuarded( at ` +
            `:${lineOf(code, body.from + runAt)} — a frame (or the error screen) built before it carries no tree. Move it up.`,
        );
      }
    }
  }

  for (const root of roots.filter((r) => rootKind.get(r) !== 'packages')) {
    const main = `${root}/main.dart`;
    if (!tracked.includes(main)) {
      coverageLost(`${root} has no tracked main.dart, so limb 3 cannot say whether that app turns the web screen-reader tree on.`);
      continue;
    }
    limb3Apps++;
    const { code } = views(main);
    if (call('bootstrapNikatru').test(code)) continue;
    const enableAt = code.search(call('enableWebSemantics'));
    const runAppAt = code.search(call('runApp'));
    if (runAppAt === -1) {
      coverageLost(`${main} calls neither bootstrapNikatru( nor runApp( — limb 3 cannot find the boot path it orders against.`);
    } else if (enableAt === -1 || enableAt > runAppAt) {
      finding(
        `ST-Y5: ${main} neither boots through bootstrapNikatru( nor calls enableWebSemantics() before runApp( at ` +
          `:${lineOf(code, runAppAt)} — its web build ships no screen-reader tree. Boot through bootstrapNikatru, or ` +
          'call enableWebSemantics() (package:nikatru_chassis_screens/shell/web_semantics.dart) first.',
      );
    }
  }
}

// ── (3b) every harness that boots main() hands the handle back ───────────────
const HARNESS = /^apps\/[^/]+\/integration_test\/|^tooling\/bricks\/app\/__brick__\/.*\/integration_test\//;
const refused3 = [];
let harnesses = 0;
if (roots.length) {
  for (const file of tracked.filter((p) => HARNESS.test(p))) {
    const { text, code } = views(file);
    // The alias is read from `text` (strings intact); the call from `code`, so a
    // `app.main()` in a comment or a string is not a boot.
    const aliases = [...text.matchAll(/^\s*import\s+['"]package:[^'"]+\/main\.dart['"]\s+as\s+([A-Za-z_$][\w$]*)\s*;/gm)].map((m) => m[1]);
    const boots = aliases
      .map((a) => code.search(new RegExp(`(?<![\\w$.])${a}\\s*\\.\\s*main\\s*\\(`)))
      .filter((i) => i !== -1);
    if (!boots.length) continue;
    harnesses++;
    if (call('releaseWebSemantics').test(code)) continue;
    const at = Math.min(...boots);
    const end = text.indexOf('\n', at);
    refused3.push({
      file,
      at: `${file}:${lineOf(code, at)}`,
      context: text.slice(text.lastIndexOf('\n', at) + 1, end === -1 ? text.length : end),
    });
  }
  if (harnesses === 0) {
    coverageLost(
      "no integration harness under apps/*/integration_test/ or the brick's boots an app's main(). The brick " +
        'carries two, so zero means the read went blind, not that no harness holds a SemanticsHandle.',
    );
  }
  matchBaseline('ST-Y5', refused3);
  for (const h of refused3) {
    if (baselined.has(h)) continue;
    finding(
      `ST-Y5: ${h.at} boots main() and never calls releaseWebSemantics(): on web main() holds a SemanticsHandle ` +
        '(bootstrapNikatru → enableWebSemantics), and flutter_test fails the first test AFTER its body passed — "A ' +
        'SemanticsHandle was active at the end of the test." (e2e run 34453685391). Call releaseWebSemantics() ' +
        "(package:nikatru_chassis_screens/shell/web_semantics.dart) on each body's last line.",
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
for (const r of perRoot) {
  console.log(`ok   ${r.root} — ${r.files} .dart file(s); ${r.detectors} gesture detector(s); ${r.obscured} obscured field(s)`);
}
for (const l of exemptLines) console.log(l);
for (const l of baselineLines) console.log(l);

exitIfProblems();

const inScope = detectors.length;
console.log(
  `\nassert-a11y-primitives: ok — ${roots.length} derived root(s); ST-Y2: ${detectorsSeen} gesture detector(s), ` +
    `${detectorsNoTap} without a tap callback, ${inScope} in scope, ${exemptLines.length} exempt and PRINTED, ` +
    `${[...baselined].filter((b) => detectors.includes(b)).length} baselined, 0 refused; ST-Y3: ${obscured.length} ` +
    `obscured field(s), ${refused2.length} without hints, all baselined; ST-Y5: bootstrapNikatru turns the tree on ` +
    `before runGuarded, and ${limb3Apps} app entry point(s) reach it; ${harnesses} harness(es) boot main(), ` +
    `${harnesses - refused3.length} release the handle, ${refused3.length} baselined`,
);
