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
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-guard-coverage.mjs');

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
 * @param guards  map of filename -> source text
 * @param tests   number of test files that mention every guard (0 = mention none)
 * ⚠️ testFiles defaults to 32 because MIN_TEST_FILES ratcheted 4 → 25 → 26 → 29 → 31
 * → 32 (2026-07-31, four times on 2026-08-01) — a fixture below the floor would make
 * every green case here red for a reason that has nothing to do with the behaviour
 * under test. Ratchet the floor and this default together, always.
 * ⚠️ The last of those ratchets was a MERGE: two branches each ratcheted honestly to
 * 31, and the merged tree has 34 test files. Neither branch's number was wrong and
 * neither was right — re-measure after a merge rather than taking the higher one.
 * `files` writes extra files at the fixture root (e.g. a ci.yml manifest).
 */
function repo(guards, { testFiles = 32, mentionAll = true, hollow = false, commentsOnly = false, files = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  const ci = join(root, 'tooling', 'ci');
  const t = join(ci, 'test');
  mkdirSync(t, { recursive: true });
  for (const [name, src] of Object.entries(guards)) writeFileSync(join(ci, name), src);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  // ⚠️ These must be REAL test declarations, not comments. This fixture used to
  // write `// <guard-name>` and pass — encoding the same blind spot the guard
  // itself had, so neither could see that a hollowed-out test file covers
  // nothing. Found 2026-07-27 while closing F-10.
  const covered = mentionAll ? Object.keys(guards) : ['nothing-real.mjs'];
  for (let i = 0; i < testFiles; i++) {
    // commentsOnly reproduces this fixture's ORIGINAL behaviour, kept so the fix
    // that removed it has a failing case of its own.
    if (commentsOnly) {
      writeFileSync(join(t, `t${i}.test.mjs`), `// ${covered.join('\n// ')}\n`);
      continue;
    }
    // hollow leaves file 0 present but declaring nothing — it still counts
    // toward MIN_TEST_FILES while asserting exactly zero.
    if (hollow && i === 0) {
      writeFileSync(join(t, `t${i}.test.mjs`), `// ${covered.join('\n// ')}\n`);
      continue;
    }
    const body = covered.map((n) => `test('exercises ${n}', () => { assert.ok('${n}'); });`).join('\n');
    writeFileSync(
      join(t, `t${i}.test.mjs`),
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${body}\n`,
    );
  }
  return root;
}

/** 38 compliant guards — enough to clear the floor (ratcheted 15 → 35 → 36 → 38,
 *  2026-07-31, then twice on 2026-08-01 — the second with assert-store-metadata.mjs. */
function compliant(extra = {}, count = 38) {
  const g = {};
  for (let i = 0; i < count; i++) g[`assert-thing-${i}.mjs`] = 'if (x) throw new Error("COVERAGE LOST");\n';
  return { ...g, ...extra };
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

describe('assert-guard-coverage', () => {
  test('a fully compliant tree passes', () => {
    const r = run(repo(compliant()));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /38 guard\(s\), all named in 32 test file\(s\)/);
  });

  test('a guard no test mentions FAILS', () => {
    const r = run(repo(compliant({ 'assert-lonely.mjs': 'COVERAGE LOST\n' }), { mentionAll: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no test file mentions it/);
  });

  test('a scanning guard with no coverage self-check FAILS', () => {
    const r = run(repo(compliant({ 'assert-blind.mjs': 'console.log("ok, scanned everything");\n' })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no "COVERAGE LOST" self-check/);
    // The message must offer the legitimate escape, or people invent a worse one.
    assert.match(r.stderr, /NOT_A_SCANNER with a reason/);
  });

  test('a named non-scanner is exempt, and the exemption is counted out loud', () => {
    const r = run(repo(compliant({ 'assert-gate-passed.mjs': 'const sha = process.argv[2];\n' })));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 exempt with a recorded reason/);
  });

  test('a test file that declares NO tests FAILS', () => {
    // The file is present, so it still satisfies MIN_TEST_FILES — and it runs
    // nothing. Counting files is not counting tests.
    const r = run(repo(compliant(), { hollow: true }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declare no tests/);
  });

  test('a guard named only inside a COMMENT is not covered', () => {
    // This is what this fixture used to write for every file, and the guard
    // accepted it: `includes()` over raw text cannot tell code from prose.
    const r = run(repo(compliant(), { commentsOnly: true }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declare no tests/);
  });

  test('an exempt guard that GROWS a scan loses the exemption', () => {
    // Otherwise an exemption granted once quietly outlives the reason for it.
    const r = run(repo(compliant({ 'record-deployment.mjs': 'if (!ok) throw new Error("COVERAGE LOST");\n' })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /listed in NOT_A_SCANNER but now contains/);
  });

  test('COVERAGE: too few guards is "the scan is broken", not "all clear"', () => {
    const r = run(repo({ 'assert-one.mjs': 'COVERAGE LOST\n' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — found 1 guard\(s\)/);
    assert.match(r.stderr, /reports perfect coverage/);
  });

  test('COVERAGE: too few test files is caught', () => {
    const r = run(repo(compliant(), { testFiles: 1 }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /found 1 test file\(s\)/);
  });

  test('COVERAGE: a missing tooling/ci is caught rather than reported clean', () => {
    const root = join(TMP, 'bare');
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST/);
  });

  test('COVERAGE: ONE guard below the ratcheted floor FAILS — the floor tracks reality, not history', () => {
    // The original floors froze at 15/4/140 while the tree grew to 37/27/533,
    // so 22 guards could vanish from the scan without tripping anything
    // (triage 2026-07-31, mutation-proven). This pins the ratchet: when
    // the tree grows again, ratchet the floor AND this fixture together.
    // Ratcheted to 38 on 2026-08-01 with assert-store-metadata.mjs ([10]D-5).
    const r = run(repo(compliant({}, 37)));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — found 37 guard\(s\)/);
  });

  test('COVERAGE: a .mjs moved into a subdirectory of tooling/ci FAILS loudly, naming it', () => {
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

  test('COVERAGE: a guard ci.yml invokes but the scan cannot find FAILS, naming it', () => {
    // The floors are relationships now: ci.yml is the committed manifest of
    // what CI actually runs, so an invoked guard the scan does not see means
    // the two have diverged — deleting a wired-in guard must not pass clean.
    const r = run(
      repo(compliant(), {
        files: {
          '.github/workflows/ci.yml':
            'jobs:\n  guards:\n    steps:\n' +
            '      - run: node tooling/ci/assert-thing-0.mjs\n' +
            '      - run: node tooling/ci/assert-vanished.mjs\n',
        },
      }),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — ci\.yml invokes 1 guard\(s\)/);
    assert.match(r.stderr, /assert-vanished\.mjs/);
  });

  test('a ci.yml whose invocations are all found passes, and comments do not count as invocations', () => {
    const r = run(
      repo(compliant(), {
        files: {
          '.github/workflows/ci.yml':
            'jobs:\n  guards:\n    steps:\n' +
            '      # was: node tooling/ci/assert-retired.mjs\n' +
            '      - run: node tooling/ci/assert-thing-0.mjs\n' +
            '      - run: node --test "tooling/ci/test/*.test.mjs"\n',
        },
      }),
    );
    assert.equal(r.status, 0, r.stderr);
  });
});
