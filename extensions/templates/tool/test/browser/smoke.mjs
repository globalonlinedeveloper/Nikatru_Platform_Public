#!/usr/bin/env node
/* REAL-BROWSER SMOKE — Chromium actually loads this extension.

   Modelled on Full_Screen_Shot/test/e2e/run.mjs, but GENERIC: every tool in this
   family copies this file unchanged and it works with no edits. It reads the
   extension's own manifest.json to find the popup, the options page and the
   icons, so it has nothing tool-specific baked in.

   What it asserts — the seven things a node simulation cannot see:
     1. Chrome ACCEPTS the manifest and the extension loads (registry ENABLED,
        no disable reasons, every declared permission actually recognised)
     2. the service worker registers and reaches "activated" without throwing
     3. the popup HTML opens and renders non-empty visible text
     4. ZERO console errors across worker and pages during load
     5. ZERO network requests leave the browser from the extension — the family's
        central privacy claim, PROVEN instead of asserted
     6. the options page opens and renders
     7. every declared icon file exists on disk AND decodes as a real image

   Run:   node test/browser/smoke.mjs
          HEADFUL=1 node test/browser/smoke.mjs      (watch it happen)
   Env:   SMOKE_EXT_DIR=<dir>      test a different copy (this is how you prove
                                   a check bites — see test/browser/README.md)
          SMOKE_PLAYWRIGHT=<dir>   path to a playwright package or a node_modules
                                   directory, if the search below cannot find one

   Exit code is 0 only when every check passes. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* test/browser/ -> extension root. Nothing else in this file knows where it is. */
const EXT_DIR = path.resolve(process.env.SMOKE_EXT_DIR || path.join(__dirname, '..', '..'));

/* A closed loopback port. Nothing listens there, so the two sentinel fetches
   below cost one instant ECONNREFUSED each and no packet leaves the machine. */
const SENTINEL_PORT = 49222;
const SENTINEL_ARM = 'http://127.0.0.1:' + SENTINEL_PORT + '/smoke-armed-outside';
const SENTINEL_PAGE = 'http://127.0.0.1:' + SENTINEL_PORT + '/smoke-csp-page';
const SENTINEL_SW = 'http://127.0.0.1:' + SENTINEL_PORT + '/smoke-csp-sw';

/* Schemes that never leave the machine. Anything else counts as network. */
const LOCAL_SCHEMES = ['chrome-extension:', 'data:', 'blob:', 'about:', 'chrome:',
  'chrome-untrusted:', 'devtools:'];

let FAILS = 0, TOTAL = 0;
const check = (label, ok, extra) => {
  TOTAL++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
};
const skip = (label, why) => console.log('SKIP  ' + label + (why ? '  — ' + why : ''));
const note = (s) => console.log('      ' + s);

/* ---------------- find Playwright without installing anything ----------------
   A no-build-step family has no node_modules of its own, and 67 tools should not
   each run `npm install`.

   THERE IS ONE FLEET LOCATION, AND IT IS LOOKED AT FIRST: Tools/_playwright/.
   The ancestor-and-sibling walk below still exists as a fallback, but it must
   not be the answer, and this is why: before the fleet location was declared,
   the walk landed on ONE PARTICULAR TOOL's test/e2e/node_modules. Rename that
   tool — which is under review for a store name collision — or delete it, and
   67 browser tiers stop finding Playwright on the same afternoon. Upgrade it
   and 67 tiers silently change behaviour with nothing recording which browser
   build graded which release. The walk also grows with the fleet: 67 tool
   folders times their children, on every run.

   To set the fleet location up once:
     mkdir Tools/_playwright && cd Tools/_playwright
     npm init -y && npm i -D playwright && npx playwright install chromium

   The resolved PATH and the resolved VERSION are both printed on every run, so
   a release can be tied to the browser build that graded it. */
function pwEntry(pkgDir) {
  for (const f of ['index.mjs', 'index.js']) {
    const p = path.join(pkgDir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function probeBase(base) {
  for (const rel of ['node_modules/playwright', 'test/e2e/node_modules/playwright',
    'test/browser/node_modules/playwright']) {
    const dir = path.join(base, ...rel.split('/'));
    const entry = fs.existsSync(dir) && pwEntry(dir);
    if (entry) return entry;
  }
  return null;
}
function childDirs(dir, cap) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name[0] !== '.' && d.name !== 'node_modules')
      .slice(0, cap)
      .map(d => path.join(dir, d.name));
  } catch (_) { return []; }
}
/* The version of the package we settled on, so the run says which browser
   build graded it rather than only where it came from. */
function pwVersion(entry) {
  try {
    const pkg = path.join(path.dirname(entry), 'package.json');
    return 'v' + (JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '?');
  } catch (_) { return 'version unknown'; }
}

/* Tools/_playwright — walk up from test/browser/ looking for a directory named
   `_playwright` beside a tool folder. Named, not positional, so it works
   whether this extension lives in Tools/Extension/<tool>/ or one level deeper. */
function fleetPlaywright() {
  let base = __dirname;
  for (let up = 0; up < 7; up++) {
    const entry = probeBase(path.join(base, '_playwright'));
    if (entry) return entry;
    const next = path.dirname(base);
    if (next === base) break;
    base = next;
  }
  return null;
}

async function loadPlaywright() {
  const tried = [];
  const env = process.env.SMOKE_PLAYWRIGHT;
  if (env) {
    const cands = [env, path.join(env, 'playwright'), path.join(env, 'node_modules', 'playwright')];
    for (const c of cands) {
      const entry = pwEntry(c);
      if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry, version: pwVersion(entry) };
      tried.push(c);
    }
  }
  /* THE FLEET LOCATION, BEFORE ANYTHING ELSE. One install, one version, one
     thing to upgrade. */
  {
    const entry = fleetPlaywright();
    if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry, version: pwVersion(entry), fleet: true };
    tried.push('<ancestor>/_playwright/node_modules/playwright  (the fleet location — see test/browser/README.md)');
  }
  try { return { mod: await import('playwright'), from: 'node resolution (import "playwright")', version: '' }; }
  catch (_) { tried.push('import("playwright")'); }

  let base = __dirname;
  for (let up = 0; up < 7; up++) {
    let entry = probeBase(base);
    if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry, version: pwVersion(entry), stray: true };
    for (const child of childDirs(base, 80)) {          // sibling tools
      entry = probeBase(child);
      if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry, version: pwVersion(entry), stray: true };
      for (const grand of childDirs(child, 40)) {       // tools one folder deeper
        entry = probeBase(grand);
        if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry, version: pwVersion(entry), stray: true };
      }
    }
    tried.push(base);
    const next = path.dirname(base);
    if (next === base) break;
    base = next;
  }
  const err = new Error('Playwright not found. Searched:\n  ' + tried.join('\n  ') +
    '\nSet SMOKE_PLAYWRIGHT=<dir containing node_modules/playwright>, or install it here.');
  err.noPlaywright = true;
  throw err;
}

/* ---------------- manifest reading (all of it generic) ---------------- */
function iconPaths(mf) {
  const out = new Set();
  const eat = (v) => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) if (typeof v[k] === 'string') out.add(v[k]);
  };
  eat(mf.icons);
  if (mf.action) eat(mf.action.default_icon);
  if (mf.browser_action) eat(mf.browser_action.default_icon);
  if (mf.page_action) eat(mf.page_action.default_icon);
  return [...out];
}
/* the declared size for an icon path, when the manifest keyed it by size */
function declaredSizes(mf) {
  const map = new Map();
  const eat = (v) => {
    if (v && typeof v === 'object') for (const k of Object.keys(v)) {
      const n = Number(k);
      if (Number.isFinite(n) && typeof v[k] === 'string' && !map.has(v[k])) map.set(v[k], n);
    }
  };
  eat(mf.icons);
  if (mf.action) eat(mf.action.default_icon);
  if (mf.browser_action) eat(mf.browser_action.default_icon);
  if (mf.page_action) eat(mf.page_action.default_icon);
  return map;
}
function optionsPagePath(mf) {
  if (typeof mf.options_page === 'string') return mf.options_page;
  if (mf.options_ui && typeof mf.options_ui.page === 'string') return mf.options_ui.page;
  return null;
}
/* every string anywhere inside chrome's own permission accounting */
function deepStrings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach(x => deepStrings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => deepStrings(x, acc));
  return acc;
}
const sameDir = (a, b) => {
  const norm = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
  return norm(a).toLowerCase() === norm(b).toLowerCase();
};

/* chrome://extensions-internals is Chrome's own JSON dump of everything it
   loaded — the only place that says what Chrome THINKS of this folder.
   It is served with no charset, so the page decodes it as windows-1252 and
   document.innerText mangles every non-ASCII character (an em dash in the
   extension name comes back as "â€”"). XHR decodes the bytes as UTF-8 and gets
   it right; innerText is kept as the fallback, and the caller is told which was
   used, because a mangled read can only ever break the path match — never the
   ASCII fields the checks depend on. */
async function readInternals(ctx) {
  const p = await ctx.newPage();
  try {
    await p.goto('chrome://extensions-internals', { timeout: 15000 });
    let text = null, how = 'XMLHttpRequest (utf-8)';
    try {
      text = await p.evaluate(() => new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open('GET', location.href);
        x.onload = () => res(x.responseText);
        x.onerror = () => rej(new Error('xhr failed'));
        x.send();
      }));
    } catch (_) {
      text = await p.evaluate(() => document.body.innerText);
      how = 'innerText (windows-1252, non-ASCII may be mangled)';
    }
    return { all: JSON.parse(text), how };
  } finally {
    await p.close().catch(() => {});
  }
}

/* ---------------- main ---------------- */
(async () => {
  console.log('=== real-browser smoke ===');
  console.log('extension  ' + EXT_DIR);

  /* --- static: the manifest must at least be readable before Chrome sees it --- */
  let mf = null;
  try {
    mf = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
    check('manifest.json parses', true, mf.name + ' ' + mf.version);
  } catch (e) {
    check('manifest.json parses', false, String((e && e.message) || e));
    console.log('\n0/1 checks passed\nFAILURES: 1');
    process.exit(1);
  }
  check('manifest_version is 3', mf.manifest_version === 3, 'manifest_version=' + mf.manifest_version);

  const popupRel = (mf.action && mf.action.default_popup) || (mf.browser_action && mf.browser_action.default_popup) || null;
  const optionsRel = optionsPagePath(mf);
  const icons = iconPaths(mf);
  const sizes = declaredSizes(mf);
  check('the extension declares at least one page to render',
    !!(popupRel || optionsRel), 'popup=' + (popupRel || 'none') + ' options=' + (optionsRel || 'none'));

  /* 7a — on disk, before the browser is involved */
  const missing = icons.filter(p => !fs.existsSync(path.join(EXT_DIR, ...p.split('/'))));
  check('every declared icon file exists on disk', icons.length > 0 && missing.length === 0,
    icons.length + ' declared' + (missing.length ? ', MISSING: ' + missing.join(', ') : ''));

  let playwright;
  try {
    const got = await loadPlaywright();
    playwright = got.mod;
    /* PATH AND VERSION, on every run. The path answers "which install graded
       this release"; the version answers "which browser build", which is the
       one you need when a check starts failing and nothing in the extension
       changed. */
    console.log('playwright  ' + got.from + (got.version ? '  ' + got.version : ''));
    if (got.stray) {
      note('NOT the fleet location. This is some other tool\'s node_modules, found by the fallback walk —');
      note('rename or delete that tool and this tier stops working. See test/browser/README.md.');
    }
  } catch (e) {
    console.log('\nCANNOT RUN — ' + e.message);
    process.exit(1);
  }
  const { chromium } = playwright;

  /* --- launch, with every listener attached before anything loads --- */
  const consoleErrors = [];   // {text, url}
  const pageErrors = [];      // uncaught exceptions
  const requests = [];        // {url, from}
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-profile-'));
  /* Chrome's own reason for refusing a folder goes to its log, nowhere else:
     "Failed to load extension from: X. Could not load icon 'icons/icon128.png'".
     Without this the harness can only say the extension did not load; with it,
     it says why. */
  const logFile = path.join(userDataDir, 'chrome-smoke.log');
  const chromeLoadErrors = () => {
    try {
      return fs.readFileSync(logFile, 'utf8').split('\n')
        .filter(l => /Failed to load extension|Extension error/i.test(l))
        .map(l => l.replace(/^.*?Extension error:\s*/i, '').trim())
        .filter(Boolean);
    } catch (_) { return []; }
  };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(userDataDir, {
      /* channel 'chromium' is load-bearing: the default headless build is the
         headless shell, which cannot load extensions at all. */
      channel: 'chromium',
      headless: !process.env.HEADFUL,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-extensions-except=' + EXT_DIR,
        '--load-extension=' + EXT_DIR,
        /* silence the browser's own housekeeping traffic so check 5 is about the
           extension and nothing else */
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        '--metrics-recording-only',
        '--enable-logging',
        '--log-file=' + logFile,
        '--log-level=0'
      ]
    });
  } catch (e) {
    check('Chromium launched with the extension loaded unpacked', false, String((e && e.message) || e));
    console.log('\n' + (TOTAL - FAILS) + '/' + TOTAL + ' checks passed\nFAILURES: ' + FAILS);
    process.exit(1);
  }
  check('Chromium launched with the extension loaded unpacked', true, 'channel=chromium headless=' + !process.env.HEADFUL);

  const originOf = (req) => {
    try { if (req.serviceWorker()) return 'service worker'; } catch (_) {}
    try { const f = req.frame(); return f ? f.url() : 'unknown'; } catch (_) { return 'unknown'; }
  };
  ctx.on('console', (m) => {
    if (m.type() !== 'error') return;
    let url = '';
    try { url = (m.location() && m.location().url) || ''; } catch (_) {}
    consoleErrors.push({ text: m.text(), url });
  });
  ctx.on('weberror', (e) => {
    try { pageErrors.push({ text: String(e.error() && e.error().message || e.error()), url: e.page() ? e.page().url() : '' }); }
    catch (_) { pageErrors.push({ text: 'uncaught error', url: '' }); }
  });
  ctx.on('request', (r) => requests.push({ url: r.url(), from: originOf(r) }));

  let extId = null, chromeMf = null;
  try {
    /* ---- 1. did Chrome accept this folder at all? ----
       Asked FIRST, and it is cheap: when the answer is no there is no point
       waiting 25 seconds for a service worker that is never coming, and the
       load error below says exactly which line of the manifest was wrong. */
    let entry = null;
    const deadlineLoad = Date.now() + 8000;
    for (;;) {
      try {
        const got = await readInternals(ctx);
        entry = got.all.find(e => e.path && sameDir(e.path, EXT_DIR)) ||
          got.all.find(e => e.location === 'COMMAND_LINE') ||
          (extId ? got.all.find(e => e.id === extId) : null);
        if (entry) { note('chrome://extensions-internals read via ' + got.how); break; }
      } catch (e) {
        note('chrome://extensions-internals unavailable: ' + ((e && e.message) || e));
        break;
      }
      if (Date.now() > deadlineLoad || chromeLoadErrors().length) break;
      await new Promise(r => setTimeout(r, 400));
    }
    const loadErrs = chromeLoadErrors();
    check('Chrome loaded the extension from this folder', !!entry,
      entry ? mf.name + ' ' + mf.version + '  id=' + entry.id
        : 'Chrome refused it' + (loadErrs.length ? ' — ' + loadErrs[0] : ' (no reason logged)'));
    check('Chrome logged no extension load errors', loadErrs.length === 0,
      loadErrs.length ? loadErrs.join(' | ') : 'none');
    if (entry) {
      check('Chrome enabled it (no disable reasons)',
        entry.registry_status === 'ENABLED' && (entry.disable_reasons || []).length === 0,
        'registry_status=' + entry.registry_status + ' disable_reasons=' + JSON.stringify(entry.disable_reasons || []));
    } else {
      check('Chrome enabled it (no disable reasons)', false, 'not loaded');
    }

    /* ---- 2. the service worker ---- */
    let sw = ctx.serviceWorkers()[0];
    if (!sw) {
      /* if Chrome never took the folder, do not sit here for 25 seconds */
      try { sw = await ctx.waitForEvent('serviceworker', { timeout: entry ? 25000 : 2000 }); } catch (_) {}
    }
    check('the service worker registered', !!sw,
      sw ? sw.url() : (entry ? 'no service worker appeared in 25s' : 'the extension was never loaded'));

    let state = 'n/a';
    if (sw) {
      /* A worker is handed to us in "activating"; give it a moment to finish.
         If background.js threw on the way, evaluate() is where we find out. */
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        state = await sw.evaluate(() => (self.serviceWorker && self.serviceWorker.state) || 'n/a').catch(e => 'evaluate failed: ' + e.message);
        if (state === 'activated' || String(state).startsWith('evaluate failed')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      check('the service worker reached "activated"', state === 'activated', 'state=' + state);
      extId = await sw.evaluate(() => chrome.runtime.id).catch(() => null);
      /* the manifest as CHROME parsed it — authoritative, and correctly encoded */
      chromeMf = await sw.evaluate(() => chrome.runtime.getManifest()).catch(() => null);

      /* Errors thrown after this point are collected in the worker itself; the
         console listener above covers the startup window before it. */
      await sw.evaluate(() => {
        if (self.__smokeErrors) return;
        self.__smokeErrors = [];
        addEventListener('error', (e) => self.__smokeErrors.push('error: ' + ((e && e.message) || e)));
        addEventListener('unhandledrejection', (e) => self.__smokeErrors.push(
          'unhandledrejection: ' + ((e && e.reason && e.reason.message) || (e && e.reason) || '?')));
      }).catch(() => {});
    } else {
      check('the service worker reached "activated"', false, 'no worker');
    }

    /* ---- 3. what Chrome made of the manifest it accepted ---- */
    /* Compared against chrome.runtime.getManifest(), not the internals dump:
       that is Chrome's own parse, handed back through the extension API.
       A version of "01.02" is not normalised — it is rejected outright — but a
       tool that grows a fifth version component, or a name Chrome truncates,
       shows up right here. */
    if (chromeMf) {
      /* The file on disk says __MSG_appName__; Chrome hands back the RESOLVED
         string. Resolve the placeholder the same way Chrome does — through
         _locales/<default_locale> — so this check keeps comparing the two
         parses instead of going red the day the manifest becomes localisable. */
      const resolveMsg = (s) => String(s == null ? '' : s).replace(/__MSG_([A-Za-z0-9_@]+)__/g, (m, key) => {
        try {
          const cat = JSON.parse(fs.readFileSync(
            path.join(EXT_DIR, '_locales', mf.default_locale || 'en', 'messages.json'), 'utf8'));
          return (cat[key] && cat[key].message) != null ? cat[key].message : m;
        } catch (_) { return m; }
      });
      const wantName = resolveMsg(mf.name);
      check('the name and version Chrome parsed match the file on disk',
        chromeMf.name === wantName && String(chromeMf.version) === String(mf.version),
        JSON.stringify({ name: chromeMf.name, version: chromeMf.version }) +
        (mf.name === wantName ? '' : '  (manifest name is ' + mf.name + ', resolved through _locales)'));
    } else {
      check('the name and version Chrome parsed match the file on disk', false, 'no service worker to ask');
    }
    /* An unrecognised permission is silently dropped: it is in the file, Chrome
       never grants it, and nothing in node can tell. Chrome's own accounting can. */
    if (entry) {
      const granted = new Set(deepStrings(entry.permissions || {}));
      const declared = Array.isArray(mf.permissions) ? mf.permissions : [];
      const unrecognised = declared.filter(p => !granted.has(p));
      check('every declared permission was recognised by Chrome',
        unrecognised.length === 0,
        declared.length ? declared.join(', ') + (unrecognised.length ? '  DROPPED: ' + unrecognised.join(', ') : '') : 'none declared');
      const hosts = [].concat(mf.host_permissions || [], mf.optional_host_permissions || []);
      note('host permissions declared: ' + (hosts.length ? hosts.join(', ') : 'none'));
    } else {
      check('every declared permission was recognised by Chrome', false, 'not loaded');
    }

    if (!extId && entry) extId = entry.id;
    check('the extension has a live origin', !!extId, extId ? 'chrome-extension://' + extId : 'no extension id');
    if (!extId) throw new Error('without an extension id there is nothing left to open');

    /* the packaged manifest is reachable at the extension origin: Chrome mounted it */
    try {
      const p = await ctx.newPage();
      await p.goto('chrome-extension://' + extId + '/manifest.json', { timeout: 15000 });
      const served = await p.evaluate(() => document.body.innerText);
      const parsed = JSON.parse(served);
      check('the packaged manifest is served from the extension origin',
        parsed.name === mf.name && parsed.version === mf.version, 'parsed name+version match');
      await p.close();
    } catch (e) {
      check('the packaged manifest is served from the extension origin', false, String((e && e.message) || e));
    }

    /* ---- 3 / 6. the pages actually render ---- */
    const openPage = async (rel, label) => {
      const url = 'chrome-extension://' + extId + '/' + String(rel).replace(/^\/+/, '');
      const page = await ctx.newPage();
      await page.goto(url, { timeout: 20000, waitUntil: 'load' });
      await page.waitForTimeout(900);          // let async render settle
      const seen = await page.evaluate(() => ({
        text: (document.body && document.body.innerText || '').trim(),
        boxes: [...document.body.querySelectorAll('*')]
          .filter(el => el.getClientRects().length > 0).length,
        height: document.body ? document.body.getBoundingClientRect().height : 0,
        title: document.title
      }));
      const oneLine = seen.text.replace(/\s+/g, ' ').slice(0, 90);
      check(label + ' opens and renders non-empty visible text',
        seen.text.length > 0 && seen.boxes > 0 && seen.height > 0,
        seen.text.length + ' chars, ' + seen.boxes + ' visible elements, ' +
        Math.round(seen.height) + 'px tall — "' + oneLine + '"');
      return page;
    };

    let popupPage = null, optionsPage = null;
    if (popupRel) {
      try { popupPage = await openPage(popupRel, 'the popup (' + popupRel + ')'); }
      catch (e) { check('the popup (' + popupRel + ') opens and renders non-empty visible text', false, String((e && e.message) || e)); }
    } else skip('the popup opens and renders', 'no action.default_popup declared');

    if (optionsRel) {
      try { optionsPage = await openPage(optionsRel, 'the options page (' + optionsRel + ')'); }
      catch (e) { check('the options page (' + optionsRel + ') opens and renders non-empty visible text', false, String((e && e.message) || e)); }
    } else skip('the options page opens and renders', 'no options_page / options_ui.page declared');

    /* ---- 7b. the icons decode as real images, in the browser ---- */
    const host = popupPage || optionsPage;
    if (host && icons.length) {
      const decoded = await host.evaluate(async (list) => {
        const out = [];
        for (const rel of list) {
          out.push(await new Promise((res) => {
            const im = new Image();
            im.onload = () => res({ rel, ok: true, w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = () => res({ rel, ok: false, w: 0, h: 0 });
            im.src = chrome.runtime.getURL(rel);
          }));
        }
        return out;
      }, icons);
      const bad = decoded.filter(d => !d.ok || d.w < 1 || d.h < 1);
      check('every declared icon decodes as a real image', bad.length === 0,
        decoded.map(d => d.rel.split('/').pop() + ' ' + (d.ok ? d.w + 'x' + d.h : 'FAILED TO DECODE')).join(', '));
      const wrong = decoded.filter(d => d.ok && sizes.has(d.rel) && (d.w !== sizes.get(d.rel) || d.h !== sizes.get(d.rel)));
      check('each icon is the size its manifest key claims', wrong.length === 0,
        wrong.length ? wrong.map(d => d.rel + ' is ' + d.w + 'x' + d.h + ', declared ' + sizes.get(d.rel)).join('; ') : 'all match');
    } else if (!icons.length) {
      check('every declared icon decodes as a real image', false, 'the manifest declares no icons');
    } else {
      skip('every declared icon decodes as a real image', 'no extension page to decode them in');
    }

    /* ---- 8. ACCESSIBILITY, the half no static parse can see ----
       The node tier grades the markup and the arithmetic. These four things are
       runtime behaviour: whether a ring is actually PAINTED, whether Tab
       actually reaches every control, whether focus actually comes back out of
       a dialog, and whether a layout actually survives being made twice as big.
       All four were logged in the reference as browser-only for exactly that
       reason. */
    if (optionsPage) {
      try {
        /* Keyboard walk. Tab from the top and record every stop: what it is,
           whether the engine considers it focus-visible, and whether the ring
           it draws is actually more than zero pixels wide. A control the walk
           never lands on is a control a keyboard user cannot reach. */
        await optionsPage.bringToFront();
        await optionsPage.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); });
        const stops = [];
        for (let i = 0; i < 12; i++) {
          await optionsPage.keyboard.press('Tab');
          const s = await optionsPage.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            return {
              id: el.id || '', tag: el.tagName.toLowerCase(),
              visible: el.matches(':focus-visible'),
              style: cs.outlineStyle,
              outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
              width: parseFloat(cs.outlineWidth) || 0
            };
          });
          if (!s) break;
          if (stops.length && stops[stops.length - 1].id === s.id && s.id) break;   // wrapped
          stops.push(s);
        }
        const reached = stops.map(s => s.id || s.tag);
        const wanted = ['themeBtn', 'copyOnOpen', 'keepHistory', 'historyLimit', 'theme', 'clearBtn'];
        const missed = wanted.filter(id => reached.indexOf(id) < 0);
        check('every control on the options page is reachable by Tab, in DOM order',
          missed.length === 0, 'reached: ' + reached.join(' -> ') + (missed.length ? '  MISSED: ' + missed.join(', ') : ''));

        /* Every stop, unconditionally — not "every stop the engine agreed was
           focus-visible". Filtering on that made the check vacuous: if
           :focus-visible never matched, the list was empty and the check went
           green over a page with no ring at all. */
        const ringless = stops.filter(s => !s.visible || s.style === 'none' || s.width < 2);
        check('every keyboard stop paints a focus ring at least 2px wide',
          stops.length >= 6 && ringless.length === 0,
          ringless.length ? ringless.map(s => (s.id || s.tag) + ': focus-visible=' + s.visible + ' outline="' + s.outline + '"').join('; ')
            : stops.length + ' stops, all ringed (' + (stops[0] && stops[0].outline) + ')');

        /* The switch used to be an invisible checkbox with a decorative span
           beside it, so the ring was painted on a transparent box. It is the
           checkbox itself now — this proves the ring lands on the thing you can
           see, and that the knob actually moves when it is checked. */
        /* Read AFTER the transition has settled. getComputedStyle mid-flight
           returns the interpolated value, which at t=0 is translateX(0) — i.e.
           reading it immediately reports "the knob does not move" about a knob
           that moves perfectly well. */
        const knobAt = () => optionsPage.evaluate(() =>
          getComputedStyle(document.getElementById('copyOnOpen'), '::after').transform);
        const sw = { w: 0, h: 0 };
        Object.assign(sw, await optionsPage.evaluate(() => {
          const b = document.getElementById('copyOnOpen').getBoundingClientRect();
          return { w: b.width, h: b.height };
        }));
        sw.before = await knobAt();
        await optionsPage.evaluate(() => { document.getElementById('copyOnOpen').checked = true; });
        await optionsPage.waitForTimeout(400);
        sw.after = await knobAt();
        await optionsPage.evaluate(() => { document.documentElement.dir = 'rtl'; });
        await optionsPage.waitForTimeout(400);
        sw.rtl = await knobAt();
        await optionsPage.evaluate(() => {
          document.documentElement.dir = 'ltr';
          document.getElementById('copyOnOpen').checked = false;
        });
        await optionsPage.waitForTimeout(300);
        check('the switch is a real, visible checkbox and its knob moves when it is on',
          sw.w > 20 && sw.h > 10 && sw.before !== sw.after && /18/.test(sw.after),
          sw.w + 'x' + sw.h + '  off=' + sw.before + '  on=' + sw.after);
        check('the knob travels the OTHER way in RTL',
          /-18/.test(sw.rtl), 'ltr=' + sw.after + '  rtl=' + sw.rtl);

        /* The dialog: opened from a real click, closed with a real Escape.
           Focus containment and focus restore are what a hand-rolled scrim div
           always gets wrong, and neither is observable in a node sim. */
        await optionsPage.focus('#clearBtn');
        await optionsPage.click('#clearBtn');
        await optionsPage.waitForTimeout(250);
        const opened = await optionsPage.evaluate(() => {
          const d = document.getElementById('sk-confirm');
          return {
            present: !!d, open: !!(d && d.open),
            inside: !!(d && d.contains(document.activeElement)),
            focused: document.activeElement ? document.activeElement.textContent : ''
          };
        });
        check('a destructive action opens a real modal <dialog> and focus moves inside it',
          opened.present && opened.open && opened.inside,
          'open=' + opened.open + ' focus="' + opened.focused + '"');
        await optionsPage.keyboard.press('Escape');
        await optionsPage.waitForTimeout(250);
        const closed = await optionsPage.evaluate(() => ({
          gone: !document.getElementById('sk-confirm'),
          back: document.activeElement ? document.activeElement.id : ''
        }));
        check('Escape closes the dialog and focus RETURNS to the button that opened it',
          closed.gone && closed.back === 'clearBtn', 'dialog gone=' + closed.gone + ' focus=#' + closed.back);

        /* WCAG 1.4.4 (resize to 200%) and 1.4.10 (reflow). `zoom` is what the
           browser's own zoom control does, so this is the real thing rather
           than a narrower viewport standing in for it. */
        for (const z of [1, 2, 4]) {
          await optionsPage.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, z);
          await optionsPage.waitForTimeout(150);
          const over = await optionsPage.evaluate(() => {
            const de = document.documentElement;
            const clipped = [...document.querySelectorAll('*')].filter(el => {
              const cs = getComputedStyle(el);
              return (cs.overflow === 'hidden' || cs.overflowY === 'hidden') &&
                     el.scrollHeight > el.clientHeight + 2 && cs.textOverflow !== 'ellipsis';
            }).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
            return { h: de.scrollWidth - de.clientWidth, clipped };
          });
          check('at ' + (z * 100) + '% zoom the options page neither scrolls sideways nor clips content',
            over.h <= 1 && over.clipped.length === 0,
            'overflow=' + over.h + 'px  clipped=[' + over.clipped.join(', ') + ']');
        }
        await optionsPage.evaluate(() => { document.documentElement.style.zoom = '1'; });

        /* THE LONGEST TRANSLATION, WITHOUT GENERATING ONE.

           German and Tamil run 40–80% longer than English, and the failure mode
           is the worst kind: `overflow: hidden` LOSES the tail of a sentence
           with no scrollbar, no ellipsis and no cue, so it is never reported —
           it is just a tool that quietly shows two-thirds of its labels in
           thirty languages.

           A pseudo-locale (en_XA) is the textbook answer and it is the wrong
           one here: it would mean shipping a 56th catalogue, or building an
           overlay the packaging tier then has to know about. Expanding the text
           nodes that are already on screen tests the same property — can this
           layout hold a string half again as long — with nothing to package and
           nothing to keep in sync. Restored afterwards, and the check reads the
           page back to prove the restore worked. */
        const grew = await optionsPage.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const saved = [];
          let n;
          while ((n = walker.nextNode())) {
            const t = n.nodeValue;
            if (!t || !t.trim() || t.length < 3) continue;
            saved.push([n, t]);
            // 45% longer, in real words rather than repeated characters: a run
            // of one letter can be broken anywhere, which is not what a long
            // German compound does to a flex row.
            n.nodeValue = t + ' ' + t.slice(0, Math.ceil(t.length * 0.45));
          }
          const de = document.documentElement;
          const clipped = [...document.querySelectorAll('*')].filter(el => {
            const cs = getComputedStyle(el);
            return (cs.overflow === 'hidden' || cs.overflowY === 'hidden') &&
                   el.scrollHeight > el.clientHeight + 2 && cs.textOverflow !== 'ellipsis';
          }).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + (el.className || '')));
          const out = { nodes: saved.length, h: de.scrollWidth - de.clientWidth, clipped };
          for (const [node, text] of saved) node.nodeValue = text;
          out.restored = de.scrollWidth - de.clientWidth;
          return out;
        });
        check('every label 45% longer — the layout still does not scroll sideways or clip',
          grew.nodes > 20 && grew.h <= 1 && grew.clipped.length === 0,
          grew.nodes + ' text nodes expanded, overflow=' + grew.h + 'px clipped=[' + grew.clipped.join(', ') + ']');
        check('and the page was put back exactly as it was',
          grew.restored <= 1, 'overflow back to ' + grew.restored + 'px');
      } catch (e) {
        check('the accessibility walk over the options page completed', false, String((e && e.message) || e));
      }

      /* ---------------------------------------------------------------- */
      /* DATA LIFECYCLE, against the real engine                           */
      /* ---------------------------------------------------------------- */
      /* Everything here is something the node sim is structurally incapable of
         seeing: StorageManager is a real browser API and the sim fakes it; the
         download path is an <a download> click the sim can only watch being
         constructed; and whether a scrollable review pane actually scrolls is
         a layout question. */
      try {
        /* THE DURABILITY LINE MUST MATCH THE ENGINE. Reporting "durable" on a
           best-effort origin is the one sentence on that page that would stop a
           user exporting a backup, so it is checked against the real answer
           rather than against a fixture. */
        const durability = await optionsPage.evaluate(async () => ({
          persisted: await navigator.storage.persisted(),
          line: (document.getElementById('dataDurability') || {}).textContent || ''
        }));
        const saysDurable = /Durable/.test(durability.line);
        const saysBestEffort = /Best effort/.test(durability.line);
        check('the durability line says exactly one of the two declared things, and it is not blank',
          (saysDurable ? 1 : 0) + (saysBestEffort ? 1 : 0) === 1,
          JSON.stringify(durability.line));
        check('and it AGREES with what the real StorageManager reports — never "durable" on a guess',
          saysDurable === durability.persisted,
          'navigator.storage.persisted()=' + durability.persisted + '  line says durable=' + saysDurable);

        /* Seed a row, then export it. In the shipped extension chrome.downloads
           is undefined (the permission is deliberately not asked for), so this
           exercises the anchor path — the one 67 tools will actually use. */
        await optionsPage.evaluate(async () => {
          await SKDB.put('items', {
            id: 'smoke-1', title: 'a stored row', origin: 'https://example.com', createdAt: Date.now()
          });
        });
        await optionsPage.reload({ waitUntil: 'domcontentloaded' });
        await optionsPage.waitForTimeout(500);

        const rowButtons = await optionsPage.evaluate(() =>
          [...document.querySelectorAll('#itemList button')].map(b => b.getAttribute('aria-label')));
        check('a stored row is listed with its own delete control, named by its origin',
          rowButtons.length === 1 && /example\.com/.test(rowButtons[0] || ''),
          JSON.stringify(rowButtons));

        const [download] = await Promise.all([
          optionsPage.waitForEvent('download', { timeout: 8000 }),
          optionsPage.click('#exportBtn')
        ]);
        const stream = await download.createReadStream();
        let exported = '';
        for await (const chunk of stream) exported += chunk;
        let parsed = null;
        try { parsed = JSON.parse(exported); } catch (_) {}
        check('the export button really downloads a file, through the no-permission anchor path',
          !!parsed, download.suggestedFilename() + ' — ' + exported.length + ' bytes');
        check('the exported file carries the schema stamp and the stored row',
          !!parsed && parsed.schema >= 1 && parsed.items.length === 1 && parsed.items[0].id === 'smoke-1',
          parsed ? 'schema=' + parsed.schema + ' items=' + parsed.items.length : 'unparseable');
        check('the filename is locale-independent functional output — an ISO-ish date, no localised month',
          /^skeleton-export-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()),
          download.suggestedFilename());

        /* THE PROBLEM REPORT: shown, scrollable, cancellable, and nothing on
           the wire. The preview pane is a layout claim — a pane that clips
           instead of scrolling is a pane the user is approving unseen. */
        await optionsPage.focus('#reportBtn');
        await optionsPage.click('#reportBtn');
        await optionsPage.waitForTimeout(400);
        const preview = await optionsPage.evaluate(() => {
          const d = document.getElementById('sk-confirm');
          const pre = d && d.querySelector('pre');
          if (!pre) return { present: false };
          const cs = getComputedStyle(pre);
          return {
            present: true,
            open: !!d.open,
            focusInside: d.contains(document.activeElement),
            text: pre.textContent,
            overflowY: cs.overflowY,
            scrollable: pre.scrollHeight > pre.clientHeight,
            tabbable: pre.getAttribute('tabindex') === '0',
            children: pre.children.length
          };
        });
        check('"Report a problem" shows the finished report in a modal, before anything is written',
          preview.present && preview.open && preview.focusInside,
          preview.present ? preview.text.length + ' characters on screen' : 'no preview pane');
        let report = null;
        try { report = JSON.parse(preview.text || ''); } catch (_) {}
        check('what is on screen is the report itself, and it parses',
          !!report && report.report === 'skeleton-problem-report' && !!report.storage,
          report ? Object.keys(report).join(',') : 'unparseable');
        check('the report names no url, no page title and no user-agent string',
          !!report && JSON.stringify(report).indexOf('a stored row') < 0 &&
          JSON.stringify(report).indexOf('AppleWebKit') < 0 &&
          JSON.stringify(report).indexOf('example.com/') < 0,
          report ? 'platform=' + report.platform : 'no report');
        check('the preview is TEXT — a value that did leak would be shown, never rendered',
          preview.children === 0, preview.children + ' child elements inside the pane');
        check('the pane SCROLLS rather than clipping, and a keyboard user can reach it to scroll it',
          preview.overflowY === 'auto' && preview.tabbable,
          'overflow-y=' + preview.overflowY + ' tabindex=' + (preview.tabbable ? '0' : 'none') +
          ' scrollable=' + preview.scrollable);

        let sawDownload = false;
        const catchDownload = () => { sawDownload = true; };
        optionsPage.on('download', catchDownload);
        await optionsPage.keyboard.press('Escape');
        await optionsPage.waitForTimeout(400);
        const afterCancel = await optionsPage.evaluate(() => ({
          gone: !document.getElementById('sk-confirm'),
          back: document.activeElement ? document.activeElement.id : ''
        }));
        optionsPage.off('download', catchDownload);
        check('Escape on the review dialog writes NOTHING and hands focus back',
          afterCancel.gone && !sawDownload && afterCancel.back === 'reportBtn',
          'dialog gone=' + afterCancel.gone + ' files written=' + (sawDownload ? 1 : 0) + ' focus=#' + afterCancel.back);

        /* Leave the profile as we found it. */
        await optionsPage.evaluate(async () => { await SKDB.clearAll(); });
      } catch (e) {
        check('the data-lifecycle walk over the options page completed', false, String((e && e.message) || e));
      }
    }

    if (popupPage) {
      try {
        /* A Chrome popup is sized to its content. 400px is the width this
           stylesheet asks for, and 280 is the narrowest a popup ever gets — the
           layout has to hold at both without a sideways scrollbar. */
        for (const w of [400, 280]) {
          await popupPage.setViewportSize({ width: w, height: 600 });
          await popupPage.waitForTimeout(150);
          const over = await popupPage.evaluate(() => {
            const de = document.documentElement;
            return { h: de.scrollWidth - de.clientWidth, w: de.clientWidth };
          });
          check('the popup layout holds at ' + w + 'px wide with no sideways scroll',
            over.h <= 1, 'viewport=' + over.w + 'px overflow=' + over.h + 'px');
        }
        /* THE TOKENS ACTUALLY REACH THE PAGE. A static scan finds `:root {`
           whether or not the browser can reach it — an early comment terminator
           earlier in the file swallows the whole block and every regex still
           passes. Only the engine can say. */
        await popupPage.emulateMedia({ colorScheme: 'light' });
        await popupPage.waitForTimeout(150);
        const light = await popupPage.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return { bg: cs.getPropertyValue('--bg').trim(), accent: cs.getPropertyValue('--accent').trim() };
        });
        check('the LIGHT token block actually reaches the page (not just the file)',
          light.bg === '#f6f6f9' && light.accent === '#4f46e5', '--bg=' + light.bg + ' --accent=' + light.accent);

        /* Dark mode is a media query, so it has to be emulated rather than
           asserted from the stylesheet: this proves the tokens actually apply. */
        await popupPage.emulateMedia({ colorScheme: 'dark' });
        await popupPage.waitForTimeout(150);
        const dark = await popupPage.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return { bg: cs.getPropertyValue('--bg').trim(), fg: cs.getPropertyValue('--fg').trim() };
        });
        check('prefers-color-scheme: dark actually swaps the palette',
          dark.bg === '#121218' && dark.fg === '#ececf2', '--bg=' + dark.bg + ' --fg=' + dark.fg);
        await popupPage.emulateMedia({ colorScheme: 'light' });

        /* Reduced motion: the spinner must STOP, not spin 80,000 times a second. */
        await popupPage.emulateMedia({ reducedMotion: 'reduce' });
        await popupPage.waitForTimeout(100);
        const motion = await popupPage.evaluate(() => {
          const d = document.createElement('div');
          d.className = 'spin';
          document.body.appendChild(d);
          const cs = getComputedStyle(d);
          const knob = document.createElement('div');
          const out = { count: cs.animationIterationCount, dur: cs.animationDuration };
          d.remove(); knob.remove();
          return out;
        });
        check('prefers-reduced-motion stops the spinner instead of speeding it to a strobe',
          motion.count === '1', 'animation-iteration-count=' + motion.count + ' duration=' + motion.dur);
        await popupPage.emulateMedia({ reducedMotion: 'no-preference' });
      } catch (e) {
        check('the accessibility walk over the popup completed', false, String((e && e.message) || e));
      }
    }

    /* ---- 4. console errors ----
       Taken before the sentinels below fire, and the sentinels' own network noise
       is filtered by URL as well, so this cannot be laundered by ordering. */
    await new Promise(r => setTimeout(r, 500));
    const swErrors = extId && ctx.serviceWorkers()[0]
      ? await ctx.serviceWorkers()[0].evaluate(() => self.__smokeErrors || []).catch(() => [])
      : [];
    const isSentinel = (u) => !!u && [SENTINEL_ARM, SENTINEL_PAGE, SENTINEL_SW].some(s => u.indexOf(s) === 0);
    /* The CSP refusals below are DELIBERATE, and Chrome logs each one as a
       console error on the page that attempted it. Filtering on the sentinel
       path keeps that out of the "zero console errors" count without blunting
       it: any other CSP violation, from any other url, still fails this. */
    const realConsole = consoleErrors.filter(e =>
      !isSentinel(e.url) && e.text.indexOf('smoke-armed') < 0 && e.text.indexOf('smoke-csp') < 0);
    check('zero console errors from the worker and the pages', realConsole.length === 0,
      realConsole.length ? realConsole.map(e => e.text + (e.url ? ' @ ' + e.url : '')).join(' | ') : 'none');
    check('zero uncaught exceptions in the pages', pageErrors.length === 0,
      pageErrors.length ? pageErrors.map(e => e.text).join(' | ') : 'none');
    check('zero errors or unhandled rejections inside the service worker', swErrors.length === 0,
      swErrors.length ? swErrors.join(' | ') : 'none');

    /* ---- 5. zero network ----

       ARM THE LISTENER FROM OUTSIDE THE EXTENSION.

       This used to fire the arming fetch from an extension page, which stopped
       working the moment manifest.json grew `connect-src 'none'` — the request
       was refused by the platform and never reached the wire, so the arming
       check went red. That failure is the good news, and it is now asserted
       below instead of worked around. The listener still has to be proved
       though, so the arming request comes from a plain `data:` page, which the
       extension's CSP does not govern. If THAT is not seen, every "zero
       requests" result underneath is worthless. */
    let armed = false;
    {
      const outside = await ctx.newPage();
      await outside.goto('data:text/html,<title>arming</title>').catch(() => {});
      await outside.evaluate((u) => fetch(u).catch(() => {}), SENTINEL_ARM).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
      armed = requests.some(r => r.url.indexOf(SENTINEL_ARM) === 0);
      await outside.close().catch(() => {});
    }
    check('the network listener is armed (a request from OUTSIDE the extension is seen)',
      armed, SENTINEL_ARM);

    /* THE PLATFORM ENFORCES THE PROMISE.

       Every other network check in this repo is a scan of the source, and a
       scan cannot see the line a tool adds next year. `connect-src 'none'` in
       content_security_policy.extension_pages makes the browser itself refuse
       fetch, XHR, WebSocket and sendBeacon from every extension page AND from
       the service worker — so "zero network calls" stops being a claim the code
       review is responsible for and becomes something the engine will not
       permit.

       Two assertions, and both matter: the call must REJECT (so the code path
       cannot silently believe it succeeded) and the request must never appear
       on the wire (so a rejected promise is not hiding a packet that already
       left). */
    let pageBlocked = null, swBlocked = null;
    if (host) {
      pageBlocked = await host.evaluate(
        (u) => fetch(u).then(() => 'RESOLVED — the request was allowed', e => 'blocked: ' + (e && e.name)),
        SENTINEL_PAGE).catch(e => 'threw: ' + e.message);
    }
    const swNow = ctx.serviceWorkers()[0];
    if (swNow) {
      swBlocked = await swNow.evaluate(
        (u) => fetch(u).then(() => 'RESOLVED — the request was allowed', e => 'blocked: ' + (e && e.name)),
        SENTINEL_SW).catch(e => 'threw: ' + e.message);
    }
    await new Promise(r => setTimeout(r, 1200));

    check('CSP refuses a fetch() from an extension PAGE — the zero-network promise is enforced, not asserted',
      typeof pageBlocked === 'string' && pageBlocked.indexOf('blocked:') === 0, String(pageBlocked));
    check('and the refused page request never reached the wire',
      !requests.some(r => r.url.indexOf(SENTINEL_PAGE) === 0),
      'no packet for ' + SENTINEL_PAGE);
    check('CSP refuses a fetch() from the SERVICE WORKER too',
      !swNow || (typeof swBlocked === 'string' && swBlocked.indexOf('blocked:') === 0), String(swBlocked));
    check('and the refused worker request never reached the wire either',
      !requests.some(r => r.url.indexOf(SENTINEL_SW) === 0),
      'no packet for ' + SENTINEL_SW);

    /* The stylesheet half of the same policy. `style-src 'self'` is only worth
       declaring if nothing shipped needs inline CSS — and this is the check
       that stops somebody adding a <style> block, seeing a blank page, and
       "fixing" it by putting 'unsafe-inline' back. */
    if (optionsPage) {
      const styleRefused = await optionsPage.evaluate(() => {
        const before = getComputedStyle(document.body).outlineStyle;
        const s = document.createElement('style');
        s.textContent = 'body { outline: 7px dotted red }';
        document.head.appendChild(s);
        const after = getComputedStyle(document.body).outlineStyle;
        s.remove();
        return { before, after };
      }).catch(e => ({ error: String(e && e.message) }));
      check('an injected <style> element has no effect — style-src carries no \'unsafe-inline\'',
        styleRefused && styleRefused.after === styleRefused.before,
        JSON.stringify(styleRefused));
      /* The other half: a policy strict enough to break the product is a policy
         somebody loosens. The page must still be LAID OUT — the rules that used
         to live in a <style> block now come from pages/options.css, which the
         CSP does allow. */
      const laidOut = await optionsPage.evaluate(() => {
        const w = document.getElementById('wrap');
        if (!w) return { found: false };
        const cs = getComputedStyle(w);
        return { found: true, maxInline: cs.maxInlineSize || cs.maxWidth, pad: cs.paddingTop };
      }).catch(() => ({ found: false }));
      check('the options page is still LAID OUT with that policy in force',
        laidOut.found && laidOut.maxInline === '640px' && laidOut.pad === '26px',
        JSON.stringify(laidOut) + ' — the rules come from pages/options.css, which the CSP allows');
    }

    const offenders = requests.filter(r =>
      !isSentinel(r.url) && !LOCAL_SCHEMES.some(s => r.url.indexOf(s) === 0));
    check('ZERO network requests left the browser', offenders.length === 0,
      offenders.length
        ? offenders.map(o => o.url + ' <- ' + o.from).join(' | ')
        // Counted, not assumed: there used to be exactly two sentinel requests
        // and the arithmetic said "- 2". Two of the three are now BLOCKED and
        // never appear, so a hard-coded subtraction prints a wrong number.
        : requests.filter(r => !isSentinel(r.url)).length + ' requests, all chrome-extension:/data:/blob:/chrome:');

    if (popupPage) await popupPage.close().catch(() => {});
    if (optionsPage) await optionsPage.close().catch(() => {});
  } catch (e) {
    check('the smoke run completed', false, String((e && e.message) || e));
  } finally {
    await ctx.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  /* ==================================================================== */
  /* A SECOND BROWSER, WHOSE UI LANGUAGE IS ARABIC                        */
  /* ==================================================================== */
  /* Everything above flipped `dir` by hand on an English page. That proves
     the stylesheet reacts to the attribute; it proves nothing about the three
     things that actually break in the field, because all three happen before
     any CSS runs:

       - the catalogue is not found, and 55 locales silently serve English;
       - nothing sets dir at boot, so an RTL locale renders left-to-right with
         Arabic text in it;
       - the mirrored layout collides or clips, which no LTR run can see.

     Three of the 55 required locales are RTL, so this is 5% of the shipped
     surface — and retrofitting it across 67 tools later is 67 investigations.
     A whole extra browser launch is worth it. */
  const rtlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-ar-'));
  let rtlCtx;
  try {
    rtlCtx = await chromium.launchPersistentContext(rtlDir, {
      channel: 'chromium',
      headless: !process.env.HEADFUL,
      viewport: { width: 1280, height: 900 },
      locale: 'ar',
      args: [
        '--disable-extensions-except=' + EXT_DIR,
        '--load-extension=' + EXT_DIR,
        '--lang=ar', '--accept-lang=ar',
        '--disable-background-networking', '--disable-component-update',
        '--disable-sync', '--no-first-run', '--no-default-browser-check'
      ]
    });

    let arSw = rtlCtx.serviceWorkers()[0];
    if (!arSw) arSw = await rtlCtx.waitForEvent('serviceworker', { timeout: 20000 });
    const arId = new URL(arSw.url()).host;
    const uiLang = await arSw.evaluate(() => chrome.i18n.getUILanguage());
    /* If Chrome did not actually come up in Arabic, every check below would
       pass for the wrong reason. Assert the premise first. */
    check('Chrome\'s UI language really is Arabic — without this the rest proves nothing',
      /^ar/.test(uiLang), 'chrome.i18n.getUILanguage() = ' + uiLang);

    const arPage = await rtlCtx.newPage();
    await arPage.goto('chrome-extension://' + arId + '/pages/options.html');
    await arPage.waitForLoadState('domcontentloaded');
    await arPage.waitForTimeout(500);

    const arState = await arPage.evaluate(() => ({
      dir: document.documentElement.getAttribute('dir'),
      lang: document.documentElement.getAttribute('lang'),
      computed: getComputedStyle(document.body).direction,
      h1: ((document.querySelector('h1') || {}).textContent || '').trim()
    }));
    check('the options page sets dir="rtl" at boot, from the locale and not from a test',
      arState.dir === 'rtl' && arState.computed === 'rtl',
      'dir=' + arState.dir + ' lang=' + arState.lang + ' computed=' + arState.computed);
    check('the Arabic catalogue actually reached the page — not English falling through',
      /[؀-ۿ]/.test(arState.h1), 'h1 = "' + arState.h1 + '"');

    /* THE OTHER HALF OF THE PASS, WHICH textContent CANNOT SHOW YOU.
       data-i18n-attr writes through setAttribute against an allowlist, and an
       icon-only button is named ENTIRELY by those attributes: get this wrong
       and the page looks perfectly translated while every glyph button
       announces its English tooltip to a screen reader — in Arabic Chrome, to
       an Arabic user. The node tier runs this against a fake DOM; only a real
       engine proves the selector matched and the attribute took. */
    const arAttr = await arPage.evaluate(() => {
      const b = document.querySelector('[data-i18n-attr]');
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let marker = '';
      while (walk.nextNode()) if (walk.currentNode.nodeValue.indexOf('⟦') >= 0) marker = walk.currentNode.nodeValue.trim();
      return {
        spec: b ? b.getAttribute('data-i18n-attr') : null,
        title: b ? b.getAttribute('title') : null,
        label: b ? b.getAttribute('aria-label') : null,
        marker
      };
    });
    check('an icon-only button\'s title AND aria-label were localised through data-i18n-attr',
      !!arAttr.spec && /[؀-ۿ]/.test(String(arAttr.title)) && /[؀-ۿ]/.test(String(arAttr.label)),
      arAttr.spec + ' -> title="' + arAttr.title + '" aria-label="' + arAttr.label + '"');
    check('and no missing-key marker survived anywhere in the Arabic page',
      arAttr.marker === '', arAttr.marker || 'no ⟦key⟧ anywhere in the rendered text');

    /* Geometry, not stylesheet text: a logical property that is not mirroring
       looks identical in a file scan. */
    const geo = await arPage.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const box = (sel) => {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(vw - r.right) };
      };
      return { vw, brand: box('.brand'), label: box('#keepHistory-label'), sw: box('#keepHistory') };
    });
    check('the layout MIRRORS — the brand sits against the right edge',
      !!geo.brand && geo.brand.right < geo.brand.left,
      geo.brand ? 'right gap ' + geo.brand.right + 'px vs left gap ' + geo.brand.left + 'px' : '.brand not found');
    check('and a settings row reverses: its label is right of its control',
      !!geo.label && !!geo.sw && geo.sw.left < geo.label.left,
      geo.label && geo.sw ? 'switch left ' + geo.sw.left + 'px, label left ' + geo.label.left + 'px' : 'row not found');

    /* The knob TRANSITIONS, so a computed read taken straight after .checked
       returns the START of the animation — a zero matrix — and the check would
       be measuring nothing. Wait it out, as the LTR knob check above does. */
    const arKnob = async (on) => {
      await arPage.evaluate((v) => { document.getElementById('keepHistory').checked = v; }, on);
      await arPage.waitForTimeout(400);
      return arPage.evaluate(() => getComputedStyle(document.getElementById('keepHistory'), '::after').transform);
    };
    await arKnob(false);
    const arOn = await arKnob(true);
    const tx = /matrix\([^)]*,\s*(-?[\d.]+),\s*-?[\d.]+\)$/.exec(arOn);
    check('the switch knob travels the other way under a REAL RTL locale',
      !!tx && parseFloat(tx[1]) < 0, 'on=' + arOn);

    const arFit = await arPage.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const clipped = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < -1 || r.right > vw + 1) clipped.push((el.id || el.className || el.tagName) + '@' + Math.round(r.left));
      }
      return { overflow: Math.max(0, document.documentElement.scrollWidth - vw), clipped };
    });
    check('the mirrored page neither scrolls sideways nor pushes anything off-screen',
      arFit.overflow === 0 && arFit.clipped.length === 0,
      'overflow=' + arFit.overflow + 'px clipped=[' + arFit.clipped.slice(0, 4).join(', ') + ']');

    const arPop = await rtlCtx.newPage();
    await arPop.goto('chrome-extension://' + arId + '/popup/popup.html');
    await arPop.waitForLoadState('domcontentloaded');
    await arPop.waitForTimeout(400);
    const popState = await arPop.evaluate(() => ({
      dir: document.documentElement.getAttribute('dir'),
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 50)
    }));
    check('the popup is a separate document and it mirrors too, in Arabic',
      popState.dir === 'rtl' && /[؀-ۿ]/.test(popState.text) && popState.overflow === 0,
      'dir=' + popState.dir + ' overflow=' + popState.overflow + 'px "' + popState.text + '"');
  } catch (e) {
    check('the Arabic-locale run completed', false, String((e && e.message) || e));
  } finally {
    if (rtlCtx) await rtlCtx.close().catch(() => {});
    try { fs.rmSync(rtlDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n' + (TOTAL - FAILS) + '/' + TOTAL + ' checks passed');
  console.log(FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS');
  process.exit(FAILS ? 1 : 0);
})();
