#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-selection-record.mjs — [pipeline N-9] the half of the selection gates
// that only a machine with BOTH trees can check.
//
// 🔴 WHY THIS IS NOT IN tooling/ci/. The stage doc's acceptance says the app's
// done-record "carries the link — a done-record with no selection link fails
// assert-app-dod.mjs (the link is checkable even though the judgment is not)".
// That sentence is FALSE AS WRITTEN. `assert-app-dod.mjs` runs in the public
// repo; the selection entry lives under `company/`, which is gitignored and
// invisible to CI. A guard there can assert that a STRING is present; it can
// never assert the string RESOLVES. This file is the correction, not the
// implementation of that sentence.
//
// The split, and each half is honest about which it is:
//   CI (assert-app-dod.mjs)  — the four fields are present, non-blank when the
//                              app claims done, `decided` a valid past date, and
//                              it PRINTS "not verifiable from the public repo"
//                              on every run rather than reporting a check it did
//                              not perform.
//   HERE (local)             — the sha256 really resolves against the file in
//                              company/. Corrupt or move the record and this
//                              goes red.
//
// Usage:  node tooling/scripts/check-selection-record.mjs [repoRoot] [--company <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const companyAt = argv.indexOf('--company');
const companyArg = companyAt === -1 ? null : argv[companyAt + 1];
const positional = argv.filter((a, i) => companyAt === -1 || (i !== companyAt && i !== companyAt + 1));

const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const COMPANY = resolve(companyArg ?? join(ROOT, 'company'));

const EXEMPT = new Set(['apps/subly']);
const problems = [];
const notes = [];

const pubspecPath = join(ROOT, 'pubspec.yaml');
if (!existsSync(pubspecPath)) {
  console.error('✗ COVERAGE LOST — no root pubspec.yaml, so the app domain could not be read.');
  process.exit(1);
}
const lines = readFileSync(pubspecPath, 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
if (at === -1) {
  console.error('✗ COVERAGE LOST — the root pubspec.yaml has no `workspace:` block; it IS the domain.');
  process.exit(1);
}
const apps = [];
for (const line of lines.slice(at + 1)) {
  if (/^\S/.test(line)) break;
  const m = line.match(/^\s*-\s*(\S+)\s*$/);
  if (m && m[1].startsWith('apps/') && !EXEMPT.has(m[1])) apps.push(m[1]);
}

// A run over zero apps has verified nothing, and saying "ok" would be the exact
// inflation this whole file exists to refuse.
if (apps.length === 0) {
  console.error('✗ COVERAGE LOST — the workspace lists no non-exempt app, so no selection record was checked.');
  console.error('  Every app in the tree is exempt by name; this script verified nothing and will not say ok.');
  process.exit(1);
}

let verified = 0;
for (const appDir of apps) {
  const appId = appDir.split('/').pop();
  const recPath = join(ROOT, appDir, 'dod.json');
  if (!existsSync(recPath)) {
    problems.push(`${appId}: no done-record at ${appDir}/dod.json.`);
    continue;
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(recPath, 'utf8'));
  } catch (e) {
    problems.push(`${appId}: ${appDir}/dod.json is not valid JSON (${e.message}).`);
    continue;
  }
  const sel = rec.selection ?? {};
  const link = typeof sel.record === 'string' ? sel.record.trim() : '';
  if (link === '') {
    // A stamped app has no selection record yet, and that is a real state rather
    // than a failure — CI already refuses a BLANK link on an app claiming done.
    notes.push(`${appId}: status "${rec.status}", no selection record linked yet — nothing to resolve.`);
    continue;
  }
  const target = join(COMPANY, link.replace(/^company\//, ''));
  if (!existsSync(target)) {
    problems.push(
      `${appId}: selection record "${link}" does not resolve — looked for ${target}. ` +
        'CI can only see that the string is there; this is the run that finds out whether it points at anything.',
    );
    continue;
  }
  const actual = createHash('sha256').update(readFileSync(target)).digest('hex');
  if (actual !== sel.sha256) {
    problems.push(
      `${appId}: selection record "${link}" hashes to ${actual}, the done-record claims ${sel.sha256}. ` +
        'The gate answers the owner signed are not the gate answers on disk.',
    );
    continue;
  }
  verified++;
}

if (notes.length) {
  console.log('⬜ notes:');
  for (const n of notes) console.log(`    ${n}`);
}
if (problems.length) {
  console.error(`✗ selection records — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline N-9] An unselected app is the most expensive defect the factory can produce —');
  console.error('  every downstream stage then runs at full cost on it.');
  process.exit(1);
}
console.log(
  `ok  selection records — ${apps.length} non-exempt app(s); ${verified} linked record(s) resolved and ` +
    `hashed as claimed, ${notes.length} not linked yet (private tree read from ${COMPANY})`,
);
