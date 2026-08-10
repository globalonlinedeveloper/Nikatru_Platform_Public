#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-seam-forks.mjs — one job, one implementation.
//
// [pipeline C-3] "No capability exists twice."
// [pipeline C-9] "A seam implementation never lives in the brick template."
//
// BOTH requirements named this file as their enforcement and BOTH were marked
// VERIFIED while it did not exist. The copies really were merged — that work
// happened — but nothing has ever watched for the next one. Proven 2026-07-28,
// against the real tree, not argued:
//   · a fork planted in the BRICK TEMPLATE passed assert-capability-register,
//     assert-clone-contract AND assert-seams-wired. Three guards, zero noticed.
//   · a RENAMED implementer in an app passed too, because the register's fork
//     check matches on class NAME, not on what the class implements.
// A fork in the template is the worse of the two: it is not one bad app, it is
// every app the factory will ever stamp, born wrong.
//
// 🔴 THE DISTINCTION THAT MAKES THIS GUARD USABLE. A naive "app implements a
// contract ⇒ fork" rule is WRONG, and would have demanded the deletion of the
// only auth implementation that exists:
//
//     shared implementation exists + app has its own  →  FORK      (fail)
//     the app holds the ONLY implementation           →  HOMELESS  (print)
//     inside test/ or live_probe/                     →  fine      (skip)
//
// Homeless is not this guard's problem to solve — it is [2]C-15's (the auth
// seam has no home). Failing the build over it would punish the tree for a gap
// in the spec. So it prints, every run, and stays visible.
//
// Checks:
//   1. coverage self-check — the register still yields contracts, and the scan
//      still reaches app and template source
//   2. every implementation of a registered contract, outside packages/, is
//      either a declared violation, a homeless sole implementation, or a FORK
//
// Usage:  node tooling/ci/assert-no-seam-forks.mjs [repoRoot]
// Exit 0 = no forks, 1 = a capability exists twice.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');

/** Floors. Below these the scan broke rather than the tree being clean — a fork
 *  checker that finds no contracts, or no source to search, reports perfection. */
const MIN_CONTRACTS = 5;
const MIN_SCANNED_FILES = 10;

/** Directories whose implementations are legitimate by construction. Test doubles
 *  and probes MUST implement contracts — that is what they are for. Verified
 *  2026-07-28: 3 doubles in the brick's own property test, 2 in Subly's tests,
 *  1 in a live probe. Without this a correct tree fires 6 false alarms on day
 *  one, and a guard that cries wolf is switched off inside a week. */
const EXEMPT_DIR = /(^|\/)(test|integration_test|live_probe)(\/|$)/;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

// ── the register supplies the contracts ──────────────────────────────────────
if (!existsSync(REGISTER)) {
  fail([`✗ COVERAGE LOST — no capability register at ${REGISTER}. [C-1] must land before this can run.`]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  fail([`✗ capability register is not valid JSON: ${err.message}`]);
}

const contracts = new Set();
for (const cap of register.capabilities ?? []) {
  for (const s of cap.seams ?? []) if (s.symbol) contracts.add(s.symbol);
}
if (contracts.size < MIN_CONTRACTS) {
  fail([
    `✗ COVERAGE LOST — the register yields ${contracts.size} contract(s), expected at least ${MIN_CONTRACTS}.`,
    '  A fork checker with no contracts to check reports a clean tree forever.',
  ]);
}

// ── collect .dart files under a root ─────────────────────────────────────────
function dartFiles(absDir, rel, out) {
  let entries;
  try {
    entries = listDir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === '.dart_tool') continue;
    const abs = join(absDir, e.name);
    const r = posix.join(rel, e.name);
    if (e.isDirectory()) dartFiles(abs, r, out);
    else if (e.name.endsWith('.dart')) out.push(r);
  }
}

/** Where a shared implementation legitimately lives. */
const sharedFiles = [];
dartFiles(join(ROOT, 'packages'), 'packages', sharedFiles);

/** Where a fork would live: shipped app code, and shipped TEMPLATE code. The
 *  template half is [2]C-9 and is why this guard cannot only scan apps/. */
const suspectFiles = [];
dartFiles(join(ROOT, 'apps'), 'apps', suspectFiles);
dartFiles(join(ROOT, 'tooling', 'bricks'), 'tooling/bricks', suspectFiles);

if (sharedFiles.length + suspectFiles.length < MIN_SCANNED_FILES) {
  fail([
    `✗ COVERAGE LOST — scanned only ${sharedFiles.length + suspectFiles.length} dart file(s).`,
    `  repo root used: ${ROOT}. The scan is broken, not the tree.`,
  ]);
}

/** ⚠️ STRIP COMMENTS BEFORE MATCHING. The first version of this guard reported
 *  `class works implements AuthRepository` — the pattern had spanned out of a doc
 *  comment ("...the class works like...") into the real declaration below it.
 *  Same failure this repo has recorded twice: assert on structure, never on prose. */
/*  🔴 …AND THE FIRST FIX WAS TWO REGEXES, WHICH IS NOT A TOKENIZER (2026-08-07).
 *  The block pattern ran FIRST, so a `/*` inside a `//` line comment opened a
 *  phantom block running to the next `*​/`. The falsifier is this guard's own
 *  subject, which is what makes it worth the change:
 *
 *      // paths like services/​*​/src/ are scanned
 *      class Ghost implements AuthRepository {}
 *      const s = 'closes *​/';
 *
 *  → `class Ghost` is blanked and the fork this guard exists to find is gone,
 *  while it prints ok. Zero files in today's 217-file Dart corpus were affected,
 *  which is exactly why it had to be found by mutation and not by a green run.
 *  Same defect and same repair as assert-ops-register.mjs and
 *  assert-no-clone-tells.mjs; all three now share text-reductions.mjs. */
function stripComments(src) {
  return stripSourceComments(src, '.dart');
}

/** TWO detection modes, because they catch different forks and neither is enough:
 *   (a) CLAUSE — `class Anything implements <Contract>`. Catches a fork RENAMED to
 *       something else, which is precisely what the capability register's
 *       name-matching check cannot see.
 *   (b) NAME — `class <Contract>` with no clause at all. Subly's notification fork
 *       is exactly this: a standalone class of the same name that re-implements the
 *       behaviour without ever declaring the interface. Clause-matching misses it.
 *  The first version shipped with only (a) and silently missed the one real fork in
 *  the tree — found because the "declared violations" count came back 0. */
function implementersIn(files) {
  const names = [...contracts].join('|');
  // ⚠️ `abstract` is what separates a CONTRACT from an IMPLEMENTATION. Without
  // this, `abstract class AuthRepository` — the contract's own declaration in
  // packages/core — counts as a shared implementation of itself, and every real
  // implementation elsewhere is then misreported as a fork of it. Caught on the
  // second run: two homeless auth classes suddenly became "forks".
  const ABSTRACT = '(abstract\\s+(?:interface\\s+|base\\s+|final\\s+)?)?';
  const clause = new RegExp(
    `\\b${ABSTRACT}class\\s+([A-Za-z_][A-Za-z0-9_]*)[^;{}]*?\\b(?:implements|extends|with)\\b[^;{}]*?\\b(?:[A-Za-z_][A-Za-z0-9_]*\\.)?(${names})\\b`,
    'g',
  );
  const bareName = new RegExp(`\\b${ABSTRACT}class\\s+(${names})\\b`, 'g');
  const found = [];
  for (const rel of files) {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    const seen = new Set();
    for (const m of src.matchAll(clause)) {
      if (m[1]) continue; // abstract: declares or extends a contract, does not implement it
      seen.add(m[2]);
      found.push({ file: rel, className: m[2], contract: m[3], how: 'implements' });
    }
    for (const m of src.matchAll(bareName)) {
      if (m[1] || seen.has(m[2])) continue;
      found.push({ file: rel, className: m[2], contract: m[2], how: 'same name' });
    }
  }
  return found;
}

const shared = implementersIn(sharedFiles);
const suspects = implementersIn(suspectFiles);

/** A contract is "homed" once packages/ implements it. */
const homed = new Set(shared.map((s) => s.contract));

/** Violations already declared in the register are printed, not failed — the
 *  same posture assert-capability-register takes. The original reason was
 *  39-CHASSIS cut 1's freeze on apps/subly, which the agent could not reverse;
 *  that freeze is gone ([ADR 036], and the auth cut-1 reversal landed
 *  2026-08-10), so what a declaration means now is simply "known, dated, and
 *  owned by a named increment". */
const declared = new Set();
/** The same declarations WITH their claimed symbol, for the staleness check
 *  below. The set above is deliberately symbol-blind — a waiver waives a FILE —
 *  but "is this waiver still describing anything?" cannot be asked without
 *  knowing what it claimed to be. */
const declaredEntries = [];
for (const cap of register.capabilities ?? []) {
  for (const v of cap.violations ?? []) {
    if (!v.path) continue;
    const p = posix.normalize(v.path.replace(/\\/g, '/'));
    declared.add(p);
    declaredEntries.push({ path: p, symbol: v.symbol, kind: v.kind });
  }
}

const forks = [];
const homeless = [];
const waived = [];

for (const s of suspects) {
  if (EXEMPT_DIR.test(s.file)) continue;
  if (declared.has(s.file)) {
    waived.push(s);
  } else if (homed.has(s.contract)) {
    forks.push(s);
  } else {
    homeless.push(s);
  }
}

if (forks.length) {
  const lines = [`✗ ${forks.length} seam fork(s) — a capability exists twice:`];
  for (const f of forks) {
    const where = f.file.startsWith('tooling/bricks') ? 'THE TEMPLATE — every stamped app inherits this' : 'an app';
    lines.push(`    ${f.file}`);
    lines.push(`      class ${f.className} re-implements \`${f.contract}\`, which packages/ already provides — inside ${where}.`);
  }
  lines.push('');
  lines.push('  [C-3] no capability exists twice · [C-9] no seam implementation in the brick template.');
  lines.push('  Use the shared implementation, or declare it in tooling/capability-register.json');
  lines.push('  with a detail and a fixOwner if it is a known, blocked exception.');
  fail(lines);
}

// ── the declarations must still describe something ───────────────────────────
// 🔴 A WAIVER THAT MATCHES NOTHING IS AN EXEMPTION OVER NOTHING, AND IT IS
// WORSE THAN NO WAIVER: it reads as "known and managed" in the register, it
// costs nothing to leave behind, and it is a live re-entry permit — put a fork
// back at that exact path tomorrow and this guard waives it on sight without a
// single person deciding to.
//
// 🔬 THIS LIMB WAS WRITTEN BECAUSE THE CUT-1 REVERSAL PRODUCED THE FIRST ONE.
// `apps/subly/lib/data/auth/supabase_auth_repository.dart` was deleted on
// 2026-08-10 and its violation entry went on sitting in the register, matching
// nothing, printing nothing, failing nothing. The loop above only ever speaks
// when a suspect is FOUND, so a stale path is silent by construction — the
// exact "a check that silently stopped checking" shape this repository keeps
// paying for. The register's own doctrine already says an exception for
// something that is not there is judgement over nothing; this is that rule
// applied to itself.
//
// It fires on two things, and the second one is deliberately NARROW:
//   (i) THE FILE IS GONE — stale whatever the declaration claimed. Universal.
//  (ii) the file is there, the declaration claims a REGISTERED CONTRACT, and the
//       file no longer implements it. Scoped to registered contracts because
//       that is the only claim this guard can adjudicate: the register also
//       carries `capability-implemented-in-app` waivers (e.g. `AnalyticsFunnel`)
//       whose symbol is not a seam at all, so they are invisible to the scan
//       above by construction and "not a suspect" says nothing about them.
//       Measured, not assumed — the first version of this limb failed on exactly
//       that entry, which is a guard reporting a defect in its own reach as a
//       defect in the tree.
//
// ⚠️ WHAT IT CANNOT ADJUDICATE, STATED SO NOBODY READS ITS SILENCE AS A CLAIM:
// the `blockedBy` and `detail` PROSE. This limb decides whether the PATH is
// still real and whether the SYMBOL is still implemented there; it has no way to
// tell whether the sentence explaining why the waiver must stay is still true.
// Both halves were live on the same day: this limb caught the deleted
// `supabase_auth_repository.dart` entry, while the entry beside it claimed the
// `--proof` screenshot lane depended on `MockAuthRepository`'s fictional profile
// — which was false in both halves (the lane resolves the chassis
// InMemoryAuthRepository, whose identity has no displayName), and the file and
// symbol were both perfectly real, so nothing here fired. A waiver's REASON has
// to be re-measured by a person; passing this guard is not evidence about it.
const suspectPaths = new Set(suspects.map((s) => s.file));
const stale = [];
for (const d of declaredEntries) {
  if (!existsSync(join(ROOT, d.path))) {
    stale.push(`    ${d.path} — the file does not exist.`);
  } else if (contracts.has(d.symbol) && !suspectPaths.has(d.path)) {
    stale.push(
      `    ${d.path} — exists, but nothing in it declares or re-implements \`${d.symbol}\` any more.`,
    );
  }
}
if (stale.length) {
  fail([
    `✗ ${stale.length} declared violation(s) in tooling/capability-register.json match NOTHING in the tree:`,
    ...stale,
    '',
    '  A waiver over nothing is not harmless: it reads as a known, managed fork and it silently',
    '  re-authorises one at that path. Delete the entry (record the resolution in `resolved` if the',
    '  history is worth keeping), or re-point it at what it actually describes.',
  ]);
}

for (const h of homeless) {
  console.log(
    `⚠  ${h.file} — class ${h.className} implements \`${h.contract}\`, and packages/ provides NO ` +
      'implementation of it. Not a fork: it is the only one that exists. Homing it is [2]C-15.',
  );
}
for (const w of waived) {
  console.log(`⚠  ${w.file} — declared fork of \`${w.contract}\` (see the register's violations).`);
}

console.log(
  `ok  no seam forks — ${contracts.size} contract(s), ${sharedFiles.length + suspectFiles.length} file(s) scanned; ` +
    `${shared.length} shared implementation(s), ${homeless.length} homeless, ${waived.length} declared`,
);
