#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// native_auth_proof.mjs — ONE TARGET'S NATIVE SIGN-IN PROOF, on its own device
// (ST-N1g, run by .github/workflows/native-auth-proof.yml).
//
// ⏱ 2026-09-28 · rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT. Box C's GoTrue captchas the password grant,
// and no store build carries a Turnstile site key (ADR 084), so every native
// sign-in answered `captcha_failed` until the platform Worker's native route
// (ST-T7a) and the client that uses it (ST-T7b). A unit test proves the client
// reaches the route; only a device proves a TARGET signs in. This runs
// `integration_test/native_auth_proof_test.dart` on the device named, and:
//
//   1. prints this runner's egress IP, read from Cloudflare's /cdn-cgi/trace on
//      the platform host — the address GoTrue's per-IP limiter must see once
//      Box C keys it on CF-Connecting-IP (the ST-T7a brief's BOX C STEP, P-IP);
//   2. when the proof prints NK_PROOF_AWAIT_CALLBACK, has the OS open
//      com.nikatru.<app>://auth-callback?nk_auth=reset&code=st-n1-invalid with
//      the target's own mechanism (adb / simctl / LaunchServices / xdg-open);
//   3. reads the run's output back: every NK_PROOF step, and on a callback
//      target the line `nk_auth_callback flow=reset outcome=failed`. A missing
//      line fails the run even when `flutter test` exited 0.
//   4. ⏱ 2026-09-29 (AB-O1-05): when the app's proof suite declares the
//      offline read (it prints OFFLINE_READ_LINE), requires that line too — the
//      list read back with the network off from this target's own store. An app
//      whose suite has no such step is not asked for it; one whose suite has it
//      and whose run did not print it is a finding.
//
// ⏱ 2026-09-29 (AB-E2E-02): also the SCHEDULED native legs' drive —
// e2e.yml's `native` job runs this per target every week, and
// tooling/e2e-leg-register.json `nativeTargets` names it as what proves the
// anonymous and sign-in legs off web. native-auth-proof.yml stays the
// per-auth-change dispatch; both run this file and nothing else.
//
// Windows runs WITHOUT --callback: protocol activation needs the MSIX
// installed, and a runner build is not one, so windows-store keeps
// nativeAuth false until the callback is proven on a device that has it.
//
// ⏱ 2026-09-30 (ADR no.NNN, lead ruling on the second review of #1070):
// --expect-refusal. Production's native route now serves only requests whose
// attestation the platform Worker VERIFIES (Play Integrity, App Attest), and a
// CI emulator, simulator or desktop runner cannot attest. So the scheduled legs
// run this mode: from the target's own runner, it sends production the calls a
// build that cannot attest sends, and PASSES ONLY WHEN EACH IS REFUSED with an
// attestation code and no session comes back (gradeRefusal). A 2xx, or any
// token in an answer, is the gate open and fails the leg. No device build runs:
// what is proved is the gate, and a flaky emulator boot must not redden it.
//
//   node tooling/e2e/native_auth_proof.mjs --app <id> --target <t>
//        [--device <id>] [--callback] [--expect-refusal]
//
// Env: E2E_EMAIL, E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL.
// Exit 0 = every step read back · 1 = a step failed or is missing · 2 = the
// run could not start (bad arguments, a missing define).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'native_auth_proof';

export const TARGETS = ['android', 'ios', 'macos', 'windows', 'linux'];
export const PROOF_TEST = 'integration_test/native_auth_proof_test.dart';
export const AWAIT_MARKER = 'NK_PROOF_AWAIT_CALLBACK';
export const FAILED_CALLBACK_LINE = 'nk_auth_callback flow=reset outcome=failed';
export const TRACE_URL = 'https://platform.nikatru.com/cdn-cgi/trace';
export const OFFLINE_READ_LINE = 'NK_PROOF step=offline-read outcome=ok';
/** The platform Worker's origin — the host TRACE_URL reads, and the native route's. */
export const PLATFORM_ORIGIN = new URL(TRACE_URL).origin;

/**
 * The refusal codes that PROVE the gate: every one says "no verified
 * attestation, so no sign-in" (services/platform/src/routes/native-auth.ts).
 * `native_auth_unavailable` is a refusal too — a listed kind whose server config
 * is not yet provisioned answers 503 rather than admitting.
 */
export const REFUSAL_CODES = Object.freeze([
  'attestation_required',
  'attestation_kind_refused',
  'attestation_challenge_invalid',
  'attestation_invalid',
  'attestation_key_unknown',
  'native_auth_unavailable',
]);

/**
 * The calls a build that CANNOT attest sends, per step: no attestation at all;
 * the desktop / simulator fallback kind (`install-key`) with a fresh challenge;
 * and an emulator's Play Integrity proof that is not a verifiable token.
 */
export const REFUSAL_STEPS = Object.freeze([
  { step: 'token-unattested', op: 'token', kind: null },
  { step: 'signup-unattested', op: 'signup', kind: null },
  { step: 'token-install-key', op: 'token', kind: 'install-key' },
  { step: 'signup-install-key', op: 'signup', kind: 'install-key' },
  { step: 'token-play-unverifiable', op: 'token', kind: 'play-integrity' },
]);

/**
 * PURE. Grades the answers the refusal steps got: `[{ step, status, body }]`.
 * Every step must answer 4xx/5xx with a REFUSAL_CODES `error_code`, and no
 * answer may carry a token. Returns the problems (empty = the gate held).
 */
export function gradeRefusal(answers) {
  const problems = [];
  const seen = new Set((answers ?? []).map((a) => a.step));
  for (const { step } of REFUSAL_STEPS) if (!seen.has(step)) problems.push(`${step}: no answer was recorded`);
  for (const a of answers ?? []) {
    const text = JSON.stringify(a.body ?? null);
    if (/"(access_token|refresh_token)"/.test(text)) {
      problems.push(`${a.step}: the answer CARRIES A SESSION — the gate is open`);
      continue;
    }
    if (!(a.status >= 400)) {
      problems.push(`${a.step}: answered HTTP ${a.status} — a call that cannot attest was ADMITTED`);
      continue;
    }
    const code = a.body && typeof a.body === 'object' ? a.body.error_code : undefined;
    if (!REFUSAL_CODES.includes(code)) {
      problems.push(`${a.step}: answered HTTP ${a.status} with error_code ${JSON.stringify(code ?? null)}, not an attestation refusal`);
    }
  }
  return problems;
}

/** IMPURE. Sends each REFUSAL_STEPS call to production's native route for [app]. */
export async function probeRefusals(app, { email, password, doFetch = fetch, origin = PLATFORM_ORIGIN } = {}) {
  const base = `${origin}/v1/auth/native/${app}`;
  const answers = [];
  const read = async (res) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };
  for (const { step, op, kind } of REFUSAL_STEPS) {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': `nikatru-e2e-refusal/${app}` };
    if (kind) {
      const ch = await doFetch(`${base}/attest/challenge`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(15_000) });
      const chBody = await read(ch);
      if (!ch.ok) {
        // No challenge at all is the gate refusing earlier (no kind listed, or no challenge key): graded as is.
        answers.push({ step, status: ch.status, body: chBody });
        continue;
      }
      headers['X-NK-Attest-Kind'] = kind;
      headers['X-NK-Attest-Challenge'] = String(chBody?.challenge ?? '');
      if (kind === 'install-key') headers['X-NK-Attest-Key'] = 'e2e-refusal-probe';
      headers['X-NK-Attest-Proof'] = kind === 'play-integrity' ? 'not.a.verifiable.integrity.token' : 'AAAA';
    }
    const path = op === 'token' ? `${base}/token?grant_type=password` : `${base}/${op}`;
    const res = await doFetch(path, { method: 'POST', headers, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000) });
    answers.push({ step, status: res.status, body: await read(res) });
  }
  return answers;
}

/** Does [app]'s proof suite declare the offline read? Read comment-stripped:
 *  a sentence about the step is not the step. */
export function offlineReadDeclared(root, app) {
  const p = join(root, 'apps', app, PROOF_TEST);
  if (!existsSync(p)) return false;
  const code = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  return /\bkOfflineReadOkLine\b/.test(code);
}

/** The unusable reset callback the OS opens: a real marker, a code no flow minted. */
export const callbackUrl = (app) => `com.nikatru.${app}://auth-callback?nk_auth=reset&code=st-n1-invalid`;

/** `ip=` off a /cdn-cgi/trace body, or null. */
export function egressIpOf(trace) {
  const m = /^ip=(.+)$/m.exec(String(trace ?? ''));
  return m ? m[1].trim() : null;
}

/** The Linux runner's binary name, read from the app's own CMakeLists. */
export function linuxBinaryOf(root, app) {
  const cmake = readFileSync(join(root, 'apps', app, 'linux', 'CMakeLists.txt'), 'utf8');
  const m = /set\(BINARY_NAME\s+"([^"]+)"\)/.exec(cmake);
  if (!m) throw new Error(`apps/${app}/linux/CMakeLists.txt sets no BINARY_NAME`);
  return m[1];
}

/**
 * The commands that make the OS deliver [url] to the running proof, in order,
 * as [cmd, ...args] — or null for a target that cannot receive it here.
 */
export function openCommands(target, url, { app, root, device, home = homedir() }) {
  switch (target) {
    case 'android':
      return [['adb', ...(device ? ['-s', device] : []), 'shell', `am start -W -a android.intent.action.VIEW -d '${url}'`]];
    case 'ios':
      return [['xcrun', 'simctl', 'openurl', device || 'booted', url]];
    case 'macos': {
      const products = join(root, 'apps', app, 'build', 'macos', 'Build', 'Products', 'Debug');
      const bundle = existsSync(products) ? readdirSync(products).find((f) => f.endsWith('.app')) : undefined;
      if (!bundle) throw new Error(`no .app under ${products} — the proof build did not land where LaunchServices is pointed`);
      const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
      return [[lsregister, '-f', join(products, bundle)], ['open', url]];
    }
    case 'linux': {
      const exec = join(root, 'apps', app, 'build', 'linux', 'x64', 'debug', 'bundle', linuxBinaryOf(root, app));
      const desktop = `nk-proof-${app}.desktop`;
      const dir = join(home, '.local', 'share', 'applications');
      return [
        ['__write__', join(dir, desktop), [
          '[Desktop Entry]',
          'Type=Application',
          `Name=${app} (ST-N1 proof)`,
          `Exec=${exec} %u`,
          `MimeType=x-scheme-handler/com.nikatru.${app};`,
          'NoDisplay=true',
          '',
        ].join('\n')],
        ['update-desktop-database', dir],
        ['xdg-mime', 'default', desktop, `x-scheme-handler/com.nikatru.${app}`],
        ['xdg-open', url],
      ];
    }
    case 'windows':
      return null;
    default:
      throw new Error(`unknown target "${target}" — one of ${TARGETS.join(', ')}`);
  }
}

/** What the run's output proves, and what it does not. */
export function readProof(out, { callback, offlineRead = false }) {
  const text = String(out ?? '');
  const problems = [];
  const need = (line, why) => {
    if (!text.includes(line)) problems.push(`missing "${line}" — ${why}`);
  };
  need('NK_PROOF step=sign-in outcome=ok', 'the real form did not sign the user in and reach Home');
  for (const step of ['sign-up-registered', 'recover-unregistered']) {
    const m = new RegExp(`NK_PROOF step=${step} answer=(\\S+)`).exec(text);
    if (!m) problems.push(`missing "NK_PROOF step=${step}" — GoTrue's answer was not recorded`);
    else if (m[1] === 'captcha_failed') problems.push(`${step} answered captcha_failed — the call did not go through the native route`);
  }
  if (offlineRead) need(OFFLINE_READ_LINE, 'the list was not read back with the network off from this target\'s store');
  need('NK_PROOF step=sign-out outcome=ok', 'sign-out did not return to the sign-in form');
  if (callback) {
    need(FAILED_CALLBACK_LINE, 'the OS-delivered callback was not reported as a failed exchange');
    need('NK_PROOF step=callback outcome=ok', 'the dead-link sentence did not show');
  }
  return problems;
}

function args(argv) {
  const o = { callback: false, expectRefusal: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--callback') o.callback = true;
    else if (a === '--expect-refusal') o.expectRefusal = true;
    else if (a === '--app' || a === '--target' || a === '--device') o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function printEgressIp() {
  try {
    const res = await fetch(TRACE_URL, { signal: AbortSignal.timeout(15_000) });
    console.log(`NK_PROOF egress_ip=${egressIpOf(await res.text()) ?? 'unread'}`);
  } catch (e) {
    console.log(`NK_PROOF egress_ip=unread (${e?.message ?? e})`);
  }
}

function runOpen(commands, root) {
  for (const [cmd, ...rest] of commands) {
    if (cmd === '__write__') {
      const [path, body] = rest;
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, body);
      console.log(`${NAME}: wrote ${path}`);
      continue;
    }
    console.log(`${NAME}: $ ${[cmd, ...rest].join(' ')}`);
    const r = spawnSync(cmd, rest, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) console.log(`${NAME}: ${cmd} exited ${r.status ?? r.error?.message}`);
  }
}

async function main() {
  const root = process.cwd();
  let o;
  try {
    o = args(process.argv.slice(2));
    if (!o.app || !TARGETS.includes(o.target)) throw new Error(`--app <id> and --target <${TARGETS.join('|')}> are required`);
    if (o.target === 'windows' && o.callback) throw new Error('windows cannot take --callback here: protocol activation needs the MSIX installed');
  } catch (e) {
    console.error(`${NAME}: ${e.message}`);
    process.exit(2);
  }
  if (o.expectRefusal) {
    for (const k of ['E2E_EMAIL', 'E2E_PASSWORD']) {
      if (!process.env[k]) {
        console.error(`${NAME}: missing env ${k} — the refusal probe sends the provisioned user's credentials`);
        process.exit(2);
      }
    }
    await printEgressIp();
    let answers;
    try {
      answers = await probeRefusals(o.app, { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
    } catch (e) {
      console.error(`${NAME}: the native route could not be reached (${e?.message ?? e})`);
      process.exit(2);
    }
    for (const a of answers) console.log(`NK_PROOF step=${a.step} answer=${a.status}/${a.body?.error_code ?? '-'}`);
    const problems = gradeRefusal(answers);
    if (problems.length) {
      for (const p of problems) console.error(`FAIL ${p}`);
      console.error(`${NAME}: ${o.app}/${o.target} FAILED — the native route did not refuse a build that cannot attest`);
      process.exit(1);
    }
    console.log(`${NAME}: ${o.app}/${o.target} OK — every call a build that cannot attest sends was refused, and no session came back (ADR no.NNN)`);
    return;
  }
  const defines = ['E2E_EMAIL', 'E2E_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL'];
  const missing = defines.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`${NAME}: missing env ${missing.join(', ')} — the build would run in demo posture or without the user`);
    process.exit(2);
  }
  const offlineRead = offlineReadDeclared(root, o.app);
  console.log(`${NAME}: ${o.app}'s proof suite ${offlineRead ? 'declares' : 'does not declare'} the offline read`);
  await printEgressIp();

  const flutterArgs = [
    'test', PROOF_TEST,
    ...(o.device ? ['-d', o.device] : []),
    ...defines.map((k) => `--dart-define=${k}=${process.env[k]}`),
    `--dart-define=NK_PROOF_CALLBACK=${o.callback}`,
  ];
  const url = callbackUrl(o.app);
  let out = '';
  let opened = false;
  const child = spawn('flutter', flutterArgs, {
    cwd: join(root, 'apps', o.app),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (stream) => (chunk) => {
    const s = chunk.toString();
    out += s;
    stream.write(s);
    if (o.callback && !opened && out.includes(AWAIT_MARKER)) {
      opened = true;
      setTimeout(() => runOpen(openCommands(o.target, url, { app: o.app, root, device: o.device }), root), 3_000);
    }
  };
  child.stdout.on('data', onData(process.stdout));
  child.stderr.on('data', onData(process.stderr));
  const code = await new Promise((r) => child.on('close', r));

  const problems = readProof(out, { callback: o.callback, offlineRead });
  if (code !== 0) problems.unshift(`flutter test exited ${code}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`${NAME}: ${o.app}/${o.target} FAILED`);
    process.exit(1);
  }
  console.log(`${NAME}: ${o.app}/${o.target} OK — the form signed in, the gated calls answered without a captcha, sign-out returned${offlineRead ? ', the list read back offline' : ''}${o.callback ? ', and the OS-delivered callback failed cleanly' : ''}`);
}

const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) await main();
