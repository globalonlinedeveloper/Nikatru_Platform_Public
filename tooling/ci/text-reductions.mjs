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
// The SOURCE reduction has a wider blast radius than that list, and knowing its
// real size matters — on 2026-08-02 a defect in it was triaged against a stale
// "five callers" and the true number is SEVEN: assert-analytics-contract,
// assert-data-inventory, assert-e2e-legs, assert-flag-exposure,
// assert-licence-register, assert-policy-claims and assert-worker-error-sink
// all take stripSourceComments. Nine guards import this module in total.
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

/** Keywords after which a `/` opens a REGEX rather than dividing. Without this
 *  set, `return /x/.test(s)` reads as a division — the exact mis-parse recorded
 *  in PR #128, where it silently mis-read four files. */
const REGEX_MAY_FOLLOW = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/** End of a quoted run beginning at `start`, or -1 if it never closes.
 *  Dart's triple quotes and JS template literals span lines; a plain JS/Dart
 *  quote does not, and hitting a newline means we mis-read the opener — which
 *  is reported as "unterminated" so the caller can KEEP the text. */
function scanQuoted(source, start, isSql) {
  const q = source[start];
  const n = source.length;
  if (!isSql && (q === "'" || q === '"') && source.startsWith(q + q + q, start)) {
    const e = source.indexOf(q + q + q, start + 3);
    return e === -1 ? -1 : e + 3;
  }
  if (q === '`') return scanTemplate(source, start);
  let i = start + 1;
  while (i < n) {
    const c = source[i];
    if (isSql) {
      // No `''`-is-an-escaped-quote branch, deliberately. Mutation-proven
      // redundant 2026-08-02: consuming `''` as close-then-reopen leaves the
      // set of in-string characters identical, and this function's only
      // consumer never blanks a string — so the branch changed no output on any
      // input, terminated or not. A branch that cannot change an outcome is the
      // shape this repo deletes rather than keeps "for safety".
      if (c === q) return i + 1;
      i++;
      continue;
    }
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (c === '\n') return -1;
    i++;
  }
  return -1;
}

/** End of a template literal, `${…}` substitutions walked as code so a nested
 *  string or template inside one does not end the outer literal early. */
function scanTemplate(source, start) {
  const n = source.length;
  let i = start + 1;
  while (i < n) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && source[i + 1] === '{') {
      const e = scanBraced(source, i + 1);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    i++;
  }
  return -1;
}

/** End of a `{…}` run, counting depth and skipping quoted runs inside it. */
function scanBraced(source, start) {
  const n = source.length;
  let depth = 0;
  let i = start;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      const e = scanQuoted(source, i, false);
      if (e === -1) return -1;
      i = e;
      continue;
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

/** End of a regex literal (flags included), or -1 if the `/` was division after
 *  all. `[…]` is tracked because a `/` inside a character class does not close
 *  the literal, and quotes inside one — `/['"]/` — are not string openers. */
function scanRegex(source, start) {
  const n = source.length;
  let i = start + 1;
  let inClass = false;
  while (i < n) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') return -1;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < n && /[a-z]/i.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}

/** C-family and SQL: one left-to-right pass that knows the difference between a
 *  comment marker and the same two characters inside something else. */
function blankCFamily(source, isSql) {
  const n = source.length;
  const out = source.split('');
  const blankRange = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  // The last significant token, only to the resolution the `/` question needs:
  // 'value' (an identifier, literal, `)` or `]`) means division; anything else
  // means a regex may open here.
  let prev = 'operator';

  while (i < n) {
    const c = source[i];
    const d = i + 1 < n ? source[i + 1] : '';

    if ((isSql && c === '-' && d === '-') || (!isSql && c === '/' && d === '/')) {
      const e = source.indexOf('\n', i);
      blankRange(i, e === -1 ? n : e);
      i = e === -1 ? n : e;
      continue;
    }

    if (c === '/' && d === '*') {
      const e = source.indexOf('*/', i + 2);
      if (e === -1) { prev = 'operator'; i += 2; continue; } // never closes → KEEP
      blankRange(i, e + 2);
      i = e + 2;
      continue;
    }

    if (c === "'" || c === '"' || (!isSql && c === '`')) {
      const e = scanQuoted(source, i, isSql);
      prev = 'value';
      i = e === -1 ? i + 1 : e; // unterminated → KEEP, and step one char
      continue;
    }

    if (!isSql && c === '/' && prev !== 'value') {
      const e = scanRegex(source, i);
      if (e !== -1) { prev = 'value'; i = e; continue; }
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      prev = REGEX_MAY_FOLLOW.has(source.slice(i, j)) ? 'operator' : 'value';
      i = j;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoO._]/.test(source[j])) j++;
      prev = 'value';
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c === ')' || c === ']' ? 'value' : 'operator';
    i++;
  }
  return out.join('');
}

/** YAML: `#` opens a comment only at the start of a line or after whitespace AND
 *  outside a quoted scalar, so `description: "a # b"` keeps its text. Quoting is
 *  tracked per LINE — a YAML scalar that spans lines is not quoted. */
function blankHash(source) {
  return source
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === '\\' && quote === '"') i++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i) + ' '.repeat(line.length - i);
        }
      }
      return line;
    })
    .join('\n');
}

// Source with its comments blanked out.
//
// (Written as LINE comments, not a block one, because the delimiters ARE the
// subject: a block comment cannot contain the close delimiter it is describing,
// and the last person who worked around that with a zero-width space left an
// invisible character in a shared module.)
//
// 🔴 THE REASON THIS EXISTS: a comment explaining that something never happens
// matches a pattern looking for it happening. This repository has been bitten
// by that shape twice — a `grep '"r2_buckets"'` that matched the template
// comment explaining why there is no r2_buckets, and (found while building
// assert-policy-claims.mjs) an `absent` assertion over `cf-connecting-ip` that
// fired on the line "CF-Connecting-IP is NEVER read and NEVER stored".
//
// 🔴 2026-08-02 — IT USED TO DELETE CODE IT HAD NOT COMMENTED OUT, in exactly
// the shape PR #128 found one level up in assert-guard-coverage.mjs. The old
// body ran a block-comment regex FIRST, over raw text, so any `/*` — inside a
// `//` line, inside a string, inside a regex literal — opened a block comment
// that ran to the next `*/` anywhere in the file.
//
//   · services/subly-api/src/middleware/cors.ts line 15 is a LINE comment
//     naming the glob `services/*/wrangler.jsonc`. The reduction handed to the
//     seven importing guards had that file's `import { cors } …`, its two type
//     imports and `const LOCALHOST = /…/` blanked out — 158 characters of real
//     code, deleted by a comment that mentions a path.
//   · separately, the `[^:]` line-comment hack blanked the rest of
//     `` `${u.protocol}//${u.host}/api/${projectId}/envelope/` `` in BOTH
//     error-sink.ts files: the character before `//` there is `}`, not `:`, so
//     the endpoint the Worker actually posts to was invisible to the guard
//     whose job is to check it.
//
// Neither surfaced as a failure. Every importing guard exited 0.
//
// ⚠️ DIRECTION OF ERROR — THE ONE PROPERTY TO PRESERVE. This reduction ERRS
// TOWARDS KEEPING TEXT. Where it cannot be certain, it does not delete: a `/*`
// that never closes, a quote with no partner, a `/` it cannot classify as regex
// or division — each is left exactly as written, so the worst case is that a
// COMMENT SURVIVES. That direction is deliberate, because the two failure modes
// are not equally visible: a surviving comment makes an `absent` assertion CRY
// WOLF, which a human sees and fixes, while deleted code makes every check over
// it quietly pass. This module exists to stop prose satisfying a check; it must
// not do that by deleting the code the check is about.
//
// WHAT IT NOW KNOWS, because every one of these was a real mis-read: `//` and
// `/*` inside a `//` line comment · `*/` and `//` inside a string, a template
// literal (including `${…}` substitutions) or a Dart `'''` block · a regex
// literal containing quotes or slashes, `/['"]/` · `return /x/.test(s)` as a
// regex and not a division · `--` inside a SQL string · `#` inside a quoted
// YAML scalar. It is still NOT a type-aware parser and it still does not strip
// string literals — a caller that needs literals gone (the SQL column scan
// does) says so with stripStringLiterals, because in a .ts file the SQL LIVES
// in the literals and blanking them would blank the subject.
//
// Replaced with spaces, never deleted, so nothing joins across a removed
// comment, byte offsets are unchanged and line-oriented patterns keep working.
export function stripSourceComments(source, extension) {
  const style = COMMENT_STYLES.get(String(extension).toLowerCase());
  if (!style) return source;
  if (style === 'hash') return blankHash(source);
  return blankCFamily(source, style === 'sql');
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
