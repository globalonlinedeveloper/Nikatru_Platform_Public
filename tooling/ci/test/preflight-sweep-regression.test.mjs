// ─────────────────────────────────────────────────────────────────────────────
// preflight-sweep-regression.test.mjs — preflight's guard-sweep leg must FAIL on
// a red the branch caused, and only print a red that main has too.
//
// 🔴 THE DEFECT THIS PINS, MEASURED 2026-09-19. PR #818 went red in CI on
// "Guards — the guards can still fail": `node tooling/ci/assert-walks-bounded.mjs`
// exited 1 on a new `readdirSync` in assert-ungraded-baseline-doc.mjs. Locally,
// `preflight.mjs --fast` exited 0 on the same tree, because guard-sweep.mjs
// reports a RED guard and exits 0 (it asserts completeness, not greenness) and
// the leg read only that exit code. Some guards ARE red on a developer machine
// for environmental reasons, so "fail on any red" is not the fix either; the
// leg now re-runs each red at merge-base(HEAD, origin/main) and classifies it.
//
// The classifier is tested as a pure function. The re-run is tested against a
// REAL throwaway git repository — a real merge-base, a real `git worktree add`,
// real guard processes — never against a mocked git, because the properties
// that matter (the base checkout exists, the guard runs INSIDE it, the checkout
// is gone afterwards) are properties of git, not of this code.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRed, newOutputLines, rerunRedsOnBase, sweepLeg } from '../../scripts/preflight.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SWEEP = join(REPO, 'tooling', 'scripts', 'guard-sweep.mjs');

describe('classifyRed — the verdict on one red guard', () => {
  test('green at the base, red here = REGRESSION', () => {
    assert.equal(classifyRed({ status: 1 }, { evaluable: true, status: 0 }).kind, 'REGRESSION');
  });
  test('red at the base with the SAME exit code = ENVIRONMENTAL', () => {
    assert.equal(classifyRed({ status: 2 }, { evaluable: true, status: 2 }).kind, 'ENVIRONMENTAL');
  });
  test('red at the base with a DIFFERENT exit code = REGRESSION (the branch changed what it reports)', () => {
    const v = classifyRed({ status: 1 }, { evaluable: true, status: 2 });
    assert.equal(v.kind, 'REGRESSION');
    assert.match(v.why, /exits 2 there and 1 here/);
  });
  test('a base that could not answer = COVERAGE-LOST, carrying its reason', () => {
    const v = classifyRed({ status: 1 }, { evaluable: false, reason: 'the guard does not exist at the base' });
    assert.equal(v.kind, 'COVERAGE-LOST');
    assert.match(v.why, /does not exist at the base/);
  });
  test('no base at all = COVERAGE-LOST, never a pass', () => {
    assert.equal(classifyRed({ status: 1 }, undefined).kind, 'COVERAGE-LOST');
  });
  test('no exit code here (a timeout) = COVERAGE-LOST even when the base is green', () => {
    assert.equal(classifyRed({ status: null }, { evaluable: true, status: 0 }).kind, 'COVERAGE-LOST');
  });
});

describe('newOutputLines — a new finding hiding inside an environmental red', () => {
  test('lines differing only by the tree root are the same line', () => {
    const fresh = newOutputLines('✗ C:/b/x.mjs bad\n✗ C:/b/y.mjs NEW', '✗ D:/base/x.mjs bad', 'C:/b', 'D:/base');
    assert.deepEqual(fresh, ['✗ <root>/y.mjs NEW']);
  });
});

// ── a real repository with a real merge-base ────────────────────────────────
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=preflight-test', '-c', 'user.email=preflight-test@example.invalid', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
};
/** Run a guard in the BRANCH tree the way guard-sweep does, and return the row
 *  guard-sweep --json would write for it. */
const sweepRow = (root, name, args = []) => {
  const r = spawnSync(process.execPath, [join(root, 'tooling', 'ci', name), ...args], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  const head = out.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return {
    name, verdict: `RED(${r.status})`, red: r.status !== 0, status: r.status, treeScanner: false,
    tried: [{ args, flags: [], status: r.status, head, tail: head }], out,
  };
};
const writeSweep = (rows) => (jsonPath) => {
  writeFileSync(jsonPath, JSON.stringify({ schema: 'guard-sweep/1', rows }), 'utf8');
  return { status: 0, out: 'sweep output' };
};

describe('rerunRedsOnBase + sweepLeg — against a real git merge-base', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'preflight-regression-'));
    git(root, 'init', '-q', '-b', 'main');
    // subject-guard reads a file the branch will break: the PR #818 shape.
    put(root, 'tooling/ci/subject-guard.mjs',
      "import { readFileSync } from 'node:fs';\n" +
      "const s = readFileSync(new URL('../../subject.txt', import.meta.url), 'utf8');\n" +
      "if (s.includes('BAD')) { console.log('✗ subject.txt carries BAD'); process.exit(1); }\n" +
      "console.log('ok subject'); process.exit(0);\n");
    // env-guard is red everywhere on this machine: the assert-ops-register shape.
    put(root, 'tooling/ci/env-guard.mjs', "console.log('✗ COVERAGE LOST — no token in the environment'); process.exit(2);\n");
    // arg-guard takes a path argument; the branch adds that path.
    put(root, 'tooling/ci/arg-guard.mjs', "console.log('✗ arg-guard red'); process.exit(1);\n");
    put(root, 'subject.txt', 'good\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'checkout', '-q', '-b', 'feature');
    put(root, 'subject.txt', 'BAD\n');
    put(root, 'tooling/ci/new-guard.mjs', "console.log('✗ new guard red'); process.exit(1);\n");
    put(root, 'fixtures/only-on-branch/x.txt', 'x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'branch');
  });
  after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  test('the four verdicts, each for its real reason', () => {
    const reds = [
      sweepRow(root, 'subject-guard.mjs'),
      sweepRow(root, 'env-guard.mjs'),
      sweepRow(root, 'new-guard.mjs'),
      sweepRow(root, 'arg-guard.mjs', ['fixtures/only-on-branch']),
    ];
    // The control: every one of them IS red on the branch, or the cases below
    // would be classifying nothing.
    assert.deepEqual(reds.map((r) => r.status), [1, 2, 1, 1]);
    const cmp = rerunRedsOnBase(reds, { root, baseRef: 'main' });
    assert.equal(cmp.error, null);
    assert.match(cmp.sha, /^[0-9a-f]{40}$/);
    const kinds = Object.fromEntries(cmp.results.map(({ row, base }) => [row.name, classifyRed({ status: row.status }, base).kind]));
    assert.deepEqual(kinds, {
      'subject-guard.mjs': 'REGRESSION',
      'env-guard.mjs': 'ENVIRONMENTAL',
      'new-guard.mjs': 'COVERAGE-LOST',
      'arg-guard.mjs': 'COVERAGE-LOST',
    });
    // The base verdict came from a process that ran IN the base checkout.
    assert.equal(cmp.results[0].base.head, 'ok subject');
  });

  test('the base checkout is removed afterwards, and no worktree is left registered', () => {
    rerunRedsOnBase([sweepRow(root, 'subject-guard.mjs')], { root, baseRef: 'main' });
    const list = git(root, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree '));
    assert.equal(list.length, 1, `expected only the main checkout, got:\n${list.join('\n')}`);
    const wt = join(root, '.worktrees');
    const left = existsSync(wt) ? spawnSync('git', ['status', '--porcelain', '--ignored', '.worktrees'], { cwd: root, encoding: 'utf8' }).stdout.trim() : '';
    assert.equal(left, '', `a base checkout was left behind: ${left}`);
  });

  test('sweepLeg FAILS on a regression and names the guard and its first output line', () => {
    const r = sweepLeg({ root, baseRef: 'main', sweep: writeSweep([sweepRow(root, 'subject-guard.mjs'), sweepRow(root, 'env-guard.mjs')]) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /✗ REGRESSION\s+subject-guard\.mjs .*subject\.txt carries BAD/);
    assert.match(r.out, /⬜ ENVIRONMENTAL env-guard\.mjs/);
  });

  test('sweepLeg PASSES when every red is main\'s too — the environmental reds are printed, not failed', () => {
    const r = sweepLeg({ root, baseRef: 'main', sweep: writeSweep([sweepRow(root, 'env-guard.mjs')]) });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 environmental · 0 coverage lost/);
  });

  test('sweepLeg REFUSES when the sweep wrote no --json — it never falls back to the exit code', () => {
    const r = sweepLeg({ root, baseRef: 'main', sweep: () => ({ status: 0, out: 'sweep output' }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — the sweep wrote no readable --json output/);
  });

  test('an unresolvable base ref is COVERAGE LOST for every red, and fails the leg', () => {
    const r = sweepLeg({ root, baseRef: 'no-such-ref', sweep: writeSweep([sweepRow(root, 'env-guard.mjs')]) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — `git merge-base HEAD no-such-ref` gave no commit/);
  });
});

describe('guard-sweep --json — the machine-readable copy', () => {
  test('--scan-only --json writes one row per file and keeps the exit code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-json-'));
    try {
      const out = join(dir, 's.json');
      const r = spawnSync(process.execPath, [SWEEP, '--scan-only', '--json', out], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-600));
      const doc = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(doc.schema, 'guard-sweep/1');
      assert.ok(doc.files > 100, `the sweep domain shrank to ${doc.files}`);
      assert.equal(doc.rows.length, doc.files);
      assert.ok(doc.rows.every((row) => typeof row.name === 'string' && typeof row.verdict === 'string' && Array.isArray(row.tried)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json with no path REFUSES (exit 2) instead of eating the next argument', () => {
    const r = spawnSync(process.execPath, [SWEEP, '--scan-only', '--json'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--json needs a file path/);
  });
});
