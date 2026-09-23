// ─────────────────────────────────────────────────────────────────────────────
// apps-gov-in-apk.test.mjs — assert-apps-gov-in-apk.mjs must name an .apk
// uploadable ONLY when its signer matches a recorded pin, must FAIL on every
// wrong key, and must refuse rather than pass when it cannot read the file.
//
// Register row O-APPS-GOV-IN-CHANNEL-APK. The decision table in the guard's
// header has one case here per row, plus the form-answers limbs (the minimum
// platform mapping and the five permission questions) and the CLI's
// COVERAGE LOST paths.
//
// ⚠️ THE CLI CASES RUN FAKE BUILD-TOOLS. `apksigner` and `aapt2` are replaced
// by two-line scripts that print a fixture file, so the guard's own process —
// argument parsing, register reading, $GITHUB_OUTPUT and the summary — runs for
// real without an Android SDK on the test host. The fixture text is each shape
// apksigner prints, (a) and (g) REAL runs; the pure-function cases pin the
// parsers to it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  toPinForm,
  parseApksignerCerts,
  distinctSignerKeys,
  signerShape,
  toolOutputLines,
  parseBadging,
  portalLabel,
  decideArtifact,
  checkFormAnswers,
  checkBuiltIdentity,
  mdCell,
} from '../assert-apps-gov-in-apk.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-apps-gov-in-apk.mjs');

// The real Play upload pin (tooling/channel-register.json android-play), and
// two made-up keys. None of the made-up ones is anybody's certificate.
const PLAY_PIN = '43:C8:4D:11:62:C4:D1:9C:0F:A0:C5:E0:01:90:5B:89:52:3D:C0:82:A6:80:83:C9:93:06:9B:86:3C:28:A6:16';
const OWN_HEX = 'aa11bb22cc33dd44ee55ff6600770088990011aa22bb33cc44dd55ee66ff7788';
const OWN_PIN = toPinForm(OWN_HEX);
const FAKE_PIN = '01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F:20';
const DEBUG_HEX = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';

const DEBUG_SIGNER = { dn: 'CN=Android Debug, O=Android, C=US', sha256: toPinForm(DEBUG_HEX) };
const OWN_SIGNER = { dn: 'CN=Nikatru, O=Nikatru, C=IN', sha256: OWN_PIN };
const PLAY_SIGNER = { dn: 'CN=Nikatru Upload, O=Nikatru, C=IN', sha256: PLAY_PIN };

const apksignerText = (dn, hex) => [
  `Signer #1 certificate DN: ${dn}`,
  `Signer #1 certificate SHA-256 digest: ${hex}`,
  'Signer #1 certificate SHA-1 digest: 0011223344556677889900112233445566778899',
  'Signer #1 certificate MD5 digest: 00112233445566778899001122334455',
  '',
].join('\n');

// ── the shapes apksigner prints, each with its provenance ───────────────────
// (a) PROVENANCE: REAL apksigner output, verbatim, CRLF included. apksigner 0.9
// (build-tools 36.0.0) on the Windows laptop, 2026-09-22, `verify --print-certs`
// over a probe .apk that aapt2 built and the Android DEBUG key signed (the debug
// certificate is public). Copy of record: Private
// research/session-2026-09-21/apksigner-0.9-print-certs-debugkey-probe.txt (311 bytes).
const PROBE_HEX = 'fee7290d944c4f88553d11af8068051afdeaac5e6c3751e58a0419e9dd4d86e1';
const PROBE_CRLF = [
  'Signer #1 certificate DN: C=US, O=Android, CN=Android Debug',
  `Signer #1 certificate SHA-256 digest: ${PROBE_HEX}`,
  'Signer #1 certificate SHA-1 digest: 9c06dccf3ac3f0345df625d316b8eed2f77c9619',
  'Signer #1 certificate MD5 digest: 44ec582aee38bd6fce6f1c95ee9dc64f',
  '',
].join('\r\n');

// (b)-(f) PROVENANCE: the labels apksig's ApkSignerTool.verify() passes to
// printCertificate(), read at android.googlesource.com/platform/tools/apksig
// (main) on 2026-09-22. With a v3.1 block it prints each v3.1 signer, then each
// v3.0 signer, under "Signer (minSdkVersion=" + min + (rotationTargetsDevRelease
// ? " (dev release=true)" : "") + ", maxSdkVersion=" + max + ")"; a source stamp
// prints last under "Source Stamp Signer". printCertificate() writes DN, SHA-256,
// SHA-1 and MD5, in that order. No .apk on hand prints these; the text is built
// from those format strings.
const V31_LABEL = 'Signer (minSdkVersion=33, maxSdkVersion=2147483647)';
const V31_DEV_LABEL = 'Signer (minSdkVersion=33 (dev release=true), maxSdkVersion=2147483647)';
const V30_LABEL = 'Signer (minSdkVersion=24, maxSdkVersion=32)';
const certBlock = (label, dn, hex) => [
  `${label} certificate DN: ${dn}`,
  `${label} certificate SHA-256 digest: ${hex}`,
  `${label} certificate SHA-1 digest: 0011223344556677889900112233445566778899`,
  `${label} certificate MD5 digest: 00112233445566778899001122334455`,
];
const printCerts = (...blocks) => `${blocks.flat().join('\n')}\n`;
const V31_ONE_KEY = printCerts(certBlock(V31_LABEL, DEBUG_SIGNER.dn, DEBUG_HEX), certBlock(V30_LABEL, DEBUG_SIGNER.dn, DEBUG_HEX));
const V31_TWO_KEYS = printCerts(certBlock(V31_DEV_LABEL, OWN_SIGNER.dn, OWN_HEX), certBlock(V30_LABEL, 'CN=Nikatru Old, O=Nikatru, C=IN', DEBUG_HEX));

// (g) PROVENANCE: REAL apksigner output, verbatim, from CI. Build apps dispatch
// run 35734304054, job 106767608635 ("Linux + Web + Android (subscriptiontracker)"),
// 2026-09-22T13:50:53Z: /usr/local/lib/android/sdk/build-tools/37.0.0/apksigner,
// `--version` 0.9, `verify --print-certs` over the debug-signed apps.gov.in .apk.
// The guard's COVERAGE LOST dump printed these 4 lines, "4 line(s), 311 bytes",
// and an empty stderr. Same `--version` as (a), a different shape: the version
// string does not name the shape.
const CI37_HEX = 'd104989e5c22b0658db819055f6f0654d1887f2a9e29ffe32682bddb23359eff';
const CI37_LF = [
  'V2 Signer: certificate DN: C=US, O=Android, CN=Android Debug',
  `V2 Signer: certificate SHA-256 digest: ${CI37_HEX}`,
  'V2 Signer: certificate SHA-1 digest: 7f04807f1620253aec8762258205cf9abf9fcf82',
  'V2 Signer: certificate MD5 digest: 3f129238c424b27aa554fac71fe6eeac',
  '',
].join('\n');

// (h) PROVENANCE: REAL aapt2 output, verbatim, CRLF included. aapt2 36.0.0 on
// the Windows laptop, 2026-09-22, `dump badging` over the probe .apk of (a). It
// spells the floor `minSdkVersion:'24'`, where the hand-written badgingText()
// below spells it `sdkVersion:'24'`.
const AAPT2_36_CRLF = [
  "package: name='com.example.probe' versionCode='1' versionName='1.0' platformBuildVersionName='15' platformBuildVersionCode='35' compileSdkVersion='35' compileSdkVersionCodename='15'",
  "minSdkVersion:'24'",
  "targetSdkVersion:'35'",
  "application: label='probe' icon=''",
  "feature-group: label=''",
  "  uses-feature: name='android.hardware.faketouch'",
  "  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'",
  "supports-screens: 'small' 'normal' 'large' 'xlarge'",
  "supports-any-density: 'true'",
  'locales:',
  'densities:',
  '',
].join('\r\n');

const badgingText = ({ sdk = 24, perms = ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'] } = {}) => [
  "package: name='com.nikatru.demo' versionCode='7' versionName='1.0.7' platformBuildVersionName='16' platformBuildVersionCode='36'",
  `sdkVersion:'${sdk}'`,
  "targetSdkVersion:'36'",
  ...perms.map((p) => `uses-permission: name='${p}'`),
  "application-label:'Demo'",
  '',
].join('\n');

const answers = ({ sdk = 24, label = 'Nougat 7.0', overrides = {} } = {}) => ({
  step1: { minimumPlatform: { sdk, label } },
  step3: [
    { id: 'location', answer: 'No' },
    { id: 'camera', answer: 'No' },
    { id: 'contacts-call-logs', answer: 'No' },
    { id: 'microphone', answer: 'No' },
    { id: 'storage', answer: 'No' },
  ].map((e) => (overrides[e.id] ? { ...e, answer: overrides[e.id] } : e)),
});

// ── pure functions ──────────────────────────────────────────────────────────
describe('parsers', () => {
  test('toPinForm turns apksigner\'s lowercase hex into the register\'s colon form, and refuses a short digest', () => {
    assert.equal(toPinForm(OWN_HEX), 'AA:11:BB:22:CC:33:DD:44:EE:55:FF:66:00:77:00:88:99:00:11:AA:22:BB:33:CC:44:DD:55:EE:66:FF:77:88');
    assert.equal(toPinForm('abcd'), null);
  });

  test('parseApksignerCerts reads the DN and the SHA-256 of signer #1', () => {
    const got = parseApksignerCerts(apksignerText('CN=Android Debug, O=Android, C=US', DEBUG_HEX));
    assert.equal(got.length, 1);
    assert.equal(got[0].dn, 'CN=Android Debug, O=Android, C=US');
    assert.equal(got[0].sha256, toPinForm(DEBUG_HEX));
  });

  test('parseBadging reads minSdk, versionName and both uses-permission spellings', () => {
    const b = parseBadging(`${badgingText({ perms: ['android.permission.INTERNET'] })}uses-permission-sdk-23: name='android.permission.CAMERA'\n`);
    assert.equal(b.sdkVersion, 24);
    assert.equal(b.targetSdkVersion, 36);
    assert.equal(b.versionName, '1.0.7');
    assert.deepEqual(b.permissions, ['android.permission.INTERNET', 'android.permission.CAMERA']);
  });

  test('(h) parseBadging reads the REAL aapt2 36.0.0 output (CRLF, `minSdkVersion:` spelling)', () => {
    assert.equal(Buffer.byteLength(AAPT2_36_CRLF), 540, 'byte-equal to the captured output');
    const b = parseBadging(AAPT2_36_CRLF);
    assert.deepEqual(b, { packageName: 'com.example.probe', versionCode: '1', versionName: '1.0', sdkVersion: 24, targetSdkVersion: 35, permissions: [] });
  });

  test('portalLabel is the form\'s own list: 21 Lollipop 5.0, 24 Nougat 7.0, 30 Android 11, and nothing past 30', () => {
    assert.equal(portalLabel(21), 'Lollipop 5.0');
    assert.equal(portalLabel(24), 'Nougat 7.0');
    assert.equal(portalLabel(30), 'Android 11');
    assert.equal(portalLabel(31), null);
  });

  test('mdCell escapes the backslash BEFORE the pipe, so an input `\\|` stays inside its cell', () => {
    // CodeQL js/incomplete-sanitization (PR #870): escaping only the pipe turns
    // the input `a\|b` into `a\\|b`, where `\\` is a literal backslash and the
    // pipe is live again. Backslash first gives `a\\\|b`: both escaped.
    assert.equal(mdCell('CN=a\\|b'), 'CN=a\\\\\\|b');
    assert.equal(mdCell('C:\\keys'), 'C:\\\\keys');
    assert.equal(mdCell('x|y'), 'x\\|y');
    assert.equal(mdCell(24), '24');
  });
});

describe('parseApksignerCerts — the three shapes apksigner prints, keyed by label', () => {
  test('(a) the REAL apksigner 0.9 output, CRLF as captured, then LF as CI prints it: one "Signer #N" signer', () => {
    for (const text of [PROBE_CRLF, PROBE_CRLF.replace(/\r\n/g, '\n')]) {
      const got = parseApksignerCerts(text);
      assert.equal(got.length, 1);
      assert.deepEqual({ ...got[0] }, { index: 1, label: 'Signer #1', dn: 'C=US, O=Android, CN=Android Debug', sha256: toPinForm(PROBE_HEX) });
      assert.equal(signerShape(got[0].label), 'Signer #N');
      assert.equal(got.sourceStamp, null);
      assert.deepEqual(got.unknown, []);
    }
  });

  test('(b) the v3.1 shape, ONE key printed in a v3.1 and a v3.0 block, is ONE signer', () => {
    const got = parseApksignerCerts(V31_ONE_KEY);
    assert.deepEqual(got.map((s) => s.label), [V31_LABEL, V30_LABEL], 'entries in print order');
    assert.deepEqual(got.map((s) => s.index), [1, 2]);
    assert.ok(got.every((s) => signerShape(s.label) === 'Signer (minSdkVersion=…)'));
    assert.equal(got[0].dn, DEBUG_SIGNER.dn);
    assert.deepEqual(distinctSignerKeys(got), [toPinForm(DEBUG_HEX)]);
    assert.deepEqual(got.unknown, []);
  });

  test('(c) the v3.1 shape with TWO keys (one "(dev release=true)") reads two distinct keys: a rotation', () => {
    const got = parseApksignerCerts(V31_TWO_KEYS);
    assert.deepEqual(got.map((s) => s.label), [V31_DEV_LABEL, V30_LABEL]);
    assert.deepEqual(distinctSignerKeys(got), [OWN_PIN, toPinForm(DEBUG_HEX)]);
    assert.deepEqual(got.unknown, []);
  });

  test('(d) "Signer #1" plus "Source Stamp Signer": one signer, and the stamp read apart, never counted', () => {
    const got = parseApksignerCerts(printCerts(certBlock('Signer #1', DEBUG_SIGNER.dn, DEBUG_HEX), certBlock('Source Stamp Signer', 'CN=Stamp, O=Example', OWN_HEX)));
    assert.equal(got.length, 1);
    assert.equal(got[0].sha256, toPinForm(DEBUG_HEX));
    assert.ok(got.sourceStamp, 'the source stamp is read');
    assert.equal(got.sourceStamp.dn, 'CN=Stamp, O=Example');
    assert.equal(got.sourceStamp.sha256, OWN_PIN);
    assert.deepEqual(distinctSignerKeys(got), [toPinForm(DEBUG_HEX)]);
  });

  test('(e) a certificate line under an unknown label is kept verbatim in `unknown`, never skipped', () => {
    const got = parseApksignerCerts(`${apksignerText(DEBUG_SIGNER.dn, DEBUG_HEX)}Signer [x] certificate DN: CN=x\n`);
    assert.deepEqual(got.unknown, ['Signer [x] certificate DN: CN=x']);
    assert.equal(signerShape('Signer [x]'), null);
  });

  test('(g) the REAL build-tools 37.0.0 output from CI (run 35734304054): one "V<n> Signer:" signer', () => {
    assert.equal(Buffer.byteLength(CI37_LF), 311, 'byte-equal to the "4 line(s), 311 bytes" CI printed');
    const got = parseApksignerCerts(CI37_LF);
    assert.equal(got.length, 1);
    assert.deepEqual({ ...got[0] }, { index: 1, label: 'V2 Signer:', dn: 'C=US, O=Android, CN=Android Debug', sha256: toPinForm(CI37_HEX) });
    assert.equal(signerShape(got[0].label), 'V<n> Signer:');
    assert.equal(got.sourceStamp, null);
    assert.deepEqual(got.unknown, []);
  });

  test('(g) the scheme shape counts by SHA-256: one key under V2 and V3 is ONE signer, two keys are two', () => {
    // The V3 label is (g)'s format with the scheme number changed; CI printed V2 only.
    const scheme = (v, dn, hex) => certBlock(`V${v} Signer:`, dn, hex);
    const one = parseApksignerCerts(printCerts(scheme(2, DEBUG_SIGNER.dn, DEBUG_HEX), scheme(3, DEBUG_SIGNER.dn, DEBUG_HEX)));
    assert.deepEqual(one.map((s) => s.label), ['V2 Signer:', 'V3 Signer:']);
    assert.deepEqual(distinctSignerKeys(one), [toPinForm(DEBUG_HEX)]);
    const two = parseApksignerCerts(printCerts(scheme(2, DEBUG_SIGNER.dn, DEBUG_HEX), scheme(3, OWN_SIGNER.dn, OWN_HEX)));
    assert.deepEqual(distinctSignerKeys(two), [toPinForm(DEBUG_HEX), OWN_PIN]);
    assert.equal(signerShape('V3.1 Signer:'), 'V<n> Signer:');
    assert.equal(signerShape('V2 Signer'), null, 'no colon is not the shape');
  });

  test('toolOutputLines prefixes each line, escapes control characters and stops at 20', () => {
    assert.deepEqual(toolOutputLines('stdout', 'a\r\nb\tc\x1b[0m\n'), ['stdout: 2 line(s), 11 bytes', 'stdout| a\\r', 'stdout| b\\tc\\x1b[0m']);
    assert.deepEqual(toolOutputLines('stderr', ''), ['stderr: (empty, 0 bytes)']);
    const many = toolOutputLines('stdout', Array.from({ length: 25 }, (_, i) => `l${i}`).join('\n'));
    assert.equal(many.length, 21);
    assert.match(many[0], /25 line\(s\), .*first 20 shown/);
    assert.equal(many[20], 'stdout| l19');
  });
});

describe('decideArtifact — one case per row of the decision table', () => {
  test('pin null + debug-signed names the artifact NOT-FOR-UPLOAD-debug-signed-build-proof, in capitals', () => {
    const d = decideArtifact({ app: 'demo', posture: 'debug', signer: DEBUG_SIGNER, pin: null, playPin: PLAY_PIN });
    assert.deepEqual(d.problems, []);
    assert.equal(d.artifactName, 'apps-gov-in-demo-apk-NOT-FOR-UPLOAD-debug-signed-build-proof');
    assert.match(d.reason, /MUST NEVER BE UPLOADED/);
  });

  test('pin null + release-signed names the artifact NOT-FOR-UPLOAD-release-signed-unpinned', () => {
    const d = decideArtifact({ app: 'demo', posture: 'release', signer: OWN_SIGNER, pin: null, playPin: PLAY_PIN });
    assert.deepEqual(d.problems, []);
    assert.equal(d.artifactName, 'apps-gov-in-demo-apk-NOT-FOR-UPLOAD-release-signed-unpinned');
  });

  test('a pin that matches the signer is the ONLY way to the name apps-gov-in-<app>-apk', () => {
    const d = decideArtifact({ app: 'demo', posture: 'release', signer: OWN_SIGNER, pin: OWN_PIN, playPin: PLAY_PIN });
    assert.deepEqual(d.problems, []);
    assert.equal(d.artifactName, 'apps-gov-in-demo-apk');
    assert.equal(d.verdict, 'UPLOADABLE');
  });

  test('NEGATIVE: a fake non-null pin that the signer does not match FAILS', () => {
    const d = decideArtifact({ app: 'demo', posture: 'release', signer: OWN_SIGNER, pin: FAKE_PIN, playPin: PLAY_PIN });
    assert.equal(d.artifactName, null);
    assert.match(d.problems.join('\n'), /does NOT match the pinned apps-gov-in certificate 01:02:03/);
  });

  test('a non-null pin and a debug-signed build FAILS: the key is pinned and the secrets did not arrive', () => {
    const d = decideArtifact({ app: 'demo', posture: 'debug', signer: DEBUG_SIGNER, pin: OWN_PIN, playPin: PLAY_PIN });
    assert.equal(d.artifactName, null);
    assert.match(d.problems.join('\n'), /does NOT match the pinned/);
  });

  test('the Play upload key FAILS even with the pin still null', () => {
    const d = decideArtifact({ app: 'demo', posture: 'release', signer: PLAY_SIGNER, pin: null, playPin: PLAY_PIN });
    assert.equal(d.artifactName, null);
    assert.match(d.problems.join('\n'), /ANDROID-PLAY UPLOAD KEY/);
  });

  test('release posture with the debug signer FAILS: the key never reached Gradle', () => {
    const d = decideArtifact({ app: 'demo', posture: 'release', signer: DEBUG_SIGNER, pin: null, playPin: PLAY_PIN });
    assert.match(d.problems.join('\n'), /posture is "release" but the signer is the DEBUG key/);
  });

  test('debug posture with a non-debug signer FAILS: some other key leaked into the build', () => {
    const d = decideArtifact({ app: 'demo', posture: 'debug', signer: OWN_SIGNER, pin: null, playPin: PLAY_PIN });
    assert.match(d.problems.join('\n'), /posture is "debug" .* NOT the debug key/);
  });
});

describe('checkFormAnswers — the answers the built .apk can contradict', () => {
  test('answers that agree with the .apk pass', () => {
    assert.deepEqual(checkFormAnswers(answers(), parseBadging(badgingText())), []);
  });

  test('NEGATIVE: a wrong mapping (SDK 24 labelled "Nougat 7.1") FAILS', () => {
    const p = checkFormAnswers(answers({ label: 'Nougat 7.1' }), parseBadging(badgingText()));
    assert.match(p.join('\n'), /the portal's label for SDK 24 is "Nougat 7.0"/);
  });

  test('an sdk that is not the .apk\'s minSdk FAILS', () => {
    const p = checkFormAnswers(answers({ sdk: 21, label: 'Lollipop 5.0' }), parseBadging(badgingText()));
    assert.match(p.join('\n'), /minimumPlatform\.sdk is 21, and the built \.apk's minSdk is 24/);
  });

  test('a minSdk past the portal\'s list FAILS: the form cannot state it', () => {
    const p = checkFormAnswers(answers({ sdk: 31, label: 'Android 12' }), parseBadging(badgingText({ sdk: 31 })));
    assert.match(p.join('\n'), /minSdk 31 has NO entry in the portal's "Minimum Platform" list/);
  });

  test('"No" to camera while the merged manifest requests CAMERA FAILS', () => {
    const p = checkFormAnswers(answers(), parseBadging(badgingText({ perms: ['android.permission.CAMERA'] })));
    assert.match(p.join('\n'), /answers "camera" No, and the built \.apk requests android\.permission\.CAMERA/);
  });

  test('"Yes" to microphone while nothing requests RECORD_AUDIO FAILS', () => {
    const p = checkFormAnswers(answers({ overrides: { microphone: 'Yes' } }), parseBadging(badgingText()));
    assert.match(p.join('\n'), /answers "microphone" Yes, and the built \.apk requests none/);
  });

  test('a permission question with no answer FAILS', () => {
    const a = answers();
    a.step3 = a.step3.filter((e) => e.id !== 'storage');
    assert.match(checkFormAnswers(a, parseBadging(badgingText())).join('\n'), /no entry with id "storage"/);
  });
});

// ── the CLI, with fake build-tools ──────────────────────────────────────────
let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-agi-apk-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// `--version` answers `fake-<name> 0.0`, so a guard that prints the tool's
// version on COVERAGE LOST shows a line a test can anchor on.
function fakeTool(dir, name, envOut, envCode) {
  if (process.platform === 'win32') {
    writeFileSync(join(dir, `${name}.bat`), `@if "%~1"=="--version" (echo fake-${name} 0.0& exit /b 0)\r\n@type "%${envOut}%"\r\n@exit /b %${envCode}%\r\n`);
  } else {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake-${name} 0.0"; exit 0; fi\ncat "$${envOut}"\nexit "$${envCode}"\n`);
    chmodSync(p, 0o755);
  }
}

/** A repo root with a register and form answers, an .apk, and fake tools. */
function fixture({
  pin = null,
  apksigner = apksignerText(DEBUG_SIGNER.dn, DEBUG_HEX),
  badging = badgingText(),
  tools = true,
  form = answers(),
  // `appId: null` omits the gradle file entirely — the case where the
  // declaration cannot be read. `forbids: null` omits `purchaseRail`.
  appId = 'com.nikatru.demo',
  forbids = ['paddle', 'play-billing', 'apple-iap'],
} = {}) {
  const root = join(TMP, `r${++seq}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({
    channels: [
      { id: 'android-play', signing: { uploadCertificate: { sha256: PLAY_PIN } } },
      {
        id: 'apps-gov-in',
        signing: { signingCertificate: { sha256: pin } },
        ...(forbids === null ? {} : { purchaseRail: { rail: 'none', forbids, forbidsWhy: 'the fixture says so' } }),
      },
    ],
  }));
  if (appId !== null) {
    mkdirSync(join(root, 'apps', 'demo', 'android', 'app'), { recursive: true });
    writeFileSync(join(root, 'apps', 'demo', 'android', 'app', 'build.gradle.kts'), `android {\n    defaultConfig {\n        applicationId = "${appId}"\n    }\n}\n`);
  }
  mkdirSync(join(root, 'apps', 'demo', 'store', 'apps-gov-in'), { recursive: true });
  writeFileSync(join(root, 'apps', 'demo', 'store', 'apps-gov-in', 'form-answers.json'), JSON.stringify(form));
  const apk = join(root, 'demo-apps-gov-in-1.0.7.apk');
  writeFileSync(apk, Buffer.from('PK not a real apk; the fake tools never open it'));
  const bt = join(root, 'build-tools');
  mkdirSync(bt);
  if (tools) {
    fakeTool(bt, 'apksigner', 'FAKE_APKSIGNER_OUT', 'FAKE_APKSIGNER_CODE');
    fakeTool(bt, 'aapt2', 'FAKE_AAPT2_OUT', 'FAKE_AAPT2_CODE');
  }
  writeFileSync(join(root, 'apksigner.out'), apksigner);
  writeFileSync(join(root, 'aapt2.out'), badging);
  return { root, apk, bt };
}

function run(fx, extra = [], posture = 'debug') {
  const out = join(fx.root, 'github-output');
  const summary = join(fx.root, 'step-summary');
  writeFileSync(out, '');
  writeFileSync(summary, '');
  const r = spawnSync(process.execPath, [GUARD, '--apk', fx.apk, '--app', 'demo', '--posture', posture, '--repo-root', fx.root, '--build-tools', fx.bt, ...extra], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      FAKE_APKSIGNER_OUT: join(fx.root, 'apksigner.out'),
      FAKE_APKSIGNER_CODE: '0',
      FAKE_AAPT2_OUT: join(fx.root, 'aapt2.out'),
      FAKE_AAPT2_CODE: '0',
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, output: readFileSync(out, 'utf8'), summary: readFileSync(summary, 'utf8') };
}

describe('checkBuiltIdentity — the package id, and the rails the row forbids', () => {
  const row = (forbids = ['paddle', 'play-billing', 'apple-iap']) => ({ purchaseRail: { rail: 'none', forbids, forbidsWhy: 'the fixture says so' } });
  const BILLING = 'com.android.vending.BILLING';

  test('the shipped shape passes: the package matches and no billing permission is requested', () => {
    assert.deepEqual(checkBuiltIdentity(parseBadging(badgingText()), row(), 'com.nikatru.demo'), []);
  });

  test('FAILS a package the gradle declaration does not name', () => {
    const p = checkBuiltIdentity(parseBadging(badgingText()), row(), 'com.nikatru.other');
    assert.equal(p.length, 1);
    assert.match(p[0], /package is "com\.nikatru\.demo" and apps\/<app>\/android\/app\/build\.gradle\.kts declares applicationId "com\.nikatru\.other"/);
  });

  test('FAILS an unreadable declaration rather than skipping the check', () => {
    const p = checkBuiltIdentity(parseBadging(badgingText()), row(), null);
    assert.equal(p.length, 1);
    assert.match(p[0], /no applicationId could be read/);
  });

  test('FAILS an .apk that requests com.android.vending.BILLING while the row forbids play-billing', () => {
    const badging = parseBadging(badgingText({ perms: ['android.permission.INTERNET', BILLING] }));
    const p = checkBuiltIdentity(badging, row(), 'com.nikatru.demo');
    assert.equal(p.length, 1);
    assert.match(p[0], /requests com\.android\.vending\.BILLING, and .* forbids the "play-billing" rail/);
  });

  test('a forbidden rail with no permission of its own ranges over nothing, and says nothing', () => {
    const badging = parseBadging(badgingText({ perms: ['android.permission.INTERNET', BILLING] }));
    assert.deepEqual(checkBuiltIdentity(badging, row(['paddle']), 'com.nikatru.demo'), []);
  });

  test('FAILS a row with no purchaseRail.forbids — the limb would range over nothing', () => {
    const p = checkBuiltIdentity(parseBadging(badgingText()), {}, 'com.nikatru.demo');
    assert.equal(p.length, 1);
    assert.match(p[0], /declares no `purchaseRail\.forbids`/);
  });

  test('END TO END: a billing permission in the built .apk exits 1 and writes no artifact name', () => {
    const badging = badgingText({ perms: ['android.permission.INTERNET', BILLING] });
    const { code, out, output } = run(fixture({ badging }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL the built \.apk requests com\.android\.vending\.BILLING/);
    assert.doesNotMatch(output, /artifact_name=/);
  });

  test('END TO END: a missing build.gradle.kts exits 1 rather than passing unchecked', () => {
    const { code, out } = run(fixture({ appId: null }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL no applicationId could be read/);
  });
});

describe('the CLI', () => {
  test('no arguments at all is COVERAGE LOST, not a pass', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /COVERAGE LOST — no --apk was named/);
  });

  test('an unknown posture is COVERAGE LOST', () => {
    const fx = fixture();
    const { code, out } = run(fx, [], 'maybe');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — --posture must be one of release, debug/);
  });

  test('an .apk that is not there is COVERAGE LOST', () => {
    const fx = fixture();
    fx.apk = join(fx.root, 'nope.apk');
    const { code, out } = run(fx);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*nope\.apk does not exist or is empty/);
  });

  test('build-tools without apksigner and aapt2 is COVERAGE LOST, never a pass', () => {
    const { code, out } = run(fixture({ tools: false }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .* lacks apksigner and aapt2/);
  });

  test('apksigner printing no signer is COVERAGE LOST, and it PRINTS what apksigner returned', () => {
    const fx = fixture({ apksigner: 'Verifies\n' });
    const { code, out } = run(fx);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — apksigner exited 0 and printed no signer certificate line in any shape/);
    // Run 35720583079 printed only the two lines above, so the real format stayed unread.
    assert.ok(out.includes(`apksigner: ${join(fx.bt, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')}`), out);
    assert.match(out, /^\s*apksigner --version: fake-apksigner 0\.0 \(exit 0\)$/m);
    assert.match(out, /^\s*stdout: 1 line\(s\), 9 bytes$/m);
    assert.match(out, /^\s*stdout\| Verifies$/m);
    assert.match(out, /^\s*stderr: \(empty, 0 bytes\)$/m);
  });

  test('(a) CLI: the REAL apksigner 0.9 output (CRLF) exits 0 in debug posture and names the shape it read', () => {
    const { code, out, output } = run(fixture({ apksigner: PROBE_CRLF }));
    assert.equal(code, 0, out);
    assert.match(output, /^artifact_name=apps-gov-in-demo-apk-NOT-FOR-UPLOAD-debug-signed-build-proof$/m);
    assert.match(out, /apksigner read: shape "Signer #N", 1 distinct signer key\(s\) over 1 signer entry — .*fake-apksigner 0\.0/);
    assert.match(out, /^\s*stdout\| Signer #1 certificate DN: C=US, O=Android, CN=Android Debug\\r$/m);
  });

  test('(f) CLI: the v3.1 shape, one key, exits 0 in debug posture with the NOT-FOR-UPLOAD name', () => {
    const { code, out, output } = run(fixture({ apksigner: V31_ONE_KEY }));
    assert.equal(code, 0, out);
    assert.match(output, /^artifact_name=apps-gov-in-demo-apk-NOT-FOR-UPLOAD-debug-signed-build-proof$/m);
    assert.match(out, /apksigner read: shape "Signer \(minSdkVersion=…\)", 1 distinct signer key\(s\) over 2 signer entries/);
  });

  test('(c) CLI: the v3.1 shape with two keys exits 1 on the rotation and writes no artifact name', () => {
    const { code, out, output } = run(fixture({ apksigner: V31_TWO_KEYS }), [], 'release');
    assert.equal(code, 1, out);
    assert.match(out, /FAIL the \.apk carries a key rotation \(2 distinct signer keys\); an apps\.gov\.in upload carries exactly one key/);
    assert.doesNotMatch(output, /artifact_name=/);
  });

  test('(e) CLI: a certificate line under an unknown label is COVERAGE LOST naming the line, with what apksigner returned', () => {
    const { code, out } = run(fixture({ apksigner: `${apksignerText(DEBUG_SIGNER.dn, DEBUG_HEX)}Signer [x] certificate DN: CN=x\n` }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — apksigner printed a certificate line whose label is none of .*: "Signer \[x\] certificate DN: CN=x"/);
    assert.match(out, /^\s*stdout\| Signer \[x\] certificate DN: CN=x$/m);
  });

  test('aapt2 printing no minSdk line is COVERAGE LOST, and it PRINTS what aapt2 returned', () => {
    const fx = fixture({ apksigner: CI37_LF, badging: "package: name='com.nikatru.demo'\n" });
    const { code, out } = run(fx);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — aapt2 badging printed no sdkVersion or minSdkVersion line/);
    assert.ok(out.includes(`aapt2: ${join(fx.bt, process.platform === 'win32' ? 'aapt2.bat' : 'aapt2')}`), out);
    assert.match(out, /^\s*aapt2 dump badging exited 0$/m);
    assert.match(out, /^\s*stdout\| package: name='com\.nikatru\.demo'$/m);
  });

  test('(g) CLI: the REAL build-tools 37.0.0 output from CI exits 0 in debug posture with the NOT-FOR-UPLOAD name', () => {
    const { code, out, output } = run(fixture({ apksigner: CI37_LF }));
    assert.equal(code, 0, out);
    assert.match(output, /^artifact_name=apps-gov-in-demo-apk-NOT-FOR-UPLOAD-debug-signed-build-proof$/m);
    assert.match(out, /apksigner read: shape "V<n> Signer:", 1 distinct signer key\(s\) over 1 signer entry — /);
    assert.match(out, /^\s*stdout\| V2 Signer: certificate SHA-256 digest: d104989e5c22b0658db819055f6f0654d1887f2a9e29ffe32682bddb23359eff$/m);
  });

  test('debug-signed with the pin null exits 0, writes the NOT-FOR-UPLOAD name to $GITHUB_OUTPUT and says why in capitals', () => {
    const { code, out, output, summary } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(output, /^artifact_name=apps-gov-in-demo-apk-NOT-FOR-UPLOAD-debug-signed-build-proof$/m);
    assert.match(output, /^verdict=NOT-FOR-UPLOAD$/m);
    assert.match(summary, /\*\*THE APPSGOVIN_\* SECRETS ARE NOT SET/);
    assert.match(summary, /\| minSdk \| 24 — portal label "Nougat 7\.0" \|/);
    assert.match(summary, /\| versionName \| 1\.0\.7 \|/);
  });

  test('NEGATIVE, END TO END: a release signer against a fake non-null pin exits 1 and writes no artifact name', () => {
    const { code, out, output } = run(fixture({ pin: FAKE_PIN, apksigner: apksignerText(OWN_SIGNER.dn, OWN_HEX) }), [], 'release');
    assert.equal(code, 1, out);
    assert.match(out, /FAIL the signer .* does NOT match the pinned apps-gov-in certificate/);
    assert.doesNotMatch(output, /artifact_name=/);
  });

  test('a matching pin, end to end, is the name apps-gov-in-demo-apk', () => {
    const { code, out, output } = run(fixture({ pin: OWN_PIN, apksigner: apksignerText(OWN_SIGNER.dn, OWN_HEX) }), [], 'release');
    assert.equal(code, 0, out);
    assert.match(output, /^artifact_name=apps-gov-in-demo-apk$/m);
  });
});
