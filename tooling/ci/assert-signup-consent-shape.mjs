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
//   4. APPLE ACCEPTS FIRST (⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP) — every file that
//      calls Sign in with Apple is a listed door, and in each door the terms
//      refusal, the disabled button and the recorded acceptance all come BEFORE
//      the provider call. Counted by call site, because a door with no boxes was
//      never a surface limbs 1-3 could find missing.
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
// Exit 0 = every sign-up surface is compliant; 1 = it is not; 2 = COVERAGE LOST only (it could not look).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { delegationOf as resolveChassisDelegation } from './chassis-delegation.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

/** The span of ONE `onPressed:` expression, for the per-button checks below: it
 *  may not run into the next control's `onPressed:` or `key:`. Widget trees
 *  carry no `;`, so without this bound a check on one button is satisfied by the
 *  flag on the NEXT button down — measured: deleting the sign-up submit's
 *  disabling half went green because the Apple button below still had one. */
const ONE_EXPRESSION = '(?:(?!onPressed|\\bkey\\s*:)[^;])*?';

/** The surfaces that TAKE a consent decision. Both trees, always.
 *
 *  `terms` is the flag that must block; `marketing` is the flag that must not.
 *  A surface with no marketing box (the re-acceptance interstitial) declares
 *  `marketing: null` — it is not exempt from limb 1, only from limb 3. */
const SURFACES = [
  {
    file: 'apps/subscriptiontracker/lib/features/auth/sign_up_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
  },
  {
    // 🔴 THE SECOND DOOR, AND IT IS THE ONE MOST USERS TAKE. Subly's
    // `LoginScreen` carries a sign-up TOGGLE, so `/sign-up` is not the only way
    // to register — and `/sign-in` is where the router sends every signed-out
    // visitor. A clickwrap with a second entrance is not a clickwrap.
    file: 'apps/subscriptiontracker/lib/features/auth/login_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
    // ⏱ 2026-09-15 · this screen's flags now gate TWO controls — the sign-up
    // submit and the Apple button (O-SIWA-NO-CLICKWRAP). A file-wide "some
    // onPressed disables on the flag" stopped proving the submit is one of them
    // (the case that deletes its disabling half went green), so limb 2 reads the
    // SUBMIT's own onPressed here; limb 4 reads the Apple button's.
    button: 'E2EKeys\\.loginSubmit',
  },
  {
    file: 'apps/subscriptiontracker/lib/features/auth/reaccept_terms_screen.dart',
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
  {
    // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP. THE THIRD DOOR, AND IT HAD NO BOX AT ALL.
    // Sign in with Apple can create an account, so the chassis sign-in body now
    // carries the same two flags for the Apple button (read through the brick
    // adapter's delegation). Subly's `LoginScreen`, above, gates its Apple button
    // on the flags it already declares.
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_in_screen.dart',
    terms: '_acceptedTerms',
    marketing: '_marketingEmail',
  },
];

/** ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP — every door that reaches Sign in with Apple.
 *
 *  🔴 LIMBS 1-3 CANNOT SEE THIS GAP, AND IT SHIPPED THROUGH THEM. They check that
 *  a surface's boxes arrive unticked and block its button; a door with NO boxes
 *  is not a surface, so it is not on the list, so nothing is missing. Sign in
 *  with Apple creates an account on first use, and for as long as it had no
 *  clickwrap every limb here printed ok. Limb 4 therefore counts CALL SITES, not
 *  surfaces: every file under a shipped lib tree that calls the provider must be
 *  a door below (or a file a door delegates to), and in each door the acceptance
 *  must be recorded, behind the terms flag, BEFORE the provider is called.
 *
 *  `accept` is the acceptance call in that door's code; `provider` is the call it
 *  must precede. The brick adapter delegates its ordering to the chassis body, so
 *  it is read through the delegation and additionally has its wiring checked. */
const APPLE_DOORS = [
  {
    file: 'apps/subscriptiontracker/lib/features/auth/login_screen.dart',
    provider: /\bsignInWithApple\s*\(\s*\)/,
    accept: /legalAcceptanceProvider\s*\.\s*notifier\s*\)\s*\.\s*accept\s*\(/,
    button: new RegExp(`continueWithApple\\s*,\\s*onPressed\\s*:${ONE_EXPRESSION}!_acceptedTerms\\b`),
  },
  {
    file: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_in_screen.dart',
    provider: /\bwidget\s*\.\s*onSignInWithApple\s*\(\s*\)/,
    accept: /\bwidget\s*\.\s*onAcceptTerms\s*\(/,
    button: new RegExp(`SignInView\\s*\\.\\s*appleButton\\s*,\\s*onPressed\\s*:${ONE_EXPRESSION}!_acceptedTerms\\b`),
    wiring: [
      {
        re: /appleTermsOwed\s*:\s*core\s*\.\s*needsLegalReacceptance\s*\(\s*acceptedStamp\s*:\s*ref\s*\.\s*watch\s*\(\s*legalAcceptanceProvider\s*\)\s*,\s*current\s*:\s*kLegalVersions\s*,?\s*\)/,
        what: '`appleTermsOwed:` must be `core.needsLegalReacceptance(acceptedStamp: ref.watch(legalAcceptanceProvider), current: kLegalVersions)` — anything else decides for the device whether it owes the terms, and "not known yet" (null) must count as owed',
      },
      {
        re: /onAcceptTerms\s*:[\s\S]{0,160}?legalAcceptanceProvider\s*\.\s*notifier\s*\)\s*\.\s*accept\s*\(/,
        what: '`onAcceptTerms:` must call `legalAcceptanceProvider.notifier).accept(` — the consent artifact and the device stamp, not a no-op',
      },
    ],
  },
];

/** Lib trees whose provider calls must all belong to a door. Declarations
 *  (`Future<void> signInWithApple()`) and the seam implementations in
 *  packages/auth_supabase and packages/core are not call sites. */
const APPLE_SCAN_ROOTS = [
  'apps',
  'tooling/bricks/app/__brick__/apps/{{app_id}}/lib',
  'packages/chassis_screens/lib',
];
const APPLE_CALL = /(?<!Future<void>\s)\b(?:signInWithApple|onSignInWithApple)\s*\(\s*\)/;

/** The shared widget both trees render the boxes with. Its checkbox `value:`
 *  comes from the caller and it takes no `initial…` argument at all — the
 *  property that makes limb 1 sufficient rather than a spot check. */
const WIDGETS = [
  'apps/subscriptiontracker/lib/features/auth/legal_consent_fields.dart',
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
const MIN_SURFACES = 6;

const problems = [];
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

const read = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart');

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SURFACES ARE PINNED BY PATH *AND* BY FIELD NAME, SO A SCREEN THAT MOVES
// INTO THE CHASSIS TAKES THE FLAG WITH IT.
//
// [ADR 067] decision 2 empties a brick screen into
// `package:nikatru_chassis_screens` and leaves an adapter at the same path.
// `bool _acceptedTerms = false;` then lives in the package, and limb 1 —
// anchored on that declaration — would report "the consent flag this guard
// checks is gone or renamed" about a tree where it is one import away and
// correct. That failure is LOUD, so it is not the silent shape this repository
// keeps paying for; but it is still a guard going red for being right, and it
// would force the first spine unit to edit a DPDP/CPRA guard mid-move. The
// stated goal of the delegation pass is that no spine unit edits a guard.
//
// So each surface is read as ITS OWN CODE PLUS the chassis file(s) it delegates
// to, by the one shared rule in ./chassis-delegation.mjs — one import, one
// level, the target on disk, AND the adapter actually referencing something the
// target declares that the adapter does not declare itself. A delegation this
// scan cannot follow is COVERAGE LOST, never silence.
//
// This only ever ADDS text, so every limb keeps its meaning: a surface that
// really has no `_acceptedTerms` anywhere still fails limb 1, and a marketing
// flag that gates the button still fails limb 3 wherever the gate is written.
// ─────────────────────────────────────────────────────────────────────────────

/** A surface's comment-stripped code UNIONED with the chassis file(s) it
 *  delegates to. `{ lost }` when the delegation cannot be followed. */
function readWithDelegation(rel) {
  const dg = resolveChassisDelegation(ROOT, rel, { describe: () => '' });
  if (dg && dg.lost) return { lost: dg.lost };
  const files = (dg && dg.files) || [];
  let code = read(rel);
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) {
      return { lost: `delegates to \`${f}\`, which is not on disk, so the consent flag is asserted NOWHERE.` };
    }
    code += `\n${read(f)}`;
  }
  return { code, files };
}

let scanned = 0;
let blocking = 0;

for (const s of SURFACES) {
  if (!existsSync(join(ROOT, s.file))) {
    coverageLost(
      `${s.file} is in the surface list and does not exist. A sign-up surface that ` +
        'moved without this list moving is a surface nothing checks; re-point the entry or remove it ' +
        'deliberately.',
    );
    continue;
  }
  const scan = readWithDelegation(s.file);
  if (scan.lost) {
    coverageLost(
      `${s.file} ${scan.lost} Limbs 1-3 read the surface PLUS whatever it delegates ` +
        'to, so a delegation this scan cannot follow is a consent flag it cannot see.',
    );
    continue;
  }
  if (scan.files.length) {
    console.log(`⬜ ${s.file} also read ${scan.files.length} chassis file(s) it delegates to — ${scan.files.join(', ')}`);
  }
  const code = scan.code;
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
  const disables = s.button
    ? new RegExp(`${s.button}(?:(?!onPressed)[^;])*?onPressed\\s*:${ONE_EXPRESSION}!${s.terms}\\b`).test(code)
    : new RegExp(`onPressed\\s*:[\\s\\S]{0,200}?!${s.terms}\\b`).test(code);
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
//
// 🔴 READ THROUGH THE DELEGATION, EXACTLY AS THE SURFACES ABOVE ARE, AND FOR
// THE SAME REASON. [ADR 071] emptied this widget into
// `package:nikatru_chassis_screens/auth/legal_consent_fields.dart` and left an
// adapter at the path below. Read at the adapter ALONE, this limb would ask
// whether a seventy-line forwarder declares `initialTermsAccepted:` — which it
// never will — while the constructor that actually renders the checkboxes sits
// one import away, unexamined. That is NOT the loud failure limb 1's path
// pinning would have been: it is a check that goes on printing ok about a file
// where the thing it forbids cannot occur. The union only ever ADDS text, so a
// real `initial…` on either side is still caught, and a delegation this scan
// cannot follow is COVERAGE LOST rather than silence.
for (const rel of WIDGETS) {
  if (!existsSync(join(ROOT, rel))) {
    coverageLost(`${rel} does not exist; the shared consent widget is the thing limb 1 relies on.`);
    continue;
  }
  const widgetScan = readWithDelegation(rel);
  if (widgetScan.lost) {
    coverageLost(
      `${rel} ${widgetScan.lost} The pre-tick check reads the widget PLUS whatever it ` +
        'delegates to, so a delegation this scan cannot follow is a constructor it cannot see — and the ' +
        'adapter it CAN see could never carry the parameter this limb forbids.',
    );
    continue;
  }
  if (widgetScan.files.length) {
    console.log(`⬜ ${rel} also read ${widgetScan.files.length} chassis file(s) it delegates to — ${widgetScan.files.join(', ')}`);
  }
  const code = widgetScan.code;
  if (/\binitial[A-Z]\w*\s*[:=]/.test(code)) {
    problems.push(
      `${rel} declares an \`initial…\` parameter. The consent state must live in the CALLER, where a ` +
        'declaration this guard can read decides it — an `initialTermsAccepted:` argument is a way to ' +
        'pre-tick a box without any field in this repository saying `true`.',
    );
  }
}

// ── limb 4 · EVERY APPLE DOOR RECORDS THE ACCEPTANCE BEFORE THE PROVIDER ──────
// ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP. See APPLE_DOORS for why limbs 1-3 could not.
let appleDoors = 0;
const doorFiles = new Set();
for (const d of APPLE_DOORS) {
  if (!existsSync(join(ROOT, d.file))) {
    coverageLost(`${d.file} is an Apple door on the list and does not exist.`);
    continue;
  }
  const scan = readWithDelegation(d.file);
  if (scan.lost) {
    coverageLost(`${d.file} ${scan.lost} Limb 4 reads the door PLUS what it delegates to.`);
    continue;
  }
  doorFiles.add(d.file);
  for (const f of scan.files) doorFiles.add(f);
  const code = scan.code;
  const call = d.provider.exec(code);
  if (!call) {
    problems.push(
      `${d.file}: no Sign in with Apple call (\`${d.provider.source}\`) found in the door or what it delegates to. ` +
        'The door this limb checks is gone or renamed; remove it from APPLE_DOORS deliberately if so.',
    );
    continue;
  }
  // The handler that makes the call: from the nearest preceding function
  // declaration to the call itself. The acceptance and its terms guard must
  // both sit inside that span, BEFORE the provider.
  const head = code.slice(0, call.index);
  const fnStart = Math.max(
    ...[...head.matchAll(/(?:Future<void>|void)\s+_\w+\s*\([^)]*\)\s*(?:async\s*)?\{/g)].map((m) => m.index),
    -1,
  );
  const span = fnStart < 0 ? '' : head.slice(fnStart);
  const accepted = d.accept.test(span);
  const guarded = /if\s*\([^)]*!_acceptedTerms\b[^)]*\)/.test(span);
  if (!accepted || !guarded) {
    problems.push(
      `🔴 APPLE ACCOUNT WITHOUT ACCEPTED TERMS — ${d.file}: the handler that calls Sign in with Apple ` +
        `${accepted ? '' : 'does NOT record the acceptance (' + d.accept.source + ') before it, and '}` +
        `${guarded ? '' : 'has NO early `if (… !_acceptedTerms …)` refusal ahead of it, and '}` +
        'so a first-time Apple sign-in can create an account the clickwrap never reached. The account may exist ' +
        'the instant the redirect returns, so the acceptance has to be on record before the call.',
    );
  } else if (!d.button.test(code)) {
    problems.push(
      `${d.file}: the Sign in with Apple button is not disabled on \`!_acceptedTerms\` (\`${d.button.source}\`). ` +
        'The refusal in the handler holds, but a live button that silently does nothing reads as a broken app — ' +
        'limb 2 asks both halves of every other clickwrap for the same reason.',
    );
  } else {
    appleDoors++;
  }
  for (const w of d.wiring ?? []) {
    if (!w.re.test(read(d.file))) problems.push(`${d.file}: ${w.what}.`);
  }
}

// Every call site belongs to a door — the count that limbs 1-3 never took.
function dartFilesUnder(rel, out = []) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const e of listDir(abs, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (['build', '.dart_tool', 'test', 'integration_test', 'android', 'ios', 'macos', 'windows', 'linux', 'web'].includes(e.name)) continue;
      dartFilesUnder(child, out);
    } else if (e.name.endsWith('.dart')) {
      out.push(child);
    }
  }
  return out;
}
const appleCallFiles = [];
for (const root of APPLE_SCAN_ROOTS) {
  for (const f of dartFilesUnder(root)) {
    if (APPLE_CALL.test(read(f))) appleCallFiles.push(f);
  }
}
if (appleCallFiles.length === 0) {
  coverageLost(
    'limb 4 found NO Sign in with Apple call site under ' +
      `${APPLE_SCAN_ROOTS.join(', ')}. Either the provider is gone everywhere (remove the limb deliberately) ` +
      'or this scan has stopped seeing it.',
  );
}
for (const f of appleCallFiles) {
  if (!doorFiles.has(f)) {
    problems.push(
      `🔴 UNLISTED APPLE DOOR — ${f} calls Sign in with Apple and is not in APPLE_DOORS. A door this guard does ` +
        'not know about is a door nobody checks for the clickwrap: add it, with the acceptance before the call.',
    );
  }
}

// ── coverage self-checks ─────────────────────────────────────────────────────
if (scanned < MIN_SURFACES) {
  coverageLost(
    `scanned ${scanned} sign-up surface(s), expected at least ${MIN_SURFACES}. ` +
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
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
}

ok(
  `signup consent shape — ${scanned} surface(s) scanned, every consent flag initialises to false, ` +
    `${blocking} terms tick(s) block in both positions, no optional consent gates a sign-up, ` +
    `${appleDoors} Sign in with Apple door(s) record the acceptance before the provider (${appleCallFiles.length} call-site file(s), all listed)`,
);
