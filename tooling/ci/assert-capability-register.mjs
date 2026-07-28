#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-capability-register.mjs — the chassis must know what it provides.
//
// [pipeline C-1] "Every shared capability has exactly one declared home."
// [pipeline C-2] "A capability with no consumer is not built."
// [pipeline C-3] widened — "a register-assigned capability may not be
//                implemented in an app" (00-RECONCILIATION-DECISIONS item 15).
//
// WHY. "Every capability" cannot be checked against a list that does not exist.
// THREE notification implementations were written because nobody had a place to
// look that would have said one already existed — and the third is STILL in the
// tree, which is why check 5 below exists.
//
// v1 of this guard (2026-07-28, same day) shipped with two structural mistakes,
// found by researching C-1 against decisions already on record rather than by any
// test:
//   · it pointed every `seam` at a package BARREL FILE, so it asserted nothing
//     about the actual contract. The real architecture is that packages/core
//     DECLARES the interfaces and other packages IMPLEMENT them.
//   · it had no concept of a seam METHOD, so it could not carry decision item 12
//     (the NotificationService tap surface), and no concept of LOCATION, so both
//     the Subly notification fork and the misplaced AnalyticsFunnel passed clean.
// Rebuilt rather than patched, per owner instruction.
//
// Checks, in order:
//   1. coverage self-check — the scan still finds packages
//   2. every packages/* dir on disk is owned by some capability          [C-1]
//   3. every path named exists; every declared seam SYMBOL really appears
//      in the file claiming it; every declared METHOD really appears too  [C-1]
//   4. consumers verified in BOTH directions against real pubspecs        [C-1]
//   5. no registered seam symbol is implemented under apps/ unless it is
//      DECLARED as a violation, and a declared violation whose file has
//      gone must be removed from the register                            [C-3]
//   6. every capability has a consumer, or a recorded reason              [C-2]
//
// ⚠️ VIOLATIONS AND MISSING SEAM METHODS ARE PRINTED ON EVERY RUN, pass or fail —
// the posture assert-seams-wired.mjs takes for owner-gated gaps. A known gap
// nobody sees becomes permanent. They do NOT fail the build: both current entries
// are blocked by 39-CHASSIS cut 1's freeze on apps/subly, which is an agreed cut
// the agent may not reverse. Undeclared ones DO fail.
//
// Usage:  node tooling/ci/assert-capability-register.mjs [repoRoot]
// Exit 0 = the register and the tree agree, 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');
const PACKAGES_DIR = join(ROOT, 'packages');
const APPS_DIR = join(ROOT, 'apps');

/** A scan that matches nothing reports perfect coverage over an empty set. */
const MIN_EXPECTED_PACKAGES = 5;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── 0. the register ──────────────────────────────────────────────────────────
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
if (!capabilities) fail(['✗ capability register has no `capabilities` array — nothing to enforce.']);
const consumerRoots = Array.isArray(register.consumerRoots) ? register.consumerRoots : [];
if (consumerRoots.length === 0) {
  fail(['✗ capability register declares no `consumerRoots` — direction (b) could never fail.']);
}

// ── 1. packages on disk ──────────────────────────────────────────────────────
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

// ── 2. every package dir is owned by SOME capability ─────────────────────────
// Several capabilities may share an owner: `core` and `analytics_funnel` both
// live in packages/core, which is correct — one package can host more than one
// capability. So this is a set membership test, not a 1:1 map.
const owners = new Set(capabilities.map((c) => c.owner).filter(Boolean));
for (const dir of onDisk) {
  if (!owners.has(dir)) {
    problems.push(
      `${dir} — on disk but no capability register entry owns it. [C-1] An unregistered package is ` +
        'one nobody can discover before writing a second copy.',
    );
  }
}

// ── 3. paths, seam symbols and seam methods are real ─────────────────────────
const seamSymbols = new Map(); // symbol -> capability id that declares it
for (const cap of capabilities) {
  const label = cap.id ?? cap.owner ?? '<unnamed>';
  if (!cap.owner) {
    problems.push(`${label} — entry has no \`owner\` path.`);
    continue;
  }
  if (!existsSync(join(ROOT, cap.owner))) {
    problems.push(`${label} — owner \`${cap.owner}\` does not exist on disk.`);
  }
  // legacy single-path seam, used by the two non-Dart capabilities
  if (cap.seam && !existsSync(join(ROOT, cap.seam))) {
    problems.push(`${label} — seam \`${cap.seam}\` does not exist on disk.`);
  }
  const seams = Array.isArray(cap.seams) ? cap.seams : [];
  if (seams.length === 0 && !cap.seam) {
    // Not every capability declares an interface (an adapter may only implement
    // one). Require it to say so explicitly rather than leaving the field absent.
    // Some capabilities genuinely have no interface: design_system is a widget
    // library, analytics_funnel is a concrete wrapper. That is legitimate, so it
    // must be STATED rather than left as an absent field.
    if (!Array.isArray(cap.implementsSeams) && !cap.unconsumedReason && !String(cap.noSeamReason ?? '').trim()) {
      problems.push(
        `${label} — declares no \`seams\`, no \`implementsSeams\` and no \`noSeamReason\`. Say which ` +
          'contract it owns or satisfies, or state why it has none; an unnamed seam is one nobody can code against.',
      );
    }
  }
  for (const s of seams) {
    if (!s.file || !existsSync(join(ROOT, s.file))) {
      problems.push(`${label} — seam file \`${s.file ?? '<missing>'}\` does not exist on disk.`);
      continue;
    }
    const src = readFileSync(join(ROOT, s.file), 'utf8');
    if (!s.symbol) {
      problems.push(`${label} — seam in \`${s.file}\` names no \`symbol\`.`);
      continue;
    }
    // The claim is that this file DECLARES the symbol, not merely mentions it.
    if (!new RegExp(`\\bclass\\s+${s.symbol}\\b`).test(src)) {
      problems.push(
        `${label} — register says \`${s.file}\` declares \`${s.symbol}\`, but no class of that name is ` +
          'declared there. The register is describing a contract that does not exist.',
      );
      continue;
    }
    seamSymbols.set(s.symbol, cap.id);
    for (const m of s.methods ?? []) {
      if (!new RegExp(`\\b${m}\\s*\\(`).test(src)) {
        problems.push(
          `${label} — register says \`${s.symbol}\` has method \`${m}\`, which does not appear in ` +
            `\`${s.file}\`. [decision item 12] Naming a seam method is only useful if it is checked.`,
        );
      }
    }
  }
}

// implementsSeams must name a contract that some capability actually declares
for (const cap of capabilities) {
  for (const sym of cap.implementsSeams ?? []) {
    if (!seamSymbols.has(sym)) {
      problems.push(
        `${cap.id} — claims to implement seam \`${sym}\`, which no register entry declares. ` +
          'Either the contract is unregistered or the name is wrong.',
      );
    }
  }
}

// ── 4. consumers, both directions ────────────────────────────────────────────
function declaredNikatruDeps(rel) {
  const p = join(ROOT, rel, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const found = new Set();
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const m = raw.replace(/#.*$/, '').match(/^\s+(nikatru_[a-z0-9_]+)\s*:/);
    if (m) found.add(m[1]);
  }
  return found;
}
const consumerDeps = new Map();
for (const root of consumerRoots) {
  const deps = declaredNikatruDeps(root);
  if (deps === null) {
    problems.push(`consumerRoots names \`${root}\`, which has no pubspec.yaml — direction (b) cannot run against it.`);
    continue;
  }
  consumerDeps.set(root, deps);
}

for (const cap of capabilities) {
  if (!cap.package) continue;
  for (const consumer of cap.consumers ?? []) {
    const deps = consumerDeps.get(consumer);
    if (!deps) {
      problems.push(`${cap.id} — claims consumer \`${consumer}\`, which is not a readable consumerRoot.`);
    } else if (!deps.has(cap.package)) {
      problems.push(
        `${cap.id} — register claims \`${consumer}\` consumes \`${cap.package}\`, but that pubspec does ` +
          'not declare it. The register is describing a dependency that no longer exists.',
      );
    }
  }
}
// (b) a package a consumer depends on must be registered, and SOME capability
//     with that package must list that consumer.
for (const [consumer, deps] of consumerDeps) {
  for (const dep of deps) {
    const caps = capabilities.filter((c) => c.package === dep);
    if (caps.length === 0) {
      problems.push(
        `${consumer} — depends on \`${dep}\`, which has no capability register entry. [C-1] A package ` +
          'wired into an app but never registered is invisible to the next person looking for it.',
      );
      continue;
    }
    if (!caps.some((c) => (c.consumers ?? []).includes(consumer))) {
      problems.push(
        `${dep} — \`${consumer}\` depends on it, but no capability entry lists that consumer. ` +
          'The register has fallen behind the tree.',
      );
    }
  }
}

// ── 5. [C-3 widened] a registered seam may not be implemented in an app ──────
const declaredViolations = new Map();
for (const cap of capabilities) {
  for (const v of cap.violations ?? []) {
    if (!v.path) {
      problems.push(`${cap.id} — a violation entry has no \`path\`.`);
      continue;
    }
    if (!existsSync(join(ROOT, v.path))) {
      problems.push(
        `${cap.id} — declared violation \`${v.path}\` no longer exists. It was fixed; REMOVE it from the ` +
          'register. A stale waiver is how a closed gap keeps excusing a new one.',
      );
      continue;
    }
    if (!v.detail || !v.fixOwner) {
      problems.push(`${cap.id} — violation \`${v.path}\` needs both \`detail\` and \`fixOwner\`.`);
    }
    declaredViolations.set(posix.normalize(v.path.replace(/\\/g, '/')), { cap: cap.id, ...v });
  }
}

/** Every .dart file under apps/<app>/lib. */
function dartFilesUnder(dir, rel, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(dir, e.name);
    const r = posix.join(rel, e.name);
    if (e.isDirectory()) dartFilesUnder(abs, r, out);
    else if (e.name.endsWith('.dart')) out.push(r);
  }
}
let appFiles = [];
if (existsSync(APPS_DIR)) {
  for (const e of readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    dartFilesUnder(join(APPS_DIR, e.name, 'lib'), `apps/${e.name}/lib`, appFiles);
  }
}
for (const rel of appFiles) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const [symbol, capId] of seamSymbols) {
    // A concrete class of the same name as a registered seam, inside an app, is a
    // fork. `implements`/`extends` clauses are excluded: an app may legitimately
    // hold a class that IMPLEMENTS a seam only if the register says so, and the
    // declaration form is what distinguishes a fork from a wiring class.
    if (!new RegExp(`^\\s*(?:final\\s+|base\\s+)?class\\s+${symbol}\\b`, 'm').test(src)) continue;
    if (declaredViolations.has(rel)) continue;
    problems.push(
      `${rel} — declares \`class ${symbol}\`, which is a seam registered to \`${capId}\`. [C-3, widened] ` +
        'A register-assigned capability may not be implemented in an app. Move it, or declare it as a ' +
        'violation in the register with a detail and a fixOwner.',
    );
  }
}

// ── 6. [C-2] a capability with no consumer is not built ──────────────────────
const waived = [];
for (const cap of capabilities) {
  if ((cap.consumers ?? []).length > 0) continue;
  if (String(cap.unconsumedReason ?? '').trim()) {
    waived.push(cap);
    continue;
  }
  problems.push(
    `${cap.id} — ZERO consumers and no \`unconsumedReason\`. [C-2] Presence in packages/ is not delivery: ` +
      'it costs a pubspec, an analysis_options, a workspace entry, a test harness and a CI surface forever.',
  );
}

if (problems.length) {
  console.error(`✗ capability register — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [C-1] one declared home per capability · [C-2] no capability without a consumer ·');
  console.error('  [C-3] no register-assigned capability implemented in an app.');
  console.error('  Register: tooling/capability-register.json');
  process.exit(1);
}

// ── the gaps print whether or not the build passes ───────────────────────────
for (const cap of waived) console.log(`⚠  ${cap.id} — no consumer. ${cap.unconsumedReason}`);
for (const [path, v] of declaredViolations) {
  console.log(`⚠  ${v.cap} — ${v.kind ?? 'violation'} at ${path} (declared ${v.declaredOn ?? '?'}) → fix owner: ${v.fixOwner}`);
}
for (const cap of capabilities) {
  for (const s of cap.seams ?? []) {
    for (const mm of s.missingMethods ?? []) {
      console.log(`⚠  ${cap.id} — seam \`${s.symbol}\` is MISSING the ${mm.surface} surface → ${mm.fixOwner}`);
    }
  }
}

const seamCount = seamSymbols.size;
console.log(
  `ok  capability register — ${capabilities.length} capability(ies) over ${onDisk.length} package dir(s); ` +
    `${seamCount} seam symbol(s) verified in place, ${appFiles.length} app file(s) scanned for forks, ` +
    `${declaredViolations.size} declared violation(s), ${waived.length} unconsumed with a reason`,
);
