// ─────────────────────────────────────────────────────────────────────────────
// stamp-sandbox.test.mjs — a throwaway brick stamp inside the tree leaves
// `git status` exactly as it found it, on a throw too.
//
// ⏱ 2026-10-03 (fix-brick-stamp-outside-repo). A local stamp of the probe left
// apps/probe on disk and its registration in tracked files; every guard that
// lists apps/ then read the probe as a real app, and two merge rounds stalled
// 80+ min on it. preflight's stamp leg put back three NAMED files, not in a
// finally. It now restores through tooling/kit/stamp-sandbox.mjs.
//
// RED CONTROL FIRST: the fake stamp below, run WITHOUT the sandbox, changes
// `git status --porcelain --ignored`; the same stamp through preflight's real
// stampLeg (a throw included) changes nothing. Every repository here is a real
// git repository under os.tmpdir(), never this checkout: a test that stamps
// the real tree is the defect, since other suites read apps/ in parallel.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAMP_PATHS, snapshotTree, restoreTree, fsPath, REPO } from '../../kit/stamp-sandbox.mjs';
import { stampLeg } from '../../scripts/preflight.mjs';

const SANDBOX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit', 'stamp-sandbox.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
const put = (root, rel, text = 'x\n') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
};
/** What every guard that lists the tree would see: tracked changes, untracked
 *  files AND ignored ones (apps/probe is ignored and still listed by readdir). */
const status = (root) => git(root, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all');

/** A committed repo shaped like the files post_gen writes, the stamp paths
 *  gitignored as .gitignore does, and one uncommitted edit of a person's. */
function freshRepo() {
  const root = mkdtempSync(join(tmpdir(), 'stamp-sandbox-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, '.gitignore', STAMP_PATHS.map((p) => `${p}/`).join('\n') + '\n');
  put(root, 'pubspec.yaml', 'workspace:\n  - apps/subscriptiontracker\n');
  put(root, 'catalog/apps.json', '{"apps":["subscriptiontracker"]}\n');
  put(root, 'tooling/channel-register.json', '{"rows":[]}\n');
  put(root, 'apps/subscriptiontracker/app.yaml', 'id: subscriptiontracker\n');
  put(root, 'notes/person.md', 'committed\n');
  put(root, 'notes/gone.md', 'the person deletes this\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  put(root, 'notes/person.md', 'committed\nthe person is still typing\n');
  put(root, 'notes/draft.md', 'an untracked draft\n');
  rmSync(join(root, 'notes/gone.md'));
  return root;
}

/** What a real `mason make app` + post_gen does to the tree, in miniature. */
function fakeStamp(root) {
  put(root, 'apps/probe/lib/main.dart', 'void main() {}\n');
  put(root, 'apps/probe/app.yaml', 'id: probe\n');
  appendFileSync(join(root, 'pubspec.yaml'), '  - apps/probe\n');
  put(root, 'catalog/apps.json', '{"apps":["subscriptiontracker","probe"]}\n');
  put(root, 'tooling/channel-register.json', '{"rows":["probe"]}\n');
  put(root, 'tooling/store/probe/listing.json', '{}\n');
  rmSync(join(root, 'apps/subscriptiontracker/app.yaml'));
  appendFileSync(join(root, 'notes/person.md'), 'and the stamp wrote here too\n');
  rmSync(join(root, 'notes/draft.md'));
  put(root, 'notes/gone.md', 'the stamp wrote back a file the person had deleted\n');
}

/** preflight's runner, faked: `mason` stamps, everything else exits 0. */
const runnerFor = (onMason) => (cmd, args, opts) => {
  if (cmd === 'mason') return onMason(opts.cwd);
  return { code: 0, out: `${cmd} ok` };
};

describe('stamp-sandbox — the tree after a throwaway stamp is the tree before it', () => {
  let root;
  beforeEach(() => { root = freshRepo(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('🔴 RED CONTROL: the fake stamp, unsandboxed, DOES change git status (so the green below can fail)', () => {
    const before = status(root);
    fakeStamp(root);
    const after = status(root);
    assert.notEqual(after, before);
    assert.match(after, /^!! apps\/probe\/app\.yaml$/m, 'the stamp directory is listed (ignored) after an unsandboxed stamp');
    assert.match(after, /^ M pubspec\.yaml$/m);
    assert.match(after, /^\?\? tooling\/store\/probe\/listing\.json$/m);
  });

  test("preflight's stampLeg: the stamp and its grading run, and git status is unchanged afterwards", () => {
    const before = status(root);
    const seen = [];
    const r = stampLeg({
      root,
      runner: (cmd, args, opts) => {
        seen.push(cmd);
        if (cmd === 'mason') {
          fakeStamp(opts.cwd);
          return { code: 0, out: 'stamped' };
        }
        // The grading runs WHILE the stamp is on disk.
        if (cmd === 'node') assert.ok(existsSync(join(opts.cwd, 'apps/probe/app.yaml')), 'the probe was gone before assert-app-dod ran');
        return { code: 0, out: `${cmd} ok` };
      },
    });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(seen, ['mason', 'flutter', 'dart', 'node']);
    assert.equal(status(root), before);
    assert.equal(readFileSync(join(root, 'notes/person.md'), 'utf8'), 'committed\nthe person is still typing\n', "a person's uncommitted edit is kept as they left it, not reset to HEAD");
    assert.equal(readFileSync(join(root, 'notes/draft.md'), 'utf8'), 'an untracked draft\n');
    assert.equal(existsSync(join(root, 'notes/gone.md')), false, "a person's uncommitted deletion stays deleted");
    assert.equal(existsSync(join(root, 'tooling/store/probe')), false, 'an emptied directory the stamp created is pruned');
    assert.match(r.out, /stamp-sandbox: restored \d+ file\(s\), removed \d+ stamp path\(s\)/);
  });

  test('a stamp that THROWS midway is restored in the finally, and the leg is red', () => {
    const before = status(root);
    const r = stampLeg({
      root,
      runner: runnerFor((cwd) => {
        fakeStamp(cwd);
        throw new Error('mason crashed after writing');
      }),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /THE STAMP THREW[\s\S]*mason crashed after writing/);
    assert.equal(status(root), before);
  });

  test('a mason failure after a partial write is restored, and the leg is red', () => {
    const before = status(root);
    const r = stampLeg({
      root,
      runner: runnerFor((cwd) => {
        put(cwd, 'apps/probe/pubspec.yaml', 'name: probe\n');
        appendFileSync(join(cwd, 'pubspec.yaml'), '  - apps/probe\n');
        return { code: 64, out: 'mason: could not find brick' };
      }),
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /mason stamp failed/);
    assert.equal(status(root), before);
  });

  test('a stamp directory that was there BEFORE the run is not this run’s, and is left alone', () => {
    put(root, 'apps/probeapi/keep.txt', 'not this run\n');
    const before = status(root);
    const r = stampLeg({ root, runner: runnerFor((cwd) => { fakeStamp(cwd); return { code: 0, out: '' }; }) });
    assert.equal(r.code, 0, r.out);
    assert.equal(status(root), before);
    assert.equal(readFileSync(join(root, 'apps/probeapi/keep.txt'), 'utf8'), 'not this run\n');
  });

  test('🔴 a tree that cannot be snapshotted stamps NOTHING (COVERAGE LOST), rather than stamping what it cannot put back', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'stamp-sandbox-norepo-'));
    try {
      let ran = false;
      const r = stampLeg({ root: notRepo, runner: () => { ran = true; return { code: 0, out: '' }; } });
      assert.equal(r.code, 1);
      assert.match(r.out, /COVERAGE LOST/);
      assert.equal(ran, false);
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  test('the CLI round trip (snapshot, stamp, restore) leaves git status unchanged; the snapshot lives outside the repo', () => {
    const snapFile = join(mkdtempSync(join(tmpdir(), 'stamp-sandbox-snap-')), 'snap.json');
    try {
      const before = status(root);
      const s = spawnSync(process.execPath, [SANDBOX, 'snapshot', snapFile, '--root', root], { encoding: 'utf8' });
      assert.equal(s.status, 0, s.stderr);
      fakeStamp(root);
      assert.notEqual(status(root), before);
      const r = spawnSync(process.execPath, [SANDBOX, 'restore', snapFile], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /· apps\/probe\//);
      assert.equal(status(root), before);
    } finally {
      rmSync(dirname(snapFile), { recursive: true, force: true });
    }
  });

  test('the CLI refuses a missing file argument with exit 2', () => {
    const r = spawnSync(process.execPath, [SANDBOX, 'snapshot'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage:/);
  });

  test('snapshot + restore directly: a rename and a deleted tracked file both come back', () => {
    const before = status(root);
    const snap = snapshotTree(root);
    git(root, 'mv', 'catalog/apps.json', 'catalog/moved.json');
    const r = restoreTree(snap);
    assert.deepEqual(r.left, []);
    assert.equal(status(root), before);
  });
});

describe('stamp-sandbox — paths', () => {
  test('a git path joins onto a Windows root with backslashes (path.win32), and onto a POSIX root with slashes', () => {
    assert.equal(fsPath('C:\\Users\\x\\repo', 'apps/probe/lib/main.dart', win32), 'C:\\Users\\x\\repo\\apps\\probe\\lib\\main.dart');
    assert.equal(fsPath('/home/x/repo', 'apps/probe/lib/main.dart', posix), '/home/x/repo/apps/probe/lib/main.dart');
  });

  test('every STAMP_PATHS directory is gitignored in THIS repository, so a crash leaves nothing `git add -A` takes', () => {
    for (const p of STAMP_PATHS) {
      const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', `${p}/pubspec.yaml`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${p}/ is not gitignored (.gitignore, "Throwaway apps stamped by the brick CI lane")`);
    }
  });
});
