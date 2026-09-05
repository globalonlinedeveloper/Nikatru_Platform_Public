#!/usr/bin/env node
/* SKELETON — store screenshots, taken by the browser that is already running.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node publish/shots.mjs              light theme, both pages
     node publish/shots.mjs --dark       dark theme
     node publish/shots.mjs --both       write both, suffixed -light / -dark
     HEADFUL=1 node publish/shots.mjs    watch it happen

   WHY THIS EXISTS, WHEN THE REFERENCE IMPLEMENTATION SAYS "AGENT CAN'T PRODUCE
   THESE".

   The Chrome Web Store will not accept a submission without at least one
   screenshot at exactly 1280x800 or exactly 640x400. Edge and AMO have their
   own comparable requirements. Wrong dimensions are an upload rejection, not a
   nag — and "1276 pixels wide because I cropped it by hand" is the classic
   way to discover that at 11pm.

   The reference lists this as an owner action and calls it impossible for a
   script, and that was true for it. It is not true here: test/browser/smoke.mjs
   already launches a real Chromium with the extension loaded unpacked and opens
   both pages, rendered. Taking a picture of what is already on screen is one
   call. Building it once costs an afternoon; not building it costs 67 sessions
   in an image editor plus a rejection or two.

   AND THE PART THAT ACTUALLY MATTERS: a screenshot taken by hand at v0.1 and
   never regenerated is a description-vs-behaviour mismatch by v1.2, which is
   something the store penalises specifically. A generated one regenerates for
   free on every release, so it cannot drift from the product.

   WHAT IT WILL NOT DO FOR YOU. It photographs the popup and the options page,
   which is the shell. A listing whose only screenshots are a settings page is a
   weak listing: the store wants to see the tool DOING ITS SINGLE PURPOSE. Add a
   case to SHOTS below for your tool's real surface, drive it into the state you
   want photographed, and let this take the picture.

   Output: publish/store/ — which is on the packaging never-list, so nothing
   here can reach a package.
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'publish', 'store');

/* The store's accepted sizes. 1280x800 is the one to use: 640x400 is offered
   for legacy listings and looks soft on any modern display. */
const SHOT_W = 1280, SHOT_H = 800;

/* One entry per picture. `page` is a path inside the extension; `prepare` is
   given the Playwright page and may drive it into whatever state should be
   photographed before the shutter.

   PLACEHOLDER(shots) — add your tool's real surface here. The two below are the
   shell every tool ships; neither of them shows a tool doing its job. */
const SHOTS = [
  {
    name: 'popup',
    page: (mf) => mf.action && mf.action.default_popup,
    /* The popup is 400px wide by design, so photographing it alone would waste
       two thirds of a 1280-wide frame. It is centred on the page background
       instead, which is also how a reviewer will imagine seeing it. */
    frame: 'centre'
  },
  {
    name: 'options',
    page: (mf) => mf.options_page || (mf.options_ui && mf.options_ui.page),
    frame: 'full'
  }
];

/* ---- Playwright, from the fleet location. Same rules as the browser tier;
        this is deliberately the same small resolver rather than a second
        implementation that can drift from it. ---- */
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
  /* The fleet location first, then the same ancestor/sibling fallback the
     browser tier uses — one behaviour, so a run that works there works here. */
  let base = HERE;
  for (let up = 0; up < 7; up++) {
    const entry = probe(path.join(base, '_playwright')) || probe(base);
    if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry };
    const next = path.dirname(base);
    if (next === base) break;
    base = next;
  }
  base = HERE;
  for (let up = 0; up < 7; up++) {
    let kids = [];
    try {
      kids = fs.readdirSync(base, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name[0] !== '.' && d.name !== 'node_modules')
        .slice(0, 80).map(d => path.join(base, d.name));
    } catch (_) {}
    for (const kid of kids) {
      const entry = probe(kid);
      if (entry) return { mod: await import(pathToFileURL(entry).href), from: entry };
      let grands = [];
      try {
        grands = fs.readdirSync(kid, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name[0] !== '.' && d.name !== 'node_modules')
          .slice(0, 40).map(d => path.join(kid, d.name));
      } catch (_) {}
      for (const g of grands) {
        const e2 = probe(g);
        if (e2) return { mod: await import(pathToFileURL(e2).href), from: e2 };
      }
    }
    const next = path.dirname(base);
    if (next === base) break;
    base = next;
  }
  throw new Error('Playwright not found. See test/browser/README.md — there is one install for the whole fleet, in Tools/_playwright/.');
}

const args = process.argv.slice(2);
const wantBoth = args.includes('--both');
const themes = wantBoth ? ['light', 'dark'] : [args.includes('--dark') ? 'dark' : 'light'];

let FAILS = 0;
const ok = (s) => console.log('PASS  ' + s);
const bad = (s) => { FAILS++; console.log('FAIL  ' + s); };

(async () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const { mod, from } = await loadPlaywright();
  console.log('playwright  ' + from);
  fs.mkdirSync(OUT, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-shots-'));
  const ctx = await mod.chromium.launchPersistentContext(userDataDir, {
    headless: !process.env.HEADFUL,
    channel: 'chromium',
    viewport: { width: SHOT_W, height: SHOT_H },
    args: ['--disable-extensions-except=' + ROOT, '--load-extension=' + ROOT, '--no-first-run']
  });

  try {
    /* The extension's own origin, the same way the smoke tier finds it. */
    let extId = null;
    for (let i = 0; i < 40 && !extId; i++) {
      const sw = ctx.serviceWorkers()[0];
      if (sw) extId = new URL(sw.url()).host;
      else await new Promise(r => setTimeout(r, 250));
    }
    if (!extId) throw new Error('the extension never registered a service worker');
    ok('the extension loaded  — chrome-extension://' + extId);

    for (const theme of themes) {
      for (const shot of SHOTS) {
        const rel = shot.page(mf);
        if (!rel) { console.log('SKIP  ' + shot.name + ' — the manifest declares no such page'); continue; }

        const page = await ctx.newPage();
        await page.setViewportSize({ width: SHOT_W, height: SHOT_H });
        /* The theme is a real setting, so it is set the way the product sets
           it rather than by faking prefers-color-scheme — a screenshot of a
           state the product cannot actually be in is a misleading screenshot. */
        await page.goto('chrome-extension://' + extId + '/' + rel.replace(/^\//, ''));
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
          return chrome.storage.sync.set({ theme: t });
        }, theme).catch(() => {});
        if (shot.prepare) await shot.prepare(page);
        await page.waitForTimeout(400);

        /* The popup is narrow. Centre it on the family background rather than
           photographing a 400px sliver in a 1280px frame. */
        if (shot.frame === 'centre') {
          await page.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            const bg = cs.getPropertyValue('--bg') || '#f6f6f9';
            const line = cs.getPropertyValue('--line') || '#e3e3ea';
            document.documentElement.style.background = bg;
            const b = document.body;
            b.style.margin = '0 auto';
            b.style.border = '1px solid ' + line;
            b.style.borderRadius = '14px';
            b.style.overflow = 'hidden';
            b.style.boxShadow = '0 18px 50px rgba(0,0,0,.18)';
            document.documentElement.style.display = 'grid';
            document.documentElement.style.placeItems = 'center';
            document.documentElement.style.minHeight = '100vh';
          });
          await page.waitForTimeout(200);
        }

        const suffix = wantBoth ? '-' + theme : '';
        const file = path.join(OUT, 'screenshot-' + SHOT_W + 'x' + SHOT_H + '-' + shot.name + suffix + '.png');
        await page.screenshot({ path: file, clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H } });
        await page.close();

        /* READ IT BACK. The whole reason this is a script and not a keyboard
           shortcut is that the store rejects a picture that is 1279 wide, and
           a file that exists is not the same thing as a file that is right. */
        const buf = fs.readFileSync(file);
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
        if (w === SHOT_W && h === SHOT_H) {
          ok(path.relative(ROOT, file).replace(/\\/g, '/') + '  ' + w + 'x' + h + '  ' + buf.length + ' bytes');
        } else {
          bad(path.relative(ROOT, file) + ' is ' + w + 'x' + h + ', and the store requires exactly ' + SHOT_W + 'x' + SHOT_H);
        }
      }
    }
  } catch (e) {
    bad(String((e && e.message) || e));
  } finally {
    await ctx.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS') +
    '\nassets in publish/store/ — never packaged, and regenerate them on every release ' +
    'so they cannot drift from the product.');
  process.exit(FAILS ? 1 : 0);
})();
