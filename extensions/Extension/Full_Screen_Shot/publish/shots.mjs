#!/usr/bin/env node
/* shots.mjs — the store screenshots, taken by the browser that is already
   running the extension.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED. `tool.json` puts `publish/**` on the
   packaging never-list, so nothing here can reach a package.

     node publish/shots.mjs                 capture, write into the listing tree
     node publish/shots.mjs --out <dir>     write somewhere else (a dry run)
     HEADFUL=1 node publish/shots.mjs       watch it happen
     node publish/shots.mjs --only 01,04    a subset, by frame number

   ── WHY THIS FILE EXISTS, AND WHY IT IS NOT NEW WORK ───────────────────────
   `templates/tool/publish/shots.mjs` has been a real, runnable capture skeleton
   at 1280x800 since the template was written, and the one real tool in this
   fleet never got a copy of it. Measured 2026-09-20: `publish/` held twelve
   files and `shots.mjs` was not among them, and
   `store/_shared/screenshots/` held a README and no images.

   The skeleton's own argument is the argument here, and it was already true of
   THIS tool before this file was written:

     test/e2e/run.mjs:280-286 and every claim-lib suite launch a persistent
     Chromium with this extension loaded unpacked at `viewport: { width: 1280,
     height: 800 }` — which is EXACTLY the one screenshot size the Chrome Web
     Store, Edge Add-ons and AMO all accept.

   The extension is already running, in a real browser, at the store's own
   dimensions, driving its real service worker. Taking the picture is one call.

   ── THE HARNESS IS REUSED, NOT REBUILT, AND HERE IS THE SEAM ───────────────
   `prepareTestExtension`, `serve` and `setSettings` are imported from
   `../test/e2e/claim-lib.mjs` — the same three functions every e2e suite uses,
   with the same launch options. Writing a second copy would mean a screenshot
   taken by a harness the test suite does not use, which is the one way a
   listing picture can drift from the tested product.

   What is NOT reused is `claim-lib.capture()`. It grades a capture and then
   CLOSES the result page; a screenshot needs that page left open and driven a
   little further. So the drive step is written here, calling the extension's
   own `startCapture` through the service worker exactly as claim-lib does.

   ⚠️ THE MANIFEST DIFFERS AND THE ENGINE DOES NOT. `prepareTestExtension()`
   copies the tree and promotes `activeTab` to a static `tabs` + `<all_urls>`,
   because a script driver has no user gesture to grant activeTab with. Not one
   line of background.js, content/, pages/ or popup/ changes, so every pixel
   below is painted by the shipped code. It is stated here because a store
   screenshot is a sworn filing and the difference belongs on the record rather
   than in a reader's assumption.

   ── DETERMINISM, AND WHAT IS AND IS NOT PROMISED ───────────────────────────
     · fixed viewport 1280x800, and the written file is read back and REFUSED
       if its IHDR does not say exactly that;
     · fixed seed data — `publish/shots-demo.html`, a fixture of ours, with its
       dates written as literal text;
     · no clock in any frame. The history page is deliberately NOT photographed
       for this reason alone: it renders `new Date(createdAt).toLocaleString()`
       beside every card, so its pixels change every run and carry the capture
       machine's locale;
     · no hostname in any frame. The result page's summary line shows the
       captured page's TITLE and falls back to its URL only when there is none;
       the fixture has a title, so `localhost:<port>` never appears.
     · NOT promised: byte-identical files across operating systems. The demo
       page and the extension's own pages are laid out with a `system-ui` font
       stack, so ubuntu and Windows paint different glyphs. That is a property
       of photographing a real browser, it is why nothing in CI byte-compares a
       screenshot, and `scripts/check-listing-assets.mjs` grades these on their
       dimensions rather than their bytes.

   ── WHAT IS DELIBERATELY NOT PHOTOGRAPHED ──────────────────────────────────
   `store/_shared/screenshots/README.md` records a standing rule: Batch URL
   capture, Beautify and Scroll to Clip "pass the sandbox sims but have never
   been exercised by hand in a real browser", and a screenshot of one "would
   advertise behaviour nobody has watched work". That is a policy judgement and
   this script obeys it: `pages/batch.html`, `pages/beautify.html` and
   `pages/scrollclip.html` have no entry in SHOTS and must not get one until
   that QA pass is done. Four frames is above Chrome's minimum of one and below
   its maximum of five.

   Exit codes: 0 every frame written and verified · 1 a frame is wrong or
   missing · 2 could not run. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXT_DIR, serve, prepareTestExtension, setSettings } from '../test/e2e/claim-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* The one size Chrome, Edge and AMO all accept. Sourced in
   scripts/store-graphics.json, which is also what grades the output. */
const SHOT_W = 1280, SHOT_H = 800;
/* A port of its own. The e2e suites bind 8907 and 8908; a shots run that
   collided with a suite would fail in a way that looks like a capture defect. */
const PORT = 8931;
const DEMO_PATH = '/publish/shots-demo.html';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : args[i + 1];
};
const DEFAULT_OUT = path.join(ROOT, 'store', '_shared', 'screenshots');
const OUT = flag('out') ? path.resolve(flag('out')) : DEFAULT_OUT;
const ONLY = flag('only') ? new Set(flag('only').split(',').map((s) => s.trim())) : null;
for (const a of args) {
  if (a.startsWith('--') && !['--out', '--only'].includes(a)) {
    console.error('CANNOT RUN — unknown flag ' + a + '. Known: --out <dir>, --only <n,n>.');
    process.exit(2);
  }
}

let FAILS = 0;
const ok = (s) => console.log('PASS  ' + s);
const bad = (s) => { FAILS++; console.log('FAIL  ' + s); };

/* ── the frames ───────────────────────────────────────────────────────────
   `n` is the frame number a listing shows them in; `what` is the sentence that
   goes in the README beside the file, so the record of what each picture shows
   is written by the thing that took it. */
const SHOTS = [
  {
    n: '01', name: 'popup',
    what: 'The toolbar popup — the five capture modes and their keyboard shortcuts, centred on ' +
          'the extension\'s own accent background.',
  },
  {
    n: '02', name: 'full-page-capture',
    what: 'The result page after a real full-page capture of publish/shots-demo.html: the whole ' +
          'document stitched into one image, with the summary line naming the page and its pixel size.',
  },
  {
    n: '03', name: 'redaction-review',
    what: 'The "Before you copy" review dialog raised by the Copy button on that same capture — ' +
          'FullShot\'s count of what it matched, painted and read back opaque, over the image that ' +
          'is about to leave the machine.',
  },
  {
    n: '04', name: 'options',
    what: 'The Options page — every capture, privacy and export setting the extension has.',
  },
];

/* ── Playwright, from the fleet location ──────────────────────────────────
   Copied from templates/tool/publish/shots.mjs, deliberately and unchanged in
   behaviour: `.github/workflows/extensions.yml` creates ONE Playwright install
   at the repository root `_playwright/` for every browser tier in the fleet,
   and a second resolver here would be a second thing to keep in step with it.
   A bare `import 'playwright'` cannot work from this directory — node resolves
   a bare specifier up the ANCESTOR node_modules chain, and `_playwright/` is a
   sibling of `extensions/`, not an ancestor of `publish/`. */
function pwEntry(dir) {
  for (const f of ['index.mjs', 'index.js']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function probe(base) {
  for (const rel of ['node_modules/playwright', 'test/e2e/node_modules/playwright']) {
    const entry = pwEntry(path.join(base, ...rel.split('/')));
    if (entry) return entry;
  }
  return null;
}
async function loadPlaywright() {
  const env = process.env.SMOKE_PLAYWRIGHT;
  if (env) {
    for (const c of [env, path.join(env, 'playwright'), path.join(env, 'node_modules', 'playwright')]) {
      const entry = pwEntry(c);
      if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry };
    }
  }
  let base = HERE;
  for (let up = 0; up < 8; up++) {
    const entry = probe(path.join(base, '_playwright')) || probe(base);
    if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry };
    const next = path.dirname(base);
    if (next === base) break;
    base = next;
  }
  throw new Error('Playwright not found. There is ONE install for the whole fleet, at the ' +
    'repository root `_playwright/`; this tool\'s own test/e2e/node_modules also satisfies it. ' +
    'Run `npm ci` in either, then `npx playwright install chromium`.');
}

/* Write one frame and read its header straight back. A file that exists is not
   the same thing as a file that is right, and 1279 pixels wide is an upload
   rejection rather than a warning. */
function writeFrame(shot, buf) {
  const file = path.join(OUT, shot.n + '-' + shot.name + '-' + SHOT_W + 'x' + SHOT_H + '.png');
  fs.writeFileSync(file, buf);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (w === SHOT_W && h === SHOT_H) ok(rel + '  ' + w + 'x' + h + '  ' + buf.length + ' bytes');
  else bad(rel + ' is ' + w + 'x' + h + ', and every one of the three stores wants exactly ' + SHOT_W + 'x' + SHOT_H);
  return { file, rel, w, h, bytes: buf.length };
}
const wanted = (shot) => !ONLY || ONLY.has(shot.n);

(async () => {
  const { mod, from } = await loadPlaywright();
  console.log('playwright  ' + from);
  fs.mkdirSync(OUT, { recursive: true });

  const srv = await serve(EXT_DIR, PORT);
  const TEST_EXT = prepareTestExtension();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-shots-'));
  const ctx = await mod.chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: SHOT_W, height: SHOT_H },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  const written = [];

  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(sw.url()).host;
    ok('the extension loaded — chrome-extension://' + extId);
    const extBase = 'chrome-extension://' + extId + '/';

    /* Redaction ON for the whole run, written and PROVEN by claim-lib's own
       setSettings: the review dialog fires only when redaction was requested,
       and a capture that silently ran with it off would photograph a claim the
       product never made. */
    await setSettings(sw, { redactPII: true });

    /* ---- 01: the popup ---------------------------------------------------
       A popup is 400px wide by design, so photographing it alone would leave
       two thirds of a 1280-wide frame empty. It is centred on the extension's
       own accent colour, read out of the page's own custom properties rather
       than typed in here — the same "parsed, never retyped" rule the graphics
       renderer follows. */
    const s01 = SHOTS[0];
    if (wanted(s01)) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: SHOT_W, height: SHOT_H });
      await p.goto(extBase + 'popup/popup.html', { waitUntil: 'load' });
      await p.waitForTimeout(500);
      await p.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const accent = (cs.getPropertyValue('--accent') || '').trim() || '#4f46e5';
        const line = (cs.getPropertyValue('--line') || '').trim() || '#e4e4ec';
        const html = document.documentElement;
        html.style.background = accent;
        html.style.display = 'grid';
        html.style.placeItems = 'center';
        html.style.minHeight = '100vh';
        const b = document.body;
        b.style.margin = '0 auto';
        b.style.border = '1px solid ' + line;
        b.style.borderRadius = '16px';
        b.style.overflow = 'hidden';
        b.style.boxShadow = '0 24px 64px rgba(0,0,0,.28)';
      });
      await p.waitForTimeout(300);
      written.push({ shot: s01, ...writeFrame(s01, await p.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } })) });
      await p.close();
    }

    /* ---- 02 + 03: one real capture, photographed twice --------------------
       The same drive claim-lib.capture() performs: open the fixture, hand the
       tab to the extension's own startCapture through the service worker, and
       wait for the result page the extension itself opens. */
    const s02 = SHOTS[1], s03 = SHOTS[2];
    if (wanted(s02) || wanted(s03)) {
      const demoUrl = 'http://localhost:' + PORT + DEMO_PATH;
      const page = await ctx.newPage();
      await page.setViewportSize({ width: SHOT_W, height: SHOT_H });
      await page.goto(demoUrl, { waitUntil: 'load' });
      await page.bringToFront();
      await page.waitForTimeout(1000);

      const resultPromise = ctx.waitForEvent('page', {
        predicate: (p) => p.url().includes('pages/result.html'), timeout: 240000
      });
      resultPromise.catch(() => {});
      await sw.evaluate(async (pageUrl) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === pageUrl) || tabs.find((t) => (t.url || '').startsWith('http'));
        if (!tab) throw new Error('the demo tab was not found; open tabs: ' + JSON.stringify(tabs.map((t) => t.url)));
        await chrome.tabs.update(tab.id, { active: true });
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
        const res = await startCapture(tab, 'full', 0);
        if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
      }, demoUrl);

      const result = await resultPromise;
      await result.setViewportSize({ width: SHOT_W, height: SHOT_H });
      await result.waitForSelector('#view:not([hidden])', { timeout: 240000 });
      /* The permanent redaction line and the summary line both land after the
         view unhides; 2.5s is claim-lib's own settle for the same read. */
      await result.waitForTimeout(2500);
      await result.bringToFront();

      if (wanted(s02)) {
        await result.evaluate(() => window.scrollTo(0, 0));
        await result.waitForTimeout(250);
        written.push({ shot: s02, ...writeFrame(s02, await result.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } })) });
      }

      if (wanted(s03)) {
        /* The dialog is raised by the product's own Copy button. It is never
           CONFIRMED: confirming is what writes the clipboard, and this run has
           no business putting anything there. Escape closes it afterwards. */
        /* `#reviewDlg` is a div with role="dialog", not a <dialog>: pages/result.js
           raises it with `dlg.hidden = false` and its stylesheet carries
           `#reviewDlg[hidden] { display: none }`. So the open state is the
           ABSENCE of the attribute, and `[open]` would wait forever.
           The gate is `r.requested !== false`, so setting redactPII above is
           what makes this click raise anything at all. */
        await result.click('#copyBtn');
        await result.waitForSelector('#reviewDlg:not([hidden])', { timeout: 60000 });
        await result.waitForTimeout(1200);
        written.push({ shot: s03, ...writeFrame(s03, await result.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } })) });
        await result.keyboard.press('Escape').catch(() => {});
      }
      await result.close().catch(() => {});
      await page.close().catch(() => {});
    }

    /* ---- 04: the options page -------------------------------------------- */
    const s04 = SHOTS[3];
    if (wanted(s04)) {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: SHOT_W, height: SHOT_H });
      await p.goto(extBase + 'pages/options.html', { waitUntil: 'load' });
      await p.waitForTimeout(900);
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(200);
      written.push({ shot: s04, ...writeFrame(s04, await p.screenshot({ clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } })) });
      await p.close();
    }
  } catch (e) {
    bad(String((e && e.stack) || e));
  } finally {
    await ctx.close().catch(() => {});
    await new Promise((r) => srv.close(r));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(TEST_EXT, { recursive: true, force: true }); } catch (_) {}
  }

  const expected = SHOTS.filter(wanted).length;
  if (written.length !== expected) {
    bad(written.length + ' of ' + expected + ' requested frame(s) were written.');
  }

  console.log('');
  for (const w of written) console.log('  ' + w.shot.n + '  ' + w.shot.what);
  console.log('');
  console.log(FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS');
  console.log('frames in ' + path.relative(ROOT, OUT).split(path.sep).join('/') +
    ' — re-run this on every release: a frame taken at one version and never retaken');
  console.log('is a listing that shows a product the user will not get,');
  console.log('then grade them with `node ../../scripts/check-listing-assets.mjs fullshot`.');
  process.exit(FAILS ? 1 : 0);
})().catch((e) => {
  console.error('CANNOT RUN — ' + ((e && e.stack) || e));
  process.exit(2);
});
