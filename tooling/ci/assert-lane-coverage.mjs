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
//   extension      → is a row in extensions/catalog/extensions.json AND one
//                    workflow both invokes scripts/discover.mjs and sets
//                    `working-directory: extensions` (check-catalog.mjs then
//                    guards that list, the way assert-workspace-coverage guards
//                    the pubspec one)
//
// Pipeline requirement: Private/requirements/ → F-9.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-lane-coverage.mjs [repoRoot]
// Exit 0 = every unit is claimed, 1 = something is unclaimed (or the scan broke).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = process.argv[2] ?? process.cwd();

/** Below this, the scan itself is broken rather than the tree being empty. */
const MIN_UNITS = 8;

const SKIP = new Set(['node_modules', 'build', '.dart_tool', '.wrangler', '_site', '.git']);

function dirs(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return listDir(abs, { withFileTypes: true })
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
// 🔴 tooling/ IS A SCAN ROOT (2026-08-02, [pipeline 7]P-1). It was not, and that
// was invisible rather than deliberate: `tooling/` held only loose scripts run
// from other lanes, so nothing there was a UNIT. The content pipeline is a real
// node package with its own CI lane and its own test suite, and had this root
// stayed out it would have been the F-9 defect all over again — a deployable unit
// checked by nothing while CI printed "all claimed". The predicate is the same
// one packages/ uses (a package.json, no pubspec.yaml), so a future tooling
// package acquires the requirement by existing rather than by being remembered.
for (const d of dirs('tooling')) {
  if (has(d, 'package.json') && !has(d, 'pubspec.yaml')) units.push({ path: d, type: 'node' });
}

// 🔴 extensions/ IS A SCAN ROOT (2026-09-05, [ADR 067] decision 1). It arrived as
// a `git subtree add` of 542 files, and report 16 §8.2 measured what happens if
// this block is omitted: THIS GUARD PRINTS "17 deployable unit(s), all claimed"
// over a tree in which 542 files are covered by nothing. That is not a
// hypothetical — the five whole-tree guards were run against the merged tree
// before the merge and all five returned exit 0. A green run over an unguarded
// subtree is the exact "a scanner that silently stopped scanning" shape this
// file's own line 153 warns about, so the root and the claims land together.
//
// The unit is the TOOL, not the subtree: an extension is a directory under
// extensions/Extension/ carrying a tool.json, which is the same predicate
// extensions/scripts/discover.mjs uses to build the CI matrix. `core/`,
// `templates/` and `scripts/` are shared machinery, not deployable units — they
// are graded by the extension lanes rather than being lanes themselves, exactly
// as sites/_shared is.
for (const d of dirs('extensions/Extension')) {
  if (has(d, 'tool.json')) units.push({ path: d, type: 'extension' });
}

// ── what covers each type ────────────────────────────────────────────────────
// 🔴 COMMENTS AND EXCLUSIONS ARE NOT CLAIMS (2026-08-01 full-corpus review).
// isClaimed() was a raw substring match over the concatenated workflow text, so
// a unit named only in a `#` comment counted as covered — and that was not
// hypothetical: the two Cloudflare-Git sites' ENTIRE claim was the prose comment
// above the Site-integrity step, so gutting that step to `echo skipped` left the
// Pages Function with a live KV binding checked by nothing while this guard
// printed "all claimed". The signal was prose in BOTH directions: rewording the
// comment failed the build with the real checks untouched. A `paths-ignore:`
// entry — a path named precisely because CI must NOT run for it — counted as a
// claim too. So the claimable text is now comment-stripped and has every
// `paths-ignore:` block blanked before any path is looked for; the sites' claim
// itself became structural (ci.yml passes them as ARGUMENTS to
// check-site-integrity.mjs, which fails if a claimed root is not really scanned).
function claimableText(raw) {
  const lines = raw.split('\n');
  const out = [];
  let ignoreIndent = -1;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    if (ignoreIndent >= 0) {
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() === '' || indent > ignoreIndent) { out.push(''); continue; }
      ignoreIndent = -1;
    }
    if (/^\s*(['"]?)paths-ignore\1\s*:/.test(line)) {
      ignoreIndent = line.match(/^\s*/)[0].length;
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

const wfDir = join(repoRoot, '.github', 'workflows');
const workflowTexts = existsSync(wfDir)
  ? listDir(wfDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => claimableText(readFileSync(join(wfDir, f), 'utf8')))
  : [];
const workflowText = workflowTexts.join('\n');

// 🔴 THE EXTENSION LANE IS CLAIMED BY A PAIR OF FACTS IN ONE FILE, NOT BY A
// SUBSTRING IN THE CONCATENATION. The extension jobs run with
// `working-directory: extensions`, so the command they invoke reads
// `node scripts/discover.mjs` — the tree-relative form, which is what keeps
// `git subtree split --prefix=extensions` producing a repository whose commands
// still resolve. Searched over the joined text, `scripts/discover.mjs` would be
// satisfied by any workflow in the tree happening to mention it, which is the
// "a unit named only in a comment counted as covered" mistake this file already
// records once. So the two halves must appear in the SAME workflow file: the
// discoverer, and the working directory that makes it point at extensions/.
// ⚠️ ANCHORED TO A WHOLE LINE, AND THE LOOSE FORM WAS TRIED FIRST AND FAILED ITS
// OWN MUTATION TEST. `/working-directory:\s*extensions\b/` also matches
// `working-directory: extensions/Extension/<Tool>/test/e2e`, a STEP-level
// override three jobs further down — so re-pointing the workflow's DEFAULT at
// another directory left this guard green, because a Playwright step still
// mentioned the word. Measured 2026-09-05: with the loose form the mutation
// printed "all claimed"; with the anchored form it names the extension as
// unclaimed. The claim has to be the default that every gate command inherits,
// not any appearance of the directory's name.
const hasExtensionLane = workflowTexts.some(
  (t) => t.includes('scripts/discover.mjs') && /^[ \t]*working-directory:[ \t]*extensions[ \t]*$/m.test(t),
);

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

// ── the extension catalogue, read the same way pubspec's workspace list is ───
// extensions/catalog/extensions.json is an independently maintained registry —
// extensions/scripts/check-catalog.mjs §1 asserts "published slugs == extension-
// surface tool ids on disk", so it is a real second list rather than a copy of
// the walk above. That is what makes it usable both as a CLAIM (below) and as
// the scan-root cross-check (further below).
const catalogSlugs = new Set();
const extCatalog = join(repoRoot, 'extensions', 'catalog', 'extensions.json');
if (existsSync(extCatalog)) {
  try {
    for (const row of JSON.parse(readFileSync(extCatalog, 'utf8'))) {
      if (row && typeof row.slug === 'string') catalogSlugs.add(row.slug);
    }
  } catch {
    console.error(`✗ COVERAGE LOST — ${'extensions/catalog/extensions.json'} did not parse.`);
    console.error('  Every extension unit would then read as unclaimed for the wrong reason, or — worse — the');
    console.error('  cross-check below would pass over an empty set. Fix the JSON before reading this guard.');
    process.exit(1);
  }
}

/** The tool id, which is what discover.mjs emits and the catalogue keys on. */
function toolId(unitPath) {
  const f = join(repoRoot, unitPath, 'tool.json');
  try { return JSON.parse(readFileSync(f, 'utf8')).id; } catch { return null; }
}

function isClaimed(unit) {
  if (unit.type === 'dart') return workspaceMembers.has(unit.path);
  // 🔴 AN EXTENSION IS NEVER NAMED BY PATH IN A WORKFLOW, AND A GUARD THAT
  // DEMANDED IT WOULD BE PERMANENTLY RED. discover.mjs emits IDS, not paths, and
  // the workflow matrix is keyed on the id precisely so that a matrix never has
  // to translate a path anywhere. So the covering mechanism is the pair: the id
  // is published in the catalogue (which check-catalog.mjs holds equal to the
  // tools on disk), and one workflow really invokes the discoverer AGAINST THIS
  // SUBTREE — see hasExtensionLane above. Delete the discover step, or point the
  // lane at some other directory, and every extension unit goes unclaimed here,
  // which is the failure that absence IS.
  if (unit.type === 'extension') {
    const id = toolId(unit.path);
    return id !== null && catalogSlugs.has(id) && hasExtensionLane;
  }
  return workflowText.includes(unit.path);
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
if (units.length < MIN_UNITS) {
  console.error(`✗ COVERAGE LOST — found only ${units.length} deployable unit(s), expected at least ${MIN_UNITS}.`);
  console.error(`  The scan is broken, not the tree. repo root used: ${repoRoot}`);
  process.exit(1);
}

// 🔴 THE SCAN ROOTS ARE THEMSELVES CHECKED, against a manifest this guard does
// not own. Mutation-proven 2026-08-02: deleting the `tooling/` root above made
// tooling/content_pipeline stop being a unit, so it stopped being unclaimed, and
// this guard printed "16 deployable unit(s), all claimed" over a package no lane
// covered. A floor cannot see that — the count simply goes down — which is the
// "a scanner that silently stopped scanning" shape CLAUDE.md names first.
//
// pnpm-workspace.yaml is a SEPARATE, independently maintained list of node
// packages, so it can be compared: every member it declares must have been
// enumerated above. Dropping a scan root now fails naming the member it lost;
// dropping the member from the workspace instead is a change a reviewer sees.
const pnpmWorkspace = join(repoRoot, 'pnpm-workspace.yaml');
if (existsSync(pnpmWorkspace)) {
  const members = [];
  let inPackages = false;
  for (const raw of readFileSync(pnpmWorkspace, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
      if (m) members.push(m[1].replace(/\/+$/, ''));
      else if (line.trim() !== '') break;
    }
  }
  const paths = new Set(units.map((u) => u.path));
  const unseen = members.filter((m) => !m.includes('*') && !paths.has(m));
  if (unseen.length) {
    console.error(`✗ COVERAGE LOST — pnpm-workspace.yaml declares ${unseen.length} member(s) this scan never enumerated:`);
    for (const m of unseen) console.error(`    ${m}`);
    console.error('  A member that is not a UNIT here cannot be reported unclaimed, so removing a scan root looks');
    console.error('  exactly like a smaller tree. Add the scan root back, or remove the member in the same change.');
    process.exit(1);
  }
}

// The same cross-check, for the extensions scan root. extensions/catalog/
// extensions.json is maintained by a different script in a different tree, so
// dropping `extensions/Extension` from the walk above now fails NAMING THE SLUG
// IT LOST rather than quietly reporting a smaller world. Mutation-proven
// 2026-09-05: with the root removed this printed "COVERAGE LOST — extensions/
// catalog/extensions.json declares 1 published extension(s) this scan never
// enumerated: fullshot"; with it restored, exit 0.
if (catalogSlugs.size) {
  const seenIds = new Set(units.filter((u) => u.type === 'extension').map((u) => toolId(u.path)));
  const unseen = [...catalogSlugs].filter((s) => !seenIds.has(s));
  if (unseen.length) {
    console.error(
      `✗ COVERAGE LOST — extensions/catalog/extensions.json declares ${unseen.length} published extension(s) this scan never enumerated:`,
    );
    for (const s of unseen) console.error(`    ${s}`);
    console.error('  An extension that is not a UNIT here cannot be reported unclaimed, so removing the');
    console.error('  extensions scan root looks exactly like a smaller tree. Add the scan root back, or');
    console.error('  remove the catalogue row in the same change.');
    process.exit(1);
  }
}

const unclaimed = units.filter((u) => !isClaimed(u));
if (unclaimed.length) {
  console.error(`✗ ${unclaimed.length} deployable unit(s) are claimed by no CI lane:`);
  for (const u of unclaimed) {
    const how =
      u.type === 'dart'
        ? 'add it to the root pubspec.yaml `workspace:` list'
        : u.type === 'extension'
          ? 'publish its id in extensions/catalog/extensions.json, and keep a workflow whose defaults set `working-directory: extensions` and which runs scripts/discover.mjs'
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
