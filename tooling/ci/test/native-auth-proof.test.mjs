// tooling/e2e/native_auth_proof.mjs — the per-target native sign-in proof's
// driver (ST-N1g). What it reads back decides a channel row's nativeAuth, so a
// reading that cannot fail would flip a row on no evidence.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
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
import { jobEnv, parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const END = 'NK_PROOF_LOG_END';
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
      const code = await runRefusalLeg({ app: 'demoapp', target: 'android' }, { log, logEnd: END, env, probe, egress: async () => {}, out: quiet });
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
    }
  });

  test('🔴 RED CONTROL: a log without its end marker is refused up front', async () => {
    await assert.rejects(runRefusalLeg({ app: 'demoapp', target: 'android' }, { log: join(tmpdir(), 'never.log') }), /needs its end marker/);
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
  const DEVICE_STEP = /setup-flutter|^flutter pub get$|build and session deps|desktop target|^Boot an /;
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
