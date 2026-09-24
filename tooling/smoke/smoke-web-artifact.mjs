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
// real `flutter build web --release --pwa-strategy=none` of apps/subscriptiontracker, headless
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
// ── IT BOOTS UNDER THE BUNDLE'S OWN CONTENT-SECURITY-POLICY (2026-09-24) ─────
// Until today this server sent no header but content-type, so the bundle booted
// under NO policy and the smoke said nothing about the one the edge serves. The
// app's `_headers` carries a CSP whose `connect-src` is a hand list of hosts,
// and a host missing from it is not a build failure or a 404: the browser
// refuses the request, sign-in or an API call fails at runtime, and every lane
// in this repository was green. (Row O-WEB-CSP-HAND-LIST-UNSMOKED.)
//
//   · THE POLICY IS THE BUNDLE'S OWN. `serveBundle` applies the bundle's
//     `_headers` rules as Pages does: a `*` splat, `:name` placeholders, every
//     matching rule's headers, and a header set by two rules joined with a
//     comma. A bundle with no `_headers`, or one that puts no CSP on the page,
//     is COVERAGE LOST (exit 2): a boot under no policy proves nothing about it.
//   · A VIOLATION IS REPORTED, NOT SCRAPED. Before navigation a
//     `securitypolicyviolation` listener is installed that calls a
//     `Runtime.addBinding` binding, so the directive and the blocked URI arrive
//     as data. An enforced violation fails the smoke (exit 1), and one during
//     boot fails it before the ready signal counts.
//   · THE PROBE. A boot reaches only the hosts its own code path calls, so once
//     the ready signal is observed the page fetches each `--connect <url>`
//     origin itself. `Fetch.enable` pauses every request to those origins and
//     answers it HERE with a 204, so no probe request reaches its host; a CSP
//     refusal happens in the renderer before a request exists, so an origin
//     missing from `connect-src` still surfaces as a violation. Each probe must
//     also have BEEN paused: a pattern that stopped matching is a failure, not a
//     request that went out unnoticed.
//
// Usage:  node tooling/smoke/smoke-web-artifact.mjs <bundleDir> [--connect URL]... [--timeout-ms N] [--chrome PATH]
// Exit 0 = the artifact started under its own policy and reached the ready
// signal, and every --connect origin was allowed. Exit 1 = a finding. Exit 2 =
// COVERAGE LOST: the bundle carries no policy for the smoke to boot under.
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
    '~1.5s against a real release build of apps/subscriptiontracker on 2026-08-03.',
};

/**
 * THE CSP HALF. Installed before navigation, like the ready signal, so a
 * violation during the very first script is heard. Each one is handed to the
 * harness through a DevTools binding as JSON — the directive and the blocked URI
 * as data, never read back out of console text. The binding is looked up when
 * a violation fires, not when the listener is installed.
 */
export const CSP_VIOLATION = {
  binding: '__nikatruCspViolation',
  install:
    "window.addEventListener('securitypolicyviolation', function (e) { if (typeof window.__nikatruCspViolation === 'function') " +
    'window.__nikatruCspViolation(JSON.stringify({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, ' +
    'disposition: e.disposition, source: e.sourceFile, line: e.lineNumber })); }, true);',
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
/** Every value of a repeatable flag, in order. */
const flagAll = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const BUNDLE = positional[0] ? resolve(positional[0]) : null;
const TIMEOUT_MS = Number(flag('timeout-ms', '90000'));
const CONNECT = flagAll('connect');

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

/** One log line per value (CodeQL #40). A newline inside a value — a --chrome path, a spawn
 *  error, a page's exception text — would otherwise start a line of its own, and a line that
 *  begins "::" is read by GitHub Actions as a workflow command, not as output. */
// Each line terminator is replaced on its own, and one of those replaces is the LAST thing done to
// the value: CodeQL's log-injection sanitizer reads a call replacing literal "\r\n", "\r" or "\n",
// so a character class, or a later tidying replace, leaves the value unsanitized to the query (#326).
// A run of terminators therefore prints one mark each, which is the only visible change.
export const oneLine = (d) =>
  String(d)
    .replace(/\r\n/g, ' ⏎ ')
    .replace(/\r/g, ' ⏎ ')
    .replace(/\n/g, ' ⏎ ');

/** The path prefix a bundle was COMPILED FOR, read out of its own index.html.
 *
 *  `flutter build web --base-href /<id>/` writes that value into
 *  `<base href="…">`, and every other URL in the document is resolved against
 *  it. So the artifact carries the answer; nothing has to be told.
 *
 *  Returns a prefix with a leading AND trailing slash (`/subscriptiontracker/`), or `/` when
 *  the bundle has no `<base>` tag or was compiled for the origin root. An
 *  absolute base href (a full URL) also yields `/`: this server is loopback and
 *  cannot honour a foreign origin, and pretending otherwise would mount the
 *  bundle somewhere the deploy never will. */
export function basePrefix(dir) {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return '/';
  const m = readFileSync(index, 'utf8').match(/<base\s[^>]*href\s*=\s*["']([^"']*)["']/i);
  const href = (m?.[1] ?? '').trim();
  if (!href || href === '/' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return '/';
  return `/${href.replace(/^\/+|\/+$/g, '')}/`;
}

/** Strip `prefix` from a request path, or null when the path is outside it.
 *  `/subscriptiontracker/x` → `/x`; `/subscriptiontracker` → `/`; `/other` → null. */
export function stripBasePrefix(path, prefix) {
  if (path === prefix.slice(0, -1)) return '/';
  if (!path.startsWith(prefix)) return null;
  return `/${path.slice(prefix.length)}`;
}

/** A Cloudflare Pages `_headers` path pattern as a RegExp: one greedy `*` splat
 *  and `:name` placeholders, each matching one path segment. */
const pagesPattern = (pattern) =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+'))
      .join('.*')}$`,
  );

/** The rules of a Pages `_headers` file: a path pattern at column 0, then its
 *  indented `Name: value` lines; `#` lines are comments.
 *
 *  🔴 ANYTHING ELSE THROWS, naming the line. The smoke's claim is "this bundle
 *  boots under the policy Pages will serve", and a line it cannot model — an
 *  absolute-URL rule, a `! Name` detach, a header before any pattern — is a line
 *  on which that claim would be a guess. main() turns the throw into COVERAGE
 *  LOST. tooling/ci/assert-web-cache-policy.mjs reads the same files for
 *  Cache-Control and skips what it does not understand; this reader cannot. */
export function parseHeadersFile(text) {
  const rules = [];
  let rule = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const m = line.match(/^\s+([A-Za-z0-9-]+)\s*:\s*(.*?)\s*$/);
      if (!rule) throw new Error(`_headers:${i + 1} is a header line before any path pattern`);
      if (!m) throw new Error(`_headers:${i + 1} is not a \`Name: value\` header line: ${line.trim()}`);
      rule.headers.push([m[1], m[2]]);
      continue;
    }
    const pattern = line.trim();
    if (!pattern.startsWith('/')) throw new Error(`_headers:${i + 1} is not a path pattern: ${pattern}`);
    rule = { pattern, line: i + 1, re: pagesPattern(pattern), headers: [] };
    rules.push(rule);
  }
  return rules;
}

/** The headers Pages sends for `path`: every matching rule applies, and a header
 *  two rules set is joined with a comma — which for Content-Security-Policy
 *  means both policies are enforced, exactly as a browser would read it. */
export function headersFor(rules, path) {
  const out = new Map();
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    for (const [name, value] of r.headers) {
      const k = name.toLowerCase();
      out.set(k, out.has(k) ? [out.get(k)[0], `${out.get(k)[1]}, ${value}`] : [name, value]);
    }
  }
  return Object.fromEntries(out.values());
}

/** The bundle's `_headers` rules, or null when it has none. One read, no
 *  existence check first (the same CodeQL #89 shape as the file server). */
export function readBundleHeaders(dir) {
  let text;
  try {
    text = readFileSync(join(dir, '_headers'), 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
  return parseHeadersFile(text);
}

/** The value of `name` in `headers`, whatever its case. */
export const headerValue = (headers, name) =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/** A static server over `dir`, bound to loopback on an ephemeral port.
 *  Loopback and not 0.0.0.0: a CI runner is a shared network and this serves an
 *  unreleased build.
 *
 *  Every response from inside the bundle carries the headers the bundle's own
 *  `_headers` gives its path, matched against the path RELATIVE TO THE BUNDLE —
 *  the Pages project serves the bundle at its root and the apex router adds the
 *  `/<id>` prefix, so `/*` and `/index.html` mean what they mean at the edge. */
export function serveBundle(dir, onRequest = () => {}, rules = readBundleHeaders(dir) ?? []) {
  const server = createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let p = requested;
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
    // 🔴 THE BUNDLE IS SERVED AT ITS OWN BASE PATH, NOT AT `/` [ADR 075].
    //
    // Until 2026-09-09 this server mounted `build/web` at the root and that was
    // right, because the app was published at the root of `<id>.nikatru.com`.
    // The app is now published at `nikatru.com/<id>`, so `flutter build web` is
    // given `--base-href /<id>/` and every URL in `index.html` is written
    // relative to THAT. Served at `/`, the very first request the page makes is
    // `/<id>/flutter_bootstrap.js`, which this directory does not contain — the
    // engine never boots and the smoke fails on a bundle that is CORRECT.
    //
    // ⚠️ THIS IS NOT A WAIVER, IT IS THE SAME ASSERTION AGAINST THE RIGHT PATH.
    // The prefix is READ OUT OF THE ARTIFACT (`<base href="…">` in its own
    // index.html), never passed in and never assumed, so the smoke reproduces
    // exactly what the deploy will serve. A bundle whose base href does not
    // match where it is published is still caught — by the 404 list, from the
    // other direction — and a bundle with no `<base>` tag keeps the old
    // root-mounted behaviour unchanged.
    const prefix = basePrefix(dir);
    const stripped = prefix === '/' ? p : stripBasePrefix(p, prefix);
    if (stripped === null) {
      // Outside the bundle's own base path: a real 404 for this artifact, and
      // exactly what the edge would answer.
      onRequest({ path: p, status: 404 });
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const abs = join(dir, normalize(stripped).replace(/^[/\\]+/, ''));
    // READ ONCE (CodeQL #89): the bytes are the answer. A missing path, a directory, or a path
    // through a file is a 404; any other failure to read throws, as the read did before.
    let body;
    try {
      body = readFileSync(abs);
    } catch (e) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR' && e?.code !== 'EISDIR') throw e;
      onRequest({ path: p, status: 404 });
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    onRequest({ path: p, status: 200 });
    const rel = prefix === '/' ? requested : stripBasePrefix(requested, prefix);
    res.writeHead(200, { ...headersFor(rules, rel), 'content-type': mimeFor(abs) });
    res.end(body);
  });
  return server;
}

/** The origin a `--connect` value names, or null when it is not an https URL.
 *  Only the origin is ever used or printed: deploy-web passes the GlitchTip DSN,
 *  whose user part is its key.
 *
 *  ⚠️ HTTPS ONLY, AND THAT IS A CONTAINMENT RULE, NOT A PREFERENCE. The app's
 *  policy carries `upgrade-insecure-requests`, so the page would rewrite an
 *  `http://` probe to `https://` — past an interception pattern written for
 *  `http://` — and that request would leave the machine. */
export function probeOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Fetched in the page once it is ready: one request per origin, sequential,
 *  `no-cors` so an answer without CORS headers still resolves (the question is
 *  whether the POLICY lets the request out, not whether the host allows the
 *  page to read it), and no credentials. The trailing wait lets a violation
 *  event, which is dispatched as its own task, reach the binding first. */
const probeExpression = (origins) =>
  `(async function (urls) { const out = []; for (const url of urls) { try { const r = await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }); ` +
  `out.push({ url: url, reached: true, type: r.type }); } catch (e) { out.push({ url: url, reached: false, error: String((e && e.message) || e) }); } } ` +
  `await new Promise(function (done) { setTimeout(done, 100); }); return out; })(${JSON.stringify(origins.map((o) => `${o}/`))})`;

/** COVERAGE LOST — exit 2, never 1: the smoke did not check enough to be
 *  evidence (AGENTS.md exit-code convention), which is not a pass either. */
function coverageLost(msg, detail = [], cleanup = () => {}) {
  console.error(`FAIL COVERAGE LOST — smoke-web-artifact: ${oneLine(msg)}`);
  for (const d of detail) console.error(`     ${oneLine(d)}`);
  cleanup();
  process.exit(2);
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
  const origins = CONNECT.map(probeOrigin);
  const notHttps = origins.flatMap((o, i) => (o ? [] : [i + 1]));
  if (notHttps.length) {
    console.error(
      `FAIL smoke-web-artifact: --connect value(s) #${notHttps.join(', #')} are not https:// URLs (the values are not ` +
        'printed: one may be a DSN, whose user part is a key). An http:// probe would be upgraded past its interception ' +
        'pattern by the policy and leave the machine, so it is refused rather than sent.',
    );
    process.exit(1);
  }
  // The policy is checked for BEFORE a browser is launched, for the same reason
  // as the entry files: the failure names its cause instead of passing a boot
  // that proved nothing about the policy.
  let rules;
  try {
    rules = readBundleHeaders(BUNDLE);
  } catch (e) {
    coverageLost(`${BUNDLE}/_headers could not be read as Pages header rules: ${e.message}`, [
      'The smoke cannot boot the bundle under the policy Pages will serve if it cannot model the file that sets it.',
    ]);
  }
  if (rules === null) {
    coverageLost(`${BUNDLE} carries no _headers, so the smoke would boot it under NO Content-Security-Policy.`, [
      'A boot under no policy proves nothing about the policy. Flutter copies web/_headers into build/web, so a',
      'built bundle without one was built from an app that declares no headers at all.',
    ]);
  }
  const csp = headerValue(headersFor(rules, '/'), 'content-security-policy');
  if (!csp) {
    coverageLost(`no rule in ${BUNDLE}/_headers puts a Content-Security-Policy on the page (/).`, [
      'The smoke would boot the bundle under no policy, which proves nothing about the one it is meant to test.',
    ]);
  }
  return run(rules, [...new Set(origins)], csp);
}

async function run(rules, origins, csp) {
  /** Every 404 the page asked for. A declared-but-missing asset is one of the
   *  three failures R-13 names, and it does NOT always stop the first frame —
   *  so it is asserted separately rather than folded into the ready signal. */
  const notFound = [];
  const server = serveBundle(BUNDLE, ({ path, status }) => {
    if (status === 404 || status === 403) notFound.push(`${status} ${path}`);
  }, rules);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // The page is opened AT THE BUNDLE'S OWN BASE PATH, for the same reason the
  // server mounts it there: that is the URL the deploy will serve it from, and
  // opening it anywhere else tests a deployment nobody is going to make.
  const prefix = basePrefix(BUNDLE);
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  console.log(`serving ${BUNDLE} at ${base}${prefix === '/' ? '' : `  (base href ${prefix}, read from the artifact)`}`);
  const connectSrc = csp.split(/[;,]/).map((d) => d.trim()).find((d) => /^connect-src\s/i.test(d));
  console.log(`     under its own _headers (${rules.length} rule(s)); the page's policy has ${connectSrc ? `\`${connectSrc}\`` : 'no connect-src'}`);

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
    console.error(`FAIL smoke-web-artifact: ${oneLine(msg)}`);
    for (const d of detail) console.error(`     ${oneLine(d)}`);
    cleanup();
    process.exit(1);
  };
  const lost = (msg, detail = []) => coverageLost(msg, detail, cleanup);

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
  /** Enforced CSP violations, from the binding. A report-only one blocks
   *  nothing, so it is printed and never fails the smoke. */
  const violations = [];
  const reportOnly = [];
  /** Every request the probe's interception paused, and so answered here. */
  const paused = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === CSP_VIOLATION.binding) {
      let v;
      try { v = JSON.parse(msg.params.payload); } catch { v = { directive: 'unreadable', blocked: String(msg.params.payload) }; }
      (v.disposition === 'report' ? reportOnly : violations).push(v);
    }
    if (msg.method === 'Fetch.requestPaused') {
      // Answered HERE, never continued: this is what keeps a probe off its host.
      paused.push(msg.params.request.url);
      send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 204, responseHeaders: [] }, msg.sessionId);
    }
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
  // The violation listener, BEFORE navigation for the same reason as the ready
  // signal. A listener that could not be installed is a CSP half that hears
  // nothing, and silence from it would read as "no violation".
  const bound = await send('Runtime.addBinding', { name: CSP_VIOLATION.binding }, session);
  const listening = await send('Page.addScriptToEvaluateOnNewDocument', { source: CSP_VIOLATION.install }, session);
  if (bound.error || listening.error) {
    lost('the CSP violation listener could not be installed, so a violation would go unheard.', [
      JSON.stringify(bound.error ?? listening.error),
    ]);
  }
  // BEFORE navigation. The event fires once and does not replay, so a listener
  // installed after the load is a check that can only ever time out.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: READY_SIGNAL.install }, session);
  await send('Page.navigate', { url: base }, session);

  const started = Date.now();
  let ready = false;
  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 250));
    if (violations.length) break;
    const r = await send('Runtime.evaluate', { expression: READY_SIGNAL.expression, returnByValue: true }, session);
    if (r.result?.result?.value === true) { ready = true; break; }
  }
  const elapsed = Date.now() - started;
  const showViolation = (v) =>
    `${v.directive} refused ${v.blocked || '(no URI)'}${v.source ? `  (from ${v.source}${v.line ? `:${v.line}` : ''})` : ''}`;
  const POLICY_WHY =
    "The policy is the bundle's own _headers, served as Pages serves it. A refusal is not an error page or a 404: " +
    'the feature behind it fails at runtime, for every visitor, while every other lane in this repository is green.';

  // BEFORE the ready signal counts. A violation is named with its directive
  // and blocked URI, which a timeout could never do.
  if (violations.length) {
    die(
      `the artifact broke its own Content-Security-Policy while it booted: ${showViolation(violations[0])}.`,
      [...violations.slice(0, 5).map(showViolation), POLICY_WHY],
    );
  }

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

  // ── THE PROBE, after the boot's own verdicts so nothing it answers can move
  // them. Interception is switched on only now: the boot above reaches exactly
  // what it reached before this limb existed, and from here every request to a
  // probe origin is paused and answered with a 204 by the handler above.
  if (origins.length) {
    const intercepting = await send(
      'Fetch.enable',
      { patterns: origins.map((o) => ({ urlPattern: `${o}/*`, requestStage: 'Request' })) },
      session,
    );
    if (intercepting.error) {
      lost('request interception could not be switched on, so the connect-src probe was NOT sent.', [
        JSON.stringify(intercepting.error),
        'A probe that is not intercepted reaches the real host, so the smoke refuses to send one.',
      ]);
    }
    const probe = await send(
      'Runtime.evaluate',
      { expression: probeExpression(origins), awaitPromise: true, returnByValue: true },
      session,
    );
    const results = probe.result?.result?.value;
    if (!Array.isArray(results)) {
      lost('the connect-src probe returned nothing readable, so no origin was tested.', [
        JSON.stringify(probe.error ?? probe.result?.exceptionDetails ?? probe.result ?? {}),
      ]);
    }
    if (violations.length) {
      die(
        `the bundle's own Content-Security-Policy refused a --connect origin: ${showViolation(violations[0])}.`,
        [
          ...violations.slice(0, 5).map(showViolation),
          'Each --connect origin is a host the build was given to call. One its connect-src does not name is a',
          'request the browser blocks in production: sign-in, the API or crash reporting fails for every visitor.',
          POLICY_WHY,
        ],
      );
    }
    const unpaused = results.filter((r) => !paused.includes(r.url));
    if (unpaused.length) {
      die(`${unpaused.length} probe request(s) were NOT paused by the interception, so they may have reached the host.`, [
        ...unpaused.map((r) => `  ${r.url}`),
        'The probe exists to test the policy without touching production; a request it did not answer itself is',
        'one it cannot vouch for.',
      ]);
    }
    const failed = results.filter((r) => !r.reached);
    if (failed.length) {
      die(`${failed.length} probe request(s) did not complete although no violation was reported.`, [
        ...failed.map((r) => `  ${r.url}: ${r.error}`),
      ]);
    }
  }

  console.log(`ok   ${READY_SIGNAL.id} reached in ${elapsed} ms — the artifact starts`);
  console.log(`ok   no 404 from the bundle, no unhandled page exception`);
  console.log("ok   no Content-Security-Policy violation, under the bundle's own _headers");
  for (const o of origins) {
    console.log(`ok   connect-src allows ${o} — fetched from the page, paused and answered here with a 204; it never reached the host`);
  }
  if (!origins.length) console.log('--   no --connect origin was given, so connect-src was not probed');
  for (const v of reportOnly.slice(0, 5)) console.log(`--   report-only: ${oneLine(showViolation(v))}`);
  console.log('\nsmoke-web-artifact: ok (this ran BEFORE publication — the artifact, not the deployment)');
  cleanup();
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join('tooling', 'smoke', 'smoke-web-artifact.mjs'))) {
  await main();
}
