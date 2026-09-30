#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// guard-yield.mjs — per-guard CATCHES over ci.yml pull_request runs, written
// beside the enforcement index as tooling/guard-yield.json and keyed by every
// one of its refs.
//
// Row O-GUARD-YIELD-UNMEASURED. [ADR 053] rule 5 asks the question this file
// answers: across the merged PRs, how many times did a guard catch a defect
// that would otherwise have reached `main`? That is GUARD YIELD, and it is the
// one input that separates a load-bearing guard from ballast.
//
// ── TWO HALVES, AND THIS IS THE PURE ONE ────────────────────────────────────
// The FETCH is tooling/ops/triage-failed-runs.mjs `--yield`: the runs API, the
// failing job's steps, its log, the failed-run-causes register, the merged PR
// set. It hands this module one record per failed run, every failing step
// already scoped to its log section and classified. This module ATTRIBUTES the
// steps to index refs, AGGREGATES per ref, and owns the file: `--check`,
// `--sync` and `--zero-count` all run offline, with no credential. It imports
// no fetcher, so tooling/ci/assert-enforcement-index.mjs imports `checkYield`
// from here without importing the network.
//
// ── WHAT A CATCH IS ─────────────────────────────────────────────────────────
// A catch of guard G is a DISTINCT MERGED PR with at least one failed ci.yml
// pull_request run in the window attributed to G, whose failing step's
// signature is not classified `infrastructure` or `not-a-defect` in
// tooling/ops/failed-run-causes.json. A merge needs ci-gate green, so G went
// green on the same branch after the failure.
//
// Attribution, per failing (non-gate) step, in order:
//   1. every `<name>: FAILED` line at column 0 of the step's log section, where
//      the ref is the index row whose basename is `<name>.mjs`. A step naming
//      two guards credits both. Column 0, because a guard prints its verdict
//      there and a failing TEST quotes a guard's output indented under its
//      assertion — that is the test's catch, not the guard's;
//   2. else the step's `##[group]Run` header, when that step runs exactly one
//      `node tooling/….mjs` script and the script is an index ref;
//   3. else the step's SIGNATURE, read against the failure ledger: the
//      failed-run-causes row it maps to names its `guard` (an index ref), or a
//      `guard-test:<title>` signature names a test whose ONE file, a key of
//      tooling/ci/test/coverage-manifest.json, exercises exactly one guard ref.
//      A guard's TEST failing is that guard's catch: the test is its red
//      control, and the PR still merged with it green (row B-2, 2026-09-29);
//   4. else the run is UNATTRIBUTED: counted, listed, never dropped.
//
// ── THE LEARNING LOOP (rows B-1, B-2, B-3, 2026-09-29) ─────────────────────
// A number nobody acts on is a number that stops being read. Three limbs turn
// this file from a measurement into a decision:
//   · every MEASURED zero-catch guard/WIRED ref carries a `disposition`:
//     {verdict: KEEP | MERGE | RETIRE, basis, reason}. `basis: "exposure"` is
//     the one a fetch writes by itself — the ref was exposed for fewer than
//     FULL_EXPOSURE_DAYS of the window, so zero is not yet evidence — and it
//     EXPIRES when a later window exposes the ref in full. `basis: "owner"` is
//     a person's decision, dated (`decided`), and survives every fetch. A MERGE
//     names the index ref it folds `into`. ADR 053 rule 5 asked the question;
//     this is where it is answered, one guard at a time;
//   · unattributed runs stay under UNATTRIBUTED_MAX_PCT of those considered —
//     above it, "zero catches" means "we could not tell", not "caught nothing";
//   · asOf is no older than MAX_AGE_DAYS: the Monday ops-watch slot runs
//     `--check`, so a yield nobody re-fetched turns that slot red and pages.
//
// ── EXIT CONTRACT ───────────────────────────────────────────────────────────
//   --check       0 = the file keys exactly the index refs and every number in
//                     it agrees with its own evidence and with a recount; every
//                     measured zero-catch guard is dispositioned; unattributed
//                     is within its limit; asOf is fresh.
//                 1 = an index ref it does not key, a key the index does not
//                     carry, catches ≠ evidence.length, a repeated PR, zeroCatch
//                     or unattributed disagreeing with a recount, a zero-catch
//                     guard with no KEEP/MERGE/RETIRE (or an expired one), an
//                     unattributed share over the limit, or asOf past its age.
//                 2 = COVERAGE LOST — the file or the index is missing or
//                     unparseable: nothing was checked.
//                 `--today YYYY-MM-DD` fixes the day the age is measured
//                     against; a test's clock, never a waiver: an earlier day
//                     than asOf is refused.
//   --reattribute re-runs rule 3 over `unattributedRuns` offline (the causes
//                 register, the test corpus, and `git log <--merged-ref,
//                 default HEAD>` for the merged set), moves each run it can
//                 name, re-classifies, writes. asOf and the window are the
//                 fetch's and do not move. 0 written, 2 unreadable.
//   --sync        adds a 0-catch entry (firstSeen = today) for each new index
//                 ref, removes each key the index no longer carries, recounts
//                 zeroCatch (a ref first seen after the window is UNMEASURED
//                 and not counted, so --sync never moves it), writes. 0 on success, 2 when either file is
//                 unreadable. A --sync never fetches and never invents a window.
//   --zero-count  prints zeroCatch alone when --check would pass; the Private
//                 platform-state verify. 1/2 as --check.
//
// Usage:  node tooling/ops/guard-yield.mjs --check [--today YYYY-MM-DD] [repoRoot]
//         node tooling/ops/guard-yield.mjs --sync|--zero-count [repoRoot]
//         node tooling/ops/guard-yield.mjs --reattribute [--merged-ref REF] [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_REL } from '../ci/build-enforcement-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const YIELD_REL = 'tooling/guard-yield.json';
export const CAUSES_REL = 'tooling/ops/failed-run-causes.json';
export const MANIFEST_REL = 'tooling/ci/test/coverage-manifest.json';
export const TESTS_REL = 'tooling/ci/test';
export const SYNC_COMMAND = 'node tooling/ops/guard-yield.mjs --sync';
export const REATTRIBUTE_COMMAND = 'node tooling/ops/guard-yield.mjs --reattribute';

/** A zero over fewer days than this is not yet evidence: the window is 90 days,
 *  and a guard exposed to less than all of it has had less than one window. */
export const FULL_EXPOSURE_DAYS = 90;
/** Above this share of the failed runs considered, "zero catches" cannot be
 *  told from "could not tell who caught it". */
export const UNATTRIBUTED_MAX_PCT = 10;
/** A third of the window: past it, a third of what the file measured has slid
 *  out of the period it claims to describe. */
export const MAX_AGE_DAYS = 30;
export const VERDICTS = ['KEEP', 'MERGE', 'RETIRE'];

export const README = [
  'GUARD YIELD — per-guard catches over ci.yml pull_request runs, keyed by every ref of tooling/enforcement-index.json. Row O-GUARD-YIELD-UNMEASURED; the question is ADR 053 rule 5.',
  'WRITTEN by `node tooling/ops/triage-failed-runs.mjs --yield --since <ISO> [--until <ISO>] --cache-dir <dir> [--max-requests N]`: one deliberate, credentialled fetch under the ledger\'s one request ceiling and quota floor, dated by asOf. AGED by the Monday ops-watch slot, which runs `--check`: asOf older than 30 days (MAX_AGE_DAYS) is red there and pages, and the fetch is due. RE-ATTRIBUTED offline by `node tooling/ops/guard-yield.mjs --reattribute` whenever the causes register or a guard test moves.',
  'KEYED by `node tooling/ops/guard-yield.mjs --sync` (offline) in every PR that adds or removes an index ref. CHECKED by `--check` (offline) and by tooling/ci/assert-enforcement-index.mjs, which refuses an index ref this file does not key.',
  '',
  'A CATCH of guard G is a distinct MERGED PR with at least one failed (failure or timed_out) ci.yml pull_request run in the window attributed to G, whose failing step is not classified infrastructure or not-a-defect in tooling/ops/failed-run-causes.json. A merge needs ci-gate green, so G went green on the same branch after the failure.',
  'ATTRIBUTION, per failing non-gate step, in order: (1) every `<name>: FAILED` line at column 0 of that step\'s log section, where <name>.mjs is the basename of an index ref; a step naming two guards credits both. (2) Else the step\'s `##[group]Run` header, when it runs exactly one `node tooling/...mjs` script and that script is an index ref. (3) Else the step\'s signature: the tooling/ops/failed-run-causes.json row it maps to names its `guard`, or a `guard-test:<title>` names a test whose one file (a key of tooling/ci/test/coverage-manifest.json) exercises exactly one guard ref — a guard\'s red control failing is that guard\'s catch. (4) Else the run is UNATTRIBUTED: counted in `unattributed`, listed in `unattributedRuns`, never dropped, and kept under 10% (UNATTRIBUTED_MAX_PCT) of runs.considered by `--check`.',
  'MERGED = the subjects of `git log <merged-ref> --since --until --format=%s` that end in `(#N)`, read without the API. A run\'s PR is run.pull_requests[0].number, else the one PR whose head branch is the run\'s and whose open span covers the run.',
  'perRef.<ref>: catches = evidence.length = distinct merged PRs. evidence = {pr, runId, signature}, one per PR, the earliest run; signature is the failed-run ledger id of the failing step. firstSeen = the later of window.since and the day the ref\'s file was added on the merged ref, or the --sync day for a ref that entered the index after the fetch.',
  'zeroCatch = index rows of kind guard and state WIRED whose catches is 0 and whose firstSeen is not after the day of window.until. A ref `--sync` keyed after the fetch, with firstSeen = the sync day, had no chance to catch anything in the window: it is UNMEASURED, printed so by `--check`, and not counted, so the number does not move on every PR that adds a guard. Removing a zero-catch guard still lowers it. unattributed = failed runs with a live failing step attributed to no ref. runs.excluded = failed runs whose every failing step was excluded (non-defect, cancelled or gate-only). runs.noPr = attributed runs whose PR could not be named.',
  'DISPOSITION (ADR 053 rule 5): every zero-catch guard/WIRED ref that is measured carries `disposition` {verdict: KEEP | MERGE | RETIRE, basis, reason}. basis "exposure" is written by the fetch itself for a ref exposed fewer than 90 days (FULL_EXPOSURE_DAYS) of the window — zero is not yet evidence — and expires when a window exposes it in full. basis "owner" is a person\'s decision with `decided` (YYYY-MM-DD) and survives every fetch; a MERGE names the ref it folds `into`. No other entry carries one.',
  '',
  'LIMITS: a catch by the local pre-commit hook never reaches CI, so it is not counted, and yield is a LOWER BOUND. A PR closed unmerged is not counted. A cancelled run rendered no verdict and is not read. A failure fixed by weakening the guard itself still counts as a catch; the evidence list is there so that a reader can judge. The window is bounded by log retention: attribution reads job logs, and a log past retention cannot be read, so the window covers far fewer PRs than the repository has merged.',
];

// ═══════════════════════════════════════════════════════════════════════════
// ATTRIBUTION — text in, refs out
// ═══════════════════════════════════════════════════════════════════════════

/** `assert-x: FAILED` at COLUMN 0 of a prefix-stripped log line. */
const FAILED_LINE = /^([\w.-]+?)(?:\.mjs)?: FAILED\s*$/;
const RUN_HEADER = /^##\[group\]Run /;
const END_GROUP = /^##\[endgroup\]/;
/** `node [flags] tooling/<dir>/<name>.mjs`, also inside `$( … )` and after `&&`. */
const NODE_SCRIPT = /(?:^|[^\w./-])node\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*(?:\.\/)?(tooling\/[\w./-]+\.mjs)\b/g;

/** Every `<name>` a column-0 `<name>: FAILED` line names, first-seen order. */
export function failedNames(lines) {
  const out = [];
  for (const l of lines ?? []) {
    const m = FAILED_LINE.exec(String(l).replace(/\r$/, ''));
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The distinct `tooling/….mjs` scripts `node` runs inside the step's
 *  `##[group]Run` section — the step's own command, as GitHub echoes it. */
export function runHeaderScripts(lines) {
  const all = (lines ?? []).map((l) => String(l).replace(/\r$/, ''));
  const start = all.findIndex((l) => RUN_HEADER.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start; i < all.length; i++) {
    if (i > start && (END_GROUP.test(all[i]) || RUN_HEADER.test(all[i]))) break;
    const text = i === start ? all[i].replace(RUN_HEADER, '') : all[i];
    for (const m of text.matchAll(NODE_SCRIPT)) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** basename → ref, for refs that are `.mjs` paths. A basename two refs share
 *  maps to null: a FAILED line naming it cannot say which guard printed it. */
export function basenameMap(refs) {
  const m = new Map();
  for (const ref of refs) {
    if (!/\.mjs$/.test(ref) || ref.includes('#')) continue;
    const base = ref.slice(ref.lastIndexOf('/') + 1);
    m.set(base, m.has(base) ? null : ref);
  }
  return m;
}

/** One failing step's log section → the refs it is attributed to, and by which
 *  rule. `signature` and `attribution` feed rule 3; without them it is 1 and 2. */
export function attributeStep(lines, byBase, refSet, signature = null, attribution = null) {
  const one = [];
  for (const name of failedNames(lines)) {
    const ref = byBase.get(`${name}.mjs`);
    if (ref && !one.includes(ref)) one.push(ref);
  }
  if (one.length) return { refs: one, rule: 1 };
  const scripts = runHeaderScripts(lines);
  if (scripts.length === 1 && refSet.has(scripts[0])) return { refs: [scripts[0]], rule: 2 };
  const bySig = signatureRefs(signature, attribution, refSet);
  if (bySig.length) return { refs: bySig, rule: 3 };
  return { refs: [], rule: 0 };
}

// ── RULE 3 — the signature, read against the failure ledger ────────────────

/** The causes row a signature maps to, as the ledger maps it: an exact id
 *  first, else the longest trailing-`*` prefix. Scope is not read — a row's
 *  `guard` names who refused, and that is the same on every branch. */
export function causeRowFor(signature, causes) {
  let best = null;
  for (const c of causes ?? []) {
    if (typeof c?.signature !== 'string') continue;
    if (c.signature === signature) return c;
    if (c.signature.endsWith('*')) {
      const p = c.signature.slice(0, -1);
      if (signature.startsWith(p) && (!best || p.length > best.signature.length - 1)) best = c;
    }
  }
  return best;
}

const TITLE_DECL = /^[ \t]*(?:test|it)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gm;
const DESCRIBE_DECL = /^[ \t]*describe\s*\(/gm;
const unescapeTitle = (s) => s.replace(/\\(.)/g, '$1');
/** A module specifier or path literal ending in `<name>.mjs`. */
const MJS_LITERAL = /['"`](?:[^'"`\s]*\/)?([\w.-]+\.mjs)['"`]/g;
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `const SCRIPT = join(ROOT, 'tooling', 'x.mjs');` — an identifier bound to
 *  a path that ENDS in a creditable ref's basename, over the whole file. */
function boundPaths(text, byBase, guardRefs) {
  const out = new Map();
  for (const m of String(text).matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=([^;\n]*)/g)) {
    const tail = /['"`](?:[^'"`\s]*\/)?([\w.-]+\.mjs)['"`][\s)]*$/.exec(m[2].trim());
    const ref = tail ? byBase.get(tail[1]) : null;
    if (ref && guardRefs.has(ref)) out.set(m[1], ref);
  }
  return out;
}

/** The distinct creditable refs a stretch of test source names — as a module
 *  or path literal, or by an identifier `bound` to one. */
function guardsNamedIn(text, byBase, guardRefs, bound = new Map()) {
  const found = [];
  const add = (ref) => {
    if (ref && guardRefs.has(ref) && !found.includes(ref)) found.push(ref);
  };
  for (const m of String(text).matchAll(MJS_LITERAL)) add(byBase.get(m[1]));
  for (const [id, ref] of bound) if (new RegExp(`(?<![\\w$.])${reEscape(id)}(?![\\w$])`).test(text)) add(ref);
  return found;
}

/** The ONE ref a test file exercises, or null. Candidates are the WIRED guard
 *  and script rows whose unique basename the file names as a module specifier
 *  or path (a LIBRARY guard catches nothing of its own: its callers do);
 *  several are narrowed by the file's own stem (`x.test.mjs` → `x.mjs` or
 *  `assert-x.mjs`). Still several, or none: null — a test that credits two
 *  guards credits neither, exactly as rule 2 treats a two-script Run header. */
export function guardOfTestFile(name, text, byBase, guardRefs) {
  const found = guardsNamedIn(text, byBase, guardRefs);
  if (found.length === 1) return found[0];
  const stem = name.replace(/\.test\.mjs$/, '');
  const named = found.filter((r) => [`${stem}.mjs`, `assert-${stem}.mjs`].includes(r.slice(r.lastIndexOf('/') + 1)));
  return named.length === 1 ? named[0] : null;
}

/**
 * title → the ONE guard ref its test exercises. Nearest first: the one file
 * the title itself names, else the guard the test's OWN body names (declaration to the next declaration), else the one its
 * enclosing `describe` block names, else the file's (guardOfTestFile). A file
 * like guards.test.mjs tests two dozen guards, one describe block each, and
 * only the block can say which. A title two tests declare for two different
 * guards maps to null. A template-literal title is kept as a PATTERN, its
 * `${…}` read as any text, in `patterns`.
 */
export function testTitleIndex(files, indexRows) {
  const refs = indexRefs(indexRows);
  const byBase = basenameMap(refs);
  const guardRefs = new Set((indexRows ?? []).filter(isCreditable).map((r) => r.ref));
  const exact = new Map();
  const shapes = new Map();
  const patterns = [];
  const put = (title, ref, templated) => {
    if (templated) {
      const re = new RegExp(`^${title.split(/\$\{[^}]*\}/).map(reEscape).join('.*')}$`, 's');
      patterns.push({ re, ref });
      return;
    }
    exact.set(title, exact.has(title) && exact.get(title) !== ref ? null : ref);
    const shape = numberless(title);
    shapes.set(shape, shapes.has(shape) && shapes.get(shape) !== ref ? null : ref);
  };
  for (const { name, text } of files ?? []) {
    const src = String(text);
    const fileRef = guardOfTestFile(name, src, byBase, guardRefs);
    const bound = boundPaths(src, byBase, guardRefs);
    const decls = [...src.matchAll(TITLE_DECL)];
    const describes = [...src.matchAll(DESCRIBE_DECL)].map((m) => m.index);
    decls.forEach((m, i) => {
      const next = i + 1 < decls.length ? decls[i + 1].index : src.length;
      // The title itself naming ONE creditable file wins: "every
      // record-deployment.mjs call site …" is that script's test whatever
      // else its body touches.
      const titled = [...new Set([...m[2].matchAll(/([\w.-]+\.mjs)\b/g)].map((t) => byBase.get(t[1])).filter((r) => r && guardRefs.has(r)))];
      const own = titled.length === 1 ? titled : guardsNamedIn(src.slice(m.index, next), byBase, guardRefs, bound);
      let ref = own.length === 1 ? own[0] : null;
      if (!ref) {
        const open = describes.filter((d) => d < m.index).pop();
        if (open !== undefined) {
          const block = guardsNamedIn(src.slice(open, next), byBase, guardRefs, bound);
          if (block.length === 1) ref = block[0];
        }
      }
      ref ??= fileRef;
      if (!ref) return;
      const raw = unescapeTitle(m[2]);
      put(raw, ref, m[1] === '`' && raw.includes('${'));
    });
  }
  exact.patterns = patterns;
  exact.shapes = shapes;
  return exact;
}

/** A title with every run of digits read as one number: a title that states
 *  a measured count ("… 57 surfaces, 19 swept") is re-measured as the tree
 *  grows, and the run that failed it carries the count of ITS day. */
const numberless = (title) => title.replace(/\d+/g, '#');

/** A guard-test title → its ref: an exact title first, else the ONE ref every
 *  matching template pattern agrees on, else the ONE ref of the same title with
 *  its numbers read as numbers. */
export function refOfTitle(testTitles, title) {
  if (!testTitles) return null;
  if (testTitles.has(title)) return testTitles.get(title);
  const refs = new Set((testTitles.patterns ?? []).filter((p) => p.re.test(title)).map((p) => p.ref));
  if (refs.size) return refs.size === 1 ? [...refs][0] : null;
  return testTitles.shapes?.get(numberless(title)) ?? null;
}

/** Rule 3 alone: the refs a signature names through the ledger. */
export function signatureRefs(signature, attribution, refSet) {
  if (typeof signature !== 'string' || !attribution) return [];
  const row = causeRowFor(signature, attribution.causes);
  if (row && typeof row.guard === 'string' && refSet.has(row.guard)) return [row.guard];
  // `✗ <label>: N problem(s)` — the ledger keys the guard's own label, and
  // a guard labels itself by its name: `chassis parity` is assert-chassis-parity.mjs.
  const label = /^guard-(?:refused|failed):(.+)$/.exec(signature);
  if (label) {
    const base = label[1].trim().toLowerCase().replace(/\.mjs$/, '').replace(/\s+/g, '-');
    const hits = [...refSet].filter((r) => [`${base}.mjs`, `assert-${base}.mjs`].includes(r.slice(r.lastIndexOf('/') + 1)));
    if (hits.length === 1) return hits;
  }
  if (signature.startsWith('guard-test:')) {
    const ref = refOfTitle(attribution.testTitles, signature.slice('guard-test:'.length));
    if (ref && refSet.has(ref)) return [ref];
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE
// ═══════════════════════════════════════════════════════════════════════════

const indexRefs = (rows) =>
  [...new Set((rows ?? []).filter((r) => r && typeof r.ref === 'string' && r.ref.trim() !== '').map((r) => r.ref))].sort();

const isGuardWired = (row) => row && row.kind === 'guard' && row.state === 'WIRED';
/** What a failing test can be the catch OF: a wired guard, or a wired script
 *  (a writer's refusal is a catch too). A LIBRARY catches nothing of its own. */
const isCreditable = (row) => row && (row.kind === 'guard' || row.kind === 'script') && row.state === 'WIRED';

/** A ref first seen AFTER the window's last day — one `--sync` keyed after the
 *  fetch — had no chance to catch anything in the window: UNMEASURED, not a zero. */
export const isUnmeasured = (entry, until) =>
  Boolean(until) && typeof entry?.firstSeen === 'string' && entry.firstSeen > new Date(until).toISOString().slice(0, 10);

/** zeroCatch, recounted from the index rows and the file's own perRef. A ref
 *  that is unmeasured against `until` (the window's end) is not counted, so the
 *  number a Private row records is stable under `--sync` (PE2-F3). */
export function recountZero(perRef, indexRows, until = null) {
  let n = 0;
  for (const row of indexRows ?? []) {
    if (!isGuardWired(row)) continue;
    const e = perRef?.[row.ref];
    if (e && e.catches === 0 && !isUnmeasured(e, until)) n++;
  }
  return n;
}

const day = (iso) => new Date(iso).toISOString().slice(0, 10);
const wholeSeconds = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Days of the window a ref was exposed to: firstSeen to the window's last day. */
export const exposureDays = (entry, until) => daysBetween(entry.firstSeen, day(until));

/** The refs that owe a disposition: guard/WIRED, measured, zero catches. */
export function zeroCatchRefs(perRef, indexRows, until) {
  return (indexRows ?? [])
    .filter(isGuardWired)
    .map((r) => r.ref)
    .filter((ref) => {
      const e = perRef?.[ref];
      return e && e.catches === 0 && !isUnmeasured(e, until);
    });
}

/**
 * Every disposition the file should carry, the fetch's own and the owner's.
 * An owner's decision (`basis: "owner"`) on a ref that still owes one is kept
 * as written. A ref exposed fewer than FULL_EXPOSURE_DAYS gets an automatic
 * KEEP on `basis: "exposure"`. A ref exposed in full with no owner decision
 * gets NOTHING, and `--check` names it: that decision is a person's. No other
 * entry keeps a disposition — a guard that caught something has answered.
 */
export function classify(perRef, indexRows, until) {
  const owes = new Set(zeroCatchRefs(perRef, indexRows, until));
  const out = {};
  for (const [ref, e] of Object.entries(perRef ?? {})) {
    const { disposition, ...rest } = e;
    let next = null;
    if (owes.has(ref)) {
      if (disposition?.basis === 'owner') next = disposition;
      else {
        const n = exposureDays(e, until);
        if (n < FULL_EXPOSURE_DAYS) {
          next = {
            verdict: 'KEEP',
            basis: 'exposure',
            reason: `exposed ${n} of the ${FULL_EXPOSURE_DAYS} days a zero needs before it is evidence (firstSeen ${e.firstSeen}); re-judged at the next fetch`,
          };
        }
      }
    }
    out[ref] = next ? { ...rest, disposition: next } : rest;
  }
  return out;
}

/**
 * The file, from the fetch half's records.
 *   records   [{ runId, pr, createdAt, units: [{ step, lines, signature, excluded }] }]
 *             — `lines` prefix-stripped and scoped to the failing step.
 *   merged    Set of PR numbers merged in the window.
 *   added     Map file path → YYYY-MM-DD it was added on the merged ref.
 *   attribution  { causes, testTitles } for rule 3 (readAttribution).
 *   previous  the file this fetch replaces: its OWNER dispositions carry over.
 */
export function buildYield({ records, indexRows, merged, added = new Map(), since, until, apiCalls = 0, attribution = null, previous = null }) {
  const refs = indexRefs(indexRows);
  const refSet = new Set(refs);
  const byBase = basenameMap(refs);
  const sinceDay = day(since);
  const found = new Map();
  const unattributedRuns = [];
  let excluded = 0;
  let attributed = 0;
  let noPr = 0;
  const ordered = [...(records ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.runId - b.runId);
  for (const rec of ordered) {
    const live = (rec.units ?? []).filter((u) => !u.excluded);
    if (live.length === 0) {
      excluded++;
      continue;
    }
    const hit = new Map();
    for (const u of live) {
      for (const ref of attributeStep(u.lines, byBase, refSet, u.signature, attribution).refs) if (!hit.has(ref)) hit.set(ref, u.signature);
    }
    if (hit.size === 0) {
      unattributedRuns.push({ pr: rec.pr ?? null, runId: rec.runId, signature: live[0].signature });
      continue;
    }
    attributed++;
    if (rec.pr === null || rec.pr === undefined) {
      noPr++;
      continue;
    }
    if (!merged.has(rec.pr)) continue;
    for (const [ref, signature] of hit) {
      if (!found.has(ref)) found.set(ref, new Map());
      const byPr = found.get(ref);
      if (!byPr.has(rec.pr)) byPr.set(rec.pr, { pr: rec.pr, runId: rec.runId, signature });
    }
  }
  const perRef = {};
  for (const ref of refs) {
    const evidence = [...(found.get(ref)?.values() ?? [])].sort((a, b) => a.pr - b.pr);
    const addedOn = added.get(ref.split('#')[0]);
    const owner = previous?.perRef?.[ref]?.disposition;
    perRef[ref] = { catches: evidence.length, firstSeen: addedOn && addedOn > sinceDay ? addedOn : sinceDay, evidence };
    if (owner?.basis === 'owner') perRef[ref].disposition = owner;
  }
  return {
    _readme: README,
    asOf: day(until),
    window: { since: wholeSeconds(since), until: wholeSeconds(until), mergedPrs: merged.size },
    apiCalls,
    perRef: classify(perRef, indexRows, until),
    runs: { considered: ordered.length, excluded, attributed, noPr },
    unattributed: unattributedRuns.length,
    unattributedRuns,
    zeroCatch: recountZero(perRef, indexRows, until),
  };
}

export const serialiseYield = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

/** The refs with the most catches, most first; ties by ref. */
export const topRefs = (doc, n = 10) =>
  Object.entries(doc.perRef ?? {})
    .filter(([, e]) => e.catches > 0)
    .sort((a, b) => b[1].catches - a[1].catches || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([ref, e]) => ({ ref, catches: e.catches }));

// ═══════════════════════════════════════════════════════════════════════════
// CHECK AND SYNC — offline
// ═══════════════════════════════════════════════════════════════════════════

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Every way the file can disagree with the index or with itself. `missing`
 *  and `extra` are also returned alone: they are the two a --sync repairs. */
export function checkYield(doc, indexRows) {
  const problems = [];
  const missing = [];
  const extra = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || doc.perRef === null || typeof doc.perRef !== 'object' || Array.isArray(doc.perRef)) {
    problems.push(`${YIELD_REL} carries no \`perRef\` object, so no index ref has an entry. Regenerate it with the --yield fetch.`);
    return { problems, missing, extra };
  }
  const refs = indexRefs(indexRows);
  const refSet = new Set(refs);
  for (const ref of refs) if (!Object.hasOwn(doc.perRef, ref)) missing.push(ref);
  for (const key of Object.keys(doc.perRef).sort()) if (!refSet.has(key)) extra.push(key);
  for (const ref of missing) {
    problems.push(`"${ref}" is an index ref and ${YIELD_REL} has no entry for it — its yield is unrecorded. Run \`${SYNC_COMMAND}\` and commit the file.`);
  }
  for (const key of extra) {
    problems.push(`${YIELD_REL} keys "${key}", which is not an index ref — a removed enforcer still carrying a yield. Run \`${SYNC_COMMAND}\` and commit the file.`);
  }
  for (const [ref, e] of Object.entries(doc.perRef)) {
    if (e === null || typeof e !== 'object' || !isCount(e.catches) || !Array.isArray(e.evidence)) {
      problems.push(`${YIELD_REL} "${ref}" is not {catches: a count, evidence: an array}.`);
      continue;
    }
    if (e.catches !== e.evidence.length) {
      problems.push(`${YIELD_REL} "${ref}" says catches ${e.catches} and lists ${e.evidence.length} evidence row(s). A catch is one PR of evidence; the two must be equal.`);
    }
    const prs = e.evidence.map((x) => x?.pr);
    if (e.evidence.some((x) => !x || !Number.isInteger(x.pr) || !Number.isInteger(x.runId) || typeof x.signature !== 'string')) {
      problems.push(`${YIELD_REL} "${ref}" carries an evidence row that is not {pr, runId, signature}.`);
    } else if (new Set(prs).size !== prs.length) {
      problems.push(`${YIELD_REL} "${ref}" lists one PR twice. Catches count DISTINCT merged PRs.`);
    }
  }
  // A keying gap moves the recount too; that finding is the gap's, and the
  // same --sync repairs both, so it is not reported twice.
  const zero = recountZero(doc.perRef, indexRows, doc.window?.until);
  if (missing.length === 0 && extra.length === 0 && doc.zeroCatch !== zero) {
    problems.push(`${YIELD_REL} says zeroCatch ${JSON.stringify(doc.zeroCatch)}; recounted over the index's guard/WIRED rows it is ${zero}. Run \`${SYNC_COMMAND}\`.`);
  }
  if (!Array.isArray(doc.unattributedRuns) || doc.unattributed !== doc.unattributedRuns.length) {
    problems.push(`${YIELD_REL} says unattributed ${JSON.stringify(doc.unattributed)} and lists ${Array.isArray(doc.unattributedRuns) ? doc.unattributedRuns.length : 'no'} unattributed run(s). An unattributed failure is listed, never dropped.`);
  }
  const r = doc.runs;
  if (!r || ![r.considered, r.excluded, r.attributed, r.noPr].every(isCount) || r.considered !== r.excluded + r.attributed + doc.unattributed) {
    problems.push(`${YIELD_REL} runs ${JSON.stringify(r)} does not add up: considered must equal excluded + attributed + unattributed (${JSON.stringify(doc.unattributed)}).`);
  }
  if (!doc.window || !Number.isFinite(Date.parse(doc.window.since)) || !Number.isFinite(Date.parse(doc.window.until))) {
    problems.push(`${YIELD_REL} states no readable window {since, until}. A yield with no window is a number about no period.`);
  }
  return { problems, missing, extra };
}

/** The share of considered runs nobody could be credited with, in percent. */
export const unattributedPct = (doc) => (doc.runs?.considered ? (100 * doc.unattributed) / doc.runs.considered : 0);

/**
 * What `--check` adds to checkYield: the file is not only CONSISTENT, it is
 * ACTED ON. checkYield stays the keying contract tooling/ci/assert-enforcement-
 * index.mjs holds every PR to; these are the loop's own limbs, and they run in
 * `--check` — the Monday ops-watch slot and a person — so an ageing file pages
 * the owner instead of reddening an unrelated PR.
 *   today  YYYY-MM-DD the age is measured against.
 */
export function loopProblems(doc, indexRows, today) {
  const problems = [];
  const until = doc.window?.until;
  const owes = new Set(zeroCatchRefs(doc.perRef, indexRows, until));
  const refSet = new Set(indexRefs(indexRows));
  for (const [ref, e] of Object.entries(doc.perRef ?? {})) {
    const d = e?.disposition;
    if (!owes.has(ref)) {
      if (d !== undefined) {
        problems.push(`${YIELD_REL} "${ref}" carries a disposition and owes none (it caught something, is not guard/WIRED, or is unmeasured). Run \`${REATTRIBUTE_COMMAND}\`, which re-classifies.`);
      }
      continue;
    }
    if (d === undefined) {
      problems.push(
        `${YIELD_REL} "${ref}" is a guard/WIRED ref with 0 catches over ${exposureDays(e, until)} days of exposure and no disposition. ` +
          `ADR 053 rule 5: decide KEEP, MERGE or RETIRE and write {"verdict", "basis": "owner", "decided": "YYYY-MM-DD", "reason"} (MERGE adds "into": <index ref>).`,
      );
      continue;
    }
    const bad = [];
    if (!d || typeof d !== 'object' || Array.isArray(d)) bad.push('is not an object');
    else {
      if (!VERDICTS.includes(d.verdict)) bad.push(`verdict ${JSON.stringify(d.verdict)} is not one of ${VERDICTS.join(' · ')}`);
      if (typeof d.reason !== 'string' || d.reason.trim().length < 20) bad.push('reason is not a sentence (20+ characters)');
      if (d.basis === 'owner') {
        if (typeof d.decided !== 'string' || !DAY_RE.test(d.decided)) bad.push('an owner decision carries no `decided` YYYY-MM-DD');
      } else if (d.basis === 'exposure') {
        if (d.verdict !== 'KEEP') bad.push('an exposure basis can only KEEP — MERGE and RETIRE are decisions');
        const n = exposureDays(e, until);
        if (n >= FULL_EXPOSURE_DAYS) bad.push(`its automatic KEEP has EXPIRED: exposed ${n} days, the whole of a ${FULL_EXPOSURE_DAYS}-day window, and still 0 catches — this is now an owner decision`);
      } else bad.push(`basis ${JSON.stringify(d.basis)} is not "owner" or "exposure"`);
      if (d.verdict === 'MERGE' && (typeof d.into !== 'string' || !refSet.has(d.into) || d.into === ref)) bad.push('a MERGE names no other index ref `into`');
    }
    for (const b of bad) problems.push(`${YIELD_REL} "${ref}" disposition ${b}.`);
  }
  const pct = unattributedPct(doc);
  if (pct > UNATTRIBUTED_MAX_PCT) {
    problems.push(
      `${YIELD_REL}: ${doc.unattributed} of ${doc.runs.considered} failed run(s) are unattributed (${pct.toFixed(2)}%), over the ${UNATTRIBUTED_MAX_PCT}% limit — ` +
        `a zero-catch count this blind cannot tell "caught nothing" from "could not tell". Give the recurring signatures a \`guard\` in ${CAUSES_REL}, then \`${REATTRIBUTE_COMMAND}\`.`,
    );
  }
  if (typeof doc.asOf !== 'string' || !DAY_RE.test(doc.asOf)) {
    problems.push(`${YIELD_REL} states no asOf day, so how old it is cannot be said.`);
  } else {
    const age = daysBetween(doc.asOf, today);
    if (age > MAX_AGE_DAYS) {
      problems.push(
        `${YIELD_REL} asOf ${doc.asOf} is ${age} days old, past MAX_AGE_DAYS ${MAX_AGE_DAYS}: the yield is due. ` +
          'Re-fetch it with `node tooling/ops/triage-failed-runs.mjs --yield --since <90 days ago> --cache-dir <dir>` and commit the file.',
      );
    }
  }
  return problems;
}

/** Rule 3, re-run offline over the runs a fetch could not attribute. Each run
 *  it can now name leaves `unattributedRuns` and is counted as `attributed`
 *  (and, on a merged PR, as that ref's catch, earliest run kept); the rest stay
 *  listed. asOf and the window do not move: nothing new was read. */
export function reattribute(doc, indexRows, attribution, merged) {
  const refSet = new Set(indexRefs(indexRows));
  const perRef = structuredClone(doc.perRef);
  const runs = { ...doc.runs };
  const still = [];
  const moved = [];
  for (const u of doc.unattributedRuns ?? []) {
    const refs = signatureRefs(u.signature, attribution, refSet);
    if (refs.length === 0) {
      still.push(u);
      continue;
    }
    moved.push({ ...u, refs });
    runs.attributed++;
    if (u.pr === null || u.pr === undefined) {
      runs.noPr++;
      continue;
    }
    if (!merged.has(u.pr)) continue;
    for (const ref of refs) {
      const e = perRef[ref];
      if (!e) continue;
      const i = e.evidence.findIndex((x) => x.pr === u.pr);
      const ev = { pr: u.pr, runId: u.runId, signature: u.signature };
      if (i < 0) e.evidence.push(ev);
      else if (u.runId < e.evidence[i].runId) e.evidence[i] = ev;
      e.evidence.sort((a, b) => a.pr - b.pr);
      e.catches = e.evidence.length;
    }
  }
  const next = {
    ...doc,
    _readme: README,
    perRef: classify(perRef, indexRows, doc.window?.until),
    runs,
    unattributed: still.length,
    unattributedRuns: still,
  };
  next.zeroCatch = recountZero(next.perRef, indexRows, doc.window?.until);
  return { doc: next, moved };
}

/** Key the file by the index again. Existing entries are kept untouched. */
export function syncYield(doc, indexRows, today) {
  const refs = indexRefs(indexRows);
  const refSet = new Set(refs);
  const perRef = {};
  const added = [];
  for (const ref of refs) {
    if (Object.hasOwn(doc.perRef ?? {}, ref)) perRef[ref] = doc.perRef[ref];
    else {
      perRef[ref] = { catches: 0, firstSeen: today, evidence: [] };
      added.push(ref);
    }
  }
  const removed = Object.keys(doc.perRef ?? {}).filter((k) => !refSet.has(k)).sort();
  const next = {
    _readme: README,
    asOf: doc.asOf,
    window: doc.window,
    apiCalls: doc.apiCalls,
    perRef,
    runs: doc.runs,
    unattributed: doc.unattributed,
    unattributedRuns: doc.unattributedRuns,
    zeroCatch: recountZero(perRef, indexRows, doc.window?.until),
  };
  return { doc: next, added, removed };
}

// ═══════════════════════════════════════════════════════════════════════════
// FILES
// ═══════════════════════════════════════════════════════════════════════════

export class Unreadable extends Error {}

const readJson = (root, rel, what) => {
  let text;
  try {
    text = readFileSync(join(root, rel), 'utf8');
  } catch (e) {
    throw new Unreadable(`${rel} could not be read (${e.code ?? e.message}) — ${what}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Unreadable(`${rel} is not valid JSON (${e.message}) — ${what}`);
  }
};

export function readIndexRows(root) {
  const rows = readJson(root, INDEX_REL, 'with no index there are no refs to key');
  if (!Array.isArray(rows) || rows.length === 0) throw new Unreadable(`${INDEX_REL} is not a non-empty row array — there are no refs to key`);
  return rows;
}

export const readYield = (root) => readJson(root, YIELD_REL, 'regenerate it with triage-failed-runs.mjs --yield');

/** Rule 3's inputs from a checkout: the causes register and every test file
 *  the coverage ratchet keys. Either unreadable is Unreadable — a rule that
 *  silently had no inputs would leave every guard-test failure unattributed
 *  and call the result a measurement. `causes` is the register the fetch
 *  already loaded (its --causes), so both halves read the same rows. */
export function readAttribution(root, indexRows, causes = null) {
  const causesDoc = causes ? { causes } : readJson(root, CAUSES_REL, 'rule 3 reads the signature\'s cause row');
  if (!Array.isArray(causesDoc?.causes) || causesDoc.causes.length === 0) throw new Unreadable(`${CAUSES_REL} carries no causes — rule 3 has nothing to read`);
  const manifest = readJson(root, MANIFEST_REL, 'rule 3 reads the guard-test corpus it keys');
  const names = Object.keys(manifest ?? {}).filter((n) => n.endsWith('.test.mjs'));
  if (names.length === 0) throw new Unreadable(`${MANIFEST_REL} keys no test file — rule 3 has no corpus`);
  const files = [];
  for (const name of names) {
    try {
      files.push({ name, text: readFileSync(join(root, TESTS_REL, name), 'utf8') });
    } catch (e) {
      throw new Unreadable(`${TESTS_REL}/${name} is keyed by ${MANIFEST_REL} and could not be read (${e.code ?? e.message})`);
    }
  }
  return { causes: causesDoc.causes, testTitles: testTitleIndex(files, indexRows) };
}

/** The merged PRs of the window, as the fetch reads them: `(#N)` ending a subject of `git log <ref>`. */
export function mergedFromGit(root, ref, since, until) {
  const r = spawnSync('git', ['log', ref, `--since=${since}`, `--until=${until}`, '--format=%s', '--'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Unreadable(`\`git log ${ref}\` exited ${r.status} in ${root}: ${String(r.stderr ?? '').trim().split('\n')[0]}`);
  const out = new Set();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /\(#(\d+)\)\s*$/.exec(line);
    if (m) out.add(Number(m[1]));
  }
  return out;
}

export const writeYield = (root, doc) => writeFileSync(join(root, YIELD_REL), serialiseYield(doc));

// ═══════════════════════════════════════════════════════════════════════════
const MODES = ['--check', '--sync', '--zero-count', '--reattribute'];
const VALUED = { '--today': '--check', '--merged-ref': '--reattribute' };

export function parseCli(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (Object.hasOwn(VALUED, argv[i])) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${argv[i]} needs a value` };
      opts[argv[i]] = v;
      i++;
    } else rest.push(argv[i]);
  }
  const modes = rest.filter((a) => MODES.includes(a));
  const unknown = rest.filter((a) => a.startsWith('--') && !MODES.includes(a));
  const positional = rest.filter((a) => !a.startsWith('--'));
  if (modes.length !== 1 || unknown.length || positional.length > 1) return { error: 'usage' };
  for (const [flag, mode] of Object.entries(VALUED)) {
    if (opts[flag] !== undefined && modes[0] !== mode) return { error: `${flag} belongs to ${mode}` };
  }
  if (opts['--today'] !== undefined && !DAY_RE.test(opts['--today'])) return { error: '--today takes YYYY-MM-DD' };
  return { mode: modes[0], root: positional[0], today: opts['--today'] ?? null, mergedRef: opts['--merged-ref'] ?? 'HEAD' };
}

function main(argv) {
  const cli = parseCli(argv);
  if (cli.error) {
    console.error(`✗ COVERAGE LOST — ${cli.error === 'usage' ? '' : `${cli.error}; `}usage: node tooling/ops/guard-yield.mjs --check [--today YYYY-MM-DD]|--sync|--zero-count|--reattribute [--merged-ref REF] [repoRoot]`);
    return 2;
  }
  const modes = [cli.mode];
  const root = resolve(cli.root ?? ROOT);
  let rows;
  let doc;
  try {
    rows = readIndexRows(root);
    doc = readYield(root);
  } catch (e) {
    if (!(e instanceof Unreadable)) throw e;
    console.error(`✗ COVERAGE LOST — ${e.message}`);
    console.error('guard-yield: FAILED');
    return 2;
  }
  if (cli.mode === '--reattribute') {
    let attribution;
    let merged;
    try {
      attribution = readAttribution(root, rows);
      merged = mergedFromGit(root, cli.mergedRef, doc.window?.since, doc.window?.until);
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      console.error(`✗ COVERAGE LOST — ${e.message}`);
      console.error('guard-yield: FAILED');
      return 2;
    }
    const { doc: next, moved } = reattribute(doc, rows, attribution, merged);
    const { problems } = checkYield(next, rows);
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`);
      console.error('✗ COVERAGE LOST — the re-attributed file does not pass its own consistency check, so it was not written');
      console.error('guard-yield: FAILED');
      return 2;
    }
    writeYield(root, next);
    for (const m of moved) console.log(`  → run ${m.runId} · PR ${m.pr ?? '(none)'} · ${m.signature} → ${m.refs.join(', ')}`);
    console.log(
      `ok  guard-yield --reattribute — ${moved.length} run(s) attributed by rule 3; unattributed ${next.unattributed} of ${next.runs.considered} ` +
        `(${unattributedPct(next).toFixed(2)}%); zeroCatch ${next.zeroCatch}; ${merged.size} merged PR(s) on ${cli.mergedRef} in the window. Wrote ${YIELD_REL}.`,
    );
    return 0;
  }
  if (modes[0] === '--sync') {
    const { doc: next, added, removed } = syncYield(doc, rows, new Date().toISOString().slice(0, 10));
    writeYield(root, next);
    for (const r of added) console.log(`  + ${r} (0 catches, firstSeen today)`);
    for (const r of removed) console.log(`  − ${r} (no longer an index ref)`);
    console.log(`ok  guard-yield --sync — ${Object.keys(next.perRef).length} ref(s) keyed; ${added.length} added, ${removed.length} removed; zeroCatch ${next.zeroCatch}. Wrote ${YIELD_REL}.`);
    return 0;
  }
  const { problems } = checkYield(doc, rows);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('guard-yield: FAILED');
    return 1;
  }
  if (modes[0] === '--zero-count') {
    console.log(String(doc.zeroCatch));
    return 0;
  }
  const today = cli.today ?? new Date().toISOString().slice(0, 10);
  if (typeof doc.asOf === 'string' && today < doc.asOf) {
    console.error(`✗ COVERAGE LOST — --today ${today} is before asOf ${doc.asOf}: an age measured from before the file existed is no age at all.`);
    console.error('guard-yield: FAILED');
    return 2;
  }
  const loop = loopProblems(doc, rows, today);
  const pctLine = `unattributed ${doc.unattributed} of ${doc.runs.considered} (${unattributedPct(doc).toFixed(2)}%, limit ${UNATTRIBUTED_MAX_PCT}%)`;
  if (loop.length) {
    for (const p of loop) console.error(`✗ ${p}`);
    console.error(`  ${pctLine}; asOf ${doc.asOf}, ${daysBetween(doc.asOf, today)} day(s) old against ${MAX_AGE_DAYS}`);
    console.error('guard-yield: FAILED');
    return 1;
  }
  const verdicts = {};
  for (const e of Object.values(doc.perRef)) if (e.disposition) verdicts[`${e.disposition.verdict}/${e.disposition.basis}`] = (verdicts[`${e.disposition.verdict}/${e.disposition.basis}`] ?? 0) + 1;
  const wired = rows.filter(isGuardWired).length;
  const unmeasured = Object.keys(doc.perRef).filter((r) => isUnmeasured(doc.perRef[r], doc.window.until));
  for (const r of unmeasured) {
    console.log(`  · unmeasured: ${r} (firstSeen ${doc.perRef[r].firstSeen}, after the window; not counted in zeroCatch)`);
  }
  console.log(
    `ok  guard-yield — ${Object.keys(doc.perRef).length} ref(s) keyed, exactly the ${indexRefs(rows).length} ref(s) of ${INDEX_REL}; ` +
      `zeroCatch ${doc.zeroCatch} of ${wired} guard/WIRED (${unmeasured.length} unmeasured), dispositioned ${JSON.stringify(verdicts)}; ${pctLine}; ` +
      `window ${doc.window.since} .. ${doc.window.until} (${doc.window.mergedPrs} merged PR(s)); asOf ${doc.asOf}, ${daysBetween(doc.asOf, today)} day(s) old against ${MAX_AGE_DAYS}`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
