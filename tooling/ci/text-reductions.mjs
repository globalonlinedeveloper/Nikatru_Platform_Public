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
//
// ⏱ APPENDED 2026-08-27 — everything above is left EXACTLY as written; this
// corpus appends dated corrections rather than rewriting them. "Two reductions
// live here" is now THREE, and the third is a different KIND of answer:
//
//   · source → WHICH BYTES ARE CODE, BY OFFSET (codeMask / NON_CODE). Not a
//     reduction you match against — it is the same length as its input by
//     construction, so `mask[i]` describes `text[i]`, and the caller goes on
//     reading the ORIGINAL bytes while asking this only WHERE it is. It knows
//     single quotes, double quotes, TEMPLATE LITERALS and their `${…}`
//     substitutions, line and block comments including mid-line, and regex
//     literals.
//
// It came in from assert-guard-coverage.mjs, where it had been the tree's one
// answer to that question and was reachable by nobody: that file exports
// nothing. assert-guards-refuse-empty.mjs needed exactly it, could not have it,
// and shipped `stripStringLiterals` used as an offset-preserving context oracle
// instead — which knows only `'…'` and `"…"`, so a fixture written in a template
// literal read there as LIVE CODE. Both guards import the mask from here now, so
// the two cannot answer differently, and the suite asks the TREE that there is
// no second copy rather than asking a reader to believe it.
//
// Nothing above changes. The mask is text in, text out, no filesystem and no
// tree, exactly like its neighbours, so the reach question still belongs to the
// callers. RE-MEASURED the same day with the ripgrep recipe that travels beside
// markerInCode in assert-guard-coverage.mjs, both flags kept: 49 tracked files
// under tooling import this module and 45 of them take stripSourceComments (39
// and 36 on 2026-08-17; 47 and 44 on 2026-08-25). The move does not move either
// number — both guards already imported this file — and the same query for the
// codeMask brace clause answers 3 (the two guards and this module's own test).
// The "SEVEN … Nine guards" sentence further up is from 2026-08-02 and was
// already four times under by 2026-08-17; re-measure, never read.
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
  // Kotlin, for the Gradle KTS build scripts. C-family delimiters, and its raw
  // string `"""…"""` is already handled by scanQuoted's triple-quote branch —
  // the same branch Dart's `'''` uses.
  //
  // ⚠️ AN UNKNOWN EXTENSION RETURNS THE SOURCE UNCHANGED, SILENTLY. That is the
  // right default for a caller that hands over an unclassified file, and a trap
  // for one that assumes the reduction happened: before these two entries
  // existed, `stripSourceComments(kts, '.kts')` was an identity function, so a
  // scanner over a build script would have been reading its own header comments
  // as code and reporting clean. assert-android-target-sdk.mjs is that caller,
  // and it asserts the reduction actually reduced rather than trusting this map.
  ['.kts', 'c'],
  ['.kt', 'c'],
  // JSONC — the wrangler config format. C-family delimiters, and the branch
  // that matters is scanQuoted's: `"https://…"` inside a string value must NOT
  // be read as opening a line comment, which is the one way a naive JSONC
  // stripper eats the rest of a config. Three guards carry a hand-rolled copy of
  // this (assert-clone-contract, check-migrations, assert-platform-register);
  // assert-no-do-alarms.mjs uses this one instead, and asserts on startup that
  // the entry below still exists — because an unknown extension is returned
  // VERBATIM and says nothing, exactly as the .kts note above records.
  ['.jsonc', 'c'],
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

// ── which BYTES are code, by OFFSET ─────────────────────────────────────────
// ⏱ 2026-08-27. Every rule below matches a shape — `from '…'`, `spawnSync(`,
// `const X =` — and a shape spelled INSIDE a string literal is the same bytes as
// one spelled in code. A fixture body carrying a QUOTED import of a relative
// `./x.mjs` credited x.mjs with being imported by a test that only ever wrote
// it into a temp file. So each match is now asked WHERE IT STARTS.
//
// Not `stripStringLiterals` composed onto the matcher: the path in a GENUINE
// import lives inside the literal too, so matching the blanked text deletes
// every real credit with the fake one. Only the offsets are taken from here;
// the regexes still read the original bytes.
//
// Same length as its input by construction — replacement, never deletion — so
// `mask[i]` describes `text[i]`. NUL marks a byte that is inside a string
// literal or a comment; a template literal's `${…}` is code again, because it
// is. Regex literals are recognised so a `/[^'"]/` cannot open a string that
// never closes and blank the rest of the file.
//
// ⏱ MOVED 2026-08-27, unchanged byte for byte. It was declared BELOW `exercisedBy`,
// which is fine for `exercisedBy` (called late) and fatal for `countCases` (called
// during module evaluation, ~90 lines down): a `const` read before its declaration
// is a ReferenceError, not a fallback — so the ratchet would have crashed rather
// than miscounted. It has no dependencies of its own; keep it above the first
// caller and there is nothing else to know.
//
// ⏱ MOVED HERE 2026-08-27, out of assert-guard-coverage.mjs, because a SECOND
// guard needed exactly this mask and could not have it — that file exported
// nothing at all. assert-guards-refuse-empty.mjs shipped `stripStringLiterals`
// above used as an offset-preserving context oracle instead, and that oracle
// knows only '…' and "…": a fixture written in a TEMPLATE LITERAL, which is how
// a multi-line fixture is naturally written, still read as LIVE CODE there.
// Both guards now read this one implementation, so neither can drift from the
// other, and the residue closed with the move.
//
// ⚠ ONE WORDING CHANGE WAS MADE IN TRANSIT, AND IT IS RECORDED RATHER THAN
// SILENT. The paragraph above used to spell its example out as a quoted
// `import p from` + a dot-slash path, all inside one comment. That is fine in a
// guard nothing else reads; it is NOT fine here, because this module is imported
// by 49 files under tooling and at least one test helper builds a temp copy of
// its guard by scraping `from` + a dot-slash specifier out of the RAW bytes of
// every module it transitively imports. MEASURED: with the example written out,
// five tests in no-hardcoded-strings.test.mjs died ENOENT trying to copy
// tooling/ci/x.mjs, a file that has never existed. The shape is described now
// instead of spelled, which changes no meaning and removes the bait — and it is
// the same defect this mask exists to fix, one level down: a reader with no
// notion of context taking prose for code.
//
// 🔴 THE DECLARATION-ORDER PARAGRAPH ABOVE IS SPENT, and is kept rather than
// deleted because it is a dated record of a real hazard. It was a rule about
// STATEMENT ORDER inside assert-guard-coverage.mjs — "keep it above the first
// caller" — and it no longer applies in either file. An import BINDING is
// hoisted and initialised before the importing module body runs, so the caller
// that made it fatal (`countCases`, still called during that guard's module
// evaluation) cannot read this binding before it exists. VERIFIED by measurement
// on the day of the move: the import statement was written textually BELOW
// `countCases` and the guard still exited 0, ratchet unchanged at the 5791
// case(s) across 148 file(s) it read before this change added its own tests. Byte-for-byte identity was checked the same way and not
// asserted: the OLD implementation was sliced out of the pre-move file into a
// standalone module and BOTH were run over the same 453 tracked
// .mjs/.js/.ts/.tsx files, 11,768,858 characters — zero differing masks, and
// NON_CODE equal. The same corpus was also hashed per file before and after the
// move: 451 of 453 hashes identical, the two that moved being exactly the two
// files this change edits, whose INPUT bytes changed and which the same-input
// run above covers.
//
// The bytes below are the original ones. The ONLY edits are the two `export`
// keywords: the mask a guard gets from here is the mask it got from there.
export const NON_CODE = '\u0000';
const REGEX_MAY_START = /(?:[([{,;:=!&|?+\-*%~^<>\n]|\b(?:return|typeof|case|in|of|do|else|yield|await|new|delete|void|instanceof))\s*$/;
const maskCache = new Map();
export const codeMask = (text) => {
  const hit = maskCache.get(text);
  if (hit !== undefined) return hit;
  const m = text.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) m[k] = NON_CODE; };
  const tpl = [];
  let brace = 0;
  let i = 0;
  const scanString = (start, q) => {
    let k = start + 1;
    while (k < text.length) {
      const c = text[k];
      if (c === '\\') { k += 2; continue; }
      if (c === q) { blank(start, k + 1); return k + 1; }
      if (q === '`' && c === '$' && text[k + 1] === '{') {
        blank(start, k + 2);
        tpl.push(brace);
        brace = 0;
        return k + 2;
      }
      if (q !== '`' && c === '\n') { blank(start, k); return k; }
      k++;
    }
    blank(start, text.length);
    return text.length;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl < 0 ? text.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && REGEX_MAY_START.test(text.slice(Math.max(0, i - 12), i))) {
      let k = i + 1;
      let cls = false;
      while (k < text.length && text[k] !== '\n') {
        const d = text[k];
        if (d === '\\') { k += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { k++; break; }
        k++;
      }
      blank(i, k);
      i = k;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { i = scanString(i, c); continue; }
    if (c === '{') { brace++; i++; continue; }
    if (c === '}') {
      if (brace === 0 && tpl.length) {
        brace = tpl.pop();
        m[i] = NON_CODE;
        i = scanString(i, '`');
        continue;
      }
      if (brace > 0) brace--;
      i++;
      continue;
    }
    i++;
  }
  const out = m.join('');
  if (maskCache.size > 400) maskCache.clear();
  maskCache.set(text, out);
  return out;
};

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
