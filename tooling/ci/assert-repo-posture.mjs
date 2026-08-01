#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-repo-posture.mjs — the repository's own legal posture, asserted.
//
// [pipeline K-12] "The repository's own legal posture is stated." Until this
// landed the root of a PUBLIC repository carried no SECURITY.md, no NOTICE.md
// and no statement of what a reader may do with the code — which is a posture,
// just an undeclared one that nobody could check.
//
// THREE LIMBS, and they are deliberately of different strengths. Saying so here
// is the point: a guard that presents its weakest check with the same confidence
// as its strongest one teaches people to trust the wrong line.
//
//   1. ONE CONTACT ADDRESS, three surfaces, EQUALITY.  ★ strongest
//      A security policy nobody can reach is worse than none, because it looks
//      like a channel. The address in SECURITY.md must EQUAL the address every
//      app compiles in (`AppConfig.supportEmail`) and the address published on
//      the contact page. Three files, written by three different kinds of work,
//      and before this nothing compared them.
//
//   2. NOTICE.md carries both posture tokens.  ☆ weakest — MARKED "+ human"
//      A token check proves a string is present, not that the surrounding
//      paragraph still means it. It is here because the two words are the
//      posture's name and deleting them is a real thing that happens in a
//      "tidy the docs" commit — not because it proves the posture is stated
//      well. Read the file; do not read this check as a substitute.
//
//   3. NO `LICENSE` FILE AT THE ROOT.  ★ the only irreversible one
//      No-LICENSE is what makes this tree all-rights-reserved. A licence grant
//      cannot be un-granted: deleting the file later does not retract it from
//      anyone who already cloned, and the file stays in the public history.
//      Every other decision this repo makes can be revised in a follow-up
//      commit; this one is planned for as though it cannot, so it is the one
//      assertion here that guards something with no undo.
//      Recorded failing input: `touch LICENSE` at the repo root → red.
//
// ⚠️ WHAT THIS DOES NOT DO. It does not read the prose. It cannot tell a
// SECURITY.md that describes a real process from one that describes a fictional
// one, and it makes no claim about whether the posture NOTICE.md states is the
// right posture — that is `master-requirements.md`'s decision, not this file's.
//
// Usage:  node tooling/ci/assert-repo-posture.mjs [repoRoot]
// Exit 0 = clean, 1 = the posture drifted or this scan lost its coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const repoRoot = resolve(process.argv[2] ?? process.cwd());

/** The chassis every stamped app inherits its identity from. This is the ONE
 *  place the support address is decided; every other surface is checked against
 *  it rather than against a constant written here — a second copy in a guard is
 *  a second source of truth, and the first one to be wrong after a change. */
const BRICK_APP_CONFIG = join(
  repoRoot,
  'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'core', 'app_config.dart',
);

/** The address a stranger with a security finding actually types. */
const CONTACT_PAGE = join(repoRoot, 'sites', 'nikatru', 'contact.html');

const SECURITY_MD = join(repoRoot, 'SECURITY.md');
const NOTICE_MD = join(repoRoot, 'NOTICE.md');

/** The two words that name the posture (`architecture.md` specified exactly
 *  this pair). Both, because either one alone is a different posture: "source-
 *  visible" without "not open-source" is what people assume means MIT. */
const POSTURE_TOKENS = ['source-visible', 'not open-source'];

/** Every spelling of a licence grant that tooling, GitHub and humans treat as
 *  one. GitHub's own licence detection reads LICENSE, LICENSE.md, LICENSE.txt,
 *  LICENCE, COPYING and COPYING.LESSER — so checking only `LICENSE` would let
 *  the grant land under a name that still shows up as a licence badge on the
 *  repository page. Matched case-INSENSITIVELY: the check-in that matters is
 *  `license` on a case-insensitive filesystem, which is most of them. */
const LICENCE_NAMES = [
  'license', 'licence', 'license.md', 'licence.md', 'license.txt', 'licence.txt',
  'license.rst', 'licence.rst', 'copying', 'copying.txt', 'copying.md',
  'copying.lesser', 'copyright',
];

const problems = [];

/** Comments, <script> and <style> removed, then tags. Kept deliberately small:
 *  this file needs "is the address on the page a visitor sees", not a renderer.
 *  ⚠️ It is a SECOND stripper — `check-site-integrity.mjs` has one — and that is
 *  a cost, not a feature. It is duplicated rather than imported because that file
 *  is a script that runs its whole scan on import; the day either grows past
 *  three replaces, extract it into a module and delete both. */
const visibleText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

const rel = (p) => relative(repoRoot, p).split(sep).join('/');

// ── COVERAGE, before anything else ───────────────────────────────────────────
// Each of the three inputs below is something this scan reads to decide the
// answer. An unreadable one is not "clean" — it is this guard grading a blank
// paper, and every one of these files has a plausible reason to move.
const brickSrc = read(BRICK_APP_CONFIG);
if (brickSrc === null) {
  console.error(`✗ COVERAGE LOST — cannot read ${rel(BRICK_APP_CONFIG)}.`);
  console.error('  That file is where the support address is DECIDED; without it every equality below');
  console.error('  compares two copies of nothing. The brick moved, or this guard was not told.');
  process.exit(1);
}
const canonical = brickSrc.match(/supportEmail\s*=\s*'([^']+)'/)?.[1];
if (!canonical) {
  console.error(`✗ COVERAGE LOST — ${rel(BRICK_APP_CONFIG)} declares no AppConfig.supportEmail.`);
  console.error('  Every app the factory stamps would ship with no support address, and the SECURITY.md');
  console.error('  equality below would have nothing to be equal to.');
  process.exit(1);
}

const securitySrc = read(SECURITY_MD);
const noticeSrc = read(NOTICE_MD);
if (securitySrc === null) problems.push('SECURITY.md is missing from the repository root. A public repo with no reporting channel routes every finding to a public issue.');
if (noticeSrc === null) problems.push('NOTICE.md is missing from the repository root. Nothing states what a reader may do with this code.');

// ── LIMB 1 · one contact address, three surfaces ─────────────────────────────
if (securitySrc !== null) {
  const named = [...new Set(securitySrc.match(EMAIL_RE) ?? [])];
  if (named.length === 0) {
    problems.push('SECURITY.md names no email address at all. It describes a process with no way to start it.');
  } else {
    const wrong = named.filter((e) => e !== canonical);
    if (wrong.length) {
      problems.push(
        `SECURITY.md names ${wrong.map((e) => JSON.stringify(e)).join(', ')}, and the address every app ` +
          `compiles in (AppConfig.supportEmail, ${rel(BRICK_APP_CONFIG)}) is ${JSON.stringify(canonical)}. ` +
          'A reporting address that is nearly right is a report that reaches nobody and looks delivered.',
      );
    }
  }
}

const contactSrc = read(CONTACT_PAGE);
if (contactSrc === null) {
  console.error(`✗ COVERAGE LOST — cannot read ${rel(CONTACT_PAGE)}, so "the address is published" was never checked.`);
  process.exit(1);
}
if (!visibleText(contactSrc).includes(canonical)) {
  problems.push(
    `${rel(CONTACT_PAGE)} does not show ${JSON.stringify(canonical)} in its visible text, and that is the ` +
      'address SECURITY.md and every stamped app send people to. The published contact page and the ' +
      'compiled-in one have forked.',
  );
}

// The same address, in every app that ships. `apps/*` rather than a named list,
// so app #2 is covered by existing, and an app that declares no support address
// fails rather than being skipped — the skip is how subly carried none at all
// while the brick carried one, and nothing could see the difference.
const appsDir = join(repoRoot, 'apps');
const appConfigs = [];
if (existsSync(appsDir)) {
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'build') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'app_config.dart') appConfigs.push(p);
    }
  };
  for (const e of readdirSync(appsDir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(appsDir, e.name));
  }
}
if (appConfigs.length === 0) {
  console.error('✗ COVERAGE LOST — no apps/*/**/app_config.dart was found, so "every app carries the address" ranged over nothing.');
  console.error('  Either the apps tree moved or this walk broke; an empty domain makes the check vacuously true.');
  process.exit(1);
}
for (const cfg of appConfigs) {
  const claimed = read(cfg)?.match(/supportEmail\s*=\s*'([^']+)'/)?.[1];
  if (!claimed) {
    problems.push(
      `${rel(cfg)} declares no supportEmail. The chassis has one (${JSON.stringify(canonical)}) and this ` +
        'app does not, so its users have no in-app route to the address SECURITY.md publishes.',
    );
  } else if (claimed !== canonical) {
    problems.push(
      `${rel(cfg)} compiles in ${JSON.stringify(claimed)} while the chassis publishes ${JSON.stringify(canonical)}. ` +
        'Two support addresses is one mailbox nobody reads.',
    );
  }
}

// ── LIMB 2 · the posture tokens (weakest limb, marked as such) ───────────────
if (noticeSrc !== null) {
  const missing = POSTURE_TOKENS.filter((t) => !noticeSrc.toLowerCase().includes(t));
  if (missing.length) {
    problems.push(
      `NOTICE.md no longer says ${missing.map((t) => JSON.stringify(t)).join(' or ')}. Those two words ARE the ` +
        'posture: source-visible without "not open-source" is what a reader assumes means MIT. ' +
        '(This is the weakest check in this guard — it proves the words are present, not that the ' +
        'paragraph around them still means them. A human reads NOTICE.md; this only stops it vanishing.)',
    );
  }
}

// ── LIMB 3 · no LICENSE at the root — the irreversible one ──────────────────
let rootEntries;
try {
  rootEntries = readdirSync(repoRoot, { withFileTypes: true });
} catch {
  console.error(`✗ COVERAGE LOST — cannot list ${repoRoot}, so the no-LICENSE check ran over nothing.`);
  process.exit(1);
}
const licences = rootEntries
  .filter((e) => !e.isDirectory() && LICENCE_NAMES.includes(e.name.toLowerCase()))
  .map((e) => e.name);
if (licences.length) {
  problems.push(
    `${licences.join(', ')} exists at the repository root. NO-LICENCE IS THE POSTURE — it is what makes this ` +
      'tree all-rights-reserved, and it is the one decision here with no undo: deleting the file in a later ' +
      'commit does not retract the grant from anyone who already cloned, and the file stays in the public ' +
      'history. If the owner has decided to licence the repository, that decision changes THIS GUARD, in the ' +
      'same commit, on purpose. ("Repo stays PUBLIC, no LICENSE" — master-requirements.md.)',
  );
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ repo posture — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-12] The repository states its own legal posture, and the statement is checked');
  console.error('  rather than trusted. See NOTICE.md and SECURITY.md.');
  process.exit(1);
}

console.log(
  `ok  repo posture — SECURITY.md, NOTICE.md and ${appConfigs.length} app config(s) all name ${canonical}; ` +
    `both posture tokens present; no LICENCE grant at the root (${rootEntries.length} root entries scanned)`,
);
