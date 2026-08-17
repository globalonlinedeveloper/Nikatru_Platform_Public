// ─────────────────────────────────────────────────────────────────────────────
// guards-refuse-empty.test.mjs — tooling/ci/assert-guards-refuse-empty.mjs must
// be able to FAIL.
//
// That guard runs every executable in tooling/ci and tooling/scripts against a
// tree with no subject in it and requires each to refuse. It is therefore the
// file most at risk of being the defect it hunts: a version that probed nothing,
// built a tree that was secretly the real repository, or counted a crash-on-
// import as a refusal would print the same reassuring line it prints today.
//
// 🔴 THE REAL PROOFS ARE NOT HERE, AND THAT IS DELIBERATE. This repository has
// shipped a guard with all six of its fixture tests green — assert-seams-wired,
// whose caller check matched the function's own declaration, so deleting every
// real caller still passed. A fixture encodes the same misunderstanding as the
// guard it tests. So the guard's limbs were each proven against the REAL guard
// corpus first, by mutation (2026-08-17):
//
//   · a real guard given an early `process.exit(0)`  → named, exit 1
//   · 11 guards moved off disk, index untouched      → COVERAGE LOST, listed
//   · 65 of 130 removed from disk AND index          → COVERAGE LOST, floor
//   · the import closure disabled                    → COVERAGE LOST, 13 crashes
//   · `tooling` declared a product root              → COVERAGE LOST, not free
//   · a canary's expected exit flipped               → COVERAGE LOST, canary
//   · an exemption for a file that is not there      → named, exit 1
//   · a refusing guard listed as vacuous             → named as a stale waiver
//
// What the cases below add is the shapes that CANNOT be produced by mutating the
// real tree, because the real tree is (by design) compliant: an executable that
// passes over nothing, a not-applicable declaration that was never recorded, a
// module with no main, a broken import, an empty home.
//
// 🔴 DO NOT NAME ANY OTHER REAL GUARD IN THIS FILE. assert-guard-coverage.mjs
// decides "does this guard have a negative test" by asking whether any file in
// test/ mentions its basename. A literal `assert-cors-allowlist.mjs` here would
// hand that guard a negative test it does not have — the same trap recorded in
// guard-coverage.test.mjs, where three e2e paths written out as literals made
// the real repository report them all as covered. Every fixture executable below
// is named `probe-*.mjs`, which collides with nothing.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-guards-refuse-empty.mjs');

/** A refusing executable — the shape every real guard must have. */
const REFUSES = "console.error('x COVERAGE LOST - nothing to scan');\nprocess.exit(1);\n";
/** The defect: prints its happy line over a tree with nothing in it. */
const PASSES = "console.log('ok  0 file(s) scanned, all clean');\nprocess.exit(0);\n";

/** Build a throwaway repository with the two homes populated as asked, commit
 *  it, and return its root. A real git repo because the guard cross-checks its
 *  enumeration against `git ls-files`, and a directory that is not one would
 *  silently take that limb out of the test. */
const makeTree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-gre-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'probe');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'fixture');
  return root;
};

/** One minimally-compliant tree: both homes populated, everything refuses. */
const compliant = (extra = {}) =>
  makeTree({
    'tooling/ci/probe-alpha.mjs': REFUSES,
    'tooling/ci/probe-beta.mjs': REFUSES,
    'tooling/scripts/probe-gamma.mjs': REFUSES,
    ...extra,
  });

const run = (root, env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, '--fixture-root', root], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 240_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const withTree = (files, fn, env) => {
  const root = files;
  try {
    return fn(run(root, env), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('the probe itself', () => {
  // The positive control. Without it every red result below is consistent with a
  // guard that reports a problem no matter what it is given.
  test('a tree in which every executable refuses is accepted', () => {
    withTree(compliant(), ({ code, out }) => {
      assert.equal(code, 0, out);
      assert.match(out, /3 probed executable\(s\) refused/);
    });
  });

  test('an executable that exits 0 over the subject-free tree is named', () => {
    withTree(compliant({ 'tooling/ci/probe-vacuous.mjs': PASSES }), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /probe-vacuous\.mjs — exit 0 over a tree with no apps/);
      // and it must quote what the guard printed, so the reader can tell a
      // silent pass from a declared one without re-running anything
      assert.match(out, /0 file\(s\) scanned, all clean/);
    });
  });

  test('the executables really are run — a passing one is caught by exit code, not by reading its source', () => {
    // Same defect expressed with no give-away text at all: the source contains
    // no `ok`, no zero, nothing a grep could key on. Only running it reveals it.
    withTree(compliant({ 'tooling/ci/probe-quiet.mjs': 'const n = 1;\nprocess.exitCode = n - 1;\n' }), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /probe-quiet\.mjs — exit 0/);
      assert.match(out, /\(nothing at all\)/);
    });
  });

  test('a not-applicable declaration that was never recorded is still a finding', () => {
    // The declaration is what makes an exemption acceptable, but only alongside
    // a dated entry. If printing the words were enough, any guard could waive
    // itself by printing them.
    withTree(
      compliant({ 'tooling/ci/probe-declares.mjs': "console.log('NOT APPLICABLE - no subject');\nprocess.exit(0);\n" }),
      ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, /probe-declares\.mjs — exit 0/);
      },
    );
  });

  test('a guard that hangs is a finding, not a refusal', () => {
    withTree(
      // `process.argv` so the library derivation reads it as an executable —
      // without it this fixture has no main and is (correctly) reported as a
      // module nothing imports, which is a different limb entirely.
      compliant({ 'tooling/ci/probe-hangs.mjs': 'if (process.argv) setInterval(() => {}, 1000);\n' }),
      ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, /probe-hangs\.mjs — did not terminate within/);
      },
      { GUARDS_REFUSE_EMPTY_TIMEOUT_MS: '2000' },
    );
  });
});

describe('the library derivation', () => {
  test('a module with no main that a sibling imports is not probed', () => {
    withTree(
      compliant({
        'tooling/ci/probe-shared.mjs': 'export const helper = () => 1;\n',
        'tooling/ci/probe-user.mjs': "import { helper } from './probe-shared.mjs';\nhelper();\nprocess.exit(1);\n",
      }),
      ({ code, out }) => {
        assert.equal(code, 0, out);
        // it must be counted as a library rather than quietly dropped
        assert.match(out, /1 derived as libraries with no main/);
      },
    );
  });

  test('a module with no main that nothing imports is reported, not classified', () => {
    // Both halves of the derivation are required. "No main" alone would let a
    // dead file sit in tooling/ci permanently exempt from every probe.
    withTree(compliant({ 'tooling/ci/probe-orphan.mjs': 'export const x = 1;\n' }), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /probe-orphan\.mjs — has no main .* and nothing imports it/s);
    });
  });
});

describe('the scan cannot be trusted', () => {
  test('a tracked executable that is not on disk is COVERAGE LOST', () => {
    const root = compliant();
    rmSync(join(root, 'tooling/ci/probe-beta.mjs'));
    try {
      const { code, out } = run(root);
      assert.equal(code, 1, out);
      assert.match(out, /COVERAGE LOST — git tracks 3 executable\(s\).*this scan found 2/s);
      assert.match(out, /probe-beta\.mjs/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an executable importing a module that is not on disk is COVERAGE LOST', () => {
    // Otherwise it would die in the module loader, exit non-zero, and be counted
    // as a refusal it never made — 13 real guards did exactly that in development.
    withTree(
      compliant({ 'tooling/ci/probe-broken.mjs': "import './probe-missing.mjs';\nprocess.exit(1);\n" }),
      ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, /probe-missing\.mjs is imported by something in the guard homes and is not on disk/);
      },
    );
  });

  test('an empty home is COVERAGE LOST, not a smaller clean run', () => {
    withTree(makeTree({ 'tooling/ci/probe-alpha.mjs': REFUSES, 'tooling/scripts/.keep': '' }), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /tooling\/scripts contains no \.mjs file/);
    });
  });

  test('a missing home is COVERAGE LOST', () => {
    withTree(makeTree({ 'tooling/ci/probe-alpha.mjs': REFUSES }), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /tooling\/scripts does not exist/);
    });
  });
});

describe('real-repo mode', () => {
  // Reached the way assert-guard-coverage.mjs's own test reaches it: a copy of
  // the guard runs INSIDE a fixture with no argument, so it believes the fixture
  // is the repository. These limbs are switched off for a fixture root on
  // purpose — the floors would fail every fixture, and the exemption lists name
  // real paths no fixture has — so this is the only way to exercise them.
  const inRepoMode = (files) => {
    const root = makeTree(files);
    copyFileSync(GUARD, join(root, 'tooling/ci/assert-guards-refuse-empty.mjs'));
    copyFileSync(join(CI_DIR, 'tree-walk.mjs'), join(root, 'tooling/ci/tree-walk.mjs'));
    const r = spawnSync(process.execPath, ['tooling/ci/assert-guards-refuse-empty.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 240_000,
    });
    rmSync(root, { recursive: true, force: true });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  test('the guard-count floor fires when the corpus is a fraction of itself', () => {
    const { code, out } = inRepoMode({
      'tooling/ci/probe-alpha.mjs': REFUSES,
      'tooling/scripts/probe-gamma.mjs': REFUSES,
    });
    assert.equal(code, 1, out);
    assert.match(out, /tooling\/ci holds \d+ executable\(s\) and the floor is \d+/);
  });

  test('an exemption naming a file the scan did not enumerate is reported', () => {
    // Needs a corpus over the floors, so the run reaches classification: 120
    // trivial refusing executables in tooling/ci and 8 in tooling/scripts. Every
    // recorded exemption then names a path this tree does not have, and each one
    // must be called out rather than sitting there covering nothing.
    const files = {};
    for (let i = 0; i < 120; i++) files[`tooling/ci/probe-${String(i).padStart(3, '0')}.mjs`] = REFUSES;
    for (let i = 0; i < 8; i++) files[`tooling/scripts/probe-s${i}.mjs`] = REFUSES;
    const { code, out } = inRepoMode(files);
    assert.equal(code, 1, out);
    assert.match(out, /is excused .* and this scan did not enumerate it/s);
    // every recorded entry must be reported, not just the first one found
    const reported = [...out.matchAll(/is excused/g)].length;
    assert.ok(reported >= 6, `expected every recorded exemption to be reported, saw ${reported}\n${out}`);
  });
});
