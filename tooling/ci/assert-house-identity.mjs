#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-house-identity.mjs — every extension carries the house identity.
//
// Row: O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY (limb 1).
//
// WHY. Each tool's publish/identity.json holds the owner domain its Firefox add-on
// id is built from (<slug>@<ownerDomain>), the listing's support address, its
// privacy URL and the storefront. Until tooling/house-identity.json existed those
// were four facts typed per tool, and the template shipped them as
// REPLACE-WITH-YOUR-DOMAIN.example: a new tool began with no usable Firefox
// identity, and AMO fixes an add-on's id at FIRST SIGNING, so a wrong one that
// ships once cannot be corrected. The house file now holds the four values and
// extensions/scripts/new-tool.mjs writes them into every stamped tool. This guard
// is what makes that a checked property rather than a stamp-time habit.
//
// LIMBS:
//   (a) the house file is readable, each of its four fields is a { value, why }
//       pair with a non-empty string value, none is a placeholder, and the privacy
//       pattern carries {slug}.
//   (b) every extensions/Extension/<dir>/publish/identity.json has slug equal to
//       its tool.json id, and ownerDomain, supportEmail, privacyPolicyUrl and
//       homepageUrl equal to the house values, with {slug} expanded in the
//       privacy pattern. A tool.json with no publish/identity.json is printed and
//       not graded here: extensions/scripts/policy-check.mjs owns whether a tool
//       must carry one.
//   (c) NOT IMPLEMENTED, deliberately. It would compare supportEmail with the
//       support address tooling/legal/policy-claims.json declares, and that file
//       declares none: its top-level keys (measured 2026-09-25) are _readme,
//       pages, siteRoot and claims, and the address appears only inside one
//       claim's prose. There is no key to read, so there is no limb.
//   (d) a run that read ZERO tool identities is COVERAGE LOST, exit 2. An
//       equality check over no tools passes vacuously and reads like a clean tree.
//
// EXIT: 0 green · 1 a finding · 2 COVERAGE LOST (the house file is missing or
// unreadable, extensions/Extension/ is missing, or no identity was read).
//
// Usage: node tooling/ci/assert-house-identity.mjs [repoRoot]
// Tests: tooling/ci/test/house-identity.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { isPlaceholderValue } from '../../extensions/scripts/lib/tool-identity.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const HOUSE_REL = 'tooling/house-identity.json';
const TOOLS_REL = 'extensions/Extension';
const FIELDS = ['ownerDomain', 'supportEmail', 'privacyPolicyUrlPattern', 'homepageUrl'];

/** The run could not look at its subject, so it is not evidence either way. */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}

/** The one placeholder test every extension script uses (the template's marker,
 *  or the reserved documentation domain at a host boundary). */
const isPlaceholder = isPlaceholderValue;

function readJson(abs) {
  try { return { value: JSON.parse(readFileSync(abs, 'utf8')) }; }
  catch (e) { return { error: String(e.message).split('\n')[0] }; }
}

const findings = [];

// ── (a) THE HOUSE FILE ─────────────────────────────────────────────────────────
const houseAbs = join(ROOT, HOUSE_REL);
if (!existsSync(houseAbs)) {
  coverageLost([
    `✗ COVERAGE LOST — ${HOUSE_REL} does not exist under ${ROOT}.`,
    '  Every tool identity is graded against it, so without it nothing below can be checked.',
  ]);
}
const houseRead = readJson(houseAbs);
if (houseRead.error || houseRead.value === null || typeof houseRead.value !== 'object' || Array.isArray(houseRead.value)) {
  coverageLost([
    `✗ COVERAGE LOST — ${HOUSE_REL} is not a JSON object (${houseRead.error ?? 'wrong shape'}).`,
    '  Every tool identity is graded against it, so without it nothing below can be checked.',
  ]);
}
const house = {};
for (const f of FIELDS) {
  const entry = houseRead.value[f];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    findings.push(`${HOUSE_REL}  ${f} is not a { value, why } object.`);
    continue;
  }
  if (typeof entry.value !== 'string' || entry.value === '') {
    findings.push(`${HOUSE_REL}  ${f}.value is not a non-empty string.`);
    continue;
  }
  if (typeof entry.why !== 'string' || entry.why.trim() === '') {
    findings.push(`${HOUSE_REL}  ${f}.why is missing. A house value nobody can explain is the next one changed by accident.`);
  }
  if (isPlaceholder(entry.value)) {
    findings.push(`${HOUSE_REL}  ${f} is a placeholder ("${entry.value}"). Every tool stamped from it would ` +
      'carry it, and the Firefox add-on id built from ownerDomain is fixed by AMO at first signing.');
  }
  house[f] = entry.value;
}
if (typeof house.privacyPolicyUrlPattern === 'string' && !house.privacyPolicyUrlPattern.includes('{slug}')) {
  findings.push(`${HOUSE_REL}  privacyPolicyUrlPattern carries no {slug}, so every tool would share one privacy URL.`);
}

// ── (b) EVERY TOOL'S IDENTITY ──────────────────────────────────────────────────
const toolsAbs = join(ROOT, TOOLS_REL);
if (!existsSync(toolsAbs) || !statSync(toolsAbs).isDirectory()) {
  coverageLost([
    `✗ COVERAGE LOST — ${TOOLS_REL}/ is not a directory under ${ROOT}.`,
    '  This guard has no subject, and "no findings" over no subject is not a pass.',
  ]);
}
let read = 0;
const notGraded = [];
for (const entry of listDir(toolsAbs, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const toolRel = `${TOOLS_REL}/${entry.name}`;
  const toolJsonAbs = join(toolsAbs, entry.name, 'tool.json');
  if (!existsSync(toolJsonAbs)) continue;
  const tool = readJson(toolJsonAbs);
  if (tool.error || typeof tool.value?.id !== 'string' || tool.value.id === '') {
    findings.push(`${toolRel}/tool.json  has no readable id (${tool.error ?? 'id missing'}), so its identity cannot be graded.`);
    continue;
  }
  const idRel = `${toolRel}/publish/identity.json`;
  const idAbs = join(toolsAbs, entry.name, 'publish', 'identity.json');
  if (!existsSync(idAbs)) { notGraded.push(`${toolRel} (no publish/identity.json)`); continue; }
  const idRead = readJson(idAbs);
  if (idRead.error || idRead.value === null || typeof idRead.value !== 'object' || Array.isArray(idRead.value)) {
    findings.push(`${idRel}  is not a JSON object (${idRead.error ?? 'wrong shape'}).`);
    continue;
  }
  read += 1;
  const id = idRead.value;
  const slug = tool.value.id;
  if (id.slug !== slug) {
    findings.push(`${idRel}  slug is ${JSON.stringify(id.slug)}, and tool.json's id is "${slug}". The slug is the ` +
      'left-hand side of the Firefox add-on id, so the two are one value.');
  }
  const expected = {
    ownerDomain: house.ownerDomain,
    supportEmail: house.supportEmail,
    privacyPolicyUrl: typeof house.privacyPolicyUrlPattern === 'string'
      ? house.privacyPolicyUrlPattern.split('{slug}').join(slug) : undefined,
    homepageUrl: house.homepageUrl,
  };
  for (const [field, want] of Object.entries(expected)) {
    if (want === undefined) continue; // the house field is already a finding under (a)
    if (id[field] !== want) {
      findings.push(`${idRel}  ${field} is ${JSON.stringify(id[field])}; the house value is "${want}" ` +
        `(${HOUSE_REL}). Change the house file for every tool, or say in it why this tool differs.`);
    }
  }
}

// ── (d) ZERO READ IS NOT A PASS ────────────────────────────────────────────────
if (read === 0) {
  coverageLost([
    `✗ COVERAGE LOST — no ${TOOLS_REL}/<tool>/publish/identity.json was read.`,
    notGraded.length ? `  Not graded: ${notGraded.join(', ')}.` : `  ${TOOLS_REL}/ holds no tool.json.`,
    '  An equality check over no tools passes vacuously and reads exactly like a clean tree.',
  ]);
}

for (const n of notGraded) console.log(`· not graded: ${n}`);
if (findings.length) {
  console.error(`✗ ${findings.length} house-identity finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ house identity: ${read} tool(s) read, each equal to ${HOUSE_REL}; limb (c) not implemented ` +
  '(tooling/legal/policy-claims.json declares no support-address key).');
