// tooling/e2e/native_auth_proof.mjs — the per-target native sign-in proof's
// driver (ST-N1g). What it reads back decides a channel row's nativeAuth, so a
// reading that cannot fail would flip a row on no evidence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
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

  test('ios: simctl openurl on the booted device', () => {
    assert.deepEqual(openCommands('ios', url, { app: 'demoapp', root: '.', device: 'UDID' }), [['xcrun', 'simctl', 'openurl', 'UDID', url]]);
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
