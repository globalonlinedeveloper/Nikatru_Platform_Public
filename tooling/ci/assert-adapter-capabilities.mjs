#!/usr/bin/env node
// [pipeline C-7] EVERY ADAPTER DECLARES WHERE IT WORKS, and degrades instead of
// crashing.
//
// G-17 sat on the gap list from the beginning and never had an owner. This is
// where it lands, and it is what makes the "six platforms" claim honest at the
// CAPABILITY level rather than only at the builds-green level F-4 covers. An app
// that builds on Windows, never fires a reminder, and reports no crash when it
// dies is passing CI and failing the user.
//
// The precedent was already here and already good: `NotificationCapabilities`
// declares Android/iOS/macOS show+schedule, Linux shows but CANNOT schedule,
// Windows can do neither on the pinned 17.x. **No other adapter did this**, and
// the same class of hole was already known elsewhere — which is the point: the
// facts below were not invented for this guard, they were already true and
// undeclared.
//
// ── WHAT THIS ENFORCES ──────────────────────────────────────────────────────
//   1. every adapter package has a capability descriptor, named in the register
//   2. the descriptor exists on disk and declares the symbol it claims
//   3. it covers ALL SIX platforms plus web — an incomplete matrix is worse than
//      none, because it reads as "checked" for the rows it silently omits
//   4. it takes the platform as a PARAMETER (`forPlatform`), so every row is
//      reachable from a test. A matrix that can only be evaluated on the host
//      leaves five of six rows permanently unexercised — a comment with a type.
//   5. it has a test, and that test really exercises the descriptor
//   6. it says what DEGRADES and what it was verified against, because a matrix
//      with no version pin silently rots at the next dependency bump
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Blank Dart comments and string literals, preserving offsets and newlines.
 *
 * A hand-rolled scanner rather than the regex pass this file used to carry: a
 * regex cannot tell `//` inside a string from a comment. It lives here rather
 * than in a shared module because every `.mjs` directly under tooling/ci is a
 * GUARD to assert-guard-coverage.mjs, and any `.mjs` in a subdirectory of
 * tooling/ci is a hard COVERAGE LOST — there is nowhere shared to put it.
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
 * Character spans covered by the argument list of a `test(…)` / `testWidgets(…)`
 * call. Something written outside every one of these spans does not run when the
 * suite runs — which is the difference between a test file and a file of prose
 * that happens to compile.
 */
function testCallSpans(code) {
  const spans = [];
  for (const m of code.matchAll(/\b(?:test|testWidgets)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let k = open; k < code.length; k++) {
      if (code[k] === '(') depth++;
      else if (code[k] === ')') { depth--; if (depth === 0) { spans.push([open, k]); break; } }
    }
  }
  return spans;
}
const insideSome = (spans, idx) => spans.some(([a, b]) => idx > a && idx < b);
const occursInATest = (code, spans, re) =>
  [...code.matchAll(re)].some((m) => insideSome(spans, m.index));

const ROOT = process.cwd();
const REGISTER = 'tooling/capability-register.json';
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

let reg;
try {
  reg = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (e) {
  console.error(`FAIL ${REGISTER} could not be read or parsed (${e.message}).`);
  console.error('\nassert-adapter-capabilities: FAILED');
  process.exit(1);
}

// ── The DOMAIN: which packages are adapters. Derived, not typed — the same
//    derivation C-5 limb (c) uses, so the two cannot drift apart. An adapter is
//    a package under packages/ that is not core, not design_system, and
//    declares at least one third-party dependency (a lint ruleset is config,
//    not a wrapped SDK). ──────────────────────────────────────────────────────
const LINT_ONLY = /(?:^|_)lints$/;
function thirdPartyDeps(pkgDir) {
  const p = join(ROOT, pkgDir, 'pubspec.yaml');
  if (!existsSync(p)) return [];
  const out = [];
  let inBlock = false;
  let current = null;
  let sdkOrPath = false;
  const flush = () => {
    if (current && !sdkOrPath && !current.startsWith('nikatru_') && !LINT_ONLY.test(current)) out.push(current);
  };
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[a-z_]+:/i.test(line)) { flush(); current = null; inBlock = line.startsWith('dependencies:'); continue; }
    if (!inBlock) continue;
    const m = line.match(/^  ([a-z0-9_]+)\s*:/i);
    if (m) { flush(); current = m[1]; sdkOrPath = false; continue; }
    if (current && /^\s+(sdk|path):/.test(line)) sdkOrPath = true;
  }
  flush();
  return out;
}

const pkgRoot = join(ROOT, 'packages');
const adapters = [];
if (existsSync(pkgRoot)) {
  for (const name of readdirSync(pkgRoot)) {
    if (name === 'core' || name === 'design_system') continue;
    if (thirdPartyDeps(`packages/${name}`).length > 0) adapters.push(`packages/${name}`);
  }
}

// Coverage self-check. SIX adapters since 2026-08-01 (packages/purchases joined
// on url_launcher); a scan that finds one or two reads exactly like "every
// adapter is compliant".
const MIN_ADAPTERS = 6;
if (adapters.length < MIN_ADAPTERS) {
  problems.push(
    `COVERAGE LOST — derived only ${adapters.length} adapter(s), expected >= ${MIN_ADAPTERS}. Either adapters were deleted or this derivation has stopped working, and the checks below would range over almost nothing.`,
  );
} else {
  ok(`${adapters.length} adapter(s) derived from the tree: ${adapters.map((a) => a.split('/')[1]).join(', ')}`);
}

// ── Register: every adapter owns a capabilityMatrix ─────────────────────────
//
// 🔴 ONE OWNER CAN HOLD MORE THAN ONE CAPABILITY, and this used to be a `Map`
// keyed on owner — so the LAST entry silently replaced the earlier one and its
// matrix stopped being checked, while this guard went on printing `ok N
// matrices exercised`. Found 2026-07-29 by adding the `review` capability to
// `packages/platform_storage`: `StorageCapabilities` vanished from the checked
// set and nothing said so.
//
// The register has always allowed this (`core` owns both `core` and
// `analytics_funnel`, and packageEarnReasons is keyed by PACKAGE precisely
// because two capabilities can share one), so the collapse was a latent bug
// waiting for the first adapter to grow a second capability. EVERY matrix is
// checked now, and the count is asserted below so a future collapse cannot be
// silent.
const byOwner = new Map();
for (const cap of reg.capabilities ?? []) {
  if (!cap.owner) continue;
  if (!byOwner.has(cap.owner)) byOwner.set(cap.owner, []);
  byOwner.get(cap.owner).push(cap);
}

// All six real targets plus web. Fuchsia is declared too, but is not a target.
const REQUIRED_PLATFORMS = ['android', 'iOS', 'macOS', 'windows', 'linux', 'web'];

let checked = 0;
// Flattened deliberately: the unit of work is a MATRIX, not a package, because a
// package with two capabilities has two matrices and both have to hold.
const matrixJobs = [];
for (const pkg of adapters) {
  const caps = byOwner.get(pkg);
  if (!caps || caps.length === 0) {
    problems.push(`\`${pkg}\` is an adapter but owns no capability register entry, so it can declare no matrix. [C-1] would normally catch this first.`);
    continue;
  }
  for (const cap of caps) matrixJobs.push({ pkg, cap });
}

for (const { pkg, cap } of matrixJobs) {
  const m = cap.capabilityMatrix;
  if (!m) {
    problems.push(
      `\`${pkg}\` declares NO capability matrix. Every adapter must publish where it works — G-17 sat unowned for months and this is where it lands. Add \`capabilityMatrix\` with file, symbol, test, pinnedTo and degradesOn.`,
    );
    continue;
  }
  for (const field of ['file', 'symbol', 'test', 'pinnedTo', 'degradesOn']) {
    if (!m[field]) {
      problems.push(`\`${pkg}\`'s capabilityMatrix is missing \`${field}\`.` + (field === 'pinnedTo' ? ' A matrix with no version pin silently rots at the next dependency bump — the notifications one names 17.x for exactly this reason.' : ''));
    }
  }
  if (!m.file || !m.symbol) continue;

  const srcPath = join(ROOT, m.file);
  if (!existsSync(srcPath)) {
    problems.push(`\`${pkg}\` names capability file \`${m.file}\`, which does not exist.`);
    continue;
  }
  const src = readFileSync(srcPath, 'utf8');
  if (!new RegExp(`class\\s+${m.symbol}\\b`).test(src)) {
    problems.push(`\`${m.file}\` does not declare \`class ${m.symbol}\`.`);
    continue;
  }

  // 3 · all six platforms, plus web.
  // 🔴 STRIP COMMENTS **AND STRING LITERALS** BEFORE MATCHING. Found by
  // mutation: deleting `TargetPlatform.linux` from the telemetry switch left the
  // guard green, because the row's own `note` string says "desktop
  // Windows/Linux" — so the check was matching the PROSE THAT DESCRIBES the row
  // rather than the row. Every one of these matrices carries a human-readable
  // note naming its platforms, which makes this failure mode certain rather than
  // unlucky. This is the repo's own recorded rule: assert on structure, never by
  // grepping prose.
  const code = stripDart(src);
  const missing = REQUIRED_PLATFORMS.filter((p) => {
    // Web is expressed as the `isWeb` PARAMETER, not as an enum case — a web
    // build still reports a host TargetPlatform, so it cannot be a switch arm.
    // `\bweb\b` does not match inside `isWeb` (no word boundary between `s` and
    // `W`), and the first version of this check therefore reported the
    // notifications matrix as missing a row it has handled since it was written.
    // The matcher was wrong, not the matrix.
    if (p === 'web') return !/\bisWeb\b|\bweb\b/i.test(code);
    return !new RegExp(`\\b${p}\\b`, 'i').test(code);
  });
  if (missing.length) {
    problems.push(
      `\`${m.symbol}\` does not mention ${missing.join(', ')}. An INCOMPLETE matrix is worse than none: it reads as "checked" for the rows it silently omits, which is how a platform ends up believed-supported and untested.`,
    );
  }

  // 4 · the platform must be a PARAMETER, not read from the host.
  if (!/\bforPlatform\s*\(/.test(code)) {
    problems.push(
      `\`${m.symbol}\` has no \`forPlatform(...)\` entry point. Reading the host platform directly leaves five of six rows unreachable from a test — a matrix nobody can exercise is a comment with a type.`,
    );
  }

  // 5 · a test that really drives it.
  const testPath = join(ROOT, m.test ?? '');
  if (!m.test || !existsSync(testPath)) {
    problems.push(`\`${pkg}\` names test \`${m.test}\`, which does not exist. C-7's acceptance is that a TEST asserts the unsupported path returns the declared fallback.`);
  } else {
    // 🔴 THE TEST HALF NEVER GOT THE TREATMENT THE DESCRIPTOR HALF DID. Until
    // 2026-08-01 these two checks ran against the RAW test file, eight lines
    // below the note above explaining why that is wrong. Mutation-proven:
    // replacing packages/telemetry/test/telemetry_capabilities_test.dart with
    // three comment lines mentioning `TelemetryCapabilities` and `forPlatform(`
    // plus `void main() {}` left this guard printing `ok 6 adapter
    // matrix/matrices exercised per-platform by their own tests`, exit 0 — and
    // `dart test` stays green too, because the file compiles and declares no
    // failing case. The suite could not backstop it: every adapter package
    // carries a second test file, so gutting the capabilities one never empties
    // a suite.
    //
    // Three things are required now, and none is an arbitrary threshold — a
    // per-platform `expect(` count was considered and REJECTED, because
    // review_capabilities_test.dart has 22 expects behind ONE literal
    // `forPlatform(`, so counting would encode a style rather than a property.
    // What is asserted instead: the symbol and `forPlatform(` appear in CODE,
    // and at least one `expect(` sits inside a `test(` body — i.e. the file
    // actually runs an assertion when the suite runs. Prose, a commented-out
    // body and a file of bare top-level declarations all fail that.
    //
    // ⚠️ `forPlatform(` is NOT required to be inside the `test(` body itself.
    // Tried, and it falsely accused review_capabilities_test.dart, whose
    // `forPlatform` call lives in a top-level `_caps()` helper the tests call —
    // a legitimate shape, and the guard would have been the thing that was wrong.
    const t = stripDart(readFileSync(testPath, 'utf8'));
    const spans = testCallSpans(t);
    const symbolRe = new RegExp(`\\b${m.symbol}\\b`, 'g');
    if (!symbolRe.test(t)) {
      problems.push(`\`${m.test}\` never references \`${m.symbol}\` in CODE (comments and string literals do not count) — it cannot be exercising the matrix it claims to test.`);
    } else if (spans.length === 0) {
      problems.push(`\`${m.test}\` declares no \`test(\`/\`testWidgets(\` case at all — nothing in it runs, so it asserts nothing about \`${m.symbol}\`.`);
    } else if (!/\bforPlatform\s*\(/.test(t)) {
      problems.push(`\`${m.test}\` never calls \`forPlatform\` in CODE — it is not exercising the per-platform rows, which is the whole point.`);
    } else if (!occursInATest(t, spans, /\bexpect\s*\(/g)) {
      problems.push(`\`${m.test}\` calls \`forPlatform\` but asserts nothing (\`expect(\` appears in no \`test(\` body). C-7's acceptance is that a TEST asserts the unsupported path returns the declared fallback.`);
    } else {
      checked++;
    }
  }

  if (m.degradesOn) notes.push(`· ${pkg.split('/')[1]} (${m.pinnedTo ?? 'unpinned'})\n    ${m.degradesOn}`);
}

// A matrix nobody tests is the "assertion that cannot fail" shape again.
// COVERAGE SELF-CHECK, expressed as a RELATIONSHIP rather than a magic number:
// every matrix the register declares on an adapter package must actually reach
// the checks above. A fixed floor would be wrong the moment the tree legitimately
// grows or shrinks, and — as the first version of this proved — it also fails on
// any synthetic tree, which is how a floor gets weakened to shut a test up.
//
// 🔴 THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE BUG ABOVE. When `byOwner`
// collapsed two capabilities into one, the register still declared 6 matrices
// and only 5 were examined — while the guard printed `ok 5 matrices exercised`,
// which is indistinguishable from there being 5.
const declaredOnAdapters = (reg.capabilities ?? []).filter(
  (c) => c.owner && adapters.includes(c.owner) && c.capabilityMatrix,
);
if (matrixJobs.length < declaredOnAdapters.length) {
  problems.push(
    `COVERAGE LOST — the register declares ${declaredOnAdapters.length} capability matrix/matrices on adapter packages, but only ${matrixJobs.length} reached the checks. A matrix that is declared and never examined reports as covered.`,
  );
}

if (adapters.length > 0 && checked === 0) {
  problems.push('COVERAGE LOST — not one adapter matrix is exercised by a test that calls forPlatform. Every check above would then be asserting the existence of documentation.');
} else if (checked > 0) {
  ok(`${checked} adapter matrix/matrices exercised per-platform by their own tests`);
}

if (notes.length) {
  console.log('\n⬜ Where each adapter DEGRADES — printed every run, because a platform gap nobody sees becomes a support ticket:');
  for (const n of notes) console.log(`  ${n}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-adapter-capabilities: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-adapter-capabilities: ok — ${adapters.length} adapter(s), each declaring all six platforms and proving it`);
}
