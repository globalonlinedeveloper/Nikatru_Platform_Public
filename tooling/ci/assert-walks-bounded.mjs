#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-walks-bounded.mjs — NO GUARD MAY ENUMERATE A DIRECTORY ITSELF.
//
// [pipeline F-10] The defect this exists to make unrepeatable, reproduced on
// `main` 2026-08-02: with agent worktrees present under `.claude/worktrees/`,
// `node tooling/ci/assert-ops-register.mjs` exited 1 with sixteen problems,
// every one naming a file inside a NESTED FULL COPY of this repository. Five
// guards were walking into other checkouts and reading their files as the
// tree's own. CI creates no worktrees, so CI was green and only a developer
// machine was red — the shape where the guard cries wolf exactly where a human
// is watching, and the rational response is to stop believing it.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY AN IMPORT-LEVEL RULE, AND NOT "FIND THE RECURSIVE WALKS AND CHECK THEM".
//
// The obvious guard is: parse each source, find every function that enumerates a
// directory AND recurses, and require it to consult the skip predicate. That was
// written first, and it was WRONG TWICE before it was ever committed — both
// times SILENTLY, in the direction that reports clean:
//
//   · the comment/string reducer did not know about REGEX LITERALS, so a
//     `/['"]/` in a guard opened a fake string that swallowed the rest of the
//     file. Five recursive walks — including the one in assert-input-contract
//     that the empirical probe had already caught red-handed — were simply not
//     seen. The detector printed a smaller number and no complaint.
//   · it then treated `return /x/.test(s)` as a division, and four more files
//     came out mis-parsed.
//
// A detector that under-detects is precisely this repo's most repeated failure
// wearing the clothes of the fix for it. So the rule was moved to a level where
// there is nothing to parse: IMPORT STATEMENTS. `readdirSync` either appears in
// a file's imports or it does not; no JavaScript understanding is required, and
// there is no input for which this scan quietly sees less than it should.
//
// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-18 — WHY THERE IS A SECOND SANCTIONED ROUTE, AND WHY IT IS NEITHER AN
// EXEMPTION LIST NOR A LOOSER `listDir`.
//
// On this date this guard reported six problems: assert-store-matrix.mjs,
// assert-copy-parity.mjs and assert-github-matrix.mjs each imported AND called
// `readdirSync` directly. The obvious repair — route all three through `listDir`
// — WOULD HAVE TURNED THEM GREEN OVER NOTHING, and that is the whole reason this
// section exists.
//
// The matrix guards' subject is not this tree. It is the WORKSPACE OF
// REPOSITORIES around it: the thirty store-slot directories spread under
// `Projects/`, and every one of those directories IS a separate checkout. BEING
// A CHECKOUT IS THE PROPERTY THAT MAKES A DIRECTORY A SLOT — it is not an
// accident of one machine. `listDir` removes exactly the entries that have a
// `.git`; that is its entire job, and the sixty-odd walks whose subject IS this
// tree depend on it doing so. Handed to a guard that enumerates slots, it
// returns an empty set: no slots found, no rows left to contradict, `ok` printed
// over nothing. That is the vacuous pass this corpus refuses, arrived at BY WAY
// OF the fix for the opposite defect — and worse than the defect it would have
// replaced, because the 2026-08-02 defect was at least LOUD on the machine of
// the one person looking at it.
//
// So the boundary was not weakened. It was NAMED. tree-walk.mjs grew a second
// exported primitive, `listCheckoutsAcrossWorkspace`, which returns exactly the
// entries `listDir` hides — and nothing else, and never what is inside them. It
// answers "which entries here are other repositories", never "what do they
// contain": it does not recurse, it offers no option that would, and it stops at
// each checkout's doorstep. R4 below proves that on every run rather than
// trusting the name. Crossing the boundary is therefore something a call site
// says OUT LOUD, in a word too long to type by accident, instead of a walk that
// drifted into another repository without anybody deciding it should.
//
// The route is for the SUBJECT, not for the three filenames: of the files
// reported that day, only those that enumerate the slot directories themselves
// need it, and the walks that merely descend within this tree moved to `listDir`
// and stayed there. A matrix guard written next year is inside this rule on the
// day it lands, without being added to anything.
//
// TWO OTHER REPAIRS WERE REJECTED, and the reasons are the reusable part:
//   · AN EXEMPTION LIST HERE — "assert-store-matrix.mjs may use readdirSync" —
//     names three FILES instead of the property. It goes stale in silence, every
//     matrix guard written after it is born outside it, and what it hands back
//     is the UNBOUNDED primitive: an exempted file may then walk anywhere,
//     including down INTO a checkout, with nothing left watching. The narrow
//     function can only ever do the one narrow thing.
//   · BENDING `listDir` to stop filtering checkouts would re-break every walk it
//     exists for — the defect of 2026-08-02 restored in full, this time enforced
//     by the guard written to prevent it.
//
// Nothing below became a warning and no file was excused: raw `readdirSync` and
// every other enumeration primitive stay banned for everything in tooling/ci
// except tree-walk.mjs, which is where BOTH routes are implemented.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULE
//
//   R1  No file in tooling/ci except tree-walk.mjs may import a directory
//       ENUMERATION primitive (`readdirSync`, `opendirSync`, `globSync`,
//       `readdir`, `opendir`, `glob`) from `node:fs` or `node:fs/promises`,
//       statically or via `await import()`.
//   R2  No file in tooling/ci except tree-walk.mjs may CALL one, in executable
//       code. (R1 catches the import; R2 catches `fs.readdirSync(…)` reached
//       through a namespace import, which R1 cannot see.)
//   R3  A file imports each entry point of tree-walk.mjs iff it calls it —
//       `listDir`, `boundedGlob` and `listCheckoutsAcrossWorkspace` alike. A
//       decorative import satisfies nothing, and a call with no import does not
//       run.
//   R4  tree-walk.mjs STILL REFUSES, AND THE SECOND ROUTE STILL CROSSES NO
//       FURTHER THAN IT CLAIMS. Proven behaviourally on every run, against a
//       temp fixture with a real nested checkout in it — not by reading its
//       source. A rule enforced across sixty files by a helper that had quietly
//       stopped excluding anything would be sixty guards reporting bounded
//       walks and none of them bounded; and a route this file ADMITS as
//       legitimate is held to the same standard — that
//       `listCheckoutsAcrossWorkspace` still returns the checkouts (or the
//       matrix guards see no slots and pass over an empty set) and still returns
//       ONLY them, at ONE level (or it has become the general escape hatch its
//       own header says it is not).
//
// R4 is the limb that matters and the reason this file is a guard rather than a
// lint rule: R1–R3 only say "everything goes through one door", which is worth
// nothing on its own if the door is open.
//
// Usage:  node tooling/ci/assert-walks-bounded.mjs [repoRoot]
// Exit 0 = every directory listing in tooling/ci is bounded; 1 = one is not.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir, boundedGlob, isNestedCheckout, listCheckoutsAcrossWorkspace } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CI_REL = 'tooling/ci';
const CI = join(ROOT, 'tooling', 'ci');
const HELPER = 'tree-walk.mjs';
const SELF = 'assert-walks-bounded.mjs';

/** No argument means CI's own invocation against the real repository, where the
 *  git manifest MUST be readable. A fixture root is a weaker situation and says
 *  so rather than silently skipping the cross-check. */
const scanningRealRepo = process.argv[2] === undefined;

/** The primitives that enumerate a directory. `statSync`/`readFileSync` are NOT
 *  here on purpose: reading a path somebody already decided to visit cannot
 *  choose to visit a nested checkout, and only the choosing is the defect. */
const ENUMERATORS = ['readdirSync', 'opendirSync', 'globSync', 'readdir', 'opendir', 'glob'];

/** The ONE listing that may cross out of the tree under test, named here because
 *  it is quoted in the pass line: a route this guard accepts has to be visible in
 *  the log of every run, or it is a permission granted somewhere nobody reads. */
const CROSSING = 'listCheckoutsAcrossWorkspace';

// The helper's callable entry points — one per enumeration shape a guard uses.
// `boundedGlob` exists because a doublestar glob pattern descends through
// whatever is on disk exactly as a `readdirSync` recursion does, with a shorter
// spelling; check-migrations.mjs was reaching node:fs/promises directly for it,
// and reasoning about that as a special case is how the class survives.
// `CROSSING` is the 2026-08-18 addition described in the header: the guards whose
// subject is the workspace OF repositories cannot use `listDir`, because
// `listDir` deletes precisely their subject. It is an ENTRY POINT OF THE SAME
// HELPER, not an exemption from it — R1 and R2 are unchanged and unconditional,
// so a file taking this route still may not touch `readdirSync`, and R4 proves
// the route is still the narrow one.
const ENTRY_POINTS = ['listDir', 'boundedGlob', CROSSING];

const problems = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ── executable code only ─────────────────────────────────────────────────────
// A LINE-LEVEL filter, and the crudeness is the design. Comments must be
// discounted — this file's own header names every banned primitive repeatedly —
// but a REDUCER that gets it wrong fails silently in the direction that reports
// clean, and the obvious one does:
//
//   🔴 `src.replace(/\/\*[\s\S]*?\*\//g, ' ')` — the reduction used by
//   text-reductions.mjs and written here first — treats the `/*` inside the LINE
//   COMMENT `//   watched workflows ≡ .github/workflows/*.yml` (real, line 23 of
//   assert-ops-register.mjs) as opening a block comment, and deletes everything
//   up to the next `*/` — including that file's entire import block. This scan
//   then read the file as importing nothing and calling nothing.
//
// So no reduction is attempted. A line is discounted only if it OPENS with a
// comment marker, which no line carrying a real call or import ever does. The
// filter can therefore produce a FALSE POSITIVE (a `//`-suffixed line is still
// read, and prose after code on one line could be flagged) but never a false
// negative — and a false positive fails the build in front of somebody, which is
// the only direction of error this repo can afford.
const codeLines = (src) =>
  src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// THE SCAN. Flat by design: guards live flat in tooling/ci, and
// assert-guard-coverage.mjs already fails loudly on any .mjs in a subdirectory,
// so this scan does not need to duplicate that and must not disagree with it.
// ─────────────────────────────────────────────────────────────────────────────
if (!existsSync(CI)) {
  coverageLost([`${CI} does not exist, so this scan ranged over no guards at all.`]);
}

const files = listDir(CI).filter((f) => f.endsWith('.mjs')).sort();
if (files.length === 0) {
  coverageLost([
    `${CI_REL} contains no .mjs files.`,
    'Every rule below quantifies over this set; an empty one makes all four vacuously true and prints ok.',
  ]);
}

// SCAN vs MANIFEST — the assert-workflow-hardening pattern. `git ls-files` is
// the committed truth about which guards exist; a guard this scan never opened
// is a guard whose walk nothing here checks, and the pass line would still count
// the rest and read as full coverage.
const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', CI_REL], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [
        ...new Set(
          ls.stdout
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.startsWith(`${CI_REL}/`) && l.endsWith('.mjs') && !l.slice(`${CI_REL}/`.length).includes('/')),
        ),
      ].map((l) => l.split('/').pop())
    : [];
if (tracked.length === 0) {
  if (scanningRealRepo) {
    coverageLost([
      `\`git ls-files -- ${CI_REL}\` returned no tracked guard under ${ROOT}.`,
      'The committed manifest is what anchors "did I open every guard"; without it this scan is computed',
      'over whatever happened to be on disk and still prints ok.',
    ]);
  }
} else {
  const unseen = tracked.filter((t) => !files.includes(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${tracked.length} guard(s) in ${CI_REL} and this scan opened ${files.length}; it never saw: ${unseen.join(', ')}.`,
      'An unopened guard is one whose directory listings nothing below examines.',
    ]);
  }
}

// ── R1 + R2 + R3 ─────────────────────────────────────────────────────────────
let importers = 0;
let crossers = 0;
for (const f of files) {
  const src = codeLines(readFileSync(join(CI, f), 'utf8'));

  if (f !== HELPER) {
    // R1 — named imports from node:fs / node:fs/promises, static or dynamic.
    for (const m of src.matchAll(/(?:import|(?:const|let|var))\s*\{([^}]*)\}\s*(?:from\s*'node:fs(?:\/promises)?'|=\s*(?:await\s+)?(?:import|require)\s*\(\s*'node:fs(?:\/promises)?'\s*\))/g)) {
      for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        if (ENUMERATORS.includes(name)) {
          problems.push(
            `${CI_REL}/${f} imports \`${name}\` from node:fs. Every directory listing in tooling/ci goes through ` +
              `\`listDir\` in ${HELPER}, which is what stops a walk descending into a nested checkout — a git ` +
              'worktree, a submodule or a stray clone, whose files are not this tree\'s and whose presence made ' +
              'assert-ops-register red on a developer machine and green in CI.',
          );
        }
      }
    }
    // R2 — a call reached through a namespace import (`import * as fs`), which
    // R1 cannot see. Bare `readdirSync(` is caught too, so a file that acquires
    // one without an import statement at all still fails.
    for (const name of ENUMERATORS) {
      const re = new RegExp(`(?:^|[^\\w$.])(?:fs\\.|fsp\\.|fsPromises\\.)?${name}\\s*\\(`);
      if (re.test(src)) {
        problems.push(
          `${CI_REL}/${f} calls \`${name}(\` in executable code. Use \`listDir\` from ${HELPER}; it is the one ` +
            'place that knows which directory entries are not part of the tree under test.',
        );
      }
    }
  }

  // R3 — both directions, per entry point. An import nothing calls is
  // decoration; a call with no import does not run. Either one alone means this
  // scan has been satisfied by something that is not the thing it checks for.
  if (f === HELPER) continue;
  let usesHelper = false;
  let crossesBoundary = false;
  for (const entry of ENTRY_POINTS) {
    const imports = new RegExp(`import\\s*\\{[^}]*\\b${entry}\\b[^}]*\\}\\s*from\\s*'\\./tree-walk\\.mjs'`).test(src);
    const calls = new RegExp(`(?:^|[^\\w$.])${entry}\\s*\\(`, 'm').test(src);
    if (imports) usesHelper = true;
    if (imports && entry === CROSSING) crossesBoundary = true;
    if (imports !== calls) {
      problems.push(
        `${CI_REL}/${f} — imports ${entry}: ${imports}, calls ${entry}: ${calls}. ` +
          (imports
            ? 'An imported-but-unused helper reads as a bounded walk and bounds nothing.'
            : `A call with no import from ./${HELPER} does not run — this file would throw the moment that line executed.`),
      );
    }
  }
  // 🔴 THIS GUARD'S OWN USE OF THE HELPER DOES NOT COUNT. It imports listDir and
  // boundedGlob to run R4, so counting itself would make the positive check
  // below true in every possible tree — an assertion that cannot fail, which is
  // worse than none because it inflates apparent coverage. Only the SUBJECTS
  // count. (Found by its own test: the fixture with no walking guard at all
  // passed, because the copy of this file sitting in it was importer number one.)
  if (usesHelper && f !== SELF) importers++;
  if (crossesBoundary && f !== SELF) crossers++;
}

if (importers === 0) {
  coverageLost([
    `not one file in ${CI_REL} — other than this guard itself — imports \`listDir\`, \`boundedGlob\` or ` +
      `\`${CROSSING}\` from ${HELPER}.`,
    'R1 and R2 are prohibitions, and prohibitions are satisfied by a directory that enumerates nothing at',
    'all. The helper being USED by the guards is the positive half; without it this scan is either pointed',
    'at something that is not tooling/ci, or at a tooling/ci whose walks have all left through some door',
    'these rules do not watch.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 — THE HELPER STILL REFUSES. A behavioural check against a real fixture,
// because everything above is worth exactly nothing if `listDir` has quietly
// stopped excluding anything: sixty files would go on routing their listings
// through one door that is standing open, and every one of them would print ok.
//
// Three cases, and the THIRD is the one a lazier check would miss: a worktree's
// `.git` is a FILE, not a directory, which is exactly the shape that was live in
// `.claude/worktrees/` when this defect was reproduced.
// ─────────────────────────────────────────────────────────────────────────────
{
  const fixture = mkdtempSync(join(tmpdir(), 'walks-bounded-'));
  try {
    mkdirSync(join(fixture, 'ordinary'));
    writeFileSync(join(fixture, 'ordinary', 'keep.txt'), 'in the tree\n');
    mkdirSync(join(fixture, 'a-clone', '.git'), { recursive: true }); // .git as a DIRECTORY
    mkdirSync(join(fixture, 'a-worktree'));
    writeFileSync(join(fixture, 'a-worktree', '.git'), 'gitdir: /elsewhere\n'); // .git as a FILE
    mkdirSync(join(fixture, '.claude', 'worktrees'), { recursive: true });
    writeFileSync(join(fixture, 'loose.txt'), 'in the tree\n');

    const got = listDir(fixture).sort();
    const want = ['loose.txt', 'ordinary'];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      coverageLost([
        `${HELPER}'s \`listDir\` no longer excludes what it claims to: expected [${want.join(', ')}], got [${got.join(', ')}].`,
        'Every rule above routes sixty guards through this one function. If it has stopped skipping nested',
        'checkouts and .claude, those guards are walking into other repositories again and all of them still',
        'print ok — which is precisely the state that was reproduced on main and is what this whole file is for.',
      ]);
    }
    if (!isNestedCheckout(join(fixture, 'a-worktree')) || !isNestedCheckout(join(fixture, 'a-clone'))) {
      coverageLost([
        `${HELPER}'s \`isNestedCheckout\` failed to recognise a checkout it built itself.`,
        'A worktree\'s .git is a FILE and a clone\'s is a DIRECTORY; a test for one alone is a test that passes',
        'while the case that actually bit walks straight through.',
      ]);
    }
    // The glob half. `**` descends on its own, so it needs its own live proof:
    // the file inside the worktree must NOT come back, and the one in the
    // ordinary directory must.
    writeFileSync(join(fixture, 'ordinary', 'seen.sql'), 'select 1;\n');
    writeFileSync(join(fixture, 'a-worktree', 'unseen.sql'), 'select 1;\n');
    const globbed = [];
    for await (const g of boundedGlob('**/*.sql', { cwd: fixture })) globbed.push(g.replaceAll('\\', '/'));
    globbed.sort();
    if (JSON.stringify(globbed) !== JSON.stringify(['ordinary/seen.sql'])) {
      coverageLost([
        `${HELPER}'s \`boundedGlob\` returned [${globbed.join(', ')}], expected [ordinary/seen.sql].`,
        'A `**` pattern walks the disk exactly as a readdirSync recursion does. If this one has stopped',
        'excluding nested checkouts, check-migrations.mjs is scanning another repository\'s schema and',
        'counting it towards its own REQUIRED_COVERAGE.',
      ]);
    }
    if (isNestedCheckout(join(fixture, 'ordinary'))) {
      coverageLost([
        `${HELPER}'s \`isNestedCheckout\` returns true for a directory with no .git at all.`,
        'A predicate that says yes to everything excludes everything, which would silently empty every scan',
        'in tooling/ci while each of them still reported ok over the nothing it had left.',
      ]);
    }

    // ── THE SECOND ROUTE, HELD TO THE SAME STANDARD (2026-08-18) ──────────────
    // R1–R3 above now accept `listCheckoutsAcrossWorkspace` as a listing route.
    // An accepted route that is never exercised is a door this file declares
    // safe on the strength of its NAME, which is exactly the trust R4 exists to
    // refuse for `listDir`. Both ends are failures and both are checked, against
    // the SAME fixture the listDir proof just used:
    //   · it returns nothing → the guards whose subject is the workspace
    //     enumerate no store slots, find no rows to contradict, and each prints
    //     ok over an empty set. That is the vacuous pass, reached through the
    //     fix for the opposite defect.
    //   · it returns ordinary directories, or it recurses → it has become the
    //     general escape hatch its own header says it is not, and another
    //     repository's files are being read as this tree's again.
    // The fixture is extended first so the two cases a lazier check would miss
    // are live: a CHECKOUT INSIDE A CHECKOUT, which must not surface from the
    // level above it, and a `.claude` that is ITSELF a checkout — an agent
    // worktree of THIS repository is not a peer in the workspace, it is the
    // original defect wearing the new function's clothes.
    mkdirSync(join(fixture, 'a-clone', 'inner-checkout', '.git'), { recursive: true });
    writeFileSync(join(fixture, '.claude', '.git'), 'gitdir: /elsewhere\n');
    const crossed = listCheckoutsAcrossWorkspace(fixture).sort();
    const wantCrossed = ['a-clone', 'a-worktree'];
    if (JSON.stringify(crossed) !== JSON.stringify(wantCrossed)) {
      coverageLost([
        `${HELPER}'s \`${CROSSING}\` returned [${crossed.join(', ')}], expected [${wantCrossed.join(', ')}].`,
        'This is the route accepted above INSTEAD of raw readdirSync, for the guards whose subject is the',
        'workspace of repositories rather than this tree. Returning LESS than this means those guards see no',
        'store slots at all and every one of them prints ok over an empty set; returning MORE — an ordinary',
        'directory, `.claude`, or anything from INSIDE a checkout — means the one sanctioned crossing has',
        'widened back into the unbounded walk it was carved out of.',
      ]);
    }
    // NO SEPARATE "the two listings never overlap" ASSERTION IS MADE HERE. The
    // two equalities above already pin every entry of this fixture to exactly
    // one side, so a complement check could not fail while they pass — and an
    // assertion with no failing input inflates apparent coverage without adding
    // any, which is the same reason this guard refuses to count itself among the
    // importers. The complement is a property of `tree-walk.mjs`, and it is
    // tested where it can actually be contradicted: entry-for-entry, on a
    // fixture built for it, in tooling/ci/test/walks-bounded.test.mjs.
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

if (problems.length) {
  console.error(`✗ tooling/ci walks — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A guard that walks into a nested checkout reads another repository\'s files as this tree\'s.');
  console.error(`  It is green in CI, which creates no worktrees, and red on the machine of the one person`);
  console.error('  actually looking at it. Route the listing through `listDir`.');
  process.exit(1);
}

console.log(
  `ok  tooling/ci walks bounded — ${files.length} guard(s) scanned, ${importers} route every directory listing ` +
    `through ${HELPER} (${crossers} of them cross to the workspace of repositories out loud, by \`${CROSSING}\`); ` +
    'none imports or calls an enumeration primitive itself; the helper was exercised against a live nested ' +
    'checkout (.git as a file AND as a directory) and still refuses, and the crossing route against the same ' +
    'fixture still returns exactly the checkouts, at one level [pipeline F-10]',
);
