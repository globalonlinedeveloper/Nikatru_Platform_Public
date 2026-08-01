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

// Floors, RATCHETED to just under reality instead of frozen at birth. 🔴 The
// original values (15/4/140) were written when the tree carried 18 guards and
// never moved again — triage 2026-07-31 (mutation-proven): with 37 guards on
// disk, MOVING 22 OF THEM into a subfolder still reported "ok 15 guard(s)",
// because a floor at ~40% of reality guards against nothing that can actually
// happen. Measured at the 2026-07-31 ratchet: 37 guards, 27 test files, 533
// test declarations. When the tree grows, ratchet these UP behind it; a count
// below any floor means this scan broke, not that the guards vanished.
// The floors are also backed by a RELATIONSHIP below: every guard ci.yml
// invokes must be a file this scan found, so the manifest CI actually runs is
// what anchors the set, not just a number that goes stale.
// Re-measured at the 2026-08-01 ratchet (assert-green-means-ran.mjs landing):
// 38 guards, 28 test files, 614 test declarations — floors moved up behind it.
// Re-measured again 2026-08-01 (assert-store-metadata.mjs landing, [10]D-5):
// 40 guards, 31 test files, 710 test declarations.
// Re-measured again 2026-08-01 (the Apple + Snap channels landing, [10]D-5/D-10):
// 40 guards, 33 test files, 830 test declarations. Guard count is UNCHANGED and
// that is correct — submit-appstore.mjs and submit-snap.mjs live in
// tooling/release/, which this scan deliberately does not cover: they are
// release paths, not guards. Their negative tests are in tooling/ci/test/ all
// the same, so the two new test FILES do move that floor.
// Re-measured ONCE MORE 2026-08-01, on the merged tree (the android-play channel
// path landing on top of the above). Still 40 guards — submit-play.mjs is also a
// release path, and assert-store-metadata.mjs / assert-channel-register.mjs were
// EXTENDED rather than duplicated. ⚠️ These numbers were RE-MEASURED against the
// merged result rather than taking the higher of the two branches' figures: two
// branches that each ratcheted honestly still produce a wrong floor when merged,
// because neither one ever saw the other's test files. Merged reality, measured:
// 40 guards, 34 test files, 871 test declarations.
// Re-measured 2026-08-01 (assert-deploy-triggers.mjs landing, corpus triage #30):
// 41 guards, 35 test files, 907 test declarations.
// Re-measured 2026-08-01 (brick stamp correctness, corpus triage #11/#24/#25):
// 41 guards, 35 test files, 938 test declarations. Guard count and file count are
// UNCHANGED and that is correct — assert-stamp-text-fidelity.mjs was EXTENDED to
// cover the release id and the catalogue name rather than duplicated into two new
// guards, so only the declaration floor moves. It moves to 900, which is 38 BELOW
// the measured 938: a floor pinned AT reality goes red on the next honest merge
// and teaches everyone to raise floors reflexively, which is how 15/4/140 came to
// sit at ~40% of the tree.
// Re-measured 2026-08-01 (guard-coverage-and-scanner-args, corpus triage
// #27/#28/#29/#39): 41 guards, 35 test files, 993 test declarations. Guard and
// file counts are UNCHANGED and that is correct — every fix EXTENDED an existing
// guard (assert-vendor-portability, assert-workflow-hardening, the two scanners)
// or added a section to one (assert-green-means-ran §C), so only the declaration
// floor moves: to 950, 43 below the measurement. ⚠️ THE SAME PR RETIRED TWO
// FLOORS OF THIS SHAPE ELSEWHERE — assert-workflow-hardening's 3/10 against 9/57
// and assert-vendor-portability's wrangler 5 against 11 — replacing them with
// relationships derived from the tree. These three survive because no
// relationship exists for them: the guard set is a directory listing, and the
// only thing that could derive its expected size is the listing itself. What
// backs them instead is the ci.yml invoked-guard cross-check below, which is a
// relationship; the numbers are the second line, not the first.
// Re-measured 2026-08-01 (assert-platform-register.mjs landing, [4]B-1/B-18/B-13):
// 42 guards, 36 test files, 1018 test declarations. All three move this time,
// because this change adds a whole guard and a whole test file rather than
// extending existing ones. Floors go to 40/34/980 — 2, 2 and 38 below the
// measurement, the same gaps the previous ratchet chose, for the same reason: a
// floor pinned AT reality goes red on the next honest merge and teaches everyone
// to raise floors reflexively, which is how 15/4/140 came to sit at ~40% of the
// tree.
//
// 🔴 RE-MEASURED ONCE MORE ON THE MERGE ITSELF (stage 3 · THE STAMPER meeting
// stage 4 · B-1). THIS IS THE CASE THE COMMENT SIX PARAGRAPHS UP WARNS ABOUT,
// arriving for the second time: BOTH branches independently ratcheted
// MIN_TEST_FILES to 34 against their own honest measurement of 36, and neither
// could see the other's new test file. Taking either side — or the higher of the
// two, which is the tempting shortcut — would have left the floor describing a
// tree that never existed. Stage 3 EXTENDED four guards and added no scanner, so
// the guard count is stage 4's alone; the test files and declarations are the
// union of both.
// Merged reality, MEASURED on the resolved tree (not predicted from either
// branch): 42 guards, 37 test files, 1060 test declarations. Floors 40/35/1000 —
// 2, 2 and 60 below.
//
// 🔴 AND A THIRD TIME, ON THE VERY NEXT MERGE (stage 8 · COMPLIANCE & LEGAL
// meeting the above). Stage 8 measured 44/38/1071 against ITS base and ratcheted
// honestly to 42/36/1033; the tree it merged into had already moved to
// 42/37/1060. Neither set is the merged tree's. Adding two guards
// (assert-repo-posture.mjs, assert-policy-archive.mjs) and two test files to a
// 42/37 base, plus stage 3's declarations this branch never saw, MEASURED on the
// resolved tree: 44 guards, 39 test files, 1106 test declarations.
// Floors 42/37/1068 — 2, 2 and 38 below. Three merges in a row have now produced
// a number neither branch could have predicted; this comment is the third
// consecutive piece of evidence that the rule is "measure after resolving", and
// that "take the higher one" is the same mistake wearing a disguise.
//
// 🔴 AND A FOURTH TIME, ON THE MERGE AFTER THAT (the stage-4 CONTINUATION —
// assert-ceiling-budget.mjs for [4]B-6 — meeting stage 8's compliance work).
// FOURTH CONSECUTIVE MERGE, FOURTH NUMBER NEITHER BRANCH COULD HAVE PREDICTED.
// This branch measured 43/37/1058 against its own base (cc2fb2d) and ratcheted
// honestly to 41/35/1020; while it was in flight main moved to 44/39/1106 with
// floors 42/37/1068. Taking either side would describe a tree that never
// existed, and taking the higher of the two would UNDERCOUNT the declarations,
// because the two sets of new tests are disjoint and add up.
// This change contributes ONE guard (assert-ceiling-budget.mjs) and ONE test
// file (ceiling-budget.test.mjs); it also EXTENDED assert-lockfile-discipline
// and assert-guard-coverage rather than duplicating them, so those move no
// counts.
// MEASURED on the resolved tree AFTER the rebase, from the actual directory
// listing and the actual declaration count — not predicted from either branch:
// 45 guards, 40 test files, 1146 test declarations. Floors 43/38/1108 — 2, 2
// and 38 below, the same gaps every previous ratchet chose.
const MIN_GUARDS = 43;
const MIN_TEST_FILES = 38;
// ⚠️ Counting FILES is not counting TESTS. Seven files containing nothing but
// comments satisfy MIN_TEST_FILES and run zero assertions, and `node --test`
// exits 0 on a glob that matches nothing at all (verified on node v24, 2026-07-27)
// — so the suite can be hollowed out or moved out from under its own glob while
// ci.yml's "The guards must be able to fail" step still reports success. Counting
// the declarations is what makes an empty suite loud.
const MIN_TEST_CASES = 1108;

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

/** [pipeline S-12r] EXECUTABLE PATHS OUTSIDE tooling/ci THAT STILL NEED A
 *  NEGATIVE TEST — named individually, never globbed.
 *
 *  Why named: this guard's whole subject set is "the .mjs files in tooling/ci",
 *  and widening it to `tooling/**` would sweep in the release scripts, whose
 *  coverage story is different (they are dry-run exercised in ci.yml, and their
 *  tests are already here). A glob would also silently acquire new subjects,
 *  which is how a list stops being reasoned. Adding to this map should feel as
 *  expensive as adding to NOT_A_SCANNER above, and for the same reason.
 *
 *  Why this entry: `tooling/scripts/provision-backend.mjs` is the ONE command
 *  the stamp's printed checklist tells the owner to run, and it had neither
 *  property F-10 requires — `grep -rn provision-backend .github/` returned zero
 *  and no test named it — purely because it sits one directory away from the set
 *  this scan reads. That is a filing accident deciding what gets covered. */
const COVERED_SCRIPTS = new Map([
  [
    'tooling/scripts/provision-backend.mjs',
    "the stamp's checklist names it as the one command that provisions a backend; its config surgery rewrites a uuid in a JSONC file and is scoped so the SHARED PLATFORM_DB binding is never the one rewritten.",
  ],
]);

const problems = [];

if (!existsSync(CI) || !existsSync(TESTS)) {
  console.error(`✗ COVERAGE LOST — expected ${CI} and ${TESTS} to exist. The scan is broken, not the tree.`);
  process.exit(1);
}

const guards = readdirSync(CI).filter((f) => f.endsWith('.mjs')).sort();
const testFiles = readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).sort();
const scanningRealRepo = process.argv[2] === undefined;

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

// ── the RELATIONSHIP behind the floors: ci.yml is the committed manifest ─────
// A floor is a number and numbers go stale — the 15/4/140 set proved it. What
// cannot go stale is the workflow that actually runs the guards: every
// `node tooling/ci/<guard>.mjs` invocation in ci.yml names a file CI depends
// on, so any invoked guard this scan cannot find means the scan and the
// pipeline have diverged — the scan is looking at the wrong tree, or a guard
// CI runs was deleted/moved without ci.yml following. Either way: not clean.
// (Fixture roots carry no ci.yml, so the cross-check applies when the manifest
// exists — and its ABSENCE on the real repo is itself coverage lost.)
const ciYml = join(ROOT, '.github', 'workflows', 'ci.yml');
if (existsSync(ciYml)) {
  const yml = readFileSync(ciYml, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const invoked = [...new Set([...yml.matchAll(/tooling\/ci\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1]))].sort();
  const unfound = invoked.filter((g) => !guards.includes(g));
  if (unfound.length) {
    console.error(`✗ COVERAGE LOST — ci.yml invokes ${unfound.length} guard(s) this scan did not find: ${unfound.join(', ')}`);
    console.error('  The manifest CI runs and the set this guard audits have diverged. Either the guard');
    console.error('  was deleted/moved while ci.yml still calls it, or this scan reads the wrong directory.');
    process.exit(1);
  }
} else if (scanningRealRepo) {
  console.error('✗ COVERAGE LOST — .github/workflows/ci.yml not found, so the invoked-guard cross-check ran over nothing.');
  console.error('  The floors alone cannot anchor the guard set; the manifest must exist to be checked against.');
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

// ── [pipeline S-12r] the named non-guard executables ────────────────────────
// Each must EXIST and be named by an executable line in the suite. The
// existence half is the self-check: a map entry pointing at a file that has been
// moved or deleted would otherwise sit here looking like coverage while
// covering nothing, which is this guard's own failure mode applied to itself.
let covered = 0;
for (const [rel, reason] of COVERED_SCRIPTS) {
  if (!existsSync(join(ROOT, rel))) {
    problems.push(
      `COVERAGE LOST — ${rel} is named in COVERED_SCRIPTS but does not exist. Either it moved and ` +
        'this entry was not updated, or it was deleted and the entry should have gone with it. A map ' +
        'entry pointing at nothing reports coverage over nothing.',
    );
    continue;
  }
  const base = rel.split('/').pop();
  if (!testCorpus.includes(base)) {
    problems.push(
      `${rel} — no test file mentions it, though it is required to have one because ${reason} ` +
        'It has only ever run against valid input, so nothing exercises its failing path.',
    );
  } else {
    covered++;
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
    `${scanners} carry a coverage self-check, ${exempt} exempt with a recorded reason; ` +
    `${covered} named non-guard script(s) outside tooling/ci also covered`,
);
