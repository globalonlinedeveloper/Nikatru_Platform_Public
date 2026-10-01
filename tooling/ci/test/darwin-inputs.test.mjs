// ─────────────────────────────────────────────────────────────────────────────
// darwin-inputs.test.mjs — tooling/ci/darwin-inputs.mjs, which decides whether
// native-auth-proof.yml's Darwin legs (ios, macos) run (⏱ 2026-10-01, the follow-up
// to the 2026-09 macOS exception in assert-runner-budget.mjs).
//
// The map is BY CONTENT: these cases put the same path through it with and without
// Darwin text, so a rule that fell back to a path list would fail them. The CLI runs
// on a real git fixture, because the diff and the deleted-file reading are git's.
//
// Run:  node --test tooling/ci/test/darwin-inputs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { darwinInputReason, darwinVerdict, lastGreenSha, main } from '../darwin-inputs.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';
import { CouldNotLook } from '../../ops/bounded-retry.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

describe('darwinInputReason — a Darwin input by its kind and its text', () => {
  test('GREEN: Darwin-native kinds and directories are inputs whatever they say', () => {
    for (const p of [
      'packages/platform_storage/ios/Classes/NativeAttestPlugin.swift',
      'apps/demo/ios/Runner/Info.plist',
      'apps/demo/macos/Runner/Release.entitlements',
      'apps/demo/ios/Podfile',
      'apps/demo/macos/Runner.xcodeproj/project.pbxproj',
      'packages/x/darwin/Classes/a.txt',
    ]) {
      assert.ok(darwinInputReason(p, ''), p);
    }
  });

  test('a workflow is an input when its TEXT runs a macOS job — on runs-on or through a matrix os', () => {
    assert.ok(darwinInputReason('.github/workflows/a.yml', 'jobs:\n  x:\n    runs-on: macos-26\n'));
    assert.ok(darwinInputReason('.github/workflows/b.yml', 'jobs:\n  x:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        include:\n          - os: macos-26\n'));
    // 🔴 the same path with a Linux-only text is not: the kind of file decides nothing here
    assert.equal(darwinInputReason('.github/workflows/a.yml', 'jobs:\n  x:\n    runs-on: ubuntu-24.04\n'), null);
  });

  test('🔴 any other file is decided by its TEXT: the same path is an input, or not, by what it says', () => {
    const path = 'services/platform/src/routes/native-auth.ts';
    assert.match(darwinInputReason(path, '// App Attest proofs are verified here'), /names a Darwin target/);
    assert.equal(darwinInputReason(path, 'export const x = 1;\n'), null);
    // a darwin plugin bumped in the lock is named by its own package name
    assert.ok(darwinInputReason('pubspec.lock', '  flutter_secure_storage_darwin:\n    dependency: transitive\n'));
    assert.equal(darwinInputReason('pubspec.lock', '  flutter_secure_storage_linux:\n    dependency: transitive\n'), null);
    assert.ok(darwinInputReason('tooling/e2e/native_auth_proof.mjs', "spawnSync('xcrun', ['simctl', 'boot'])"));
    assert.equal(darwinInputReason('docs/ci/README.md', '# the Linux lanes\n'), null);
    // a word that merely CONTAINS a Darwin name is not one
    assert.equal(darwinInputReason('services/a.ts', 'const radios = pineapple + biosphere;'), null);
  });

  test('darwinVerdict: true with the reasons when any file is an input, false over none', () => {
    assert.deepEqual(darwinVerdict([{ path: 'services/a.ts', text: 'x' }]), { darwin: false, reasons: [] });
    const v = darwinVerdict([{ path: 'services/a.ts', text: 'x' }, { path: 'apps/d/ios/Runner/Info.plist', text: '' }]);
    assert.equal(v.darwin, true);
    assert.deepEqual(v.reasons.map((r) => r.path), ['apps/d/ios/Runner/Info.plist']);
  });

  test('lastGreenSha: the newest SUCCESSFUL run of THIS app, never another app\'s or a failure', () => {
    const runs = [
      { conclusion: 'success', head_sha: 'aaa', created_at: '2026-09-28T00:00:00Z', display_title: 'Native auth proof — demo by @x' },
      { conclusion: 'success', head_sha: 'bbb', created_at: '2026-09-30T00:00:00Z', display_title: 'Native auth proof — demo by @x' },
      { conclusion: 'failure', head_sha: 'ccc', created_at: '2026-10-01T00:00:00Z', display_title: 'Native auth proof — demo by @x' },
      { conclusion: 'success', head_sha: 'ddd', created_at: '2026-10-01T00:00:00Z', display_title: 'Native auth proof — demo2 by @x' },
    ];
    assert.equal(lastGreenSha(runs, 'demo'), 'bbb');
    assert.equal(lastGreenSha(runs, 'demo2'), 'ddd');
    assert.equal(lastGreenSha(runs, 'other'), null);
  });
});

/** A git repository with a Darwin-native file and a macOS workflow (what the self-check needs). */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'darwin-inputs-'));
  const g = (...a) => {
    const r = spawnSync('git', a, { cwd: root, encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'fixture@local');
  g('config', 'user.name', 'fixture');
  put('apps/demo/ios/Runner/Info.plist', '<plist/>\n');
  put('.github/workflows/proof.yml', 'jobs:\n  ios:\n    runs-on: macos-26\n');
  put('services/api/src/a.ts', 'export const a = 1;\n');
  put('tooling/e2e/driver.mjs', "// boots the iOS simulator\nexport const b = 1;\n");
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const commit = (msg, edit) => {
    edit({ put, root });
    g('add', '-A');
    g('commit', '-q', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  return { root, base: g('rev-parse', 'HEAD'), commit };
}

async function cli(root, argv, opts = {}) {
  const lines = [];
  const code = await main(argv, { root, out: (l) => lines.push(l), err: (l) => lines.push(l), ...opts });
  return { code, out: lines.join('\n'), last: lines[lines.length - 1] };
}

describe('darwin-inputs CLI — the verdict the gate job emits', () => {
  test('GREEN: a change to a file that is no Darwin kind and names no Darwin thing is darwin=false', async () => {
    const f = fixture();
    try {
      f.commit('api only', ({ put }) => put('services/api/src/a.ts', 'export const a = 2;\n'));
      const r = await cli(f.root, ['--base', f.base]);
      assert.equal(r.code, 0, r.out);
      assert.equal(r.last, 'darwin=false');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('🔴 RED: a plist, or a script whose text names the simulator, is darwin=true', async () => {
    const f = fixture();
    try {
      f.commit('plist', ({ put }) => put('apps/demo/ios/Runner/Info.plist', '<plist version="1"/>\n'));
      const r = await cli(f.root, ['--base', f.base]);
      assert.equal(r.last, 'darwin=true', r.out);
      assert.match(r.out, /apps\/demo\/ios\/Runner\/Info\.plist — a Darwin-native file/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
    const g = fixture();
    try {
      g.commit('driver', ({ put }) => put('tooling/e2e/driver.mjs', "// boots the iOS simulator\nexport const b = 2;\n"));
      const r = await cli(g.root, ['--base', g.base]);
      assert.equal(r.last, 'darwin=true', r.out);
      assert.match(r.out, /its text names a Darwin target or toolchain \("iOS"\)/);
    } finally { rmSync(g.root, { recursive: true, force: true }); }
  });

  test('🔴 a DELETED Darwin script is judged by its text at the base, and is darwin=true', async () => {
    const f = fixture();
    try {
      f.commit('delete', ({ root }) => unlinkSync(join(root, 'tooling/e2e/driver.mjs')));
      const r = await cli(f.root, ['--base', f.base]);
      assert.equal(r.last, 'darwin=true', r.out);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('not knowing runs the legs: an unknown base is darwin=true, with the reason', async () => {
    const f = fixture();
    try {
      const r = await cli(f.root, ['--base', '0123456789abcdef0123456789abcdef01234567']);
      assert.equal(r.code, 0, r.out);
      assert.equal(r.last, 'darwin=true');
      assert.match(r.out, /is not a commit in this checkout — running the Darwin legs/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('--since-green: the base is this app\'s last green proof; a refused listing or no green run runs the legs', async () => {
    const f = fixture();
    try {
      f.commit('api only', ({ put }) => put('services/api/src/a.ts', 'export const a = 3;\n'));
      const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' };
      // The run history arrives through anchoredRunRead's injectable read; a fresh page needs no cross-read.
      const now = new Date().toISOString();
      const listing = (runs, refuse = false) => async (url) => {
        assert.match(url, /^https:\/\/api\.github\.com\/repos\/o\/r\/actions\/workflows\/proof\.yml\/runs\?status=success/);
        if (refuse) throw new CouldNotLook('GitHub API returned 403 for proof.yml successful runs');
        return { workflow_runs: runs };
      };
      const green = [{ id: 7, conclusion: 'success', head_sha: f.base, created_at: now, updated_at: now, display_title: 'Native auth proof — demo by @x' }];
      const retry = { attempts: 1 };
      const r = await cli(f.root, ['--since-green', 'proof.yml', '--app', 'demo'], { env, read: listing(green), retry });
      assert.equal(r.last, 'darwin=false', r.out);
      const none = await cli(f.root, ['--since-green', 'proof.yml', '--app', 'demo'], { env, read: listing([]), retry });
      assert.equal(none.last, 'darwin=true', none.out);
      const refused = await cli(f.root, ['--since-green', 'proof.yml', '--app', 'demo'], { env, read: listing(green, true), retry });
      assert.equal(refused.last, 'darwin=true', refused.out);
      assert.match(refused.out, /could not be read .*403/);
      const noToken = await cli(f.root, ['--since-green', 'proof.yml', '--app', 'demo'], { env: {}, read: listing(green), retry });
      assert.equal(noToken.last, 'darwin=true', noToken.out);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('🔴 COVERAGE LOST: a tree in which the map finds no Darwin at all is exit 2, never a darwin=false', async () => {
    const f = fixture();
    try {
      f.commit('no darwin', ({ root }) => {
        unlinkSync(join(root, 'apps/demo/ios/Runner/Info.plist'));
      });
      const r = await cli(f.root, ['--base', f.base]);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST — the map found 0 Darwin-native file\(s\)/);
      assert.doesNotMatch(r.out, /darwin=false/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('the REAL driver, spawned: exit 2 and no verdict without a base', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tooling/ci/darwin-inputs.mjs')], { cwd: REPO, encoding: 'utf8', env: ENV });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /^darwin=/m);
  });
});

describe('native-auth-proof.yml — the Darwin legs run on the gate\'s verdict', () => {
  test('WORKFLOW-SCAN: ios and macos carry `if: needs.gate.outputs.darwin == \'true\'`; the gate emits it from darwin-inputs.mjs', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/native-auth-proof.yml');
    assert.ok(wf, 'native-auth-proof.yml parses');
    const text = (job) => job.lines.map((l) => l.text).join('\n');
    for (const name of ['ios', 'macos']) {
      const job = wf.jobs.get(name);
      assert.ok(job, `native-auth-proof.yml has no ${name} job`);
      assert.match(text(job), /^ {4}if: needs\.gate\.outputs\.darwin == 'true'$/m, `${name} runs whatever the gate saw`);
      assert.match(text(job), /^ {4}runs-on: macos-/m, `${name} is no longer a Darwin leg — this scan is reading the wrong job`);
    }
    for (const name of ['android', 'windows', 'linux']) {
      assert.doesNotMatch(text(wf.jobs.get(name)), /outputs\.darwin/, `${name} is not a Darwin leg and must not wait on the Darwin verdict`);
    }
    const gate = text(wf.jobs.get('gate'));
    assert.match(gate, /darwin: \$\{\{ steps\.darwin\.outputs\.darwin \}\}/);
    assert.match(gate, /node tooling\/ci\/darwin-inputs\.mjs --since-green native-auth-proof\.yml --app "\$APP_INPUT"/);
    assert.match(gate, /fetch-depth: 0/);
    assert.match(gate, /actions: read/);
  });
});
