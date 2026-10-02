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
  REFUSAL_LIMITS,
  REFUSAL_RETRIES,
  REFUSAL_SLOT_MS,
  TARGETS,
  legCost,
  legsPerSlot,
  refusalSchedule,
  refusalSlot,
  retryAfterMs,
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

  // ⏱ 2026-10-01 · train st-e2e-parity (EN-07): the native legs OPEN THE APP
  // again. A `--sign-in token` leg runs the refusal probe FIRST — so the gate is
  // still proven — and then the device leg. Every target is `token` for now: a
  // phone's form route needs an attestation no hosted device can produce, and a
  // desktop's e-mail sign-in is the system-browser hand-off, which no app
  // screen opens until #1133's PR B lands. A `form` leg runs no probe.
  const TARGETS_NOW = ['android', 'ios', 'macos', 'windows', 'linux'];
  function driverBlocks(root) {
    const blocks = [];
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      const wf = parseWorkflow(root, rel);
      assert.ok(wf, `${rel} parses`);
      for (const job of wf.jobs.values()) {
        for (const line of job.logical) {
          const text = typeof line === 'string' ? line : line.text;
          if (/tooling\/e2e\/native_auth_proof\.mjs/.test(text)) blocks.push({ rel, job: job.name, text });
        }
      }
    }
    return blocks;
  }

  test('WORKFLOW-SCAN: every native leg opens the app; a token leg runs the refusal probe first', () => {
    const blocks = driverBlocks(REPO);
    for (const { rel, job, text } of blocks) {
      const calls = text.split(/(?=node tooling\/e2e\/native_auth_proof\.mjs)/).filter((c) => c.startsWith('node tooling/e2e/native_auth_proof.mjs'));
      const device = calls.filter((c) => !/--expect-refusal\b/.test(c));
      assert.equal(device.length, 1, `${rel} job ${job}: one device leg per run block, found ${device.length}: ${text.trim()}`);
      assert.match(device[0], /--device\b/, `${rel} job ${job}: the device leg names no device`);
      const via = /--sign-in (\S+)/.exec(device[0])?.[1];
      assert.ok(via, `${rel} job ${job}: the device leg says no --sign-in: ${device[0].trim()}`);
      for (const probe of calls.filter((c) => /--expect-refusal\b/.test(c))) {
        assert.doesNotMatch(probe, /--device\b/, `${rel} job ${job}: the refusal probe never opens a device`);
      }
      if (via === 'form') continue;
      // `token`, literal or chosen by the matrix: the probe comes first.
      assert.ok(calls.length === 2 && /--expect-refusal\b/.test(calls[0]), `${rel} job ${job}: a --sign-in ${via} leg runs no refusal probe before it: ${text.trim()}`);
    }
    assert.ok(blocks.length >= 7, `the scan found ${blocks.length} driver run block(s) — fewer than the seven legs means it stopped reaching them`);
    // The matrix: every target takes the token today, and each run block with
    // a "$SIGN_IN" device leg probes first when it is `token`.
    const e2e = readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8');
    const rows = [...e2e.matchAll(/- target: (\w+)\n(?:\s+\w+: [^\n]*\n)*?\s+sign_in: (\w+)/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(Object.fromEntries(rows), Object.fromEntries(TARGETS_NOW.map((t) => [t, 'token'])));
    assert.equal((e2e.match(/if \[ "\$SIGN_IN" = token \]; then\n\s+node tooling\/e2e\/native_auth_proof\.mjs [^\n]*--expect-refusal/g) ?? []).length, 2);
    const nap = readFileSync(join(REPO, '.github/workflows/native-auth-proof.yml'), 'utf8');
    const napLines = nap.split('\n');
    for (const t of TARGETS_NOW) {
      const leg = napLines.findIndex((l) => l.includes(`--target ${t} --device `) && l.includes('--sign-in token'));
      assert.ok(leg > 0, `native-auth-proof.yml ${t}: no --sign-in token device leg`);
      const probe = napLines.findIndex((l) => l.includes(`--target ${t} --log `) && l.includes('--expect-refusal'));
      assert.ok(probe > 0 && probe < leg, `native-auth-proof.yml ${t}: no refusal probe before the device leg`);
    }
  });

  // The device steps stay gated on PROOF_NEEDS_DEVICE (so a refusal-only
  // posture can come back in one line), and every native-leg job sets it 'true'.
  const DEVICE_STEP = /setup-flutter|^flutter pub get$|build and session deps|desktop target|^Boot an |past MAX_PATH/;
  const GATED = /env\.PROOF_NEEDS_DEVICE == 'true'/;
  function deviceLegFindings(root) {
    const found = [];
    let jobs = 0;
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      for (const job of parseWorkflow(root, rel).jobs.values()) {
        if (!job.logical.some((l) => /native_auth_proof\.mjs/.test(typeof l === 'string' ? l : l.text))) continue;
        jobs++;
        if (jobEnv(job).get('PROOF_NEEDS_DEVICE')?.value !== 'true') found.push(`${rel} ${job.name}: PROOF_NEEDS_DEVICE is not 'true' — the leg never opens the app`);
        let deviceSteps = 0;
        for (const s of workflowSteps(job)) {
          if (!DEVICE_STEP.test(s.uses ?? s.name ?? '')) continue;
          deviceSteps++;
          if (!GATED.test(s.cond ?? '')) found.push(`${rel} ${job.name}: "${s.uses ?? s.name}" is not gated on PROOF_NEEDS_DEVICE`);
        }
        if (deviceSteps === 0) found.push(`${rel} ${job.name}: no device step — nothing builds or boots the app`);
      }
    }
    return { jobs, found };
  }

  test('WORKFLOW-SCAN: every native-leg job builds and boots the app (PROOF_NEEDS_DEVICE true, its steps gated on it)', () => {
    const { jobs, found } = deviceLegFindings(REPO);
    assert.ok(jobs >= 6, `the scan found ${jobs} native-leg job(s) — fewer than six means it stopped reaching them`);
    assert.deepEqual(found, []);
  });

  test('🔴 RED CONTROL: the real workflows with one job back on PROOF_NEEDS_DEVICE false, or a device step un-gated, are findings', () => {
    const root = mkdtempSync(join(tmpdir(), 'nk-device-wf-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    for (const rel of ['.github/workflows/e2e.yml', '.github/workflows/native-auth-proof.yml']) {
      let text = readFileSync(join(REPO, rel), 'utf8');
      if (rel.endsWith('native-auth-proof.yml')) {
        text = text.replace(/\n {8}if: env\.PROOF_NEEDS_DEVICE == 'true'\n(\s+env:\n\s+API_LEVEL)/, '\n$1');
      } else {
        text = text.replace("PROOF_NEEDS_DEVICE: 'true'", "PROOF_NEEDS_DEVICE: 'false'");
      }
      writeFileSync(join(root, rel), text);
    }
    assert.deepEqual(deviceLegFindings(root).found, [
      ".github/workflows/e2e.yml native: PROOF_NEEDS_DEVICE is not 'true' — the leg never opens the app",
      '.github/workflows/native-auth-proof.yml android: "Boot an emulator" is not gated on PROOF_NEEDS_DEVICE',
    ]);
  });
});

// ⏱ 2026-10-01 (fourth review of #1070): the Sunday refusal legs of every app
// fire at one cron minute from runners that share networks, and the platform
// Worker's per-network limiters count them as ONE caller. These cases hold the
// stagger that keeps a third app's legs under those budgets, and the 429 wait.
describe('native_auth_proof --expect-refusal — the legs share the per-network budget', () => {
  /** The `"simple": { "limit": N, "period": P }` of [binding] in the platform Worker's top-level config. */
  const wranglerLimit = (binding) => {
    const text = readFileSync(join(REPO, 'services', 'platform', 'wrangler.jsonc'), 'utf8');
    const at = text.indexOf(`"name": "${binding}"`);
    assert.notEqual(at, -1, `services/platform/wrangler.jsonc declares no ${binding}`);
    const m = /"simple":\s*\{\s*"limit":\s*(\d+),\s*"period":\s*(\d+)\s*\}/.exec(text.slice(at, at + 400));
    assert.ok(m, `${binding}: no "simple" limit within its entry`);
    return { limit: Number(m[1]), period: Number(m[2]) };
  };

  test('the budgets are the platform Worker\'s own, read from services/platform/wrangler.jsonc', () => {
    for (const l of REFUSAL_LIMITS) {
      assert.deepEqual(wranglerLimit(l.binding), { limit: l.limit, period: l.period }, `${l.binding} drifted from the Worker's config`);
      assert.equal(l.period * 1000, REFUSAL_SLOT_MS, `${l.binding}: a slot is one limiter period`);
    }
    // One leg: a challenge + an op per attested step, an op per bare one.
    assert.equal(legCost(REFUSAL_LIMITS[0]), REFUSAL_STEPS.length + REFUSAL_STEPS.filter((x) => x.kind).length);
    assert.equal(legsPerSlot(), 2);
  });

  test('the schedule: apps in order, targets in TARGETS order, at most legsPerSlot() legs a slot', () => {
    const apps = ['alpha', 'bravo', 'charlie'];
    const schedule = refusalSchedule(apps);
    assert.equal(schedule.length, apps.length * TARGETS.length);
    const perSlot = new Map();
    for (const l of schedule) perSlot.set(l.slot, (perSlot.get(l.slot) ?? 0) + 1);
    assert.ok([...perSlot.values()].every((n) => n <= legsPerSlot()));
    assert.deepEqual(refusalSlot(apps, 'alpha', 'android'), { slot: 0, slots: 8 });
    assert.deepEqual(refusalSlot(apps, 'charlie', 'linux'), { slot: 7, slots: 8 });
    assert.equal(refusalSlot(apps, 'delta', 'linux'), null);
  });

  /**
   * Three simulated apps, five targets each, every leg through the REAL runRefusalLeg
   * and probeRefusals on a virtual clock. Each runner starts somewhere in the two
   * minutes before the anchor; each call takes 400 ms. Every call is stamped with its
   * limiters, then each limiter's busiest sliding period is counted.
   */
  async function simulate(apps, { stagger }) {
    const anchor = 1_800_000_000_000;
    const calls = [];
    const quiet = { log() {}, error() {} };
    let leg = 0;
    for (const app of apps) {
      for (const target of TARGETS) {
        let clock = anchor - 120_000 + ((leg++ * 7919) % 100_000);
        const doFetch = async (url, init) => {
          clock += 400;
          const kind = init.headers['X-NK-Attest-Kind'] ?? null;
          const challenge = url.endsWith('/attest/challenge');
          const spent = ['NATIVE_AUTH_EDGE_LIMITER'];
          if (!challenge && kind === 'install-key') spent.push('NATIVE_AUTH_UNATTESTED_LIMITER');
          if (!challenge && kind === 'play-integrity') spent.push('NATIVE_AUTH_PLAY_VERIFY_LIMITER');
          calls.push({ t: clock, spent, app });
          if (challenge) return new Response(JSON.stringify({ challenge: `c1.${app}.1.x.y`, expires_in: 120 }), { status: 200 });
          return new Response(JSON.stringify({ code: 401, error_code: 'attestation_invalid', msg: 'x' }), { status: 401 });
        };
        const o = { app, target, ...(stagger ? { staggerAnchor: String(anchor), staggerApps: JSON.stringify(apps) } : {}) };
        const code = await runRefusalLeg(o, {
          env: { E2E_EMAIL: 'e', E2E_PASSWORD: 'p' },
          probe: (a, opts) => probeRefusals(a, { ...opts, doFetch, origin: 'https://platform.test', sleep: async (ms) => { clock += ms; }, out: quiet }),
          egress: async () => {},
          out: quiet,
          now: () => clock,
          sleep: async (ms) => { clock += ms; },
        });
        assert.equal(code, 0, `${app}/${target} did not grade clean`);
      }
    }
    const busiest = {};
    for (const l of REFUSAL_LIMITS) {
      const ts = calls.filter((c) => c.spent.includes(l.binding)).map((c) => c.t).sort((a, b) => a - b);
      let max = 0;
      for (let i = 0, j = 0; i < ts.length; i++) {
        while (ts[i] - ts[j] >= l.period * 1000) j++;
        max = Math.max(max, i - j + 1);
      }
      busiest[l.binding] = max;
    }
    return { busiest, calls };
  }

  test('🔴 PROOF: three simulated apps, staggered, never exceed any per-network budget in any sliding minute', async () => {
    const { busiest, calls } = await simulate(['alpha', 'bravo', 'charlie'], { stagger: true });
    assert.equal(calls.length, 3 * TARGETS.length * legCost(REFUSAL_LIMITS[0]));
    for (const l of REFUSAL_LIMITS) {
      assert.ok(busiest[l.binding] <= l.limit, `${l.binding}: ${busiest[l.binding]} calls in one sliding minute, over its ${l.limit}`);
    }
    // The third app is not squeezed out: its legs run, and run after the other two's.
    const charlie = calls.filter((c) => c.app === 'charlie').map((c) => c.t);
    const alpha = calls.filter((c) => c.app === 'alpha').map((c) => c.t);
    assert.ok(Math.min(...charlie) > Math.max(...alpha));
  });

  test('🔴 RED CONTROL: the same three apps UNSTAGGERED overrun the budgets — the 429 the stagger exists for', async () => {
    const { busiest } = await simulate(['alpha', 'bravo', 'charlie'], { stagger: false });
    assert.ok(busiest.NATIVE_AUTH_EDGE_LIMITER > 60, `edge: ${busiest.NATIVE_AUTH_EDGE_LIMITER}`);
    assert.ok(busiest.NATIVE_AUTH_UNATTESTED_LIMITER > 10, `unattested: ${busiest.NATIVE_AUTH_UNATTESTED_LIMITER}`);
  });

  test('a 429 over_request_rate_limit is waited out (Retry-After) and the step re-asked; its final answer is graded', async () => {
    let first = true;
    const waits = [];
    const doFetch = async (url) => {
      if (url.endsWith('/attest/challenge')) return new Response(JSON.stringify({ challenge: 'c1.demoapp.1.x.y' }), { status: 200 });
      if (first) {
        first = false;
        return new Response(JSON.stringify({ code: 429, error_code: 'over_request_rate_limit', msg: 'x' }), { status: 429, headers: { 'Retry-After': '30' } });
      }
      return new Response(JSON.stringify({ code: 401, error_code: 'attestation_required', msg: 'x' }), { status: 401 });
    };
    const answers = await probeRefusals('demoapp', { email: 'e', password: 'p', doFetch, origin: 'https://platform.test', sleep: async (ms) => waits.push(ms), out: { log() {} } });
    assert.deepEqual(gradeRefusal(answers), []);
    assert.deepEqual(waits, [30_000]);
  });

  test('🔴 RED: a 429 that outlasts the retries is graded — it is not an attestation refusal', async () => {
    const waits = [];
    const doFetch = async () =>
      new Response(JSON.stringify({ code: 429, error_code: 'over_request_rate_limit', msg: 'x' }), { status: 429 });
    const answers = await probeRefusals('demoapp', { email: 'e', password: 'p', doFetch, origin: 'https://platform.test', sleep: async (ms) => waits.push(ms), out: { log() {} } });
    assert.match(gradeRefusal(answers).join('\n'), /answered HTTP 429 with error_code "over_request_rate_limit", not an attestation refusal/);
    assert.equal(waits.length, REFUSAL_STEPS.length * REFUSAL_RETRIES);
    assert.equal(retryAfterMs(null), 60_000);
    assert.equal(retryAfterMs('9999'), 120_000);
  });

  test('a stagger that cannot place the leg refuses (exit 2, log finished) — it never probes early', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nk-refusal-stagger-'));
    const log = join(dir, 'p.log');
    writeFileSync(log, 'native_auth_proof: demoapp/android — flutter test output follows\n');
    let probed = false;
    const code = await runRefusalLeg(
      { app: 'demoapp', target: 'android', staggerAnchor: '1800000000000', staggerApps: '["other"]' },
      { log, env: { E2E_EMAIL: 'e', E2E_PASSWORD: 'p' }, probe: async () => { probed = true; return []; }, egress: async () => {}, out: { log() {}, error() {} } },
    );
    assert.equal(code, 2);
    assert.equal(probed, false);
    assert.match(readFileSync(log, 'utf8'), new RegExp(`${END} flutter_exit=none mode=expect-refusal exit=2 refused=stagger`));
  });

  test('WORKFLOW-SCAN: every e2e.yml refusal leg passes the stagger, from prepare\'s one anchor', () => {
    const wf = parseWorkflow(REPO, '.github/workflows/e2e.yml');
    let legs = 0;
    for (const job of wf.jobs.values()) {
      for (const line of job.logical) {
        const text = typeof line === 'string' ? line : line.text;
        if (!/tooling\/e2e\/native_auth_proof\.mjs[^\n]*--expect-refusal/.test(text)) continue;
        legs++;
        assert.match(text, /--stagger-anchor "\$REFUSAL_ANCHOR" --stagger-apps "\$REFUSAL_APPS"/, `e2e.yml job ${job.name}: ${text.trim()}`);
        const env = jobEnv(job);
        assert.equal(env.get('REFUSAL_ANCHOR')?.value, '${{ needs.prepare.outputs.refusal_anchor }}');
        assert.equal(env.get('REFUSAL_APPS')?.value, '${{ needs.prepare.outputs.apps }}');
      }
    }
    // ⏱ 2026-10-01 · st-e2e-parity: two run blocks again — the non-Linux step and the Linux step, each with its probe before its device leg.
    assert.ok(legs >= 2, `the scan found ${legs} refusal run block(s) in e2e.yml — fewer than two means it stopped reaching them`);
    assert.equal((readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8').match(/--expect-refusal --stagger-anchor "\$REFUSAL_ANCHOR" --stagger-apps "\$REFUSAL_APPS"/g) ?? []).length, 2);
    assert.match(readFileSync(join(REPO, '.github/workflows/e2e.yml'), 'utf8'), /refusal_anchor: \$\{\{ steps\.workspace\.outputs\.refusal_anchor \}\}/);
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
