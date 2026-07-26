#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-lane-coverage.mjs — every deployable unit is claimed by a CI lane.
//
// The list of CI lanes is written by hand and nothing checks it is complete, so
// a new Worker, site or package is checked by nothing and CI still goes green.
// This is F-1's failure shape one level up: F-1 proved every *Dart package* is
// claimed by the gate; nothing proved every *deployable unit* is.
//
// It was not hypothetical. `sites/nikatru` — including a Pages Function holding
// a live KV binding — was covered by no lane at all while Cloudflare deployed it
// on every push.
//
// ⚠️ COVERAGE IS PER TYPE. A naive "is this path named in a workflow?" reports
// every Dart package as uncovered, because melos covers members collectively and
// never names them. A guard that cries wolf on eight packages gets switched off,
// so each unit type is checked against the mechanism that actually covers it:
//
//   dart package   → is a member of the root pubspec `workspace:` list
//                    (F-1's assert-workspace-coverage then guards that list)
//   worker         → named in some file under .github/workflows/
//   node package   → named in some file under .github/workflows/
//   site           → named in some file under .github/workflows/
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-9.
//
// Usage:  node tooling/ci/assert-lane-coverage.mjs [repoRoot]
// Exit 0 = every unit is claimed, 1 = something is unclaimed (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const repoRoot = process.argv[2] ?? process.cwd();

/** Below this, the scan itself is broken rather than the tree being empty. */
const MIN_UNITS = 8;

const SKIP = new Set(['node_modules', 'build', '.dart_tool', '.wrangler', '_site', '.git']);

function dirs(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
    .map((e) => posix.join(rel, e.name));
}

const has = (unit, file) => existsSync(join(repoRoot, unit, file));

// ── enumerate deployable units ───────────────────────────────────────────────
const units = [];

for (const d of [...dirs('packages'), ...dirs('apps')]) {
  if (has(d, 'pubspec.yaml')) units.push({ path: d, type: 'dart' });
}
for (const d of dirs('services')) {
  if (has(d, 'wrangler.jsonc') || has(d, 'wrangler.toml')) units.push({ path: d, type: 'worker' });
}
for (const d of dirs('sites')) {
  // A deploy root ships an index.html. Source-only layers (an Eleventy include
  // layer, for instance) are not deploy roots and are caught as node packages.
  if (has(d, 'index.html')) units.push({ path: d, type: 'site' });
  else if (has(d, 'package.json')) units.push({ path: d, type: 'node' });
}
for (const d of dirs('packages')) {
  // Node packages living under packages/ (e.g. the design-token emitter).
  if (has(d, 'package.json') && !has(d, 'pubspec.yaml')) units.push({ path: d, type: 'node' });
}

// ── what covers each type ────────────────────────────────────────────────────
const wfDir = join(repoRoot, '.github', 'workflows');
const workflowText = existsSync(wfDir)
  ? readdirSync(wfDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => readFileSync(join(wfDir, f), 'utf8'))
      .join('\n')
  : '';

let workspaceMembers = new Set();
const rootPubspec = join(repoRoot, 'pubspec.yaml');
if (existsSync(rootPubspec)) {
  const text = readFileSync(rootPubspec, 'utf8');
  const m = text.match(/^workspace:\s*$/m);
  if (m) {
    for (const raw of text.slice(m.index + m[0].length).split('\n')) {
      const line = raw.replace(/#.*$/, '');
      if (/^\s*-\s+\S/.test(line)) workspaceMembers.add(line.replace(/^\s*-\s+/, '').trim().replace(/\/+$/, ''));
      else if (line.trim() !== '') break;
    }
  }
}

function isClaimed(unit) {
  if (unit.type === 'dart') return workspaceMembers.has(unit.path);
  return workflowText.includes(unit.path);
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (units.length < MIN_UNITS) {
  console.error(`✗ COVERAGE LOST — found only ${units.length} deployable unit(s), expected at least ${MIN_UNITS}.`);
  console.error(`  The scan is broken, not the tree. repo root used: ${repoRoot}`);
  process.exit(1);
}

const unclaimed = units.filter((u) => !isClaimed(u));
if (unclaimed.length) {
  console.error(`✗ ${unclaimed.length} deployable unit(s) are claimed by no CI lane:`);
  for (const u of unclaimed) {
    const how =
      u.type === 'dart'
        ? 'add it to the root pubspec.yaml `workspace:` list'
        : 'name it in a job under .github/workflows/';
    console.error(`    ${u.path}  (${u.type}) — ${how}`);
  }
  console.error('  An unclaimed unit is checked by nothing, and CI still reports green.');
  process.exit(1);
}

const byType = units.reduce((acc, u) => ({ ...acc, [u.type]: (acc[u.type] ?? 0) + 1 }), {});
const summary = Object.entries(byType)
  .map(([t, n]) => `${n} ${t}`)
  .join(', ');
console.log(`ok  lane coverage — ${units.length} deployable unit(s) (${summary}), all claimed`);
