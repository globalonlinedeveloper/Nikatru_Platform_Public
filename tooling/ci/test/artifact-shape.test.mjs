// ─────────────────────────────────────────────────────────────────────────────
// artifact-shape.test.mjs — the recorded failing cases for
// tooling/ci/assert-artifact-shape.mjs.
//
// 🔴 THE LOAD-BEARING CASE IS `the .msix is deleted and Release/ is left intact`,
// and it is load-bearing because THAT EXACT TREE IS GREEN TODAY. `actions/
// upload-artifact@v4`'s `if-no-files-found: error` fires only when the WHOLE
// `path:` set matches nothing, so a union of a directory and a glob is satisfied
// by the directory alone: the only Microsoft Store package this factory builds
// can vanish from the artifact with the upload green, the workflow green, and
// every guard that reads the workflow's TEXT green — because the text still
// names the .msix. Nothing in the tree distinguished that state from a good one
// before this guard, which is why the case is written first and why it asserts
// on the msix PATH appearing in the failure rather than merely on a non-zero
// exit: a guard that goes red for some other reason is not this guard working.
//
// The same union hides a missing .aab behind a present .apk on the Android lane,
// so that case is here too — one defect, two lanes.
//
// ⚠️ A FIXTURE PASSING IS NOT A GUARD WORKING (assert-seams-wired.mjs, 2026-07-26:
// six green fixtures over a version that could not fail). What a fixture CAN do
// here is the thing the real tree cannot: the real repository has no build/
// output at all, so it can only ever produce the all-missing case. Every
// partial-emptiness shape below — present-but-zero-byte, directory-present-but-
// empty, bundle-without-its-executable — needs a tree somebody built on purpose.
// The all-missing case is verified against the REAL repository in the guard's
// own header and by the last test in this file.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-artifact-shape.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-shape-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The register rows this guard actually reads: a `lane.job` and the file
 *  formats the row accepts. Deliberately the real shape — the android-play and
 *  windows-store rows bind to the same two job names the workflow declares. */
const REGISTER = {
  channels: [
    { id: 'web', kind: 'web', served: true, artifactFormats: ['static-bundle'], platforms: ['web'] },
    {
      id: 'android-play',
      kind: 'store',
      served: false,
      artifactFormats: ['.aab'],
      platforms: ['android'],
      lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' },
    },
    {
      id: 'windows-store',
      kind: 'store',
      served: false,
      artifactFormats: ['.msix'],
      platforms: ['windows'],
      lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' },
    },
    { id: 'windows-direct', kind: 'direct', served: false, artifactFormats: ['.msix', '.exe'], platforms: ['windows'] },
  ],
};

const file = (root, rel, body = 'x') => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

/** A repo root carrying a register and an apps/<app> tree. `build` is a map of
 *  repo-relative-to-the-app path → contents; a `null` body makes a directory
 *  with nothing in it, which is the shape a union `path:` is satisfied by. */
function fixture({ register = REGISTER, app = 'subly', build = {}, withApp = true } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });
  if (register !== null) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'channel-register.json'),
      typeof register === 'string' ? register : JSON.stringify(register, null, 2),
    );
  }
  if (withApp) mkdirSync(join(root, 'apps', app), { recursive: true });
  for (const [rel, body] of Object.entries(build)) {
    if (body === null) mkdirSync(join(root, 'apps', app, rel), { recursive: true });
    else file(join(root, 'apps', app), rel, body);
  }
  return root;
}

const run = (root, args) => {
  const r = spawnSync(process.execPath, [GUARD, '--repo-root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// ── the shapes a complete lane produces ──────────────────────────────────────
const WINDOWS_OK = {
  'build/windows/msix/subly.msix': 'MSIX-BYTES',
  'build/windows/x64/runner/Release/subly.exe': 'PE-BYTES',
  'build/windows/x64/runner/Release/flutter_windows.dll': 'DLL',
  'build/windows/x64/runner/Release/data/app.so': 'AOT',
};

const ANDROID_OK = {
  'build/app/outputs/bundle/release/app-release.aab': 'AAB-BYTES',
  'build/app/outputs/flutter-apk/app-release.apk': 'APK-BYTES',
  'build/linux/x64/release/bundle/subly': 'ELF',
  'build/linux/x64/release/bundle/lib/libapp.so': 'AOT',
  'build/web/index.html': '<html>',
  'build/web/main.dart.js': 'js',
};

const APPLE_OK = {
  'build/macos/Build/Products/Release/Subly.app/Contents/MacOS/Subly': 'MACHO',
  'build/macos/Build/Products/Release/Subly.app/Contents/Info.plist': '<plist/>',
  // The iOS half. `flutter build ios --no-codesign` writes an .app whose binary
  // sits at the BUNDLE ROOT, not under Contents/MacOS — iOS bundles are flat and
  // macOS bundles are not. Retained since 2026-08-20; asserted since this change.
  'build/ios/iphoneos/Runner.app/Runner': 'MACHO-ARM64',
  'build/ios/iphoneos/Runner.app/Info.plist': '<plist/>',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-artifact-shape — the union-upload trap, per lane', () => {
  test('a complete windows lane passes', () => {
    const { code, out } = run(fixture({ build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 0, out);
    assert.match(out, /assert-artifact-shape: ok/);
    assert.match(out, /build\/windows\/msix\/subly\.msix/);
    assert.match(out, /1 channel row\(s\) bound to this lane job/);
  });

  // 🔴 THE RECORDED FAILING CASE. This exact tree is accepted by
  // `upload-artifact` with `if-no-files-found: error` set, because `Release/`
  // matches. It must go red HERE, and it must NAME the msix path.
  test('THE CASE THAT IS GREEN TODAY: the .msix is gone and Release/ is intact', () => {
    const build = { ...WINDOWS_OK };
    delete build['build/windows/msix/subly.msix'];
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /build\/windows\/msix\/\*\.msix/);
    assert.match(out, /if-no-files-found/);
    // and it must NOT be red about the half that is genuinely fine
    assert.doesNotMatch(out, /runner\/Release\/ — the directory does not exist/);
  });

  test('the msix directory exists and holds no .msix', () => {
    const build = { ...WINDOWS_OK };
    delete build['build/windows/msix/subly.msix'];
    build['build/windows/msix'] = null;
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /NO \.msix at this path/);
  });

  test('a ZERO-BYTE .msix is not an artifact', () => {
    const build = { ...WINDOWS_OK, 'build/windows/msix/subly.msix': '' };
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /ZERO BYTES/);
    assert.match(out, /subly\.msix/);
  });

  test('the runner bundle exists and is empty', () => {
    const build = { ...WINDOWS_OK };
    delete build['build/windows/x64/runner/Release/subly.exe'];
    delete build['build/windows/x64/runner/Release/flutter_windows.dll'];
    delete build['build/windows/x64/runner/Release/data/app.so'];
    build['build/windows/x64/runner/Release'] = null;
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /exists and is EMPTY/);
  });

  test('the runner bundle has files but no .exe', () => {
    const build = { ...WINDOWS_OK };
    delete build['build/windows/x64/runner/Release/subly.exe'];
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /NO "\.exe"/);
  });

  test('a ZERO-BYTE .exe in the bundle is caught', () => {
    const build = { ...WINDOWS_OK, 'build/windows/x64/runner/Release/subly.exe': '' };
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /ZERO BYTES/);
  });
});

describe('assert-artifact-shape — the same trap on the Android lane', () => {
  test('a complete linux_web_android lane passes', () => {
    const { code, out } = run(fixture({ build: ANDROID_OK }), ['--app', 'subly', '--platform', 'linux_web_android']);
    assert.equal(code, 0, out);
    assert.match(out, /app-release\.aab/);
    assert.match(out, /app-release\.apk/);
    assert.match(out, /build\/web\/ \(2 file\(s\)\) \[built here, not uploaded\]/);
  });

  test('the .aab is gone and the .apk is present — the union upload accepts it', () => {
    const build = { ...ANDROID_OK };
    delete build['build/app/outputs/bundle/release/app-release.aab'];
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'linux_web_android']);
    assert.equal(code, 1, out);
    assert.match(out, /build\/app\/outputs\/bundle\/release\/\*\.aab/);
    assert.doesNotMatch(out, /flutter-apk/);
  });

  test('the linux bundle directory is empty', () => {
    const build = { ...ANDROID_OK };
    delete build['build/linux/x64/release/bundle/subly'];
    delete build['build/linux/x64/release/bundle/lib/libapp.so'];
    build['build/linux/x64/release/bundle'] = null;
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'linux_web_android']);
    assert.equal(code, 1, out);
    assert.match(out, /build\/linux\/x64\/release\/bundle\/ — the directory exists and is EMPTY/);
  });

  test('a web build that produced nothing is caught even though nothing uploads it', () => {
    const build = { ...ANDROID_OK };
    delete build['build/web/index.html'];
    delete build['build/web/main.dart.js'];
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'linux_web_android']);
    assert.equal(code, 1, out);
    assert.match(out, /build\/web\/ — the directory does not exist/);
  });
});

describe('assert-artifact-shape — the apple lane asserts what it produces, and prints what it does not', () => {
  test('BOTH apple bundles pass, and the gap that remains is the .ipa alone', () => {
    const { code, out } = run(fixture({ build: APPLE_OK }), ['--app', 'subly', '--platform', 'apple']);
    assert.equal(code, 0, out);
    assert.match(out, /Subly\.app\//);
    // The iOS half must appear as a SATISFIED artifact, not merely as prose. A
    // green run that names only the macOS bundle is the state this change ended.
    assert.match(out, /build\/ios\/iphoneos\/Runner\.app\//);
    assert.match(out, /2 expectation\(s\) satisfied/);
    // The gap is pinned to the .ipa specifically. `GAP — iOS` alone kept matching
    // across this whole change, which makes it a pin that cannot tell the old
    // disclaimer from the new one — exactly the weak proxy this repo keeps
    // deleting. What is owner-gated is the FORMAT, and that is what is asserted.
    assert.match(out, /GAP — iOS — THE \.ipa/);
    assert.match(out, /OWNER_QUEUE A-4/);
    assert.doesNotMatch(out, /STILL ASSERTS NOTHING ABOUT IT/, 'the old disclaimer must be gone, not merely outvoted');
    assert.match(out, /no channel in tooling\/channel-register\.json names lane job "apple"/);
  });

  test('an EMPTY .app directory is not a build — size on a directory says nothing', () => {
    const { code, out } = run(
      fixture({ build: { 'build/macos/Build/Products/Release/Subly.app': null } }),
      ['--app', 'subly', '--platform', 'apple'],
    );
    assert.equal(code, 1, out);
    assert.match(out, /the \.app bundle exists and is EMPTY/);
  });

  test('no .app at all', () => {
    const { code, out } = run(
      fixture({ build: { 'build/macos/Build/Products/Release/Runner.txt': 'not a bundle' } }),
      ['--app', 'subly', '--platform', 'apple'],
    );
    assert.equal(code, 1, out);
    assert.match(out, /no "\.app" bundle at this path/);
  });

  // ── the iOS half, asserted since 2026-08-20 ──────────────────────────
  // 🔴 THESE THREE WERE RUN AGAINST THE GUARD BEFORE THE iOS ENTRY EXISTED AND
  // ALL THREE RETURNED EXIT 0 — PASS. That is the measurement, not the
  // illustration: until the entry landed there was no assertion here to fail,
  // and a lane with no iOS build at all was graded clean.
  test('the iOS bundle is MISSING entirely — the state every run before 2026-08-20 was in', () => {
    const build = { ...APPLE_OK };
    delete build['build/ios/iphoneos/Runner.app/Runner'];
    delete build['build/ios/iphoneos/Runner.app/Info.plist'];
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'apple']);
    assert.equal(code, 1, out);
    assert.match(out, /build\/ios\/iphoneos\/\*\.app — the containing directory does not exist/);
    assert.doesNotMatch(out, /build\/macos.*does not exist/, 'the macOS half is intact and must not be blamed');
  });

  test('the iOS .app exists and is EMPTY — a directory the upload accepts happily', () => {
    const build = { ...APPLE_OK };
    delete build['build/ios/iphoneos/Runner.app/Runner'];
    delete build['build/ios/iphoneos/Runner.app/Info.plist'];
    build['build/ios/iphoneos/Runner.app'] = null;
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'apple']);
    assert.equal(code, 1, out);
    assert.match(out, /the \.app bundle exists and is EMPTY/);
  });

  test('build/ios/iphoneos holds something that is NOT an .app', () => {
    const build = { ...APPLE_OK };
    delete build['build/ios/iphoneos/Runner.app/Runner'];
    delete build['build/ios/iphoneos/Runner.app/Info.plist'];
    build['build/ios/iphoneos/Runner.txt'] = 'not a bundle';
    const { code, out } = run(fixture({ build }), ['--app', 'subly', '--platform', 'apple']);
    assert.equal(code, 1, out);
    assert.match(out, /no "\.app" bundle at this path/);
  });
});

describe('assert-artifact-shape — COVERAGE LOST: the derivation, not the tree', () => {
  test('the register is missing entirely', () => {
    const { code, out } = run(fixture({ register: null, build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /tooling\/channel-register\.json does not exist/);
  });

  test('the register is unparseable', () => {
    const { code, out } = run(fixture({ register: '{ not json', build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /is not valid JSON/);
  });

  // An extension set derived from an EMPTY register would "cover" every
  // expectation by containing nothing to contradict it.
  test('the register declares no channel at all', () => {
    const { code, out } = run(fixture({ register: { channels: [] }, build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    // `.apk` is EXTRA_INSTALLABLE, so the set is never truly empty — what fails
    // is direction (a): `.msix`/`.exe` are no longer derivable from the register.
    assert.match(out, /derives no such installable format/);
  });

  // The direction that matters most: a channel binds to this job, declares a
  // format, and this guard has no path for it. Its absence from an upload would
  // be exactly as invisible as before.
  test('a bound channel declares a format this guard has no path for', () => {
    const register = JSON.parse(JSON.stringify(REGISTER));
    register.channels.push({
      id: 'windows-sideload',
      kind: 'direct',
      served: false,
      artifactFormats: ['.zip'],
      platforms: ['windows'],
      lane: { workflow: '.github/workflows/build-platforms.yml', job: 'windows' },
    });
    const { code, out } = run(fixture({ register, build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /channel "windows-sideload" declares lane job "windows" and accepts "\.zip"/);
  });

  test('an unknown --platform is a renamed job, not a clean lane', () => {
    const { code, out } = run(fixture({ build: WINDOWS_OK }), ['--app', 'subly', '--platform', 'windows_2026']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no output layout is declared for lane job "windows_2026"/);
  });

  test('an app directory that is not there', () => {
    const { code, out } = run(fixture({ withApp: false }), ['--app', 'ghost', '--platform', 'windows']);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /apps\/ghost does not exist/);
  });

  test('--app and --platform are both required', () => {
    const a = run(TMP, ['--platform', 'windows']);
    assert.equal(a.code, 1);
    assert.match(a.out, /--app <id> is required/);
    const b = run(TMP, ['--app', 'subly']);
    assert.equal(b.code, 1);
    assert.match(b.out, /--platform <lane job> is required/);
  });
});

describe('assert-artifact-shape — against the real repository', () => {
  // The real tree has no build/ output, so the honest expectation is RED, and
  // red for the right reason. This is the one case a fixture cannot give: it
  // proves the guard's path resolution matches the paths this repo's workflow
  // actually uploads, rather than paths invented in a fixture to match itself.
  test('the real repo has no build output, and every real lane says so by name', () => {
    for (const [platform, expected] of [
      ['windows', /build\/windows\/msix\/\*\.msix/],
      ['linux_web_android', /build\/app\/outputs\/bundle\/release\/\*\.aab/],
      ['apple', /build\/macos\/Build\/Products\/Release/],
    ]) {
      const r = spawnSync(process.execPath, [GUARD, '--app', 'subly', '--platform', platform], {
        encoding: 'utf8',
        cwd: REPO,
      });
      const out = `${r.stdout}${r.stderr}`;
      assert.equal(r.status, 1, `${platform}: ${out}`);
      assert.match(out, expected);
      assert.doesNotMatch(out, /COVERAGE LOST/, `${platform} must fail on the TREE, not on its own derivation: ${out}`);
    }
  });
});
