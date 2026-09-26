// ─────────────────────────────────────────────────────────────────────────────
// smoke-web-artifact.test.mjs — the LAUNCH SMOKE itself must be able to fail.
//
// ⚠️ THE REAL ARTIFACT IS THE FIRST NEGATIVE TEST, and it was run. Against a
// genuine `flutter build web --release --pwa-strategy=none` of apps/subscriptiontracker on
// 2026-08-03, headless Chrome, this box:
//   · the untouched bundle  → exit 0, `flutter-first-frame` at ~1.5–4.2 s
//   · `main.dart.js` deleted → exit 1, "never reached the ready signal", naming
//     the 404 the page asked for
//   · `<base href="/">` rewritten to `/nope/` → exit 1, naming four 404s
//   · `favicon.png` deleted  → exit 1, "STARTED but requested 1 file(s) the
//     bundle does not contain" — the limb the first-frame signal cannot see,
//     which is why it is asserted separately
// Those four are the whole reason this exists, and no fixture can stand in for
// them: they are the difference between "the build completed" and "the app runs".
//
// What is covered HERE is everything that must hold WITHOUT a browser, so the
// suite stays runnable on a machine with no Chrome: argument handling, the
// bundle precondition, the static server's containment and content types, and
// the internal consistency of the ready signal itself.
//
// ⏱ 2026-09-24 — AND THE CSP LIMB, WHICH NEEDS ONE. The bundle now boots under
// its own `_headers` policy (row O-WEB-CSP-HAND-LIST-UNSMOKED), and whether a
// browser refuses a request is a question only a browser answers. Those cases
// boot the checked-in fixture tooling/ci/test/fixtures/smoke-web-csp/ under the
// app's REAL apps/subscriptiontracker/web/_headers, mutated per case. Where no
// Chrome is found they are SKIPPED and say so — except in GitHub Actions, whose
// runner image ships Chrome, where they FAIL instead: a CSP limb that stopped
// being tested there would read exactly like one that passed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import fsMod from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE = join(ROOT, 'tooling', 'smoke', 'smoke-web-artifact.mjs');
const {
  READY_SIGNAL,
  CSP_VIOLATION,
  mimeFor,
  serveBundle,
  basePrefix,
  stripBasePrefix,
  oneLine,
  parseHeadersFile,
  headersFor,
  headerValue,
  probeOrigin,
} = await import(`file://${SMOKE.replaceAll('\\', '/')}`);

const FIXTURE = join(ROOT, 'tooling', 'ci', 'test', 'fixtures', 'smoke-web-csp');
const APP_HEADERS = readFileSync(join(ROOT, 'apps', 'subscriptiontracker', 'web', '_headers'), 'utf8');
/** The CSP the app ships, as written on its one `Content-Security-Policy:` line. */
const APP_CSP = APP_HEADERS.match(/^\s+Content-Security-Policy:\s*(.+?)\s*$/m)?.[1];
const API = 'https://subscriptiontracker-api.nikatru.com';
const API_HOST = new URL(API).hostname;
/** The host a recorded proxy request named: `host:port` for a CONNECT tunnel, an
 *  absolute URL for a plain request. Compared whole, never as a substring. */
const hostOf = (u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? new URL(u).hostname : String(u).replace(/:\d+$/, ''));
/** A `_headers` that sets a policy and nothing else, for the cases that never reach a browser. */
const MINIMAL_HEADERS = "/*\n  Content-Security-Policy: default-src 'self'\n";

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-smokeharness-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
function bundle(files) {
  const dir = join(TMP, `b${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const run = (args) => {
  const r = spawnSync(process.execPath, [SMOKE, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('smoke-web-artifact.mjs — it refuses before it ever opens a browser', () => {
  test('a newline inside a value cannot start a log line of its own — no forged workflow command (CodeQL #40)', () => {
    // --chrome REPLACES the candidate list, so this never launches a real browser: the spawn
    // fails, and both detail lines ("tried:" and "last error:") carry the value. The bundle
    // carries a policy so that it reaches the launch at all (2026-09-24: no _headers is exit 2).
    const dir = bundle({ 'index.html': '<html></html>', 'flutter_bootstrap.js': '// x', _headers: MINIMAL_HEADERS });
    const r = run([dir, '--chrome', join(TMP, 'no-such-chrome') + '\n::error title=forged::x']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no headless Chrome could be started/);
    assert.doesNotMatch(r.out, /^::/m, r.out);
  });

  test('oneLine folds a CR, an LF and a CRLF, each into its own mark (CodeQL #326)', () => {
    // Each terminator is replaced on its own, so a lone CR cannot survive; a character class read
    // as no sanitizer at all to CodeQL, which is what raised #326 on the detail loop.
    assert.equal(oneLine('a\nb'), 'a ⏎ b');
    assert.equal(oneLine('a\rb'), 'a ⏎ b');
    assert.equal(oneLine('a\r\nb'), 'a ⏎ b');
    assert.equal(oneLine('a\n\n\r\nb'), 'a ⏎  ⏎  ⏎ b'); // one mark per terminator
    assert.equal(oneLine('plain'), 'plain');
    assert.doesNotMatch(oneLine('::error title=x\n::warning y'), /\r|\n/);
  });

  test('no bundle directory at all', () => {
    const r = run([]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no bundle directory given/);
  });

  test('a bundle path that is not a directory', () => {
    const r = run([join(TMP, 'nowhere')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /The build step produced nothing to launch/);
  });

  test('a directory with no index.html is not a web bundle', () => {
    const r = run([bundle({ 'flutter_bootstrap.js': '// x' })]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing index\.html/);
  });

  test('a directory with no flutter_bootstrap.js is not a web bundle', () => {
    const r = run([bundle({ 'index.html': '<html></html>' })]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing flutter_bootstrap\.js/);
  });
});

describe('smoke-web-artifact.mjs — the ready signal is internally consistent', () => {
  test('it names an event, installs a listener for THAT event, and polls what the listener sets', () => {
    // Three halves that must agree, and the failure if they do not is SILENT:
    // a listener for one event and a poll of another variable never fires and
    // the smoke times out on a working app, which reads exactly like a broken
    // build. That is worse than no check.
    assert.ok(READY_SIGNAL.id.length > 0);
    assert.match(READY_SIGNAL.install, new RegExp(`addEventListener\\('${READY_SIGNAL.id}'`));
    const variable = READY_SIGNAL.install.match(/window\.(__\w+)\s*=\s*false/)?.[1];
    assert.ok(variable, `the install script must define the flag it sets: ${READY_SIGNAL.install}`);
    assert.match(READY_SIGNAL.expression, new RegExp(`window\\.${variable}\\s*===\\s*true`));
  });

  test('the signal is not a DOM node the ENGINE creates before any app code renders', () => {
    // <flutter-view> and <flt-glass-pane> exist as soon as the engine boots, so
    // an app whose first build threw would still have them. A ready signal a
    // broken app satisfies is not a ready signal.
    assert.doesNotMatch(READY_SIGNAL.expression, /flutter-view|flt-glass-pane|querySelector/);
  });
});

describe('smoke-web-artifact.mjs — the static server it serves the artifact from', () => {
  test('.wasm is served as application/wasm', () => {
    // Not decoration: `WebAssembly.instantiateStreaming` REFUSES any other type,
    // so getting this wrong fails the smoke for the harness\'s own reason.
    assert.equal(mimeFor('a/b/skwasm.wasm'), 'application/wasm');
    assert.equal(mimeFor('index.html'), 'text/html; charset=utf-8');
    assert.equal(mimeFor('main.dart.js'), 'text/javascript; charset=utf-8');
    assert.equal(mimeFor('something.unknown'), 'application/octet-stream');
  });

  test('a request is answered from ONE read of the file — no existence or stat look first (CodeQL #89)', async () => {
    const dir = bundle({ 'index.html': '<html>hi</html>', 'assets/a.bin': 'x' });
    const target = resolve(join(dir, 'assets', 'a.bin'));
    const seen = [];
    const real = { existsSync: fsMod.existsSync, statSync: fsMod.statSync, readFileSync: fsMod.readFileSync };
    const onTarget = (p) => typeof p === 'string' && resolve(p) === target;
    // Patched on the fs module and synced into the ESM bindings serveBundle imported, then
    // restored in finally, so no other case in this file sees the recording wrappers.
    fsMod.existsSync = function (p, ...a) { if (onTarget(p)) seen.push('exists'); return real.existsSync.call(this, p, ...a); };
    fsMod.statSync = function (p, ...a) { if (onTarget(p)) seen.push('stat'); return real.statSync.call(this, p, ...a); };
    fsMod.readFileSync = function (p, ...a) { if (onTarget(p)) seen.push('read'); return real.readFileSync.call(this, p, ...a); };
    syncBuiltinESMExports();
    const server = serveBundle(dir);
    try {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const res = await fetch(`http://127.0.0.1:${server.address().port}/assets/a.bin`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'x');
      assert.deepEqual(seen, ['read'], `the file was looked at before it was read: ${seen.join(' -> ')}`);
    } finally {
      server.close();
      Object.assign(fsMod, real);
      syncBuiltinESMExports();
    }
  });

  test('it serves index.html for the root, 404s what is absent, and refuses to escape the bundle', async () => {
    const dir = bundle({ 'index.html': '<html>hi</html>', 'assets/a.bin': 'x' });
    const seenRequests = [];
    const server = serveBundle(dir, (r) => seenRequests.push(r));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal(await (await fetch(`${base}/index.html`)).text(), '<html>hi</html>');
      assert.equal((await fetch(`${base}/assets/a.bin`)).status, 200);
      assert.equal((await fetch(`${base}/missing.png`)).status, 404);
      // The 404 is REPORTED, not merely returned: that report is the whole of
      // the "declared asset is not in the bundle" limb.
      assert.ok(seenRequests.some((r) => r.status === 404 && r.path === '/missing.png'), JSON.stringify(seenRequests));
      // CONTAINMENT, asserted POSITIVELY. The same name exists both inside the
      // bundle and one level above it, so the answer distinguishes the two: a
      // traversal that escaped would return the outside file. Asserting a 403
      // instead would pass for the wrong reason — the traversal is collapsed
      // before any rejection could fire, so "403 or 404" is satisfied by a
      // server with no containment at all.
      writeFileSync(join(dir, '..', 'outside.txt'), 'ESCAPED');
      writeFileSync(join(dir, 'outside.txt'), 'INSIDE');
      const escape = await fetch(`${base}/..%2foutside.txt`);
      assert.equal(escape.status, 200);
      assert.equal(await escape.text(), 'INSIDE', 'a `..` in the request escaped the bundle directory');
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE BUNDLE IS SERVED AT ITS OWN BASE PATH — ADDED 2026-09-09 [ADR 075].
//
// THE REAL NEGATIVE TEST RAN IN PRODUCTION FIRST, and is the reason these exist:
// the merge that moved the app to `nikatru.com/<id>` built it with
// `--base-href /subscriptiontracker/`, this smoke served it at `/`, and the run FAILED with
// "404 /subscriptiontracker/flutter_bootstrap.js, 404 /subscriptiontracker/manifest.json — the artifact
// never reached flutter-first-frame". The bundle was correct and the harness was
// wrong, and it refused to publish — which is the harness working. The fix is
// not to relax it: it is to serve the artifact where the deploy will.
//
// The prefix is READ OUT OF THE ARTIFACT, so the smoke cannot be told a lie
// about where the bundle belongs, and a bundle with no <base> keeps the old
// root-mounted behaviour exactly.
describe('smoke-web-artifact.mjs — a bundle compiled for a path is served at that path', () => {
  test('basePrefix reads <base href> out of the artifact, and defaults to / safely', () => {
    assert.equal(basePrefix(bundle({ 'index.html': '<html><head><base href="/subscriptiontracker/"></head></html>' })), '/subscriptiontracker/');
    // No trailing slash in the tag, and no leading one: still normalised to /x/.
    assert.equal(basePrefix(bundle({ 'index.html': '<html><head><base href="subscriptiontracker"></head></html>' })), '/subscriptiontracker/');
    assert.equal(basePrefix(bundle({ 'index.html': '<html><head><base href="/"></head></html>' })), '/');
    assert.equal(basePrefix(bundle({ 'index.html': '<html><head></head></html>' })), '/');
    // An ABSOLUTE base href yields `/`: this server is loopback and cannot honour
    // a foreign origin, so mounting under it would test a deploy nobody makes.
    assert.equal(basePrefix(bundle({ 'index.html': '<html><head><base href="https://x.example/y/"></head></html>' })), '/');
    // A bundle with no index.html at all is not a crash — the entry-file limb
    // above is what reports that, and it reports it better.
    assert.equal(basePrefix(bundle({})), '/');
  });

  test('stripBasePrefix maps a request into the bundle, and refuses what is outside it', () => {
    assert.equal(stripBasePrefix('/subscriptiontracker/flutter_bootstrap.js', '/subscriptiontracker/'), '/flutter_bootstrap.js');
    assert.equal(stripBasePrefix('/subscriptiontracker/', '/subscriptiontracker/'), '/');
    // The bare prefix, which is what a browser asks for before the 301.
    assert.equal(stripBasePrefix('/subscriptiontracker', '/subscriptiontracker/'), '/');
    // 🔴 THE ONE THAT MATTERS: a path outside the base is NOT quietly served
    // from the bundle root. If it were, this smoke would pass a bundle whose
    // base href is wrong for where it is published — the exact defect the live
    // failure was.
    assert.equal(stripBasePrefix('/flutter_bootstrap.js', '/subscriptiontracker/'), null);
    assert.equal(stripBasePrefix('/subscriptiontrackerx/a.js', '/subscriptiontracker/'), null);
  });

  test('the server mounts a path-based bundle under its prefix, and 404s outside it', async () => {
    const dir = bundle({
      'index.html': '<html><head><base href="/subscriptiontracker/"></head></html>',
      'flutter_bootstrap.js': 'console.log(1);',
    });
    const server = serveBundle(dir);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(`${base}/subscriptiontracker/`)).status, 200);
      // The exact request that 404'd in the live run.
      assert.equal((await fetch(`${base}/subscriptiontracker/flutter_bootstrap.js`)).status, 200);
      // GREEN CONTROL for the negative: at the root it is gone, as the edge
      // would answer, so a wrong base href still fails this smoke.
      assert.equal((await fetch(`${base}/flutter_bootstrap.js`)).status, 404);
    } finally {
      server.close();
    }
  });

  test('a root-mounted bundle is unchanged — the old behaviour is not disturbed', async () => {
    const dir = bundle({ 'index.html': '<html><head><base href="/"></head></html>', 'main.dart.js': 'x' });
    const server = serveBundle(dir);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal((await fetch(`${base}/main.dart.js`)).status, 200);
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE BUNDLE BOOTS UNDER ITS OWN CONTENT-SECURITY-POLICY — ADDED 2026-09-24.
//
// Row O-WEB-CSP-HAND-LIST-UNSMOKED. Until this date the smoke served the bundle
// with no header but content-type, so every red control below exited 0 at the
// parent commit, measured against the same fixture copies: the API origin gone
// from connect-src (RC1), 'wasm-unsafe-eval' gone from script-src (RC2), and no
// _headers at all (RC3). The policy each case boots under is the app's own file,
// read at test time, so the fixture carries no copy of it.
// ─────────────────────────────────────────────────────────────────────────────

/** The fixture bundle, copied, with `headers` as its `_headers` (none when null). */
function cspBundle(headers) {
  const dir = join(TMP, `b${seq++}`);
  cpSync(FIXTURE, dir, { recursive: true });
  if (headers !== null) writeFileSync(join(dir, '_headers'), headers);
  return dir;
}

/** The app's `_headers` with ONE edit to its policy line. Refuses when `from` is
 *  not on that line, so a moved seam fails here instead of mutating nothing. */
function appHeadersWith(from, to) {
  const lines = APP_HEADERS.split('\n');
  const i = lines.findIndex((l) => /^\s+Content-Security-Policy:/.test(l));
  assert.ok(i >= 0 && lines[i].includes(from), `the seam moved: the app's policy line has no \`${from}\``);
  lines[i] = lines[i].replace(from, to);
  return lines.join('\n');
}

describe('smoke-web-artifact.mjs — the bundle is served under its own _headers', () => {
  test("the parser reads the app's own _headers: the page gets the CSP line verbatim, and every matching rule applies", () => {
    assert.ok(APP_CSP, 'apps/subscriptiontracker/web/_headers has no Content-Security-Policy line to compare against');
    const rules = parseHeadersFile(APP_HEADERS);
    const page = headersFor(rules, '/');
    assert.equal(headerValue(page, 'content-security-policy'), APP_CSP);
    // `/` matches BOTH `/*` (the security headers) and `/` (the cache rule), as it does at the edge.
    assert.equal(headerValue(page, 'cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(headerValue(headersFor(rules, '/canvaskit/canvaskit.wasm'), 'content-security-policy'), APP_CSP);
    assert.equal(headerValue(headersFor(rules, '/canvaskit/canvaskit.wasm'), 'cache-control'), 'public, max-age=0, must-revalidate');
  });

  test('two rules setting one header are joined with a comma, a placeholder spans one segment, and a line it cannot model throws with its number', () => {
    const rules = parseHeadersFile('# a comment\n/*\n  X-A: one\n\n/:id/app.js\n  X-A: two\n');
    assert.equal(headersFor(rules, '/x/app.js')['X-A'], 'one, two');
    assert.equal(headersFor(rules, '/x/y/app.js')['X-A'], 'one');
    assert.deepEqual(headersFor(rules, 'nothing-matches'), {});
    assert.throws(() => parseHeadersFile('  X-A: one\n'), /_headers:1 is a header line before any path pattern/);
    assert.throws(() => parseHeadersFile('/*\n  ! X-A\n'), /_headers:2 is not a `Name: value` header line/);
    assert.throws(() => parseHeadersFile('https://x.pages.dev/*\n  X-A: one\n'), /_headers:1 is not a path pattern/);
  });

  test('serveBundle sends the rules for the path RELATIVE to the bundle, under its base prefix', async () => {
    const dir = cspBundle(APP_HEADERS);
    const server = serveBundle(dir);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await fetch(`${base}/subscriptiontracker/`);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get('content-security-policy'), APP_CSP);
      assert.equal(page.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
      const boot = await fetch(`${base}/subscriptiontracker/flutter_bootstrap.js`);
      assert.equal(boot.headers.get('content-security-policy'), APP_CSP);
      // Outside the base path is not the app's project at all: a 404 with no policy of its own.
      const outside = await fetch(`${base}/flutter_bootstrap.js`);
      assert.equal(outside.status, 404);
      assert.equal(outside.headers.get('content-security-policy'), null);
    } finally {
      server.close();
    }
  });

  test('RC3 — a bundle with no _headers is COVERAGE LOST (exit 2), before any browser is launched', () => {
    const r = run([cspBundle(null), '--connect', API, '--chrome', join(TMP, 'no-such-chrome')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /carries no _headers/);
    assert.doesNotMatch(r.out, /no headless Chrome could be started/, 'the policy must be refused before a browser is tried');
  });

  test('a _headers that puts no CSP on the page is COVERAGE LOST too — a boot under no policy proves nothing', () => {
    const r = run([cspBundle('/*\n  X-Frame-Options: DENY\n'), '--chrome', join(TMP, 'no-such-chrome')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no rule in .* puts a Content-Security-Policy on the page/);
  });

  test('a _headers line the smoke cannot model is COVERAGE LOST, naming the line', () => {
    const r = run([cspBundle(`${MINIMAL_HEADERS}  ! X-Frame-Options\n`), '--chrome', join(TMP, 'no-such-chrome')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /_headers:3 is not a `Name: value` header line/);
  });

  test('a --connect value that is not an https URL is refused, and the value itself is never printed', () => {
    const r = run([cspBundle(APP_HEADERS), '--connect', 'http://SECRETKEY@glitchtip.example/1', '--chrome', join(TMP, 'no-such-chrome')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /--connect value\(s\) #1 are not https:\/\/ URLs/);
    assert.doesNotMatch(r.out, /SECRETKEY/);
  });

  test("probeOrigin keeps the origin only: a DSN's key and path never reach the probe", () => {
    assert.equal(probeOrigin('https://SECRETKEY@glitchtip.nikatru.com/4'), 'https://glitchtip.nikatru.com');
    assert.equal(probeOrigin(`${API}/v1/things?x=1`), API);
    assert.equal(probeOrigin('http://subscriptiontracker-api.nikatru.com'), null);
    assert.equal(probeOrigin(''), null);
    assert.equal(probeOrigin('not a url'), null);
  });

  test('the violation listener hands each violation to the binding it is registered under', () => {
    // The same silent failure as a ready signal whose halves disagree: a listener
    // calling a name the harness never bound reports nothing, which reads as "no violation".
    assert.match(CSP_VIOLATION.install, /addEventListener\('securitypolicyviolation'/);
    assert.ok(CSP_VIOLATION.install.includes(`window.${CSP_VIOLATION.binding}(JSON.stringify(`), CSP_VIOLATION.install);
    assert.match(CSP_VIOLATION.install, /effectiveDirective/);
    assert.match(CSP_VIOLATION.install, /blockedURI/);
  });
});

/** The first Chrome this machine has, found the way the smoke finds one. */
const CHROME =
  [process.env.CHROME_EXECUTABLE, 'google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']
    .filter(Boolean)
    .find((bin) => spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 }).status === 0) ?? null;

/** True when a browser case can run. Skips where no Chrome exists; FAILS in GitHub Actions. */
function needChrome(t) {
  if (CHROME) return true;
  assert.notEqual(
    process.env.GITHUB_ACTIONS,
    'true',
    'no Chrome was found on a GitHub runner, whose image ships one: the CSP limb would go untested and read as a pass',
  );
  t.skip('no Chrome on this machine (set CHROME_EXECUTABLE to run the CSP cases)');
  return false;
}

/** The smoke, run WITHOUT blocking this process: the recording proxy below lives in it. */
const runAsync = (args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [SMOKE, ...args]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => done({ code, out }));
  });

/**
 * The smoke in a real Chrome whose every NON-loopback request is routed to a
 * recording proxy here, which notes the host:port it was asked for and refuses
 * it. A request that leaves the browser therefore arrives at `seen`; Chrome never
 * proxies loopback, so the bundle itself is still served direct. The proxy is set
 * by a wrapper script (`--chrome` replaces the binary), so on Windows, where a
 * shell wrapper cannot be spawned, `seen` is null and the proof cases skip.
 */
async function smokeInChrome(dir, extra = []) {
  const args = [dir, '--timeout-ms', '30000', ...extra];
  if (process.platform === 'win32') return { ...(await runAsync([...args, '--chrome', CHROME])), seen: null };
  const seen = [];
  const proxy = createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(403);
    res.end();
  });
  proxy.on('connect', (req, socket) => {
    seen.push(req.url);
    // Chrome may reset a refused tunnel; unhandled, that reset would fail the case that caused it.
    socket.on('error', () => {});
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  proxy.on('clientError', (e, socket) => socket.destroy());
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const wrapper = join(TMP, `chrome-${seq++}.sh`);
  const quoted = `'${CHROME.replaceAll("'", "'\\''")}'`;
  writeFileSync(wrapper, `#!/bin/sh\nexec ${quoted} --proxy-server=http://127.0.0.1:${proxy.address().port} "$@"\n`);
  chmodSync(wrapper, 0o755);
  try {
    return { ...(await runAsync([...args, '--chrome', wrapper])), seen };
  } finally {
    proxy.close();
  }
}

describe("smoke-web-artifact.mjs — in Chrome, the fixture boots under the app's own policy", () => {
  test('RC4 — a listed --connect origin passes, and the probe request never left the browser', { timeout: 90000 }, async (t) => {
    if (!needChrome(t)) return;
    const r = await smokeInChrome(cspBundle(APP_HEADERS), ['--connect', API]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {3}no Content-Security-Policy violation/);
    assert.match(r.out, /ok {3}connect-src allows https:\/\/subscriptiontracker-api\.nikatru\.com — fetched from the page, paused and answered here/);
    if (r.seen === null) return t.skip('the no-egress half needs a shell wrapper for Chrome, which Windows cannot spawn');
    assert.deepEqual(r.seen.filter((u) => hostOf(u) === API_HOST), [], `the probe reached the network: ${r.seen.join(', ')}`);
  });

  test('GREEN CONTROL for RC4 — a request the probe does NOT intercept does arrive at the recording proxy', { timeout: 90000 }, async (t) => {
    // Without this, "the proxy saw nothing" would hold for a proxy Chrome never used.
    // The fixture's boot is given one fetch to a host its policy allows and no
    // --connect names, so nothing intercepts it: it must be SEEN, and refused there.
    if (!needChrome(t)) return;
    if (process.platform === 'win32') return t.skip('needs the shell wrapper for Chrome');
    const dir = cspBundle(APP_HEADERS);
    const boot = readFileSync(join(dir, 'flutter_bootstrap.js'), 'utf8');
    const ready = "  window.dispatchEvent(new Event('flutter-first-frame'));";
    assert.ok(boot.includes(ready), 'the seam moved: the fixture no longer dispatches the ready signal on its own line');
    writeFileSync(
      join(dir, 'flutter_bootstrap.js'),
      boot.replace(ready, `  try { await fetch('https://config.nikatru.com/leak-control', { mode: 'no-cors' }); } catch (e) { /* refused by the proxy */ }\n${ready}`),
    );
    const r = await smokeInChrome(dir, ['--connect', API]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.seen.some((u) => u === 'config.nikatru.com:443'), `the recording proxy saw: ${r.seen.join(', ') || 'nothing'}`);
    assert.deepEqual(r.seen.filter((u) => hostOf(u) === API_HOST), []);
  });

  test("RC1 — the API origin removed from connect-src fails the probe, naming the directive and the origin", { timeout: 90000 }, async (t) => {
    if (!needChrome(t)) return;
    const r = await smokeInChrome(cspBundle(appHeadersWith(` ${API}`, '')), ['--connect', API]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /refused a --connect origin: connect-src refused https:\/\/subscriptiontracker-api\.nikatru\.com/);
  });

  test("RC2 — 'wasm-unsafe-eval' removed from script-src fails the BOOT, before the ready signal counts", { timeout: 90000 }, async (t) => {
    if (!needChrome(t)) return;
    const r = await smokeInChrome(cspBundle(appHeadersWith(" 'wasm-unsafe-eval'", '')), ['--connect', API]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /broke its own Content-Security-Policy while it booted: script-src refused wasm-eval/);
    assert.doesNotMatch(r.out, /ok {3}flutter-first-frame reached/);
  });

  test('blob: removed from worker-src fails the boot — the second engine clause the fixture exercises', { timeout: 90000 }, async (t) => {
    if (!needChrome(t)) return;
    const r = await smokeInChrome(cspBundle(appHeadersWith("worker-src 'self' blob:", "worker-src 'self'")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /broke its own Content-Security-Policy while it booted: worker-src refused blob/);
  });
});

describe("deploy-web.yml — the pre-publication smoke probes the build's derived connect origins", () => {
  test('the smoke step takes its --connect flags from the connect-src compare, and hand-passes no define', () => {
    // Without the flags the probe silently probes nothing: the smoke prints a
    // `--` note and exits 0. ⏱ 2026-09-25 — the three hand-passed defines are
    // gone: tooling/web/connect-origins.mjs emits the set it compared with
    // connect-src, and tooling/ci/test/connect-origins.test.mjs holds that step.
    const wf = parseWorkflow(ROOT, '.github/workflows/deploy-web.yml');
    assert.ok(wf, 'deploy-web.yml was not found');
    const steps = [...wf.jobs.values()].flatMap((j) => workflowSteps(j));
    const smoke = steps.find((s) => s.run?.text.includes('node tooling/smoke/smoke-web-artifact.mjs'));
    assert.ok(smoke, 'deploy-web.yml no longer runs the launch smoke');
    assert.match(smoke.run.text, /\$\{\{ steps\.connect\.outputs\.connect \}\}/);
    assert.doesNotMatch(smoke.run.text, /--connect\b/);
    assert.equal(smoke.env.size, 0, `the smoke step needs no secret now: ${[...smoke.env.keys()].join(', ')}`);
  });
});
