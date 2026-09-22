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
// real without an Android SDK on the test host. The fixture text is the shape
// build-tools 36 prints; the pure-function cases pin the parsers to it.
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
  parseBadging,
  portalLabel,
  decideArtifact,
  checkFormAnswers,
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

function fakeTool(dir, name, envOut, envCode) {
  if (process.platform === 'win32') {
    writeFileSync(join(dir, `${name}.bat`), `@type "%${envOut}%"\r\n@exit /b %${envCode}%\r\n`);
  } else {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\ncat "$${envOut}"\nexit "$${envCode}"\n`);
    chmodSync(p, 0o755);
  }
}

/** A repo root with a register and form answers, an .apk, and fake tools. */
function fixture({ pin = null, apksigner = apksignerText(DEBUG_SIGNER.dn, DEBUG_HEX), badging = badgingText(), tools = true, form = answers() } = {}) {
  const root = join(TMP, `r${++seq}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({
    channels: [
      { id: 'android-play', signing: { uploadCertificate: { sha256: PLAY_PIN } } },
      { id: 'apps-gov-in', signing: { signingCertificate: { sha256: pin } } },
    ],
  }));
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

  test('apksigner printing no signer is COVERAGE LOST: the format moved, the signer is unread', () => {
    const { code, out } = run(fixture({ apksigner: 'Verifies\n' }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — apksigner exited 0 and printed no "Signer #1 certificate" lines/);
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
