#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-legal-text-parity.mjs — a legal document published in more than one
// place says the SAME THING in every one of them, and every copy still says what
// its source says.
//
// ── THE CONTROL THIS REPLACES WAS A COMMENT ──────────────────────────────────
// `sites/nikatru/fullshot/privacy.html` carried a provenance note that was
// honest about its own weakness:
//
//     "No guard in either repo can see across the repository boundary —
//      assert-enforcement-index prints 'no row carries kind cross-repo' — so
//      THIS COMMENT is the only thing joining the two copies. Edit the source
//      first, then re-copy; never edit this file alone."
//
// Two published copies of a privacy policy — one served at the URL every store
// listing points at, one submitted to Chrome, Edge and AMO — joined by a
// request. That sentence stopped being true the moment `extensions/` became a
// subtree of this repository ([ADR 067] decision 1): both files are in one tree
// and one guard can read both.
//
// Measured 2026-09-05, markup stripped from both: the two were IDENTICAL in
// text. So this is not a repair of a divergence. It closes the gap while there
// is nothing in it, which is the only time closing it is cheap.
//
// ── TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT IS EASY TO LEAVE OUT ──────
//   1 THE PUBLISHED COPIES AGREE WITH EACH OTHER. Markup stripped, entities
//     decoded, whitespace collapsed, curly quotes and dashes folded — because
//     "the apostrophe is curly" is not a legal difference.
//   2 NO PUBLISHED COPY HAS DRIFTED FROM ITS MARKDOWN SOURCE. Without this, the
//     pair can be edited in step and `contracts/legal/*.md` quietly becomes a
//     third, stale copy — the failure mode of every "source of truth" that
//     nothing generates from.
//
// ── AND IT MUST NOT PASS VACUOUSLY ───────────────────────────────────────────
// A comparison that found one copy, or zero, is COVERAGE LOST rather than "no
// differences". The count of copies compared is printed on every run, for the
// same reason `check-store-packages.mjs` prints its package count: so
// "0 copies, clean" cannot be misread as "2 clean".
//
// ── THE SUBJECT SET IS DERIVED, WITH REQUIRED MEMBERS ────────────────────────
// `DOCUMENTS` names what is published where. `contracts/legal/` is then swept,
// and a `.md` in it that no row covers is a FAILURE — so a second legal document
// cannot be added and silently ungraded. That is the same shape
// `assert-entitlement-contract.mjs` uses for its migration set.
//
// Usage:  node tooling/ci/assert-legal-text-parity.mjs [repoRoot]
// Exit 0 = every published copy matches its source and its siblings.
//      1 = a divergence, or the scan could not reach enough to be evidence.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { normaliseForMatch, visibleText } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** Where the shared legal text lives. Swept, so a new document is graded. */
const LEGAL_DIR = 'contracts/legal';

/**
 * One row per legal document that is published more than once.
 *
 * `renderedBy` is named so a failure can say what to run. The renderer writes
 * both copies from the same Markdown, which makes a divergence impossible to
 * introduce accidentally — this guard is what catches it being introduced
 * DELIBERATELY, by editing a published file instead of its source.
 */
const DOCUMENTS = [
  {
    source: 'contracts/legal/fullshot-privacy.md',
    renderedBy: 'node contracts/legal/render-fullshot-privacy.mjs',
    copies: [
      {
        file: 'sites/nikatru/fullshot/privacy.html',
        what: 'served at nikatru.com/fullshot/privacy — the URL every store listing points at',
      },
      {
        file: 'extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html',
        what: 'the copy submitted to Chrome, Edge and AMO',
      },
    ],
  },
];

/** Below this, a "match" is not evidence: two nearly-empty documents agree. */
const MIN_CHARACTERS = 2000;
/** A document published in one place needs no parity check; zero is a broken scan. */
const MIN_COPIES_PER_DOCUMENT = 2;

/** The sentinel that parks a code span while HTML tags are stripped out of the
 *  Markdown. U+E000 is a Private Use Area code point: it cannot appear in an
 *  authored legal document, and unlike NUL it keeps this file plain text. */
const SPAN = '\uE000';

const problems = [];
const fail = (m) => problems.push(m);

/**
 * The text a reader of the MARKDOWN sees, reduced the same way `visibleText`
 * reduces HTML.
 *
 * 🔴 CODE SPANS ARE LIFTED OUT FIRST, AND THAT IS NOT TIDINESS. This policy
 * contains `` `<all_urls>` ``. Strip HTML tags before protecting it and the
 * permission name DISAPPEARS from one side of the comparison — the guard would
 * then pass a page that had lost it, which is the single most load-bearing
 * string in the permissions section.
 */
function markdownVisibleText(md) {
  const spans = [];
  let text = md.replace(/`([^`]*)`/g, (_, body) => {
    spans.push(body);
    // The placeholder is SENTINEL-delimited rather than ` <n> `, because this
    // document contains ordinary numbers with spaces round them -- "(stage 13)" --
    // and a numeric placeholder would let one of them be read as a code-span
    // index. That index is undefined, so the string "undefined" would be spliced
    // into a legal document's reduced text and the comparison would then fail for
    // a reason that looks exactly like a real divergence.
    return `${SPAN}${spans.length - 1}${SPAN}`;
  });
  text = text
    // 🔴 A `callout=` DIRECTIVE CARRIES PUBLISHED TEXT, so it is lifted out
    // BEFORE comments are dropped. The tag "In one line" is rendered into both
    // HTML copies as a visible `<span class="tag">`; treating the directive that
    // holds it as metadata would let that string change in the Markdown with
    // this guard reporting a clean run. Every other directive is presentation.
    .replace(/<!--\s*render:[^>]*?callout=([^>]*?)\s*-->/g, ' $1 ')
    .replace(/<!--[\s\S]*?-->/g, ' ')   // reader notes and the other directives
    .replace(/<[^>]*>/g, ' ')            // the inline HTML the policy uses (<u>)
    .replace(/^\s*---\s*$/gm, ' ')       // the footer rule
    .replace(/^#{1,6}\s+/gm, '')         // heading markers
    .replace(/^\s*[-*]\s+/gm, '')        // list bullets
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their label
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1');
  text = text.replace(new RegExp(`${SPAN}(\\d+)${SPAN}`, "g"), (_, i) => spans[Number(i)]);
  return publishedForm(text);
}

/**
 * The normal form BOTH sides are reduced to, on top of `normaliseForMatch`.
 *
 * ⚠️ `visibleText` replaces every tag with a SPACE — deliberately, so that
 * `<b>a</b><b>b</b>` cannot read as one word. The cost is that a link ending a
 * sentence, `…<a …>support@nikatru.com</a>.`, reduces to "support@nikatru.com ."
 * while the Markdown reduces to "support@nikatru.com." — a difference produced
 * entirely by the reduction, in a pair that is character-for-character
 * identical. Tightening the space before closing punctuation on BOTH sides
 * removes the artefact and removes nothing a reader could see: a space before a
 * full stop is not a legal difference, and any change to the words themselves
 * still lands.
 */
const publishedForm = (text) =>
  normaliseForMatch(text)
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1');

/**
 * The BODY of an HTML page, because that is what "published text" means here.
 *
 * ⚠️ `visibleText` over the whole file also returns the `<title>`, which on both
 * of these pages repeats the `<h1>` — so a whole-file comparison reported the
 * heading TWICE on the HTML side and once in the Markdown, and read as a
 * divergence in a pair that is character-for-character identical. A guard whose
 * first red is an artefact of its own reduction is a guard that gets switched
 * off. The head is metadata (canonical link, description, the generator note);
 * the claim this guard makes is about the document a reader reads.
 *
 * No `<body>` is COVERAGE LOST rather than "compare the whole file": a legal
 * page with no body element is not something to guess about.
 */
function htmlBody(html, file) {
  const m = /<body[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  if (!m) {
    fail(`COVERAGE LOST — ${file} has no <body>…</body>, so there is no published text to compare.`);
    return null;
  }
  return m[1];
}

/** The first place two strings differ, with a window either side. Printing the
 *  whole of a 9,000-character policy is not a diagnostic. */
function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return {
    at: i,
    a: `…${a.slice(from, i + 60)}…`,
    b: `…${b.slice(from, i + 60)}…`,
  };
}

// ── COVERAGE, FIRST ─────────────────────────────────────────────────────────
if (DOCUMENTS.length === 0) {
  console.error('✗ COVERAGE LOST — the DOCUMENTS table is empty, so this guard compared nothing.');
  process.exit(1);
}

const legalAbs = join(ROOT, LEGAL_DIR);
if (!existsSync(legalAbs)) {
  console.error(`✗ COVERAGE LOST — ${LEGAL_DIR}/ does not exist under ${ROOT}, so the sweep read nothing.`);
  console.error('  A parity guard whose subject directory is gone reports a clean run over an empty set.');
  process.exit(1);
}

// A .md in contracts/legal that no row covers is UNGRADED, and an ungraded legal
// document published twice is exactly the state this guard was written for.
const covered = new Set(DOCUMENTS.map((d) => d.source));
const onDisk = listDir(legalAbs)
  .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .map((f) => `${LEGAL_DIR}/${f}`);
for (const f of onDisk) {
  if (!covered.has(f)) {
    fail(
      `${f} is shared legal text that NO row in this guard covers, so nothing compares it to what is ` +
        'published. Add it to DOCUMENTS with the files it is published as.',
    );
  }
}
if (onDisk.length === 0) {
  fail(`COVERAGE LOST — no .md found under ${LEGAL_DIR}/, so the sweep that proves this table is complete read nothing.`);
}

// ── the two assertions ──────────────────────────────────────────────────────
let comparisons = 0;
let copiesChecked = 0;

for (const doc of DOCUMENTS) {
  const sourceAbs = join(ROOT, doc.source);
  if (!existsSync(sourceAbs)) {
    fail(`COVERAGE LOST — ${doc.source} does not exist, so its ${doc.copies.length} published copy/copies are compared to nothing.`);
    continue;
  }
  const sourceText = markdownVisibleText(readFileSync(sourceAbs, 'utf8'));
  if (sourceText.length < MIN_CHARACTERS) {
    fail(
      `COVERAGE LOST — ${doc.source} reduced to ${sourceText.length} character(s), below the ${MIN_CHARACTERS} floor. ` +
        'Two nearly-empty documents agree with each other and with anything else.',
    );
    continue;
  }

  const read = [];
  for (const copy of doc.copies) {
    const abs = join(ROOT, copy.file);
    if (!existsSync(abs)) {
      fail(`COVERAGE LOST — ${copy.file} does not exist. It is ${copy.what}, and it was compared to nothing.`);
      continue;
    }
    const bodyHtml = htmlBody(readFileSync(abs, 'utf8'), copy.file);
    if (bodyHtml === null) continue;
    const text = publishedForm(visibleText(bodyHtml));
    if (text.length < MIN_CHARACTERS) {
      fail(
        `COVERAGE LOST — ${copy.file} reduced to ${text.length} character(s) of visible text, below the ` +
          `${MIN_CHARACTERS} floor. An empty page matches an empty page.`,
      );
      continue;
    }
    read.push({ ...copy, text });
    copiesChecked++;
  }

  if (read.length < MIN_COPIES_PER_DOCUMENT) {
    fail(
      `COVERAGE LOST — only ${read.length} readable published copy/copies of ${doc.source}, and parity needs ` +
        `${MIN_COPIES_PER_DOCUMENT}. "Compared nothing, found nothing wrong" is not a pass.`,
    );
    continue;
  }

  // 1 · the published copies agree with each other.
  for (let i = 1; i < read.length; i++) {
    comparisons++;
    if (read[0].text !== read[i].text) {
      const d = firstDifference(read[0].text, read[i].text);
      fail(
        `${read[0].file} and ${read[i].file} PUBLISH DIFFERENT TEXT for ${doc.source}.\n` +
          `      first difference at character ${d.at}\n` +
          `      ${read[0].file}: ${d.a}\n` +
          `      ${read[i].file}: ${d.b}\n` +
          `      Both are rendered from the source: ${doc.renderedBy}`,
      );
    }
  }

  // 2 · no published copy has drifted from the source.
  for (const copy of read) {
    comparisons++;
    if (copy.text !== sourceText) {
      const d = firstDifference(sourceText, copy.text);
      fail(
        `${copy.file} has DRIFTED FROM ${doc.source}. It is ${copy.what}.\n` +
          `      first difference at character ${d.at}\n` +
          `      ${doc.source}: ${d.a}\n` +
          `      ${copy.file}: ${d.b}\n` +
          `      The published copies are generated: edit the Markdown and run ${doc.renderedBy}`,
      );
    }
  }
}

if (comparisons === 0) {
  fail('COVERAGE LOST — not one text comparison was performed, so every limb above is dark.');
}

if (problems.length) {
  console.error(`✗ legal text parity — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A published legal document that says two different things in two places is a');
  console.error('  misstatement in whichever one is wrong, and nothing tells you which.');
  process.exit(1);
}

console.log(
  `ok  legal text parity — ${DOCUMENTS.length} shared legal document(s), ${copiesChecked} published copy/copies ` +
    `compared, ${comparisons} comparison(s): every copy agrees with its siblings AND with its Markdown source ` +
    `(floor ${MIN_CHARACTERS} characters, ${MIN_COPIES_PER_DOCUMENT} copies per document)`,
);
