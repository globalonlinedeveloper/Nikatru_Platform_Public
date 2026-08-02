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
// THE RULE
//
//   R1  No file in tooling/ci except tree-walk.mjs may import a directory
//       ENUMERATION primitive (`readdirSync`, `opendirSync`, `globSync`,
//       `readdir`, `opendir`, `glob`) from `node:fs` or `node:fs/promises`,
//       statically or via `await import()`.
//   R2  No file in tooling/ci except tree-walk.mjs may CALL one, in executable
//       code. (R1 catches the import; R2 catches `fs.readdirSync(…)` reached
//       through a namespace import, which R1 cannot see.)
//   R3  A file imports `listDir` iff it calls `listDir`. A decorative import
//       satisfies nothing, and a call with no import does not run.
//   R4  tree-walk.mjs STILL REFUSES. Proven behaviourally on every run, against
//       a temp fixture with a real nested checkout in it — not by reading its
//       source. A rule enforced across sixty files by a helper that had quietly
//       stopped excluding anything would be sixty guards reporting bounded
//       walks and none of them bounded.
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
import { listDir, boundedGlob, isNestedCheckout } from './tree-walk.mjs';

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

// The helper's callable entry points — one per enumeration shape a guard uses.
// `boundedGlob` exists because a doublestar glob pattern descends through
// whatever is on disk exactly as a `readdirSync` recursion does, with a shorter
// spelling; check-migrations.mjs was reaching node:fs/promises directly for it,
// and reasoning about that as a special case is how the class survives.
const ENTRY_POINTS = ['listDir', 'boundedGlob'];

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
  for (const entry of ENTRY_POINTS) {
    const imports = new RegExp(`import\\s*\\{[^}]*\\b${entry}\\b[^}]*\\}\\s*from\\s*'\\./tree-walk\\.mjs'`).test(src);
    const calls = new RegExp(`(?:^|[^\\w$.])${entry}\\s*\\(`, 'm').test(src);
    if (imports) usesHelper = true;
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
}

if (importers === 0) {
  coverageLost([
    `not one file in ${CI_REL} — other than this guard itself — imports \`listDir\` or \`boundedGlob\` from ${HELPER}.`,
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
    `through ${HELPER}; none imports or calls an enumeration primitive itself; the helper was exercised against ` +
    'a live nested checkout (.git as a file AND as a directory) and still refuses [pipeline F-10]',
);
