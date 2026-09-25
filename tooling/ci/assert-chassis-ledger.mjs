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
//   7. THE BRICK lib/ TOTAL IS PRINTED AND HELD UNDER ITS CEILING [ADR 096].
//      Every tracked file under the Dart app root's `lib/`, and again under
//      `lib/state/`, is counted by `linesOf`; either total above its
//      `floors.<key>.max` in the ledger fails. A PR that grows brick lib/ raises
//      that max in the same PR and says why. This limb exists because lib/ grew
//      past ADR 072's re-stated band while every run printed ok: the guard
//      printed no lib/ total, so no run said so.
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
const LEDGER_REL = 'tooling/chassis-ledger.json';

/** The whole brick template. Every tracked file under it must fall inside one of
 *  the ROOTS below — that is limb 0, and it is what stops a THIRD root growing
 *  unnoticed the way the Worker template did. */
const TEMPLATE = 'tooling/bricks/app/__brick__';

// ── THE ROOTS, AND WHY THERE ARE NOW TWO ────────────────────────────────
//
// 🔴 THE LEDGER COVERED 96 OF THE TEMPLATE'S 109 TRACKED FILES AND SAID SO
// NOWHERE. `root` was one string — the Dart app under `apps/{{app_id}}` — so the
// 13 files of the opt-in Worker template under
// `{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api` were outside the
// bijection entirely: 917 lines every stamped backend app inherits, with no row,
// no verdict and no line count, and `git ls-files -- <the one root>` could not
// see them to complain. That is precisely the hole this guard's own header
// describes — "an undeclared file added to the brick reddened ZERO of the 127
// guards" — reopened one directory to the left.
//
// ⚠️ THE ROOT LIST LIVES HERE, NOT IN THE LEDGER, AND THAT IS THE WHOLE POINT.
// A ledger that named its own subject set could shrink the scan by deleting a
// root, and the run would print a smaller, cheerful `ok`. So the guard is the
// authority, the ledger's `roots` is cross-checked against it below, and limb 0
// fails on any tracked template file that falls outside every root. Each root
// carries its OWN floor, measured, for the same reason the single floor existed:
// a root that empties is an enumeration that broke.
//
// WHY NOT RE-KEY THE 96 EXISTING ROWS to template-relative paths. It was the
// alternative and it was measured against this one: re-keying is a 96-row diff
// that touches every `path` in the file, invalidates every citation anyone has
// written against it, and buys exactly one thing — not having a `root` field on
// 13 rows. A row's `root` is optional and defaults to `ROOTS[0]`, so the 96 rows
// are byte-identical and the 13 new ones say where they live.
const ROOTS = [
  {
    path: 'tooling/bricks/app/__brick__/apps/{{app_id}}',
    /** Measured 2026-09-05 at 96 files. A floor, not the count: the template may
     *  legitimately grow or shrink, but falling under this means the enumeration
     *  broke rather than the template emptying — step 4 removes LINES, and the
     *  files it deletes are a handful, not seventy. Raise it only with a
     *  measurement. */
    minFiles: 60,
    what: 'the Dart app every stamp produces',
  },
  {
    path: 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api',
    /** Measured 2026-09-07 at 13 files, 917 lines. */
    minFiles: 10,
    what: 'the opt-in Cloudflare Worker a backend stamp produces',
  },
];

/** The first root is where a row with no `root` of its own lives. */
const DEFAULT_ROOT = ROOTS[0].path;

// ── THE lib/ CEILING'S SUBJECT LIVES HERE; ITS MAX LIVES IN THE LEDGER ──────
// [ADR 096] re-states the brick's lib/ size as two ceilings. The prefixes are
// fixed in this file for the reason THE ROOT LIST is (above): a ledger that
// named its own subject could narrow what it is judged on and print a smaller
// ok. The MAX is a ledger key, `floors.<key>.max`, because a PR that grows
// lib/ already re-measures that file's row in the ledger (limb 2), so the rise
// and its reason land as one diff. Both prefixes are under DEFAULT_ROOT only.
const LIB_SUBJECTS = [
  { key: 'lib', prefix: 'lib/', what: 'brick lib/' },
  { key: 'state', prefix: 'lib/state/', what: 'lib/state' },
];

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
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
};

// ── the tree ────────────────────────────────────────────────────────────────
const lsFiles = (pathspec, what) => {
  try {
    return execFileSync('git', ['-C', ROOT, 'ls-files', '--', pathspec], {
      encoding: 'utf8', maxBuffer: 1 << 28,
    }).split('\n').filter(Boolean);
  } catch {
    return coverageLost([
      `\`git ls-files -- ${pathspec}\` failed, so ${what} is unreadable.`,
      'Every limb below compares the ledger against that list. Without it this guard would compare a',
      'ledger against nothing and print ok — which is the exact shape it exists to prevent.',
    ]);
  }
};

// ── limb 0 · EVERY TRACKED TEMPLATE FILE FALLS INSIDE A DECLARED ROOT ───────
// This is the limb the single-root version could not have: it reads the WHOLE
// template and refuses anything the roots do not cover. The 13 Worker-template
// files sat outside the old root for as long as this ledger existed and nothing
// could say so, because the scan's own pathspec was the thing that hid them.
const templateFiles = lsFiles(TEMPLATE, "the template's contents");
if (templateFiles.length === 0) {
  coverageLost([
    `no tracked file was found under ${TEMPLATE}.`,
    'Either the template moved or this scan lost its grip on the tree. Both read as "nothing to check".',
  ]);
}
const rootOf = (rel) => ROOTS.find((r) => rel === r.path || rel.startsWith(`${r.path}/`)) ?? null;
for (const f of templateFiles.filter((p) => rootOf(p) === null).sort()) {
  problems.push(
    `${f} is tracked under ${TEMPLATE} and falls under NO declared root, so no ledger row can reach it. ` +
      'A stamped app inherits it and nothing in this repository counts it — which is exactly how 13 Worker ' +
      'template files and 917 lines stayed outside this ledger until 2026-09-07. Add the root to ROOTS in ' +
      'this file, with its own measured floor, and give every file in it a row, in the same commit.',
  );
}

// ── per root: the tracked set, and its own floor ────────────────────────────
const trackedByRoot = new Map();
for (const r of ROOTS) {
  const files = lsFiles(r.path, `${r.what} (${r.path})`);
  if (files.length === 0) {
    coverageLost([
      `no tracked file was found under the root ${r.path} (${r.what}).`,
      'Either that half of the template moved or this scan lost its grip on it. Both read as "nothing to',
      'check", and a root that silently contributes zero files is a root whose rows all read as orphans.',
    ]);
  }
  if (IS_FULL_CHECKOUT && files.length < r.minFiles) {
    coverageLost([
      `only ${files.length} tracked file(s) under ${r.path}, below its floor of ${r.minFiles}.`,
      'Chassis step 4 removes LINES; the files it deletes are a handful, not seventy. A drop this large is',
      'an enumeration that broke, not a template that emptied. If it is real, re-measure and lower the floor',
      'in the same commit as the deletion.',
    ]);
  }
  trackedByRoot.set(r.path, files);
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

// ── limb 7's register · `floors`, validated before anything is summed ──────
// A ceiling that is missing or malformed is COVERAGE LOST, not a pass: limb 7
// would print a lib/ total and hold it against nothing.
const floors = ledger.floors;
if (floors === null || typeof floors !== 'object' || Array.isArray(floors)) {
  coverageLost([
    `${LEDGER_REL} declares no \`floors\` object, so the brick lib/ ceiling [ADR 096] has no max to hold.`,
    'Limb 7 would print a lib/ total and compare it against nothing — the silence that let lib/ outgrow',
    "ADR 072's band while every run printed ok.",
  ]);
}
for (const s of LIB_SUBJECTS) {
  const f = floors[s.key];
  if (f === null || typeof f !== 'object' || Array.isArray(f)) {
    coverageLost([`${LEDGER_REL} has no \`floors.${s.key}\` object, so ${s.what} has no ceiling to be held under.`]);
  }
  if (!Number.isInteger(f.max) || f.max <= 0) {
    coverageLost([
      `${LEDGER_REL} \`floors.${s.key}.max\` is ${JSON.stringify(f.max)}, not a positive integer.`,
      'A string or a fraction compares against a line total by accident; write the measured number.',
    ]);
  }
  if (typeof f.adr !== 'string' || !/^ADR \d{3}$/.test(f.adr)) {
    coverageLost([
      `${LEDGER_REL} \`floors.${s.key}.adr\` is ${JSON.stringify(f.adr)}, not "ADR" and the three digits of the`,
      'decision that set the ceiling. A max that names no decision is a number somebody wrote down once.',
    ]);
  }
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

// ── THE ROW KEY IS (root, path), AND THE ROOT DEFAULTS ──────────────────────
// A row's `path` stays relative to ITS OWN root, so the 96 rows written against
// the single root are byte-identical and every citation against them still
// resolves. `root` is optional and defaults to ROOTS[0]; a row naming a root
// this guard does not scan is a row nothing reads, and it fails below.
const KEYSEP = '\u0000';
const keyOf = (root, path) => `${root}${KEYSEP}${path}`;
const showKey = (k) => k.replace(KEYSEP, '/');

const treeSet = new Set();
for (const r of ROOTS) {
  for (const p of trackedByRoot.get(r.path)) treeSet.add(keyOf(r.path, p.slice(r.path.length + 1)));
}

const declaredRoots = ledger.roots;
if (!Array.isArray(declaredRoots) || declaredRoots.length === 0) {
  coverageLost([
    `${LEDGER_REL} declares no \`roots\` array, so nothing in it says which template trees its rows cover.`,
    'The guard is the authority on that list — see the ROOTS header — but a ledger that is silent about it',
    'cannot be cross-checked at all, and a row could name a root nobody scans.',
  ]);
}
const guardRoots = ROOTS.map((r) => r.path);
const rootsDisagree =
  declaredRoots.length !== guardRoots.length || declaredRoots.some((p, i) => p !== guardRoots[i]);
if (rootsDisagree) {
  coverageLost([
    `${LEDGER_REL} \`roots\` disagrees with this guard's ROOTS.`,
    `  ledger: ${declaredRoots.join(', ')}`,
    `  guard:  ${guardRoots.join(', ')}`,
    'The guard scans its own list, so a ledger naming a different one is declaring rows against a tree that',
    'is never read — which prints as a clean bijection over the half that is.',
  ]);
}

const rowByKey = new Map();
for (const row of ledger.files) {
  const root = row.root ?? DEFAULT_ROOT;
  if (!guardRoots.includes(root)) {
    problems.push(
      `${LEDGER_REL} has a row for \`${row.path}\` under root \`${root}\`, which this guard does not scan. ` +
        'Nothing reads it, so it can neither be verified nor go stale loudly.',
    );
    continue;
  }
  const k = keyOf(root, row.path);
  if (rowByKey.has(k)) problems.push(`${LEDGER_REL} declares \`${showKey(k)}\` twice.`);
  rowByKey.set(k, row);
}

// ── 1 · bijection, both directions ──────────────────────────────────────────
const undeclared = [...treeSet].filter((k) => !rowByKey.has(k)).sort();
const orphaned = [...rowByKey.keys()].filter((k) => !treeSet.has(k)).sort();

for (const k of undeclared) {
  problems.push(
    `${showKey(k)} is tracked under the template and has NO ledger row. Every file a stamped app inherits ` +
      'must be accounted for — nothing else in this repository notices a new file appearing here.',
  );
}
for (const k of orphaned) {
  problems.push(
    `${LEDGER_REL} has a row for \`${showKey(k)}\`, which is not tracked under the template. A row nobody ` +
      'can reach is the stale second copy this ledger exists to prevent — delete it, or restore the file.',
  );
}

// ── 2 · every count recomputed, and 4/6 · the verdict contract ──────────────
const VERDICTS = new Set(['STAYS', 'MOVES', 'GOES', 'UNCLASSIFIED']);
let sumLines = 0;
let unclassified = 0;

for (const [k, row] of rowByKey) {
  if (!treeSet.has(k)) continue; // already reported as orphaned
  const p = showKey(k);

  const actual = linesOf(p);
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

// ── 7 · the brick lib/ totals, summed from the TREE ─────────────────────────
// Summed over every tracked key under DEFAULT_ROOT, not over the ledger's rows:
// [ADR 096] counts every git-tracked file under lib/, so a lib/ file whose row
// is missing is still counted here (and fails limb 1 besides).
const libTotals = new Map(LIB_SUBJECTS.map((s) => [s.key, { files: 0, lines: 0 }]));
for (const k of treeSet) {
  if (!k.startsWith(`${DEFAULT_ROOT}${KEYSEP}`)) continue;
  const rel = k.slice(DEFAULT_ROOT.length + KEYSEP.length);
  const n = linesOf(showKey(k)) ?? 0;
  for (const s of LIB_SUBJECTS) {
    if (!rel.startsWith(s.prefix)) continue;
    const acc = libTotals.get(s.key);
    acc.files += 1;
    acc.lines += n;
  }
}
for (const s of LIB_SUBJECTS) {
  if (libTotals.get(s.key).files === 0) {
    coverageLost([
      `no tracked file was found under ${DEFAULT_ROOT}/${s.prefix}, so ${s.what} totals 0 and its ceiling holds vacuously.`,
      'That is the enumeration breaking, not the template emptying. If the directory really moved, move its',
      'prefix in LIB_SUBJECTS in this file in the same PR.',
    ]);
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
/** Was 28 when this guard landed; measured to ZERO the same day, once all 28
 *  were classified by deleting each file and diffing the full guard sweep
 *  against a per-worktree baseline.
 *
 *  At zero this stops being a ratchet and becomes a wall: every file in the
 *  template now has a measured verdict, so a NEW file must arrive with one too.
 *  It may never be raised — if a file genuinely cannot be classified yet, that
 *  is a reason to measure it, not a reason to widen this. */
const UNCLASSIFIED_CEILING = 0;
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

// ── 7 · the brick lib/ ceiling [ADR 096] ────────────────────────────────────
for (const s of LIB_SUBJECTS) {
  const { files, lines } = libTotals.get(s.key);
  const { max, adr } = floors[s.key];
  if (lines > max) {
    problems.push(
      `${s.what} is ${lines} line(s) in ${files} file(s), ${lines - max} above floors.${s.key}.max ${max} [${adr}]. ` +
        `Raise \`floors.${s.key}.max\` in ${LEDGER_REL} in the SAME PR with a reason in its body, or shrink it. ` +
        'The ceiling was set at the measured size with zero headroom, so any growth is a decision to record.',
    );
  } else if (lines < max) {
    notes.push(
      `⬜ ${s.what} is ${lines} line(s), ${max - lines} below the ceiling of ${max} [${adr}] — lower ` +
        `floors.${s.key}.max in ${LEDGER_REL} to bank it, in the same PR that shrank it.`,
    );
  }
}
const libFloor = floors[LIB_SUBJECTS[0].key];
const libLine = LIB_SUBJECTS.map((s) => {
  const { files, lines } = libTotals.get(s.key);
  const { max, adr } = floors[s.key];
  const cite = s === LIB_SUBJECTS[0] || adr !== libFloor.adr ? ` [${adr}]` : '';
  return `${s.what} — ${files} file(s), ${lines} line(s), ceiling ${max}${cite}`;
}).join('; ');

// ── report ──────────────────────────────────────────────────────────────────
for (const n of notes) console.log(n);

if (problems.length) {
  console.error(`✗ assert-chassis-ledger — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [ADR 065] the template becomes a thin shell; [ADR 066] the size of that shell is a');
  console.error('  MEASUREMENT, not a number somebody wrote down once. Every line is accounted for here');
  console.error('  or the build is red.');
  console.error(`  measured on this run: ${libLine}`);
  process.exit(1);
}

const byVerdict = { STAYS: 0, MOVES: 0, GOES: 0, UNCLASSIFIED: 0 };
for (const [k, row] of rowByKey) if (treeSet.has(k)) byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + 1;

// ── THE PER-ROOT BREAKDOWN PRINTS, AND IT IS NOT DECORATION ────────────────
// The union total ROSE on 2026-09-07 — from 15,871 over 96 files to a figure
// over 109 — while the Dart app root FELL, because 917 previously-uncounted
// Worker-template lines entered the count for the first time. One number cannot
// say both, and a run that printed only the union would read as the template
// growing. So each root prints its own files and lines beside the total.
for (const r of ROOTS) {
  const files = [...treeSet].filter((k) => k.startsWith(`${r.path}${KEYSEP}`));
  const lines = files.reduce((n, k) => n + (linesOf(showKey(k)) ?? 0), 0);
  console.log(`ok  ${r.path} — ${files.length} file(s), ${lines} line(s) · ${r.what}`);
}

console.log(`ok  ${libLine}`);

console.log(
  `ok  chassis ledger — ${treeSet.size} tracked file(s) across ${ROOTS.length} root(s), ${sumLines} line(s), ` +
    `every one accounted for [STAYS=${byVerdict.STAYS}, MOVES=${byVerdict.MOVES}, GOES=${byVerdict.GOES}, ` +
    `UNCLASSIFIED=${byVerdict.UNCLASSIFIED}/ceiling ${UNCLASSIFIED_CEILING}]` +
    (IS_FULL_CHECKOUT
      ? `; full checkout, so each root's own file floor was applied (${ROOTS.map((r) => r.minFiles).join(', ')})`
      : '; NOTE: this root is not a checkout of this repository, so the per-root file floors were NOT applied'),
);
