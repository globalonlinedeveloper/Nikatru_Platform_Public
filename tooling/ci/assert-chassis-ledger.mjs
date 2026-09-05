#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-chassis-ledger.mjs — THE APP TEMPLATE IS A DECLARED SET, AND EVERY
// LINE OF IT IS ACCOUNTED FOR.
//
// [ADR 065] moves the generic chassis into packages/ and empties the template.
// [ADR 066] amends that step's target after measuring it as unsourced.
//
// ── WHY THIS EXISTS, AND IT IS NOT A TIDINESS ARGUMENT ──────────────────────
// The size of this template has been written down three times and been wrong
// three times, each figure written once and never re-derived:
//
//   ~205 lines    ADR 065's target. No derivation exists in either repository.
//   ~2,900-3,550  ADR 066's corrected floor. Counted lib/ and the arb only.
//   18,205        MEASURED 2026-09-05, 96 tracked files. The inherited TEST
//                 suite alone is 7,678 of them - 42% - and appears in no plan.
//
// A number that lives in prose is a measurement that stopped being taken. So it
// stops living in prose: every tracked file gets a row, and this guard keeps the
// rows and the tree in bijection and recomputes every count from the tree.
//
// 🔴 AND THE HOLE IT CLOSES IS REAL, MEASURED RATHER THAN ASSERTED. On
// 2026-09-05 an undeclared file was added to the brick and all 127
// `tooling/ci/assert-*.mjs` were run against it: it reddened ZERO of them.
// Seventeen were red both WITH and WITHOUT it - every one needing build
// artifacts, credentials or CLI args - so the difference was nil. Nothing in
// this repository noticed a new file appearing in the template every future app
// is stamped from. This guard is the first thing that does.
//
// ⚠️ THAT SEVENTEEN IS A PRIMARY-CHECKOUT NUMBER AND DOES NOT TRAVEL. In a
// detached worktree under a temp path the baseline is NINETEEN: two more go red
// for reasons that have nothing to do with the tree's content —
// `assert-apple-privacy-manifest` wants a `flutter pub get` that has not run
// there, and `assert-github-matrix` walks up for an ancestor holding both
// `Projects/` and `nikatru/`, which no temp path has. Two agents measuring
// against this file's seventeen on 2026-09-05 each caught the discrepancy by
// taking their own baseline first, which is the only reason their deltas were
// true. Quote a baseline WITH the checkout it came from, or it silently becomes
// somebody's wrong reference.
//
// ── WHAT IS CHECKED, AND WHY EACH LIMB CAN FAIL ─────────────────────────────
//   1. BIJECTION, BOTH DIRECTIONS. A tracked file with no row fails; a row
//      naming no tracked file fails. One direction alone is half a check: rows
//      would rot silently as files were deleted.
//   2. EVERY LINE COUNT IS RECOMPUTED. The ledger's number is compared against
//      the tree's, per file. A ledger that records what it wishes were true is
//      the prose problem again with a .json extension.
//   3. THE DECLARED TOTALS ARE RECOMPUTED from the rows, so the summary cannot
//      drift from the detail it summarises.
//   4. A `MOVES` ROW MUST CARRY A NEGATIVE `callSiteDelta`. This is [ADR 066]'s
//      rule made mechanical: a screen moves only when the calling code
//      measurably SHRINKS. It is not hypothetical - chassis steps 0-3 GREW this
//      template by 731 lines, and both shared-widget adoptions so far cost the
//      call site more than they removed.
//   5. `UNCLASSIFIED` IS A RATCHET. The count may fall and never rise, so a new
//      undecided file cannot be parked here quietly.
//   6. EVERY ROW CARRIES A REASON. An empty `why` is a row nobody thought about.
//
// ── COVERAGE, BECAUSE A SCAN OVER NOTHING PRINTS OK ─────────────────────────
// The recurring failure in this repository is a check that silently stopped
// checking. So: the brick root must exist and be non-empty, the ledger must
// parse, and the file count carries a floor. Which branch was taken PRINTS on
// every run rather than being implied.
//
// Usage:  node tooling/ci/assert-chassis-ledger.mjs [repoRoot]
// Exit 0 = every line of the template is accounted for.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const LEDGER_REL = 'tooling/chassis-ledger.json';

/** Measured 2026-09-05 at 96 files. A floor, not the count: the template may
 *  legitimately grow or shrink, but falling under this means the enumeration
 *  broke rather than the template emptying — step 4 removes LINES, and the
 *  files it deletes are a handful, not seventy. Raise it only with a
 *  measurement. */
const MIN_FILES = 60;

/** A sentinel OUTSIDE every subject tree, so it survives any mutation OF the
 *  subject — which a sentinel inside the brick would not. */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-chassis-ledger.mjs'));

const problems = [];
const notes = [];

const coverageLost = (lines) => {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-chassis-ledger: FAILED');
  process.exit(1);
};

// ── the tree ────────────────────────────────────────────────────────────────
let tracked;
try {
  tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', BRICK], {
    encoding: 'utf8', maxBuffer: 1 << 28,
  }).split('\n').filter(Boolean);
} catch {
  coverageLost([
    `\`git ls-files -- ${BRICK}\` failed, so the template's contents are unreadable.`,
    'Every limb below compares the ledger against that list. Without it this guard would compare a',
    'ledger against nothing and print ok — which is the exact shape it exists to prevent.',
  ]);
}

if (tracked.length === 0) {
  coverageLost([
    `no tracked file was found under ${BRICK}.`,
    'Either the template moved or this scan lost its grip on the tree. Both read as "nothing to check".',
  ]);
}
if (IS_FULL_CHECKOUT && tracked.length < MIN_FILES) {
  coverageLost([
    `only ${tracked.length} tracked file(s) under the template, below the floor of ${MIN_FILES}.`,
    'Chassis step 4 removes LINES; the files it deletes are a handful, not seventy. A drop this large is',
    'an enumeration that broke, not a template that emptied. If it is real, re-measure and lower the floor',
    'in the same commit as the deletion.',
  ]);
}

// ── the ledger ──────────────────────────────────────────────────────────────
const ledgerPath = join(ROOT, LEDGER_REL);
if (!existsSync(ledgerPath)) {
  coverageLost([
    `${LEDGER_REL} does not exist, so nothing declares what the template is allowed to contain.`,
    'Measured 2026-09-05: an undeclared file added to the brick reddened ZERO of the 127 assert-*.mjs',
    'guards. Without this ledger that hole is open again.',
  ]);
}
let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
} catch (e) {
  coverageLost([`${LEDGER_REL} is not readable JSON: ${e.message}`]);
}
// 🔴 THE NULL CHECK IS NOT DEFENSIVE PROGRAMMING — IT WAS A REAL HOLE, found by
// writing the test below. `JSON.parse('null')` succeeds and returns null, so a
// ledger file containing the four characters `null` sailed past the parse guard
// and then threw a raw TypeError on `ledger.files`. A stack trace is exit 1, so
// the build would still have been red — but red with a crash instead of the
// sentence that tells the reader the ledger is unusable, and a crash reads as a
// broken guard rather than a broken tree. Same for an array or a string.
if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
  coverageLost([
    `${LEDGER_REL} parsed, but not to an object — it is ${ledger === null ? 'null' : Array.isArray(ledger) ? 'an array' : typeof ledger}.`,
    'Nothing below can range over it, and every limb would report zero problems over zero rows.',
  ]);
}
if (!Array.isArray(ledger.files) || ledger.files.length === 0) {
  coverageLost([`${LEDGER_REL} declares no \`files\`, so the bijection below would hold vacuously.`]);
}

/** Lines exactly as the generator counted them: newline-separated, not counting
 *  a trailing empty segment. Kept in one place so the ledger and the guard can
 *  never disagree about what "a line" is. */
const linesOf = (relPath) => {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  const s = readFileSync(abs, 'utf8');
  if (s.length === 0) return 0;
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
};

const treeSet = new Set(tracked.map((p) => p.slice(BRICK.length + 1)));
const rowByPath = new Map();
for (const row of ledger.files) {
  if (rowByPath.has(row.path)) problems.push(`${LEDGER_REL} declares \`${row.path}\` twice.`);
  rowByPath.set(row.path, row);
}

// ── 1 · bijection, both directions ──────────────────────────────────────────
const undeclared = [...treeSet].filter((p) => !rowByPath.has(p)).sort();
const orphaned = [...rowByPath.keys()].filter((p) => !treeSet.has(p)).sort();

for (const p of undeclared) {
  problems.push(
    `${p} is tracked under the template and has NO ledger row. Every file a stamped app inherits must ` +
      'be accounted for — nothing else in this repository notices a new file appearing here.',
  );
}
for (const p of orphaned) {
  problems.push(
    `${LEDGER_REL} has a row for \`${p}\`, which is not tracked under the template. A row nobody can ` +
      'reach is the stale second copy this ledger exists to prevent — delete it, or restore the file.',
  );
}

// ── 2 · every count recomputed, and 4/6 · the verdict contract ──────────────
const VERDICTS = new Set(['STAYS', 'MOVES', 'GOES', 'UNCLASSIFIED']);
let sumLines = 0;
let unclassified = 0;

for (const [p, row] of rowByPath) {
  if (!treeSet.has(p)) continue; // already reported as orphaned

  const actual = linesOf(`${BRICK}/${p}`);
  if (actual === null) {
    problems.push(`${p} is tracked but absent from the working tree, so its size cannot be verified.`);
    continue;
  }
  if (row.lines !== actual) {
    problems.push(
      `${p}: the ledger records ${row.lines} line(s); the tree has ${actual}. The ledger is not the ` +
        'authority — the tree is. Re-measure and record what is there, in the same commit as the change.',
    );
  }
  sumLines += actual;

  if (!VERDICTS.has(row.verdict)) {
    problems.push(`${p}: verdict \`${row.verdict}\` is not one of ${[...VERDICTS].join(', ')}.`);
  }
  if (typeof row.why !== 'string' || row.why.trim().length === 0) {
    problems.push(`${p}: the row carries no \`why\`. A verdict without a reason is a row nobody thought about.`);
  }
  if (row.verdict === 'UNCLASSIFIED') unclassified++;

  if (row.verdict === 'MOVES' || row.verdict === 'GOES') {
    if (typeof row.callSiteDelta !== 'number') {
      problems.push(
        `${p}: verdict ${row.verdict} with no measured \`callSiteDelta\`. [ADR 066] — a screen moves only ` +
          'when the calling code measurably shrinks, and "measurably" means a number counted before the ' +
          'unit runs, not an expectation.',
      );
    } else if (row.verdict === 'MOVES' && row.callSiteDelta >= 0) {
      problems.push(
        `${p}: MOVES with callSiteDelta ${row.callSiteDelta >= 0 ? '+' : ''}${row.callSiteDelta}. That is a ` +
          'move which does NOT shrink the caller, and it is forbidden by [ADR 066] for a measured reason: ' +
          'chassis steps 0-3 GREW this template by 731 lines, and both shared-widget adoptions so far cost ' +
          'the call site more than they removed. "The chassis is tidier" is not a reason to grow the tree ' +
          'the chassis exists to shrink.',
      );
    } else if (row.verdict === 'GOES' && row.callSiteDelta > 0) {
      problems.push(`${p}: GOES with callSiteDelta +${row.callSiteDelta} — deleting it made the caller bigger.`);
    }
    if (row.verdict === 'MOVES' && (typeof row.target !== 'string' || !row.target.trim())) {
      problems.push(`${p}: MOVES without a \`target\` naming where it went.`);
    } else if (row.verdict === 'MOVES' && !existsSync(join(ROOT, row.target))) {
      problems.push(`${p}: MOVES to \`${row.target}\`, which does not exist.`);
    }
  }
}

// ── 3 · declared totals recomputed from the rows ────────────────────────────
const t = ledger.totals ?? {};
const declaredFiles = t.files;
const declaredLines = t.lines;
if (declaredFiles !== treeSet.size) {
  problems.push(`totals.files says ${declaredFiles}; the tree has ${treeSet.size}.`);
}
if (declaredLines !== sumLines) {
  problems.push(`totals.lines says ${declaredLines}; the rows sum to ${sumLines}.`);
}
if (t.unclassified !== unclassified) {
  problems.push(`totals.unclassified says ${t.unclassified}; ${unclassified} row(s) are UNCLASSIFIED.`);
}

// ── 5 · the ratchet ─────────────────────────────────────────────────────────
/** Measured 2026-09-05 at 28. It may only ever be LOWERED, and lowering it is
 *  the act of giving a file a measured verdict. A rise means somebody parked a
 *  new undecided file in the template. */
const UNCLASSIFIED_CEILING = 28;
if (unclassified > UNCLASSIFIED_CEILING) {
  problems.push(
    `${unclassified} file(s) are UNCLASSIFIED, above the ceiling of ${UNCLASSIFIED_CEILING}. This ratchet ` +
      'only goes down: a new file in the template must arrive with a measured verdict, not be parked as ' +
      'undecided.',
  );
} else if (unclassified < UNCLASSIFIED_CEILING) {
  notes.push(
    `⬜ ${unclassified} UNCLASSIFIED, below the ceiling of ${UNCLASSIFIED_CEILING} — lower ` +
      'UNCLASSIFIED_CEILING in this file to bank the progress, in the same commit that classified them.',
  );
}

// ── report ──────────────────────────────────────────────────────────────────
for (const n of notes) console.log(n);

if (problems.length) {
  console.error(`✗ assert-chassis-ledger — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [ADR 065] the template becomes a thin shell; [ADR 066] the size of that shell is a');
  console.error('  MEASUREMENT, not a number somebody wrote down once. Every line is accounted for here');
  console.error('  or the build is red.');
  process.exit(1);
}

const byVerdict = { STAYS: 0, MOVES: 0, GOES: 0, UNCLASSIFIED: 0 };
for (const [p, row] of rowByPath) if (treeSet.has(p)) byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + 1;

console.log(
  `ok  chassis ledger — ${treeSet.size} tracked file(s), ${sumLines} line(s), every one accounted for ` +
    `[STAYS=${byVerdict.STAYS}, MOVES=${byVerdict.MOVES}, GOES=${byVerdict.GOES}, ` +
    `UNCLASSIFIED=${byVerdict.UNCLASSIFIED}/ceiling ${UNCLASSIFIED_CEILING}]` +
    (IS_FULL_CHECKOUT
      ? `; full checkout, so the ${MIN_FILES}-file floor was applied`
      : `; NOTE: this root is not a checkout of this repository, so the ${MIN_FILES}-file floor was NOT applied`),
);
