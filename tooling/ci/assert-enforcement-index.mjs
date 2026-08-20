#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-enforcement-index.mjs — the committed enforcement index is what the
// tree ACTUALLY says, re-derived here and compared, never trusted.
//
// Pipeline requirement: Private/requirements/ → F-10.
//
// ── WHY THIS IS NOT A CHECKSUM ───────────────────────────────────────────────
// A generated file that is committed has one failure mode worth guarding, and
// it is not corruption — it is a HUMAN EDIT that makes the index say something
// the tree does not. A digest cannot catch that: a challenger edited a row,
// re-ran the same hash the guard used, pasted the value back, and passed.
// A checksum stored beside the data it describes is a copy of the data.
// So this guard REGENERATES from the tree and compares bytes, and section 2
// FAILS if a digest field ever appears — the forgeable design is refused
// rather than merely unused.
//
// ── THE POPULATION IS DERIVED HERE, NOT TAKEN FROM THE GENERATOR ─────────────
// 🔴 Regeneration alone proves only that the file was not hand-edited. If the
// generator UNDER-COLLECTS, it under-collects identically in the committed file
// and in the rebuild, the diff is empty, and the guard is green over a smaller
// world. So section 4 lists tooling/ci ITSELF, through tree-walk, and requires
// every depth-1 .mjs to appear as a row. That is the one claim this guard holds
// that the generator cannot define away.
//
// ── WHAT IT CANNOT SEE ───────────────────────────────────────────────────────
//  · It does not re-derive invocation. Section 6 asks only whether a named
//    workflow exists and whether the ref is named inside that workflow's JOB
//    region — a one-sided test that can only catch a claim false under every
//    reading. A second matcher disagreeing with the generator would be a false
//    RED, which is the drift workflow-scan.mjs was extracted to stop.
//  · A `test`-kind row is NOT expected to be named in any workflow: the suite
//    is invoked as `node --test "tooling/ci/test/*.test.mjs"`, a GLOB, so no
//    workflow line carries a test file's name. Requiring one would make every
//    such row permanently red.
//  · A `lane` ref is a JOB, not a path, and a `human` ref is a review row in
//    tooling/dod-register.json. Resolving either with existsSync would report
//    the two enforcers the Definition-of-Done register names as non-existent.
//  · Line endings are normalised before comparison, so a CRLF checkout reads as
//    equal. Keeping the file LF is .gitattributes' job.
//
// ── ORPHANS PRINT, THEY DO NOT FAIL ──────────────────────────────────────────
// An enforcer nothing invokes is a FINDING FOR A HUMAN. Failing on one would
// make the index unaddable the day the tree grows its first orphan, and the
// standing rule applies: a guard that reds the build on work only a person can
// do gets switched off, and a gap nobody sees becomes permanent.
//
// Usage:  node tooling/ci/assert-enforcement-index.mjs [repoRoot]
// Exit 0 = the committed index is byte-for-byte what this tree generates, every
//          ref resolves in the way its kind requires, and the population holds.
//      1 = it is not, or the index is absent, unparseable or empty.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { parseAllWorkflows, shellSegments, WORKFLOW_DIR } from './workflow-scan.mjs';
import { INDEX_REL, KINDS, STATES, CoverageLost, buildEnforcementIndex, serialiseIndex } from './build-enforcement-index.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const scanningRealRepo = process.argv[2] === undefined;

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('assert-enforcement-index: FAILED');
  process.exit(1);
}

const FORBIDDEN_KEYS = /^(digest|checksum|sha|sha1|sha256|sha512|hash|md5|signature|fingerprint|integrity|generatedAt|timestamp)$/i;
const CI_REL = 'tooling/ci';
const DOD_REL = 'tooling/dod-register.json';

// ── 1. THE COMMITTED INDEX EXISTS, PARSES, AND HAS ROWS ─────────────────────
// Read BEFORE the generator is called: with no index every limb below ranges
// over nothing and prints ok, and deleting the file is the cheapest way to turn
// this guard green — so its absence is the LOUD case, not a skip.
const INDEX_ABS = join(ROOT, INDEX_REL);
if (!existsSync(INDEX_ABS)) {
  coverageLost([
    `${INDEX_REL} does not exist.`,
    'It is the only place this repository states which enforcer answers for which requirement. With no',
    'index every question below has no subject.',
  ]);
}
const rawCommitted = readFileSync(INDEX_ABS, 'utf8');
if (rawCommitted.trim() === '') {
  coverageLost([`${INDEX_REL} is empty.`, 'An empty file is not an index of nothing; it is an index that was not written.']);
}
let committedRows;
try {
  committedRows = JSON.parse(rawCommitted);
} catch (e) {
  coverageLost([`${INDEX_REL} is not valid JSON — ${e.message}`, 'An unparseable index must never read as an unchanged one.']);
}
if (!Array.isArray(committedRows)) {
  coverageLost([`${INDEX_REL} is not a row array, so every check below has an empty domain.`]);
}
if (committedRows.length === 0) {
  coverageLost([
    `${INDEX_REL} contains ZERO rows.`,
    'An index over no enforcers makes "every ref resolves" vacuously true.',
  ]);
}

// ── 2. SCHEMA, VOCABULARY, AND THE REFUSED DIGEST ───────────────────────────
function findForbidden(value, path, out) {
  if (Array.isArray(value)) return value.forEach((v, i) => findForbidden(v, `${path}[${i}]`, out));
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(k)) out.push(`${path}.${k}`);
    findForbidden(v, `${path}.${k}`, out);
  }
}
const digestFields = [];
findForbidden(committedRows, '(index)', digestFields);
for (const where of digestFields) {
  problems.push(
    `${INDEX_REL} carries a stored digest at ${where}. This index is verified by REGENERATION; a checksum ` +
      'committed beside the data it describes is forgeable in the same edit that forged the data. Remove it.',
  );
}

const seenRefs = new Map();
for (const [i, row] of committedRows.entries()) {
  const at = `${INDEX_REL} row ${i}`;
  if (row === null || typeof row !== 'object' || Array.isArray(row)) { problems.push(`${at} is not an object, so it names no enforcer.`); continue; }
  if (typeof row.ref !== 'string' || row.ref.trim() === '') { problems.push(`${at} has no \`ref\`. A row with no enforcer is a claim about nobody.`); continue; }
  if (seenRefs.has(row.ref)) {
    problems.push(`${at} repeats ref "${row.ref}", already row ${seenRefs.get(row.ref)}. Two rows for one enforcer means two answers to "what does this enforce".`);
  } else seenRefs.set(row.ref, i);
  if (typeof row.kind !== 'string' || !KINDS.has(row.kind)) {
    problems.push(
      `${at} ("${row.ref}") has kind ${JSON.stringify(row.kind)}, outside ${[...KINDS].sort().join(' | ')}. Forcing a LANE, ` +
        'a HUMAN review or a TEST into "guard" or "none" publishes a false negative — a requirement reported ' +
        'unenforced that a job enforces on every push.',
    );
  }
  if (typeof row.state !== 'string' || !STATES.has(row.state)) {
    problems.push(`${at} ("${row.ref}") has state ${JSON.stringify(row.state)}, outside ${[...STATES].sort().join(' | ')}.`);
  }
  for (const f of ['claims', 'references', 'invokedBy']) {
    if (!Array.isArray(row[f]) || row[f].some((v) => typeof v !== 'string' || v.trim() === '')) {
      problems.push(`${at} ("${row.ref}") has no \`${f}\` array of strings.`);
    }
  }
  if (row.state === 'WIRED' && Array.isArray(row.invokedBy) && row.invokedBy.length === 0 && row.kind !== 'test') {
    problems.push(`${at} ("${row.ref}") is WIRED and names no workflow — the state and the evidence disagreeing inside one row.`);
  }
  if (row.state === 'ORPHAN' && Array.isArray(row.invokedBy) && row.invokedBy.length > 0) {
    problems.push(`${at} ("${row.ref}") is ORPHAN and names ${row.invokedBy.length} workflow(s); the index is under-reporting coverage it has.`);
  }
}

// ── 3. REGENERATE AND COMPARE — the tree is the authority ───────────────────
let built;
try {
  built = await buildEnforcementIndex(ROOT, { realRepo: scanningRealRepo });
} catch (e) {
  if (e instanceof CoverageLost) {
    coverageLost([`the generator refused to rebuild the index from this tree — ${e.lines[0]}`, ...e.lines.slice(1)]);
  }
  coverageLost([
    `the generator threw while rebuilding from this tree — ${e && e.message ? e.message : e}`,
    '"The check did not run" must never be reported as "the check passed".',
  ]);
}
if (built.problems.length) {
  for (const p of built.problems) problems.push(`the regenerated index is itself invalid: ${p}`);
}
if (!Array.isArray(built.rows) || built.rows.length === 0) {
  coverageLost([
    'the generator produced no rows from this tree, so the comparison has no subject.',
  ]);
}
const rebuilt = serialiseIndex(built);
const lf = (s) => s.replace(/\r\n/g, '\n');
const bytesEqual = lf(rebuilt) === lf(rawCommitted);

function diffRows(committedList, builtList) {
  const key = (list) => {
    const m = new Map();
    for (const r of list) if (r && typeof r === 'object' && typeof r.ref === 'string' && !m.has(r.ref)) m.set(r.ref, r);
    return m;
  };
  const a = key(committedList);
  const b = key(builtList);
  const out = [];
  for (const ref of a.keys()) if (!b.has(ref)) out.push(`  − "${ref}" is in the committed index and this tree does not produce it.`);
  for (const ref of b.keys()) if (!a.has(ref)) out.push(`  + "${ref}" is produced by this tree and is missing from the committed index.`);
  for (const [ref, cRow] of a) {
    const bRow = b.get(ref);
    if (!bRow) continue;
    for (const f of [...new Set([...Object.keys(cRow), ...Object.keys(bRow)])].sort()) {
      const cv = JSON.stringify(cRow[f]);
      const bv = JSON.stringify(bRow[f]);
      if (cv !== bv) out.push(`  ≠ "${ref}".${f}: committed ${cv ?? 'absent'} — this tree ${bv ?? 'absent'}`);
    }
  }
  return out;
}

if (!bytesEqual) {
  const rowDiff = diffRows(committedRows, built.rows);
  // 🔴 A NON-DETERMINISTIC GENERATOR would make this guard permanently red and
  // the message would blame the author for a staleness that is not there. On a
  // mismatch only — it costs a second full build — the generator is compared
  // with ITSELF, so that fault is named instead of misattributed.
  let second = null;
  try {
    second = serialiseIndex(await buildEnforcementIndex(ROOT, { realRepo: scanningRealRepo }));
  } catch { second = null; }
  if (typeof second === 'string' && lf(second) !== lf(rebuilt)) {
    coverageLost([
      'the generator produced TWO DIFFERENT indexes from one unchanged tree.',
      'Nothing can be concluded about the committed file: a generator carrying a timestamp, an absolute path',
      'or an unsorted set can never agree with any committed copy. Fix the generator first.',
    ]);
  }
  if (rowDiff.length === 0) {
    problems.push(
      `${INDEX_REL} has the same rows this tree produces but not the same BYTES — row order, key order or ` +
        'formatting differs from serialiseIndex(). It was written by something other than the generator.',
    );
  } else {
    problems.push(`${INDEX_REL} DISAGREES with the index regenerated from this tree — ${rowDiff.length} difference(s). The tree is the authority:`);
    for (const l of rowDiff.slice(0, 40)) problems.push(l);
    if (rowDiff.length > 40) problems.push(`  … and ${rowDiff.length - 40} more difference(s).`);
  }
}

// ── 4. THE POPULATION IDENTITY, DERIVED HERE ────────────────────────────────
const CI_ABS = join(ROOT, 'tooling', 'ci');
if (!existsSync(CI_ABS)) {
  coverageLost([`${CI_REL} does not exist, so the population this index must cover cannot be listed.`]);
}
const onDisk = listDir(CI_ABS).filter((f) => f.endsWith('.mjs')).sort();
if (onDisk.length === 0) {
  coverageLost([
    `${CI_REL} holds ZERO .mjs file, so "every enforcer has a row" is true of the empty set.`,
    'That is the shape of a scan that stopped scanning, not of a repository with no guards.',
  ]);
}
const rowRefs = new Set(committedRows.filter((r) => r && typeof r.ref === 'string').map((r) => r.ref));
const missing = onDisk.filter((f) => !rowRefs.has(`${CI_REL}/${f}`));
if (missing.length) {
  problems.push(
    `${missing.length} enforcer(s) exist in ${CI_REL} and have NO ROW in the index — a missing row reads as ` +
      '"there is no such enforcer", which is the one error worse than a wrong row:',
  );
  for (const m of missing.slice(0, 20)) problems.push(`  · ${CI_REL}/${m}`);
}

// The register that types LANE and HUMAN. Its items are the only public,
// machine-readable statement that a DoD item is enforced by a job or a person.
const dodAbs = join(ROOT, DOD_REL);
if (!existsSync(dodAbs)) {
  coverageLost([
    `${DOD_REL} does not exist, so no LANE or HUMAN enforcer can be cross-checked.`,
    'Every such item would be published as enforced by nothing — the false negative typed enforcement exists',
    'to prevent.',
  ]);
}
let dod = null;
try { dod = JSON.parse(readFileSync(dodAbs, 'utf8')); } catch (e) {
  coverageLost([`${DOD_REL} is not valid JSON — ${e.message}`]);
}
const dodItems = Array.isArray(dod.items) ? dod.items : [];
const humanReviewRows = Array.isArray(dod.humanReviewRows) ? dod.humanReviewRows : [];
const wantLane = dodItems.filter((i) => i.enforcedBy === 'lane').length;
const wantHuman = dodItems.filter((i) => i.enforcedBy === 'human').length;
const gotLane = committedRows.filter((r) => r && r.kind === 'lane').length;
const gotHuman = committedRows.filter((r) => r && r.kind === 'human').length;
if (wantLane > 0 && gotLane === 0) {
  problems.push(`${DOD_REL} declares ${wantLane} LANE-enforced item(s) and the index carries no \`lane\` row. A lane that enforces on every push has been published as nothing.`);
}
if (wantHuman > 0 && gotHuman === 0) {
  problems.push(`${DOD_REL} declares ${wantHuman} HUMAN-enforced item(s) and the index carries no \`human\` row. A person who does the work has been published as nobody.`);
}

// ── 5. EVERY `ref` RESOLVES IN THE WAY ITS KIND REQUIRES ────────────────────
const parsed = parseAllWorkflows(ROOT);
const wfDirAbs = join(ROOT, WORKFLOW_DIR);
const wfOnDisk = existsSync(wfDirAbs) ? listDir(wfDirAbs).filter((f) => /\.ya?ml$/.test(f)) : [];
if (scanningRealRepo && wfOnDisk.length === 0) {
  coverageLost([`no workflow exists under ${WORKFLOW_DIR} in the real repository, so every WIRED claim would pass unexamined.`]);
}
if (parsed.length !== wfOnDisk.length) {
  coverageLost([
    `${wfOnDisk.length} workflow file(s) are on disk under ${WORKFLOW_DIR} and the shared parser returned ${parsed.length}.`,
    'A workflow that was never opened would exonerate every row whose invocation lives in it.',
  ]);
}
const jobIndex = new Set();
const jobText = new Map();
for (const w of parsed) {
  for (const job of w.jobs.values()) {
    jobIndex.add(`${w.rel}#${job.name}`);
    jobText.set(`${w.rel}#${job.name}`, (job.logical ?? []).map((l) => l.text ?? ''));
  }
}

let resolved = 0;
let printedRefs = 0;
for (const row of committedRows) {
  if (!row || typeof row.ref !== 'string' || row.ref.trim() === '') continue;
  switch (row.kind) {
    case 'lane': {
      // A JOB NAME, not a path. existsSync here would report the register's own
      // lane enforcer as non-existent and go permanently red.
      if (jobIndex.has(row.ref)) { resolved++; break; }
      problems.push(`"${row.ref}" is a LANE enforcer and no workflow declares that job. A lane that does not exist enforces nothing.`);
      break;
    }
    case 'human': {
      const rowName = row.ref.startsWith(`${DOD_REL}#`) ? row.ref.slice(DOD_REL.length + 1) : null;
      if (rowName && humanReviewRows.includes(rowName)) { resolved++; break; }
      problems.push(`"${row.ref}" is a HUMAN enforcer naming a review row that ${DOD_REL} does not declare. A human half pointing at nothing is worse than an admitted gap.`);
      break;
    }
    case 'cross-repo':
    case 'none': {
      printedRefs++;
      prints.push(`"${row.ref}" (kind ${row.kind}) is not resolvable in this checkout by design — printed so it is never mistaken for a verified path.`);
      break;
    }
    default: {
      if (existsSync(join(ROOT, row.ref))) { resolved++; break; }
      problems.push(
        `"${row.ref}" is named as an enforcer of ${JSON.stringify(row.claims ?? [])} and does not exist. A row ` +
          'pointing at a deleted file reports a requirement as ENFORCED by something that cannot run.',
      );
    }
  }
}
if (resolved === 0) {
  coverageLost([
    `${committedRows.length} row(s) produced ZERO resolvable refs (${printedRefs} were of a kind this checkout cannot resolve).`,
    'Nothing was actually looked at, so "every ref resolves" was proven over the empty set.',
  ]);
}

// ── 6. EVERY WIRED ROW'S WORKFLOWS EXIST AND NAME IT ────────────────────────
// `test`-kind rows are exempt by construction: the suite is invoked as a GLOB,
// so no workflow line can ever carry a test file's name.
let edges = 0;
// Only kinds whose ref IS a runnable path get the mention test. A `lane` ref is
// the job itself, a `human` ref is a review row, and `none`/`cross-repo` name
// nothing here — asking any of them to appear in a `node` command produces a
// message about a claim the row never made.
const wiredRows = committedRows.filter(
  (r) => r && r.state === 'WIRED' && Array.isArray(r.invokedBy) && (r.kind === 'guard' || r.kind === 'script'),
);
for (const row of wiredRows) {
  for (const edge of row.invokedBy) {
    const [wf] = edge.split('#');
    if (!existsSync(join(ROOT, wf))) {
      problems.push(`"${row.ref}" is WIRED by "${edge}", and that workflow does not exist. The row reports an enforcer as running when nothing runs it.`);
      continue;
    }
    const lines = jobText.get(edge);
    if (lines === undefined) {
      problems.push(`"${row.ref}" is WIRED by "${edge}" and no such job exists in that workflow.`);
      continue;
    }
    edges++;
    const mentions = lines.filter((t) => t.includes(row.ref));
    if (mentions.length === 0) {
      problems.push(
        `"${row.ref}" is WIRED by "${edge}" and that job never names it. Comments are blanked and trigger ` +
          'filters sit outside the job region, so this is a claim no reading of the file supports.',
      );
      continue;
    }
    // Matched on the FULL ref, never the basename: assert-artifact-signed.mjs is
    // a prefix of assert-artifact-signed-apple.mjs, and two more such pairs
    // exist, so a basename test lets a row ride on its neighbour's invocation.
    const commanded = mentions.some((t) => shellSegments(t).some((seg) => seg.includes(row.ref) && /(?:^|[^\w.\-/])node(?:\s|$)/.test(seg)));
    if (!commanded) {
      prints.push(
        `"${row.ref}" is named in "${edge}" but in no segment that also runs \`node\` — it may be text in an ` +
          '`echo`, a heredoc or a commit message. Printed, not failed: this guard does not re-derive invocation.',
      );
    }
  }
}
if (wiredRows.length > 0 && edges === 0) {
  coverageLost([
    `${wiredRows.length} WIRED row(s) produced ZERO workflow comparisons.`,
    'The invocation half of the index was accepted without being looked at once.',
  ]);
}

// ── 7. ORPHANS PRINT ────────────────────────────────────────────────────────
const orphans = committedRows.filter((r) => r && r.state === 'ORPHAN');
for (const row of orphans) {
  prints.push(
    `ORPHAN — "${row.ref}" is an enforcer no workflow invokes` +
      (Array.isArray(row.claims) && row.claims.length
        ? `, and it claims ${row.claims.join(' · ')}. Those requirements are cited by something that never runs.`
        : ', and it claims no requirement id. Nothing states what it is for and nothing runs it.'),
  );
}
for (const n of built.notes) prints.push(n);

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('   ── printed, not failed (a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
if (problems.length) {
  for (const p of problems) console.error(p.startsWith('  ') ? p : `✗ ${p}`);
  console.error('  The index is REGENERATED from the tree and compared, never trusted. There is no digest to');
  console.error('  re-compute: see the header of tooling/ci/assert-enforcement-index.mjs.');
  console.error('assert-enforcement-index: FAILED');
  process.exit(1);
}
const kinds = new Map();
for (const r of committedRows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
console.log(
  `ok  enforcement index — ${committedRows.length} row(s) in ${INDEX_REL} are byte-for-byte the index regenerated ` +
    `from this tree [${[...kinds.entries()].sort().map(([k, n]) => `${n} ${k}`).join(', ')}]; ` +
    `all ${onDisk.length} enforcer(s) in ${CI_REL} carry a row; ${resolved} ref(s) resolve; ` +
    `${edges} WIRED row × job edge(s) checked against ${parsed.length} workflow(s); ${orphans.length} orphan(s) printed`,
);
