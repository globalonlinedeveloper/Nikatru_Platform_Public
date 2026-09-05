#!/usr/bin/env node
// [pipeline C-4] A PACKAGE IS EARNED, NEVER NAMED.
//
// A new package needs a STRUCTURAL reason — a native binary payload, a licence
// exposure, or a codegen step. A capability name is not a reason. 39-CHASSIS §2
// adjudicated this and it was written nowhere that binds, so nothing stopped the
// split-per-noun habit: followed loosely, the remaining gap list alone would
// spawn packages for share, deep-links, review, purchases, connectivity and
// analytics. Each one costs a pubspec, an analysis_options, a workspace entry, a
// test harness and a CI surface — forever, for one founder. Applied correctly,
// `share_plus` / `app_links` / `in_app_review` all land in the existing
// platform_storage, and only a genuine native or codegen payload earns a split.
//
// ── WHY A CLOSED ENUM AND NOT A JUSTIFICATION FIELD (C-4 lock amendment) ─────
// The obvious implementation is a free-text `why` on each package. It was
// rejected at lock time for the reason this repo keeps re-learning: a
// justification nobody can check is a justification that always passes. Any
// string satisfies it, including "we needed a home for this", which is precisely
// the naming-is-a-reason failure C-4 exists to stop.
//
// So each reason must SUBSTANTIATE ITSELF AGAINST THE TREE:
//   native-binary    → evidence.dependency must really be declared in that
//                      package's own pubspec
//   licence-exposure → evidence.dependency declared, and the licence named
//   codegen          → evidence.buildFile must really exist on disk
//   chassis          → evidence.ledgerTarget must be the destination of at
//                      least one MOVES row in tooling/chassis-ledger.json whose
//                      measured callSiteDelta is NEGATIVE
//   GRANDFATHERED    → predates the rule; requires a date and a detail, the
//                      date must be ON OR BEFORE the rule date, and it is
//                      PRINTED on every run rather than silently forgiven
//
// Measured against the tree 2026-07-28: of 8 packages, exactly 4 substantiate a
// reason (platform_storage, notifications, telemetry — native; tokens — codegen)
// and exactly 4 substantiate nothing (core, design_system, api_client,
// analysis). Those four are grandfathered with dates. An exemption you can see
// is safer than a justification that is not true.
//
// ── `chassis`, AND WHY IT IS NOT FREE TEXT EITHER (ADR 067 decision 2) ───────
// [ADR 065] moves the generic chassis out of the app tree and into packages,
// and [ADR 066] re-scoped that to a measured rule: A SCREEN MOVES ONLY WHEN THE
// CALL SITE MEASURABLY SHRINKS. That rule already has a machine-readable home —
// `tooling/chassis-ledger.json`, kept in bijection with the brick tree by
// `assert-chassis-ledger.mjs`, which refuses a `MOVES` row whose `callSiteDelta`
// is not negative and refuses a `target` that is not on disk.
//
// So a chassis package does not earn its place by being called a chassis. It
// earns it by being the TARGET of work the ledger has already measured as a
// shrink. `evidence.ledgerTarget` names the package path; this guard reads the
// ledger and requires at least one `MOVES` row landing inside it with a
// negative delta. A package nothing has moved into yet substantiates NOTHING,
// which is the correct answer — it is a package named before it was earned, the
// exact failure C-4 exists to stop.
//
// ── WHY `GRANDFATHERED` NOW CHECKS THE DATE ITSELF (ADR 066 defect 1) ────────
// [ADR 066] measured this guard's own line 195 — "A NEW package with no reason
// fails the build" — and found it FALSE. The branch checked only that
// `declaredOn` matched `/^\d{4}-\d{2}-\d{2}$/`, so a package created today,
// declared GRANDFATHERED with today's date and any sentence, passed and was
// merely PRINTED. "Predates the rule" was prose, not a check.
//
// It is a check now: the date must parse AND be on or before RULE_DATE, the day
// the four honest exemptions were recorded. A later date is not a grandfather
// clause, it is a new package claiming one — and the whole point of the enum is
// that a reason nobody can check always passes.
//
// ── WHY A SEPARATE GUARD ─────────────────────────────────────────────────────
// C-4's spec line says "assert-capability-register.mjs (register field)". This
// ships as its own guard instead, matching the pattern C-8's lock already
// settled for vendors: a new top-level key in the EXISTING register, read by a
// SEPARATE guard. Verified before relying on it — the register guard ignores
// unknown top-level keys, so this costs zero edits to a working guard. Recorded
// as a deliberate deviation, not an oversight.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = process.cwd();
const REGISTER = 'tooling/capability-register.json';
const LEDGER = 'tooling/chassis-ledger.json';
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

/** The day the four honest exemptions were recorded. A `declaredOn` after this
 *  is not "predates the rule" — see the header, [ADR 066] defect 1. */
const RULE_DATE = '2026-07-28';

const REASONS = {
  'native-binary': 'a platform payload that a Dart-only package cannot carry',
  'licence-exposure': 'a licence that must be isolated from the rest of the tree',
  codegen: 'a build step that produces artefacts, not a library',
  chassis: 'the measured destination of chassis work the ledger records as a call-site SHRINK',
  GRANDFATHERED: 'predates the rule — recorded and dated, never silently forgiven',
};

let register;
try {
  register = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (e) {
  console.error(`FAIL ${REGISTER} could not be read or parsed (${e.message}). The earn-reasons live here, so nothing can be checked.`);
  console.error('\nassert-package-earned: FAILED');
  process.exit(1);
}

const declared = register.packageEarnReasons;
if (!declared || typeof declared !== 'object') {
  console.error(`FAIL ${REGISTER} has no \`packageEarnReasons\` block. Without it every package is unjustified and this guard would have nothing to range over.`);
  console.error('\nassert-package-earned: FAILED');
  process.exit(1);
}

// ── The domain: package directories actually on disk. Read from the tree, never
//    listed here, so a new package cannot arrive unnoticed. ──────────────────
const pkgRoot = join(ROOT, 'packages');
const onDisk = existsSync(pkgRoot)
  ? listDir(pkgRoot).filter((d) => statSync(join(pkgRoot, d)).isDirectory()).map((d) => `packages/${d}`)
  : [];

// Coverage self-check. A domain scan that quietly returns nothing reads exactly
// like "every package is justified", and that failure has shipped here before.
const MIN_PACKAGES = 8;
if (onDisk.length < MIN_PACKAGES) {
  problems.push(
    `COVERAGE LOST — found only ${onDisk.length} package dir(s) under packages/, expected >= ${MIN_PACKAGES}. Either packages were deleted, or this scan has stopped seeing them and every remaining package is going unchecked.`,
  );
} else {
  ok(`${onDisk.length} package(s) on disk, each must be earned or dated`);
}

// Dependencies a package declares, for substantiating a claim. Comments stripped
// first: a commented-out dependency is not a dependency.
function declaredDeps(pkgDir) {
  const p = join(ROOT, pkgDir, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const deps = new Set();
  let inBlock = false;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[a-z_]+:/i.test(line)) { inBlock = /^dependencies:/.test(line); continue; }
    if (!inBlock) continue;
    const m = line.match(/^  ([a-z0-9_]+)\s*:/i);
    if (m) deps.add(m[1]);
  }
  return deps;
}

/** The chassis ledger's MOVES rows, or `null` when there is no ledger to read.
 *
 *  `null` and `[]` are DIFFERENT ANSWERS and the caller must keep them apart:
 *  an absent ledger means the claim could not be checked at all, an empty one
 *  means it was checked and nothing has moved. Collapsing the two is how a
 *  reader that stopped reaching its file starts reporting "no findings".
 *
 *  Only `MOVES` rows with a NEGATIVE `callSiteDelta` are returned, which is
 *  [ADR 066]'s rule restated: a screen moves only when the call site
 *  measurably shrinks. `assert-chassis-ledger.mjs` already refuses a row that
 *  breaks it, so this is a second reader of the same rule and not a second
 *  copy of it. */
function shrinkingMoves() {
  const p = join(ROOT, LEDGER);
  if (!existsSync(p)) return null;
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(ledger.files)) return null;
  return ledger.files.filter(
    (r) => r && r.verdict === 'MOVES' && typeof r.target === 'string' && typeof r.callSiteDelta === 'number' && r.callSiteDelta < 0,
  );
}

/** `target` lands inside `pkg` — a path prefix on a `/` boundary, so
 *  `packages/chassis_screens` does not match `packages/chassis_screens_x`. */
const landsIn = (target, pkg) => target === pkg || target.startsWith(`${pkg}/`);

let substantiated = 0;
for (const pkg of onDisk) {
  const entry = declared[pkg];
  if (!entry) {
    problems.push(
      `\`${pkg}\` exists but names no earn-reason. A package is earned, never named: give it one of ${Object.keys(REASONS).filter((r) => r !== 'GRANDFATHERED').join(' / ')} with evidence this guard can check against the tree, or GRANDFATHERED with a date and a reason. If it earns nothing, the capability belongs in an existing package — that is the whole point of the rule.`,
    );
    continue;
  }
  if (!REASONS[entry.reason]) {
    problems.push(`\`${pkg}\` claims reason \`${entry.reason}\`, which is not in the closed enum (${Object.keys(REASONS).join(', ')}). Free text was rejected deliberately: a justification nobody can check always passes.`);
    continue;
  }

  const ev = entry.evidence ?? {};
  switch (entry.reason) {
    case 'native-binary':
    case 'licence-exposure': {
      if (!ev.dependency) {
        problems.push(`\`${pkg}\` claims \`${entry.reason}\` but names no evidence.dependency, so the claim cannot be substantiated against the tree.`);
        break;
      }
      if (entry.reason === 'licence-exposure' && !ev.licence) {
        problems.push(`\`${pkg}\` claims \`licence-exposure\` without naming evidence.licence — the licence IS the exposure, so an unnamed one substantiates nothing.`);
        break;
      }
      const deps = declaredDeps(pkg);
      if (deps === null) {
        problems.push(`\`${pkg}\` claims \`${entry.reason}\` via \`${ev.dependency}\`, but has no pubspec.yaml to substantiate it against.`);
      } else if (!deps.has(ev.dependency)) {
        problems.push(
          `\`${pkg}\` claims \`${entry.reason}\` via \`${ev.dependency}\`, but its pubspec does not declare that dependency. The reason this package exists has been removed, so either the claim is stale or the package no longer earns its place.`,
        );
      } else {
        substantiated++;
      }
      break;
    }
    case 'codegen': {
      if (!ev.buildFile) {
        problems.push(`\`${pkg}\` claims \`codegen\` but names no evidence.buildFile, so there is nothing on disk to check.`);
      } else if (!existsSync(join(ROOT, ev.buildFile))) {
        problems.push(`\`${pkg}\` claims \`codegen\` via \`${ev.buildFile}\`, which does not exist. A build step that is not there is not a reason to be a package.`);
      } else {
        substantiated++;
      }
      break;
    }
    case 'chassis': {
      if (!ev.ledgerTarget) {
        problems.push(
          `\`${pkg}\` claims \`chassis\` but names no evidence.ledgerTarget, so there is no ledger row to check the claim against. [ADR 066]: a screen moves only when the call site measurably shrinks, and the ledger is where that measurement lives.`,
        );
        break;
      }
      const moves = shrinkingMoves();
      if (moves === null) {
        problems.push(
          `COVERAGE LOST — \`${pkg}\` claims \`chassis\` via \`${ev.ledgerTarget}\`, but ${LEDGER} could not be read as a ledger with a \`files\` array. The claim was not checked against anything, which is not the same as passing.`,
        );
        break;
      }
      const landed = moves.filter((r) => landsIn(r.target, ev.ledgerTarget));
      if (landed.length === 0) {
        problems.push(
          `\`${pkg}\` claims \`chassis\` via \`${ev.ledgerTarget}\`, but ${LEDGER} holds no MOVES row landing there with a NEGATIVE callSiteDelta (${moves.length} shrinking MOVES row(s) in the ledger overall). A package nothing has measurably moved into is a package NAMED, not earned — [ADR 066]'s rule is that the call site has to get smaller, and a row with a delta of zero or more is exactly the case that rule refuses.`,
        );
        break;
      }
      substantiated++;
      break;
    }
    case 'GRANDFATHERED': {
      const declaredOn = entry.declaredOn ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(declaredOn)) {
        problems.push(`\`${pkg}\` is GRANDFATHERED without a \`declaredOn\` date. An undated exemption is permanent by accident — the date is what makes it reviewable.`);
      } else if (declaredOn > RULE_DATE) {
        problems.push(
          `\`${pkg}\` is GRANDFATHERED with \`declaredOn\` ${declaredOn}, which is AFTER the rule date ${RULE_DATE}. GRANDFATHERED means "predates the rule"; a package declared after it is a new package claiming an exemption it cannot have. Give it one of ${Object.keys(REASONS).filter((r) => r !== 'GRANDFATHERED').join(' / ')} with evidence this guard can check, or the capability belongs in an existing package. ([ADR 066] measured this branch passing a brand-new package declared with the day's own date — the words "predates the rule" were prose until now.)`,
        );
      }
      if (!entry.detail) {
        problems.push(`\`${pkg}\` is GRANDFATHERED with no \`detail\`. The point of recording it is that the next person can tell whether it still applies.`);
      }
      break;
    }
  }
}

// Stale entries: a reason for a package that no longer exists inflates apparent
// rigour, the same way a coverage claim pointing at a deleted file does.
for (const pkg of Object.keys(declared)) {
  if (pkg.startsWith('_')) continue;
  if (!onDisk.includes(pkg)) {
    problems.push(`\`packageEarnReasons\` still justifies \`${pkg}\`, which no longer exists on disk. Delete the entry — a list that has drifted from the tree stops meaning anything.`);
  }
}

// A substantiation path that never runs is an assertion that cannot fail. Four
// packages substantiate a reason today; if that reaches zero, every remaining
// package is grandfathered and this guard has quietly become decorative.
if (substantiated === 0 && onDisk.length > 0) {
  problems.push(
    'COVERAGE LOST — not one package substantiated a structural reason. Either every package is now grandfathered (in which case the rule is enforcing nothing) or the substantiation checks have stopped running.',
  );
} else if (substantiated > 0) {
  ok(`${substantiated} package(s) substantiate a structural reason against the tree`);
}

const grandfathered = onDisk.filter((p) => declared[p]?.reason === 'GRANDFATHERED');
if (grandfathered.length) {
  notes.push(`⬜ ${grandfathered.length} package(s) earn NONE of the three structural reasons — dated, not forgiven:`);
  for (const p of grandfathered) notes.push(`   · ${p} (${declared[p].declaredOn}) — ${declared[p].detail}`);
  notes.push(
    `   (printed, not failed: merging them is churn across every pubspec and import. A NEW package with no reason fails the build — and since [ADR 066] so does a new one declared GRANDFATHERED, because \`declaredOn\` must now be on or before ${RULE_DATE} rather than merely look like a date.)`,
  );
}

if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-package-earned: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-package-earned: ok — ${onDisk.length} package(s), ${substantiated} substantiated, ${grandfathered.length} dated`);
}
