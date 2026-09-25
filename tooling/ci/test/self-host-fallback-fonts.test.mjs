// self-host-fallback-fonts.test.mjs — the web app's CanvasKit and text fallback
// fonts come from its own origin, and a bundle that would reach Google's CDN at
// runtime is refused before it is deployed.
//
// Two halves:
//   · the script, on synthetic build directories (hermetic: `--source` reads a
//     local mirror, nothing is fetched);
//   · the tree — the three edits that make the egress closed (build flag,
//     bootstrap config, CSP) and the workflow wiring that runs the script before
//     the pre-publication smoke. Restoring any one of them turns a test here RED.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'web', 'self-host-fallback-fonts.mjs');
const { extractFallbackPaths, inspectBootstrap, carriesCanvasKitCdnDefault, FONT_PATH, FONT_FALLBACK_BASE_URL } = await import(
  new URL(`file:///${SCRIPT.replace(/\\/g, '/')}`).href
);

const ROBOTO = 'roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2';
const SYMBOLS = 'notosanssymbols2/v24/I_uyMoGduATTei9eI8daxVHDyfisHr71ypPqfX71-AI.woff2';
const GOOD_BOOT =
  '_flutter.buildConfig = {"engineRevision":"abc","useLocalCanvasKit":true,"builds":[]};\n' +
  '_flutter.loader.load({\n  config: {\n    fontFallbackBaseUrl: "fallback-fonts/",\n  },\n});\n';
const GOOD_MAIN = `r($,"a","b",()=>A.ez().gabG()+"${ROBOTO}")\nB.x=s([A.N("Noto Sans Symbols 2","${SYMBOLS}")]);\nreturn(s==null?"canvaskit/":s)+a`;
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Third-party CDN hosts the web app must never let a browser reach. Compared as exact hostnames. */
const FORBIDDEN_HOSTS = ['www.gstatic.com', 'fonts.gstatic.com', 'browser.sentry-cdn.com'];
/** The hostnames a CSP line allows, parsed from each source that carries a scheme. */
function cspHosts(line) {
  const value = line.slice(line.indexOf(':') + 1);
  const hosts = [];
  for (const token of value.split(/[\s;]+/)) {
    if (!token.includes('://')) continue;
    try {
      hosts.push(new URL(token).hostname);
    } catch {
      /* a keyword, not a URL */
    }
  }
  return hosts;
}

function fixture({ main = GOOD_MAIN, boot = GOOD_BOOT, canvaskit = true, lockFiles, sourceBytes } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'w5-fonts-'));
  const build = join(root, 'build');
  const source = join(root, 'source');
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'main.dart.js'), main);
  writeFileSync(join(build, 'flutter_bootstrap.js'), boot);
  if (canvaskit) {
    mkdirSync(join(build, 'canvaskit'));
    writeFileSync(join(build, 'canvaskit', 'canvaskit.wasm'), 'wasm');
  }
  const bytes = sourceBytes ?? { [ROBOTO]: Buffer.from('roboto-bytes'), [SYMBOLS]: Buffer.from('symbols-bytes') };
  for (const [p, b] of Object.entries(bytes)) {
    mkdirSync(dirname(join(source, p)), { recursive: true });
    writeFileSync(join(source, p), b);
  }
  const files =
    lockFiles ??
    Object.fromEntries(
      [ROBOTO, SYMBOLS].map((p) => {
        const b = p === ROBOTO ? Buffer.from('roboto-bytes') : Buffer.from('symbols-bytes');
        return [p, { sha256: sha(b), bytes: b.length }];
      }),
    );
  const lock = join(root, 'lock.json');
  writeFileSync(lock, JSON.stringify({ files }));
  return { root, build, source, lock };
}

function run(fx, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, fx.build, '--lock', fx.lock, '--source', fx.source, ...extra], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('self-host-fallback-fonts — the script', () => {
  test('a well-formed bundle gets every fallback font placed under fallback-fonts/, byte-identical to the lock', () => {
    const fx = fixture();
    try {
      const r = run(fx);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /ok {2}2 fallback font\(s\)/);
      assert.equal(readFileSync(join(fx.build, 'fallback-fonts', ROBOTO), 'utf8'), 'roboto-bytes');
      assert.equal(readFileSync(join(fx.build, 'fallback-fonts', SYMBOLS), 'utf8'), 'symbols-bytes');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('a font whose bytes differ from the lock is refused and NOT written', () => {
    const fx = fixture({ sourceBytes: { [ROBOTO]: Buffer.from('tampered'), [SYMBOLS]: Buffer.from('symbols-bytes') } });
    try {
      const r = run(fx);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /roboto\/v32\/KFOmCnqEu92Fr1Me4GZLCzYlKw\.woff2: fetched 8 bytes sha256 [0-9a-f]{64}; the lock pins 12 bytes/);
      assert.equal(existsSync(join(fx.build, 'fallback-fonts', ROBOTO)), false);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('a bundle naming a font the lock does not hold (a rolled engine list) fails and names the path', () => {
    const b = Buffer.from('roboto-bytes');
    const fx = fixture({ lockFiles: { [ROBOTO]: { sha256: sha(b), bytes: b.length } } });
    try {
      const r = run(fx);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /1 fallback font path\(s\) in this bundle are not in the lock/);
      assert.ok(r.out.includes(SYMBOLS), r.out);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('a bootstrap that does not pass fontFallbackBaseUrl is refused — the engine would fetch fonts.gstatic.com', () => {
    const fx = fixture({ boot: '_flutter.buildConfig = {"useLocalCanvasKit":true};\n_flutter.loader.load();\n' });
    try {
      const r = run(fx);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /passes fontFallbackBaseUrl null, not "fallback-fonts\/"/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('a bootstrap pointing the fallback at Google explicitly is refused too', () => {
    const fx = fixture({ boot: GOOD_BOOT.replace('"fallback-fonts/"', '"https://fonts.gstatic.com/s/"') });
    try {
      const r = run(fx);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /passes fontFallbackBaseUrl "https:\/\/fonts\.gstatic\.com\/s\/"/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('a build without --no-web-resources-cdn is refused on BOTH of its tells', () => {
    const fx = fixture({
      boot: GOOD_BOOT.replace('"useLocalCanvasKit":true,', ''),
      main: GOOD_MAIN.replace('"canvaskit/"', '"https://www.gstatic.com/flutter-canvaskit/a804b261/"'),
    });
    try {
      const r = run(fx);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /does not set useLocalCanvasKit: true/);
      assert.match(r.out, /main\.dart\.js still carries the CanvasKit CDN default/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST (exit 2) when the bundle names no fallback font at all', () => {
    const fx = fixture({ main: 'return(s==null?"canvaskit/":s)+a' });
    try {
      const r = run(fx);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST/);
      assert.match(r.out, /names ZERO fallback font paths/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST (exit 2) when the extraction finds fonts but not Roboto, the one loaded on every boot', () => {
    const fx = fixture({ main: GOOD_MAIN.replace(`+"${ROBOTO}"`, '') });
    try {
      const r = run(fx);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /none is Roboto/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('the CanvasKit CDN default is recognised as a parsed URL, not a substring', () => {
    assert.equal(carriesCanvasKitCdnDefault('x="https://www.gstatic.com/flutter-canvaskit/a804b261/"'), true);
    assert.equal(carriesCanvasKitCdnDefault('x="canvaskit/"'), false);
    assert.equal(carriesCanvasKitCdnDefault('x="https://evil.example/www.gstatic.com/flutter-canvaskit/"'), false);
    assert.equal(carriesCanvasKitCdnDefault('x="https://www.gstatic.com.evil.example/flutter-canvaskit/"'), false);
  });

  test('--check grades a well-formed bundle WITHOUT fetching or writing a single font', () => {
    const fx = fixture({ sourceBytes: {} }); // the source mirror is EMPTY: any fetch attempt would fail
    try {
      const r = run(fx, ['--check']);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /--check: this bundle passes every grading limb/);
      assert.match(r.out, /nothing was fetched or written/);
      assert.equal(existsSync(join(fx.build, 'fallback-fonts')), false, '--check wrote a font directory');
      // The control: the SAME bundle and the same empty mirror, without --check,
      // is a failure — which is what proves --check skipped the network half
      // rather than the mirror happening to satisfy it.
      const full = run(fx);
      assert.equal(full.code, 1, full.out);
      assert.match(full.out, /not in --source/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('--check still REFUSES a bundle whose bootstrap does not pass fontFallbackBaseUrl', () => {
    const fx = fixture({ boot: '_flutter.buildConfig = {"useLocalCanvasKit":true};\n_flutter.loader.load();\n' });
    try {
      const r = run(fx, ['--check']);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /passes fontFallbackBaseUrl null, not "fallback-fonts\/"/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test('path shape: a lock or bundle path can never climb out of fallback-fonts/', () => {
    assert.ok(FONT_PATH.test(ROBOTO));
    for (const bad of ['../x/v1/a.woff2', 'roboto/v32/../../etc.woff2', 'roboto/v32/.hidden.woff2', 'Roboto/v32/a.woff2', 'roboto/v32/a.js']) {
      assert.equal(FONT_PATH.test(bad), false, bad);
    }
    assert.deepEqual(extractFallbackPaths(`"../x/v1/a.woff2" "${ROBOTO}"`), [ROBOTO]);
  });
});

describe('the tree — the Google CDN is off the web app\'s runtime path', () => {
  const appsWithWeb = readdirSync(join(REPO, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(REPO, 'apps', e.name, 'web', 'index.html')))
    .map((e) => e.name);

  test('the scan reaches at least one Flutter web app (a walk over nothing is not a pass)', () => {
    assert.ok(appsWithWeb.length >= 1, 'no apps/*/web/index.html found');
  });

  test('every Flutter web app ships a bootstrap passing the self-hosted fallback base', () => {
    for (const app of appsWithWeb) {
      const p = join(REPO, 'apps', app, 'web', 'flutter_bootstrap.js');
      assert.ok(existsSync(p), `apps/${app}/web/flutter_bootstrap.js is missing — Flutter would generate one that loads fonts from fonts.gstatic.com`);
      const text = readFileSync(p, 'utf8');
      assert.equal(inspectBootstrap(text).fontFallbackBaseUrl, FONT_FALLBACK_BASE_URL, `apps/${app}/web/flutter_bootstrap.js`);
      assert.ok(text.includes('{{flutter_js}}') && text.includes('{{flutter_build_config}}'), `apps/${app}: the template lost a Flutter token`);
    }
  });

  test('no shipped app Content-Security-Policy lets a browser reach a forbidden third-party CDN host', () => {
    for (const app of appsWithWeb) {
      const csp = readFileSync(join(REPO, 'apps', app, 'web', '_headers'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^\s*Content-Security-Policy\s*:/i.test(l));
      assert.ok(csp.length >= 1, `apps/${app}/web/_headers declares no CSP`);
      const hosts = csp.flatMap(cspHosts);
      assert.ok(hosts.length >= 1, `apps/${app}/web/_headers: no host parsed from the CSP — the parser is reading nothing`);
      for (const h of FORBIDDEN_HOSTS) assert.equal(hosts.includes(h), false, `apps/${app}/web/_headers allows ${h}`);
    }
  });

  test('deploy-web.yml builds with --no-web-resources-cdn and places the fonts after the build and before the smoke', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
    const lines = wf.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
    const build = lines.indexOf('flutter build web --release');
    const flag = lines.indexOf('--no-web-resources-cdn');
    const fonts = lines.indexOf('node tooling/web/self-host-fallback-fonts.mjs apps/${{ matrix.app }}/build/web');
    const smoke = lines.indexOf('node tooling/smoke/smoke-web-artifact.mjs');
    assert.ok(build >= 0 && smoke >= 0, 'build or smoke step not found');
    assert.ok(flag > build && flag < lines.indexOf('--dart-define', build), '--no-web-resources-cdn is not on the release build line');
    assert.ok(fonts > build && fonts < smoke, 'the fonts step must run after the build and before the pre-publication smoke');
    // deploy-web.yml is workflow_call only (D2b-2): what publishes the web unit is lane-map.json deployUnits.
    const webUnit = JSON.parse(readFileSync(join(REPO, 'tooling', 'ci', 'lane-map.json'), 'utf8')).deployUnits['<app>-web'];
    assert.ok(webUnit.includes('tooling/web/**'), "lane-map.json deployUnits['<app>-web'] must include 'tooling/web/**' or editing the script deploys nothing");
  });

  test('the committed lock is well-formed and non-empty', () => {
    const lock = JSON.parse(readFileSync(join(REPO, 'tooling', 'web', 'fallback-fonts.lock.json'), 'utf8'));
    const keys = Object.keys(lock.files);
    assert.ok(keys.length > 100, `lock holds ${keys.length} files`);
    assert.equal(lock.count, keys.length);
    assert.ok(keys.includes(ROBOTO), 'the lock has no Roboto');
    let total = 0;
    for (const k of keys) {
      assert.ok(FONT_PATH.test(k), k);
      assert.match(lock.files[k].sha256, /^[0-9a-f]{64}$/);
      total += lock.files[k].bytes;
    }
    assert.equal(lock.bytes, total);
  });
});

describe('the APP BRICK stamps a bootstrap that satisfies the deploy', () => {
  // ⏱ 2026-09-12. #676 made deploy-web refuse a bundle whose flutter_bootstrap.js
  // does not pass fontFallbackBaseUrl — and the brick stamped no such file, so
  // Flutter generated a default one and the NEXT stamped app's first deploy would
  // have stopped at that step, after the app was published in the catalogue. The
  // tests above scan apps/*/web on an unstamped checkout, so not one of them
  // could see the template. These do, and ci.yml's app-brick job runs the real
  // grading against a real stamp.
  const BRICK_BOOT = join(REPO, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'web', 'flutter_bootstrap.js');
  const APP_BOOT = join(REPO, 'apps', 'subscriptiontracker', 'web', 'flutter_bootstrap.js');
  /** mason's delimiter change plus the brick-only comment it enables, exactly as
   *  mason removes them: `{{=<% %>=}}` then one comment in the CHANGED delimiters. */
  const BRICK_PREAMBLE = /^\{\{=<% %>=\}\}<%!(?:(?!%>)[\s\S])*%>/;

  test('the template ships web/flutter_bootstrap.js at all', () => {
    assert.ok(
      existsSync(BRICK_BOOT),
      'tooling/bricks/app/__brick__/apps/{{app_id}}/web/flutter_bootstrap.js is missing — Flutter would generate a default bootstrap for every stamped app and deploy-web would refuse the bundle',
    );
  });

  test("mason leaves Flutter's two build tokens alone (a plain {{token}} would stamp as an EMPTY STRING)", () => {
    const text = readFileSync(BRICK_BOOT, 'utf8');
    assert.match(text, BRICK_PREAMBLE, 'the template does not open with a mustache delimiter change, so mason would render {{flutter_js}} as an undeclared variable');
    const stamped = text.replace(BRICK_PREAMBLE, '');
    assert.ok(stamped.includes('{{flutter_js}}'), 'the stamped bootstrap would carry no {{flutter_js}} token');
    assert.ok(stamped.includes('{{flutter_build_config}}'), 'the stamped bootstrap would carry no {{flutter_build_config}} token');
  });

  test('what a stamp produces passes the fonts step\'s own bootstrap grading', () => {
    const stamped = readFileSync(BRICK_BOOT, 'utf8').replace(BRICK_PREAMBLE, '');
    assert.equal(inspectBootstrap(stamped).fontFallbackBaseUrl, FONT_FALLBACK_BASE_URL);
  });

  test('template and app do not fork: the stamped bytes are IDENTICAL to apps/subscriptiontracker/web/flutter_bootstrap.js', () => {
    const stamped = readFileSync(BRICK_BOOT, 'utf8').replace(BRICK_PREAMBLE, '');
    assert.equal(stamped, readFileSync(APP_BOOT, 'utf8'), 'the brick template and the app it was derived from have drifted apart');
  });

  test('ci.yml grades the STAMPED probe with the deploy step itself, on a bundle built the deploy way', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const lines = wf.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
    const build = lines.indexOf('flutter build web --pwa-strategy=none --no-web-resources-cdn');
    const check = lines.indexOf('node tooling/web/self-host-fallback-fonts.mjs --check apps/probe/build/web');
    assert.ok(build >= 0, 'the app-brick job no longer builds the stamped probe for web the way deploy-web builds it (--no-web-resources-cdn)');
    assert.ok(check > build, 'the app-brick job must grade the stamped probe with the fonts step AFTER building it');
  });
});
