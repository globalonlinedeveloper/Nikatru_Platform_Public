#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// text-reductions.mjs — ONE reading of "what does this text actually say".
//
// Two reductions live here, and both exist because a guard that answers them
// differently from its neighbour is enforcing a document nobody serves:
//   · HTML → the visible text a person saw (and the claims they saw emphasised);
//   · source → the code, with comments removed, so PROSE CANNOT SATISFY A CHECK.
//
// That second one is not hypothetical here. The first draft of
// assert-policy-claims.mjs asserted that services/platform/src/routes/events.ts
// never reads `CF-Connecting-IP`, and it failed — on a COMMENT that says the
// header is never read. A guard that greps prose reports the opposite of the
// truth exactly when the code is right.
//
// 🔴 THIS IS NOT A GUARD. It is the single implementation of the reductions
// several guards depend on, and it lives here because the alternative is several
// copies that drift:
//
//   check-site-integrity.mjs   the 1000-character stub floor and the seller's
//                              legal name are measured on visible text, so a
//                              <script> or a base64 image cannot pad a stub.
//   assert-policy-archive.mjs  an archived snapshot is compared to the live page
//                              on visible text, because the two legitimately
//                              differ in <meta robots>, in the canonical link
//                              and in link form — none of which a reader saw.
//   assert-policy-claims.mjs   the <b>-emphasised claim spans are extracted from
//                              the same reduction, so "the page says X" means
//                              the same thing to the claims register as it does
//                              to the stub floor.
//   assert-data-inventory.mjs  a store holding personal data quotes the sentence
//                              that discloses it, and the quote is matched
//                              against the page's visible text.
//
// If two of those disagreed about whether a commented-out paragraph counts as
// page text, one of them would be enforcing a document nobody serves. They now
// cannot disagree.
//
// ⚠️ IT SCANS NOTHING AND OWNS NO COVERAGE CLAIM. Every function here is pure:
// text in, text out. The "did my scan still reach the tree" question belongs to
// the callers, and each of them carries its own coverage self-check. (Which is
// why the phrase assert-guard-coverage.mjs looks for is deliberately NOT written
// out anywhere in this file: it matches raw text, so a comment ABOUT the marker
// would claim a self-check this module does not have — prose satisfying a check
// is the same defect this module exists to prevent, one level up.) That is why this
// file is named in assert-guard-coverage.mjs's NOT_A_SCANNER map with that
// reason, rather than being given a self-check it could not honestly make.
//
// It is FLAT in tooling/ci, not tucked into a lib/ subdirectory, because
// assert-guard-coverage.mjs treats any .mjs below tooling/ci as a guard that has
// escaped its scan — a rule that exists because a "tidy into subfolders" refactor
// once moved 22 guards out of view and the coverage check still printed ok.
// ─────────────────────────────────────────────────────────────────────────────

/** Comment syntaxes, by file extension. A file whose extension is not here is
 *  returned UNCHANGED rather than being guessed at: silently applying C-style
 *  rules to a language that does not have them would delete real code, and a
 *  guard that mangles its own subject is worse than one that reads it whole. */
const COMMENT_STYLES = new Map([
  ['.ts', 'c'],
  ['.tsx', 'c'],
  ['.js', 'c'],
  ['.mjs', 'c'],
  ['.dart', 'c'],
  ['.sql', 'sql'],
  ['.yaml', 'hash'],
  ['.yml', 'hash'],
]);

/** Source with its comments blanked out.
 *
 *  🔴 THE REASON THIS EXISTS: a comment explaining that something never happens
 *  matches a pattern looking for it happening. This repository has been bitten
 *  by that shape twice — a `grep '"r2_buckets"'` that matched the template
 *  comment explaining why there is no r2_buckets, and (found while building
 *  assert-policy-claims.mjs) an `absent` assertion over `cf-connecting-ip` that
 *  fired on the line "CF-Connecting-IP is NEVER read and NEVER stored".
 *
 *  ⚠️ WHAT IT DOES NOT DO: it does not strip string literals, and it does not
 *  parse. `//` is treated as a line comment unless it is preceded by `:` — which
 *  keeps `https://…` inside a string intact and is the whole of its cleverness.
 *  A caller that needs literals gone as well (SQL column scanning does) must say
 *  so; pretending this is a tokeniser would be the second mistake in the class
 *  it exists to prevent.
 *
 *  Replaced with spaces, never deleted, so nothing joins across a removed
 *  comment and line-oriented patterns keep working. */
export function stripSourceComments(source, extension) {
  const style = COMMENT_STYLES.get(String(extension).toLowerCase());
  if (!style) return source;
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let out = source;
  if (style === 'c' || style === 'sql') out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (style === 'c') out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
  if (style === 'sql') out = out.replace(/--[^\n]*/g, blank);
  if (style === 'hash') out = out.replace(/(^|\s)#[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
  return out;
}

/** Single- and double-quoted string literals blanked out, on top of comments.
 *  Used where a NAME must be found in structure rather than in text — the SQL
 *  column scan, where `'card_number'` inside a comment-free string is still not
 *  a column. Quotes are kept so the shape of the statement survives. */
export function stripStringLiterals(source) {
  return source.replace(/'(?:[^'\\\n]|\\.|'')*'|"(?:[^"\\\n]|\\.)*"/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);
}

/** Blank out comments, <script> and <style>.
 *
 *  Replaced with a SPACE rather than deleted: nothing here needs byte offsets,
 *  and keeping words apart is what stops `<b>a</b><b>b</b>` reading as one word
 *  and what keeps the character floor honest.
 *
 *  Why comments go first and go at all: a commented-out link must not be able to
 *  bind a site to a policy it never promised, and script source must not count
 *  as page text. Both were real inputs. */
export function stripInert(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

/** The text a reader saw, whitespace-collapsed. Tags out, entities left as
 *  written — see decodeEntities below for why that is deliberate here. */
export function visibleText(html) {
  return stripInert(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The handful of named entities this site's legal pages actually use, plus the
 *  numeric forms.
 *
 *  ⚠️ DELIBERATELY NOT A FULL ENTITY TABLE. A partial table that pretends to be
 *  complete is the failure mode this repo keeps recording: it would silently
 *  leave `&hellip;` in one guard's idea of the text and not another's. So the
 *  set is small, named, and only used where a HUMAN-AUTHORED register string has
 *  to be compared to page text — never in visibleText itself, where leaving
 *  entities alone is the conservative reading. */
const NAMED_ENTITIES = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&nbsp;', ' '],
  ['&mdash;', '—'],
  ['&ndash;', '–'],
  ['&rarr;', '→'],
  ['&middot;', '·'],
  ['&copy;', '©'],
  ['&trade;', '™'],
  ['&hellip;', '…'],
  ['&rsquo;', '’'],
  ['&lsquo;', '‘'],
  ['&ldquo;', '“'],
  ['&rdquo;', '”'],
]);

/** Decode the entities above, then collapse whitespace. Used to normalise BOTH
 *  sides of a comparison between a register row somebody typed and the page it
 *  quotes, so `&mdash;` and an em dash are the same claim. */
export function decodeEntities(text) {
  let out = text;
  for (const [entity, ch] of NAMED_ENTITIES) out = out.split(entity).join(ch);
  return out
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** The normal form both sides of a page-text comparison are reduced to.
 *  Entities decoded, whitespace collapsed, and the three quote/dash pairs a word
 *  processor substitutes folded onto their ASCII forms — because a register row
 *  is typed by a human in an editor and the page was typed by a human in another
 *  one, and "the apostrophe is curly" is not a legal difference. */
export function normaliseForMatch(text) {
  return decodeEntities(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every `<b>`/`<strong>` span in the page, as the text a reader saw inside it.
 *
 *  🔴 THIS IS THE DOMAIN [pipeline K-3] QUANTIFIES OVER, and its whole value is
 *  that it CANNOT BE SHRUNK WITHOUT EDITING THE PUBLISHED PAGE. A register that
 *  listed its own rows would be a list somebody trims; a register checked
 *  against the emphasis marks in the served HTML can only be trimmed by
 *  un-emphasising a sentence, which is a visible change to the document.
 *
 *  Nested emphasis is flattened rather than double-counted: the OUTER span's
 *  full text is what a reader saw as one emphasised claim.
 *
 *  Returns `{ text, raw }` — `text` normalised for matching, `raw` as written,
 *  so a failure message can quote the page rather than its normal form. */
export function emphasisedSpans(html) {
  const clean = stripInert(html);
  const spans = [];
  const open = /<(b|strong)\b[^>]*>/gi;
  let m;
  while ((m = open.exec(clean)) !== null) {
    const tag = m[1].toLowerCase();
    // Walk forward counting nested opens of the SAME tag so the matching close
    // is found rather than the first one. A non-greedy regex would end the span
    // at an inner </b> and report two half-claims where the page made one.
    let depth = 1;
    let i = open.lastIndex;
    const scan = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
    scan.lastIndex = i;
    let close = -1;
    let s;
    while ((s = scan.exec(clean)) !== null) {
      if (s[0][1] === '/') {
        depth--;
        if (depth === 0) {
          close = s.index;
          break;
        }
      } else depth++;
    }
    if (close === -1) continue; // unclosed tag — the HTML is malformed, not a claim
    const inner = clean.slice(i, close);
    const raw = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (raw !== '') spans.push({ text: normaliseForMatch(raw), raw });
    open.lastIndex = close; // skip past this span so nested opens are not re-entered
  }
  return spans;
}
