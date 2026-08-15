#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-dod-sync.mjs — [pipeline N-1] the LOCAL half of the Definition of Done.
//
// 🔴 WHY THIS IS NOT A CI GUARD, AND MUST NOT BECOME ONE.
//
// The stage doc's replacement acceptance for N-1 asks CI to parse
// `Private/MASTER_PLAN.md` §4 *and* `Private/requirements/definition-of-done.md`
// and assert a relationship between them. **`Private/company/` is gitignored.** It is a
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
//   Private/requirements/…-done.md     PRIVATE. The prose one-pager.
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
//       And each cut must still be RECORDED — matched to a row that is ITS OWN.
//
// 🔴 REPAIRED 2026-08-12 — R3's "stayed recorded" half was five assertions that
// were really one, AND ITS OWN SUCCESS MESSAGE WAS THE THING THAT LIED.
//
//   The old test was `pageText.slice(cutsHeadingAt).includes(cut.decided)` — a
//   bare DATE substring against the whole cut region. Four of the five cuts are
//   dated 2026-07-25, so ONE surviving row satisfied all four; the fifth carried
//   the only other date. Three of the five assertions could not fail alone, and
//   the run still printed "5 dated cut(s) stayed cut and stayed recorded" — a
//   count of what the REGISTER declares, never of what was found on the page.
//
//   MUTATION THAT PROVED IT (2026-08-12). Every mutation below ran against a
//   byte-identical copy of the live page (sha256 e7f86749…) driven through
//   `--company`, and the copy was first shown to produce output identical to the
//   real tree's. The page is another agent's file this session, so it was never
//   edited in place; the copy was re-verified at e7f86749… afterwards.
//
//     delete 3 of the 5 rows from the page's cut table
//       — golden matrix · manual per-platform accessibility pass · widget-per-state —
//     OLD:  `ok  … 5 dated cut(s) stayed cut and stayed recorded`   EXIT 0   ❌
//     NEW:  `✗ COVERAGE LOST — the one-pager's cut table has 2 row(s); the
//            register declares 5 cut(s), and only 2 could be matched to a row of
//            its own`, then names the 2 it matched and the 3 it did not,
//                                                                  EXIT 1   ✅
//
//   INDEPENDENT FALSIFIABILITY, measured one row at a time (delete row N alone,
//   N = 1..5, restore between). NEW: 5 of 5 caught, each naming that cut and only
//   that cut. OLD: 1 of 5 — only `e2e-per-environment`, the one cut whose date is
//   not shared with any other. That ratio is the defect in one number.
//
//   THE REPAIR. Each cut is matched to a row by the ROW'S OWN IDENTITY: the cut
//   table is PARSED and its HEADER names the columns (proven: swapping the `cut`
//   and `decided` columns still passes with the right rows — position is not what
//   is being read), then each register cut must win exactly one row on the tokens
//   of its own `id` + `what`. Only then is THAT ROW'S `decided` cell compared with
//   the register's date, so a wrong date names the row.
//
//   The match must be MUTUAL — best row for the cut AND best cut for the row. The
//   first draft of this repair used one-sided best and reported `golden-matrix`
//   as found on "the E2E environment matrix" once its own row was deleted: they
//   share the word "matrix". The count was right and the exit was right and the
//   named row was wrong, which is the same lie in a smaller place. A tie on either
//   side is a failure, never a guess: rows a guard cannot tell apart are
//   assertions that cannot fail alone.
//
//   ALSO PROVEN TO FAIL (each restored after): one row's date changed 07-25→07-26
//   (names that row); the cut table emptied (COVERAGE LOST, zero rows); the header
//   renamed `decided`→`when` (COVERAGE LOST — the scan would otherwise reach zero
//   rows and report five cuts safely recorded); a 6th row the register does not
//   declare (drift, both directions checked); a truncated 1-cell row (malformed,
//   named by line); a cut re-adopted into the ITEMS table (the phrase half).
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
// Default followed the tree on 2026-08-15: company/ now lives under Private/. `--company`
// still overrides, and is still the answer when the private tree is not a sibling of the
// checkout at all — which is why this guard refuses to report ok when it cannot find it.
// Repointed again 2026-08-15: the flatten merged company/ and knowledge/ into ONE repo at
// Private/, so the private tree root is Private/ itself. --company still overrides.
const COMPANY = resolve(companyArg ?? join(ROOT, 'Private'));

const REGISTER = join(ROOT, 'tooling', 'dod-register.json');
const PLAN = join(COMPANY, 'MASTER_PLAN.md');
const PAGE = join(COMPANY, 'requirements', 'definition-of-done.md');

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

/** Structural failure — everything below quantifies over what just went missing,
 *  so continuing would print a clean sweep of nothing. Anything already found is
 *  flushed first: exiting on a structural fault must not swallow the real
 *  problems collected before it. */
const coverageLost = (lines) => {
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) were already found before coverage was lost:`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
  }
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
  console.error('  This is a LOCAL check by construction — Private/company/ is gitignored and CI can never run it.');
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
    'Private/MASTER_PLAN.md has no `## 4.` heading, so §4 could not be located.',
    'R1 compares the register against that section; without it the comparison ranges over nothing.',
  ]);
}
const rest = planText.slice(secStart + 1);
const secEnd = rest.search(/^##\s/m);
const section = secEnd === -1 ? rest : rest.slice(0, secEnd);
const planLetters = [...section.matchAll(/^\*\*([A-Z])\.\s/gm)].map((m) => m[1]);
if (planLetters.length === 0) {
  coverageLost([
    'Private/MASTER_PLAN.md §4 was located but declares ZERO lettered items.',
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
    'Private/requirements/definition-of-done.md declares no item rows this parser can see.',
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
    'Private/requirements/definition-of-done.md has no `## Cuts honoured` heading.',
    'R3 scans only the region ABOVE it, so without the heading the bound is the whole file and the',
    'page\'s own honest cut list would read as five re-adopted items. A missing heading is also a page',
    'that has stopped recording its cuts at all.',
  ]);
}
const itemsRegion = pageText.slice(0, cutsHeadingAt);
let phrasesChecked = 0;
for (const cut of cuts) {
  const phrase = cut.pageMustNotContain;
  if (!phrase) {
    fail(
      `cut "${cut.id}" has no \`pageMustNotContain\` phrase, so nothing stops it reappearing as an item. ` +
        'A cut with no detectable form is a cut nobody is watching.',
    );
    continue;
  }
  phrasesChecked++;
  if (itemsRegion.includes(phrase)) {
    fail(
      `the cut "${cut.id}" (${cut.what}, cut ${cut.decided} by ${cut.by}) has reappeared in the ` +
        `one-pager's ITEMS section — the phrase "${phrase}" is there. A cut that quietly returns is how ` +
        'the one-pager becomes the four-pager that rotted.',
    );
  }
}
if (cuts.length > 0 && phrasesChecked === 0) {
  coverageLost([
    `the register declares ${cuts.length} cut(s) and NONE carried a phrase to look for.`,
    'R3 would have reported a clean page having examined nothing.',
  ]);
}

// ═════ R3b — every cut is still RECORDED, matched to a row that is ITS OWN ════
// See the repair note in the header. The old form was
// `pageText.slice(cutsHeadingAt).includes(cut.decided)` — a bare DATE substring
// over the whole region. Four of the five cuts share 2026-07-25, so ONE surviving
// row satisfied four assertions, and the success line counted the REGISTER rather
// than the page. Identity now comes from the row, so each of the five fails alone.

// Bounded by the next `##`, so a later section's table can never be read as a cut
// row — the same bounding argument as §4 in R1.
const cutsRegionRaw = pageText.slice(cutsHeadingAt);
const afterCutsHeading = cutsRegionRaw.slice(1);
const nextHeadAt = afterCutsHeading.search(/^##\s/m);
const cutsRegion = nextHeadAt === -1 ? cutsRegionRaw : cutsRegionRaw.slice(0, nextHeadAt + 1);
const headingLineNo = pageText.slice(0, cutsHeadingAt).split('\n').length;

// PARSED STRUCTURE, not a grep over prose: markdown table rows, and the HEADER
// names the columns. Rename or reorder a column and the parser says so, rather
// than reading whichever cell happens to sit second.
const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const normHeader = (c) => c.toLowerCase().replace(/[`*_]/g, '').trim();

let cols = null;
const pageCutRows = [];
const regionLines = cutsRegion.split('\n');
for (let i = 0; i < regionLines.length; i++) {
  const line = regionLines[i];
  if (!/^\s*\|.*\|\s*$/.test(line)) continue;
  const cells = cellsOf(line);
  if (isSeparator(cells)) continue;
  if (!cols) {
    const h = cells.map(normHeader);
    const cut = h.indexOf('cut');
    const decided = h.indexOf('decided');
    if (cut !== -1 && decided !== -1) cols = { cut, decided, by: h.indexOf('by') };
    continue; // nothing above the header row is data
  }
  if (cells.length <= Math.max(cols.cut, cols.decided)) {
    fail(
      `the one-pager's cut table has a malformed row at definition-of-done.md:${headingLineNo + i} ` +
        `(${cells.length} cell(s); the header declares at least ${Math.max(cols.cut, cols.decided) + 1}).`,
    );
    continue;
  }
  pageCutRows.push({
    cut: cells[cols.cut],
    decided: cells[cols.decided],
    by: cols.by === -1 ? '' : (cells[cols.by] ?? ''),
    line: headingLineNo + i,
  });
}

if (cuts.length > 0 && !cols) {
  coverageLost([
    "the one-pager's cut table has no header row this parser can read (it needs a `cut` and a `decided` column).",
    'Every "stayed recorded" assertion reads named columns of that table; without the header the scan',
    'reaches ZERO rows and would report five cuts safely recorded having examined none of them.',
    `Looked between definition-of-done.md:${headingLineNo} and the next \`##\` heading.`,
  ]);
}
if (cuts.length > 0 && pageCutRows.length === 0) {
  coverageLost([
    `the register declares ${cuts.length} cut(s) and the one-pager's cut table has ZERO rows.`,
    'A cut deleted from the page is a cut whose reasoning nobody can find. Over zero rows the check is',
    'vacuously true — which is how a message can say "stayed recorded" about a page recording nothing.',
  ]);
}

// A cut's ANCHOR is its own identity: the significant tokens of its `id` and its
// `what`. The page abbreviates ("the manual per-platform accessibility pass" for
// `manual-screen-reader`), so a verbatim compare would fail on a correct page —
// but the anchor must still pick out exactly ONE row, and a tie is reported
// rather than guessed: two rows a guard cannot tell apart are two assertions
// that cannot fail independently, which is the defect repaired here.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'as', 'of', 'on', 'in', 'per', 'to', 'for', 'by', 'with',
  'its', 'is', 'at', 'not', 'no', 'it', 'that', 'this', 'all', 'x', 'six',
]);
const tokenize = (s) =>
  new Set(
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  );
const rowTokens = pageCutRows.map((r) => tokenize(r.cut));

// The whole score matrix first, because the match must be MUTUAL: the row is
// this cut's best row AND this cut is that row's best cut. One-sided "best" is
// not identity — with the golden-matrix row deleted, `golden-matrix` still shares
// the word "matrix" with "the E2E environment matrix" and would be reported as
// found on somebody else's row. Confidently naming the wrong row is the same
// class of lie as counting the register instead of the page.
const anchors = cuts.map((c) => new Set([...tokenize(c.id), ...tokenize(c.what)]));
const score = anchors.map((a) => pageCutRows.map((_, i) => [...rowTokens[i]].filter((t) => a.has(t))));
const bestCutsForRow = pageCutRows.map((_, i) => {
  const best = Math.max(0, ...score.map((row) => row[i].length));
  return { best, cutIdx: score.map((row, c) => ({ c, n: row[i].length })).filter((x) => x.n === best && best > 0) };
});

const claimedBy = new Map(); // row index -> cut id
const recorded = []; // { id, line, cell, decided, overlap }
for (let c = 0; c < cuts.length; c++) {
  const cut = cuts[c];
  const anchor = anchors[c];
  if (anchor.size === 0) {
    fail(
      `cut "${cut.id}" yields no distinguishing tokens from its id or its \`what\`, so no row can be ` +
        'matched to it and its "stayed recorded" assertion could never fail. Give it a describable id.',
    );
    continue;
  }
  const scores = score[c];
  const best = Math.max(0, ...scores.map((s) => s.length));
  const winners = scores.map((s, i) => ({ i, s })).filter(({ s }) => s.length === best && best > 0);

  if (winners.length === 0) {
    fail(
      `the cut "${cut.id}" (${cut.what}) is NOT recorded in the one-pager's cut list — no row there shares ` +
        `any of its identifying words [${[...anchor].join(' ')}]. A cut whose reasoning is not on the page ` +
        'will be re-litigated from memory. Rows present: ' +
        (pageCutRows.map((r) => `"${r.cut}"`).join(', ') || '(none)'),
    );
    continue;
  }
  if (winners.length > 1) {
    fail(
      `the cut "${cut.id}" matches ${winners.length} rows of the one-pager's cut list equally ` +
        `(${winners.map(({ i }) => `:${pageCutRows[i].line} "${pageCutRows[i].cut}"`).join(', ')}). ` +
        'The guard refuses to guess: rows it cannot tell apart are assertions that cannot fail alone, ' +
        'which is the exact defect this check was repaired for.',
    );
    continue;
  }

  const { i, s } = winners[0];
  const row = pageCutRows[i];

  // MUTUAL check — is this cut also that row's best claimant?
  const owners = bestCutsForRow[i].cutIdx;
  if (!owners.some((o) => o.c === c)) {
    const stronger = owners.map((o) => `"${cuts[o.c].id}" [${score[o.c][i].join(' ')}]`).join(', ');
    fail(
      `the cut "${cut.id}" (${cut.what}) is NOT recorded in the one-pager's cut list. Its nearest row ` +
        `(definition-of-done.md:${row.line} "${row.cut}") is a STRONGER match for ${stronger} than for ` +
        `this cut [${s.join(' ')}], so that row belongs to another cut and this one has no row of its own.`,
    );
    continue;
  }
  if (owners.length > 1) {
    fail(
      `the row definition-of-done.md:${row.line} "${row.cut}" is claimed equally by ` +
        `${owners.map((o) => `"${cuts[o.c].id}"`).join(' and ')}. The guard refuses to guess which cut it ` +
        'records; two cuts one row cannot separate are two assertions that cannot fail alone.',
    );
    continue;
  }

  const owner = claimedBy.get(i);
  if (owner !== undefined) {
    fail(
      `cuts "${owner}" and "${cut.id}" both resolve to the SAME row of the one-pager's cut list ` +
        `(definition-of-done.md:${row.line} "${row.cut}"). One row cannot record two cuts.`,
    );
    continue;
  }
  claimedBy.set(i, cut.id);
  recorded.push({ id: cut.id, line: row.line, cell: row.cut, decided: row.decided, overlap: s });

  // …and THAT row's own date cell must carry the register's date. Keyed to the
  // row, so a wrong date names the row instead of the whole region.
  if (row.decided !== cut.decided) {
    fail(
      `the cut "${cut.id}" is dated ${cut.decided} in the register and its row on the one-pager ` +
        `(definition-of-done.md:${row.line} "${row.cut}") says ${row.decided || '(empty)'}. ` +
        'The date is the part of a cut that stops it being re-litigated from memory.',
    );
  }
}

// The other direction: a row on the page that no register cut accounts for.
for (let i = 0; i < pageCutRows.length; i++) {
  if (!claimedBy.has(i)) {
    fail(
      `the one-pager's cut list has a row (definition-of-done.md:${pageCutRows[i].line} ` +
        `"${pageCutRows[i].cut}") that no cut in tooling/dod-register.json accounts for. ` +
        'Either the register lost it or the page invented it; both are drift.',
    );
  }
}

// COVERAGE SELF-CHECK. Matching fewer rows than the register declares cuts means
// the scan reached less than its subject. That is COVERAGE LOST, never a pass —
// and the report names both halves, so nobody has to diff the page to learn
// which ones went missing.
if (recorded.length < cuts.length) {
  const missing = cuts.map((c) => c.id).filter((id) => !recorded.some((r) => r.id === id));
  coverageLost([
    `the one-pager's cut table has ${pageCutRows.length} row(s); the register declares ${cuts.length} cut(s), ` +
      `and only ${recorded.length} could be matched to a row of its own.`,
    `matched ${recorded.length}: ${recorded.map((r) => `${r.id} → :${r.line} "${r.cell}"`).join(' · ') || '(none)'}`,
    `NOT recorded on the page: ${missing.join(' · ')}`,
    '',
    'Until 2026-08-12 this state printed "5 dated cut(s) stayed cut and stayed recorded" and exited 0: the',
    'test was a bare date substring and four cuts share one date, so one surviving row answered for four.',
  ]);
}

// ── what CI cannot see, printed rather than implied ──────────────────────────
notes.push(
  `Private/company/ is gitignored: CI enforces the register (${items.length} item(s)) and every app's ` +
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
    `them; ${phrasesChecked} cut phrase(s) absent from the items table.`,
);
// NAME THE ROWS. The old line reported a count taken from the register, so it
// said "5 stayed recorded" over a page holding two. A count is not evidence; the
// row it was matched to is.
console.log(`    ${recorded.length} of ${cuts.length} dated cut(s) stayed cut and stayed recorded, each on its OWN row:`);
for (const r of recorded) {
  console.log(`      ${r.id} → definition-of-done.md:${r.line} "${r.cell}" (${r.decided}) via [${r.overlap.join(' ')}]`);
}
