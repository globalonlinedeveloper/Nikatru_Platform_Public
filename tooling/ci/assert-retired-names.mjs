#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-retired-names.mjs — a RETIRED name may not come back as the NAME of a
// LIVE resource.
//
// [ADR 079]. Owner, in chat, 2026-09-11: "Rename all, remove redirects too".
// Until that day `subly` — the name retired at the stores by [ADR 074] — was
// still the deployed Worker (`subly-api`), the app database (`subly_db`, bound
// as `SUBLY_DB`), an e2e env name (`SUBLY_D1_DATABASE_ID`), a live subdomain
// with a zone 301, and two `/subly` path redirects. Nothing could have said so:
// assert-store-identity.mjs refuses the token in STORE identifiers only, and its
// register note even recorded the live names as kept "on purpose".
//
// ── ONE LIST OF RETIRED NAMES, NOT TWO ──────────────────────────────────────
// The tokens are tooling/channel-register.json `retiredIdentityTokens.tokens`,
// the list assert-store-identity.mjs already reads. A guard-side copy would be a
// second list to forget. Matching is the same too: case- and separator-
// insensitive, so `Subly`, `SUBLY_DB`, `sub-ly` and `subly.nikatru.com` are one
// refusal.
//
// ── WHAT IS A LIVE RESOURCE NAME HERE (the subjects) ─────────────────────────
//   1. services/*/wrangler.json(c) — `name`; every d1/kv/r2 `binding`,
//      `database_name` and `bucket_name`; every `routes[].pattern` (custom
//      domains included); the HOST of every URL in `vars`.
//   2. catalog/apps.json — `slug`, `url`, `origin`, `api`, every `listings.*`.
//   3. apps/*/app.yaml — every `hosts.*` value.
//   4. tooling/monitor-register.json — every `hosts[].hostname`, and the `name`
//      and `url` of every monitor (a GlitchTip monitor's name is a live name).
//   5. tooling/platform-register.json — every Worker `name` and `hosts[]`, every
//      `bindings[].binding`.
//   6. tooling/channel-register.json `serviceEnvironments[]` — `id`,
//      `deploymentEnvironment`, `url`, `name`.
//   7. .github/workflows/*.yml — every environment-variable NAME (an
//      UPPER_SNAKE key) and every `secrets.` / `vars.` / `env.` reference.
//   8. sites/*/_redirects — the source and target of every rule.
//
// ── WHAT IS DELIBERATELY NOT A SUBJECT ──────────────────────────────────────
// Comments, prose, history notes, test fixtures, applied migrations, GlitchTip
// release stamps and issue ids. They record what happened; rewriting them would
// falsify a citation. Comments are stripped before a config is read, so the
// long "why this was renamed" notes cannot trip this guard.
//
// Exit: 0 = no live name carries a retired token · 1 = one does ·
//       2 = COVERAGE LOST (the tree did not yield enough to be evidence)
// Usage: node tooling/ci/assert-retired-names.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseJsonc } from './d1-sql-inventory.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';
// The tokens AND the matching rule come from one home, so the tree check and the
// live account check (tooling/ops/check-retired-names-live.mjs) can never disagree
// about what the retired name is.
import { RETIRED_REGISTER_REL, retiredIn, tokensFrom } from './retired-identity.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const abs = (p) => join(ROOT, p);
const REGISTER_REL = RETIRED_REGISTER_REL;

function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — assert-retired-names read too little of the tree to be evidence.');
  for (const l of lines) console.error(`    ${l}`);
  console.error('  2 is deliberately NOT a pass: a guard that checked nothing has proved nothing.');
  process.exit(2);
}

function readJson(relPath) {
  if (!existsSync(abs(relPath))) coverageLost([`${relPath} does not exist.`]);
  try {
    return JSON.parse(readFileSync(abs(relPath), 'utf8'));
  } catch (err) {
    coverageLost([`${relPath} is not valid JSON (${err.message}).`]);
  }
  return null;
}

const listing = (relDir) => (existsSync(abs(relDir)) ? listDir(abs(relDir), { withFileTypes: true }) : []);

// ── the tokens ───────────────────────────────────────────────────────────────
const register = readJson(REGISTER_REL);
const tokens = tokensFrom(register);
if (tokens.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`retiredIdentityTokens.tokens\`.`,
    'With no tokens this guard refuses nothing, and a retired name returning as a live resource would read exactly',
    'like a clean tree.',
  ]);
}
const carriesRetired = (value) => retiredIn(tokens, value);

const findings = [];
const read = new Map(); // subject → number of names read
function check(subject, where, field, value) {
  if (typeof value !== 'string' || value.trim() === '') return;
  read.set(subject, (read.get(subject) ?? 0) + 1);
  const hit = carriesRetired(value);
  if (hit) {
    findings.push(
      `${where} → ${field} = ${JSON.stringify(value)} carries the retired name "${hit}" ` +
        `(${REGISTER_REL} retiredIdentityTokens). [ADR 079]: rename the live resource; the retired name stays retired.`,
    );
  }
}
const hostOf = (s) => {
  try {
    return new URL(s).hostname;
  } catch {
    return null;
  }
};

// ── 1 · Worker configs ───────────────────────────────────────────────────────
let workerConfigs = 0;
for (const e of listing('services')) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const f of ['wrangler.jsonc', 'wrangler.json']) {
    const p = `services/${e.name}/${f}`;
    if (!existsSync(abs(p))) continue;
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(abs(p), 'utf8'));
    } catch (err) {
      coverageLost([`${p} did not parse (${err.message}); its names were not read.`]);
    }
    workerConfigs++;
    const scan = (c, prefix) => {
      check('workers', p, `${prefix}name`, c?.name);
      for (const kind of ['d1_databases', 'kv_namespaces', 'r2_buckets']) {
        for (const [i, b] of (Array.isArray(c?.[kind]) ? c[kind] : []).entries()) {
          for (const k of ['binding', 'database_name', 'bucket_name']) check('workers', p, `${prefix}${kind}[${i}].${k}`, b?.[k]);
        }
      }
      for (const [i, r] of (Array.isArray(c?.routes) ? c.routes : []).entries()) {
        check('workers', p, `${prefix}routes[${i}].pattern`, typeof r === 'string' ? r : r?.pattern);
      }
      for (const [k, v] of Object.entries(c?.vars ?? {})) {
        if (typeof v !== 'string') continue;
        for (const m of v.matchAll(/https?:\/\/[^\s,;"']+/g)) check('workers', p, `${prefix}vars.${k} (host)`, hostOf(m[0]));
      }
    };
    scan(cfg, '');
    for (const [envName, envCfg] of Object.entries(cfg?.env ?? {})) scan(envCfg, `env.${envName}.`);
    break;
  }
}
if (workerConfigs === 0) {
  coverageLost(['no services/*/wrangler.json(c) was found, so no Worker, database, bucket or custom-domain name was read.']);
}

// ── 2 · the app catalogue ────────────────────────────────────────────────────
const catalogue = readJson('catalog/apps.json');
if (!Array.isArray(catalogue) || catalogue.length === 0) {
  coverageLost(['catalog/apps.json lists no app, so no published address was read.']);
}
for (const [i, a] of catalogue.entries()) {
  const where = `catalog/apps.json[${i}]`;
  check('catalogue', where, 'slug', a?.slug);
  for (const f of ['url', 'origin', 'api']) check('catalogue', where, f, a?.[f]);
  for (const [k, v] of Object.entries(a?.listings ?? {})) check('catalogue', where, `listings.${k}`, v);
}

// ── 3 · app declarations ─────────────────────────────────────────────────────
let appYamls = 0;
for (const e of listing('apps')) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const p = `apps/${e.name}/app.yaml`;
  if (!existsSync(abs(p))) continue;
  let doc;
  try {
    doc = parseYaml(readFileSync(abs(p), 'utf8'));
  } catch (err) {
    coverageLost([`${p} did not parse (${err.message}); its hosts were not read.`]);
  }
  appYamls++;
  check('app.yaml', p, 'id', doc?.id);
  for (const [k, v] of Object.entries(doc?.hosts ?? {})) check('app.yaml', p, `hosts.${k}`, v);
}
if (appYamls === 0) coverageLost(['no apps/*/app.yaml was found, so no declared host was read.']);

// ── 4 · the monitor register ─────────────────────────────────────────────────
const monitors = readJson('tooling/monitor-register.json');
const monitorHosts = Array.isArray(monitors?.hosts) ? monitors.hosts : [];
if (monitorHosts.length === 0) coverageLost(['tooling/monitor-register.json carries no `hosts`, so no monitored hostname was read.']);
for (const [i, h] of monitorHosts.entries()) {
  const where = `tooling/monitor-register.json hosts[${i}]`;
  check('monitors', where, 'hostname', h?.hostname);
  const mons = [h?.monitor, h?.sslMonitor, ...(Array.isArray(h?.pathMonitors) ? h.pathMonitors : [])];
  for (const m of mons) {
    if (!m || typeof m !== 'object') continue;
    check('monitors', where, 'monitor name', m.name);
    check('monitors', where, 'monitor url', m.url);
  }
}

// ── 5 · the platform register ────────────────────────────────────────────────
const platform = readJson('tooling/platform-register.json');
const workers = [platform?.servingWorker, ...(Array.isArray(platform?.appWorkers) ? platform.appWorkers : [])].filter(Boolean);
if (workers.length === 0) coverageLost(['tooling/platform-register.json names no Worker (`servingWorker`, `appWorkers`).']);
for (const w of workers) {
  const where = `tooling/platform-register.json Worker ${JSON.stringify(w.config ?? w.name ?? '?')}`;
  check('platform', where, 'name', w.name);
  for (const h of Array.isArray(w.hosts) ? w.hosts : []) check('platform', where, 'hosts[]', h);
}
for (const [i, b] of (Array.isArray(platform?.bindings) ? platform.bindings : []).entries()) {
  check('platform', `tooling/platform-register.json bindings[${i}]`, 'binding', b?.binding);
}

// ── 6 · service environments ─────────────────────────────────────────────────
for (const [i, s] of (Array.isArray(register?.serviceEnvironments) ? register.serviceEnvironments : []).entries()) {
  const where = `${REGISTER_REL} serviceEnvironments[${i}]`;
  for (const f of ['id', 'deploymentEnvironment', 'url', 'name']) check('services', where, f, s?.[f]);
}

// ── 7 · workflow environment names ───────────────────────────────────────────
let workflows = 0;
for (const e of listing('.github/workflows')) {
  if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
  const p = `.github/workflows/${e.name}`;
  workflows++;
  const lines = readFileSync(abs(p), 'utf8').split(/\r?\n/);
  for (const [n, raw] of lines.entries()) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/\s#.*$/, '');
    const key = /^\s*-?\s*([A-Z][A-Z0-9_]*)\s*:/.exec(line);
    if (key) check('workflows', `${p}:${n + 1}`, 'env name', key[1]);
    for (const m of line.matchAll(/\b(?:secrets|vars|env)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      check('workflows', `${p}:${n + 1}`, 'secret/var/env reference', m[1]);
    }
  }
}
if (workflows === 0) coverageLost(['no .github/workflows/*.yml was found, so no workflow env name was read.']);

// ── 8 · path redirects ───────────────────────────────────────────────────────
for (const e of listing('sites')) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const p = `sites/${e.name}/_redirects`;
  if (!existsSync(abs(p))) continue;
  for (const [n, raw] of readFileSync(abs(p), 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [from, to] = line.split(/\s+/);
    check('redirects', `${p}:${n + 1}`, 'rule source', from);
    check('redirects', `${p}:${n + 1}`, 'rule target', to);
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
const summary = [...read.entries()].map(([k, v]) => `${k} ${v}`).join(' · ');
if (findings.length > 0) {
  console.error(`✗ ${findings.length} live resource name(s) carry a retired name:`);
  for (const f of findings) console.error(`    ${f}`);
  console.error(`  read: ${summary}; retired tokens: ${tokens.join(', ')}`);
  process.exit(1);
}
console.log(`✓ no live resource name carries a retired name (${tokens.join(', ')}). read: ${summary}`);
