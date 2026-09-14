#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-hyperdrive-cap.mjs — a Worker may not bind a Hyperdrive configuration
// whose origin connection cap is undeclared, and the declared caps may not add
// up to more connections than the origin Postgres has free.
//
// Register row: O-HYPERDRIVE-COLLISION (the guard leg). The declarations live in
// tooling/ops/hyperdrive.json, which carries the origin numbers and why.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// 🔴 Each Hyperdrive configuration opens its own pool to the origin, the limit is
// SOFT, and nothing sets it by default — so an uncapped configuration may take up
// to the plan ceiling (~100 on paid) against a Box A that the register row
// records at max_connections 100, 3 reserved, 25 in use: 72 free. The collision
// is silent until a table lands and traffic arrives, and then it is Postgres
// refusing connections for the whole identity stack at once.
// MEASURED 2026-09-14: `git grep -nliE "hyperdrive|max_connections"` -> zero
// files. Nothing uses Hyperdrive yet, which is exactly when the rule is free.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   C1 every `hyperdrive` binding in a wrangler config under services/ (top level
//      and every `env.<name>` block) and in the brick's backend template has a
//      row in tooling/ops/hyperdrive.json, matched on service + binding, with a
//      positive integer `originConnectionLimit`
//   C2 the declared caps sum to no more than `origin.budget`, and `budget` is
//      maxConnections - reserved - inUse (a budget typed by hand drifts)
//   C3 every `wrangler hyperdrive create|update` written in tooling/, services/
//      or docs/ passes `--origin-connection-limit`
//   C4 no row describes a binding that no longer exists (a stale row is budget
//      held for nothing, and a row nobody reads is a register nobody checks)
//
// Usage:  node tooling/ci/assert-hyperdrive-cap.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER = 'tooling/ops/hyperdrive.json';
const BRICK_WRANGLER = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/wrangler.jsonc';
const COMMAND_ROOTS = ['tooling', 'services', 'docs'];
const TEXT = /\.(mjs|cjs|js|ts|jsonc|json|toml|md|ya?ml|sh|ps1)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.dart_tool', '.wrangler', 'test', 'fixtures']);

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

/** JSONC -> value. Comments stripped string-aware, trailing commas removed. */
function parseJsonc(text, where) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += c2 ?? ''; i++; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  // The brick template is mustache: a `{{...}}` outside a string is not JSON.
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (e) {
    coverageLost([`${where} could not be parsed after stripping comments — ${e.message}`]);
  }
}

// ── the register ─────────────────────────────────────────────────────────────
const regAbs = join(ROOT, REGISTER);
if (!existsSync(regAbs)) coverageLost([`${REGISTER} does not exist, so no cap can be declared and every binding would be judged against nothing.`]);
let reg;
try {
  reg = JSON.parse(readFileSync(regAbs, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const problems = [];
const o = reg.origin ?? {};
for (const k of ['maxConnections', 'reserved', 'inUse', 'budget']) {
  if (!Number.isInteger(o[k]) || o[k] < 0) coverageLost([`${REGISTER} origin.${k} is ${JSON.stringify(o[k] ?? null)}, not a non-negative integer. The budget is the right-hand side of C2.`]);
}
if (typeof o.verify !== 'string' || o.verify.trim() === '' || typeof o.asOf !== 'string' || o.asOf.trim() === '') {
  coverageLost([`${REGISTER} origin carries no \`asOf\` + \`verify\`. A connection budget nobody can re-derive is somebody's memory.`]);
}
if (o.budget !== o.maxConnections - o.reserved - o.inUse) {
  problems.push(`C2 ${REGISTER} origin.budget is ${o.budget}, but maxConnections ${o.maxConnections} - reserved ${o.reserved} - inUse ${o.inUse} = ${o.maxConnections - o.reserved - o.inUse}.`);
}
if (!Array.isArray(reg.configs)) coverageLost([`${REGISTER} has no \`configs\` array.`]);

// ── the bindings ─────────────────────────────────────────────────────────────
const configs = [];
const servicesAbs = join(ROOT, 'services');
if (!existsSync(servicesAbs)) coverageLost([`services/ does not exist under ${ROOT}. The scan is broken, not the tree.`]);
for (const e of listDir(servicesAbs, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const f of ['wrangler.jsonc', 'wrangler.json']) {
    const p = join(servicesAbs, e.name, f);
    if (existsSync(p)) { configs.push({ service: e.name, abs: p }); break; }
  }
}
if (configs.length === 0) coverageLost(['found ZERO wrangler configs under services/. A scan over nothing would pass every binding it never saw.']);
const brickAbs = join(ROOT, BRICK_WRANGLER);
if (!existsSync(brickAbs)) coverageLost([`${BRICK_WRANGLER} does not exist; every stamped backend inherits its bindings, so it must be read.`]);
configs.push({ service: '{{app_id}}-api', abs: brickAbs, brick: true });

const bindings = [];
for (const c of configs) {
  const where = rel(c.abs);
  const text = readFileSync(c.abs, 'utf8');
  if (!/hyperdrive/i.test(text)) continue;
  const cfg = parseJsonc(c.brick ? text.replace(/\{\{[^}]*\}\}/g, 'x') : text, where);
  const blocks = [['', cfg], ...Object.entries(cfg.env ?? {}).map(([k, v]) => [`env.${k}.`, v])];
  for (const [prefix, block] of blocks) {
    for (const b of block?.hyperdrive ?? []) bindings.push({ service: c.service, binding: b.binding, where: `${where} → ${prefix}hyperdrive[${b.binding}]` });
  }
}

let sum = 0;
const matched = new Set();
for (const b of bindings) {
  const row = reg.configs.find((r) => r.service === b.service && r.binding === b.binding);
  if (!row) {
    problems.push(`C1 ${b.where} has NO row in ${REGISTER}. Declare its originConnectionLimit there, sized against origin.budget ${o.budget}, before it deploys: an uncapped Hyperdrive configuration may open up to the plan ceiling (~100) against ${o.budget} free.`);
    continue;
  }
  matched.add(row);
  if (!Number.isInteger(row.originConnectionLimit) || row.originConnectionLimit <= 0) {
    problems.push(`C1 ${b.where} — its row's originConnectionLimit is ${JSON.stringify(row.originConnectionLimit ?? null)}, not a positive integer.`);
  }
}
for (const row of reg.configs) {
  if (Number.isInteger(row.originConnectionLimit) && row.originConnectionLimit > 0) sum += row.originConnectionLimit;
  if (!matched.has(row)) problems.push(`C4 ${REGISTER} declares ${row.service ?? '?'} → ${row.binding ?? '?'}, and no wrangler config binds it.`);
}
if (sum > o.budget) {
  problems.push(`C2 the declared originConnectionLimit values sum to ${sum}, over origin.budget ${o.budget}. Postgres refuses the overflow for every client at once.`);
}

// ── C3 provisioning commands ─────────────────────────────────────────────────
let commands = 0;
const walk = (abs) => {
  for (const e of listDir(abs, { withFileTypes: true })) {
    const p = join(abs, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p);
    } else if (TEXT.test(e.name) && p !== join(ROOT, 'tooling', 'ci', 'assert-hyperdrive-cap.mjs')) {
      const text = readFileSync(p, 'utf8');
      if (!/hyperdrive/i.test(text)) continue;
      text.split('\n').forEach((line, i) => {
        if (/wrangler\s+hyperdrive\s+(create|update)\b/.test(line)) {
          commands++;
          if (!/--origin-connection-limit/.test(line)) {
            problems.push(`C3 ${rel(p)}:${i + 1} runs \`wrangler hyperdrive ${line.match(/(create|update)/)[1]}\` without --origin-connection-limit.`);
          }
        }
      });
    }
  }
};
for (const r of COMMAND_ROOTS) if (existsSync(join(ROOT, r))) walk(join(ROOT, r));

if (problems.length) {
  console.error(`✗ hyperdrive cap — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  O-HYPERDRIVE-COLLISION: a Hyperdrive configuration is capped, and the caps fit the origin.');
  process.exit(1);
}
console.log(
  `ok  hyperdrive cap — ${configs.length} wrangler config(s) read (brick included), ${bindings.length} Hyperdrive binding(s), ` +
    `${commands} provisioning command(s); declared caps ${sum} of origin budget ${o.budget} ` +
    `(${o.maxConnections} max - ${o.reserved} reserved - ${o.inUse} in use, ${o.asOf})`,
);
