#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// smoke-web-artifact.mjs — start the built web bundle once, BEFORE PUBLICATION,
// and require it to reach a defined ready signal.
//
// [pipeline 9]R-13 "No artifact is published without being launched once."
//
// 🔴 THOSE THREE WORDS — *before publication* — ARE LOad-BEARING AND MUST SURVIVE
// ANY FUTURE FOLD. `[14]O-7` smokes a LIVE ENVIRONMENT after a deploy and can
// roll it back; this smokes the ARTIFACT before anything has shipped, where
// there is nothing to roll back because nothing is live. Duplicate D-14 was
// re-confirmed on that distinction. A fold that loses the words moves the check
// to after the damage.
//
// ── WHAT NOTHING IN THIS REPOSITORY PROVED UNTIL THIS EXISTED ────────────────
// Every gate here proves a build COMPLETES and stops. `build-platforms.yml` runs
// six `flutter build` invocations and immediately uploads the output; `ci.yml`
// analyzes and unit-tests a stamped app and never starts it; `e2e.yml` drives a
// DEBUG `web-server` target, which is not the released bundle. So a build that
// produces a non-starting artifact was green in every lane: a wrong `base href`,
// an asset declared in pubspec and missing from the bundle, an exception thrown
// in `main()` before the first frame. Each of those fails at first launch and
// NOWHERE EARLIER.
//
// ── THE READY SIGNAL IS OBSERVED, NOT ASSUMED ───────────────────────────────
// `flutter-first-frame` is dispatched on `window` by the Flutter web engine once
// the first frame has been rasterized — which requires main() to have run to
// completion AND runApp to have produced a frame. VERIFIED 2026-08-03 against a
// real `flutter build web --release --pwa-strategy=none` of apps/subly, headless
// Chrome, CDP: the event fired at ~1.5 s. It is preferred over a DOM node on
// purpose: `<flutter-view>` and `<flt-glass-pane>` are created during ENGINE
// bootstrap, before any app code renders, so an app whose first build threw
// would still have them — a ready signal satisfied by a broken app is not one.
//
// A zero exit code from the browser is NOT the signal either: headless Chrome
// exits 0 on a page that rendered nothing at all.
//
// ── NO DEPENDENCIES, DELIBERATELY ───────────────────────────────────────────
// A static server from `node:http`, Chrome spoken to over the DevTools Protocol
// through Node's built-in `WebSocket` (Node >= 22). No chromedriver, no
// puppeteer, no new SHA-pinned action in the deploy lane — the smoke must not
// become the reason a deploy fails to start.
//
// Usage:  node tooling/smoke/smoke-web-artifact.mjs <bundleDir> [--timeout-ms N] [--chrome PATH]
// Exit 0 = the artifact started and reached the ready signal.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/**
 * THE DEFINED READY SIGNAL. Exported so tooling/ci/assert-launch-smoke.mjs can
 * assert it still exists rather than trusting that this file still checks
 * something — a smoke step reduced to "load the page and exit 0" is exactly the
 * degradation R-13 exists to prevent, and it looks identical in a run log.
 */
export const READY_SIGNAL = {
  id: 'flutter-first-frame',
  /** Installed before navigation, so the event cannot fire before we listen. */
  install: "window.__nikatruFirstFrame = false; window.addEventListener('flutter-first-frame', function () { window.__nikatruFirstFrame = true; });",
  /** Polled after navigation. */
  expression: 'window.__nikatruFirstFrame === true',
  why:
    'the Flutter web engine dispatches `flutter-first-frame` on window once the first frame has been ' +
    'rasterized, so it is true only after main() completed and runApp produced a frame. Observed at ' +
    '~1.5s against a real release build of apps/subly on 2026-08-03.',
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const BUNDLE = positional[0] ? resolve(positional[0]) : null;
const TIMEOUT_MS = Number(flag('timeout-ms', '90000'));

/** Entry points whose absence means the bundle cannot start at all. Checked
 *  before a browser is launched so the failure names the cause instead of
 *  arriving as "the ready signal never fired". */
const REQUIRED_ENTRY_FILES = ['index.html', 'flutter_bootstrap.js'];

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.otf', 'font/otf'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.bin', 'application/octet-stream'],
  ['.map', 'application/json; charset=utf-8'],
]);

/** Content type for a served file. Exported for its own test: serving
 *  `.wasm` as octet-stream makes `WebAssembly.instantiateStreaming` refuse,
 *  which would fail the smoke for a reason that is the harness's fault. */
export const mimeFor = (file) => MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream';

/** A static server over `dir`, bound to loopback on an ephemeral port.
 *  Loopback and not 0.0.0.0: a CI runner is a shared network and this serves an
 *  unreleased build. */
export function serveBundle(dir, onRequest = () => {}) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p.endsWith('/')) p += 'index.html';
    // CONTAINMENT, and it is these two operations rather than a third check.
    // `p` always begins with `/` (an origin-form request line does), so
    // `normalize` resolves every `..` against the ROOT and can never climb past
    // it; stripping the leading separator then re-roots the result inside the
    // bundle. `/..%2foutside.txt` therefore resolves to `<dir>/outside.txt`.
    //
    // 🔴 A `!abs.startsWith(dir)` branch WAS written here and was DELETED on
    // 2026-08-03 after the test written to exercise it could not make it fire:
    // every traversal was already collapsed above, so the branch changed no
    // outcome on any writable input. An assertion that cannot fail is worse
    // than none — it inflates apparent coverage — which is why the test below
    // asserts the collapse POSITIVELY (the request returns the file INSIDE the
    // bundle) instead of asserting a rejection that never happens.
    const abs = join(dir, normalize(p).replace(/^[/\\]+/, ''));
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      onRequest({ path: p, status: 404 });
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    onRequest({ path: p, status: 200 });
    res.writeHead(200, { 'content-type': mimeFor(abs) });
    res.end(readFileSync(abs));
  });
  return server;
}

const CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE,
  'google-chrome',
  'google-chrome-stable',
  'chromium-browser',
  'chromium',
].filter(Boolean);

function main() {
  if (!BUNDLE) {
    console.error('FAIL smoke-web-artifact: no bundle directory given. Usage: smoke-web-artifact.mjs <bundleDir>');
    process.exit(1);
  }
  if (!existsSync(BUNDLE) || !statSync(BUNDLE).isDirectory()) {
    console.error(`FAIL smoke-web-artifact: ${BUNDLE} is not a directory. The build step produced nothing to launch.`);
    process.exit(1);
  }
  const missing = REQUIRED_ENTRY_FILES.filter((f) => !existsSync(join(BUNDLE, f)));
  if (missing.length) {
    console.error(
      `FAIL smoke-web-artifact: ${BUNDLE} is missing ${missing.join(', ')}. A web bundle without its entry ` +
        'point cannot start, and a browser would only be able to tell you that the ready signal never fired.',
    );
    process.exit(1);
  }
  return run();
}

async function run() {
  /** Every 404 the page asked for. A declared-but-missing asset is one of the
   *  three failures R-13 names, and it does NOT always stop the first frame —
   *  so it is asserted separately rather than folded into the ready signal. */
  const notFound = [];
  const server = serveBundle(BUNDLE, ({ path, status }) => {
    if (status === 404 || status === 403) notFound.push(`${status} ${path}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  console.log(`serving ${BUNDLE} at ${base}`);

  const profile = mkdtempSync(join(tmpdir(), 'nikatru-smoke-'));
  let chrome = null;
  let ws = null;
  const cleanup = () => {
    try { ws?.close(); } catch { /* already closed */ }
    try { chrome?.kill(); } catch { /* already gone */ }
    try { server.close(); } catch { /* already closed */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const die = (msg, detail = []) => {
    console.error(`FAIL smoke-web-artifact: ${msg}`);
    for (const d of detail) console.error(`     ${d}`);
    cleanup();
    process.exit(1);
  };

  const explicit = flag('chrome', process.env.CHROME_EXECUTABLE);
  const candidates = explicit ? [explicit] : CHROME_CANDIDATES;
  let devtools = null;
  let lastErr = '';
  for (const bin of candidates) {
    const child = spawn(bin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
      'about:blank',
    ]);
    const url = await new Promise((done) => {
      let buf = '';
      const t = setTimeout(() => done(null), 25000);
      child.on('error', (e) => { lastErr = `${bin}: ${e.message}`; clearTimeout(t); done(null); });
      child.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(t); done(m[1]); }
      });
      child.on('exit', (code) => { lastErr = `${bin}: exited ${code} before printing a DevTools endpoint`; clearTimeout(t); done(null); });
    });
    if (url) { chrome = child; devtools = url; break; }
    try { child.kill(); } catch { /* already gone */ }
  }
  if (!devtools) {
    die(
      'no headless Chrome could be started, so the artifact was never launched.',
      [
        `tried: ${candidates.join(', ')}`,
        lastErr ? `last error: ${lastErr}` : 'no error text was produced',
        'This is a FAILURE and not a skip on purpose: "I could not tell" must never read as "it starts".',
      ],
    );
  }

  ws = new WebSocket(devtools);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', () => j(new Error('devtools socket refused'))); }).catch((e) =>
    die(e.message, ['The browser started but its DevTools endpoint could not be reached.']),
  );

  let seq = 0;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  const netFailures = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails ?? {};
      pageErrors.push(d.exception?.description ?? d.text ?? 'unknown exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.method === 'Network.loadingFailed' && !msg.params?.canceled) {
      netFailures.push(msg.params.errorText);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((done) => {
      const id = ++seq;
      pending.set(id, done);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.result?.targetId, flatten: true });
  const session = attached.result?.sessionId;
  if (!session) die('could not attach to a browser tab, so nothing was loaded.');

  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  await send('Log.enable', {}, session);
  await send('Network.enable', {}, session);
  // BEFORE navigation. The event fires once and does not replay, so a listener
  // installed after the load is a check that can only ever time out.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: READY_SIGNAL.install }, session);
  await send('Page.navigate', { url: base }, session);

  const started = Date.now();
  let ready = false;
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 250));
    const r = await send('Runtime.evaluate', { expression: READY_SIGNAL.expression, returnByValue: true }, session);
    if (r.result?.result?.value === true) { ready = true; break; }
  }
  const elapsed = Date.now() - started;

  if (!ready) {
    die(
      `the artifact never reached the ready signal \`${READY_SIGNAL.id}\` within ${TIMEOUT_MS} ms.`,
      [
        READY_SIGNAL.why,
        ...(pageErrors.length ? [`page exception: ${pageErrors[0]}`] : []),
        ...(consoleErrors.length ? [`console error: ${consoleErrors[0]}`] : []),
        ...(netFailures.length ? [`network failure: ${netFailures[0]}`] : []),
        ...(notFound.length ? [`the page asked for files the bundle does not contain: ${notFound.join(', ')}`] : []),
        'A build that completes and does not start is green in every other lane in this repository.',
      ],
    );
  }

  if (notFound.length) {
    die(
      `the artifact started but requested ${notFound.length} file(s) the bundle does not contain.`,
      [
        ...notFound.map((n) => `  ${n}`),
        'An asset declared in pubspec and absent from the bundle does not always stop the first frame — it ' +
          'fails on the screen that needs it, which is why this is asserted separately.',
      ],
    );
  }
  if (pageErrors.length) {
    die(
      `the artifact reached its first frame but threw ${pageErrors.length} unhandled exception(s) doing it.`,
      pageErrors.slice(0, 5),
    );
  }

  console.log(`ok   ${READY_SIGNAL.id} reached in ${elapsed} ms — the artifact starts`);
  console.log(`ok   no 404 from the bundle, no unhandled page exception`);
  console.log('\nsmoke-web-artifact: ok (this ran BEFORE publication — the artifact, not the deployment)');
  cleanup();
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join('tooling', 'smoke', 'smoke-web-artifact.mjs'))) {
  await main();
}
