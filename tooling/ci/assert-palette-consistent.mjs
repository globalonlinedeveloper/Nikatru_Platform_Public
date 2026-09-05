#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-palette-consistent.mjs — ONE PALETTE. Where two sources declare the
// same CSS custom property in the same scope, they must declare the same value.
//
// ── WHY THIS EXISTS, AND WHY IT IS A COMPARISON AND NOT A LINK ───────────────
// `packages/tokens` generates `sites/_shared/assets/tokens.css`, and nothing
// serves it. Measured 2026-08-17 (PR #322): zero `rel="stylesheet"` tags exist
// across the static pages, every page inlines its own `:root`, and
// `sites/nikatru/_headers` records that `/assets/tokens.css` returns 404. The
// only `<link>` to it is `sites/_shared/_includes/base.njk`, whose Eleventy
// output lands in a gitignored `_site/` that deploys nowhere.
//
// So the palette lives in ~17 hand-maintained copies, and the de-duplication —
// serve one stylesheet, delete the inline blocks — was deliberately NOT
// attempted, because linking the pages to a 404 is worse than duplicating them.
// PR #322's own closing line names the honest alternative: "guard the inline
// copies for drift rather than link them to a 404." This is that guard.
//
// It compares rather than templates. Nothing here rewrites a page, and nothing
// here declares one source to be the master: a divergence is reported with
// EVERY value and EVERY file that declares it, because when `--text` moved from
// #334155 to #1E293B the question that mattered was "which pages did not move",
// and a one-sided "does not match tokens.css" answers that badly when the token
// file is the thing that is behind.
//
// ── WHAT IS IN THE SUBJECT ───────────────────────────────────────────────────
//   1. every TRACKED `.html` and `.css` under `sites/`, minus the exclusion
//      below. Tracked, not on-disk: `sites/_shared/_site/**` is a gitignored
//      Eleventy build that exists on a developer machine and in no deploy, and
//      `tooling/sites/generate-discovery.mjs:17` states outright that it "is
//      explicitly NOT an acceptable subject for any assertion about these
//      surfaces". Deriving the set from `git ls-files` excludes it by the same
//      rule that excludes it from the deploy, rather than by a directory name
//      this file would have to remember.
//   2. `tooling/sites/generate-discovery.mjs`'s `STYLE` constant — the palette
//      the app landings and the portfolio hub are GENERATED from. It is in the
//      subject in its own right and not merely through its output: a hex edited
//      there is wrong the moment it is typed, and waiting for someone to re-run
//      the generator before the build notices is a lag with no upside.
//
// `sites/_shared/assets/tokens.css` enters through (1) like any other file, and
// is additionally named in MUST_COMPARE below so it cannot leave the subject
// quietly.
//
//   3. ADDED 2026-09-05 — THE GENERATED SIBLINGS. [ADR 067] decision 1 moved the
//      DTCG token JSON to `contracts/tokens/dtcg/` and packages/tokens now emits
//      THREE committed files from it: the CSS above, Dart constants in
//      `packages/design_system/lib/src/tokens/brand_tokens.dart`, and a JSON
//      table in `extensions/core/tokens.json` for the build-free extension
//      subtree. A second limb, at the bottom of this file, holds all three equal
//      to the DTCG source. (1) and (2) compare hand-maintained copies with each
//      other; that limb compares generated copies with the thing they are
//      generated from. Both are "one palette" and both belong here.
//
// ── THE EXCLUSION, AND WHY IT IS ITSELF CHECKED ──────────────────────────────
// `sites/nikatru/legal/<YYYY-MM-DD>/<locale>/*.html` are DATED POLICY SNAPSHOTS
// ([pipeline K-4], `assert-policy-archive.mjs`). A consent record naming policy
// version 2026-08-01 is worth exactly our ability to reproduce the bytes a
// reader saw on 2026-08-01. Re-styling one to keep a palette guard green edits
// a legal record to satisfy a lint, which is the wrong trade in every direction
// — so they are out of the subject, and PR #322 already shipped the palette
// change with "zero diffs under legal/".
//
// ⚠️ AN EXCLUSION IS A HOLE, SO IT IS CHECKED THREE WAYS, EVERY RUN:
//   · it must MATCH something. Zero matches means the archive moved or the
//     pattern rotted, and an exclusion that excludes nothing is not the rule
//     this file claims to apply — COVERAGE LOST, not a pass.
//   · every `.html` under the archive root must match the dated schema. One
//     that does not is a file this guard cannot classify — frozen record or
//     live page — and guessing either way silently changes the subject.
//   · it must not have WIDENED. MUST_COMPARE names the live policy page
//     `sites/nikatru/privacy.html` (plus both homepages and tokens.css); each
//     must still be in the compared set with a `:root` block in it.
//
// 🔴 AND THE HONEST CAVEAT: as of 2026-08-17 the three snapshots AGREE with the
// live pages on every property they share, so the exclusion changes no verdict
// today. It is not load-bearing yet; it exists so that the NEXT palette move
// does not present as fifteen red files whose only green fix is to rewrite a
// legal archive. Do not read a green run as evidence that the exclusion did
// something.
//
// ── HOW IT REFUSES ───────────────────────────────────────────────────────────
// This file is a comparison across a set, and a comparison across an empty set
// is the single most repeated defect in this repository — it prints the same
// sentence over 17 sources and over none. So every run floors what it saw:
// pages, `:root` blocks, declarations, and — the one that classification can
// eat — the number of properties actually COMPARED, i.e. declared by two or
// more sources. Rename every property to a unique name and the agreement set
// empties while every other count holds; MIN_COMPARED is the limb that fires.
// The ok line states the page count and the property count out loud so a
// shrinking subject is visible in a passing run, not only in a failing one.
//
// ⚠️ AND THE ORDER OF THOSE CHECKS IS LOAD-BEARING: NAMED BEFORE COUNTED. The
// first draft put MIN_PAGES ahead of the MUST_COMPARE membership check, which
// made that limb unreachable — every way of losing a named file also drops the
// page count, so the specific message could never be the one printed. An
// assertion that cannot fire is worse than none, and this one had shipped inside
// the file whose whole subject is that failure. Same repair below for the "named
// source declares no `:root`" limb, which MIN_ROOT_BLOCKS was shadowing.
//
// Negative-tested on the REAL tree (2026-08-17 at dcff9fb, every mutation
// restored and re-verified by sha256 / `git diff --stat`):
//   (a) `sites/nikatru/pricing.html` `--text` → `#334155` ⇒ exit 1: "--text is
//       declared 2 different ways in the light palette", #1e293b from 13 sources
//       against #334155 from one, every citation file:line.
//   (b) the generator's own `STYLE` constant, `--primary` → `#2E6FF3` ⇒ exit 1,
//       naming generate-discovery.mjs (STYLE):234 alone against 16 sources.
//   (c) a page hidden from the tracked set ⇒ exit 2, "16 page(s) in the subject,
//       expected at least 17", before any comparison is attempted.
// Eight more, each proving ONE limb can fire on its own — the constant RENAMED ·
// the live policy page hidden (the NAMED message, not the count one) · the
// exclusion matching 1 of 3 · an undated file under `legal/` · tokens.css losing
// its `:root` · an ordinary page losing its `:root` · `flush` neutered so blocks
// are found and declarations are not · every property made unique per source —
// are recorded with their exact output in
// `tooling/ci/test/palette-consistent.test.mjs`. Every floor in this file has a
// named input that fires it; none is decorative.
//
// The generated-siblings limb was negative-tested the same way, on the REAL tree
// (2026-09-05, each mutation restored with `git checkout --` and a green control
// run before and after):
//   (d) brand_tokens.dart `primary` #2E6FF2 → #2E6FF3 ⇒ exit 1, "light.primary
//       disagrees between the token source and a file generated from it",
//       citing the Dart line.
//   (e) brand_tokens.dart `line` (DARK class) #22304D → #22304E ⇒ exit 1, in the
//       dark scope — the class split is read, not assumed.
//   (f) extensions/core/tokens.json `muted` #586275 → #586276 ⇒ exit 1.
//   (g) brand_tokens.dart `fontBody` 'Manrope' → 'Manrop' ⇒ exit 1. The font
//       families are the tokens that actually reach the Flutter apps today.
//   (h) brand_tokens.dart deleted ⇒ exit 2, "a COMMITTED output … not on disk".
//   (i) `light.teal` deleted from tokens.json ⇒ exit 2, "declares 22 of the 23
//       token(s) the DTCG source names".
//   (j) contracts/tokens/dtcg/ moved away ⇒ exit 2, naming color.json.
// Two more that a fixture reaches more cheaply than the tree — an emptied
// `color` group, and `class BrandTokensDark` renamed — are in the test file.
//
// Usage:  node tooling/ci/assert-palette-consistent.mjs [repoRoot]
// Exit:   0 = one palette · 1 = two sources disagree · 2 = the scan lost its
//         coverage and refuses to report on a subject it did not read.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** The generated palette's one non-page home, and the constant inside it. Named
 *  rather than pattern-matched: a rename is a COVERAGE LOST below, which is the
 *  point — a guard that shrugs when its subject is renamed is how a scan quietly
 *  stops scanning. */
const GENERATOR = 'tooling/sites/generate-discovery.mjs';
const GENERATOR_CONST = 'STYLE';

/** The dated policy snapshots. Root and schema are separate so the "matched
 *  nothing" and "did not match the schema" failures can be told apart. */
const ARCHIVE_ROOT = 'sites/nikatru/legal';
const SNAPSHOT = /^sites\/nikatru\/legal\/\d{4}-\d{2}-\d{2}\/[^/]+\/[^/]+\.html$/;

/** The generated reference palette. Named once: it is both a MUST_COMPARE entry
 *  and the file the failure message points a reader away from editing. */
const TOKENS_CSS = 'sites/_shared/assets/tokens.css';

/** Files that must still be COMPARED — the narrowness half of the exclusion
 *  check, and the reason tokens.css cannot drift out of the subject unnoticed.
 *  Failing input for each: add it to SNAPSHOT's reach, or delete the file.
 *  ORDER MATTERS ONLY FOR THE MESSAGE: the first entry is quoted by name in the
 *  failure text as the one the exclusion swallows first. */
const MUST_COMPARE = [
  'sites/nikatru/privacy.html',
  'sites/nikatru/index.html',
  'sites/rajasekarselvam/index.html',
  TOKENS_CSS,
];

/* ── Floors. Measured on this tree 2026-08-17 at dcff9fb, and every one of them
 *  is a floor rather than an identity so that ADDING a page is free.
 *
 *  ⚠️ A FLOOR IS ONLY A FLOOR ON THE DAY IT IS MEASURED. If a page is
 *  legitimately deleted these must be lowered deliberately, in a diff a reviewer
 *  sees — which is the whole trade: the alternative is a count nothing states,
 *  and a subject that can halve in silence. */
/** Tracked `.html`/`.css` under `sites/`, dated snapshots removed. Today 18 —
 *  16 pages, plus `assets/base.css` (which declares no `:root` and is in the set
 *  because "a stylesheet under sites/" is the honest subject, not "the ones that
 *  happen to declare something today") and `assets/tokens.css`. EXACT, because
 *  the page set is what this guard is a comparison ACROSS.
 *  17 -> 18 on 2026-08-21: `sites/nikatru/fullshot/privacy.html`, the hosted
 *  FullShot policy. It arrived carrying its own greys and was the only dissenting
 *  declaration of --ink, --muted and --line on either root, which is precisely
 *  what this guard is for — it caught the page on the run that added it. */
const MIN_PAGES = 18;
/** What the exclusion must still match. */
const MIN_SNAPSHOTS = 3;
/** `:root` blocks across every source. Today 32. EXACT: a block is a page's
 *  whole light or dark palette, so losing one is never incidental.
 *  31 -> 32 with MIN_PAGES above; the new page declares a light palette and no
 *  dark override, so it contributes exactly one block. */
const MIN_ROOT_BLOCKS = 32;
/** Declarations inside those blocks. Today 265, floored SLACK on purpose. The
 *  three exact floors already fence the subject; this one exists for the single
 *  failure they cannot see — a reducer that blanks one character too many and
 *  leaves the blocks standing with nothing in them. That is a collapse to near
 *  zero, not a decrement, so a floor that reddens when somebody legitimately
 *  drops an unused `--ink` from 404.html would buy nothing and cost trust. */
const MIN_DECLARATIONS = 200;
/** (scope, property) pairs declared by two or more sources — the count
 *  classification can eat, and the only one that measures whether any COMPARING
 *  happened at all. Today 21, floored SLACK for the same reason: the input this
 *  must catch is "every property renamed to something unique" or "the corpus
 *  collapsed to one source", both of which land at or near zero. */
const MIN_COMPARED = 15;

const problems = [];
const prints = [];

/** Structural failure: the scan itself cannot be trusted, so nothing it would
 *  have reported means anything. Exits immediately, and never joins `problems`
 *  — a coverage hole reported as "one more finding" is a coverage hole that gets
 *  triaged behind the findings. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

/* ── Reduction ──────────────────────────────────────────────────────────────
 * Every reducer below BLANKS with characters of equal length rather than
 * deleting, so byte offsets survive and a reported line number is the line in
 * the real file. And every one of them can only ever see LESS than the truth,
 * never more — over-discarding drops declarations, and dropping declarations is
 * what the floors above are for. That direction is chosen deliberately: this repo
 * has twice shipped a reducer that ate real code and reported clean, so the
 * failure mode is aimed at the limb that fires rather than the one that passes. */

/** 🔴 NEWLINES SURVIVE THE BLANKING, AND THE FIRST DRAFT OF THIS FILE DID NOT DO
 *  THAT. Blanking every discarded character to a space keeps OFFSETS right and
 *  silently destroys LINE NUMBERS: `sites/_shared/assets/tokens.css`'s seven-line
 *  header comment became seven-lines-worth of spaces on one line, and the guard
 *  reported the `--text` declaration — really on line 17 — as `tokens.css:10`.
 *  Every citation it printed was short by the number of newlines it had eaten,
 *  and each one still looked like a plausible line in a real file, which is the
 *  only reason it took a mutation to notice. */
const blank = (s) => s.replace(/[^\n]/g, ' ');

/** CSS block comments. CSS has no line comments, and no nested comments, so a
 *  non-greedy pair match is the whole grammar rather than an approximation. */
const blankCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, blank);

/**
 * The CSS view of a source: same length as the original, with everything that
 * is not stylesheet text blanked out.
 *
 * For `.css` that is the whole file minus comments. For HTML it is the bodies of
 * the `<style>` elements — `:root` cannot be declared anywhere else in an HTML
 * document, so this is a narrowing that cannot lose a real declaration, and HTML
 * comments go first so a commented-out `<style>` block cannot contribute a
 * palette nobody ships.
 */
function cssView(rel, source) {
  if (rel.endsWith('.css')) return blankCssComments(source);
  const html = source.replace(/<!--[\s\S]*?-->/g, blank);
  /* 🔴 UTF-16 UNITS, NOT CODE POINTS, AND THE DIFFERENCE IS REACHABLE HERE.
     This was `[...html]`, which iterates by CODE POINT, while `m.index` from
     `matchAll` is a UTF-16 offset. On any document containing an astral character
     — an emoji — the two disagree and every declaration after it is written at the
     wrong offset, so the guard reports a real drift at a line that does not hold it.
     Measured 2026-08-17: FOUR tracked pages differ between the two indexings
     (`apps/_template.html` and `checkout-return.html` by 1, `pricing.html` by 1,
     `rajasekarselvam/index.html` by 3), so this was not theoretical. `Array.from`
     over `.length` with an index loop keeps the array in the same units `m.index`
     speaks, which is the only property that matters. A line number is the part of a
     guard's output a human acts on; one that is quietly off is worse than none,
     because it sends the reader to an innocent line and costs them the trust. */
  const view = new Array(html.length);
  for (let i = 0; i < html.length; i++) view[i] = html[i] === '\n' ? '\n' : ' ';
  for (const m of html.matchAll(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi)) {
    const body = blankCssComments(m[2]);
    const at = m.index + m[1].length;
    for (let i = 0; i < body.length; i++) view[at + i] = body[i];
  }
  return view.join('');
}

/* ── Parse ─────────────────────────────────────────────────────────────────── */

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** A prelude names `:root` if any of its comma-separated selectors is `:root`.
 *  `:root, body { … }` is a `:root` declaration and reads as one. */
const isRootSelector = (prelude) =>
  prelude
    .split(',')
    .map((s) => squash(s))
    .includes(':root');

/** The condition a `:root` block sits under, as a comparison key: ALL enclosing
 *  at-rules, lower-cased, with the whitespace AROUND PUNCTUATION removed and the
 *  whitespace BETWEEN WORDS kept. So `@media(prefers-color-scheme:dark)` and
 *  `@media (prefers-color-scheme: dark)` are one scope, and a block under some
 *  OTHER at-rule gets its own key rather than being folded into the light palette
 *  and reported as a conflict with it.
 *
 *  ⚠️ THE FIRST VERSION STRIPPED ALL WHITESPACE, which is correct for every
 *  parenthesised media feature and wrong the moment a media TYPE appears:
 *  `@media print` keyed as `@mediaprint`. It compared correctly and printed a
 *  scope name no CSS author would recognise, which is the quiet half of the bug —
 *  a guard's message is the only part of it anyone reads. */
function scopeKey(stack) {
  const conds = stack.slice(0, -1).filter((p) => p.startsWith('@'));
  if (!conds.length) return 'unconditional';
  return conds
    .map((c) =>
      c
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\s*([(),:])\s*/g, '$1')
        .trim(),
    )
    .join(' and ');
}

const scopeLabel = (key) =>
  key === 'unconditional' ? 'light' : key === '@media(prefers-color-scheme:dark)' ? 'dark' : key;

/**
 * Every custom-property declaration inside a `:root` block, with the scope it
 * was declared under.
 *
 * A brace/semicolon scanner rather than a regex: the scope of a declaration is
 * the at-rule NESTING above it, which a regex over `:root\s*\{[^}]*\}` cannot
 * see at all — and getting that wrong merges the dark palette into the light one
 * and reports every dark override as a conflict.
 */
function rootDeclarations(css) {
  const out = [];
  const stack = [];
  let start = 0;

  const flush = (end) => {
    if (!stack.length || !isRootSelector(stack[stack.length - 1])) return;
    const raw = css.slice(start, end);
    const text = raw.trim();
    if (!text.startsWith('--')) return;
    const colon = text.indexOf(':');
    if (colon < 0) return;
    out.push({
      property: text.slice(0, colon).trim(),
      value: squash(text.slice(colon + 1)),
      scope: scopeKey(stack),
      // The `--` itself, NOT `start`. `start` is the character after the previous
      // `;`, which is the newline that ended the previous line — so citing it
      // reports every declaration one line early, on a line that exists and looks
      // right. Measured: tokens.css's `--text` cited as :16 for a declaration on 17.
      offset: start + (raw.length - raw.trimStart().length),
    });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(squash(css.slice(start, i)));
      start = i + 1;
    } else if (ch === '}') {
      flush(i);
      stack.pop();
      start = i + 1;
    } else if (ch === ';') {
      flush(i);
      start = i + 1;
    }
  }
  return out;
}

/** `:root` blocks, counted separately from the declarations in them: a file that
 *  keeps its blocks but loses their contents and one that loses the blocks are
 *  different failures, and MIN_ROOT_BLOCKS is the limb that survives a reducer
 *  that ate the declaration text. */
function rootBlockCount(css) {
  let n = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{' || ch === '}' || ch === ';') {
      if (ch === '{' && isRootSelector(squash(css.slice(start, i)))) n++;
      start = i + 1;
    }
  }
  return n;
}

/** Hex colours compared case-insensitively and in their expanded form, because
 *  `#FFF`, `#fff` and `#ffffff` are the same colour and a guard that reddens on
 *  the spelling of a colour is a guard somebody switches off within a week.
 *  Everything else is compared as written, whitespace collapsed — a font stack
 *  is not a colour and its case is not ours to fold. */
function comparable(value) {
  const t = squash(value);
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t)) return t;
  const h = t.toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
}

const lineOf = (text, offset, base = 1) => base + (text.slice(0, offset).match(/\n/g) ?? []).length;

/* ── Subject ───────────────────────────────────────────────────────────────── */

const git = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (git.error || git.status !== 0) {
  coverageLost([
    `\`git ls-files\` failed in ${ROOT}, so the tracked set — the only thing that tells a deployed page`,
    `from a gitignored build artefact — could not be read. ${git.error?.message ?? `exit ${git.status}: ${squash(git.stderr ?? '')}`}`,
  ]);
}
const tracked = git.stdout.split('\0').filter(Boolean);

const candidates = tracked.filter((p) => /^sites\/.+\.(?:html|css)$/.test(p)).sort();
const excluded = candidates.filter((p) => SNAPSHOT.test(p));
const pages = candidates.filter((p) => !SNAPSHOT.test(p));

/* ── The exclusion, checked before it is honoured ──────────────────────────── */

if (!existsSync(join(ROOT, ARCHIVE_ROOT))) {
  coverageLost([
    `the exclusion names ${ARCHIVE_ROOT}/ and that directory is not on disk.`,
    `Either the policy archive moved — in which case SNAPSHOT here and assert-policy-archive.mjs`,
    `both point at nothing — or this is not a checkout of this repository.`,
  ]);
}

if (excluded.length < MIN_SNAPSHOTS) {
  coverageLost([
    `the dated-snapshot exclusion matched ${excluded.length} file(s), expected at least ${MIN_SNAPSHOTS}.`,
    `An exclusion that excludes nothing is not the rule this guard claims to apply: it would report`,
    `"snapshots excluded" while comparing them like any other page, or while the archive it protects`,
    `has silently emptied. Pattern: ${SNAPSHOT}`,
  ]);
}

const unclassified = candidates.filter((p) => p.startsWith(`${ARCHIVE_ROOT}/`) && !SNAPSHOT.test(p));
if (unclassified.length) {
  coverageLost([
    `${unclassified.length} file(s) under ${ARCHIVE_ROOT}/ do not match the dated <YYYY-MM-DD>/<locale>/ schema,`,
    `so this guard cannot tell a frozen legal record from a live page — and it must not guess. Comparing a`,
    `frozen record drags a palette change into a consent artefact; excluding a live page silently shrinks`,
    `the subject. Fix the path or teach SNAPSHOT the new schema deliberately.`,
    ...unclassified.map((p) => `  · ${p}`),
  ]);
}

/* 🔴 THE NAMED CHECK RUNS BEFORE THE COUNTING ONE, AND THE ORDER IS THE POINT.
   Widening SNAPSHOT to swallow the live policy page also drops the page count, so
   with MIN_PAGES first this limb would be unreachable — an assertion that cannot
   fire, inflating apparent coverage while a generic "16 < 17" sent the reader
   looking for a deleted file. Specific before generic, everywhere below. */
const absent = MUST_COMPARE.filter((rel) => !pages.includes(rel));
if (absent.length) {
  coverageLost([
    `${absent.length} named source(s) are not in the compared set:`,
    ...absent.map((p) => `  · ${p}`),
    `These are named because losing them is how this guard goes quietly wrong. ${MUST_COMPARE[0]} is the`,
    `live policy page — the one the dated-snapshot exclusion swallows first if it ever widens; the two`,
    `homepages are the two deploy roots; and tokens.css is the generated reference palette that nothing`,
    `serves and, without this guard, nothing checks. Either the exclusion widened or the file moved.`,
  ]);
}

if (pages.length < MIN_PAGES) {
  coverageLost([
    `${pages.length} page(s) in the subject, expected at least ${MIN_PAGES}.`,
    `A palette comparison over a shrunken set prints the same sentence as one over the whole tree.`,
    `Tracked .html/.css under sites/: ${candidates.length}; excluded as dated snapshots: ${excluded.length}.`,
  ]);
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

/** name → { css, lineBase } for every source whose declarations are compared. */
const sources = new Map();

for (const rel of pages) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    coverageLost([
      `${rel} is tracked but not on disk, so the subject this run compared is smaller than the`,
      `subject the repository declares. A partial checkout is not a clean palette.`,
    ]);
  }
  sources.set(rel, { css: cssView(rel, readFileSync(abs, 'utf8')), lineBase: 1 });
}

/* The generator's constant. Extracted by NAME — a rename is COVERAGE LOST, not a
   quietly smaller subject. */
{
  const abs = join(ROOT, GENERATOR);
  if (!existsSync(abs)) {
    coverageLost([
      `${GENERATOR} is not on disk, so the palette the app landings and the portfolio hub are`,
      `GENERATED from is not in this comparison. Its output pages would still be compared, which is`,
      `the trap: they agree with each other while the constant that writes them is free to drift.`,
    ]);
  }
  const src = readFileSync(abs, 'utf8');
  const marker = `const ${GENERATOR_CONST} = \``;
  const at = src.indexOf(marker);
  if (at < 0) {
    coverageLost([
      `${GENERATOR} no longer declares \`${marker.trim()}\`.`,
      `The generator's palette constant was renamed or restructured, and this guard would have gone on`,
      `comparing everything else and printing ok while covering it not at all.`,
    ]);
  }
  const bodyAt = at + marker.length;
  let end = bodyAt;
  while (end < src.length && src[end] !== '`') {
    if (src[end] === '\\') end++;
    end++;
  }
  if (end >= src.length) {
    coverageLost([`${GENERATOR}'s \`${GENERATOR_CONST}\` template literal is unterminated — the file does not parse as read.`]);
  }
  const literal = src.slice(bodyAt, end);
  sources.set(`${GENERATOR} (${GENERATOR_CONST})`, {
    css: cssView('.html', literal),
    lineBase: lineOf(src, bodyAt),
  });
}

/* ── Parse, and floor what was parsed ──────────────────────────────────────── */

/** One entry per (scope, property): `{ scope, property, byValue }`, where byValue
 *  is Map(comparableValue → [{ source, raw, line }]).
 *
 *  The two halves are CARRIED rather than joined into the map key and split back
 *  out again. A scope key is a join of at-rule preludes and may itself contain a
 *  space, so any separator that looked safe here would mis-attribute every
 *  property under a nested at-rule to the wrong scope the first time one appeared
 *  — and it would do it silently, which is the only way it would ever matter. */
const declaredBy = new Map();
let rootBlocks = 0;
let declarations = 0;

for (const [name, { css, lineBase }] of sources) {
  rootBlocks += rootBlockCount(css);
  for (const d of rootDeclarations(css)) {
    declarations++;
    const key = JSON.stringify([d.scope, d.property]);
    if (!declaredBy.has(key)) declaredBy.set(key, { scope: d.scope, property: d.property, byValue: new Map() });
    const { byValue } = declaredBy.get(key);
    const cmp = comparable(d.value);
    if (!byValue.has(cmp)) byValue.set(cmp, []);
    byValue.get(cmp).push({ source: name, raw: d.value, line: lineOf(css, d.offset, lineBase) });
  }
}

/* Specific before generic again: a named source that is IN the set but declares
   nothing is a different repair from "the corpus shrank", and reporting it as the
   latter sends the reader to the wrong file. */
const silent = MUST_COMPARE.filter((rel) => rootBlockCount(sources.get(rel).css) === 0);
if (silent.length) {
  coverageLost([
    `${silent.length} named source(s) are in the compared set but declare no \`:root\` block at all:`,
    ...silent.map((p) => `  · ${p}`),
    `Present and contributing nothing is worse than absent: the file is counted, the ok line reads the`,
    `same, and the palette it was supposed to pin is unpinned. For tokens.css this is what a broken`,
    `\`packages/tokens\` build looks like from here — the emitter ran and wrote no palette.`,
  ]);
}

if (rootBlocks < MIN_ROOT_BLOCKS) {
  coverageLost([
    `${rootBlocks} \`:root\` block(s) parsed across ${sources.size} source(s), expected at least ${MIN_ROOT_BLOCKS}.`,
    `Either the pages stopped declaring their palettes inline — in which case this guard is asking the`,
    `wrong question and should be re-pointed — or the reduction above ate the stylesheets it was`,
    `supposed to isolate. Both print "ok" if this floor is not here.`,
  ]);
}

if (declarations < MIN_DECLARATIONS) {
  coverageLost([
    `${declarations} custom-property declaration(s) read from ${rootBlocks} \`:root\` block(s), expected at`,
    `least ${MIN_DECLARATIONS}. Blocks were found and their contents were not, which is what a reducer looks`,
    `like when it blanks one character too many.`,
  ]);
}

/* ── Compare ───────────────────────────────────────────────────────────────── */

let compared = 0;
const scopesSeen = new Set();

for (const [, { scope, property, byValue }] of [...declaredBy].sort(([a], [b]) => a.localeCompare(b))) {
  const declarers = [...byValue.values()].reduce((n, sites) => n + sites.length, 0);
  if (declarers < 2) continue;
  // Counted AFTER the two-declarer gate, so the ok line's "across N scope(s)" is
  // the number of scopes something was actually compared in — not the number a
  // single page happened to open. A scope with one declarer in it is a scope this
  // guard has no opinion about, and saying otherwise overstates the run.
  scopesSeen.add(scope);
  compared++;
  if (byValue.size === 1) continue;

  const lines = [
    `${property} is declared ${byValue.size} different ways in the ${scopeLabel(scope)} palette:`,
  ];
  for (const [cmp, sites] of [...byValue].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${cmp}  — ${sites.length} source(s)`);
    for (const s of sites) lines.push(`      ${s.source}:${s.line}${s.raw === cmp ? '' : `  (written \`${s.raw}\`)`}`);
  }
  problems.push(lines.join('\n'));
}

if (compared < MIN_COMPARED) {
  coverageLost([
    `only ${compared} propert(ies) are declared by two or more sources, expected at least ${MIN_COMPARED}.`,
    `This is the count classification can eat: rename every property to something unique and every other`,
    `floor above still holds while this guard compares nothing and prints ok. ${declaredBy.size} distinct`,
    `(scope, property) pair(s) were seen in total.`,
  ]);
}

/* ── THE GENERATED SIBLINGS ─────────────────────────────────────────────────
 *
 * Everything above compares HAND-MAINTAINED palettes with each other. This limb
 * asks the other half of the question: do the three GENERATED outputs still say
 * what their one source says?
 *
 * ── WHY IT IS HERE AND NOT IN A GUARD OF ITS OWN ────────────────────────────
 * This file's subject is already "one palette", and until 2026-09-05 exactly one
 * output existed. [ADR 067] decision 1 moved the DTCG JSON to
 * contracts/tokens/dtcg/ and packages/tokens now emits THREE committed files
 * from it — the CSS, Dart constants for the Flutter apps, and a JSON table for
 * the build-free extension subtree. Three committed generated files is three
 * more chances for a hand edit to stick, and the failure is silent in the worst
 * way: the file still parses, the app still builds, and the palette has forked.
 *
 * ── WHY IT DUPLICATES THE CI LANE, DELIBERATELY ─────────────────────────────
 * ci.yml's `site-tokens` lane deletes all three, rebuilds and diffs — which is
 * the stronger check, because it re-derives rather than compares. But it needs
 * `npm ci` and a node_modules tree, so it cannot run in the guard lanes and it
 * cannot run on a developer machine that has not installed the emitter. This
 * limb reads four JSON files and three text files and needs nothing. It cannot
 * catch an emitter whose FORMATTER changed (only a rebuild sees that); it does
 * catch every hand edit to a value, which is the failure that actually happens.
 *
 * ── HOW IT REFUSES ─────────────────────────────────────────────────────────
 * A comparison across an absent file is this repository's most repeated defect,
 * so: the DTCG source must exist and must yield at least the floors below, and
 * each generated output must exist and must declare EVERY key the source does.
 * A missing output is COVERAGE LOST, not a finding — it is what a build that did
 * not run looks like from here, and reporting it as "the palette disagrees"
 * would send a reader to edit a file that is not there.
 */

const DTCG_DIR = 'contracts/tokens/dtcg';
const DART_OUT = 'packages/design_system/lib/src/tokens/brand_tokens.dart';
const JSON_OUT = 'extensions/core/tokens.json';

/** Light colours in the DTCG source. EXACT: the emitters assert completeness on
 *  their side too (`assertEmitsEveryToken`), so a token added to the JSON and
 *  not to the emit order fails the BUILD; this floor is the half that fires when
 *  a token is REMOVED from the source and every output loses it together, which
 *  no other check here would see. */
const MIN_SOURCE_LIGHT = 12;
/** Dark overrides in the DTCG source. */
const MIN_SOURCE_DARK = 8;

function readJsonOrRefuse(rel, why) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) coverageLost([`${rel} is not on disk.`, why]);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${rel} is not valid JSON, so it cannot be the source this guard compares against.`, String(e.message)]);
  }
}

/** `ink-2` -> `ink2`. The same mechanical transform the Dart emitter applies —
 *  restated here rather than imported, because importing it would mean this
 *  guard agrees with the emitter BY CONSTRUCTION and could not catch an emitter
 *  that renamed on the way out. Two independent statements of one rule is the
 *  point; a divergence between them is a real finding, not a nuisance. */
const dartIdent = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/* The source of truth. */
const dtcgColor = readJsonOrRefuse(
  `${DTCG_DIR}/color.json`,
  `It is the light half of the token contract [ADR 067] decision 1 created, and every generated palette in the tree is emitted from it.`,
);
const dtcgDark = readJsonOrRefuse(`${DTCG_DIR}/color.dark.json`, `It is the dark half of the token contract.`);
const dtcgFont = readJsonOrRefuse(`${DTCG_DIR}/font.json`, `It declares the two brand font families.`);
const dtcgSize = readJsonOrRefuse(`${DTCG_DIR}/size.json`, `It declares the brand corner radius.`);

/** DTCG group -> Map(name -> value), skipping the `$`-prefixed metadata keys. */
function dtcgGroup(doc, group) {
  const body = doc?.[group];
  const out = new Map();
  if (!body || typeof body !== 'object') return out;
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith('$')) continue;
    const value = v?.$value ?? v?.value;
    if (typeof value === 'string') out.set(k, value);
  }
  return out;
}

const srcLight = dtcgGroup(dtcgColor, 'color');
const srcDark = dtcgGroup(dtcgDark, 'dark');
const srcFont = dtcgGroup(dtcgFont, 'font');
const srcSize = dtcgGroup(dtcgSize, 'size');

if (srcLight.size < MIN_SOURCE_LIGHT || srcDark.size < MIN_SOURCE_DARK) {
  coverageLost([
    `the DTCG source declares ${srcLight.size} light and ${srcDark.size} dark colour(s), expected at least`,
    `${MIN_SOURCE_LIGHT} and ${MIN_SOURCE_DARK}. Comparing three generated files against a source that has emptied prints ok over`,
    `nothing — the outputs would agree with an empty contract by containing no key it names.`,
  ]);
}
if (!srcFont.has('display') || !srcFont.has('body') || !srcSize.has('radius')) {
  coverageLost([
    `${DTCG_DIR}/font.json must declare font.display and font.body, and size.json must declare size.radius.`,
    `They are the non-colour half of this comparison and the only tokens that reach the Flutter apps today.`,
  ]);
}

/** Every key this limb holds equal, as `scope.name` -> value, from the source. */
const expected = new Map();
for (const [k, v] of srcLight) expected.set(`light.${k}`, v);
for (const [k, v] of srcDark) expected.set(`dark.${k}`, v);
expected.set('font.display', srcFont.get('display'));
expected.set('font.body', srcFont.get('body'));
expected.set('size.radius', srcSize.get('radius'));

/** One generated output, read as `scope.name` -> { value, line }. */
const readGenerated = {
  css() {
    const abs = join(ROOT, TOKENS_CSS);
    const text = readFileSync(abs, 'utf8');
    const out = new Map();
    for (const d of rootDeclarations(blankCssComments(text))) {
      const name = d.property.replace(/^--/, '');
      const scope = d.scope === '@media(prefers-color-scheme:dark)' ? 'dark' : 'light';
      const line = lineOf(text, d.offset);
      if (name === 'radius') out.set('size.radius', { value: d.value, line });
      else if (name === 'font-display') out.set('font.display', { value: d.value.replace(/^"|"$/g, ''), line });
      else if (name === 'font-body') out.set('font.body', { value: d.value.replace(/^"|"$/g, ''), line });
      else out.set(`${scope}.${name}`, { value: d.value, line });
    }
    return out;
  },
  dart() {
    const text = readFileSync(join(ROOT, DART_OUT), 'utf8');
    const split = text.indexOf('class BrandTokensDark');
    if (split < 0) {
      coverageLost([
        `${DART_OUT} declares no \`class BrandTokensDark\`, so the dark half of the palette is not in this`,
        `comparison and every dark token would read as "the output does not declare it" — a message about the`,
        `wrong thing. Either the emitter's class names changed, or the file is not the emitter's output.`,
      ]);
    }
    const out = new Map();
    const scan = (body, scope, base) => {
      for (const m of body.matchAll(/static const Color (\w+) = Color\(0x(?:FF)?([0-9A-Fa-f]{6})\);/g)) {
        out.set(`${scope}.${m[1]}`, { value: `#${m[2]}`, line: lineOf(text, base + m.index), dart: true });
      }
    };
    scan(text.slice(0, split), 'light', 0);
    scan(text.slice(split), 'dark', split);
    for (const m of text.matchAll(/static const String (fontDisplay|fontBody) = '([^']*)';/g)) {
      out.set(m[1] === 'fontDisplay' ? 'font.display' : 'font.body', { value: m[2], line: lineOf(text, m.index) });
    }
    const r = text.match(/static const double radius = ([0-9]+(?:\.[0-9]+)?);/);
    if (r) out.set('size.radius', { value: `${r[1].replace(/\.0$/, '')}px`, line: lineOf(text, text.indexOf(r[0])) });
    return out;
  },
  json() {
    const doc = readJsonOrRefuse(JSON_OUT, `It is the token table the build-free extension subtree reads.`);
    const text = readFileSync(join(ROOT, JSON_OUT), 'utf8');
    const out = new Map();
    const lineFor = (key) => {
      const at = text.indexOf(`"${key}":`);
      return at < 0 ? 1 : lineOf(text, at);
    };
    for (const scope of ['light', 'dark']) {
      for (const [k, v] of Object.entries(doc?.[scope] ?? {})) out.set(`${scope}.${k}`, { value: String(v), line: lineFor(k) });
    }
    for (const k of ['display', 'body']) {
      if (doc?.font?.[k] !== undefined) out.set(`font.${k}`, { value: String(doc.font[k]), line: lineFor(k) });
    }
    if (doc?.size?.radius !== undefined) out.set('size.radius', { value: String(doc.size.radius), line: lineFor('radius') });
    return out;
  },
};

for (const [rel, kind] of [
  [TOKENS_CSS, 'css'],
  [DART_OUT, 'dart'],
  [JSON_OUT, 'json'],
]) {
  if (!existsSync(join(ROOT, rel))) {
    coverageLost([
      `${rel} is a COMMITTED output of packages/tokens and it is not on disk.`,
      `That is what a build that did not run looks like from here, so this guard refuses rather than`,
      `reporting a palette disagreement about a file nobody can edit. Rebuild with`,
      `\`cd packages/tokens && npm ci && npm run build\`, or — if the output was retired on purpose —`,
      `remove it from this guard and from ci.yml's site-tokens lane in the same change.`,
    ]);
  }
  const got = readGenerated[kind]();
  const missing = [...expected.keys()].filter((k) => !got.has(kind === 'dart' ? dartKey(k) : k));
  if (missing.length) {
    coverageLost([
      `${rel} declares ${got.size} of the ${expected.size} token(s) the DTCG source names — ${missing.length} missing:`,
      ...missing.slice(0, 12).map((k) => `  · ${k}`),
      ...(missing.length > 12 ? [`  · … and ${missing.length - 12} more`] : []),
      `A generated file that is missing a token compares clean on every token it still has, which is`,
      `"compared nothing, found nothing wrong" wearing a passing run's clothes.`,
    ]);
  }
  for (const [key, want] of expected) {
    const lookup = kind === 'dart' ? dartKey(key) : key;
    const have = got.get(lookup);
    if (comparable(have.value) === comparable(want)) continue;
    problems.push(
      [
        `${key} disagrees between the token source and a file generated from it:`,
        `  ${comparable(want)}  — ${DTCG_DIR}/ (the source)`,
        `  ${comparable(have.value)}  — ${rel}:${have.line}${have.value === comparable(have.value) ? '' : `  (written \`${have.value}\`)`}`,
      ].join('\n'),
    );
  }
}

/** `light.ink-2` -> `light.ink2`, and the non-colour keys unchanged. Dart cannot
 *  spell a hyphen in an identifier and that is the ONLY difference between the
 *  Dart names and the token names — see the emitter's own note on why there is
 *  no rename table. */
function dartKey(key) {
  const dot = key.indexOf('.');
  const scope = key.slice(0, dot);
  const name = key.slice(dot + 1);
  if (scope === 'light' || scope === 'dark') return `${scope}.${dartIdent(name)}`;
  return key === 'font.display' ? 'font.display' : key;
}

/* ── Report ────────────────────────────────────────────────────────────────── */

prints.push(
  `3 generated output(s) held equal to ${DTCG_DIR}/ on ${expected.size} token(s): ${TOKENS_CSS}, ${DART_OUT}, ${JSON_OUT}.`,
);

prints.push(
  `${excluded.length} dated legal snapshot(s) excluded from the comparison (frozen consent records, [pipeline K-4]):`,
);
for (const p of excluded) prints.push(`  · ${p}`);

for (const p of prints) console.log(`note  ${p}`);

if (problems.length) {
  console.error(`✗ the palette disagrees with itself in ${problems.length} place(s):`);
  for (const p of problems) console.error(`  ${p.split('\n').join('\n  ')}`);
  console.error(
    `\n  One palette: a property declared in two places must carry the same value in both. Pick the value the`,
  );
  console.error(
    `  brand actually uses, apply it everywhere it is declared, and remember ${DTCG_DIR}/*.json is the source`,
  );
  console.error(
    `  ${TOKENS_CSS}, ${DART_OUT} and ${JSON_OUT} are ALL generated from — edit the DTCG JSON and rebuild`,
  );
  console.error(`  (\`cd packages/tokens && npm run build\`), never a generated file.`);
  process.exit(1);
}

console.log(
  `ok  one palette — ${pages.length} page(s) + the ${GENERATOR_CONST} constant in ${GENERATOR} agree on ` +
    `${compared} shared propert(ies) across ${scopesSeen.size} scope(s) ` +
    `(${rootBlocks} \`:root\` block(s), ${declarations} declaration(s), ${declaredBy.size} distinct (scope, property) pair(s); ` +
    `${excluded.length} dated snapshot(s) excluded).`,
);
