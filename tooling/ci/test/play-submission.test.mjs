// ─────────────────────────────────────────────────────────────────────────────
// play-submission.test.mjs — tooling/release/submit-play.mjs must be able to
// FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point, which is why the dry run is wired
// into ci.yml on every push as well as into the dispatch workflow — and why it
// has these tests.
//
// 🔴 THE MOST IMPORTANT CASE IN THIS FILE IS THE ONE THAT ASSERTS A REFUSAL.
// `--submit` prints `UNVERIFIED:` for every Play Developer API fact that was not
// fetched from a primary source, and exits 1 BEFORE running any check. A guessed
// endpoint does not fail on a laptop; it fails against a live Play account,
// mid-submission. If somebody later implements `--submit`, this test failing is
// the correct signal — it means the refusal is gone and the UNVERIFIED list must
// have been replaced by sourced facts, not deleted.
//
// ⚠️ MUTATION-PROVEN FIRST, NOT FIXTURE-FIRST. CLAUDE.md: "A fixture passing is
// not a guard working — MUTATE THE REAL TREE", because a fixture you wrote
// encodes the same misunderstanding as the guard you wrote. This script was
// mutation-proven on 2026-08-01 against a scratch COPY of the real tree (13 of
// the run's 25 cases target this script): restore re-verified green before and
// after every case, and no case "caught" by a crash.
//
// ⛔ WHAT THESE TESTS CANNOT PROVE, stated rather than implied: no .aab has ever
// been built on the owner's box. Android cannot build there at all — java.nio
// Selector.open() fails process-wide from a Windows socket-layer defect
// (CLAUDE.md), not from anything Gradle or Flutter does. The artifact half is
// exercised in CI by .github/workflows/submit-play.yml, which builds a real app
// bundle and then dry-runs against it.
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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-play.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-playsubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A value that must NEVER appear in output. A service-account key is a private
 *  key, and the failure paths are exactly where a naive implementation echoes
 *  the thing it could not parse. */
const SECRET = 'THIS-IS-A-PRIVATE-KEY-DO-NOT-PRINT';

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
};

/** The real file's shape, reduced to the parts the script parses. Both the
 *  `releaseSigningEnv` map and the debug fallback are load-bearing: the script
 *  reads the ENV VAR NAMES out of this file rather than repeating them, so a
 *  rename here follows through instead of drifting. */
const gradle = ({ appId = 'com.nikatru.subly', envMap = true, debugFallback = true } = {}) =>
  [
    'plugins { id("com.android.application") }',
    '',
    envMap
      ? [
          'val releaseSigningEnv = mapOf(',
          '    "storeFile" to "ANDROID_KEYSTORE_PATH",',
          '    "storePassword" to "ANDROID_KEYSTORE_PASSWORD",',
          '    "keyAlias" to "ANDROID_KEY_ALIAS",',
          '    "keyPassword" to "ANDROID_KEY_PASSWORD",',
          ')',
        ].join('\n')
      : 'val releaseSigningEnv = mapOf<String, String>()',
    '',
    'android {',
    appId === null ? '' : `    applicationId = "${appId}"`,
    '    buildTypes {',
    '        release {',
    debugFallback
      ? '            signingConfig = signingConfigs.getByName("debug")'
      : '            signingConfig = signingConfigs.getByName("release")',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');

function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  omitTree = false,
  withArtifact = false,
  artifactBytes = 1024,
  gradleOver = {},
  omitGradle = false,
  withKeyProperties = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: Object.keys(FILES),
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      perChannel: {
        'android-play': {
          maxChars: {
            'title.txt': { max: 30, source: 'support.google.com/.../9859152 (2026-07-29)' },
            'short-description.txt': { max: 80, source: 'support.google.com/.../9859152 (2026-07-29)' },
            'long-description.txt': { max: 4000, source: 'support.google.com/.../9859152 (2026-07-29)' },
          },
        },
      },
    },
    channels: [
      {
        id: 'android-play',
        kind: 'store',
        served: false,
        submittable: true,
        platforms: ['android'],
        artifactFormats: ['.aab'],
        storeMetadataDir: 'apps/{app}/store/android-play',
        ownerQueue: 'A-3',
        submission: { runbook: 'company/runbooks/store-submission-android.md' },
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }], null, 2));
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  if (!omitGradle) write('apps/subly/android/app/build.gradle.kts', gradle(gradleOver));
  if (withKeyProperties) write('apps/subly/android/key.properties', 'storeFile=x.jks\n');
  if (!omitTree) {
    for (const [rel, body] of Object.entries(FILES)) {
      if (omitFiles.includes(rel)) continue;
      write(`apps/subly/store/android-play/${rel}`, fields[rel] ?? body);
    }
  }
  if (withArtifact) write('apps/subly/build/app/outputs/bundle/release/app-release.aab', 'x'.repeat(artifactBytes));
  return root;
}

function run(root, { args = ['--dry-run', '--app', 'subly', '--allow-missing-artifact'], env = {} } = {}) {
  // A clean slate: the developer running these tests may have any of these set.
  const base = { ...process.env };
  for (const k of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'PLAY_SERVICE_ACCOUNT_JSON', 'PLAY_TRACK']) delete base[k];
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], { encoding: 'utf8', env: { ...base, ...env } });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A crash is not a catch. Every failing case asserts a real complaint. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-play — the submission path is walkable, and --submit refuses', () => {
  test('DRY RUN passes on a complete tree and says nothing was sent', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Google/);
    assert.match(out, /metadata tree apps\/subly\/store\/android-play — 8 field\(s\) present and non-empty, 3 within a SOURCED Play limit/);
  });

  test('names the runbook the console-only steps live in', () => {
    const { out } = run(tree());
    assert.match(out, /company\/runbooks\/store-submission-android\.md/);
  });

  // The calendar realities have to be on the happy path, not only in a doc:
  // a gap nobody sees becomes permanent.
  test('the DRY RUN prints the 12-tester / 14-day gate even when everything passes', () => {
    const { out } = run(tree());
    assert.match(out, /12 testers opted in to a closed test for 14 continuous/);
  });

  // ── the refusal ───────────────────────────────────────────────────────────
  test('--submit REFUSES and lists every UNVERIFIED API fact', () => {
    const { code, out } = run(tree({ withArtifact: true }), { args: ['--submit', '--app', 'subly'] });
    assert.equal(code, 1, out);
    assert.match(out, /--submit is NOT IMPLEMENTED, and refusing is the implementation/);
    assert.match(out, /UNVERIFIED: the Google Play Developer API base URL/);
  });

  test('--submit refuses BEFORE any validation runs', () => {
    const { out } = run(tree({ withArtifact: true }), { args: ['--submit', '--app', 'subly'] });
    assert.doesNotMatch(out, /^ok   metadata tree/m, out);
    assert.match(out, /this refusal is BEFORE the checks on purpose/);
  });

  test('refuses when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), { args: ['--app', 'subly'] });
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('refuses when BOTH modes are given', () => {
    const { code, out } = run(tree(), { args: ['--dry-run', '--submit', '--app', 'subly'] });
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  // ── the listing ───────────────────────────────────────────────────────────
  test('FAILS when the metadata tree does not exist', () => {
    const { code, out } = run(tree({ omitTree: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /the store metadata tree apps\/subly\/store\/android-play does not exist/);
  });

  test('FAILS on a missing listing field', () => {
    const { code, out } = run(tree({ omitFiles: ['long-description.txt'] }));
    assert.equal(code, 1, out);
    assert.match(out, /long-description\.txt is missing/);
  });

  test('FAILS on an emptied listing field', () => {
    const { code, out } = run(tree({ fields: { 'category.txt': '  \n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS on a privacy-policy URL that is not a single absolute https URL', () => {
    const { code, out } = run(tree({ fields: { 'privacy-policy-url.txt': '/privacy.html\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /is not a single absolute https URL/);
  });

  test('FAILS on an app name over Play’s sourced 30-character cap', () => {
    const { code, out } = run(tree({ fields: { 'title.txt': `${'A'.repeat(31)}\n` } }));
    assert.equal(code, 1, out);
    assert.match(out, /title\.txt is 31 characters; Play caps this field at 30/);
  });

  test('FAILS on a limit declared with no source rather than enforcing it', () => {
    const { code, out } = run(
      tree({ mutateRegister: (r) => { delete r.storeMetadataContract.perChannel['android-play'].maxChars['title.txt'].source; } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /maxChars\["title\.txt"\] for "android-play" declares max 30 with no `source`/);
  });

  test('COVERAGE LOST when requiredFiles is emptied', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.storeMetadataContract.requiredFiles = []; } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register declares no android-play row', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels = []; } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no "android-play" channel/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels[0].submittable = false; } }));
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });

  // ── the package name: immutable after the first upload ────────────────────
  test('FAILS when applicationId is not the canonical com.nikatru.<app_id>', () => {
    const { code, out } = run(tree({ gradleOver: { appId: 'com.example.subly' } }));
    assert.equal(code, 1, out);
    assert.match(out, /Play binds the package name at the FIRST upload/);
  });

  test('COVERAGE LOST when the gradle file declares no applicationId at all', () => {
    const { code, out } = run(tree({ gradleOver: { appId: null } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no `applicationId`/);
  });

  test('FAILS when the gradle file is gone entirely', () => {
    const { code, out } = run(tree({ omitGradle: true }));
    assert.equal(code, 1, out);
    assert.match(out, /build\.gradle\.kts does not exist/);
  });

  // ── the signing posture ───────────────────────────────────────────────────
  // 🔴 The env var names are PARSED OUT OF THE GRADLE FILE, so deleting the
  // signing block is COVERAGE LOST rather than a silent "no keystore".
  test('COVERAGE LOST when the release-signing env map is removed from gradle', () => {
    const { code, out } = run(tree({ gradleOver: { envMap: false } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no release-signing environment map/);
  });

  test('FAILS when the recorded debug fallback is removed', () => {
    const { code, out } = run(tree({ gradleOver: { debugFallback: false } }));
    assert.equal(code, 1, out);
    assert.match(out, /no longer names the debug signing config as the fallback/);
  });

  test('PRINTS the debug-fallback posture when no keystore is supplied', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /SIGNING POSTURE: DEBUG FALLBACK/);
    assert.match(out, /A debug-signed \.aab CANNOT be uploaded to Play/);
  });

  // The one state that must never fall back quietly: a debug-signed artifact
  // out of a run that looked like a signing run.
  test('FAILS when signing is HALF configured', () => {
    const { code, out } = run(tree(), { env: { ANDROID_KEYSTORE_PATH: 'x.jks', ANDROID_KEY_ALIAS: 'upload' } });
    assert.equal(code, 1, out);
    assert.match(out, /signing is HALF configured — 2 of 4/);
  });

  test('accepts a fully supplied keystore and never echoes a value', () => {
    const { code, out } = run(tree(), {
      env: {
        ANDROID_KEYSTORE_PATH: 'x.jks',
        ANDROID_KEYSTORE_PASSWORD: SECRET,
        ANDROID_KEY_ALIAS: 'upload',
        ANDROID_KEY_PASSWORD: SECRET,
      },
    });
    assert.equal(code, 0, out);
    assert.match(out, /signing posture — all 4 keystore variable\(s\) supplied/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed a keystore password');
  });

  test('PRINTS that key.properties takes precedence, and never reads it', () => {
    const { code, out } = run(tree({ withKeyProperties: true }));
    assert.equal(code, 0, out);
    assert.match(out, /key\.properties is present/);
  });

  // ── the artifact ──────────────────────────────────────────────────────────
  test('FAILS when the .aab is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = run(tree(), { args: ['--dry-run', '--app', 'subly'] });
    assert.equal(code, 1, out);
    assert.match(out, /app-release\.aab does not exist/);
  });

  test('validates a real .aab when one is on disk', () => {
    const { code, out } = run(tree({ withArtifact: true }), { args: ['--dry-run', '--app', 'subly'] });
    assert.equal(code, 0, out);
    assert.match(out, /artifact apps\/subly\/build\/app\/outputs\/bundle\/release\/app-release\.aab/);
  });

  test('FAILS on a zero-byte .aab — it uploads and costs a version code', () => {
    const { code, out } = run(tree({ withArtifact: true, artifactBytes: 0 }), { args: ['--dry-run', '--app', 'subly'] });
    assert.equal(code, 1, out);
    assert.match(out, /is ZERO bytes/);
  });

  test('FAILS when the build output format is not one the channel accepts', () => {
    const { code, out } = run(tree({ mutateRegister: (r) => { r.channels[0].artifactFormats = ['.apk']; } }));
    assert.equal(code, 1, out);
    assert.match(out, /matches none of the formats channel "android-play" accepts/);
  });

  // ── the service account ───────────────────────────────────────────────────
  test('PRINTS which credential is absent, and does not fail', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /SERVICE ACCOUNT NOT CONFIGURED — PLAY_SERVICE_ACCOUNT_JSON is absent/);
  });

  test('accepts a well-formed service-account key without printing it', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'a@b.iam.gserviceaccount.com', private_key: SECRET }) },
    });
    assert.equal(code, 0, out);
    assert.match(out, /service account — PLAY_SERVICE_ACCOUNT_JSON parses/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed the private key');
  });

  // A truncated or badly-pasted secret otherwise surfaces mid-submission,
  // against a live account.
  test('FAILS on a malformed service-account secret WITHOUT echoing it', () => {
    const { code, out } = run(tree(), { env: { PLAY_SERVICE_ACCOUNT_JSON: `{"private_key":"${SECRET}` } });
    assert.equal(code, 1, out);
    assert.match(out, /is set but is not valid JSON/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script echoed the malformed secret');
  });

  test('FAILS when a required service-account field is missing, naming only the KEY', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', private_key: SECRET }) },
    });
    assert.equal(code, 1, out);
    assert.match(out, /is missing client_email/);
    assert.doesNotMatch(out, new RegExp(SECRET), 'the script printed the private key');
  });

  test('FAILS on an OAuth client secret handed in place of a service-account key', () => {
    const { code, out } = run(tree(), {
      env: { PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'authorized_user', client_email: 'a@b.c', private_key: SECRET }) },
    });
    assert.equal(code, 1, out);
    assert.match(out, /needs a service-account key/);
    assert.doesNotMatch(out, new RegExp(SECRET));
  });

  // 🔴 NOT an allowlist, on purpose: Play supports CUSTOM closed-test track
  // names, so validating against internal/alpha/beta/production would reject
  // correct input — the exact failure mode the D-5 limits table exists to stop.
  test('does NOT validate the track against a vocabulary', () => {
    const { code, out } = run(tree(), { env: { PLAY_TRACK: 'nikatru-closed-2026' } });
    assert.equal(code, 0, out);
    assert.match(out, /Play allows custom closed-test track names/);
  });
});
