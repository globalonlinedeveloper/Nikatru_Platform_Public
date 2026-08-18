// ─────────────────────────────────────────────────────────────────────────────
// walks-bounded.test.mjs — tree-walk.mjs must actually refuse, and
// assert-walks-bounded.mjs must actually be able to fail.
//
// [pipeline F-10] THE DEFECT, reproduced on `main` 2026-08-02 before a line was
// written: with agent worktrees present under `.claude/worktrees/` — this repo
// creates one per agent task — `node tooling/ci/assert-ops-register.mjs` exited
// 1 with sixteen problems, every one naming a wrangler config inside a NESTED
// FULL COPY of this repository. CI checks out one tree and creates no worktrees,
// so CI was green and only a developer machine was red. A guard that cries wolf
// exactly where a human is watching gets disbelieved, and a disbelieved guard
// has already stopped guarding.
//
// TWO SUBJECTS, and the split matters:
//   · tree-walk.mjs      is not a guard (NOT_A_SCANNER in assert-guard-coverage)
//                        but sixty-four guards' walks pass through it, so its
//                        failing case is the most load-bearing in the directory.
//   · assert-walks-bounded.mjs  is the guard that stops the class coming back,
//                        by forbidding every OTHER file in tooling/ci from
//                        enumerating a directory itself.
//
// ⚠️ THE CASES THAT ARE NOT STYLISTIC:
//   · a worktree's `.git` is a FILE, a clone's is a DIRECTORY. A test for one
//     alone passes while the case that actually bit walks straight through, so
//     both shapes are exercised separately and neither is folded into the other.
//   · the ROOT of a walk contains `.git` — the real repository always does — and
//     must still be scanned in full. An exclusion rule that also excluded the
//     root would empty every scan in tooling/ci while each still printed ok,
//     which is a worse failure than the one being fixed.
//   · an ORDINARY directory must still be returned. "Skip nested checkouts" is
//     only correct if it skips nothing else; the negative case is what proves
//     the fix did not buy its green by narrowing what the guards see.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  listDir,
  listCheckoutsAcrossWorkspace,
  boundedGlob,
  isNestedCheckout,
  withinTree,
  SCRATCH_DIR_NAME,
} from '../tree-walk.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-walks-bounded.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-walks-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
const scratch = () => {
  const d = join(TMP, `t${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** A directory that looks exactly like a git worktree: `.git` is a FILE holding
 *  a `gitdir:` pointer. This is the shape that was live under
 *  `.claude/worktrees/` when the defect was reproduced. */
const makeWorktree = (parent, name) => {
  const d = join(parent, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.git'), 'gitdir: /somewhere/else/.git/worktrees/x\n');
  writeFileSync(join(d, 'wrangler.jsonc'), '{ "triggers": { "crons": ["0 * * * *"] } }\n');
  return d;
};

/** A directory that looks like a clone or a submodule: `.git` is a DIRECTORY. */
const makeClone = (parent, name) => {
  const d = join(parent, name);
  mkdirSync(join(d, '.git'), { recursive: true });
  writeFileSync(join(d, 'wrangler.jsonc'), '{ "triggers": { "crons": ["0 * * * *"] } }\n');
  return d;
};

describe('tree-walk.mjs — what is not part of the tree under test', () => {
  test('a git WORKTREE (.git is a file) is not returned', () => {
    const root = scratch();
    makeWorktree(root, 'agent-abc');
    mkdirSync(join(root, 'services'));
    assert.deepEqual(listDir(root).sort(), ['services']);
  });

  test('a CLONE or submodule (.git is a directory) is not returned', () => {
    const root = scratch();
    makeClone(root, 'vendored');
    mkdirSync(join(root, 'services'));
    assert.deepEqual(listDir(root).sort(), ['services']);
  });

  test('.claude is not returned even with no checkout inside it', () => {
    const root = scratch();
    mkdirSync(join(root, SCRATCH_DIR_NAME, 'worktrees'), { recursive: true });
    mkdirSync(join(root, 'packages'));
    assert.deepEqual(listDir(root).sort(), ['packages']);
  });

  // ⚠️ THE NEGATIVE HALF. Skipping nested checkouts is only a fix if it skips
  // nothing else — a walk narrowed until it sees nothing passes every guard in
  // this repo and guards none of them.
  test('ordinary directories and files ARE still returned', () => {
    const root = scratch();
    mkdirSync(join(root, 'services'));
    mkdirSync(join(root, 'packages'));
    writeFileSync(join(root, 'pubspec.yaml'), '');
    makeWorktree(root, 'agent-abc');
    assert.deepEqual(listDir(root).sort(), ['packages', 'pubspec.yaml', 'services']);
  });

  test('a FILE named .git does not remove its own directory from a listing', () => {
    // The `.git` marker disqualifies the directory that CONTAINS it, never the
    // directory that is its sibling. Getting this backwards would delete the
    // whole tree from every scan.
    const root = scratch();
    const wt = makeWorktree(root, 'agent-abc');
    mkdirSync(join(root, 'apps'));
    assert.ok(listDir(root).includes('apps'));
    // and the worktree's own contents are reachable if something asks directly
    assert.ok(listDir(wt).includes('wrangler.jsonc'));
  });

  // 🔴 THE ROOT IS NEVER EXCLUDED. The real repository is itself a checkout, so
  // a rule that excluded any directory containing `.git` — including the one it
  // was pointed at — would empty every scan in tooling/ci at once, silently,
  // with every guard still printing ok over nothing.
  test('the walk root is scanned in full even though it is itself a checkout', () => {
    const root = scratch();
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'services'));
    writeFileSync(join(root, 'package.json'), '{}');
    assert.deepEqual(listDir(root).sort(), ['.git', 'package.json', 'services']);
  });

  test('withFileTypes returns Dirents, and the same entries are excluded', () => {
    const root = scratch();
    makeWorktree(root, 'agent-abc');
    mkdirSync(join(root, 'sites'));
    const entries = listDir(root, { withFileTypes: true });
    assert.deepEqual(entries.map((e) => e.name).sort(), ['sites']);
    assert.ok(entries[0].isDirectory());
  });

  test('an unsupported option THROWS rather than being silently ignored', () => {
    const root = scratch();
    assert.throws(() => listDir(root, { recursive: true }), /unsupported option/);
    assert.throws(() => listDir(root, 'utf8'), /must be an object/);
  });

  test('isNestedCheckout recognises both shapes and nothing else', () => {
    const root = scratch();
    makeWorktree(root, 'wt');
    makeClone(root, 'cl');
    mkdirSync(join(root, 'plain'));
    assert.equal(isNestedCheckout(join(root, 'wt')), true);
    assert.equal(isNestedCheckout(join(root, 'cl')), true);
    assert.equal(isNestedCheckout(join(root, 'plain')), false);
  });

  test('withinTree walks the whole ancestor chain, not just the leaf', () => {
    const root = scratch();
    const wt = makeWorktree(root, 'agent-abc');
    mkdirSync(join(wt, 'services', 'platform'), { recursive: true });
    writeFileSync(join(wt, 'services', 'platform', 'wrangler.jsonc'), '{}');
    mkdirSync(join(root, 'services', 'platform'), { recursive: true });
    writeFileSync(join(root, 'services', 'platform', 'wrangler.jsonc'), '{}');
    assert.equal(withinTree(root, 'agent-abc/services/platform/wrangler.jsonc'), false);
    assert.equal(withinTree(root, 'services/platform/wrangler.jsonc'), true);
    assert.equal(withinTree(root, 'services\\platform\\wrangler.jsonc'), true);
  });

  test('boundedGlob drops matches inside a nested checkout and keeps the rest', async () => {
    const root = scratch();
    const wt = makeWorktree(root, 'agent-abc');
    mkdirSync(join(wt, 'services', 'db', 'migrations'), { recursive: true });
    writeFileSync(join(wt, 'services', 'db', 'migrations', '0001.sql'), 'select 1;');
    mkdirSync(join(root, 'services', 'db', 'migrations'), { recursive: true });
    writeFileSync(join(root, 'services', 'db', 'migrations', '0001.sql'), 'select 1;');
    const got = [];
    for await (const m of boundedGlob('services/*/migrations/*.sql', { cwd: root })) got.push(m.replaceAll('\\', '/'));
    assert.deepEqual(got.sort(), ['services/db/migrations/0001.sql']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listCheckoutsAcrossWorkspace — the SANCTIONED crossing, added 2026-08-18.
//
// The three matrix guards' subject is the store-slot directories spread across
// the workspace, and each of those IS a separate repository. `listDir` filters
// out exactly those, so the interesting failures are the two ends:
//   · it returns nothing → the matrix guards see no slots and print ok over an
//     empty set, which is the vacuous pass, arrived at through the fix for the
//     opposite defect;
//   · it returns everything, or it recurses → it has become the general escape
//     hatch its header says it is not, and another repository's files are being
//     read as this tree's again.
// Both ends are tested here, and so is the complement property that keeps the
// two primitives from ever overlapping.
// ─────────────────────────────────────────────────────────────────────────────
describe('tree-walk.mjs — the workspace of repositories, crossed on purpose', () => {
  test('exactly the nested checkouts come back — both shapes, and only those', () => {
    const root = scratch();
    makeWorktree(root, 'Nikatru_Android_Apps_Public'); // .git as a FILE
    makeClone(root, 'Nikatru_Android_Apps_Private'); // .git as a DIRECTORY
    mkdirSync(join(root, 'not-a-slot'));
    writeFileSync(join(root, 'README.md'), '');
    assert.deepEqual(
      listCheckoutsAcrossWorkspace(root).sort(),
      ['Nikatru_Android_Apps_Private', 'Nikatru_Android_Apps_Public'],
    );
  });

  // 🔴 THE END THAT MATTERS. A directory with no `.git` is not a slot, and a
  // listing that returned ordinary directories too would hand the matrix guards
  // every container between Projects/ and the slots as if each were a repo.
  test('an ordinary directory and a plain file are NOT returned', () => {
    const root = scratch();
    mkdirSync(join(root, 'Google_Play_Store'));
    writeFileSync(join(root, 'notes.txt'), '');
    assert.deepEqual(listCheckoutsAcrossWorkspace(root), []);
  });

  test('it is the exact complement of listDir, entry for entry', () => {
    const root = scratch();
    makeWorktree(root, 'slot-a');
    makeClone(root, 'slot-b');
    mkdirSync(join(root, 'container'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    const kept = listDir(root).sort();
    const crossed = listCheckoutsAcrossWorkspace(root).sort();
    assert.deepEqual(kept, ['container', 'pnpm-workspace.yaml']);
    assert.deepEqual(crossed, ['slot-a', 'slot-b']);
    assert.deepEqual(kept.filter((n) => crossed.includes(n)), [], 'no entry may be in both listings');
  });

  // ⚠️ IT STOPS AT THE DOORSTEP. Enumerating the checkouts is the licence; going
  // INSIDE one is the defect the whole file exists to prevent, so a checkout
  // nested inside a checkout must not surface from the level above it.
  test('it never recurses — only the checkouts at this level, named not pathed', () => {
    const root = scratch();
    const slot = makeClone(root, 'slot-a');
    makeWorktree(slot, 'inner-checkout');
    mkdirSync(join(slot, 'apps'));
    const got = listCheckoutsAcrossWorkspace(root);
    assert.deepEqual(got, ['slot-a']);
    assert.ok(!got.some((n) => n.includes('/') || n.includes('\\')), 'entries are names, not paths');
  });

  // `.claude` is this repo's own agent scratch space. A worktree parked in it is
  // not a peer repository in the workspace — it is THIS repository again, which
  // is the original defect wearing the new function's clothes.
  test('the scratch directory is skipped even when it is itself a checkout', () => {
    const root = scratch();
    makeClone(root, SCRATCH_DIR_NAME);
    makeWorktree(root, 'slot-a');
    assert.deepEqual(listCheckoutsAcrossWorkspace(root), ['slot-a']);
  });

  test('withFileTypes returns Dirents for the same entries', () => {
    const root = scratch();
    makeWorktree(root, 'slot-a');
    mkdirSync(join(root, 'container'));
    const entries = listCheckoutsAcrossWorkspace(root, { withFileTypes: true });
    assert.deepEqual(entries.map((e) => e.name), ['slot-a']);
    assert.ok(entries[0].isDirectory());
  });

  test('an unsupported option THROWS — `recursive` most of all', () => {
    const root = scratch();
    assert.throws(() => listCheckoutsAcrossWorkspace(root, { recursive: true }), /unsupported option/);
    assert.throws(() => listCheckoutsAcrossWorkspace(root, { withFileTypes: true, encoding: 'utf8' }), /unsupported option/);
    assert.throws(() => listCheckoutsAcrossWorkspace(root, 'utf8'), /must be an object/);
  });

  test('listDir is untouched by the addition — it still hides every checkout', () => {
    const root = scratch();
    makeWorktree(root, 'slot-a');
    makeClone(root, 'slot-b');
    mkdirSync(join(root, SCRATCH_DIR_NAME));
    mkdirSync(join(root, 'services'));
    assert.deepEqual(listDir(root).sort(), ['services']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guard itself. Fixture roots carry a real copy of the helper so that R4 —
// "the helper still refuses" — is exercised against the fixture's copy and can
// be mutated, which is the only way to prove that limb can fail at all.
// ─────────────────────────────────────────────────────────────────────────────
const fixtureRoot = (files) => {
  const root = scratch();
  const ci = join(root, 'tooling', 'ci');
  mkdirSync(ci, { recursive: true });
  copyFileSync(join(CI_DIR, 'assert-walks-bounded.mjs'), join(ci, 'assert-walks-bounded.mjs'));
  copyFileSync(join(CI_DIR, 'tree-walk.mjs'), join(ci, 'tree-walk.mjs'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(ci, name), body);
  return root;
};

const run = (root) => {
  const r = spawnSync(process.execPath, [join(root, 'tooling', 'ci', 'assert-walks-bounded.mjs'), root], {
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

const OK_GUARD = [
  "import { listDir } from './tree-walk.mjs';",
  "for (const e of listDir('.')) void e;",
  '',
].join('\n');

describe('assert-walks-bounded.mjs — the prohibition can fail', () => {
  test('a tooling/ci where every listing goes through the helper passes', () => {
    const { status, out } = run(fixtureRoot({ 'assert-thing.mjs': OK_GUARD }));
    assert.equal(status, 0, out);
    assert.match(out, /walks bounded/);
  });

  test('R1 — importing readdirSync from node:fs fails', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "import { readdirSync } from 'node:fs';\nvoid readdirSync;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-bad\.mjs imports `readdirSync` from node:fs/);
  });

  test('R1 — a dynamic destructuring import of readdir is caught too', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "const { readdir } = await import('node:fs/promises');\nvoid readdir;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-bad\.mjs imports `readdir` from node:fs/);
  });

  test('R2 — a call reached through a namespace import is caught with no import to see', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "import * as fs from 'node:fs';\nvoid fs.readdirSync('.');\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-bad\.mjs calls `readdirSync\(`/);
  });

  test('R1/R2 — a doublestar glob taken straight from node:fs/promises is caught', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "import { glob } from 'node:fs/promises';\nfor await (const f of glob('a/**/b')) void f;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-bad\.mjs imports `glob` from node:fs/);
  });

  // The comment filter must discount prose without ever hiding code. Both halves
  // are asserted, because a filter that discounted too much would silently stop
  // seeing real calls — the failure direction this whole change is about.
  test('a comment NAMING readdirSync is not a use of it', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': `// this file used to call readdirSync(dir) and now does not\n${OK_GUARD}`,
    });
    const { status, out } = run(root);
    assert.equal(status, 0, out);
  });

  test('R3 — importing listDir and never calling it fails', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "import { listDir } from './tree-walk.mjs';\nvoid 0;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /imports listDir: true, calls listDir: false/);
  });

  test('R3 — calling listDir with no import fails', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "for (const e of listDir('.')) void e;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /imports listDir: false, calls listDir: true/);
  });

  // ── the self-checks: this guard reporting ok over nothing ──────────────────
  test('COVERAGE LOST when tooling/ci holds no .mjs at all', () => {
    const root = fixtureRoot({});
    rmSync(join(root, 'tooling', 'ci', 'tree-walk.mjs'));
    const guard = join(root, 'tooling', 'ci', 'assert-walks-bounded.mjs');
    const kept = readFileSync(guard, 'utf8');
    rmSync(guard);
    // run the REAL guard against the emptied fixture root
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
    assert.ok(kept.length > 0);
  });

  test('COVERAGE LOST when nothing routes a listing through the helper', () => {
    // Prohibitions alone are satisfied by a tooling/ci that enumerates nothing,
    // which is not what this guard asserts. The positive half must be present.
    const root = fixtureRoot({ 'assert-thing.mjs': 'void 0;\n' });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not one file/);
  });

  // 🔴 R4 — THE LIMB THAT MATTERS. R1–R3 only say "everything goes through one
  // door"; they are worth nothing if the door is standing open. Mutating the
  // fixture's own copy of the helper is the only way to prove this can fail.
  test('R4 — a helper that has stopped excluding nested checkouts is caught', () => {
    const root = fixtureRoot({ 'assert-thing.mjs': OK_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    writeFileSync(helper, src.replace('export function isNestedCheckout(absDir) {', 'export function isNestedCheckout(absDir) {\n  if (absDir) return false;'));
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no longer excludes what it claims to|failed to recognise a checkout/);
  });

  test('R4 — a helper that excludes EVERYTHING is caught too', () => {
    // The opposite failure, and the more dangerous one: every scan in tooling/ci
    // would range over an empty tree and every one of them would print ok.
    const root = fixtureRoot({ 'assert-thing.mjs': OK_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    writeFileSync(helper, src.replace('export function isNestedCheckout(absDir) {', 'export function isNestedCheckout(absDir) {\n  if (absDir) return true;'));
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('R4 — a boundedGlob that stopped filtering is caught', () => {
    const root = fixtureRoot({ 'assert-thing.mjs': OK_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    writeFileSync(helper, src.replace('if (withinTree(cwd, match)) yield match;', 'void cwd; yield match;'));
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /boundedGlob/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND ROUTE, AS THE GUARD SEES IT (added 2026-08-18).
//
// assert-walks-bounded.mjs now accepts `listCheckoutsAcrossWorkspace` as a
// listing route, because the guards whose subject is the WORKSPACE OF
// REPOSITORIES cannot use `listDir` — `listDir` removes exactly the nested
// checkouts that ARE their subject, so routing them through it would hand each
// an empty set and each would print ok over nothing.
//
// 🔴 THE ONLY THING THAT MATTERS ABOUT THIS ALLOWANCE IS THAT IT IS NARROW, so
// the two halves are tested as one pair and neither is allowed to stand alone:
//   · the new route PASSES — or the allowance was never made;
//   · raw `readdirSync` STILL FAILS, including in the very file that takes the
//     new route — or the allowance is an exemption, and the rule got weaker in
//     the one direction that reports clean.
// ─────────────────────────────────────────────────────────────────────────────
const CROSSING_GUARD = [
  "import { listCheckoutsAcrossWorkspace } from './tree-walk.mjs';",
  "for (const slot of listCheckoutsAcrossWorkspace('.')) void slot;",
  '',
].join('\n');

describe('assert-walks-bounded.mjs — the sanctioned crossing is a route, not an exemption', () => {
  test('a guard that lists the workspace by name PASSES', () => {
    const { status, out } = run(fixtureRoot({ 'assert-matrix.mjs': CROSSING_GUARD }));
    assert.equal(status, 0, out);
    assert.match(out, /walks bounded/);
  });

  // The pass line has to SAY that a crossing happened. A route granted in a file
  // nobody reads and reported in no log is a permission that has gone quiet.
  test('the pass line counts the crossers, and the guard does not count itself', () => {
    const withOne = run(fixtureRoot({ 'assert-matrix.mjs': CROSSING_GUARD }));
    assert.match(withOne.out, /\(1 of them cross to the workspace of repositories/);
    // 🔴 assert-walks-bounded.mjs imports the crossing primitive ITSELF, to run R4
    // against it. If its own copy in the fixture were counted, this number would
    // be >= 1 in every possible tree — the same inflation the importer count was
    // already caught committing once.
    const withNone = run(fixtureRoot({ 'assert-thing.mjs': OK_GUARD }));
    assert.equal(withNone.status, 0, withNone.out);
    assert.match(withNone.out, /\(0 of them cross to the workspace of repositories/);
  });

  // 🔴 THE RULE DID NOT GET WEAKER. This is the test the whole allowance is
  // answerable to: taking the sanctioned route buys a file nothing at all with
  // respect to R1/R2. If this ever passes, `listCheckoutsAcrossWorkspace` has
  // become the exemption list it was written to avoid being.
  test('raw readdirSync STILL FAILS in the very file that takes the new route', () => {
    const root = fixtureRoot({
      'assert-matrix.mjs': [
        "import { readdirSync } from 'node:fs';",
        "import { listCheckoutsAcrossWorkspace } from './tree-walk.mjs';",
        "for (const slot of listCheckoutsAcrossWorkspace('.')) void readdirSync(slot);",
        '',
      ].join('\n'),
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-matrix\.mjs imports `readdirSync` from node:fs/);
    assert.match(out, /assert-matrix\.mjs calls `readdirSync\(`/);
  });

  test('raw readdirSync STILL FAILS through a namespace import alongside the new route', () => {
    const root = fixtureRoot({
      'assert-matrix.mjs': [
        "import * as fs from 'node:fs';",
        "import { listCheckoutsAcrossWorkspace } from './tree-walk.mjs';",
        "for (const slot of listCheckoutsAcrossWorkspace('.')) void fs.readdirSync(slot);",
        '',
      ].join('\n'),
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /assert-matrix\.mjs calls `readdirSync\(`/);
  });

  // R3 reaches the new entry point too, in both directions. A decorative import
  // of the crossing primitive would read, to anyone auditing this rule, as a
  // guard that enumerates the workspace deliberately — while enumerating nothing.
  test('R3 — importing the crossing primitive and never calling it fails', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "import { listCheckoutsAcrossWorkspace } from './tree-walk.mjs';\nvoid 0;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /imports listCheckoutsAcrossWorkspace: true, calls listCheckoutsAcrossWorkspace: false/);
  });

  test('R3 — calling the crossing primitive with no import fails', () => {
    const root = fixtureRoot({
      'assert-thing.mjs': OK_GUARD,
      'assert-bad.mjs': "for (const s of listCheckoutsAcrossWorkspace('.')) void s;\n",
    });
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /imports listCheckoutsAcrossWorkspace: false, calls listCheckoutsAcrossWorkspace: true/);
  });

  // 🔴 R4 FOR THE SECOND DOOR. R1–R3 only say "the crossing has a name"; that is
  // worth nothing if the named function has quietly become an ordinary walk, or
  // has quietly become nothing. Both ends are mutated in the fixture's own copy
  // of the helper, which is the only way to prove these limbs can fail at all.
  test('R4 — a crossing primitive that has stopped returning the checkouts is caught', () => {
    // The vacuous end. Every matrix guard would enumerate zero store slots, find
    // no row to contradict, and print ok — the exact pass this route exists to
    // prevent, arrived at through the route itself.
    const root = fixtureRoot({ 'assert-matrix.mjs': CROSSING_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    writeFileSync(
      helper,
      src.replace(
        'export function listCheckoutsAcrossWorkspace(dir, options) {',
        'export function listCheckoutsAcrossWorkspace(dir, options) {\n  if (dir) return [];',
      ),
    );
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /listCheckoutsAcrossWorkspace` returned \[\]/);
  });

  test('R4 — a crossing primitive that returns ORDINARY directories too is caught', () => {
    // The other end: the crossing has widened into the walk it was carved out
    // of, and the matrix guards start treating every container between
    // Projects/ and the slots as if it were a repository.
    const root = fixtureRoot({ 'assert-matrix.mjs': CROSSING_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    const mutated = src.replace(
      "e.isDirectory() && e.name !== SCRATCH_DIR_NAME && isNestedCheckout(join(dir, e.name)),",
      "e.isDirectory() && e.name !== SCRATCH_DIR_NAME,",
    );
    assert.notEqual(mutated, src, 'the filter this test mutates must still exist in tree-walk.mjs');
    writeFileSync(helper, mutated);
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /listCheckoutsAcrossWorkspace` returned \[[^\]]*ordinary/);
  });

  test('R4 — a crossing primitive that has started RECURSING is caught', () => {
    // It stops at each checkout's doorstep or it is the original defect again:
    // a checkout nested inside a checkout must not surface from the level above.
    const root = fixtureRoot({ 'assert-matrix.mjs': CROSSING_GUARD });
    const helper = join(root, 'tooling', 'ci', 'tree-walk.mjs');
    const src = readFileSync(helper, 'utf8');
    const recursing = [
      'export function listCheckoutsAcrossWorkspace(dir, options) {',
      '  if (dir && !options) {',
      '    const acc = [];',
      '    const rec = (d, rel) => {',
      '      for (const e of readdirSync(d, { withFileTypes: true })) {',
      '        if (!e.isDirectory() || e.name === SCRATCH_DIR_NAME) continue;',
      '        const r = rel ? `${rel}/${e.name}` : e.name;',
      '        if (isNestedCheckout(join(d, e.name))) { acc.push(r); rec(join(d, e.name), r); }',
      '      }',
      '    };',
      '    rec(dir, \'\');',
      '    return acc.sort();',
      '  }',
    ].join('\n');
    writeFileSync(helper, src.replace('export function listCheckoutsAcrossWorkspace(dir, options) {', recursing));
    const { status, out } = run(root);
    assert.equal(status, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /inner-checkout/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The regression itself, stated as a test rather than as a note: the guard that
// was red on a developer machine must be green WITH A NESTED CHECKOUT PRESENT.
// A green run with no worktrees proves nothing — it is the state CI was already
// in while the defect was live.
// ─────────────────────────────────────────────────────────────────────────────
describe('the reproduced defect', () => {
  test('a wrangler config inside a nested checkout is invisible to the walk', () => {
    const root = scratch();
    // the tree's own service
    mkdirSync(join(root, 'services', 'platform'), { recursive: true });
    writeFileSync(join(root, 'services', 'platform', 'wrangler.jsonc'), '{}');
    // and sixteen agent worktrees, each a full copy
    mkdirSync(join(root, SCRATCH_DIR_NAME, 'worktrees'), { recursive: true });
    for (let i = 0; i < 16; i++) {
      const wt = makeWorktree(join(root, SCRATCH_DIR_NAME, 'worktrees'), `agent-${i}`);
      mkdirSync(join(wt, 'services', 'platform'), { recursive: true });
      writeFileSync(join(wt, 'services', 'platform', 'wrangler.jsonc'), '{}');
    }
    const found = [];
    const walk = (dir, rel) => {
      for (const e of listDir(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), r);
        else if (e.name === 'wrangler.jsonc') found.push(r);
      }
    };
    walk(root, '');
    assert.deepEqual(found, ['services/platform/wrangler.jsonc']);
  });
});
