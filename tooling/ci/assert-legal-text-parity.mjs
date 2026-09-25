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
// ── ⏱ 2026-09-11 — A THIRD ASSERTION: THE BYTES, NOT ONLY THE WORDS ─────────
// REVIEW-stores-2026-09-10 #5: `render-fullshot-privacy.mjs --check` exited 1 on
// the served page and NOTHING in CI ran it, while assertions 1 and 2 above passed
// — they compare VISIBLE TEXT, so a drift in markup, head or comments is invisible
// to them by construction. Assertion 3 runs the renderer into a scratch tree and
// requires every published copy to equal its output byte for byte.
//
// ⚠️ ONE TRANSFORM IS ALLOWED, AND IT IS NAMED: `<!--email_off-->` markers are
// removed from the served copy before comparing. check-site-integrity.mjs FAILS
// any mailto: outside them (#575 — Cloudflare Email Address Obfuscation replaced
// the statutory contact address with "[email protected]" in the served bytes),
// and the renderer does not emit them. So the drift `--check` reports today is
// exactly those markers, and "regenerate the page" would turn a different guard
// red and break the address on the live page. That residue PRINTS, naming the
// source-side fix, and retires itself the day the two are identical. Every other
// byte of drift FAILS.
//
// Usage:  node tooling/ci/assert-legal-text-parity.mjs [repoRoot]
// Exit 0 = every published copy matches its source and its siblings.
//      1 = a divergence, or the scan could not reach enough to be evidence.
// ─────────────────────────────────────────────────────────────────────────────
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { normaliseForMatch, visibleText } from './text-reductions.mjs';
import { fullshotPro, dropGated, FULLSHOT_TOOL_REL, APP_CONFIG_REL } from '../../contracts/legal/pro-gate.mjs';

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
    /** Assertion 3 RUNS this, in a scratch tree, and compares bytes. */
    renderer: 'contracts/legal/render-fullshot-privacy.mjs',
    /** ⏱ 2026-09-25 (EXT-4, Q2) — the files the renderer reads to decide which
     *  `when=pro|sells|free` paragraphs are published; copied into the scratch tree. */
    rendererReads: ['contracts/legal/pro-gate.mjs', FULLSHOT_TOOL_REL, APP_CONFIG_REL],
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
const fail = (m) => problems.push(m); const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
const prints = [];

/** Is this run grading the repository this guard lives in? A synthetic tree
 *  (the test suite) legitimately carries no renderer; the real one must. */
const SCANNING_OWN_REPO = resolve(ROOT) === resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one transform assertion 3 allows — see the header. Both spellings
 *  check-site-integrity.mjs accepts, open and close. */
const EMAIL_OFF_MARKER = /<!--\s*\/?\s*email_off\s*-->/gi;

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
    // `--!>` closes a comment as well as `-->`; both patterns accept it, so this
    // reduction and contracts/legal/render-fullshot-privacy.mjs agree about where
    // a comment ENDS. They disagreeing is a divergence report nobody can explain.
    .replace(/<!--\s*render:[^>]*?callout=([^>]*?)\s*--!?>/g, ' $1 ')
    .replace(/<!--[\s\S]*?--!?>/g, ' ')  // reader notes and the other directives
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
    coverageLost(`${file} has no <body>…</body>, so there is no published text to compare.`);
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
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}

const legalAbs = join(ROOT, LEGAL_DIR);
if (!existsSync(legalAbs)) {
  console.error(`✗ COVERAGE LOST — ${LEGAL_DIR}/ does not exist under ${ROOT}, so the sweep read nothing.`);
  console.error('  A parity guard whose subject directory is gone reports a clean run over an empty set.');
  process.exit(2); // COVERAGE LOST: could not look, not a finding
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
  coverageLost(`no .md found under ${LEGAL_DIR}/, so the sweep that proves this table is complete read nothing.`);
}

// ── the two assertions ──────────────────────────────────────────────────────
let comparisons = 0;
let copiesChecked = 0;

for (const doc of DOCUMENTS) {
  const sourceAbs = join(ROOT, doc.source);
  if (!existsSync(sourceAbs)) {
    coverageLost(`${doc.source} does not exist, so its ${doc.copies.length} published copy/copies are compared to nothing.`);
    continue;
  }
  // ⏱ 2026-09-25 (EXT-4, Q2). A `when=pro|sells|free` paragraph is published only
  // on one side of FullShot's transmits-or-sells facts, so the Markdown side is
  // reduced by the renderer's own dropGated() first. A source that gates a
  // paragraph in a tree where those facts cannot be read is COVERAGE LOST.
  let sourceMd = readFileSync(sourceAbs, 'utf8').replace(/\r\n/g, '\n');
  if (/<!--\s*render:[^>]*\bwhen=(?:pro|sells|free)\b/.test(sourceMd)) {
    let gate;
    try { gate = fullshotPro(ROOT); } catch (e) {
      coverageLost(`${doc.source} gates paragraphs on FullShot Pro and ${e.message}.`);
      continue;
    }
    sourceMd = dropGated(sourceMd, gate);
  }
  const sourceText = markdownVisibleText(sourceMd);
  if (sourceText.length < MIN_CHARACTERS) {
    coverageLost(
      `${doc.source} reduced to ${sourceText.length} character(s), below the ${MIN_CHARACTERS} floor. ` +
        'Two nearly-empty documents agree with each other and with anything else.',
    );
    continue;
  }

  const read = [];
  for (const copy of doc.copies) {
    const abs = join(ROOT, copy.file);
    if (!existsSync(abs)) {
      coverageLost(`${copy.file} does not exist. It is ${copy.what}, and it was compared to nothing.`);
      continue;
    }
    const bodyHtml = htmlBody(readFileSync(abs, 'utf8'), copy.file);
    if (bodyHtml === null) continue;
    const text = publishedForm(visibleText(bodyHtml));
    if (text.length < MIN_CHARACTERS) {
      coverageLost(
        `${copy.file} reduced to ${text.length} character(s) of visible text, below the ` +
          `${MIN_CHARACTERS} floor. An empty page matches an empty page.`,
      );
      continue;
    }
    read.push({ ...copy, text });
    copiesChecked++;
  }

  if (read.length < MIN_COPIES_PER_DOCUMENT) {
    coverageLost(
      `only ${read.length} readable published copy/copies of ${doc.source}, and parity needs ` +
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

// 3 · no published copy has drifted from its RENDERER, byte for byte.
let byteComparisons = 0;
for (const doc of DOCUMENTS) {
  if (typeof doc.renderer !== 'string' || doc.renderer === '') {
    coverageLost(`${doc.source} names no \`renderer\`, so its published BYTES are compared to nothing.`);
    continue;
  }
  if (!existsSync(join(ROOT, doc.renderer))) {
    if (SCANNING_OWN_REPO) {
      coverageLost(`${doc.renderer} does not exist, so no published copy of ${doc.source} is compared to what renders.`);
    }
    continue; // a synthetic tree without the renderer is exercising assertions 1 and 2
  }
  const scratch = mkdtempSync(join(tmpdir(), 'nikatru-ltp-render-'));
  try {
    for (const rel of [doc.renderer, doc.source, ...(doc.rendererReads ?? [])]) {
      if (!existsSync(join(ROOT, rel))) continue; // the renderer names what it could not read
      mkdirSync(dirname(join(scratch, rel)), { recursive: true });
      copyFileSync(join(ROOT, rel), join(scratch, rel));
    }
    for (const copy of doc.copies) mkdirSync(dirname(join(scratch, copy.file)), { recursive: true });
    const r = spawnSync(process.execPath, [join(scratch, doc.renderer)], { cwd: scratch, encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/).slice(-6).join(' ⏎ ');
      coverageLost(`${doc.renderer} exited ${r.status ?? r.error?.code} rendering ${doc.source} into a scratch tree, so no byte comparison ran: ${tail}`);
      continue;
    }
    for (const copy of doc.copies) {
      const servedAbs = join(ROOT, copy.file);
      if (!existsSync(servedAbs)) continue; // already COVERAGE LOST in assertion 1
      const renderedAbs = join(scratch, copy.file);
      if (!existsSync(renderedAbs)) {
        coverageLost(`${doc.renderer} ran and wrote no ${copy.file}. The copy this guard grades is not one the renderer produces.`);
        continue;
      }
      // ⏱ 2026-09-11 — THE MARKERS ARE SET ASIDE ON BOTH SIDES. The renderer now
      // emits <!--email_off--> around the served copy's mailto anchors, so
      // stripping them from the served page alone would call the correct page
      // drift. Stripped from both, the comparison is the words-and-markup one; the
      // raw comparison below is what still notices markers placed differently.
      const renderedRaw = readFileSync(renderedAbs, 'utf8').replace(/\r\n/g, '\n');
      const rendered = renderedRaw.replace(EMAIL_OFF_MARKER, '');
      const servedRaw = readFileSync(servedAbs, 'utf8').replace(/\r\n/g, '\n');
      const served = servedRaw.replace(EMAIL_OFF_MARKER, '');
      byteComparisons++;
      if (served !== rendered) {
        const d = firstDifference(rendered, served);
        fail(
          `${copy.file} is not what ${doc.renderer} renders from ${doc.source} — BYTES, not words (<!--email_off--> markers already set aside). It is ${copy.what}.\n` +
            `      first difference at character ${d.at}\n` +
            `      rendered: ${d.a}\n` +
            `      ${copy.file}: ${d.b}\n` +
            `      A hand edit to a generated legal page is the drift \`--check\` exists to catch: edit ${doc.source} and run ${doc.renderedBy}.`,
        );
      } else if (servedRaw !== renderedRaw) {
        prints.push(
          `${copy.file} differs from ${doc.renderer}'s output ONLY by <!--email_off--> markers, so \`${doc.renderedBy} --check\` exits 1 on a correct page. ` +
            'check-site-integrity.mjs REQUIRES the markers (#575: Cloudflare obfuscation put "[email protected]" in the served bytes) and the renderer does not emit ' +
            'them — regenerating would strip them, turn that guard red and break the live contact address. The fix is at the source: the renderer emits ' +
            'the markers (contracts/legal is outside the unit that added this limb — HANDOFF-stores.md). This print retires itself when the bytes are identical.',
        );
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (SCANNING_OWN_REPO && byteComparisons === 0 && problems.length === 0) {
  coverageLost('assertion 3 compared ZERO published copies to their renderer on the repository itself.');
}

if (comparisons === 0) {
  coverageLost('not one text comparison was performed, so every limb above is dark.');
}

if (problems.length) {
  console.error(`✗ legal text parity — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A published legal document that says two different things in two places is a');
  console.error('  misstatement in whichever one is wrong, and nothing tells you which.');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
}

console.log(
  `ok  legal text parity — ${DOCUMENTS.length} shared legal document(s), ${copiesChecked} published copy/copies ` +
    `compared, ${comparisons} comparison(s): every copy agrees with its siblings AND with its Markdown source ` +
    `(floor ${MIN_CHARACTERS} characters, ${MIN_COPIES_PER_DOCUMENT} copies per document); ${byteComparisons} copy/copies equal their renderer's bytes`,
);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (the fix is at the renderer, outside this guard; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
