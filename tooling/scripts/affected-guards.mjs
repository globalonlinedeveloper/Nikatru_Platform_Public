#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// affected-guards.mjs — run the checks that cover the paths this branch changed,
// BEFORE the push, and say which changed paths nothing covers.
//
// 🔴 WHY THIS EXISTS, MEASURED (lane fix-prepush-affected-guards, 2026-09-30).
// Of 125 PR CI runs since 2026-09-29 00:00Z, 49 were not green; the 42 CANCELLED
// ones were red first and then cancelled by fail-fast. 23 of the first failing jobs
// were the lane's OWN change, which the right local checks would have caught:
// guard-meta 6, lane-verdict 5, workspace gate 4, platform 3, store 2,
// privacy/money 2, app brick 1. Since 2026-09-25 lanes skip the whole-branch
// preflight ("CI is the sweep"), and the owner's lock of that day said a lane checks
// its TOUCHED files. Nothing enforced that, so first pushes reached CI unverified.
// This is the enforcement: one tool, run by the pre-push hook after the spec guards.
//
// ── WHAT IT SELECTS, AND WHERE EACH RULE COMES FROM ──────────────────────────
// Every rule is derived from a file that already exists; none is a hand-kept list.
//   guard   every `node <script>` call in ci.yml and the workflows ci.yml calls
//           (`uses: ./.github/workflows/…`), read through workflow-scan.mjs, the
//           repository's one workflow parse. Its SUBJECT is the set of tracked
//           paths its source — and the source of every module it imports — names:
//           string literals, `join(ROOT, 'a', 'b')` chains and template literals.
//           That is trap ci-18's rule ("grep the guards for the thing you touched")
//           done by a program, over the import closure a grep cannot see.
//   test    every file a `node --test <glob>` call in those workflows runs. Its
//           subject is the same extraction, and it also follows every script the
//           test names (a test spawns the guard it tests).
//   dart    each pub workspace member (the root pubspec's `workspace:`), analysed
//           and tested alone through melos. Subject: the member's own directory.
//           The root pubspec.yaml / pubspec.lock select every member's analyze.
//   content a guard whose subject is "any file whose TEXT has X" (CONTENT_SUBJECTS:
//           assert-workflow-readers, assert-mechanism-claims) is also selected by
//           the changed file's own text, matched with the guard's own detector.
//   worker  each services/<w> with a package.json: `tsc --noEmit` + `npm test`, as
//           lane-workers.yml runs them. Subject: services/<w>/**, and every glob
//           of the `workers` lane in tooling/ci/lane-map.json (the register of what
//           the Worker jobs READ) selects all of them.
//
// A changed path is MAPPED when a selected check's subject names it SPECIFICALLY —
// a file, a directory below the top level, or a glob — or when lane-map.json's
// `unclaimed` list declares it gradeable by nothing. A subject of a whole top-level
// directory (`tooling`, `apps`) still SELECTS the check but does not MAP the path:
// a guard that reads "somewhere under tooling" is not evidence that anything read
// THIS file. An unmapped path is COVERAGE LOST, exit 2.
//
// ⚠️ THE EXTRACTION IS STATIC, AND ITS BLIND SPOT IS WRITTEN HERE: a guard that
// builds a path only from data it read (`join(ROOT, row.path)`) names no literal
// for it. Such a guard is selected through the literal it DID name for the
// register it read, and CI remains the sweep. The unit of trust is the push, not
// this list: over-selection costs seconds, under-selection costs a red CI run.
//
// ── HOW IT RUNS ──────────────────────────────────────────────────────────────
// In parallel (--jobs, default min(4, cores)), each check with its own ceiling,
// output to FILES, never pipes (preflight.mjs's captureSync, 2026-09-22: a pipe
// waits for every descendant, a file waits for nobody). One line per check with
// its exit code and wall time; the total wall time last.
// ORDER AND BUDGET. Each selected check carries the TIER of its tightest tie to the
// change: 0 its own file changed, 1 a file its entry names (for a test, also the
// guard it runs; a package gate's own package), 2 a file a module it imports names,
// 3 a directory or glob. One lane runs the tight slow checks (Dart gates, Worker
// suites, a changed guard's tests), the others every guard, tightest first (see
// twoQueues), and the run starts nothing after --budget-s (default DEFAULT_BUDGET_S, env
// NIKATRU_AFFECTED_BUDGET_S, floor BUDGET_FLOOR_S); a check still running GRACE_MS
// later is stopped. The cut is printed by name as NOT RUN (budget) — CI runs them —
// and is not a pass of those checks: it is the same bargain as preflight --smoke's.
// Measured 2026-09-30 on this laptop while other lanes held all four cores: single
// guard tests took 4–375 s, so an unbudgeted run of a register-wide change (~200
// checks) would take most of an hour. --no-budget runs everything.
// A red guard or test is re-run at merge-base(HEAD, --base) in a detached checkout
// (preflight.mjs's detachedCheckout / classifyRed): red there with the same exit
// code is ENVIRONMENTAL — this machine, not this branch — and printed, not failed.
// A Worker red is re-run there too (`npm ci` first: a base checkout has no node_modules),
// because a vitest case timed out by load is red on main as well. A Dart red is not
// re-run (the base has no resolved workspace, and pub get costs minutes): a finding.
// The tree is snapshotted before and after: a check that rewrote a tracked file
// (assert-guard-coverage's ratchet, a generator's output) is a finding, because CI
// runs the same check and fails on the same diff.
//
// ── THE ESCAPE HATCH, WHICH NAMES WHAT IT SKIPS ──────────────────────────────
// `--skip-for-ci <id>[,<id>] --reason "<why>"` (or NIKATRU_SKIP_FOR_CI and
// NIKATRU_SKIP_FOR_CI_REASON, for the hook) skips exactly the named checks, for a
// push whose only purpose is to reach CI for a Linux-only check. Every id must be a
// check this run SELECTED — a skip that skips nothing is a typo and is refused
// (exit 2) — the reason is required, each skip prints a SKIPPED-FOR-CI line, and
// one JSON line per use is appended to `<git common dir>/affected-guards-skips.log`.
// Nothing else is skipped: there is no flag that turns the whole run off.
//
// Usage:  node tooling/scripts/affected-guards.mjs [--base <ref>] [--jobs <n>] [--list] [--root <dir>] [--sha <commit>]
//                [--json <path>] [--skip-for-ci <ids> --reason <text>] [--paths <p>…]
//   --list   select and print, run nothing (the selection and its coverage, in ~1 s)
//   --paths  judge these paths instead of the diff (the tests' seam; also for a
//            question like "what would this file select?")
// Exit:   0 every selected check green (or environmental) and every path mapped
//         1 a finding: a check red here and not at the base, or a tree edit
//         2 COVERAGE LOST: an unmapped path, a check that timed out or could not
//           run, a base that could not answer, a bad skip, a usage error
// Tests:  tooling/ci/test/affected-guards.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows, shellSegments, workflowSteps } from '../ci/workflow-scan.mjs';
import { globToRegExp, readMap } from '../ci/lane-detect.mjs';
import { TEST_DIR_REL as SHARD_TEST_DIR } from '../ci/guard-test-shards.mjs';
import { classifyRed, detachedCheckout, removeCheckout, spawnCeilingUrl } from './preflight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The guard-tests shard planner, as a workflow names it. */
const SHARD_SCRIPT = 'tooling/ci/guard-test-shards.mjs';
const CI_WORKFLOW = 'ci.yml';
/** The lane's target is under five minutes for a typical change on the 4-core laptop. */
export const DEFAULT_BUDGET_S = 240;
/** Like preflight's SMOKE_BUDGET_FLOOR_S: a tiny budget would cut most checks and pass. */
export const BUDGET_FLOOR_S = 60;
/** The hard stop: a check still running this long after the budget is stopped and
 *  reported by name, so the added wall time is bounded by budget + grace, not by the
 *  slowest ceiling (a 262 s test started at 239 s took the first dogfood run to 448 s). */
const GRACE_MS = 60_000;
/** The ceiling on re-running the reds at the merge-base, checkout included in spirit. */
const BASE_MS = 300_000;

// ── the tracked tree ─────────────────────────────────────────────────────────

/** Tracked paths (index, so an intent-to-add file counts), and every directory above one. */
export function trackedTree(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${(r.stderr || '').trim()}`);
  return treeOf(r.stdout.split('\0').filter(Boolean));
}

export function treeOf(files) {
  const fileSet = new Set(files);
  const dirs = new Set();
  const byBase = new Map();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    const b = parts[parts.length - 1];
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  return { files: fileSet, list: files, dirs, byBase };
}

// ── the static subject of one source file ────────────────────────────────────

/** Every string literal in JS source, comments skipped. Template literals come back
 *  with each `${…}` replaced by \u0000. Also returns join/resolve chains: the run
 *  of literal arguments at the start of the call (after any non-literal first
 *  argument), with `open` true when a non-literal argument followed them. */
export function scanSource(src) {
  const strings = [];
  const chains = [];
  const imports = [];
  const tokens = []; // { t: 'str'|'id'|'p', v }
  let i = 0;
  const n = src.length;
  const prevSignificant = () => {
    for (let k = tokens.length - 1; k >= 0; k--) return tokens[k];
    return null;
  };
  const regexAllowed = () => {
    const p = prevSignificant();
    if (!p) return true;
    if (p.t === 'str') return false;
    if (p.t === 'id') return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(p.v);
    return !/^[)\]}]$/.test(p.v);
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      let v = '';
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { v += src[j + 1] ?? ''; j += 2; continue; }
        v += src[j++];
      }
      strings.push(v);
      tokens.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let v = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { v += src[j + 1] ?? ''; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          j += 2;
          while (j < n && depth > 0) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            else if (src[j] === '\'' || src[j] === '"' || src[j] === '`') {
              const q = src[j];
              j++;
              while (j < n && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
            }
            j++;
          }
          v += '\u0000';
          continue;
        }
        v += src[j++];
      }
      strings.push(v);
      tokens.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      tokens.push({ t: 'p', v: 're' });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    tokens.push({ t: 'p', v: c });
    i++;
  }
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    // import … from '<x>' · export … from '<x>' · import('<x>') · import '<x>'
    if (tk.t === 'id' && tk.v === 'from' && tokens[k + 1]?.t === 'str') imports.push(tokens[k + 1].v);
    if (tk.t === 'id' && tk.v === 'import' && tokens[k + 1]?.t === 'str') imports.push(tokens[k + 1].v);
    if (tk.t === 'id' && tk.v === 'import' && tokens[k + 1]?.v === '(' && tokens[k + 2]?.t === 'str') imports.push(tokens[k + 2].v);
    // join( … ) / resolve( … ): the literal run of arguments.
    if (tk.t === 'id' && (tk.v === 'join' || tk.v === 'resolve') && tokens[k + 1]?.v === '(') {
      const args = [];
      let depth = 0;
      let cur = [];
      for (let m = k + 1; m < tokens.length; m++) {
        const x = tokens[m];
        if (x.v === '(' || x.v === '[' || x.v === '{') { depth++; if (depth === 1) continue; }
        if (x.v === ')' || x.v === ']' || x.v === '}') { depth--; if (depth === 0) { args.push(cur); break; } }
        if (depth === 1 && x.v === ',') { args.push(cur); cur = []; continue; }
        cur.push(x);
      }
      const lit = (a) => a.length === 1 && a[0].t === 'str' && !a[0].v.includes('\u0000');
      // Each argument is its literal, or \u0000 (any path) when it is not one; the
      // first argument, when not a literal, is the base (ROOT, HERE) and is dropped.
      const parts = args.map((a) => (lit(a) ? a[0].v : '\u0000'));
      if (parts[0] === '\u0000') parts.shift();
      if (parts.some((x) => x !== '\u0000')) chains.push({ parts });
    }
  }
  return { strings, chains, imports };
}

const TOP_LEVEL_ONLY = (p) => !p.includes('/');

/** Normalise one candidate path, relative to ROOT or to `fromDir` for ./ and ../. */
function normalise(raw, fromDir) {
  let s = String(raw).replace(/\\/g, '/').trim();
  if (!s || s.length > 240 || /[\s:<>|"]/.test(s)) return null;
  if (/^\.\.?\//.test(s)) s = posix.normalize(posix.join(fromDir, s));
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s || s === '.' || s.startsWith('..')) return null;
  return s;
}

/** Match a candidate against the tree: { kind: 'file'|'dir'|'glob', path } or null. */
function classify(cand, tree) {
  if (!cand) return null;
  tree.classified ??= new Map();
  if (!tree.classified.has(cand)) tree.classified.set(cand, classifyUncached(cand, tree));
  return tree.classified.get(cand);
}

function classifyUncached(cand, tree) {
  if (cand.includes('\u0000') || cand.includes('*')) {
    // A template or a glob: each ${…} is any run of characters, across segments.
    let g = cand.replace(/^\u0000\/+/, '').replace(/\u0000/g, '**').replace(/\*{3,}/g, '**');
    g = g.replace(/^\/+/, '');
    if (!g || g === '**' || /^\*\*\/?\*?\*?$/.test(g) || !/[A-Za-z0-9]/.test(g.replace(/\*/g, ''))) return null;
    // A pattern names a place only when its literal prefix holds a whole directory
    // (`apps/**/pubspec.yaml`), or it is `**/<file name>`. `t**`, `**.json` and
    // `**-${x}` name nothing: every template literal would otherwise be a subject.
    const prefix = g.slice(0, g.indexOf('*'));
    const suffixFile = /^\*\*\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}$/.test(g);
    if (!prefix.includes('/') && !suffixFile) return null;
    let re;
    try { re = globToRegExp(g); } catch { return null; }
    const size = tree.list.filter((f) => re.test(f)).length;
    return size ? { kind: 'glob', path: g, re, size } : null;
  }
  if (tree.files.has(cand)) return { kind: 'file', path: cand };
  if (tree.dirs.has(cand)) return { kind: 'dir', path: cand, size: tree.list.filter((f) => f.startsWith(`${cand}/`)).length };
  return null;
}

const LISTS_A_DIRECTORY = /\b(readdirSync|readdir|opendirSync|opendir|globSync|listDir|walk\w*)\s*\(|ls-files/;

/** The subjects ONE source file names, and the relative modules it imports. */
export function subjectsOf(src, rel, tree) {
  const fromDir = posix.dirname(rel);
  const { strings, chains, imports } = scanSource(src);
  const out = new Map();
  const add = (s) => { if (s && !out.has(`${s.kind}:${s.path}`)) out.set(`${s.kind}:${s.path}`, s); };
  for (const raw of strings) {
    if (raw.length > 240 || /[\s|<>"']/.test(raw.replace(/\u0000/g, ''))) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) continue;
    const c = classify(normalise(raw, fromDir), tree);
    if (c) { add(c); continue; }
    // A bare file name (`versions.json`) that names few tracked files names them.
    if (/^[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}$/.test(raw)) {
      const hits = tree.byBase.get(raw) ?? [];
      if (hits.length >= 1 && hits.length <= 3) for (const h of hits) add({ kind: 'file', path: h, bare: true });
    }
  }
  for (const ch of chains) {
    const relative = /^\.\.?$/.test(ch.parts[0]);
    const base = relative ? fromDir : '';
    const joined = posix.normalize(posix.join(base, ...ch.parts)).replace(/^\.\/?/, '').replace(/\/+$/, '');
    if (!joined || joined === '.' || joined.startsWith('..')) continue;
    // a trailing \u0000 is "something under here": the directory is the subject
    const c = classify(joined.replace(/(\/\u0000)+$/, ''), tree);
    if (c) add(c);
  }
  const deps = [];
  for (const spec of imports) {
    if (!/^\.\.?\//.test(spec)) continue;
    const p = posix.normalize(posix.join(fromDir, spec));
    if (tree.files.has(p)) deps.push(p);
  }
  // A directory that holds this very file (`const CI_DIR = join(ROOT, 'tooling', 'ci')`,
  // `join(HERE, '..')`) is where the script stands, not what it reads — unless the
  // source LISTS a directory, which is how a guard over its siblings reads them.
  const lists = LISTS_A_DIRECTORY.test(src);
  const subjects = [...out.values()].filter((s) => s.kind !== 'dir' || lists || !(fromDir === s.path || fromDir.startsWith(`${s.path}/`)));
  return { subjects, deps, lists };
}

const SCRIPT = /\.(m?js|cjs)$/;

/** Subjects of a script and its whole relative-import closure. `follow` also walks
 *  every SCRIPT the ENTRY names (a test names the guard it spawns) — from the entry
 *  only: a guard that names another guard as data does not inherit its subjects. */
export function closureSubjects(entry, tree, readSource, { follow = false, codeOnly = false } = {}) {
  const seen = new Set();
  // [path, primary]: the entry and the scripts it names are PRIMARY; an imported
  // module is not. A module's directory walks belong to functions its importer may
  // never call (workflow-scan.mjs is imported by a hundred guards and lists every
  // workflow), so from a non-primary module only files and globs are subjects.
  const queue = [[entry, true]];
  const subjects = new Map();
  while (queue.length) {
    const [rel, primary] = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    tree.scanned ??= new Map();
    if (!tree.scanned.has(rel)) {
      let src = null;
      try { src = readSource(rel); } catch {}
      tree.scanned.set(rel, src === null ? null : subjectsOf(src, rel, tree));
    }
    if (!tree.scanned.get(rel)) continue;
    const { subjects: s, deps } = tree.scanned.get(rel);
    // tier: how tightly a change to this subject implicates the check. 0 the check's own
    // file · 1 what the entry (or the script a test runs) names · 2 a module it imports.
    const put = (x, tier) => { const k = `${x.kind}:${x.path}`; if (!subjects.has(k) || subjects.get(k).tier > tier) subjects.set(k, { ...x, tier }); };
    put({ kind: 'file', path: rel }, rel === entry ? 0 : primary ? 1 : 2);
    for (const x of s) {
      if (x.kind === 'dir' && !primary) continue;
      // codeOnly (a test): what a module it runs READS is that module's subject, not the test's.
      if (codeOnly && rel !== entry) continue;
      // …and in the test itself, a bare file name is usually a fixture's, and a directory
      // ABOVE the test (`join(HERE, '..')`) is where it stands, not what it reads. Any
      // other directory is a subject: hook-runner-pin.test.mjs copies `.githooks/<h>` in
      // a loop, and requiring a listing call missed it (the 2026-09-30 CI red).
      if (codeOnly && (x.bare || (x.kind === 'dir' && `${posix.dirname(rel)}/`.startsWith(`${x.path}/`)))) continue;
      put(x, primary ? 1 : 2);
      if (follow && rel === entry && x.kind === 'file' && SCRIPT.test(x.path) && !x.path.includes('/test/') && !seen.has(x.path)) queue.push([x.path, true]);
    }
    for (const d of deps) queue.push([d, false]);
  }
  return { subjects: [...subjects.values()], closure: [...seen] };
}

/** Breadth is MEASURED, not assumed from depth: a top-level directory of two files
 *  (`.githooks`) is as specific as a file, and treating it as broad is how this tool's
 *  first CI run went red (2026-09-30: hook-runner-pin.test.mjs copies `.githooks/<h>`
 *  in a loop, so its subject is the directory, and the change to pre-push missed it). */
const BROAD_FILES = 50;
const wide = (subject) => (subject.size ?? Infinity) > BROAD_FILES;

/** Does one subject cover one path? And is that cover SPECIFIC (it maps the path)? */
export function covers(subject, path) {
  if (subject.kind === 'file') return subject.path === path ? 'specific' : null;
  if (subject.kind === 'dir') {
    if (!path.startsWith(`${subject.path}/`)) return null;
    return TOP_LEVEL_ONLY(subject.path) && wide(subject) ? 'broad' : 'specific';
  }
  if (subject.kind === 'glob') {
    const re = subject.re ?? globToRegExp(subject.path);
    if (!re.test(path)) return null;
    // broad when its only literal segment is one top-level directory (`apps/**`, `apps/**/**`)
    const literal = subject.path.split('/').filter((x) => !x.includes('*'));
    return literal.length <= 1 && /\*$/.test(subject.path) && wide(subject) ? 'broad' : 'specific';
  }
  if (subject.kind === 'lane') return subject.re.test(path) ? 'specific' : null;
  // A guard whose subject is a SHAPE OF TEXT, not a place (CONTENT_SUBJECTS below):
  // the changed file's own text decides, and a match is as specific as a named file.
  if (subject.kind === 'content') return subject.test(path, subject.read(path)) ? 'specific' : null;
  return null;
}

// ── the check universe ───────────────────────────────────────────────────────

/** The workflows a pull request runs: ci.yml and every local workflow it calls. */
function prWorkflows(parsed) {
  const byName = new Map(parsed.map((p) => [p.rel.split('/').pop(), p]));
  const ci = byName.get(CI_WORKFLOW);
  if (!ci) return [];
  const out = [ci];
  for (const job of ci.jobs.values()) {
    for (const l of job.lines) {
      const m = l.text.match(/^\s+uses:\s*\.\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)\s*$/);
      if (m && byName.has(m[1]) && !out.includes(byName.get(m[1]))) out.push(byName.get(m[1]));
    }
  }
  return out;
}

/** The working directory a step runs in: its own, else the job's defaults. */
function workingDir(wf, job, step) {
  const lines = job.lines ?? [];
  if (step) {
    for (const l of lines) {
      if (l.n < step.first || l.n > step.last) continue;
      const m = l.text.match(/^\s+working-directory:\s*(\S+)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  const d = lines.findIndex((l) => /^ {4}defaults:\s*$/.test(l.text));
  if (d !== -1) {
    for (let k = d + 1; k < lines.length && (/^ {6,}/.test(lines[k].text) || !lines[k].text.trim()); k++) {
      const m = lines[k].text.match(/^\s+working-directory:\s*(\S+)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  // the workflow's own `defaults: run: working-directory:`
  const top = wf.lines ?? [];
  const w = top.findIndex((l) => /^defaults:\s*$/.test(l.text));
  if (w !== -1) {
    for (let k = w + 1; k < top.length && (/^ /.test(top[k].text) || !top[k].text.trim()); k++) {
      const m = top[k].text.match(/^ {4}working-directory:\s*(\S+)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return '.';
}

/** Split one shell segment into words, honouring quotes; `$(`, `)`, and redirections end it. */
function words(seg) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === '\'') { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    if (c === ')' || c === '>' || c === '<') { if (has || cur) out.push(cur); cur = ''; has = false; if (c !== ')') break; continue; }
    cur += c;
  }
  if (has || cur) out.push(cur);
  return out.filter((w) => !/^\d$/.test(w));
}

/** Node flags that take their value as the NEXT word. */
const VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-concurrency', '--env-file', '--conditions', '-C']);

/** `node [flags] <script> [args]` → { flags, script, args }; `node … --test <globs>` → { test }. */
export function parseNodeCall(seg) {
  const w = words(seg);
  const at = w.findIndex((x) => x === 'node');
  if (at === -1) return null;
  const flags = [];
  let test = null;
  let k = at + 1;
  for (; k < w.length; k++) {
    const x = w[k];
    if (x === '--test') { test = []; continue; }
    if (x.startsWith('-')) {
      flags.push(x);
      if (VALUE_FLAGS.has(x) && k + 1 < w.length) flags.push(w[++k]);
      continue;
    }
    if (test) { test.push(x); continue; }
    break;
  }
  // A test call keeps its node flags, less the reporters (CI's junit file is a runner path).
  if (test) {
    const kept = [];
    for (let i = 0; i < flags.length; i++) {
      if (/^--test-reporter(-destination)?$/.test(flags[i])) { i++; continue; }
      if (/^--test-reporter/.test(flags[i]) || flags[i].includes('${{')) continue;
      kept.push(flags[i]);
    }
    return { test, flags: kept };
  }
  const script = w[k];
  if (!script || !/\.(m?js|cjs)$/.test(script)) return null;
  return { flags, script, args: w.slice(k + 1) };
}

/** Every `node <script>` and `node --test <files>` call the PR workflows make. */
export function workflowCalls(root, parsed = parseAllWorkflows(root)) {
  const calls = [];
  const tests = [];
  for (const wf of prWorkflows(parsed)) {
    const wfName = wf.rel.split('/').pop();
    for (const job of wf.jobs.values()) {
      for (const step of workflowSteps(job)) {
        if (!step.run) continue;
        const wd = workingDir(wf, job, step);
        if (wd.includes('${{')) continue;
        const pr = [...step.env.values()].some((v) => /\$\{\{\s*github\.event\./.test(v.value ?? ''));
        const segs = shellSegments(step.run.text);
        // A guard-tests shard runs `node --test $(cat <plan>)`: its files come from
        // guard-test-shards.mjs --plan in the same step, and are the whole suite
        // across the matrix. Without this the `$` below drops every guard suite.
        const sharded = segs.some((seg) => {
          const c = parseNodeCall(seg);
          return c?.script && posix.normalize(posix.join(wd, c.script)) === SHARD_SCRIPT && c.args.includes('--plan');
        });
        for (const seg of segs) {
          const call = parseNodeCall(seg);
          if (!call) continue;
          if (call.test) {
            let literal = 0;
            for (const g of call.test) {
              const glob = posix.normalize(posix.join(wd, g));
              if (/\.(m?js|cjs)$/.test(glob) && !glob.includes('$')) {
                tests.push({ wf: wfName, job: job.name, glob, wd, flags: call.flags });
                literal++;
              }
            }
            if (sharded && literal === 0) tests.push({ wf: wfName, job: job.name, glob: `${SHARD_TEST_DIR}/*.test.mjs`, wd, flags: call.flags });
            continue;
          }
          const rel = posix.normalize(posix.join(wd, call.script));
          calls.push({ wf: wfName, job: job.name, step: step.name, rel, wd, flags: call.flags, args: call.args, pr });
        }
      }
    }
  }
  return { calls, tests };
}

/** Why this machine cannot make a call as CI makes it, or null. */
export function blocker(call, root) {
  if (call.pr) return 'its step reads the pull request event (github.event.*), which exists only in CI';
  const raw = call.args.join(' ');
  if (/\$\{\{/.test(raw)) return `a CI expression in its arguments: \`${raw}\``;
  if (/\$\{?\w+\}?/.test(raw)) return `a runner variable in its arguments: \`${raw}\``;
  for (const tok of call.args) {
    const bare = tok.replace(/^["']|["']$/g, '');
    if (!bare || bare.startsWith('-') || !bare.includes('/')) continue;
    if (!existsSync(join(root, call.wd, bare))) return `its subject does not exist here: \`${bare}\` (CI-ephemeral)`;
  }
  return null;
}

const PUBLISHING = /^(deploy-|submit-|build-platforms|release)/;
/** Checks whose subject directory is their own code: its tier comes from the subject. */
const OWN_DIR_KINDS = new Set(['dart-analyze', 'dart-test', 'worker']);

/** The lane-map lane a workflow file runs: the lane whose `callee` it is, or the lane
 *  its name starts with (`extensions-ci.yml` → extensions). ci.yml is no lane's. */
function laneOf(laneMap, wfName) {
  if (!laneMap?.lanes || wfName === CI_WORKFLOW) return null;
  for (const lane of laneMap.lanes.values()) {
    if (lane.callee && lane.callee.split('/').pop() === wfName) return lane;
  }
  for (const [name, lane] of laneMap.lanes) if (wfName.startsWith(`${name}-`)) return lane;
  return null;
}

// ── CONTENT SUBJECTS — guards whose subject is a shape of text, not a place ──
// ⏱ 2026-10-01 (#1076 cycle 3). Every subject above is a PATH a guard's source
// names. Some guards name none, because their subject is "ANY file whose text
// has X": assert-workflow-readers.mjs grades any code file that reads a workflow
// by text, and assert-mechanism-claims.mjs any text file carrying a claim shape.
// A path cannot map them — tooling/ops/land-rules.mjs began to name
// '.github/workflows/ci.yml', and nothing selected the workflow-readers guard
// that then went red in CI; a prose edit selected no mechanism-claims run at all.
// So these get a CONTENT subject, matched against the changed file's own text,
// and built FROM WHAT THE GUARD ITSELF DECLARES — its detector read out of its
// source, its register's shapes and rows — never from a second copy kept here,
// which is the copy that drifts. A rule that cannot read its declaration is
// COVERAGE LOST: a content subject that silently matches nothing is a guard that
// silently stopped being selected.

/** The regex literals of `const <name> = [ /…/, … ];` in [src], one per line. */
function regexArrayIn(src, name, guard) {
  const m = new RegExp(`const ${name} = \\[\\n([\\s\\S]*?)\\n\\];`).exec(src);
  const out = [];
  for (const line of (m?.[1] ?? '').split('\n')) {
    const r = /^\s*\/(.+)\/([a-z]*),?\s*$/.exec(line);
    if (r) out.push(new RegExp(r[1], r[2]));
  }
  if (!out.length) throw new Error(`${guard} no longer declares \`const ${name} = [ /…/, … ];\` — its content subject cannot be read`);
  return out;
}

/** The single regex literal of `const <name> = /…/flags;` in [src]. */
function regexIn(src, name, guard) {
  const m = new RegExp(`const ${name} = \\/(.+)\\/([a-z]*);`).exec(src);
  if (!m) throw new Error(`${guard} no longer declares \`const ${name} = /…/;\` — its content subject cannot be read`);
  return new RegExp(m[1], m[2]);
}

/** A JSON register the rule reads, or a thrown reason. */
function registerOf(readSource, rel, guard) {
  try {
    return JSON.parse(readSource(rel));
  } catch (e) {
    throw new Error(`${rel} (what ${guard} judges against) could not be read: ${e.message}`);
  }
}

export const CONTENT_SUBJECTS = Object.freeze([
  {
    guard: 'tooling/ci/assert-workflow-readers.mjs',
    what: 'any code file that reads a workflow by text, or a row of tooling/workflow-readers.json',
    build(readSource) {
      const src = readSource(this.guard);
      const reads = regexArrayIn(src, 'READS', this.guard);
      const code = regexIn(src, 'CODE', this.guard);
      const reg = registerOf(readSource, 'tooling/workflow-readers.json', this.guard);
      const rows = new Set((reg.readers ?? []).map((r) => r?.path).filter((x) => typeof x === 'string'));
      if (!rows.size) throw new Error('tooling/workflow-readers.json declares no `readers` — the rows a deletion would leave behind cannot be read');
      return (path, text) =>
        rows.has(path) ||
        (code.test(path) && !/\.test\.(mjs|js|ts)$/.test(path) && !path.startsWith('.github/') && reads.some((re) => re.test(text)));
    },
  },
  {
    guard: 'tooling/ci/assert-mechanism-claims.mjs',
    what: 'any text file carrying a mechanism-claim shape, or one tooling/mechanism-claims.json names',
    build(readSource) {
      const src = readSource(this.guard);
      const gap = /const GAP = '([^']+)';/.exec(src);
      if (!gap) throw new Error(`${this.guard} no longer declares \`const GAP = '…';\` — its shapes cannot be compiled as it compiles them`);
      const GAP = gap[1].replaceAll('\\\\', '\\');
      const reg = registerOf(readSource, 'tooling/mechanism-claims.json', this.guard);
      const shapes = (reg.shapes ?? []).map((x) => new RegExp(String(x.pattern).split(' ').join(GAP), 'i'));
      if (!shapes.length) throw new Error('tooling/mechanism-claims.json declares no `shapes`');
      const named = new Set([...Object.keys(reg.backlog ?? {}), ...(reg.claims ?? []).map((c) => c?.file)].filter((x) => typeof x === 'string'));
      return (path, text) => named.has(path) || shapes.some((re) => re.test(text));
    },
  },
  {
    // ⏱ 2026-10-01 (O-NO-PORT-SELECTS-AN-ADAPTER-BY-CONFIG). A port's subject is
    // every file its REGISTRY names — adapter impl files, interface files, conformance
    // files, hand tables — and those paths live only in tooling/ports/*.json, which
    // the guard reads as data (the static extraction's blind spot, header above). So
    // the rule reads the same registries, by CONTENT, never a path list kept here.
    guard: 'tooling/ci/assert-ports.mjs',
    what: 'tooling/ports/**, services/_shared/src/ports/**, services/*/src/ports.ts and src/generated/ports.ts, and every file a tooling/ports/*.json registry names',
    build(readSource, tree) {
      const regs = (tree?.list ?? []).filter((f) => /^tooling\/ports\/[^/]+\.json$/.test(f) && !f.endsWith('/port.schema.json'));
      if (!regs.length) throw new Error('tooling/ports/ holds no registry — the port guard\'s subjects cannot be read');
      const named = new Set();
      const walk = (v, key) => {
        // `modules`: an adapter's outbound private modules (port-pay-core), protected by limb 4 like its file.
        if (typeof v === 'string') { if (key === 'file' || key === 'modules') named.add(v); return; }
        if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
      };
      for (const rel of regs) {
        const doc = registerOf(readSource, rel, this.guard);
        walk(doc);
        const src = doc?.selection?.source;
        if (typeof src === 'string') named.add(src.split('#')[0]);
      }
      if (!named.size) throw new Error('no tooling/ports/*.json registry names a file — the port guard\'s subjects cannot be read');
      // A Worker's composition root and its rendered port table are subjects by CONVENTION
      // (tooling/ports/README.md §3; limbs 4 and 3), so they are matched by shape, not listed.
      // ⏱ 2026-10-01 · port-pay-client: so are the Dart rail map limb 3 re-renders (and the fee
      // register it derives the store-billed rails from), and every Dart lib file — limb 10
      // DERIVES the client adapter set from the classes in packages/*/lib that implement a seam,
      // and refuses an apps/*/lib or packages/*/lib import of the shared fakes.
      return (path) => named.has(path) || path.startsWith('tooling/ports/') || path.startsWith('services/_shared/src/ports/') ||
        /^services\/[^/]+\/src\/(?:generated\/)?ports\.ts$/.test(path) ||
        path === 'tooling/catalog/fee-register.json' ||
        /^(?:packages|apps)\/[^/]+\/lib\/.+\.dart$/.test(path);
    },
  },
]);

/** The changed file's text for a content subject: '' when it is gone or too big to be prose. */
function textReader(root) {
  const cache = new Map();
  return (rel) => {
    if (!cache.has(rel)) {
      let text = '';
      try {
        const buf = readFileSync(join(root, rel));
        if (buf.length <= 2_000_000 && !buf.includes(0)) text = buf.toString('utf8');
      } catch { /* deleted or unreadable: the rule's named rows still answer */ }
      cache.set(rel, text);
    }
    return cache.get(rel);
  };
}

/** The whole check universe, with each check's subjects. Pure over its inputs
 *  except for reading sources through `readSource`. */
export function buildChecks(root, tree, { parsed, readSource = (rel) => readFileSync(join(root, rel), 'utf8'), laneMap = readMap(root), pubspec } = {}) {
  const checks = [];
  const { calls, tests } = workflowCalls(root, parsed ?? parseAllWorkflows(root));
  const blocked = [];

  // guards — one check per distinct (script, flags, args, wd)
  const seen = new Map();
  for (const c of calls) {
    if (PUBLISHING.test(c.wf)) continue;
    if (!tree.files.has(c.rel)) continue;
    const key = [c.rel, c.flags.join(' '), c.args.join(' '), c.wd].join('\u0001');
    if (seen.has(key)) { seen.get(key).jobs.add(`${c.wf}#${c.job}`); continue; }
    const why = blocker(c, root);
    if (why) { blocked.push({ ...c, why }); continue; }
    const base = c.rel.split('/').pop().replace(SCRIPT, '');
    const check = {
      kind: 'guard', rel: c.rel, wd: c.wd, flags: c.flags, args: c.args,
      jobs: new Set([`${c.wf}#${c.job}`]),
      cmd: process.execPath, argv: [...c.flags, posix.relative(c.wd, c.rel) || c.rel, ...c.args], ceilingMs: 300_000,
      baseComparable: true,
      label: `${base}${c.args.length ? ` ${c.args.join(' ')}` : ''}`,
    };
    seen.set(key, check);
    checks.push(check);
  }
  // one id per check: the script's name, numbered when one script is called more than one way
  const byBase = new Map();
  for (const c of checks) {
    const b = c.rel.split('/').pop().replace(SCRIPT, '');
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(c);
  }
  for (const [b, list] of byBase) list.forEach((c, k) => { c.id = `guard:${b}${list.length > 1 ? `#${k + 1}` : ''}`; });

  // tests — one check per test file
  const testSeen = new Set();
  for (const t of tests) {
    let re;
    try { re = globToRegExp(t.glob); } catch { continue; }
    for (const f of tree.list) {
      if (!re.test(f) || testSeen.has(f)) continue;
      testSeen.add(f);
      checks.push({
        kind: 'test', id: `test:${f.split('/').pop().replace(/\.test\.m?js$|\.m?js$/, '')}`, rel: f, wd: t.wd,
        jobs: new Set([`${t.wf}#${t.job}`]),
        cmd: process.execPath,
        argv: [...t.flags, '--test', posix.relative(t.wd, f)],
        ceilingMs: 600_000, baseComparable: true, label: f,
      });
    }
  }
  const ids = new Map();
  for (const c of checks.filter((x) => x.kind === 'test')) {
    if (ids.has(c.id)) c.id = `test:${c.rel}`;
    ids.set(c.id, c);
  }

  // subjects of every script-backed check
  const cache = new Map();
  for (const c of checks) {
    const k = `${c.kind}:${c.rel}`;
    if (!cache.has(k)) cache.set(k, closureSubjects(c.rel, tree, readSource, { follow: c.kind === 'test', codeOnly: c.kind === 'test' }));
    c.subjects = cache.get(k).subjects;
    // A check a LANE workflow makes (extensions-ci.yml, lane-workers.yml) also has that
    // lane's globs from lane-map.json: CI runs the whole lane when one of them changes,
    // and a lane's scripts find their subjects from manifests no literal names.
    const laneGlobs = [...c.jobs].flatMap((j) => laneOf(laneMap, j.split('#')[0])?.globs ?? []);
    if (laneGlobs.length) c.subjects = [...c.subjects, ...laneGlobs.map((g) => ({ kind: 'lane', path: g.glob, re: g.re }))];
  }

  // content — the guards whose subject is a shape of text (CONTENT_SUBJECTS)
  const contentLost = [];
  const read = textReader(root);
  for (const rule of CONTENT_SUBJECTS) {
    const targets = checks.filter((c) => c.kind === 'guard' && c.rel === rule.guard);
    if (!targets.length) continue; // not a CI guard of this tree: nothing to attach the rule to
    let test;
    try {
      test = rule.build(readSource, tree);
    } catch (e) {
      contentLost.push(e.message);
      continue;
    }
    for (const c of targets) c.subjects = [...c.subjects, { kind: 'content', path: rule.what, test, read }];
  }

  // dart — each pub workspace member
  const members = pubspec ?? workspaceMembers(root);
  for (const m of members) {
    const name = pubspecName(root, m) ?? m.split('/').pop();
    const subjects = [{ kind: 'dir', path: m, tier: 0 }]; // its own package: the tightest tie
    checks.push({ kind: 'dart-analyze', id: `dart-analyze:${name}`, pkg: name, dir: m, label: `dart analyze (${m})`,
      subjects: [...subjects, { kind: 'file', path: 'pubspec.yaml' }, { kind: 'file', path: 'pubspec.lock' }, { kind: 'file', path: 'analysis_options.yaml' }],
      ceilingMs: 600_000, baseComparable: false });
    if (tree.dirs.has(`${m}/test`)) {
      checks.push({ kind: 'dart-test', id: `dart-test:${name}`, pkg: name, dir: m, label: `tests (${m})`, subjects,
        ceilingMs: 900_000, baseComparable: false });
    }
  }

  // workers — services/<w> with a package.json, and the workers lane's globs
  const workersLane = laneMap?.lanes?.get('workers');
  for (const f of tree.list) {
    const m = f.match(/^services\/([^/]+)\/package\.json$/);
    if (!m) continue;
    // services/_shared is the kit, not a Worker (worker-set.mjs excludes it by name too): it has a
    // package.json since 2026-10-01 only to declare `jose`, and its suite runs inside every Worker's,
    // which the line below already ties it to.
    if (m[1] === '_shared') continue;
    const dir = `services/${m[1]}`;
    const subjects = [{ kind: 'dir', path: dir, tier: 0 }]; // its own Worker: the tightest tie
    for (const g of workersLane?.globs ?? []) if (!g.glob.startsWith('services/')) subjects.push({ kind: 'lane', path: g.glob, re: g.re });
    subjects.push({ kind: 'dir', path: 'services/_shared', tier: 1 });
    checks.push({ kind: 'worker', id: `worker:${m[1]}`, dir, label: `tsc --noEmit + npm test (${dir})`, subjects,
      ceilingMs: 600_000, baseComparable: true }); // a load-timed-out vitest case is red on main too (measured 2026-09-30)
  }
  return { checks, blocked, contentLost };
}

export function workspaceMembers(root) {
  let text;
  try { text = readFileSync(join(root, 'pubspec.yaml'), 'utf8'); } catch { return []; }
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at === -1) return [];
  const out = [];
  for (let k = at + 1; k < lines.length; k++) {
    const m = lines[k].match(/^\s+-\s+(\S+)\s*$/);
    if (m) { out.push(m[1].replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')); continue; }
    if (lines[k].trim() && !/^\s/.test(lines[k])) break;
  }
  return out;
}

function pubspecName(root, dir) {
  try {
    const m = readFileSync(join(root, dir, 'pubspec.yaml'), 'utf8').match(/^name:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}

// ── selection ────────────────────────────────────────────────────────────────

/** Select the checks for `changed`, and say which paths nothing maps. */
export function select(checks, changed, laneMap) {
  const selected = new Map();
  const mappedBy = new Map();
  const why = new Map();
  const tiers = new Map();
  for (const p of changed) {
    for (const c of checks) {
      let hit = null;
      let tier = 9;
      for (const s of c.subjects) {
        if (covers(s, p) !== 'specific') continue;
        hit = 'specific';
        // a directory, glob or lane glob is a looser tie than any named file (tier 3), except
        // a package gate's or Worker suite's OWN directory, which is its code (tier 0)
        tier = Math.min(tier, s.kind === 'file' || s.kind === 'content' ? (s.tier ?? 1) : OWN_DIR_KINDS.has(c.kind) ? (s.tier ?? 3) : 3);
      }
      // A broad subject (one whole top-level directory) neither selects nor maps: it
      // names no place specific enough to tie the check to this change.
      if (!hit) continue;
      selected.set(c.id, c);
      if (!tiers.has(c.id) || tiers.get(c.id) > tier) { tiers.set(c.id, tier); why.set(c.id, p); }
      if (hit === 'specific') {
        if (!mappedBy.has(p)) mappedBy.set(p, []);
        mappedBy.get(p).push(c.id);
      }
    }
  }
  const unclaimed = (p) => (laneMap?.unclaimed ?? []).some((g) => g.re.test(p));
  const unmapped = changed.filter((p) => !mappedBy.has(p) && !unclaimed(p));
  const declaredNothing = changed.filter((p) => !mappedBy.has(p) && unclaimed(p));
  return { selected: [...selected.values()], mappedBy, unmapped, declaredNothing, why, tiers };
}

// ── the changed paths ────────────────────────────────────────────────────────

/** The paths this branch changed. Without `sha`: merge-base(HEAD, baseRef)..HEAD plus every
 *  uncommitted change to a tracked file. With `sha` (the pre-push hook): merge-base..sha
 *  only — what the push sends — and `sha` must be HEAD here, because the checks run on
 *  this working tree and a verdict about another commit would be a verdict about nothing. */
export function changedPaths(root, baseRef, sha = null) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (sha) {
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const want = git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`).stdout.trim();
    if (!want) return { error: `${sha} is not a commit here` };
    if (want !== head) {
      return { error: `the pushed commit ${want.slice(0, 8)} is not HEAD (${head.slice(0, 8)}) of ${root}, and the checks run on this working tree — push it from a checkout of it` };
    }
  }
  const mb = git('merge-base', 'HEAD', baseRef);
  if (mb.status !== 0) return { error: `\`git merge-base HEAD ${baseRef}\` failed: ${(mb.stderr || '').trim().split('\n')[0]}` };
  const base = mb.stdout.trim();
  const committed = git('diff', '--name-only', '-z', `${base}`, 'HEAD');
  const local = git('diff', '--name-only', '-z', 'HEAD');
  if (committed.status !== 0 || local.status !== 0) return { error: 'git diff failed' };
  const set = new Set([...committed.stdout.split('\0'), ...(sha ? [] : local.stdout.split('\0'))].filter(Boolean));
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').stdout.split('\0').filter(Boolean)
    .filter((f) => !/^\.worktrees(\/|$)/.test(f));
  return { base, changed: [...set].sort(), dirty: local.stdout.split('\0').filter(Boolean).length, untracked };
}

// ── running ──────────────────────────────────────────────────────────────────

/** Spawn one command with output to a FILE and a ceiling. Resolves on the child's
 *  own exit, never on pipe EOF. { status, out, ms, timedOut }. */
export function runOne(cmd, args, { cwd, env = process.env, timeoutMs = 300_000, shell = false } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    let dir;
    let fd;
    try {
      dir = mkdtempSync(join(tmpdir(), 'affected-'));
      fd = openSync(join(dir, 'out'), 'w');
    } catch (e) {
      done({ status: null, out: `COULD NOT CAPTURE (${e.code ?? e.message}); not run`, ms: 0, timedOut: false });
      return;
    }
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, shell, windowsHide: true, stdio: ['ignore', fd, fd] });
    } catch (e) {
      closeSync(fd);
      done({ status: null, out: `could not start \`${cmd}\`: ${e.message}`, ms: 0, timedOut: false });
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else try { process.kill(child.pid, 'SIGKILL'); } catch {}
    }, timeoutMs);
    const finish = (status, extra = '') => {
      clearTimeout(timer);
      try { closeSync(fd); } catch {}
      let out = '';
      try { out = readFileSync(join(dir, 'out'), 'utf8'); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      done({ status: timedOut ? null : status, out: out + extra, ms: Date.now() - started, timedOut });
    };
    child.on('error', (e) => finish(null, `\n${e.message}`));
    child.on('exit', (code) => finish(code ?? null));
  });
}

async function pool(items, width, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
    while (next < items.length) {
      const k = next++;
      results[k] = await fn(items[k]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Run two queues on `width` lanes: lane 0 drains `slow` first, the others drain
 *  `fast` first; a lane whose queue is empty takes from the other. Returns id → result. */
async function twoQueues(slow, fast, width, fn) {
  const out = new Map();
  const queues = [slow.slice(), fast.slice()];
  const lanes = Array.from({ length: Math.max(1, width) }, async (_, k) => {
    const order = k === 0 && slow.length ? [0, 1] : [1, 0];
    for (;;) {
      const q = order.map((i) => queues[i]).find((x) => x.length);
      if (!q) return;
      const check = q.shift();
      out.set(check.id, await fn(check));
    }
  });
  await Promise.all(lanes);
  return out;
}

/** Tool environment for the Dart checks: the melos shim directory on PATH, and the
 *  Flutter SDK named by NIKATRU_FLUTTER_ROOT ahead of whatever PATH holds. */
function dartEnv() {
  const env = { ...process.env };
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = [];
  if (env.NIKATRU_FLUTTER_ROOT) extra.push(join(env.NIKATRU_FLUTTER_ROOT, 'bin'));
  if (process.platform === 'win32' && env.LOCALAPPDATA) extra.push(join(env.LOCALAPPDATA, 'Pub', 'Cache', 'bin'));
  else if (env.HOME) extra.push(join(env.HOME, '.pub-cache', 'bin'));
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[key] = [...extra, env[key]].join(sep);
  return env;
}

const MELOS = process.platform === 'win32' ? 'melos.bat' : 'melos';

/** The pinned Flutter version, and the one this environment would run. */
/** The first file named \`bin\` (with a PATHEXT extension on Windows) on env's PATH. */
function which(bin, env) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').concat('') : [''];
  for (const dir of String(env[key] ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) if (existsSync(join(dir, bin + ext))) return join(dir, bin + ext);
  }
  return null;
}

/** The Dart checks' preconditions, read from FILES: the SDK's own version record and
 *  the melos shim. Measured 2026-09-30 under load, `melos --version` took 91 s: a
 *  probe slower than some of the checks it guards. */
function flutterPrecondition(root, env) {
  let pinned = null;
  try { pinned = JSON.parse(readFileSync(join(root, 'tooling', 'versions.json'), 'utf8')).flutter ?? null; } catch {}
  const flutter = which('flutter', env);
  if (!flutter) return `no \`flutter\` on PATH (set NIKATRU_FLUTTER_ROOT to the SDK tooling/versions.json pins, ${pinned})`;
  let have = null;
  try { have = JSON.parse(readFileSync(join(dirname(flutter), 'cache', 'flutter.version.json'), 'utf8')).frameworkVersion ?? null; } catch {}
  if (!have) return `${flutter} has no readable bin/cache/flutter.version.json, so its version is unknown (run it once to bootstrap it)`;
  if (pinned && have !== pinned) return `the flutter on PATH is ${have} and tooling/versions.json pins ${pinned}: set NIKATRU_FLUTTER_ROOT to a ${pinned} SDK`;
  if (!which(MELOS.replace(/\.bat$/, ''), env)) return `no ${MELOS} on PATH or in the pub cache bin (activate it: dart pub global activate melos)`;
  return null;
}

/** node_modules finished installing, from the package-lock.json beside it. */
function installedAsLocked(dir) {
  try {
    const want = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages ?? {};
    const have = JSON.parse(readFileSync(join(dir, 'node_modules', '.package-lock.json'), 'utf8')).packages ?? {};
    return Object.keys(want).filter((k) => k.startsWith('node_modules/') && !want[k].optional)
      .every((k) => have[k]?.version === want[k].version);
  } catch { return false; }
}

/** A workflow word naming $SPAWN_CEILING, which setup-node exports in CI, as that
 *  checkout's preload URL — the replay runs with no shell to expand it. */
export const withCiEnv = (argv, root) => argv.map((a) => (/^\$(?:SPAWN_CEILING|\{SPAWN_CEILING\})$/.test(a) ? spawnCeilingUrl(root) : a));

/** Commands for one check. A worker check is a sequence. */
function commandsFor(check, root) {
  const shell = process.platform === 'win32';
  if (check.kind === 'guard' || check.kind === 'test') return [{ cmd: check.cmd, args: withCiEnv(check.argv, root), cwd: join(root, check.wd), shell: false }];
  if (check.kind === 'dart-analyze') return [{ cmd: MELOS, args: ['exec', `--scope=${check.pkg}`, '--', 'dart', 'analyze'], cwd: root, shell, env: 'dart' }];
  if (check.kind === 'dart-test') {
    return [
      { cmd: MELOS, args: ['exec', `--scope=${check.pkg}`, '--dir-exists=test', '--no-flutter', '--', 'dart', 'test'], cwd: root, shell, env: 'dart' },
      { cmd: MELOS, args: ['exec', `--scope=${check.pkg}`, '--dir-exists=test', '--flutter', '--', 'flutter', 'test', '--no-pub'], cwd: root, shell, env: 'dart' },
    ];
  }
  if (check.kind === 'worker') {
    const cwd = join(root, check.dir);
    const seq = [];
    // npm writes node_modules/.package-lock.json LAST: a directory without it is an
    // install that was killed half way (measured 2026-09-30: tsc missing, a 29 s red).
    if (!installedAsLocked(cwd)) seq.push({ cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'], cwd, shell });
    seq.push({ cmd: 'npx', args: ['tsc', '--noEmit'], cwd, shell });
    seq.push({ cmd: 'npm', args: ['test'], cwd, shell });
    return seq;
  }
  return [];
}

/** Run one check's commands under its ceiling, and under `deadline` (an epoch ms, or
 *  null): a check the deadline stops is `budgetCut`, not a timeout — it was not given
 *  its time, so it has no verdict, and the run says so by name. */
async function runCheck(check, root, envs, deadline = null) {
  const started = Date.now();
  let out = '';
  let status = 0;
  let timedOut = false;
  let budgetCut = false;
  // Whichever limit comes first names the stop: the deadline is a budget cut (no
  // verdict, named), the check's own ceiling a timeout (COVERAGE LOST).
  const byDeadline = deadline !== null && deadline <= started + check.ceilingMs;
  for (const c of commandsFor(check, root)) {
    const own = check.ceilingMs - (Date.now() - started);
    const left = deadline === null ? own : Math.min(own, deadline - Date.now());
    if (left <= 0) { if (byDeadline) budgetCut = true; else timedOut = true; status = null; break; }
    const r = await runOne(c.cmd, c.args, { cwd: c.cwd, shell: c.shell, env: c.env === 'dart' ? envs.dart : process.env, timeoutMs: left });
    out += `$ ${c.cmd} ${c.args.join(' ')}\n${r.out}\n`;
    if (r.timedOut) { if (byDeadline) budgetCut = true; else timedOut = true; status = null; break; }
    if (r.status !== 0) { status = r.status; break; }
  }
  return budgetCut ? { status: 0, out, ms: Date.now() - started, timedOut: false, budgetCut: true, stopped: true }
    : { status, out, ms: Date.now() - started, timedOut };
}

/** Porcelain status plus a content hash of every dirty path: what the checks wrote. */
function treeState(root) {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const state = new Map();
  for (const e of (r.stdout ?? '').split('\0').filter(Boolean)) {
    const p = e.slice(3);
    if (/^\.worktrees(\/|$)/.test(p)) continue;
    let stamp = e.slice(0, 2);
    // the CONTENT, not the mtime: a check that rewrites a file byte for byte wrote nothing
    try { stamp += `:${createHash('sha1').update(readFileSync(join(root, p))).digest('hex')}`; } catch { stamp += ':gone'; }
    state.set(p, stamp);
  }
  return state;
}

/** Re-run red script checks at merge-base(HEAD, baseRef). */
async function rerunOnBase(reds, root, baseRef, width) {
  const mb = spawnSync('git', ['merge-base', 'HEAD', baseRef], { cwd: root, encoding: 'utf8' });
  const sha = mb.status === 0 ? mb.stdout.trim() : '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return { error: `\`git merge-base HEAD ${baseRef}\` gave no commit`, results: new Map() };
  // A base verdict is a fact about (merge-base commit, check): a lane pushing twice on
  // one base re-runs nothing the first push already asked. The cache lives in the git
  // common dir, beside the skip log, and holds exit codes only.
  const cachePath = gitCommonFile(root, 'affected-guards-base-cache.json');
  let cache = {};
  try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch {}
  const results = new Map();
  const misses = reds.filter((c) => {
    const hit = cache[`${sha}:${c.id}`];
    if (hit && Number.isInteger(hit.status)) results.set(c.id, { evaluable: true, status: hit.status, out: hit.head ?? '', cached: true });
    return !results.has(c.id);
  });
  if (misses.length === 0) return { sha, error: null, results, cached: reds.length };
  const co = detachedCheckout({ root, sha, tag: 'agb' });
  if (co.error) return { error: co.error, results: new Map() };
  reds = misses;
  // The base phase is bounded too: a red the base cannot answer in BASE_MS is COVERAGE
  // LOST, never a pass.
  const deadline = Date.now() + BASE_MS;
  // A Worker at the base borrows this tree's node_modules through a link when its
  // package-lock.json is byte-identical — `npm ci` per Worker would spend the whole
  // base limit. Each link is removed BEFORE the checkout is, so the removal never
  // walks into the borrowed directory.
  const links = [];
  try {
    await pool(reds, width, async (check) => {
      if (!existsSync(join(co.dir, check.rel ?? check.dir))) {
        results.set(check.id, { evaluable: false, reason: 'the script does not exist at the base — it is new on this branch, so main cannot vouch for its red' });
        return;
      }
      if (check.kind === 'worker') {
        const lock = (d) => { try { return readFileSync(join(d, check.dir, 'package-lock.json'), 'utf8'); } catch { return null; } };
        const mine = join(root, check.dir, 'node_modules');
        const theirs = join(co.dir, check.dir, 'node_modules');
        if (lock(root) !== null && lock(root) === lock(co.dir) && installedAsLocked(join(root, check.dir)) && !existsSync(theirs)) {
          try { symlinkSync(mine, theirs, 'junction'); links.push(theirs); } catch {}
        }
      }
      const r = await runCheck(check, co.dir, {}, deadline);
      if (r.budgetCut) results.set(check.id, { evaluable: false, reason: `the base re-run was stopped at its ${BASE_MS / 1000} s limit` });
      else if (r.timedOut) results.set(check.id, { evaluable: false, reason: `it timed out at the base (${check.ceilingMs / 1000}s)` });
      else {
        results.set(check.id, { evaluable: true, status: r.status, out: r.out });
        cache[`${sha}:${check.id}`] = { status: r.status, head: firstLine(r.out.replace(/^\$ .*\n/, '')) };
      }
    });
  } finally {
    for (const l of links) { try { unlinkSync(l); } catch { try { rmdirSync(l); } catch {} } }
    const stillLinked = links.filter((l) => { try { lstatSync(l); return true; } catch { return false; } });
    if (stillLinked.length) {
      // never remove a checkout that still links into this tree
      results.cleanup = `the base checkout ${co.dir} still links ${stillLinked.join(', ')} into this tree, so it was NOT removed — unlink those, then: git worktree remove --force "${co.dir}"`;
      try { writeFileSync(cachePath, JSON.stringify(cache, null, 1)); } catch {}
      return { sha, error: null, results, cached: results.size - reds.length };
    }
    const why = removeCheckout({ root, dir: co.dir });
    if (why) results.cleanup = why;
    try { writeFileSync(cachePath, JSON.stringify(cache, null, 1)); } catch {}
  }
  return { sha, error: null, results, cached: results.size - reds.length };
}

/** A file in the git common dir (shared by every worktree of the repository). */
function gitCommonFile(root, name) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  const dir = r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
  return dir ? join(dir, name) : null;
}

const skipLogPath = (root) => gitCommonFile(root, 'affected-guards-skips.log');

const firstLine = (s) => (String(s ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '').trim();
const lastLines = (s, k = 8) => String(s ?? '').split(/\r?\n/).filter((l) => l.trim()).slice(-k);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return null;
  return v;
}

export async function main(argv = process.argv.slice(2), { root = ROOT, log = console.log, err = console.error } = {}) {
  const t0 = Date.now();
  for (const f of ['--base', '--jobs', '--json', '--skip-for-ci', '--reason', '--root', '--sha', '--budget-s']) {
    if (argValue(argv, f) === null) { err(`✗ ${f} needs a value after it.`); return 2; }
  }
  // The budget: no check STARTS after it, and one still running GRACE_MS later is
  // stopped. Default DEFAULT_BUDGET_S; --no-budget runs every selected check.
  const budgetRaw = argValue(argv, '--budget-s') ?? process.env.NIKATRU_AFFECTED_BUDGET_S ?? String(DEFAULT_BUDGET_S);
  const budgetS = Number(budgetRaw);
  if (!Number.isFinite(budgetS) || budgetS < BUDGET_FLOOR_S) {
    err(`✗ the budget must be a number of seconds, at least ${BUDGET_FLOOR_S} (got \`${budgetRaw}\`); a smaller one would cut most checks and pass the push.`);
    return 2;
  }
  const budgetMs = argv.includes('--no-budget') ? null : budgetS * 1000;
  if (argValue(argv, '--root')) root = resolve(argValue(argv, '--root'));
  const sha = argValue(argv, '--sha') ?? null;
  const baseRef = argValue(argv, '--base') ?? 'origin/main';
  const width = Number(argValue(argv, '--jobs') ?? Math.min(4, availableParallelism()));
  if (!Number.isInteger(width) || width < 1) { err('✗ --jobs needs a positive integer.'); return 2; }
  const listOnly = argv.includes('--list');
  const jsonOut = argValue(argv, '--json');
  const skipRaw = argValue(argv, '--skip-for-ci') ?? process.env.NIKATRU_SKIP_FOR_CI ?? '';
  const skipReason = argValue(argv, '--reason') ?? process.env.NIKATRU_SKIP_FOR_CI_REASON ?? '';
  const skipIds = skipRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (skipIds.length && !skipReason.trim()) {
    err('✗ a skip needs a reason: --reason "<why this check must run in CI and not here>" (or NIKATRU_SKIP_FOR_CI_REASON).');
    return 2;
  }
  const pathsAt = argv.indexOf('--paths');

  // 1 · the changed paths
  let changed;
  let info = '';
  if (pathsAt !== -1) {
    // every word after --paths up to the next --flag
    const rest = argv.slice(pathsAt + 1);
    const end = rest.findIndex((a) => a.startsWith('--'));
    changed = (end === -1 ? rest : rest.slice(0, end)).map((p) => p.replace(/\\/g, '/'));
    info = `${changed.length} path(s) given with --paths`;
  } else {
    const c = changedPaths(root, baseRef, sha);
    if (c.error) { err(`🔴 COVERAGE LOST — ${c.error}. Without the diff nothing can be selected.`); return 2; }
    changed = c.changed;
    info = `${changed.length} changed path(s) vs merge-base ${c.base.slice(0, 8)} of ${baseRef}` +
      (sha
        ? ` in the pushed commit${c.dirty ? ` · ⚠️ ${c.dirty} uncommitted change(s) are NOT pushed but ARE in the tree the checks read` : ''}`
        : ` (${c.dirty} uncommitted, included)`) +
      (c.untracked.length ? ` · ${c.untracked.length} untracked file(s) not judged — CI never sees them; \`git add\` what should be` : '');
  }
  log(`affected-guards: ${info}`);
  if (changed.length === 0) { log('affected-guards: nothing changed, nothing to run. (0 s)'); return 0; }

  // 2 · the universe and the selection
  let tree;
  let laneMap;
  try {
    tree = trackedTree(root);
    laneMap = readMap(root);
  } catch (e) {
    err(`🔴 COVERAGE LOST — ${e.message}`);
    return 2;
  }
  const { checks, blocked, contentLost } = buildChecks(root, tree, { laneMap });
  if (contentLost.length) {
    for (const why of contentLost) err(`🔴 COVERAGE LOST — ${why}`);
    return 2;
  }
  if (checks.filter((c) => c.kind === 'guard').length === 0 || checks.filter((c) => c.kind === 'test').length === 0) {
    err('🔴 COVERAGE LOST — the workflows yielded no guard or no test call, so nothing could be selected. The workflow parse is blind.');
    return 2;
  }
  const sel = select(checks, changed, laneMap);
  const mappedCount = changed.length - sel.unmapped.length;
  const pct = Math.round((1000 * mappedCount) / changed.length) / 10;
  const kinds = (k) => sel.selected.filter((c) => c.kind === k).length;
  log(`affected-guards: selected ${sel.selected.length} of ${checks.length} checks — ${kinds('guard')} guard · ${kinds('test')} test · ` +
    `${kinds('dart-analyze')} dart analyze · ${kinds('dart-test')} dart test · ${kinds('worker')} worker`);
  log(`affected-guards: coverage ${mappedCount}/${changed.length} changed paths mapped (${pct}%)` +
    (sel.declaredNothing.length ? ` · ${sel.declaredNothing.length} declared ungraded by lane-map.json \`unclaimed\`` : ''));
  for (const p of sel.unmapped) log(`🔴 UNMAPPED  ${p}  — no check's subject names it, and lane-map.json does not declare it ungraded`);

  // 3 · the skips
  const selectedIds = new Set(sel.selected.map((c) => c.id));
  const badSkips = skipIds.filter((id) => !selectedIds.has(id));
  if (badSkips.length) {
    err(`✗ --skip-for-ci names ${badSkips.join(', ')}, which this run did not select. A skip must name a selected check; ` +
      `selected: ${[...selectedIds].sort().join(', ')}`);
    return 2;
  }
  // TWO QUEUES, because one order starved one side either way (measured under load,
  // 2026-09-30): slow tests first cut 19 guards of 1–5 s, the meta guards CI fails on
  // most; tier-0 Dart first put three ~210 s analyzes on three of four lanes and cut 83
  // guards. So the SLOW queue — every non-guard check tied at tier 0 or 1 (the changed
  // package's gates, its Worker suite, the tests of a changed guard) — gets one lane,
  // and the FAST queue — every guard, tightest first, then the looser slow checks —
  // gets the rest. A lane whose queue is empty takes from the other.
  const KIND_ORDER = { guard: 0, worker: 1, 'dart-analyze': 2, test: 3, 'dart-test': 4 };
  const toRun = sel.selected.filter((c) => !skipIds.includes(c.id))
    .sort((a, b) => (sel.tiers.get(a.id) - sel.tiers.get(b.id)) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.id.localeCompare(b.id));
  const slowQueue = toRun.filter((c) => c.kind !== 'guard' && sel.tiers.get(c.id) <= 1);
  const fastQueue = [...toRun.filter((c) => c.kind === 'guard'), ...toRun.filter((c) => c.kind !== 'guard' && sel.tiers.get(c.id) > 1)];

  if (listOnly) {
    for (const c of toRun) log(`   tier ${sel.tiers.get(c.id)}  ${c.id.padEnd(48)} ← ${sel.why.get(c.id)}`);
    log(`affected-guards: --list, nothing run (${secs(Date.now() - t0)})`);
    return sel.unmapped.length ? 2 : 0;
  }

  if (skipIds.length) {
    const logPath = skipLogPath(root);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    for (const id of skipIds) log(`⏭  SKIPPED-FOR-CI  ${id}  — ${skipReason}`);
    if (logPath) {
      try {
        appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), head, skipped: skipIds, reason: skipReason })}\n`);
        log(`   logged to ${logPath}`);
      } catch (e) { err(`🔴 COVERAGE LOST — the skip could not be logged to ${logPath} (${e.code ?? e.message}); a skip is logged or refused.`); return 2; }
    } else { err('🔴 COVERAGE LOST — no git common dir to log the skip into; a skip is logged or refused.'); return 2; }
  }

  // 4 · preconditions for the Dart checks
  const envs = { dart: dartEnv() };
  let dartBlocked = null;
  if (toRun.some((c) => c.kind.startsWith('dart-'))) {
    dartBlocked = flutterPrecondition(root, envs.dart);
    if (!dartBlocked && !existsSync(join(root, '.dart_tool', 'package_config.json'))) {
      log('affected-guards: the workspace is not resolved here — `flutter pub get --enforce-lockfile` at the root first…');
      const before = treeState(root);
      const r = await runOne('flutter', ['pub', 'get', '--enforce-lockfile'], { cwd: root, env: envs.dart, shell: process.platform === 'win32', timeoutMs: 600_000 });
      // On Windows without Developer Mode pub get resolves, writes package_config.json and
      // then exits 1 on the plugin-symlink step (measured 2026-09-30). The resolution is
      // what analyze and test need, so the file decides; the exit code is printed.
      if (!existsSync(join(root, '.dart_tool', 'package_config.json'))) {
        dartBlocked = `\`flutter pub get --enforce-lockfile\` exited ${r.status} and resolved nothing: ${firstLine(r.out)}`;
      } else if (r.status !== 0) {
        log(`⚠️  flutter pub get exited ${r.status} after resolving the workspace (${lastLines(r.out, 1)[0] ?? ''}); continuing on the resolution`);
      }
      // pub get rewrites each member's analysis_options.yaml; put back only files that were clean before.
      const after = treeState(root);
      const rewritten = [...after.keys()].filter((p) => !before.has(p) && /(^|\/)analysis_options\.yaml$/.test(p));
      if (rewritten.length) spawnSync('git', ['checkout', '--', ...rewritten], { cwd: root });
    }
  }

  // 5 · run
  const before = treeState(root);
  const tRun = Date.now();
  log(`affected-guards: running ${toRun.length} check(s), ${width} at a time${budgetMs === null ? ', no budget' : `, none started after ${budgetMs / 1000} s`}…`);
  const byId = await twoQueues(slowQueue, fastQueue, width, async (check) => {
    if (budgetMs !== null && Date.now() - tRun > budgetMs) return { status: 0, out: '', ms: 0, timedOut: false, budgetCut: true };
    if (check.kind.startsWith('dart-') && dartBlocked) return { status: null, out: dartBlocked, ms: 0, timedOut: false, blocked: true };
    const r = await runCheck(check, root, envs, budgetMs === null ? null : tRun + budgetMs + GRACE_MS);
    if (r.stopped) { log(`⏭ ${'STOPPED'.padStart(7)}  ${secs(r.ms).padStart(7)}  ${check.id} — still running at the hard stop (budget + ${GRACE_MS / 1000} s)`); return r; }
    const mark = r.status === 0 ? '✓' : '✗';
    log(`${mark} ${String(r.status === null ? (r.timedOut ? 'TIMEOUT' : 'null') : r.status).padStart(7)}  ${secs(r.ms).padStart(7)}  ${check.id}`);
    return r;
  });
  const results = toRun.map((c) => byId.get(c.id));
  const runMs = Date.now() - tRun;
  for (const [k, r] of results.entries()) if (r.blocked) log(`🔴 ${'BLOCKED'.padStart(7)}  ${'-'.padStart(7)}  ${toRun[k].id} — ${r.out}`);

  // 6 · the reds, judged against the base
  const reds = toRun.map((c, k) => ({ c, r: results[k] })).filter(({ r }) => r.status !== 0);
  const comparable = reds.filter(({ c, r }) => c.baseComparable && r.status !== null);
  let base = { results: new Map(), error: null };
  if (comparable.length) {
    log(`affected-guards: ${comparable.length} red script check(s) — re-running them at the merge-base…`);
    const tBase = Date.now();
    base = await rerunOnBase(comparable.map(({ c }) => c), root, baseRef, width);
    log(`affected-guards: the base answered in ${secs(Date.now() - tBase)}${base.cached ? ` (${base.cached} verdict(s) from the per-merge-base cache)` : ''}`);
  }
  const verdicts = [];
  for (const { c, r } of reds) {
    if (r.blocked) { verdicts.push({ c, r, kind: 'COVERAGE-LOST', why: r.out }); continue; }
    if (!c.baseComparable) {
      verdicts.push(r.status === null ? { c, r, kind: 'COVERAGE-LOST', why: 'it timed out, so there is no verdict' } : { c, r, kind: 'REGRESSION', why: 'red here (not re-run at the base)' });
      continue;
    }
    const b = base.error ? { evaluable: false, reason: base.error } : base.results.get(c.id);
    verdicts.push({ c, r, ...classifyRed({ status: r.status }, b) });
  }

  // 7 · what the checks wrote
  const after = treeState(root);
  const wrote = [...after.keys()].filter((p) => before.get(p) !== after.get(p))
    .concat([...before.keys()].filter((p) => !after.has(p)));

  // 8 · report
  log('');
  for (const v of verdicts) {
    const tag = v.kind === 'REGRESSION' ? '✗ FINDING      ' : v.kind === 'ENVIRONMENTAL' ? '⬜ ENVIRONMENTAL' : '🔴 COVERAGE LOST';
    log(`${tag} ${v.c.id} — ${v.why}`);
    if (v.kind !== 'ENVIRONMENTAL') for (const l of lastLines(v.r.out)) log(`      │ ${l.slice(0, 220)}`);
  }
  if (base.results?.cleanup) log(`⚠️ ${base.results.cleanup}`);
  for (const p of wrote) log(`✗ FINDING       the checks rewrote ${p} — CI runs the same check and fails on this diff; review it and commit it (or revert it)`);
  for (const b of blocked.filter((x) => sel.selected.some((c) => c.rel === x.rel))) {
    log(`⬜ NOT RUN HERE  ${b.rel} ${b.args.join(' ')} (${b.wf}#${b.job}) — ${b.why}`);
  }

  const findings = verdicts.filter((v) => v.kind === 'REGRESSION').length + wrote.length;
  const lost = verdicts.filter((v) => v.kind === 'COVERAGE-LOST').length + sel.unmapped.length;
  const env = verdicts.filter((v) => v.kind === 'ENVIRONMENTAL').length;
  const cut = toRun.filter((c, k) => results[k].budgetCut);
  const green = results.filter((r) => r.status === 0 && !r.budgetCut).length;
  const total = Date.now() - t0;
  if (cut.length) {
    log(`⏭  NOT RUN (budget ${budgetMs / 1000} s) ${cut.length} check(s), the loosest ties — CI runs them: ${cut.map((c) => c.id).join(', ')}`);
  }
  log(`affected-guards: ${green} green · ${findings} finding(s) · ${env} environmental · ${lost} coverage lost · ${cut.length} over budget · ${skipIds.length} skipped-for-CI — ` +
    `checks ${secs(runMs)}, total ${secs(total)} (${width} at a time)`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      schema: 'affected-guards/1', changed, unmapped: sel.unmapped, coveragePct: pct, totalMs: total, runMs,
      checks: toRun.map((c, k) => ({ id: c.id, kind: c.kind, tier: sel.tiers.get(c.id), status: results[k].budgetCut ? null : results[k].status, ms: results[k].ms, timedOut: results[k].timedOut, budgetCut: !!results[k].budgetCut })),
      verdicts: verdicts.map((v) => ({ id: v.c.id, kind: v.kind, why: v.why })), wrote, skipped: skipIds,
    }, null, 2));
  }
  if (findings) return 1;
  if (lost) return 2;
  return 0;
}

const IS_MAIN = (() => {
  const a = process.argv[1];
  if (!a) return false;
  const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(fileURLToPath(import.meta.url));
})();
if (IS_MAIN) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`🔴 COVERAGE LOST — affected-guards crashed: ${e?.stack ?? e}`); process.exitCode = 2; });
}
