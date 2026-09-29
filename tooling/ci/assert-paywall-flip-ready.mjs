#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-paywall-flip-ready.mjs — THE PAYWALL IS NOT SWITCHED ON WHILE A
// PRECONDITION OF THE SWITCH IS OPEN.
//
// ⏱ 2026-09-29 · AB-M2-01 (full-review round 2). Turning the paywall on is one
// config change — `paywall.enabled: true` for an app in
// services/platform/src/app-config-data.json — and until this guard nothing tied
// that change to what must be true first: a real Paddle cancel that ends
// access, a refund that stays revoked, a cancel the app can carry out, an
// account deletion that stops billing, a renewal notice for a 30-day trial, a
// sandbox purchase proof per rail. Each was known; none had an owner; and the
// switch would have gone through CI green with every one of them open.
//
// tooling/paywall-flip.json is the checklist. This guard:
//   1 REFUSES (exit 1) while any app whose served config resolves to
//     `paywall.enabled: true` has an OPEN precondition that applies to it.
//   2 REFUSES a CLOSED precondition that names no `verify` evidence, or names a
//     path that does not exist — closing a row by editing the list is not
//     closing it.
//   3 REFUSES a checklist that has lost a precondition this guard knows of
//     (REQUIRED_IDS): the list only grows; a row is closed, never deleted.
//   COVERAGE LOST (exit 2) when the checklist or the config cannot be read, or
//   either ranges over nothing.
//
// Not seen: the runtime KV override services/platform/src/config.ts reads. That
// switch is owner-gated; this list is what the owner reads before touching it.
//
// Usage:  node tooling/ci/assert-paywall-flip-ready.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CHECKLIST = 'tooling/paywall-flip.json';
const CONFIG = 'services/platform/src/app-config-data.json';

/** Every precondition this guard has been told of. A checklist missing one lost it. */
const REQUIRED_IDS = [
  'AB-M4-01',
  'AB-M4-02',
  'AB-M4-03-server',
  'AB-M4-03-client',
  'AB-M3-01',
  'AB-A5-02-server',
  'AB-A5-02-client',
  'AB-M4-07',
  'T-11',
  'REVENUECAT-LEG-A',
  'SANDBOX-PURCHASE-PROOF',
  'PRICES-READ-BACK',
  'PADDLE-CANCEL-SANDBOX',
];

const problems = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    coverageLost(`${rel} does not exist.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    coverageLost(`${rel} could not be parsed (${err.message}).`);
    return null;
  }
}

const checklist = readJson(CHECKLIST);
const config = readJson(CONFIG);

// ── the checklist's own shape (limbs 2 and 3) ────────────────────────────────
const rows = Array.isArray(checklist?.preconditions) ? checklist.preconditions : null;
if (checklist !== null && (rows === null || rows.length === 0)) {
  coverageLost(`${CHECKLIST} carries no \`preconditions\`, so a flip would be checked against nothing.`);
}
const seen = new Set();
for (const [i, r] of (rows ?? []).entries()) {
  const where = `${CHECKLIST} preconditions[${i}]`;
  if (typeof r?.id !== 'string' || r.id.trim() === '') {
    fail(`${where} has no \`id\`.`);
    continue;
  }
  if (seen.has(r.id)) fail(`${where} repeats the id ${r.id}.`);
  seen.add(r.id);
  if (typeof r.what !== 'string' || r.what.trim() === '') fail(`${r.id} says nothing in \`what\`.`);
  if (!Array.isArray(r.apps) || r.apps.length === 0 || !r.apps.every((a) => typeof a === 'string' && a !== '')) {
    fail(`${r.id} names no \`apps\` (an app id, or "*" for every app).`);
  }
  if (typeof r.open !== 'boolean') {
    fail(`${r.id} has no boolean \`open\`.`);
    continue;
  }
  if (!r.open) {
    if (!Array.isArray(r.verify) || r.verify.length === 0) {
      fail(`${r.id} is closed with no \`verify\` evidence. Name the test, guard or record that proves it.`);
    } else {
      for (const v of r.verify) {
        if (typeof v !== 'string' || !existsSync(join(ROOT, v))) {
          fail(`${r.id} is closed on evidence that does not exist: ${JSON.stringify(v)}.`);
        }
      }
    }
  }
}
if (rows !== null) {
  for (const id of REQUIRED_IDS) {
    if (!seen.has(id)) {
      fail(`${CHECKLIST} has lost the precondition ${id}. A precondition is closed with evidence, never deleted.`);
    }
  }
}

// ── the switch (limb 1) ──────────────────────────────────────────────────────
const apps = config?.apps && typeof config.apps === 'object' ? Object.keys(config.apps) : [];
if (config !== null && apps.length === 0) {
  coverageLost(`${CONFIG} declares no app under \`apps\`, so no paywall switch was read.`);
}
const defaultOn = config?.defaults?.paywall?.enabled === true;
const on = apps.filter((id) => {
  const own = config.apps[id]?.paywall?.enabled;
  return own === true || (own === undefined && defaultOn);
});
const openRows = (rows ?? []).filter((r) => r?.open === true);
for (const app of on) {
  const blocking = openRows.filter((r) => Array.isArray(r.apps) && (r.apps.includes('*') || r.apps.includes(app)));
  for (const r of blocking) {
    fail(
      `${CONFIG} turns the paywall ON for ${app} while the precondition ${r.id} is OPEN: ${r.what}` +
        (typeof r.blockedOn === 'string' ? ` (blocked on: ${r.blockedOn})` : ''),
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ assert-paywall-flip-ready — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error(`  AB-M2-01: the paywall is switched on only when every precondition in ${CHECKLIST} is closed with evidence.`);
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
}
console.log(
  `ok  paywall flip — ${apps.length} app(s) read, ${on.length} with the paywall on; ` +
    `${rows.length} precondition(s), ${openRows.length} open` +
    (openRows.length ? ` (${openRows.map((r) => r.id).join(', ')})` : '') +
    '; every closed one names evidence that exists.',
);
