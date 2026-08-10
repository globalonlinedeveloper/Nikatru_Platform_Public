#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-signup-consent-shape.mjs — NO CONSENT BOX IS EVER BORN TICKED, AND THE
// TERMS TICK IS ALWAYS THE THING THAT OPENS THE BUTTON.
//
// 🔴 WHY THIS IS A GUARD AND NOT A NOTE. Change `bool _acceptedTerms = false;`
// to `= true` and EVERYTHING STILL WORKS. The screen renders, the button is
// live, sign-up succeeds, an acceptance artifact is written, every existing test
// passes and the app is unlawful in every market it ships to — Planet49/EDPB
// (pre-ticked ≠ consent), the DPDP Rules 2025, and CPRA's dark-pattern rules all
// land on the same line. There is no exception to raise and no pixel to notice.
// It is exactly the class of mistake this repository has decided belongs in CI
// rather than in prose: prose only helps a session that reads it.
//
// Adopted from research/43's SPLIT verdict + research/44's rider (owner,
// 2026-08-09), landing with the 39-CHASSIS cut-1 reversal.
//
// ── THE THREE LIMBS ─────────────────────────────────────────────────────────
//   1. UNTICKED — every consent-flag field on a sign-up surface initialises to
//      `false`. Both the app and the BRICK TEMPLATE, because a fork in the
//      template is not one bad app, it is every app the factory will stamp.
//   2. BLOCKING — each surface's terms flag appears in a DISABLING position: an
//      early `if (… !<flag>) return;` guard AND an `onPressed:` expression. One
//      without the other is a half-gate: a disabled button alone is bypassed by
//      the keyboard's `onSubmitted:`, and a guard alone leaves a live button
//      that silently does nothing.
//   3. NOT CONDITIONAL ON MARKETING — the marketing flag must NOT appear in
//      either position. An optional consent that gates the service is GDPR
//      Art 7(4) conditionality, declined in the research as legally unavailable
//      rather than as a matter of taste.
//
// ── COVERAGE SELF-CHECK ─────────────────────────────────────────────────────
// Every limb above is satisfied by an EMPTY set of surfaces. A guard that finds
// no sign-up screens reports a clean tree forever, which is the "silently
// stopped checking" shape this repo keeps paying for — so the floors below
// assert the scan found what it is known to contain before any verdict is
// believed.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE ANY MATCHING (text-reductions.mjs). This
// file's own prose contains `_acceptedTerms = true`, and so do the doc comments
// on the surfaces themselves, which explain the rule at length. A guard that
// greps prose reports the opposite of the truth exactly when the code is right.
//
// Usage:  node tooling/ci/assert-signup-consent-shape.mjs [repoRoot]
// Exit 0 = every sign-up surface is compliant; 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

/** The surfaces that TAKE a consent decision. Both trees, always.
 *
 *  `terms` is the flag that must block; `marketing` is the flag that must not.
 *  A surface with no marketing box (the re-acceptance interstitial) declares
 *  `marketing: null` — it is not exempt from limb 1, only from limb 3. */
const SURFACES = [
  {
    file: 'apps/subly/lib/features/auth/sign_up_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
  },
  {
    // 🔴 THE SECOND DOOR, AND IT IS THE ONE MOST USERS TAKE. Subly's
    // `LoginScreen` carries a sign-up TOGGLE, so `/sign-up` is not the only way
    // to register — and `/sign-in` is where the router sends every signed-out
    // visitor. A clickwrap with a second entrance is not a clickwrap.
    file: 'apps/subly/lib/features/auth/login_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
  },
  {
    file: 'apps/subly/lib/features/auth/reaccept_terms_screen.dart',
    terms: '_accepted',
    marketing: null,
  },
  {
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_up_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
  },
  {
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/reaccept_terms_screen.dart',
    terms: '_accepted',
    marketing: null,
  },
];

/** The shared widget both trees render the boxes with. Its checkbox `value:`
 *  comes from the caller and it takes no `initial…` argument at all — the
 *  property that makes limb 1 sufficient rather than a spot check. */
const WIDGETS = [
  'apps/subly/lib/features/auth/legal_consent_fields.dart',
  'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/legal_consent_fields.dart',
];

/** The floor. Below it the scan broke rather than the tree being clean.
 *
 *  🔴 THERE IS EXACTLY ONE, AND A SECOND ONE WAS DELETED RATHER THAN CORRECTED.
 *  This file shipped with `MIN_BLOCKING = 4` beside it, commented "every surface
 *  with a terms flag, which is all of them" — and all of them is FIVE, so the
 *  number never described the tree. Worse, it could not fail: a shortfall was
 *  pushed to `notes`, which prints `⚠` and exits 0.
 *
 *  Correcting the number to 5 and promoting it to `problems` would have made it
 *  an assertion that STILL cannot fail, which is the trap rather than the fix.
 *  Every surface either increments the blocking count or pushes a limb-2
 *  problem, so `blocking < scanned` implies `problems.length > 0` and the build
 *  is already red — with a message naming the exact file, which the floor's
 *  message could not. And a surface vanishing from the list is what
 *  [MIN_SURFACES] is for. The floor was therefore redundant in every direction
 *  it could point, and this repository's rule is that an assertion nobody can
 *  write a failing input for is worse than none: it inflates apparent coverage. */
const MIN_SURFACES = 5;

const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

const read = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart');

let scanned = 0;
let blocking = 0;

for (const s of SURFACES) {
  if (!existsSync(join(ROOT, s.file))) {
    problems.push(
      `COVERAGE LOST — ${s.file} is in the surface list and does not exist. A sign-up surface that ` +
        'moved without this list moving is a surface nothing checks; re-point the entry or remove it ' +
        'deliberately.',
    );
    continue;
  }
  const code = read(s.file);
  scanned++;

  // ── limb 1 · UNTICKED ─────────────────────────────────────────────────────
  // Matches the DECLARATION, `bool <flag> = <literal>;`. Anchored on `bool`
  // rather than on the bare name so an assignment elsewhere in the file (the
  // `setState` in `onTermsChanged`, which legitimately assigns true) is not
  // mistaken for the initial value.
  for (const flag of [s.terms, s.marketing].filter(Boolean)) {
    const decl = new RegExp(`\\bbool\\s+${flag}\\s*=\\s*([A-Za-z0-9_]+)\\s*;`).exec(code);
    if (!decl) {
      problems.push(
        `${s.file}: no \`bool ${flag} = …;\` declaration found. The consent flag this guard checks is ` +
          'gone or renamed — which means nothing is checking whether the box arrives ticked.',
      );
    } else if (decl[1] !== 'false') {
      problems.push(
        `🔴 PRE-TICKED CONSENT — ${s.file} initialises \`${flag}\` to \`${decl[1]}\`, not \`false\`. ` +
          'A box the user did not tick is not consent (Planet49/EDPB · DPDP Rules 2025 · CPRA ' +
          'dark-pattern rules), and nothing else in this repository can see the difference: the ' +
          'screen renders, the button works, an acceptance artifact is written, and every test passes.',
      );
    }
  }

  // ── limb 2 · THE TERMS TICK BLOCKS, IN BOTH POSITIONS ─────────────────────
  const guarded = new RegExp(`if\\s*\\([^)]*!${s.terms}\\b[^)]*\\)`).test(code);
  const disables = new RegExp(`onPressed\\s*:[\\s\\S]{0,200}?!${s.terms}\\b`).test(code);
  if (guarded && disables) {
    blocking++;
  } else {
    problems.push(
      `${s.file}: the terms flag \`${s.terms}\` is ${guarded ? '' : 'NOT '}used in an early-return guard and ` +
        `${disables ? '' : 'NOT '}used to disable a button. BOTH are required. A disabled button alone is ` +
        "bypassed by the keyboard (`onSubmitted:` reaches the handler directly); a guard alone leaves a " +
        'live control that silently does nothing, which reads to the user as a broken app.',
    );
  }

  // ── limb 3 · THE OPTIONAL BOX MAY NOT GATE ────────────────────────────────
  if (s.marketing) {
    const mGuard = new RegExp(`if\\s*\\([^)]*!${s.marketing}\\b[^)]*\\)`).test(code);
    const mDisable = new RegExp(`onPressed\\s*:[\\s\\S]{0,200}?!${s.marketing}\\b`).test(code);
    if (mGuard || mDisable) {
      problems.push(
        `🔴 CONDITIONALITY — ${s.file} gates sign-up on \`${s.marketing}\`, the OPTIONAL marketing opt-in. ` +
          'Making a service conditional on a consent that is not necessary for it is GDPR Art 7(4); ' +
          'research/43 declined this as legally unavailable in every target market, not as a preference.',
      );
    }
  }
}

// ── the shared widget cannot be asked to pre-tick ─────────────────────────────
// The state lives in the parent; if this widget ever grows an `initial…`
// argument, limb 1 stops being sufficient because a caller could pass `true`
// without ever declaring a field this guard can see.
for (const rel of WIDGETS) {
  if (!existsSync(join(ROOT, rel))) {
    problems.push(`COVERAGE LOST — ${rel} does not exist; the shared consent widget is the thing limb 1 relies on.`);
    continue;
  }
  const code = read(rel);
  if (/\binitial[A-Z]\w*\s*[:=]/.test(code)) {
    problems.push(
      `${rel} declares an \`initial…\` parameter. The consent state must live in the CALLER, where a ` +
        'declaration this guard can read decides it — an `initialTermsAccepted:` argument is a way to ' +
        'pre-tick a box without any field in this repository saying `true`.',
    );
  }
}

// ── coverage self-checks ─────────────────────────────────────────────────────
if (scanned < MIN_SURFACES) {
  problems.push(
    `COVERAGE LOST — scanned ${scanned} sign-up surface(s), expected at least ${MIN_SURFACES}. ` +
      'Every limb above is satisfied by an empty set, so a broken scan reports a compliant tree.',
  );
}
// 🔴 THE `blocking` COUNT IS REPORTED, NOT ASSERTED, and that is the whole
// point of the note on MIN_SURFACES above. It is printed in the success line so
// a human reading CI output can see the number move; the enforcement is limb 2,
// per surface, by name.

for (const n of notes) console.log(`⚠  ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('\nassert-signup-consent-shape: FAILED');
  process.exit(1);
}

ok(
  `signup consent shape — ${scanned} surface(s) scanned, every consent flag initialises to false, ` +
    `${blocking} terms tick(s) block in both positions, no optional consent gates a sign-up`,
);
