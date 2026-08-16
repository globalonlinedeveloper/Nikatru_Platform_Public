#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-stamp-wiring.mjs — a stamped app must CALL the chassis, not merely
// depend on it.
//
// [pipeline S-2] "The stamp wires every chassis capability the register says it
// must." Private/company/pipeline/03-stamper.md
//
// 🔴 WHY THIS GUARD REPLACES THE ONE THE SPEC ORIGINALLY DESCRIBED.
// S-2's acceptance criterion was written as "for every C-1 register entry
// flagged `brick-wired` …". Measured 2026-07-29: `tooling/capability-register.json`
// contains ZERO occurrences of any such flag — the field does not exist. So the
// set was EMPTY, "every entry is wired" was VACUOUSLY TRUE, and the check would
// have passed while wiring nothing. That is this repo's single most expensive
// recurring defect, and building the criterion as drafted would have reproduced
// it. The set is therefore derived from `consumers`, a field that already exists
// and is already maintained in both directions by assert-capability-register.mjs.
//
// 🔴 AND WHY IT IS NOT A DUPLICATE OF assert-capability-register.mjs.
// That guard verifies `consumers` against real pubspecs, in both directions, and
// does it well. But a pubspec line proves a package was DOWNLOADED — never that
// a single line of it is executed. Every capability below could be listed,
// resolved, analyzed and shipped with no call site at all, and that guard would
// stay green. This one asserts the call.
//
// ⚠️ ONE LIMB THE SPEC ASKED FOR IS DELIBERATELY NOT IMPLEMENTED HERE.
// S-2 also says "fail if a declared capability's owner package doesn't exist".
// assert-capability-register.mjs already fails on exactly that (its check 3,
// `owner does not exist on disk`). Re-asserting it here would be an assertion
// that cannot fail in practice, which CLAUDE.md records as worse than none
// because it inflates apparent coverage. What IS implemented is the form that is
// genuinely uncovered: a capability that claims the stamp as a consumer but
// exposes NOTHING the stamp could call is undeliverable, and fails below.
//
// ── WHAT IT CHECKS ───────────────────────────────────────────────────────────
//   1. COVERAGE — the brick consumer root is found, the derived capability set
//      is non-empty, and the brick's pubspec yields nikatru deps. Any of those
//      empty means the SCAN broke, not that the tree is clean.
//   2. WIRED — every capability whose `consumers` include the brick has at least
//      one symbol it owns appearing in a CALL position in the brick's `lib/`.
//   3. COVERAGE, the relationship — every `nikatru_*` dependency the brick
//      declares is accounted for by at least one wired capability.
//
// ── HOW A CAPABILITY'S SYMBOLS ARE DERIVED (never typed here) ────────────────
// A package may host more than one capability (packages/platform_storage owns
// both `platform_storage` and `review`), so ownership alone is not attribution:
//   · package hosting exactly ONE brick-consuming capability → every public
//     top-level declaration in it belongs to that capability. Simple, and robust
//     against the concrete classes nobody thought to register.
//   · package SHARED by two or more → attribute by evidence only: a declared
//     seam symbol, the capability's `capabilityMatrix.symbol`, or a declaration
//     whose `implements`/`extends` clause names one of the capability's seams.
//     Anything unattributable belongs to NEITHER — better an unusable symbol
//     than one silently credited to the wrong capability.
// A capability that ends up with zero attributable symbols FAILS. It cannot be
// checked, and "cannot be checked" must never read as "passes".
//
// ── WHY `lib/` ONLY, AND NOT `test/` ────────────────────────────────────────
// A test calling a capability proves the package resolves. It does not prove the
// stamped APP wires it — which is the entire requirement. Wiring lives in lib/.
//
// ── HOUSE RULES ENCODED HERE, each paid for in this repo ────────────────────
//   · DECLARATION IS NOT USAGE (six incidents). A symbol the brick DECLARES
//     itself can never be evidence that the brick CALLS the package's version,
//     so brick-declared names are struck from the evidence set entirely.
//   · STRIP COMMENTS BEFORE SCANNING — including the comment you just wrote. A
//     guard here once matched `flutter build web` inside its own explanatory
//     comment. Strings are stripped too, by the same argument.
//   · A COVERAGE FLOOR MUST BE A RELATIONSHIP, NOT A NUMBER. The spec proposed
//     "a floor of 6". A number needs tuning, and a floor that needs tuning is a
//     floor somebody lowers. Check 3 ties coverage to the brick's OWN pubspec
//     instead: whatever the stamp depends on must be wired, whether that is 6
//     packages or 60. (It is 8 today, which would have passed a floor of 6 while
//     two capabilities went unwired.)
//
// Usage:  node tooling/ci/assert-stamp-wiring.mjs [repoRoot]
// Exit 0 = the stamp calls what it declares, 1 = it does not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

// cwd, not this file's location. Resolving from `import.meta.url` pins the guard
// to the real repository no matter where it is invoked from, so every fixture
// test silently asserts against the LIVE tree — which is how the first run of
// this suite came back with all fifteen cases failing, the guard having never
// once looked at the fixture it was handed. This is the convention the other
// fixture-driven guards already use.
const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── strip Dart comments and string literals ──────────────────────────────────
// A hand-rolled scanner rather than a regex, because a regex cannot tell `//`
// inside a string from a comment, and getting that backwards is how a guard ends
// up matching its own documentation. Blanked spans keep their newlines so any
// line number derived later still lines up.
//
// String interpolation is blanked WITH the string. That is deliberate and it is
// the strict direction: a `${x.y()}` call inside a literal is not wiring, and
// missing a call site can only make this guard fail, never falsely pass.
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // line comment
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    // block comment — Dart allows nesting
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') {
          depth--; out += '  '; i += 2;
          if (depth === 0) break;
          continue;
        }
        out += blank(src[i]); i++;
      }
      continue;
    }
    // string literal (raw / triple / single, either quote)
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      // blank the opening delimiter (+ the r prefix)
      for (let k = i; k < j + closeLen; k++) out += blank(src[k]);
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { out += '  '; j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) {
          for (let k = 0; k < closeLen; k++) out += ' ';
          j += closeLen;
          break;
        }
        // an unterminated single-quoted string cannot cross a line
        if (!triple && src[j] === '\n') { out += '\n'; j++; break; }
        out += blank(src[j]); j++;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Drop `import`/`export` directives — naming a package is not calling it. */
function stripDirectives(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*(?:import|export|part)\b/.test(line) ? '' : line))
    .join('\n');
}

const DECL_RE =
  /^\s*(?:@\w+\s+)*(?:abstract\s+|final\s+|base\s+|sealed\s+|interface\s+|mixin\s+)*(?:class|mixin|enum|extension|typedef)\s+([A-Za-z_]\w*)/gm;
/** Top-level function/getter: a declaration starting hard at column 0. */
const TOP_FN_RE = /^(?!\s)(?:[A-Za-z_][\w<>,?\[\]. ]*\s+)([a-zA-Z_]\w*)\s*\(/gm;

function dartFilesUnder(dir, out = []) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) dartFilesUnder(abs, out);
    else if (e.name.endsWith('.dart')) out.push(abs);
  }
  return out;
}

/** Public top-level declarations in a package's lib/, with the source line that
 *  declared each — the line is what makes `implements`-clause attribution work. */
function publicDeclarations(pkgDir) {
  const decls = new Map(); // name -> declaration line text
  for (const f of dartFilesUnder(join(pkgDir, 'lib'))) {
    const src = stripCommentsAndStrings(readFileSync(f, 'utf8'));
    for (const re of [DECL_RE, TOP_FN_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const name = m[1];
        if (!name || name.startsWith('_') || name.length < 3) continue;
        if (RESERVED.has(name)) continue;
        if (!decls.has(name)) {
          const lineStart = src.lastIndexOf('\n', m.index) + 1;
          let lineEnd = src.indexOf('{', m.index);
          if (lineEnd === -1) lineEnd = src.indexOf('\n', m.index);
          decls.set(name, src.slice(lineStart, lineEnd === -1 ? m.index + 200 : lineEnd));
        }
      }
    }
  }
  return decls;
}

/** Words TOP_FN_RE would otherwise mistake for a declared name. */
const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'assert', 'super', 'this',
  'new', 'await', 'yield', 'throw', 'else', 'try', 'set', 'get',
]);

// ── 0. the register ──────────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  fail([`✗ COVERAGE LOST — no capability register at ${REGISTER}.`]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  fail([`✗ capability register is not valid JSON: ${err.message}`]);
}
const capabilities = Array.isArray(register.capabilities) ? register.capabilities : [];
const consumerRoots = Array.isArray(register.consumerRoots) ? register.consumerRoots : [];

// ── 1. locate the brick, derived rather than hardcoded ───────────────────────
const brickRoots = consumerRoots.filter((r) => r.includes('__brick__'));
if (brickRoots.length !== 1) {
  fail([
    `✗ COVERAGE LOST — expected exactly ONE consumerRoot under \`__brick__\`, found ${brickRoots.length}.`,
    `  consumerRoots: ${JSON.stringify(consumerRoots)}`,
    '  Without the brick root this guard would range over an empty set and pass while wiring nothing —',
    '  which is the exact defect [pipeline S-2] was rewritten to avoid.',
  ]);
}
const BRICK = brickRoots[0];
const BRICK_ABS = join(ROOT, BRICK);
const BRICK_LIB = join(BRICK_ABS, 'lib');
if (!existsSync(BRICK_LIB)) {
  fail([`✗ COVERAGE LOST — the brick's lib/ is not at ${BRICK_LIB}. The scan is broken, not the tree.`]);
}

// ── 2. the derived set: capabilities the register says the stamp consumes ────
const wanted = capabilities.filter((c) => (c.consumers ?? []).includes(BRICK));
if (wanted.length === 0) {
  fail([
    '✗ COVERAGE LOST — no capability lists the brick as a consumer.',
    `  brick root: ${BRICK}`,
    '  An empty set makes "every capability is wired" vacuously true. Refusing to pass on it.',
  ]);
}

// ── 3. the brick's own source, with comments, strings and imports removed ────
const brickFiles = dartFilesUnder(BRICK_LIB);
if (brickFiles.length === 0) {
  fail([`✗ COVERAGE LOST — no .dart files under ${BRICK_LIB}.`]);
}
const brickRaw = brickFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const brickCode = stripDirectives(stripCommentsAndStrings(brickRaw));

// Names the BRICK declares. A brick-local `class TelemetryBootstrap` must never
// count as evidence that the brick calls the telemetry package's one.
const brickDeclared = new Set();
{
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(brickCode)) !== null) brickDeclared.add(m[1]);
}

// Import prefixes, derived from the brick's own imports: `as core` means a call
// may legitimately read `core.ConfigLoader(`.
// 🔴 BOTH quote styles, closing delimiter included (2026-08-01 full-corpus
// review, found alongside the same defect in assert-package-boundaries.mjs):
// the quote was hardcoded as `'` at both ends, so a double-quoted
// `import "package:x/x.dart" as y;` derived NO prefix and every `y.Symbol(`
// call went unseen. A backreference keeps the two delimiters paired.
const prefixOf = new Map(); // package name -> prefix
for (const m of brickRaw.matchAll(/^\s*import\s+(['"])package:([a-z0-9_]+)\/[^'"]*\1\s+as\s+(\w+)\s*;/gm)) {
  prefixOf.set(m[2], m[3]);
}

/** Is `sym` CALLED (constructed / invoked / a static member reached) in the brick? */
function calledInBrick(sym, pkg) {
  const p = prefixOf.get(pkg);
  const q = p ? `(?:${p}\\s*\\.\\s*)?` : '';
  //  Sym(...)            constructor or function call
  //  Sym.member(...)     named constructor, static method, factory
  const call = new RegExp(`(?<![\\w.])${q}${sym}\\s*\\(`);
  const staticCall = new RegExp(`(?<![\\w.])${q}${sym}\\s*\\.\\s*\\w+\\s*\\(`);
  return call.test(brickCode) || staticCall.test(brickCode);
}

// ── 4. attribute symbols, then assert a call ─────────────────────────────────
// Two owner counts, deliberately different, because the two directions want
// opposite kinds of safety:
//   · FORWARD (a claimed capability must be called) counts only WANTED
//     capabilities, so a package hosting one of them contributes all its public
//     symbols. Robustness against a FALSE FAILURE: the claim is already made,
//     we only need proof that something in the package runs.
//   · REVERSE (an unclaimed capability must NOT be called) counts ALL
//     capabilities, so a symbol is only ever attributed on hard evidence.
//     Conservatism against a FALSE FAILURE: accusing the register of having
//     fallen behind the tree should need more than a shared package.
const wantedOwnerCount = new Map();
for (const c of wanted) wantedOwnerCount.set(c.owner, (wantedOwnerCount.get(c.owner) ?? 0) + 1);
const allOwnerCount = new Map();
for (const c of capabilities) allOwnerCount.set(c.owner, (allOwnerCount.get(c.owner) ?? 0) + 1);

/** Symbols in `decls` attributable to `cap`. `shared` ⇒ evidence only. */
function attribute(cap, decls, shared) {
  if (!shared) return [...decls.keys()];
  const seamNames = new Set([
    ...(cap.seams ?? []).map((s) => s.symbol).filter(Boolean),
    ...(cap.implementsSeams ?? []),
  ]);
  const matrix = cap.capabilityMatrix?.symbol;
  return [...decls.entries()]
    .filter(([name, decl]) => {
      if (seamNames.has(name)) return true;
      if (matrix && name === matrix) return true;
      // `implements core.ReviewPrompter` — the clause may carry an import
      // prefix, so match the seam name as a dotted-path tail, not a bare word.
      for (const s of seamNames) {
        if (new RegExp(`(?:implements|extends|with)\\b[^{]*\\b(?:\\w+\\s*\\.\\s*)?${s}\\b`).test(decl)) return true;
      }
      return false;
    })
    .map(([name]) => name);
}

const problems = [];
const report = [];
let dartChecked = 0;

for (const cap of wanted) {
  const pkgDir = join(ROOT, cap.owner ?? '');
  const decls = cap.owner && existsSync(pkgDir) ? publicDeclarations(pkgDir) : new Map();

  // ── the non-Dart capability. packages/analysis ships a single .dart file whose
  // entire content is a comment saying it ships no Dart: its payload is
  // lib/analysis_options.yaml. A Dart call site cannot exist, so requiring one
  // would be a rule that fires on correct input. The real wiring mechanism is
  // asserted instead — the stamped config must reference the package.
  if (decls.size === 0) {
    const wiredNonDart = nonDartReference(cap.package);
    if (!cap.package) {
      problems.push(
        `${cap.id} — claims the stamp as a consumer but names no \`package\`, and its owner exposes no ` +
          'Dart API. There is nothing a stamp could wire.',
      );
    } else if (!wiredNonDart) {
      problems.push(
        `${cap.id} — the stamp declares \`${cap.package}\` but nothing in the stamped app references it. ` +
          `Its owner \`${cap.owner}\` ships no Dart API, so the wiring must appear in the stamped config ` +
          '(e.g. an analyzer `include:`), and it does not.',
      );
    } else {
      report.push(`${cap.id} → ${wiredNonDart} (non-Dart payload)`);
    }
    continue;
  }

  let symbols = attribute(cap, decls, (wantedOwnerCount.get(cap.owner) ?? 1) > 1);

  // A brick-declared name is struck from the evidence — declaration is not usage.
  const collisions = symbols.filter((s) => brickDeclared.has(s));
  symbols = symbols.filter((s) => !brickDeclared.has(s));

  if (symbols.length === 0) {
    problems.push(
      `${cap.id} — ZERO attributable symbols in \`${cap.owner}\`, so this capability cannot be checked at ` +
        'all. "Cannot be checked" must never read as "passes". Declare a seam, a capabilityMatrix, or an ' +
        'implementsSeams entry so the stamp\'s use of it is decidable.' +
        (collisions.length ? ` (Struck as brick-declared: ${collisions.join(', ')}.)` : ''),
    );
    continue;
  }

  dartChecked++;
  const hit = symbols.find((s) => calledInBrick(s, cap.package));
  if (!hit) {
    problems.push(
      `${cap.id} — the stamp DEPENDS on \`${cap.package}\` but never CALLS it. None of its ${symbols.length} ` +
        `public symbol(s) appears in a call position anywhere under ${BRICK}/lib. A dependency line proves ` +
        'the package was downloaded, never that a line of it runs. ' +
        `Symbols looked for: ${symbols.slice(0, 8).join(', ')}${symbols.length > 8 ? ', …' : ''}` +
        (collisions.length ? ` (Struck as brick-declared: ${collisions.join(', ')}.)` : ''),
    );
  } else {
    report.push(`${cap.id} → ${hit}`);
  }
}

/** Does any stamped NON-Dart file reference `pkg` outside the pubspec? */
function nonDartReference(pkg) {
  if (!pkg) return null;
  const skip = new Set(['pubspec.yaml', 'pubspec.lock', 'README.md']);
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = listDir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'build') continue;
      const abs = join(dir, e.name);
      const r = posix.join(rel, e.name);
      if (e.isDirectory()) {
        const found = walk(abs, r);
        if (found) return found;
        continue;
      }
      if (e.name.endsWith('.dart') || skip.has(e.name) || e.name.endsWith('.md')) continue;
      // `#` (yaml) and `//` (jsonc) comments stripped: a package named only in a
      // comment explaining why it is absent is not wiring.
      const text = readFileSync(abs, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').replace(/\/\/.*$/, ''))
        .join('\n');
      if (text.includes(pkg)) return r;
    }
    return null;
  };
  return walk(BRICK_ABS, '');
}

// ── 5. the relationship floor — every nikatru dep the stamp declares is wired ─
const pubspecPath = join(BRICK_ABS, 'pubspec.yaml');
const declaredPkgs = new Set();
if (existsSync(pubspecPath)) {
  for (const raw of readFileSync(pubspecPath, 'utf8').split('\n')) {
    const m = raw.replace(/#.*$/, '').match(/^\s+(nikatru_[a-z0-9_]+)\s*:/);
    if (m) declaredPkgs.add(m[1]);
  }
}
if (declaredPkgs.size === 0) {
  fail([
    `✗ COVERAGE LOST — the stamped pubspec at ${BRICK}/pubspec.yaml declares no \`nikatru_*\` package.`,
    '  Either the stamp has no chassis at all, or this scan stopped scanning. Both are failures.',
  ]);
}
// Deliberately the OTHER direction from the loop above, with no overlap: that
// loop checks every capability that CLAIMS the stamp, this one checks every
// package the stamp DECLARES. An unwired-but-claimed package is already reported
// above, so reporting it twice would only make the output look worse than the
// defect. What only this limb can catch is a package the stamp depends on that
// NO capability claims — which is precisely what happens if somebody quietly
// removes the brick from a register entry's `consumers`, shrinking the derived
// set. That is the "silently stopped checking" failure this floor exists for,
// and it is a relationship to the stamp's own pubspec rather than a number.
const claimedPkgs = new Set(wanted.map((c) => c.package).filter(Boolean));
for (const pkg of declaredPkgs) {
  if (!claimedPkgs.has(pkg)) {
    problems.push(
      `${pkg} — the stamped pubspec depends on it, but NO capability lists the stamp as a consumer of it. ` +
        'Either the register has fallen behind the stamp, or an entry\'s `consumers` lost the brick — which ' +
        'would shrink the set this guard ranges over and let it pass while checking less. [S-2]',
    );
  }
}

// ── 6. the reverse direction — the stamp may not call what it does not claim ──
// The pubspec relationship above cannot see one particular way the checked set
// shrinks: TWO capabilities can share ONE package (platform_storage hosts both
// `platform_storage` and `review`), so dropping the brick from `review`'s
// consumers removes it from every check while the pubspec still resolves and the
// other capability still claims the package. Nothing above would notice, and the
// guard would quietly check 8 things while reporting success — the exact
// "silently stopped checking" failure CLAUDE.md opens with.
//
// The stamp's own source is the independent record. If it CALLS a capability the
// register does not claim, the register is behind the tree. Attribution here is
// evidence-only (see `attribute`), so this accuses nobody on a shared package
// alone.
const unclaimed = capabilities.filter((c) => !(c.consumers ?? []).includes(BRICK));
for (const cap of unclaimed) {
  const pkgDir = join(ROOT, cap.owner ?? '');
  if (!cap.owner || !existsSync(pkgDir)) continue;
  const decls = publicDeclarations(pkgDir);
  if (decls.size === 0) continue;
  const symbols = attribute(cap, decls, (allOwnerCount.get(cap.owner) ?? 1) > 1)
    .filter((s) => !brickDeclared.has(s));
  const hit = symbols.find((s) => calledInBrick(s, cap.package));
  if (hit) {
    problems.push(
      `${cap.id} — the stamp CALLS \`${hit}\`, which belongs to this capability, but the register does not ` +
        `list the stamp among its consumers. Either the register lost the brick from \`${cap.id}.consumers\` ` +
        '(shrinking what this guard checks, invisibly), or the stamp reached for a capability nobody ' +
        'registered for it. [S-2]',
    );
  }
}

if (problems.length) {
  console.error(`✗ stamp wiring — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline S-2] the stamp wires every chassis capability the register declares.');
  console.error(`  Register: tooling/capability-register.json · Stamp: ${BRICK}`);
  process.exit(1);
}

for (const r of report) console.log(`    ${r}`);
console.log(
  `ok  stamp wiring — ${wanted.length} capability(ies) claim the stamp; ${dartChecked} proved by a Dart ` +
    `call site, ${wanted.length - dartChecked} by non-Dart payload; ${declaredPkgs.size} declared ` +
    `nikatru package(s) all accounted for; ${brickFiles.length} stamped lib file(s) scanned`,
);
