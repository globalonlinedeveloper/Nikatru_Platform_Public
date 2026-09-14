#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-d1-location-hint.mjs — a D1 location hint is a LATENCY choice, never a
// residency one. Refuse a hint value D1 does not have, a D1 jurisdiction, and
// residency wording written beside a hint.
//
// Register row: O-DATA-RESIDENCY-HINT (the guard leg; the corpus half is not
// this file's).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// 🔴 `--location apac` HAS NEVER PUT A DATABASE IN INDIA AND CANNOT. D1's location
// hints are wnam, enam, weur, eeur, apac and oc; none of them names a country,
// and a hint only chooses where the PRIMARY is created, once, at create time.
// MEASURED 2026-09-14 against the account, read-only (`GET .../d1/database/<id>`
// and the `meta` of a `SELECT 1`):
//   · platform_db             running_in_region APAC · primary served from SIN
//   · subscriptiontracker_db  running_in_region APAC · primary served from KIX
//   · both: jurisdiction null, read_replication disabled. Neither is in India.
// The corpus had treated the hint as RESIDENCY in two documents that were later
// corrected, and the framing survived elsewhere; nothing in CI checked it. A
// residency sentence sitting beside a hint is a public statement about where
// data lives that the platform cannot make true — so it is refused here, where
// the hint is written.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   H1 every `--location <v>` and every `location_hint` / `locationHint` /
//      `primary_location_hint` value in the scanned files is one of D1's six
//      hints; a value that reads as India (in, india, bom, del, maa, blr,
//      mumbai, ap-south…) is named as the residency claim it is
//   H2 provision-backend.mjs's VALID_HINTS is EXACTLY those six — the one list
//      a create call is validated against
//   H3 no D1 jurisdiction (`--jurisdiction`, a `"jurisdiction"` key in a wrangler
//      config): D1's jurisdictions are eu and fedramp, so one could only pin
//      data somewhere other than India — provision-backend.mjs:16-29 says why
//      it is the wrong tool
//   H4 no residency wording (residency, resident, data localisation, in-country,
//      stored/kept/hosted in India, sovereign) within WINDOW lines of a hint
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
// It does not call Cloudflare: CI has no token and forks would fail for people
// rather than for defects. The live placement above is recorded, not re-read.
// It does not read privacy copy or the private corpus — legal wording is the
// owner's, and the corpus is not in this repository.
//
// Usage:  node tooling/ci/assert-d1-location-hint.mjs [repoRoot]
// Exit 0 = clean. Exit 1 = a finding. Exit 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const D1_HINTS = ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc'];
const SCAN_ROOTS = ['services', 'tooling/scripts', 'tooling/bricks', 'docs'];
const PROVISION = 'tooling/scripts/provision-backend.mjs';
const TEXT = /\.(mjs|cjs|js|ts|jsonc|json|toml|md|ya?ml|sh|ps1|dart)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.dart_tool', '.wrangler']);
const WINDOW = 6;

const INDIA_VALUE = /^(in|ind|india|bom|del|maa|blr|hyd|ccu|mumbai|delhi|chennai|bangalore|bengaluru|ap-south(-\d)?|asia-south\d?)$/i;
const RESIDENCY = /residen(cy|t|ce)|data locali[sz]ation|in-country|sovereign|(stor|kept|keep|host|held|hold|resid|lives?|stays?|remain)[a-z]* (only |exclusively |entirely )?(in|within) india/i;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

const files = [];
const walk = (abs) => {
  for (const e of listDir(abs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(abs, e.name));
    } else if (TEXT.test(e.name)) {
      files.push(join(abs, e.name));
    }
  }
};
for (const r of SCAN_ROOTS) {
  const abs = join(ROOT, r);
  if (!existsSync(abs)) coverageLost([`${r}/ does not exist under ${ROOT}. The scan is broken, not the tree.`]);
  walk(abs);
}

const rel = (abs) => relative(ROOT, abs).split(sep).join('/');
const problems = [];
let hintValues = 0;
let apacSeen = 0;

// `--location <v>` (curl's bare `--location` is followed by another flag, a
// quoted url or a line continuation, none of which is an identifier).
const FLAG_LOC = /--location(?:=|\s+)[`'"]?([A-Za-z][A-Za-z0-9-]*)\b/g;
const KEY_LOC = /\b(?:primary_location_hint|location_hint|locationHint)\b["'`]?\s*[:=]\s*["'`]([^"'`\s]+)["'`]/g;
const JURISDICTION_FLAG = /--jurisdiction(?:=|\s+)[`'"]?([A-Za-z][A-Za-z0-9-]*)/g;
const HINT_MENTION = /--location\s+[`'"]?(wnam|enam|weur|eeur|apac|oc)\b|location_hint|locationHint/;

for (const abs of files) {
  const text = readFileSync(abs, 'utf8');
  if (!/--location|location_hint|locationHint|--jurisdiction|"jurisdiction"/.test(text)) continue;
  const lines = text.split('\n');
  const where = rel(abs);
  const mentionLines = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(FLAG_LOC)) {
      if (m[1] === 'retry' || /^--/.test(m[1])) continue;
      judgeValue(m[1], `${where}:${i + 1}`);
    }
    for (const m of line.matchAll(KEY_LOC)) {
      if (/^\$\{|^</.test(m[1])) continue;
      judgeValue(m[1], `${where}:${i + 1}`);
    }
    for (const m of line.matchAll(JURISDICTION_FLAG)) {
      problems.push(`H3 ${where}:${i + 1} passes \`--jurisdiction ${m[1]}\`. D1 jurisdictions are eu and fedramp; neither is India, and ${PROVISION} records why a jurisdiction is the wrong tool here.`);
    }
    if (/wrangler\.jsonc?$/.test(where) && /"jurisdiction"\s*:/.test(line)) {
      problems.push(`H3 ${where}:${i + 1} sets a D1 "jurisdiction". D1 jurisdictions are eu and fedramp; neither is India.`);
    }
    if (HINT_MENTION.test(line)) mentionLines.push(i);
  });
  for (const i of mentionLines) {
    for (let j = Math.max(0, i - WINDOW); j <= Math.min(lines.length - 1, i + WINDOW); j++) {
      const hit = lines[j].match(RESIDENCY);
      if (hit) {
        problems.push(
          `H4 ${where}:${j + 1} says "${hit[0]}" within ${WINDOW} lines of the D1 location hint at :${i + 1}. ` +
            'The hint is LATENCY: it picks the region of the primary once, at create time, and apac has never placed a database in India ' +
            '(measured 2026-09-14: platform_db primary SIN, subscriptiontracker_db primary KIX).',
        );
      }
    }
  }
}

function judgeValue(v, at) {
  hintValues++;
  if (v === 'apac') apacSeen++;
  if (D1_HINTS.includes(v)) return;
  problems.push(
    INDIA_VALUE.test(v)
      ? `H1 ${at} uses D1 location "${v}", which reads as INDIA. D1 has no India location — its hints are ${D1_HINTS.join(', ')} — so this value is a residency claim the platform cannot make true.`
      : `H1 ${at} uses D1 location "${v}", which is not a D1 location hint (${D1_HINTS.join(', ')}).`,
  );
}

// ── H2 the validation list itself ────────────────────────────────────────────
const provAbs = join(ROOT, PROVISION);
if (!existsSync(provAbs)) coverageLost([`${PROVISION} does not exist, so the list a create call is validated against could not be read.`]);
const vh = readFileSync(provAbs, 'utf8').match(/const VALID_HINTS = \[([^\]]*)\]/);
if (!vh) coverageLost([`${PROVISION} no longer declares \`const VALID_HINTS = [...]\`; H2 has nothing to compare.`]);
const declared = [...vh[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
const extra = declared.filter((h) => !D1_HINTS.includes(h));
const missing = D1_HINTS.filter((h) => !declared.includes(h));
if (extra.length || missing.length) {
  problems.push(
    `H2 ${PROVISION} VALID_HINTS is [${declared.join(', ')}]` +
      `${extra.length ? `; not D1 hints: ${extra.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}. ` +
      `It must be exactly D1's ${D1_HINTS.length}.`,
  );
}

if (problems.length === 0 && (hintValues === 0 || apacSeen === 0)) {
  coverageLost([
    `scanned ${files.length} file(s) under ${SCAN_ROOTS.join(', ')} and read ${hintValues} location value(s), ${apacSeen} of them apac.`,
    'provision-backend.mjs and the brick both write `--location apac`; reading none means the scan stopped reaching them.',
  ]);
}

if (problems.length) {
  console.error(`✗ d1 location hint — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  O-DATA-RESIDENCY-HINT: a D1 location hint is latency, never residency.');
  process.exit(1);
}
console.log(
  `ok  d1 location hint — ${hintValues} location value(s) across ${files.length} scanned file(s), all D1 hints; ` +
    `VALID_HINTS is exactly [${D1_HINTS.join(', ')}]; no jurisdiction; no residency wording within ${WINDOW} lines of a hint`,
);
