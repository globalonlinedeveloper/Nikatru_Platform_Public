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
//   · apps/subly/lib/features/consent/consent_prompt.dart:70 is a caller.
//   · apps/subly/lib/features/settings/settings_screen.dart:197 is another.
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
  const declaresRail = libFiles.some((f) => DECLARES.test(f.body));
  if (!declaresRail) {
    notes.push(`note ${root} declares no ${RECORD} — no analytics rail, so no withdrawal surface is owed (derived from ${libFiles.length} lib/ file(s), not from a list).`);
    continue;
  }
  railBearing++;

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
    if (DECLARES.test(f.body)) {
      problems.push(
        `${root}/${f.rel} DECLARES ${RECORD}. Moving the declaration into the settings tree would make limb 1 ` +
          'satisfied by the function\'s own signature — the precise defect assert-seams-wired.mjs shipped with, ' +
          'which all six of its fixture tests passed against.',
      );
      continue;
    }
    for (const c of callArgs(f.body, RECORD)) calls.push({ file: `${root}/${f.rel}`, args: c.args });
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

  notes.push(
    `ok   ${root} — ${calls.length} withdrawal call site(s) in ${SETTINGS_DIR} across ${settingsFiles.length} file(s); ` +
      `granted: ${grantedArgs.map((g) => (g.granted ?? '(none)')).join(' · ')}`,
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
if (settingsCallsFound === 0 && problems.length === 0) {
  coverageLost([
    'zero settings call sites were found AND no problem was recorded — the two cannot both be true.',
    'That combination means the call matcher stopped matching rather than the rows being present.',
  ]);
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
  console.log('\nassert-consent-withdrawal-surface: ok');
}
