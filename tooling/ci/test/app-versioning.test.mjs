// ─────────────────────────────────────────────────────────────────────────────
// app-versioning.test.mjs — assert-app-versioning.mjs must be able to FAIL.
//
// Read this first, because it changes how much these tests are worth:
//
//   A FIXTURE PASSING IS NOT A GUARD WORKING. On 2026-07-26 a guard shipped here
//   whose caller check matched the function's own declaration, so deleting every
//   real caller still passed — and ALL SIX of its fixture tests passed against
//   the broken version. A fixture you write encodes the same misunderstanding as
//   the guard you write.
//
// So the primary evidence for the derive-and-pass rules is 23 mutations applied
// on 2026-07-27 (b2f31b2) to the REAL repository (freeze the version, drop
// --build-number, point the build number at the SHA, delete the derive step, …),
// every one of which was confirmed to fail with its own message. Two of those
// mutations changed the guard itself:
//   · a malformed pubspec made it print "COVERAGE LOST — the scan is broken",
//     blaming the scanner for a defect the scanner had correctly found; and
//   · its `buildsChecked === 0` coverage assertion turned out to be UNREACHABLE,
//     because every route to zero matched builds already produces a better
//     message. It was deleted rather than kept, per this repo's rule that an
//     assertion which cannot fail is worse than none.
// Neither would have been visible from fixtures alone.
//
// What THESE tests add is the cheap, permanent, per-rule half: one known-bad
// input per check, run on every push, so a future edit that guts one rule while
// leaving the others intact still turns the build red. Fixtures are built in a
// temp dir, never in the repo.
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
const GUARD = 'assert-app-versioning.mjs';
const REPO = resolve(CI_DIR, '..', '..');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-appver-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

// ── the lane set is DERIVED FROM THE REGISTER since 2026-08-03 ───────────────
// `RELEASE_LANES` used to be a one-entry array inside the guard. It is now every
// `channels[]` row in tooling/channel-register.json that carries a `lane`, with
// `served` deciding whether the row is CHECKED or merely PRINTED. So every
// fixture needs a register, and `fixture()` writes the minimal one unless the
// case supplies its own — a case that omits it is testing the absent-register
// COVERAGE LOST, not the rule it thinks it is testing.
const registerJson = (channels) => JSON.stringify({ channels }, null, 2);
const WEB_ROW = {
  id: 'web',
  served: true,
  lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' },
};
const DEFAULT_REGISTER = registerJson([WEB_ROW]);

function fixture(name, files) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  const withRegister = Object.prototype.hasOwnProperty.call(files, 'tooling/channel-register.json')
    ? files
    : { 'tooling/channel-register.json': DEFAULT_REGISTER, ...files };
  for (const [rel, body] of Object.entries(withRegister)) {
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function run({ cwd = ROOT, args = [] } = {}) {
  const r = spawnSync(process.execPath, [join(CI_DIR, GUARD), ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── the shape of a correct release lane, with one knob per rule ──────────────
const BNAME = '${{ steps.ver.outputs.release_line }}.${{ github.run_number }}';

function workflow({
  buildName = BNAME,
  buildNumber = '${{ github.run_number }}',
  appVersion = `${BNAME}+\${GITHUB_SHA::7}`,
  emitStep = true,
  stepId = 'ver',
  flutterBuild = true,
  deployMarker = 'pages deploy build/web --project-name=subly',
} = {}) {
  const derive = emitStep
    ? `      - name: Derive the release line from pubspec\n` +
      (stepId ? `        id: ${stepId}\n` : '') +
      `        working-directory: .\n` +
      `        run: node tooling/ci/${GUARD} --emit apps/subly >> "$GITHUB_OUTPUT"\n`
    : '';
  const build = flutterBuild
    ? `      - name: Build web\n        run: >\n          flutter build web --release --pwa-strategy=none\n` +
      (buildName === null ? '' : `          --build-name=${buildName}\n`) +
      (buildNumber === null ? '' : `          --build-number=${buildNumber}\n`) +
      (appVersion === null ? '' : `          --dart-define=APP_VERSION=${appVersion}\n`)
    : `      - name: Build web\n        run: echo skip\n`;
  return (
    `name: Deploy Web\npermissions:\n  contents: read\njobs:\n  deploy-web:\n    runs-on: ubuntu-24.04\n    steps:\n` +
    derive +
    build +
    `      - name: Deploy\n        run: ${deployMarker}\n`
  );
}

const pubspec = (version = '1.0.0+1') => `name: subly\n${version === null ? '' : `version: ${version}\n`}`;

function lane(name, { wf = {}, version = '1.0.0+1', extra = {} } = {}) {
  return fixture(name, {
    '.github/workflows/deploy-web.yml': workflow(wf),
    'apps/subly/pubspec.yaml': pubspec(version),
    ...extra,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-app-versioning — the passing shape', () => {
  test('PASSES when the version is derived from pubspec + github.run_number', () => {
    const { code, out } = run({ args: [lane('ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /ok\s+app versioning/);
  });

  test('PASSES against the REAL repository', () => {
    const { code, out } = run({ args: [REPO] });
    assert.equal(code, 0, out);
  });
});

describe('assert-app-versioning — the build number (Play versionCode)', () => {
  test('FAILS when no --build-number is passed at all', () => {
    const { code, out } = run({ args: [lane('bn-missing', { wf: { buildNumber: null } })] });
    assert.equal(code, 1);
    assert.match(out, /passes no --build-number/);
  });

  test('FAILS when --build-number is a frozen literal', () => {
    const { code, out } = run({ args: [lane('bn-literal', { wf: { buildNumber: '1' } })] });
    assert.equal(code, 1);
    assert.match(out, /is the literal "1"/);
  });

  // A SHA identifies a build; it cannot rank two of them, and Play needs a rank.
  test('FAILS when --build-number is derived from the commit SHA', () => {
    const { code, out } = run({ args: [lane('bn-sha', { wf: { buildNumber: '${GITHUB_SHA::7}' } })] });
    assert.equal(code, 1);
    assert.match(out, /NOT ORDERED/);
  });

  test('FAILS when --build-number comes from a non-monotonic source', () => {
    const { code, out } = run({ args: [lane('bn-attempt', { wf: { buildNumber: '${{ github.run_attempt }}' } })] });
    assert.equal(code, 1);
    assert.match(out, /not derived from github\.run_number/);
  });
});

describe('assert-app-versioning — the version string (CFG-1 kill-switch)', () => {
  test('FAILS when no --build-name is passed, leaving the binary on pubspec\'s frozen version', () => {
    const { code, out } = run({ args: [lane('bname-missing', { wf: { buildName: null } })] });
    assert.equal(code, 1);
    assert.match(out, /passes no --build-name/);
  });

  test('FAILS when --build-name is a hardcoded literal (a second copy of pubspec\'s version)', () => {
    const { code, out } = run({ args: [lane('bname-literal', { wf: { buildName: '1.0.0' } })] });
    assert.equal(code, 1);
    assert.match(out, /is a hardcoded literal/);
  });

  // version_gate.dart drops everything after `+`, so a frozen major.minor.patch
  // is the kill-switch having no floor it can usefully sit on.
  test('FAILS when --build-name does not move with github.run_number', () => {
    const { code, out } = run({
      args: [lane('bname-frozen', { wf: { buildName: '${{ steps.ver.outputs.release_line }}.0' } })],
    });
    assert.equal(code, 1);
    assert.match(out, /does not move with github\.run_number/);
  });
});

describe('assert-app-versioning — APP_VERSION (analytics + what the client reports)', () => {
  test('FAILS when APP_VERSION is not passed', () => {
    const { code, out } = run({ args: [lane('av-missing', { wf: { appVersion: null } })] });
    assert.equal(code, 1);
    assert.match(out, /passes no --dart-define=APP_VERSION/);
  });

  // This is the defect verbatim: `--dart-define=APP_VERSION=1.0.0+${GITHUB_SHA::7}`.
  test('FAILS on the original defect — a hardcoded version core', () => {
    const { code, out } = run({ args: [lane('av-frozen', { wf: { appVersion: '1.0.0+${GITHUB_SHA::7}' } })] });
    assert.equal(code, 1);
    assert.match(out, /version core "1\.0\.0" is hardcoded/);
  });

  test('FAILS when APP_VERSION carries no commit SHA — ordered but no longer traceable', () => {
    const { code, out } = run({ args: [lane('av-nosha', { wf: { appVersion: BNAME } })] });
    assert.equal(code, 1);
    assert.match(out, /carries no commit SHA/);
  });

  test('FAILS when APP_VERSION\'s core and --build-name are two different numbers', () => {
    const { code, out } = run({
      args: [lane('av-split', { wf: { appVersion: `${BNAME}.9+\${GITHUB_SHA::7}` } })],
    });
    assert.equal(code, 1);
    assert.match(out, /differs from --build-name/);
  });

  // services/platform/src/routes/events.ts:135 writes app_version through
  // str(…, 32) — it TRUNCATES rather than rejects, so two builds could land in
  // analytics under one string with nothing to show for it.
  test('FAILS when the release line makes APP_VERSION able to exceed 32 chars', () => {
    const { code, out } = run({ args: [lane('av-long', { version: '111111111.2222222222222.0' })] });
    assert.equal(code, 1);
    assert.match(out, /truncates app_version at 32/);
  });

  test('PASSES at a release line that stays inside 32 chars', () => {
    const { code, out } = run({ args: [lane('av-fits', { version: '12.345.0' })] });
    assert.equal(code, 0, out);
  });
});

describe('assert-app-versioning — the version must be DERIVED, not typed', () => {
  test('FAILS when the --emit derive step is absent', () => {
    const { code, out } = run({ args: [lane('emit-missing', { wf: { emitStep: false } })] });
    assert.equal(code, 1);
    assert.match(out, /never derives the version from apps\/subly\/pubspec\.yaml/);
  });

  test('FAILS when the derive step has no id, so nothing can read its outputs', () => {
    const { code, out } = run({ args: [lane('emit-noid', { wf: { stepId: null } })] });
    assert.equal(code, 1);
    assert.match(out, /no `id:`/);
  });

  test('FAILS when release_line is derived and then never used', () => {
    const { code, out } = run({
      args: [
        lane('emit-unused', {
          wf: {
            buildName: '${{ steps.ver.outputs.pubspec_version }}',
            appVersion: '${{ steps.ver.outputs.pubspec_version }}+${GITHUB_SHA::7}',
          },
        }),
      ],
    });
    assert.equal(code, 1);
    assert.match(out, /never uses it/);
  });
});

describe('assert-app-versioning — the pubspec declaration', () => {
  test('FAILS when the app declares no version at all', () => {
    const { code, out } = run({ args: [lane('ps-none', { version: null })] });
    assert.equal(code, 1);
    assert.match(out, /declares no `version:`/);
  });

  test('FAILS when the version is not X.Y.Z — pub itself would reject it', () => {
    const { code, out } = run({ args: [lane('ps-bad', { version: '1.0' })] });
    assert.equal(code, 1);
    assert.match(out, /is not `X\.Y\.Z`/);
  });

  // PARSE, DO NOT GREP PROSE. A commented-out declaration is not a declaration —
  // a CORS guard here once matched the comment explaining why a setting was absent.
  test('FAILS when `version:` survives only inside a comment', () => {
    const dir = fixture('ps-comment', {
      '.github/workflows/deploy-web.yml': workflow(),
      'apps/subly/pubspec.yaml': 'name: subly\n# version: 1.0.0+1\n',
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /declares no `version:`/);
  });

  test('a trailing comment on a real declaration does NOT break the parse', () => {
    const dir = fixture('ps-trailing', {
      '.github/workflows/deploy-web.yml': workflow(),
      'apps/subly/pubspec.yaml': 'name: subly\nversion: 2.7.0+1 # local-dev placeholder\n',
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 0, out);
  });
});

describe('assert-app-versioning — coverage self-check', () => {
  // The single most repeated bug in this repo is a guard reporting "clean" over
  // an incomplete set. A new lane that builds and ships must not slip past.
  test('FAILS LOUDLY when another workflow builds a Flutter app and deploys it', () => {
    const dir = lane('cov-newlane', {
      extra: {
        '.github/workflows/deploy-android.yml':
          'name: Android\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n' +
          '    steps:\n      - run: flutter build apk --release\n      - run: wrangler whatever\n',
      },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /deploy-android\.yml builds a Flutter app AND deploys it/);
  });

  // …but a build matrix that ships NOTHING must not be dragged in, or CI fails
  // for a lane with no user-visible version at all. build-platforms.yml is
  // exactly this: six builds, upload-artifact, no deploy.
  test('PASSES when another workflow builds every platform but deploys none', () => {
    const dir = lane('cov-matrix', {
      extra: {
        '.github/workflows/build-platforms.yml':
          'name: Build all\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-24.04\n' +
          '    steps:\n      - run: flutter build apk --release\n' +
          '      - uses: actions/upload-artifact@abc\n',
      },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS when a declared lane names a workflow that does not exist', () => {
    const dir = fixture('cov-nowf', {
      '.github/workflows/other.yml': 'name: Other\npermissions:\n  contents: read\n',
      'apps/subly/pubspec.yaml': pubspec(),
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /which does not exist/);
  });

  test('FAILS when apps/ contains no pubspec at all', () => {
    const dir = fixture('cov-noapps', { '.github/workflows/deploy-web.yml': workflow() });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS when the declared lane stops running `flutter build`', () => {
    const { code, out } = run({ args: [lane('cov-nobuild', { wf: { flutterBuild: false } })] });
    assert.equal(code, 1);
    assert.match(out, /runs no `flutter build`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 9]R-2's NATIVE HALF — the lane set is DERIVED, not typed.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Before this change the guard printed
// "1 release lane(s)" over a hardcoded array while build-platforms.yml's .aab
// and .msix carried `versionCode 1` and nothing could say so. After it, the
// same real tree prints THREE lanes — one served and checked, two deferred and
// PRINTED by row id — and the printed lines are what expire the exemption the
// day somebody flips `served`.
//
// Mutations run against a full copy of the repository, 2026-08-03:
//   · `android-play.served` → true with the .aab's `--build-number` deleted ⇒
//     exit 1 naming the missing flag. (Flipping `served` alone now PASSES,
//     because the flag really is there — which is the point of adding it.)
//   · a lane's `job:` renamed ⇒ COVERAGE LOST naming the jobs that DO exist.
//   · the register's `lane` blocks all removed ⇒ COVERAGE LOST, not "0 lanes, ok".
//   · the register deleted ⇒ COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-app-versioning — the lane set is derived from the channel register', () => {
  const deferredNativeRow = (served, buildNumber) => ({
    register: registerJson([
      WEB_ROW,
      { id: 'android-play', served, lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
    ]),
    workflow:
      'name: Build all\npermissions:\n  contents: read\njobs:\n  linux_web_android:\n    runs-on: ubuntu-24.04\n' +
      '    steps:\n      - name: Build android\n        working-directory: apps/subly\n        run: >\n' +
      '          flutter build appbundle --release\n' +
      (buildNumber ? '          --build-number=${{ github.run_number }}\n' : '') +
      '      - uses: actions/upload-artifact@abc\n',
  });

  test('a DEFERRED lane is exempt and its exemption is PRINTED, naming the row', () => {
    const d = deferredNativeRow(false, false);
    const dir = lane('reg-deferred', {
      extra: { '.github/workflows/build-platforms.yml': d.workflow, 'tooling/channel-register.json': d.register },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 0, out);
    assert.match(out, /deferred lanes, EXEMPT and printed not hidden/);
    assert.match(out, /"android-play"/);
    assert.match(out, /1 served and checked, 1 deferred and printed/);
  });

  // THE RECORDED FAILING CASE: flip `served` AND remove the flag. Flipping
  // alone must pass, because the flag is really in build-platforms.yml now.
  test('FAILS the moment a lane is SERVED and its build passes no --build-number', () => {
    const d = deferredNativeRow(true, false);
    const dir = lane('reg-served-nobn', {
      extra: { '.github/workflows/build-platforms.yml': d.workflow, 'tooling/channel-register.json': d.register },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /build-platforms\.yml/);
    assert.match(out, /passes no --build-number/);
  });

  test('a SERVED native lane that does pass --build-number is judged on the rest, not on the flag', () => {
    const d = deferredNativeRow(true, true);
    const dir = lane('reg-served-bn', {
      extra: { '.github/workflows/build-platforms.yml': d.workflow, 'tooling/channel-register.json': d.register },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1, out);
    assert.ok(!/passes no --build-number/.test(out), 'the build-number rule is satisfied');
    assert.match(out, /never derives the version from|passes no --build-name/);
  });

  test('COVERAGE LOST when a lane names a job the workflow does not declare', () => {
    const dir = lane('reg-nojob', {
      extra: {
        'tooling/channel-register.json': registerJson([
          { id: 'web', served: true, lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-webb' } },
        ]),
      },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /names job "deploy-webb"/);
    assert.match(out, /it has: deploy-web/);
  });

  test('COVERAGE LOST when the register carries channels but none resolves to a lane', () => {
    const dir = lane('reg-nolanes', {
      extra: { 'tooling/channel-register.json': registerJson([{ id: 'web', served: true }]) },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /NONE resolved to a lane/);
  });

  test('COVERAGE LOST when the register declares no channels at all', () => {
    const dir = lane('reg-empty', { extra: { 'tooling/channel-register.json': registerJson([]) } });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /declares no `channels`/);
  });

  test('COVERAGE LOST when the register is not there', () => {
    const dir = lane('reg-gone', { extra: { 'tooling/channel-register.json': null } });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /does not exist, so the lane set is derived from nothing/);
  });

  test('COVERAGE LOST when every resolved lane is deferred — nothing would be asserted', () => {
    const d = deferredNativeRow(false, false);
    const dir = lane('reg-all-deferred', {
      extra: {
        '.github/workflows/build-platforms.yml': d.workflow,
        'tooling/channel-register.json': registerJson([
          { id: 'android-play', served: false, lane: { workflow: '.github/workflows/build-platforms.yml', job: 'linux_web_android' } },
        ]),
      },
    });
    const { code, out } = run({ args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /NONE is served/);
  });
});

describe('assert-app-versioning — --emit is the build step\'s source of truth', () => {
  test('emits the release line and the raw pubspec version', () => {
    const dir = lane('emit-ok');
    const { code, out } = run({ cwd: dir, args: ['--emit', 'apps/subly'] });
    assert.equal(code, 0, out);
    assert.match(out, /^release_line=1\.0$/m);
    assert.match(out, /^pubspec_version=1\.0\.0\+1$/m);
  });

  test('emits the release line the REAL apps/subly declares', () => {
    const { code, out } = run({ cwd: REPO, args: ['--emit', 'apps/subly'] });
    assert.equal(code, 0, out);
    assert.match(out, /^release_line=\d+\.\d+$/m);
  });

  // A deploy must never proceed on a guessed version.
  test('--emit FAILS rather than inventing a version when pubspec is unreadable', () => {
    const dir = lane('emit-bad', { version: null });
    const { code, out } = run({ cwd: dir, args: ['--emit', 'apps/subly'] });
    assert.equal(code, 1);
    assert.match(out, /no parseable `version: X\.Y\.Z`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --tag — the release tag must name the version the app declares.
//
// 🔴 READ THIS BEFORE TRUSTING A GREEN HERE. No tag has ever been pushed here
// (`git tag` → 0, measured 2026-08-27), so in CI this mode is UNEXECUTED CODE
// that reports nothing at all. These offline cases are the entire evidence that
// it can fail. A skip written one notch too broadly ("skip whenever the ref does
// not parse") reads `subly-untagged-abc1234` and `subly-vFOO` identically and
// swallows the exact tag the mode exists to catch. That variant was built and
// measured: it exits 0 on all four of `subly-vFOO`, `subly-v1.0`,
// `subly-v9.9.9.1` and `subly-nightly`, where the shipped guard exits 1 on
// every one.
describe('assert-app-versioning — --tag: the tag must name the declared version', () => {
  test('PASSES when the tag names the build name pubspec declares', () => {
    const { code, out } = run({ args: ['--tag', 'subly-v1.0.0', lane('tag-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /ok\s+tag ↔ pubspec/);
    assert.match(out, /build name 1\.0\.0/);
  });

  // The tree as it stands: the tag apps/subly's own pubspec implies must pass.
  test('PASSES against the REAL repository for the tag its pubspec implies', () => {
    const emitted = run({ cwd: REPO, args: ['--emit', 'apps/subly'] });
    assert.equal(emitted.code, 0, emitted.out);
    const raw = /^pubspec_version=(\S+)$/m.exec(emitted.out)[1];
    const { code, out } = run({ cwd: REPO, args: ['--tag', `subly-v${raw.split('+')[0]}`] });
    assert.equal(code, 0, out);
  });

  test('FAILS naming BOTH versions when the tag names a different one', () => {
    const { code, out } = run({ args: ['--tag', 'subly-v9.9.9', lane('tag-mismatch')] });
    assert.equal(code, 1);
    assert.match(out, /names version 9\.9\.9/);
    assert.match(out, /declares "1\.0\.0\+1"/);
  });

  test('is a NO-OP on the <app>-untagged-<sha> value a non-tag run synthesises', () => {
    const { code, out } = run({ args: ['--tag', 'subly-untagged-659380f', lane('tag-untagged')] });
    assert.equal(code, 0, out);
    assert.match(out, /claims no version/);
    assert.doesNotMatch(out, /ok\s+tag ↔ pubspec/);
  });

  // ── the six anti-swallow cases ─────────────────────────────────────────────
  for (const [name, tag, expected] of [
    ['a version claim that is not a number', 'subly-vFOO', /claims version "FOO"/],
    ['a two-part version', 'subly-v1.0', /claims version "1\.0"/],
    ['a four-part version', 'subly-v9.9.9.1', /claims version "9\.9\.9\.1"/],
    ['a tag that names no version at all', 'subly-nightly', /names no version/],
    ['an app that apps/ does not hold', 'probe-v1.0.0', /names app "probe"/],
    // 🔴 THE CASEFOLD SEAM. Measured, not assumed: the variant without the
    // exact directory-listing match exits 0 on this host and 1 under WSL2 ext4.
    // Matching the leaf EXACTLY against readdir makes both print the same line.
    ['a slug that differs only in case', 'SUBLY-v1.0.0', /names app "SUBLY"/],
  ]) {
    test(`FAILS rather than skipping on ${name}`, () => {
      const dir = lane(`tag-bad-${tag.replace(/[^a-z0-9]/gi, '_')}`);
      const { code, out } = run({ args: ['--tag', tag, dir] });
      assert.equal(code, 1, `expected a RED, got ${code}: ${out}`);
      assert.match(out, expected);
    });
  }

  test('compares the build NAME only — a tag carrying +N still passes', () => {
    const { code, out } = run({ args: ['--tag', 'subly-v1.0.0+7', lane('tag-plusn')] });
    assert.equal(code, 0, out);
  });

  test('FAILS rather than inventing a version when the pubspec is unreadable', () => {
    const dir = lane('tag-badspec', { version: null });
    const { code, out } = run({ args: ['--tag', 'subly-v1.0.0', dir] });
    assert.equal(code, 1);
    assert.match(out, /no parseable `version: X\.Y\.Z`/);
  });

  // 🔴 `--app` RELOCATES THE APP; UNTIL 2026-08-27 IT DISARMED TWO OF THE SIX ABOVE.
  test('an explicit --app RELOCATES which pubspec is read', () => {
    const dir = lane('tag-app-relocate', { extra: { 'packages/subly/pubspec.yaml': pubspec('2.3.4+1') } });
    const { code, out } = run({ args: ['--tag', 'subly-v2.3.4', '--app', 'packages/subly', dir] });
    assert.equal(code, 0, out);
    assert.match(out, /ok\s+tag ↔ pubspec/);
    assert.match(out, /packages\/subly\/pubspec\.yaml \("2\.3\.4\+1"\)/);
  });

  test('--app pointing at a DIFFERENT app does NOT excuse the slug', () => {
    const { code, out } = run({ args: ['--tag', 'probe-v1.0.0', '--app', 'apps/subly', lane('tag-app-probe')] });
    assert.equal(code, 1, `expected a RED, got ${code}: ${out}`);
    assert.match(out, /--app points at apps\/subly/);
  });

  test('--app does NOT excuse the casefold seam', () => {
    const { code, out } = run({ args: ['--tag', 'SUBLY-v1.0.0', '--app', 'apps/SUBLY', lane('tag-app-case')] });
    assert.equal(code, 1, `expected a RED, got ${code}: ${out}`);
    assert.match(out, /names app "SUBLY"/);
  });

  // 🔴 THE GREEN-WHILE-BROKEN THIS FILE WAS NEARLY SHIPPED WITH. `--tag` whose
  // shell variable had gone missing parsed as "no --tag at all", fell through to
  // the verify mode and printed `ok  app versioning` — exit 0 from a release
  // check that never read a tag, with nothing in the log to say so.
  for (const flag of ['--tag', '--emit']) {
    test(`${flag} with no value EXITS 2 rather than falling through to another check`, () => {
      const { code, out } = run({ args: [flag] });
      assert.equal(code, 2, out);
      assert.match(out, /was passed with no value/);
      assert.doesNotMatch(out, /^ok\s+app versioning/m);
    });
  }

  // 🔴 THE SAME FAILURE ONE LEVEL UP, MEASURED 2026-08-27: `--emit` answers and exits
  // above the --tag block, so both flags together exited 0 over a tag alone worth a 1.
  for (const [name, args] of [
    ['--emit then --tag', ['--emit', 'apps/subly', '--tag', 'subly-v9.9.9']],
    ['--tag then --emit', ['--tag', 'subly-v9.9.9', '--emit', 'apps/subly']],
  ]) {
    test(`REFUSES ${name} rather than answering for the flag it read first`, () => {
      const { code, out } = run({ cwd: lane('mode-collision'), args });
      assert.equal(code, 2, `expected a REFUSAL, got ${code}: ${out}`);
      assert.match(out, /--emit and --tag in one invocation/);
      assert.doesNotMatch(out, /^release_line=/m);
    });
  }

  for (const [name, args] of [
    ['with --emit', ['--emit', 'apps/subly', '--app', 'apps/subly']],
    ['with neither mode', ['--app', 'apps/subly']],
  ]) {
    test(`REFUSES --app ${name} rather than dropping it`, () => {
      const { code, out } = run({ cwd: lane('app-dropped'), args });
      assert.equal(code, 2, `expected a REFUSAL, got ${code}: ${out}`);
      assert.match(out, /--app was passed without --tag/);
      assert.doesNotMatch(out, /^release_line=/m);
      assert.doesNotMatch(out, /^ok\s+app versioning/m);
    });
  }
});
