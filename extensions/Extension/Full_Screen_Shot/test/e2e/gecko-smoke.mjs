/* ============================================================================
   gecko-smoke.mjs — the Firefox add-on, run in Firefox (2026-09-24,
   O-FIREFOX-BUILD-NEVER-RUN-IN-A-BROWSER limb 2).

   Until this file, nothing had ever loaded FullShot's Firefox package into a
   Firefox: web-ext lint reads it, verify-firefox-package.node.js greps it, and
   test/background-sim.firefox.node.js models it in node. This installs the
   PACKED Firefox tree (packed-lib.mjs: pack.mjs --target firefox plus the one
   asserted delta) into a real Firefox over WebDriver BiDi (bidi-lib.mjs) and
   asks the questions only a browser answers:
     · does Firefox accept the add-on (webExtension.install), under the id the
       manifest pins;
     · does background.js load — the worker router answers DIAGNOSTIC_BUNDLE
       from a page, naming Firefox, which needs pages/db.js and pages/batch.js
       loaded through background.scripts and no importScripts thrown;
     · does every page open under the inherited CSP (G8) with its stylesheet
       APPLIED (a computed style, not a <link> present), no CSP violation and
       no uncaught error.

   STOPS, EXIT 2 (COVERAGE LOST): no Firefox, a Firefox older than 140, or BiDi
   refusing webExtension.install, moz-extension navigation or script. Each means
   this suite could not ask its question, which is not an answer.
   Exit: 0 green · 1 a finding · 2 coverage lost.
   ⏱ 2026-09-25: Firefox 156 refuses moz-extension navigation over BiDi without system access and runs no preload script in a moz-extension document; bidi-lib.mjs grants the access, and a page without the recorder is graded by its loaded stylesheets plus one post-load enforcement check.
   ========================================================================== */
import { packedExtension, coverageLost, PAGE_RECORDER } from './packed-lib.mjs';
import { firefoxVersion, launchFirefox, evalJson, topContext, FIREFOX_BIN } from './bidi-lib.mjs';

const MIN_MAJOR = 140;
const PAGES = [
  /* page, and one rule from its own stylesheet that must be APPLIED */
  { rel: 'popup/popup.html', probe: null },
  { rel: 'pages/options.html', probe: { sel: '.opt', prop: 'flex-wrap', want: 'wrap' } },
  { rel: 'pages/history.html', probe: { sel: '#searchBox', prop: 'flex-basis', want: '220px' } },
  { rel: 'pages/batch.html', probe: { sel: '#bqHint', prop: 'font-size', want: '12px' } }
];
let passes = 0;
const fails = [];
const check = (label, ok, extra) => {
  if (ok) passes++; else fails.push(label + (extra != null ? '  — ' + extra : ''));
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
};

const v = firefoxVersion();
if (!v) coverageLost('no Firefox at ' + FIREFOX_BIN + ' (set FS_E2E_FIREFOX); the Gecko suites cannot run');
console.log('firefox: ' + v.text);
if (v.major < MIN_MAJOR) coverageLost('Firefox ' + v.major + ' is older than ' + MIN_MAJOR);

const ext = packedExtension('firefox');
const addonId = ext.packedManifest.browser_specific_settings.gecko.id;
const ff = await launchFirefox({ addonId }).catch(e => coverageLost('Firefox did not start a BiDi session: ' + e.message));
let exitCode = 0;
try {
  console.log('browserVersion (BiDi): ' + (ff.capabilities.browserVersion || '?'));
  const errors = [];
  ff.on('log.entryAdded', e => { if (e.level === 'error') errors.push((e.source && e.source.context) + ' ' + e.text); });
  await ff.send('session.subscribe', { events: ['log.entryAdded'] });

  let installed;
  try { installed = await ff.send('webExtension.install', { extensionData: { type: 'path', path: ext.dir } }); }
  catch (e) { coverageLost('webExtension.install refused the packed Firefox tree: ' + e.message); }
  check('Firefox installs the packed add-on under the id the manifest pins', installed && installed.extension === addonId,
    JSON.stringify(installed));

  await ff.send('script.addPreloadScript', { functionDeclaration: '() => {' + PAGE_RECORDER + '}' });
  const ctx = await topContext(ff);
  const base = 'moz-extension://' + ff.uuid + '/';

  for (const p of PAGES) {
    try { await ff.send('browsingContext.navigate', { context: ctx, url: base + p.rel, wait: 'complete' }); }
    catch (e) { coverageLost('moz-extension navigation to ' + p.rel + ' was refused: ' + e.message); }
    await new Promise(r => setTimeout(r, 1000));
    let st;
    try {
      st = await evalJson(ff, ctx, '(() => ({ href: location.href, rec: window.__fsRec || null, ' +
        'css: [...document.styleSheets].map(s => s.href || "inline"), ' +
        'sheets: [...document.querySelectorAll("link[rel=stylesheet]")].map(l => ({ href: l.getAttribute("href"), rules: l.sheet ? l.sheet.cssRules.length : 0 })), ' +
        'probe: ' + (p.probe ? '(() => { const el = document.querySelector(' + JSON.stringify(p.probe.sel) + '); return el ? getComputedStyle(el).getPropertyValue(' + JSON.stringify(p.probe.prop) + ') : null; })()' : 'null') +
        ' }))()');
    } catch (e) { coverageLost('script.evaluate was refused on ' + p.rel + ': ' + e.message); }
    check(p.rel + ' opened at its moz-extension URL', st.href === base + p.rel, st.href);
    if (!st.rec) {
      console.log('  NOTE  ' + p.rel + ': no BiDi preload script runs in a moz-extension document, so its load-time CSP events and network-API calls are not observable here (network-audit grades those on Chromium)');
      check(p.rel + ': every stylesheet it links loaded under the inherited CSP', st.sheets.length > 0 && st.sheets.every(s => s.rules > 0), JSON.stringify(st.sheets));
    } else {
      check(p.rel + ' raised no CSP violation under the inherited policy', st.rec.csp.length === 0, JSON.stringify(st.rec.csp));
      check(p.rel + ' made no network-API call', st.rec.net.length === 0, JSON.stringify(st.rec.net));
    }
    if (p.probe) {
      check(p.rel + ': its own stylesheet is APPLIED (' + p.probe.sel + ' ' + p.probe.prop + ')', st.probe === p.probe.want,
        'computed ' + JSON.stringify(st.probe) + ', sheets ' + st.css.join(' '));
    }
  }

  /* The background, through the router every page already talks to. */
  let diag;
  try {
    diag = await evalJson(ff, ctx, 'chrome.runtime.sendMessage({ type: "DIAGNOSTIC_BUNDLE" }).then(r => ({ ok: true, browser: r && r.bundle && r.bundle.browser, version: r && r.bundle && r.bundle.version }), e => ({ ok: false, error: String(e && e.message || e) }))');
  } catch (e) { coverageLost('script.evaluate was refused for the background probe: ' + e.message); }
  check('background.js loaded in Firefox and its router answers a page', diag.ok === true, JSON.stringify(diag));
  check('...naming Firefox, as a name and a number', diag.ok && /^Firefox \d+$/.test(String(diag.browser)), String(diag.browser));
  check('...and the version the packed manifest carries', diag.ok && diag.version === ext.packedManifest.version,
    diag.version + ' vs ' + ext.packedManifest.version);

  /* The inherited policy is IN FORCE in Gecko (G8): an inline <style> added after load is refused. */
  let enf;
  try {
    await ff.send('browsingContext.navigate', { context: ctx, url: base + 'pages/options.html', wait: 'complete' });
    enf = await evalJson(ff, ctx, '(async () => { const seen = []; document.addEventListener("securitypolicyviolation", e => seen.push(e.effectiveDirective || e.violatedDirective), true); ' +
      'const s = document.createElement("style"); s.textContent = "body { outline: 7px solid rgb(1, 2, 3) !important; }"; document.head.appendChild(s); ' +
      'await new Promise(r => setTimeout(r, 500)); return { applied: getComputedStyle(document.body).outlineColor === "rgb(1, 2, 3)", seen }; })()');
  } catch (e) { coverageLost('the CSP enforcement probe could not run: ' + e.message); }
  check('the inherited CSP is IN FORCE in Firefox: an inline <style> is refused', enf.applied === false && enf.seen.some(d => /^style-src/.test(d)), JSON.stringify(enf));

  check('no uncaught error was logged by any extension context', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
  exitCode = fails.length ? 1 : 0;
  console.log('\n' + passes + ' pass · ' + fails.length + ' fail');
  if (fails.length) console.log('FINDINGS:\n  ' + fails.join('\n  '));
} catch (e) {
  console.log('COVERAGE LOST — the Gecko smoke did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ff.close();
}
process.exit(exitCode);
