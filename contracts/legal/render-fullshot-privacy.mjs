#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-fullshot-privacy.mjs — the two published FullShot privacy policies are
// RENDERED from contracts/legal/fullshot-privacy.md, not typed twice.
//
//   node contracts/legal/render-fullshot-privacy.mjs           rewrite both files
//   node contracts/legal/render-fullshot-privacy.mjs --check   exit 1 on drift
//
// ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
// The served copy carried a provenance comment that said, accurately:
//
//     "No guard in either repo can see across the repository boundary …
//      so THIS COMMENT is the only thing joining the two copies."
//
// A published legal document held together by a request. Both files are in one
// tree now ([ADR 067] decision 1), so the text can have ONE source and the two
// files can be derived from it. `tooling/ci/assert-legal-text-parity.mjs` is the
// gate; this is the generator.
//
// ── A RENDERER FOR THIS DOCUMENT, AND IT SAYS SO ─────────────────────────────
// This is NOT a general Markdown implementation and must never grow into one. It
// understands exactly the constructs this policy uses — h1/h2/h3, paragraphs,
// unordered lists, `---` for the footer rule, and inline strong / em / code /
// link — and it REFUSES anything else rather than guessing. A general renderer
// would be a dependency, and nothing under contracts/ may need a build step or
// an install to be consumed ([ADR 067] decision 1).
//
// ── PRESENTATION LIVES IN THE MARKDOWN, AS A DIRECTIVE ───────────────────────
// Three blocks in this document are not plain paragraphs: a `.meta` date line
// with non-breaking separators, a `.lead` intro, and a `.callout` box with a
// tag. Keying those off a block's INDEX would break the day a sentence is added;
// keying them off the block's text would be a second copy of the text. So the
// markdown carries a directive comment on the line above:
//
//     <!-- render: class=meta nbsp-dots -->
//     <!-- render: class=lead -->
//     <!-- render: callout=In one line -->
//
// A Markdown reader ignores HTML comments, so the source still reads as prose.
//
// ── THE CHROME IS PER TARGET AND IS HELD HERE ────────────────────────────────
// The two files differ ONLY in their head: the served copy carries a canonical
// link, a meta description and a provenance comment; the store copy does not,
// and the two palette comments are worded differently. That difference is real —
// one is a web page, the other is a file inside a zip — so it is declared in
// TARGETS below rather than smuggled into the shared text.
//
// ⚠️ THE STYLE BLOCK'S VALUES ARE GENERATED TOKENS. `assert-palette-consistent.
// mjs` reads both of these files and caught the imported policy's own greys as
// the only dissenting declaration on the whole site. Edit
// `packages/tokens/tokens/*.json`, never the literals below.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SOURCE_REL = 'contracts/legal/fullshot-privacy.md';
const check = process.argv.includes('--check');

/** The shared CSS. One string, so the two files cannot disagree about it. */
const STYLE_BODY = `  :root { --ink:#0B1220; --muted:#586275; --line:#E2E8F0; --accent:#2E6FF2; }
  * { box-sizing: border-box; }
  body { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px;
         font: 16px/1.65 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         color: var(--ink); background: #fff; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 34px 0 8px; padding-top: 14px; border-top: 1px solid var(--line); }
  h3 { font-size: 16px; margin: 20px 0 4px; }
  p, li { color: var(--ink); }
  .meta { color: var(--muted); font-size: 14px; margin: 0 0 8px; }
  .lead { font-size: 17px; color: #333; }
  ul { padding-left: 22px; }
  li { margin: 5px 0; }
  code { background: #f4f4f6; padding: 1px 5px; border-radius: 4px; font-size: 14px; }
  .callout { background: #f0f6ff; border: 1px solid #cfe0fb; border-radius: 8px;
             padding: 14px 16px; margin: 16px 0; }
  .tag { display:inline-block; background:#e8f0fe; color:var(--accent);
         border-radius: 999px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
           color: var(--muted); font-size: 14px; }
  a { color: var(--accent); }`;

/** The two published copies, and the head each one needs. */
const TARGETS = [
  {
    rel: 'sites/nikatru/fullshot/privacy.html',
    what: 'served at nikatru.com/fullshot/privacy — the URL every store listing points at',
    head: [
      '<link rel="canonical" href="https://nikatru.com/fullshot/privacy">',
      '<meta name="description" content="How FullShot handles your data: everything is processed locally on your device and nothing is transmitted.">',
      '<!-- GENERATED from contracts/legal/fullshot-privacy.md by',
      '     contracts/legal/render-fullshot-privacy.mjs. DO NOT EDIT THIS FILE.',
      '     Edit the Markdown and re-run the renderer.',
      '',
      '     ⏱ REPLACES THE PROVENANCE COMMENT THAT USED TO STAND HERE, which named',
      '     the extension copy as the source of truth and then said: "No guard in',
      '     either repo can see across the repository boundary … so THIS COMMENT is',
      '     the only thing joining the two copies." That was true, and it was a',
      '     published legal document held together by a request. Both copies are now',
      '     in one tree; `tooling/ci/assert-legal-text-parity.mjs` compares their',
      '     visible text to each other AND to the Markdown, and refuses to pass over',
      '     fewer than two copies. -->',
    ],
    styleComment: [
      '  /* Nikatru brand palette. The imported policy shipped its own greys',
      '     (#1a1a1a / #555 / #e2e2e2 / #1a73e8); assert-palette-consistent.mjs',
      '     caught them as the only dissenting declaration on the whole site. The',
      '     values below are the generated ones from sites/_shared/assets/tokens.css',
      '     -- edit packages/tokens/tokens/*.json, never this line. */',
    ],
  },
  {
    rel: 'extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html',
    what: 'the copy submitted to Chrome, Edge and AMO',
    head: [
      '<!-- GENERATED from contracts/legal/fullshot-privacy.md by',
      '     contracts/legal/render-fullshot-privacy.mjs. DO NOT EDIT THIS FILE.',
      '     Edit the Markdown and re-run the renderer.',
      '     The served copy at nikatru.com/fullshot/privacy is rendered from the same',
      '     source; tooling/ci/assert-legal-text-parity.mjs holds the two equal. -->',
    ],
    styleComment: [
      '  /* Nikatru brand palette, kept identical to the served copy at',
      '     nikatru.com/fullshot/privacy. The original greys (#1a1a1a / #555 /',
      '     #e2e2e2 / #1a73e8) were caught by assert-palette-consistent.mjs in the',
      '     platform repo as the only dissenting declaration on the whole site.',
      '     Source of these values: sites/_shared/assets/tokens.css, generated from',
      '     packages/tokens/tokens/*.json. */',
    ],
  },
];

// ── the source ──────────────────────────────────────────────────────────────
const md = readFileSync(join(ROOT, SOURCE_REL), 'utf8').replace(/\r\n/g, '\n');

/** Drop the leading HTML comment block(s) that are notes to readers of the
 *  Markdown itself — anything that is not a `render:` directive. */
const lines = md.split('\n');

/** Inline: strong, em, code, links. Everything else is passed through, which is
 *  why `assertNoUnknownInline` runs first. */
function inline(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('`', i)) {
      const end = text.indexOf('`', i + 1);
      if (end === -1) throw new Error(`unterminated code span: ${text.slice(i, i + 40)}`);
      const body = text.slice(i + 1, end).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      out += `<code>${body}</code>`;
      i = end + 1;
      continue;
    }
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end === -1) throw new Error(`unterminated bold: ${text.slice(i, i + 40)}`);
      out += `<strong>${inline(text.slice(i + 2, end))}</strong>`;
      i = end + 2;
      continue;
    }
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end === -1) throw new Error(`unterminated italic: ${text.slice(i, i + 40)}`);
      out += `<em>${inline(text.slice(i + 1, end))}</em>`;
      i = end + 1;
      continue;
    }
    if (text[i] === '[') {
      const close = text.indexOf('](', i);
      if (close !== -1) {
        const end = text.indexOf(')', close + 2);
        if (end === -1) throw new Error(`unterminated link: ${text.slice(i, i + 40)}`);
        const label = text.slice(i + 1, close);
        const href = text.slice(close + 2, end);
        // `rel="nofollow"` on outbound http(s) only. A mailto is not a link the
        // crawler follows and the served copy has never carried one there.
        const rel = /^https?:/.test(href) ? ' rel="nofollow"' : '';
        out += `<a href="${href}"${rel}>${inline(label)}</a>`;
        i = end + 1;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * REFUSE WHAT IS NOT UNDERSTOOD. A renderer that silently passes an unknown
 * construct through produces a page that looks right in a diff and is wrong in a
 * browser — and this document is a legal filing on three stores. Only the inline
 * HTML this policy actually uses is allowed through verbatim.
 */
const ALLOWED_RAW_HTML = /^<\/?(?:u|br)>$/;
function assertNoUnknownInline(text, where) {
  for (const m of text.matchAll(/<[^>]*>/g)) {
    if (!ALLOWED_RAW_HTML.test(m[0])) {
      // A `<` inside a code span is escaped by `inline` and is not raw HTML.
      const before = text.slice(0, m.index);
      const ticks = (before.match(/`/g) ?? []).length;
      if (ticks % 2 === 1) continue;
      throw new Error(`unrecognised inline HTML ${m[0]} in ${where}`);
    }
  }
}

// ── block scan ──────────────────────────────────────────────────────────────
const blocks = [];
let pending = null; // the directive attached to the next block
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const directive = /^<!--\s*render:\s*(.*?)\s*-->$/.exec(line);
  if (directive) { pending = directive[1]; continue; }
  if (/^<!--/.test(line)) {
    // A note to readers of the Markdown. Skip to the end of the comment.
    while (i < lines.length && !/-->\s*$/.test(lines[i])) i++;
    continue;
  }
  if (line.trim() === '') continue;

  if (/^#{1,3} /.test(line)) {
    const level = line.match(/^#+/)[0].length;
    assertNoUnknownInline(line, `heading "${line}"`);
    blocks.push({ kind: `h${level}`, text: line.replace(/^#+\s+/, '') });
    pending = null;
    continue;
  }
  if (line.trim() === '---') { blocks.push({ kind: 'hr' }); pending = null; continue; }
  if (/^- /.test(line)) {
    const items = [];
    while (i < lines.length && /^- /.test(lines[i])) {
      assertNoUnknownInline(lines[i], 'a list item');
      items.push(lines[i].slice(2));
      i++;
    }
    i--;
    blocks.push({ kind: 'ul', items });
    pending = null;
    continue;
  }
  // A paragraph: one source line, because this document has no wrapped ones and
  // a renderer that joined lines would silently change the bytes if one appeared.
  assertNoUnknownInline(line, 'a paragraph');
  blocks.push({ kind: 'p', text: line, directive: pending });
  pending = null;
}

// ── render ──────────────────────────────────────────────────────────────────
function directiveOf(raw) {
  const d = { class: null, nbspDots: false, callout: null };
  if (!raw) return d;
  // Consume the known keys and REFUSE a leftover. Splitting on whitespace is
  // wrong here and was: `callout=In one line` carries a value with spaces, and a
  // splitter read `line` as a second directive. So each key is lifted out by
  // name and whatever is left must be blank — an unknown directive is a refusal,
  // never a silent no-op that renders a paragraph as a plain one.
  let rest = raw;
  rest = rest.replace(/(^|\s)nbsp-dots(?=\s|$)/, (m, p1) => { d.nbspDots = true; return p1; });
  rest = rest.replace(/(^|\s)class=(\S+)/, (m, p1, v) => { d.class = v; return p1; });
  rest = rest.replace(/(^|\s)callout=(.*)$/, (m, p1, v) => { d.callout = v; return p1; });
  if (rest.trim() !== '') throw new Error(`unknown render directive(s): "${rest.trim()}" in "${raw}"`);
  return d;
}

function body() {
  const out = [];
  let afterHr = false;
  const footerLines = [];
  for (const b of blocks) {
    if (b.kind === 'hr') { afterHr = true; continue; }
    if (afterHr) {
      if (b.kind !== 'p') throw new Error('only a paragraph may follow the footer rule');
      footerLines.push(inline(b.text));
      continue;
    }
    if (b.kind === 'h1') { out.push(`<h1>${inline(b.text)}</h1>`); continue; }
    if (b.kind === 'h2' || b.kind === 'h3') {
      out.push('');
      out.push(`<${b.kind}>${inline(b.text)}</${b.kind}>`);
      continue;
    }
    if (b.kind === 'ul') {
      out.push('<ul>');
      for (const item of b.items) out.push(`  <li>${inline(item)}</li>`);
      out.push('</ul>');
      continue;
    }
    const d = directiveOf(b.directive);
    let text = inline(b.text);
    // The published copy separates the three facts with `&nbsp;·&nbsp;` and
    // KEEPS the ordinary spaces either side, so the dot cannot end a line on its
    // own. Dropping them would be a one-character rendering change to a legal
    // document's date line, which is exactly the class of silent edit the guard
    // downstream exists to notice.
    if (d.nbspDots) text = text.replace(/ · /g, ' &nbsp;·&nbsp; ');
    if (d.callout) {
      out.push('');
      out.push('<div class="callout">');
      out.push(`<span class="tag">${d.callout}</span>`);
      out.push(`<p style="margin:8px 0 0">${text}</p>`);
      out.push('</div>');
      continue;
    }
    if (d.class === 'lead') { out.push(''); out.push(`<p class="lead">${text}</p>`); continue; }
    if (d.class) { out.push(`<p class="${d.class}">${text}</p>`); continue; }
    out.push(`<p>${text}</p>`);
  }
  if (footerLines.length === 0) throw new Error('no footer block after the `---` rule');
  out.push('');
  out.push('<footer>');
  for (const line of footerLines) out.push(line);
  out.push('</footer>');
  return out;
}

const title = blocks.find((b) => b.kind === 'h1');
if (!title) throw new Error(`${SOURCE_REL} has no level-1 heading, so neither page would have a title`);

// COVERAGE SELF-CHECK. A source that parsed to almost nothing renders as a valid
// but empty page, which reads exactly like a clean run.
const headingCount = blocks.filter((b) => b.kind === 'h2').length;
if (blocks.length < 20 || headingCount < 5) {
  console.error(`✗ COVERAGE LOST — ${SOURCE_REL} parsed to only ${blocks.length} block(s) and ${headingCount} section(s).`);
  console.error('  A near-empty policy renders as valid HTML and reads exactly like a clean run.');
  process.exit(1);
}

function render(target) {
  const out = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${inline(title.text)}</title>`,
    ...target.head,
    '<style>',
    ...target.styleComment,
    STYLE_BODY,
    '</style>',
    '</head>',
    '<body>',
    '',
    ...body(),
    '',
    '</body>',
    '</html>',
  ];
  return out.join('\n') + '\n';
}

let drift = 0;
for (const target of TARGETS) {
  const abs = join(ROOT, target.rel);
  const rendered = render(target);
  if (!check) {
    writeFileSync(abs, rendered, 'utf8');
    console.log(`ok  wrote ${target.rel}`);
    continue;
  }
  let current;
  try { current = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'); }
  catch { current = null; }
  if (current === null) {
    console.error(`✗ ${target.rel} does not exist — it is ${target.what}.`);
    drift++;
    continue;
  }
  if (current !== rendered) {
    console.error(`✗ ${target.rel} is not what ${SOURCE_REL} renders to.`);
    console.error(`  It is ${target.what}, and a published legal document has drifted from its source.`);
    console.error('  Run: node contracts/legal/render-fullshot-privacy.mjs');
    drift++;
  }
}

if (drift) process.exit(1);
console.log(`ok  FullShot privacy policy — ${TARGETS.length} published copy/copies rendered from ${SOURCE_REL} ` +
  `(${blocks.length} block(s), ${headingCount} numbered section(s))`);
