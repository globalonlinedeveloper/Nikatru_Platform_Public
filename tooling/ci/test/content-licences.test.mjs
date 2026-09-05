// ─────────────────────────────────────────────────────────────────────────────
// content-licences.test.mjs — the COVERAGE cases for
// assert-content-licences.mjs: does the tripwire scan actually reach the files
// it says it reached?
//
// The guard's other limbs (register completeness, banned ids, the recipe
// blocking limb, the [8]K-10 seam) already have recorded failing cases in
// test/content-pipeline.test.mjs and test/licence-register.test.mjs, and the
// per-root emptying regressions live in test/vacuity-a.test.mjs. This file is
// about ONE question those three cannot ask, because none of them carries
// tooling/bricks: the brick template is part of the domain, and it must be
// impossible for it to fall out again in silence.
//
// ── THE DEFECT (G-2), MEASURED ON THIS TREE 2026-09-05 ──────────────────────
// The walk opened `if (depth > 4 || !existsSync(dir)) return;`. The brick's app
// pubspec sits at `tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml` —
// SIX directory levels below `tooling/` — so the walk turned back one level
// short of it. Appending `awesome_notifications_fcm: ^0.10.0` to that file (the
// exact dependency the one armed tripwire exists to catch) and running the
// committed guard printed
//
//   tripwire "awesome_notifications_fcm" armed and not tripped — appears in
//   none of the 12 pubspec(s) scanned (apps=1, packages=9, tooling=1, root=1)
//
// and EXITED 0. `tooling=1` was the mason hooks pubspec alone.
//
// ── EVERY CASE HERE WAS PROVED ABLE TO FAIL (2026-09-05) ────────────────────
// Three tests in this repo were found measuring nothing, so each limb of the
// repair was removed in turn and this file re-run. The cases that went RED are
// recorded beside the limb they stand for:
//
//   limb removed from the guard                     tests that went RED
//   the depth cap put back (`depth > 4`)            passes/names the split · THE G-2
//                                                   REGRESSION · the same dependency in an
//                                                   APP pubspec · no depth cap at all · THE
//                                                   SECOND LANDMARK · packages/ BELOW ITS FLOOR
//   the reach limb, L1 (`unreached = []`)           THE WALK NARROWED
//   the existence limb, L2 (`missing = []`)         THE LANDMARK IS GONE · tooling/ COLLAPSED ·
//                                                   THE SECOND LANDMARK · the sentinel switches
//                                                   the branch
//   the measured per-root floors (`belowFloor=[]`)  packages/ BELOW ITS FLOOR
//   the structural per-root floor (`if (false)`)    apps/ EMPTIED
//   `coverage mode:` dropped from the ok line       passes/names the split · A PARTIAL TREE
//                                                   SAYS SO
//
// Every case above appears on at least one row. The one case that appears on
// none — "the copy the other cases mutate really is the real brick" — asserts
// about the FIXTURE, not the guard: it is what stops the rest of this file from
// becoming evidence about a stand-in.
//
// Run:  node --test "tooling/ci/test/content-licences.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-content-licences.mjs');

/** The two landmark pubspecs the guard declares by name. Spelled here rather
 *  than imported, deliberately: a constant shared with the subject would move
 *  WITH the subject, and then a rename would break neither. */
const BRICK_APP_PUBSPEC = 'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml';
const BRICK_HOOKS_PUBSPEC = 'tooling/bricks/app/hooks/pubspec.yaml';
/** The full-checkout sentinel: the brick registry, at the repo root and so
 *  outside every subject tree the floors are about. */
const MASON = 'mason.yaml';
/** The one armed tripwire in the real register, and the reason it is armed. */
const TRIPWIRE_TOKEN = 'awesome_notifications_fcm';

/**
 * A copy of the real tree's subject, never a hand-built fixture.
 *
 * 🔴 THIS REPO HAS SHIPPED A GUARD WHOSE SIX FIXTURE TESTS ALL PASSED AGAINST A
 * BROKEN VERSION (assert-seams-wired.mjs): a fixture you write encodes the same
 * misunderstanding as the guard you write. So the register, the recipes and
 * every pubspec below are the committed files, byte for byte — including the
 * brick's, at its real six-deep path with its real `{{app_id}}` directory name.
 *
 * tooling/ci is NOT copied and does not need to be: the guard is run from the
 * repository with this tree as `argv[2]`, so its `./tree-walk.mjs` and
 * `../content_pipeline/src/recipe.mjs` imports resolve against the repository
 * while every path it READS is under this tree. That is also what makes
 * `mason.yaml` a usable sentinel here — see [PARTIAL TREE] below.
 */
function realTree({ mason = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-content-licences-'));
  for (const rel of ['tooling/legal', 'tooling/content_pipeline/examples']) {
    cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  }
  const files = ['pubspec.yaml', BRICK_APP_PUBSPEC, BRICK_HOOKS_PUBSPEC, ...(mason ? [MASON] : [])];
  for (const top of ['apps', 'packages']) {
    for (const e of readdirSync(join(REPO, top), { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(REPO, top, e.name, 'pubspec.yaml'))) files.push(`${top}/${e.name}/pubspec.yaml`);
    }
  }
  for (const rel of files) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  return root;
}

function withTree(opts, mutate, fn) {
  const root = realTree(opts);
  try {
    mutate(root);
    const r = spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' });
    fn({ ...r, out: `${r.stdout}${r.stderr}`, root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Append to a file, refusing a write that changed nothing — a test that
 *  mutates nothing proves nothing. */
const append = (root, rel, text) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  assert.ok(!before.includes(text.trim()), `${rel} already contains the mutation — it would prove nothing`);
  writeFileSync(p, `${before}${text}`);
};

/** Empty a directory but KEEP it, so a walk matches zero entries rather than
 *  erroring on a missing path. Absence and emptiness are different bugs. */
const emptyDir = (root, rel) => {
  const abs = join(root, rel);
  assert.ok(existsSync(abs) && readdirSync(abs).length > 0, `${rel} must be NON-EMPTY first, or the mutation proves nothing`);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
};

describe('the real tree', () => {
  test('passes, and the passing line names the split, the landmarks AND the branch it took', () => {
    withTree({}, () => {}, (r) => {
      assert.equal(r.status, 0, r.out);
      // 🔴 tooling=2, NOT 1. That single digit is the whole of G-2: it read 1
      // for as long as the depth cap stood, and the line was true either way
      // until it started naming the landmarks and the branch.
      assert.match(r.stdout, /apps=1, packages=\d+, tooling=2/, r.out);
      assert.match(r.stdout, /2 of the 2 declared landmark\(s\) were on disk and every one of those was reached/, r.out);
      assert.match(r.stdout, /coverage mode: FULL CHECKOUT \(mason\.yaml present\)/, r.out);
      assert.match(r.stdout, /tooling by named landmark, not by count/, r.out);
    });
  });

  test('the copy the other cases mutate really is the real brick', () => {
    // Without this, every "the guard caught it" below could be an artefact of a
    // stand-in file rather than evidence about the template that ships.
    withTree({}, () => {}, (r) => {
      const brick = readFileSync(join(r.root, BRICK_APP_PUBSPEC), 'utf8');
      assert.ok(brick.includes('resolution: workspace'), 'the brick pubspec must be the committed one');
      assert.ok(brick.includes('nikatru_notifications:'), 'and must really carry the shared notifications seam');
      assert.ok(!brick.includes(TRIPWIRE_TOKEN), 'and must NOT already declare the tripwire token');
    });
  });
});

describe('the brick template is IN the domain', () => {
  test('🔴 THE G-2 REGRESSION — an uncleared dependency in the BRICK app pubspec FAILS', () => {
    // EXIT 0 on the committed guard, measured 2026-09-05. This is the case.
    withTree({}, (root) => append(root, BRICK_APP_PUBSPEC, `\n  ${TRIPWIRE_TOKEN}: ^0.10.0\n`), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /is now IN A PUBSPEC and the row is not cleared/, r.out);
      assert.doesNotMatch(r.stdout, /armed and not tripped/, 'the guard must not also report the tripwire un-tripped');
    });
  });

  test('the same dependency in an APP pubspec fails too — the brick is not a special case', () => {
    // The control for the case above: if this one were green the redness there
    // would be evidence about the tripwire limb, not about the brick's reach.
    withTree({}, (root) => append(root, 'apps/subly/pubspec.yaml', `\n  ${TRIPWIRE_TOKEN}: ^0.10.0\n`), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /is now IN A PUBSPEC and the row is not cleared/, r.out);
    });
  });

  test('there is no depth cap at all — a pubspec NINE levels below tooling/ is still read', () => {
    // The brick's own pubspec is five levels below tooling/; this probe is nine.
    // A cap raised to 6 would pass the G-2 case above and fail this one, which
    // is why the repair deleted the cap rather than enlarging it. Nothing in
    // this repo nests this deep today: the point is that no number governs it.
    const deep = `${dirname(BRICK_APP_PUBSPEC)}/a/b/c/d/pubspec.yaml`;
    withTree(
      {},
      (root) => {
        mkdirSync(join(root, dirname(deep)), { recursive: true });
        writeFileSync(join(root, deep), `name: deep_probe\ndependencies:\n  ${TRIPWIRE_TOKEN}: ^0.10.0\n`);
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.stderr, /is now IN A PUBSPEC and the row is not cleared/, r.out);
      },
    );
  });
});

describe('the walk cannot narrow in silence', () => {
  test('🔴 THE WALK NARROWED — a landmark ON DISK that the scan did not collect is COVERAGE LOST', () => {
    // Not a hypothetical prune: `listDir` (tree-walk.mjs) excludes any directory
    // that is the root of ANOTHER CHECKOUT, because a guard reading a nested
    // clone's files as this tree's is the defect that module exists to prevent.
    // Drop a `.git` marker on tooling/bricks and both brick pubspecs are still
    // on disk, still shipped, and no longer in the scan — which is the exact
    // shape of every silent narrowing, depth cap included. Nothing but a
    // BY-NAME requirement can tell that apart from a smaller clean tree.
    withTree({}, (root) => writeFileSync(join(root, 'tooling/bricks/.git'), 'gitdir: ../elsewhere\n'), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /COVERAGE LOST/, r.out);
      assert.match(r.stderr, /2 pubspec\(s\) this guard must read are ON DISK and were NOT collected by the walk/, r.out);
      assert.match(r.stderr, /__brick__/, 'the refusal must name the file the walk stopped reaching');
      assert.match(r.stderr, /This is G-2 recurring/, r.out);
      assert.doesNotMatch(r.stdout, /armed and not tripped/, 'and must refuse BEFORE printing a tripwire verdict');
    });
  });

  test('🔴 THE LANDMARK IS GONE — deleting the brick app pubspec is COVERAGE LOST, not a smaller pass', () => {
    withTree({}, (root) => rmSync(join(root, BRICK_APP_PUBSPEC), { force: true }), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /COVERAGE LOST/, r.out);
      assert.match(r.stderr, /declared landmark pubspec\(s\) are not on disk/, r.out);
      assert.match(r.stderr, /__brick__/, 'the refusal must name the file that went missing');
      assert.doesNotMatch(r.stdout, /armed and not tripped/, 'and must refuse BEFORE printing a tripwire verdict');
    });
  });

  test('🔴 tooling/ COLLAPSED to the hooks pubspec — exactly what the depth cap produced — is refused', () => {
    // tooling=1, apps and packages intact: the committed guard exited 0 on this
    // very shape. There is deliberately NO count floor on tooling — see the
    // guard — so what refuses here is the landmark, by name.
    withTree(
      {},
      (root) => rmSync(join(root, 'tooling/bricks/app/__brick__'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.stderr, /COVERAGE LOST/, r.out);
        assert.match(r.stderr, /declared landmark pubspec\(s\) are not on disk/, r.out);
        assert.match(r.stderr, /__brick__/, r.out);
      },
    );
  });

  test('🔴 THE SECOND LANDMARK COUNTS TOO — losing the mason hooks pubspec is refused', () => {
    // Two entries in the list, so two cases. Without this one the hooks entry
    // could be deleted from REQUIRED_PUBSPECS and no test would notice.
    withTree({}, (root) => rmSync(join(root, BRICK_HOOKS_PUBSPEC), { force: true }), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /declared landmark pubspec\(s\) are not on disk/, r.out);
      assert.match(r.stderr, /bricks\/app\/hooks\/pubspec\.yaml/, r.out);
    });
  });

  test('🔴 packages/ BELOW ITS FLOOR of 5 is COVERAGE LOST while the structural floor of 1 is still met', () => {
    // The case a structural "at least one" floor cannot see: eight of nine
    // packages stop being scanned and one remains, so the root is not empty and
    // the union total is still large. Only a measured per-root floor fires.
    withTree(
      {},
      (root) => {
        const keep = new Set(['core']);
        for (const e of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
          if (e.isDirectory() && !keep.has(e.name)) rmSync(join(root, 'packages', e.name), { recursive: true, force: true });
        }
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.stderr, /packages\/ yielded 1 pubspec\(s\), floor 5/, r.out);
      },
    );
  });

  test('🔴 apps/ EMPTIED is COVERAGE LOST on the structural floor, over any tree', () => {
    withTree({ mason: false }, (root) => emptyDir(root, 'apps'), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /0 pubspec\.yaml under apps\//, r.out);
    });
  });
});

describe('the passing line does not claim coverage it did not have', () => {
  test('🔴 A PARTIAL TREE SAYS SO, and does not count a landmark it never had', () => {
    // [PARTIAL TREE] The measured floors and the "every landmark exists" check
    // are measurements of THIS repository and mean nothing over a tree that was
    // never meant to carry the brick — tooling/ci/test/content-pipeline.test.mjs
    // builds exactly such a tree. So they are gated, and WHICH BRANCH RAN IS
    // PRINTED: without that sentence a partial run and a full one are the same
    // line of output, which is how a floor stops applying and nobody notices.
    withTree(
      { mason: false },
      (root) => rmSync(join(root, BRICK_APP_PUBSPEC), { force: true }),
      (r) => {
        assert.equal(r.status, 0, r.out);
        assert.match(r.stdout, /coverage mode: PARTIAL TREE \(no mason\.yaml/, r.out);
        // 1 of 2, not 2 of 2. The line must not round its own coverage up.
        assert.match(r.stdout, /1 of the 2 declared landmark\(s\) were on disk/, r.out);
        assert.match(r.stdout, /tooling=1/, r.out);
      },
    );
  });

  test('the sentinel is what switches the branch, and nothing else does', () => {
    // Same tree, same missing landmark, mason.yaml back: now it must refuse.
    // Two runs differing in one file is what makes the gate a gate rather than
    // a condition that happens to be false.
    withTree({}, (root) => rmSync(join(root, BRICK_APP_PUBSPEC), { force: true }), (r) => {
      assert.equal(r.status, 1, r.out);
      assert.match(r.stderr, /not on disk under this full checkout/, r.out);
    });
  });
});
