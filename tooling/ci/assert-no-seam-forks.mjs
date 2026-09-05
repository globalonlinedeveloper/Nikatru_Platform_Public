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
//   3. PARITY — for a fork this repository has ACCEPTED rather than removed, the
//      chassis twin's capability gates must all still exist in it ([ADR 042])
//   4. THE WATCH — every OTHER chassis/fork screen pair, undecidable today (its
//      chassis gates on nothing), must STAY so or be PROMOTED into check 3
// Usage:  node tooling/ci/assert-no-seam-forks.mjs [repoRoot]
// Exit 0 = no forks. 1 = a fork, a lagging accepted fork, or an unpromoted pair.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'capability-register.json');

/** Floor. Below this the scan broke rather than the tree being clean — a fork
 *  checker that finds no contracts reports perfection. The FILE floors are one
 *  per root, at REQUIRED_COVERAGE below, beside the measurement that set them. */
const MIN_CONTRACTS = 5;

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

// ─────────────────────────────────────────────────────────────────────────────
// ── COVERAGE: ONE FLOOR PER ROOT, NEVER ONE FLOOR OVER THE UNION ─────────────
//
// 🔴 WHAT STOOD HERE UNTIL 2026-09-05 WAS A SINGLE FLOOR OVER THE SUM:
//       if (sharedFiles.length + suspectFiles.length < 10) …
//   Three roots pooled into one number, and a pooled number can be carried
//   entirely by ONE of them. That is the defect assert-no-tls-pinning.mjs was
//   repaired for, and this file held it in a worse form: there, three roots are
//   three samples of one subject. Here they are not. `packages/` supplies the
//   SHARED implementations; `apps/` and `tooling/bricks/` supply the SUSPECTS.
//   Lose one side and the comparison at the heart of this guard has no other
//   side left to make — it does not scan less, it stops being able to conclude.
//
// 🔬 MEASURED BY MUTATION AGAINST THIS TREE, 2026-09-05. Each root was moved
//   aside with `mv`, the guard run, the directory moved back, and `git status`
//   confirmed clean before the next one. Not argued, and not from fixtures:
//
//     mutation                            old guard          this guard
//     ───────────────────────────────────────────────────────────────────────
//     none — THE GREEN CONTROL            EXIT 0  ok         EXIT 0  ok
//     `packages/` removed                 EXIT 0  ok   ⚠️    EXIT 1  COVERAGE LOST
//     `apps/` removed                     EXIT 1 stale-waiver EXIT 1 COVERAGE LOST
//     `tooling/bricks/` removed           EXIT 1 arrive-limb  EXIT 1 COVERAGE LOST
//     apps/ shipped code removed, the     EXIT 1 stale-waiver EXIT 1 COVERAGE LOST
//       12 chassis/fork pair files kept
//     packages/design_system folded away  EXIT 0  ok         EXIT 0  ok
//     five Subly feature areas dropped    EXIT 0  ok         EXIT 0  ok
//     the brick's test/ folder moved      EXIT 0  ok         EXIT 0  ok
//
//   THE SECOND ROW IS THE WHOLE REASON THIS CHANGED. Delete the entire shared
//   chassis — every package, the home of every seam implementation — and the old
//   guard printed
//       ok  no seam forks — 17 contract(s), 180 file(s) scanned; 0 shared
//       implementation(s), 0 homeless, 1 declared, 3 accepted fork(s) at parity
//   and exited 0. 181 of 361 files gone, and not merely unscanned: with `shared`
//   empty, `homed` is empty, so every fork in an app or in the TEMPLATE is
//   reclassified HOMELESS and printed as a friendly ⚠ instead of failing the
//   build. The rule this guard exists for — "packages/ homes it AND the app has
//   its own → FORK" — cannot fire at all, and the sentence it prints while it
//   cannot fire begins with the word `ok`.
//
//   The last three rows are the other half of the discipline: a floor that fires
//   on honest work is switched off inside a week. Each is a real, legitimate
//   shrink (a package folded into another, features dropped from the app, a test
//   folder reorganised) and each must stay GREEN. They do.
//
// ⚠️ A CORRECTION TO THE STANDING WRITE-UP OF THIS DEFECT, since reading a plan
//   is not measuring a tree. It has been described as "apps/ and the brick could
//   BOTH empty and the floor would still be satisfied — it would print ok over a
//   tree that had lost the entire shipped product and the template". The FLOOR
//   is indeed satisfied, but the guard does NOT print ok: removing apps/ trips
//   the stale-waiver limb (two register violations point into it) and removing
//   tooling/bricks trips the arrive limb's empty-universe check. Both EXIT 1,
//   measured above. Those limbs are load-bearing by accident, not by design —
//   they fire on the register and on the brick features root, not on coverage —
//   and the direction nobody had looked at is the one that really does reach
//   `ok`: packages/. The union floor is exactly as broken as claimed; the
//   example given for it was wrong, and the true example is worse.
//
// ⚠️ THE FLOOR COUNTS THE SUBJECT, NOT THE FILES. For the two suspect roots the
//   subject is the NON-EXEMPT files: an `apps/` that has become nothing but
//   `test/` directories still holds 148 .dart files while EXEMPT_DIR skips every
//   one of them before it can be classified, so a floor on the raw count would
//   call that covered. The same choice keeps the floor off honest work in the
//   other direction — Subly's 69 test files are 47% of `apps/`, and reorganising
//   them must not redden a guard that never looked at them. Both measured
//   2026-09-05. For `packages/` the guard applies no such exemption (every file
//   there feeds the shared set, doubles included), so subject == files read, and
//   that asymmetry is stated here rather than left to be discovered.
// ─────────────────────────────────────────────────────────────────────────────

/** Derived from THIS tree on 2026-09-05, by the walk below and nothing else:
 *  `apps` 75 non-exempt of 148 .dart, `packages` 181 of 181, `tooling/bricks` 22
 *  of 32. Each floor is HALF its measured subject, rounded down — the ratio
 *  assert-no-tls-pinning.mjs uses, chosen over assert-no-gate-weakening's
 *  one-third because this subject is ONE app and ten packages, with no fleet for
 *  the count to swing with. Half means a root must lose more of itself than it
 *  keeps before this speaks, and the three legitimate shrinks in the table above
 *  (−40 packages, −5 app features, −10 brick test files) all clear it. */
const REQUIRED_COVERAGE = [
  {
    dir: 'apps',
    role: 'suspect',
    floor: 37,
    label: 'the shipped app — a fork here reaches the users who installed it (75 non-exempt .dart today)',
  },
  {
    dir: 'packages',
    role: 'shared',
    floor: 90,
    label:
      'the shared chassis — the ONLY place an implementation is "homed", so with this root thin nothing ' +
      'is a fork and every fork reads as homeless (181 .dart today)',
  },
  {
    dir: 'tooling/bricks',
    role: 'suspect',
    floor: 11,
    label:
      'the template every future app is stamped from — a fork here is not one bad app, it is every app ' +
      'the factory will ever make, born wrong (22 non-exempt .dart today)',
  },
];

/** The floors are measurements of THIS repository and mean nothing over a
 *  synthetic root — the fixtures in tooling/ci/test model one tree at a time with
 *  a handful of files in it. So they are applied only when ROOT is a full
 *  checkout, detected by this guard's OWN file being present under it: a sentinel
 *  that sits OUTSIDE all three subject roots and therefore survives any mutation
 *  OF a subject, which a sentinel inside apps/ or packages/ would not. Which
 *  branch was taken is PRINTED on every run rather than implied. */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-no-seam-forks.mjs'));

const perRoot = new Map();
for (const r of REQUIRED_COVERAGE) {
  const abs = join(ROOT, ...r.dir.split('/'));
  const found = [];
  dartFiles(abs, r.dir, found);
  perRoot.set(r.dir, {
    present: existsSync(abs),
    found,
    // What this guard can actually classify. Suspect roots lose their test
    // doubles and probes to EXEMPT_DIR before any decision is made about them.
    subject: r.role === 'suspect' ? found.filter((f) => !EXEMPT_DIR.test(f)) : found,
  });
}

/** Where a shared implementation legitimately lives. */
const sharedFiles = REQUIRED_COVERAGE.filter((r) => r.role === 'shared').flatMap(
  (r) => perRoot.get(r.dir).found,
);

/** Where a fork would live: shipped app code, and shipped TEMPLATE code. The
 *  template half is [2]C-9 and is why this guard cannot only scan apps/.
 *  ⚠️ ALL files, exempt ones included — the exemption is applied per suspect at
 *  classification time, and the stale-waiver limb below needs to see a waived
 *  path even when it lives under test/. Only the FLOOR reads `subject`. */
const suspectFiles = REQUIRED_COVERAGE.filter((r) => r.role === 'suspect').flatMap(
  (r) => perRoot.get(r.dir).found,
);

// Every root reports its own verdict and they are reported TOGETHER: a tree can
// lose two roots for two different reasons, and naming only the first sends the
// reader to fix half of it.
const coverageLost = [];
for (const r of REQUIRED_COVERAGE) {
  const t = perRoot.get(r.dir);
  if (!t.present) {
    coverageLost.push(`\`${r.dir}\` is not a directory under this root — ${r.label}.`);
  } else if (t.found.length === 0) {
    coverageLost.push(`\`${r.dir}\` exists but holds no .dart file at all — ${r.label}.`);
  } else if (t.subject.length === 0) {
    // Reachable only for a suspect root; `packages/` has subject === found.
    coverageLost.push(
      `all ${t.found.length} .dart file(s) under \`${r.dir}\` sit in a test/, integration_test/ or ` +
        `live_probe/ directory, so EXEMPT_DIR skips every one and nothing is left to classify — ${r.label}.`,
    );
  } else if (IS_FULL_CHECKOUT && t.subject.length < r.floor) {
    coverageLost.push(
      `\`${r.dir}\` yielded only ${t.subject.length} file(s) to classify, below its floor of ${r.floor} — ${r.label}.`,
    );
  }
}
if (coverageLost.length) {
  fail([
    `✗ COVERAGE LOST — ${coverageLost.length} of the ${REQUIRED_COVERAGE.length} declared root(s) did not deliver a subject:`,
    ...coverageLost.map((l) => `    · ${l}`),
    '',
    `  repo root used: ${ROOT}.`,
    '  This guard concludes by COMPARING two sides — what packages/ homes, and what apps/ and the brick',
    '  template hold. Lose either side and there is nothing to compare, which is not the same as a clean',
    '  tree: with packages/ thin, nothing is homed, so every fork is reclassified "homeless" and merely',
    '  printed. Each root carries its OWN floor deliberately. One floor over the three combined was',
    '  satisfied by apps/ and the brick alone, so packages/ could vanish entirely while this guard printed',
    '  `ok … 180 file(s) scanned; 0 shared implementation(s)`. Measured 2026-09-05, not feared.',
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

// ─────────────────────────────────────────────────────────────────────────────
// ── PARITY: A FORK THIS REPOSITORY ACCEPTED MUST STILL FOLLOW THE CHASSIS ────
//
// [ADR 042] — Subly's sign-in stays a fork. #275 canonicalised `/sign-in` onto
// the forked `LoginScreen` and DELETED the chassis `SignInScreen` from the app,
// for three good reasons (the ADR-027 deletion notice, which has no other
// surface; the `E2EKeys.login*` anchors the nightly legs drive; the localized
// `_friendlyMessage` mapping). The decision was to accept the divergence — and
// the price of accepting it is this limb, not a promise.
//
// 🔬 THE PRICE IS NOT THEORETICAL; IT HAD ALREADY BEEN PAID BEFORE THE ADR WAS
// EVEN WRITTEN. The brick's `SignInScreen` renders the Apple button only inside
// `if (caps.oauthRedirect …)` ([pipeline C-7], what identity can actually do
// HERE). The fork rendered it UNCONDITIONALLY, and a live probe of
// `GET /auth/v1/authorize?provider=apple` answered 400 "provider is not
// enabled". A fix to one screen does not reach the other, and nothing went red.
//
// THE DERIVATION, which is the whole guard ([ADR 042]:94-99):
//   Let C = the `caps.<field>` reads in the CHASSIS screen and F = the same set
//   in the FORK, both taken with comments AND string literals stripped.
//   Require C ⊆ F.  Today {oauthRedirect} ⊆ {oauthRedirect}.
//
// 🔴 THE STRIPPING IS NOT HYGIENE, IT IS THE ASSERTION. Measured 2026-08-11:
// login_screen.dart names `caps.oauthRedirect` in a COMMENT narrating the fix
// (lines 445 and 451) as well as in the live `if` at 464. A raw match is
// satisfied by the comment alone — the prose-grep false green this repository
// has a scar about. Delete the `if` and leave the comment, and an unstripped
// version of this limb still prints ok.
//
// WHY C ⊆ F AND NOT C = F: the fork legitimately carries MORE than the chassis
// (that is why it was kept). Requiring equality would fail the tree on the day
// it was written, which is a guard nobody keeps.
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT DO, because it was tried and rejected ON
// MEASUREMENT ([ADR 042]:105-108): the same rule over `ref.watch(<X>Provider)`
// false-positives on a CORRECT tree today — the brick watches
// `authRepositoryProvider` in `build`, the fork reads it with `ref.read` at
// three call sites. Same capability, different idiom. A rule with a known false
// positive on day one is switched off inside a week.
//
// ⚠️ AND THE IDENTIFIER `caps` IS PART OF THE CONTRACT, not an accident of this
// implementation. Rename the local in the CHASSIS and C empties → COVERAGE LOST
// below. Rename it in the FORK and F empties → every chassis read is reported
// missing. Both directions are LOUD; neither is silent, which is the only
// property that matters when the thing being watched is two files drifting.
//
// 🔬 NEGATIVE-TESTED AGAINST THE REAL TREE 2026-08-12, not against fixtures.
// [ADR 037]'s scar is that assert-seams-wired.mjs shipped broken with all six of
// its fixtures green; a fixture encodes the same misunderstanding as the guard
// it was written beside. Each mutation below was applied to the real file, the
// guard was run, and the original bytes were restored byte-identically:
//
//   1. [ADR 042]:121 — `if (caps.secureSessionStorage) …` added to the chassis
//      screen  → EXIT 1, naming login_screen.dart and the field it never reads.
//      (`dart format --output=none` exit 0 on the mutated file first, so the
//      mutation is real Dart and not a parse accident.)
//   2. [ADR 042]:122 — `if (caps.oauthRedirect && providers.any)` in the fork
//      narrowed to `if (providers.any)`, THE TWO COMMENT MENTIONS AT :445 AND
//      :451 LEFT IN PLACE  → EXIT 1, `fork reads {—}`. This is one mutation
//      testing two things: the limb reads the fork at all, and the stripping is
//      load-bearing — an unstripped version reads `caps.oauthRedirect` out of
//      the prose narrating the fix and prints ok.
//   3. PARITY_PAIRS emptied  → EXIT 1 COVERAGE LOST, not a silent pass. This is
//      the mutation that matters most: deleting the subject is how this limb
//      would otherwise die without a sound.
//   4. the pair's `fork` path re-pointed at a file that does not exist  →
//      EXIT 1 COVERAGE LOST naming the path.
//   5. the chassis gate narrowed so C empties  → EXIT 1 COVERAGE LOST. Without
//      this one the limb degrades into an assertion that cannot fail, which
//      this repository deletes rather than keeps.
//
// The fixture cases are in tooling/ci/test/no-seam-forks.test.mjs and are the
// SECOND line of evidence, not the first.
// ─────────────────────────────────────────────────────────────────────────────

/** Accepted forks and the chassis file each one must keep up with.
 *
 *  🔴 EMPTYING THIS LIST IS HOW THIS LIMB WOULD DIE QUIETLY — the loop below
 *  only ever speaks about a pair it was given, so zero pairs is a silent pass,
 *  the exact "a check that silently stopped checking" shape. MIN_PARITY_PAIRS
 *  is the floor that makes the deletion loud instead. A pair is removed only
 *  when the fork is GONE, and then the file-existence check below fails first
 *  and makes somebody decide. */
const PARITY_PAIRS = [
  {
    adr: 'ADR 042',
    chassis: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_in_screen.dart',
    fork: 'apps/subly/lib/features/auth/login_screen.dart',
    note: '#275 deleted the chassis SignInScreen from apps/subly; the fork is accepted, so it owes parity.',
  },
  {
    adr: 'ADR 042',
    chassis:
      'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/settings_screen.dart',
    fork: 'apps/subly/lib/features/settings/settings_screen.dart',
    note:
      'Listed UNSPECIFIED at [ADR 042]:260 because it was "not established that settings gates on that ' +
      'idiom at all". Established by measurement 2026-08-12: BOTH sides build the reminders tile inside ' +
      '`NotificationCapabilities.forPlatform(...)` and gate it on `if (!caps.canSchedule)`. Same idiom, ' +
      'same field, same seam as the auth pair. C = F = {canSchedule} on the day it landed — no day-one ' +
      'false positive, which is the bar [ADR 042]:267 sets for widening this rule.',
  },
  {
    adr: 'ADR 042',
    chassis: 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/home/home_screen.dart',
    fork: 'apps/subly/lib/features/home/home_screen.dart',
    note:
      '🔴 THIS PAIR IS IN NO ADR. [ADR 042]:256-260 enumerates THREE pairs and calls that the tree; it is ' +
      'not. Found 2026-08-12 by enumerating every brick screen that has a Subly counterpart (11) and ' +
      'measuring each, instead of trusting the list — the same false-negative shape CLAUDE.md records for ' +
      'ripgrep and Private/: a table is an assertion about files somebody once looked at. Both sides pass ' +
      '`platformCanSchedule: caps.canSchedule`. C = F = {canSchedule} when it landed.',
  },
];
/** 3, not 1: raising this floor with the list is the whole point of the floor.
 *  Left at 1, two of the three pairs could be deleted and the limb would still
 *  report a clean tree — the "check that silently stopped checking" shape this
 *  guard exists to refuse. */
const MIN_PARITY_PAIRS = 3;

/** ── THE WATCH ──────────────────────────────────────────────────────────────
 *  The other eight chassis/fork screen pairs. For each, the CHASSIS reads zero
 *  `caps.<field>`, so C = {} and C ⊆ F holds for ANY fork: the subset test
 *  cannot fail, and this guard deletes assertions that cannot fail rather than
 *  keeping them for the look of coverage. So they are NOT in PARITY_PAIRS.
 *
 *  🔴 BUT "UNDECIDABLE TODAY" IS ITSELF A CLAIM WITH AN EXPIRY, AND THAT CLAIM
 *  IS WHAT IS ENFORCED BELOW. The day somebody adds the first `caps.` gate to
 *  one of these chassis screens, the pair BECOMES decidable — and under the old
 *  one-pair guard that capability would have reached all 49 stamped apps and
 *  not Subly, in silence, which is the precise defect [ADR 042] was written
 *  about (the Apple button rendered against a provider the server 400s).
 *  The loop below fails the build at that moment and demands promotion into
 *  PARITY_PAIRS with its own two mutations ([ADR 042]:263).
 *
 *  This is the difference between a guard that is silent about eight pairs and
 *  one that is EXPLICIT about why it does not cover them and watches the reason
 *  hold. Silence is indistinguishable from coverage ([ADR 042]:262); this is
 *  not silent. */
const WATCHED_PAIRS = [
  ['firstrun/onboarding_screen.dart', 'onboarding/onboarding_screen.dart'],
  ['auth/check_inbox_screen.dart', 'auth/check_inbox_screen.dart'],
  // Added 2026-08-13 by the ARRIVE limb below, on its first run. It was the ONE
  // brick feature file with a Subly counterpart that appeared in neither list —
  // the count said 11 accounted and the filesystem said 12 pairs. Both sides
  // read zero `caps.<field>`, so it is undecidable exactly like the other eight
  // and belongs here rather than in PARITY_PAIRS.
  ['auth/legal_consent_fields.dart', 'auth/legal_consent_fields.dart'],
  ['auth/reaccept_terms_screen.dart', 'auth/reaccept_terms_screen.dart'],
  ['auth/reset_password_screen.dart', 'auth/reset_password_screen.dart'],
  ['auth/sign_up_screen.dart', 'auth/sign_up_screen.dart'],
  ['auth/verify_email_screen.dart', 'auth/verify_email_screen.dart'],
  ['monetization/manage_plan_screen.dart', 'monetization/manage_plan_screen.dart'],
  ['monetization/paywall_screen.dart', 'monetization/paywall_screen.dart'],
].map(([c, f]) => ({
  chassis: `tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/${c}`,
  fork: `apps/subly/lib/features/${f}`,
}));

/** Every brick screen with a Subly counterpart must be accounted for by exactly
 *  one of the two lists. Re-measured against the filesystem 2026-08-13: 12 such
 *  pairs — 3 decidable, 9 not. The floor is on the TOTAL so that PROMOTING a
 *  pair (moving it from the watch into PARITY_PAIRS) is free, while DELETING one
 *  is loud.
 *
 *  🔴 THIS FLOOR IS THE *VANISH* LIMB ONLY, AND ON ITS OWN IT WAS THE DEFECT IT
 *  DESCRIBES. It compares `PARITY_PAIRS.length + WATCHED_PAIRS.length` against a
 *  constant — three values that all live in THIS FILE. It never touches the
 *  filesystem, so it structurally cannot detect the condition its own failure
 *  message names: a pair that is "in NEITHER" list. It catches a pair being
 *  DELETED from the lists; it could not catch one ARRIVING in the tree, and it
 *  did not notice one that was never listed. Shipped at 11 while the tree held
 *  12 pairs — `auth/legal_consent_fields.dart` was unexamined and the guard
 *  printed ok. The ARRIVE limb below is the other half. */
const MIN_ACCOUNTED_PAIRS = 12;

/** Every `caps.<field>` read in a file — comments and string literals blanked
 *  first, so neither prose nor a quoted string can satisfy the requirement.
 *  `caps?.field` counts: it is the same read, and admitting it can only ever
 *  find MORE reads on both sides of the subset. */
const CAPS_READ = /\bcaps\??\.([A-Za-z_][A-Za-z0-9_]*)/g;
function capsReads(rel) {
  const src = stripStringLiterals(stripComments(readFileSync(join(ROOT, rel), 'utf8')));
  const out = new Set();
  for (const m of src.matchAll(CAPS_READ)) out.add(m[1]);
  return out;
}

const parityLost = [];
const parityGaps = [];
const parityOk = [];

if (PARITY_PAIRS.length < MIN_PARITY_PAIRS) {
  fail([
    `✗ COVERAGE LOST — ${PARITY_PAIRS.length} accepted-fork parity pair(s), expected at least ${MIN_PARITY_PAIRS}.`,
    '  [ADR 042] pays for an accepted fork with this obligation. With no pair to check, the limb',
    '  quantifies over nothing and reports a clean tree forever.',
  ]);
}

if (PARITY_PAIRS.length + WATCHED_PAIRS.length < MIN_ACCOUNTED_PAIRS) {
  fail([
    `✗ COVERAGE LOST — ${PARITY_PAIRS.length + WATCHED_PAIRS.length} chassis/fork screen pair(s) accounted ` +
      `for, expected at least ${MIN_ACCOUNTED_PAIRS}.`,
    '  Every brick screen with a Subly counterpart belongs to exactly one of PARITY_PAIRS (decidable,',
    '  enforced) or WATCHED_PAIRS (undecidable, watched). A pair that is in NEITHER is not "fine" — it is',
    '  unexamined, and unexamined reads exactly like clean. Promotion between the two lists is free;',
    '  dropping a pair out of both is what this floor refuses.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ARRIVE LIMB — the other half of coverage, derived from the FILESYSTEM.
//
// The floor above is a written list, deliberately: a fully derived list loses an
// entry at the moment the thing it names disappears. But a written list has the
// mirror-image blind spot — it cannot know about a screen pair that DID NOT
// EXIST when it was written. The two limbs point in opposite directions and
// neither substitutes for the other:
//   · the floor above catches a pair that VANISHED from the lists,
//   · this one catches a pair that ARRIVED in the tree.
// That is the same two-sided shape `check-migrations.mjs` [pipeline B-8] already
// spells out and implements; this guard shipped only the vanish half, which is
// why it read 11 while the tree held 12.
//
// PAIRING RULE: same relative path under `features/` on both sides. That is the
// convention every pair here follows except the two that were deliberately
// renamed (sign_in→login, firstrun→onboarding), and those are already listed by
// hand. A brick screen with NO same-path counterpart could still be forked under
// some other name, which no path rule can see — so those are PRINTED every run
// rather than passed over in silence, and the limitation is stated instead of
// being left for a reader to discover.
// ─────────────────────────────────────────────────────────────────────────────
const BRICK_FEATURES = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features';
const SUBLY_FEATURES = 'apps/subly/lib/features';

/** Every `.dart` under a features root, as paths relative to that root. */
function featureFiles(relRoot) {
  const abs = join(ROOT, relRoot);
  if (!existsSync(abs)) return null;
  const out = [];
  const walk = (dirRel) => {
    for (const e of listDir(join(abs, dirRel), { withFileTypes: true })) {
      const rel = dirRel ? posix.join(dirRel, e.name) : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.dart')) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

const brickFeatureFiles = featureFiles(BRICK_FEATURES);
// ZERO, not "fewer than MIN_ACCOUNTED_PAIRS". A count floor here would fire
// ahead of the parity and watch limbs' own per-file COVERAGE LOST checks and
// replace a precise diagnosis ("the chassis file is gone") with a vague one —
// measured: it swallowed that exact case. Those per-file checks already assert
// every listed chassis EXISTS under this same ROOT, so a mis-rooted or truncated
// walk is caught there, more specifically. What is left for this floor is the
// one condition they cannot see: an empty or absent universe, which would make
// `arrived` trivially empty and this whole limb an assertion that cannot fail.
if (brickFeatureFiles === null || brickFeatureFiles.length === 0) {
  fail([
    `✗ COVERAGE LOST — the brick features root produced NO .dart file(s) at ${BRICK_FEATURES}.`,
    '  The arrive limb derives its universe from this directory. With an empty universe it would compare',
    '  nothing against the lists and report a clean tree forever.',
  ]);
}

const accountedChassis = new Set(
  [...PARITY_PAIRS, ...WATCHED_PAIRS].map((p) => p.chassis.slice(`${BRICK_FEATURES}/`.length)),
);

const arrived = [];
const unpairedByPath = [];
for (const rel of brickFeatureFiles) {
  if (accountedChassis.has(rel)) continue;
  if (existsSync(join(ROOT, SUBLY_FEATURES, rel))) arrived.push(rel);
  else unpairedByPath.push(rel);
}

if (arrived.length) {
  fail([
    `✗ ${arrived.length} chassis/fork screen pair(s) exist on disk and are in NEITHER list:`,
    ...arrived.map((rel) => `    ${BRICK_FEATURES}/${rel}\n      ↔ ${SUBLY_FEATURES}/${rel}`),
    '',
    '  A pair in neither PARITY_PAIRS nor WATCHED_PAIRS is not "fine" — it is unexamined, and unexamined',
    '  reads exactly like clean. Decide which it is and add it:',
    '    · the chassis reads at least one `caps.<field>` → PARITY_PAIRS, with a note and its two mutations;',
    '    · the chassis reads none → WATCHED_PAIRS, where the watch below asserts that stays true.',
    '  Then raise MIN_ACCOUNTED_PAIRS to match, so the pair cannot later drop out of both in silence.',
  ]);
}

for (const pair of PARITY_PAIRS) {
  const missingFiles = [pair.chassis, pair.fork].filter((rel) => !existsSync(join(ROOT, rel)));
  if (missingFiles.length) {
    for (const rel of missingFiles) {
      parityLost.push(
        `    ${rel} — the file is not there, so the [${pair.adr}] pair cannot be compared at all.`,
      );
    }
    continue;
  }
  const chassisReads = capsReads(pair.chassis);
  const forkReads = capsReads(pair.fork);
  if (chassisReads.size === 0) {
    parityLost.push(
      `    ${pair.chassis} — 0 \`caps.<field>\` read(s) found. C is empty, so C ⊆ F holds for ANY fork:` +
        ' the subset test cannot fail and is therefore worse than none.',
    );
    continue;
  }
  const missing = [...chassisReads].filter((f) => !forkReads.has(f));
  if (missing.length) parityGaps.push({ pair, missing, chassisReads, forkReads });
  else parityOk.push({ pair, chassisReads });
}

// ── THE WATCH: every pair excluded for being undecidable must STILL be so ────
const watchLost = [];
const watchPromotable = [];
for (const pair of WATCHED_PAIRS) {
  const missingFiles = [pair.chassis, pair.fork].filter((rel) => !existsSync(join(ROOT, rel)));
  if (missingFiles.length) {
    for (const rel of missingFiles) {
      watchLost.push(`    ${rel} — the file is not there, so this pair is no longer being watched.`);
    }
    continue;
  }
  const chassisReads = capsReads(pair.chassis);
  if (chassisReads.size > 0) watchPromotable.push({ pair, chassisReads });
}

if (watchLost.length) {
  fail([
    `✗ COVERAGE LOST — the watch lost sight of ${watchLost.length} path(s):`,
    ...watchLost,
    '',
    '  A watched pair is one this guard has DECLARED it does not cover, and the declaration is only',
    '  honest while the files are where it says. Re-point it, or drop the pair in the same change that',
    '  deletes the screen — and mind MIN_ACCOUNTED_PAIRS, which is there to make that a decision.',
  ]);
}

if (watchPromotable.length) {
  const lines = [
    `✗ ${watchPromotable.length} watched pair(s) BECAME DECIDABLE and were not promoted:`,
  ];
  for (const w of watchPromotable) {
    lines.push(`    ${w.pair.chassis}`);
    lines.push(
      `      now reads {${[...w.chassisReads].sort().join(', ')}} — it gated on nothing when it was ` +
        'put on the watch, so C ⊆ F was vacuous and the pair was deliberately left out of PARITY_PAIRS.',
    );
    lines.push(`      Its fork is ${w.pair.fork}.`);
  }
  lines.push('');
  lines.push('  THIS IS THE MOMENT THE OLD GUARD WOULD HAVE MISSED. A chassis screen that gates on a');
  lines.push('  capability reaches every stamped app; the Subly fork of it only gets there if somebody');
  lines.push('  carries the gate across. That is [ADR 042] exactly — the Apple button shipped rendered');
  lines.push('  against a provider the server answers 400 for, and nothing went red.');
  lines.push('  Move this pair into PARITY_PAIRS, and give it ITS OWN two mutations ([ADR 042]:263)');
  lines.push('  before trusting it: an unmutated pair inflates apparent coverage.');
  fail(lines);
}

if (parityLost.length) {
  fail([
    `✗ COVERAGE LOST — the accepted-fork parity limb reached nothing in ${parityLost.length} place(s):`,
    ...parityLost,
    '',
    '  This limb is the price [ADR 042] charged for keeping a forked screen. A moved, renamed or',
    '  deleted file makes it silent, not satisfied. Re-point the pair above at where the code went —',
    '  or, if the fork was genuinely converged away, delete the pair in the same change that deletes',
    '  the file, so a person decides rather than a path 404 deciding for them.',
  ]);
}

if (parityGaps.length) {
  const lines = [
    `✗ ${parityGaps.length} accepted fork(s) have fallen behind the chassis screen they forked:`,
  ];
  for (const g of parityGaps) {
    lines.push(`    ${g.pair.fork}`);
    for (const f of g.missing) {
      lines.push(
        `      does NOT read \`caps.${f}\`, which the chassis gates on in ${g.pair.chassis}.`,
      );
    }
    lines.push(
      `      chassis reads {${[...g.chassisReads].sort().join(', ')}} · fork reads {${[...g.forkReads].sort().join(', ') || '—'}}`,
    );
  }
  lines.push('');
  lines.push('  [ADR 042] accepted this fork; the parity obligation is what it was accepted WITH. A chassis');
  lines.push('  auth capability that the fork never mentions reaches every stamped app EXCEPT this one, in');
  lines.push('  silence — which is the defect that already shipped once (the Apple button rendered');
  lines.push('  unconditionally against a provider the server answers 400 for).');
  lines.push('  Add the same gate to the fork, or move the behaviour into the chassis and converge — but');
  lines.push('  read [ADR 042] first: three behaviours only the fork carries need a home before it can go.');
  fail(lines);
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
for (const p of parityOk) {
  console.log(
    `✓  [${p.pair.adr}] parity — ${p.pair.fork} follows all ${p.chassisReads.size} chassis ` +
      `\`caps.\` read(s): ${[...p.chassisReads].sort().join(', ')}`,
  );
}
// Printed EVERY run, like homeless above: the gap this guard does not close is
// stated by the guard itself. A limitation nobody can see is a limitation that
// gets mistaken for coverage.
console.log(
  `⚠  [ADR 042] ${WATCHED_PAIRS.length} chassis/fork screen pair(s) are WATCHED, NOT COVERED — their ` +
    'chassis gates on no `caps.<field>`, so C ⊆ F is vacuous for them. They fail this guard the day ' +
    'that stops being true: ' +
    WATCHED_PAIRS.map((p) => p.chassis.replace(/^.*\/features\//, '')).join(', '),
);

// The ARRIVE limb's own blind spot, stated every run for the same reason. It
// pairs by identical path, so a brick screen forked under a DIFFERENT name is
// invisible to it — exactly how sign_in_screen→login_screen and
// firstrun→onboarding are shaped, which is why both are listed by hand. These
// files have no same-path counterpart; if one of them is silently forked
// elsewhere in apps/subly, no path rule here will say so.
if (unpairedByPath.length) {
  console.log(
    `⚠  ${unpairedByPath.length} brick feature file(s) have NO same-path Subly counterpart, so the arrive ` +
      'limb cannot decide them by path — a fork under a different NAME would not be seen: ' +
      unpairedByPath.join(', '),
  );
}

// 🔴 THE PASSING LINE PRINTS THE SPLIT, NOT THE POOLED TOTAL. It used to read
// "361 file(s) scanned" — one number over three roots, and that sentence stayed
// literally true at 180 with the whole of `packages/` deleted, which is how a
// reader confirms coverage from a line that no longer carries any. A per-root
// breakdown cannot be true of a collapsed tree. Which coverage branch ran is
// printed too: over a synthetic root the floors do not apply, and a run that
// silently skipped them would be indistinguishable from one that met them.
const split = REQUIRED_COVERAGE.map((r) => {
  const t = perRoot.get(r.dir);
  return `${r.dir}=${t.subject.length}${IS_FULL_CHECKOUT ? `/floor ${r.floor}` : ''}`;
}).join(', ');

console.log(
  `ok  no seam forks — ${contracts.size} contract(s), ${sharedFiles.length + suspectFiles.length} .dart file(s) read, ` +
    `classifiable per root [${split}]; ` +
    `${shared.length} shared implementation(s), ${homeless.length} homeless, ${waived.length} declared, ` +
    `${parityOk.length} accepted fork(s) at parity, ${WATCHED_PAIRS.length} watched` +
    (IS_FULL_CHECKOUT
      ? ''
      : '. NOTE: this root is not a checkout of this repository, so the per-root floors were NOT applied — ' +
        'only the structural "every declared root delivered something to classify" check ran.'),
);
