// ─────────────────────────────────────────────────────────────────────────────
// store-build-config.test.mjs — assert-store-build-config.mjs must be able to FAIL.
//
// The guard exists because the .aab built for Google Play passed exactly one
// dart-define, so `AppConfig.isBackendLive` stayed false and the store artifact
// shipped mock auth and seeded data. Seven store build steps across four
// workflows were affected, and every check in the tree was green.
//
// 🔬 THE TWO THINGS WORTH BREAKING are the two DERIVATIONS, because those are
// what stop the guard freezing at today's answer:
//   · the required defines, followed out of `isBackendLive` through
//     app_config.dart — a fourth requirement added there must be enforced
//     WITHOUT editing the guard, and a renamed getter must be COVERAGE LOST
//     rather than an empty requirement every lane satisfies;
//   · the subject lanes, read out of each `kind: store` row's own
//     `lane`/`submission` — a guard pointed at a lane nobody ships from is this
//     repository's most-recorded failure.
//
// ⚠️ RECORDED MUTATIONS AGAINST THE REAL TREE are in the PR. These fixtures are
// the regression net; the real-tree run is the proof.
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
const GUARD = join(CI_DIR, 'assert-store-build-config.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-storecfg-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** The real chassis shape: placeholder-defaulted fields behind two getters. */
const CONFIG = `
class AppConfig {
  static const String supabaseUrl = String.fromEnvironment('SUPABASE_URL', defaultValue: _ph);
  static const String supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '');
  static const String apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: _phApi);
  static const String appVersion = String.fromEnvironment('APP_VERSION', defaultValue: 'dev');
  static bool get isSupabaseConfigured => supabaseUrl != _ph && supabaseAnonKey.isNotEmpty;
  static bool get isApiConfigured => apiBaseUrl != _phApi;
  static bool get isBackendLive => isSupabaseConfigured && isApiConfigured;
}
`;

const ALL = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL'];

const buildStep = (target, defines) => `      - name: Build ${target}
        run: >
          flutter build ${target} --release
${defines.map((d) => `          --dart-define=${d}=\${{ secrets.${d} }}`).join('\n')}
`;

function makeRoot({
  config = CONFIG,
  defines = ALL,
  target = 'appbundle',
  platforms = ['android'],
  kind = 'store',
  lane = { workflow: '.github/workflows/build.yml', job: 'android' },
  submission = null,
  extraJob = '',
} = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'apps', 'subly', 'lib', 'core', 'config'), { recursive: true });

  writeFileSync(join(root, 'sites', '_shared', '_data', 'apps.json'), JSON.stringify([{ slug: 'subly' }]));
  if (config !== null) writeFileSync(join(root, 'apps', 'subly', 'lib', 'core', 'config', 'app_config.dart'), config);

  const row = { id: 'android-play', kind, platforms, artifactFormats: ['.aab'] };
  if (lane) row.lane = lane;
  if (submission) row.submission = submission;
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels: [row] }));

  writeFileSync(
    join(root, '.github', 'workflows', 'build.yml'),
    `name: build\non:\n  push:\npermissions:\n  contents: read\njobs:\n  android:\n    runs-on: ubuntu-24.04\n    steps:\n${buildStep(target, defines)}${extraJob}`,
  );
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-store-build-config — the happy path really passes', () => {
  test('a store lane passing all three defines is clean', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 store build step\(s\)/);
  });

  test('the summary NAMES the derived set and the getter chain it came from', () => {
    const r = run(makeRoot());
    assert.match(out(r), /isBackendLive/);
    for (const d of ALL) assert.match(out(r), new RegExp(d));
  });

  test('it prints that it cannot see the VALUES — a staging URL passes here', () => {
    assert.match(out(run(makeRoot())), /VALUES ARE NOT CHECKED/);
  });
});

describe('assert-store-build-config — every derived define is load-bearing', () => {
  for (const missing of ALL) {
    test(`FAILS when ${missing} is the one define left off`, () => {
      const r = run(makeRoot({ defines: ALL.filter((d) => d !== missing) }));
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), new RegExp(`does not pass ${missing}`));
    });
  }

  test('FAILS when the step passes no defines at all, and names every one', () => {
    const r = run(makeRoot({ defines: [] }));
    assert.equal(r.status, 1, out(r));
    for (const d of ALL) assert.match(out(r), new RegExp(d));
    assert.match(out(r), /mock auth and seeded data/);
  });

  test('a define the getter does NOT reach is not demanded — APP_VERSION is absent and this passes', () => {
    // The rule is derived, not "every define deploy-web.yml happens to pass".
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /APP_VERSION/);
  });

  test('a FOURTH requirement added to isBackendLive is enforced with NO edit to the guard', () => {
    const extended = CONFIG
      .replace(
        "static const String appVersion",
        "static const String platformBase = String.fromEnvironment('PLATFORM_BASE_URL', defaultValue: _phPlatform);\n  static bool get isPlatformConfigured => platformBase != _phPlatform;\n  static const String appVersion",
      )
      .replace('=> isSupabaseConfigured && isApiConfigured;', '=> isSupabaseConfigured && isApiConfigured && isPlatformConfigured;');
    const r = run(makeRoot({ config: extended }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /does not pass PLATFORM_BASE_URL/);
  });
});

describe('assert-store-build-config — the subject set is derived from the register', () => {
  test('a NON-store row is not graded — the six-platform proof is not a store lane', () => {
    const r = run(makeRoot({ kind: 'direct', defines: [] }));
    assert.equal(r.status, 1, out(r));
    // Not a define failure: with no store rows at all the guard must refuse to
    // report clean rather than sweep an empty set.
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /no `kind: "store"` channel/);
  });

  test('a build for ANOTHER platform in the same job is not this row\'s artifact', () => {
    // `flutter build web` inside the android row's lane must not be graded
    // against the android row — build-platforms.yml really is shaped this way.
    const root = makeRoot({
      extraJob: '      - name: Build web\n        run: flutter build web --release\n',
    });
    const r = run(root);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 store build step\(s\)/);
  });

  test('a DEBUG build is not a store artifact', () => {
    const root = makeRoot({
      defines: [],
      extraJob: '',
      target: 'appbundle',
    });
    // rewrite the single step to a debug build
    const wf = join(root, '.github', 'workflows', 'build.yml');
    writeFileSync(
      wf,
      'name: build\non:\n  push:\npermissions:\n  contents: read\njobs:\n  android:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Build\n        run: flutter build appbundle --debug\n',
    );
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    // Nothing graded -> COVERAGE LOST, never a quiet pass.
    assert.match(out(r), /ZERO graded build steps/);
  });

  test('a SUBMISSION job is graded as well as a lane — both ship an artifact', () => {
    const r = run(makeRoot({
      lane: null,
      submission: { workflow: '.github/workflows/build.yml', job: 'android' },
      defines: [],
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /submission job "android"/);
  });

  test('a row whose declared job builds nothing for its platform PRINTS rather than fails', () => {
    const r = run(makeRoot({ platforms: ['ios'], defines: ALL }));
    assert.equal(r.status, 1, out(r));
    // No graded steps at all -> COVERAGE LOST, and the row is named.
    assert.match(out(r), /android-play/);
  });

  test('a declared job that does not exist is a failure, not a silent skip', () => {
    const r = run(makeRoot({ lane: { workflow: '.github/workflows/build.yml', job: 'ghost' } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares lane job "ghost"/);
  });

  test('a declared workflow that does not exist is a failure, not a silent skip', () => {
    const r = run(makeRoot({ lane: { workflow: '.github/workflows/nope.yml', job: 'android' } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /which this scan did not parse/);
  });
});

describe('assert-store-build-config — coverage self-checks', () => {
  test('COVERAGE LOST when app_config.dart is gone from every app', () => {
    const r = run(makeRoot({ config: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when isBackendLive is renamed — the requirement would be EMPTY', () => {
    const r = run(makeRoot({ config: CONFIG.replace('get isBackendLive', 'get isBackendReady') }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no `isBackendLive` getter/);
  });

  test('COVERAGE LOST when isBackendLive reaches no define at all', () => {
    const r = run(makeRoot({ config: CONFIG.replace('=> isSupabaseConfigured && isApiConfigured;', '=> true;') }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /reaches ZERO dart-defines/);
  });

  test('COVERAGE LOST when the register is missing', () => {
    const root = makeRoot();
    rmSync(join(root, 'tooling', 'channel-register.json'));
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no store row declares a lane or a submission', () => {
    const r = run(makeRoot({ lane: null, submission: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /NOT ONE declares a `lane` or `submission`/);
  });

  test('an empty evaluation set is never reported as a pass', () => {
    const r = run(makeRoot({ lane: null, submission: null }));
    assert.doesNotMatch(out(r), /assert-store-build-config: OK/);
  });
});
