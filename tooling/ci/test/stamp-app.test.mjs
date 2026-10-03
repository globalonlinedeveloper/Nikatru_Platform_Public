// ─────────────────────────────────────────────────────────────────────────────
// stamp-app.test.mjs — tooling/kit/stamp-app.mjs is the one command that
// stamps an app, and it is loud where post_gen is not.
//
// What is pinned here, and why each matters:
//   · `mason get` runs before `mason make`, from the repo root — a fresh
//     checkout has no brick registry and `make` exits 64 having stamped nothing;
//   · on Windows mason, flutter and dart are .bat files, and NONE is reached
//     through cmd.exe (CodeQL #578): each is the executable the .bat runs,
//     spawned without a shell; an argument cmd would read as syntax is still
//     refused before anything runs;
//   · NIKATRU_ALLOW_OVERWRITE=1 comes from --overwrite and from nothing else;
//   · a vars file that cannot be read, or an app id the contract refuses, stops
//     the stamp before mason;
//   · after mason, `flutter pub get` runs AT THE REPO ROOT and then
//     gen-app-licence-rows.mjs --write --app <id> (LEAD RULING NP12B-R2): the
//     new app's package files get their licence rows in the stamp itself;
//   · 🔴 that pub get leaves the tracked tree as it found it: the
//     analysis_options.yaml it rewrites are put back byte for byte (a person's
//     own uncommitted edit included), and any OTHER tracked file it changes,
//     the root pubspec.lock aside, fails the stamp by name — driven against a
//     real throwaway git checkout;
//   · after the root pub get, `dart run flutter_launcher_icons` runs from
//     apps/<id> (O-BRICK-STAMPS-WEB-ONLY, D30) under the same tree keeper, and it
//     owns NO tracked file: a run that rewrote the root lock from the
//     subdirectory fails the stamp by name;
//   · the seven post-conditions exist, in order, and a failing one makes the
//     exit non-zero;
//   · no workflow stamps with a raw `mason make`: a stamp step that skips this
//     file skips its post-conditions too. The one raw `mason make` a workflow
//     may carry is over a vars file whose app_id the contract refuses, which
//     can only prove that pre_gen refuses it too (ci.yml's "A bad app id is
//     refused before anything is written"); this file refuses such an id
//     before mason runs, so routed through it, pre_gen would never be asked.
//
// The suite reads the PLAN and drives the runner with an injected `run`: it
// spawns no mason and stamps nothing. No test is declared inside a loop
// (assert-no-loop-cases.mjs).
//
// Run:  node --single-threaded --test tooling/ci/test/stamp-app.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { appIdProblems } from '../../../contracts/app-id/app-id.js';
import { PRODUCT_REGISTERS } from '../../../contracts/entitlement/bundle.js';
import { planStamp, runStamp, REPO, REGEN, TAG_OWNER, APP_LICENCE_ROWS, STAMP_SHARED, STAMP_NATIVE, SNAP_UPDATE_ROW } from '../../kit/stamp-app.mjs';

let ROOT;
const GOOD = 'good-vars.json';

/** Where a workflow's steps can live: the workflows themselves, and the local
 *  composite actions a `uses: ./.github/actions/<x>` step runs in their place. */
const WORKFLOW_DIRS = ['.github/workflows', '.github/actions'];

/** Every workflow or local-action YAML file under `rel`, repo-relative. */
function yamlFiles(rel) {
  const abs = join(REPO, ...rel.split('/'));
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true })
    .map((f) => String(f).split('\\').join('/'))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => `${rel}/${f}`);
}

/** True when the line's `-c <vars>` names a vars file whose app_id the contract
 *  refuses: mason's pre_gen throws on it before writing anything, so the line
 *  cannot stamp an app. Anything unreadable is false. */
function refusedIdVars(line) {
  const vars = /\s-c\s+(\S+)/.exec(line)?.[1];
  if (!vars) return false;
  let spec;
  try {
    spec = JSON.parse(readFileSync(join(REPO, ...vars.split('/')), 'utf8'));
  } catch {
    return false;
  }
  return typeof spec?.app_id === 'string' && appIdProblems(spec.app_id).length > 0;
}

/** Every register PRODUCT_REGISTERS names, empty, so the claimed-id set (tooling/kit/product-set.mjs)
 *  reads a tree and not an absence; `extension` is the extension register's rows. */
function registers(root, extension = []) {
  for (const { register } of PRODUCT_REGISTERS) {
    if (register === null) continue;
    mkdirSync(dirname(join(root, register)), { recursive: true });
    writeFileSync(join(root, register), register.startsWith('extensions/') ? JSON.stringify(extension) : '[]\n');
  }
}

before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-stamp-app-'));
  registers(ROOT, [{ slug: 'claimedtool', status: 'preview' }]);
  writeFileSync(join(ROOT, 'claimed-id-vars.json'), JSON.stringify({ app_id: 'claimedtool' }));
  writeFileSync(join(ROOT, GOOD), JSON.stringify({ app_id: 'habittracker', display_name: 'Habit Tracker' }));
  writeFileSync(join(ROOT, 'bad-id-vars.json'), JSON.stringify({ app_id: 'habit_tracker' }));
  writeFileSync(join(ROOT, 'no-id-vars.json'), JSON.stringify({ display_name: 'No Id' }));
  writeFileSync(join(ROOT, 'not-json-vars.json'), '{ app_id: habittracker');
});

after(() => {
  if (ROOT) rmSync(ROOT, { recursive: true, force: true });
});

const plan = (argv, extra = {}) => planStamp({ argv, root: ROOT, platform: 'linux', env: {}, ...extra });

/** A tree keeper that keeps nothing: for the cases about step order and exit codes. */
const INERT = { snapshot: () => ({}), settle: () => ({ restored: [], stray: [] }) };

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};
const put = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const bytes = (root, rel) => readFileSync(join(root, rel), 'utf8');

/** A real git checkout — nothing committed, the index is the baseline — with
 *  two tracked analysis_options.yaml (one carrying a person's uncommitted
 *  edit), the root lock, a README, and the new app's untracked analysis_options.yaml. */
function trackedTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-stamp-tree-'));
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  registers(root);
  put(root, 'packages/a/analysis_options.yaml', 'include: package:nikatru_lints/analysis_options.yaml\n');
  put(root, 'apps/one/analysis_options.yaml', 'include: package:nikatru_lints/analysis_options.yaml\n');
  put(root, 'pubspec.lock', 'packages: {}\n');
  put(root, 'README.md', '# repo\n');
  put(root, GOOD, JSON.stringify({ app_id: 'habittracker' }));
  git(root, 'add', '-A');
  put(root, 'apps/one/analysis_options.yaml', 'include: package:nikatru_lints/analysis_options.yaml\n# a person\'s edit\n');
  put(root, 'apps/habittracker/analysis_options.yaml', 'include: package:nikatru_lints/analysis_options.yaml\n');
  return root;
}
const MIGRATED = '\nanalyzer:\n  exclude:\n    - build/**\n';
/** What a root `flutter pub get` does to the tree, measured (TRAPS.md, flutter class), plus `extra`. */
const pubGetWrites = (root, extra = () => {}) => (command) => {
  if (command !== 'flutter') return 0;
  for (const rel of ['packages/a/analysis_options.yaml', 'apps/one/analysis_options.yaml', 'apps/habittracker/analysis_options.yaml']) {
    writeFileSync(join(root, rel), bytes(root, rel) + MIGRATED);
  }
  writeFileSync(join(root, 'pubspec.lock'), 'packages: {habit: 1}\n');
  extra();
  return 0;
};

describe('stamp-app.mjs — one command, and loud about what it left behind', () => {
  test('mason get, mason make, the root pub get, the launcher icons, the licence rows and the snap update row run in that order; only the icons run in the app', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.map((s) => [s.command, ...s.args]),
      [
        ['mason', 'get'],
        ['mason', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
        ['flutter', 'pub', 'get'],
        ['dart', 'run', 'flutter_launcher_icons'],
        [process.execPath, join(ROOT, ...APP_LICENCE_ROWS.split('/')), '--write', '--app', 'habittracker'],
        [process.execPath, join(ROOT, ...SNAP_UPDATE_ROW.split('/')), '--write', '--app', 'habittracker'],
      ],
    );
    // flutter_launcher_icons reads ./pubspec.yaml, so it runs in the app; nothing else does.
    assert.deepEqual(p.steps.map((s) => s.cwd), [ROOT, ROOT, ROOT, join(ROOT, 'apps', 'habittracker'), ROOT, ROOT]);
  });

  test('🔴 on Windows no step is cmd.exe: each .bat is replaced by the executable it runs, with the same arguments (CodeQL #578)', () => {
    const sdk = 'C:\\sdk\\flutter';
    const dart = `${sdk}\\bin\\cache\\dart-sdk\\bin\\dart.exe`;
    const snapshot = `${sdk}\\bin\\cache\\flutter_tools.snapshot`;
    const packages = `--packages=${sdk}\\packages\\flutter_tools\\.dart_tool\\package_config.json`;
    const files = new Set([`${sdk}\\bin\\flutter.bat`, dart, snapshot, packages.slice('--packages='.length)]);
    const p = plan(['--vars', GOOD], { platform: 'win32', env: { Path: `C:\\Windows;${sdk}\\bin` }, isFile: (f) => files.has(f) });
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.slice(0, 4).map((s) => [s.command, ...s.args]),
      [
        [dart, 'pub', 'global', 'run', 'mason_cli:mason', 'get'],
        [dart, 'pub', 'global', 'run', 'mason_cli:mason', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
        [dart, packages, snapshot, 'pub', 'get'],
        [dart, 'run', 'flutter_launcher_icons'],
      ],
    );
    assert.ok(p.steps.every((s) => s.command !== 'cmd.exe' && !s.args.includes('/c')), 'a step still goes through cmd.exe');
    assert.ok(p.steps.slice(0, 4).every((s) => s.env.FLUTTER_ROOT === sdk), 'the SDK tools are told their root');
    assert.equal(p.steps[4].command, process.execPath, 'the licence-row generator is node, spawned without a shell');
    assert.equal(p.steps[5].command, process.execPath, 'the snap update row is node, spawned without a shell');

    // A mason.exe on PATH is used as it is.
    files.add('C:\\tools\\mason.exe');
    const exe = plan(['--vars', GOOD], { platform: 'win32', env: { PATH: `C:\\tools;${sdk}\\bin` }, isFile: (f) => files.has(f) });
    assert.deepEqual([exe.steps[0].command, ...exe.steps[0].args], ['C:\\tools\\mason.exe', 'get']);
  });

  test('on Windows an SDK that cannot be resolved is refused before anything runs, never worked around through cmd.exe', () => {
    const none = plan(['--vars', GOOD], { platform: 'win32', env: { Path: 'C:\\Windows' }, isFile: () => false });
    assert.equal(none.steps.length, 0);
    assert.match(none.problems.join('\n'), /flutter\.bat is not on PATH/);

    const unbuilt = plan(['--vars', GOOD], { platform: 'win32', env: { Path: 'C:\\sdk\\flutter\\bin' }, isFile: (f) => f.endsWith('flutter.bat') });
    assert.equal(unbuilt.steps.length, 0);
    assert.match(unbuilt.problems.join('\n'), /has not built its tool yet .*run `flutter --version` once/);
  });

  test('the licence rows are written only after the root pub get, and a failed pub get stops the stamp before them', () => {
    const p = plan(['--vars', GOOD]);
    const labels = p.steps.map((s) => s.label);
    assert.ok(labels.indexOf('flutter pub get (repo root)') < labels.indexOf(`node ${APP_LICENCE_ROWS} --write --app habittracker`));
    const ran = [];
    const errors = [];
    const code = runStamp(p, {
      run: (command, args) => {
        ran.push([command, ...args].join(' '));
        return command === 'flutter' ? 1 : 0;
      },
      exists: () => true,
      tree: INERT,
      log: () => {},
      error: (l) => errors.push(l),
    });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /flutter pub get \(repo root\) exited 1; the post-conditions were not checked/);
    assert.ok(!ran.some((r) => r.includes('gen-app-licence-rows')), `the generator ran after a failed pub get: ${ran.join(' | ')}`);
  });

  test('NIKATRU_ALLOW_OVERWRITE=1 is set only by --overwrite, and an inherited one is stripped', () => {
    const without = plan(['--vars', GOOD], { env: { PATH: '/bin', NIKATRU_ALLOW_OVERWRITE: '1' } });
    assert.deepEqual(without.problems, []);
    assert.equal(without.steps.length, 6);
    assert.ok(without.steps.every((s) => !('NIKATRU_ALLOW_OVERWRITE' in s.env)), 'a stamp without --overwrite carries NIKATRU_ALLOW_OVERWRITE');
    assert.ok(without.steps.every((s) => s.env.PATH === '/bin'), 'the caller environment is not passed through');

    const withIt = plan(['--vars', GOOD, '--overwrite'], { env: { PATH: '/bin' } });
    assert.deepEqual(withIt.problems, []);
    assert.ok(withIt.steps.every((s) => s.env.NIKATRU_ALLOW_OVERWRITE === '1'), '--overwrite did not set NIKATRU_ALLOW_OVERWRITE=1');
  });

  test('a vars path a shell would read as syntax is refused, and nothing is planned', () => {
    const amp = plan(['--vars', 'a&calc.json'], { platform: 'win32' });
    assert.equal(amp.steps.length, 0);
    assert.match(amp.problems.join('\n'), /--vars "a&calc\.json" is refused/);

    const pct = plan(['--vars', '%TEMP%.json'], { platform: 'win32' });
    assert.equal(pct.steps.length, 0);
    assert.match(pct.problems.join('\n'), /is refused/);

    const space = plan(['--vars', 'my vars.json'], { platform: 'win32' });
    assert.equal(space.steps.length, 0);
    assert.match(space.problems.join('\n'), /is refused/);
  });

  test('a missing, unparseable or id-less vars file is refused before mason', () => {
    const missing = plan(['--vars', 'absent-vars.json']);
    assert.equal(missing.steps.length, 0);
    assert.match(missing.problems.join('\n'), /could not be read as JSON \(ENOENT\)/);

    const notJson = plan(['--vars', 'not-json-vars.json']);
    assert.equal(notJson.steps.length, 0);
    assert.match(notJson.problems.join('\n'), /could not be read as JSON/);

    const noId = plan(['--vars', 'no-id-vars.json']);
    assert.equal(noId.steps.length, 0);
    assert.match(noId.problems.join('\n'), /carries no string "app_id"/);

    const noVars = plan([]);
    assert.equal(noVars.steps.length, 0);
    assert.match(noVars.problems.join('\n'), /--vars <file\.json> is required/);
  });

  test('the post-conditions are the pubspec, regen.mjs, tag-owner.mjs, the licence rows, the shared files --check, the native stamp --check and the snap update row --check, in that order', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.post.map((c) => c.label),
      [
        'apps/habittracker/pubspec.yaml exists',
        `node ${REGEN} --check`,
        `node ${TAG_OWNER} --check`,
        `node ${APP_LICENCE_ROWS} --check --app habittracker`,
        `node ${STAMP_SHARED} --check`,
        `node ${STAMP_NATIVE} --check --app habittracker`,
        `node ${SNAP_UPDATE_ROW} --check --app habittracker`,
      ],
    );
    assert.equal(p.post[0].path, join(ROOT, 'apps', 'habittracker', 'pubspec.yaml'));
    assert.deepEqual(p.post[1].args, [join(ROOT, 'tooling', 'sites', 'regen.mjs'), '--check']);
    assert.deepEqual(p.post[2].args, [join(ROOT, 'tooling', 'ci', 'tag-owner.mjs'), '--check']);
    assert.deepEqual(p.post[3].args, [join(ROOT, 'tooling', 'ci', 'gen-app-licence-rows.mjs'), '--check', '--app', 'habittracker']);
    // ⏱ 2026-10-01 (train P43): the bundle exclusion, the e2e entry and the auth
    // allow list post_gen writes outside apps/<id>/.
    assert.deepEqual(p.post[4].args, [join(ROOT, 'tooling', 'kit', 'stamp-shared.mjs'), '--check', '--root', ROOT]);
    // ⏱ 2026-10-01 (O-BRICK-STAMPS-WEB-ONLY, D30): the five native folders the native stamp writes.
    assert.deepEqual(p.post[5].args, [join(ROOT, 'tooling', 'kit', 'stamp-native.mjs'), '--check', '--app', 'habittracker']);
    assert.deepEqual(p.post[6].args, [join(ROOT, 'tooling', 'kit', 'snap-update-row.mjs'), '--check', '--app', 'habittracker']);
  });

  test('a stamp whose licence rows check red exits 1 and names the generator', () => {
    const p = plan(['--vars', GOOD]);
    const errors = [];
    const rowsRed = (command, args) => (args.includes('--check') && args[0].endsWith('gen-app-licence-rows.mjs') ? 1 : 0);
    const code = runStamp(p, { run: rowsRed, exists: () => true, tree: INERT, log: () => {}, error: (l) => errors.push(l) });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /1 post-condition\(s\) failed: node tooling\/ci\/gen-app-licence-rows\.mjs --check --app habittracker/);
  });

  test('a failing post-condition makes the exit 1 and is named; all green is exit 0', () => {
    const p = plan(['--vars', GOOD]);
    const calls = [];
    const errors = [];
    const regenFails = (command, args) => {
      calls.push([command, ...args].join(' '));
      return args.includes('--check') && args[0].endsWith('regen.mjs') ? 1 : 0;
    };
    const red = runStamp(p, { run: regenFails, exists: () => true, tree: INERT, log: () => {}, error: (l) => errors.push(l) });
    assert.equal(red, 1);
    assert.match(errors.join('\n'), /1 post-condition\(s\) failed: node tooling\/sites\/regen\.mjs --check/);
    assert.equal(calls.length, 12, `expected mason get, mason make, pub get, the launcher icons, the two --write and the six --check runs; got ${calls.join(' | ')}`);

    const green = runStamp(p, { run: () => 0, exists: () => true, tree: INERT, log: () => {}, error: () => {} });
    assert.equal(green, 0);

    const noApp = runStamp(p, { run: () => 0, exists: () => false, tree: INERT, log: () => {}, error: () => {} });
    assert.equal(noApp, 1, 'a stamp that wrote no apps/<id>/pubspec.yaml exited 0');
  });

  test('an app id the contract refuses stops the stamp before mason, with the contract message', () => {
    const p = plan(['--vars', 'bad-id-vars.json']);
    assert.equal(p.steps.length, 0);
    assert.match(p.problems.join('\n'), /app id "habit_tracker" breaks the pattern/);
    assert.match(p.problems.join('\n'), /contracts\/app-id/);
    const ran = [];
    const code = runStamp(p, { run: (c) => { ran.push(c); return 0; }, exists: () => true, tree: INERT, log: () => {}, error: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(ran, [], 'a refused stamp ran a command');
  });

  test('rv2-newproduct-015: an id another product claims stops the stamp before mason, naming the claim', () => {
    const p = plan(['--vars', 'claimed-id-vars.json']);
    assert.equal(p.steps.length, 0);
    assert.match(p.problems.join('\n'), /"claimedtool" is already claimed: extension id \(extensions\/catalog\/extensions\.json, owned by extension:claimedtool\)/);
    const ran = [];
    const code = runStamp(p, { run: (c) => { ran.push(c); return 0; }, exists: () => true, tree: INERT, log: () => {}, error: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(ran, [], 'a refused stamp ran a command');
  });

  test('rv2-newproduct-015: a tree whose product registers cannot be read stamps nothing (the claimed set is not a measurement)', () => {
    const bare = mkdtempSync(join(tmpdir(), 'nikatru-stamp-bare-'));
    try {
      writeFileSync(join(bare, GOOD), JSON.stringify({ app_id: 'habittracker' }));
      const p = planStamp({ argv: ['--vars', GOOD], root: bare, platform: 'linux', env: {} });
      assert.equal(p.steps.length, 0);
      assert.match(p.problems.join('\n'), /the claimed-id set could not be read/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test('the root pub get and the launcher icons are wrapped by the tracked-tree keeper, the icons at the repo root owning nothing', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(
      p.steps.filter((s) => s.keepsTrackedTree).map((s) => s.label),
      ['flutter pub get (repo root)', 'dart run flutter_launcher_icons (apps/habittracker)'],
    );
    const icons = p.steps[3];
    assert.equal(icons.treeRoot, ROOT, 'the keeper must read the whole checkout, not the app directory');
    assert.deepEqual(icons.owns, []);
  });

  test('🔴 RED CONTROL: a launcher-icons run that rewrites the root pubspec.lock fails the stamp, named, before the licence rows', () => {
    const root = trackedTree();
    try {
      const ran = [];
      const errors = [];
      const pubGet = pubGetWrites(root);
      const code = runStamp(planStamp({ argv: ['--vars', GOOD], root, platform: 'linux', env: {} }), {
        run: (command, args) => {
          ran.push([command, ...args].join(' '));
          if (command === 'dart') {
            writeFileSync(join(root, 'pubspec.lock'), 'packages: {re-resolved-from-the-app: 1}\n');
            return 0;
          }
          return pubGet(command);
        },
        exists: () => true,
        log: () => {},
        error: (l) => errors.push(l),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /dart run flutter_launcher_icons \(apps\/habittracker\) left 1 tracked file\(s\) changed: pubspec\.lock\. No tracked file is its to write/);
      assert.ok(!ran.some((r) => r.includes('gen-app-licence-rows')), `the generator ran after a stray write: ${ran.join(' | ')}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the analysis_options.yaml a root pub get rewrites are put back byte for byte — a person\'s own edit as they left it — and the lock is its to write', () => {
    const root = trackedTree();
    try {
      const before = ['packages/a/analysis_options.yaml', 'apps/one/analysis_options.yaml', 'apps/habittracker/analysis_options.yaml'].map((r) => bytes(root, r));
      const logs = [];
      const code = runStamp(planStamp({ argv: ['--vars', GOOD], root, platform: 'linux', env: {} }), {
        run: pubGetWrites(root),
        exists: () => true,
        log: (l) => logs.push(l),
        error: (l) => logs.push(l),
      });
      assert.equal(code, 0, logs.join('\n'));
      assert.deepEqual(
        ['packages/a/analysis_options.yaml', 'apps/one/analysis_options.yaml', 'apps/habittracker/analysis_options.yaml'].map((r) => bytes(root, r)),
        before,
      );
      assert.match(bytes(root, 'apps/one/analysis_options.yaml'), /# a person's edit/);
      assert.equal(bytes(root, 'pubspec.lock'), 'packages: {habit: 1}\n');
      assert.match(logs.join('\n'), /put back 3 analysis_options\.yaml it rewrote/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 RED CONTROL: any other tracked file the root pub get changes fails the stamp, named, before the licence rows', () => {
    const root = trackedTree();
    try {
      const ran = [];
      const errors = [];
      const writes = pubGetWrites(root, () => writeFileSync(join(root, 'README.md'), '# rewritten\n'));
      const code = runStamp(planStamp({ argv: ['--vars', GOOD], root, platform: 'linux', env: {} }), {
        run: (command, args) => {
          ran.push([command, ...args].join(' '));
          return writes(command);
        },
        exists: () => true,
        log: () => {},
        error: (l) => errors.push(l),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /flutter pub get \(repo root\) left 1 tracked file\(s\) changed: README\.md\. Only pubspec\.lock is its to write/);
      assert.ok(!ran.some((r) => r.includes('gen-app-licence-rows')), `the generator ran after a stray write: ${ran.join(' | ')}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a tree the keeper cannot read stops the stamp BEFORE pub get runs', () => {
    const p = plan(['--vars', GOOD]); // ROOT is not a git checkout
    const ran = [];
    const errors = [];
    const code = runStamp(p, { run: (c) => { ran.push(c); return 0; }, exists: () => true, log: () => {}, error: (l) => errors.push(l) });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /flutter pub get \(repo root\): the tracked tree could not be read before it .*; it was not run/);
    assert.deepEqual(ran, ['mason', 'mason']);
  });

  test('no workflow under .github/workflows runs mason make itself', () => {
    const files = WORKFLOW_DIRS.flatMap(yamlFiles);
    assert.ok(files.includes('.github/workflows/ci.yml'), `the scan found no .github/workflows/ci.yml; it read ${files.length} file(s)`);
    const raw = [];
    for (const rel of files) {
      const lines = readFileSync(join(REPO, ...rel.split('/')), 'utf8').split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        if (/^\s*#/.test(line) || !/\bmason(?:\.bat)?\s+make\b/.test(line)) continue;
        if (!refusedIdVars(line)) raw.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
    assert.deepEqual(raw, [], 'a workflow stamps with a raw `mason make`; call `node tooling/kit/stamp-app.mjs --vars <file.json>` instead, so the stamp runs its post-conditions');
  });
});
