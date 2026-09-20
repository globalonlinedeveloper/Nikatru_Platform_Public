// capture-fallback-fonts.test.mjs — the Play capture stages the engine's text
// fallback fonts where the `flutter drive -d web-server` dev server will serve
// them, or it stops.
//
// WHY THIS SUITE EXISTS. Between 2026-09-12 and 2026-09-20 every captured store
// frame contained NO TEXT and nothing said so. `web/flutter_bootstrap.js` points
// `fontFallbackBaseUrl` at the relative `fallback-fonts/`, only deploy-web.yml
// ever fills it, and the dev server answers the resulting request with
// `index.html` (HTTP 200, text/html) rather than a 404 — so the engine got HTML
// where Roboto should have been and drew nothing, while the bundled MaterialIcons
// asset under `assets/` kept rendering. A listing asset with no text on it is
// unusable and `assert-listing-assets.mjs` cannot see the defect, because it
// decodes pixels and no guard in this tree reads text in an image.
//
// So the cases below are about the two ways that failure stays SILENT: a font
// that is not placed, and a base URL this module does not actually serve.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

// A dynamic import of an ABSOLUTE path throws ERR_UNSUPPORTED_ESM_URL_SCHEME on
// Windows ("Received protocol 'c:'") — it must be a file:// URL, the same way
// self-host-fallback-fonts.test.mjs does it.
const SCRIPT = join(ROOT, 'tooling', 'store', 'capture-fallback-fonts.mjs');
const { bootstrapPosture, checkStaged, readLock, stagedDirFor, unstageFallbackFonts, CoverageLost } = await import(
  new URL(`file:///${SCRIPT.replace(/\\/g, '/')}`).href
);

/** A throwaway app directory with the given bootstrap contents (or none). */
function appFixture(bootstrap) {
  const dir = mkdtempSync(join(tmpdir(), 'capture-fonts-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  if (bootstrap !== null) writeFileSync(join(dir, 'web', 'flutter_bootstrap.js'), bootstrap);
  return dir;
}

const REAL_BOOTSTRAP = '_flutter.loader.load({\n  config: {\n    fontFallbackBaseUrl: "fallback-fonts/",\n  },\n});\n';

describe('where the fonts are staged', () => {
  test('the staging directory is the dev server\'s last-resort static root, <appDir>/web/', () => {
    // flutter_tools web_asset_server.dart resolves an unmatched request against
    // `<cwd>/web/<requestPath>` and the capture spawns flutter with cwd=appDir.
    // Staging anywhere else is served by nothing.
    assert.equal(stagedDirFor(join('apps', 'x')), join('apps', 'x', 'web', 'fallback-fonts'));
  });

  test('unstaging is safe when nothing was staged, and removes the tree when it was', () => {
    const dir = appFixture(REAL_BOOTSTRAP);
    assert.equal(unstageFallbackFonts(dir), false);
    const staged = stagedDirFor(dir);
    mkdirSync(join(staged, 'roboto', 'v32'), { recursive: true });
    writeFileSync(join(staged, 'roboto', 'v32', 'a.woff2'), 'x');
    assert.equal(unstageFallbackFonts(dir), true);
    assert.equal(existsSync(staged), false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('whether an app needs staging at all, read from its own bootstrap', () => {
  test('a bootstrap passing "fallback-fonts/" needs staging', () => {
    const dir = appFixture(REAL_BOOTSTRAP);
    assert.equal(bootstrapPosture(dir).needsStaging, true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an app with no web/flutter_bootstrap.js needs none', () => {
    const dir = appFixture(null);
    assert.equal(bootstrapPosture(dir).needsStaging, false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a bootstrap that passes no fontFallbackBaseUrl needs none — the engine uses its own default', () => {
    const dir = appFixture('_flutter.loader.load({ config: { useLocalCanvasKit: true } });\n');
    assert.equal(bootstrapPosture(dir).needsStaging, false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an absolute font base URL needs none — that host serves them, not this tree', () => {
    const dir = appFixture('_flutter.loader.load({ config: { fontFallbackBaseUrl: "https://fonts.gstatic.com/s/" } });\n');
    const p = bootstrapPosture(dir);
    assert.equal(p.needsStaging, false);
    assert.match(p.why, /absolute URL/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('🔴 a DIFFERENT relative base is COVERAGE LOST, not a pass', () => {
    // The dangerous shape. Staging writes to one fixed directory; if the
    // bootstrap named another relative path, the fonts would land where nothing
    // looks for them and the capture would go textless again while this module
    // reported success. That must stop the run, not pass it.
    const dir = appFixture('_flutter.loader.load({ config: { fontFallbackBaseUrl: "fonts/" } });\n');
    assert.throws(() => bootstrapPosture(dir), CoverageLost);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the lock is the only source of what gets placed', () => {
  test('a lock entry that is not a plain <family>/v<n>/<file> path is refused', () => {
    // FONT_PATH admits no `/` inside a segment and no leading dot, so a lock
    // entry can never climb out of the staging directory. Asserted here because
    // these paths are joined to a filesystem path.
    const bad = mkdtempSync(join(tmpdir(), 'capture-lock-'));
    const lock = join(bad, 'lock.json');
    writeFileSync(lock, JSON.stringify({ files: { '../../etc/passwd': { bytes: 1, sha256: 'x' } } }));
    assert.throws(() => readLock(lock), CoverageLost);
    rmSync(bad, { recursive: true, force: true });
  });

  test('a lock with no files map is COVERAGE LOST', () => {
    const bad = mkdtempSync(join(tmpdir(), 'capture-lock-'));
    const lock = join(bad, 'lock.json');
    writeFileSync(lock, JSON.stringify({ upstream: 'https://fonts.gstatic.com/s/' }));
    assert.throws(() => readLock(lock), CoverageLost);
    rmSync(bad, { recursive: true, force: true });
  });

  test('the real lock still carries Roboto — the family every text run in these apps falls back to', () => {
    // The apps declare no fonts of their own (the pubspec `fonts:` block is
    // commented out and there is no assets/fonts/), so ALL text depends on this
    // one file. A Flutter upgrade that rolled the list out of the lock would
    // take the text off the store frames again.
    const files = readLock();
    const roboto = Object.keys(files).filter((p) => p.startsWith('roboto/'));
    assert.ok(roboto.length >= 1, `the lock names no roboto/ file; it has ${Object.keys(files).length} entries`);
  });
});

describe('grading an app directory', () => {
  test('an app that needs staging and has nothing staged grades RED and names the count', () => {
    const dir = appFixture(REAL_BOOTSTRAP);
    const r = checkStaged(dir);
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, Object.keys(readLock()).length);
    rmSync(dir, { recursive: true, force: true });
  });

  test('🔴 the LIVE app still asks for a base URL this tree must fill', () => {
    // The positive control against the real tree. If subscriptiontracker's
    // bootstrap stopped redirecting the font base URL, staging would become a
    // no-op and every case above would pass vacuously while the capture quietly
    // depended on reaching Google again.
    const p = bootstrapPosture(join(ROOT, 'apps', 'subscriptiontracker'));
    assert.equal(p.needsStaging, true, `the live bootstrap no longer needs staging: ${p.why}`);
  });
});
