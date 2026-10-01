// ─────────────────────────────────────────────────────────────────────────────
// hook-own-tree.test.mjs — a hook invoked from a lane worktree runs THAT
// worktree's guards, never the main checkout's (⏱ 2026-10-01, #1097 review
// minor 6).
//
// THE DEFECT. Both hooks find everything they run from `$0`:
// `<hooks dir>/../tooling/scripts/spec-guards.mjs`, and beside it
// affected-guards.mjs and preflight.mjs. When core.hooksPath resolves to the MAIN
// checkout's .githooks/ — an absolute value, which worktrees share because they
// share one config — a commit or push in `.worktrees/<lane>` ran the main
// checkout's OLD tooling, and "hooks green" was a verdict about main's guards,
// not this branch's. The fix: the hook asks `git rev-parse --show-toplevel`
// which tree it was invoked in and hands over, once, to that tree's own copy.
//
// ⚠️ THE FIXTURE IS A REAL REPOSITORY, A REAL `git worktree add` AND A REAL
// `git commit` / `git push`, so git itself resolves core.hooksPath — a hook run
// by hand would not exercise the resolution the defect lives in. The tooling is
// STUBS that print which tree they belong to; the hooks are the REAL files.
//
// 🔴 THE RED CONTROL IS IN THIS FILE: the same hooks with the hand-over block
// cut out must run the MAIN checkout's stub, or this file could not tell the
// fix from its absence.
//
// Run:  node --test tooling/ci/test/hook-own-tree.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOKS = ['pre-commit', 'pre-push'];
const BLOCK_START = "# ── THIS checkout's hook, never another tree's";
const BLOCK_END = '# ── Self-advance: the pinned runner moves to origin/main BEFORE it runs';

/** process.env minus every GIT_* variable: run from inside a hook, an exported
 *  GIT_DIR would point every fixture command at the repository being committed. */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const ok = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.code, 0, `fixture setup failed: git ${args.join(' ')} -> ${r.code}\n${r.out}`);
  return r.out;
};

/** The hook text with the hand-over block cut out — the shape before the fix. */
function withoutHandOver(text) {
  const a = text.indexOf(BLOCK_START);
  const b = text.indexOf(BLOCK_END);
  assert.ok(a > 0 && b > a, 'the hand-over block moved — this red control no longer reaches it');
  return text.slice(0, a) + text.slice(b);
}

/** A stub that prints which tree it is, then exits 0. */
const stub = (tag, what) => `console.log('STUB ${what} tree=${tag}'); process.exit(0);\n`;

/** Lay down one tree's hooks and stub tooling, every stub labelled `tag`. */
function writeTree(root, tag, hookText) {
  mkdirSync(join(root, '.githooks'), { recursive: true });
  for (const h of HOOKS) writeFileSync(join(root, '.githooks', h), hookText(h), { mode: 0o755 });
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  for (const what of ['spec-guards', 'affected-guards', 'preflight']) {
    writeFileSync(join(root, 'tooling', 'scripts', `${what}.mjs`), stub(tag, what));
  }
}

/**
 * main + a bare remote + a lane worktree beside them, core.hooksPath ABSOLUTE to
 * main's .githooks/. The lane's tooling is relabelled `lane` and committed there.
 */
function fixture(hookText) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hook-own-tree-')));
  const main = join(base, 'main');
  const lane = join(base, '.worktrees', 'lane-x');
  const remote = join(base, 'remote.git');
  mkdirSync(main);
  ok(main, 'init', '-q', '-b', 'main');
  ok(main, 'config', 'user.email', 'fixture@local');
  ok(main, 'config', 'user.name', 'fixture');
  writeTree(main, 'main', hookText);
  ok(main, 'add', '-A');
  ok(main, 'commit', '-q', '--no-verify', '-m', 'main');
  ok(base, 'init', '-q', '--bare', remote);
  ok(main, 'remote', 'add', 'origin', remote);
  ok(main, 'config', 'core.hooksPath', join(main, '.githooks'));
  mkdirSync(dirname(lane), { recursive: true });
  ok(main, 'worktree', 'add', '-q', '-b', 'lane-x', lane);
  writeTree(lane, 'lane', hookText);
  return { base, main, lane };
}

const HOOK_TEXT = (h) => readFileSync(join(REPO, '.githooks', h), 'utf8');
const OLD_HOOK_TEXT = (h) => withoutHandOver(HOOK_TEXT(h));

describe('a hook runs the guards of the tree it was invoked in', () => {
  test('GREEN: a commit in a lane worktree runs the LANE\'s spec guards, not main\'s', () => {
    const { base, lane } = fixture(HOOK_TEXT);
    try {
      writeFileSync(join(lane, 'change.txt'), 'x\n');
      ok(lane, 'add', '-A');
      const r = git(lane, 'commit', '-q', '-m', 'lane change');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /STUB spec-guards tree=lane/);
      assert.doesNotMatch(r.out, /tree=main/);
      assert.match(r.out, /pre-commit: this hook is .*outside the tree git invoked it in; running .*lane-x\/\.githooks\/pre-commit instead/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('GREEN: a push from a lane worktree runs the LANE\'s spec guards, affected checks and smoke', () => {
    const { base, lane } = fixture(HOOK_TEXT);
    try {
      writeFileSync(join(lane, 'change.txt'), 'x\n');
      ok(lane, 'add', '-A');
      ok(lane, 'commit', '-q', '--no-verify', '-m', 'lane change');
      const r = git(lane, 'push', '-q', 'origin', 'lane-x');
      assert.equal(r.code, 0, r.out);
      for (const what of ['spec-guards', 'affected-guards', 'preflight']) {
        assert.match(r.out, new RegExp(`STUB ${what} tree=lane`), `${what} did not run from the lane:\n${r.out}`);
      }
      assert.doesNotMatch(r.out, /tree=main/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('GREEN: the main checkout itself keeps its own hook — no hand-over, no message', () => {
    const { base, main } = fixture(HOOK_TEXT);
    try {
      writeFileSync(join(main, 'change.txt'), 'x\n');
      ok(main, 'add', '-A');
      const r = git(main, 'commit', '-q', '-m', 'main change');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /STUB spec-guards tree=main/);
      assert.doesNotMatch(r.out, /outside the tree git invoked it in/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('GREEN: a tree with no spec-guards.mjs of its own (the corpus shape) keeps the hook it was given', () => {
    const { base, main } = fixture(HOOK_TEXT);
    const corpus = join(base, 'corpus');
    try {
      mkdirSync(corpus);
      ok(corpus, 'init', '-q');
      ok(corpus, 'config', 'user.email', 'fixture@local');
      ok(corpus, 'config', 'user.name', 'fixture');
      ok(corpus, 'config', 'core.hooksPath', join(main, '.githooks'));
      writeFileSync(join(corpus, 'note.md'), 'x\n');
      ok(corpus, 'add', '-A');
      const r = git(corpus, 'commit', '-q', '-m', 'corpus change');
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /STUB spec-guards tree=main/);
      assert.doesNotMatch(r.out, /outside the tree git invoked it in/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('🔴 RED CONTROL: without the hand-over, the lane\'s commit and push run MAIN\'s stale tooling', () => {
    const { base, lane } = fixture(OLD_HOOK_TEXT);
    try {
      writeFileSync(join(lane, 'change.txt'), 'x\n');
      ok(lane, 'add', '-A');
      const c = git(lane, 'commit', '-q', '-m', 'lane change');
      assert.equal(c.code, 0, c.out);
      assert.match(c.out, /STUB spec-guards tree=main/);
      const p = git(lane, 'push', '-q', 'origin', 'lane-x');
      assert.equal(p.code, 0, p.out);
      assert.match(p.out, /STUB affected-guards tree=main/);
      assert.doesNotMatch(`${c.out}${p.out}`, /tree=lane/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
