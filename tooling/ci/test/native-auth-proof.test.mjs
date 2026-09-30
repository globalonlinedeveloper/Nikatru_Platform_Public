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
  OFFLINE_READ_LINE,
  offlineReadDeclared,
  openCommands,
  PROOF_TEST,
  probeRefusals,
  readProof,
  REFUSAL_STEPS,
  gradeRefusal,
  runRefusalLeg,
} from '../../e2e/native_auth_proof.mjs';
import { PROOF_LOG_END as END, resolveProofLogConsent } from '../../e2e/consent_anon_id.mjs';
import { jobEnv, parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');

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

  // ⏱ 2026-09-29 · AB-O1-05 — the offline read, per target.
  test('an app that declares the offline read reads clean with its line', () => {
    assert.deepEqual(readProof(`${GREEN}\n${OFFLINE_READ_LINE}`, { callback: true, offlineRead: true }), []);
  });

  test('🔴 an app that declares the offline read and whose run did not print it is a finding', () => {
    assert.match(
      readProof(GREEN, { callback: true, offlineRead: true }).join('\n'),
      /step=offline-read outcome=ok/,
    );
  });

  test('an app whose suite has no offline read is not asked for it', () => {
    assert.deepEqual(readProof(GREEN, { callback: true, offlineRead: false }), []);
  });

  test('offlineReadDeclared reads the REAL tree: subscriptiontracker declares it', () => {
    assert.equal(offlineReadDeclared(REPO, 'subscriptiontracker'), true);
  });

  test('🔴 offlineReadDeclared ignores a comment that only names the step', () => {
    const root = mkdtempSync(join(tmpdir(), 'nk-offline-'));
    const suite = join(root, 'apps', 'demoapp', PROOF_TEST);
    mkdirSync(join(suite, '..'), { recursive: true });
    writeFileSync(suite, '// debugPrint(kOfflineReadOkLine) is what the step would print\nvoid main() {}\n');
    assert.equal(offlineReadDeclared(root, 'demoapp'), false);
    writeFileSync(suite, 'void main() {\n  debugPrint(kOfflineReadOkLine);\n}\n');
    assert.equal(offlineReadDeclared(root, 'demoapp'), true);
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · ADR no.NNN (lead ruling on the second review of #1070): the
// native legs EXPECT THE REFUSAL. Production serves native sign-in only to a
// verified attestation and a CI device cannot attest, so the legs pass exactly
// when every call such a build sends is refused and no session comes back.
// ─────────────────────────────────────────────────────────────────────────────
describe('native_auth_proof --expect-refusal — the leg proves the gate', () => {
  const refused = (status, code) => REFUSAL_STEPS.map(({ step }) => ({ step, status, body: { code: status, error_code: code, msg: 'x' } }));

  test('GREEN: every step refused with an attestation code', () => {
    assert.deepEqual(gradeRefusal(refused(401, 'attestation_required')), []);
    assert.deepEqual(gradeRefusal(refused(503, 'native_auth_unavailable')), []);
    assert.deepEqual(gradeRefusal(refused(403, 'attestation_kind_refused')), []);
  });

  test('🔴 RED: an admitted call (2xx) is the gate open', () => {
    const answers = refused(401, 'attestation_required');
    answers[0] = { step: answers[0].step, status: 200, body: { user: { id: 'u' } } };
    assert.match(gradeRefusal(answers)[0], /answered HTTP 200 — a call that cannot attest was ADMITTED/);
  });

  test('🔴 RED: a session in ANY answer fails, whatever the status', () => {
    const answers = refused(401, 'attestation_required');
    answers[2] = { step: answers[2].step, status: 400, body: { access_token: 'x', error_code: 'attestation_invalid' } };
    assert.match(gradeRefusal(answers)[0], /CARRIES A SESSION — the gate is open/);
  });

  test('🔴 RED: a refusal that is not an attestation refusal (a captcha, a missing route) fails, and so does a missing step', () => {
    assert.match(gradeRefusal(refused(400, 'captcha_failed'))[0], /not an attestation refusal/);
    assert.match(gradeRefusal(refused(404, 'unknown_app'))[0], /not an attestation refusal/);
    assert.match(gradeRefusal(refused(401, 'attestation_required').slice(1)).join('\n'), /no answer was recorded/);
  });

  test('the probe sends every step to the native route, with a fresh challenge for each attested kind', async () => {
    const seen = [];
    const doFetch = async (url, init) => {
      seen.push({ url, kind: init.headers['X-NK-Attest-Kind'] ?? null });
      if (url.endsWith('/attest/challenge')) return new Response(JSON.stringify({ challenge: 'c1.demoapp.1.x.y', expires_in: 120 }), { status: 200 });
      return new Response(JSON.stringify({ code: 401, error_code: 'attestation_required', msg: 'x' }), { status: 401 });
    };
    const answers = await probeRefusals('demoapp', { email: 'e', password: 'p', doFetch, origin: 'https://platform.test' });
    assert.deepEqual(gradeRefusal(answers), []);
    assert.equal(seen.filter((s) => s.url.endsWith('/attest/challenge')).length, REFUSAL_STEPS.filter((x) => x.kind).length);
    assert.ok(seen.some((s) => s.url === 'https://platform.test/v1/auth/native/demoapp/token?grant_type=password' && s.kind === 'install-key'));
    assert.ok(seen.some((s) => s.url === 'https://platform.test/v1/auth/native/demoapp/signup' && s.kind === null));
  });

  // Third review of #1070: the purge after a proof step reads its log, and a log
  // with no end marker is UNRESOLVED — so every exit of the leg must finish it.
  test('every exit of the refusal leg FINISHES the proof log — 0, 1, and both 2s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nk-refusal-log-'));
    const quiet = { log() {}, error() {} };
    const leg = async (name, { env = { E2E_EMAIL: 'e', E2E_PASSWORD: 'p' }, probe }) => {
      const log = join(dir, `${name}.log`);
      writeFileSync(log, 'native_auth_proof: demoapp/android — flutter test output follows\n');
      const code = await runRefusalLeg({ app: 'demoapp', target: 'android' }, { log, env, probe, egress: async () => {}, out: quiet });
      return { code, text: readFileSync(log, 'utf8') };
    };
    const cases = [
      ['held', 0, { probe: async () => refused(401, 'attestation_required') }],
      ['open', 1, { probe: async () => refused(200, undefined) }],
      ['env', 2, { env: {}, probe: async () => assert.fail('probed without credentials') }],
      ['unreachable', 2, { probe: async () => { throw new Error('ECONNRESET'); } }],
    ];
    for (const [name, want, opts] of cases) {
      const { code, text } = await leg(name, opts);
      assert.equal(code, want, name);
      assert.match(text, new RegExp(`\\n${END} flutter_exit=none mode=expect-refusal exit=${want}`), `${name}: the log is not finished`);
      assert.equal(resolveProofLogConsent(join(dir, `${name}.log`)).noRow, true, `${name}: the purge does not read "no row"`);
    }
  });

  test('🔴 RED CONTROL: the same log, cut off before the leg finished, is UNRESOLVED to the purge', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'nk-refusal-cut-')), 'proof.log');
    writeFileSync(log, 'native_auth_proof: demoapp/android — flutter test output follows\nNK_PROOF step=token-unattested answer=401/attestation_required\n');
    assert.equal(resolveProofLogConsent(log).noRow, false);
  });

  test('🔴 the REAL driver: --expect-refusal --log with no credentials exits 2 and still finishes the log', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'nk-refusal-cli-')), 'proof.log');
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '' };
    const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', '..', 'e2e', 'native_auth_proof.mjs'), '--app', 'demo', '--target', 'linux', '--log', log, '--expect-refusal'], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(readFileSync(log, 'utf8'), new RegExp(`${END} flutter_exit=none mode=expect-refusal exit=2 refused=env`));
    assert.equal(resolveProofLogConsent(log).noRow, true);
  });

  test('WORKFLOW-SCAN: every native leg in e2e.yml and native-auth-proof.yml runs the driver with --expect-refusal', () => {
    let runs = 0;
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      const wf = parseWorkflow(REPO, rel);
      assert.ok(wf, `${rel} parses`);
      for (const job of wf.jobs.values()) {
        for (const line of job.logical) {
          const text = typeof line === 'string' ? line : line.text;
          if (!/tooling\/e2e\/native_auth_proof\.mjs/.test(text)) continue;
          runs++;
          assert.match(text, /--expect-refusal\b/, `${rel} job ${job.name} runs the proof without --expect-refusal: ${text.trim()}`);
        }
      }
    }
    assert.ok(runs >= 7, `the scan found ${runs} driver invocation(s) — fewer than the seven legs means it stopped reaching them`);
  });

  // Third review of #1070: a refusal leg probes over HTTP, so a leg that still
  // installs Flutter and boots a device spends its ceiling on nothing.
  const DEVICE_STEP = /setup-flutter|^flutter pub get$|build and session deps|desktop target|^Boot an |past MAX_PATH/;
  const GATED = /env\.PROOF_NEEDS_DEVICE == 'true'/;
  function ungatedDeviceSteps(root) {
    const found = [];
    let jobs = 0;
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      for (const job of parseWorkflow(root, rel).jobs.values()) {
        if (!job.logical.some((l) => /native_auth_proof\.mjs[^\n]*--expect-refusal/.test(typeof l === 'string' ? l : l.text))) continue;
        jobs++;
        if (jobEnv(job).get('PROOF_NEEDS_DEVICE')?.value !== 'false') found.push(`${rel} ${job.name}: PROOF_NEEDS_DEVICE is not 'false'`);
        for (const s of workflowSteps(job)) {
          if (DEVICE_STEP.test(s.uses ?? s.name ?? '') && !GATED.test(s.cond ?? '')) found.push(`${rel} ${job.name}: "${s.uses ?? s.name}" runs in refusal mode`);
        }
      }
    }
    return { jobs, found };
  }

  test('WORKFLOW-SCAN: a refusal leg installs no Flutter and boots no device', () => {
    const { jobs, found } = ungatedDeviceSteps(REPO);
    assert.ok(jobs >= 6, `the scan found ${jobs} refusal job(s) — fewer than six means it stopped reaching them`);
    assert.deepEqual(found, []);
  });

  test('🔴 RED CONTROL: the real workflow with one device step un-gated is a finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'nk-refusal-wf-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      let text = readFileSync(join(REPO, rel), 'utf8');
      if (rel.endsWith('native-auth-proof.yml')) text = text.replace(/\n {8}if: env\.PROOF_NEEDS_DEVICE == 'true'\n(\s+env:\n\s+API_LEVEL)/, '\n$1');
      writeFileSync(join(root, rel), text);
    }
    assert.deepEqual(ungatedDeviceSteps(root).found, ['.github/workflows/native-auth-proof.yml android: "Boot an emulator" runs in refusal mode']);
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
