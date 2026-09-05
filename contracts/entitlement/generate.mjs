#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate.mjs — write contract.json from contract.js, or prove they agree.
//
//   node contracts/entitlement/generate.mjs           rewrite contract.json
//   node contracts/entitlement/generate.mjs --check   exit 1 if it would change
//
// WHY THERE ARE TWO FILES AT ALL, since two files is exactly what this directory
// exists to stop. `contract.js` is the artefact a browser extension and a
// Cloudflare Worker can import with no tool in between — that is the whole
// no-build property, and it costs a JavaScript file. Dart cannot import a
// JavaScript file, so the Dart generator needs the same table as data. So the
// second copy is unavoidable; what is avoidable is it being unchecked.
//
// `--check` runs in CI, which makes the pair a DERIVED copy rather than a second
// hand-maintained one. The copy that is still hand-maintained and still joined
// by nothing is services/platform/src/lib/mor/contract.ts — see ../README.md.
//
// ⚠️ NO DEPENDENCIES, DELIBERATELY. This runs on plain node with no install, for
// the same reason nothing under extensions/ has a package.json.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_TABLE } from './contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'contract.json');
const REL = 'contracts/entitlement/contract.json';
const check = process.argv.includes('--check');

const payload = {
  $schema: './contract.schema.json',
  ...JSON.parse(JSON.stringify(CONTRACT_TABLE)),
};
const rendered = JSON.stringify(payload, null, 2) + '\n';

// A COVERAGE SELF-CHECK, because an empty table would serialise perfectly and
// read exactly like a clean run.
if (!payload.revocationReasons?.length || !payload.moneyEnvironments?.length) {
  console.error(`✗ COVERAGE LOST — contract.js exported an empty table, so ${REL} would be written empty.`);
  console.error('  An empty set satisfies every downstream check vacuously; that is not a pass.');
  process.exit(1);
}

if (!check) {
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`ok  wrote ${REL} — ${payload.revocationReasons.length} revocation reason(s), ` +
    `${payload.moneyEnvironments.length} money environment(s)`);
  process.exit(0);
}

let current;
try { current = readFileSync(OUT, 'utf8'); }
catch { current = null; }

if (current === null) {
  console.error(`✗ ${REL} does not exist. Run: node ${'contracts/entitlement/generate.mjs'}`);
  process.exit(1);
}
if (current.replace(/\r\n/g, '\n') !== rendered) {
  console.error(`✗ ${REL} is not what contract.js derives — the two copies of the entitlement`);
  console.error('  vocabulary have drifted, which is the exact failure this directory exists to prevent.');
  console.error(`  Run: node contracts/entitlement/generate.mjs`);
  process.exit(1);
}

console.log(`ok  entitlement contract — ${REL} matches contract.js ` +
  `(${payload.revocationReasons.length} revocation reason(s), ${payload.moneyEnvironments.length} money environment(s))`);
