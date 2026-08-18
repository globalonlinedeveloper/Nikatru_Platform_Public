// ─────────────────────────────────────────────────────────────────────────────
// store-matrix.test.mjs — assert-store-matrix.mjs must be able to FAIL.
//
// The guard's job is to keep catalog/store-matrix.json and the on-disk store
// tree from drifting apart, so the only thing worth testing is the set of states
// it must REFUSE. A guard tested exclusively against the real repository has only
// ever seen valid input, which is valid by definition.
//
// ⚠️ THE REAL-TREE NEGATIVES CAME FIRST, AND THEY ARE THE EVIDENCE. Every case
// below was first produced by MUTATING THE ACTUAL TREE AND THE ACTUAL REGISTRY on
// 2026-08-18, running the guard, and then restoring. The registry was pinned at
// sha256 3c151a68bbcaead921dc97a4c2ef577a0a343bda3543b6e31907d1627fedb488 before
// the first mutation and re-verified against that pin after the last. Results:
//   M1  mkdir Projects/Google_Play_Store/Android/Apps/Nikatru_Probe_Apps_Public
//                                          -> named the undeclared slot,  exit 1
//   M2  the same probe at Projects/ (depth 1, hiding from a depth-4 scan)
//                                          -> named it as out-of-shape,   exit 1
//   M3  mkdir a second `*_Private` in one slot path
//                                          -> named the broken pair,      exit 1
//   R1  a row dropped from `slots`         -> FLOOR BREACHED + both dirs,  exit 1
//   R2  two rows retargeted onto one name  -> named the repo collision,    exit 1
//   R3  state "shipped"                    -> named the vocabulary,        exit 1
//   R4  `slots: []`                        -> COVERAGE LOST,               exit 2
//   A   --registry-only where the tree IS reachable -> COVERAGE LOST,      exit 2
//   B   no anchor, nothing declared        -> COVERAGE LOST + walk,        exit 2
// Restored: registry hash back to the pin, tree back to 30 slot directories,
// guard exit 0.
//
// The cases below re-run those same faults against CONSTRUCTED trees, because a
// suite may not leave the real tree broken for the next reader. A constructed
// tree passing is not evidence the guard reaches the real one — the mutations
// above are that evidence, and this file is what keeps them from rotting.
//
// 🔴 THE POSITIVE CONTROLS ARE NOT OPTIONAL, AND THERE ARE THREE. Without a case
// that demands exit 0 over real input, every negative below is equally consistent
// with a guard that refuses everything it is shown; and without a case proving the
// CONSTRUCTED tree is clean BEFORE a fault is planted in it, every negative here
// is equally consistent with a tree that was malformed from the start.
//
// 🔴 AND ONE OF THEM DELIBERATELY DOES NOT ASSERT THE REAL TREE'S VERDICT, WHICH
// NEEDS ITS REASON WRITTEN DOWN. The registry is IN this repository; the store
// tree is THIRTY DIRECTORIES OUTSIDE it, and it is mutated by other processes.
// MEASURED 2026-08-18 17:47:24, while this suite was being written: another
// process filed 906 files into Google_Play_Store/Android/Games/
// Nikatru_Android_Games_Public — the public half of the FULL SOURCE COPY, private
// half still empty — and the guard immediately went red with `state says
// "shell-empty" but disk+backing derive "live"`. That is the guard working. It is
// ALSO proof that a positive control asserting `exit 0` over that tree is
// asserting what other agents are doing this minute, not what this guard does. So
// P1 demands exit 0 over the REAL REGISTRY (reproducible anywhere, and the thing
// this repo owns), P2 demands only that the real tree be REACHED and a verdict
// FORMED — anchor resolved, tree limb RAN, never exit 2 — and the verdict on the
// tree's contents belongs to the guard's own run, not to a test.
// Weakening P2 to `exit 0` and weakening P2 to `assert nothing` are both wrong;
// it asserts the one thing that is this guard's responsibility, which is that it
// still reaches the tree at all.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-store-matrix.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-store-matrix-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const run = (args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** The guard's own anchor walk, repeated here so the two cases below can state
 *  WHICH environment they are in instead of assuming the developer's one.
 *  A workstation holds the thirty slot directories; a CI runner clones ONE
 *  repository into /home/runner/work and holds neither marker. Both are real,
 *  and the guard behaves differently — correctly — in each. */
const anchorReachable = () => {
  let cur = dirname(GUARD);
  for (;;) {
    if (existsSync(join(cur, 'Projects')) && existsSync(join(cur, 'nikatru'))) return true;
    const up = dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
};

/** Three rows, one in each state, so that the vocabulary's "every value has a
 *  member" rule is satisfied and each case below can break exactly ONE thing. A
 *  fixture that differs from a valid tree in several ways at once cannot tell you
 *  which difference the guard reacted to. */
const ROWS = () => [
  { store: 'Store_A', target: 'Alpha', type: 'Apps', state: 'shell-empty', backing: null },
  { store: 'Store_B', target: 'Beta', type: 'Apps', state: 'shell-claimed', backing: { product: 'p', filed: false } },
  { store: 'Store_C', target: 'Gamma', type: 'Apps', state: 'live', backing: null },
];

const registryFor = (rows) => ({
  naming: { directoryRule: 'Nikatru_<target>_<type>_<Public|Private>. Holds for every directory.' },
  stateVocabulary: { note: 'n', live: 'l', 'shell-claimed': 'c', 'shell-empty': 'e', derivedFrom: 'd' },
  counts: {
    slots: rows.length,
    directories: rows.length * 2,
    live: rows.filter((r) => r.state === 'live').length,
    'shell-claimed': rows.filter((r) => r.state === 'shell-claimed').length,
    'shell-empty': rows.filter((r) => r.state === 'shell-empty').length,
    intendedReposExistingOnGitHub: 0,
  },
  backing: { products: [{ product: 'p', claimsSlots: rows.filter((r) => r.backing).map((r) => `${r.store}/${r.target}/${r.type}`) }] },
  slots: rows.map((r) => ({
    store: r.store,
    target: r.target,
    type: r.type,
    publicDir: r.publicDir ?? `Nikatru_${r.target}_${r.type}_Public`,
    state: r.state,
    backing: r.backing,
    repos: {
      public: { existsOnGitHub: false, visibility: null, boundRemote: null },
      private: { existsOnGitHub: false, visibility: null, boundRemote: null },
    },
  })),
});

/** Builds a real directory tree plus a registry file, and returns the two paths.
 *  `mutate` runs after both are written, so a case can break the tree, the
 *  registry, or both — the same way the real-tree mutations did. */
function tree(rows, mutate) {
  const base = join(TMP, `t${seq++}`);
  const projects = join(base, 'Projects');
  for (const r of rows) {
    const typeDir = join(projects, r.store, r.target, r.type);
    mkdirSync(join(typeDir, `Nikatru_${r.target}_${r.type}_Public`), { recursive: true });
    mkdirSync(join(typeDir, `Nikatru_${r.target}_${r.type}_Private`), { recursive: true });
    if (r.state === 'live') {
      // `live` means a real source tree, so it needs a real file in it — the
      // guard derives the state from emptiness and would otherwise disagree.
      writeFileSync(join(typeDir, `Nikatru_${r.target}_${r.type}_Public`, 'f.txt'), 'x');
      writeFileSync(join(typeDir, `Nikatru_${r.target}_${r.type}_Private`, 'f.txt'), 'x');
    }
  }
  const registry = join(base, 'registry.json');
  const reg = registryFor(rows);
  writeFileSync(registry, `${JSON.stringify(reg, null, 2)}\n`);
  if (mutate) mutate({ projects, registry, reg, write: () => writeFileSync(registry, `${JSON.stringify(reg, null, 2)}\n`) });
  return ['--projects', projects, '--registry', registry];
}

describe('assert-store-matrix — positive controls', () => {
  test('P1 the REAL registry, as this repository ships it, passes', () => {
    // Run from a copy planted where no ancestor holds Projects/ + nikatru/ — the
    // shape of a CI checkout, and the only place --registry-only is legitimate.
    const base = join(TMP, `p1-${seq++}`);
    mkdirSync(base, { recursive: true });
    const guardCopy = join(base, 'assert-store-matrix.mjs');
    writeFileSync(guardCopy, readFileSync(GUARD, 'utf8'));
    // 2026-08-18: the guard now imports `listDir` and `listCheckoutsAcrossWorkspace`
    // from ./tree-walk.mjs, so a planted copy needs its sibling or node fails at
    // MODULE RESOLUTION — exit 1, before a line of the guard runs. That failure
    // wears the same clothes as a real finding while proving nothing about the
    // registry, which is what this case is for. Same repair as
    // github-matrix.test.mjs:283, guards-refuse-empty.test.mjs:236 and
    // release-durable.test.mjs:100.
    writeFileSync(join(base, 'tree-walk.mjs'), readFileSync(join(CI_DIR, 'tree-walk.mjs'), 'utf8'));
    const r = spawnSync(
      process.execPath,
      [guardCopy, '--registry-only', '--registry', join(REPO, 'catalog', 'store-matrix.json')],
      { encoding: 'utf8' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /assert-store-matrix: ok/);
    // 15 rows, not 0: an `ok` over an empty registry would satisfy the line above.
    assert.match(out, /checked 15 slot row\(s\)/);
  });

  test('P2 a no-flag run REACHES whichever tree is here, and forms a verdict about it', () => {
    // THIS CASE HAS TWO ENVIRONMENTS AND IT ASSERTS IN BOTH. It is NOT a
    // conditional skip: neither branch can pass without the guard doing the
    // thing that branch names.
    //
    // Written first as "the REAL tree is still REACHED from here", it asserted a
    // fact about the DEVELOPER'S HOME DIRECTORY, and it went red on a runner for
    // that reason alone (measured: run 32148776220). The tree is thirty
    // directories OUTSIDE this repository and a CI checkout holds one repo, so
    // "the anchor resolves" is not a property this repository can carry.
    //
    // What IS this guard's responsibility is that it never quietly stops
    // looking, and that has a different, equally checkable shape in each place:
    //   anchor present -> the tree limb RAN and a verdict was formed, never 2
    //   anchor absent  -> COVERAGE LOST, exit 2, and the walk PRINTED
    // The second is case B of the real-tree mutation table in this file's header
    // ("no anchor, nothing declared -> COVERAGE LOST + walk, exit 2"), which was
    // recorded as evidence and then had no test. It has one now.
    const r = run([]);
    if (anchorReachable()) {
      // 0 or 1: a finding about the tree is a true finding and not this suite's
      // business. 2 is not allowed - that is the anchor failing, which IS this
      // guard's business and would mean it had quietly stopped looking.
      assert.ok(r.code === 0 || r.code === 1, `expected 0 or 1, got ${r.code}\n${r.out}`);
      assert.match(r.out, /tree limb: RAN against/);
      assert.match(r.out, /across 15 slot path\(s\)/);
    } else {
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST/);
      assert.match(r.out, /ANCHOR NOT FOUND/);
      // The walk is printed, so "I could not look" names where it looked. An
      // exit 2 with no walk would be the refusal degrading into a shrug.
      assert.match(r.out, /Walked:/);
      // and it must NOT have reported a tree verdict it could not have formed.
      assert.doesNotMatch(r.out, /tree limb: RAN against/);
    }
  });

  test('P3 the constructed tree is clean BEFORE any fault is planted in it', () => {
    const r = run(tree(ROWS()));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /assert-store-matrix: ok/);
  });

  test('P4 a slot that is a REAL CHECKOUT is still enumerated', () => {
    // 🔴 ADDED 2026-08-18 WITH THE MOVE TO tree-walk.mjs, AND IT IS THE CASE THAT
    // KEEPS THE REPAIR FROM BEING UNDONE. Every other fixture in this file builds
    // slot directories with no `.git` in them, so every one of them passes just as
    // well through `listDir` — which SKIPS nested checkouts — as through
    // `listCheckoutsAcrossWorkspace`. A live slot is a separate repository (2 of the
    // 30 on the developer's tree are, this repo among them), so a guard routed
    // through `listDir` alone would stop seeing exactly the slots that exist for
    // real and report the registry's rows as "not on disk". Negative-tested by
    // deleting the crossing call from a copy of the guard: this case then exits 1
    // with `is not a slot directory on disk — Store_C/Gamma/Apps/...`, both halves.
    const r = run(
      tree(ROWS(), ({ projects }) => {
        const d = join(projects, 'Store_C', 'Gamma', 'Apps');
        // A worktree's `.git` is a FILE and a clone's is a DIRECTORY. Both shapes
        // are planted, because a test for one alone passes while the other walks
        // straight through — the same trap tree-walk.mjs names in isNestedCheckout.
        writeFileSync(join(d, 'Nikatru_Gamma_Apps_Public', '.git'), 'gitdir: /elsewhere\n');
        mkdirSync(join(d, 'Nikatru_Gamma_Apps_Private', '.git'), { recursive: true });
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /assert-store-matrix: ok/);
    // and it must have counted all six directories, not four: an `ok` that lost
    // the two checkout halves is exactly the vacuous pass this case exists for.
    assert.match(r.out, /6 slot directories across 3 slot path\(s\)/);
  });
});

describe('assert-store-matrix — the tree and the registry must agree, in BOTH directions', () => {
  test('N1 a slot directory on disk with no row is named', () => {
    const r = run(
      tree(ROWS(), ({ projects }) => {
        mkdirSync(join(projects, 'Store_A', 'Alpha', 'Apps', 'Nikatru_Probe_Apps_Public'), { recursive: true });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NO ROW in the registry — Store_A\/Alpha\/Apps\/Nikatru_Probe_Apps_Public/);
  });

  test('N2 a row naming a directory that is not on disk is named', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.slots[0].target = 'Alfa';
        reg.slots[0].publicDir = 'Nikatru_Alfa_Apps_Public';
        write();
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not a slot directory on disk — Store_A\/Alfa\/Apps\/Nikatru_Alfa_Apps_Public/);
  });

  test('N3 a slot-shaped directory hiding OUTSIDE the depth-4 shape is named', () => {
    const r = run(
      tree(ROWS(), ({ projects }) => {
        mkdirSync(join(projects, 'Nikatru_Probe_Apps_Public'), { recursive: true });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /OUTSIDE the <store>\/<target>\/<type>\/<name> shape — Nikatru_Probe_Apps_Public \(depth 1/);
  });
});

describe('assert-store-matrix — the pair is one public and one private, swapped', () => {
  test('N4 a private half whose name is not the public name swapped is named', () => {
    const r = run(
      tree(ROWS(), ({ projects }) => {
        const d = join(projects, 'Store_A', 'Alpha', 'Apps');
        renameSync(join(d, 'Nikatru_Alpha_Apps_Private'), join(d, 'Nikatru_Alfa_Apps_Private'));
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the private half on disk is "Nikatru_Alfa_Apps_Private"/);
    assert.match(r.out, /swaps to "Nikatru_Alpha_Apps_Private"/);
  });

  test('N5 a slot path holding two private halves is named', () => {
    const r = run(
      tree(ROWS(), ({ projects }) => {
        mkdirSync(join(projects, 'Store_A', 'Alpha', 'Apps', 'Nikatru_Alpha_Games_Private'), { recursive: true });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a slot is ONE public \+ ONE private directory/);
  });
});

describe('assert-store-matrix — the collision class that already bit this tree', () => {
  test('N6 two slots intending the same GitHub repo name are named, both halves', () => {
    const r = run(
      tree(ROWS(), ({ projects, reg, write }) => {
        // Store_B retargeted onto Alpha: the name rule is still satisfied, so the
        // ONLY fault is that two slots now intend one repo.
        reg.slots[1].target = 'Alpha';
        reg.slots[1].publicDir = 'Nikatru_Alpha_Apps_Public';
        reg.backing.products[0].claimsSlots = ['Store_B/Alpha/Apps'];
        write();
        mkdirSync(join(projects, 'Store_B', 'Alpha', 'Apps', 'Nikatru_Alpha_Apps_Public'), { recursive: true });
        mkdirSync(join(projects, 'Store_B', 'Alpha', 'Apps', 'Nikatru_Alpha_Apps_Private'), { recursive: true });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /same GitHub repo name "Nikatru_Alpha_Apps_Public"/);
    assert.match(r.out, /same GitHub repo name "Nikatru_Alpha_Apps_Private"/);
  });

  test('N7 a collision that differs only in CASE is still a collision', () => {
    const r = run(
      tree(ROWS(), ({ projects, reg, write }) => {
        reg.naming.directoryRule = 'Nikatru_<target>_<type>_<Public|Private>.';
        reg.slots[1].target = 'ALPHA';
        reg.slots[1].publicDir = 'Nikatru_ALPHA_Apps_Public';
        reg.backing.products[0].claimsSlots = ['Store_B/ALPHA/Apps'];
        write();
        mkdirSync(join(projects, 'Store_B', 'ALPHA', 'Apps', 'Nikatru_ALPHA_Apps_Public'), { recursive: true });
        mkdirSync(join(projects, 'Store_B', 'ALPHA', 'Apps', 'Nikatru_ALPHA_Apps_Private'), { recursive: true });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /same GitHub repo name "Nikatru_ALPHA_Apps_Public"/);
    assert.match(r.out, /flat and case-insensitive/);
  });
});

describe('assert-store-matrix — the vocabulary is the registry\'s, not this guard\'s', () => {
  test('N8 a state outside the documented vocabulary is named', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.slots[0].state = 'shipped';
        write();
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /state "shipped" is not in the documented vocabulary/);
  });

  test('N9 a vocabulary value no row is in is named', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.stateVocabulary.retired = 'r';
        write();
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"retired" has no member/);
  });

  test('N10 a renamed meta key would otherwise become a valid state — that is named', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.stateVocabulary.comment = reg.stateVocabulary.note;
        delete reg.stateVocabulary.note;
        write();
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /stateVocabulary has no "note" key/);
  });

  test('N11 an unparseable naming rule is COVERAGE LOST, not a silent accept-everything', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.naming.directoryRule = 'names are whatever feels right on the day';
        write();
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /does not contain a parseable template/);
  });
});

describe('assert-store-matrix — the floor', () => {
  test('N12 a registry that silently empties REFUSES rather than passing over nothing', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.slots = [];
        write();
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /declares ZERO slots/);
  });

  test('N13 fewer rows than slot paths on disk breaches the floor by name', () => {
    const r = run(
      tree(ROWS(), ({ reg, write }) => {
        reg.slots.pop();
        write();
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /FLOOR BREACHED — 2 row\(s\) < 3 slot path\(s\) on disk/);
  });

  test('N14 an absent registry is "the subject is gone", not "nothing to check"', () => {
    const r = run(['--projects', join(TMP, 'nonexistent-tree-that-is-fine'), '--registry', join(TMP, 'no-such-registry.json')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe('assert-store-matrix — the two absences are answered by two different tests', () => {
  test('N15 --registry-only where the tree IS reachable refuses itself', () => {
    // THE REACHABLE TREE IS GIVEN, NOT INHERITED. This case needs a tree that IS
    // reachable; taking that from the ambient filesystem made it assert the
    // developer's home directory, and on a runner - where no tree is reachable -
    // `--registry-only` is LEGITIMATE, so the guard correctly exited 0 and the
    // case went red having found no subject (measured: run 32148776220).
    // `--projects` names a tree that is reachable BY CONSTRUCTION, so the branch
    // under test is entered on every box. Same refusal, same assertions, no
    // dependence on where this ran.
    const r = run(['--registry-only', ...tree(ROWS())]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /the store tree IS reachable from here/);
  });

  test('N16 a wrong --projects path is a defect, refused, not read as "no tree here"', () => {
    const r = run(['--projects', join(TMP, 'definitely-not-here'), '--registry', join(REPO, 'catalog', 'store-matrix.json')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /which does not exist/);
  });

  test('N17 --registry-only is not a pass-everything mode: registry faults still fail', () => {
    // Run from a copy planted where no ancestor holds Projects/ + nikatru/, which
    // is the shape of a CI checkout — the only place the flag is legitimate.
    const base = join(TMP, `ro${seq++}`);
    mkdirSync(base, { recursive: true });
    const guardCopy = join(base, 'assert-store-matrix.mjs');
    writeFileSync(guardCopy, readFileSync(GUARD, 'utf8'));
    // 2026-08-18: the planted copy needs ./tree-walk.mjs beside it — see P1. A
    // module-resolution failure here would exit 1 with no `same GitHub repo name`
    // in it, i.e. this case would fail for a reason that has nothing to do with
    // whether --registry-only still runs the registry limb.
    writeFileSync(join(base, 'tree-walk.mjs'), readFileSync(join(CI_DIR, 'tree-walk.mjs'), 'utf8'));
    const rows = ROWS();
    rows[1].target = 'Alpha';
    rows[1].publicDir = 'Nikatru_Alpha_Apps_Public';
    const reg = registryFor(rows);
    reg.backing.products[0].claimsSlots = ['Store_B/Alpha/Apps'];
    const registry = join(base, 'registry.json');
    writeFileSync(registry, `${JSON.stringify(reg, null, 2)}\n`);
    const r = spawnSync(process.execPath, [guardCopy, '--registry-only', '--registry', registry], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /same GitHub repo name/);
    // and it must SAY what it did not do, rather than reading as a full run.
    assert.match(out, /tree limb: NOT RUN/);
  });
});
