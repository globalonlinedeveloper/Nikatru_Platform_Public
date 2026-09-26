#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-site-bindings.mjs — the bindings the apex site's Pages Function reads are
// the ones its Direct Upload project is given (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE,
// D3a).
//
// ⏱ ADDED 2026-09-25. Until D3a the site's bindings lived only in the dashboard of the
// Git-connected Pages project `nikatru`, named in prose in sites/nikatru/README.md. D3a
// publishes the same directory, by Direct Upload from deploy-web.yml's `site` job, to a
// NEW project `nikatru-apex`, whose bindings come from tooling/sites/nikatru-apex/wrangler.jsonc and
// whose salt comes from an Actions secret. A binding the Function reads and the new
// project lacks does not fail the deploy: subscribe.js answers 503 "Signups aren't
// switched on yet" when PLATFORM_DB or SIGNUPS is missing, and turns its rate limit OFF
// when the salt is missing. Both are the Function's DESIGNED graceful paths, so nothing
// downstream of the deploy goes red on them.
//
// ── WHAT IT READS ───────────────────────────────────────────────────────────
//   · the `| kind | binding | target |` table in sites/nikatru/README.md — the one place
//     a person states which bindings the site has. Kinds: D1, KV, secret.
//   · tooling/sites/nikatru-apex/wrangler.jsonc — JSONC, comments blanked by
//     tooling/ci/text-reductions.mjs. A file that does not parse is COVERAGE LOST.
//   · every `env.NAME` read in sites/nikatru/functions/**/*.js, comments blanked, so a
//     name in a SETUP comment is not a read.
//   · services/*/wrangler.jsonc — the Workers' own D1 declarations, for the id.
//   · .github/workflows/deploy-web.yml, through workflow-scan.mjs (comments blanked) — the
//     `--fill-kv-id --out` step, the `pages deploy .` line, its `workingDirectory`, and
//     each `pages secret put`.
//
// ── WHAT MAKES IT FAIL (exit 1) ─────────────────────────────────────────────
//   1. A D1 or KV row with no binding of that name and target in wrangler.jsonc, or a
//      binding in wrangler.jsonc with no row. (Red control RC4: delete the
//      `d1_databases` entry.)
//   2. A D1 binding whose database_id is not the id a Worker under services/ declares for
//      the same database_name.
//   3. A KV binding whose committed id is anything but the placeholder
//      __NIKATRU_SIGNUPS_KV_ID__: the id is the owner's, and it arrives through the
//      Actions variable NIKATRU_SIGNUPS_KV_ID at deploy time, never as a literal here.
//   4. A secret row named anywhere in wrangler.jsonc's code, or not put on the project
//      by a `pages secret put <NAME>` in deploy-web.yml.
//   5. An `env.NAME` the Functions read with no row, or a row no Function reads.
//   6. A top-level key outside the ones this file needs (a binding kind the table
//      cannot name), `pages_build_output_dir` other than ".", or a `name` that is not the
//      project the job's `pages deploy .` names.
//   7. 🔴 ANY wrangler config (wrangler.json, .jsonc, .toml) in sites/nikatru. That
//      directory is the ROOT of the Git-connected project `nikatru` serving nikatru.com,
//      and Pages reads a root config carrying `pages_build_output_dir` as that project's
//      configuration: the placeholder KV id and the name `nikatru-apex` would reach the
//      live site. The D3a design put the file there; this limb is why it is not.
//   8. A job that does not fill the config INTO the directory it deploys: no
//      `assert-site-bindings.mjs --fill-kv-id --out <dir>` in deploy-web.yml, or no
//      `workingDirectory: <dir>` for the `pages deploy .` to run from.
//
// ── --fill-kv-id --out <dir> (the deploy job only) ──────────────────────────
// Runs every check above on the committed file, then writes it to <dir>/wrangler.jsonc
// with the placeholder replaced by the value of NIKATRU_SIGNUPS_KV_ID, which must be a
// 32-hex namespace id. <dir> is the staged copy of sites/nikatru the job deploys; the
// committed file is never rewritten. The value is an identifier, not a secret; it is
// still not printed, only its length.
//
// Usage:
//   node tooling/ci/assert-site-bindings.mjs [--root <dir>]
//   node tooling/ci/assert-site-bindings.mjs --fill-kv-id --out <staged dir> [--root <dir>]
// Exit 0 = the bindings agree (and, with --fill-kv-id, the filled file was written).
//      1 = a finding: a binding would be missing, extra or wrong on the project.
//      2 = COVERAGE LOST: a file is missing or does not parse, the README table has no
//          row, or the Functions read no binding at all; or --fill-kv-id without --out.
//
// LANE-BOUND: deploy-web.yml — its subject IS the one job that publishes sites/nikatru, the `site` job, which fills this config and deploys it; no other lane publishes the apex site, so there is no set of lanes to derive.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

export const SITE_REL = 'sites/nikatru';
export const README_REL = `${SITE_REL}/README.md`;
export const CONFIG_REL = 'tooling/sites/nikatru-apex/wrangler.jsonc';
/** The names wrangler finds a config by. None may sit in SITE_REL: it is the ROOT of the
 *  Git-connected project `nikatru` that serves nikatru.com, and Pages reads a root config
 *  as that project's configuration. */
export const CONFIG_NAMES = ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml'];
export const FUNCTIONS_REL = `${SITE_REL}/functions`;
export const WORKFLOW_REL = '.github/workflows/deploy-web.yml';
export const SERVICES_REL = 'services';
export const KV_ID_PLACEHOLDER = '__NIKATRU_SIGNUPS_KV_ID__';
export const KV_ID_VARIABLE = 'NIKATRU_SIGNUPS_KV_ID';
export const KV_ID = /^[0-9a-f]{32}$/;
/** Bindings Pages gives every project itself, which no table row declares. */
export const PLATFORM_BINDINGS = new Set(['ASSETS']);
/** The top-level keys the site's config may carry. A binding kind outside these is one
 *  the README table has no kind for, so it would reach the project ungraded. */
export const ALLOWED_KEYS = new Set(['name', 'pages_build_output_dir', 'compatibility_date', 'd1_databases', 'kv_namespaces']);
const KINDS = new Set(['D1', 'KV', 'secret']);

/** A refusal to grade: the check could not read enough to be evidence. */
export class CoverageLost extends Error {}

/** PURE. The rows of the first `| kind | binding | target |` table in `text`, or null. */
export function parseBindingsTable(text) {
  const lines = String(text).split('\n');
  const head = lines.findIndex((l) => /^\|\s*kind\s*\|\s*binding\s*\|\s*target\s*\|\s*$/i.test(l.trim()));
  if (head === -1) return null;
  const rows = [];
  for (let i = head + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    const tick = (c) => (/`([^`]+)`/.exec(c ?? '') ?? [])[1] ?? null;
    rows.push({ kind: cells[0], binding: tick(cells[1]) ?? cells[1], target: tick(cells[2]) });
  }
  return rows;
}

/** PURE. A wrangler JSONC text as an object; CoverageLost when it does not parse. */
export function parseConfig(text, rel = CONFIG_REL) {
  try {
    return JSON.parse(stripSourceComments(text, '.jsonc').replace(/,(\s*[}\]])/g, '$1'));
  } catch (e) {
    throw new CoverageLost(`${rel} does not parse as JSONC (${e.message}), and wrangler would read it`);
  }
}

/** PURE. The `env.NAME` / `env["NAME"]` reads in one Function's source, comments blanked. */
export function envReads(source) {
  const code = stripSourceComments(source, '.js');
  const names = new Set();
  for (const m of code.matchAll(/\benv\s*(?:\.\s*([A-Z][A-Z0-9_]*)\b|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g)) names.add(m[1] ?? m[2]);
  return names;
}

/** PURE. database_name → Set of database_id, from the Workers' wrangler.jsonc texts. */
export function workerDatabaseIds(configTexts) {
  const ids = new Map();
  for (const text of configTexts) {
    const code = stripSourceComments(text, '.jsonc');
    for (const m of code.matchAll(/"database_name"\s*:\s*"([^"]+)"\s*,\s*"database_id"\s*:\s*"([^"]+)"/g)) {
      if (!ids.has(m[1])) ids.set(m[1], new Set());
      ids.get(m[1]).add(m[2]);
    }
  }
  return ids;
}

function jsFiles(abs) {
  const out = [];
  for (const e of listDir(abs, { withFileTypes: true })) {
    const p = join(abs, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (/\.(m?js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : null);

/**
 * PURE over its inputs. `{ problems, rows, reads, declared }` for the site's bindings.
 *   readme, config, workflow: file texts · functions: [{ rel, source }] · workerConfigs: [text]
 *   gitRootConfigs: the CONFIG_NAMES present in SITE_REL (every one is a finding)
 *   filledKvId: null for the committed file (the KV id must be the placeholder); the id
 *   --fill-kv-id wrote, for the re-check of the filled file.
 */
export function gradeBindings({ readme, config, functions, workerConfigs, workflow, gitRootConfigs = [], filledKvId = null }) {
  const rows = parseBindingsTable(readme);
  if (rows === null) throw new CoverageLost(`${README_REL} has no \`| kind | binding | target |\` table, so there is nothing to grade the project against`);
  if (rows.length === 0) throw new CoverageLost(`the bindings table in ${README_REL} has no row`);
  if (functions.length === 0) throw new CoverageLost(`no Function source was found under ${FUNCTIONS_REL}`);
  const cfg = parseConfig(config);
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new CoverageLost(`${CONFIG_REL} is not a JSON object`);
  const problems = [];

  const byName = new Map();
  for (const r of rows) {
    if (!KINDS.has(r.kind)) problems.push(`${README_REL}: the row for \`${r.binding}\` has kind "${r.kind}", not one of ${[...KINDS].join(', ')}.`);
    if (byName.has(r.binding)) problems.push(`${README_REL}: \`${r.binding}\` has two rows.`);
    byName.set(r.binding, r);
  }

  // ── the Functions' reads, both ways ──
  const reads = new Map();
  for (const f of functions) for (const n of envReads(f.source)) if (!PLATFORM_BINDINGS.has(n)) reads.set(n, f.rel);
  if (reads.size === 0) throw new CoverageLost(`the Functions under ${FUNCTIONS_REL} read no \`env.*\` binding, so the table is graded against nothing`);
  for (const [n, rel] of reads) {
    if (!byName.has(n)) problems.push(`${rel} reads \`env.${n}\` and the table in ${README_REL} has no row for it, so no project is given it.`);
  }
  for (const r of rows) {
    if (!reads.has(r.binding)) problems.push(`${README_REL}: \`${r.binding}\` has a row and no Function reads \`env.${r.binding}\`. A stale row is a binding the project is given for nothing.`);
  }

  // ── the config, both ways ──
  for (const key of Object.keys(cfg)) {
    if (!ALLOWED_KEYS.has(key)) problems.push(`${CONFIG_REL}: top-level \`${key}\` is not one of ${[...ALLOWED_KEYS].join(', ')}; a binding kind the README table cannot name reaches the project ungraded.`);
  }
  if (cfg.pages_build_output_dir !== '.') {
    problems.push(`${CONFIG_REL}: pages_build_output_dir is ${JSON.stringify(cfg.pages_build_output_dir ?? null)}, not "." — the job deploys this directory from itself.`);
  }
  const declared = [];
  for (const [key, kind] of [['d1_databases', 'D1'], ['kv_namespaces', 'KV']]) {
    const entries = list(cfg[key]);
    if (entries === null) {
      problems.push(`${CONFIG_REL}: \`${key}\` is not a list.`);
      continue;
    }
    for (const e of entries) {
      if (!e || typeof e.binding !== 'string' || e.binding === '') problems.push(`${CONFIG_REL}: a \`${key}\` entry has no \`binding\`.`);
      else declared.push({ kind, binding: e.binding, entry: e });
    }
  }
  for (const d of declared) {
    const row = byName.get(d.binding);
    if (!row || row.kind !== d.kind) problems.push(`${CONFIG_REL}: ${d.kind} binding \`${d.binding}\` has no ${d.kind} row in ${README_REL}.`);
  }
  const dbIds = workerDatabaseIds(workerConfigs);
  if (dbIds.size === 0) throw new CoverageLost(`no database_name/database_id pair was read from ${SERVICES_REL}/*/wrangler.jsonc`);
  for (const r of rows) {
    if (r.kind === 'D1') {
      const d = declared.find((x) => x.kind === 'D1' && x.binding === r.binding);
      if (!d) {
        problems.push(`${README_REL} names D1 \`${r.binding}\` → \`${r.target}\` and ${CONFIG_REL} declares no d1_databases binding \`${r.binding}\`: the project would run the Function without it.`);
        continue;
      }
      if (d.entry.database_name !== r.target) {
        problems.push(`${CONFIG_REL}: \`${r.binding}\` binds database_name ${JSON.stringify(d.entry.database_name ?? null)}, and the table says \`${r.target}\`.`);
      }
      const known = dbIds.get(r.target);
      const id = d.entry.database_id;
      if (!known) problems.push(`${CONFIG_REL}: no Worker under ${SERVICES_REL}/ declares database \`${r.target}\`, so its id has no source.`);
      else if (!known.has(id)) problems.push(`${CONFIG_REL}: \`${r.binding}\` has database_id ${JSON.stringify(id ?? null)}, and ${SERVICES_REL}/ declares \`${r.target}\` as ${[...known].join(', ')}.`);
    } else if (r.kind === 'KV') {
      const d = declared.find((x) => x.kind === 'KV' && x.binding === r.binding);
      if (!d) {
        problems.push(`${README_REL} names KV \`${r.binding}\` → \`${r.target}\` and ${CONFIG_REL} declares no kv_namespaces binding \`${r.binding}\`.`);
        continue;
      }
      const want = filledKvId ?? KV_ID_PLACEHOLDER;
      if (d.entry.id !== want) {
        problems.push(
          filledKvId
            ? `${CONFIG_REL}: after the fill, \`${r.binding}\` does not carry the id from ${KV_ID_VARIABLE}.`
            : `${CONFIG_REL}: \`${r.binding}\` has id ${JSON.stringify(d.entry.id ?? null)}; the committed value is the placeholder "${KV_ID_PLACEHOLDER}", filled from the Actions variable ${KV_ID_VARIABLE} at deploy.`,
        );
      }
    }
  }

  // ── secrets: never in the file, always put by the job ──
  const configCode = stripSourceComments(config, '.jsonc');
  const workflowCode = stripSourceComments(workflow, '.yml');
  for (const r of rows.filter((x) => x.kind === 'secret')) {
    if (new RegExp(`\\b${r.binding}\\b`).test(configCode)) problems.push(`${CONFIG_REL} names the secret \`${r.binding}\` outside a comment. A secret is put on the project, never written in a file.`);
    if (!new RegExp(`pages\\s+secret\\s+put\\s+${r.binding}\\b`).test(workflowCode)) {
      problems.push(`${WORKFLOW_REL} runs no \`wrangler pages secret put ${r.binding}\`, so the project the job deploys never receives it.`);
    }
  }

  // ── the project the job deploys is the one the file names ──
  const deploy = /pages\s+deploy\s+\.\s+--project-name[= ]([A-Za-z0-9-]+)/.exec(workflowCode);
  if (!deploy) problems.push(`${WORKFLOW_REL} has no \`pages deploy . --project-name=<name>\`, so nothing deploys a staged ${SITE_REL} from itself with this file.`);
  else if (deploy[1] !== cfg.name) problems.push(`${CONFIG_REL} names project ${JSON.stringify(cfg.name ?? null)} and ${WORKFLOW_REL} deploys to "${deploy[1]}".`);

  // ── the filled file lands in the directory the deploy runs from ──
  const out = /assert-site-bindings\.mjs\s+--fill-kv-id\s+--out\s+(\S+)/.exec(workflowCode);
  if (!out) {
    problems.push(`${WORKFLOW_REL} runs no \`assert-site-bindings.mjs --fill-kv-id --out <dir>\`, so the directory it deploys carries no filled config and the project gets no bindings.`);
  } else if (!new RegExp(`workingDirectory:\\s*${out[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(workflowCode)) {
    problems.push(`${WORKFLOW_REL} fills the config into ${out[1]} and no deploy step has \`workingDirectory: ${out[1]}\`: wrangler reads the config from its working directory, so the deploy would run without it.`);
  }

  // ── never in the Git-connected project's root ──
  for (const name of gitRootConfigs) {
    problems.push(
      `${SITE_REL}/${name} exists. ${SITE_REL} is the ROOT of the Git-connected Pages project \`nikatru\` that serves nikatru.com, ` +
        'and Pages reads a root wrangler config as that project\'s configuration, so this file would reconfigure the live site. ' +
        `The nikatru-apex config lives at ${CONFIG_REL} and is copied into the staged directory by the job.`,
    );
  }

  return { problems, rows, reads: [...reads.keys()], declared: declared.map((d) => `${d.kind} ${d.binding}`) };
}

/** Reads the inputs off disk under `root`. Throws CoverageLost on a missing one. */
export function readInputs(root) {
  const need = (rel) => {
    const abs = join(root, ...rel.split('/'));
    if (!existsSync(abs)) throw new CoverageLost(`${rel} is not on disk`);
    return readFileSync(abs, 'utf8');
  };
  const fnDir = join(root, ...FUNCTIONS_REL.split('/'));
  if (!existsSync(fnDir) || !statSync(fnDir).isDirectory()) throw new CoverageLost(`${FUNCTIONS_REL} is not a directory`);
  const functions = jsFiles(fnDir).map((abs) => ({ rel: relative(root, abs).split(sep).join('/'), source: readFileSync(abs, 'utf8') }));
  const svcDir = join(root, SERVICES_REL);
  const workerConfigs = existsSync(svcDir)
    ? listDir(svcDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(svcDir, e.name, 'wrangler.jsonc')))
        .map((e) => readFileSync(join(svcDir, e.name, 'wrangler.jsonc'), 'utf8'))
    : [];
  const gitRootConfigs = CONFIG_NAMES.filter((n) => existsSync(join(root, ...SITE_REL.split('/'), n)));
  // Read through workflow-scan.mjs (tooling/workflow-readers.json): its parse, comments blanked.
  const wf = parseWorkflow(root, WORKFLOW_REL);
  if (wf === null) throw new CoverageLost(`${WORKFLOW_REL} is not on disk`);
  const workflow = wf.lines.map((l) => l.text).join('\n');
  return { readme: need(README_REL), config: need(CONFIG_REL), workflow, functions, workerConfigs, gitRootConfigs };
}

function coverageLost(lines) {
  for (const [i, l] of lines.entries()) console.error(i === 0 ? `✗ COVERAGE LOST — ${l}` : `  ${l}`);
  process.exit(2);
}

function main(argv) {
  const r = argv.indexOf('--root');
  const root = resolve(r === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..', '..') : argv[r + 1] ?? '');
  const fill = argv.includes('--fill-kv-id');
  const o = argv.indexOf('--out');
  const outRel = o === -1 ? null : argv[o + 1] ?? null;
  if (fill && (outRel === null || outRel.startsWith('--'))) {
    return coverageLost(['--fill-kv-id was given with no --out <staged dir>.', 'The filled config goes into the directory the job deploys, never over the committed file.']);
  }
  let inputs;
  let graded;
  try {
    inputs = readInputs(root);
    graded = gradeBindings(inputs);
  } catch (e) {
    if (e instanceof CoverageLost) return coverageLost([e.message, 'The check could not read enough of the site to be evidence about its bindings.']);
    throw e;
  }
  if (graded.problems.length > 0) {
    console.error(`✗ the apex site's Pages bindings disagree — ${graded.problems.length} problem(s):`);
    for (const p of graded.problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log(`ok  ${graded.rows.length} binding row(s) in ${README_REL}; the Functions read ${graded.reads.join(', ')}; ${CONFIG_REL} declares ${graded.declared.join(', ')}`);
  if (!fill) return;

  const value = process.env[KV_ID_VARIABLE] ?? '';
  if (!KV_ID.test(value)) {
    console.error(
      `✗ the Actions variable ${KV_ID_VARIABLE} is ${value === '' ? 'empty or unset' : `not a 32-hex KV namespace id (${value.length} characters)`}. ` +
        'The owner supplies the nikatru-signups namespace id there; nothing deploys without it.',
    );
    process.exit(1);
  }
  const quoted = `"${KV_ID_PLACEHOLDER}"`;
  const count = inputs.config.split(quoted).length - 1;
  if (count !== 1) {
    console.error(`✗ ${CONFIG_REL} carries the placeholder ${quoted} ${count} time(s), not once.`);
    process.exit(1);
  }
  const filled = inputs.config.replace(quoted, `"${value}"`);
  const again = gradeBindings({ ...inputs, config: filled, filledKvId: value });
  if (again.problems.length > 0) {
    console.error('✗ the filled wrangler.jsonc no longer grades clean:');
    for (const p of again.problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  const outDir = resolve(root, outRel);
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    console.error(`✗ --out ${outRel} is not a directory. The job stages the site there before this step, and deploys it after.`);
    process.exit(1);
  }
  if (!existsSync(join(outDir, 'functions'))) {
    console.error(`✗ --out ${outRel} holds no functions/ directory, so it is not a staged copy of ${SITE_REL}.`);
    process.exit(1);
  }
  writeFileSync(join(outDir, 'wrangler.jsonc'), filled);
  console.log(`ok  ${outRel}/wrangler.jsonc: ${CONFIG_REL} with the KV id placeholder filled from ${KV_ID_VARIABLE} (${value.length} hex characters)`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main(process.argv.slice(2));
