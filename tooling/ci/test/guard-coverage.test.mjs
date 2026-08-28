// ─────────────────────────────────────────────────────────────────────────────
// guard-coverage.test.mjs — assert-guard-coverage.mjs must be able to FAIL.
//
// [pipeline F-10] This is the guard that enforces F-10 on every other guard, so
// if it silently stops working the whole mechanism stops with it and every
// requirement in all fourteen stages goes back to resting on discipline.
//
// Fake trees, because the real tree is (by design) always compliant — which is
// exactly the blind spot F-10 exists to remove.
//
// 🔴 READ THIS BEFORE EDITING THE FIXTURES. Until 2026-08-01 the helpers below
// carried `testFiles = 37` and `compliant(…, 42)` — numbers that had to be
// ratcheted in lockstep with MIN_TEST_FILES and MIN_GUARDS in the guard, because
// a fixture under the floor turned every green case red for a reason that had
// nothing to do with the behaviour under test. That coupling is GONE with the
// floors: the fixtures now build FOUR guards and THREE test files and will never
// need touching as the real tree grows. If you ever find yourself raising a
// number here to make a test pass, something has regressed to the old shape.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, unlinkSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-guard-coverage.mjs');
const MANIFEST_REL = join('tooling', 'ci', 'test', 'coverage-manifest.json');

/** The paths NO_NEGATIVE_TEST_NEEDED excuses, READ OUT OF THE GUARD rather than
 *  copied here — for two reasons, and the second one is not obvious.
 *
 *  1. A hardcoded copy drifts. Deriving it means a real-mode fixture always
 *     models the exemption list that actually exists.
 *  2. 🔴 WRITING THOSE PATHS OUT AS LITERALS IN THIS FILE BREAKS THE GUARD IT
 *     TESTS. "Is this script named anywhere in the suite?" is how the guard
 *     decides an outside script HAS a negative test, and the corpus is every
 *     file in test/ — including this one. A literal `'tooling/e2e/purge.mjs'`
 *     here made the real repository report all three e2e scripts as COVERED,
 *     silently emptying the exemption list and overstating coverage. Caught on
 *     the first real run after the fixtures were written. Keep this derived;
 *     do not paste the paths back in. */
const EXCUSED = (() => {
  const src = readFileSync(GUARD, 'utf8');
  const block = src.match(/NO_NEGATIVE_TEST_NEEDED = new Map\(\[([\s\S]*?)\n\]\);/);
  assert.ok(block, 'could not find NO_NEGATIVE_TEST_NEEDED in the guard — the fixtures cannot model it');
  return [...block[1].matchAll(/'(tooling\/[^']+\.mjs)'/g)].map((m) => m[1]);
})();

/** Every workflow-invoked executable OUTSIDE tooling/ci in the REAL repository,
 *  derived the way the guard derives `invokedOutside` (comment lines dropped,
 *  then the same broad `tooling/…​.mjs` match). DERIVED, NEVER PASTED — for
 *  reason 2 in the EXCUSED note above, which is the same reason the last test in
 *  this file exists. */
const WORKFLOW_INVOKED_OUTSIDE = (() => {
  const dir = resolve(CI_DIR, '..', '..', '.github', 'workflows');
  const rels = new Set();
  // `.ya?ml` is the guard's own filter. Without
  // it a stray directory or dotfile in .github/workflows makes readFileSync
  // THROW — an error, not a verdict — on whichever host has one first.
  for (const wf of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(dir, wf), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    for (const m of text.matchAll(/tooling\/([A-Za-z0-9._/-]+\.mjs)/g)) {
      const rel = `tooling/${m[1]}`;
      if (!rel.startsWith('tooling/ci/')) rels.add(rel);
    }
  }
  return [...rels].sort();
})();

/** The guards NOT_CI_RUNNABLE excuses from R2, READ OUT OF THE GUARD for the two
 *  reasons EXCUSED is derived above — and the second one bites harder here.
 *
 *  1. A hardcoded copy drifts.
 *  2. 🔴 THE NAMES ARE tooling/ci FILENAMES, AND "IS THIS GUARD NAMED ANYWHERE IN
 *     THE SUITE?" IS HOW LIMB 1 DECIDES A GUARD HAS A NEGATIVE TEST. Typing
 *     `'assert-github-matrix.mjs'` in this file would hand that guard a recorded
 *     failing case it does not have, from the very file testing the mechanism
 *     that excused it. That is the same trap the EXCUSED comment records, one
 *     directory over, and it is worse here: the guard it would falsely cover is
 *     the guard nothing runs.
 *
 *  Matched on the KEY position — a quoted name immediately followed by the entry
 *  object — because the `why` prose names other .mjs files inside its strings. */
const UNRUNNABLE = (() => {
  const src = readFileSync(GUARD, 'utf8');
  const block = src.match(/NOT_CI_RUNNABLE = new Map\(\[([\s\S]*?)\n\]\);/);
  assert.ok(block, 'could not find NOT_CI_RUNNABLE in the guard — the fixtures cannot model it');
  const names = [...block[1].matchAll(/\[\s*'([A-Za-z0-9._-]+\.mjs)',\s*\{/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'NOT_CI_RUNNABLE parsed to zero entries — the fixtures would model an empty map');
  return names;
})();

/** A fixture stand-in for a guard no runner can make pass. It REFUSES, which is
 *  the entry's price of admission, and it carries its self-check in code rather
 *  than in a comment — a comment mentioning the marker is exactly the
 *  prose-satisfies-a-check pattern these guards exist to refuse, even here. */
const UNRUNNABLE_REFUSES = [
  '#!/usr/bin/env node',
  "console.error('COVERAGE LOST — fixture stand-in: no subject reachable from a runner');",
  'process.exit(2);',
  '',
].join('\n');

/** The same stand-in with the claim FALSIFIED: it passes. An exemption saying a
 *  runner cannot make this guard pass, over a guard that just did. */
const UNRUNNABLE_PASSES = [
  '#!/usr/bin/env node',
  "if (process.env.NEVER) console.error('COVERAGE LOST — unreachable');",
  "console.log('ok  fixture stand-in that should not have passed');",
  'process.exit(0);',
  '',
].join('\n');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-gc-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/**
 * Build a fake repo.
 *
 * @param guards  map of filename -> source text
 * @param opts.testFiles      how many test files to write (each naming every guard)
 * @param opts.mentionAll     false = the test files name nothing real
 * @param opts.hollow         file 0 is present but declares no test
 * @param opts.commentsOnly   every test file is comments only
 * @param opts.files          extra files written at the fixture root
 * @param opts.scripts        executables OUTSIDE tooling/ci, created on disk AND
 *                            invoked by the generated workflow — the derived
 *                            subject set that replaced the hand-written
 *                            COVERED_SCRIPTS map
 * @param opts.mentionScripts how the generated test files treat those scripts:
 *                            true = each is SPAWNED (what a negative test does),
 *                            'names-only' = named in executable code but never
 *                            run — the tooling/e2e/verify_purged.mjs shape, a
 *                            fixture edit inside a test of something else —
 *                            false = not named at all
 * @param opts.mutateGuard    transform applied to the REAL guard source before
 *                            it is copied in under `real` — the only way to
 *                            reach the guard's own inline canaries, which cannot
 *                            fail unless the detector they watch is broken
 * @param opts.workflow       replace the generated workflow entirely
 * @param opts.invoke         override which guard filenames the workflow invokes
 * @param opts.manifest       pre-seed tooling/ci/test/coverage-manifest.json
 * @param opts.real           copy the REAL guard into the fixture so it can be
 *                            invoked with no argv[2] — i.e. in the same
 *                            "scanning the real repository" mode ci.yml uses
 */
function repo(
  guards,
  {
    testFiles = 3,
    mentionAll = true,
    hollow = false,
    commentsOnly = false,
    files = {},
    scripts = ['tooling/scripts/provision-backend.mjs'],
    /** created on disk and invoked by the workflow, but deliberately NEVER named
     *  by a test file — i.e. the shape NO_NEGATIVE_TEST_NEEDED excuses. */
    excused = [],
    /** filenames written into tooling/ci and deliberately NEVER invoked by the
     *  workflow — the shape NOT_CI_RUNNABLE excuses from R2. Pass the derived
     *  UNRUNNABLE list so a real-mode fixture models the map that exists. */
    unrunnable = [],
    mentionScripts = true,
    workflow,
    invoke,
    manifest,
    real = false,
    mutateGuard,
  } = {},
) {
  const root = join(TMP, `r${seq++}`);
  const ci = join(root, 'tooling', 'ci');
  const t = join(ci, 'test');
  mkdirSync(t, { recursive: true });

  const all = { ...guards };
  // The guard under test, copied in, so that invoking THE COPY with no argument
  // puts it in real-repo mode against the fixture. Any other way of reaching
  // those limbs would mean adding a "pretend this is the real repo" switch to a
  // guard, and a switch that relaxes a guard is a switch someone will find.
  if (real) {
    const g = readFileSync(GUARD, 'utf8');
    all['assert-guard-coverage.mjs'] = mutateGuard ? mutateGuard(g) : g;
  }

  // Modules the copied guard IMPORTS travel with it, or the copy does not FAIL
  // the assertion under test — it fails to start, and the test then reports
  // whatever the module loader said. Deliberately NOT added to `all`: nothing
  // invokes tree-walk.mjs, and that is the point. It is reached only through the
  // import graph, which is exactly the FOUND ⊆ REACHED path these fixtures
  // otherwise never exercise.
  // text-reductions.mjs joined tree-walk.mjs here on 2026-08-17, when the
  // coverage-self-check limb stopped grepping raw prose and started asking
  // `stripSourceComments` what is actually CODE. Both are pure modules with no
  // imports of their own, so copying the two files is the whole dependency.
  const deps = real ? ['tree-walk.mjs', 'text-reductions.mjs'] : [];
  for (const dep of deps) writeFileSync(join(ci, dep), readFileSync(join(CI_DIR, dep), 'utf8'));

  for (const [name, src] of Object.entries(all)) writeFileSync(join(ci, name), src);
  // Written into tooling/ci but deliberately absent from `all`, so the generated
  // workflow does not invoke them — unreached by construction, which is the
  // whole state NOT_CI_RUNNABLE describes.
  for (const name of unrunnable) writeFileSync(join(ci, name), UNRUNNABLE_REFUSES);
  for (const rel of [...scripts, ...excused]) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '#!/usr/bin/env node\n// an executable a workflow runs\n');
  }

  // EVERY GUARD IS WIRED INTO A WORKFLOW BY DEFAULT, because that is now the
  // property that pins the guard set. A fixture that skipped it would model a
  // tree that cannot exist.
  const invoked = invoke ?? Object.keys(all);
  const generated =
    'name: fixture\non: [push]\njobs:\n  guards:\n    runs-on: ubuntu-latest\n    steps:\n' +
    invoked.map((g) => `      - run: node tooling/ci/${g}\n`).join('') +
    [...scripts, ...excused].map((s) => `      - run: node ${s}\n`).join('') +
    '      - run: node --test "tooling/ci/test/*.test.mjs"\n';
  if (workflow !== null) {
    const wf = join(root, '.github', 'workflows', 'ci.yml');
    mkdirSync(dirname(wf), { recursive: true });
    writeFileSync(wf, workflow ?? generated);
  }

  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }

  // ⚠️ These must be REAL test declarations, not comments. This fixture used to
  // write `// <guard-name>` and pass — encoding the same blind spot the guard
  // itself had, so neither could see that a hollowed-out test file covers
  // nothing. Found 2026-07-27 while closing F-10.
  const covered = mentionAll ? [...Object.keys(all), ...unrunnable, ...deps] : ['nothing-real.mjs'];
  // ⚠️ A SCRIPT OUTSIDE tooling/ci IS NOT CREDITED BY BEING NAMED — it is
  // credited by being RUN, so the fixture has to run it. Until 2026-08-26 this
  // wrote `test('exercises provision-backend.mjs', …)` and the guard counted it,
  // which is the same blind spot that credited tooling/e2e/verify_purged.mjs to
  // a test of assert-d1-sql-inventory.mjs for editing a COMMENT inside it.
  // 'names-only' reproduces exactly that shape, kept so the repair has a failing
  // case of its own.
  const scriptLines = (rel) =>
    mentionScripts === 'names-only'
      ? `test('edits ${rel} as fixture material', () => { edit(root, '${rel}', (s) => s.replace('a', 'b')); });`
      : `test('runs ${rel}', () => { spawnSync(process.execPath, ['${rel}', '--self-check'], { encoding: 'utf8' }); });`;
  for (let i = 0; i < testFiles; i++) {
    // commentsOnly reproduces this fixture's ORIGINAL behaviour, kept so the fix
    // that removed it has a failing case of its own.
    if (commentsOnly) {
      writeFileSync(join(t, `t${i}.test.mjs`), `// ${covered.join('\n// ')}\n`);
      continue;
    }
    // hollow leaves file 0 present but declaring nothing — the ratchet would
    // otherwise record a floor of zero for a file that asserts zero.
    if (hollow && i === 0) {
      writeFileSync(join(t, `t${i}.test.mjs`), `// ${covered.join('\n// ')}\n`);
      continue;
    }
    const body = [
      ...covered.map((n) => `test('exercises ${n}', () => { assert.ok('${n}'); });`),
      ...(mentionScripts === false ? [] : scripts.map(scriptLines)),
    ].join('\n');
    writeFileSync(
      join(t, `t${i}.test.mjs`),
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n` +
        `import { spawnSync } from 'node:child_process';\n${body}\n`,
    );
  }

  if (manifest !== undefined) writeFileSync(join(root, MANIFEST_REL), `${JSON.stringify(manifest, null, 2)}\n`);
  return root;
}

/** FOUR compliant guards. Deliberately a small constant with no relationship to
 *  the real tree's size — proving the fixture no longer tracks a floor. */
function compliant(extra = {}, count = 4) {
  const g = {};
  for (let i = 0; i < count; i++) g[`assert-thing-${i}.mjs`] = 'if (x) throw new Error("COVERAGE LOST");\n';
  return { ...g, ...extra };
}

/** FIXTURE MODE — the guard is pointed at a root it was told about. */
const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

/** REAL-REPO MODE — the COPY inside the fixture is invoked with no argument, so
 *  `scanningRealRepo` is true and the limbs that only apply to the real tree
 *  (the git workflow manifest, the ratchet's existence) actually run. */
const runReal = (root) =>
  spawnSync(process.execPath, [join(root, 'tooling', 'ci', 'assert-guard-coverage.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });

/** Make the fixture a real git repo, so `git ls-files -- .github/workflows`
 *  answers, exactly as it does in CI. */
function gitify(root) {
  const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 'fixture@local');
  g('config', 'user.name', 'fixture');
  g('add', '-A');
  g('commit', '-q', '-m', 'fixture');
}

/** A fixture stand-in for a shared module. It carries a real self-check line
 *  rather than the bare marker string, because a comment mentioning the marker
 *  would be exactly the prose-satisfies-a-check pattern these guards exist to
 *  refuse — even in a fixture. */
const SHARED_MODULE = [
  'export const x = 1;',
  "if (x === 0) { console.error('COVERAGE LOST — nothing to reduce'); process.exit(1); }",
  '',
].join('\n');

const readManifest = (root) => JSON.parse(readFileSync(join(root, MANIFEST_REL), 'utf8'));

describe('assert-guard-coverage', () => {
  test('a fully compliant tree passes', () => {
    const r = run(repo(compliant()));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /4 file\(s\) in tooling\/ci, all accounted for: 4 invoked by 1 workflow\(s\), 0 imported by one that is, and 0 recorded not CI-runnable/);
    assert.match(r.stdout, /all named in 3 test file\(s\)/);
  });

  // ── THE INVOCATION IDENTITY — what replaced MIN_GUARDS ────────────────────
  // A floor could only say "not zero-ish"; MIN_GUARDS = 42 against 44 let TWO
  // guards be deleted outright with nothing said, and never covered
  // assert-gate-passed.mjs or record-deployment.mjs at all, because the old
  // cross-check read ci.yml alone and those two are invoked by the deploy
  // workflows. Both directions are checked now, so neither set can shrink alone.
  describe('the invocation identity (replaces MIN_GUARDS)', () => {
    test('a guard a workflow INVOKES but the scan cannot find FAILS, naming it', () => {
      const r = run(repo(compliant(), { invoke: ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs', 'assert-vanished.mjs'] }));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /invoke 1 guard\(s\) this scan did not find: assert-vanished\.mjs/);
    });

    test('a guard NO workflow invokes FAILS, naming it', () => {
      // The half that never existed. A guard nothing runs cannot fail a build:
      // it is covered on paper, inert in practice, and it inflates every count
      // taken over this directory — which is how a floor drifts upward while
      // real coverage stands still.
      const r = run(repo(compliant({ 'assert-orphan.mjs': 'COVERAGE LOST\n' }), { invoke: ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs'] }));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /1 file\(s\) in tooling\/ci are neither invoked by a workflow nor imported by one that is/);
      assert.match(r.stderr, /assert-orphan\.mjs/);
      assert.match(r.stderr, /cannot fail a build/);
    });

    // ── REACHED, not merely INVOKED ────────────────────────────────────────
    // R2 originally read FOUND ⊆ INVOKED and carried a note: "there is no
    // exemption list here on purpose… if a guard ever genuinely needs to exist
    // unrun, the mechanism gets added THEN, with a reason and a failing case of
    // its own." The case arrived one merge later — a shared reduction module
    // five guards IMPORT and no workflow calls. An exemption map would have
    // been the same hand-maintained shape this file deleted its floors to
    // escape, so reachability is DERIVED from the imports instead. These two
    // tests are that mechanism's failing case and its passing one.
    test('a shared module IMPORTED by an invoked guard is reached, and passes', () => {
      const r = run(
        repo(
          {
            ...compliant(),
            // The self-check is IN CODE, not in a comment. It read
            // `// COVERAGE LOST` until 2026-08-17 and passed, because the guard
            // grepped raw prose; when that limb learned to strip comments this
            // fixture went red and was the first thing to say so.
            'assert-thing-0.mjs': "import { x } from './shared-thing.mjs';\nif (!x) throw new Error('COVERAGE LOST');\nconsole.log(x);\n",
            'shared-thing.mjs': SHARED_MODULE,
          },
          { invoke: ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs'] },
        ),
      );
      assert.equal(r.status, 0, r.stderr);
    });

    test('a shared module whose LAST import is deleted becomes unreached and FAILS', () => {
      // Nothing can be added to a list to silence this: the only way to satisfy
      // it is for something a workflow actually runs to import the file. That
      // is exactly the moment the module stops being covered.
      const r = run(
        repo(
          { ...compliant(), 'shared-thing.mjs': 'export const x = 1;\n' },
          { invoke: ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs'] },
        ),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /neither invoked by a workflow nor imported/);
      assert.match(r.stderr, /shared-thing\.mjs/);
    });

    test('an import inside a COMMENT does not make a module reached', () => {
      const r = run(
        repo(
          {
            ...compliant(),
            // ONLY the import is commented out — that is the subject. The
            // self-check stays in CODE so this fixture has exactly ONE fault
            // and the assertions below can name it. When both were comments,
            // the guard failed for two reasons at once and `status === 1` plus
            // a bare filename match could not tell which, so the test would
            // have gone on passing if the reachability limb had been deleted.
            'assert-thing-0.mjs': "// import { x } from './shared-thing.mjs';\nif (0) throw new Error('COVERAGE LOST');\n",
            'shared-thing.mjs': SHARED_MODULE,
          },
          { invoke: ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs'] },
        ),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /neither invoked by a workflow nor imported/);
      assert.match(r.stderr, /shared-thing\.mjs/);
      // The commented-out import must be the ONLY complaint: no guard here is
      // missing a self-check, so if that phrase appears the fixture has drifted
      // and this test is no longer measuring reachability.
      assert.doesNotMatch(r.stderr, /no "COVERAGE LOST" self-check/);
    });

    test('a COMMENTED-OUT invocation does not count as wiring', () => {
      // Otherwise `# - run: node tooling/ci/assert-x.mjs` would satisfy the
      // identity for a guard nothing runs, which is worse than no check.
      const r = run(
        repo(compliant(), {
          workflow:
            'jobs:\n  guards:\n    steps:\n' +
            '      # - run: node tooling/ci/assert-thing-0.mjs\n' +
            '      - run: node tooling/ci/assert-thing-1.mjs\n' +
            '      - run: node tooling/ci/assert-thing-2.mjs\n' +
            '      - run: node tooling/ci/assert-thing-3.mjs\n' +
            '      - run: node tooling/scripts/provision-backend.mjs\n',
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /neither invoked by a workflow nor imported/);
      assert.match(r.stderr, /assert-thing-0\.mjs/);
    });

    test('a workflow invoking a NESTED tooling/ci path FAILS — this scan is flat', () => {
      const r = run(
        repo(compliant(), {
          workflow:
            'jobs:\n  guards:\n    steps:\n' +
            ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs']
              .map((g) => `      - run: node tooling/ci/${g}\n`)
              .join('') +
            '      - run: node tooling/ci/guards/assert-buried.mjs\n' +
            '      - run: node tooling/scripts/provision-backend.mjs\n',
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /invoke a tooling\/ci path this FLAT scan cannot audit/);
      assert.match(r.stderr, /tooling\/ci\/guards\/assert-buried\.mjs/);
    });

    test('no .github/workflows at all is COVERAGE LOST, not a clean pass', () => {
      // The workflows ARE the anchor now. Losing them and passing would be the
      // floors' failure mode with the numbers taken out.
      const r = run(repo(compliant(), { workflow: null }));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.match(r.stderr, /invocation identity ranged over nothing/);
    });

    test('a .mjs moved into a subdirectory of tooling/ci FAILS loudly, naming it', () => {
      // readdirSync(CI) is flat — pre-fix, a "tidy into tooling/ci/guards/"
      // refactor dropped every moved guard from BOTH per-guard checks while the
      // guard printed its intended pass message (triage 2026-07-31).
      const root = repo(compliant());
      const sub = join(root, 'tooling', 'ci', 'guards');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'assert-hidden.mjs'), 'if (x) throw new Error("COVERAGE LOST");\n');
      const r = run(root);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.match(r.stderr, /tooling\/ci\/guards\/assert-hidden\.mjs/);
    });

    // 🔴 THE HEADLINE. This is the case the three hand-ratcheted floors could
    // not satisfy: adding a guard and a test file used to require raising
    // MIN_GUARDS, MIN_TEST_FILES and MIN_TEST_CASES and moving the fixtures in
    // the same commit — a three-line shared mutable every parallel branch wrote
    // to, which collided on PRs #112, #113 and #114 in a single day.
    test('ADDING a guard and a test file passes with NO edit to any floor', () => {
      const r = run(
        repo(compliant({ 'assert-brand-new.mjs': 'if (n === 0) throw new Error("COVERAGE LOST");\n' }), {
          testFiles: 4,
        }),
      );
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /5 file\(s\) in tooling\/ci, all accounted for: 5 invoked by 1 workflow\(s\), 0 imported by one that is, and 0 recorded not CI-runnable/);
      assert.match(r.stdout, /all named in 4 test file\(s\)/);
    });
  });

  // ── THE RATCHET — what replaced MIN_TEST_FILES and MIN_TEST_CASES ─────────
  describe('the per-file ratchet (replaces MIN_TEST_FILES and MIN_TEST_CASES)', () => {
    test('a first run records every test file and passes', () => {
      const root = repo(compliant());
      const r = run(root);
      assert.equal(r.status, 0, r.stderr);
      const m = readManifest(root);
      assert.deepEqual(Object.keys(m).sort(), ['t0.test.mjs', 't1.test.mjs', 't2.test.mjs']);
      assert.ok(m['t0.test.mjs'] > 0);
    });

    test('a recorded test file that is GONE fails, and says a guard lost its failing case', () => {
      // The mutation the old floors missed outright: deleting one test file took
      // 39 → 38 against MIN_TEST_FILES = 37, and any guard it named was usually
      // named by another file too.
      const root = repo(compliant());
      assert.equal(run(root).status, 0);
      unlinkSync(join(root, 'tooling', 'ci', 'test', 't1.test.mjs'));
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /ratchet went BACKWARDS/);
      assert.match(r.stderr, /t1\.test\.mjs — recorded with \d+ test case\(s\) and the file is GONE/);
    });

    test('ONE case deleted from ONE file fails, naming the delta', () => {
      // Strictly stronger than the total ever was: under MIN_TEST_CASES = 1068
      // against 1106, thirty-eight cases could leave one file unremarked.
      const root = repo(compliant(), { manifest: { 't0.test.mjs': 99 } });
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /t0\.test\.mjs — 99 test case\(s\) recorded, 5 found\. 94 case\(s\) left the suite\./);
    });

    test('MORE cases than recorded RISES the ratchet and passes — no hand edit', () => {
      const root = repo(compliant(), { manifest: { 't0.test.mjs': 1 } });
      const r = run(root);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /ratchet raised in/);
      assert.match(r.stdout, /↑ t0\.test\.mjs 1 → 5/);
      assert.equal(readManifest(root)['t0.test.mjs'], 5);
    });

    test('a brand-new test file is recorded automatically, not rejected', () => {
      const root = repo(compliant(), { manifest: { 't0.test.mjs': 5, 't1.test.mjs': 5 } });
      const r = run(root);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\+ t2\.test\.mjs \(5\)/);
      assert.equal(readManifest(root)['t2.test.mjs'], 5);
    });

    test('an unchanged tree does NOT rewrite the manifest — not even byte-identically', () => {
      // Otherwise every run touches a committed file, and a guard that always
      // dirties the tree trains people to `git checkout --` the manifest, which
      // discards real ratchet rises with the noise.
      //
      // 🔴 ASSERT ON mtime, NOT ON CONTENT. Comparing the bytes cannot fail:
      // rewriting the same value produces the same bytes, so the first version
      // of this test stayed green with the write made unconditional. Found by
      // reverting the limb (2026-08-01) — an assertion that cannot fail is
      // worse than none.
      const root = repo(compliant());
      const p = join(root, MANIFEST_REL);
      assert.equal(run(root).status, 0);
      const before = { body: readFileSync(p, 'utf8'), at: statSync(p).mtimeMs };
      assert.equal(run(root).status, 0);
      assert.equal(readFileSync(p, 'utf8'), before.body);
      assert.equal(statSync(p).mtimeMs, before.at, 'a clean run must not touch the manifest at all');
    });

    test('an unparseable manifest is COVERAGE LOST, not an empty ratchet', () => {
      const root = repo(compliant());
      writeFileSync(join(root, MANIFEST_REL), '{ not json');
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.match(r.stderr, /could not be parsed/);
    });

    test('a manifest that is not an object is COVERAGE LOST', () => {
      const root = repo(compliant());
      writeFileSync(join(root, MANIFEST_REL), '[1,2,3]');
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /is not a JSON object/);
    });

    test('a test file that declares NO tests FAILS before the ratchet records a zero', () => {
      const r = run(repo(compliant(), { hollow: true }));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /declare no tests/);
    });

    test('a declaration written INSIDE A STRING is not a test case', () => {
      // ⏱ 2026-08-27. `countCases` was `text.match(/^\s*(test|it)\s*\(/gm)` over
      // the comment-stripped source, and a `test('m1', () {});` sitting at the
      // start of a line INSIDE a quoted Dart or JS fixture is the same bytes as
      // a declaration. Fifty-seven of them were in the floor — guards.test.mjs
      // 431 → 383, money-config.test.mjs 35 → 32, mor-adapters 42 → 40,
      // adapter-capabilities 28 → 26, app-dod 33 → 32, purchase-path 66 → 65.
      //
      // 🔴 AND THIS IS THE DANGEROUS DIRECTION FOR A RATCHET. A floor is a
      // promise that this much coverage exists; a rise is recorded for free and
      // never falls back, so a phantom case is a permanent claim to coverage
      // that nothing runs. The hollow check below is the sharpest form of it: a
      // file whose ONLY declarations are quoted runs nothing at all, and the
      // old counter read it as a working test file.
      const r = run(
        repo(compliant(), {
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { writeFileSync } from 'node:fs';",
              'const FIXTURE = `',
              "test('m1', () => {});",
              "it('m2', () => {});",
              '`;',
              "writeFileSync('generated.test.mjs', FIXTURE);",
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /1 test file\(s\) declare no tests: t9\.test\.mjs/);
    });

    test('a real case after a fixture whose closing backtick is on a COMMENT line still counts', () => {
      // 🔴 THE COMPOSITION, NOT THE COUNTER. `executable()` is a line filter with
      // no notion of strings, so it deletes a `//`-leading line from INSIDE a
      // template literal — and money-config.test.mjs:176-178 is a template whose
      // body is three commented-out lines with the CLOSING BACKTICK on the third.
      // Reduce that file first and the remaining text carries an unpaired
      // backtick, so `codeMask` inverts from there on: fixture bodies read as
      // code and real code reads as string. Measured on the real file —
      // countCases over the reduced text said 19, `node --test` runs 32, and
      // over the raw bytes it says 32.
      //
      // So the counter is handed the RAW file. This fixture is that shape in
      // miniature: reduce it first and the one real declaration below lands
      // inside a string that never closes, the file reads as HOLLOW, and the
      // guard fails. Counting the raw bytes, it is worth exactly 1.
      const r = run(
        repo(compliant(), {
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              'const FIXTURE = `',
              "// this line ends with the fixture's closing backtick`;",
              "test('the only real case in this file', () => { if (!FIXTURE) throw new Error('empty'); });",
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\+ t9\.test\.mjs \(1\)/);
    });

    test('a guard named only inside a COMMENT is not covered', () => {
      // This is what this fixture used to write for every file, and the guard
      // accepted it: `includes()` over raw text cannot tell code from prose.
      const r = run(repo(compliant(), { commentsOnly: true }));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /declare no tests/);
    });
  });

  // ── limbs that only apply to the REAL repository ──────────────────────────
  // Reached by invoking the COPY of the guard inside the fixture with no
  // argument, which is exactly how ci.yml calls it.
  describe('real-repo mode', () => {
    /** Real mode REFUSES to create the ratchet from nothing — that is the point
     *  of it. So a real-mode fixture is seeded by one fixture-mode run first,
     *  exactly as the real repository's manifest was bootstrapped. It also ships
     *  every EXCUSED path, because in real mode that map's own self-check runs
     *  and a fixture that did not model it would fail for a reason unrelated to
     *  the behaviour under test. */
    const seeded = (opts) => {
      const root = repo(compliant(), { real: true, excused: EXCUSED, unrunnable: UNRUNNABLE, ...opts });
      const seed = run(root);
      assert.equal(seed.status, 0, `fixture-mode seed failed: ${seed.stderr}`);
      gitify(root);
      return root;
    };

    test('a git-tracked, workflow-wired fixture passes in real mode', () => {
      const r = runReal(seeded());
      assert.equal(r.status, 0, r.stderr + r.stdout);
    });

    test('the DETECTOR regressed to a basename grep is COVERAGE LOST, not a healthy count', () => {
      // `exercisedBy` is only worth anything while it can still tell a script
      // that is RUN from one that is merely NAMED. Regress it to the
      // `includes(basename)` it replaced — a plausible simplification — and the
      // guard would go back to crediting tooling/e2e/verify_purged.mjs to a test
      // of assert-d1-sql-inventory.mjs, while printing a larger covered count
      // than before. The guard carries an inline canary for exactly that, and
      // this is the canary's failing case: without it, deleting the whole rule
      // costs nothing.
      const r = runReal(
        seeded({
          mutateGuard: (s) => {
            const anchor = 'const exercisedBy = (text, base) => {\n  const mask = codeMask(text);';
            assert.ok(s.includes(anchor), 'the detector moved — this mutation no longer reaches it');
            return s.replace(anchor, `const exercisedBy = (text, base) => {\n  if (text.includes(base)) return 'names it';\n  const mask = codeMask(text);`);
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /no longer distinguishes a script that is RUN from one that is merely NAMED/);
      assert.match(r.stderr, /must be null/);
    });

    // ── NOT_CI_RUNNABLE — R2's one exemption, and the failing cases it owes ──
    //
    // R2 refused an exemption list the first time it was asked, and said why:
    // a hand-maintained list is satisfied by typing in it. The mechanism that
    // landed instead is a CLAIM RE-RUN ON EVERY PASS — the guard is spawned with
    // the argv a runner would have and must refuse. These four cases are the
    // three ways that claim can be false plus the control; without them the map
    // would be exactly the list R2 was right to refuse.
    describe('NOT_CI_RUNNABLE is a claim re-verified, not a name trusted', () => {
      test('the control: unreached guards that REFUSE are accounted for, and PRINTED', () => {
        const r = runReal(seeded());
        assert.equal(r.status, 0, r.stderr + r.stdout);
        // Printed not hidden, with the exit code observed on THIS run — the
        // measurement, not a repeat of the claim.
        assert.match(r.stdout, /recorded NOT CI-RUNNABLE, printed not hidden — each claim RE-RUN just now/);
        assert.match(r.stdout, /exited 2 on this run/);
        assert.match(r.stdout, new RegExp(`${UNRUNNABLE.length} recorded not CI-runnable and re-verified refusing`));
      });

      test('an entry naming a file that is NOT THERE fails — judgement over nothing', () => {
        // The stand-ins are simply not written. This is the shape that made
        // NO_NEGATIVE_TEST_NEEDED grow a self-check: an exemption for something
        // that is not there sits looking considered while covering nothing.
        const r = runReal(seeded({ unrunnable: [] }));
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /NOT_CI_RUNNABLE entr/);
        assert.match(r.stderr, /tooling\/ci no longer holds it/);
      });

      // ⚠️ THESE TWO MUTATE AFTER SEEDING, AND THAT IS NOT A TEST-HARNESS
      // WORKAROUND — IT IS THE REAL SEQUENCE. Limbs (b) and (c) apply wherever
      // the named file is present, fixture root or not, so a tree built already
      // broken cannot even seed its ratchet: the guard refuses it, correctly, on
      // the first run. Both cases are a tree that WAS compliant and then changed,
      // which is exactly how a waiver goes stale in the first place.
      test('an entry for a guard a workflow NOW INVOKES fails as stale', () => {
        // The good-news case, and it must still fail: the guard is covered by
        // being run, so the exemption standing in for that is obsolete. Derived
        // from the same reachability graph R2 uses, so the two cannot disagree.
        const root = seeded();
        assert.equal(runReal(root).status, 0);
        appendFileSync(
          join(root, '.github', 'workflows', 'ci.yml'),
          UNRUNNABLE.map((g) => `      - run: node tooling/ci/${g}\n`).join(''),
        );
        const r = runReal(root);
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /it IS reached now/);
        assert.match(r.stderr, /Delete it/);
      });

      test('an entry whose guard EXITS 0 fails — the claim itself is false', () => {
        // 🔴 THE CASE THE WHOLE MECHANISM EXISTS FOR. A name in a list cannot
        // notice this; only spawning the guard can. Either it is CI-runnable now
        // and must be wired in, or it has grown a vacuous pass — and an
        // exemption would otherwise be hiding exactly the defect this file hunts.
        const root = seeded();
        assert.equal(runReal(root).status, 0);
        for (const g of UNRUNNABLE) writeFileSync(join(root, 'tooling', 'ci', g), UNRUNNABLE_PASSES);
        const r = runReal(root);
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /EXITED 0/);
        assert.match(r.stderr, /vacuous pass/);
      });
    });

    test('a DELETED ratchet manifest is COVERAGE LOST on the real repo', () => {
      const root = seeded();
      assert.equal(runReal(root).status, 0);
      unlinkSync(join(root, MANIFEST_REL));
      const r = runReal(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /coverage-manifest\.json does not exist/);
      assert.match(r.stderr, /resets every/);
    });

    test('an EMPTIED ratchet manifest is COVERAGE LOST — the one reset that would be silent', () => {
      const root = seeded();
      assert.equal(runReal(root).status, 0);
      writeFileSync(join(root, MANIFEST_REL), '{}\n');
      const r = runReal(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /coverage-manifest\.json is empty/);
      assert.match(r.stderr, /deleting the floor, not resetting a cache/);
    });

    test('no git manifest for the workflows is COVERAGE LOST on the real repo', () => {
      // Without it, "did I see every workflow" cannot be answered — and there is
      // deliberately no fallback number left to answer it with.
      const root = repo(compliant(), { real: true });
      const r = runReal(root); // NOT gitified
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /returned no tracked workflow/);
    });

    test('a workflow git TRACKS but the scan never opened is COVERAGE LOST', () => {
      // A workflow that vanishes from the scan takes its guard invocations with
      // it, shrinking the identity's right-hand side without a word.
      const root = repo(compliant(), { real: true });
      writeFileSync(join(root, '.github', 'workflows', 'extra.yml'), 'name: extra\njobs: {}\n');
      gitify(root);
      unlinkSync(join(root, '.github', 'workflows', 'extra.yml'));
      const r = runReal(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /never saw: extra\.yml/);
    });

    test('an excused outside script no workflow invokes is caught on the real repo', () => {
      // NO_NEGATIVE_TEST_NEEDED's own self-check: an exception for something
      // that is not there reports judgement over nothing. Only meaningful in
      // real-repo mode, since the map names this repository's own paths.
      const pass = runReal(seeded());
      assert.equal(pass.status, 0, `every excused script invoked → passes\n${pass.stderr}`);
      assert.match(pass.stdout, new RegExp(`${EXCUSED.length} excused`));

      // Drop the LAST excused path from the workflow: the file is still there,
      // but nothing runs it, so the exception now excuses a subject that is not
      // a subject. (Derived, never pasted — see the note on EXCUSED.)
      const dropped = EXCUSED[EXCUSED.length - 1];
      const root2 = seeded({
        workflow:
          'jobs:\n  guards:\n    steps:\n' +
          ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs', 'assert-guard-coverage.mjs']
            .map((g) => `      - run: node tooling/ci/${g}\n`)
            .join('') +
          '      - run: node tooling/scripts/provision-backend.mjs\n' +
          EXCUSED.slice(0, -1).map((s) => `      - run: node ${s}\n`).join(''),
      });
      const r = runReal(root2);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(
        r.stderr.includes(`${dropped} is excused in NO_NEGATIVE_TEST_NEEDED but no workflow invokes it`),
        r.stderr,
      );
    });
  });

  // ── the two per-guard properties F-10 is actually about ───────────────────
  describe('the per-guard properties', () => {
    test('a guard no test mentions FAILS', () => {
      const r = run(repo(compliant({ 'assert-lonely.mjs': 'COVERAGE LOST\n' }), { mentionAll: false }));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /no test file mentions it/);
    });

    test('a guard named ONLY inside a comment, in an otherwise real test file, is NOT covered', () => {
      // `includes()` over raw text cannot tell code from prose, so a test file
      // could be gutted to its header and still "cover" every guard it names.
      //
      // 🔴 THE commentsOnly CASE DOES NOT COVER THIS LIMB. That fixture makes
      // EVERY file comments-only, so the hollow check fires first and the corpus
      // stripping is never reached — reverting the stripping left the suite
      // green (found 2026-08-01 by reverting it). This case keeps the file's
      // real declarations and moves only the NAME into a comment, which is the
      // shape that actually reaches the limb.
      const names = Object.keys(compliant());
      const root = repo(compliant(), { invoke: [...names, 'assert-comment-only.mjs'] });
      writeFileSync(join(root, 'tooling', 'ci', 'assert-comment-only.mjs'), 'if (n === 0) throw new Error("COVERAGE LOST");\n');
      appendFileSync(join(root, 'tooling', 'ci', 'test', 't0.test.mjs'), '\n// exercises assert-comment-only.mjs\n');
      const r = run(root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /assert-comment-only\.mjs — no test file mentions it/);
    });

    test('a scanning guard with no coverage self-check FAILS', () => {
      const r = run(repo(compliant({ 'assert-blind.mjs': 'console.log("ok, scanned everything");\n' })));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /no "COVERAGE LOST" self-check/);
      // The message must offer the legitimate escape, or people invent a worse one.
      assert.match(r.stderr, /NOT_A_SCANNER with a reason/);
    });

    // ── the marker must be CODE, never prose ──────────────────────────────
    // 🔴 THE DEFECT THESE THREE REPLACE WAS LIVE UNTIL 2026-08-17. The limb was
    // `source.includes('COVERAGE LOST')` over the RAW file, so a guard earned
    // its self-check credit by MENTIONING coverage loss in a comment — the same
    // class as the `grep '"r2_buckets"'` that matched the template comment
    // explaining why there are no r2_buckets. It was not theoretical: THREE real
    // files passed on prose alone (read-identity.mjs, migration-tables.mjs,
    // flutter-stock-assets.mjs), and in each the sentence that earned the pass
    // was the sentence DISCLAIMING the duty — "the caller must report COVERAGE
    // LOST". All three are now in NOT_A_SCANNER, where the prose grep had been
    // quietly keeping them from being noticed as missing.
    test('a guard whose ONLY marker is in a COMMENT is not credited with a self-check', () => {
      const r = run(
        repo(
          compliant({
            'assert-prose.mjs': '// This guard exits COVERAGE LOST when its scan reaches nothing.\nconsole.log("ok, scanned everything");\n',
          }),
        ),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /assert-prose\.mjs — no "COVERAGE LOST" self-check/);
    });

    test('the same marker in a STRING LITERAL does count — that is how a real self-check prints', () => {
      // The other half of the rule, and the one that would break every genuine
      // guard if the stripper ever removed string literals as well as comments.
      const r = run(
        repo(
          compliant({
            'assert-real.mjs': "if (files.length === 0) { console.error('✗ COVERAGE LOST — nothing scanned'); process.exit(1); }\n",
          }),
        ),
      );
      assert.equal(r.status, 0, r.stderr);
    });

    test('a JSDoc block naming the marker does not count either', () => {
      // `/** … */` is the shape the three real files used, so it gets its own
      // case rather than riding on the `//` one.
      const r = run(
        repo(
          compliant({
            'assert-jsdoc.mjs': '/**\n * Callers own the COVERAGE LOST decision — this module only reports what it read.\n */\nexport const read = () => 1;\n',
          }),
        ),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /assert-jsdoc\.mjs — no "COVERAGE LOST" self-check/);
    });

    test('a named non-scanner is exempt, and the exemption is counted out loud', () => {
      const r = run(repo(compliant({ 'assert-gate-passed.mjs': 'const sha = process.argv[2];\n' })));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 exempt with a recorded reason/);
    });

    test('an exempt guard that GROWS a scan loses the exemption', () => {
      // Otherwise an exemption granted once quietly outlives the reason for it.
      const r = run(repo(compliant({ 'record-deployment.mjs': 'if (!ok) throw new Error("COVERAGE LOST");\n' })));
      assert.equal(r.status, 1);
      assert.match(r.stderr, /listed in NOT_A_SCANNER but now contains/);
    });

    test('COVERAGE: a missing tooling/ci is caught rather than reported clean', () => {
      const root = join(TMP, 'bare');
      mkdirSync(root, { recursive: true });
      const r = run(root);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /COVERAGE LOST/);
    });
  });

  // ── [pipeline S-12r] executables OUTSIDE tooling/ci that a workflow runs ─── (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/plans/03-stamper-plan.md after the pipeline harvest was frozen)
  // DERIVED from the workflows now, not a hand-written list. tooling/scripts/
  // provision-backend.mjs — the one command the stamp's printed checklist tells
  // the owner to run — had neither F-10 property purely because it sits one
  // directory outside the set this scan reads. A filing accident was deciding
  // what got covered.
  describe('workflow-invoked executables outside tooling/ci', () => {
    test('one with no negative test FAILS', () => {
      const r = run(repo(compliant(), { mentionScripts: false }));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/scripts\/provision-backend\.mjs — a workflow runs it and no test file EXERCISES it/);
      assert.match(r.stderr, /NO_NEGATIVE_TEST_NEEDED with a reason/);
    });

    test('one a workflow invokes but that does NOT EXIST fails', () => {
      // The self-check on the derived set: CI running a path that is not there
      // fails for a reason nobody reads as coverage loss.
      const r = run(
        repo(compliant(), {
          scripts: [],
          workflow:
            'jobs:\n  guards:\n    steps:\n' +
            ['assert-thing-0.mjs', 'assert-thing-1.mjs', 'assert-thing-2.mjs', 'assert-thing-3.mjs']
              .map((g) => `      - run: node tooling/ci/${g}\n`)
              .join('') +
            '      - run: node tooling/release/submit-nowhere.mjs\n',
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/submit-nowhere\.mjs, which does not exist/);
    });

    test('a NEW workflow-invoked script acquires the requirement automatically', () => {
      // The point of deriving the set: wiring a script into a workflow is what
      // makes it a subject, not somebody remembering a map exists.
      const r = run(
        repo(compliant(), { scripts: ['tooling/scripts/provision-backend.mjs', 'tooling/release/submit-newthing.mjs'], mentionScripts: false }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/submit-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('an EXCUSED script a test file RUNS is counted as covered — and the demotion is printed', () => {
      // Still not a contradiction — see the long comment at that spot in the
      // guard: "the basename appears in the suite" is a weak proxy read as
      // POSITIVE evidence everywhere else, and inverting it for excused scripts
      // made the check fire on this very file, which has to name those paths to
      // model the exemption list at all. What IS new is that the demotion is no
      // longer silent: the entry has stopped being what covers the file, and
      // that is the sentence nobody got for tooling/e2e/verify_purged.mjs.
      const r = run(repo(compliant(), { scripts: [EXCUSED[0]], mentionScripts: true }));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 workflow-invoked script\(s\) outside tooling\/ci also covered, 0 excused/);
      assert.match(r.stdout, /has stopped being what covers the file/);
      assert.ok(r.stdout.includes(`${EXCUSED[0]} — exercised by t0.test.mjs runs it`), r.stdout);
    });

    // ── EXERCISED, NOT MENTIONED — the 2026-08-26 repair and its failing cases ──
    //
    // tooling/e2e/verify_purged.mjs was counted as COVERED because one string in
    // tooling/ci/test/d1-sql-inventory.test.mjs named it: that file EDITS A
    // COMMENT inside it to test a different guard's R4 limb, asserts on that
    // guard's stderr, and would pass unchanged if verify_purged.mjs stopped
    // verifying anything. The credit outranks NO_NEGATIVE_TEST_NEEDED, so the
    // recorded exception silently stopped being what covered the file — the ⬜
    // line that exists to make that gap visible went quiet, and nobody was told.
    test('a script only NAMED by a test of something else is NOT covered', () => {
      const r = run(repo(compliant(), { mentionScripts: 'names-only' }));
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/scripts\/provision-backend\.mjs — a workflow runs it and no test file EXERCISES it/);
      // Attributable in BOTH directions: the guard names the files that name it.
      assert.match(r.stderr, /t0\.test\.mjs, t1\.test\.mjs, t2\.test\.mjs name it without running it/);
      assert.match(r.stderr, /a byte touched and not a behaviour exercised/);
    });

    test('a name-only mention does not outrank a recorded exception', () => {
      // The half that made the real defect SILENT rather than merely wrong. With
      // the credit gone the exemption is primary again, printed with its reason.
      const r = run(repo(compliant(), { scripts: [EXCUSED[0]], mentionScripts: 'names-only' }));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /0 workflow-invoked script\(s\) outside tooling\/ci also covered, 1 excused/);
      assert.ok(r.stdout.includes(EXCUSED[0]), r.stdout);
      assert.doesNotMatch(r.stdout, /has stopped being what covers the file/);
    });

    test('a script IMPORTED by a test file is covered — a module under test is exercised too', () => {
      // ⚠️ THE SUBJECT IS SYNTHETIC ON PURPOSE, and it was a REAL path
      // (`tooling/sites/lastmod.mjs`) until 2026-08-27. `exercisedBy` matches
      // `from '<path>'`, and the path it matches lives INSIDE this fixture's
      // string literal — the matcher has no string context to lose it in.
      // Synthetic names are the tree's idiom for this
      // (`tooling/release/submit-newthing.mjs`, below); the check that keeps it
      // that way is the last test in this describe.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/sites/emit-newthing.mjs'],
          mentionScripts: false,
          files: {
            'tooling/ci/test/t9.test.mjs':
              "import { test } from 'node:test';\nimport { emit } from '../../sites/emit-newthing.mjs';\n" +
              "test('emit() returns a string', () => { emit(); });\n",
          },
          testFiles: 2,
        }),
      );
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 workflow-invoked script\(s\) outside tooling\/ci also covered/);
    });

    test('a path passed as an ARGUMENT to another program is not an execution of it', () => {
      // Position is the whole rule. argv[0] is the thing being run; argv[1] is
      // data handed to something else — which is how a fixture path belonging to
      // one guard shows up inside the spawn of another.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/submit-newthing.mjs'],
          mentionScripts: false,
          files: {
            'tooling/ci/test/t9.test.mjs':
              "import { test } from 'node:test';\nimport { spawnSync } from 'node:child_process';\n" +
              "test('names it as data', () => { spawnSync(process.execPath, ['tooling/ci/assert-thing-0.mjs', 'tooling/release/submit-newthing.mjs']); });\n",
          },
          testFiles: 2,
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/submit-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
      assert.match(r.stderr, /t9\.test\.mjs names it without running it/);
    });

    // ── THE SIX isCode GATES, ONE FAILING CASE EACH ──────────────────────────
    //
    // ⏱ 2026-08-27. `codeMask` landed with its credit identity proven — the
    // guard's own inline canary holds `exercisedBy` to reading a QUOTED import
    // as null. That canary reaches exactly ONE of the six places the mask is
    // consulted: the `inCode()` matcher at the top of `exercisedBy`, which is
    // what the `from '…'` rules go through. The other five ran on every
    // invocation and were gated by nothing anybody could make fail — and a gate
    // with no failing case is a gate that can be deleted for free, which is the
    // state this file exists to refuse.
    //
    // Each fixture below has exactly ONE route to a credit, and it runs through
    // one gate. The bite was PROVEN, not reasoned: that single `isCode` call was
    // neutered to `() => true`, the suite re-run, the test observed failing, the
    // gate restored, and the test observed passing again.
    //
    // The subjects are SYNTHETIC (`…-newthing.mjs`, this tree's idiom) because
    // this file is part of the corpus the real guard reads — see the last test
    // in this describe. And the bodies are READ by the guard, never executed, so
    // a fixture that spawns an identifier it never defines is the subject, not a
    // mistake.
    test('a spawn written INSIDE A STRING is not a spawn', () => {
      // spawnedExecutables' own gate. Without it every quoted `spawnSync(` in
      // the suite — every fixture that shows what a negative test looks like —
      // credits whatever it names.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/g1-newthing.mjs'],
          mentionScripts: false,
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              `const SNIPPET = "spawnSync(process.execPath, ['tooling/release/g1-newthing.mjs'])";`,
              "test('quotes a spawn it never makes', () => { if (!SNIPPET) throw new Error('empty'); });",
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/g1-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('an identifier bound to the path INSIDE A STRING does not bind', () => {
      // The `const X = '…/subject.mjs';` rule, which exists so that a spawn of a
      // bare identifier can still be credited. A test that WRITES that
      // declaration into a generated file is the shape that abuses it: the
      // binding is in the file under construction, not in this one.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/g3-newthing.mjs'],
          mentionScripts: false,
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              "import { spawnSync } from 'node:child_process';",
              "import { writeFileSync } from 'node:fs';",
              "test('binds the path only inside the file it writes', () => {",
              `  writeFileSync('generated.mjs', "const SCRIPT = 'tooling/release/g3-newthing.mjs';");`,
              "  spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });",
              '});',
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/g3-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('a runner DEFINED inside a string is not a runner', () => {
      // The runner rule lets `runGuard('…')` count, because the spawn is one
      // indirection away. `invoke()` below is this fixture's REAL runner and
      // nothing calls it; `runGuard` exists only as quoted text, and the call to
      // it must therefore credit nothing. Without the gate the quoted
      // definition registers — its parameter list closes inside the literal, and
      // the real spawn on the next line is what completes the registration.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/g4-newthing.mjs'],
          mentionScripts: false,
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              "import { spawnSync } from 'node:child_process';",
              `const GENERATED = "const runGuard = (guard) => spawnSync(process.execPath, [guard]);";`,
              "const invoke = (guard) => spawnSync(process.execPath, [guard], { encoding: 'utf8' });",
              "test('calls a runner only a fixture string defines', () => {",
              "  if (!GENERATED) throw new Error('empty');",
              "  runGuard('tooling/release/g4-newthing.mjs');",
              '});',
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/g4-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('a quoted spawn inside a helper does not make the helper a runner', () => {
      // The one gate whose `isCode` is OFFSET-SHIFTED — the scan runs over a
      // slice starting mid-file, so the mask has to be consulted at `at + i`.
      // An off-by-anything here reads the wrong bytes and still returns a
      // boolean, which is the failure mode that leaves no trace. `runGuard`
      // spawns nothing; only the string in its body looks like it does.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/g5-newthing.mjs'],
          mentionScripts: false,
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              'const runGuard = (guard) => {',
              `  const SNIPPET = "spawnSync(process.execPath, [guard])";`,
              '  return SNIPPET.length;',
              '};',
              "test('quotes the spawn that would make it a runner', () => { runGuard('tooling/release/g5-newthing.mjs'); });",
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/g5-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('a runner CALL written inside a string is not a call', () => {
      // The last gate: `runGuard` is a genuine runner here and the file really
      // does call it — on something else. The call that names the subject is
      // quoted text. This is the shape a test of a code generator has, and
      // without the gate the generator's OUTPUT credits its input.
      const r = run(
        repo(compliant(), {
          scripts: ['tooling/release/g6-newthing.mjs'],
          mentionScripts: false,
          testFiles: 2,
          files: {
            'tooling/ci/test/t9.test.mjs': [
              "import { test } from 'node:test';",
              "import { spawnSync } from 'node:child_process';",
              "const runGuard = (guard) => spawnSync(process.execPath, [guard], { encoding: 'utf8' });",
              `const SNIPPET = "runGuard('tooling/release/g6-newthing.mjs')";`,
              "test('quotes the call it never makes', () => {",
              "  if (!SNIPPET) throw new Error('empty');",
              "  runGuard('tooling/ci/assert-thing-0.mjs');",
              '});',
              '',
            ].join('\n'),
          },
        }),
      );
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /tooling\/release\/g6-newthing\.mjs — a workflow runs it and no test file EXERCISES it/);
    });

    test('the passing line reports how many outside scripts were covered and excused', () => {
      const r = run(repo(compliant()));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /1 workflow-invoked script\(s\) outside tooling\/ci also covered, 0 excused/);
    });

    // ── THIS FILE'S OWN FIXTURES, ASKED OF THE REAL GUARD ─────────────────────
    //
    // 🔴 THE FIXTURES ABOVE ARE PART OF THE CORPUS THE GUARD READS, so this file
    // is held to crediting NOTHING it does not actually run.
    //
    // ⏱ APPENDED 2026-08-27 — until today a fixture body that spelled a real
    // workflow-invoked script's path inside a string literal DID credit this
    // file: `exercisedBy` matched `from '<path>'` wherever it fell. The guard's
    // `codeMask` now asks where each match STARTS, so an import written inside a
    // literal is no longer an import. Blanking the literal instead — composing
    // `stripStringLiterals` onto the matcher — would have deleted every genuine
    // credit with it, because the path in a real import lives inside the literal
    // too; only the OFFSETS come from the mask. The fixture-naming discipline
    // below is still worth keeping, but it is no longer the only thing holding.
    test('🔴 this file must credit NONE', () => {
      const subjects = WORKFLOW_INVOKED_OUTSIDE.filter((rel) => !EXCUSED.includes(rel));
      assert.ok(subjects.length > 3, `derived only ${subjects.length} outside scripts — the derivation stopped reaching them`);
      const SELF = readFileSync(fileURLToPath(import.meta.url), 'utf8');
      const uncovered = (rel) => `${rel} — a workflow runs it and no test file EXERCISES it`;
      const askGuard = (t9) =>
        run(
          repo(compliant(), {
            scripts: subjects,
            mentionScripts: false,
            files: { 'tooling/ci/test/t9.test.mjs': t9 },
            testFiles: 2,
          }),
        );

      // 🔴 POSITIVE CONTROL, AND IT RUNS FIRST. The assertion below is a
      // NEGATIVE one, so it also passes over a fixture this file never reached:
      // measured 2026-08-27, swapping SELF for a placeholder body left it GREEN
      // while this file carried `from '…/ops/status.mjs'` in executable code.
      // Same repo, same subjects, same slot, plus ONE exercising line naming
      // `probe` — derived, never written out here — SPLICED IN AT A LINE OF THIS
      // FILE'S OWN CODE, so a body that is not this file cannot receive it and
      // cannot then credit `probe`. `subjects[1]` keeps the control itself from
      // passing on a guard that crashed and printed no verdict at all.
      //
      // ⏱ APPENDED 2026-08-27 — the spliced line was `const PROBE = "import p
      // from './…';";` until today: an import INSIDE A STRING, so the control was
      // built out of the very defect the guard now rejects, and closing the hole
      // would have turned this control red. It is a bare import STATEMENT now —
      // what a test that really imports a script writes — so the control proves
      // the same thing without depending on the bug.
      const probe = subjects[0];
      const ANCHOR = "const MANIFEST_REL = join('tooling', 'ci', 'test', 'coverage-manifest.json');";
      assert.ok(SELF.includes(ANCHOR), 'ANCHOR is no longer a line of this file — the control below would splice nothing');
      const seeded = askGuard(SELF.replace(ANCHOR, `${ANCHOR}\nimport probeModule from './${probe}';`));
      assert.ok(
        seeded.stderr.includes(uncovered(subjects[1])),
        `the control fixture did not produce a verdict — the guard never reported ${subjects[1]}. ${seeded.stderr || seeded.stdout}`,
      );
      assert.ok(
        !seeded.stderr.includes(uncovered(probe)),
        `an exercising line naming ${probe} spliced into the t9 body did NOT credit it, so t9 is not carrying ` +
          "this file's bytes. The assertion below then holds over bytes the guard never read.",
      );

      const r = askGuard(SELF);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /guard coverage — \d+ problem\(s\)/);
      const credited = subjects.filter((rel) => !r.stderr.includes(uncovered(rel)));
      assert.deepEqual(
        credited,
        [],
        `the guard reads this file as EXERCISING ${credited.join(', ')}. A fixture body names it, and a name ` +
          'inside a fixture string is a byte written, not a behaviour run. Rename the fixture subject to a ' +
          'synthetic path — tooling/release/submit-newthing.mjs is the tree\'s idiom for one.',
      );
    });
  });
});
