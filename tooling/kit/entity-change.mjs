#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// entity-change.mjs --dry-run <proposed.json> — what a change of legal entity
// would touch, listed before anything is touched. A PLANNING TOOL FOR THE OWNER:
// it writes nothing, and prints field names and file paths, never a value.
//
// Owner, 2026-10-01: "may be we can migrate to PVT ltd, with which ever available
// company name, or in my wife name new company registration we might do but
// pipeline is base for future works." The pipeline half of such a move is one
// edit to tooling/house-identity.json and `node tooling/entity/render.mjs`. This
// lists that half AND the half no pipeline can do: the store consoles, the
// payment rails, the tax registrations and the vendor accounts that hang off the
// legal identity, each an owner step.
//
// THE PROPOSED FILE is a copy of tooling/house-identity.json with the new entity
// written in (or a file holding only `entity` and `people`, merged over the
// current source). It is never written anywhere.
//
// It reads Private `platform-state/identity.json` (`storeAccounts`, `vendors`)
// when the corpus is beside this repo, and prints LOST for those sections when
// it is not: the list is then the static one below, and says so.
//
// Usage:  node tooling/kit/entity-change.mjs --dry-run <proposed.json> [--root <dir>]
// Exit 0 = listed. 1 = the proposal cannot render (an unworded template, a
// missing field), each named. 2 = an input could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ENTITY_SOURCE, REPO_ROOT, entityContext, readJson } from '../entity/facts.mjs';
import { renderSurfaces, trackedTextFiles, readText } from '../entity/render.mjs';
import { renderEntity } from '../ports/render-entity.mjs';

const argv = process.argv.slice(2);
let root = REPO_ROOT;
let proposedPath = null;
let dry = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dry-run') { dry = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) proposedPath = argv[++i]; }
  else if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[++i]);
  else { console.error(`entity-change: REFUSED — unknown argument ${argv[i]}`); process.exit(2); }
}
if (!dry || !proposedPath) {
  console.error('entity-change: REFUSED — this tool only plans. Usage: node tooling/kit/entity-change.mjs --dry-run <proposed.json>');
  console.error('  The change itself is an edit to tooling/house-identity.json, then: node tooling/entity/render.mjs');
  process.exit(2);
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
let current, proposedRaw, surfaces;
try { current = readJson(root, ENTITY_SOURCE); } catch (e) { console.error(`entity-change: LOST — ${ENTITY_SOURCE}: ${e.message}`); process.exit(2); }
try { proposedRaw = JSON.parse(readFileSync(resolve(proposedPath), 'utf8')); } catch (e) { console.error(`entity-change: LOST — ${proposedPath}: ${e.message}`); process.exit(2); }
try { surfaces = readJson(root, 'tooling/entity/surfaces.json'); } catch (e) { console.error(`entity-change: LOST — tooling/entity/surfaces.json: ${e.message}`); process.exit(2); }
const proposed = { ...current, ...proposedRaw };

// ── 1. THE FACTS THAT CHANGE ─────────────────────────────────────────────────
const leaves = (node, path, out) => {
  if (Array.isArray(node)) { node.forEach((v, i) => leaves(v, `${path}[${i}]`, out)); return out; }
  if (isObj(node)) { for (const [k, v] of Object.entries(node)) if (!k.startsWith('_') && k !== 'why' && k !== 'brain') leaves(v, path ? `${path}.${k}` : k, out); return out; }
  out.set(path, node);
  return out;
};
const before = leaves({ entity: current.entity, people: current.people }, '', new Map());
const after = leaves({ entity: proposed.entity, people: proposed.people }, '', new Map());
const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k)).sort();
const ENUMS = new Set(['entity.form.value']);
const out = [];
const say = (s = '') => out.push(s);
say(`ENTITY CHANGE — DRY RUN. Nothing is written. Source: ${ENTITY_SOURCE}; proposal: ${proposedPath}`);
say('');
say(`1. FACTS THAT CHANGE (${changed.length}) — names only; the values are in the two files`);
for (const k of changed) say(`   · ${k}${ENUMS.has(k) ? `: ${before.get(k)} → ${after.get(k)}` : ''}`);
if (!changed.length) say('   (none: the proposal equals the current source)');

// ── 2. GENERATED SURFACES ────────────────────────────────────────────────────
const tracked = trackedTextFiles(root);
const curCtx = entityContext(current);
const newCtx = entityContext(proposed);
const now = renderSurfaces(root, { ctx: curCtx, surfaces, files: tracked });
const next = renderSurfaces(root, { ctx: newCtx, surfaces, files: tracked });
const moved = [...next.out].filter(([rel, v]) => now.out.get(rel)?.want !== v.want).map(([rel]) => rel).sort();
const worker = (() => { const a = renderEntity(current); const b = renderEntity(proposed); return a.text !== b.text ? 1 : 0; })();
say('');
say(`2. GENERATED SURFACES THAT WOULD CHANGE (${moved.length + worker}) — \`node tooling/entity/render.mjs\` rewrites every one`);
for (const rel of moved) say(`   · ${rel}`);
if (worker) say('   · services/platform/src/generated/entity.ts (tooling/ports/render-entity.mjs)');
const unworded = next.errors.filter((e) => !now.errors.some((n) => n.file === e.file && n.what === e.what));
if (unworded.length) {
  say('');
  say(`   ⛔ ${unworded.length} SURFACE(S) THE PROPOSAL CANNOT RENDER — word them in tooling/entity/surfaces.json (\`byForm\`) first.`);
  say("     (each file's FIRST refusal; word it and re-run to see the next)");
  for (const e of unworded) say(`   · ${e.file}: ${e.what}`);
}

// ── 3. RECORDS THAT STAY AS WRITTEN ──────────────────────────────────────────
say('');
say('3. RECORDS THAT KEEP THE OLD ENTITY, BY DESIGN (tooling/entity/surfaces.json `exempt`)');
for (const x of surfaces.exempt ?? []) say(`   · ${x.path} — ${x.kind}`);

// ── 4-7. THE OWNER'S STEPS ───────────────────────────────────────────────────
const PRIVATE = (() => {
  if (process.env.NIKATRU_PRIVATE_ROOT) return resolve(process.env.NIKATRU_PRIVATE_ROOT);
  for (let d = root; ; d = dirname(d)) {
    const c = join(d, 'Projects', 'Nikatru_Platform_Private');
    if (existsSync(c) && statSync(c).isDirectory()) return c;
    if (dirname(d) === d) return null;
  }
})();
let identity = null;
if (PRIVATE) { try { identity = JSON.parse(readFileSync(join(PRIVATE, 'platform-state', 'identity.json'), 'utf8')); } catch { identity = null; } }
const fromForm = before.get('entity.form.value');
const toForm = after.get('entity.form.value');
const formMoves = fromForm !== toForm;

const STORE_STEPS = {
  'google-play': 'Google Play — an ACCOUNT TRANSFER to the new entity\'s developer account (package ids are kept); re-verify the payments profile, and the BillDesk verification Google uses for international payouts (Google\'s KYC step, not a rail: the brain\'s vendors/google.md).',
  apple: 'Apple — Individual → Organization needs a D-U-N-S number for the new entity and an enrolment as an organisation; the App Store seller name becomes the legal entity name.',
  microsoft: 'Microsoft Partner Center — the account type is fixed at creation; the legal entity details and their verification move with the entity (Store and Edge Add-ons share the account).',
  'chrome-web-store': 'Chrome Web Store — the verified trader/publisher is the legal name today; re-verify under the new entity.',
  'mozilla-amo': 'Firefox Add-ons (AMO) — no account type; update the developer profile and the licensor in each listing.',
  'snap-store': 'Snap Store — the publisher name.',
  'apps-gov-in': 'apps.gov.in and API Setu — Individual today; the portal offers PVT, Gov, PSU or Individual, and a company re-registers as PVT.',
};
say('');
say(`4. STORES — owner steps, in the consoles${formMoves ? ` (form ${fromForm} → ${toForm})` : ''}`);
const stores = identity?.storeAccounts;
if (Array.isArray(stores)) {
  for (const s of stores) say(`   · [${s.entity ?? 'unrecorded'}] ${STORE_STEPS[s.store] ?? `${s.store} — the account holder.`}`);
} else {
  say('   LOST — Private platform-state/identity.json is not readable here, so the account types below are the static list:');
  for (const step of Object.values(STORE_STEPS)) say(`   · ${step}`);
}
say('');
say('5. PAYMENT RAILS — owner steps');
for (const [rail] of Object.entries(proposed.entity?.sellerOfRecord ?? {})) {
  if (rail.startsWith('_')) continue;
  const step = {
    paddle: 'Paddle — the seller entity and the payout account (Paddle stays merchant of record outside India).',
    razorpay: 'Razorpay — KYC under the new entity, a new merchant account, the GST invoice issuer.',
    appleIap: 'Apple in-app purchase — follows the Apple account (step 4).',
    playBilling: 'Google Play billing — follows the Play account and its payments profile (step 4).',
  }[rail] ?? `${rail} — the seller of record.`;
  say(`   · ${step}`);
}
say('   · RevenueCat — the account owner.');
say('');
say('6. TAX AND BANK — owner steps');
say('   · GST — a new registration per state for the new PAN (a GSTIN embeds the PAN); the LUT for exports again.');
say('   · TAN, the Udyam registration (a new one for a new enterprise), and a CIN or LLPIN where the form has one.');
say('   · The bank current account in the new entity\'s name, and every payout pointing at it.');
say('   · The accountant.');
say('');
say('7. VENDOR ACCOUNTS THAT HANG OFF THE IDENTITY — owner steps (billing entity, invoices, ownership)');
const vendors = identity?.vendors;
if (Array.isArray(vendors)) for (const v of vendors) say(`   · ${v.id}`);
else {
  say('   LOST — Private platform-state/identity.json is not readable here; the static list:');
  for (const v of ['Cloudflare (with the registrar)', 'the GitHub organisation', 'Google Workspace', 'Hostinger', 'Oracle Cloud', 'Resend (both accounts)', 'Anthropic', 'Supabase', 'AWS', 'Google Cloud']) say(`   · ${v}`);
}
say('');
say('8. WHO SIGNS');
const officers = proposed.entity?.officers;
say(`   · entity.officers is owner-only (${officers?.heldIn ?? 'Private platform-state/identity.json'}); it is never rendered. A company signs through its directors, an LLP through its designated partners.`);

// ── 9. UNCHANGED ─────────────────────────────────────────────────────────────
const appsDir = join(root, 'apps');
const apps = existsSync(appsDir) ? readdirSync(appsDir).filter((d) => existsSync(join(appsDir, d, 'app.yaml'))) : [];
say('');
say('9. UNCHANGED, said explicitly');
say(`   · the bundle and package ids (com.<ownerDomain>.<id>), the app ids (${apps.join(', ') || 'none found'}), the domain (${current.ownerDomain?.value ?? 'unrecorded'}) and the brand.`);
for (const id of apps) {
  const m = /^name:\s*(.+)$/m.exec(readText(root, `apps/${id}/app.yaml`) ?? '');
  const name = m?.[1].trim().replace(/^["']|["']$/g, '');
  if (!name) continue;
  const n = tracked.filter((f) => (readText(root, f) ?? '').includes(name)).length;
  say(`   · app ${id}: its display name is in apps/${id}/app.yaml and appears in ${n} tracked file(s) — a RENAME is a separate change (tooling/app-yaml/render.mjs), not an entity change.`);
}

console.log(out.join('\n'));
process.exit(unworded.length ? 1 : 0);
