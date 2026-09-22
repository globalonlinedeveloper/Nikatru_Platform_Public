#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-retired-names-visible.mjs — no surface a customer can read names a
// RETIRED product.
//
// [ADR 074] retired `Subly` at the stores; the app is Nikatru Subscription
// Tracker (launcher "Subscriptions", slug `subscriptiontracker`). Owner, in chat,
// 2026-09-22: "\"Subly Pro\" (old app name) - we need to remove old and
// everywhere we need to use new name only". Measured the same day: nikatru.com
// still published the old name in a served README, in two comments on
// pricing.html, in four screenshot file names, and in a public issue form.
//
// ── WHY A SECOND GUARD AND NOT A LIMB OF assert-retired-names.mjs ────────────
// That guard reads the NAMES of live resources — ids, hosts, bindings, env keys.
// This one reads TEXT a customer can see. Different subjects, different floors,
// and one verdict line each. What they share lives in one module each: the
// tokens and the matching rule in ./retired-identity.mjs, and what a deploy
// root serves in ../sites/served.mjs.
//
// ── THE SURFACES, EACH WITH A COVERAGE FLOOR (exit 2 when it is not met) ─────
//   1. site         sites/nikatru/** — every text file the apex serves, and
//                   the PATH of every file it serves (a screenshot named after
//                   the old product is public under that name).
//                   Floor: sites/nikatru/index.html was read.
//                   TEXT is decided by CONTENT, not by extension: a served file
//                   is read as text unless its first 8 KiB hold a NUL byte (an
//                   image, a font). A file with no extension, or with a type no
//                   list anticipated, is still read. Measured 2026-09-22 over
//                   both served roots: the 17 images all hold a NUL; the 40
//                   other files hold none.
//   2. web          apps/*/web/** and the app brick's web/** — the same rule,
//                   for the shell each app ships. Floor: one web/index.html.
//   3. arb          UI strings: the VALUE of every top-level key not starting
//                   with `@`, in apps/*/lib/l10n, packages/*/lib/src/l10n and
//                   the app brick's lib/l10n. Floor: one value.
//   4. store        apps/*/store/*/*.txt — the listing copy that is uploaded.
//                   Floor: one title.txt.
//   5. issue-forms  .github/ISSUE_TEMPLATE/* — public forms on the repository.
//                   Floor: one file.
//
// ── WHAT IS NOT READ, AND WHY ────────────────────────────────────────────────
//   · Files a deploy root does not serve (../sites/served.mjs): Pages' own
//     control files (`_headers`, `_redirects`, …), `functions/`, and on the apex
//     every `*.md`, which the router answers 404 for since 2026-09-22.
//   · `@key` entries in an .arb: a translator reads those, a customer does not.
//   · sites/rajasekarselvam/**: a different site, not a Nikatru surface.
//   · Comments, history and fixtures elsewhere in the tree: they record what
//     happened, and assert-retired-names.mjs covers live resource names.
//
// ── THE ONE EXEMPTION: DATED LEGAL SNAPSHOTS, BY EXACT PATH ──────────────────
// A dated policy under sites/nikatru/legal/<date>/ is the record of what a user
// agreed to on that date. Editing it would falsify that record, so each one is
// listed below by its exact path with its reason, and every green run prints how
// many were exempt and why. A snapshot at a path not listed IS scanned, and a
// listed path that no longer exists is a finding.
//
// Matching: every run of [A-Za-z0-9._-] is compared with retiredIn(), which is
// case- and separator-insensitive, so `Subly`, `SUBLY`, `sub-ly` and
// `subly.nikatru.com` are one refusal. A run never crosses whitespace or `<`/`>`.
//
// Exit: 0 = clean · 1 = a customer-visible surface names a retired product ·
//       2 = COVERAGE LOST (a surface read less than its floor)
// Usage: node tooling/ci/assert-retired-names-visible.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { RETIRED_REGISTER_REL, retiredIn, tokensFrom } from './retired-identity.mjs';
import { CHROME_ROOT } from '../sites/chrome.mjs';
import { servedAt } from '../sites/served.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const abs = (p) => join(ROOT, p);

/** Dated consent records. Exact paths; a new snapshot is scanned until it is
 *  listed here with its own reason. */
const LEGAL_SNAPSHOTS_EXEMPT = [
  {
    path: 'sites/nikatru/legal/2026-07-26/en/privacy.html',
    why: 'dated privacy policy — the record of what a user agreed to on 2026-07-26; editing it falsifies that record',
  },
  {
    path: 'sites/nikatru/legal/2026-08-01/en/privacy.html',
    why: 'dated privacy policy — the record of what a user agreed to on 2026-08-01; editing it falsifies that record',
  },
  {
    path: 'sites/nikatru/legal/2026-08-10/en/privacy.html',
    why: 'dated privacy policy — the record of what a user agreed to on 2026-08-10; editing it falsifies that record',
  },
  {
    path: 'sites/nikatru/legal/2026-09-05/en/privacy.html',
    why: 'dated privacy policy — the record of what a user agreed to on 2026-09-05; editing it falsifies that record',
  },
];
const EXEMPT = new Map(LEGAL_SNAPSHOTS_EXEMPT.map((e) => [e.path, e.why]));

const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

function coverageLost(lines) {
  console.error('✗ COVERAGE LOST — assert-retired-names-visible read too little to be evidence.');
  for (const l of lines) console.error(`    ${l}`);
  console.error('  2 is deliberately NOT a pass: a guard that checked nothing has proved nothing.');
  process.exit(2);
}

const listing = (relDir) => (existsSync(abs(relDir)) ? listDir(abs(relDir), { withFileTypes: true }) : []);

/** Every file under `relDir`, as paths relative to `relDir`. */
function walk(relDir) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const sub = stack.pop();
    for (const e of listing(sub ? `${relDir}/${sub}` : relDir)) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) out.push(rel);
    }
  }
  return out.sort();
}

// ── the tokens ───────────────────────────────────────────────────────────────
let register = null;
if (!existsSync(abs(RETIRED_REGISTER_REL))) coverageLost([`${RETIRED_REGISTER_REL} does not exist, so there is no retired name to look for.`]);
try {
  register = JSON.parse(readFileSync(abs(RETIRED_REGISTER_REL), 'utf8'));
} catch (err) {
  coverageLost([`${RETIRED_REGISTER_REL} is not valid JSON (${err.message}).`]);
}
const tokens = tokensFrom(register);
if (tokens.length === 0) {
  coverageLost([
    `${RETIRED_REGISTER_REL} declares no \`retiredIdentityTokens.tokens\`.`,
    'With no tokens this guard refuses nothing, and a retired name on a served page would read exactly like a clean one.',
  ]);
}

const findings = [];
const read = { site: 0, web: 0, arb: 0, store: 0, 'issue-forms': 0 };

function scanText(surface, rel, text) {
  read[surface]++;
  for (const [n, line] of text.split(/\r?\n/).entries()) {
    for (const m of line.matchAll(/[A-Za-z0-9._-]+/g)) {
      const hit = retiredIn(tokens, m[0]);
      if (hit) findings.push(`${rel}:${n + 1} → "${m[0]}" names the retired product "${hit}"`);
    }
  }
}
function scanPath(rel) {
  for (const m of rel.matchAll(/[A-Za-z0-9._-]+/g)) {
    const hit = retiredIn(tokens, m[0]);
    if (hit) findings.push(`${rel} → the file NAME "${m[0]}" names the retired product "${hit}"`);
  }
}

/** A served file's text, or null when it is binary. Binary is decided by CONTENT —
 *  a NUL byte in the first 8 KiB — never by extension, so a file with no extension
 *  or of a type nobody listed is still read. A binary file is read by PATH only. */
let binaryByPath = 0;
function textOf(rel) {
  const buf = readFileSync(abs(rel));
  if (buf.subarray(0, 8192).includes(0)) {
    binaryByPath++;
    return null;
  }
  return buf.toString('utf8');
}

// ── 1 · the served apex site ─────────────────────────────────────────────────
const exemptSeen = [];
let siteIndexRead = false;
for (const rel of walk(CHROME_ROOT)) {
  if (!servedAt(rel, { router: true })) continue;
  const full = `${CHROME_ROOT}/${rel}`;
  if (EXEMPT.has(full)) {
    exemptSeen.push(full);
    continue;
  }
  scanPath(full);
  const text = textOf(full);
  if (text !== null) {
    scanText('site', full, text);
    if (rel === 'index.html') siteIndexRead = true;
  }
}
for (const e of LEGAL_SNAPSHOTS_EXEMPT) {
  if (!exemptSeen.includes(e.path)) {
    findings.push(
      `${e.path} is listed in LEGAL_SNAPSHOTS_EXEMPT and is not a served file. Remove the entry: an exemption with no subject passes vacuously.`,
    );
  }
}
if (!siteIndexRead) coverageLost([`${CHROME_ROOT}/index.html was not read, so the served site was not evidence.`]);

// ── 2 · app web shells ───────────────────────────────────────────────────────
const webDirs = [];
for (const e of listing('apps')) {
  if (e.isDirectory() && !e.name.startsWith('.') && existsSync(abs(`apps/${e.name}/web`))) webDirs.push(`apps/${e.name}/web`);
}
if (existsSync(abs(`${BRICK_APP}/web`))) webDirs.push(`${BRICK_APP}/web`);
let webIndexRead = 0;
for (const dir of webDirs) {
  for (const rel of walk(dir)) {
    if (!servedAt(rel)) continue;
    const full = `${dir}/${rel}`;
    scanPath(full);
    const text = textOf(full);
    if (text !== null) {
      scanText('web', full, text);
      if (rel === 'index.html') webIndexRead++;
    }
  }
}
if (webIndexRead === 0) coverageLost(['no apps/*/web/index.html was read, so no app web shell was evidence.']);

// ── 3 · UI strings ───────────────────────────────────────────────────────────
const arbDirs = [];
for (const e of listing('apps')) {
  if (e.isDirectory() && !e.name.startsWith('.')) arbDirs.push(`apps/${e.name}/lib/l10n`);
}
for (const e of listing('packages')) {
  if (e.isDirectory() && !e.name.startsWith('.')) arbDirs.push(`packages/${e.name}/lib/src/l10n`);
}
arbDirs.push(`${BRICK_APP}/lib/l10n`);
let arbValues = 0;
for (const dir of arbDirs) {
  for (const e of listing(dir)) {
    if (!e.isFile() || !e.name.endsWith('.arb')) continue;
    const rel = `${dir}/${e.name}`;
    const raw = readFileSync(abs(rel), 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      coverageLost([`${rel} is not valid JSON (${err.message}); its strings were not read.`]);
    }
    const lines = raw.split(/\r?\n/);
    for (const [key, value] of Object.entries(doc ?? {})) {
      if (key.startsWith('@') || typeof value !== 'string') continue;
      arbValues++;
      const at = lines.findIndex((l) => l.trimStart().startsWith(`${JSON.stringify(key)}`));
      for (const m of value.matchAll(/[A-Za-z0-9._-]+/g)) {
        const hit = retiredIn(tokens, m[0]);
        if (hit) findings.push(`${rel}:${at + 1} (${key}) → "${m[0]}" names the retired product "${hit}"`);
      }
    }
    read.arb++;
  }
}
if (arbValues === 0) coverageLost(['no .arb value was read, so no UI string was evidence.']);

// ── 4 · store listing copy ───────────────────────────────────────────────────
let titles = 0;
for (const app of listing('apps')) {
  if (!app.isDirectory() || app.name.startsWith('.')) continue;
  for (const channel of listing(`apps/${app.name}/store`)) {
    if (!channel.isDirectory()) continue;
    const dir = `apps/${app.name}/store/${channel.name}`;
    for (const f of listing(dir)) {
      if (!f.isFile() || !f.name.endsWith('.txt')) continue;
      scanText('store', `${dir}/${f.name}`, readFileSync(abs(`${dir}/${f.name}`), 'utf8'));
      if (f.name === 'title.txt') titles++;
    }
  }
}
if (titles === 0) coverageLost(['no apps/*/store/*/title.txt was read, so no store listing was evidence.']);

// ── 5 · issue forms ──────────────────────────────────────────────────────────
for (const f of listing('.github/ISSUE_TEMPLATE')) {
  if (!f.isFile()) continue;
  const rel = `.github/ISSUE_TEMPLATE/${f.name}`;
  scanPath(rel);
  scanText('issue-forms', rel, readFileSync(abs(rel), 'utf8'));
}
if (read['issue-forms'] === 0) coverageLost(['no .github/ISSUE_TEMPLATE/* file was read, so no public issue form was evidence.']);

// ── verdict ──────────────────────────────────────────────────────────────────
const summary = `${Object.entries(read)
  .map(([k, v]) => `${k} ${v}`)
  .join(' · ')} text file(s), ${binaryByPath} binary file(s) by path only`;
const exemptLine = `exempt ${exemptSeen.length} dated legal snapshot(s) by path`;
if (findings.length > 0) {
  console.error(`✗ ${findings.length} customer-visible place(s) name a retired product:`);
  for (const f of findings) console.error(`    ${f}`);
  console.error(`  [ADR 074]: use the current name. read: ${summary}; ${exemptLine}; retired tokens: ${tokens.join(', ')}`);
  process.exit(1);
}
console.log(`✓ no customer-visible surface names a retired product (${tokens.join(', ')}). read: ${summary} (${arbValues} arb value(s)); ${exemptLine}:`);
for (const path of exemptSeen) console.log(`    ${path} — ${EXEMPT.get(path)}`);
