#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate.mjs — write vocabulary.json from vocabulary.js, or prove they agree.
//
//   node contracts/store/generate.mjs           rewrite vocabulary.json
//   node contracts/store/generate.mjs --check    exit 1 if it would change
//
// WHY THERE ARE TWO FILES AT ALL, since two files is exactly what this directory
// exists to stop. `vocabulary.js` is the artefact a browser extension, a
// Cloudflare Worker and every node guard can import with no tool in between —
// that is the whole no-build property, and it costs a JavaScript file. Readers
// that cannot import JavaScript (Dart, a YAML step, `jq` in a workflow) need the
// same table as data. So the second copy is unavoidable; what is avoidable is it
// being unchecked. `--check` in CI is what makes it a DERIVED copy rather than a
// second hand-maintained one.
//
// ⚠️ NO DEPENDENCIES, DELIBERATELY. This runs on plain node with no install, for
// the same reason nothing under extensions/ has a package.json.
//
// Exit codes: 0 agreed (or written) · 1 a difference, or a coverage floor.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_VOCABULARY, VOCABULARY_AXES } from './vocabulary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'vocabulary.json');
const REL = 'contracts/store/vocabulary.json';
const check = process.argv.includes('--check');

const payload = {
  $schema: './vocabulary.schema.json',
  ...JSON.parse(JSON.stringify(STORE_VOCABULARY)),
};

// ── COVERAGE SELF-CHECKS ─────────────────────────────────────────────────────
// An empty axis would serialise perfectly and read exactly like a clean run, and
// every downstream "is this value declared?" check would pass vacuously over it.
// So each axis is asserted non-empty HERE, at the moment the file is written,
// rather than left for a reader to notice.
const emptyAxes = [];
for (const axis of VOCABULARY_AXES) {
  const value = payload[axis];
  if (value === undefined || value === null) {
    emptyAxes.push(`${axis} (absent from STORE_VOCABULARY)`);
    continue;
  }
  const size = Array.isArray(value) ? value.length : Object.keys(value).length;
  if (size === 0) emptyAxes.push(`${axis} (empty)`);
}
if (emptyAxes.length > 0) {
  console.error(`✗ COVERAGE LOST — vocabulary.js exported no members on ${emptyAxes.length} axis/axes, so ${REL}`);
  console.error('  would be written with an axis nothing can fail against. An empty set satisfies every');
  console.error('  downstream check vacuously; that is not a pass.');
  for (const a of emptyAxes) console.error(`    · ${a}`);
  process.exit(1);
}

// The listing-field table has a sharper floor than "non-empty": a table of rows
// where NONE is required on either surface is a listing vocabulary that requires
// no listing file, and it renders as valid JSON that reads exactly like a clean
// run.
const anyRequired = payload.listingFields.some((f) => f.app === 'required' || f.extension !== null);
if (!anyRequired) {
  console.error(`✗ COVERAGE LOST — no listing field is required on either surface, so ${REL} would carry a`);
  console.error('  listing vocabulary that requires nothing. That is not the same as a field nobody needed.');
  process.exit(1);
}

const rendered = JSON.stringify(payload, null, 2) + '\n';

if (!check) {
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`✓ wrote ${REL} — ${VOCABULARY_AXES.length} axes, ${payload.listingFields.length} listing field(s)`);
  process.exit(0);
}

if (!existsSync(OUT)) {
  console.error(`✗ ${REL} does not exist. Run: node contracts/store/generate.mjs`);
  process.exit(1);
}

const onDisk = readFileSync(OUT, 'utf8');
if (onDisk === rendered) {
  console.log(`✓ ${REL} agrees with vocabulary.js — ${VOCABULARY_AXES.length} axes, ${payload.listingFields.length} listing field(s)`);
  process.exit(0);
}

console.error(`✗ ${REL} does not match what vocabulary.js would generate.`);
console.error('  The JSON is DERIVED. Do not hand-edit it — edit vocabulary.js and run:');
console.error('    node contracts/store/generate.mjs');
process.exit(1);
