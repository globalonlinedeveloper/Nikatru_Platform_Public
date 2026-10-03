// ─────────────────────────────────────────────────────────────────────────────
// assert-codeql-lite.mjs — the repo's recurring CodeQL alert shapes, caught BEFORE
// the push, from the lane, in seconds, instead of by CodeQL in CI ~40 jobs later.
//
// 🔴 WHY THIS EXISTS, MEASURED (lane codeql-lite, lead brief 2026-10-03). Three PRs
// in one day went red only on the security job's "This pull request adds no CodeQL
// alert its own dispositions do not answer" step (assert-codeql-pr-no-new-high.mjs):
// #1189 (alert 602, js/file-system-race — `existsSync(p)`, then a write of p),
// #1187 (alert 596, an import a fix left unused) and #1176 (a new alert after a fix
// round). Each cost a CI cycle and a fix round. The repo's FIXED high/critical
// alerts by rule were missing-regexp-anchor 29, file-system-race 27,
// incomplete-sanitization 21, incomplete-multi-character-sanitization 12,
// incomplete-url-substring-sanitization 7, incomplete-hostname-regexp 6 and
// insecure-temporary-file 5: about a hundred alerts a local check could have stopped.
//
// ── WHAT IT FLAGS (each printed `file:line <CodeQL rule id> message`) ─────────
//   js/file-system-race          an fs check (exists/stat/lstat/access/open, Sync
//                                or not) of a path, then a readFile/writeFile/appendFile/
//                                open of the SAME path expression later in the same
//                                function, where the check dominates the use — except
//                                exists() then a READ, which CodeQL does not report (as
//                                tooling/ci/test/fixtures/fs-spy-preload.mjs measured).
//                                A check in an `if (…)` condition guards only its own
//                                branches, and the code after the `if` only when a branch
//                                ends in return/throw/break/continue: `if (!existsSync(p))
//                                coverageLost(…)` falls through, so a later read of p is
//                                not on a checked branch (assert-elf-page-alignment.mjs).
//                                → read once in a try (ENOENT = missing), or write 'wx'.
//   js/regex/missing-regexp-anchor  a regex that VALIDATES a URL or host — tested (`.test`/
//                                `.exec`/`.match`/`.search`) and holding a host on a common
//                                TLD or a `//`, or tested against a URL-named value — with
//                                neither `^` nor `$`; or `^a|b` / `a|b$`, an anchor that
//                                binds to one alternative while no other alternative carries
//                                one (`^`, `$`, `\b`, `(^|\/)`). Not in a test file (CodeQL
//                                leaves tests out of this rule) and not an assertion's pattern.
//   js/incomplete-hostname-regexp   an UNESCAPED `.` inside a host on a common TLD in a
//                                regex literal or a `new RegExp('…')` string.
//   js/incomplete-url-substring-sanitization  includes/startsWith/endsWith of a URL or
//                                host literal (or a const naming one), or an indexOf of
//                                one COMPARED with -1/0 — `startsWith('https://h/')` with
//                                its slash and `endsWith('.h.com')` with its dot pass.
//   js/incomplete-sanitization   `.replace(<string or non-global regex>, …)` of an
//                                escaping meta-character (CodeQL's set less `%`: ' " \ &
//                                < > \n \r \t * | { } [ ] $) or `..`, which replaces only
//                                the first; and a backslash escape (`c` → `\c`, `\$&`)
//                                with no earlier step escaping backslashes (#540, 581).
//   js/incomplete-multi-character-sanitization  `.replace(re, '')` done once, where re
//                                can begin `<!--` or `../` followed by no literal text, or
//                                `<` (or `</`) then a tag NAME it does not spell — a class or
//                                wildcard — or then script/style/iframe: the removal can
//                                splice one back together. `<string>…` cannot re-form
//                                `<script`, and a removal anchored to the end (or start) of
//                                the string has nothing on that side to splice with. A
//                                fixed-point loop, or a later replace of the same opener in
//                                the chain, passes.
//   js/insecure-temporary-file   a write/open of a path built from `tmpdir()` (directly
//                                or through a const) that is not under `mkdtemp…` and
//                                carries no exclusive `wx` flag.
//   js/unused-local-variable     an `import` binding the file never names again (#1187).
//
// ── SCOPE: WHAT CodeQL WOULD SEE ON THIS PR, NOT THE WHOLE TREE ──────────────
// Default: the TRACKED .js/.mjs/.cjs/.ts/.mts/.cts/.jsx/.tsx files (any case of the
// extension, any script in the path) this branch changed against merge-base(HEAD,
// origin/main) — committed, staged or not — minus the `paths-ignore` of
// .github/codeql/codeql-config.yml (read, never restated). An UNTRACKED file is not part
// of the change a push carries (affected-guards and the pre-push hook leave it out too; a
// main checkout can hold hundreds of scratch files), so it is graded, whole, only under
// `--untracked`. CodeQL's
// PR analysis is diff-informed and so is the CI step this pre-empts, so a finding
// counts only on a CHANGED line; the one exception is an unused import, which a fix
// creates by deleting the LAST use on another line (the #1187 shape), so it counts
// anywhere in a changed file. `--all` grades every tracked file whole (a report: the
// tree is not clean, and the default stays diff-scoped so old code blocks nobody);
// `--files a b c` grades those files whole, and grading none of them (each not JS/TS, or
// in paths-ignore) is COVERAGE LOST, never a green. `--base <ref>` (or CODEQL_LITE_BASE, which
// ci.yml sets to origin/<the PR's base branch> so a stacked PR is graded against its own
// base) replaces origin/main.
//
// A line may carry `// codeql-lite: allow <rule> — <reason of 10+ characters>` in a
// COMMENT to suppress that one rule on THAT line only (never the next one, and never from
// inside a string, template or regex literal); each suppression is printed with its
// reason. A suppression with a short reason is itself a finding.
//
// ⚠️ THIS IS A TOKEN-LEVEL APPROXIMATION OF CodeQL, NOT CodeQL. No JavaScript parser
// ships to tooling/ (no root package.json; every guard here is dependency-free), so
// it tokenizes (comments, strings, templates, regex literals) and matches shapes.
// It misses what needs data flow across functions; CI's CodeQL step stays the sweep.
// What it does flag, CodeQL flags too, so the fix (or the allow line) costs seconds.
//
// ── HOW IT WAS CALIBRATED (2026-10-03) ───────────────────────────────────────
// RECALL: the pre-fix files of eight real alerts each give exactly the alert —
// #1189/602 at listing-qa.mjs:105, #547 render.mjs, #1148 new-channel.mjs (races);
// #579 (url substring); #596 (unused import); 581 ledger.mjs (backslash escape);
// #569 and #1154 (comment strip once). PRECISION: the changed lines of #1161, #1164,
// #1154 and #1148 — merged with the CodeQL PR rule live, so CodeQL reported nothing
// on them — give nothing. Each exclusion above is one of those merged lines: an
// exists-then-read, a check inside a block the write is outside of, a `<meta …>`
// removal, an indexOf kept for later, a `.replace('%', '')`.
//
// ⏱ 2026-10-03 (the post-merge review of #1199): `--all` on main gave 13 findings, every
// one a line CodeQL analysed and never flagged — an exists check whose `if` falls through,
// an alternation whose other alternatives carry their own anchor (or that validates no URL),
// a `<string>…</string>` removal. Each shape is now a green test; `--all` on main is 0.
//
// Exit 0 = clean. 1 = a finding. 2 = COVERAGE LOST: git could not name the change, the
// CodeQL config could not be read, a file it should grade could not be read or tokenized
// (an unterminated string, comment, template or regex; unbalanced brackets), or `--files`
// named nothing it grades.
//
// Usage: node tooling/ci/assert-codeql-lite.mjs [--base <ref>] [--untracked] [--all | --files <f>…] [--root <dir>] [--quiet]
// Tests: tooling/ci/test/codeql-lite.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from './lane-detect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const CODEQL_CONFIG_REL = '.github/codeql/codeql-config.yml';
/** The extensions CodeQL's javascript-typescript extractor reads, as this guard grades them. */
export const CODE_FILE = /\.(?:m|c)?[jt]sx?$/i;
export const DEFAULT_BASE = 'origin/main';
export const ALLOW = 'codeql-lite: allow';
export const MIN_REASON = 10;

export const RULES = Object.freeze({
  race: 'js/file-system-race',
  anchor: 'js/regex/missing-regexp-anchor',
  hostRe: 'js/incomplete-hostname-regexp',
  urlSub: 'js/incomplete-url-substring-sanitization',
  sanit: 'js/incomplete-sanitization',
  multi: 'js/incomplete-multi-character-sanitization',
  tmp: 'js/insecure-temporary-file',
  unused: 'js/unused-local-variable',
  allow: 'codeql-lite/allow-reason',
});

/** CodeQL's RegExpPatterns::getACommonTld(). */
const TLD = '(?:com|org|edu|gov|uk|net|io)(?![a-z0-9])';

// ── tokenizer ────────────────────────────────────────────────────────────────

const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCT3 = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??='];
const PUNCT2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

export class TokenizeError extends Error {}

/**
 * Tokens of JS/TS source: { t: 'id'|'num'|'str'|'tpl'|'re'|'p', v, line, start, end, td }.
 * `str` carries the cooked value, `re` { source, flags } in `v`, `tpl` the raw text.
 * A template's `${…}` expressions are tokenized in-stream after its `tpl` token, with
 * `td` (template depth) one higher. Throws TokenizeError on anything unterminated.
 */
export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  // a stack of open template expressions: each holds the brace depth inside it
  const tplStack = [];
  if (src.startsWith('#!')) while (i < n && src[i] !== '\n') i++;
  const push = (t, v, start, startLine) => toks.push({ t, v, line: startLine, start, end: i, td: tplStack.length });
  const regexOk = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'id') return KEYWORD_BEFORE_REGEX.has(p.v);
    if (p.t !== 'p') return false;
    return !(p.v === ')' || p.v === ']' || p.v === '}');
  };
  // scan a template body from just after ` or }, until ` (done) or ${ (pushes an expression)
  const templateBody = (start, startLine) => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '`') { i++; return true; }
      if (c === '$' && src[i + 1] === '{') { i += 2; tplStack.push(0); return false; }
      if (c === '\n') line++;
      i++;
    }
    throw new TokenizeError(`unterminated template literal opened on line ${startLine}`);
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029') { i++; continue; }
    const start = i;
    const startLine = line;
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e === -1) throw new TokenizeError(`unterminated block comment opened on line ${startLine}`);
      for (let k = i; k < e; k++) if (src[k] === '\n') line++;
      i = e + 2;
      continue;
    }
    if (c === '\'' || c === '"') {
      let v = '';
      i++;
      for (;;) {
        if (i >= n || src[i] === '\n') throw new TokenizeError(`unterminated string on line ${startLine}`);
        const ch = src[i];
        if (ch === c) { i++; break; }
        if (ch === '\\') {
          const e = src[i + 1];
          if (e === '\n') { line++; i += 2; continue; }
          if (e === '\r' && src[i + 2] === '\n') { line++; i += 3; continue; }
          v += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[e] ?? e;
          i += 2;
          continue;
        }
        v += ch;
        i++;
      }
      push('str', v, start, startLine);
      continue;
    }
    if (c === '`') {
      i++;
      const done = templateBody(start, startLine);
      // the tpl token spans the literal head; its expressions follow it in-stream
      toks.push({ t: 'tpl', v: src.slice(start, i), line: startLine, start, end: i, td: tplStack.length - (done ? 0 : 1) });
      continue;
    }
    if (tplStack.length && c === '}' && tplStack[tplStack.length - 1] === 0) {
      tplStack.pop();
      i++;
      const done = templateBody(start, startLine);
      toks.push({ t: 'tpl', v: src.slice(start, i), line: startLine, start, end: i, td: tplStack.length - (done ? 0 : 1), cont: true });
      continue;
    }
    if (/[A-Za-z_$#\u0080-\uffff]/.test(c)) {
      i++;
      while (i < n && /[A-Za-z0-9_$\u0080-\uffff]/.test(src[i])) i++;
      push('id', src.slice(start, i), start, startLine);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      i++;
      while (i < n && /[0-9A-Za-z_.]/.test(src[i])) {
        if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '+' || src[i + 1] === '-')) i++;
        i++;
      }
      push('num', src.slice(start, i), start, startLine);
      continue;
    }
    if (c === '/' && regexOk()) {
      i++;
      let inClass = false;
      for (;;) {
        if (i >= n || src[i] === '\n') throw new TokenizeError(`unterminated regular expression on line ${startLine}`);
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        i++;
      }
      const source = src.slice(start + 1, i);
      i++;
      const fs = i;
      while (i < n && /[a-z]/.test(src[i])) i++;
      push('re', { source, flags: src.slice(fs, i) }, start, startLine);
      continue;
    }
    let p = PUNCT3.find((x) => src.startsWith(x, i)) ?? PUNCT2.find((x) => src.startsWith(x, i)) ?? c;
    // `?.5` is a conditional and a number, not optional chaining
    if (p === '?.' && /[0-9]/.test(src[i + 2] ?? '')) p = '?';
    i += p.length;
    if (tplStack.length) {
      if (p === '{') tplStack[tplStack.length - 1]++;
      else if (p === '}') tplStack[tplStack.length - 1]--;
    }
    push('p', p, start, startLine);
  }
  if (tplStack.length) throw new TokenizeError('unterminated template expression at end of file');
  return toks;
}

/** Bracket matching over the token stream, and each '{' judged a function body or not. */
export function structure(toks) {
  const match = new Array(toks.length).fill(-1);
  const stack = [];
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (OPEN[t.v]) stack.push(k);
    else if (t.v === ')' || t.v === ']' || t.v === '}') {
      const o = stack.pop();
      if (o === undefined || OPEN[toks[o].v] !== t.v) throw new TokenizeError(`unbalanced '${t.v}' on line ${t.line}`);
      match[o] = k;
      match[k] = o;
    }
  }
  if (stack.length) throw new TokenizeError(`unclosed '${toks[stack[stack.length - 1]].v}' opened on line ${toks[stack[stack.length - 1]].line}`);
  // fn[k] = the index of the innermost function body '{' enclosing token k, or -1
  const fn = new Array(toks.length).fill(-1);
  const scopes = [];
  const NOT_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
  const isFnBody = (k) => {
    let j = k - 1;
    if (j < 0) return false;
    if (toks[j].t === 'p' && toks[j].v === '=>') return true;
    // a TS return type `): T<U> {` — walk back over the type to its ':'
    if (!(toks[j].t === 'p' && toks[j].v === ')')) {
      let steps = 0;
      while (j >= 0 && steps < 40 && (toks[j].t === 'id' || toks[j].t === 'str' || (toks[j].t === 'p' && /^(?:\.|<|>|\[|\]|\||&|,|\?)$/.test(toks[j].v)))) { j--; steps++; }
      if (!(j >= 1 && toks[j].v === ':' && toks[j - 1].v === ')')) return false;
      j--;
    }
    const o = match[j];
    if (o < 1) return false;
    const before = toks[o - 1];
    if (before.t === 'id') return !NOT_FN.has(before.v);
    if (before.t === 'p' && before.v === '>') return true; // a generic `f<T>(…) {`
    return false;
  };
  for (let k = 0; k < toks.length; k++) {
    while (scopes.length && match[scopes[scopes.length - 1]] < k) scopes.pop();
    fn[k] = scopes.length ? scopes[scopes.length - 1] : -1;
    if (toks[k].t === 'p' && toks[k].v === '{' && isFnBody(k)) scopes.push(k);
  }
  // an expression-bodied arrow `(x) => expr` is a function too: its scope is the `=>`,
  // and it runs to the first `,` `;` or unmatched closer at its own level
  for (let a = 0; a < toks.length; a++) {
    if (!(toks[a].t === 'p' && toks[a].v === '=>') || toks[a + 1]?.v === '{') continue;
    let e = a + 1;
    while (e < toks.length) {
      const t = toks[e];
      if (t.t === 'p' && (t.v === '(' || t.v === '[' || t.v === '{') && match[e] > e) { e = match[e] + 1; continue; }
      if (t.t === 'p' && (t.v === ',' || t.v === ';' || t.v === ')' || t.v === ']' || t.v === '}')) break;
      e++;
    }
    for (let k = a + 1; k < e; k++) if (fn[k] === fn[a]) fn[k] = a;
  }
  // blk[k] = the innermost '{' of any kind enclosing token k, or -1 (a check inside a
  // block the use is outside of does not dominate it)
  const blk = new Array(toks.length).fill(-1);
  const open = [];
  for (let k = 0; k < toks.length; k++) {
    while (open.length && match[open[open.length - 1]] < k) open.pop();
    blk[k] = open.length ? open[open.length - 1] : -1;
    if (toks[k].t === 'p' && toks[k].v === '{') open.push(k);
  }
  return { match, fn, blk };
}

// ── helpers over tokens ──────────────────────────────────────────────────────

/** The top-level argument token ranges [from, to) of the call whose '(' is at `open`. */
function argRanges(toks, match, open) {
  const close = match[open];
  const out = [];
  let from = open + 1;
  const td = toks[open].td;
  for (let k = open + 1; k < close; k++) {
    const t = toks[k];
    if (t.t === 'p' && (t.v === '(' || t.v === '[' || t.v === '{') && match[k] > k) { k = match[k]; continue; }
    if (t.t === 'p' && t.v === ',' && t.td === td) { out.push([from, k]); from = k + 1; }
  }
  if (from < close) out.push([from, close]);
  return out;
}

function rangeText(src, toks, [a, b]) {
  if (a >= b) return '';
  let end = 0;
  for (let k = a; k < b; k++) end = Math.max(end, toks[k].end);
  return src.slice(toks[a].start, end).replace(/\s+/g, '');
}

/** `const NAME = 'literal'` (or a template with no expression) anywhere in the file. */
function constStrings(toks) {
  const out = new Map();
  for (let k = 0; k + 3 < toks.length; k++) {
    if (toks[k].t === 'id' && (toks[k].v === 'const') && toks[k + 1].t === 'id' && toks[k + 2].v === '=') {
      const v = toks[k + 3];
      const after = toks[k + 4];
      const ends = !after || (after.t === 'p' && (after.v === ';' || after.v === ',')) || after.line > v.line;
      if (!ends) continue;
      if (v.t === 'str') out.set(toks[k + 1].v, v.v);
      else if (v.t === 'tpl' && !v.v.includes('${') && v.v.endsWith('`')) out.set(toks[k + 1].v, v.v.slice(1, -1));
    }
  }
  return out;
}

/** The string value of a one-token argument: a literal, or a const naming one. */
function stringValue(toks, [a, b], consts) {
  if (b - a !== 1) return null;
  const t = toks[a];
  if (t.t === 'str') return t.v;
  if (t.t === 'tpl' && !t.v.includes('${') && t.v.endsWith('`')) return t.v.slice(1, -1);
  if (t.t === 'id' && consts.has(t.v)) return consts.get(t.v);
  return null;
}

const isCallAt = (toks, k) => toks[k]?.t === 'id' && toks[k + 1]?.t === 'p' && toks[k + 1].v === '(';
const isMember = (toks, k) => toks[k - 1]?.t === 'p' && (toks[k - 1].v === '.' || toks[k - 1].v === '?.');

/** The names this file binds to node:fs / node:fs/promises members, and its fs namespaces. */
function fsBindings(toks) {
  const named = new Map(); // local → imported
  const ns = new Set(['fs', 'fsp', 'fsPromises', 'promises']);
  for (let k = 0; k < toks.length; k++) {
    if (!(toks[k].t === 'id' && toks[k].v === 'import') || isMember(toks, k)) continue;
    const imp = parseImport(toks, k);
    if (!imp || !/^(?:node:)?fs(?:\/promises)?$/.test(imp.from)) continue;
    for (const b of imp.bindings) {
      if (b.kind === 'named') named.set(b.local, b.imported);
      else ns.add(b.local);
    }
  }
  return { named, ns };
}

/** The fs member a call at k names (`existsSync(` or `fs.existsSync(`), or null. */
function fsCallName(toks, k, fsb) {
  if (!isCallAt(toks, k)) return null;
  const v = toks[k].v;
  if (isMember(toks, k)) {
    const obj = toks[k - 2];
    if (obj?.t === 'id' && fsb.ns.has(obj.v)) return v;
    if (obj?.t === 'id' && obj.v === 'promises' && toks[k - 4]?.t === 'id' && fsb.ns.has(toks[k - 4].v)) return v;
    return null;
  }
  return fsb.named.get(v) ?? null;
}

/** An `import … from '…'` statement at k: its bindings and source, or null (dynamic import, type import). */
export function parseImport(toks, k) {
  let j = k + 1;
  const t1 = toks[j];
  if (!t1 || (t1.t === 'p' && (t1.v === '(' || t1.v === '.'))) return null;
  if (t1.t === 'str') return { from: t1.v, bindings: [], end: j };
  if (t1.t === 'id' && t1.v === 'type' && !(toks[j + 1]?.t === 'id' && toks[j + 1].v === 'from') && toks[j + 1]?.v !== ',') return null;
  const bindings = [];
  while (j < toks.length) {
    const t = toks[j];
    if (t.t === 'id' && t.v === 'from' && toks[j + 1]?.t === 'str') return { from: toks[j + 1].v, bindings, end: j + 1 };
    if (t.t === 'p' && t.v === '*' && toks[j + 1]?.v === 'as' && toks[j + 2]?.t === 'id') {
      bindings.push({ kind: 'ns', local: toks[j + 2].v, line: toks[j + 2].line });
      j += 3;
      continue;
    }
    if (t.t === 'p' && t.v === '{') {
      j++;
      while (j < toks.length && !(toks[j].t === 'p' && toks[j].v === '}')) {
        let typeOnly = false;
        if (toks[j].t === 'id' && toks[j].v === 'type' && toks[j + 1]?.t === 'id' && toks[j + 1].v !== 'as') { typeOnly = true; j++; }
        if (toks[j].t === 'id' || toks[j].t === 'str') {
          const imported = toks[j].v;
          let local = imported;
          let line = toks[j].line;
          if (toks[j + 1]?.t === 'id' && toks[j + 1].v === 'as' && toks[j + 2]?.t === 'id') { local = toks[j + 2].v; line = toks[j + 2].line; j += 2; }
          bindings.push({ kind: 'named', imported, local, line, typeOnly });
        }
        j++;
        if (toks[j]?.t === 'p' && toks[j].v === ',') j++;
      }
      j++;
      continue;
    }
    if (t.t === 'id' && j === k + 1) { bindings.push({ kind: 'default', local: t.v, line: t.line }); j++; continue; }
    if (t.t === 'p' && t.v === ',') { j++; continue; }
    return null;
  }
  return null;
}

// ── regex shape helpers ──────────────────────────────────────────────────────

/** The regex source with character classes blanked, so `[.]` and `[^>]` are not read as terms. */
function blankClasses(source) {
  let out = '';
  let inClass = false;
  for (let k = 0; k < source.length; k++) {
    const c = source[k];
    if (c === '\\') { out += inClass ? '__' : c + (source[k + 1] ?? ''); k++; continue; }
    if (!inClass && c === '[') { inClass = true; out += '_'; continue; }
    if (inClass && c === ']') { inClass = false; out += '_'; continue; }
    out += inClass ? '_' : c;
  }
  return out;
}

/** The top-level alternatives of a regex source. */
function topAlternatives(source) {
  const s = blankClasses(source);
  const out = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) { out.push(s.slice(from, k)); from = k + 1; }
  }
  out.push(s.slice(from));
  return out;
}

const HOST_IN_REGEX = new RegExp(`[a-z0-9-]\\\\\\.${TLD}`, 'i');
const UNESCAPED_HOST_DOT = new RegExp(`(?<=[A-Za-z0-9-])(?<!\\\\[A-Za-z])\\.(?:[A-Za-z0-9-]+\\\\?\\.)*${TLD}`, 'i');

/** A tested regex that reads as a URL or a bare host: a protocol (or `//`) first, or nothing but a host. */
function urlShaped(blanked) {
  const s = blanked.replace(/^(?:\(\?:|\()+/, '');
  if (/^(?:[a-z]+\??|\([a-z|?]+\))?:?\\\/\\\//i.test(s)) return true;
  return /^(?:[a-z0-9-]|\\\.|\(\?:|[()?*+])+$/i.test(s);
}

/** A regex that names a URL or a host: a host on a common TLD, or a `//`. */
const URLISH_REGEX = new RegExp(`${HOST_IN_REGEX.source}|\\\\\\/\\\\\\/`, 'i');
/** A tested value whose name says it holds a URL, a host or an origin. */
export const URL_SUBJECT = /(?:url|uri|href|host|origin|domain|referr?er|redirect|location|endpoint|callback|link)/i;
/** Any anchor or pseudo-anchor in a (class-blanked) alternative: ^ $ \b \B or a lookbehind. */
const HAS_ANCHOR = /(?<!\\)[\^$]|\\[bB]|\(\?<[=!]/;

/**
 * One regex source's own shape findings: [{ rule, message }]. `use` is how the regex is
 * used: 'test' (.test/.exec, or the pattern of .match/.search), 'replace' (the pattern of
 * .replace/.replaceAll/.split — CodeQL's precedence check skips those) or 'other'.
 * `urlSubject`: the tested value is named like a URL. `testFile`: CodeQL's anchor query
 * leaves test files out, so the anchor rule does too.
 */
export function regexFindings(source, use = 'other', { urlSubject = false, testFile = false } = {}) {
  const out = [];
  const s = blankClasses(source);
  if (UNESCAPED_HOST_DOT.test(s)) {
    out.push({ rule: RULES.hostRe, message: `the regex /${source}/ has an unescaped '.' in a host name, so it matches more hosts than the one it names — escape it as \\.` });
  }
  const alts = topAlternatives(source);
  const startAnchored = (a) => a.startsWith('^');
  const endAnchored = (a) => /(?<!\\)\$$/.test(a);
  // the anchor rule is about a regex that VALIDATES a URL or host, as CodeQL's is
  const validates = !testFile && use === 'test' && (URLISH_REGEX.test(s) || urlSubject);
  if (alts.length > 1) {
    const first = startAnchored(alts[0]);
    const last = endAnchored(alts[alts.length - 1]);
    // `^a|b$` is the trim idiom, anchored at both ends on purpose; only a ONE-sided anchor
    // misleads, and only when no OTHER alternative carries an anchor of its own
    // (`(^|\/)x(\/|$)|\.md$`, `\bload\b|^\s*more`, `REPLACE|\.example$|^$` are deliberate)
    const others = first ? alts.slice(1) : alts.slice(0, -1);
    if (validates && first !== last && !others.some((a) => HAS_ANCHOR.test(a))) {
      out.push({ rule: RULES.anchor, message: `the regex /${source}/ anchors only ${first ? 'its first' : 'its last'} alternative: '|' binds looser than '^'/'$' — group the alternatives, ^(?:a|b)$` });
    }
    return out;
  }
  if (!testFile && use === 'test' && HOST_IN_REGEX.test(s) && urlShaped(s) && !startAnchored(s) && !endAnchored(s)) {
    out.push({ rule: RULES.anchor, message: `the regex /${source}/ tests for a host with neither '^' nor '$', so it matches anywhere in a URL (https://evil.example/?x=<host>) — anchor it` });
  }
  return out;
}

const URL_SUB = [
  new RegExp(`^([a-z]*:?//)?\\.?([a-z0-9-]+\\.)+${TLD}(:[0-9]+)?/?$`, 'i'),
  /^https?:\/\/([a-z0-9-]+\.)+([a-z]+)(:[0-9]+)?\/?$/i,
];
const URL_WITH_PATH = /^https?:\/\/([a-z0-9-]+\.)+([a-z]+)(:[0-9]+)?\/[a-z0-9/_-]+$/i;

/** Is `method(target)` an incomplete URL substring check? */
export function urlSubstringUnsafe(method, target) {
  if (typeof target !== 'string') return false;
  const hostish = URL_SUB.some((re) => re.test(target)) || (URL_WITH_PATH.test(target) && (method === 'includes' || method === 'indexOf'));
  if (!hostish) return false;
  if (method === 'startsWith' && /^[a-z]*:?\/\/[^/]+\//i.test(target)) return false; // the host is closed by its '/'
  if (method === 'endsWith' && target.startsWith('.')) return false; // a suffix that starts at a label boundary
  return true;
}

/** CodeQL IncompleteSanitization's metachar() set, less `%` (a `.replace('%', '')` merged
 *  unflagged in #1148), plus its path and %XX shapes. */
const META = new Set([...'\'"\\&<>\n\r\t*|{}[]$']);
function sanitizedChar(value) {
  if (META.has(value)) return true;
  if (['..', '/..', '../', '/../'].includes(value)) return true;
  return /^%[0-9A-Fa-f]{2}$/.test(value);
}
/** A regex source that matches exactly one literal string: its value, or null. */
function literalOfRegex(source) {
  if (/^\\[nrt]$/.test(source)) return ({ n: '\n', r: '\r', t: '\t' })[source[1]];
  if (/^\\.$/.test(source)) return source[1];
  if (/^[^\\^$.|?*+()[\]{}]+$/.test(source)) return source;
  if (/^(?:\\\.){2}(?:\\?\/)?$/.test(source)) return source.startsWith('\\.\\.') && source.length > 4 ? '../' : '..';
  return null;
}
/** Literal text (a letter, digit or `_`) a regex spells outside its classes and escapes. */
const spellsText = (blanked) => /[A-Za-z0-9]/.test(blanked.replace(/\\./g, '').replace(/\(\?(?:[:=!]|<[=!])/g, '').replace(/\{\d+(?:,\d*)?\}/g, '').replace(/_+/g, ''));

/**
 * The dangerous string a removal regex can begin with — CodeQL's DangerousPrefix model —
 * or null:
 *   `<!--`, and `../` / `/..`, when what follows spells no literal text (CodeQL: a regex
 *     matching the explicit content of a comment or a path is not a sanitizer —
 *     `<!--\s*email_off\s*-->` cannot be spliced from its own pieces);
 *   `<script` when `<` (or `</`) is followed by script/style/iframe (or cript/scrip), or by
 *     a NAME it does not spell — a class, a wildcard, `\w`/`\S`/`\s`. A specific tag
 *     (`<meta …>`, `<p>…</p>`, `<string>…</string>`) cannot re-form one.
 * A regex anchored to the end (or the start) of the string, without the m flag, removes
 * everything on that side, so nothing is left there to splice with: null.
 */
export function dangerousOpener(source, flags = '') {
  const s = blankClasses(source).replace(/^(?:\(\?:|\()+/, '');
  if (!flags.includes('m') && topAlternatives(source).length === 1 && (s.startsWith('^') || /(?<!\\)\$\)*$/.test(s))) return null;
  const rest = (m) => s.slice(m[0].length);
  let m = /^\\?<!--/.exec(s);
  if (m) return spellsText(rest(m)) ? null : '<!--';
  if (/^\\?<!(?:\.|_|\\[sSwW])/.test(s)) return '<!--';
  m = /^\\?<(?:\\?\/\??)?/.exec(s);
  if (m) {
    const r = rest(m).replace(/^(?:\(\?:|\()+/, '');
    if (/^(?:[a-z]+\|)*(?:script|style|iframe|scrip|cript)/i.test(r)) return '<script';
    if (/^(?:_|\.|\\[sSwW])/.test(r)) return '<script';
    return null;
  }
  m = /^(?:\\\.){2}(?:\\?\/|_)/.exec(s) ?? /^\\?\/(?:\\\.){2}/.exec(s);
  if (m) return spellsText(rest(m)) ? null : '../';
  return null;
}

/** Does a regex source match a backslash? */
const matchesBackslash = (source) => source.includes('\\\\');

// ── the rules ────────────────────────────────────────────────────────────────

/** fstat is not here: it takes a descriptor, and open-then-fstat(fd)-then-read(fd) is the FIXED shape. */
const FS_CHECK = new Set(['open', 'openSync', 'exists', 'existsSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync']);
const FS_USE = new Set(['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'open', 'openSync']);
const TMP_SINK = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'open', 'openSync', 'createWriteStream']);

/** A test file, as CodeQL's anchor query leaves them out: a test/tests/__tests__ directory, or *.test.* / *.spec.*. */
export const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/i;
const EXITS = new Set(['return', 'throw', 'break', 'continue']);

/**
 * Every finding in one file's source: [{ line, rule, message }]. Throws TokenizeError.
 * `testFile`: the source is a test (TEST_FILE), so the anchor rule does not apply.
 */
export function analyse(src, { testFile = false } = {}) {
  const toks = tokenize(src);
  const { match, fn, blk } = structure(toks);
  const consts = constStrings(toks);
  const fsb = fsBindings(toks);
  const out = [];
  const add = (line, rule, message) => out.push({ line, rule, message });

  /** The first token of the expression statement holding k: back over `(…)`/`[…]` groups, to the
   *  nearest `;` `{` `}` `,` or an unclosed `(`/`[` (the start of an argument). */
  const statementStart = (k) => {
    let s = k;
    while (s > 0) {
      const x = toks[s - 1];
      if (x.t === 'p' && (x.v === ')' || x.v === ']') && match[s - 1] >= 0) { s = match[s - 1]; continue; }
      if (x.t === 'p' && (x.v === ';' || x.v === '{' || x.v === '}' || x.v === ',' || x.v === '(' || x.v === '[')) break;
      s--;
    }
    return s;
  };
  /** One past the last token of the statement holding k. */
  const statementEnd = (k) => {
    let e = k;
    while (e < toks.length && !(toks[e].t === 'p' && (toks[e].v === ';' || ((toks[e].v === '}' || toks[e].v === ')') && match[e] < k)))) {
      if (toks[e].t === 'p' && (toks[e].v === '(' || toks[e].v === '[' || toks[e].v === '{') && match[e] > e) { e = match[e] + 1; continue; }
      e++;
    }
    return e;
  };
  /** `x = x.replace(…)` (or `x = x.trim().replace(…)`) with an enclosing for/while/do loop. */
  const inFixpointLoop = (k) => {
    const s = statementStart(k);
    if (!(toks[s]?.t === 'id' && toks[s + 1]?.v === '=' && toks[s + 2]?.t === 'id' && toks[s + 2].v === toks[s].v)) return false;
    for (let b = blk[k]; b !== -1; b = blk[b]) {
      const prev = toks[b - 1];
      if (prev?.t === 'id' && prev.v === 'do') return true;
      if (prev?.t === 'p' && prev.v === ')' && match[b - 1] > 0 && ['for', 'while'].includes(toks[match[b - 1] - 1]?.v)) return true;
    }
    return false;
  };

  /** Is token k inside the arguments of `assert(…)`, `assert.x(…)`, `t.assert.x(…)` or `expect(…)`?
   *  An assertion on output validates nothing, so its regex is no URL check. */
  const inAssertion = (k) => {
    for (let j = k - 1; j >= 0; j--) {
      const x = toks[j];
      if (x.t !== 'p') continue;
      if ((x.v === ')' || x.v === ']' || x.v === '}') && match[j] < j) { j = match[j]; continue; }
      if (x.v === ';' || x.v === '{' || x.v === '}') return false;
      if (x.v === '(' && toks[j - 1]?.t === 'id') {
        const callee = toks[j - 1].v;
        if (callee === 'assert' || callee === 'expect') return true;
        if (isMember(toks, j - 1) && toks[j - 3]?.t === 'id' && toks[j - 3].v === 'assert') return true;
      }
    }
    return false;
  };

  /** One past the last token of the statement (a `{…}` block, or up to its `;`) starting at b. */
  const bodyEnd = (b) => {
    if (toks[b]?.t === 'p' && toks[b].v === '{') return match[b] + 1;
    let e = b;
    while (e < toks.length && !(toks[e].t === 'p' && (toks[e].v === ';' || toks[e].v === '}'))) {
      if (toks[e].t === 'p' && (toks[e].v === '(' || toks[e].v === '[' || toks[e].v === '{') && match[e] > e) {
        const o = e;
        e = match[e] + 1;
        // a block statement's `{…}` (`if (…) {…}`, `else {…}`, `try {…}`) ends it, unless it continues
        const blockOf = toks[o].v === '{' && (toks[o - 1]?.v === ')' || /^(?:else|try|finally|do)$/.test(toks[o - 1]?.v ?? ''));
        if (blockOf && !/^(?:else|catch|finally|while)$/.test(toks[e]?.v ?? '')) return e;
        continue;
      }
      e++;
    }
    return toks[e]?.v === ';' ? e + 1 : e;
  };
  /** Does the statement [b, e) end by leaving — its last statement a return/throw/break/continue? */
  const leaves = (b, e) => {
    if (toks[b]?.v === '{' && toks[b].t === 'p') {
      let last = -1;
      for (let j = b + 1; j < e - 1; j = Math.max(j + 1, bodyEnd(j))) if (toks[j].v !== ';') last = j;
      return last !== -1 && toks[last].t === 'id' && EXITS.has(toks[last].v);
    }
    return toks[b]?.t === 'id' && EXITS.has(toks[b].v);
  };
  /** The `if` whose condition holds token k: { then: [a, b), else: [a, b) | null, end }, or null. */
  const ifOf = (k) => {
    for (let j = k - 1; j >= 0; j--) {
      const x = toks[j];
      if (x.t !== 'p') continue;
      if ((x.v === ')' || x.v === ']' || x.v === '}') && match[j] < j) { j = match[j]; continue; }
      if (x.v === ';' || x.v === '{') return null;
      if (x.v === '(' && toks[j - 1]?.t === 'id' && toks[j - 1].v === 'if') {
        const tb = match[j] + 1;
        const te = bodyEnd(tb);
        const hasElse = toks[te]?.t === 'id' && toks[te].v === 'else';
        const eb = hasElse ? te + 1 : -1;
        const ee = hasElse ? (toks[eb]?.v === 'if' ? bodyEnd(match[eb + 1] + 1) : bodyEnd(eb)) : -1;
        return { then: [tb, te], else: hasElse ? [eb, ee] : null, end: hasElse ? ee : te };
      }
    }
    return null;
  };
  /** Is the use at u on a branch the check at c decided? Not when c is an `if` condition and u
   *  sits after an `if` none of whose branches leaves — the use runs whatever the check said. */
  const onCheckedBranch = (c, u) => {
    const g = ifOf(c);
    if (!g) return true;
    const within = ([a, b]) => u >= a && u < b;
    if (within(g.then) || (g.else && within(g.else))) return true;
    if (u < g.end) return true;
    return leaves(...g.then) || (g.else !== null && leaves(...g.else));
  };

  // js/file-system-race — what CodeQL reports, as measured by this repo's own runtime
  // spy (tooling/ci/test/fixtures/fs-spy-preload.mjs): every check→use pair on one path
  // in one function where the check dominates the use, EXCEPT exists() followed by a
  // READ (a vanished file makes that read throw; it cannot act on stale state), and a use
  // after an `if (check)` that falls through (assert-elf-page-alignment.mjs:300→308).
  const checks = [];
  for (let k = 0; k < toks.length; k++) {
    const name = fsCallName(toks, k, fsb);
    if (!name) continue;
    const args = argRanges(toks, match, k + 1);
    if (!args.length) continue;
    const pathText = rangeText(src, toks, args[0]);
    if (FS_USE.has(name)) {
      const flag = args[1] ? stringValue(toks, args[1], consts) : null;
      const read = /^readFile/.test(name) || (/^open/.test(name) && (!args[1] || (flag !== null && /^(?:r|rs|sr)$/.test(flag))));
      const dominates = (c) => c.blk === -1 || (c.blk < k && match[c.blk] > k);
      const hit = checks.findLast((c) => c.fn === fn[k] && c.pathText === pathText && dominates(c) && !(read && /^exists/.test(c.name)) && onCheckedBranch(c.k, k));
      if (hit) {
        add(toks[k].line, RULES.race, `${name}(${pathText}) acts on a path ${hit.name}() checked on line ${toks[hit.k].line}; the file can change in between — ${read ? "read once in a try and treat err.code === 'ENOENT' as missing" : "write with flag 'wx' (or read once in a try) instead of deciding on an earlier look"}`);
      }
    }
    if (FS_CHECK.has(name)) checks.push({ k, name, pathText, fn: fn[k], blk: blk[k] });
  }

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];

    // regex literals: hostname dots, anchors
    if (t.t === 're') {
      const nextIsTest = toks[k + 1]?.v === '.' && isCallAt(toks, k + 2) && (toks[k + 2].v === 'test' || toks[k + 2].v === 'exec');
      const argOf = toks[k - 1]?.v === '(' && isCallAt(toks, k - 2) && isMember(toks, k - 2) ? toks[k - 2].v : null;
      const asserts = inAssertion(k);
      const use = nextIsTest || ['match', 'search', 'matchAll'].includes(argOf) ? (asserts ? 'other' : 'test') : ['replace', 'replaceAll', 'split'].includes(argOf) ? 'replace' : 'other';
      // the tested value: .test(<arg>), or the receiver of .match(/re/)
      const subject = nextIsTest ? rangeText(src, toks, argRanges(toks, match, k + 3)[0] ?? [0, 0]) : argOf ? (toks[k - 4]?.v ?? '') : '';
      for (const f of regexFindings(t.v.source, use, { urlSubject: URL_SUBJECT.test(String(subject)), testFile })) add(t.line, f.rule, f.message);
      continue;
    }
    if (t.t !== 'id' || !isCallAt(toks, k)) continue;

    // new RegExp('…')
    if (t.v === 'RegExp' && toks[k - 1]?.t === 'id' && toks[k - 1].v === 'new') {
      const args = argRanges(toks, match, k + 1);
      const v = args.length ? stringValue(toks, args[0], consts) : null;
      if (v !== null) for (const f of regexFindings(v)) if (f.rule === RULES.hostRe) add(t.line, f.rule, f.message);
      continue;
    }

    if (!isMember(toks, k)) continue;
    const method = t.v;
    const args = argRanges(toks, match, k + 1);

    // js/incomplete-url-substring-sanitization — CodeQL's InclusionTest: includes(), or an
    // indexOf() COMPARED with -1/0 (or under `~`); an indexOf() stored for later is not a check
    if (['includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith'].includes(method) && args.length) {
      const v = stringValue(toks, args[0], consts);
      const close = match[k + 1];
      const after = toks[close + 1];
      const tested = !/indexOf$/i.test(method) ||
        (after?.t === 'p' && /^(?:[!=]==?|[<>]=?)$/.test(after.v) && /^-?[01]$/.test(`${toks[close + 2]?.v === '-' ? '-' : ''}${toks[close + (toks[close + 2]?.v === '-' ? 3 : 2)]?.v ?? ''}`)) ||
        (statementStart(k) < k && toks.slice(statementStart(k), k).some((x) => x.t === 'p' && x.v === '~'));
      if (tested && urlSubstringUnsafe(method, v)) {
        add(t.line, RULES.urlSub, `.${method}(${JSON.stringify(v)}) is not a URL check: '${v}' can sit anywhere in a hostile URL (https://evil.example/?${v}) — parse with new URL() and compare the host whole`);
      }
      continue;
    }

    // js/incomplete-sanitization and js/incomplete-multi-character-sanitization
    if (method === 'replace' && args.length >= 2) {
      // CodeQL skips a replace repeated to a fixed point: `x = x.replace(…)` inside a loop
      if (inFixpointLoop(k)) continue;
      const [a0, a1] = args;
      const first = toks[a0[0]];
      const replacement = stringValue(toks, a1, consts);
      if (a0[1] - a0[0] === 1 && (first.t === 'str' || (first.t === 'tpl' && !first.v.includes('${')))) {
        const v = first.t === 'str' ? first.v : first.v.slice(1, -1);
        if (sanitizedChar(v)) add(t.line, RULES.sanit, `.replace(${JSON.stringify(v)}, …) with a string replaces only the FIRST occurrence — use replaceAll or a /g regex`);
      } else if (a0[1] - a0[0] === 1 && first.t === 're') {
        const { source, flags } = first.v;
        const lit = literalOfRegex(source);
        if (!flags.includes('g') && lit !== null && sanitizedChar(lit)) {
          add(t.line, RULES.sanit, `.replace(/${source}/${flags}, …) has no g flag, so it replaces only the FIRST occurrence`);
        }
        // a backslash escape (`c` → `\c`, or `\$&`): the backslashes must be escaped first,
        // earlier in the chain (or by this same regex, or by JSON.stringify)
        const escapes = typeof replacement === 'string' && (/^\\\$(?:&|\d)$/.test(replacement) || (lit !== null && replacement === `\\${lit}`));
        if (flags.includes('g') && escapes && !matchesBackslash(source)) {
          const before = toks.slice(statementStart(k), k);
          const escapedFirst = before.some((x, i) => (x.t === 're' && matchesBackslash(x.v.source)) || (x.t === 'id' && x.v === 'stringify' && before[i - 2]?.v === 'JSON'));
          if (!escapedFirst) add(t.line, RULES.sanit, `.replace(/${source}/${flags}, ${JSON.stringify(replacement)}) escapes with a backslash, but no earlier step escapes backslashes, so an input holding \\ un-escapes it — replace(/\\\\/g, '\\\\\\\\') first`);
        }
        const removes = replacement === '';
        const opener = dangerousOpener(source, flags);
        if (removes && opener) {
          // …and a LATER replace in the same chain of the same opener handles what this one re-forms
          const later = toks.slice(match[k + 1], statementEnd(k)).some((x, i, arr) => x.t === 're' && arr[i - 2]?.v === 'replace' &&
            dangerousOpener(x.v.source, x.v.flags) === opener);
          if (!later) add(t.line, RULES.multi, `.replace(/${source}/${flags}, '') removes a pattern that can start '${opener}' once; the removal can splice a new one together ('<!<!---->--' → '<!--') — repeat it to a fixed point, or escape instead of stripping`);
        }
      }
    }
  }

  // js/insecure-temporary-file
  const tainted = new Set();
  const underMkdtemp = (k) => {
    for (let j = k - 1; j >= 0; j--) {
      if (toks[j].t === 'p' && toks[j].v === '(' && match[j] > k && isCallAt(toks, j - 1)) {
        if (/^mkdtemp(?:Sync)?$/.test(toks[j - 1].v)) return true;
      }
      if (toks[j].t === 'p' && (toks[j].v === ';' || (toks[j].v === '{' && match[j] > k))) return false;
    }
    return false;
  };
  const tmpCalls = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t === 'id' && toks[k].v === 'tmpdir' && isCallAt(toks, k) && !underMkdtemp(k)) tmpCalls.push(k);
  }
  const declOf = (k) => {
    // `const X = <expr holding k>` on the same statement → X
    for (let j = k - 1; j >= 1; j--) {
      const x = toks[j];
      if (x.t === 'p' && (x.v === ';' || x.v === '{' || x.v === '}') && !(match[j] > k)) return null;
      if (x.t === 'p' && x.v === '=' && toks[j - 1].t === 'id' && ['const', 'let', 'var'].includes(toks[j - 2]?.v)) return toks[j - 1].v;
    }
    return null;
  };
  for (const k of tmpCalls) { const d = declOf(k); if (d) tainted.add(d); }
  // one more hop: `const Y = join(X, …)` with X tainted
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t === 'id' && tainted.has(toks[k].v) && !isMember(toks, k) && toks[k + 1]?.v !== '=') {
      const d = declOf(k);
      if (d && !underMkdtemp(k)) tainted.add(d);
    }
  }
  if (tmpCalls.length) {
    for (let k = 0; k < toks.length; k++) {
      const name = fsCallName(toks, k, fsb);
      if (!name || !TMP_SINK.has(name)) continue;
      const args = argRanges(toks, match, k + 1);
      if (!args.length) continue;
      const [a, b] = args[0];
      const pathToks = toks.slice(a, b);
      const fromTmp = pathToks.some((x, idx) => (x.t === 'id' && x.v === 'tmpdir' && tmpCalls.includes(a + idx)) || (x.t === 'id' && tainted.has(x.v) && !isMember(toks, a + idx)));
      if (!fromTmp) continue;
      const exclusive = args.slice(1).some((r) => toks.slice(r[0], r[1]).some((x) => x.t === 'str' && /^wx\+?$/.test(x.v)));
      if (exclusive) continue;
      add(toks[k].line, RULES.tmp, `${name}(${rangeText(src, toks, args[0])}) writes a predictable name in the shared temp directory — create a private directory with mkdtempSync(join(tmpdir(), 'x-')) and write inside it (or open with flag 'wx')`);
    }
  }

  // js/unused-local-variable — import bindings
  const importRanges = [];
  const imports = [];
  for (let k = 0; k < toks.length; k++) {
    if (!(toks[k].t === 'id' && toks[k].v === 'import') || isMember(toks, k) || toks[k].td) continue;
    if (k > 0 && !(toks[k - 1].t === 'p' && (toks[k - 1].v === ';' || toks[k - 1].v === '}')) && toks[k - 1].line === toks[k].line) continue;
    const imp = parseImport(toks, k);
    if (!imp) continue;
    importRanges.push([k, imp.end]);
    imports.push(...imp.bindings);
  }
  if (imports.length) {
    const used = new Set();
    let r = 0;
    for (let k = 0; k < toks.length; k++) {
      while (r < importRanges.length && importRanges[r][1] < k) r++;
      if (r < importRanges.length && k >= importRanges[r][0] && k <= importRanges[r][1]) continue;
      const x = toks[k];
      if (x.t === 'id' && !isMember(toks, k)) used.add(x.v);
      // a JSDoc-free TS `typeof X` and `X.y` are ids too; a name inside a template is tokenized in-stream
    }
    for (const b of imports) {
      if (!used.has(b.local)) add(b.line, RULES.unused, `unused import ${b.local}${b.kind === 'named' && b.imported !== b.local ? ` (${b.imported})` : ''} — delete it`);
    }
  }

  return out.sort((x, y) => x.line - y.line || x.rule.localeCompare(y.rule));
}

/**
 * Split findings by the suppression comments on THEIR OWN line — never the line above
 * (an allow there would also cover a second, unreviewed shape on the next line), and
 * never an `codeql-lite: allow` that sits inside a string, template or regex literal.
 */
export function applyAllows(src, findings) {
  if (!findings.length) return { kept: [], allowed: [] };
  const lines = src.split('\n');
  const lineStart = [0];
  for (let k = 0; k < lines.length; k++) lineStart.push(lineStart[k] + lines[k].length + 1);
  const literals = tokenize(src).filter((t) => t.t === 'str' || t.t === 'tpl' || t.t === 're');
  const inLiteral = (off) => literals.some((t) => t.start <= off && off < t.end);
  const allowOn = (n) => {
    const text = (lines[n - 1] ?? '').replace(/\r$/, '');
    for (let at = text.indexOf(ALLOW); at !== -1; at = text.indexOf(ALLOW, at + 1)) {
      if (inLiteral(lineStart[n - 1] + at)) continue;
      const rest = text.slice(at + ALLOW.length);
      const m = /^\s+(\S+)\s*(?:—|--|-|:)?\s*(.*)$/.exec(rest);
      if (!m) return [{ rule: '', reason: '' }];
      return [{ rule: m[1], reason: m[2].replace(/\s*\*\/\s*$/, '').trim() }];
    }
    return [];
  };
  const kept = [];
  const allowed = [];
  for (const f of findings) {
    const a = allowOn(f.line).find((x) => x.rule === f.rule);
    if (!a) { kept.push(f); continue; }
    if (a.reason.length < MIN_REASON) {
      kept.push({ line: f.line, rule: RULES.allow, message: `the allow for ${f.rule} gives no reason of ${MIN_REASON}+ characters (${JSON.stringify(a.reason)}), so it suppresses nothing; ${f.message}` });
      continue;
    }
    allowed.push({ ...f, reason: a.reason });
  }
  return { kept, allowed };
}

// ── the file set ─────────────────────────────────────────────────────────────

/** A repo-relative POSIX path for a user-given path, on either platform's path rules. */
export function toRepoRel(root, input, pathMod = path) {
  const abs = pathMod.resolve(root, input);
  return pathMod.relative(root, abs).split(pathMod.sep).join('/').replaceAll('\\', '/');
}

/** The paths-ignore globs of the CodeQL config, as regexes. Throws on an unreadable config. */
export function codeqlIgnores(root) {
  const text = readFileSync(path.join(root, CODEQL_CONFIG_REL), 'utf8');
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^paths-ignore:\s*$/.test(l));
  if (at === -1) return [];
  const out = [];
  for (let k = at + 1; k < lines.length; k++) {
    const m = /^\s+-\s+['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(lines[k]);
    if (m) { out.push(globToRegExp(m[1])); continue; }
    if (lines[k].trim() && !lines[k].trim().startsWith('#')) break;
  }
  return out;
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.error?.message || r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
}

/** A path as git prints it: "C-quoted" (octal UTF-8 bytes, \t \" \\) when it had to be, else as is. */
export function unquoteGitPath(p) {
  if (!(p.startsWith('"') && p.endsWith('"') && p.length >= 2)) return p;
  const bytes = [];
  const body = p.slice(1, -1);
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const e = body[++k];
    if (/[0-7]/.test(e)) { bytes.push(parseInt(body.slice(k, k + 3), 8)); k += 2; continue; }
    bytes.push(({ n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 })[e] ?? e.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Parse `git diff -U0` output into Map<rel, Set<line>> of added/changed new-side lines. */
export function changedLines(diff) {
  const out = new Map();
  let file = null;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      const p = unquoteGitPath(l.slice(4).replace(/\t$/, ''));
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !out.has(file)) out.set(file, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let k = 0; k < count; k++) out.get(file).add(start + k);
    }
  }
  return out;
}

/**
 * The change: Map<rel, Set<line> | 'all'> of the TRACKED code files this branch changed
 * (committed, staged or not). Untracked files only when asked (`untracked`), whole.
 */
export function changedSet(root, base, { untracked = false } = {}) {
  const mb = git(root, ['merge-base', 'HEAD', base]).trim();
  const out = new Map();
  for (const [f, lines] of changedLines(git(root, ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AMR', '-M', mb, '--']))) out.set(f, lines);
  if (untracked) for (const f of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) out.set(f, 'all');
  return { files: out, mergeBase: mb };
}

/**
 * Grade a set: { findings, allowed, files, lost, skipped } where lost names a file that
 * could not be graded and skipped one that is not CodeQL's (not JS/TS, or in paths-ignore).
 */
export function grade(root, set, { ignores = [] } = {}) {
  const findings = [];
  const allowed = [];
  const lost = [];
  const skipped = [];
  let files = 0;
  for (const [rel, scope] of [...set.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!CODE_FILE.test(rel)) { skipped.push(`${rel} (not a JavaScript/TypeScript file)`); continue; }
    if (ignores.some((re) => re.test(rel))) { skipped.push(`${rel} (in ${CODEQL_CONFIG_REL} paths-ignore)`); continue; }
    let src;
    try {
      src = readFileSync(path.join(root, ...rel.split('/')), 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT' && scope !== 'all') continue; // deleted by the change itself
      lost.push(`${rel}: unreadable (${e.code ?? e.message})`);
      continue;
    }
    let all;
    try {
      all = analyse(src, { testFile: TEST_FILE.test(rel) });
    } catch (e) {
      if (e instanceof TokenizeError) { lost.push(`${rel}: could not be tokenized — ${e.message}`); continue; }
      throw e;
    }
    files++;
    const inScope = all.filter((f) => scope === 'all' || f.rule === RULES.unused || scope.has(f.line));
    const r = applyAllows(src, inScope);
    for (const f of r.kept) findings.push({ file: rel, ...f });
    for (const f of r.allowed) allowed.push({ file: rel, ...f });
  }
  return { findings, allowed, files, lost, skipped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs(argv, env = process.env) {
  const o = { base: env.CODEQL_LITE_BASE || DEFAULT_BASE, all: false, files: null, root: DEFAULT_ROOT, quiet: false, untracked: false };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--all') o.all = true;
    else if (a === '--untracked') o.untracked = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--base') o.base = argv[++k];
    else if (a === '--root') o.root = path.resolve(argv[++k]);
    else if (a === '--files') { o.files = []; while (k + 1 < argv.length && !argv[k + 1].startsWith('--')) o.files.push(argv[++k]); }
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.base) throw new Error('--base needs a ref');
  if (o.all && o.files) throw new Error('--all and --files are exclusive');
  if (o.files && !o.files.length) throw new Error('--files needs at least one path');
  if (o.untracked && (o.all || o.files)) throw new Error('--untracked adds to the changed set; --all and --files name their own');
  return o;
}

export function main(argv = process.argv.slice(2), log = console.log, err = console.error) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`codeql-lite: COVERAGE LOST — ${e.message}`); return 2; }
  const t0 = Date.now();
  let ignores;
  try { ignores = codeqlIgnores(o.root); } catch (e) {
    err(`codeql-lite: COVERAGE LOST — ${CODEQL_CONFIG_REL} could not be read (${e.message}); without it this cannot know what CodeQL scans`);
    return 2;
  }
  let set;
  let what;
  try {
    if (o.files) {
      set = new Map(o.files.map((f) => [toRepoRel(o.root, f), 'all']));
      what = `${set.size} named file(s), whole`;
    } else if (o.all) {
      set = new Map(git(o.root, ['ls-files', '-z']).split('\0').filter(Boolean).map((f) => [f, 'all']));
      what = 'every tracked file, whole';
    } else {
      const c = changedSet(o.root, o.base, { untracked: o.untracked });
      set = c.files;
      what = `the changed lines since merge-base(HEAD, ${o.base}) ${c.mergeBase.slice(0, 10)}${o.untracked ? ', and every untracked file whole' : ''}`;
    }
  } catch (e) {
    err(`codeql-lite: COVERAGE LOST — the change could not be named: ${e.message}`);
    return 2;
  }
  const r = grade(o.root, set, { ignores });
  for (const f of r.allowed) log(`codeql-lite: allowed ${f.file}:${f.line} ${f.rule} — ${f.reason}`);
  for (const f of r.findings) log(`${f.file}:${f.line} ${f.rule} ${f.message}`);
  if (o.all) {
    const by = new Map();
    for (const f of r.findings) by.set(f.rule, (by.get(f.rule) ?? 0) + 1);
    for (const [rule, count] of [...by.entries()].sort()) log(`codeql-lite: --all ${rule} ${count}`);
  }
  const ms = Date.now() - t0;
  if (o.files) for (const s of r.skipped) log(`codeql-lite: not graded ${s}`);
  if (o.files && r.files === 0 && !r.lost.length) r.lost.push(`--files named ${set.size} file(s) and none is one CodeQL grades (${r.skipped.join('; ')}), so nothing was checked`);
  if (r.lost.length) {
    for (const l of r.lost) err(`codeql-lite: COVERAGE LOST — ${l}`);
    return 2;
  }
  const verdict = r.findings.length ? `${r.findings.length} finding(s)` : 'clean';
  log(`codeql-lite: ${verdict} — ${r.files} code file(s) graded (${what}), ${r.allowed.length} allowed, ${ms} ms`);
  if (r.findings.length && !o.quiet) log('codeql-lite: fix each, or add `// codeql-lite: allow <rule> — <why>` on the line if CodeQL would be wrong there (and disposition it in tooling/ci/codeql-dispositions.json)');
  return r.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
