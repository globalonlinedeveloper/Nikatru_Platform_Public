#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-workspace-coverage.mjs — the gate must know when it is not looking.
//
// `melos run gate` (analyze + test) only visits packages named in the root
// `pubspec.yaml` → `workspace:` list. That list is maintained BY HAND, and
// nothing else checks it. So a Dart package that exists on disk but is missing
// from the list is never analyzed, never tested — and the gate still prints
// green, because from its point of view every member passed.
//
// This is the failure shape this repo keeps hitting (CLAUDE.md → Verification
// discipline): not a broken check, a check that quietly stopped checking.
// It has already cost us once — `packages/tokens` sat outside the workspace
// emitting a Dart file nobody consumed, and the gate could never have caught it.
//
// It also scales badly. `tooling/bricks/app/hooks/post_gen.dart` does not add a
// stamped app to `workspace:` (verified 2026-07-26 — the string does not appear
// in the file), so without this guard EVERY app the factory produces is born
// outside the gate.
//
// Checks, in order:
//   1. every dir with a pubspec.yaml under packages/ or apps/ IS a member
//   2. every member listed still EXISTS on disk (no stale entries)
//   3. coverage self-check: the scan found a plausible number of packages
//
// Deliberately NOT flagged: `packages/tokens` is a Node package with no
// pubspec.yaml, so it is invisible to this scan by construction — it is gated
// by its own CI lane instead. No exception list to maintain.
//
// Pipeline requirement: Private/requirements/ → F-1.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/assert-workspace-coverage.mjs
// Exit 0 = clean, 1 = a package is ungated (or a member is missing).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

const repoRoot = process.argv[2] ?? process.cwd();

/** Roots that may contain Dart workspace members. */
const SCAN_ROOTS = ['packages', 'apps'];

/** Directory names never worth descending into. */
const SKIP_DIRS = new Set(['build', '.dart_tool', 'node_modules', '.git', 'ios', 'android', 'macos', 'windows', 'linux', 'web']);

/** A scan that silently matches nothing would report "clean" forever. The repo
 *  has 10 members today (9 under `packages/`, 1 under `apps/`); anything below
 *  this floor means the scan itself broke (a rename, a moved directory, a bad
 *  cwd) rather than the tree being empty.
 *
 *  ⚠️ THIS NUMBER RANGES OVER THE UNION OF `SCAN_ROOTS`, so on its own it cannot
 *  see one root go quiet — `packages/` alone clears 5 twice over. The per-root
 *  floor further down is what covers that, and the two are not interchangeable.
 *  *(The count here read "8 members" from the day it was written until
 *  2026-08-17, while the guard printed 10 on every run. A floor reasoned from a
 *  stale number is a floor nobody can check by reading.)* */
const MIN_EXPECTED_PACKAGES = 5;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 1. the declared list ─────────────────────────────────────────────────────
const rootPubspec = join(repoRoot, 'pubspec.yaml');
if (!existsSync(rootPubspec)) {
  fail([`✗ root pubspec.yaml not found at ${rootPubspec} — cannot verify workspace coverage`]);
}

const text = readFileSync(rootPubspec, 'utf8');
const wsMatch = text.match(/^workspace:\s*$/m);
if (!wsMatch) {
  fail(['✗ no `workspace:` key in root pubspec.yaml — the melos workspace is undeclared']);
}

const declared = [];
const afterWs = text.slice(wsMatch.index + wsMatch[0].length).split('\n');
for (const raw of afterWs) {
  const line = raw.replace(/#.*$/, '');
  if (/^\s*-\s+\S/.test(line)) {
    declared.push(line.replace(/^\s*-\s+/, '').trim().replace(/\/+$/, ''));
  } else if (line.trim() !== '') {
    break; // first non-item, non-blank line ends the block
  }
}

// ── 2. what is actually on disk ──────────────────────────────────────────────
/** A dir is a Dart package iff it directly contains a pubspec.yaml. */
function findPackages(dir, rel, out) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.isFile() && e.name === 'pubspec.yaml')) {
    out.push(rel);
    return; // do not descend: nested example/ apps are not workspace members
  }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    findPackages(join(dir, e.name), posix.join(rel, e.name), out);
  }
}

const onDisk = [];
/** What each scan root contributed, kept separately so the floor below can be
 *  asked per root instead of once over the total. */
const perRoot = new Map();
for (const root of SCAN_ROOTS) {
  const abs = join(repoRoot, root);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
  const before = onDisk.length;
  findPackages(abs, root, onDisk);
  perRoot.set(root, onDisk.length - before);
}

// ── 3. coverage self-check, BEFORE reporting anything as clean ───────────────
if (onDisk.length < MIN_EXPECTED_PACKAGES) {
  fail([
    `✗ COVERAGE LOST — found only ${onDisk.length} dart package(s) under ${SCAN_ROOTS.join('/, ')}/,`,
    `  expected at least ${MIN_EXPECTED_PACKAGES}. The scan is broken, not the tree.`,
    `  repo root used: ${repoRoot}`,
  ]);
}

// 🔴 ONE FLOOR PER SCAN ROOT, because the count above is one number over a UNION
// and a union floor cannot see one member fall to zero. `packages/` holds 9 of
// the 10 members, so it clears 5 on its own and `apps/` — the root this whole
// repository exists to fill — can contribute NOTHING while the line above is
// comfortably satisfied.
//
// MEASURED on a copy of this repository, 2026-08-17: with `apps/` emptied (the
// directory kept) AND `- apps/subly` dropped from the `workspace:` block, this
// guard exited 0 and printed "ok  workspace coverage — 9 dart package(s) on
// disk, all gated". Section 4's two directions are both relationships between
// the declaration and the disk, so when a root leaves BOTH of them at once
// there is nothing left for them to disagree about — they go quiet together,
// which is precisely when a count is the only thing still watching.
//
// Only roots that EXIST are floored, and the residual is worth stating exactly
// rather than leaving to be rediscovered: a root that is ABSENT ALTOGETHER and
// declares nothing contributes zero here without tripping this floor. In a
// fixture tree that is correct — no `apps/` directory is a legitimately smaller
// subject. In THIS repository it is unreachable: the `workspace:` block names
// `apps/subly`, so deleting `apps/` leaves a declared member with nothing on
// disk and section 4's "listed but missing" direction fails first. Absence is
// therefore covered by the declaration, and this floor covers the case the
// declaration cannot see — a root that empties on BOTH sides at once.
{
  const quiet = [...perRoot].filter(([, n]) => n === 0).map(([root]) => root);
  if (quiet.length) {
    fail([
      `✗ COVERAGE LOST — ${quiet.map((r) => `${r}/`).join(', ')} exist(s) but yielded ZERO dart package(s).`,
      `  ${onDisk.length} package(s) were found in the other root(s), which is why the ${MIN_EXPECTED_PACKAGES}-package`,
      '  floor above stayed green — it counts the union, so it can never report a root that went silent.',
      '  Nothing under that root is gated by this run, and both checks below would still print "all gated".',
      `  repo root used: ${repoRoot}`,
    ]);
  }
}

// ── 4. the two directions ────────────────────────────────────────────────────
const declaredSet = new Set(declared);
const diskSet = new Set(onDisk);

const ungated = onDisk.filter((p) => !declaredSet.has(p)).sort();
const stale = declared.filter((p) => !diskSet.has(p)).sort();

const problems = [];
if (ungated.length) {
  problems.push(
    `✗ ${ungated.length} dart package(s) exist on disk but are NOT in the workspace:`,
    ...ungated.map((p) => `    ${p}/pubspec.yaml`),
    '  `melos run gate` will never analyze or test these, and will still report green.',
    '  Fix: add them under `workspace:` in the root pubspec.yaml.',
  );
}
if (stale.length) {
  problems.push(
    `✗ ${stale.length} workspace member(s) listed but missing from disk:`,
    ...stale.map((p) => `    ${p}`),
    '  Fix: remove the stale entry, or restore the package.',
  );
}
if (problems.length) fail(problems);

console.log(`ok  workspace coverage — ${onDisk.length} dart package(s) on disk, all gated`);
