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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAMP_PATHS, STAMP_WRITES, snapshotTree, restoreTree, validateSnapshot, inWriteSet, fsPath, REPO, StampLeftover, SnapshotRefused, sameDir, moveCommands } from '../../kit/stamp-sandbox.mjs';
import { stampLeg } from '../../scripts/preflight.mjs';
// The catalogue paths from their owners, as STAMP_WRITES takes them.
import { CATALOGUE } from '../../app-yaml/render.mjs';
import { PAYLOAD } from '../../sites/generate-landing-payload.mjs';
import { BUNDLES_REGISTER } from '../../catalog/read.mjs';

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
 *  gitignored as .gitignore does, and a person's uncommitted work from BEFORE
 *  the run: an edit and a deletion inside the stamp's write set, an edit and
 *  an untracked draft outside it. */
function freshRepo() {
  const root = mkdtempSync(join(tmpdir(), 'stamp-sandbox-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, '.gitignore', STAMP_PATHS.map((p) => `${p}/`).join('\n') + '\n');
  put(root, 'pubspec.yaml', 'workspace:\n  - apps/subscriptiontracker\n');
  put(root, CATALOGUE, '{"apps":["subscriptiontracker"]}\n');
  put(root, BUNDLES_REGISTER, '{"bundles":[]}\n');
  put(root, 'tooling/channel-register.json', '{"rows":[]}\n');
  put(root, 'tooling/mail-transport.json', '{"allow":[]}\n');
  put(root, 'apps/subscriptiontracker/app.yaml', 'id: subscriptiontracker\n');
  put(root, 'notes/person.md', 'committed\n');
  put(root, 'notes/clean.dart', 'void lib() {}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  put(root, 'pubspec.yaml', 'workspace:\n  - apps/subscriptiontracker\n  - apps/my_wip\n');
  rmSync(join(root, BUNDLES_REGISTER));
  put(root, 'notes/person.md', 'committed\nthe person is still typing\n');
  put(root, 'notes/draft.md', 'an untracked draft\n');
  return root;
}

/** What a real `mason make app` + post_gen does to the tree, in miniature:
 *  every write lands in STAMP_WRITES. */
function fakeStamp(root) {
  put(root, 'apps/probe/lib/main.dart', 'void main() {}\n');
  put(root, 'apps/probe/app.yaml', 'id: probe\n');
  appendFileSync(join(root, 'pubspec.yaml'), '  - apps/probe\n');
  put(root, CATALOGUE, '{"apps":["subscriptiontracker","probe"]}\n');
  put(root, BUNDLES_REGISTER, '{"bundles":[],"excluded":["probe"]}\n');
  put(root, 'tooling/channel-register.json', '{"rows":["probe"]}\n');
  put(root, 'sites/nikatru/probe/privacy.html', '<p>probe</p>\n');
  rmSync(join(root, 'tooling/mail-transport.json'));
}

/** A person (or another tool) writing WHILE the stamp runs, outside its write
 *  set: the reviewer's probe on fc4d5cab, an edit to a clean tracked file and a
 *  new file. */
function personWritesDuringStamp(root) {
  put(root, 'notes/clean.dart', 'void lib() { /* saved during leg 5 */ }\n');
  put(root, 'notes/new_feature.dart', 'void feature() {}\n');
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
    assert.match(after, /^\?\? sites\/nikatru\/probe\/privacy\.html$/m);
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
    assert.equal(readFileSync(join(root, 'pubspec.yaml'), 'utf8'), 'workspace:\n  - apps/subscriptiontracker\n  - apps/my_wip\n', "a person's uncommitted edit to a set path is kept as they left it, not reset to HEAD");
    assert.equal(readFileSync(join(root, 'notes/draft.md'), 'utf8'), 'an untracked draft\n');
    assert.equal(existsSync(join(root, BUNDLES_REGISTER)), false, "a person's uncommitted deletion stays deleted");
    assert.equal(existsSync(join(root, 'sites/nikatru')), false, 'an emptied directory the stamp created is pruned');
    assert.doesNotMatch(r.out, /not by it/, 'a clean run names no foreign path');
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

  test('🔴 a path changed DURING the stamp outside its write set is LEFT AS IS and named; the stamp\'s own outputs are still restored (review fc4d5cab finding 1)', () => {
    const before = status(root);
    const r = stampLeg({
      root,
      runner: runnerFor((cwd) => {
        fakeStamp(cwd);
        personWritesDuringStamp(cwd);
        return { code: 0, out: 'stamped' };
      }),
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(root, 'notes/clean.dart'), 'utf8'), 'void lib() { /* saved during leg 5 */ }\n', 'the edit saved during the stamp was reverted');
    assert.equal(readFileSync(join(root, 'notes/new_feature.dart'), 'utf8'), 'void feature() {}\n', 'the file created during the stamp was deleted');
    assert.match(r.out, /^⬜ changed during the stamp, not by it: notes\/clean\.dart/m);
    assert.match(r.out, /^⬜ changed during the stamp, not by it: notes\/new_feature\.dart/m);
    // Everything else is exactly as before: the stamp's outputs are gone.
    const expected = (before + ' M notes/clean.dart\n?? notes/new_feature.dart\n').split('\n').filter(Boolean).sort();
    assert.deepEqual(status(root).split('\n').filter(Boolean).sort(), expected);
    assert.equal(existsSync(join(root, 'apps/probe')), false);
  });

  test('a person\'s pre-run edit outside the set that they change AGAIN during the stamp keeps the new bytes', () => {
    const r = stampLeg({
      root,
      runner: runnerFor((cwd) => {
        fakeStamp(cwd);
        appendFileSync(join(cwd, 'notes/person.md'), 'still typing during leg 5\n');
        return { code: 0, out: '' };
      }),
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(root, 'notes/person.md'), 'utf8'), 'committed\nthe person is still typing\nstill typing during leg 5\n');
    assert.match(r.out, /not by it: notes\/person\.md/);
  });

  const refusesLeftover = (p) => {
    put(root, `${p}/keep.txt`, 'an earlier run\n');
    const before = status(root);
    let ran = false;
    const r = stampLeg({ root, runner: () => { ran = true; return { code: 0, out: '' }; } });
    assert.equal(r.code, 1);
    assert.equal(ran, false, 'mason ran over a leftover');
    assert.match(r.out, /REFUSED, nothing was stamped/);
    assert.ok(r.out.includes(`${p} exists from an earlier stamp`), r.out);
    assert.match(r.out, /^  PowerShell: +New-Item -ItemType Directory -Force '[^']*stamped' \| Out-Null; Move-Item -LiteralPath '[^']*' -Destination '[^']*stamped'$/m, 'a PowerShell 5.1 move, on its own line');
    assert.match(r.out, /^  bash: +mkdir -p '[^']*stamped' && mv '[^']*' '[^']*stamped'\/$/m, 'a bash move, on its own line');
    assert.doesNotMatch(r.out, /\brm\b/);
    assert.equal(readFileSync(join(root, `${p}/keep.txt`), 'utf8'), 'an earlier run\n');
    assert.equal(status(root), before);
    assert.throws(() => snapshotTree(root), StampLeftover);
  };
  test('🔴 a leftover apps/probe/ from an earlier run REFUSES the stamp, names the path and a MOVE, and touches nothing (review fc4d5cab nit 2)', () => refusesLeftover('apps/probe'));
  test('🔴 a leftover apps/probeapi/ (another stamp path) refuses the same way', () => refusesLeftover('apps/probeapi'));

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

  test('🔴 a root that is not the git top-level is REFUSED at the snapshot, BEFORE anything is stamped, with nothing written (review f5b054c5 finding 1b)', () => {
    const sub = join(root, 'apps', 'subscriptiontracker');
    const before = status(root);
    assert.throws(() => snapshotTree(sub), (e) => e instanceof SnapshotRefused && /nothing was snapshotted, nothing may be stamped/.test(e.message) && /not a git top-level/.test(e.message));
    let ran = false;
    const r = stampLeg({ root: sub, runner: (cmd, args, opts) => { ran = true; fakeStamp(opts.cwd); return { code: 0, out: '' }; } });
    assert.equal(r.code, 1);
    assert.equal(ran, false, 'mason ran on a root the restore would refuse');
    assert.match(r.out, /COVERAGE LOST.*nothing was stamped/s);
    assert.equal(status(root), before);
    const snapFile = join(mkdtempSync(join(tmpdir(), 'stamp-sandbox-snap-')), 'snap.json');
    try {
      const c = spawnSync(process.execPath, [SANDBOX, 'snapshot', snapFile, '--root', sub], { encoding: 'utf8' });
      assert.equal(c.status, 2, `${c.stdout}${c.stderr}`);
      assert.match(c.stderr, /snapshot refused/);
      assert.equal(existsSync(snapFile), false, 'a refused snapshot was still written');
      assert.equal(status(root), before);
    } finally {
      rmSync(dirname(snapFile), { recursive: true, force: true });
    }
  });

  test('a root spelled through a symlink (a non-canonical path, as a Windows 8.3 short name is) snapshots, stamps and restores (review f5b054c5 finding 1a)', (t) => {
    const linkDir = mkdtempSync(join(tmpdir(), 'stamp-sandbox-link-'));
    const link = join(linkDir, 'repo');
    try {
      symlinkSync(root, link, 'junction');
      // review 008cddae: some Windows hosts cannot create a directory THROUGH a junction, so the fake stamp could not run
      // there. Measured on the lead's laptop 2026-10-03: mkdir answers EEXIST (not ENOENT, as first written). Probe it; where it
      // fails ON WIN32, the comparator tests below (sameDir with a LOCALU~2-style input and an injected realpath) carry the
      // short-name case, and this end-to-end leg runs on Linux CI. Anywhere else the error is re-thrown, so a Linux failure
      // is a red test, never a silent skip (review of #1186, d83ffacb).
      try { mkdirSync(join(link, '.stamp-sandbox-probe')); rmSync(join(root, '.stamp-sandbox-probe'), { recursive: true, force: true }); } catch (e) {
        if (process.platform !== 'win32') throw e;
        t.skip(`this host cannot create a directory through a junction (${e.code}); the sameDir comparator tests cover the short-name case`);
        return;
      }
      const top = git(link, 'rev-parse', '--show-toplevel').trim();
      assert.notEqual(top, link, 'RED CONTROL: git names the root in another spelling, so a plain string compare would refuse');
      const before = status(root);
      const r = stampLeg({ root: link, runner: runnerFor((cwd) => { fakeStamp(cwd); return { code: 0, out: 'stamped' }; }) });
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /COULD NOT RESTORE|refused/);
      assert.equal(status(root), before);
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
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

  test('snapshot + restore directly: a rename and a deleted tracked file inside the set both come back', () => {
    const before = status(root);
    const snap = snapshotTree(root);
    git(root, 'mv', CATALOGUE, PAYLOAD);
    rmSync(join(root, 'tooling/channel-register.json'));
    const r = restoreTree(snap);
    assert.deepEqual(r.left, []);
    assert.deepEqual(r.foreign, []);
    assert.equal(status(root), before);
  });
});

describe('stamp-sandbox — a snapshot is checked before restore acts on it (review fc4d5cab nit 3)', () => {
  let root;
  let dir;
  beforeEach(() => {
    root = freshRepo();
    dir = mkdtempSync(join(tmpdir(), 'stamp-sandbox-snap-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  const refuses = (mutate) => {
    const snapFile = join(dir, 'snap.json');
    const snap = snapshotTree(root);
    mutate(snap);
    writeFileSync(snapFile, JSON.stringify(snap));
    fakeStamp(root);
    const stamped = status(root);
    const r = spawnSync(process.execPath, [SANDBOX, 'restore', snapFile], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refused/);
    assert.equal(status(root), stamped, 'a refused restore changed the tree');
    assert.equal(existsSync(join(root, '..', 'escaped.txt')), false);
    assert.throws(() => restoreTree(snap), SnapshotRefused);
  };

  test(`🔴 the CLI restore refuses a path with '..' that leaves the root with exit 2 and writes nothing`, () => refuses((snap) => { snap.files['../escaped.txt'] = { xy: '??', bytes: Buffer.from('x').toString('base64') }; }));
  test(`🔴 the CLI restore refuses an absolute path with exit 2 and writes nothing`, () => refuses((snap) => { snap.files[join(dir, 'abs.txt')] = { xy: '??', bytes: Buffer.from('x').toString('base64') }; }));
  test(`🔴 the CLI restore refuses a write-set entry that is not in STAMP_WRITES with exit 2 and writes nothing`, () => refuses((snap) => { snap.writes.push('notes/'); }));
  test(`🔴 the CLI restore refuses a write-set entry with '..' with exit 2 and writes nothing`, () => refuses((snap) => { snap.writes.push('../'); }));
  test(`🔴 the CLI restore refuses a root that is a subdirectory, not the git top-level with exit 2 and writes nothing`, () => refuses((snap) => { snap.root = join(snap.root, 'catalog'); }));
  test(`🔴 the CLI restore refuses a root that is not a git repository with exit 2 and writes nothing`, () => refuses((snap) => { snap.root = dir; }));

  test('GREEN CONTROL: the same snapshot, untampered, validates and restores', () => {
    const before = status(root);
    const snap = snapshotTree(root);
    assert.deepEqual(validateSnapshot(snap), []);
    fakeStamp(root);
    restoreTree(snap);
    assert.equal(status(root), before);
  });
});

describe('stamp-sandbox — the root comparator (review f5b054c5 finding 1a)', () => {
  // On the lead's Windows host %TEMP% is C:\Users\LOCALU~2\…, git --show-toplevel answers
  // C:/Users/localuserwin11/…; realpathSync.native expands the short name,
  // the JS realpathSync does not. Both are injected here, so Linux CI proves it.
  const native = (p) => p.replace(/\\LOCALU~2\\/i, '\\localuserwin11\\');
  const short = 'C:\\Users\\LOCALU~2\\AppData\\Local\\Temp\\stamp-sandbox-ab12';
  const long = 'C:/Users/localuserwin11/AppData/Local/Temp/stamp-sandbox-ab12';
  test('an 8.3 short-name root and git\'s long top-level are the same directory, with a canonicalising realpath', () => {
    assert.equal(sameDir(long, short, { realpath: native, platform: 'win32' }), true);
    assert.equal(sameDir(long.toUpperCase(), short, { realpath: native, platform: 'win32' }), true, 'case-insensitive on win32');
  });
  test('🔴 RED CONTROL: with a realpath that keeps the short name (the JS realpathSync on win32) they differ', () => {
    assert.equal(sameDir(long, short, { realpath: (p) => p, platform: 'win32' }), false);
  });
  test('a different directory, a failing realpath, and case on POSIX are not the same directory', () => {
    assert.equal(sameDir(long, `${short}-other`, { realpath: native, platform: 'win32' }), false);
    assert.equal(sameDir(long, short, { realpath: () => { throw new Error('ENOENT'); }, platform: 'win32' }), false);
    assert.equal(sameDir('/tmp/Repo', '/tmp/repo', { realpath: (p) => p, platform: 'linux' }), false);
  });
  test('the leftover move names a PowerShell 5.1 form (no &&) and a bash form, each on its own line, quoting a path with a quote (review f5b054c5 nit 2)', () => {
    const lines = moveCommands("/r/it's", ['apps/probe'], '/t/stamped').split('\n');
    assert.equal(lines.length, 2);
    assert.doesNotMatch(lines[0], /&&/);
    // The source is joined with the HOST path module (review 008cddae: on Windows it reads \r\it's\apps\probe), so the
    // expectation is built the same way; the QUOTING is what this test pins.
    const src = join("/r/it's", 'apps/probe');
    assert.ok(lines[0].includes(`Move-Item -LiteralPath '${src.replace(/'/g, "''")}' -Destination '/t/stamped'`), lines[0]);
    assert.ok(lines[1].includes(`mv '${src.replace(/'/g, "'\\''")}' '/t/stamped'/`), lines[1]);
  });
});

describe('stamp-sandbox — paths', () => {
  test('a git path joins onto a Windows root with backslashes (path.win32), and onto a POSIX root with slashes', () => {
    assert.equal(fsPath('C:\\Users\\x\\repo', 'apps/probe/lib/main.dart', win32), 'C:\\Users\\x\\repo\\apps\\probe\\lib\\main.dart');
    assert.equal(fsPath('/home/x/repo', 'apps/probe/lib/main.dart', posix), '/home/x/repo/apps/probe/lib/main.dart');
  });

  test('the write set: a directory entry covers what is under it, a file entry only itself', () => {
    assert.ok(inWriteSet('apps/probe/lib/main.dart'));
    assert.ok(inWriteSet('pubspec.yaml'));
    assert.ok(!inWriteSet('apps/probes/x'), 'apps/probe/ must not cover apps/probes/');
    assert.ok(!inWriteSet('apps/probe'), 'the directory entry is a prefix with its slash');
    assert.ok(!inWriteSet('pubspec.yaml.bak'));
    assert.ok(!inWriteSet('apps/subscriptiontracker/app.yaml'));
    for (const p of STAMP_PATHS) assert.ok(STAMP_WRITES.includes(`${p}/`), `${p}/ is a stamp directory outside the write set`);
  });

  test("the write set names every output the stamp's writers export, read from the writers themselves", async () => {
    // A writer that renames its output, or a lane tag-owner starts rewriting,
    // would otherwise fall out of the set and be left on disk after leg 5.
    const render = await import('../../app-yaml/render.mjs');
    const privacy = await import('../../app-yaml/render-privacy.mjs');
    const wellKnown = await import('../../sites/generate-well-known.mjs');
    const authMail = await import('../../sites/gen-auth-mail.mjs');
    const personal = await import('../../sites/generate-personal-site.mjs');
    const appsData = await import('../../sites/generate-apps-data.mjs');
    const landing = await import('../../sites/generate-landing-payload.mjs');
    const shared = await import('../../kit/stamp-shared.mjs');
    const catalog = await import('../../catalog/read.mjs');
    const auth = await import('../../ci/assert-auth-callbacks.mjs');
    const tagOwner = await import('../../ci/tag-owner.mjs');
    const outputs = [
      render.CATALOGUE, render.REVENUECAT_APP_IDS_MODULE, render.STORE_SKUS_MODULE, privacy.TEMPLATE_LISTING,
      `${wellKnown.WELL_KNOWN_DIR}/`, `${authMail.AUTH_MAIL_SERVED_DIR}/`, personal.PAGE, personal.LLMS, personal.SITEMAP,
      appsData.SITE_DATA, landing.PAYLOAD, shared.E2E_LEG_REGISTER, catalog.BUNDLES_REGISTER, auth.MAIL_TRANSPORT,
      ...tagOwner.derive(REPO).lanes.keys(),
    ];
    for (const o of outputs) assert.ok(STAMP_WRITES.includes(o), `${o} is written by the stamp's chain and missing from STAMP_WRITES`);
    // Every FILE entry exists here, so a renamed output is caught, not carried.
    for (const w of STAMP_WRITES.filter((e) => !e.endsWith('/'))) assert.ok(existsSync(join(REPO, w)), `STAMP_WRITES names ${w}, which does not exist`);
  });

  test('every STAMP_PATHS directory is gitignored in THIS repository, so a crash leaves nothing `git add -A` takes', () => {
    for (const p of STAMP_PATHS) {
      const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', `${p}/pubspec.yaml`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${p}/ is not gitignored (.gitignore, "Throwaway apps stamped by the brick CI lane")`);
    }
  });
});
