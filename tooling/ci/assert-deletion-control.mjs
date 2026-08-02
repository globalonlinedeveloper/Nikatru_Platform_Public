#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deletion-control.mjs — AN APP WITH ACCOUNTS SHIPS A DELETION CONTROL.
//
// [ADR 027] Both stores require an in-app path to account deletion wherever an
// account can be created at all. It cannot be left to a support email, and it
// cannot be left to the next app.
//
// ── THE HOLE THIS EXISTS FOR, AND WHY NOTHING ELSE COVERED IT ────────────────
// `assert-stamp-properties.mjs` already enforces `account-deletion-works` — for
// THE BRICK AND EVERY STAMPED APP. Its domain carries `EXEMPT_APPS =
// {'apps/subly'}`, correctly: Subly predates the brick, was never stamped, and
// has no inherited property test to keep. The consequence went unnoticed for
// months — THE ONLY APP IN THE FIELD was the one app no deletion guard reached.
// It shipped with `deleteAccount()` an unconditional throw and no control at
// all, and `sites/nikatru/delete-account.html` had to scope its own sentence
// ("where an app shows a Delete account control") around that absence.
//
// So this guard asks the STORE'S question instead of the chassis's, over a
// domain with NO exemptions: not "did this app keep its inherited property
// test", which only a stamped app can answer, but "can a user of this app
// delete their account from inside it". Subly answers that today; so does the
// brick; so will app #2, whether or not it was stamped.
//
// ── WHAT IS CHECKED, AND WHY EACH LIMB CAN FAIL ─────────────────────────────
// For every root whose code HAS ACCOUNTS (derived — see below):
//
//   1. A CALL SITE, not a declaration. `.deleteAccount(` with the leading dot,
//      in comment-stripped source. `assert-seams-wired.mjs` shipped with its
//      caller check matching the function's own DECLARATION, so deleting every
//      real caller still passed and all six of its fixture tests were green.
//      A declaration reads `Future<void> deleteAccount() async`; a call reads
//      `auth.deleteAccount()`.
//   2. IN SETTINGS. Both stores' reviewers look in the app's settings; a call
//      site buried in a service nothing renders is the dead-seam shape again.
//   3. BEHIND A CONFIRMATION THAT CANNOT MISFIRE. The settings tree must open a
//      dialog AND re-authenticate — deletion is irreversible, so a borrowed or
//      unattended device must not be enough to destroy an account.
//   4. AND IT MUST NOT COLLAPSE THE OUTCOMES. `DELETE /v1/account` answers 501
//      (nothing was deleted) and 502 (the rows are gone and the login still
//      works). A `catch (_)` printing one message tells a user whose data is
//      already destroyed that nothing happened — the one failure they cannot
//      discover for themselves. The failure path must reach
//      `accountDeletionOutcomeOf`, which is the chassis's classifier.
//   5. THE SERVER HOOK IS NOT NULLED. `requestServerDeletion: null` makes every
//      limb above pass against a flow that can only ever refuse. That is not
//      hypothetical: it is exactly what the brick shipped until [pipeline C-15].
//
// ── THE DOMAIN, AND THE FILTER THAT IS NOT AN EXCUSE ────────────────────────
// Roots = the brick's app template PLUS every `apps/*` on the root
// `pubspec.yaml` `workspace:` list. A directory listing is refused for the
// reason assert-app-dod.mjs states: the brick lane stamps `apps/probe` and never
// removes it, so a listing differs between this box and CI. NO app is exempt.
//
// "Has accounts" is DERIVED from the app's own code — it programs against
// `AuthRepository` and calls `signInWithEmail(`. An app that genuinely offers no
// account owes no deletion control, and saying so from the tree rather than from
// a list is what stops the filter becoming a waiver somebody adds themselves to.
// Every root's verdict PRINTS, so an app quietly judged account-free is visible.
//
// Usage:  node tooling/ci/assert-deletion-control.mjs [repoRoot]
// Exit 0 = every account-bearing app can be deleted from inside itself.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
/** Where a store reviewer looks, and therefore where the control must be. */
const SETTINGS_DIR = 'lib/features/settings';

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

/** Every .dart file under `dir`, comment-stripped and concatenated. */
const readDartTree = (dir) => {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) {
        out.push(stripSourceComments(readFileSync(p, 'utf8'), '.dart'));
      }
    }
  };
  walk(dir);
  return out.join('\n');
};

// ── the roots ───────────────────────────────────────────────────────────────
const roots = [];
if (existsSync(join(ROOT, BRICK))) roots.push(BRICK);
let workspaceRead = false;
try {
  const lines = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8')
    .replace(/^\s*#.*$/gm, '')
    .split('\n');
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
    'The set of apps this guard ranges over would then be the brick alone — and the brick was never the',
    'problem. The app that shipped with no deletion control is the one that lives under apps/.',
  ]);
}
// The brick plus at least one real app. Below that the domain has collapsed to
// the template, which is the exact blind spot that let the only shipping app go
// unchecked — and an empty-domain scan prints ok, this repo's most repeated
// failure.
if (roots.length < 2) {
  coverageLost([
    `only ${roots.length} root(s) resolved (${roots.join(', ') || 'none'}).`,
    'Expected the brick app template AND at least one apps/* workspace member. A guard over the template',
    'alone re-creates the hole it was written to close.',
  ]);
}

// ── the check ───────────────────────────────────────────────────────────────
let withAccounts = 0;

for (const root of roots) {
  const lib = join(ROOT, root, 'lib');
  const src = readDartTree(lib);
  if (src.trim().length === 0) {
    coverageLost([
      `no Dart source was read under ${root}/lib.`,
      'Every limb below reads that tree, and a predicate over an empty string answers "no accounts here"',
      'for reasons that have nothing to do with the app. A scan over nothing prints ok.',
    ]);
  }

  // DERIVED, never declared: the app programs against the auth seam AND has a
  // way in. Both limbs, because a file that merely mentions the type could be a
  // leftover import, while `signInWithEmail(` is the door an account comes
  // through.
  const hasAuthSeam = /\bAuthRepository\b/.test(src);
  const hasSignIn = src.includes('signInWithEmail(');
  if (!hasAuthSeam || !hasSignIn) {
    notes.push(
      `⬜ ${root} — no account surface (AuthRepository: ${hasAuthSeam}, signInWithEmail: ${hasSignIn}); ` +
        'no deletion control is owed. Derived from the app\'s own code, not from a list.',
    );
    continue;
  }
  withAccounts++;

  const settings = readDartTree(join(ROOT, root, SETTINGS_DIR));
  if (settings.trim().length === 0) {
    problems.push(
      `${root} offers accounts and has NO ${SETTINGS_DIR}/. Both stores' reviewers look for the deletion ` +
        'control in settings, so an app with accounts and no settings screen has nowhere to put one.',
    );
    continue;
  }

  // 1 + 2 — a CALL SITE, and it is in settings.
  if (!settings.includes('.deleteAccount(')) {
    problems.push(
      `${root}: no \`.deleteAccount(\` CALL SITE in ${SETTINGS_DIR}/. Both stores require an in-app ` +
        'deletion path wherever an account can be created. (The leading dot is the check: a declaration ' +
        'reads `Future<void> deleteAccount() async` and would match a screen that calls nothing.)',
    );
  }

  // 3 — a confirmation that cannot be triggered by accident.
  if (!settings.includes('showDialog')) {
    problems.push(
      `${root}: the deletion control in ${SETTINGS_DIR}/ opens no dialog. An irreversible action one tap ` +
        'away is the misfire a confirmation step exists to stop.',
    );
  }
  if (!settings.includes('signInWithEmail(')) {
    problems.push(
      `${root}: the deletion flow in ${SETTINGS_DIR}/ does not RE-AUTHENTICATE. Deletion is irreversible, ` +
        'so a borrowed or unattended device must not be enough to destroy an account.',
    );
  }

  // 4 — the outcomes must not collapse.
  if (!settings.includes('accountDeletionOutcomeOf(')) {
    problems.push(
      `${root}: the deletion failure path in ${SETTINGS_DIR}/ never reaches ` +
        '`accountDeletionOutcomeOf`, so every refusal shares one message. DELETE /v1/account answers 501 ' +
        '(nothing was deleted) and 502 (the data is gone and the login still works) — telling a user ' +
        'whose data is already destroyed that nothing happened is the one failure they cannot detect.',
    );
  }

  // 5 — and the server hook is not nulled out from under all of it.
  if (/requestServerDeletion:\s*null/.test(src)) {
    problems.push(
      `${root}: \`requestServerDeletion: null\` is wired. Every limb above then passes against a flow ` +
        'that can only ever refuse — the user is signed out and never deleted, which is what the brick ' +
        'shipped until [pipeline C-15].',
    );
  }
}

// The account-bearing set cannot be empty either. If every root were judged
// account-free, all five limbs above would be skipped and this guard would
// print a clean pass over nothing at all.
if (withAccounts === 0) {
  coverageLost([
    `not one of the ${roots.length} root(s) was judged to offer accounts.`,
    'Every assertion in this guard is gated on that judgement, so a pass here would mean the scan stopped',
    'recognising an account surface — not that no app has one.',
  ]);
}

if (problems.length) {
  console.error(`✗ assert-deletion-control — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [ADR 027] An app that lets a person create an account must let them delete it from');
  console.error('  inside the app, and must tell them what actually happened when they try.');
  process.exit(1);
}

for (const n of notes) console.log(n);
console.log(
  `ok  deletion control — ${withAccounts} of ${roots.length} root(s) offer accounts and every one of them ` +
    `ships a confirmed, honestly-reported in-app deletion path (${roots.join(', ')})`,
);
