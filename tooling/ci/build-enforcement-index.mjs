#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-enforcement-index.mjs — THE GENERATOR for tooling/enforcement-index.json.
//
// Pipeline requirement: Private/requirements/ → F-10.
//
// One row per ENFORCER. The requirement ids and the things that satisfy them
// both already exist and neither moves; what did not exist is the JOIN, and a
// join nobody generates is a join somebody maintains by hand.
//
// ── TWO COLUMNS, BECAUSE THERE ARE TWO QUESTIONS ─────────────────────────────
// `kind` answers WHAT enforces — guard | script | lane | human | test |
// cross-repo | none. `state` answers WHETHER CI REACHES IT — WIRED | IMPORTED |
// LIBRARY | NOT-CI-RUNNABLE | HELD | ORPHAN.
//
// `kind` guard|lane|human is NOT invented here. tooling/dod-register.json
// already carries exactly that closed set, and tooling/ci/assert-app-dod.mjs
// FAILS on a fourth value. The lane and human rows are READ OUT of that
// register, so the two documents cannot drift.
//
// Usage:  node tooling/ci/build-enforcement-index.mjs [repoRoot] [--write]
// Exit 0 = an index was produced over a non-empty enforcer set.
//      1 = COVERAGE LOST, or a problem that makes the index untrustworthy.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listDir } from './tree-walk.mjs';
import { parseAllWorkflows, WORKFLOW_DIR } from './workflow-scan.mjs';

export const INDEX_REL = 'tooling/enforcement-index.json';
export const KINDS = new Set(['guard', 'script', 'lane', 'human', 'test', 'cross-repo', 'none']);
export const STATES = new Set(['WIRED', 'IMPORTED', 'LIBRARY', 'NOT-CI-RUNNABLE', 'HELD', 'ORPHAN']);

const CI_REL = 'tooling/ci';
const DOD_REL = 'tooling/dod-register.json';
const HEADER_LINES = 60;

export class CoverageLost extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
    this.name = 'COVERAGE LOST';
  }
}
const lose = (lines) => {
  throw new CoverageLost(lines);
};

const ID = '[A-Z]{1,3}-\\d{1,3}[a-z]?';
const ID_HEAD = new RegExp(`^(${ID})`);
const ID_ONLY = new RegExp(`^${ID}$`);
const RUN_ANCHOR = /\[(?:pipeline|plan)\b\s*(?:\d{1,2}\]\s*)?/g;
const RUN_SEP = /^[\s·,)(\]\[/]*(?:and|clauses?|clause|limbs?|limb|second|first|\d+)?[\s·,)(\]\[/]*/;
const RUN_GLOSS = /^\s*\([^)]*\)/;
const STAGE_CITE = new RegExp(`\\[(?:\\d{1,2})\\]\\s*(${ID})`, 'g');
const BARE_CITE = new RegExp(`\\[(${ID})\\]`, 'g');
const ADR_CITE = /\[ADR[\s-](\d{1,3})\]/g;
const PROSE_DECL = new RegExp(`Pipeline requirement[^\\n]*?\\u2192\\s*((?:${ID})(?:\\s*(?:,|and)?\\s*(?:${ID}))*)`, 'g');

const DENY_PREFIX = new Set(['SHA', 'UTF', 'RFC', 'ISO', 'HTTP', 'TLS', 'API', 'URL', 'CRC', 'INV', 'CFG', 'PR', 'ADR']);
const admissible = (id) => !DENY_PREFIX.has(id.split('-')[0]);

const isHeaderComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#!');
};
const stripCommentPrefix = (line) => line.replace(/^\s*(?:\/\/+|\/\*+|\*+)\s?/, '');

const idRun = (text, from, into) => {
  let rest = text.slice(from);
  for (let i = 0; i < 12; i++) {
    const sep = RUN_SEP.exec(rest);
    if (sep && sep[0].length) rest = rest.slice(sep[0].length);
    const hit = ID_HEAD.exec(rest);
    if (!hit) return;
    if (admissible(hit[1])) into.add(hit[1]);
    rest = rest.slice(hit[1].length);
    const gloss = RUN_GLOSS.exec(rest);
    if (gloss) rest = rest.slice(gloss[0].length);
  }
};

export const readCitations = (source, selfName, siblingNames) => {
  const lines = source.split(/\r?\n/).slice(0, HEADER_LINES);
  const claims = new Set();
  const references = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isHeaderComment(line)) continue;
    const named = (line.match(/[A-Za-z0-9._-]+\.mjs/g) ?? []).filter((n) => n !== selfName && siblingNames.has(n));
    const sink = named.length > 0 ? references : claims;

    PROSE_DECL.lastIndex = 0;
    for (let m = PROSE_DECL.exec(line); m; m = PROSE_DECL.exec(line)) {
      for (const raw of m[1].split(/[\s,]+|and/)) {
        const id = raw.trim();
        if (id && ID_ONLY.test(id) && admissible(id)) sink.add(id);
      }
    }
    RUN_ANCHOR.lastIndex = 0;
    for (let m = RUN_ANCHOR.exec(line); m; m = RUN_ANCHOR.exec(line)) {
      idRun(line, m.index + m[0].length, sink);
      if (/[·,/]\s*$/.test(line) && i + 1 < lines.length && isHeaderComment(lines[i + 1])) {
        idRun(stripCommentPrefix(lines[i + 1]), 0, sink);
      }
    }
    for (const re of [STAGE_CITE, BARE_CITE]) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) if (admissible(m[1])) sink.add(m[1]);
    }
    ADR_CITE.lastIndex = 0;
    for (let m = ADR_CITE.exec(line); m; m = ADR_CITE.exec(line)) sink.add(`ADR ${m[1].padStart(3, '0')}`);
  }
  for (const c of claims) references.delete(c);
  return { claims: [...claims].sort(), references: [...references].sort() };
};

const canaries = () => {
  const sib = new Set(['assert-other.mjs']);
  const c = (src) => readCitations(src, 'self.mjs', sib);
  const comment = c('// [pipeline 10]D-4 · D-5 — the claim\n');
  const literal = c("console.error('  [pipeline 10]D-4 · D-5');\n");
  const deny = c('// [pipeline SHA-256 · UTF-8] · [INV-505] · [10]CFG-1 · [ADR-15]\n');
  const prose = c('// Pipeline requirement: Private/requirements/ → F-8.\n');
  const attrib = c('//   · [3]S-7a  assert-other.mjs — CATALOGUE REACHABILITY\n');
  const bad = [];
  if (comment.claims.join(',') !== 'D-4,D-5') bad.push(`a bracket citation in a comment read as [${comment.claims}] (must be D-4,D-5)`);
  if (literal.claims.length || literal.references.length) bad.push(`the SAME citation inside a string literal read as [${literal.claims}] (must be empty)`);
  if (deny.claims.join(',') !== 'ADR 015') bad.push(`SHA-256 / UTF-8 / INV-505 / CFG-1 / [ADR-15] in claim position read as [${deny.claims}] (must be ADR 015 alone)`);
  if (prose.claims.join(',') !== 'F-8') bad.push(`the prose declaration form read as [${prose.claims}] (must be F-8)`);
  if (attrib.claims.length || attrib.references.join(',') !== 'S-7a') bad.push(`a routing-table line crediting another guard read as claims [${attrib.claims}] / references [${attrib.references}] (must be [] / S-7a)`);
  if (bad.length) lose(['the citation reader no longer reads what it is documented to read.', ...bad]);
};

const read = (abs, rel) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    lose([`${rel} could not be read (${e.message}).`]);
  }
};

export async function buildEnforcementIndex(root, opts = {}) {
  const ROOT = resolve(root);
  const realRepo = opts.realRepo === true;
  const notes = [];
  canaries();

  const CI = join(ROOT, 'tooling', 'ci');
  const TESTS = join(CI, 'test');
  const WF = join(ROOT, WORKFLOW_DIR);

  if (!existsSync(CI)) lose([`${CI_REL} does not exist under ${ROOT}, so the enforcer set is derived from nothing.`]);
  const guards = listDir(CI).filter((f) => f.endsWith('.mjs')).sort();
  if (guards.length === 0) lose([`${CI_REL} holds ZERO .mjs file, so the index would have no rows.`]);
  const guardSet = new Set(guards);

  const stray = [];
  const findStray = (dir, rel) => {
    for (const e of listDir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) findStray(join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.mjs')) stray.push(`${rel}${e.name}`);
    }
  };
  for (const e of listDir(CI, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== 'test') findStray(join(CI, e.name), `${e.name}/`);
  }
  if (stray.length) lose([`${stray.length} .mjs file(s) sit in subdirectories of ${CI_REL} this FLAT scan does not reach:`, ...stray]);
  if (!existsSync(TESTS)) lose([`${CI_REL}/test does not exist, so the TEST state cannot be computed.`]);
  if (!existsSync(WF)) lose([`${WORKFLOW_DIR} does not exist, so every row's invokedBy would be empty.`]);

  const workflows = parseAllWorkflows(ROOT);
  if (workflows.length === 0) lose([`${WORKFLOW_DIR} holds no readable workflow. Every enforcer would read ORPHAN.`]);

  if (realRepo) {
    const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', WORKFLOW_DIR], { encoding: 'utf8' });
    const tracked = ls.status === 0 ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)))] : [];
    if (tracked.length === 0) lose([`git ls-files -- ${WORKFLOW_DIR} returned no tracked workflow on the real repository.`]);
    const seen = new Set(workflows.map((w) => w.rel));
    const unseen = tracked.filter((t) => !seen.has(t)).sort();
    if (unseen.length) lose([`git tracks ${tracked.length} workflow(s) and this scan read ${seen.size}; it never saw: ${unseen.join(', ')}.`]);
  }

  const invokedBy = new Map();
  const nested = [];
  const notFound = new Set();
  const addEdge = (key, edge) => {
    if (!invokedBy.has(key)) invokedBy.set(key, new Set());
    invokedBy.get(key).add(edge);
  };
  let testRunnerJobs = [];
  for (const wf of workflows) {
    for (const job of wf.jobs.values()) {
      const edge = `${wf.rel}#${job.name}`;
      for (const l of job.logical) {
        const text = l.text ?? '';
        for (const m of text.matchAll(/\btooling\/([A-Za-z0-9._/-]+\.mjs)/g)) {
          const rel = `tooling/${m[1]}`;
          if (rel.startsWith('tooling/ci/')) {
            const tail = rel.slice('tooling/ci/'.length);
            if (tail.includes('/')) { nested.push(`${edge} → ${rel}`); continue; }
            if (!guardSet.has(tail)) { notFound.add(`${edge} → ${rel}`); continue; }
            addEdge(rel, edge);
          } else {
            addEdge(rel, edge);
          }
        }
        if (/\bnode\b[^\n]*--test\b[^\n]*tooling\/ci\/test\//.test(text)) testRunnerJobs.push(edge);
      }
    }
  }
  testRunnerJobs = [...new Set(testRunnerJobs)].sort();
  if (nested.length) lose([`${nested.length} workflow step(s) invoke a ${CI_REL} path this FLAT scan cannot index:`, ...nested]);
  for (const n of [...notFound].sort()) notes.push(`a workflow names a ${CI_REL} file that is not on disk, so it has no row: ${n}`);
  if (testRunnerJobs.length === 0) notes.push(`no workflow job runs node --test over ${CI_REL}/test, so no enforcer can reach the TEST state.`);

  const codeOf = (text) =>
    text.split('\n').filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    }).join('\n');
  const sources = new Map(guards.map((g) => [g, read(join(CI, g), `${CI_REL}/${g}`)]));
  const importsOf = (file) => {
    const src = codeOf(sources.get(file));
    const out = new Set();
    for (const m of src.matchAll(/from\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g)) out.add(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]\s*\)/g)) out.add(m[1]);
    return [...out];
  };
  const importers = new Map(guards.map((g) => [g, new Set()]));
  for (const g of guards) for (const d of importsOf(g)) if (guardSet.has(d)) importers.get(d).add(g);

  const reached = new Set(guards.filter((g) => invokedBy.has(`${CI_REL}/${g}`)));
  for (const queue = [...reached]; queue.length > 0; ) {
    for (const dep of importsOf(queue.pop())) {
      if (guardSet.has(dep) && !reached.has(dep)) { reached.add(dep); queue.push(dep); }
    }
  }

  const testFiles = listDir(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();
  const testCorpus = codeOf(testFiles.map((f) => read(join(TESTS, f), `${CI_REL}/test/${f}`)).join('\n'));

  const COVERAGE_GUARD = 'assert-guard-coverage.mjs';
  const readNotCiRunnable = () => {
    if (!guardSet.has(COVERAGE_GUARD)) return null;
    const lines = sources.get(COVERAGE_GUARD).split('\n');
    const start = lines.findIndex((l) => /^const NOT_CI_RUNNABLE = new Map\(\[/.test(l));
    if (start === -1) return null;
    const end = lines.findIndex((l, i) => i > start && /^\]\);/.test(l));
    if (end === -1) return null;
    const names = new Set();
    for (const l of lines.slice(start + 1, end)) {
      const m = /^\s*(?:\[\s*)?'([A-Za-z0-9._-]+\.mjs)',?\s*$/.exec(l);
      if (m) names.add(m[1]);
    }
    return names;
  };
  const notCiRunnable = readNotCiRunnable();
  if (notCiRunnable === null || notCiRunnable.size === 0) {
    lose([`${CI_REL}/${COVERAGE_GUARD}'s NOT_CI_RUNNABLE declaration could not be read (${notCiRunnable === null ? 'absent' : 'parsed to ZERO names'}).`]);
  }
  for (const n of [...notCiRunnable].sort()) {
    if (!guardSet.has(n)) notes.push(`${COVERAGE_GUARD} exempts ${CI_REL}/${n} and ${CI_REL} no longer holds it.`);
  }

  const hasMain = (src) => /process\.(exit|argv)/.test(codeOf(src));
  const stateOfGuard = (g) => {
    if (invokedBy.has(`${CI_REL}/${g}`)) return 'WIRED';
    if (reached.has(g)) return importers.get(g).size > 0 && !hasMain(sources.get(g)) ? 'LIBRARY' : 'IMPORTED';
    if (notCiRunnable.has(g)) return 'NOT-CI-RUNNABLE';
    if (testRunnerJobs.length > 0 && testCorpus.includes(g)) return 'TEST';
    return 'ORPHAN';
  };

  const rows = [];
  for (const g of guards) {
    const { claims, references } = readCitations(sources.get(g), g, guardSet);
    const state = stateOfGuard(g);
    rows.push({
      claims,
      invokedBy: [...(invokedBy.get(`${CI_REL}/${g}`) ?? [])].sort(),
      kind: state === 'TEST' ? 'test' : 'guard',
      ref: `${CI_REL}/${g}`,
      references,
      state: state === 'TEST' ? 'WIRED' : state,
      ...(state === 'TEST' ? { reachedBy: testRunnerJobs } : {}),
    });
  }

  // Executables a workflow runs that do NOT live in tooling/ci. Excluding them
  // publishes a join in which every enforcer happens to sit in one directory —
  // the filing accident assert-guard-coverage.mjs records as having once
  // decided what got covered.
  //
  // A named path that is NOT on disk gets a NOTE, never a row. The row would
  // assert that an enforcer exists, which is the one thing the tree contradicts,
  // and INVOKED ⊆ FOUND is assert-guard-coverage.mjs's identity to fail on —
  // two guards failing on one fact teaches people to read neither.
  for (const [ref, edges] of [...invokedBy].sort()) {
    if (ref.startsWith(`${CI_REL}/`)) continue;
    if (!existsSync(join(ROOT, ref))) {
      notes.push(`a workflow invokes ${ref}, which is not on disk, so it has no row: ${[...edges].sort().join(', ')}`);
      continue;
    }
    rows.push({
      claims: readCitations(read(join(ROOT, ref), ref), ref.split('/').pop(), new Set()).claims,
      invokedBy: [...edges].sort(),
      kind: 'script',
      ref,
      references: [],
      state: 'WIRED',
    });
  }

  const dodAbs = join(ROOT, DOD_REL);
  if (!existsSync(dodAbs)) lose([`${DOD_REL} does not exist, so no LANE or HUMAN enforcer can be read.`]);
  let dod;
  try {
    dod = JSON.parse(readFileSync(dodAbs, 'utf8'));
  } catch (e) {
    lose([`${DOD_REL} is not valid JSON (${e.message}), so the LANE and HUMAN rows cannot be derived.`]);
  }
  const dodItems = Array.isArray(dod.items) ? dod.items : [];
  const humanRows = Array.isArray(dod.humanReviewRows) ? dod.humanReviewRows : [];
  if (dodItems.length === 0) lose([`${DOD_REL} declares no items, so the lane and human halves would be empty.`]);
  const jobIndex = new Map();
  for (const wf of workflows) for (const j of wf.jobs.keys()) jobIndex.set(j, `${wf.rel}#${j}`);

  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const dodClaims = new Map();
  for (const item of dodItems) {
    if (!['guard', 'lane', 'human'].includes(item.enforcedBy)) {
      lose([`${DOD_REL} item ${item.id} has enforcedBy "${item.enforcedBy}", outside the closed set guard | lane | human.`]);
    }
    const claim = `DoD ${item.id}`;
    if (item.enforcedBy === 'guard') {
      const ref = `${CI_REL}/${item.check}`;
      if (!byRef.has(ref)) lose([`${DOD_REL} item ${item.id} names guard "${item.check}", which is not a depth-1 enforcer in ${CI_REL}.`]);
      dodClaims.set(ref, [...(dodClaims.get(ref) ?? []), claim]);
      continue;
    }
    if (item.enforcedBy === 'lane') {
      const edge = jobIndex.get(item.check);
      if (!edge) lose([`${DOD_REL} item ${item.id} is enforced by LANE "${item.check}" and no workflow declares a job of that name.`]);
      const existing = rows.find((r) => r.kind === 'lane' && r.ref === edge);
      if (existing) existing.claims = [...new Set([...existing.claims, claim])].sort();
      else rows.push({ claims: [claim], invokedBy: [edge], kind: 'lane', ref: edge, references: [], state: 'WIRED' });
      continue;
    }
    if (!humanRows.includes(item.check)) {
      lose([`${DOD_REL} item ${item.id} is enforced by HUMAN "${item.check}", not one of its own humanReviewRows [${humanRows.join(', ')}].`]);
    }
    const href = `${DOD_REL}#${item.check}`;
    const existing = rows.find((r) => r.kind === 'human' && r.ref === href);
    if (existing) existing.claims = [...new Set([...existing.claims, claim])].sort();
    else rows.push({ claims: [claim], invokedBy: [], kind: 'human', ref: href, references: [], state: 'HELD' });
  }
  for (const [ref, cs] of dodClaims) {
    const r = byRef.get(ref);
    r.claims = [...new Set([...r.claims, ...cs])].sort();
  }

  rows.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  const EMITTED = /^(?:[A-Z]{1,3}-\d{1,3}[a-z]?|ADR \d{3}|DoD [A-Z0-9-]+)$/;
  const problems = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.ref)) problems.push(`two rows carry ref "${r.ref}" — the index is one row per ENFORCER.`);
    seen.add(r.ref);
    if (!KINDS.has(r.kind)) problems.push(`${r.ref} — kind "${r.kind}" is outside the declared vocabulary.`);
    if (!STATES.has(r.state)) problems.push(`${r.ref} — state "${r.state}" is outside the declared vocabulary.`);
    for (const c of [...r.claims, ...r.references]) {
      if (!EMITTED.test(c)) problems.push(`${r.ref} — emitted key "${c}" cannot be joined on.`);
    }
  }
  if (rows.filter((r) => r.claims.length > 0).length === 0) lose([`not one of ${rows.length} enforcer(s) carries a citation.`]);
  if (!rows.some((r) => r.kind === 'lane') || !rows.some((r) => r.kind === 'human')) {
    lose(['the index carries no LANE row or no HUMAN row — the collapse to {guard, none}.']);
  }
  if (!rows.some((r) => r.kind === 'cross-repo')) {
    notes.push('no row carries kind cross-repo: no workflow in this repository invokes across a repository boundary.');
  }
  return { rows, notes, problems, meta: { guards: guards.length, workflows: workflows.length, testFiles: testFiles.length, testRunnerJobs } };
}

export const serialiseIndex = (doc) => `${JSON.stringify(doc.rows, null, 2)}\n`;

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const WRITE = argv.includes('--write');
  const POSITIONAL = argv.find((a) => !a.startsWith('--'));
  const ROOT = resolve(POSITIONAL ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  try {
    const doc = await buildEnforcementIndex(ROOT, { realRepo: POSITIONAL === undefined });
    const text = serialiseIndex(doc);
    if (doc.problems.length) {
      console.error(`✗ enforcement index — ${doc.problems.length} problem(s):`);
      for (const p of doc.problems) console.error(`    ${p}`);
      process.exit(1);
    }
    if (WRITE) writeFileSync(join(ROOT, INDEX_REL), text);
    else process.stdout.write(text);
    const tally = new Map();
    for (const r of doc.rows) tally.set(`${r.kind}/${r.state}`, (tally.get(`${r.kind}/${r.state}`) ?? 0) + 1);
    if (doc.notes.length) {
      console.error('⬜ notes, printed not hidden:');
      for (const n of doc.notes) console.error(`    ${n}`);
    }
    console.error(
      `ok  enforcement index — ${doc.rows.length} enforcer(s) [` +
        [...tally.entries()].sort().map(([k, n]) => `${n} ${k}`).join(', ') +
        `]; ${doc.rows.filter((r) => r.claims.length).length} carry a claim; ${doc.meta.workflows} workflow(s), ` +
        `${doc.meta.testFiles} test file(s); ${WRITE ? `written to ${INDEX_REL}` : 'printed, nothing written'}`,
    );
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.lines[0]}`);
      for (const l of e.lines.slice(1)) console.error(`  ${l}`);
      process.exit(1);
    }
    throw e;
  }
}
