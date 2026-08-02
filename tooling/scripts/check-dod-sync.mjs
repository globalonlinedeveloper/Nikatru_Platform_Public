#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-dod-sync.mjs — [pipeline N-1] the LOCAL half of the Definition of Done.
//
// 🔴 WHY THIS IS NOT A CI GUARD, AND MUST NOT BECOME ONE.
//
// The stage doc's replacement acceptance for N-1 asks CI to parse
// `company/MASTER_PLAN.md` §4 *and* `company/requirements/definition-of-done.md`
// and assert a relationship between them. **`company/` is gitignored.** It is a
// separate private repository nested inside a PUBLIC one, and it is never pushed.
// So a check living in `tooling/ci/` could never once execute against its own
// subject — it would exist, print ok, and be enforcing nothing. That is the same
// class of blocker stage 8 hit, and the resolution there was to give the
// machine-checkable half an in-tree home; `tooling/dod-register.json` mirrors it.
//
// The division of labour, stated so nobody re-crosses the line:
//
//   tooling/dod-register.json          PUBLIC. The machine-readable items.
//   tooling/ci/assert-app-dod.mjs      PUBLIC. Fails the build on the register
//                                      and on every app's done-record.
//   company/requirements/…-done.md     PRIVATE. The prose one-pager.
//   THIS FILE                          LOCAL. The only place with read access to
//                                      BOTH trees, so the only place the
//                                      cross-tree relationships can be checked
//                                      at all. It PRINTS what it could not read
//                                      rather than reporting a clean sweep of it.
//
// Three relationships, none of them a count somebody has to keep raising:
//
//   R1  register item ids  ==  MASTER_PLAN §4's lettered items, minus any letter
//       a dated cut removes wholesale (none today — the five cuts are sub-items).
//       Adding a letter to §4 without a register row FAILS here. That is the
//       only shape that stops the two drifting the way §4 and the tree already
//       drifted once.
//   R2  the prose page's item ids  ==  the register's, and their enforced-by
//       values agree. Neither document is the sole authority, which is how a
//       4-page DoD came to claim `[CI]` on three items no lane touched.
//   R3  no dated cut has crept back into the page's ITEMS section. The page is
//       allowed — required — to LIST the cuts under its own cuts heading; what
//       it may not do is re-adopt one as an item. Scanning the whole page would
//       make the cut list itself the failure, so the scan is bounded and says so.
//
// Usage:  node tooling/scripts/check-dod-sync.mjs [repoRoot] [--company <dir>]
//
// `--company` exists because the private tree does not live inside a git
// worktree: it is a sibling of the checkout, so an agent working in a worktree
// has a repo root and a company root in two different places. Defaults to
// `<repoRoot>/company`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const companyAt = argv.indexOf('--company');
const companyArg = companyAt === -1 ? null : argv[companyAt + 1];
const positional = argv.filter((a, i) => companyAt === -1 || (i !== companyAt && i !== companyAt + 1));

const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const COMPANY = resolve(companyArg ?? join(ROOT, 'company'));

const REGISTER = join(ROOT, 'tooling', 'dod-register.json');
const PLAN = join(COMPANY, 'MASTER_PLAN.md');
const PAGE = join(COMPANY, 'requirements', 'definition-of-done.md');

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

/** Structural failure — everything below quantifies over what just went missing,
 *  so continuing would print a clean sweep of nothing. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── the public half, which must always be readable ───────────────────────────
if (!existsSync(REGISTER)) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'It is the machine-readable half of the DoD and the only half a build can fail on.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (e) {
  coverageLost([`tooling/dod-register.json could not be parsed (${e.message}).`]);
}
const items = Array.isArray(register.items) ? register.items : [];
if (items.length === 0) {
  coverageLost([
    'tooling/dod-register.json declares no items.',
    'Every relationship below is a set comparison against this list; over an empty list they are all',
    'vacuously true, which is exactly how an empty file satisfied the original N-1.',
  ]);
}
const registerIds = new Set(items.map((i) => i.id));
const cuts = Array.isArray(register.cuts) ? register.cuts : [];

// ── the private half. NOT readable from CI, by design ────────────────────────
// Absence is a REFUSAL, not a skip: this script exists to check the cross-tree
// relationship, and a run that could not see one side has checked nothing. It
// says which side and where it looked.
const missingPrivate = [PLAN, PAGE].filter((p) => !existsSync(p));
if (missingPrivate.length) {
  console.error('✗ the private tree is not readable from here, so NOTHING was cross-checked:');
  for (const p of missingPrivate) console.error(`    missing: ${p}`);
  console.error('');
  console.error('  This is a LOCAL check by construction — company/ is gitignored and CI can never run it.');
  console.error('  Point it at the private tree explicitly if it is not a sibling of the checkout:');
  console.error('      node tooling/scripts/check-dod-sync.mjs . --company <path-to-company>');
  console.error('');
  console.error('  Reporting ok here would be the exact failure this file guards against: silence about an');
  console.error('  unperformed check is how apparent coverage inflates.');
  process.exit(1);
}

const planText = readFileSync(PLAN, 'utf8');
const pageText = readFileSync(PAGE, 'utf8');

// ═════ R1 — register ids == MASTER_PLAN §4's lettered items ══════════════════
// §4 is bounded by its own heading and the next one. Bounding matters: `**A.` is
// a shape that occurs elsewhere in a 200-line plan, and an unbounded scan would
// quietly enlarge the domain until the set comparison meant nothing.
const secStart = planText.search(/^##\s*4\./m);
if (secStart === -1) {
  coverageLost([
    'company/MASTER_PLAN.md has no `## 4.` heading, so §4 could not be located.',
    'R1 compares the register against that section; without it the comparison ranges over nothing.',
  ]);
}
const rest = planText.slice(secStart + 1);
const secEnd = rest.search(/^##\s/m);
const section = secEnd === -1 ? rest : rest.slice(0, secEnd);
const planLetters = [...section.matchAll(/^\*\*([A-Z])\.\s/gm)].map((m) => m[1]);
if (planLetters.length === 0) {
  coverageLost([
    'company/MASTER_PLAN.md §4 was located but declares ZERO lettered items.',
    'Either the section format changed, or this parser has stopped seeing it. A scanner that quietly',
    'matches less is the failure this repo keeps re-learning.',
  ]);
}
const planSet = new Set(planLetters);

// A cut MAY remove a whole letter; none does today. Modelled anyway, because the
// alternative when it happens is somebody deleting this relationship.
const removedLetters = new Set(cuts.map((c) => c.removesItem).filter(Boolean));
const expected = [...planSet].filter((l) => !removedLetters.has(l)).sort();
const actual = [...registerIds].sort();

for (const l of expected) {
  if (!registerIds.has(l)) {
    fail(
      `MASTER_PLAN §4 declares item ${l} and tooling/dod-register.json has no row for it. ` +
        'A DoD item with no register row is enforced by nothing and checked by nobody.',
    );
  }
}
for (const l of actual) {
  if (!planSet.has(l)) {
    fail(
      `tooling/dod-register.json declares item ${l}, which is not a lettered item in MASTER_PLAN §4. ` +
        'Either the plan lost it or the register invented it; both are drift.',
    );
  }
}

// ═════ R2 — the prose page agrees, item for item ═════════════════════════════
// The page's table rows read `| **A** | title | `guard` | …`.
const pageRows = [...pageText.matchAll(/^\|\s*\*\*([A-Z])\*\*\s*\|([^|]*)\|\s*`(\w+)`\s*\|/gm)];
if (pageRows.length === 0) {
  coverageLost([
    'company/requirements/definition-of-done.md declares no item rows this parser can see.',
    'R2 and R3 both range over that table; over zero rows they are vacuously true, which is the exact',
    'defect the original N-1 acceptance had — an empty page satisfied all three of its conjuncts.',
  ]);
}
const pageEnforcedBy = new Map(pageRows.map((m) => [m[1], m[3]]));

for (const item of items) {
  if (!pageEnforcedBy.has(item.id)) {
    fail(
      `item ${item.id} is in the register and absent from the one-pager. The page is what the owner ` +
        'reads; an item only the machine knows about is not a definition of done anybody agreed to.',
    );
    continue;
  }
  const onPage = pageEnforcedBy.get(item.id);
  if (onPage !== item.enforcedBy) {
    fail(
      `item ${item.id}: the register says enforced-by \`${item.enforcedBy}\` and the one-pager says ` +
        `\`${onPage}\`. Neither document is the sole authority — that disagreement is how a 4-page DoD ` +
        'came to claim [CI] on three items no lane touched.',
    );
  }
}
for (const id of pageEnforcedBy.keys()) {
  if (!registerIds.has(id)) {
    fail(`the one-pager lists item ${id}, which has no row in tooling/dod-register.json.`);
  }
}

// ═════ R3 — no dated cut has crept back onto the page as an item ═════════════
// BOUNDED SCAN, and the bound is the whole reason this check can exist: the page
// is REQUIRED to list its cuts under its own cuts heading, so scanning the whole
// file would make the honest cut list the failure. Only the region above that
// heading — where the items live — is in scope.
const cutsHeadingAt = pageText.search(/^##\s+Cuts honoured/m);
if (cutsHeadingAt === -1) {
  coverageLost([
    'company/requirements/definition-of-done.md has no `## Cuts honoured` heading.',
    'R3 scans only the region ABOVE it, so without the heading the bound is the whole file and the',
    'page\'s own honest cut list would read as five re-adopted items. A missing heading is also a page',
    'that has stopped recording its cuts at all.',
  ]);
}
const itemsRegion = pageText.slice(0, cutsHeadingAt);
let cutsChecked = 0;
for (const cut of cuts) {
  const phrase = cut.pageMustNotContain;
  if (!phrase) {
    fail(
      `cut "${cut.id}" has no \`pageMustNotContain\` phrase, so nothing stops it reappearing as an item. ` +
        'A cut with no detectable form is a cut nobody is watching.',
    );
    continue;
  }
  cutsChecked++;
  if (itemsRegion.includes(phrase)) {
    fail(
      `the cut "${cut.id}" (${cut.what}, cut ${cut.decided} by ${cut.by}) has reappeared in the ` +
        `one-pager's ITEMS section — the phrase "${phrase}" is there. A cut that quietly returns is how ` +
        'the one-pager becomes the four-pager that rotted.',
    );
  }
  // …and the cut must still be RECORDED below the heading. A cut deleted from
  // the page is a cut nobody can find the reason for.
  if (!pageText.slice(cutsHeadingAt).includes(cut.decided)) {
    fail(
      `the cut "${cut.id}" is dated ${cut.decided} in the register and that date appears nowhere in the ` +
        "one-pager's cut list. A cut whose reasoning is not on the page will be re-litigated from memory.",
    );
  }
}
if (cuts.length > 0 && cutsChecked === 0) {
  coverageLost([
    `the register declares ${cuts.length} cut(s) and NONE carried a phrase to look for.`,
    'R3 would have reported a clean page having examined nothing.',
  ]);
}

// ── what CI cannot see, printed rather than implied ──────────────────────────
notes.push(
  `company/ is gitignored: CI enforces the register (${items.length} item(s)) and every app's ` +
    'done-record; the one-pager and MASTER_PLAN §4 are checked HERE and nowhere else.',
);

if (problems.length) {
  console.error(`✗ DoD sync — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-1] The register and the one-pager check each other. Neither is the sole');
  console.error('  authority, because a document that only agrees with itself is what rotted the first time.');
  process.exit(1);
}

console.log('⬜ notes:');
for (const n of notes) console.log(`    ${n}`);
console.log(
  `ok  DoD sync — ${items.length} register item(s), set-equal to MASTER_PLAN §4's ${planLetters.length} ` +
    `lettered item(s) and to the one-pager's ${pageEnforcedBy.size} row(s); enforced-by agrees on all of ` +
    `them; ${cutsChecked} dated cut(s) stayed cut and stayed recorded`,
);
