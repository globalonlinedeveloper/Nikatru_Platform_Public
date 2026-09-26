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
//   3. else the run is UNATTRIBUTED: counted, listed, never dropped.
//
// ── EXIT CONTRACT ───────────────────────────────────────────────────────────
//   --check       0 = the file keys exactly the index refs and every number in
//                     it agrees with its own evidence and with a recount.
//                 1 = an index ref it does not key, a key the index does not
//                     carry, catches ≠ evidence.length, a repeated PR, zeroCatch
//                     or unattributed disagreeing with a recount.
//                 2 = COVERAGE LOST — the file or the index is missing or
//                     unparseable: nothing was checked.
//   --sync        adds a 0-catch entry (firstSeen = today) for each new index
//                 ref, removes each key the index no longer carries, recounts
//                 zeroCatch (a ref first seen after the window is UNMEASURED
//                 and not counted, so --sync never moves it), writes. 0 on success, 2 when either file is
//                 unreadable. A --sync never fetches and never invents a window.
//   --zero-count  prints zeroCatch alone when --check would pass; the Private
//                 platform-state verify. 1/2 as --check.
//
// Usage:  node tooling/ops/guard-yield.mjs --check|--sync|--zero-count [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_REL } from '../ci/build-enforcement-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const YIELD_REL = 'tooling/guard-yield.json';
export const SYNC_COMMAND = 'node tooling/ops/guard-yield.mjs --sync';

export const README = [
  'GUARD YIELD — per-guard catches over ci.yml pull_request runs, keyed by every ref of tooling/enforcement-index.json. Row O-GUARD-YIELD-UNMEASURED; the question is ADR 053 rule 5.',
  'WRITTEN by `node tooling/ops/triage-failed-runs.mjs --yield --since <ISO> [--until <ISO>] --cache-dir <dir> [--max-requests N]`: one deliberate, credentialled fetch under the ledger\'s one request ceiling and quota floor, dated by asOf, never scheduled.',
  'KEYED by `node tooling/ops/guard-yield.mjs --sync` (offline) in every PR that adds or removes an index ref. CHECKED by `--check` (offline) and by tooling/ci/assert-enforcement-index.mjs, which refuses an index ref this file does not key.',
  '',
  'A CATCH of guard G is a distinct MERGED PR with at least one failed (failure or timed_out) ci.yml pull_request run in the window attributed to G, whose failing step is not classified infrastructure or not-a-defect in tooling/ops/failed-run-causes.json. A merge needs ci-gate green, so G went green on the same branch after the failure.',
  'ATTRIBUTION, per failing non-gate step, in order: (1) every `<name>: FAILED` line at column 0 of that step\'s log section, where <name>.mjs is the basename of an index ref; a step naming two guards credits both. (2) Else the step\'s `##[group]Run` header, when it runs exactly one `node tooling/...mjs` script and that script is an index ref. (3) Else the run is UNATTRIBUTED: counted in `unattributed`, listed in `unattributedRuns`, never dropped.',
  'MERGED = the subjects of `git log <merged-ref> --since --until --format=%s` that end in `(#N)`, read without the API. A run\'s PR is run.pull_requests[0].number, else the one PR whose head branch is the run\'s and whose open span covers the run.',
  'perRef.<ref>: catches = evidence.length = distinct merged PRs. evidence = {pr, runId, signature}, one per PR, the earliest run; signature is the failed-run ledger id of the failing step. firstSeen = the later of window.since and the day the ref\'s file was added on the merged ref, or the --sync day for a ref that entered the index after the fetch.',
  'zeroCatch = index rows of kind guard and state WIRED whose catches is 0 and whose firstSeen is not after the day of window.until. A ref `--sync` keyed after the fetch, with firstSeen = the sync day, had no chance to catch anything in the window: it is UNMEASURED, printed so by `--check`, and not counted, so the number does not move on every PR that adds a guard. Removing a zero-catch guard still lowers it. unattributed = failed runs with a live failing step attributed to no ref. runs.excluded = failed runs whose every failing step was excluded (non-defect, cancelled or gate-only). runs.noPr = attributed runs whose PR could not be named.',
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

/** One failing step's log section → the refs it is attributed to, and by which rule. */
export function attributeStep(lines, byBase, refSet) {
  const one = [];
  for (const name of failedNames(lines)) {
    const ref = byBase.get(`${name}.mjs`);
    if (ref && !one.includes(ref)) one.push(ref);
  }
  if (one.length) return { refs: one, rule: 1 };
  const scripts = runHeaderScripts(lines);
  if (scripts.length === 1 && refSet.has(scripts[0])) return { refs: [scripts[0]], rule: 2 };
  return { refs: [], rule: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE
// ═══════════════════════════════════════════════════════════════════════════

const indexRefs = (rows) =>
  [...new Set((rows ?? []).filter((r) => r && typeof r.ref === 'string' && r.ref.trim() !== '').map((r) => r.ref))].sort();

const isGuardWired = (row) => row && row.kind === 'guard' && row.state === 'WIRED';

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

/**
 * The file, from the fetch half's records.
 *   records   [{ runId, pr, createdAt, units: [{ step, lines, signature, excluded }] }]
 *             — `lines` prefix-stripped and scoped to the failing step.
 *   merged    Set of PR numbers merged in the window.
 *   added     Map file path → YYYY-MM-DD it was added on the merged ref.
 */
export function buildYield({ records, indexRows, merged, added = new Map(), since, until, apiCalls = 0 }) {
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
      for (const ref of attributeStep(u.lines, byBase, refSet).refs) if (!hit.has(ref)) hit.set(ref, u.signature);
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
    perRef[ref] = { catches: evidence.length, firstSeen: addedOn && addedOn > sinceDay ? addedOn : sinceDay, evidence };
  }
  return {
    _readme: README,
    asOf: day(until),
    window: { since: wholeSeconds(since), until: wholeSeconds(until), mergedPrs: merged.size },
    apiCalls,
    perRef,
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

export const writeYield = (root, doc) => writeFileSync(join(root, YIELD_REL), serialiseYield(doc));

// ═══════════════════════════════════════════════════════════════════════════
function main(argv) {
  const modes = argv.filter((a) => ['--check', '--sync', '--zero-count'].includes(a));
  const unknown = argv.filter((a) => a.startsWith('--') && !modes.includes(a));
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (modes.length !== 1 || unknown.length || positional.length > 1) {
    console.error('✗ COVERAGE LOST — usage: node tooling/ops/guard-yield.mjs --check|--sync|--zero-count [repoRoot]');
    return 2;
  }
  const root = resolve(positional[0] ?? ROOT);
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
  const wired = rows.filter(isGuardWired).length;
  const unmeasured = Object.keys(doc.perRef).filter((r) => isUnmeasured(doc.perRef[r], doc.window.until));
  for (const r of unmeasured) {
    console.log(`  · unmeasured: ${r} (firstSeen ${doc.perRef[r].firstSeen}, after the window; not counted in zeroCatch)`);
  }
  console.log(
    `ok  guard-yield — ${Object.keys(doc.perRef).length} ref(s) keyed, exactly the ${indexRefs(rows).length} ref(s) of ${INDEX_REL}; ` +
      `zeroCatch ${doc.zeroCatch} of ${wired} guard/WIRED (${unmeasured.length} unmeasured); unattributed ${doc.unattributed}; ` +
      `window ${doc.window.since} .. ${doc.window.until} (${doc.window.mergedPrs} merged PR(s)); asOf ${doc.asOf}`,
  );
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
