#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-clone-tells.mjs — shared code must not know which app it is in.
//
// [pipeline C-10] "Shared code carries no app-specific vocabulary."
//
// Named by C-10 as its enforcement; marked VERIFIED while it did not exist.
// The moment shared code says "if this is Subly…", it stops being shared: app #2
// inherits a rule about a product it is not, and app #50 inherits it fifty times.
// It is also the tell a store reviewer reads as "these are the same app".
//
// 🔴 COMMENTS ARE EXEMPT, CODE IS SCANNED — and that is not a loophole, it is the
// difference between a guard that survives and one that gets switched off. Real
// measurement 2026-07-28: shared code mentions "Subly" EIGHT times and every
// single one is a comment, including one that records that a hardcoded 'subly'
// value WAS found and removed. Scanning comments would fire 8 false alarms on
// day one, all correct-as-written; a guard that cries wolf is disabled within a
// week, and then you believe you are protected when you are not.
//
// The app names are DERIVED from apps/ on disk, never typed here — a hand-kept
// list would go stale the first time an app is added, and go stale silently.
//
// LIMB 3 ("the brick's seed_hex default must not equal a live app's brand
// colour") is NOT IMPLEMENTED, and the reason is recorded rather than hidden:
// its premise is false. `tooling/bricks/app/brick.yaml` declares seed_hex as a
// PROMPT with type/description/prompt and NO `default:` — so there is no default
// value that could collide with anything. Verified 2026-07-28. The real issue in
// that area is that `AppThemeX.light/.dark` are compile-time constants holding
// Subly's brand values, which is [2]C-11's fix (the seed must drive what is
// painted), not a vocabulary problem. Recorded as SUPERSEDED BY FACTS.
//
// Checks:
//   1. coverage self-check — apps were found, and shared source was scanned
//   2. no app name appears in shared CODE (comments stripped first)
//   3. no banned domain noun appears in shared CODE, from a list that must exist
//      and must NOT be empty — an empty list passes everything, silently, forever
//
// Usage:  node tooling/ci/assert-no-clone-tells.mjs [repoRoot]
// Exit 0 = shared code is app-neutral, 1 = a clone tell leaked in.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');

const MIN_APPS = 1;
const MIN_SCANNED = 10;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 1. the app names, derived from disk ──────────────────────────────────────
let appNames = [];
try {
  appNames = listDir(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    // `probe` is the stamped fixture the app_brick lane creates; it is also an
    // ordinary English word that appears legitimately in shared code, so matching
    // it would be noise rather than signal.
    .filter((n) => n !== 'probe');
} catch { /* handled by the floor below */ }

if (appNames.length < MIN_APPS) {
  fail([
    `✗ COVERAGE LOST — found ${appNames.length} app(s) under apps/, expected at least ${MIN_APPS}.`,
    '  A clone-tell check with no app names to look for reports a clean tree forever.',
  ]);
}

// ── the banned domain vocabulary, from the register ──────────────────────────
let register = {};
if (existsSync(REGISTER)) {
  try {
    register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  } catch (err) {
    fail([`✗ capability register is not valid JSON: ${err.message}`]);
  }
}
const domainNouns = register.cloneTells?.domainNouns;
if (!Array.isArray(domainNouns) || domainNouns.length === 0) {
  fail([
    '✗ COVERAGE LOST — tooling/capability-register.json has no non-empty `cloneTells.domainNouns`.',
    '  [C-10] limb 2 would range over an empty set and pass everything, forever. An assertion',
    '  that cannot fail is worse than none: it inflates apparent coverage. Declare the list.',
  ]);
}

// ── what counts as shared code ───────────────────────────────────────────────
function dartFiles(absDir, rel, out) {
  let entries;
  try {
    entries = listDir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(absDir, e.name);
    const r = posix.join(rel, e.name);
    if (e.isDirectory()) dartFiles(abs, r, out);
    else if (e.name.endsWith('.dart')) out.push(r);
  }
}
const sharedFiles = [];
for (const pkg of (() => {
  try {
    return listDir(join(ROOT, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
})()) {
  dartFiles(join(ROOT, 'packages', pkg.name, 'lib'), `packages/${pkg.name}/lib`, sharedFiles);
}
dartFiles(join(ROOT, 'tooling', 'bricks'), 'tooling/bricks', sharedFiles);

if (sharedFiles.length < MIN_SCANNED) {
  fail([
    `✗ COVERAGE LOST — scanned ${sharedFiles.length} shared dart file(s), expected at least ${MIN_SCANNED}.`,
    `  repo root used: ${ROOT}. The scan is broken, not the tree.`,
  ]);
}

/** Comments carry history and rationale and are legitimately allowed to name an
 *  app. Only executable code is scanned. Strings ARE code: a hardcoded 'subly'
 *  config key was a real defect here, so string literals stay in scope. */
/*  🔴 AND IT WAS THREE REGEXES, WHICH IS NOT A TOKENIZER (fixed 2026-08-07).
 *  The block pattern ran FIRST, so a `/*` inside a `//` line comment opened a
 *  phantom block that ran to the next `*​/` and swallowed everything between —
 *  the same defect measured in assert-ops-register.mjs, where it ate 103 lines
 *  of assert-ceiling-budget.mjs including a real `const`. A minimal falsifier
 *  both this copy and assert-no-seam-forks.mjs failed:
 *
 *      // paths like services/​*​/src/ are scanned
 *      class Ghost implements AuthRepository {}
 *      const s = 'closes *​/';
 *
 *  → the `class Ghost` DECLARATION is blanked, so a clone tell (or a seam fork)
 *  written after any such comment is invisible and the guard prints ok.
 *  On today's Dart corpus (217 files) the loss was 1 file / 62 chars of comment
 *  prose and no code — but that is a fact about today's comments, not about the
 *  scanner. Delegates to the shared tokenizer, which walks comments, strings and
 *  regex literals in one pass. */
function stripComments(src) {
  return stripSourceComments(src, '.dart');
}

/** ⚠️ A trailing `\b` MISSES camelCase. `\bsubly\b` does not match `SublyThing`,
 *  because the boundary needs a non-word character and `T` is one — so a class
 *  named after the app would sail through. Caught by a fixture, not by reading.
 *  Instead: match the name at a word start, in any of its normal casings, and
 *  require that what follows is not a lowercase letter. `SublyThing` and
 *  `SUBLY_KEY` match; `sublyx` (a longer, unrelated word) does not.
 *  The `i` flag cannot be used here — it would make `[a-z]` match `T` too.
 *
 *  🔴 AND THE LEADING `\b` MISSED THE PRIVATE HALF (2026-08-01 corpus triage).
 *  `_` is a WORD character, so there is no word boundary in `_subly…` — which
 *  means `_sublyLegacyLimit` and `class _SublyMigration` appended to
 *  packages/core were scanned and the guard printed "no clone tells". That is
 *  not a corner case: in Dart the underscore prefix is how you spell "private",
 *  so the entire private surface of every shared package was out of scope while
 *  the PUBLIC `sublyLegacyLimit` was caught. Mutation-proven on the real tree.
 *  The left edge is therefore "not preceded by a letter or digit" — `_` and `$`
 *  separate, exactly as they do to a human reading the identifier — while
 *  `mysubly` still does not match.
 *
 *  🔴 The word's OWN spelling is a variant too. The list was lower/Capital/UPPER
 *  only, so `billingCycle` — a camelCase entry in cloneTells.domainNouns —
 *  generated `billingcycle|BillingCycle|BILLINGCYCLE` and matched none of the
 *  three ways it is actually written. A banned word that cannot match itself is
 *  an assertion that cannot fail. */
function tellPattern(words) {
  const variants = words.flatMap((w) => [
    w,
    w.toLowerCase(),
    w.charAt(0).toUpperCase() + w.slice(1),
    w.toUpperCase(),
  ]);
  return new RegExp(`(?<![A-Za-z0-9])(${[...new Set(variants)].join('|')})(?![a-z])`);
}

const problems = [];
const appRe = tellPattern(appNames);
const nounRe = tellPattern(domainNouns);

for (const rel of sharedFiles) {
  const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  for (const [i, line] of code.split('\n').entries()) {
    const app = line.match(appRe);
    if (app) {
      problems.push(
        `${rel}:${i + 1} — shared code names the app "${app[1]}". Once shared code knows which app it ` +
          'is in, every other app inherits a rule about a product it is not.',
      );
    }
    const noun = line.match(nounRe);
    if (noun) {
      problems.push(
        `${rel}:${i + 1} — shared code uses the domain word "${noun[1]}". That vocabulary belongs to one ` +
          "app's problem, not to the chassis.",
      );
    }
  }
}

if (problems.length) {
  console.error(`✗ clone tells — ${problems.length} found in shared code:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [C-10] shared code carries no app-specific vocabulary. Comments are exempt;');
  console.error('  these are in executable code or string literals.');
  process.exit(1);
}

console.log(
  `ok  no clone tells — ${sharedFiles.length} shared file(s) scanned for ${appNames.length} app name(s) ` +
    `and ${domainNouns.length} domain word(s); comments exempt`,
);
