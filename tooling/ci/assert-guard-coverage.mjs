#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-guard-coverage.mjs — F-10 enforcing itself.
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover." Until now that
// was a rule people followed, and the accounting lived in prose that went stale:
// the spec said "5 of 6 guards" while the tree had SEVENTEEN. A count nobody
// computes is a count that drifts, and every requirement in all fourteen stages
// rests on the guards actually still working.
//
// So this is the F-9 idea — every deployable unit is claimed by a lane — applied
// to the guards themselves. Two properties, checked mechanically:
//
//   1. NEGATIVE TEST. Every guard is named by at least one file in test/. A
//      guard nobody feeds known-bad input to has only ever run against the real
//      repository, which is valid input by definition, so only its passing path
//      is exercised.
//   2. COVERAGE SELF-CHECK. Every guard that SCANS something asserts its scan
//      still reaches the tree. A scan over nothing prints "ok" — this repo's
//      single most repeated failure. `check-migrations.mjs` silently dropped
//      from 5 files to 4 and reported PASS; `assert-clone-contract.mjs`
//      reported "no per-app D1 name appears" whether it had read 200 files or 0.
//
// ⚠️ THE EXCEPTIONS ARE NAMED AND REASONED, never a silent skip. Two guards do
// not scan a tree at all — they take arguments and call an API — so "did my scan
// reach everything" is not a question that applies to them. That is a real
// distinction, not a waiver, and it is written here where it is enforced rather
// than in a doc nobody reads. Adding to this list should feel expensive.
//
// It also self-checks, because a guard-coverage guard that stopped finding
// guards would report perfect coverage over an empty set.
//
// Usage:  node tooling/ci/assert-guard-coverage.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CI = join(ROOT, 'tooling', 'ci');
const TESTS = join(CI, 'test');

// Floors. The tree carries 18 guards, 7 test files and 178 test declarations; a
// count far below any of them means this scan broke, not that the guards vanished.
const MIN_GUARDS = 15;
const MIN_TEST_FILES = 4;
// ⚠️ Counting FILES is not counting TESTS. Seven files containing nothing but
// comments satisfy MIN_TEST_FILES and run zero assertions, and `node --test`
// exits 0 on a glob that matches nothing at all (verified on node v24, 2026-07-27)
// — so the suite can be hollowed out or moved out from under its own glob while
// ci.yml's "The guards must be able to fail" step still reports success. Counting
// the declarations is what makes an empty suite loud.
const MIN_TEST_CASES = 140;

/** The marker every scanning guard uses when its own reach falls short. Chosen
 *  because it is already this repo's idiom, so the check enforces the existing
 *  convention rather than inventing a second one. */
const COVERAGE_MARKER = 'COVERAGE LOST';

/** Guards that do not scan a tree, with the reason. NOT a waiver list — each
 *  entry is a claim that the coverage question does not apply, and the reason
 *  has to survive being read aloud. */
const NOT_A_SCANNER = new Map([
  [
    'assert-gate-passed.mjs',
    'takes a SHA and asks the GitHub API one question about it. There is no tree to under-reach; its failure mode is argument handling, which is where the real off-by-one lived and which its tests cover.',
  ],
  [
    'record-deployment.mjs',
    'writes a GitHub Deployment record. It performs an action rather than scanning anything, so there is no scope for it to silently cover less.',
  ],
]);

const problems = [];

if (!existsSync(CI) || !existsSync(TESTS)) {
  console.error(`✗ COVERAGE LOST — expected ${CI} and ${TESTS} to exist. The scan is broken, not the tree.`);
  process.exit(1);
}

const guards = readdirSync(CI).filter((f) => f.endsWith('.mjs')).sort();
const testFiles = readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();

// ── self-check first: this guard must still be finding guards ────────────────
if (guards.length < MIN_GUARDS) {
  console.error(`✗ COVERAGE LOST — found ${guards.length} guard(s) in ${CI}, expected at least ${MIN_GUARDS}.`);
  console.error('  A guard-coverage check that finds no guards reports perfect coverage.');
  process.exit(1);
}
if (testFiles.length < MIN_TEST_FILES) {
  console.error(`✗ COVERAGE LOST — found ${testFiles.length} test file(s), expected at least ${MIN_TEST_FILES}.`);
  process.exit(1);
}

const rawCorpus = testFiles.map((f) => readFileSync(join(TESTS, f), 'utf8')).join('\n');

// Only EXECUTABLE lines count as evidence. `includes()` over the raw text was
// satisfied by a guard's name sitting in a comment — so a test file could be
// gutted down to its header comment and still "cover" every guard it names.
const testCorpus = rawCorpus
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

const countCases = (text) => (text.match(/^\s*(test|it)\s*\(/gm) ?? []).length;

// (a) PER FILE — applies to any tree, so a fixture can prove this fires. A test
//     file carrying no declaration is a file that runs nothing while still
//     counting toward MIN_TEST_FILES.
const hollow = testFiles.filter((f) => countCases(readFileSync(join(TESTS, f), 'utf8')) === 0);
if (hollow.length) {
  console.error(`✗ COVERAGE LOST — ${hollow.length} test file(s) declare no tests: ${hollow.join(', ')}`);
  console.error('  The file is present so it still counts toward the file floor, and it asserts nothing.');
  process.exit(1);
}

// (b) WHOLE SUITE — only meaningful against the real repository, so it is skipped
//     when a caller points this guard at a fixture root. This is the one that
//     catches the suite being moved out from under ci.yml's glob: `node --test`
//     exits 0 on a pattern matching nothing (verified, node v24, 2026-07-27).
const scanningRealRepo = process.argv[2] === undefined;
const testCases = countCases(testCorpus);
if (scanningRealRepo && testCases < MIN_TEST_CASES) {
  console.error(`✗ COVERAGE LOST — found ${testCases} test declaration(s), expected at least ${MIN_TEST_CASES}.`);
  console.error('  Every requirement in all fourteen stages rests on these guards being exercised.');
  process.exit(1);
}

let scanners = 0;
let exempt = 0;
for (const guard of guards) {
  // 1. a recorded failing case
  if (!testCorpus.includes(guard)) {
    problems.push(
      `${guard} — no test file mentions it. It has only ever run against the real repo, ` +
        'which is valid input by definition, so nothing exercises its failing path.',
    );
  }

  // 2. a coverage self-check, unless it genuinely has nothing to scan
  const source = readFileSync(join(CI, guard), 'utf8');
  const hasMarker = source.includes(COVERAGE_MARKER);
  const reason = NOT_A_SCANNER.get(guard);
  if (hasMarker) {
    scanners++;
  } else if (reason) {
    exempt++;
  } else {
    problems.push(
      `${guard} — no "${COVERAGE_MARKER}" self-check. A scan that silently stops reaching the tree ` +
        'prints ok forever. Add one, or add this file to NOT_A_SCANNER with a reason that survives ' +
        'being read aloud.',
    );
  }
  // An exempt guard that later grows a scan should lose its exemption, not keep
  // it. Flag the contradiction rather than quietly preferring one signal.
  if (hasMarker && reason) {
    problems.push(
      `${guard} — listed in NOT_A_SCANNER but now contains a "${COVERAGE_MARKER}" check. ` +
        'It scans something after all; remove the exemption.',
    );
  }
}

if (problems.length) {
  console.error(`✗ guard coverage — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline F-10] Every guard needs a recorded failing case AND a self-check that');
  console.error('  its own scan still reaches everything it claims to cover. This is the mechanism');
  console.error('  every other requirement in all fourteen stages rests on.');
  process.exit(1);
}

console.log(
  `ok  guard coverage — ${guards.length} guard(s), all named in ${testFiles.length} test file(s); ` +
    `${scanners} carry a coverage self-check, ${exempt} exempt with a recorded reason`,
);
