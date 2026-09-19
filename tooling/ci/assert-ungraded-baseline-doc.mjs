#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-ungraded-baseline-doc.mjs — the README that itemises an extension's
// ungraded fixtures says what the fixture-coverage guard's baseline says.
//
// Register row: O-FULLSHOT-CLAIM-SUITES-STALE (the stale-README limb).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// .github/workflows/extensions.yml carries the fixture-coverage guard, and two
// arrays in its inline script: QUARANTINE (the suites that do not run) and
// UNGRADED_BASELINE (the shapes that reach no suite that does). The Full Screen
// Shot README itemises the same shapes in a table, with the suite that would
// grade each. On 2026-08-27 privacy-verify.mjs came off QUARANTINE and three
// shapes came off the baseline. The README went on saying "fifteen" and calling
// privacy-verify.mjs quarantined for three weeks, because nothing compared the
// workflow to the doc. The workflow runs weekly and never reads the README.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
// A README takes part by carrying a marked block:
//   <!-- ungraded-baseline:begin <dir> -->  …  <!-- ungraded-baseline:end -->
// where <dir> is the workflow's SUITE_DIR spelling (e.g. Extension/Full_Screen_Shot).
//   U0 every dir that has UNGRADED_BASELINE rows has a block in
//      extensions/<dir>/test/e2e/README.md, and a block's <dir> is the dir its
//      README sits in
//   U1 the shapes in the block's table are exactly that dir's baseline rows
//      (none missing, none extra, none twice)
//   U2 every suite a row names is in that dir's QUARANTINE list, and the row's
//      state cell says so. A wired suite would have graded the shape.
//   U3 the block states its count once, as **N shapes reach no graded suite**,
//      and N is the number of baseline rows for the dir
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
// It does not check that the named suite is the ONLY suite that registers the
// shape. That derivation (registrations, loaded children, comment stripping) is
// the workflow's own, and a second copy here would drift from it. It does not
// check the "what would close it" column, which is judgement. It does not check
// the total shape count, which the workflow derives on every run and prints.
// It reads the arrays as text, through workflow-scan.mjs, and does not run the
// workflow's script.
//
// Usage:  node tooling/ci/assert-ungraded-baseline-doc.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { listDir } from './tree-walk.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, WORKFLOW_DIR } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const WORKFLOW = `${WORKFLOW_DIR}/extensions.yml`;
const readmeFor = (dir) => `extensions/${dir}/test/e2e/README.md`;

function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — assert-ungraded-baseline-doc checked nothing that counts as evidence:');
  for (const l of lines) console.error(`  ${l}`);
  process.exit(2);
}

// ── read the two arrays out of the workflow ─────────────────────────────────
const parsed = parseWorkflow(ROOT, WORKFLOW);
if (parsed === null) coverageLost([`${WORKFLOW} does not exist under ${ROOT}; there is no baseline to compare against.`]);

/** The source lines of `const NAME = [` up to the first line that is only `];`,
 *  with JS block comments removed. Returns null when the array is not there. */
function arraySource(name) {
  const lines = parsed.lines.map((l) => l.text);
  const start = lines.findIndex((t) => new RegExp(String.raw`\bconst\s+${name}\s*=\s*\[`).test(t));
  if (start === -1) return null;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    body.push(lines[i]);
    if (i > start && /^\s*\];\s*$/.test(lines[i])) {
      return body.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    }
  }
  return null;
}

const quarantineSrc = arraySource('QUARANTINE');
const baselineSrc = arraySource('UNGRADED_BASELINE');
const missing = [];
if (quarantineSrc === null) missing.push(`${WORKFLOW} has no readable \`const QUARANTINE = [ … ];\` array.`);
if (baselineSrc === null) missing.push(`${WORKFLOW} has no readable \`const UNGRADED_BASELINE = [ … ];\` array.`);
if (missing.length) coverageLost(missing);

const quarantine = new Map(); // dir -> Set(file)
for (const m of quarantineSrc.matchAll(/\{\s*dir:\s*"([^"]+)",\s*file:\s*"([^"]+)"/g)) {
  if (!quarantine.has(m[1])) quarantine.set(m[1], new Set());
  quarantine.get(m[1]).add(m[2]);
}
const baseline = new Map(); // dir -> string[]
for (const m of baselineSrc.matchAll(/\{\s*dir:\s*"([^"]+)",\s*id:\s*"([^"]+)"\s*\}/g)) {
  if (!baseline.has(m[1])) baseline.set(m[1], []);
  baseline.get(m[1]).push(m[2]);
}
// A row the entry pattern did not read is a row this guard is blind to.
const rowsWritten = (baselineSrc.match(/\{\s*dir:/g) ?? []).length;
const rowsRead = [...baseline.values()].reduce((n, ids) => n + ids.length, 0);
if (rowsWritten !== rowsRead) {
  coverageLost([`UNGRADED_BASELINE in ${WORKFLOW} has ${rowsWritten} \`{ dir:\` entries but only ${rowsRead} read as { dir: "…", id: "…" }; the entry shape changed.`]);
}
const quarantineWritten = (quarantineSrc.match(/\{\s*dir:/g) ?? []).length;
const quarantineRead = [...quarantine.values()].reduce((n, s) => n + s.size, 0);
if (quarantineWritten !== quarantineRead) {
  coverageLost([`QUARANTINE in ${WORKFLOW} has ${quarantineWritten} \`{ dir:\` entries but ${quarantineRead} distinct { dir, file } pairs were read; the entry shape changed.`]);
}

// ── find every block ────────────────────────────────────────────────────────
const findings = [];
const BEGIN = /<!--\s*ungraded-baseline:begin\s+(\S+)\s*-->/g;
const END = /<!--\s*ungraded-baseline:end\s*-->/;

const dirs = new Set([...baseline.keys()]);
const extRoot = join(ROOT, 'extensions');
if (!existsSync(extRoot)) coverageLost([`extensions/ does not exist under ${ROOT}; there is no README to read.`]);

let blocksRead = 0;
const checkedReadmes = new Set();
const readReadmes = [];
function checkReadme(dir) {
  const rel = readmeFor(dir);
  if (checkedReadmes.has(rel)) return;
  checkedReadmes.add(rel);
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    if (baseline.has(dir)) findings.push(`U0 ${dir} has ${baseline.get(dir).length} UNGRADED_BASELINE row(s) and ${rel} does not exist to itemise them.`);
    return;
  }
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  const begins = [...text.matchAll(BEGIN)];
  if (begins.length === 0) {
    if (baseline.has(dir)) findings.push(`U0 ${rel} carries no <!-- ungraded-baseline:begin ${dir} --> block, and ${dir} has ${baseline.get(dir).length} UNGRADED_BASELINE row(s).`);
    return;
  }
  for (const b of begins) {
    const blockDir = b[1];
    const line = text.slice(0, b.index).split('\n').length;
    const after = text.slice(b.index + b[0].length);
    const end = after.search(END);
    if (end === -1) {
      findings.push(`U0 ${rel}:${line} opens a block with no <!-- ungraded-baseline:end -->.`);
      continue;
    }
    if (blockDir !== dir) {
      findings.push(`U0 ${rel}:${line} is a block for "${blockDir}", but the README sits in ${dir}.`);
      continue;
    }
    blocksRead++;
    readReadmes.push(rel);
    checkBlock(rel, line, dir, after.slice(0, end));
  }
}

function checkBlock(rel, line, dir, block) {
  const want = baseline.get(dir) ?? [];
  const quarantined = quarantine.get(dir) ?? new Set();

  // U3 — the stated count.
  const counts = [...block.matchAll(/\*\*(\d+) shapes? reach(?:es)? no graded suite\b/g)];
  if (counts.length !== 1) {
    findings.push(`U3 ${rel}:${line} states its count ${counts.length} times; write it once as **N shapes reach no graded suite**.`);
  } else if (Number(counts[0][1]) !== want.length) {
    findings.push(`U3 ${rel}:${line} says ${counts[0][1]} shapes reach no graded suite; UNGRADED_BASELINE holds ${want.length} for ${dir}.`);
  }

  // The table rows: a first cell that is one backticked path.
  const rows = [];
  for (const l of block.split('\n')) {
    const cells = l.trim().startsWith('|') ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : null;
    if (!cells) continue;
    const shape = cells[0].match(/^`([^`]+)`$/);
    if (!shape) continue;
    rows.push({ shape: shape[1], suite: (cells[1] ?? '').match(/^`([^`]+)`$/)?.[1] ?? null, state: cells[2] ?? '' });
  }

  // U1 — the set of shapes.
  const seen = new Map();
  for (const r of rows) seen.set(r.shape, (seen.get(r.shape) ?? 0) + 1);
  for (const [s, n] of seen) if (n > 1) findings.push(`U1 ${rel}:${line} lists ${s} ${n} times.`);
  for (const s of want) if (!seen.has(s)) findings.push(`U1 ${rel}:${line} does not list ${s}, which is on UNGRADED_BASELINE for ${dir}.`);
  for (const s of seen.keys()) if (!want.includes(s)) findings.push(`U1 ${rel}:${line} lists ${s}, which is NOT on UNGRADED_BASELINE for ${dir}. It reaches a graded suite now, or the name is wrong.`);

  // U2 — every named suite is still quarantined, and the row says so.
  for (const r of rows) {
    if (r.suite === null) {
      findings.push(`U2 ${rel}:${line} row ${r.shape} names no suite as one backticked file in its second cell.`);
    } else if (!quarantined.has(r.suite)) {
      findings.push(`U2 ${rel}:${line} row ${r.shape} names ${r.suite}, which is NOT on QUARANTINE for ${dir}. A wired suite grades its shapes, so the row is stale.`);
    } else if (!/^quarantined\b/.test(r.state)) {
      findings.push(`U2 ${rel}:${line} row ${r.shape} gives ${r.suite} the state "${r.state}"; QUARANTINE lists it, so the state starts with "quarantined".`);
    }
  }
}

for (const dir of dirs) checkReadme(dir);
// A block in a README whose dir has no baseline rows is still checked: it must say 0.
for (const q of quarantine.keys()) checkReadme(q);
// ...and so is a block whose dir has NEITHER. Added 2026-09-19, when the Full Screen Shot
// rows and quarantine entries all went to zero in one commit: the two loops above are keyed
// on the arrays, so an emptied dir dropped out of both and its README block went unread —
// "0 README block(s) read", exit 0, over a block that could have gone on saying 12. Every
// extensions/<Category>/<Tool>/test/e2e/README.md is therefore visited; one without a block
// and without baseline rows is not a finding (checkReadme returns quietly), one WITH a block
// is held to the arrays like any other.
for (const cat of listDir(extRoot, { withFileTypes: true })) {
  if (!cat.isDirectory()) continue;
  for (const tool of listDir(join(extRoot, cat.name), { withFileTypes: true })) {
    if (tool.isDirectory()) checkReadme(`${cat.name}/${tool.name}`);
  }
}

if (dirs.size > 0 && blocksRead === 0) {
  if (findings.length === 0) coverageLost([`UNGRADED_BASELINE names ${dirs.size} dir(s) and no block was read.`]);
}

const total = [...baseline.values()].reduce((n, ids) => n + ids.length, 0);
console.log(`assert-ungraded-baseline-doc: ${WORKFLOW} — ${total} baseline row(s) over ${dirs.size} dir(s), ${quarantineRead} quarantined suite(s); ${blocksRead} README block(s) read (${readReadmes.join(', ') || 'none'})`);
if (findings.length) {
  for (const f of findings) console.error(`✗ ${f}`);
  console.error(`✗ ${findings.length} finding(s). Update the README block to match the workflow's arrays; the arrays are the record.`);
  process.exit(1);
}
console.log('ok  every README block matches UNGRADED_BASELINE and QUARANTINE');
