#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate.mjs — write app-id.json from app-id.js, or prove they agree.
//
//   node contracts/app-id/generate.mjs           rewrite app-id.json
//   node contracts/app-id/generate.mjs --check    exit 1 if it would change; writes nothing
//
// `app-id.js` is what every node caller imports. `app-id.json` exists for the one
// reader that cannot import JavaScript: the brick's pre_gen.dart hook, which
// refuses a bad `app_id` before mason writes anything. `--check` in CI (and limb 1
// of tooling/ci/assert-app-id-contract.mjs) is what keeps the JSON a generated
// file rather than a second hand-maintained one. Same form as
// contracts/store/generate.mjs.
//
// ⚠️ NO DEPENDENCIES, DELIBERATELY: plain node, no install.
//
// Exit codes: 0 agreed (or written) · 1 a difference, or a coverage floor.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID_RULE, RESERVED, renderAppIdJson } from './app-id.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'app-id.json');
const REL = 'contracts/app-id/app-id.json';
const check = process.argv.includes('--check');

// ── COVERAGE SELF-CHECKS ─────────────────────────────────────────────────────
// A reserved word the pattern could never accept is a list entry that refuses
// nothing, and a rule whose bounds cross accepts nothing at all. Both would
// serialise perfectly, so each is refused HERE, before the file is written.
const floors = [];
const pattern = new RegExp(APP_ID_RULE.pattern);
if (!Number.isInteger(APP_ID_RULE.minLength) || !Number.isInteger(APP_ID_RULE.maxLength) || APP_ID_RULE.minLength > APP_ID_RULE.maxLength) {
  floors.push(`the length bounds ${APP_ID_RULE.minLength}..${APP_ID_RULE.maxLength} admit no id`);
}
if (RESERVED.length === 0) floors.push('RESERVED is empty');
for (const word of RESERVED) {
  if (!pattern.test(word) || word.length < APP_ID_RULE.minLength || word.length > APP_ID_RULE.maxLength) {
    floors.push(`reserved word ${JSON.stringify(word)} is outside the rule, so listing it refuses nothing`);
  }
}
if (floors.length > 0) {
  console.error(`✗ COVERAGE LOST — app-id.js would write ${REL} with a rule that cannot mean what it says:`);
  for (const f of floors) console.error(`    · ${f}`);
  process.exit(1);
}

const rendered = renderAppIdJson();

if (!check) {
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`✓ wrote ${REL} — pattern ${APP_ID_RULE.pattern}, ${APP_ID_RULE.minLength}-${APP_ID_RULE.maxLength} characters, ${RESERVED.length} reserved word(s)`);
  process.exit(0);
}

if (!existsSync(OUT)) {
  console.error(`✗ ${REL} does not exist. Run: node contracts/app-id/generate.mjs`);
  process.exit(1);
}

if (readFileSync(OUT, 'utf8') === rendered) {
  console.log(`✓ ${REL} agrees with app-id.js — pattern ${APP_ID_RULE.pattern}, ${APP_ID_RULE.minLength}-${APP_ID_RULE.maxLength} characters, ${RESERVED.length} reserved word(s)`);
  process.exit(0);
}

console.error(`✗ ${REL} does not match what app-id.js would generate.`);
console.error('  The JSON is GENERATED. Do not hand-edit it — edit app-id.js and run:');
console.error('    node contracts/app-id/generate.mjs');
process.exit(1);
