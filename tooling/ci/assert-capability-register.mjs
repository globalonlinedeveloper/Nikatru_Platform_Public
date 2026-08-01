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
//   3. every path named exists; every declared seam SYMBOL is really declared
//      in the file claiming it; every declared METHOD is really declared on
//      THAT class — matched against comment- and string-stripped source, so a
//      doc comment cannot stand in for a contract                         [C-1]
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

/**
 * Blank Dart comments and string literals, preserving offsets and newlines.
 *
 * A hand-rolled scanner rather than a regex: a regex cannot tell `//` inside a
 * string from a comment, and getting that backwards is how a guard ends up
 * matching its own documentation. It lives here rather than in a shared module
 * because every `.mjs` directly under tooling/ci is a GUARD to
 * assert-guard-coverage.mjs, and any `.mjs` in a subdirectory of tooling/ci is a
 * hard COVERAGE LOST — there is nowhere shared to put it.
 */
function stripDart(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; if (depth === 0) break; continue; }
        out += blank(src[i]); i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      const start = i;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') break;
        j++;
      }
      for (const ch of src.slice(start, j)) out += blank(ch);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The body of `class <symbol>` in already-stripped source, or null.
 *
 * Scoping matters as much as stripping: without it, ANY class, extension or call
 * site in the same file satisfies the interface's method claim. Proven by
 * mutation — deleting `scheduleDaily` from `abstract interface class
 * NotificationService` while the sibling `NoOpNotificationService` in the same
 * file kept its override left this guard reporting the method "verified in place".
 */
function classBody(code, symbol) {
  const decl = new RegExp(`\\bclass\\s+${symbol}\\b`).exec(code);
  if (!decl) return null;
  const open = code.indexOf('{', decl.index);
  if (open === -1) return null; // `class X = A with B;` — no body to scope to
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (depth === 0) return code.slice(open, k + 1); }
  }
  return code.slice(open);
}

/** A member DECLARATION of `method`, not merely the name followed by a paren. */
const declaresMethod = (body, method) =>
  new RegExp(
    `(?:^|[;{}])\\s*(?:@\\w+\\s+)*(?:(?:static|external|abstract|covariant)\\s+)*` +
      `[A-Za-z_$][\\w<>,?\\[\\]$. ]*\\s+${method}\\s*\\(`,
  ).test(body);

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
    // 🔴 STRIP COMMENTS AND STRING LITERALS FIRST. Both checks below used to run
    // against the RAW file, so a doc comment satisfied them — the sibling
    // assert-no-seam-forks.mjs already carried a warning that this repo had
    // shipped exactly that bug ("the pattern had spanned out of a doc comment")
    // and this guard never got the same treatment. Mutation-proven 2026-08-01: a
    // complete, compile-clean rename of `scheduleDaily` to `scheduleReminder`
    // that left the old name in ONE house-style doc comment
    // (`/// Renamed 2026-08-01: scheduleDaily(...) is now scheduleReminder().`)
    // kept this guard at exit 0, still printing "seam symbol(s) verified in
    // place" for a method the interface no longer has. The register would have
    // gone on describing a contract that no longer existed. Delete that one
    // comment line and the guard fails — the comment was the entire difference.
    const src = stripDart(readFileSync(join(ROOT, s.file), 'utf8'));
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
    const body = classBody(src, s.symbol);
    for (const m of s.methods ?? []) {
      // Scoped to the DECLARING CLASS and required to be a declaration, not any
      // `name(` anywhere in the file. `tooling/capability-register.json`'s own
      // _readme claims "every declared seam METHOD really appears in THAT
      // INTERFACE"; a bare `\bname\s*\(` over the whole file made good on
      // neither half of that sentence.
      if (body === null || !declaresMethod(body, m)) {
        problems.push(
          `${label} — register says \`${s.symbol}\` has method \`${m}\`, which is not declared in that ` +
            `class in \`${s.file}\` (comments, string literals and other classes in the same file do not ` +
            'count). [decision item 12] Naming a seam method is only useful if it is checked.',
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
  // Stripped for the same reason as check 3, pointed the other way: here a
  // commented-out `class NotificationService` would falsely ACCUSE an app file
  // of forking a seam. Same rule either way — assert on code, never on prose.
  const src = stripDart(readFileSync(join(ROOT, rel), 'utf8'));
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
