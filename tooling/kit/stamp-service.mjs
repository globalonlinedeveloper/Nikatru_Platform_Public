#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-service.mjs — stamp an API-only Worker, `services/<id>-api`, from the
// app brick's Worker variant, and print what makes it deployable.
//
// Row O-NEW-PRODUCT-HAS-NO-READOUT (rv2-newproduct-016). The only Worker
// template rode an app stamp (`needs_backend: true`), so a service with no app
// was a hand copy: resolve the template's mustache by hand, keep its lockfile,
// then provision. This is that copy, done by the one renderer the template
// needs — and a refusal the moment the template needs more than it.
//
// ── RULINGS ──────────────────────────────────────────────────────────────────
//   · ONE TEMPLATE. The Worker variant under
//     tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api
//     is the template an app's backend is stamped from; a service is stamped
//     from the same bytes, so a fix to the chassis reaches both.
//   · THE TEMPLATE'S VOCABULARY IS CLOSED. It speaks `{{app_id}}` and
//     `{{{display_name}}}` (unescaped). Any other mustache tag left after those
//     two are rendered — in a path or in a file — stops the stamp with exit 1
//     before ANYTHING is written: a template that grew a variable this command
//     does not know would otherwise be stamped with the tag in it.
//   · THE ID IS ONE NO OTHER PRODUCT CLAIMS. contracts/app-id first (the id
//     becomes a Worker name, a D1 database name and a host label), then the one
//     claimed-id set (tooling/kit/product-set.mjs), where ANY claim refuses a
//     new service, its own kind's included: `platform` would bind the new
//     Worker's APP_DB to the live platform_db.
//   · IT WRITES ONLY services/<id>-api, and refuses a directory that exists.
//     The register row, the data-inventory row and the monitor host row are
//     provision-backend.mjs's steps [6] and [7], which read the stamped
//     wrangler.jsonc; the monitor and the DSN secret are the owner's. Each is a
//     line this prints, never a thing it does. It calls no network.
//
// Usage:
//   node tooling/kit/stamp-service.mjs <id> [--name "<Display Name>"] [--root <dir>] [--dry-run]
//
//   --name     the service's display name (its README's first line); default: <id>.
//   --root     the tree to stamp into (default: this file's repository).
//   --dry-run  render and check everything, print the files, write nothing.
//
// Exit: 0 stamped (or the dry run rendered) · 1 refused (the id, a claim, an
// existing directory, or an unknown template tag) · 2 COVERAGE LOST (no template,
// an unreadable product register, or a wrong usage).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appIdProblems } from '../../contracts/app-id/app-id.js';
import { claimsOf, describeClashes } from './product-set.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The Worker variant of the app brick, repo-relative. */
export const TEMPLATE_REL = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
/** Any mustache tag: what must be gone once the two known ones are rendered. */
const ANY_TAG = /\{\{\{?[#^/!>&]?\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}?\}\}/;

/** Every file under `dir`, as `/`-joined paths relative to it, sorted. */
function filesUnder(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...filesUnder(abs, rel));
    else out.push(rel);
  }
  return out;
}

/** The template rendered for `id`: `{ files: [{ rel, text }], unknown: [where] }`. */
export function renderTemplate(root, id, displayName) {
  const tpl = join(root, ...TEMPLATE_REL.split('/'));
  if (!existsSync(tpl)) return { lost: `${TEMPLATE_REL} does not exist, so there is no Worker template to stamp from` };
  const render = (t) => t.replaceAll('{{{display_name}}}', displayName).replaceAll('{{app_id}}', id);
  const files = [];
  const unknown = [];
  for (const rel of filesUnder(tpl)) {
    const out = `services/${id}-api/${render(rel)}`;
    const text = render(readFileSync(join(tpl, ...rel.split('/')), 'utf8'));
    if (ANY_TAG.test(out)) unknown.push(`${TEMPLATE_REL}/${rel} (in its path)`);
    const m = ANY_TAG.exec(text);
    if (m) unknown.push(`${TEMPLATE_REL}/${rel}: ${m[0]}`);
    files.push({ rel: out, text });
  }
  return { files, unknown };
}

/** The lines that take a stamped Worker to deployable, every one printed, none run. */
export function nextSteps(id) {
  const secret = `GLITCHTIP_DSN_${id.toUpperCase()}`;
  return [
    `  1. node tooling/scripts/provision-backend.mjs ${id}`,
    '       creates its D1 database, writes its appWorkers row (hosts, routes, cors, dsnSecret), its data-inventory',
    '       row and each host\'s monitor-register row; commit what it writes',
    `  2. owner O-E1: create the GitHub secret ${secret} (its GlitchTip DSN); provision-backend prints the two lines`,
    '       that deliver it to deploy-workers.yml',
    '  3. owner O-E2: node tooling/ops/ensure-monitors.mjs --apply (after the go)',
    `  then: node tooling/kit/new-product.mjs plan ${id} --kind service`,
  ];
}

/** @returns {number} the exit code */
export function main(argv, { log = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const valued = new Set(['--root', '--name']);
  const known = new Set([...valued, '--dry-run']);
  const bad = argv.filter((a) => a.startsWith('--') && !known.has(a));
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const value = (f) => {
    const i = argv.indexOf(f);
    return i === -1 ? null : argv[i + 1] ?? '';
  };
  const usage = 'usage: stamp-service.mjs <id> [--name "<Display Name>"] [--root <dir>] [--dry-run]';
  if (bad.length || positional.length !== 1 || [...valued].some((f) => value(f) === '' || value(f)?.startsWith('--'))) {
    err(`✗ COVERAGE LOST — ${bad.length ? `unknown flag ${bad[0]}; ` : ''}${usage}`);
    return 2;
  }
  const id = positional[0];
  const root = resolve(value('--root') ?? REPO);
  const displayName = value('--name') ?? id;
  const dry = argv.includes('--dry-run');

  const idProblems = appIdProblems(id);
  if (idProblems.length) {
    for (const p of idProblems) err(`✗ ${p} Nothing was stamped.`);
    return 1;
  }
  // A NEW service: every claim on the id refuses it, its own included (`platform`
  // is the platform service already; a second stamp would be `platform-api`).
  const { claims, problems } = claimsOf(root);
  const clashes = claims.get(id) ?? [];
  if (problems.length) {
    err(`✗ COVERAGE LOST — the claimed-id set could not be read (${problems[0]}); nothing was stamped.`);
    return 2;
  }
  if (clashes.length) {
    err(`✗ ${describeClashes(id, clashes)}. Choose another id; nothing was stamped.`);
    return 1;
  }
  const dir = `services/${id}-api`;
  if (existsSync(join(root, ...dir.split('/')))) {
    err(`✗ ${dir} exists already; this stamps a new service and never writes over one. Nothing was stamped.`);
    return 1;
  }
  const r = renderTemplate(root, id, displayName);
  if (r.lost) {
    err(`✗ COVERAGE LOST — ${r.lost}`);
    return 2;
  }
  if (r.unknown.length) {
    err(`✗ the Worker template carries ${r.unknown.length} tag(s) this stamp does not render ({{app_id}} and {{{display_name}}} only):`);
    for (const u of r.unknown) err(`    ${u}`);
    err('  Teach this command the variable (and what a service sets it to) before stamping; nothing was stamped.');
    return 1;
  }
  if (dry) {
    for (const f of r.files) log(`would write  ${f.rel}`);
    log(`dry run: ${r.files.length} file(s) for "${id}", nothing written.`);
    return 0;
  }
  for (const f of r.files) {
    const abs = join(root, ...f.rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.text);
  }
  log(`ok  stamp-service: ${dir} stamped (${r.files.length} file(s)), its lockfile the template's. Next, in order:`);
  for (const l of nextSteps(id)) log(l);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
