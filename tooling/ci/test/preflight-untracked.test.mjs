// ─────────────────────────────────────────────────────────────────────────────
// preflight-untracked.test.mjs — preflight's FIRST leg must refuse a tree with
// untracked files, because CI judges the committed tree and the index-reading
// guards here do not see an untracked file at all.
//
// 🔴 THE DEFECT THIS PINS, MEASURED TWICE ON 2026-09-19. A helper ran
// `preflight --fast` with NEW files untracked and it went green:
//   PR #819        assert-mechanism-claims reads `git ls-files`; the new test
//                  file's claim sentence was never read locally. CI failed.
//   PR #824, #825  gen-start-here.mjs --check counts from `git ls-files
//                  --cached`; CI run 35449581752 failed "START-HERE.md differs
//                  from what the tree generates" on the files it had committed.
// The fix is `git add -N` (intent-to-add): the path enters the index with no
// content staged, and `git ls-files --cached` — what both readers use — lists it.
//
// Tested against REAL throwaway git repositories, never a mocked git: "is this
// path untracked, ignored, or intent-to-add" is a property of git.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { untrackedFiles, untrackedLeg } from '../../scripts/preflight.mjs';

const PREFLIGHT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'preflight.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=preflight-test', '-c', 'user.email=preflight-test@example.invalid', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const put = (root, rel, text = 'x\n') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
};
/** A committed repo with a .gitignore, and preflight.mjs itself committed at
 *  tooling/scripts/ so the CLI can be run INSIDE it (ROOT is its own ../..). */
const freshRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-untracked-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, '.gitignore', 'ignored-dir/\n*.log\n');
  put(root, 'tracked.txt');
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  copyFileSync(PREFLIGHT, join(root, 'tooling', 'scripts', 'preflight.mjs'));
  // preflight.mjs imports the one workflow parse (ci-gate's needs, 2026-09-24).
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  for (const f of ['workflow-scan.mjs', 'tree-walk.mjs', 'flutter-release-build.mjs', 'app-set.mjs']) copyFileSync(join(dirname(PREFLIGHT), '..', 'ci', f), join(root, 'tooling', 'ci', f));
  // ⏱ 2026-09-26: workflow-scan.mjs imports the release-build composer and the app set (O-FLUTTER-BUILD-TYPED-PER-LINE)
  mkdirSync(join(root, 'tooling', 'app-yaml'), { recursive: true });
  copyFileSync(join(dirname(PREFLIGHT), '..', 'app-yaml', 'yaml.mjs'), join(root, 'tooling', 'app-yaml', 'yaml.mjs'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
};

describe('untrackedLeg — against a real git index', () => {
  let root;
  before(() => { root = freshRepo(); });
  after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  test('control: a clean committed tree passes', () => {
    const r = untrackedLeg({ root });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(untrackedFiles({ root }).files, []);
  });

  test('an untracked new file FAILS, naming it and the exact `git add -N` fix', () => {
    put(root, 'tooling/ci/test/zz-new.test.mjs');
    const r = untrackedLeg({ root });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /· tooling\/ci\/test\/zz-new\.test\.mjs/);
    assert.match(r.out, /git add -N tooling\/ci\/test\/zz-new\.test\.mjs$/m);
  });

  test('after `git add -N` it PASSES — and `git ls-files --cached` (what the index readers use) lists it', () => {
    assert.ok(!git(root, 'ls-files', '--cached').split(/\r?\n/).includes('tooling/ci/test/zz-new.test.mjs'), 'control: not in the index before');
    git(root, 'add', '-N', 'tooling/ci/test/zz-new.test.mjs');
    assert.ok(git(root, 'ls-files', '--cached').split(/\r?\n/).includes('tooling/ci/test/zz-new.test.mjs'));
    // intent-to-add stages no content: the staged diff is empty.
    assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), '');
    const r = untrackedLeg({ root });
    assert.equal(r.code, 0, r.out);
  });

  test('an ignored file or directory PASSES — .gitignore is the declared way out', () => {
    put(root, 'ignored-dir/a.txt');
    put(root, 'run.log');
    assert.equal(untrackedLeg({ root }).code, 0);
  });

  test('.worktrees/ is skipped by name — it is not gitignored and holds other checkouts', () => {
    const wt = join(root, '.worktrees', 'other');
    mkdirSync(wt, { recursive: true });
    git(wt, 'init', '-q');
    put(root, '.worktrees/other/file.txt');
    put(root, '.worktrees/loose.txt');
    // control: git DOES list them, so the skip is doing the work
    const raw = git(root, 'ls-files', '--others', '--exclude-standard');
    assert.match(raw, /^\.worktrees\//m);
    assert.deepEqual(untrackedFiles({ root }).files, []);
    assert.equal(untrackedLeg({ root }).code, 0);
  });

  test('an embedded repository elsewhere is FAILED but never offered to `git add -N`', () => {
    const nested = join(root, 'vendor', 'nested');
    mkdirSync(nested, { recursive: true });
    git(nested, 'init', '-q');
    put(root, 'vendor/nested/f.txt');
    const r = untrackedLeg({ root });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /· vendor\/nested\/ .*embedded git repository/);
    assert.doesNotMatch(r.out, /git add -N/);
    rmSync(join(root, 'vendor'), { recursive: true, force: true });
  });

  test('a path with a space is quoted in the fix line', () => {
    put(root, 'docs/a b.md');
    const r = untrackedLeg({ root });
    assert.equal(r.code, 1);
    assert.match(r.out, /git add -N "docs\/a b\.md"/);
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    assert.equal(untrackedLeg({ root }).code, 0);
  });

  test('outside a git checkout it is COVERAGE LOST (exit 1), never an empty "none found"', () => {
    const bare = mkdtempSync(join(tmpdir(), 'preflight-nogit-'));
    try {
      // GIT_CEILING_DIRECTORIES stops git walking up into an enclosing repo.
      const prev = process.env.GIT_CEILING_DIRECTORIES;
      process.env.GIT_CEILING_DIRECTORIES = dirname(bare);
      try {
        const u = untrackedFiles({ root: bare });
        assert.ok(u.error, `expected an error, got ${JSON.stringify(u)}`);
        const r = untrackedLeg({ root: bare });
        assert.equal(r.code, 1);
        assert.match(r.out, /COVERAGE LOST/);
      } finally {
        if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prev;
      }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('preflight CLI — the untracked leg runs FIRST and STOPS the run', () => {
  let root;
  before(() => { root = freshRepo(); });
  after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [join(root, 'tooling', 'scripts', 'preflight.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  test('--untracked-only: green on a clean tree (control)', () => {
    const r = cli('--untracked-only');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /preflight --untracked-only: ok/);
  });

  test('--untracked-only: red naming the file, then green after `git add -N`', () => {
    put(root, 'tooling/ci/test/zz-probe.test.mjs');
    const red = cli('--untracked-only');
    assert.equal(red.status, 1, red.out);
    assert.match(red.out, /zz-probe\.test\.mjs/);
    assert.match(red.out, /STOPPED at the first leg/);
    git(root, 'add', '-N', 'tooling/ci/test/zz-probe.test.mjs');
    const green = cli('--untracked-only');
    assert.equal(green.status, 0, green.out);
    git(root, 'reset', '-q', '--', 'tooling/ci/test/zz-probe.test.mjs');
    // Only the probe's own directory: tooling/ci/ holds the workflow parse preflight imports.
    rmSync(join(root, 'tooling', 'ci', 'test'), { recursive: true, force: true });
  });

  test('--sweep-only runs the untracked leg too, and never reaches the sweep while it is red', () => {
    put(root, 'new.txt');
    const r = cli('--sweep-only');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /FAIL no untracked files/);
    assert.doesNotMatch(r.out, /… guard sweep/);
    rmSync(join(root, 'new.txt'));
  });
});
