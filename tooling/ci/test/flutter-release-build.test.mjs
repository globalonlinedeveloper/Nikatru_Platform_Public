// ─────────────────────────────────────────────────────────────────────────────
// flutter-release-build.test.mjs — tooling/ci/flutter-release-build.mjs is the one
// composition of a release `flutter build`, so each decision it makes is pinned
// here by the exact argv it produces, and each refusal by the input it names.
//
// The channel rows are a copy of the REAL tooling/channel-register.json, so a row
// or a `purchaseRails.storeKeyDefine` change reaches these cases; the app is a
// fixture app.yaml, so its API host is one this file controls.
//
// 🔴 The composed argv names env vars. A `${{` in any element is a secret's value
// (or an expression) in the command line itself — the case below reds on it.
//
// Run:  node --test tooling/ci/test/flutter-release-build.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  composeReleaseBuild, apiBaseUrl, appApiHost, printed, substitute, PLATFORM_API_BASE,
} from '../flutter-release-build.mjs';
import { flutterReleaseBuilds, flutterBuilds } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'flutter-release-build.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'flutter-release-build-'));
  mkdirSync(join(TMP, 'tooling'), { recursive: true });
  copyFileSync(join(REPO, 'tooling', 'channel-register.json'), join(TMP, 'tooling', 'channel-register.json'));
  mkdirSync(join(TMP, 'apps', 'fixture'), { recursive: true });
  writeFileSync(join(TMP, 'apps', 'fixture', 'app.yaml'), 'id: fixture\nhosts:\n  api: fixture-api.nikatru.com\n');
  mkdirSync(join(TMP, 'apps', 'nobackend'), { recursive: true });
  writeFileSync(join(TMP, 'apps', 'nobackend', 'app.yaml'), 'id: nobackend\nhosts:\n  web: nobackend.nikatru.com\n');
});
after(() => rmSync(TMP, { recursive: true, force: true }));

const compose = (target, channel, lane) => composeReleaseBuild({ root: TMP, app: 'fixture', channel, target, lane });

describe('the composition, one decision per case', () => {
  test('appbundle for android-play: symbols, build number, the Google store key, the app API host', () => {
    const c = compose('appbundle', 'android-play');
    assert.deepEqual(c.argv, [
      'build', 'appbundle', '--release',
      '--obfuscate', '--split-debug-info=build/symbols/android-aab',
      '--build-name=$RELEASE_LINE.$GITHUB_RUN_NUMBER', '--build-number=$GITHUB_RUN_NUMBER',
      '--dart-define=SUPABASE_URL=$SUPABASE_URL',
      '--dart-define=SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY',
      '--dart-define=API_BASE_URL=https://fixture-api.nikatru.com',
      '--dart-define=APP_VERSION=$RELEASE_LINE.$GITHUB_RUN_NUMBER+${GITHUB_SHA::7}',
      '--dart-define=RELEASE_CHANNEL=android-play',
      '--dart-define=REVENUECAT_KEY=$REVENUECAT_PUBLIC_KEY_GOOGLE',
      '--dart-define=GLITCHTIP_DSN=$GLITCHTIP_DSN',
    ]);
    assert.equal(c.symbolsDir, 'build/symbols/android-aab');
    assert.deepEqual(c.env, [
      'RELEASE_LINE', 'GITHUB_RUN_NUMBER', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GITHUB_SHA', 'REVENUECAT_PUBLIC_KEY_GOOGLE', 'GLITCHTIP_DSN',
    ]);
  });

  test('--lane pr blanks the backend and the crash sink, ends APP_VERSION with +pr, and KEEPS the store key', () => {
    const c = compose('apk', 'android-play', 'pr');
    assert.deepEqual(c.argv, [
      'build', 'apk', '--release',
      '--obfuscate', '--split-debug-info=build/symbols/android-apk',
      '--build-name=$RELEASE_LINE.$GITHUB_RUN_NUMBER', '--build-number=$GITHUB_RUN_NUMBER',
      '--dart-define=SUPABASE_URL=',
      '--dart-define=SUPABASE_ANON_KEY=',
      '--dart-define=API_BASE_URL=',
      '--dart-define=APP_VERSION=$RELEASE_LINE.$GITHUB_RUN_NUMBER+pr',
      '--dart-define=RELEASE_CHANNEL=android-play',
      '--dart-define=REVENUECAT_KEY=$REVENUECAT_PUBLIC_KEY_GOOGLE',
      '--dart-define=GLITCHTIP_DSN=',
    ]);
    assert.ok(!c.env.includes('SUPABASE_URL'), 'a blanked define reads no env var');
  });

  test('apps-gov-in: its own symbols directory, and no store key — its rail is keyed by nothing', () => {
    const c = compose('apk', 'apps-gov-in');
    assert.equal(c.symbolsDir, 'build/symbols/android-apk-apps-gov-in');
    assert.ok(c.argv.includes('--split-debug-info=build/symbols/android-apk-apps-gov-in'));
    assert.equal(c.argv.filter((a) => a.startsWith('--dart-define=REVENUECAT_KEY=')).length, 0);
    assert.ok(c.argv.includes('--dart-define=RELEASE_CHANNEL=apps-gov-in'));
  });

  test('ipa for ios-appstore: the export options plist by env name, and the Apple store key', () => {
    const c = compose('ipa', 'ios-appstore');
    assert.deepEqual(c.argv.slice(0, 7), [
      'build', 'ipa', '--release', '--export-options-plist', '$APPLE_EXPORT_OPTIONS_PLIST',
      '--obfuscate', '--split-debug-info=build/symbols/ios',
    ]);
    assert.ok(c.argv.includes('--dart-define=REVENUECAT_KEY=$REVENUECAT_PUBLIC_KEY_APPLE'));
    assert.ok(c.env.includes('APPLE_EXPORT_OPTIONS_PLIST'));
  });

  test('linux for linux-snap: a build name and NO --build-number', () => {
    const c = compose('linux', 'linux-snap');
    assert.ok(c.argv.includes('--build-name=$RELEASE_LINE.$GITHUB_RUN_NUMBER'));
    assert.equal(c.argv.filter((a) => a.startsWith('--build-number')).length, 0);
    assert.equal(c.symbolsDir, 'build/symbols/linux');
  });

  test('web: no obfuscation, the deploy flags, the base href by env name, Turnstile and APP_ENV', () => {
    const c = compose('web', 'web');
    assert.equal(c.symbolsDir, null);
    assert.equal(c.argv.filter((a) => a === '--obfuscate').length, 0);
    assert.deepEqual(c.argv.slice(0, 8), [
      'build', 'web', '--release', '--pwa-strategy=none', '--source-maps', '--no-web-resources-cdn', '--base-href', '$BASE_HREF',
    ]);
    assert.deepEqual(c.argv.slice(-2), ['--dart-define=TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY', '--dart-define=APP_ENV=production']);
    assert.ok(c.env.includes('BASE_HREF'));
  });

  test('no composed argv element carries a ${{ expression — secrets travel by NAME', () => {
    const all = [
      compose('appbundle', 'android-play'),
      compose('apk', 'android-play', 'pr'),
      compose('apk', 'apps-gov-in'),
      compose('ipa', 'ios-appstore'),
      compose('ios', 'ios-appstore'),
      compose('macos', 'macos-appstore'),
      compose('windows', 'windows-store'),
      compose('linux', 'linux-snap'),
      compose('web', 'web'),
    ].flatMap((c) => c.argv);
    assert.deepEqual(all.filter((a) => a.includes('${{')), []);
  });
});

describe('the API base rule', () => {
  test('an API host gives https://<host>; none gives the shared platform API', () => {
    assert.equal(apiBaseUrl('x-api.nikatru.com'), 'https://x-api.nikatru.com');
    assert.equal(apiBaseUrl(null), PLATFORM_API_BASE);
    assert.equal(apiBaseUrl('  '), PLATFORM_API_BASE);
    assert.equal(PLATFORM_API_BASE, 'https://platform.nikatru.com/v1');
  });

  test('an app.yaml without hosts.api composes the shared platform API', () => {
    assert.equal(appApiHost(TMP, 'nobackend'), null);
    const c = composeReleaseBuild({ root: TMP, app: 'nobackend', channel: 'android-play', target: 'appbundle' });
    assert.ok(c.argv.includes('--dart-define=API_BASE_URL=https://platform.nikatru.com/v1'));
  });
});

describe('refusals name the input', () => {
  test('a channel no register row declares', () => {
    assert.throws(() => compose('appbundle', 'android-sideload'), /"android-sideload" is not a channel row/);
  });

  test('a channel whose platforms do not include the target', () => {
    assert.throws(() => compose('appbundle', 'ios-appstore'), /channel "ios-appstore" ships \["ios"\], and `flutter build appbundle` produces android/);
  });

  test('a target the factory does not ship', () => {
    assert.throws(() => compose('aar', 'android-play'), /"aar" is not a flutter build target/);
  });

  test('a lane that is neither release nor pr', () => {
    assert.throws(() => compose('appbundle', 'android-play', 'staging'), /--lane "staging" is not one of release, pr/);
  });

  test('an app with no app.yaml', () => {
    assert.throws(
      () => composeReleaseBuild({ root: TMP, app: 'ghost', channel: 'android-play', target: 'appbundle' }),
      /apps\/ghost\/app\.yaml does not exist/,
    );
  });

  test('an app id that is not one', () => {
    assert.throws(
      () => composeReleaseBuild({ root: TMP, app: '../fixture', channel: 'android-play', target: 'appbundle' }),
      /"\.\.\/fixture" is not an app id/,
    );
  });
});

describe('substitute', () => {
  test('replaces each $NAME and ${GITHUB_SHA::7} through the lookup, and reports every name it could not', () => {
    const values = new Map([['SUPABASE_URL', 'https://s.example'], ['GITHUB_SHA::7', 'abc1234']]);
    const r = substitute(
      ['--dart-define=SUPABASE_URL=$SUPABASE_URL', '--dart-define=APP_VERSION=1.$GITHUB_RUN_NUMBER+${GITHUB_SHA::7}'],
      (name) => values.get(name) ?? null,
    );
    assert.deepEqual(r.argv, ['--dart-define=SUPABASE_URL=https://s.example', '--dart-define=APP_VERSION=1.$GITHUB_RUN_NUMBER+abc1234']);
    assert.deepEqual(r.missing, ['GITHUB_RUN_NUMBER']);
  });
});

describe('the CLI', () => {
  const run = (args, env) =>
    spawnSync(process.execPath, [SCRIPT, ...args, '--root', TMP], { encoding: 'utf8', ...(env === undefined ? {} : { env }) });

  test('--print prints exactly printed(argv) and exits 0', () => {
    const r = run(['fixture', 'appbundle', 'android-play', '--print']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), printed(compose('appbundle', 'android-play').argv));
  });

  test('--lane pr --print prints the PR composition', () => {
    const r = run(['fixture', 'apk', 'android-play', '--lane', 'pr', '--print']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), printed(compose('apk', 'android-play', 'pr').argv));
  });

  test('--emit-env API_BASE_URL prints the rule\'s value for the app', () => {
    const r = run(['--emit-env', 'API_BASE_URL', 'fixture']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'API_BASE_URL=https://fixture-api.nikatru.com');
  });

  test('--emit-env of any other name is refused', () => {
    const r = run(['--emit-env', 'SUPABASE_URL', 'fixture']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /API_BASE_URL is the one value it emits/);
  });

  test('a refused composition exits 1 with a FAIL line naming the input', () => {
    const r = run(['fixture', 'appbundle', 'android-sideload', '--print']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^FAIL "android-sideload" is not a channel row/);
  });

  test('run mode with the env names unset exits 1 BEFORE starting flutter, naming each', () => {
    const env = Object.fromEntries(
      Object.entries({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }).filter(([, v]) => v !== undefined),
    );
    const r = run(['fixture', 'appbundle', 'android-play'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^FAIL the environment does not set RELEASE_LINE, GITHUB_RUN_NUMBER, SUPABASE_URL, SUPABASE_ANON_KEY, GITHUB_SHA, REVENUECAT_PUBLIC_KEY_GOOGLE, GLITCHTIP_DSN;/);
  });
});

// ── THE CENSUS FOLLOWS THE CALL ──────────────────────────────────────────────
// A workflow that asks the composer for its build has no `flutter build` in its
// text. Each case below is a scratch tree with ONE workflow; the first pair is the
// same step twice — once the literal line, once the call — and the census must
// return the same record for both, or every reader grades a different build.

/** A scratch root: the real channel rows, one app.yaml per app, a pubspec
 *  workspace naming them, and `.github/workflows/build.yml`. */
function censusRoot(name, workflow, apps = ['fixture']) {
  const r = join(TMP, name);
  mkdirSync(join(r, 'tooling'), { recursive: true });
  copyFileSync(join(REPO, 'tooling', 'channel-register.json'), join(r, 'tooling', 'channel-register.json'));
  for (const app of apps) {
    mkdirSync(join(r, 'apps', app), { recursive: true });
    writeFileSync(join(r, 'apps', app, 'app.yaml'), `id: ${app}\nhosts:\n  api: ${app}-api.nikatru.com\n`);
  }
  writeFileSync(join(r, 'pubspec.yaml'), `name: workspace\nworkspace:\n${apps.map((a) => `  - apps/${a}\n`).join('')}`);
  mkdirSync(join(r, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(r, '.github', 'workflows', 'build.yml'), workflow);
  return r;
}

const STEP_ENV = [
  '        env:',
  '          RELEASE_LINE: ${{ steps.ver.outputs.release_line }}',
  '          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}',
  '          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}',
  '          REVENUECAT_PUBLIC_KEY_GOOGLE: ${{ secrets.REVENUECAT_PUBLIC_KEY_GOOGLE }}',
  '          GLITCHTIP_DSN: ${{ secrets.GLITCHTIP_DSN }}',
];

/** One job, one step, `run: <run>`; `matrix` is the `app:` value, or none. */
function buildWorkflow(run, { matrix = null, env = STEP_ENV } = {}) {
  return [
    'name: fixture',
    'on: workflow_dispatch',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    ...(matrix === null ? [] : ['    strategy:', '      matrix:', `        app: ${matrix}`]),
    '    steps:',
    '      - name: Build',
    ...env,
    `        run: ${run}`,
    '',
  ].join('\n');
}

const LITERAL =
  'flutter build appbundle --release --obfuscate --split-debug-info=build/symbols/android-aab' +
  ' --build-name=${{ steps.ver.outputs.release_line }}.${{ github.run_number }} --build-number=${{ github.run_number }}' +
  ' --dart-define=SUPABASE_URL=${{ secrets.SUPABASE_URL }} --dart-define=SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY }}' +
  ' --dart-define=API_BASE_URL=https://fixture-api.nikatru.com' +
  ' --dart-define=APP_VERSION=${{ steps.ver.outputs.release_line }}.${{ github.run_number }}+${GITHUB_SHA::7}' +
  ' --dart-define=RELEASE_CHANNEL=android-play --dart-define=REVENUECAT_KEY=${{ secrets.REVENUECAT_PUBLIC_KEY_GOOGLE }}' +
  ' --dart-define=GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}';
const CALL = 'node tooling/ci/flutter-release-build.mjs fixture appbundle android-play';

describe('the census follows the call', () => {
  test('a composer call yields the SAME record as the literal line it replaces', () => {
    const literal = flutterReleaseBuilds(censusRoot('census-literal', buildWorkflow(LITERAL)));
    const called = flutterReleaseBuilds(censusRoot('census-call', buildWorkflow(CALL)));
    assert.equal(literal.length, 1);
    assert.equal(called.length, 1);
    assert.deepEqual(called[0], literal[0]);
    assert.equal(called[0].stamp, 'android-play');
    assert.equal(called[0].platform, 'android');
  });

  test('the full census carries a composer call as mode `release`, and its release view is the same record', () => {
    const root = censusRoot('census-call-mode', buildWorkflow(CALL));
    const [full] = flutterBuilds(root);
    const [release] = flutterReleaseBuilds(root);
    assert.equal(full.mode, 'release');
    assert.deepEqual({ ...release, mode: 'release' }, full);
  });

  test('--print is not a build', () => {
    assert.deepEqual(flutterReleaseBuilds(censusRoot('census-print', buildWorkflow(`${CALL} --print`))), []);
  });

  test('--emit-env is not a build', () => {
    const root = censusRoot('census-emit', buildWorkflow('node tooling/ci/flutter-release-build.mjs --emit-env API_BASE_URL fixture'));
    assert.deepEqual(flutterReleaseBuilds(root), []);
  });

  test('a call the composer refuses THROWS, naming the workflow line and the refusal', () => {
    const root = censusRoot('census-refused', buildWorkflow('node tooling/ci/flutter-release-build.mjs fixture appbundle android-sideload'));
    assert.throws(
      () => flutterReleaseBuilds(root),
      /^Error: \.github\/workflows\/build\.yml:\d+: the composer refuses this call for app "fixture": "android-sideload" is not a channel row/,
    );
  });

  test('--lane pr is read: the backend is blank and APP_VERSION ends +pr', () => {
    const [b] = flutterReleaseBuilds(censusRoot('census-pr', buildWorkflow(`node tooling/ci/flutter-release-build.mjs fixture apk android-play --lane pr`)));
    assert.equal(b.target, 'apk');
    assert.match(b.segment, / --dart-define=SUPABASE_URL= /);
    assert.match(b.segment, /--dart-define=APP_VERSION=\$\{\{ steps\.ver\.outputs\.release_line \}\}\.\$\{\{ github\.run_number \}\}\+pr /);
  });

  test('a name no env block maps stays $NAME, and the run number is GitHub\'s own', () => {
    const [b] = flutterReleaseBuilds(censusRoot('census-noenv', buildWorkflow(CALL, { env: [] })));
    assert.match(b.segment, /--dart-define=SUPABASE_URL=\$SUPABASE_URL /);
    assert.match(b.segment, /--build-number=\$\{\{ github\.run_number \}\} /);
  });

  test('${{ matrix.app }} over a literal list is one record per app, each with its own API base', () => {
    const root = censusRoot(
      'census-matrix-list',
      buildWorkflow('node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} appbundle android-play', { matrix: '[fixture, other]' }),
      ['fixture', 'other'],
    );
    const builds = flutterReleaseBuilds(root);
    assert.equal(builds.length, 2);
    assert.match(builds[0].segment, /API_BASE_URL=https:\/\/fixture-api\.nikatru\.com /);
    assert.match(builds[1].segment, /API_BASE_URL=https:\/\/other-api\.nikatru\.com /);
  });

  test('${{ matrix.app }} over an expression matrix is the workspace app set', () => {
    const root = censusRoot(
      'census-matrix-expr',
      buildWorkflow('node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} appbundle android-play', { matrix: '${{ fromJSON(needs.apps.outputs.apps) }}' }),
      ['fixture', 'other', 'third'],
    );
    assert.equal(flutterReleaseBuilds(root).length, 3);
  });

  test('a matrix key the job does not declare THROWS', () => {
    const root = censusRoot('census-matrix-missing', buildWorkflow('node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} appbundle android-play'));
    assert.throws(() => flutterReleaseBuilds(root), /the composer's app is matrix\.app, which job "build" does not declare/);
  });

  test('a call behind a shell comment is not a build', () => {
    assert.deepEqual(flutterReleaseBuilds(censusRoot('census-comment', buildWorkflow(`echo skipped # ${CALL}`))), []);
  });
});
