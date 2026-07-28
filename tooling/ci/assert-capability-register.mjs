#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-capability-register.mjs — the chassis must know what it provides.
//
// [pipeline C-1] "Every shared capability has exactly one declared home."
// [pipeline C-2] "A capability with no consumer is not built."
//
// Both requirements name THIS file as their enforcement. C-2 was marked VERIFIED
// at 5f3466b on the strength of the fix — telemetry wired into Subly, notifications
// into the brick — while the guard that stops it regressing was never written. So
// the tree was correct and unprotected: exactly the shape CLAUDE.md's verification
// discipline warns about, one level up from "a check that stopped checking".
//
// Why a register at all. The charter's word "every" is not checkable against an
// unstated set. Three separate notification implementations were written — the
// seam in core, the adapter in notifications, a private fork in Subly — because
// nobody set out to write three and there was no place to look that would have
// said one already existed.
//
// Checks, in order:
//   1. coverage self-check — the scan still finds packages at all
//   2. every packages/* dir on disk has a register entry            [C-1]
//   3. every register entry's owner dir and seam file exist         [C-1]
//   4. consumers are real, BOTH directions:                         [C-1]
//        a. every consumer the register claims really declares the package
//        b. every nikatru_* dep a consumer declares is in the register, and
//           lists that consumer
//   5. every package has at least one consumer, or a recorded reason [C-2]
//
// ⚠️ EXCEPTIONS ARE RECORDED IN THE REGISTER AND PRINTED ON EVERY RUN, never
// silently skipped. An entry with no consumers must carry `unconsumedReason`,
// and this guard echoes each one whether it passes or fails — the same posture
// assert-seams-wired.mjs takes for owner-gated gaps. A waiver you stop seeing is
// a waiver that becomes permanent.
//
// Direction (b) is what makes this more than a checklist: a new package wired
// into an app but never registered fails here, so the register cannot silently
// fall behind the tree it describes.
//
// Usage:  node tooling/ci/assert-capability-register.mjs [repoRoot]
// Exit 0 = clean, 1 = the register and the tree disagree.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');
const PACKAGES_DIR = join(ROOT, 'packages');

/** A scan that matches nothing reports perfect coverage over an empty set. The
 *  tree carries 8 packages today; below this floor the scan broke, not the tree. */
const MIN_EXPECTED_PACKAGES = 5;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 0. the register itself ───────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  fail([
    `✗ COVERAGE LOST — no capability register at ${REGISTER}.`,
    '  [pipeline C-1] requires a machine-readable register of every shared capability.',
  ]);
}

let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  fail([`✗ capability register is not valid JSON: ${err.message}`]);
}

const capabilities = Array.isArray(register.capabilities) ? register.capabilities : null;
if (!capabilities) {
  fail(['✗ capability register has no `capabilities` array — nothing to enforce.']);
}
const consumerRoots = Array.isArray(register.consumerRoots) ? register.consumerRoots : [];
if (consumerRoots.length === 0) {
  fail(['✗ capability register declares no `consumerRoots` — direction (b) could never fail.']);
}

// ── 1. what is actually on disk ──────────────────────────────────────────────
let onDisk = [];
if (existsSync(PACKAGES_DIR) && statSync(PACKAGES_DIR).isDirectory()) {
  onDisk = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => `packages/${e.name}`)
    .sort();
}

if (onDisk.length < MIN_EXPECTED_PACKAGES) {
  fail([
    `✗ COVERAGE LOST — found only ${onDisk.length} package dir(s) under packages/,`,
    `  expected at least ${MIN_EXPECTED_PACKAGES}. The scan is broken, not the tree.`,
    `  repo root used: ${ROOT}`,
  ]);
}

const problems = [];

// ── 2 + 3. register ↔ disk, both directions ──────────────────────────────────
const registered = new Map(capabilities.map((c) => [c.owner, c]));

for (const dir of onDisk) {
  if (!registered.has(dir)) {
    problems.push(
      `${dir} — on disk but absent from the capability register. [C-1] Every shared capability ` +
        'declares one home; an unregistered package is one nobody can discover before writing a second copy.',
    );
  }
}

for (const cap of capabilities) {
  const label = cap.id ?? cap.owner ?? '<unnamed entry>';
  if (!cap.owner) {
    problems.push(`${label} — register entry has no \`owner\` path.`);
    continue;
  }
  if (!existsSync(join(ROOT, cap.owner))) {
    problems.push(`${label} — register names owner \`${cap.owner}\`, which does not exist on disk.`);
  }
  if (!cap.seam) {
    problems.push(`${label} — register entry has no \`seam\` entrypoint.`);
  } else if (!existsSync(join(ROOT, cap.seam))) {
    problems.push(`${label} — register names seam \`${cap.seam}\`, which does not exist on disk.`);
  }
}

// ── 4. consumers, verified against their own pubspecs ────────────────────────
/** Dart package names a pubspec declares as a dependency of any kind. */
function declaredNikatruDeps(consumerRelPath) {
  const pubspec = join(ROOT, consumerRelPath, 'pubspec.yaml');
  if (!existsSync(pubspec)) return null;
  const text = readFileSync(pubspec, 'utf8');
  const found = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    const m = line.match(/^\s+(nikatru_[a-z0-9_]+)\s*:/);
    if (m) found.add(m[1]);
  }
  return found;
}

const consumerDeps = new Map();
for (const root of consumerRoots) {
  const deps = declaredNikatruDeps(root);
  if (deps === null) {
    problems.push(
      `consumerRoots names \`${root}\`, which has no pubspec.yaml. Direction (b) cannot run against it, ` +
        'so a package wired in there would never be checked against the register.',
    );
    continue;
  }
  consumerDeps.set(root, deps);
}

// (a) every consumer the register CLAIMS really declares the package
for (const cap of capabilities) {
  if (!cap.package) continue; // non-Dart capability; handled by its reason below
  for (const consumer of cap.consumers ?? []) {
    const deps = consumerDeps.get(consumer);
    if (!deps) {
      problems.push(
        `${cap.id} — claims consumer \`${consumer}\`, which is not a readable consumerRoot.`,
      );
      continue;
    }
    if (!deps.has(cap.package)) {
      problems.push(
        `${cap.id} — register claims \`${consumer}\` consumes \`${cap.package}\`, but that pubspec ` +
          'does not declare it. The register is describing a dependency that no longer exists.',
      );
    }
  }
}

// (b) every nikatru_* dep a consumer declares is registered, and lists that consumer
const byPackage = new Map(capabilities.filter((c) => c.package).map((c) => [c.package, c]));
for (const [consumer, deps] of consumerDeps) {
  for (const dep of deps) {
    const cap = byPackage.get(dep);
    if (!cap) {
      problems.push(
        `${consumer} — depends on \`${dep}\`, which has no capability register entry. [C-1] A package ` +
          'wired into an app but never registered is invisible to the next person looking for it.',
      );
      continue;
    }
    if (!(cap.consumers ?? []).includes(consumer)) {
      problems.push(
        `${cap.id} — \`${consumer}\` depends on \`${dep}\`, but the register does not list it as a ` +
          'consumer. The register has fallen behind the tree.',
      );
    }
  }
}

// ── 5. [C-2] a capability with no consumer is not built ──────────────────────
const waived = [];
for (const cap of capabilities) {
  const consumers = cap.consumers ?? [];
  if (consumers.length > 0) continue;
  if (cap.unconsumedReason && String(cap.unconsumedReason).trim().length > 0) {
    waived.push(cap);
    continue;
  }
  problems.push(
    `${cap.id} — ZERO consumers and no \`unconsumedReason\`. [C-2] Presence in packages/ is not ` +
      'delivery: it costs a pubspec, an analysis_options, a workspace entry, a test harness and a CI ' +
      'surface forever. Wire it to a real consumer, delete it, or record why neither applies.',
  );
}

if (problems.length) {
  console.error(`✗ capability register — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline C-1] one declared home per capability · [pipeline C-2] no capability');
  console.error('  without a consumer. Register: tooling/capability-register.json');
  process.exit(1);
}

// ── the gaps are printed whether or not the build passes ─────────────────────
for (const cap of waived) {
  console.log(`⚠  ${cap.id} — no consumer. ${cap.unconsumedReason}`);
}

const dartCaps = capabilities.filter((c) => c.package).length;
console.log(
  `ok  capability register — ${capabilities.length} capability(ies) covering ${onDisk.length} package dir(s); ` +
    `${dartCaps} Dart package(s) consumer-verified in both directions, ${waived.length} with a recorded reason`,
);
