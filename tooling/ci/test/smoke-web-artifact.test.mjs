// ─────────────────────────────────────────────────────────────────────────────
// smoke-web-artifact.test.mjs — the LAUNCH SMOKE itself must be able to fail.
//
// ⚠️ THE REAL ARTIFACT IS THE FIRST NEGATIVE TEST, and it was run. Against a
// genuine `flutter build web --release --pwa-strategy=none` of apps/subly on
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
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE = join(ROOT, 'tooling', 'smoke', 'smoke-web-artifact.mjs');
const { READY_SIGNAL, mimeFor, serveBundle } = await import(`file://${SMOKE.replaceAll('\\', '/')}`);

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
