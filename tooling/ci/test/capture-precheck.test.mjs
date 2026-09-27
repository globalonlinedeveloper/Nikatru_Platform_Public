// ─────────────────────────────────────────────────────────────────────────────
// capture-precheck.test.mjs — tooling/store/capture-precheck.mjs must be able to FAIL,
// and must name what it failed on (O-SCREENSHOT-DRIVER-IS-ONE-APPS, RC4).
//
// The precheck is the first step of every capture job in store-screenshots.yml. Its
// one job is to refuse an app the lane cannot capture BEFORE the job installs
// Flutter and provisions a user, so each case below spawns it exactly as the lane
// does and reads the exit code and the named file. Fixtures live in os.tmpdir()
// (ADR 072); the real-tree cases come last and run the real command on the real
// repository, which is the evidence a fixture is not.
//
// Every case is written out by hand (assert-no-loop-cases.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../text-reductions.mjs';
import { SUITE_FILE, DRIVER_FILE } from '../../store/capture-suite-scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const PRECHECK = join(REPO, 'tooling', 'store', 'capture-precheck.mjs');
const RUNNER = join(REPO, 'tooling', 'store', 'capture-play-screenshots.mjs');

// BOUNDED, so a spawn that hangs at exit fails its case by name.
const BOUND = { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' };
const out = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n[spawn] ${r.error.message}` : ''}`;

/** A register with one capturable store channel and one store channel with no
 *  screenshot block, in the real register's shapes. */
const REGISTER = {
  channels: [
    { id: 'android-play', kind: 'store', storeMetadataDir: 'apps/{app}/store/android-play' },
    { id: 'apps-gov-in', kind: 'store', storeMetadataDir: 'apps/{app}/store/apps-gov-in' },
  ],
  storeMetadataContract: {
    perChannel: {
      'android-play': { graphicAssets: { screenshots: { dir: 'screenshots' } } },
      'apps-gov-in': { graphicAssets: { assets: {} } },
    },
  },
};

/** A workspace whose one app, `demo`, has everything a Play capture needs.
 *  `omit` names the repo-relative paths to leave out. */
function fixture({ omit = [], workspace = ['apps/demo'], register = REGISTER } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nk-capture-precheck-'));
  const files = {
    'pubspec.yaml': `name: fixture_workspace\nworkspace:\n${workspace.map((w) => `  - ${w}\n`).join('')}`,
    'tooling/channel-register.json': register === null ? null : JSON.stringify(register),
    [`apps/demo/${SUITE_FILE}`]: 'void main() {}\n',
    [`apps/demo/${DRIVER_FILE}`]: 'Future<void> main() async {}\n',
    'apps/demo/store/android-play/title.txt': 'Demo\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    if (body === null || omit.includes(rel)) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  roots.push(root);
  return root;
}
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('capture-precheck.mjs — a fixture workspace', () => {
  test('GREEN CONTROL — an app with its suite, its driver and its listing directory exits 0 and names all three', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /"demo" is one of the 1 app\(s\) of the workspace set/);
    assert.ok(out(r).includes(`apps/demo/${SUITE_FILE}, apps/demo/${DRIVER_FILE}, apps/demo/store/android-play — each present`), out(r));
  });

  test('🔴 RC4 — an app without store_screenshots_test.dart exits 1 and names the file', () => {
    const root = fixture({ omit: [`apps/demo/${SUITE_FILE}`] });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAIL apps\/demo\/integration_test\/store_screenshots_test\.dart is missing — the capture suite/);
    // Only the one missing file is named: the driver and the directory are there.
    assert.equal((out(r).match(/^FAIL /gm) ?? []).length, 1, out(r));
  });

  test('🔴 an app without the capture driver exits 1 and names it', () => {
    const root = fixture({ omit: [`apps/demo/${DRIVER_FILE}`] });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAIL apps\/demo\/test_driver\/store_screenshots\.dart is missing — the capture driver/);
  });

  test('🔴 an app without the channel\'s listing directory exits 1 and names the directory', () => {
    const root = fixture({ omit: ['apps/demo/store/android-play/title.txt'] });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAIL apps\/demo\/store\/android-play is missing — the listing directory/);
  });

  test('🔴 two missing files are both named, not only the first', () => {
    const root = fixture({ omit: [`apps/demo/${SUITE_FILE}`, `apps/demo/${DRIVER_FILE}`] });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.equal((out(r).match(/^FAIL /gm) ?? []).length, 2, out(r));
    assert.match(out(r), /store_screenshots_test\.dart is missing/);
    assert.match(out(r), /test_driver\/store_screenshots\.dart is missing/);
  });

  test('🔴 RC1 — an app outside the workspace set exits 1 and names the set', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'other', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAIL the app "other" is not in the workspace app set \(demo\)/);
  });

  test('🔴 a channel that declares no screenshot set exits 1 and names the channels that do', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'apps-gov-in', '--root', root], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /FAIL the channel "apps-gov-in" declares no screenshot set in tooling\/channel-register\.json\. The channels that do: android-play\./);
  });

  test('COVERAGE LOST — a workspace with no apps/ member exits 2, never 0', () => {
    const root = fixture({ workspace: ['packages/core'] });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /FAIL COVERAGE LOST — capture-precheck: .*declares no `workspace:` entry under apps\//);
  });

  test('COVERAGE LOST — a missing register exits 2', () => {
    const root = fixture({ register: null });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /FAIL COVERAGE LOST — capture-precheck: .*channel-register\.json is missing or is not valid JSON/);
  });

  test('COVERAGE LOST — a register in which no channel declares a screenshot set exits 2', () => {
    const root = fixture({
      register: {
        channels: [{ id: 'apps-gov-in', kind: 'store', storeMetadataDir: 'apps/{app}/store/apps-gov-in' }],
        storeMetadataContract: { perChannel: { 'apps-gov-in': { graphicAssets: { assets: {} } } } },
      },
    });
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declares no `kind: "store"` channel with a storeMetadataDir and a graphicAssets\.screenshots block/);
  });

  test('COVERAGE LOST — no --channel exits 2: nothing was checked', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'demo', '--root', root], BOUND);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /FAIL COVERAGE LOST — capture-precheck: --channel was not given/);
  });

  test('COVERAGE LOST — no --app exits 2', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [PRECHECK, '--channel', 'android-play', '--root', root], BOUND);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /FAIL COVERAGE LOST — capture-precheck: --app was not given/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PAIR IT REQUIRES IS THE PAIR THE DRIVE NAMES.
//
// Structural, over the runner's CODE with comments stripped: the runner's prose
// names both files, and a grep that counted those would pass on a runner that had
// gone back to typing its own paths (grep-02).
// ─────────────────────────────────────────────────────────────────────────────
describe('capture-precheck.mjs requires what capture-play-screenshots.mjs drives', () => {
  const code = stripSourceComments(readFileSync(RUNNER, 'utf8'), '.mjs');

  test('the runner imports SUITE_FILE and DRIVER_FILE from capture-suite-scan.mjs', () => {
    assert.match(code, /import\s*\{[^}]*\bSUITE_FILE\b[^}]*\bDRIVER_FILE\b[^}]*\}\s*from\s*'\.\/capture-suite-scan\.mjs'/);
  });

  test('both of its drives build --driver and --target from those constants, and no path is typed', () => {
    assert.equal((code.match(/`--driver=\$\{DRIVER_FILE\}`/g) ?? []).length, 2);
    assert.equal((code.match(/`--target=\$\{SUITE_FILE\}`/g) ?? []).length, 2);
    assert.doesNotMatch(code, /--driver=test_driver\//);
    assert.doesNotMatch(code, /--target=integration_test\//);
  });
});

describe('capture-precheck.mjs — the real repository', () => {
  test('app #1 passes for each of the five channels the lane captures', () => {
    const play = spawnSync(process.execPath, [PRECHECK, '--app', 'subscriptiontracker', '--channel', 'android-play'], BOUND);
    assert.equal(play.status, 0, out(play));
    const snap = spawnSync(process.execPath, [PRECHECK, '--app', 'subscriptiontracker', '--channel', 'linux-snap'], BOUND);
    assert.equal(snap.status, 0, out(snap));
    const windows = spawnSync(process.execPath, [PRECHECK, '--app', 'subscriptiontracker', '--channel', 'windows-store'], BOUND);
    assert.equal(windows.status, 0, out(windows));
    const macos = spawnSync(process.execPath, [PRECHECK, '--app', 'subscriptiontracker', '--channel', 'macos-appstore'], BOUND);
    assert.equal(macos.status, 0, out(macos));
    const ios = spawnSync(process.execPath, [PRECHECK, '--app', 'subscriptiontracker', '--channel', 'ios-appstore'], BOUND);
    assert.equal(ios.status, 0, out(ios));
  });

  test('🔴 an app id outside the real workspace set exits 1', () => {
    const r = spawnSync(process.execPath, [PRECHECK, '--app', 'not-an-app-of-this-workspace', '--channel', 'android-play'], BOUND);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not in the workspace app set \(.*subscriptiontracker.*\)/);
  });
});
