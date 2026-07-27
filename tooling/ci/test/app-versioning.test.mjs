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
// So the primary evidence for this guard is 23 mutations applied to the REAL
// repository (freeze the version, drop --build-number, point the build number at
// the SHA, delete the derive step, break the scanner's own regex, …), every one
// of which was confirmed to fail with its own specific message. Two of those
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

function fixture(name, files) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
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
