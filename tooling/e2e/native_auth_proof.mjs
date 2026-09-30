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
//      line fails the run even when `flutter test` exited 0;
//   4. tees every byte `flutter test` prints to --log <path>, ending it with
//      the PROOF_LOG_END line once flutter has exited — tooling/e2e/purge.mjs
//      reads the consent row's install id off it (E2E_PROOF_LOG), and a
//      finished log with none shows this run wrote no row (run 36525783687:
//      all four purges failed on "no consent anon_id resolved");
//   5. kills `flutter test` after SILENCE_LIMIT_MS with no output, so a hung
//      launch (run 36525783687: macOS printed nothing for 40 min after
//      "Failed to foreground app" and the job was cancelled) fails as a named
//      finding with its purge still inside the job's ceiling.
//   6. ⏱ 2026-09-29 (AB-O1-05): when the app's proof suite declares the
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
//   node tooling/e2e/native_auth_proof.mjs --app <id> --target <t>
//        [--device <id>] [--callback] [--log <path>]
//
// Env: E2E_EMAIL, E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL.
// Exit 0 = every step read back · 1 = a step failed or is missing · 2 = the
// run could not start (bad arguments, a missing define).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROOF_LOG_END } from './consent_anon_id.mjs';

const NAME = 'native_auth_proof';

export const TARGETS = ['android', 'ios', 'macos', 'windows', 'linux'];
export const PROOF_TEST = 'integration_test/native_auth_proof_test.dart';
export const AWAIT_MARKER = 'NK_PROOF_AWAIT_CALLBACK';
export const FAILED_CALLBACK_LINE = 'nk_auth_callback flow=reset outcome=failed';
export const TRACE_URL = 'https://platform.nikatru.com/cdn-cgi/trace';
/** How long `flutter test` may print nothing before the proof calls it hung.
 *  The longest silent stretch of a healthy run is a cold Gradle build (≈ 4.5
 *  min in run 36525783687); an iOS xcodebuild is the next. */
export const SILENCE_LIMIT_MS = 20 * 60_000;

export const OFFLINE_READ_LINE = 'NK_PROOF step=offline-read outcome=ok';

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
      // 🔴 NOT `simctl openurl`: iOS holds a custom-scheme URL from outside
      // the app behind a system "Open in “<app>”?" sheet that nothing on a
      // runner answers — run 36637965865's screenshot, 25 s after the open.
      // The app opens its own callback instead (appOpensCallback below), which
      // iOS routes through the same scene → app_links → supabase_flutter path.
      return [];
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

/** Whether the APP opens the callback itself (`NK_PROOF_OPEN_FROM_APP`)
 *  rather than the host — iOS alone; see the `ios` arm of openCommands. */
export const appOpensCallback = (target) => target === 'ios';

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
  const o = { callback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--callback') o.callback = true;
    else if (a === '--app' || a === '--target' || a === '--device' || a === '--log') o[a.slice(2)] = argv[++i];
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

/**
 * What the OS did with the callback, read 25 s after it was opened — or null
 * where the target's own output already says. iOS only: proof run
 * 36546306851's simctl openurl exited 0 and the app never saw the URL (no
 * `handle deeplink uri`), and nothing a runner prints could say why. So the
 * simulator's own log and a screenshot of what was on screen.
 */
export function afterOpenDiagnostics(target, { device, dir }) {
  if (target !== 'ios') return null;
  const dev = device || 'booted';
  return {
    screenshot: ['xcrun', 'simctl', 'io', dev, 'screenshot', join(dir, 'nk-proof-ios-after-open.png')],
    log: ['xcrun', 'simctl', 'spawn', dev, 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate',
      'eventMessage CONTAINS[c] "nikatru" OR eventMessage CONTAINS[c] "openurl" OR eventMessage CONTAINS "app_links" ' +
        'OR eventMessage CONTAINS "Flutter application in debug" OR process == "SpringBoard" AND eventMessage CONTAINS[c] "url"'],
  };
}

function runDiagnostics(d, root) {
  if (!d) return;
  console.log(`${NAME}: $ ${d.screenshot.join(' ')}`);
  spawnSync(d.screenshot[0], d.screenshot.slice(1), { cwd: root, stdio: 'inherit' });
  const r = spawnSync(d.log[0], d.log.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = String(r.stdout ?? '').split('\n').filter((l) => l.trim());
  console.log(`${NAME}: simulator log after the open — last ${Math.min(lines.length, 150)} of ${lines.length} line(s):`);
  for (const l of lines.slice(-150)) console.log(`  ${l}`);
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
  // Created FIRST, before any refusal and before the spawn: to the purge a
  // proof step that ran and left no log is UNRESOLVED (consent_anon_id.mjs,
  // resolveProofLogConsent), so a path that starts no app must say so here.
  const log = o.log ? resolve(root, o.log) : null;
  if (log) {
    mkdirSync(resolve(log, '..'), { recursive: true });
    writeFileSync(log, `${NAME}: ${o.app}/${o.target} — flutter test output follows\n`);
  }
  const missing = defines.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`${NAME}: missing env ${missing.join(', ')} — the build would run in demo posture or without the user`);
    if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=none refused=env\n`);
    process.exit(2);
  }
  const offlineRead = offlineReadDeclared(root, o.app);
  console.log(`${NAME}: ${o.app}'s proof suite ${offlineRead ? 'declares' : 'does not declare'} the offline read`);
  await printEgressIp();

  const flutterArgs = [
    'test', PROOF_TEST,
    // why: on CI flutter picks the `github` reporter, which holds a test's
    // output until the test ENDS — so a hung or killed run left no line at all
    // (run 36525783687), and the consent id printed before the tap would never
    // reach the log. `expanded` streams each line as it is printed.
    '--reporter', 'expanded',
    ...(o.device ? ['-d', o.device] : []),
    ...defines.map((k) => `--dart-define=${k}=${process.env[k]}`),
    `--dart-define=NK_PROOF_CALLBACK=${o.callback}`,
    ...(o.callback && appOpensCallback(o.target) ? [`--dart-define=NK_PROOF_OPEN_FROM_APP=${callbackUrl(o.app)}`] : []),
  ];
  const url = callbackUrl(o.app);
  let out = '';
  let opened = false;
  let hung = false;
  const child = spawn('flutter', flutterArgs, {
    cwd: join(root, 'apps', o.app),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let silence;
  const arm = () => {
    clearTimeout(silence);
    silence = setTimeout(() => {
      hung = true;
      console.error(`${NAME}: flutter test printed nothing for ${SILENCE_LIMIT_MS / 60_000} min — killing it`);
      // On Windows `shell: true` makes the child cmd.exe, and flutter its child.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill();
    }, SILENCE_LIMIT_MS);
  };
  arm();
  const onData = (stream) => (chunk) => {
    const s = chunk.toString();
    arm();
    out += s;
    if (log) appendFileSync(log, s);
    stream.write(s);
    if (o.callback && !opened && out.includes(AWAIT_MARKER)) {
      opened = true;
      setTimeout(() => runOpen(openCommands(o.target, url, { app: o.app, root, device: o.device }), root), 3_000);
      const diag = afterOpenDiagnostics(o.target, { device: o.device, dir: process.env.RUNNER_TEMP || root });
      if (diag) setTimeout(() => runDiagnostics(diag, root), 28_000);
    }
  };
  child.stdout.on('data', onData(process.stdout));
  child.stderr.on('data', onData(process.stderr));
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(silence);
  if (log) appendFileSync(log, `\n${PROOF_LOG_END} flutter_exit=${code}${hung ? ' killed=silence' : ''}\n`);

  const problems = readProof(out, { callback: o.callback, offlineRead });
  if (code !== 0) problems.unshift(`flutter test exited ${code}`);
  if (hung) problems.unshift(`flutter test printed nothing for ${SILENCE_LIMIT_MS / 60_000} min and was killed — the app never reported back (a launch that hung, not a sign-in that failed)`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`${NAME}: ${o.app}/${o.target} FAILED`);
    process.exit(1);
  }
  console.log(`${NAME}: ${o.app}/${o.target} OK — the form signed in, the gated calls answered without a captcha, sign-out returned${offlineRead ? ', the list read back offline' : ''}${o.callback ? ', and the OS-delivered callback failed cleanly' : ''}`);
}

const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) await main();
