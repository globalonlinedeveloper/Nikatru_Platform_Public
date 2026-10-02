#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-worker-secrets-declared.mjs — EVERY SECRET A WORKER READS IS A ROW OF
// tooling/worker-secrets.json, the one manifest tooling/ops/worker-secrets.mjs
// syncs from the vault (owner lock 2026-10-01: every Worker secret comes from
// the pipeline, and is portable, so a key can be rotated by editing the vault
// and running one command). The manifest carries NAMES ONLY.
//
// Before it, Worker secrets were set by hand or by ad-hoc lead scripts, and
// nothing listed them: a secret read by `env[name]` (the store receipt
// verifiers' credentialEnvVars, the MoR verifiers' secretEnvVar) was in no
// `interface Env` at all, so no reader could say which keys a rotation touches.
//
// THE LIMBS, each with its red control in test/worker-secrets-declared.test.mjs:
//   A reads     every secret a Worker reads has a row for that Worker's script:
//               an `interface Env` member typed `string` in services/<w>/src/
//               types.ts that is no `vars` key of its wrangler.jsonc and no
//               deploy-time `--var NAME:` of a workflow; every `secretEnvVar:`
//               and `credentialEnvVars:` literal in its comment-stripped src;
//               and every wrangler `secrets.required` name. The reverse too: a
//               row naming a secret its Worker does not read is stale.
//   B consumers every row names at least one consumer file; each exists and
//               names the secret in comment-stripped source.
//   C values    the manifest holds no value: no secret-shaped string (the
//               detector assert-ports.mjs limb 1 uses), and no row key outside
//               the declared set (a `value`, `hash` or `length` is refused).
//   D ports     when tooling/ports/ exists, a row's `port` and `adapter` are
//               both null or name a registry and one of its adapter ids.
//   E workers   a row's `worker` is a wrangler script: a services/<w> `name`,
//               or `<name>-sandbox` where that config declares env.sandbox.
//   F unique    (worker, secret) appears once.
//   G shape     `kind` is generated|vendor|config, `setBy` vault|deploy and
//               `replace` never|explicit (TOKEN_ENC_KEY_* always never: a key that
//               seals stored data is never overwritten live, #1135 review); a
//               `generated` row, and only one, declares `generate` (>= 32
//               bytes, base64 or hex); a `deploy` row is carried by
//               .github/workflows/deploy-workers.yml as `secrets.<NAME>`.
//
// LANE-BOUND: deploy-workers.yml — the one workflow that carries a Worker secret at deploy time
// (the platform job's --secrets-file), so a `setBy: deploy` row is checked against it and no other.
//
// Exit 0 green, 1 a finding, 2 COVERAGE LOST: the manifest is absent,
// unparseable or empty, or no Worker yielded a single read. The FIRST line names
// the deciding limb. Usage: node tooling/ci/assert-worker-secrets-declared.mjs [root]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { forbiddenValues } from './assert-ports.mjs';
import { parseAllWorkflows } from './workflow-scan.mjs';

export const MANIFEST = 'tooling/worker-secrets.json';
export const PORTS_DIR = 'tooling/ports';
export const DEPLOY_WORKFLOW = '.github/workflows/deploy-workers.yml';
export const KINDS = Object.freeze(['generated', 'vendor', 'config']);
export const SET_BY = Object.freeze(['vault', 'deploy']);
export const ROW_KEYS = Object.freeze(['worker', 'secret', 'vaultKey', 'setBy', 'replace', 'kind', 'port', 'adapter', 'generate', 'purpose', 'rotation', 'consumers']);
export const REPLACE = Object.freeze(['never', 'explicit']);
/** Keys that seal or sign STORED data: overwritten live, every sealed row stops opening. Always `never`. */
export const SEALS_STORED_DATA = /^TOKEN_ENC_KEY_/;
const NAME = /^[A-Z][A-Z0-9_]*$/;
const VAULT_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** JSONC text → object: comments stripped (string-aware), trailing commas dropped. */
export function parseJsonc(text) {
  return JSON.parse(stripSourceComments(text, '.jsonc').replace(/,(\s*[}\]])/g, '$1'));
}

/** Every `.ts` under `dir` that is not a test, relative to `root`. */
function tsFiles(root, rel) {
  const out = [];
  let entries = [];
  try { entries = listDir(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...tsFiles(root, r)); }
    else if (e.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(r);
  }
  return out;
}

/** Each workflow's comment-blanked text, read through workflow-scan.mjs (the one workflow reader). */
export const workflowTexts = (root) => new Map(parseAllWorkflows(root).map((w) => [w.rel, w.lines.map((l) => l.text).join('\n')]));

/** The names every deploy workflow passes as `--var NAME:`: set at deploy time, never secrets. */
export function deployVars(root, texts = workflowTexts(root)) {
  const out = new Set();
  for (const text of texts.values()) for (const m of text.matchAll(/--var\s+([A-Z][A-Z0-9_]*):/g)) out.add(m[1]);
  return out;
}

/** Each Worker: its script names and the secret names it reads, with where each was read. */
export function readWorkers(root) {
  const workers = [];
  let dirs = [];
  try { dirs = listDir(join(root, 'services'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* lost below */ }
  const dvars = deployVars(root);
  for (const d of dirs.sort()) {
    const cfgRel = `services/${d}/wrangler.jsonc`;
    if (!existsSync(join(root, cfgRel))) continue;
    let cfg;
    try { cfg = parseJsonc(readFileSync(join(root, cfgRel), 'utf8')); } catch (e) { workers.push({ dir: d, error: `${cfgRel} could not be parsed (${e.message})` }); continue; }
    const name = typeof cfg?.name === 'string' ? cfg.name : null;
    if (!name) { workers.push({ dir: d, error: `${cfgRel} declares no top-level "name"` }); continue; }
    const blocks = [cfg, ...Object.values(isObj(cfg.env) ? cfg.env : {})].filter(isObj);
    const vars = new Set(blocks.flatMap((b) => Object.keys(isObj(b.vars) ? b.vars : {})));
    const reads = new Map(); // name → Set(where)
    const add = (n, where) => { if (!reads.has(n)) reads.set(n, new Set()); reads.get(n).add(where); };
    for (const b of blocks) for (const n of b?.secrets?.required ?? []) if (typeof n === 'string') add(n, `${cfgRel} secrets.required`);
    const typesRel = `services/${d}/src/types.ts`;
    if (existsSync(join(root, typesRel))) {
      const src = stripSourceComments(readFileSync(join(root, typesRel), 'utf8'), '.ts');
      const block = src.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
      for (const m of block?.[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*\??\s*:\s*string\s*;/gm) ?? []) {
        if (vars.has(m[1]) || dvars.has(m[1])) continue;
        add(m[1], `${typesRel} interface Env`);
      }
    }
    for (const rel of tsFiles(root, `services/${d}/src`)) {
      const src = stripSourceComments(readFileSync(join(root, rel), 'utf8'), '.ts');
      for (const m of src.matchAll(/\bsecretEnvVar\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) add(m[1], `${rel} secretEnvVar`);
      for (const m of src.matchAll(/\bcredentialEnvVars\s*:\s*\[([^\]]*)\]/g)) {
        for (const n of m[1].matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)) add(n[1], `${rel} credentialEnvVars`);
      }
    }
    const scripts = [name, ...(isObj(cfg.env) && isObj(cfg.env.sandbox) ? [`${name}-sandbox`] : [])];
    workers.push({ dir: d, name, scripts, reads });
  }
  return workers;
}

/** Evaluate the limbs over `root`. @returns {{ findings: {limb:string,msg:string,lost:boolean}[], notes: string[] }} */
export function evaluate(root) {
  const findings = [];
  const notes = [];
  const find = (limb, msg) => findings.push({ limb, msg, lost: false });
  const lost = (limb, msg) => findings.push({ limb, msg, lost: true });

  let doc;
  try { doc = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')); } catch (e) {
    lost('A', `${MANIFEST} could not be read (${e.code === 'ENOENT' ? 'absent' : e.message}); without it nothing says which secrets a Worker needs`);
    return { findings, notes };
  }
  const rows = Array.isArray(doc?.rows) ? doc.rows : null;
  if (!rows || !rows.length) { lost('A', `${MANIFEST} has no rows`); return { findings, notes }; }

  const texts = workflowTexts(root);
  if (!texts.size) {
    lost('A', 'could not read any workflow under .github/workflows (through workflow-scan.mjs), so the deploy-time --var names and the deploy carrier are unknown; every verdict would be a guess');
    return { findings, notes };
  }
  const workers = readWorkers(root);
  for (const w of workers) if (w.error) lost('E', w.error);
  const ok = workers.filter((w) => !w.error);
  const totalReads = ok.reduce((n, w) => n + w.reads.size, 0);
  if (!ok.length || !totalReads) { lost('A', 'no Worker under services/ yielded a single secret read; the reader is blind, not the tree clean'); return { findings, notes }; }
  notes.push(`read ${totalReads} secret name(s) across ${ok.length} Worker(s); ${rows.length} manifest row(s)`);

  // C · values: before anything prints a row
  for (const f of forbiddenValues(doc)) find('C', `${MANIFEST} ${f.at} holds ${f.what}; the manifest names secrets, it never carries one`);

  const scriptOf = new Map(); // script → worker
  for (const w of ok) for (const s of w.scripts) scriptOf.set(s, w);
  const seen = new Set();
  let portDocs = null;
  if (existsSync(join(root, PORTS_DIR))) {
    portDocs = new Map();
    for (const e of listDir(join(root, PORTS_DIR), { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.json') || e.name.startsWith('_') || e.name === 'port.schema.json') continue;
      try { portDocs.set(e.name.replace(/\.json$/, ''), JSON.parse(readFileSync(join(root, PORTS_DIR, e.name), 'utf8'))); } catch { /* assert-ports owns an unparseable registry */ }
    }
  }
  const deployText = texts.get(DEPLOY_WORKFLOW) ?? null; // absent: a deploy row then has no carrier (G)

  rows.forEach((r, i) => {
    const at = `rows[${i}]`;
    if (!isObj(r)) { find('G', `${MANIFEST} ${at} is not an object`); return; }
    const id = `${r.worker}/${r.secret}`;
    for (const k of Object.keys(r)) if (!ROW_KEYS.includes(k)) find('C', `${MANIFEST} ${at} (${id}) carries key \`${k}\`; a row holds only ${ROW_KEYS.join(', ')} — never a value, a hash or a length`);
    // G · shape
    if (typeof r.secret !== 'string' || !NAME.test(r.secret)) find('G', `${MANIFEST} ${at}: secret ${JSON.stringify(r.secret)} is not a NAME`);
    if (typeof r.vaultKey !== 'string' || !VAULT_KEY.test(r.vaultKey)) find('G', `${MANIFEST} ${at} (${id}): vaultKey ${JSON.stringify(r.vaultKey)} is not a vault key name`);
    if (!KINDS.includes(r.kind)) find('G', `${MANIFEST} ${at} (${id}): kind ${JSON.stringify(r.kind)} is not one of ${KINDS.join('|')}`);
    if (!SET_BY.includes(r.setBy)) find('G', `${MANIFEST} ${at} (${id}): setBy ${JSON.stringify(r.setBy)} is not one of ${SET_BY.join('|')}`);
    if (!REPLACE.includes(r.replace)) find('G', `${MANIFEST} ${at} (${id}): replace ${JSON.stringify(r.replace)} is not one of ${REPLACE.join('|')}; every row says whether a LIVE value may ever be overwritten`);
    else if (typeof r.secret === 'string' && SEALS_STORED_DATA.test(r.secret) && r.replace !== 'never') find('G', `${MANIFEST} ${at} (${id}) seals stored data and says replace ${JSON.stringify(r.replace)}: overwritten live, every sealed row stops opening, so it is "never" (rotate as a new name plus a migration)`);
    for (const k of ['purpose', 'rotation']) if (typeof r[k] !== 'string' || r[k].trim().length < 10) find('G', `${MANIFEST} ${at} (${id}): \`${k}\` must say it in words (10+ characters)`);
    if (r.kind === 'generated') {
      const g = r.generate;
      if (!isObj(g) || !Number.isInteger(g.bytes) || g.bytes < 32 || !['base64', 'hex'].includes(g.encoding)) find('G', `${MANIFEST} ${at} (${id}) is generated but declares no generate {bytes >= 32, encoding base64|hex}`);
      if (r.setBy !== 'vault') find('G', `${MANIFEST} ${at} (${id}) is generated, so the vault is its custody: setBy must be vault`);
    } else if (r.generate !== undefined) find('G', `${MANIFEST} ${at} (${id}) declares generate but is ${r.kind}; only a generated key is made by worker-secrets.mjs`);
    if (r.setBy === 'deploy' && !(deployText && new RegExp(`secrets\\.${esc(String(r.secret))}\\b`).test(deployText))) {
      find('G', `${MANIFEST} ${at} (${id}) is setBy deploy, but ${DEPLOY_WORKFLOW} carries no secrets.${r.secret}`);
    }
    // F · unique
    if (seen.has(id)) find('F', `${MANIFEST} declares ${id} twice`);
    seen.add(id);
    // E · workers
    const w = scriptOf.get(r.worker);
    if (!w) find('E', `${MANIFEST} ${at}: worker ${JSON.stringify(r.worker)} is no wrangler script (known: ${[...scriptOf.keys()].join(', ')})`);
    // A (reverse) · a row its Worker does not read
    else if (typeof r.secret === 'string' && !w.reads.has(r.secret)) find('A', `${MANIFEST} ${at} declares ${id}, but services/${w.dir} reads no ${r.secret}: a stale row`);
    // B · consumers
    if (!Array.isArray(r.consumers) || !r.consumers.length) find('B', `${MANIFEST} ${at} (${id}) names no consumer`);
    for (const c of Array.isArray(r.consumers) ? r.consumers : []) {
      if (typeof c !== 'string' || !existsSync(join(root, c))) { find('B', `${MANIFEST} ${at} (${id}): consumer ${JSON.stringify(c)} does not exist`); continue; }
      const src = stripSourceComments(readFileSync(join(root, c), 'utf8'), '.ts');
      if (!new RegExp(`\\b${esc(String(r.secret))}\\b`).test(src)) find('B', `${MANIFEST} ${at} (${id}): consumer ${c} never names ${r.secret} outside a comment`);
    }
    // D · ports
    const pn = r.port ?? null;
    const an = r.adapter ?? null;
    if ((pn === null) !== (an === null)) find('D', `${MANIFEST} ${at} (${id}): port and adapter are both null or both set (port ${JSON.stringify(pn)}, adapter ${JSON.stringify(an)})`);
    else if (pn !== null && portDocs) {
      const pd = portDocs.get(pn);
      if (!pd) find('D', `${MANIFEST} ${at} (${id}): port ${JSON.stringify(pn)} is no ${PORTS_DIR}/<port>.json registry (known: ${[...portDocs.keys()].join(', ')})`);
      else if (!(pd.adapters ?? []).some((a) => a?.id === an)) find('D', `${MANIFEST} ${at} (${id}): adapter ${JSON.stringify(an)} is no adapter of ${PORTS_DIR}/${pn}.json (has: ${(pd.adapters ?? []).map((a) => a?.id).join(', ')})`);
    }
    if (r.kind === 'generated' && pn !== null) find('D', `${MANIFEST} ${at} (${id}) is generated, ours: it belongs to no vendor's port`);
  });

  // A · every read has a row for the Worker's own script
  for (const w of ok) {
    for (const [n, where] of [...w.reads].sort(([a], [b]) => a.localeCompare(b))) {
      if (!seen.has(`${w.name}/${n}`)) find('A', `${w.name} reads ${n} (${[...where].join('; ')}) and ${MANIFEST} has no ${w.name}/${n} row: rotating it would be a hand edit nobody can list`);
    }
  }
  return { findings, notes };
}

function main() {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..'));
  const { findings, notes } = evaluate(root);
  const lostOnes = findings.filter((f) => f.lost);
  if (lostOnes.length) {
    console.error(`COVERAGE LOST — limb ${lostOnes[0].limb}: ${lostOnes[0].msg}`);
    for (const f of lostOnes.slice(1)) console.error(`  limb ${f.limb}: ${f.msg}`);
    process.exitCode = 2;
    return;
  }
  if (findings.length) {
    console.error(`FAIL — limb ${findings[0].limb}: ${findings[0].msg}`);
    for (const f of findings.slice(1)) console.error(`  limb ${f.limb}: ${f.msg}`);
    for (const n of notes) console.error(`  ${n}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK — every Worker secret is a row of ${MANIFEST} (limbs A-G)`);
  for (const n of notes) console.log(`  ${n}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
