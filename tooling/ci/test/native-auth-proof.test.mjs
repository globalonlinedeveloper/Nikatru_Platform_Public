// tooling/e2e/native_auth_proof.mjs — the per-target native sign-in proof's
// driver (ST-N1g). What it reads back decides a channel row's nativeAuth, so a
// reading that cannot fail would flip a row on no evidence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  afterOpenDiagnostics,
  appOpensCallback,
  callbackUrl,
  egressIpOf,
  FAILED_CALLBACK_LINE,
  openCommands,
  readProof,
} from '../../e2e/native_auth_proof.mjs';

const GREEN = [
  'NK_PROOF egress_ip=203.0.113.9',
  'NK_PROOF step=sign-in outcome=ok',
  'NK_PROOF step=sign-up-registered answer=ok',
  'NK_PROOF step=recover-unregistered answer=ok',
  'NK_PROOF step=sign-out outcome=ok',
  'NK_PROOF_AWAIT_CALLBACK',
  FAILED_CALLBACK_LINE,
  'NK_PROOF step=callback outcome=ok',
].join('\n');

describe('native_auth_proof — reading the run back', () => {
  test('a complete callback run reads clean', () => {
    assert.deepEqual(readProof(GREEN, { callback: true }), []);
  });

  test('🔴 a gated call that answered captcha_failed is a finding, whatever flutter exited', () => {
    const out = GREEN.replace('recover-unregistered answer=ok', 'recover-unregistered answer=captcha_failed');
    assert.match(readProof(out, { callback: true }).join('\n'), /recover-unregistered answered captcha_failed/);
  });

  test('🔴 no sign-in line is a finding: the form did not reach Home', () => {
    const out = GREEN.replace('NK_PROOF step=sign-in outcome=ok', '');
    assert.match(readProof(out, { callback: true }).join('\n'), /step=sign-in outcome=ok/);
  });

  test('🔴 a callback run without the failed-exchange line is a finding', () => {
    const out = GREEN.replace(FAILED_CALLBACK_LINE, '');
    assert.match(readProof(out, { callback: true }).join('\n'), /nk_auth_callback flow=reset outcome=failed/);
  });

  test('a sign-in-only run (windows) does not need the callback lines', () => {
    const out = GREEN.replace(FAILED_CALLBACK_LINE, '').replace('NK_PROOF step=callback outcome=ok', '');
    assert.deepEqual(readProof(out, { callback: false }), []);
  });

  test('egressIpOf reads ip= off a /cdn-cgi/trace body', () => {
    assert.equal(egressIpOf('fl=1\nh=platform.nikatru.com\nip=198.51.100.7\nts=1\n'), '198.51.100.7');
    assert.equal(egressIpOf('no address here'), null);
  });
});

describe('native_auth_proof — how each OS is handed the callback', () => {
  const url = callbackUrl('demoapp');

  test('the callback is the app\'s own reset marker with an unusable code', () => {
    assert.equal(url, 'com.nikatru.demoapp://auth-callback?nk_auth=reset&code=st-n1-invalid');
  });

  test('android: am start VIEW, the URL quoted for the device shell', () => {
    const [cmd] = openCommands('android', url, { app: 'demoapp', root: '.', device: 'emulator-5554' });
    assert.deepEqual(cmd.slice(0, 4), ['adb', '-s', 'emulator-5554', 'shell']);
    assert.match(cmd[4], /^am start -W -a android\.intent\.action\.VIEW -d '.+&code=st-n1-invalid'$/);
  });

  test('🔴 ios: NO host command — simctl openurl stops at a system "Open in" sheet; the app opens it', () => {
    assert.deepEqual(openCommands('ios', url, { app: 'demoapp', root: '.', device: 'UDID' }), []);
    assert.equal(appOpensCallback('ios'), true);
    for (const t of ['android', 'macos', 'linux', 'windows']) assert.equal(appOpensCallback(t), false, t);
  });

  test('linux: a .desktop with %u and the scheme, set default, then xdg-open', () => {
    const root = mkdtempSync(join(tmpdir(), 'nap-'));
    mkdirSync(join(root, 'apps', 'demoapp', 'linux'), { recursive: true });
    writeFileSync(join(root, 'apps', 'demoapp', 'linux', 'CMakeLists.txt'), 'set(BINARY_NAME "demo-app")\n');
    const cmds = openCommands('linux', url, { app: 'demoapp', root, home: join(root, 'home') });
    const [write, , mime, open] = cmds;
    assert.equal(write[0], '__write__');
    assert.match(write[2], /^Exec=.*demo-app %u$/m);
    assert.match(write[2], /^MimeType=x-scheme-handler\/com\.nikatru\.demoapp;$/m);
    assert.deepEqual(mime, ['xdg-mime', 'default', 'nk-proof-demoapp.desktop', 'x-scheme-handler/com.nikatru.demoapp']);
    assert.deepEqual(open, ['xdg-open', url]);
  });

  test('windows cannot be handed the callback on a runner', () => {
    assert.equal(openCommands('windows', url, { app: 'demoapp', root: '.' }), null);
  });

  test('an unknown target is refused', () => {
    assert.throws(() => openCommands('fuchsia', url, { app: 'demoapp', root: '.' }), /unknown target/);
  });
});

// Proof run 36525783687: the consent scrim ate the Sign in tap on Android and
// Linux, and every purge failed because nothing named the consent row. The
// purge's "no row" verdict (consent_anon_id.mjs, resolveProofLogConsent) holds
// only while the prompt is answered in ONE place, id printed before the tap.
describe('native_auth_proof — the consent prompt is answered once, id first', () => {
  const REPO = join(import.meta.dirname, '..', '..', '..');
  const BRICK = join(REPO, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'integration_test');
  const APPS = readdirSync(join(REPO, 'apps')).filter((a) =>
    existsSync(join(REPO, 'apps', a, 'integration_test', 'native_auth_proof_test.dart')),
  );
  const suites = [BRICK, ...APPS.map((a) => join(REPO, 'apps', a, 'integration_test'))];

  test('every copy of the steps file is the brick\'s, byte for byte', () => {
    assert.ok(APPS.length > 0, 'no app carries the proof — this check would pass on nothing');
    const brick = readFileSync(join(BRICK, 'native_auth_proof_steps.dart'), 'utf8');
    for (const a of APPS) {
      assert.equal(readFileSync(join(REPO, 'apps', a, 'integration_test', 'native_auth_proof_steps.dart'), 'utf8'), brick, a);
    }
  });

  test('🔴 no proof suite names the decline control — only answerConsentPrompt taps it', () => {
    for (const dir of suites) {
      assert.doesNotMatch(readFileSync(join(dir, 'native_auth_proof_test.dart'), 'utf8'), /No thanks|kConsentDecline/, dir);
      assert.match(readFileSync(join(dir, 'native_auth_proof_test.dart'), 'utf8'), /answerConsentPrompt\(/, dir);
    }
  });

  test('🔴 the steps file prints the install id BEFORE its one tap on the prompt', () => {
    const steps = readFileSync(join(BRICK, 'native_auth_proof_steps.dart'), 'utf8');
    const body = steps.slice(steps.indexOf('Future<bool> answerConsentPrompt('));
    const printed = body.indexOf("debugPrint('$kConsentAnonIdToken=$id')");
    const tapped = body.indexOf('await tester.tap(decline.first)');
    assert.ok(printed > 0 && tapped > 0, 'answerConsentPrompt no longer prints the id or taps the prompt');
    assert.ok(printed < tapped, 'the id is printed after the tap — a run that dies between them leaves an unnamed row');
    assert.equal(steps.split('tester.tap(decline').length - 1, 1, 'the decline control is tapped in more than one place');
    assert.match(steps, /const String kConsentAnonIdToken = 'E2E_CONSENT_ANON_ID';/);
  });

  test('🔴 the Sign in tap is refused when something covers the button', () => {
    const steps = readFileSync(join(BRICK, 'native_auth_proof_steps.dart'), 'utf8');
    const body = steps.slice(steps.indexOf('Future<void> proveFormSignIn('));
    assert.ok(body.indexOf('submit.hitTestable()') > 0, 'proveFormSignIn taps without checking the tap would land');
    assert.ok(body.indexOf('submit.hitTestable()') < body.indexOf('await tester.tap(submit)'));
  });
});

// The purge reads the proof's log (consent_anon_id.mjs, resolveProofLogConsent),
// and a proof step that RAN and left no log is unresolved there — so a driver
// that refuses must still leave a FINISHED log saying no app ran.
describe('native_auth_proof — the log is written before anything can refuse', () => {
  test('🔴 a run refused for missing env leaves a log that ends, and starts no app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nk-proof-log-'));
    const log = join(dir, 'proof.log');
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '' };
    const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', '..', 'e2e', 'native_auth_proof.mjs'), '--app', 'demo', '--target', 'linux', '--log', log], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(r.status, 2, r.stderr);
    const text = readFileSync(log, 'utf8');
    assert.match(text, /NK_PROOF_LOG_END flutter_exit=none refused=env/);
    assert.doesNotMatch(text, /E2E_CONSENT_ANON_ID=/);
  });

  test('the post-open diagnostics exist for iOS alone, and name the device', () => {
    const d = afterOpenDiagnostics('ios', { device: 'SIM-1', dir: '/tmp' });
    assert.deepEqual(d.screenshot.slice(0, 5), ['xcrun', 'simctl', 'io', 'SIM-1', 'screenshot']);
    assert.deepEqual(d.log.slice(0, 6), ['xcrun', 'simctl', 'spawn', 'SIM-1', 'log', 'show']);
    for (const t of ['android', 'macos', 'linux', 'windows']) assert.equal(afterOpenDiagnostics(t, {}), null, t);
  });
});
