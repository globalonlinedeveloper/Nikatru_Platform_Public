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
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 2026-08-01 — THE THREE HAND-RATCHETED FLOORS ARE GONE. THIS FILE NO LONGER
//    CONTAINS A SINGLE HAND-MAINTAINED NUMBER.
//
// What was here: `MIN_GUARDS = 42`, `MIN_TEST_FILES = 37`, `MIN_TEST_CASES =
// 1068`, against a tree measuring 44/39/1106. Every increment that added a guard
// or a test file had to raise all three AND move its own fixtures in the same
// commit, so the floors were a THREE-LINE SHARED MUTABLE that every branch wrote
// to. With several agents working in parallel that is a guaranteed collision, and
// it collided on PR #112, #113 and #114 — three consecutive merges in one day.
//
// Each time, both branches had ratcheted HONESTLY against their own tree, and
// neither number described the merged result, because neither branch could see
// the other's new test files. The correct resolution was always "re-measure the
// merged tree"; the tempting one — take the higher of the two — is the same
// mistake wearing a disguise, and it was a manual step a human had to remember.
// A rule that depends on remembering will eventually be resolved wrongly, and
// the wrong resolution here is SILENT: a floor set too low guards nothing and
// still prints ok.
//
// The header used to record an honest limitation: "nothing but a directory
// listing can derive a directory listing's size". That is true of an ABSOLUTE
// COUNT, so this file no longer tries to derive one. It derives the
// RELATIONSHIPS instead — the same repair already made in
// `assert-vendor-portability.mjs` (every `services/*` dir must contribute ≥1
// wrangler surface) and `assert-workflow-hardening.mjs` (the scanned set must
// equal what `git ls-files` tracks, plus an accounting identity between two
// deliberately different `uses:` matchers).
//
//   ┌ WHAT REPLACED WHAT ────────────────────────────────────────────────────┐
//   │ MIN_GUARDS       →  THE INVOCATION IDENTITY (R1 + R2 below).           │
//   │                     The set of `.mjs` in tooling/ci must EQUAL the set │
//   │                     of tooling/ci guards the tracked workflows invoke. │
//   │                     Deleting a guard leaves the workflow naming a file │
//   │                     that is gone → fail. Adding a guard is fine the    │
//   │                     moment it is wired into a workflow, which is what  │
//   │                     "a guard exists" was always supposed to mean.      │
//   │                     Both directions, so neither set can shrink alone.  │
//   │                                                                        │
//   │ MIN_TEST_FILES   →  THE RATCHET MANIFEST'S KEY SET (R6).               │
//   │ MIN_TEST_CASES   →  THE RATCHET MANIFEST'S VALUES (R6).                │
//   │                     `tooling/ci/test/coverage-manifest.json` records   │
//   │                     the measured declaration count PER TEST FILE. A    │
//   │                     DROP — a file gone, or fewer cases in it — FAILS.  │
//   │                     A RISE rewrites the manifest and never fails.      │
//   └────────────────────────────────────────────────────────────────────────┘
//
// WHY PER-FILE IS THE WHOLE TRICK, AND NOT JUST "ONE NUMBER IN A FILE INSTEAD OF
// IN THE SOURCE": a single total is one line that every branch must write, which
// is exactly the collision being removed. Keyed by test file, two branches adding
// two different test files touch two different lines and git merges them without
// a word. And a per-file floor is STRICTLY STRONGER than the total ever was —
// under `MIN_TEST_CASES = 1068` against 1106, thirty-eight cases could be deleted
// from one file with nothing said; under the ratchet, one can not.
//
// THE LIMIT, STATED PLAINLY RATHER THAN PAPERED OVER: a ratchet has state, and
// state can be reset. Emptying or deleting the manifest is caught (both are
// COVERAGE LOST on the real repo), but LOWERING one recorded value by hand is
// not distinguishable from a test file that legitimately shrank. That exposure
// is not new — it is exactly what `MIN_TEST_CASES = 1068` already had — except
// that it is now one line per file in a diff instead of one line for the whole
// suite, and every automatic rise is PRINTED, so a reviewer sees the ratchet move.
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:  node tooling/ci/assert-guard-coverage.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CI = join(ROOT, 'tooling', 'ci');
const TESTS = join(CI, 'test');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
/** The ratchet's state. Committed, because a floor nobody can see is not a floor. */
const MANIFEST = join(TESTS, 'coverage-manifest.json');
const MANIFEST_REL = 'tooling/ci/test/coverage-manifest.json';

/** No argument means CI's own invocation — the real repository, where the git
 *  manifest and the ratchet state MUST both be readable. A caller pointing this
 *  at a fixture root is a different, weaker situation and says so out loud. */
const scanningRealRepo = process.argv[2] === undefined;

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

/** [pipeline S-12r] EXECUTABLES OUTSIDE tooling/ci THAT A WORKFLOW RUNS, and
 *  which are NOT required to carry a negative test — with the reason.
 *
 *  🔴 This used to be the opposite list: `COVERED_SCRIPTS`, a hand-written map
 *  naming the ONE script outside tooling/ci that had to have a test. A hand list
 *  of things to cover only ever covers what somebody remembered to add, which is
 *  the same shape as a hand-ratcheted floor — so the subject set is now DERIVED
 *  (every `tooling/**` script the tracked workflows actually invoke) and this map
 *  holds the exceptions instead. A new release script acquires the requirement by
 *  being wired into a workflow, not by somebody remembering this file exists.
 *
 *  The three entries are the e2e harness itself. They are exercised end-to-end
 *  every night by e2e.yml against a live Supabase — a stronger signal than a
 *  fixture, and the reason their absence from test/ is a recorded exception
 *  rather than an oversight. Naming them here is what makes the gap VISIBLE; the
 *  passing line counts them out loud. */
const NO_NEGATIVE_TEST_NEEDED = new Map([
  [
    'tooling/e2e/provision_user.mjs',
    'is the e2e harness, not a guard: e2e.yml runs it nightly against a live Supabase, so it is exercised against the real system rather than a fixture.',
  ],
  [
    'tooling/e2e/verify_row.mjs',
    'is the e2e harness, not a guard: its whole purpose is the live assertion, which e2e.yml performs nightly against real data.',
  ],
  [
    'tooling/e2e/purge.mjs',
    'is the e2e harness teardown, run nightly by e2e.yml against the live project; a fixture cannot model the thing it exists to clean up.',
  ],
]);

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

if (!existsSync(CI) || !existsSync(TESTS)) {
  coverageLost([
    `expected ${CI} and ${TESTS} to exist.`,
    'The scan is broken, not the tree.',
  ]);
}

const guards = readdirSync(CI).filter((f) => f.endsWith('.mjs')).sort();
const testFiles = readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();

// ── the scan is FLAT by design, so a subfolder must be LOUD, not a leak ──────
// readdirSync(CI) does not recurse. Triage 2026-07-31 (mutation-proven): a
// "tidy into tooling/ci/guards/" refactor moved 22 guards into a subfolder and
// this guard printed its intended pass message over the 15 that remained —
// every moved guard silently left BOTH per-guard checks. Guards live flat in
// tooling/ci on purpose; any .mjs in a subdirectory (test/ excepted — that is
// the suite, audited separately below) is either a guard this scan can no
// longer see or a new layout this guard was never taught.
const strayMjs = [];
const findStray = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) findStray(join(dir, e.name), `${rel}${e.name}/`);
    else if (e.name.endsWith('.mjs')) strayMjs.push(`${rel}${e.name}`);
  }
};
for (const e of readdirSync(CI, { withFileTypes: true })) {
  if (e.isDirectory() && e.name !== 'test') findStray(join(CI, e.name), `${e.name}/`);
}
if (strayMjs.length) {
  console.error(`✗ COVERAGE LOST — ${strayMjs.length} .mjs file(s) sit in subdirectories of tooling/ci this scan does not reach:`);
  for (const s of strayMjs) console.error(`    tooling/ci/${s}`);
  console.error('  A guard moved into a subfolder leaves BOTH checks (negative test + self-check) silently.');
  console.error('  Move it back to tooling/ci/, or teach this guard the new layout in the same change.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE INVOCATION IDENTITY — what replaced MIN_GUARDS.
//
// A floor could only ever say "not zero-ish", and it said it against a number
// somebody had to keep raising. What is actually TRUE, and stays true at any
// size of tree, is that a guard exists in order to be RUN: every `.mjs` under
// tooling/ci is invoked by a workflow, and every tooling/ci invocation in a
// workflow names a file that is there. Two set inclusions, computed from the
// tree on every run, which together pin the guard set exactly.
//
// This is strictly stronger than the floor it replaces. Under `MIN_GUARDS = 42`
// against 44 guards, TWO guards could be deleted outright with nothing said —
// and `assert-gate-passed.mjs` and `record-deployment.mjs` were not even
// anchored, because the old cross-check read ci.yml alone and those two are
// invoked by the deploy workflows. Under the identity, deleting any one of the
// forty-four fails, and the two deploy-only guards are anchored like the rest.
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(WORKFLOWS)) {
  coverageLost([
    `${WORKFLOWS} does not exist, so the invocation identity ranged over nothing.`,
    'The workflows are the committed manifest of what CI actually runs — they are what anchors the',
    'guard set now that the floors are gone. Without them every guard below could vanish unremarked.',
  ]);
}

const workflowFiles = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

// (i) SCAN vs MANIFEST, the assert-workflow-hardening pattern. `git ls-files` is
//     the committed truth about which workflows exist; `workflowFiles` is what
//     this scan opened. If a workflow the repo tracks never got read, its
//     invocations are invisible and the identity below silently shrinks.
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', '.github/workflows'], { encoding: 'utf8' });
const trackedWorkflows =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))]
    : [];
if (trackedWorkflows.length === 0) {
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- .github/workflows\` returned no tracked workflow under ${ROOT}.`,
      'The manifest that anchors the guard set is unreadable, so "did I see every workflow" cannot be',
      'answered — and there is no floor left to fall back on, deliberately.',
    ]);
  }
} else {
  const unseen = trackedWorkflows.filter((t) => !workflowFiles.includes(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${trackedWorkflows.length} workflow(s) and this scan opened ${workflowFiles.length}; it never saw: ${unseen.join(', ')}.`,
      'Every unseen workflow takes its guard invocations with it, so the identity below would be computed',
      'over a smaller set and still print ok — which is the exact shape of the floors this replaced.',
    ]);
  }
}

// Comment lines are stripped so a commented-out step is not read as a live
// invocation — the same reason assert-workflow-hardening anchors its matcher.
const invokedGuards = new Set();
const invokedOutside = new Set();
const nestedInvocations = [];
for (const wf of workflowFiles) {
  const text = readFileSync(join(WORKFLOWS, wf), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  // Deliberately broad — `/` is inside the class — so a nested invocation is
  // SEEN and reported rather than quietly failing to match. (`node --test
  // "tooling/ci/test/*.test.mjs"` cannot match: `*` is outside the class.)
  for (const m of text.matchAll(/tooling\/([A-Za-z0-9._/-]+\.mjs)/g)) {
    const rel = `tooling/${m[1]}`;
    if (rel.startsWith('tooling/ci/')) {
      const tail = rel.slice('tooling/ci/'.length);
      if (tail.includes('/')) nestedInvocations.push(`${wf} → ${rel}`);
      else invokedGuards.add(tail);
    } else {
      invokedOutside.add(rel);
    }
  }
}
if (nestedInvocations.length) {
  coverageLost([
    `${nestedInvocations.length} workflow step(s) invoke a tooling/ci path this FLAT scan cannot audit:`,
    ...nestedInvocations.map((n) => `    ${n}`),
    'Guards live flat in tooling/ci so both per-guard checks reach them. A nested one is run by CI and',
    'audited by nobody.',
  ]);
}

// (ii) R1 — INVOKED ⊆ FOUND. A workflow naming a guard this scan cannot find
//      means the two have diverged: the guard was deleted or moved while CI
//      still calls it, or this scan is reading the wrong directory.
const unfound = [...invokedGuards].filter((g) => !guards.includes(g)).sort();
if (unfound.length) {
  coverageLost([
    `the workflows invoke ${unfound.length} guard(s) this scan did not find: ${unfound.join(', ')}.`,
    'The manifest CI runs and the set this guard audits have diverged. Either the guard was',
    'deleted/moved while a workflow still calls it, or this scan reads the wrong directory.',
  ]);
}

// (iii) R2 — FOUND ⊆ INVOKED. The other half, and the half that never existed
//       before. A guard nothing runs is a guard that cannot fail a build; it is
//       covered on paper and inert in practice.
//
//       THERE IS NO EXEMPTION LIST HERE ON PURPOSE. All forty-four guards are
//       invoked today, so an exemption map would be an unreachable branch —
//       and by this repo's own rule an assertion that cannot fail is worse than
//       none, because it inflates apparent coverage. If a guard ever genuinely
//       needs to exist unrun, the mechanism gets added THEN, with a reason and a
//       failing case of its own.
const uninvoked = guards.filter((g) => !invokedGuards.has(g));
if (uninvoked.length) {
  console.error(`✗ COVERAGE LOST — ${uninvoked.length} guard(s) in tooling/ci are invoked by NO workflow:`);
  for (const g of uninvoked) console.error(`    ${g}`);
  console.error('  A guard nothing runs cannot fail a build. It is covered on paper and inert in practice,');
  console.error('  and it inflates every count taken over this directory.');
  console.error('  Wire it into a workflow in the same change, or delete it.');
  process.exit(1);
}

const rawCorpus = testFiles.map((f) => readFileSync(join(TESTS, f), 'utf8')).join('\n');

// Only EXECUTABLE lines count as evidence. `includes()` over the raw text was
// satisfied by a guard's name sitting in a comment — so a test file could be
// gutted down to its header comment and still "cover" every guard it names.
const executable = (text) =>
  text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

const testCorpus = executable(rawCorpus);
const countCases = (text) => (text.match(/^\s*(test|it)\s*\(/gm) ?? []).length;

// A test file carrying no declaration is a file that runs nothing while still
// holding a manifest entry, so it must be caught before the ratchet records it.
const perFile = new Map(
  testFiles.map((f) => [f, countCases(executable(readFileSync(join(TESTS, f), 'utf8')))]),
);
const hollow = [...perFile.entries()].filter(([, n]) => n === 0).map(([f]) => f);
if (hollow.length) {
  console.error(`✗ COVERAGE LOST — ${hollow.length} test file(s) declare no tests: ${hollow.join(', ')}`);
  console.error('  The file is present so the ratchet would record a floor of zero for it, and it asserts nothing.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RATCHET — what replaced MIN_TEST_FILES and MIN_TEST_CASES.
//
// One number per test file, kept in a committed manifest THIS GUARD MAINTAINS.
//   · a recorded file that is gone      → FAIL (the test file was deleted)
//   · measured < recorded               → FAIL (cases were deleted from it)
//   · measured > recorded, or a new key → rewrite the manifest, print, PASS
//
// The asymmetry is the entire point. A rise is what an honest increment does, so
// it must never cost anything and must never need a hand edit; a drop is
// coverage leaving the tree, so it must be loud. Because the state is keyed by
// file, two branches that each add a test file write two different lines and
// merge without conflict — which is what the single shared MIN_TEST_CASES line
// could not do, and what cost three merges in one day.
// ─────────────────────────────────────────────────────────────────────────────
let recorded = {};
if (existsSync(MANIFEST)) {
  const text = readFileSync(MANIFEST, 'utf8');
  try {
    recorded = JSON.parse(text);
  } catch (e) {
    coverageLost([
      `${MANIFEST_REL} could not be parsed (${e.message}).`,
      'This file is the ratchet: unreadable means every per-file floor is gone at once, which would',
      'otherwise look exactly like a tree that had never recorded one.',
    ]);
  }
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) {
    coverageLost([`${MANIFEST_REL} is not a JSON object of "<test file>": <count>.`]);
  }
} else if (scanningRealRepo) {
  coverageLost([
    `${MANIFEST_REL} does not exist.`,
    'It is the ratchet state that replaced MIN_TEST_FILES and MIN_TEST_CASES — deleting it resets every',
    'per-file floor to nothing at once. On a fixture root this guard creates it; on the real repository',
    'its absence is the floor being removed, which is precisely what must not pass quietly.',
  ]);
}
if (scanningRealRepo && Object.keys(recorded).length === 0 && existsSync(MANIFEST)) {
  coverageLost([
    `${MANIFEST_REL} is empty.`,
    'An empty ratchet accepts any suite at all, including none — every file below would read as new and',
    'be recorded without complaint. Emptying it is deleting the floor, not resetting a cache.',
  ]);
}

const dropped = [];
for (const [f, was] of Object.entries(recorded)) {
  if (!perFile.has(f)) {
    dropped.push(`${f} — recorded with ${was} test case(s) and the file is GONE. Deleting a test file deletes a guard's only recorded failing case; if the retirement is deliberate, remove its entry here in the same change.`);
    continue;
  }
  const now = perFile.get(f);
  if (now < was) {
    dropped.push(`${f} — ${was} test case(s) recorded, ${now} found. ${was - now} case(s) left the suite.`);
  }
}
if (dropped.length) {
  console.error(`✗ COVERAGE LOST — the test-coverage ratchet went BACKWARDS in ${dropped.length} place(s):`);
  for (const d of dropped) console.error(`    ${d}`);
  console.error('');
  console.error(`  ${MANIFEST_REL} records the measured declaration count per test file. It rises by itself`);
  console.error('  and never needs a hand edit; it only ever fails when coverage LEAVES the tree, which is');
  console.error('  the one direction a floor was ever for.');
  process.exit(1);
}

// Rises and new files: rewrite, print, never fail. Written only when the bytes
// actually change, so an unchanged tree is never dirtied by running this guard.
const ratcheted = [];
const next = {};
for (const f of testFiles) {
  const now = perFile.get(f);
  const was = Object.prototype.hasOwnProperty.call(recorded, f) ? recorded[f] : null;
  if (was === null) ratcheted.push(`+ ${f} (${now})`);
  else if (now > was) ratcheted.push(`↑ ${f} ${was} → ${now}`);
  next[f] = now;
}
const serialised = `${JSON.stringify(Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]])), null, 2)}\n`;
if (!existsSync(MANIFEST) || readFileSync(MANIFEST, 'utf8') !== serialised) {
  try {
    writeFileSync(MANIFEST, serialised);
    if (ratcheted.length) {
      notes.push(`ratchet raised in ${MANIFEST_REL} — commit it with this change:`);
      for (const r of ratcheted) notes.push(`    ${r}`);
    }
  } catch (e) {
    notes.push(`could-not-establish — ${MANIFEST_REL} is not writable (${e.message}), so the ratchet could not rise. The floors it already records still hold.`);
  }
}

const totalCases = [...perFile.values()].reduce((a, b) => a + b, 0);

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

// ── [pipeline S-12r] the workflow-invoked executables OUTSIDE tooling/ci ─────
// DERIVED, not hand-listed: whatever the tracked workflows run under tooling/
// that is not a guard must still carry a negative test, or appear in
// NO_NEGATIVE_TEST_NEEDED with a reason. `tooling/scripts/provision-backend.mjs`
// — the one command the stamp's printed checklist tells the owner to run — had
// neither F-10 property purely because it sits one directory away from the set
// this scan reads. A filing accident was deciding what got covered.
let covered = 0;
const scriptExempt = [];
for (const rel of [...invokedOutside].sort()) {
  if (!existsSync(join(ROOT, rel))) {
    problems.push(
      `COVERAGE LOST — a workflow invokes ${rel}, which does not exist. CI runs a path that is not there, ` +
        'so the step either never runs or fails for a reason nobody reads as coverage loss.',
    );
    continue;
  }
  const reason = NO_NEGATIVE_TEST_NEEDED.get(rel);
  const base = rel.split('/').pop();
  // ⚠️ THERE IS DELIBERATELY NO "excused but a test names it after all" CHECK
  // here, though NOT_A_SCANNER carries the equivalent contradiction check above
  // and the symmetry is tempting. The signal is not strong enough to invert:
  // "the basename appears somewhere in the suite" is a WEAK proxy read as
  // positive evidence everywhere else in this file, and reading the same proxy
  // as negative evidence makes it fire on the one file that must name these
  // paths — THIS guard's own test, which has to model the exemption list to
  // test anything about it. Written, it failed immediately on its first real
  // run, and the only ways to satisfy it were to obfuscate the fixture or to
  // stop modelling the tree. An assertion that cannot tell its failure from a
  // false positive is worse than none, for the same reason as one that cannot
  // fail at all. The exemption is still self-checked below, against the DERIVED
  // signal — a workflow either invokes the script or it does not.
  if (testCorpus.includes(base)) {
    covered++;
  } else if (reason) {
    scriptExempt.push(`${rel} — ${reason}`);
  } else {
    problems.push(
      `${rel} — a workflow runs it and no test file mentions it. It has only ever run against valid ` +
        'input, so nothing exercises its failing path. Give it a negative test, or record an exception ' +
        'in NO_NEGATIVE_TEST_NEEDED with a reason that survives being read aloud.',
    );
  }
}
// The exemption map's own self-check: an entry naming a script no workflow runs
// any more sits there looking like a considered exception while covering
// nothing — this guard's failure mode applied to itself.
//
// REAL-REPO ONLY, because the map names THIS repository's paths: a fixture root
// legitimately has none of them, and firing there would mean every fixture had
// to model the e2e harness to say anything about anything else. Its own failing
// case is in `describe('real-repo mode')`, reached by invoking a copy of this
// guard inside a fixture with no argument — the same way ci.yml calls it.
for (const rel of scanningRealRepo ? NO_NEGATIVE_TEST_NEEDED.keys() : []) {
  if (!invokedOutside.has(rel)) {
    problems.push(
      `${rel} is excused in NO_NEGATIVE_TEST_NEEDED but no workflow invokes it. Either it moved and the ` +
        'entry did not follow, or it is retired and the entry should have gone with it. An exception ' +
        'for something that is not there reports judgement over nothing.',
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

if (scriptExempt.length) {
  console.log('⬜ workflow-invoked scripts outside tooling/ci with a recorded exception, printed not hidden:');
  for (const s of scriptExempt) console.log(`    ${s}`);
}
if (notes.length) {
  console.log('⬜ notes:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  guard coverage — ${guards.length} guard(s) in tooling/ci, exactly the ${invokedGuards.size} the ` +
    `${workflowFiles.length} workflow(s) invoke (identity holds, no floor involved); all named in ` +
    `${testFiles.length} test file(s); ${scanners} carry a coverage self-check, ${exempt} exempt with a ` +
    `recorded reason; ${covered} workflow-invoked script(s) outside tooling/ci also covered, ` +
    `${scriptExempt.length} excused; ratchet holds at ${totalCases} test case(s) across ${testFiles.length} file(s)`,
);
