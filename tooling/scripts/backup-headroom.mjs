#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// backup-headroom.mjs — how close each offsite-backup set is to the bound the
// 10:00 backup enforces, counted at commit time from the backup's own table.
//
// ⏱ 2026-09-26 (O-BACKUP-SET-BALLOON-HAS-NO-EARLY-WARNING). The offsite backup
// (Private `runbooks/config/backup-offsite.ps1`; the copy that runs sits in the
// Public MAIN checkout's `.claude/scripts/`, and Private's
// assert-runtime-copies.mjs pairs the two) refuses a set whose file count is
// over its `Max` with `SET BALLOONED`. That refusal is the bound working. What
// was missing is a warning before it: the bound was first met at 10:00, the
// run stopped, and the missed beat turned main red through ops-watch
// (2026-09-18: four `.worktrees` lanes in `platform repo`; 2026-09-23: a nested
// checkout under Private `research/`).
//
// WHAT IT READS. Every number and every set comes from the ps1's TEXT: the
// `$REPO_CHURN` line, the `$repoChurnSkip` line, `$rescueLeaf`, and the FIRST
// `$jobs = @(` table (a second `$jobs = @(` further down is the git-bundles
// table, which the pre-flight never counts). Each `@{ … }` gives Name, Src,
// Probe, Max, Skip and Keep; Filter, Exclude, Dest and the rest are rclone's
// and play no part in the pre-flight count. The ps1 is parsed, never run.
//
// HOW IT COUNTS: the `Get-BackupFiles` rule. Every file under Src; drop
// `*\worktrees\*`, `*\node_modules\*` and `*\_site\*`; then the Keep whitelist
// (empty keeps everything); then Skip. Each is a PowerShell `-like` test on the
// ABSOLUTE Windows path, case-insensitive. A directory is passed over without
// being listed only when an exclusion already matches `<dir>\` with its final
// `*` empty, because then every file beneath it matches too. Private's
// `requirements/tooling/test/backup-headroom-parity.test.mjs` runs the real
// `Get-BackupFiles` beside `countSet` on one tree: that test, not this
// paragraph, is the evidence the two rules agree.
//
// WHERE THE SETS ARE: as the running ps1 finds them. `$repo` is the Public MAIN
// checkout (asked of git, so a lane worktree or the pinned hook runner answers
// the same); the anchor is the first directory upward holding `Projects/` and
// `nikatru/`; `$privatePath` is the `_Public` → `_Private` sibling, else
// `<repo>/Private`, the first one that is non-empty. Each resolved Src must
// hold that set's own `Probe` file, or the run is COVERAGE LOST.
//
// GRADES: warn at 80% of Max; refuse at 100% (the backup throws one file
// later, at Max + 1). Warn and refuse lines name the top-level directory that
// holds the most COUNTED files — not the backup's raw count, which can name
// `.git`, a directory the bound never counts. Any `.git` (directory, or the
// file a linked worktree leaves) or `node_modules` under Private `research/`
// refuses at any size.
//
// WHAT IT NEVER DOES: open a file under a set (it lists directory entries and
// checks that each probe exists; the one file it reads is the ps1), list a set
// whose Src is outside the workspace anchor (`scheduled-tasks` today: printed
// by name on every run; the backup's own pre-flight still bounds it), or write
// anything.
//
// Usage:  node tooling/scripts/backup-headroom.mjs [--ps1 <path>] [--json]
//         --ps1 reads another copy of the script (default: the Private tracked
//         one); the sets are still this machine's.
// Exit:   0 = every in-anchor bounded set is under its bound (⬜ lines warn)
//         1 = a set at or over its bound, or a research/ intruder
//         2 = COVERAGE LOST: no anchor or main checkout, the ps1 or its table
//             unreadable, a bounded set's Src, Skip or Keep in a form this file
//             does not model, a probe missing, research/ absent, or zero
//             in-anchor bounded sets graded
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mainCheckoutOf } from './repo-git.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** The share of `Max` at which a set warns. The bound itself refuses. */
export const WARN_FRACTION = 0.8;

/** `Get-BackupFiles`' three pre-filters, applied before Keep and Skip. */
export const PRE_FILTERS = Object.freeze(['*\\worktrees\\*', '*\\node_modules\\*', '*\\_site\\*']);

/** A parse the rest of this file cannot stand on. */
export class ParseError extends Error {}

// ── PowerShell `-like` ───────────────────────────────────────────────────────

const RX_SPECIAL = /[\\^$.*+?()[\]{}|/-]/;
const rxChar = (c) => (RX_SPECIAL.test(c) ? `\\${c}` : c);

/** A PowerShell `-like` pattern as an anchored, case-insensitive RegExp:
 *  `*` any run, `?` one character, `[abc]` / `[a-c]` a set, and a backtick
 *  making the next character literal. */
export function likeToRegExp(pattern) {
  const p = String(pattern);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '`' && i + 1 < p.length) { re += rxChar(p[++i]); continue; }
    if (c === '*') { re += '[\\s\\S]*'; continue; }
    if (c === '?') { re += '[\\s\\S]'; continue; }
    if (c === '[') {
      const chars = [];
      let j = i + 1;
      for (; j < p.length && p[j] !== ']'; j++) {
        if (p[j] === '`' && j + 1 < p.length) { chars.push({ c: p[++j], lit: true }); continue; }
        chars.push({ c: p[j], lit: false });
      }
      if (j >= p.length || chars.length === 0) throw new ParseError(`\`${p}\` has a \`[\` with no closing \`]\`, or an empty set`);
      re += '[' + chars.map((x, k) => (x.c === '-' && !x.lit && k > 0 && k < chars.length - 1 ? '-' : rxChar(x.c))).join('') + ']';
      i = j;
      continue;
    }
    re += rxChar(c);
  }
  return new RegExp(`^${re}$`, 'i');
}

/** True when the pattern's last character is an unescaped `*`: then a string
 *  that matches it still matches with anything appended. */
export function endsWithWildcard(pattern) {
  const p = String(pattern);
  if (!p.endsWith('*')) return false;
  let ticks = 0;
  for (let i = p.length - 2; i >= 0 && p[i] === '`'; i--) ticks++;
  return ticks % 2 === 0;
}

// ── the ps1's text ───────────────────────────────────────────────────────────

const unquote = (v) => {
  const t = String(v ?? '').trim();
  if (/^'(?:[^']|'')*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^"(?:[^"`]|`.|"")*"$/.test(t)) return t.slice(1, -1);
  return null;
};
const quotedList = (s) => [...String(s).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
/** One spelling per expression: runs of whitespace collapse, ends trimmed. */
const norm = (expr) => String(expr).replace(/\s+/g, ' ').trim();

/** The `@{ … }` entries of one table body. `text` is the body; `firstLine` is
 *  the ps1 line number its first character sits on. Comments (`#` to the end of
 *  the line, outside a string) are dropped, inside a hashtable or an array as
 *  much as between entries. */
function parseHashtables(text, firstLine) {
  const out = [];
  let i = 0;
  let line = firstLine;
  const skipComment = () => { while (i < text.length && text[i] !== '\n') i++; };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === ',') { i++; continue; }
    if (c === '#') { skipComment(); continue; }
    if (c === '@' && text[i + 1] === '{') {
      const at = line;
      i += 2;
      const keys = new Map();
      for (;;) {
        // between pairs: whitespace, `;`, newlines, comments
        while (i < text.length && /[\s;]/.test(text[i])) { if (text[i] === '\n') line++; i++; }
        if (text[i] === '#') { skipComment(); continue; }
        if (i >= text.length) throw new ParseError(`the \`@{\` at ps1 line ${at} is never closed`);
        if (text[i] === '}') { i++; break; }
        const km = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
        if (!km) throw new ParseError(`ps1 line ${line}: expected a key inside the \`@{\` of line ${at}, found \`${text.slice(i, i + 20).split('\n')[0]}\``);
        i += km[0].length;
        while (text[i] === ' ' || text[i] === '\t') i++;
        if (text[i] !== '=') throw new ParseError(`ps1 line ${line}: \`${km[0]}\` is not followed by \`=\``);
        i++;
        let value = '';
        let depth = 0;
        for (;;) {
          if (i >= text.length) throw new ParseError(`the value of \`${km[0]}\` (ps1 line ${line}) runs off the end of the table`);
          const v = text[i];
          if (v === "'") {
            let j = i + 1;
            for (; j < text.length; j++) { if (text[j] === "'") { if (text[j + 1] === "'") { j++; continue; } break; } }
            value += text.slice(i, j + 1); i = j + 1; continue;
          }
          if (v === '"') {
            let j = i + 1;
            for (; j < text.length; j++) { if (text[j] === '`') { j++; continue; } if (text[j] === '"') { if (text[j + 1] === '"') { j++; continue; } break; } }
            value += text.slice(i, j + 1); i = j + 1; continue;
          }
          if (v === '#') { skipComment(); continue; }
          if (v === '\n') { if (depth === 0) break; line++; value += ' '; i++; continue; }
          if (depth === 0 && (v === ';' || v === '}')) break;
          if (v === '(' || v === '{' || v === '[') depth++;
          if (v === ')' || v === '}' || v === ']') depth--;
          value += v; i++;
        }
        keys.set(km[0].toLowerCase(), norm(value));
      }
      const raw = (k) => keys.get(k.toLowerCase());
      const name = unquote(raw('Name'));
      if (name === null) throw new ParseError(`the entry at ps1 line ${at} has no quoted Name`);
      const maxRaw = raw('Max');
      if (maxRaw !== undefined && !/^\d+$/.test(maxRaw)) throw new ParseError(`'${name}' (ps1 line ${at}): Max is \`${maxRaw}\`, not a whole number`);
      out.push({
        name,
        srcExpr: raw('Src'),
        probe: raw('Probe') === undefined ? undefined : unquote(raw('Probe')),
        max: maxRaw === undefined ? undefined : Number(maxRaw),
        skipExpr: raw('Skip'),
        keepExpr: raw('Keep'),
        line: at,
      });
      continue;
    }
    throw new ParseError(`ps1 line ${line}: expected \`@{\` in the \`$jobs\` table, found \`${text.slice(i, i + 20).split('\n')[0]}\``);
  }
  return out;
}

/** The backup's set table, read from the ps1's text. Throws ParseError when
 *  the first `$jobs = @(` table cannot be found or read. */
export function parseBackupSets(ps1Text) {
  const text = String(ps1Text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const churnM = /^\$REPO_CHURN\s*=\s*@\(([^)\n]*)\)\s*$/m.exec(text);
  const churnSkipKnown = /^\$repoChurnSkip\s*=\s*@\(\s*\$REPO_CHURN\s*\|\s*ForEach-Object\s*\{\s*"\*\\\$_\\\*"\s*\}\s*\)\s*$/m.test(text);
  const leafM = /^\$rescueLeaf\s*=\s*'([^'\n]*)'\s*$/m.exec(text);
  const open = lines.findIndex((l) => /^\$jobs\s*=\s*@\(\s*$/.test(l));
  if (open === -1) throw new ParseError('no `$jobs = @(` line at column 0');
  let close = -1;
  for (let k = open + 1; k < lines.length; k++) if (/^\)\s*$/.test(lines[k])) { close = k; break; }
  if (close === -1) throw new ParseError(`the \`$jobs = @(\` at ps1 line ${open + 1} has no closing \`)\` at column 0`);
  const sets = parseHashtables(lines.slice(open + 1, close).join('\n'), open + 2);
  if (sets.length === 0) throw new ParseError(`the \`$jobs\` table at ps1 lines ${open + 1}-${close + 1} holds no \`@{ … }\` entry`);
  return {
    churn: churnM ? quotedList(churnM[1]) : null,
    churnSkipKnown,
    rescueLeaf: leafM ? leafM[1] : null,
    table: { open: open + 1, close: close + 1 },
    sets,
  };
}

// ── Src, Skip, Keep: the forms the table uses, and nothing else ──────────────

const SRC_FORMS = new Map([
  ['$repo', (c) => c.repo],
  ["(Join-Path $repo '.claude')", (c) => join(c.repo, '.claude')],
  ['$brainPath', (c) => join(c.anchor, 'nikatru')],
  ['$rescuePath', (c) => (c.rescueLeaf ? join(c.anchor, 'Projects', c.rescueLeaf) : null)],
  ['$privatePath', (c) => c.privatePath],
  ['"$env:USERPROFILE\\.claude\\scheduled-tasks"', (c) => join(c.userProfile, '.claude', 'scheduled-tasks')],
]);

/** A set's Src expression as a path. `ctx` is { anchor, repo, privatePath,
 *  userProfile, rescueLeaf }. Returns { path } or { error }. */
export function resolveSrc(srcExpr, ctx) {
  if (srcExpr === undefined) return { error: 'it has no Src' };
  const form = SRC_FORMS.get(norm(srcExpr));
  if (!form) return { error: `its Src \`${norm(srcExpr)}\` is not one of the ${SRC_FORMS.size} forms this file resolves (${[...SRC_FORMS.keys()].join(' · ')})` };
  const path = form(ctx);
  if (!path) return { error: `its Src \`${norm(srcExpr)}\` needs \`$rescueLeaf = '…'\`, which the ps1 does not carry` };
  return { path };
}

/** A set's Skip expression as `-like` patterns. `parsed` is parseBackupSets'
 *  result. Returns { patterns } or { error }. */
export function resolveSkip(skipExpr, parsed) {
  if (skipExpr === undefined) return { patterns: [] };
  const e = norm(skipExpr);
  const churnSkip = () => {
    if (!parsed.churn) return { error: 'it uses `$repoChurnSkip`, and the ps1 has no `$REPO_CHURN = @(…)` line' };
    if (!parsed.churnSkipKnown) return { error: 'it uses `$repoChurnSkip`, whose line is no longer `@($REPO_CHURN | ForEach-Object { "*\\$_\\*" })`' };
    return { patterns: parsed.churn.map((d) => `*\\${d}\\*`) };
  };
  if (e === '$repoChurnSkip') return churnSkip();
  // The list is ITEM (SEP ITEM)* then a trailing SEP, and SEP between two items
  // is never empty. `'a''b'` is ONE item with a '' escape in it, so a list that
  // also allowed two items with nothing between them read that text two ways,
  // and a run of `''` backtracked 2^n ways before failing (CodeQL js/redos). The
  // text accepted and m[1] are exactly what `(?:'…'\s*,?\s*)+` gave.
  const m = /^\(\s*@\(\s*('(?:[^']|'')*'(?:(?:\s+(?:,\s*)?|,\s*)'(?:[^']|'')*')*\s*(?:,\s*)?)\)\s*\+\s*\$repoChurnSkip\s*\)$/.exec(e);
  if (m) {
    const rest = churnSkip();
    return rest.error ? rest : { patterns: [...quotedList(m[1]), ...rest.patterns] };
  }
  return { error: `its Skip \`${e}\` is not \`$repoChurnSkip\` or \`(@('…', …) + $repoChurnSkip)\`` };
}

/** A set's Keep expression. The table sets none today; a literal list is the
 *  one form modelled. Returns { patterns } or { error }. */
export function resolveKeep(keepExpr) {
  if (keepExpr === undefined) return { patterns: [] };
  // resolveSkip's list, made optional so `@()` is still the empty list.
  const m = /^@\(\s*((?:'(?:[^']|'')*'(?:(?:\s+(?:,\s*)?|,\s*)'(?:[^']|'')*')*\s*(?:,\s*)?)?)\)$/.exec(norm(keepExpr));
  if (!m) return { error: `its Keep \`${norm(keepExpr)}\` is not a literal \`@('…', …)\` list` };
  return { patterns: quotedList(m[1]) };
}

// ── counting ─────────────────────────────────────────────────────────────────

/** A path as PowerShell's FullName spells it: backslash separators. */
const winPath = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '');

/** One walk of a set: { count, perTop, unreadable }. perTop maps each top-level
 *  directory of `src` to the COUNTED files beneath it. */
function walkSet({ src, skip = [], keep = [] }) {
  const pre = PRE_FILTERS.map(likeToRegExp);
  const keepRx = keep.filter(Boolean).map(likeToRegExp);
  const skipRx = skip.filter(Boolean).map(likeToRegExp);
  const prune = [...PRE_FILTERS, ...skip.filter(Boolean)].filter(endsWithWildcard).map(likeToRegExp);
  let count = 0;
  let unreadable = 0;
  const perTop = new Map();
  const stack = [{ dir: src, win: winPath(src), top: null }];
  while (stack.length) {
    const { dir, win, top } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable++;   // Get-ChildItem -ErrorAction SilentlyContinue passes over it too
      continue;
    }
    for (const e of entries) {
      const full = `${win}\\${e.name}`;
      if (e.isDirectory()) {
        if (prune.some((rx) => rx.test(`${full}\\`))) continue;
        stack.push({ dir: join(dir, e.name), win: full, top: top ?? e.name });
        continue;
      }
      let ok = !pre.some((rx) => rx.test(full));
      if (ok && keepRx.length) ok = keepRx.some((rx) => rx.test(full));
      if (ok && skipRx.length) ok = !skipRx.some((rx) => rx.test(full));
      if (!ok) continue;
      count++;
      if (top !== null) perTop.set(top, (perTop.get(top) ?? 0) + 1);
    }
  }
  return { count, perTop, unreadable };
}

/** The number of files `Get-BackupFiles -Path src -Skip skip -Keep keep` yields. */
export function countSet({ src, skip = [], keep = [] }) {
  return walkSet({ src, skip, keep }).count;
}

const topOf = (perTop) => {
  let best = null;
  for (const [name, count] of [...perTop].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
};

/** The top-level directory of `src` holding the most COUNTED files, as
 *  { name, count }, or null when no counted file is in a subdirectory. */
export function largestSubfolder({ src, skip = [], keep = [] }) {
  return topOf(walkSet({ src, skip, keep }).perTop);
}

/** Each { name, count, max } graded: warn at WARN_FRACTION of max, refuse at max. */
export function grade(sets) {
  return sets.map((s) => ({
    ...s,
    pct: Math.floor((s.count * 100) / s.max),
    verdict: s.count >= s.max ? 'refuse' : s.count >= WARN_FRACTION * s.max ? 'warn' : 'ok',
  }));
}

/** Every `.git` (directory or file) and `node_modules` under `<private>/research/`.
 *  Returns { research, found: [{ rel, kind }] } or { error } when there is no
 *  research/ directory to look in. */
export function researchIntruders(privatePath) {
  const research = join(privatePath, 'research');
  if (!isDir(research)) return { error: `there is no research/ directory at ${research}, so the nested-checkout limb looked at nothing` };
  const found = [];
  const stack = [research];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const lower = e.name.toLowerCase();
      if (lower === '.git' || lower === 'node_modules') {
        found.push({ rel: relative(privatePath, join(dir, e.name)).replace(/\\/g, '/'), kind: e.isDirectory() ? 'directory' : 'file' });
        continue;
      }
      if (e.isDirectory()) stack.push(join(dir, e.name));
    }
  }
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  return { research, found };
}

// ── this machine ─────────────────────────────────────────────────────────────

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
const isNonEmptyDir = (p) => { try { return readdirSync(p).length > 0; } catch { return false; } };
const fold = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));

/** True when `child` is `parent` or lies beneath it. */
export function isInside(child, parent) {
  const r = relative(fold(parent), fold(child));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** The first directory upward from `from` that holds both `Projects/` and `nikatru/`. */
export function findAnchor(from) {
  const walked = [];
  let d = resolve(from);
  for (;;) {
    walked.push(d);
    if (isDir(join(d, 'Projects')) && isDir(join(d, 'nikatru'))) return { path: d, walked };
    const up = dirname(d);
    if (up === d) return { path: null, walked };
    d = up;
  }
}

/** The running ps1's `$repo`, anchor and `$privatePath`, as it resolves them. */
export function machineContext({ root = ROOT, env = process.env } = {}) {
  // A `.git` DIRECTORY is a main checkout, which is its own answer; only a
  // linked worktree (a `.git` file) needs git to name its main checkout. Every
  // spawn costs 0.1-0.5 s on this host, and this runs on every commit.
  const m = isDir(join(root, '.git')) ? { main: root } : mainCheckoutOf(root);
  if (!m.main) return { error: `the Public main checkout could not be elected from ${root}: ${m.why}` };
  const repo = m.main;
  const anchor = findAnchor(repo);
  if (!anchor.path) return { error: `no directory holding both Projects/ and nikatru/ above ${repo} (walked ${anchor.walked.join(' , ')})` };
  const leaf = basename(repo);
  const privateLeaf = /_Public$/i.test(leaf) ? leaf.replace(/_Public$/i, '_Private') : `${leaf}_Private`;
  const candidates = [join(dirname(repo), privateLeaf), join(repo, 'Private')];
  const privatePath = candidates.find(isNonEmptyDir) ?? candidates[0];
  return { repo, anchor: anchor.path, privatePath, userProfile: env.USERPROFILE || homedir() };
}

/** The one file this module reads. */
function readPs1(path) {
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (e) {
    return { error: `the backup script is not readable at ${path} (${e?.code ?? e?.message ?? e})` };
  }
}

// ── the verdict ──────────────────────────────────────────────────────────────

/** Grade every set of `parsed` on the tree `ctx` names. Returns
 *  { code, lines, sets, research, lost }: code 0 green or warn only, 1 a
 *  refusal, 2 COVERAGE LOST. `lines[0]` is the summary, or the COVERAGE LOST line. */
export function evaluate({ parsed, ctx }) {
  const lost = [];
  const measured = [];
  const shown = [];
  let bounded = 0;
  for (const s of parsed.sets) {
    if (s.max === undefined) {
      shown.push({ name: s.name, kind: 'unbounded' });
      continue;
    }
    bounded++;
    const src = resolveSrc(s.srcExpr, { ...ctx, rescueLeaf: parsed.rescueLeaf });
    if (src.error) { lost.push(`'${s.name}' (ps1 line ${s.line}): ${src.error}`); continue; }
    if (!isInside(src.path, ctx.anchor)) {
      shown.push({ name: s.name, kind: 'outside', src: src.path, max: s.max });
      continue;
    }
    const skip = resolveSkip(s.skipExpr, parsed);
    if (skip.error) { lost.push(`'${s.name}' (ps1 line ${s.line}): ${skip.error}`); continue; }
    const keep = resolveKeep(s.keepExpr);
    if (keep.error) { lost.push(`'${s.name}' (ps1 line ${s.line}): ${keep.error}`); continue; }
    if (!s.probe) { lost.push(`'${s.name}' (ps1 line ${s.line}): it has no Probe, so the Src resolved here cannot be told from a wrong one`); continue; }
    const probePath = join(src.path, ...s.probe.split(/[\\/]/));
    if (!existsSync(probePath)) {
      lost.push(`'${s.name}' (ps1 line ${s.line}): its probe '${s.probe}' is not at ${probePath}, so ${src.path} is not the tree the backup reads`);
      continue;
    }
    const w = walkSet({ src: src.path, skip: skip.patterns, keep: keep.patterns });
    const g = grade([{ name: s.name, count: w.count, max: s.max }])[0];
    measured.push({ ...g, src: src.path, top: topOf(w.perTop), unreadable: w.unreadable });
    shown.push({ name: s.name, kind: 'graded' });
  }
  const research = researchIntruders(ctx.privatePath);
  if (research.error) lost.push(research.error);
  if (measured.length === 0 && lost.length === 0) {
    lost.push(`zero of ${bounded} bounded set(s) lie inside the workspace anchor ${ctx.anchor}, so nothing was graded`);
  }

  const warn = measured.filter((m) => m.verdict === 'warn').length;
  const refuse = measured.filter((m) => m.verdict === 'refuse').length;
  const intruders = research.found ?? [];
  const lines = [];
  const code = lost.length ? 2 : refuse || intruders.length ? 1 : 0;
  const summary = `backup-headroom: ${measured.length} of ${bounded} bounded set(s) graded, ${warn} warn, ${refuse} refuse, ${intruders.length} research intruder(s)`;
  if (lost.length) {
    lines.push(`✗ COVERAGE LOST — backup-headroom: ${lost[0]}`);
    for (const l of lost.slice(1)) lines.push(`✗ COVERAGE LOST — ${l}`);
    lines.push(`  (${summary}; exit 2 — not a pass)`);
  } else {
    lines.push(summary);
  }
  const top = (m) => (m.top ? `largest subfolder '${m.top.name}' (${m.top.count} counted)` : 'no subfolder holds a counted file');
  const Top = (m) => { const t = top(m); return t[0].toUpperCase() + t.slice(1); };
  for (const row of shown) {
    if (row.kind === 'unbounded') { lines.push(`  --   ${row.name}: no bound in the backup; not graded`); continue; }
    if (row.kind === 'outside') {
      lines.push(`⬜ not walked: '${row.name}' (Max ${row.max}) — its Src ${row.src} is outside the workspace anchor ${ctx.anchor}; the backup's own pre-flight still bounds it`);
      continue;
    }
    const m = measured.find((x) => x.name === row.name);
    const head = `${m.name}  ${m.count}/${m.max} (${m.pct}%)`;
    if (m.verdict === 'ok') lines.push(`  ok   ${head}`);
    if (m.verdict === 'warn') lines.push(`⬜ warn ${head} — at or over ${Math.round(WARN_FRACTION * 100)}% of its bound; ${top(m)}`);
    if (m.verdict === 'refuse') {
      lines.push(`✗ REFUSE ${head} — at or over its bound; the 10:00 backup throws SET BALLOONED at ${m.max + 1}. ` +
        `${Top(m)}: move it to the session scratchpad, or raise the bound deliberately in backup-offsite.ps1 (an owner-visible commit).`);
    }
    if (m.unreadable) lines.push(`⬜ ${m.name}: ${m.unreadable} directory(ies) could not be listed, and are not counted (Get-BackupFiles passes over them too)`);
  }
  if (!research.error) {
    if (intruders.length === 0) lines.push(`  ok   research/: no nested .git or node_modules under ${research.research}`);
    for (const x of intruders) {
      lines.push(`✗ REFUSE ${x.rel} — a ${basename(x.rel)} ${x.kind} under research/ refuses at any size (a nested checkout ballooned 'platform private' on 2026-09-23): move it to the session scratchpad.`);
    }
  }
  return { code, lines, sets: measured, research: intruders, lost };
}

// ── the CLI ──────────────────────────────────────────────────────────────────

const IS_MAIN = (() => {
  const a = process.argv[1];
  if (!a) return false;
  return fold(a) === fold(fileURLToPath(import.meta.url));
})();

if (IS_MAIN) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const at = args.indexOf('--ps1');
  const ps1Arg = at === -1 ? undefined : args[at + 1];
  const known = new Set(['--json', '--ps1']);
  const stray = args.filter((a, k) => !known.has(a) && !(at !== -1 && k === at + 1));
  if ((at !== -1 && (ps1Arg === undefined || ps1Arg.startsWith('--'))) || stray.length) {
    console.error(`✗ usage: node tooling/scripts/backup-headroom.mjs [--ps1 <path>] [--json]${stray.length ? ` (unknown: ${stray.join(' ')})` : ''}`);
    process.exit(2);
  }
  const finish = (r) => {
    if (json) console.log(JSON.stringify({ code: r.code, first: r.lines[0], lines: r.lines, sets: r.sets, research: r.research, lost: r.lost }, null, 2));
    else console.log(r.lines.join('\n'));
    process.exit(r.code);
  };
  const stop = (why) => finish({ code: 2, lines: [`✗ COVERAGE LOST — backup-headroom: ${why}`], sets: [], research: [], lost: [why] });
  const ctx = machineContext();
  if (ctx.error) stop(ctx.error);
  const ps1Path = ps1Arg ? resolve(ps1Arg) : join(ctx.privatePath, 'runbooks', 'config', 'backup-offsite.ps1');
  const src = readPs1(ps1Path);
  if (src.error) stop(src.error);
  let parsed;
  try {
    parsed = parseBackupSets(src.text);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    stop(`${ps1Path}: ${e.message}`);
  }
  finish(evaluate({ parsed, ctx }));
}
