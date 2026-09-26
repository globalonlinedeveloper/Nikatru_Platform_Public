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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

/** The two layouts an app_config lives in, in the register order — the SAME
 *  declaration assert-store-metadata.mjs reads. apps/subscriptiontracker kept
 *  `lib/core/config/app_config.dart`; the brick stamps `lib/core/app_config.dart`.
 *  The guard used to hard-code the first, which made a de-duplicated app
 *  COVERAGE LOST while being perfectly correct. */
const APP_CONFIG_PATHS = [
  'apps/{app}/lib/core/config/app_config.dart',
  'apps/{app}/lib/core/app_config.dart',
];

/** ⏱ 2026-09-22 — `channel` IS NOW PART OF EVERY FIXTURE BUILD. The guard's domain
 *  is no longer "a job a row declares" but the RELEASE_CHANNEL each build stamps into
 *  itself (workflow-scan.mjs `flutterReleaseBuilds`), so a fixture step with no stamp is
 *  a build the census cannot place — a real state, which now has its own test below
 *  instead of being the accidental shape of every other one. */
const buildStep = (target, defines, channel = 'android-play') => `      - name: Build ${target}
        run: >
          flutter build ${target} --release
${channel === null ? '' : `          --dart-define=RELEASE_CHANNEL=${channel}\n`}${defines.map((d) => `          --dart-define=${d}=\${{ secrets.${d} }}`).join('\n')}
`;

function makeRoot({
  config = CONFIG,
  configLayout = 'live',
  appConfigPaths = APP_CONFIG_PATHS,
  defines = ALL,
  target = 'appbundle',
  platforms = ['android'],
  kind = 'store',
  channelId = 'android-play',
  channel = 'android-play',
  exemptions = [],
  extraRows = [],
  lane = { workflow: '.github/workflows/build.yml', job: 'android' },
  submission = null,
  extraJob = '',
  web = null,
  extraLib = null,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'apps', 'subscriptiontracker', 'lib', 'core', 'config'), { recursive: true });

  writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify([{ slug: 'subscriptiontracker' }]));
  if (config !== null) {
    const rel = configLayout === 'stamp'
      ? join('apps', 'subscriptiontracker', 'lib', 'core', 'app_config.dart')
      : join('apps', 'subscriptiontracker', 'lib', 'core', 'config', 'app_config.dart');
    writeFileSync(join(root, rel), config);
  }

  const row = { id: channelId, kind, platforms, artifactFormats: ['.aab'], surface: 'app' };
  if (lane) row.lane = lane;
  if (submission) row.submission = submission;
  const channels = [row, ...extraRows];
  // [ADR 084] fixtures: a `web` row whose lane builds web, and a captcha import.
  if (web) {
    channels.push({ id: 'web', kind: 'web', platforms: ['web'], surface: 'app', lane: { workflow: '.github/workflows/web.yml', job: 'deploy-web' } });
    writeFileSync(
      join(root, '.github', 'workflows', 'web.yml'),
      `name: web\non:\n  push:\npermissions:\n  contents: read\njobs:\n  deploy-web:\n    runs-on: ubuntu-24.04\n    steps:\n${buildStep('web', web.defines, 'web')}`,
    );
  }
  if (extraLib) {
    for (const [rel, text] of Object.entries(extraLib)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
  }
  // `storeMetadataContract.appConfigPaths` is where BOTH this guard and
  // assert-store-metadata.mjs learn the layouts. A fixture that omits it
  // would exercise a fallback the real register never takes.
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({
    channels,
    storeMetadataContract: { appConfigPaths },
    // `surfaces` is what partitionByFlutterApp reads. A row whose surface the register
    // does not declare is COVERAGE LOST, never a quiet exclusion.
    surfaces: { app: { flutterApp: true }, extension: { flutterApp: false } },
    releaseBuildsNeverShipped: { entries: exemptions },
  }));

  writeFileSync(
    join(root, '.github', 'workflows', 'build.yml'),
    `name: build\non:\n  push:\npermissions:\n  contents: read\njobs:\n  android:\n    runs-on: ubuntu-24.04\n    steps:\n${buildStep(target, defines, channel)}${extraJob}`,
  );
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-store-build-config — the happy path really passes', () => {
  test('a store lane passing all three defines is clean', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 of 1 release build step\(s\)/);
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

describe('assert-store-build-config — the subject set is the census, placed by the register', () => {
  test('a kind: direct row IS graded — the build a direct download ships from is not a proof build', () => {
    // ⏱ 2026-09-22, O-DIRECT-DOWNLOADS-NEVER-GRADED. This case is the whole defect:
    // linux-appimage declares no lane at all, so the OLD domain never reached it and
    // the Linux build stamped for it carried no backend defines — a demo build the
    // day the row is served (latent: served:false at 097e1f6e).
    const r = run(makeRoot({ kind: 'direct', channelId: 'linux-appimage', channel: 'linux-appimage', platforms: ['linux'], target: 'linux', lane: null, defines: [] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /channel "linux-appimage"/);
    for (const d of ALL) assert.match(out(r), new RegExp(`does not pass[^\\n]*${d}`));
  });

  test('a job NO row declares is graded — the submission job is not exempt for being unnamed', () => {
    // ⏱ 2026-09-22, O-STORE-BUILD-GUARD-GRADES-DECLARED-JOBS-ONLY. Measured at f88912e5:
    // deleting SUPABASE_URL from submit-play.yml's `submit` job left the guard exiting 0.
    const r = run(makeRoot({ lane: null, submission: null, defines: [] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /job "android"/);
  });

  test('a row of a kind that ships nothing leaves the domain empty — and that is COVERAGE LOST', () => {
    const r = run(makeRoot({ kind: 'web', defines: [] }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /no `kind: "store"` or `kind: "direct"` channel/);
  });

  test('a build the census cannot place is PRINTED, never graded and never silently dropped', () => {
    // `flutter build web` with no RELEASE_CHANNEL beside the stamped android build:
    // build-platforms.yml really is shaped this way. It is assert-channel-register 6b's
    // finding, not this guard's, so this guard names it and grades on.
    const r = run(makeRoot({
      extraJob: '      - name: Build web\n        run: flutter build web --release\n',
    }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 of 2 release build step\(s\)/);
    assert.match(out(r), /could not be placed against a channel row/);
    assert.match(out(r), /unstamped/);
  });

  test('a build stamped for a row whose platforms exclude it is not that row\'s artifact', () => {
    const r = run(makeRoot({ platforms: ['ios'], defines: ALL }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /android-play/);
    assert.match(out(r), /platform-mismatch/);
  });

  test('an EXEMPT build is not graded, and its reason is printed every run', () => {
    const r = run(makeRoot({
      defines: [],
      exemptions: [{ workflow: '.github/workflows/build.yml', job: 'android', why: 'a compile proof whose output is discarded.' }],
    }));
    // Nothing left to grade -> COVERAGE LOST rather than a quiet pass, and the
    // exemption is named so an excuse nobody reads cannot masquerade as coverage.
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /a compile proof whose output is discarded/);
  });

  test('a DEBUG build is not a release build — e2e compiles, it does not ship', () => {
    const root = makeRoot({ defines: [], extraJob: '', target: 'appbundle' });
    const wf = join(root, '.github', 'workflows', 'build.yml');
    writeFileSync(
      wf,
      'name: build\non:\n  push:\npermissions:\n  contents: read\njobs:\n  android:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Build\n        run: flutter build appbundle --debug\n',
    );
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /NOT ONE release `flutter build` was found/);
  });

  test('a row whose id nothing stamps PRINTS rather than fails', () => {
    // linux-snap ingests a prebuilt artifact ([ADR 015] §3) and windows-direct
    // declares a `.exe` nothing packages: both are real, neither is a failure.
    const r = run(makeRoot({ extraRows: [{ id: 'windows-direct', kind: 'direct', platforms: ['windows'], surface: 'app' }] }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /channel "windows-direct" \[direct\] — NOT ONE release `flutter build`/);
  });

  test('an EXTENSION-surface row is outside the rule by construction, and says so', () => {
    const r = run(makeRoot({ extraRows: [{ id: 'amo', kind: 'store', platforms: ['firefox'], surface: 'extension' }] }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /not a Flutter-app surface/);
    assert.doesNotMatch(out(r), /channel "amo" \[store\] — NOT ONE/);
  });

  test('a row whose surface the register does not declare is COVERAGE LOST, not a quiet skip', () => {
    const r = run(makeRoot({ extraRows: [{ id: 'mystery', kind: 'store', platforms: ['android'] }] }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declare no surface this scan can resolve/);
  });

  test('a declared lane pointing at a job that does not exist is a failure, not a silent skip', () => {
    const r = run(makeRoot({ lane: { workflow: '.github/workflows/build.yml', job: 'ghost' } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares lane job "ghost"/);
  });

  test('a declared lane pointing at a workflow that does not exist is a failure', () => {
    const r = run(makeRoot({ lane: { workflow: '.github/workflows/nope.yml', job: 'android' } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /nope\.yml/);
  });
});

describe('assert-store-build-config — coverage self-checks', () => {
  test('COVERAGE LOST when app_config.dart is gone from every app', () => {
    const r = run(makeRoot({ config: null }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  // 🔴 THE NEGATIVE TEST FOR THE 2026-08-08 LAYOUT FIX ([ADR 037] P2.5).
  // Before it the lookup was the single hard-coded
  // `apps/<slug>/lib/core/config/app_config.dart`, and THIS EXACT ROOT exited 1
  // with "not one app_config.dart was read" — a correct tree failing a guard
  // that had memorised the layout the app was moving off. Remove the stamped
  // entry from APP_CONFIG_PATHS and this goes red again, which is the point.
  test('the STAMPED layout is found too — a de-duplicated app is not COVERAGE LOST', () => {
    const r = run(makeRoot({ configLayout: 'stamp' }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /isBackendLive/);
  });

  test('COVERAGE LOST when the register declares no app_config layout at all', () => {
    const r = run(makeRoot({ appConfigPaths: [] }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /appConfigPaths is missing, empty/);
  });

  test('COVERAGE LOST when isBackendLive is renamed — the requirement would be EMPTY', () => {
    const r = run(makeRoot({ config: CONFIG.replace('get isBackendLive', 'get isBackendReady') }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /declares no `isBackendLive` getter/);
  });

  test('COVERAGE LOST when isBackendLive reaches no define at all', () => {
    const r = run(makeRoot({ config: CONFIG.replace('=> isSupabaseConfigured && isApiConfigured;', '=> true;') }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /reaches ZERO dart-defines/);
  });

  test('COVERAGE LOST when the register is missing', () => {
    const root = makeRoot();
    rmSync(join(root, 'tooling', 'channel-register.json'));
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no release build in the tree stamps a channel that exists', () => {
    const r = run(makeRoot({ channel: 'a-channel-no-row-declares' }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /NOT ONE was placed against a `store` or `direct` channel row/);
  });

  test('an empty evaluation set is never reported as a pass', () => {
    // A build that stamps NO channel is a build the census cannot place, so the
    // domain is empty — which must never read as "everything checked out".
    const r = run(makeRoot({ channel: null }));
    assert.doesNotMatch(out(r), /assert-store-build-config: OK/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-15 · [ADR 084] — the web-only captcha key, graded BOTH ways.
// Owner: "Store builds skip it". Each case declared on its own (assert-no-loop-cases).
// ─────────────────────────────────────────────────────────────────────────────
const TURNSTILE_CONFIG = CONFIG.replace(
  'static bool get isBackendLive',
  "static const String turnstileSiteKey = String.fromEnvironment('TURNSTILE_SITE_KEY');\n  static bool get isTurnstileConfigured => turnstileSiteKey.isNotEmpty;\n  static bool get isBackendLive",
);
const GATE = { 'apps/subscriptiontracker/lib/features/auth/turnstile_gate.dart': "import 'package:cloudflare_turnstile/cloudflare_turnstile.dart';\nclass TurnstileGate {}\n" };
const WEB_OK = { defines: [...ALL, 'TURNSTILE_SITE_KEY'] };

describe('assert-store-build-config — [ADR 084] the captcha key is WEB-ONLY', () => {
  test('green: the web lane passes the key and the store lane does not', () => {
    const r = run(makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: WEB_OK }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /web-only define\(s\) TURNSTILE_SITE_KEY via subscriptiontracker: isTurnstileConfigured: passed by 1 web build step\(s\), refused on 1 store build step\(s\)/);
  });

  test('W1 FAILS when the web lane does not pass the key — a keyless web build is an error', () => {
    const r = run(makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: { defines: ALL } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /W1 \.github\/workflows\/web\.yml:\d+ \(web channel "web", lane job "deploy-web", `flutter build web`\) does not pass TURNSTILE_SITE_KEY/);
  });

  test('W2 FAILS when a store lane starts passing the key', () => {
    const r = run(makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: WEB_OK, defines: [...ALL, 'TURNSTILE_SITE_KEY'] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /W2 \.github\/workflows\/build\.yml:\d+ \(channel "android-play".*passes TURNSTILE_SITE_KEY/);
  });

  test('W3 FAILS when a second file under lib/ reads the define itself', () => {
    const r = run(makeRoot({
      config: TURNSTILE_CONFIG,
      web: WEB_OK,
      extraLib: { ...GATE, 'apps/subscriptiontracker/lib/features/auth/login.dart': "const k = String.fromEnvironment('TURNSTILE_SITE_KEY');\n" },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /W3 apps\/subscriptiontracker\/lib\/features\/auth\/login\.dart reads String\.fromEnvironment\('TURNSTILE_SITE_KEY'\) itself/);
  });

  test('W4 FAILS when isBackendLive also reaches the web-only key', () => {
    const both = TURNSTILE_CONFIG.replace('=> isSupabaseConfigured && isApiConfigured;', '=> isSupabaseConfigured && isApiConfigured && isTurnstileConfigured;');
    const r = run(makeRoot({ config: both, extraLib: GATE, web: WEB_OK, defines: [...ALL, 'TURNSTILE_SITE_KEY'] }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /W4 TURNSTILE_SITE_KEY is reached by BOTH/);
  });

  test('COVERAGE LOST when the app imports the captcha and declares no isTurnstileConfigured', () => {
    const r = run(makeRoot({ config: CONFIG, extraLib: GATE, web: WEB_OK }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — .*declares no `isTurnstileConfigured` getter\. — and .*turnstile_gate\.dart import\(s\) the captcha package/);
  });

  test('COVERAGE LOST when a web-only key exists and no web lane builds web', () => {
    const r = run(makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — 1 web-only define\(s\) \(TURNSTILE_SITE_KEY\) and ZERO release `flutter build web` steps were graded/);
  });

  test('COVERAGE LOST when the only web build is a DEBUG build — e2e is not the web lane', () => {
    const root = makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: WEB_OK });
    writeFileSync(
      join(root, '.github', 'workflows', 'web.yml'),
      'name: web\non:\n  push:\npermissions:\n  contents: read\njobs:\n  deploy-web:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Build\n        run: flutter build web --debug --dart-define=TURNSTILE_SITE_KEY=x\n',
    );
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /ZERO release `flutter build web` steps were graded/);
  });

  // ⏱ ADDED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): W1 reads the
  // census. A web build made through tooling/ci/flutter-release-build.mjs has no
  // `flutter build web` in its text; the raw line test graded ZERO web steps for it
  // and exited 2. The composer passes the key on every web build, so a composed
  // web lane can only pass W1 — what it proves is that the build is graded at all.
  test('a web lane that builds through the composer is graded, and passes the key', () => {
    const root = makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: WEB_OK });
    writeFileSync(
      join(root, '.github', 'workflows', 'web.yml'),
      'name: web\non:\n  push:\npermissions:\n  contents: read\njobs:\n  deploy-web:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Build\n        run: node tooling/ci/flutter-release-build.mjs subscriptiontracker web web\n',
    );
    const regPath = join(root, 'tooling', 'channel-register.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.purchaseRails = { storeKeyDefine: { define: 'STORE_KEY', secretByRail: {} } };
    writeFileSync(regPath, JSON.stringify(reg));
    writeFileSync(join(root, 'apps', 'subscriptiontracker', 'app.yaml'), 'id: subscriptiontracker\nhosts:\n  api: subscriptiontracker-api.nikatru.com\n');
    const r = run(root);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /passed by 1 web build step\(s\), refused on 1 store build step\(s\)/);
  });

  test('W1 grades each build on a line by its own defines — a keyed build does not answer for a keyless one', () => {
    const root = makeRoot({ config: TURNSTILE_CONFIG, extraLib: GATE, web: WEB_OK });
    const base = 'flutter build web --release --dart-define=RELEASE_CHANNEL=web --dart-define=SUPABASE_URL=x --dart-define=SUPABASE_ANON_KEY=x --dart-define=API_BASE_URL=x';
    writeFileSync(
      join(root, '.github', 'workflows', 'web.yml'),
      `name: web\non:\n  push:\npermissions:\n  contents: read\njobs:\n  deploy-web:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: Build\n        run: |\n          ${base} --dart-define=TURNSTILE_SITE_KEY=x\n          ${base}\n`,
    );
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /W1 \.github\/workflows\/web\.yml:\d+ \(web channel "web", lane job "deploy-web", `flutter build web`\) does not pass TURNSTILE_SITE_KEY/);
  });

  test('an app with NO captcha and no getter grades nothing web-only, and says so', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /no `isTurnstileConfigured` and no captcha import under apps\/subscriptiontracker\/lib/);
  });
});
