#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-paid-calls-metered.mjs — EVERY CALL TO A PER-CALL PAID API IS PAID FOR
// BY THE CUSTOMER, GATED IN CODE, DISCLOSED AND MARKED.
//
// train-st-ai-customer-pays (T17). The owner lock (2026-10-01): "If using AI ...
// it should come from customer pocket." Allowed shapes ONLY: the user's own key
// (bring-your-own-key) or OUR key behind a paid plan or paid credits, metered and
// hard-capped. The register is tooling/paid-calls.json; its `_readme` is the
// contract. This guard holds the tree to it:
//
//   P1  every row has a host the register declares, a kind, `payer: customer`,
//       a mode (`metered` | `byok`) and callers that exist;
//   P2  every `gate` anchor is a fragment its file still contains — a metered
//       row needs at least two (the reservation and the plan check), a byok row
//       at least one (the device key read). Deleting the reservation call from
//       the adapter, or the plan check from the meter, exits 1. A gate may also
//       name `requires`/`forbid` fragments of the function body its anchor
//       opens (P2b), so a plan check rewritten to answer `'paid'` unconditionally
//       exits 1 although its first line still stands;
//   P3  every `ai-inference` row names its disclosure string keys — each must be
//       a key of the named ARB — and its output marker fields — each must appear
//       in the named file (EU AI Act Art. 50(1) and 50(2), for every future AI
//       feature, not only today's);
//   P4  COVERAGE: every non-test source file under `scanRoots` that names one of
//       a host's needles is a `caller` of a row for THAT host. A new paid call
//       with no row is a finding, not a silence.
//
// Exit 0 green · 1 a finding · 2 COVERAGE LOST (no register, no rows, or the
// scan found no caller at all — a scan that sees nothing proves nothing).
//
// Usage: node tooling/ci/assert-paid-calls-metered.mjs [repoRoot]
// Plain Node, no shell helper, `node:path` joins only: it runs the same on the
// Windows laptop the hooks run on.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const REGISTER = join(repoRoot, 'tooling', 'paid-calls.json');
const KINDS = new Set(['ai-inference', 'paid-api']);
const MODES = new Set(['metered', 'byok']);
const SOURCE_EXT = /\.(?:ts|tsx|mts|js|mjs|cjs|dart)$/;
const SKIP_DIRS = new Set(['node_modules', '.dart_tool', 'build', 'test', 'tests', 'integration_test', 'test_driver', '.wrangler', 'generated']);
const isTestFile = (name) => /(?:_test\.dart|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?)$/.test(name);

const toPosix = (p) => p.split(sep).join('/');
const rel = (p) => toPosix(relative(repoRoot, p));

function coverageLost(msg) {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  process.exit(2);
}

if (!existsSync(REGISTER)) coverageLost(`${rel(REGISTER)} is missing: there is no register to hold the tree to.`);
let reg;
try {
  reg = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (e) {
  coverageLost(`${rel(REGISTER)} is not JSON (${e.message}).`);
}
const rows = Array.isArray(reg.rows) ? reg.rows : [];
if (rows.length === 0) coverageLost(`${rel(REGISTER)} has no rows.`);
const hosts = reg.hosts && typeof reg.hosts === 'object' ? reg.hosts : {};
if (Object.keys(hosts).length === 0) coverageLost(`${rel(REGISTER)} declares no hosts to scan for.`);
const scanRoots = Array.isArray(reg.scanRoots) ? reg.scanRoots : [];
if (scanRoots.length === 0) coverageLost(`${rel(REGISTER)} declares no scanRoots.`);

const problems = [];
const fileCache = new Map();
/** A repo-relative POSIX path's text, or null. Backslashes and a leading ./ are normalised. */
function read(relPath) {
  const norm = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  if (fileCache.has(norm)) return fileCache.get(norm);
  const abs = join(repoRoot, ...norm.split('/'));
  // One read, no existence check first (a check-then-read is a race): a missing
  // path or a directory throws, and either is "no such file" here.
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    text = null;
  }
  fileCache.set(norm, text);
  return text;
}
const normRel = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * P2b — A GATE THAT STANDS BUT NO LONGER GATES. An anchor on a function's first
 * line survives a body rewritten to `return 'paid';` (review 2026-10-03). A gate may
 * therefore name `requires` (fragments its BODY must hold: the predicate itself)
 * and `forbid` (fragments it must not: an unconditional verdict). Both are compared
 * with all whitespace removed, as plain text — never compiled into a pattern. The
 * body is the anchor's line through the first line that is a lone `}` at column 0.
 */
function gateBodyProblems(where, g, text) {
  const requires = Array.isArray(g.requires) ? g.requires : [];
  const forbid = Array.isArray(g.forbid) ? g.forbid : [];
  if (requires.length === 0 && forbid.length === 0) return [];
  const at = text.indexOf(g.anchor);
  const end = text.indexOf('\n}', at);
  const squash = (t) => String(t).replace(/\s+/g, '');
  const body = squash(text.slice(at, end === -1 ? undefined : end));
  const out = [];
  for (const f of requires) {
    if (!body.includes(squash(f))) out.push(`${where} P2 the gate at ${JSON.stringify(g.anchor)} in ${normRel(g.file)} no longer holds ${JSON.stringify(f)} — ${g.why ?? 'the gate'} stands but no longer decides`);
  }
  for (const f of forbid) {
    if (body.includes(squash(f))) out.push(`${where} P2 the gate at ${JSON.stringify(g.anchor)} in ${normRel(g.file)} holds the forbidden ${JSON.stringify(f)} — ${g.why ?? 'the gate'} answers without checking`);
  }
  return out;
}

// ── P1–P3: the rows ───────────────────────────────────────────────────────────
const callersByHost = new Map();
for (const [i, row] of rows.entries()) {
  const id = typeof row?.id === 'string' && row.id ? row.id : `rows[${i}]`;
  const where = `[${id}]`;
  if (!row || typeof row !== 'object') {
    problems.push(`${where} is not an object`);
    continue;
  }
  if (!Object.hasOwn(hosts, row.host)) problems.push(`${where} P1 host ${JSON.stringify(row.host)} is not one the register declares in \`hosts\``);
  if (!KINDS.has(row.kind)) problems.push(`${where} P1 kind ${JSON.stringify(row.kind)} is not one of ${[...KINDS].join(', ')}`);
  if (row.payer !== 'customer') problems.push(`${where} P1 payer is ${JSON.stringify(row.payer)}: the owner lock admits only \`customer\` (BYOK, or our key behind a paid plan or paid credits)`);
  if (!MODES.has(row.mode)) problems.push(`${where} P1 mode ${JSON.stringify(row.mode)} is not one of ${[...MODES].join(', ')}`);
  const callers = Array.isArray(row.callers) ? row.callers.map(normRel) : [];
  if (callers.length === 0) problems.push(`${where} P1 names no callers`);
  for (const c of callers) {
    if (read(c) === null) problems.push(`${where} P1 caller ${c} does not exist`);
    if (!callersByHost.has(row.host)) callersByHost.set(row.host, new Set());
    callersByHost.get(row.host).add(c);
  }

  const gates = Array.isArray(row.gate) ? row.gate : [];
  const need = row.mode === 'metered' ? 2 : 1;
  if (gates.length < need) problems.push(`${where} P2 a ${row.mode} row needs at least ${need} gate anchor(s) (the reservation and the plan check, or the device key read); it has ${gates.length}`);
  for (const g of gates) {
    const text = read(g?.file ?? '');
    if (text === null) problems.push(`${where} P2 gate file ${g?.file} does not exist`);
    else if (typeof g.anchor !== 'string' || g.anchor.length < 8) problems.push(`${where} P2 gate anchor in ${g.file} is missing or too short to mean anything`);
    else if (!text.includes(g.anchor)) problems.push(`${where} P2 gate anchor ${JSON.stringify(g.anchor)} is gone from ${normRel(g.file)} — ${g.why ?? 'the gate'} no longer stands there`);
    else problems.push(...gateBodyProblems(where, g, text));
  }

  if (row.kind === 'ai-inference') {
    const d = row.disclosure;
    const keys = Array.isArray(d?.keys) ? d.keys : [];
    if (!d || typeof d.arb !== 'string' || keys.length === 0) problems.push(`${where} P3 an ai-inference row names its disclosure: an ARB and at least one string key`);
    else {
      const arbText = read(d.arb);
      let arb = null;
      try {
        arb = arbText === null ? null : JSON.parse(arbText);
      } catch {
        arb = null;
      }
      if (arb === null) problems.push(`${where} P3 disclosure ARB ${d.arb} is missing or not JSON`);
      else for (const k of keys) if (typeof k !== 'string' || k.startsWith('@') || !Object.hasOwn(arb, k)) problems.push(`${where} P3 disclosure string key ${JSON.stringify(k)} does not exist in ${normRel(d.arb)}`);
    }
    const markers = Array.isArray(row.marker) ? row.marker : [];
    if (markers.length === 0) problems.push(`${where} P3 an ai-inference row names its output marker field(s) (Art. 50(2))`);
    for (const m of markers) {
      const text = read(m?.file ?? '');
      if (text === null) problems.push(`${where} P3 marker file ${m?.file} does not exist`);
      else if (typeof m.field !== 'string' || m.field.length < 4 || !text.includes(m.field)) problems.push(`${where} P3 marker ${JSON.stringify(m?.field)} is not in ${normRel(m.file)}`);
    }
  }
}

// ── P4: coverage — every caller in the tree has a row ────────────────────────
function* walk(dir) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      yield* walk(join(dir, e.name));
    } else if (e.isFile() && SOURCE_EXT.test(e.name) && !isTestFile(e.name)) {
      yield join(dir, e.name);
    }
  }
}

let found = 0;
for (const root of scanRoots) {
  for (const abs of walk(join(repoRoot, ...String(root).split('/')))) {
    const text = readFileSync(abs, 'utf8');
    const r = rel(abs);
    for (const [host, needles] of Object.entries(hosts)) {
      if (!needles.some((n) => text.includes(n))) continue;
      found++;
      if (!callersByHost.get(host)?.has(r)) problems.push(`P4 ${r} names ${host} and no row of ${rel(REGISTER)} lists it as a caller — every paid call needs a row (who pays, what gates it)`);
    }
  }
}
if (found === 0) coverageLost(`the scan of ${scanRoots.join(', ')} found no caller of any declared host: a scan that sees nothing proves nothing.`);

if (problems.length) {
  console.error(`✗ paid calls — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`✓ paid calls — ${rows.length} row(s), ${found} caller reference(s) in the tree, every one customer-paid, gated, disclosed and marked.`);
