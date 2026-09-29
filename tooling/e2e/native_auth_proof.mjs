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
//
// Windows runs WITHOUT --callback: protocol activation needs the MSIX
// installed, and a runner build is not one, so windows-store keeps
// nativeAuth false until the callback is proven on a device that has it.
//
//   node tooling/e2e/native_auth_proof.mjs --app <id> --target <t>
//        [--device <id>] [--callback]
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
export function readProof(out, { callback }) {
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
  need('NK_PROOF step=sign-out outcome=ok', 'sign-out did not return to the sign-in form');
  if (callback) {
    need(FAILED_CALLBACK_LINE, 'the OS-delivered callback was not reported as a failed exchange');
    need('NK_PROOF step=callback outcome=ok', 'the dead-link sentence did not show');
  }
  return problems;
}

function args(argv) {
  const o = { callback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--callback') o.callback = true;
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
  const defines = ['E2E_EMAIL', 'E2E_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_BASE_URL'];
  const missing = defines.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`${NAME}: missing env ${missing.join(', ')} — the build would run in demo posture or without the user`);
    process.exit(2);
  }
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

  const problems = readProof(out, { callback: o.callback });
  if (code !== 0) problems.unshift(`flutter test exited ${code}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`${NAME}: ${o.app}/${o.target} FAILED`);
    process.exit(1);
  }
  console.log(`${NAME}: ${o.app}/${o.target} OK — the form signed in, the gated calls answered without a captcha, sign-out returned${o.callback ? ', and the OS-delivered callback failed cleanly' : ''}`);
}

const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) await main();
