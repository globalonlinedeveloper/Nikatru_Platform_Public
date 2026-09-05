#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-captcha-gated-call-sites.mjs — EVERY CALL TO A CAPTCHA-GATED AUTH
// ENDPOINT MUST CARRY A CAPTCHA TOKEN, AND THE SURFACE THAT MAKES ONE MUST BE ON
// THE SAME SCREEN.
//
// [pipeline C-6] — the measured false-green, 2026-09-04.
//
// ── THE DEFECT, MEASURED ────────────────────────────────────────────────────
// `apps/subly/lib/features/settings/settings_screen.dart` re-authenticated
// the user before deleting their account:
//
//     await auth.signInWithEmail(email: user.email, password: password);
//
// No `captchaToken:`. That call reaches `token?grant_type=password`, which is
// one of the six endpoints Cloudflare Turnstile gates on Box A (auth-cutover.md
// §4.7). `turnstile_gate.dart` is imported by `login_screen.dart`,
// `sign_up_screen.dart` and `verify_email_screen.dart`; `settings_screen.dart`
// does not appear in that set at all.
//
// 🔴 SO AFTER THE CUTOVER A REAL USER CANNOT DELETE THEIR ACCOUNT FROM INSIDE
// THE APP, and it fails TOTALLY rather than partially: `settings_screen.dart`
// puts `deleteAccount()` BELOW the reauth on purpose, so a refused reauth means
// the deletion never runs. That is the DPDP/GDPR erasure path, which makes this
// the worst consequence of the set and not merely another instance of it.
//
// ── WHY NO EXISTING CHECK SEES IT, WHICH IS THE PROPERTY THIS GUARD FIXES ────
// The affected surfaces were enumerated BY PROVIDER METHOD, off
// `packages/core/lib/src/auth/auth_repository.dart`: `signInWithEmail`,
// `signUpWithEmail`, `sendPasswordReset`, `resendVerificationEmail`. Four
// methods, four screens, and the list reads complete.
//
// The delete dialog is a FIFTH SURFACE REUSING THE FIRST METHOD. A method-shaped
// list cannot represent it — there is no fifth row for it to be missing from. So
// this guard enumerates CALL SITES, which is the only shape in which the defect
// is expressible at all.
//
// ── WHAT IS DERIVED RATHER THAN WRITTEN DOWN ────────────────────────────────
// The gated method set is NOT a list in this file. It is read out of the
// repository interface: A METHOD THAT ACCEPTS A `captchaToken` IS A METHOD WHOSE
// ENDPOINT IS GATED — that parameter exists for no other reason, and
// `auth_repository.dart:51` says so in its own words ("`captchaToken` IS THE
// SEAM FOR A GATE…"). Add a fifth gated method tomorrow and this guard covers it
// the moment the parameter lands, with no edit here. A written list would have
// to be remembered, and this repository's recurring defect is precisely the
// check that silently stopped checking.
//
// ── THE TWO LIMBS, AND WHY ONE IS NOT ENOUGH ────────────────────────────────
// R1  every call site passes a `captchaToken:` argument.
// R2  the FILE holding such a call site also mounts `TurnstileGate`.
//
// R1 alone is satisfied by `captchaToken: null` — the argument is present and
// buys nothing — and by a token threaded in from a screen that never rendered a
// challenge. R2 alone is satisfied by importing the widget and then not passing
// what it produces, which is the dead-seam shape [pipeline C-6] names. Together
// they say: a challenge was rendered HERE, and its answer went to THIS call.
//
// ⚠️ THE HONEST LIMIT, STATED SO IT IS NOT DISCOVERED LATER. `captchaToken:
// _captchaToken` is accepted, and `_captchaToken` is a `String?` that IS null
// until the widget calls back. This guard cannot prove a token was non-null at
// the moment of the call — that is a runtime property and no static check
// reaches it. What it proves is that the wire EXISTS: a call with nowhere to
// receive a token from cannot ever succeed against the gate, and that is the
// defect actually found. The literal `null` is refused explicitly, because that
// is the one spelling that is knowably useless.
//
// ── THE BRICK IS REPORTED, NOT FAILED, AND THAT IS A RULE NOT A CONCESSION ───
// `tooling/bricks/app/__brick__/apps/{{app_id}}` carries FIVE gated call sites
// and mentions `TurnstileGate` ZERO times — Turnstile was never propagated to
// the chassis, so every future stamped app inherits an ungated auth surface.
// Failing the build on that would block every unrelated change until an
// owner-sized piece of work lands, and CLAUDE.md's verification discipline gives
// the rule for exactly this shape: "A fail-closed seam with no proven open path
// is a dead feature that reports healthy. When the on-switch is owner-gated, the
// guard must PRINT the gap every run rather than fail the build."
//
// 🔴 AND THE PRINT IS NOT A PERMANENT EXEMPTION — it arms itself. A root is
// governed by R1/R2 as soon as it mentions `TurnstileGate` anywhere. The day
// somebody adds the widget to the brick, the five call sites below start failing
// without anybody editing this file. That is the opposite of an allowlist: the
// exemption is a MEASURED property of the tree that expires on its own.
//
// ── COVERAGE, BECAUSE A SCANNER THAT SCANS NOTHING PRINTS PERFECTLY ─────────
// C1 the gated set derived from the interface is non-empty.
// C2 the comment strip actually reduced — `stripSourceComments` returns its
//    input UNCHANGED for an extension it does not know, so a scanner over
//    unreduced source reads doc comments as code. `.dart` is in its map today;
//    this asserts it rather than trusting it, the same way
//    assert-android-target-sdk.mjs does after `.kts` was silently an identity.
// C3 REQUIRED_COVERAGE names the two roots literally, so a glob that stops
//    matching is COVERAGE LOST rather than "0 problems".
// C4 at least one call site is found overall.
// C5 every argument list extracted is PAREN-BALANCED. An unbalanced read is
//    refused loudly instead of being scored, because a mis-parsed call list
//    silently satisfies R1.
//
// ⚠️ TWO OF THE EIGHT TEXTUAL HITS IN apps/subly ARE DOC COMMENTS —
// `check_inbox_screen.dart:28` and `login_screen.dart:235` both mention a gated
// method in prose. A grep-shaped version of this guard reports two violations
// that do not exist, which is why the reduction is mandatory and not tidy.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { delegationOf as resolveChassisDelegation } from './chassis-delegation.mjs';

// argv[2] overrides the tree, so the negative tests can mutate a COPY of the
// real tree instead of the checkout. 🔴 THE COPY IS `git init`-ed BY THE TEST
// RATHER THAN ENUMERATED SOME OTHER WAY, on purpose: a guard that finds its
// files one way in CI and another way under test is not the thing the test
// passed. One enumeration, both callers.
const REPO = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The interface the gated set is READ OUT OF, never copied from. */
const INTERFACE = 'packages/core/lib/src/auth/auth_repository.dart';

/** The widget that renders the challenge and hands back a token. */
const WIDGET = 'TurnstileGate';

const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';

// Named literally, so a pathspec that stops matching is COVERAGE LOST rather
// than a clean run over an empty set.
const REQUIRED_COVERAGE = [
  { root: 'apps/subly/lib', label: 'the flagship app — the only app that exists today, and the one carrying the defect' },
  { root: BRICK_LIB, label: 'the chassis every future app is stamped from — five gated call sites, no Turnstile' },
];

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`    ${d}`);
  process.exit(1);
};

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Comments blanked, then string literals blanked. Both preserve byte offsets,
 *  so line numbers below are the line numbers a reader will see. */
function reduce(source) {
  return stripStringLiterals(stripSourceComments(source, '.dart'));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The argument list of the call whose `(` is at `open`, or null if the parens
 *  do not balance. Strings and comments are already blank, so a paren inside
 *  either cannot reach this scan. */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// ── C1 · the gated set, derived ─────────────────────────────────────────────
let interfaceSrc;
try {
  interfaceSrc = readFileSync(join(REPO, INTERFACE), 'utf8');
} catch {
  coverageLost(`the auth interface is not at ${INTERFACE}`, 'The gated method set is derived from it; without it this guard checks nothing.');
}

const interfaceCode = reduce(interfaceSrc);
if (interfaceCode === interfaceSrc) {
  coverageLost(
    'the comment strip returned the interface UNCHANGED',
    'stripSourceComments is an identity function for an extension it does not know.',
    "If `.dart` left COMMENT_STYLES, every check below would be reading prose as code.",
  );
}

// ⚠️ A KEYWORD IS NOT A METHOD NAME, AND `identifier(` CANNOT TELL THEM APART.
// Nothing in the interface wraps `captchaToken` in an `if (…)` today, so the
// derived set is the four methods either way — but the day somebody writes
// `if (captchaToken != null)` in a default body, `if` would join GATED and every
// `if (` in every app would become a call site owing a token. That fails LOUDLY
// rather than passing quietly, which is the right direction, and it is still a
// confusing hour for whoever hits it. Excluded here instead.
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'assert', 'await', 'yield', 'super', 'this',
]);

// A declaration is `Future<…> name(… captchaToken …)`. Take the name of every
// method whose own parameter list mentions the seam.
const GATED = new Set();
for (const m of interfaceCode.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
  if (NOT_A_CALL.has(m[1])) continue;
  const args = argsAt(interfaceCode, m.index + m[0].length - 1);
  if (args === null) continue;
  if (/\bcaptchaToken\b/.test(args)) GATED.add(m[1]);
}
if (GATED.size === 0) {
  coverageLost(
    `no method in ${INTERFACE} declares a \`captchaToken\` parameter`,
    'That parameter IS the definition of "gated" here. An empty set makes every',
    'assertion below vacuous, so this is a failure and not a clean tree.',
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — A GATED CALL SITE FOLLOWS ITS SCREEN INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2; the same resolver assert-a11y-coverage.mjs carries)
//
// Every root here is a DIRECTORY, and that is the whole exposure. [ADR 066]
// step 4 empties a brick screen into `package:nikatru_chassis_screens`; the
// `signInWithEmail(` call and the `TurnstileGate` mount go with the body, and
// `packages/chassis_screens` is not one of the roots below. The call site does
// not fail this guard — it LEAVES it, which is worse, because the root then
// looks compliant for having nothing in it.
//
// So each root's file set gains the chassis files that root delegates to. The
// file label stays the real package path, so a finding sends the reader where
// the code is. This only ever ADDS files to a scan.
//
// ONE LEVEL, ONE IMPORT, EVERY REFUSAL LOUD — an ambiguous or unresolvable
// delegation is COVERAGE LOST, never a quiet fall-back to the adapter alone.
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE RULE IS NOT WRITTEN OUT AGAIN HERE. It lives in
// ./chassis-delegation.mjs — one import, one level, the target must be on
// disk, AND THE ADAPTER MUST ACTUALLY USE SOMETHING THE TARGET DECLARES.
// It shipped as eleven near-copies on 2026-09-05 and a review measured seven
// distinct implementations of the same paragraph with nothing in the tree
// comparing them; the module is that finding repaired, and the use check is
// the half whose absence let ONE UNUSED IMPORT silence a DPDP withdrawal
// control and a caps gate. `null` (no delegation) and `{ lost }` (one this
// scan could not follow) stay DIFFERENT ANSWERS: everything below reports
// `lost` as COVERAGE LOST and nothing reads it as "nothing to do".
/** The chassis file(s) a repo-relative file delegates to, resolved ONE level.
 *  `null` = none · `{ lost }` = could not be followed · `{ files }`. */
const delegationOf = (rel) => resolveChassisDelegation(REPO, rel, { describe: (r) => r });

// ── the roots ───────────────────────────────────────────────────────────────
const tracked = git('ls-files', '--', '*.dart').split('\n').filter(Boolean);

const appRoots = [...new Set(
  tracked
    .filter((p) => /^apps\/[^/]+\/lib\//.test(p))
    .map((p) => p.split('/').slice(0, 2).join('/') + '/lib'),
)];
const roots = [...appRoots, BRICK_LIB];

for (const { root, label } of REQUIRED_COVERAGE) {
  if (!roots.includes(root)) {
    coverageLost(`REQUIRED_COVERAGE names ${root} and the scan did not reach it`, label);
  }
  if (!tracked.some((p) => p.startsWith(`${root}/`))) {
    coverageLost(`${root} yielded no tracked .dart files`, label, 'A root that is invisible reads exactly like a root that is compliant.');
  }
}

// ── the scan ────────────────────────────────────────────────────────────────
const problems = [];
const ownerPrints = [];
let callSitesFound = 0;
const perRoot = [];

for (const root of roots) {
  const files = tracked.filter((p) => p.startsWith(`${root}/`));
  const read = new Map();
  for (const f of files) read.set(f, reduce(readFileSync(join(REPO, f), 'utf8')));

  // The chassis files this root delegates to are scanned WITH it — see the
  // resolver above. Keyed by their real package path so every line printed
  // below sends the reader to the file the call is actually in.
  const delegatedHere = [];
  for (const f of files) {
    const dg = delegationOf(f);
    if (dg && dg.lost) {
      coverageLost(
        `a chassis delegation could not be followed: ${dg.lost}`,
        'The gated call sites move into the package with the screen body, so a delegation this scan',
        'cannot follow is a call site it cannot see — and a root with nothing in it reads as compliant.',
      );
    }
    for (const t of (dg && dg.files) || []) {
      if (read.has(t)) continue;
      read.set(t, reduce(readFileSync(join(REPO, t), 'utf8')));
      delegatedHere.push(t);
    }
  }
  if (delegatedHere.length) {
    console.log(
      `⬜ ${root} — also scanned ${delegatedHere.length} chassis file(s) it delegates to: ` +
        `${delegatedHere.sort().join(', ')}`,
    );
  }

  // A root is GOVERNED once it mounts the widget anywhere. Nothing here is an
  // allowlist: this is measured, and it arms itself the day the widget lands.
  const adopted = [...read.values()].some((code) => new RegExp(`\\b${WIDGET}\\b`).test(code));

  const sites = [];
  for (const [file, code] of read) {
    for (const m of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (!GATED.has(m[1])) continue;
      const open = m.index + m[0].length - 1;
      const args = argsAt(code, open);
      if (args === null) {
        // C5 — never score a call we could not read.
        coverageLost(
          `unbalanced parentheses reading the arguments of ${m[1]}( at ${file}:${lineOf(code, open)}`,
          'A mis-parsed argument list silently satisfies the captchaToken check.',
          'Refused rather than scored.',
        );
      }
      const tokenArg = /\bcaptchaToken\s*:\s*([^,]*)/.exec(args);
      const passed = tokenArg !== null && tokenArg[1].trim() !== '' && tokenArg[1].trim() !== 'null';
      sites.push({ file, line: lineOf(code, open), method: m[1], passed, mountsWidget: new RegExp(`\\b${WIDGET}\\b`).test(code) });
      callSitesFound++;
    }
  }

  perRoot.push({ root, adopted, sites });

  if (!adopted) {
    if (sites.length) {
      ownerPrints.push(
        `👤 OWNER ${root} has ${sites.length} captcha-gated call site(s) and mounts ${WIDGET} ZERO times, so none of ` +
          `them can answer a challenge: ${sites.map((s) => `${s.file.slice(root.length + 1)}:${s.line} ${s.method}`).join(', ')}. ` +
          'PRINTED, NOT FAILED — Turnstile has not been propagated to this tree, and failing here would block every ' +
          'unrelated change behind owner-sized work (CLAUDE.md: an owner-gated on-switch PRINTS the gap every run). ' +
          `This is not an exemption: add ${WIDGET} anywhere under this root and every line above starts failing, ` +
          'with no edit to the guard.',
      );
    }
    continue;
  }

  for (const s of sites) {
    if (!s.passed) {
      problems.push(
        `${s.file}:${s.line} calls ${s.method}( with no usable \`captchaToken:\` argument, in a tree that HAS adopted ` +
          `${WIDGET}. That endpoint is gated, so this call is refused with \`captcha_failed\` before its credentials ` +
          'are even read.',
      );
      continue;
    }
    if (!s.mountsWidget) {
      problems.push(
        `${s.file}:${s.line} passes a \`captchaToken:\` to ${s.method}( but this file never mounts ${WIDGET}, so no ` +
          'challenge was rendered on this surface and the token has no audited source. A token threaded in from ' +
          'elsewhere is the dead-seam shape, not a gate.',
      );
    }
  }
}

// ── C4 ──────────────────────────────────────────────────────────────────────
if (callSitesFound === 0) {
  coverageLost(
    'the scan found ZERO captcha-gated call sites across every root',
    `Derived gated methods: ${[...GATED].join(', ')}.`,
    'Zero call sites means the matcher stopped matching, not that the tree is clean.',
  );
}

for (const p of ownerPrints) console.log(p);

console.log(
  `note the gated set is DERIVED, not written: ${GATED.size} method(s) in ${INTERFACE} declare a \`captchaToken\` ` +
    `parameter (${[...GATED].sort().join(', ')}). Add a fifth and it is covered the moment the parameter lands.`,
);
console.log(
  'note this proves the WIRE, not the runtime value. `captchaToken: _captchaToken` is accepted even though that ' +
    'field is null until the widget calls back — no static check reaches a runtime value. The literal `null` is ' +
    'refused, because it is the one spelling that is knowably useless.',
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  A gated endpoint called without a token is refused BEFORE the credentials are read, so the');
  console.error('  surface stops working entirely rather than degrading. The measured instance was account');
  console.error('  DELETION (settings_screen.dart re-authenticates first and deletes second), which makes the');
  console.error('  DPDP/GDPR erasure path the thing that breaks. Render TurnstileGate on the surface and pass');
  console.error('  what it produces — do not add an exemption here.');
  console.error('\nassert-captcha-gated-call-sites: FAILED');
  process.exitCode = 1;
} else {
  for (const { root, adopted, sites } of perRoot) {
    console.log(
      adopted
        ? `ok   ${root} — adopted ${WIDGET}; all ${sites.length} captcha-gated call site(s) pass a token from a file that mounts it`
        : `ok   ${root} — ${sites.length} gated call site(s), ${WIDGET} not adopted in this tree (reported above, arms itself)`,
    );
  }
  console.log('\nassert-captcha-gated-call-sites: ok');
}
