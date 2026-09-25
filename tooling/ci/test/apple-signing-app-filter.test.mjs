// apple-signing-app-filter.test.mjs — O-SECOND-APP-SIGNS-AS-THE-FIRST.
//
// APPLE_PROVISIONING_PROFILES_BASE64 is ONE secret for the whole account, so the
// day a second app is provisioned it carries every app's profiles. Before this
// file, tooling/ci/apple-signing.mjs installed all of them and exported
// APPLE_IOS_PROFILE_NAME / APPLE_MACOS_PROFILE_NAME through an
// `Object.fromEntries` over every profile it had parsed: with two apps in the
// zip the LAST member won, and `--app a` signed with app b's profile. Nothing
// failed until App Store Connect refused the upload.
//
// The fix keeps only the profiles whose bundle id is `apps.<--app>.bundleId` in
// tooling/apple-provisioning.json (read through apple-provisioning.mjs
// `bundleIdOf`, never derived here), and refuses anything but exactly one iOS
// (.mobileprovision) and one macOS (.provisionprofile) match.
//
// 🔴 EVERY CASE RUNS THE REAL SCRIPT END TO END, AS A SUBPROCESS, ON ANY OS.
// The exported names are written after the macOS platform gate and after
// `security`, so a Linux or Windows runner never reaches them. A preload
// (written into the temp directory below, never checked in) makes the child
// report `darwin` and answers every `security` call with exit 0 — and
// `find-identity` with one synthetic "Apple Distribution" line — so the whole of
// main() runs, and what it exported is read back out of --github-env. The shim
// replaces the one import bounded-spawn.mjs takes from node:child_process; if
// that seam moves, the GREEN CONTROL below stops reaching the export and says so.
//
// This file imports nothing that the pre-fix script lacked, so it RUNS against
// the old apple-signing.mjs and fails there on the assertion that matters
// (RC1: b's name exported for `--app a`), not on a missing export.
//
// Every Apple value here is synthetic: team ABCDE12345, bundle ids
// com.nikatru.a / com.nikatru.b, invented UUIDs. The zip is built in the test.
//
// Proof on real profiles is NOT here: it is the first build-platforms run on
// main after this lands. A fixture passing is not the real zip passing.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRegister, zipStored } from '../apple-provisioning.mjs';
import { ROLE_ENV, WANTED, expectedNames } from '../apple-signing.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREPARE = join(CI_DIR, 'apple-signing.mjs');

const TEAM = 'ABCDE12345';
const A = 'com.nikatru.a';
const B = 'com.nikatru.b';

let TMP;
let SHIM;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'apple-signing-app-filter-'));
  SHIM = join(TMP, 'darwin-shim.mjs');
  // The preload. Plain string concatenation, so no template literal is needed
  // inside it. `syncBuiltinESMExports` is what makes bounded-spawn.mjs's named
  // import `spawnSync` see the replacement.
  writeFileSync(
    SHIM,
    [
      "import { createRequire, syncBuiltinESMExports } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      "const cp = require('node:child_process');",
      "Object.defineProperty(process, 'platform', { value: 'darwin' });",
      'cp.spawnSync = (exe, args) => {',
      "  const line = '  1) ' + 'A'.repeat(40) + ' \"Apple Distribution: Fixture Team (" + TEAM + ")\"\\n     1 valid identities found\\n';",
      "  if (Array.isArray(args) && args[0] === 'find-identity') return { status: 0, stdout: line, stderr: '' };",
      "  return { status: 0, stdout: '', stderr: '' };",
      '};',
      'syncBuiltinESMExports();',
      '',
    ].join('\n'),
  );
});

after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** A hand-built profile: a DER-looking stub around the plist a real
 *  .mobileprovision / .provisionprofile carries. macOS spells the identifier key
 *  `com.apple.application-identifier`, as the real macOS profiles do. */
function profile({ name, bundleId, uuid, macos = false, expires = '2099-01-01T00:00:00Z' }) {
  const idKey = macos ? 'com.apple.application-identifier' : 'application-identifier';
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Entitlements</key>',
    '  <dict>',
    `    <key>${idKey}</key>`,
    `    <string>${TEAM}.${bundleId}</string>`,
    '  </dict>',
    '  <key>ExpirationDate</key>',
    `  <date>${expires}</date>`,
    '  <key>Name</key>',
    `  <string>${name}</string>`,
    '  <key>TeamIdentifier</key>',
    '  <array>',
    `  <string>${TEAM}</string>`,
    '  </array>',
    '  <key>TeamName</key>',
    '  <string>Fixture Team</string>',
    '  <key>UUID</key>',
    `  <string>${uuid}</string>`,
    '</dict>',
    '</plist>',
  ].join('\n');
  const head = Buffer.from([0x30, 0x82, 0x0f, 0xff, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  return Buffer.concat([head, Buffer.from(plist, 'utf8'), Buffer.alloc(32, 0x00)]);
}

const A_IOS = { name: 'Nikatru A iOS App Store', uuid: '00000000-0000-4000-8000-00000000a001' };
const A_MAC = { name: 'Nikatru A macOS App Store', uuid: '00000000-0000-4000-8000-00000000a002' };
const B_IOS = { name: 'Nikatru B iOS App Store', uuid: '00000000-0000-4000-8000-00000000b001' };
const B_MAC = { name: 'Nikatru B macOS App Store', uuid: '00000000-0000-4000-8000-00000000b002' };

const aIos = (o = {}) => ({ name: 'a-ios.mobileprovision', bytes: profile({ ...A_IOS, bundleId: A, ...o }) });
const aMac = (o = {}) => ({ name: 'a-macos.provisionprofile', bytes: profile({ ...A_MAC, bundleId: A, macos: true, ...o }) });
const bIos = (o = {}) => ({ name: 'b-ios.mobileprovision', bytes: profile({ ...B_IOS, bundleId: B, ...o }) });
const bMac = (o = {}) => ({ name: 'b-macos.provisionprofile', bytes: profile({ ...B_MAC, bundleId: B, macos: true, ...o }) });

/** A synthetic tooling/apple-provisioning.json: the smallest register
 *  validateRegister accepts, with one row per slug. */
function provisioningRegister(slugs) {
  return {
    anchor: { identifier: 'com.nikatru.anchor' },
    protected: { bundleIds: [], profiles: [], certificates: [] },
    capabilities: { IN_APP_PURCHASE: { apiWritable: true, entitlementKey: null, profileKey: null } },
    macosEntitlementFiles: { 'Runner/Release.entitlements': { 'com.apple.security.app-sandbox': true } },
    apps: Object.fromEntries(slugs.map((s) => [s, { bundleId: `com.nikatru.${s}`, capabilities: ['IN_APP_PURCHASE'] }])),
  };
}

function makeRoot({ apps = ['a', 'b'], registerApps = ['a', 'b'], provisioning = true } = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  const channels = ['ios-appstore', 'macos-appstore'].map((id) => ({
    id,
    submittable: true,
    served: false,
    lane: null,
    signing: { ciSecrets: { names: [...expectedNames(id)] } },
    submission: { workflow: '.github/workflows/submit-appstore.yml' },
  }));
  writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels }));
  writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(apps.map((slug) => ({ slug }))));
  if (provisioning) {
    writeFileSync(join(root, 'tooling', 'apple-provisioning.json'), JSON.stringify(provisioningRegister(registerApps)));
  }
  return root;
}

function fakeP12() {
  const b = Buffer.alloc(256, 0x41);
  b[0] = 0x30;
  b[1] = 0x82;
  b.writeUInt16BE(252, 2);
  return b;
}

/** Runs the real script with the four Apple secrets supplied and the darwin
 *  preload. `exported` is what landed in --github-env, as a map. */
function run(root, members, { app = 'a' } = {}) {
  const n = seq++;
  const outDir = join(TMP, `out${n}`);
  const ghEnv = join(TMP, `ghenv${n}.txt`);
  const home = join(TMP, `home${n}`);
  mkdirSync(home, { recursive: true });
  const blank = Object.fromEntries(WANTED.map((k) => [k, '']));
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(SHIM).href, PREPARE, '--app', app, '--repo-root', root, '--out', outDir, '--github-env', ghEnv],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...blank,
        GITHUB_REF: '',
        GITHUB_WORKFLOW_REF: '',
        [ROLE_ENV.installerP12]: '',
        HOME: home,
        [ROLE_ENV.p12]: fakeP12().toString('base64'),
        [ROLE_ENV.p12Password]: 'fixture-passphrase',
        [ROLE_ENV.profiles]: zipStored(members).toString('base64'),
        [ROLE_ENV.teamId]: TEAM,
      },
    },
  );
  const exported = existsSync(ghEnv)
    ? Object.fromEntries(
        readFileSync(ghEnv, 'utf8')
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};
  const installed = (sub) => {
    const dir = join(home, ...sub);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };
  return { r, outDir, exported, installed, text: `${r.stdout}${r.stderr}` };
}

const XCODE_16_DIR = ['Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'];

describe('apple-signing --app keeps only that app\'s profiles', () => {
  test('GREEN CONTROL — the synthetic register is one validateRegister accepts', () => {
    // Without this, every refusal below is consistent with a fixture the script
    // rejects for a reason that has nothing to do with the filter.
    assert.deepEqual(validateRegister(provisioningRegister(['a', 'b'])), []);
  });

  test('GREEN CONTROL — one app\'s two profiles reach the export through the darwin preload', () => {
    // The harness itself: if this is red, the preload no longer reaches
    // exportEnv and every case below is measuring nothing.
    const { r, exported, text } = run(makeRoot(), [aIos(), aMac()]);
    assert.equal(r.status, 0, text);
    assert.equal(exported.APPLE_SIGNING_POSTURE, 'release-signed', text);
    assert.equal(exported.APPLE_IOS_PROFILE_NAME, A_IOS.name, text);
    assert.equal(exported.APPLE_MACOS_PROFILE_NAME, A_MAC.name, text);
  });

  test('RC1 — a zip carrying a\'s and b\'s profiles, --app a: a\'s names are exported, not the last member\'s', () => {
    const { r, exported, text } = run(makeRoot(), [aIos(), aMac(), bIos(), bMac()]);
    assert.equal(r.status, 0, text);
    assert.equal(exported.APPLE_IOS_PROFILE_NAME, A_IOS.name, `--app a exported "${exported.APPLE_IOS_PROFILE_NAME}" as the iOS profile`);
    assert.equal(exported.APPLE_MACOS_PROFILE_NAME, A_MAC.name, `--app a exported "${exported.APPLE_MACOS_PROFILE_NAME}" as the macOS profile`);
  });

  test('RC1, member order reversed — --app b gets b\'s names with a\'s profiles last in the zip', () => {
    const { r, exported, text } = run(makeRoot(), [bIos(), bMac(), aIos(), aMac()], { app: 'b' });
    assert.equal(r.status, 0, text);
    assert.equal(exported.APPLE_IOS_PROFILE_NAME, B_IOS.name, text);
    assert.equal(exported.APPLE_MACOS_PROFILE_NAME, B_MAC.name, text);
  });

  test('only the kept profiles are installed where Xcode looks — b\'s UUIDs are not', () => {
    const { r, installed, text } = run(makeRoot(), [aIos(), aMac(), bIos(), bMac()]);
    assert.equal(r.status, 0, text);
    assert.deepEqual(installed(XCODE_16_DIR), [`${A_IOS.uuid}.mobileprovision`, `${A_MAC.uuid}.provisionprofile`]);
  });

  test('only the kept profiles are written to the profiles directory, and ExportOptions maps only a', () => {
    const { r, outDir, text } = run(makeRoot(), [aIos(), aMac(), bIos(), bMac()]);
    assert.equal(r.status, 0, text);
    assert.deepEqual(readdirSync(join(outDir, 'a-profiles')).sort(), ['a-ios.mobileprovision', 'a-macos.provisionprofile']);
    const plist = readFileSync(join(outDir, 'a-ExportOptions.plist'), 'utf8');
    assert.match(plist, /<key>com\.nikatru\.a<\/key>/);
    assert.doesNotMatch(plist, /com\.nikatru\.b/);
  });

  test('the run log says what was kept and what was dropped (other app)', () => {
    const { r, text } = run(makeRoot(), [aIos(), aMac(), bIos(), bMac()]);
    assert.equal(r.status, 0, text);
    assert.match(text, /kept\b.*com\.nikatru\.a/);
    assert.match(text, /"Nikatru A iOS App Store"/);
    assert.match(text, /dropped \(other app\)/);
    assert.match(text, /"Nikatru B macOS App Store" → com\.nikatru\.b/);
  });

  test('an EXPIRED profile of another app does not stop this app — the expiry check reads the kept set', () => {
    const { r, exported, text } = run(makeRoot(), [aIos(), aMac(), bIos({ expires: '2020-01-01T00:00:00Z' }), bMac()]);
    assert.equal(r.status, 0, text);
    assert.equal(exported.APPLE_IOS_PROFILE_NAME, A_IOS.name, text);
  });

  test('an EXPIRED profile of THIS app still fails', () => {
    const { r, text } = run(makeRoot(), [aIos({ expires: '2020-01-01T00:00:00Z' }), aMac(), bIos(), bMac()]);
    assert.equal(r.status, 1, text);
    assert.match(text, /EXPIRED provisioning profile/);
  });
});

describe('apple-signing --app refuses anything but one iOS and one macOS match', () => {
  test('RC3 — a\'s iOS profile only: exit 1 naming a, its bundle id and "0 macOS profile"', () => {
    const { r, outDir, exported, text } = run(makeRoot(), [aIos(), bIos(), bMac()]);
    assert.equal(r.status, 1, text);
    assert.match(text, /--app a\b/);
    assert.match(text, /com\.nikatru\.a/);
    assert.match(text, /\b1 iOS profile/);
    assert.match(text, /\b0 macOS profile/);
    assert.equal(exported.APPLE_IOS_PROFILE_NAME, undefined, 'a refused run exported a profile name');
    assert.ok(!existsSync(join(outDir, 'a-distribution.p12')), 'a refused run wrote key material');
  });

  test('two iOS profiles for a: exit 1 naming "2 iOS profile", never a pick between them', () => {
    const second = { name: 'a-ios-2.mobileprovision', bytes: profile({ name: 'Nikatru A iOS Second', uuid: '00000000-0000-4000-8000-00000000a003', bundleId: A }) };
    const { r, text } = run(makeRoot(), [aIos(), second, aMac()]);
    assert.equal(r.status, 1, text);
    assert.match(text, /\b2 iOS profile/);
    assert.match(text, /\b1 macOS profile/);
  });

  test('a zip holding only b\'s profiles, --app a: exit 1 naming "0 iOS profile" and "0 macOS profile"', () => {
    const { r, text } = run(makeRoot(), [bIos(), bMac()]);
    assert.equal(r.status, 1, text);
    assert.match(text, /\b0 iOS profile/);
    assert.match(text, /\b0 macOS profile/);
    assert.match(text, /dropped \(other app\)/);
  });

  test('RC4 — --app zz with no row in tooling/apple-provisioning.json: exit 1 naming zz', () => {
    const { r, outDir, text } = run(makeRoot({ apps: ['a', 'b', 'zz'] }), [aIos(), aMac()], { app: 'zz' });
    assert.equal(r.status, 1, text);
    assert.match(text, /"zz"/);
    assert.match(text, /tooling\/apple-provisioning\.json/);
    assert.ok(!existsSync(join(outDir, 'zz-distribution.p12')), 'a refused run wrote key material');
  });

  test('COVERAGE LOST when tooling/apple-provisioning.json is absent — no bundle id to keep', () => {
    const { r, text } = run(makeRoot({ provisioning: false }), [aIos(), aMac()]);
    assert.equal(r.status, 2, text);
    assert.match(text, /COVERAGE LOST/);
    assert.match(text, /tooling\/apple-provisioning\.json/);
  });
});
