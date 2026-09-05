#!/usr/bin/env node
/* FullShot REAL-BROWSER e2e — Playwright + the actual extension.

   Loads the unpacked extension into Chromium, opens the torture pages,
   triggers full-page captures through the extension's own service worker
   (exactly like the popup does), pulls the stitched PNG out of IndexedDB,
   saves it to test/e2e/out/, and grades pixel + scoreboard assertions.

   Setup (once):   cd test/e2e && npm install && npx playwright install chromium
   Run:            npm test          (headless)
                   HEADFUL=1 npm test  (watch it happen)
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, '..', '..');   // extension root
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8907;
let FAILS = 0;
const check = (label, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
};

/* ---------- tiny static file server (serves the extension folder) ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve(dir, port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

/* ---------- pixel helpers ---------- */
const near = (a, b, tol = 24) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
/* count rows in which `rgb` appears anywhere (sampled every 4th column) */
function rowsContaining(img, rgb, tol) {
  let rows = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x += 4) {
      const o = (y * img.width + x) * 4;
      if (near([img.data[o], img.data[o + 1], img.data[o + 2]], rgb, tol)) { rows++; break; }
    }
  }
  return rows;
}

/* ---------- redaction: differential helpers ----------
   The redact block used to grade row-colour row-counts: "the red row's colour
   is gone from >=120 of its 140 rows". That measured WHOLE-ROW occlusion, which
   is what v1.7.0 did. v1.9.6 made the bake TOKEN-PRECISE — it paints the
   matched substring's rect, so a 140px row keeps its background everywhere
   outside a ~24px block. Four of those assertions therefore sat red against
   working code; worse, the one that still passed ("decoy left un-redacted,
   >=60 yellow rows") passed for the wrong reason — 140 yellow rows survive
   whether or not the decoy is redacted, so it could not fail.

   The instrument here is a diff against the SAME page captured with redactPII
   OFF. The baseline supplies the "before", so the geometry needs almost no
   hand-calibrated constants: what redaction did is literally the set of pixels
   it changed. Every bound that remains is derived from the fixture's own CSS
   (test/redact-e2e.html) and is quoted where it is used. */

/* The fixture's layout, in fixture units — NOT read off a capture. The
   geometry precondition below refuses to grade anything if the capture stops
   matching, so a re-laid-out fixture fails loudly instead of quietly grading
   the wrong row. */
const RD_HEAD_H = 120, RD_ROW_H = 140, RD_FOOT_H = 152;
const RD_BLOCK = [17, 17, 17];              // .redact block colour baked by the engine
const REDACT_ROWS = [
  { name: 'email', bg: [255, 90, 90],  pii: true  },
  { name: 'phone', bg: [90, 200, 120], pii: true  },
  { name: 'card',  bg: [90, 130, 255], pii: true  },
  { name: 'decoy', bg: [245, 205, 45], pii: false }   // Luhn-invalid: must survive
].map((r, i) => ({ ...r, y0: RD_HEAD_H + i * RD_ROW_H, y1: RD_HEAD_H + (i + 1) * RD_ROW_H }));
const RD_PII_COUNT = REDACT_ROWS.filter(r => r.pii).length;

/* Bounds, each stated in fixture units rather than in observed pixels:
   the rows are 140px tall and their text line box is 15px x 1.4 = 21px. */
const RD_MIN_H = 10;        // shorter than a 15px glyph => it covers nothing
const RD_MAX_H = 60;        // ~2.5 line boxes; a 140px row block is whole-row again
const RD_MIN_GLYPH_PCT = 5; // blank background scores 0; real token text ~20-35%
const RD_MIN_LABEL_PX = 20; // "Email:"/"Call"/"Card" left of the block; swallowed = 0
const RD_MIN_DECOY_PX = 500;// the decoy's 58-char line; a blacked-out row is ~0

/* Pixels that differ between two same-sized captures, grouped into 4-connected
   components. area === w*h answers "is this component a filled rectangle?".
   `strays` counts changed pixels that did NOT become the block colour — i.e.
   evidence the page re-laid-out rather than merely being painted over. */
function diffComponents(off, on) {
  const w = off.width, h = off.height, n = w * h;
  const mask = new Uint8Array(n);
  let changed = 0, strays = 0, strayAt = null;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (off.data[o] === on.data[o] && off.data[o + 1] === on.data[o + 1] &&
        off.data[o + 2] === on.data[o + 2]) continue;
    mask[i] = 1; changed++;
    if (!near([on.data[o], on.data[o + 1], on.data[o + 2]], RD_BLOCK, 12)) {
      strays++;
      if (!strayAt) strayAt = '(' + (i % w) + ',' + ((i / w) | 0) + ')';
    }
  }
  const comps = [], seen = new Uint8Array(n), stack = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = i % w, x1 = x0, y0 = (i / w) | 0, y1 = y0, area = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(); area++;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0     && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0     && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    comps.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return { mask, changed, strays, strayAt, comps, width: w };
}
const changedInBand = (d, y0, y1) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < d.width; x++) if (d.mask[y * d.width + x]) n++;
  return n;
};
/* Pixels in a rect that are NOT the row's flat background — on this fixture the
   only other thing on a row is rendered text, so this counts glyph coverage. */
function glyphPixels(img, bg, x0, y0, x1, y1) {
  if (x1 < x0 || y1 < y0) return 0;             // empty region (e.g. a block at x=0)
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) {
      const o = (y * img.width + x) * 4;
      if (!near([img.data[o], img.data[o + 1], img.data[o + 2]], bg, 24)) n++;
    }
  }
  return n;
}
/* Everything below indexes rows by y. If any of this is wrong the row mapping
   is wrong, and a check that grades the wrong row is worse than no check.
   The bands are sampled on the BASELINE, never on the redacted shot: the
   baseline is the unmodified page, so a bake — however wrong — can never make
   this precondition fire and mask the checks whose job is to catch it. */
function redactFixtureFaults(baseline, shot) {
  const f = [];
  if (baseline.width !== shot.width || baseline.height !== shot.height) {
    f.push('baseline ' + baseline.width + '×' + baseline.height +
           ' but redacted ' + shot.width + '×' + shot.height);
    return f;                                    // no point checking bands
  }
  const want = RD_HEAD_H + REDACT_ROWS.length * RD_ROW_H + RD_FOOT_H;
  if (shot.height !== want) f.push('capture is ' + shot.height + 'px tall, fixture CSS says ' + want);
  for (const r of REDACT_ROWS) {
    const o = ((r.y0 + 4) * baseline.width + (baseline.width - 8)) * 4;  // right margin: past every glyph
    if (!near([baseline.data[o], baseline.data[o + 1], baseline.data[o + 2]], r.bg, 12)) {
      f.push(r.name + ' band at y' + r.y0 + ' is not its background colour');
    }
  }
  return f;
}

/* ---------- one capture ---------- */
async function capture(ctx, sw, name, url) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(1000); // page scripts set up scroll state

  const resultPromise = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'),
    timeout: 240000
  });
  // If we bail out before the result page appears, the abandoned waiter must
  // not crash the process with an unhandled rejection.
  resultPromise.catch(() => {});

  // Find the test tab by URL — from a service worker, {active, currentWindow}
  // can resolve to the browser's initial about:blank tab, which the extension
  // rightly refuses to capture as a protected page.
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === pageUrl) ||
                tabs.find(t => (t.url || '').startsWith('http'));
    if (!tab) throw new Error('test tab not found; open tabs: ' +
      JSON.stringify(tabs.map(t => t.url)));
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 300)); // let activation settle
    const r = await startCapture(tab, 'full', 0);
    if (!r || !r.ok) throw new Error('startCapture failed: ' + (r && r.error));
  }, url);

  const resultPage = await resultPromise;
  await resultPage.waitForSelector('#view:not([hidden])', { timeout: 240000 });

  const b64 = await resultPage.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('id');
    const shot = await FSDB.get('shots', id);
    const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(s);
  });
  const png = Buffer.from(b64, 'base64');
  const file = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(file, png);

  // the torture pages grade themselves — read their scoreboard
  await page.bringToFront();
  await page.waitForTimeout(1500);
  const boardText = await page.evaluate(() => {
    const el = document.getElementById('scoreboard');
    return el ? el.textContent : '';
  });

  const img = decodePng(png);
  console.log('\n=== ' + name + '  (' + img.width + '×' + img.height + ', saved ' + path.relative(process.cwd(), file) + ') ===');
  await resultPage.close();
  await page.close();
  return { img, boardText };
}

/* set extension settings in chrome.storage (opt-in features) via the SW */
async function setSettings(sw, patch) {
  await sw.evaluate(async (p) => { await chrome.storage.sync.set(p); }, patch);
}

/* ---------- test build of the extension ----------
   The shipped manifest uses activeTab: permissions arrive with the user's
   click/shortcut gesture. A test driver has no gesture, so tab.url would be
   invisible and script injection blocked ("protected page"). Load a copy
   whose manifest holds statically what activeTab grants at click-time —
   the engine under test is byte-identical. */
function prepareTestExtension() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-ext-'));
  fs.cpSync(EXT_DIR, tmp, {
    recursive: true,
    filter: src => !src.includes('node_modules') &&
                   !src.includes(path.join('e2e', 'out')) &&
                   !src.includes(path.join('pixel-sim', 'out'))
  });
  const mfPath = path.join(tmp, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  mf.permissions = Array.from(new Set([...(mf.permissions || []), 'tabs']));
  mf.host_permissions = ['<all_urls>'];
  delete mf.optional_host_permissions;
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return tmp;
}

/* ---------- main ---------- */
(async () => {
  const srv = await serve(EXT_DIR, PORT);
  const TEST_EXT = prepareTestExtension();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-extensions-except=' + TEST_EXT,
      '--load-extension=' + TEST_EXT
    ]
  });

  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    check('extension service worker started', !!sw, sw && sw.url());

    /* ---- app shell: the internal-scroll case ---- */
    try {
      const { img, boardText } = await capture(ctx, sw, 'appshell',
        'http://localhost:' + PORT + '/test/appshell.html');
      check('appshell scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture is tall (pane fully unrolled)', img.height > 3600, img.height + 'px');
      const red = rowsContaining(img, [255, 51, 51]);
      check('sticky toolbar appears exactly once (~48 rows)', red >= 30 && red <= 80, red + ' rows');
      const green = rowsContaining(img, [0, 255, 136]);
      check('inner chat DEEP MARKER present (~120 rows)', green >= 80, green + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('pane BOTTOM MARKER present (~152 rows)', blue >= 100, blue + ' rows');
      const fab = rowsContaining(img, [255, 0, 255]);
      check('FAB appears exactly once (~64 rows)', fab >= 40 && fab <= 100, fab + ' rows');
      const footer = rowsContaining(img, [68, 68, 80], 10);
      check('footer present once (~24 rows)', footer >= 12 && footer <= 48, footer + ' rows');
    } catch (e) {
      check('appshell capture completed', false, String(e && e.message || e));
    }

    /* ---- torture page: shadow rail, iframes, walk budget ---- */
    try {
      const { img, boardText } = await capture(ctx, sw, 'torture',
        'http://localhost:' + PORT + '/test/torture.html');
      check('torture scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      const nav = rowsContaining(img, [255, 136, 0], 16);
      check('shadow nav fully expanded (>2000 rows of rail)', nav > 2000, nav + ' rows');
      const green = rowsContaining(img, [0, 255, 136]);
      check('panel DEEP MARKER present', green >= 80, green + ' rows');
      const lime = rowsContaining(img, [136, 255, 0]);
      check('same-origin IFRAME DEEP MARKER present', lime >= 80, lime + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 80, blue + ' rows');
      const fab = rowsContaining(img, [255, 0, 255]);
      check('FAB appears exactly once (~64 rows)', fab >= 40 && fab <= 100, fab + ' rows');
    } catch (e) {
      check('torture capture completed', false, String(e && e.message || e));
    }

    /* ---- embedded virtualized list: inline unroll (v1.6.1, opt-in unrollVirtual) ---- */
    try {
      await setSettings(sw, { unrollVirtual: true });
      const { img, boardText } = await capture(ctx, sw, 'virtualunroll',
        'http://localhost:' + PORT + '/test/virtuallist-e2e.html');
      check('virtualunroll scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture grew tall (embedded list unrolled inline)', img.height > 6500, img.height + 'px');
      const green = rowsContaining(img, [0, 255, 136]);
      check('list DEEP SENTINEL present (deep rows captured)', green >= 80, green + ' rows');
      const rowA = rowsContaining(img, [60, 130, 190], 20);   // #3C82BE even list rows
      check('list body rows present across the whole unroll (>1500 rows)', rowA > 1500, rowA + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present below the unrolled list', blue >= 100, blue + ' rows');
    } catch (e) {
      check('virtualunroll capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { unrollVirtual: false });
    }

    /* ---- interaction-gated content: expand-everything reveal (v1.6.2, opt-in expandInteractive) ---- */
    try {
      await setSettings(sw, { expandInteractive: true });
      const { img, boardText } = await capture(ctx, sw, 'interactive',
        'http://localhost:' + PORT + '/test/interactive-e2e.html');
      check('interactive scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture grew tall (interaction-gated content revealed)', img.height > 1400, img.height + 'px');
      const gold = rowsContaining(img, [255, 200, 0], 20);
      check('collapsed <details> body revealed in the shot', gold >= 300, gold + ' rows');
      const teal = rowsContaining(img, [0, 200, 160], 20);
      check('inactive tab panel revealed in the shot', teal >= 250, teal + ' rows');
      const pink = rowsContaining(img, [200, 80, 160], 20);
      check('[hidden] accordion revealed in the shot', pink >= 200, pink + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 100, blue + ' rows');
    } catch (e) {
      check('interactive capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { expandInteractive: false });
    }

    /* ---- multi-carousel page: merged-right must NOT misfire (v1.6.3) ---- */
    try {
      await setSettings(sw, { unrollVirtual: false, expandInteractive: false });
      const { img, boardText } = await capture(ctx, sw, 'multicarousel',
        'http://localhost:' + PORT + '/test/multicarousel-e2e.html');
      check('multicarousel scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture NOT ballooned sideways (width near viewport, not a wide grid)',
        img.width < 2000, img.width + 'px wide');
      const red = rowsContaining(img, [255, 51, 51], 20);
      check('sticky nav appears once (~60 rows, no diagonal striping)', red >= 40 && red <= 120, red + ' rows');
      const orange = rowsContaining(img, [230, 140, 40], 24);
      check('carousel row captured as-seen (first items visible)', orange >= 150, orange + ' rows');
      const green = rowsContaining(img, [0, 255, 136]);
      check('deep marker in lower block present', green >= 80, green + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 100, blue + ' rows');
    } catch (e) {
      check('multicarousel capture completed', false, String(e && e.message || e));
    }

    /* ---- late/lazy image must not capture black (v1.6.4 adaptive decode) ---- */
    try {
      const { img, boardText } = await capture(ctx, sw, 'lazyimage',
        'http://localhost:' + PORT + '/test/lazyimage-e2e.html');
      check('lazyimage scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      const green = rowsContaining(img, [0, 255, 136], 24);
      check('decoded hero image present (green, not black)', green >= 150, green + ' rows');
      // the hero band (y 120..320) must not be a black tile
      let black = 0;
      for (let y = 130; y < 310 && y < img.height; y++) {
        const o = (y * img.width + (img.width >> 1)) * 4;
        if (img.data[o] < 20 && img.data[o + 1] < 20 && img.data[o + 2] < 20) black++;
      }
      check('hero is not a black tile', black <= 10, black + ' black rows in hero band');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 100, blue + ' rows');
    } catch (e) {
      check('lazyimage capture completed', false, String(e && e.message || e));
    }

    /* ---- lazy footer must not be truncated (v1.6.5 adaptive bottom re-measure) ---- */
    try {
      const { img, boardText } = await capture(ctx, sw, 'lazyfooter',
        'http://localhost:' + PORT + '/test/lazyfooter-e2e.html');
      check('lazyfooter scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      const green = rowsContaining(img, [0, 255, 136], 20);
      check('lazy footer tail captured (green, ~260 rows) — not truncated', green >= 200, green + ' rows');
      const blue = rowsContaining(img, [0, 136, 255], 20);
      check('copyright bar at the very bottom captured (blue)', blue >= 25, blue + ' rows');
      // the copyright bar should be near the very bottom of the capture
      const bottomBand = (() => { let n = 0; for (let y = img.height - 30; y < img.height; y++) {
        const o = (y * img.width + (img.width >> 1)) * 4;
        if (Math.abs(img.data[o] - 0) <= 30 && Math.abs(img.data[o+1] - 136) <= 30 && Math.abs(img.data[o+2] - 255) <= 30) n++; } return n; })();
      check('capture ends at the true bottom (copyright is the last band)', bottomBand >= 10, bottomBand + ' rows in bottom 30px');
    } catch (e) {
      check('lazyfooter capture completed', false, String(e && e.message || e));
    }

    /* ---- scroll-lock + consent/modal overlays (v1.6.6 hide distractions) ---- */
    try {
      await setSettings(sw, { hideOverlays: true });
      const { img, boardText } = await capture(ctx, sw, 'overlay',
        'http://localhost:' + PORT + '/test/overlay-e2e.html');
      check('overlay scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('full page captured past the scroll-lock (tall, not one screen)', img.height > 1800, img.height + 'px');
      const green = rowsContaining(img, [0, 255, 136], 24);
      check('deep content behind the lock captured (green)', green >= 60, green + ' rows');
      const orange = rowsContaining(img, [255, 140, 0], 30);
      check('cookie banner NOT in the shot', orange <= 5, orange + ' orange rows');
      const purple = rowsContaining(img, [150, 80, 200], 30);
      check('modal dialog NOT in the shot', purple <= 5, purple + ' purple rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 100, blue + ' rows');
    } catch (e) {
      check('overlay capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { hideOverlays: false });
    }

    /* ---- network "load more" button: click-then-wait-for-append (v1.6.11, opt-in loadMore) ---- */
    try {
      await setSettings(sw, { loadMore: true });
      const { img, boardText } = await capture(ctx, sw, 'loadmore',
        'http://localhost:' + PORT + '/test/loadmore-e2e.html');
      check('loadmore scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture grew tall (full feed loaded via the button)', img.height > 2000, img.height + 'px');
      const deep = rowsContaining(img, [0, 200, 120], 24);
      check('deep feed item #18 present (appended by the loop)', deep >= 80, deep + ' rows');
      const orange = rowsContaining(img, [230, 120, 40], 24);
      check('"Load more" button gone from the shot (feed exhausted)', orange <= 5, orange + ' orange rows');
      const body = rowsContaining(img, [90, 160, 210], 20);
      check('full feed body present (>1500 rows)', body > 1500, body + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present below the feed', blue >= 100, blue + ' rows');
    } catch (e) {
      check('loadmore capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { loadMore: false });
    }

    /* ---- infinite-scroll feed, no button: scroll-until-stable (v1.6.12, opt-in infiniteScroll) ---- */
    try {
      await setSettings(sw, { infiniteScroll: true });
      const { img, boardText } = await capture(ctx, sw, 'infinitescroll',
        'http://localhost:' + PORT + '/test/infinitescroll-e2e.html');
      check('infinitescroll scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture grew tall (full infinite feed scrolled in)', img.height > 2000, img.height + 'px');
      const deep = rowsContaining(img, [0, 210, 130], 24);
      check('deep feed item #22 present (scrolled in)', deep >= 80, deep + ' rows');
      const body = rowsContaining(img, [70, 150, 200], 24);
      check('full feed body present (>1500 rows)', body > 1500, body + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present below the feed', blue >= 100, blue + ' rows');
    } catch (e) {
      check('infinitescroll capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { infiniteScroll: false });
    }

    /* ---- skeleton -> data mid-page swap: wait-for-DOM-stability (v1.6.13, opt-in waitStable) ---- */
    try {
      await setSettings(sw, { waitStable: true });
      const { img, boardText } = await capture(ctx, sw, 'skeleton',
        'http://localhost:' + PORT + '/test/skeleton-e2e.html');
      check('skeleton scoreboard: ALL PASS', boardText.includes('ALL PASS'),
        boardText.split('\n')[0]);
      check('capture grew tall (real data settled in, not skeleton height)', img.height > 2000, img.height + 'px');
      const deep = rowsContaining(img, [0, 210, 122], 24);
      check('deep real-data marker present (settled in)', deep >= 80, deep + ' rows');
      const body = rowsContaining(img, [80, 160, 120], 24);
      check('full real content present (>1500 rows)', body > 1500, body + ' rows');
      const skel = rowsContaining(img, [210, 210, 216], 10);
      check('no skeleton/placeholder pixels remain', skel < 40, skel + ' rows');
      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present below the content', blue >= 100, blue + ' rows');
    } catch (e) {
      check('skeleton capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { waitStable: false });
    }

    /* ---- auto-redact PII (v1.7.0, opt-in redactPII; graded against a
       redactPII-OFF baseline \u2014 see the diff helpers above) ---- */
    try {
      /* The baseline is the same page, same viewport, captured with the feature
         off. It is what makes the rest of this block state what redaction DID
         rather than guess at absolute pixel counts. Two independent runs of
         this pair produce byte-identical diffs, so the strict assertions below
         (exactly three components, zero stray pixels) are safe to make. */
      await setSettings(sw, { redactPII: false });
      const baseline = await capture(ctx, sw, 'redact-baseline',
        'http://localhost:' + PORT + '/test/redact-e2e.html');

      await setSettings(sw, { redactPII: true });
      const { img, boardText } = await capture(ctx, sw, 'redact',
        'http://localhost:' + PORT + '/test/redact-e2e.html');

      check('redact scoreboard: ALL PASS (source DOM untouched \u2014 leave-no-trace)',
        boardText.includes('ALL PASS'), boardText.split('\n')[0]);

      const faults = redactFixtureFaults(baseline.img, img);
      check('redact fixture geometry is what the row checks assume',
        faults.length === 0,
        faults.length ? faults.join('; ')
                      : img.width + '\u00d7' + img.height + ', ' + REDACT_ROWS.length + ' bands verified');

      const d = diffComponents(baseline.img, img);
      check('redaction changed the capture at all (a block was actually baked)',
        d.changed > 0,
        d.changed + ' px differ from the un-redacted baseline');

      /* An empty change set makes "all changed pixels are black" vacuously
         true, which is the same disease as a claim that reports success from a
         setting. The non-empty requirement is part of the check, not a
         precondition someone can delete. */
      check('the only edit is the block colour painted on top (no re-layout, no bleed-through)',
        d.changed > 0 && d.strays === 0,
        d.changed === 0 ? 'nothing changed at all'
          : d.strays + ' of ' + d.changed + ' changed px are not rgb(17,17,17)' +
            (d.strayAt ? ', first at ' + d.strayAt : ''));

      const hits = REDACT_ROWS.map(r => ({
        row: r,
        blocks: d.comps.filter(c => { const cy = (c.y0 + c.y1) >> 1; return cy >= r.y0 && cy < r.y1; })
      }));
      const strayBlocks = d.comps.length - hits.reduce((n, x) => n + x.blocks.length, 0);
      check('one block on each PII row, none on the decoy and none off-row',
        strayBlocks === 0 && hits.every(x => x.blocks.length === (x.row.pii ? 1 : 0)),
        hits.map(x => x.row.name + '=' + x.blocks.length).join(' ') +
        ', outside every row=' + strayBlocks);

      check('each block is a solid filled rectangle',
        d.comps.length > 0 && d.comps.every(c => c.area === c.w * c.h),
        d.comps.length ? d.comps.map(c => c.w + '\u00d7' + c.h +
          (c.area === c.w * c.h ? '' : ' NOT FILLED (' + c.area + 'px)')).join(', ')
          : 'no blocks at all');

      /* From here on every check demands all three boxes. A short list must
         FAIL, never pass over the boxes that happen to exist. */
      const boxes = hits.filter(x => x.row.pii && x.blocks.length === 1)
                        .map(x => ({ name: x.row.name, bg: x.row.bg, row: x.row, r: x.blocks[0] }));
      const missing = RD_PII_COUNT - boxes.length;
      const short = missing + ' of ' + RD_PII_COUNT + ' PII rows have no block at all';

      /* Shape AND place. A block is only token-precise if it is the height of a
         line box rather than of a row, and if it stays on the row that owns the
         token \u2014 one that bleeds into the header is painting over content that
         was never PII. */
      const badBox = boxes.filter(b => b.r.h < RD_MIN_H || b.r.h > RD_MAX_H ||
                                       b.r.y0 < b.row.y0 || b.r.y1 >= b.row.y1);
      check('each block is token-height and stays inside its own row (v1.9.6 token-precise bake)',
        missing === 0 && badBox.length === 0,
        missing ? short : boxes.map(b => b.name + ' h=' + b.r.h +
          (b.r.y0 < b.row.y0 || b.r.y1 >= b.row.y1 ? ' SPILLS y' + b.r.y0 + '..' + b.r.y1 +
            ' out of ' + b.row.y0 + '..' + (b.row.y1 - 1) : '')).join(' ') +
          '  (line box 21px, row ' + RD_ROW_H + 'px, allowed h ' + RD_MIN_H + '..' + RD_MAX_H + ')');

      /* THE claim: the block sits on the PII glyphs. Measured in the BASELINE,
         where the text is still visible \u2014 a block over blank background scores
         0% and a block over a rendered token scores ~20-35%.
         Clamped to the row band, because outside it the row's background colour
         is the wrong yardstick: a block spilling into the dark header would
         score every header pixel as "glyph" and pass for the wrong reason. */
      const cover = boxes.map(b => {
        const y0 = Math.max(b.r.y0, b.row.y0), y1 = Math.min(b.r.y1, b.row.y1 - 1);
        const area = (b.r.x1 - b.r.x0 + 1) * Math.max(0, y1 - y0 + 1);
        return { name: b.name,
                 pct: area ? glyphPixels(baseline.img, b.bg, b.r.x0, y0, b.r.x1, y1) / area * 100 : 0 };
      });
      check('each block landed on rendered PII text, not on blank background',
        missing === 0 && cover.every(c => c.pct >= RD_MIN_GLYPH_PCT),
        missing ? short : cover.map(c => c.name + '=' + c.pct.toFixed(1) + '%').join(' ') +
          ' of the block (within its row) was glyph before redaction (need >=' + RD_MIN_GLYPH_PCT + '%)');

      /* The other half of "token-precise": the non-PII label on the same line
         is still readable. Whole-leaf redaction swallows it and scores 0. */
      const label = boxes.map(b => ({
        name: b.name,
        px: glyphPixels(baseline.img, b.bg, 0,                        // clamped to the row, as above
              Math.max(b.r.y0, b.row.y0), b.r.x0 - 1, Math.min(b.r.y1, b.row.y1 - 1))
      }));
      check('each block spares the non-PII label to its left ("Email:", "Call", "Card")',
        missing === 0 && label.every(l => l.px >= RD_MIN_LABEL_PX),
        missing ? short : label.map(l => l.name + '=' + l.px + 'px').join(' ') +
          ' of label glyph survives left of the block (need >=' + RD_MIN_LABEL_PX + ')');

      /* False-positive guard. The old version of this check counted surviving
         yellow rows, which stayed at 140 whether or not the decoy was redacted.
         Byte-identity is the claim that actually has teeth. */
      const decoyRow = REDACT_ROWS.find(r => !r.pii);
      const decoyChanged = changedInBand(d, decoyRow.y0, decoyRow.y1);
      const decoyGlyph = glyphPixels(img, decoyRow.bg, 0, decoyRow.y0, img.width - 1, decoyRow.y1 - 1);
      check('Luhn-invalid decoy row is untouched and still legible (no false positive)',
        decoyChanged === 0 && decoyGlyph >= RD_MIN_DECOY_PX,
        decoyChanged + ' px changed, ' + decoyGlyph + ' glyph px still rendered' +
          ' (need 0 changed, >=' + RD_MIN_DECOY_PX + ' glyph)');

      const blue = rowsContaining(img, [0, 136, 255]);
      check('page BOTTOM MARKER present', blue >= 100, blue + ' rows');
    } catch (e) {
      check('redact capture completed', false, String(e && e.message || e));
    } finally {
      await setSettings(sw, { redactPII: false });
    }
  } catch (e) {
    check('e2e run completed', false, String(e && e.message || e));
  } finally {
    await ctx.close();
    srv.close();
  }

  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
  process.exit(FAILS ? 1 : 0);
})();
