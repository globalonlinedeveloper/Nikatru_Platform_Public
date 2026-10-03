// ─────────────────────────────────────────────────────────────────────────────
// runtime-signer-check.test.mjs — tooling/ci/assert-runtime-signer-check.mjs and
// the build-time refusal it grades (flutter-release-build.mjs
// `unpinnedReleaseRefusal`). Row O-APPS-GOV-IN-VAPT-CHECKLIST.
//
// Every case runs on a COPY OF THE REAL FILES the guard reads (the register,
// the generated pins, every wiring file, every app's main() and the brick's),
// so the green control is the real tree's verdict, and each red case breaks
// exactly one thing in that copy and requires the guard to name it.
//
// Run:  node --test tooling/ci/test/runtime-signer-check.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, renderSignerPins, WIRING, REGISTER } from '../assert-runtime-signer-check.mjs';
import { unpinnedReleaseRefusal, signerPinsOf, RELEASE_SIGNING_ENV } from '../flutter-release-build.mjs';
import { appSignerPinsOf, renderAppSignerPinsDart, SIGNER_PINS_DART } from '../../app-yaml/render.mjs';
import { parseYaml } from '../../app-yaml/yaml.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-runtime-signer-check.mjs');
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_MAIN = `${BRICK}/lib/main.dart`;
const APP = 'apps/subscriptiontracker';
const RELEASE_ENV = Object.fromEntries(RELEASE_SIGNING_ENV.map((n) => [n, 'x']));

const realRegister = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));

function filesToCopy() {
  // The one shipping app and the brick: each one's main(), app shell and the
  // helper the app's main() imports. A new app is graded by the guard on the
  // real tree (the green control below), not by this copy.
  const set = new Set([
    REGISTER, realRegister.runtimeSignerCheck.generated, ...WIRING.map((w) => w.file),
    BRICK_MAIN, `${BRICK}/lib/app.dart`,
    `${APP}/app.yaml`, `${APP}/lib/main.dart`, `${APP}/lib/app.dart`, `${APP}/lib/core/device_integrity.dart`, `${APP}/${SIGNER_PINS_DART}`,
  ]);
  for (const row of realRegister.channels) for (const a of row.storeReview?.answers ?? []) for (const f of a.evidence ?? []) set.add(f);
  return [...set];
}

let ROOT;
beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'runtime-signer-check-'));
  for (const rel of filesToCopy()) {
    mkdirSync(dirname(join(ROOT, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(ROOT, rel));
  }
});
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

const readReg = () => JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
const writeReg = (r) => writeFileSync(join(ROOT, REGISTER), JSON.stringify(r, null, 2) + '\n');
const edit = (rel, from, to) => {
  const p = join(ROOT, rel);
  const t = readFileSync(p, 'utf8');
  assert.ok(t.includes(from), `fixture ${rel} no longer contains ${JSON.stringify(from)} — the case would mutate nothing`);
  writeFileSync(p, t.replace(from, to));
};
const run = (...args) => spawnSync(process.execPath, [GUARD, '--root', ROOT, ...args], { encoding: 'utf8' });
const findings = () => check(ROOT).problems.join('\n');

describe('green control', () => {
  test('the real files are green, through the CLI', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^ok {2}runtime signer check — 2 Android channel/);
  });

  test('the real tree itself is green', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});

describe('COVERAGE LOST (exit 2)', () => {
  test('no runtimeSignerCheck block', () => {
    const r = readReg();
    delete r.runtimeSignerCheck;
    writeReg(r);
    const out = run();
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, /^COVERAGE LOST/);
  });

  test('an empty channels map', () => {
    const r = readReg();
    r.runtimeSignerCheck.channels = {};
    writeReg(r);
    assert.equal(run().status, 2);
  });

  test('an unreadable register', () => {
    writeFileSync(join(ROOT, REGISTER), '{not json');
    assert.equal(run().status, 2);
  });
});

describe('S1 register shape', () => {
  test('a pin path the row does not have', () => {
    const r = readReg();
    r.runtimeSignerCheck.channels['apps-gov-in'].pins = ['signing.nope.sha256'];
    writeReg(r);
    assert.match(findings(), /S1 .*"signing\.nope\.sha256", which row "apps-gov-in" does not have/);
  });

  test('a pin that is not a colon-separated uppercase SHA-256', () => {
    const r = readReg();
    r.channels.find((c) => c.id === 'android-play').signing.uploadCertificate.sha256 = 'abc';
    writeReg(r);
    assert.match(findings(), /S1 android-play signing\.uploadCertificate\.sha256 is "abc"/);
  });

  test('a channel that is not android', () => {
    const r = readReg();
    r.runtimeSignerCheck.channels.web = { pins: ['id'], unpinnedReleaseBuild: 'allowed' };
    writeReg(r);
    assert.match(findings(), /S1 runtimeSignerCheck names "web", whose platforms \["web"\] are not android/);
  });

  test('an unknown unpinnedReleaseBuild', () => {
    const r = readReg();
    r.runtimeSignerCheck.channels['apps-gov-in'].unpinnedReleaseBuild = 'maybe';
    writeReg(r);
    assert.match(findings(), /S1 .*unpinnedReleaseBuild is "maybe"/);
  });
});

describe('S2 coverage', () => {
  test('a pinned android channel with no entry has no runtime check', () => {
    const r = readReg();
    delete r.runtimeSignerCheck.channels['android-play'];
    writeReg(r);
    assert.match(findings(), /S2 channel "android-play" pins signing\.uploadCertificate\.sha256 and has no runtimeSignerCheck entry/);
  });

  test('a pin the row carries and the entry does not list', () => {
    // ⏱ 2026-10-03: the row's app-signing value moved to each app's app.yaml
    // (ADR 030, one key per app), so a channel-row pin is planted here.
    const r = readReg();
    r.channels.find((c) => c.id === 'android-play').signing.extraCertificate = { sha256: null };
    writeReg(r);
    assert.match(findings(), /S2 channel "android-play" carries pin signing\.extraCertificate\.sha256/);
  });

  test('the row holds NO app-signing value: it lives per app, in app.yaml (one source)', () => {
    const asc = realRegister.channels.find((c) => c.id === 'android-play').signing.appSigningCertificate;
    assert.equal(Object.hasOwn(asc, 'sha256'), false);
    assert.match(asc.perApp, /apps\/<id>\/app\.yaml stores\.android-play\.appSigningSha256/);
  });
});

describe('S3 the generated pins are the register', () => {
  test('a pin edited in the register and not regenerated', () => {
    const r = readReg();
    r.channels.find((c) => c.id === 'apps-gov-in').signing.signingCertificate.sha256 = Array(32).fill('AB').join(':');
    writeReg(r);
    assert.match(findings(), /S3 .*signer_pins\.g\.dart is not what the register renders/);
  });

  test('a digest hand-edited in the generated file', () => {
    edit(realRegister.runtimeSignerCheck.generated, '43C84D11', '43C84D12');
    assert.match(findings(), /S3 /);
  });

  test('--write regenerates it, and then it is green', () => {
    const r = readReg();
    const pin = Array(32).fill('AB').join(':');
    r.channels.find((c) => c.id === 'apps-gov-in').signing.signingCertificate.sha256 = pin;
    writeReg(r);
    const out = run('--write');
    assert.equal(out.status, 0, out.stderr);
    const gen = readFileSync(join(ROOT, r.runtimeSignerCheck.generated), 'utf8');
    assert.ok(gen.includes(`'${'AB'.repeat(32)}'`));
    assert.match(gen, /'apps-gov-in': SignerPins\(\n {4}digests: <String>\[\n {6}'(AB){32}',\n {4}\],\n {4}complete: true,/);
  });

  test('the channel default carries the factory pins only, and says the app\'s own pin completes it', () => {
    const text = renderSignerPins(realRegister);
    assert.match(text, /'android-play': SignerPins\(\n {4}digests: <String>\[\n {6}'43C84D11[0-9A-F]+',\n {4}\],\n {4}complete: false,\n {4}appPinCompletes: true,\n {2}\),/);
    assert.doesNotMatch(text, /98FA5FDC/);
    assert.match(text, /\+ per app: stores\.android-play\.appSigningSha256/);
    // ...and it names no app ([C-10]: shared code carries no app vocabulary).
    assert.doesNotMatch(text, /subscriptiontracker/);
  });

  test('the real app\'s OWN file holds ITS app signing pin — and is unchanged', () => {
    const own = readFileSync(join(REPO, APP, SIGNER_PINS_DART), 'utf8');
    assert.match(own, /const Map<String, List<String>> kAppSignerPins = <String, List<String>>\{\n {2}'android-play': <String>\[\n {4}'98FA5FDCA1491BEC84198D3DABE797B0432985741581BBFEA2555B176C833A3C',\n {2}\],\n\};/);
  });

  test('🔴 an app whose own pins file is missing', () => {
    rmSync(join(ROOT, APP, SIGNER_PINS_DART));
    assert.match(findings(), /S3 apps\/subscriptiontracker\/lib\/core\/signer_pins\.g\.dart does not exist/);
  });
});

// ── ⏱ 2026-10-03 · S8: ONE APP SIGNING KEY PER APP (ruling on PR #1198, ADR 030) ──
// A second app is stamped into the copy from the real app's files, so every
// other limb grades it exactly as it grades app #1.
const SECOND = 'apps/second';
const KEY2 = Array(32).fill('CD').join(':');
function stampSecond(storesPlay, listing = null) {
  for (const rel of ['app.yaml', 'lib/main.dart', 'lib/app.dart', 'lib/core/device_integrity.dart', SIGNER_PINS_DART]) {
    mkdirSync(dirname(join(ROOT, SECOND, rel)), { recursive: true });
    copyFileSync(join(ROOT, APP, rel), join(ROOT, SECOND, rel));
  }
  const p = join(ROOT, SECOND, 'app.yaml');
  let y = readFileSync(p, 'utf8');
  const play = /\n {2}android-play:\n(?: {4}.*\n)+/;
  assert.match(y, play, 'the real app.yaml no longer has an android-play record to replace');
  y = y.replace(play, `\n  android-play:\n${storesPlay.map((l) => `    ${l}\n`).join('')}`);
  if (listing !== null) {
    assert.match(y, /\nlistings:\n/);
    y = y.replace('\nlistings:\n', `\nlistings:\n  play: ${listing}\n`);
  }
  writeFileSync(p, y);
  // Its own pins file, as tooling/app-yaml/render.mjs writes it.
  writeFileSync(join(ROOT, SECOND, SIGNER_PINS_DART), renderAppSignerPinsDart(appSignerPinsOf(realRegister, parseYaml(y))));
  return y;
}

describe('S8 per-app pins', () => {
  test('a second app with ITS OWN key gets its own pin, and app #1\'s is unchanged', () => {
    stampSecond(['state: issued', 'declaredOn: null', 'appSigningSha256:', `  - "${KEY2}"`]);
    assert.equal(findings(), '');
    const second = readFileSync(join(ROOT, SECOND, SIGNER_PINS_DART), 'utf8');
    assert.match(second, /'android-play': <String>\[\n {4}'(CD){32}',\n {2}\],/);
    assert.doesNotMatch(second, /98FA5FDC/);
    const first = readFileSync(join(ROOT, APP, SIGNER_PINS_DART), 'utf8');
    assert.equal(first, readFileSync(join(REPO, APP, SIGNER_PINS_DART), 'utf8'));
    assert.doesNotMatch(first, /CDCDCDCD/);
    // The shared channel default carries neither app's key.
    assert.doesNotMatch(readFileSync(join(ROOT, realRegister.runtimeSignerCheck.generated), 'utf8'), /98FA5FDC|CDCDCDCD/);
  });

  test('a second app with no key renders an EMPTY own-pins file', () => {
    stampSecond(['state: pending', 'declaredOn: null']);
    assert.match(readFileSync(join(ROOT, SECOND, SIGNER_PINS_DART), 'utf8'), /kAppSignerPins = <String, List<String>>\{\};/);
  });

  test('🔴 a second app ON Play (a listing) with no recorded key FAILS', () => {
    stampSecond(['state: pending', 'declaredOn: null'], 'https://play.google.com/store/apps/details?id=com.nikatru.second');
    assert.match(findings(), /S8 apps\/second\/app\.yaml says the app is on android-play \(listings\.play is .*\) and records no stores\.android-play\.appSigningSha256/);
  });

  test('🔴 a second app with an issued Play record and no key FAILS', () => {
    stampSecond(['state: issued', 'declaredOn: null']);
    assert.match(findings(), /S8 apps\/second\/app\.yaml says the app is on android-play \(stores\.android-play\.state is issued\)/);
  });

  test('a second app NOT yet on Play, with no key, is green: it compiles the channel default and reports only', () => {
    stampSecond(['state: pending', 'declaredOn: null']);
    assert.equal(findings(), '');
  });

  test('🔴 two apps recording the SAME app signing key: one is a copy', () => {
    stampSecond(['state: issued', 'declaredOn: null', 'appSigningSha256:', '  - "98:FA:5F:DC:A1:49:1B:EC:84:19:8D:3D:AB:E7:97:B0:43:29:85:74:15:81:BB:FE:A2:55:5B:17:6C:83:3A:3C"']);
    assert.match(findings(), /S8 apps\/subscriptiontracker\/app\.yaml and apps\/second\/app\.yaml record the same stores\.android-play\.appSigningSha256|S8 apps\/second\/app\.yaml and apps\/subscriptiontracker\/app\.yaml record the same/);
  });

  test('🔴 a per-app pin that is not a SHA-256', () => {
    stampSecond(['state: issued', 'declaredOn: null', 'appSigningSha256:', '  - "abc"']);
    assert.match(findings(), /S8 apps\/second\/app\.yaml stores\.android-play\.appSigningSha256 holds "abc"/);
  });

  test('signerPinsOf: the channel default is incomplete; with the app\'s own pin it is complete', () => {
    assert.equal(signerPinsOf(realRegister, 'android-play').complete, false);
    assert.equal(signerPinsOf(realRegister, 'android-play', null).complete, false);
    assert.equal(signerPinsOf(realRegister, 'android-play', [KEY2]).complete, true);
  });
});

describe('S9 internal app sharing', () => {
  test('🔴 a workflow uploading to internal app sharing while no key for it is pinned', () => {
    mkdirSync(join(ROOT, '.github/workflows'), { recursive: true });
    writeFileSync(join(ROOT, '.github/workflows/share.yml'), 'jobs:\n  share:\n    steps:\n      - run: curl https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/internalappsharing/x/artifacts/bundle\n');
    assert.match(findings(), /S9 \.github\/workflows\/share\.yml uploads to Play's internal app sharing/);
  });

  test('🔴 a per-app channel that does not say whether internal sharing is used', () => {
    const r = readReg();
    delete r.runtimeSignerCheck.channels['android-play'].internalAppSharing;
    writeReg(r);
    assert.match(findings(), /S1 runtimeSignerCheck\.channels\.android-play names a perAppPin and no internalAppSharing/);
  });
});

describe('S4 the build-time refusal, and only for that channel\'s release build', () => {
  test('apps-gov-in, release-signed, pin null: refused', () => {
    assert.match(unpinnedReleaseRefusal({ root: ROOT, channel: 'apps-gov-in', env: RELEASE_ENV }), /signing\.signingCertificate\.sha256 is not set/);
  });

  test('apps-gov-in, debug-signed (no signing variables): allowed', () => {
    assert.equal(unpinnedReleaseRefusal({ root: ROOT, channel: 'apps-gov-in', env: {} }), null);
  });

  test('apps-gov-in, a PARTIAL set of signing variables is not a release build', () => {
    const { ANDROID_KEY_PASSWORD, ...three } = RELEASE_ENV;
    assert.equal(unpinnedReleaseRefusal({ root: ROOT, channel: 'apps-gov-in', env: three }), null);
  });

  test('android-play, release-signed, app signing pin null: allowed', () => {
    // ⏱ 2026-10-03: with no app the per-app pin is null — the channel default.
    assert.equal(unpinnedReleaseRefusal({ root: ROOT, channel: 'android-play', env: RELEASE_ENV }), null);
  });

  test('apps-gov-in, release-signed, once pinned: allowed', () => {
    const r = readReg();
    r.channels.find((c) => c.id === 'apps-gov-in').signing.signingCertificate.sha256 = Array(32).fill('AB').join(':');
    writeReg(r);
    assert.equal(unpinnedReleaseRefusal({ root: ROOT, channel: 'apps-gov-in', env: RELEASE_ENV }), null);
  });

  test('a channel with no entry is never refused', () => {
    assert.equal(unpinnedReleaseRefusal({ root: ROOT, channel: 'web', env: RELEASE_ENV }), null);
  });

  test('the guard reds when an app-signing-key channel stops refusing', () => {
    const r = readReg();
    r.runtimeSignerCheck.channels['apps-gov-in'].unpinnedReleaseBuild = 'allowed';
    writeReg(r);
    assert.match(findings(), /S1 runtimeSignerCheck\.channels\.apps-gov-in\.unpinnedReleaseBuild is "allowed", and "apps-gov-in" signs with an app-signing-key/);
  });

  test('signerPinsOf reports completeness per channel', () => {
    assert.equal(signerPinsOf(realRegister, 'android-play').complete, false);
    assert.equal(signerPinsOf(realRegister, 'apps-gov-in').complete, false);
    assert.equal(signerPinsOf(realRegister, 'web'), null);
  });
});

describe('S6 wiring', () => {
  test('the Kotlin handler stops reading GET_SIGNING_CERTIFICATES', () => {
    edit('packages/platform_storage/android/src/main/kotlin/com/nikatru/platform_storage/DeviceIntegrityHandler.kt', 'PackageManager.GET_SIGNING_CERTIFICATES', 'PackageManager.GET_META_DATA');
    assert.match(findings(), /S6 .*DeviceIntegrityHandler\.kt lacks .*GET_SIGNING_CERTIFICATES/);
  });

  test('the plugin stops registering the channel', () => {
    edit('packages/platform_storage/android/src/main/kotlin/com/nikatru/platform_storage/AgeSignalsPlugin.kt', '"nikatru/device_integrity"', '"nikatru/something_else"');
    assert.match(findings(), /S6 .*AgeSignalsPlugin\.kt lacks/);
  });

  test('the comparison stops reading the generated pins', () => {
    edit('packages/core/lib/src/integrity/device_integrity.dart', 'kSignerPinsByChannel[releaseChannel]', "const <String, SignerPins>{}[releaseChannel]");
    assert.match(findings(), /S6 .*device_integrity\.dart lacks/);
  });

  test('the bootstrap initialises identity BEFORE the check', () => {
    const rel = 'packages/chassis_screens/lib/shell/bootstrap.dart';
    const t = readFileSync(join(ROOT, rel), 'utf8');
    const moved = t.replace('    await initialiseIdentity();\n', '').replace('    if (await modifiedCopyBlocked(', '    await initialiseIdentity();\n    if (await modifiedCopyBlocked(');
    assert.notEqual(moved, t);
    writeFileSync(join(ROOT, rel), moved);
    assert.match(findings(), /S6 .*bootstrap\.dart: .*out of order/);
  });

  test('the gate stops running the modified-copy app on a block', () => {
    edit('packages/chassis_screens/lib/integrity/device_integrity_gate.dart', 'runApp(const TamperedBuildApp());', '// nothing');
    assert.match(findings(), /S6 .*device_integrity_gate\.dart: .*out of order/);
  });

  test('the brick main() stops passing the compiled channel', () => {
    edit(BRICK_MAIN, 'releaseChannel: AppConfig.releaseChannel', "releaseChannel: 'android-play'");
    assert.match(findings(), /S6 tooling\/bricks\/.*main\.dart/);
  });

  test('the brick app.dart stops mounting the rooted notice', () => {
    edit(`${BRICK}/lib/app.dart`, 'RootedDeviceNoticeHost(child: child)', 'child');
    assert.match(findings(), /S6 tooling\/bricks\/.*app\.dart mounts no RootedDeviceNoticeHost/);
  });

  test('the app main() stops calling its integrity step', () => {
    edit(`${APP}/lib/main.dart`, '      if (await integrityBootBlocks(telemetry)) return;', '      // removed');
    assert.match(findings(), /S6 apps\/subscriptiontracker\/lib\/main\.dart neither calls bootstrapNikatru/);
  });

  test('the app main() calls it AFTER identity', () => {
    const rel = `${APP}/lib/main.dart`;
    const t = readFileSync(join(ROOT, rel), 'utf8');
    const line = '      if (await integrityBootBlocks(telemetry)) return; // core/device_integrity\n';
    assert.ok(t.includes(line));
    const moved = t.replace(line, '').replace('      runApp(\n', `${line}      runApp(\n`);
    assert.notEqual(moved, t);
    writeFileSync(join(ROOT, rel), moved);
    assert.match(findings(), /S6 apps\/subscriptiontracker\/lib\/main\.dart neither calls bootstrapNikatru/);
  });

  test('the app helper stops passing the platform probe', () => {
    edit(`${APP}/lib/core/device_integrity.dart`, 'integrityProbe: platformDeviceIntegrityProbe()', 'integrityProbe: null');
    assert.match(findings(), /S6 apps\/subscriptiontracker: integrityBootBlocks\(\) .*platformDeviceIntegrityProbe/);
  });

  test('🔴 the app helper stops passing ITS OWN pins', () => {
    edit(`${APP}/lib/core/device_integrity.dart`, 'appPins: kAppSignerPins', 'appPins: const <String, List<String>>{}');
    assert.match(findings(), /S6 apps\/subscriptiontracker: integrityBootBlocks\(\) .*appPins/);
  });

  test('🔴 the brick main() stops passing its own pins', () => {
    edit(BRICK_MAIN, 'appPins: kAppSignerPins', 'appPins: const <String, List<String>>{}');
    assert.match(findings(), /S6 tooling\/bricks\/.*main\.dart: \/appPins/);
  });

  test('🔴 the comparison stops adding the app\'s own pins', () => {
    edit('packages/core/lib/src/integrity/device_integrity.dart', 'appPins[releaseChannel]', 'const <String, List<String>>{}[releaseChannel]');
    assert.match(findings(), /S6 .*device_integrity\.dart lacks .*appPins/);
  });

  test('the app app.dart stops mounting the rooted notice', () => {
    edit(`${APP}/lib/app.dart`, 'RootedDeviceNoticeHost(child: child)', 'child');
    assert.match(findings(), /S6 apps\/subscriptiontracker\/lib\/app\.dart mounts no RootedDeviceNoticeHost/);
  });

  test('the brick main() unreadable is COVERAGE LOST', () => {
    rmSync(join(ROOT, BRICK_MAIN));
    assert.equal(run().status, 2);
  });
});

describe('S7 store-review evidence', () => {
  test('a cited file that moved', () => {
    const r = readReg();
    r.channels.find((c) => c.id === 'apps-gov-in').storeReview.answers[0].evidence.push('packages/nowhere.dart');
    writeReg(r);
    assert.match(findings(), /S7 apps-gov-in storeReview "Root detection" cites packages\/nowhere\.dart/);
  });

  test('the three answers the review asks for are all there', () => {
    const items = realRegister.channels.find((c) => c.id === 'apps-gov-in').storeReview.answers.map((a) => a.item);
    assert.deepEqual(items, ['Root detection', 'Code obfuscation', 'Runtime signature check']);
  });
});
