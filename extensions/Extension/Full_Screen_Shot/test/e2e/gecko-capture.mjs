/* ============================================================================
   gecko-capture.mjs — a REAL capture, taken by the packed Firefox add-on, in
   Firefox (2026-09-29, O-FIREFOX-BUILD-NEVER-RUN-IN-A-BROWSER limb 2; rv2
   findings EXB-09 and EXB-17).

   gecko-smoke.mjs proves the add-on installs, its background loads and four
   pages open. It never takes a picture: no captureVisibleTab, no content/*.js
   injected, no stitch, and result, editor, beautify and scrollclip never open
   in Firefox. This suite drives the product the way the popup does — a page
   sends START_CAPTURE to the background router with a tab id — and grades what
   comes out:
     · VISIBLE   the stitched image is the viewport, at the page's DPR;
     · FULL      test/torture.html end to end: content/capture.js injected, the
                 page scrolled, every frame grabbed, result.html stitches an
                 image whose height is the page's, with the deep markers in it;
     · REGION    content/region.js injected, a real pointer drag, the crop is
                 the dragged rectangle;
     · TALL      a page taller than result.js MAX_DIM: the stitch splits into
                 parts no taller than MAX_DIM, each part DECODES at its declared
                 size and carries its own marker band (a part the engine could
                 not allocate comes back blank or not at all, and is caught);
     · WEBP      the imageFormat=webp capture is an image/webp Firefox decodes;
     · WEBM      scrollclip's own fsPickWebmMime + fsRecordWebM produce a
                 video/webm blob (or the page's declared GIF fallback: that is
                 recorded, not failed);
     · PAGES     result, editor, beautify and scrollclip open on that capture
                 and reach their ready state, with no uncaught error;
     · REFUSAL   a page Firefox forbids to extensions (the profile's
                 extensions.webextensions.restrictedDomains names the fixture
                 host "localhost") is refused with the BLOCKED sentence, never
                 with the reload-and-retry one — the Gecko wording of the
                 refusal is printed so background.js can be held to it.

   Every grade runs on the PACKED Firefox tree (packed-lib.mjs: pack.mjs
   --target firefox plus the one asserted delta), over raw WebDriver BiDi
   (bidi-lib.mjs). The fixture pages are served from this checkout; the tall
   page is generated here, so no fixture file is added.

   RED CONTROLS (run by hand; each reddens exactly its limb):
     · break content/capture.js injection (background.js startCapture: inject
       'content/capture.jsx') -> FULL and TALL fail, exit 1 (measured
       2026-09-29, Firefox 156.0.1: 14 pass 5 fail);
     · raise result.js MAX_DIM to 40000 -> the TALL page stitches as ONE part and
       TALL fails on the split, exit 1 (measured 2026-09-29, 32 pass 1 fail).
   NOT MEASURED: a part the ENGINE refuses to allocate. The profile's
   gfx.canvas.max-size would force one (FS_GECKO_CANVAS_MAX, below); the run that
   was to measure it could not finish, so which TALL line reddens is open.

   MEASURED 2026-09-29, Firefox 156.0.1, Windows, DPR 1: with MAX_DIM raised to
   40000 Firefox allocated, encoded and decoded ONE 1366x34000 part, band for
   band. So result.js's 16000 is conservative for Gecko, not at its edge; the
   limit the constant guards is Chromium's.

   STOPS, EXIT 2 (COVERAGE LOST): no Firefox, one older than the manifest's
   strict_min_version, or BiDi refusing install, navigation or script.
   Exit: 0 green · 1 a finding · 2 coverage lost.
   ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { packedExtension, coverageLost, EXT_DIR } from './packed-lib.mjs';
import { firefoxVersion, launchFirefox, evalJson, topContext, FIREFOX_BIN } from './bidi-lib.mjs';

const PORT = Number(process.env.PORT || 8941);
/* result.js's own limits, read from the file the package ships, so a change to
   either is graded against the new value rather than a copy typed here. */
const RESULT_SRC = fs.readFileSync(path.join(EXT_DIR, 'pages', 'result.js'), 'utf8');
const MAX_DIM = Number((/const MAX_DIM = (\d+)/.exec(RESULT_SRC) || [])[1]);
const MAX_AREA = String((/const MAX_AREA = ([\d.e* ]+);/.exec(RESULT_SRC) || [])[1] || 'NaN')
  .split('*').reduce((a, f) => a * Number(f.trim()), 1);
if (!(MAX_DIM > 0) || !(MAX_AREA > 0)) coverageLost('pages/result.js declares no readable MAX_DIM / MAX_AREA');
const TALL_H = 34000;   // past MAX_DIM twice over: three parts at the shipped limit

let passes = 0;
const fails = [];
const check = (label, ok, extra) => {
  if (ok) passes++; else fails.push(label + (extra != null ? '  — ' + extra : ''));
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- the fixture server: test/ from this checkout, plus /tall.html ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const TEST_DIR = path.join(EXT_DIR, 'test');
const BANDS = [[255, 0, 0], [0, 160, 0], [0, 0, 255]];   // one per expected part
function tallPage(h) {
  /* A solid band every MAX_DIM px, in the colour of the part it should land in,
     and a grey ramp between, so a blank or truncated part has nothing to match. */
  const bands = [];
  for (let y = 0, i = 0; y < h; y += MAX_DIM, i++) {
    const c = BANDS[i % BANDS.length];
    bands.push('<div style="position:absolute;left:0;right:0;top:' + (y + 400) + 'px;height:300px;background:rgb(' + c.join(',') + ')"></div>');
  }
  return '<!doctype html><meta charset="utf-8"><title>tall</title><style>html,body{margin:0}body{height:' + h + 'px;position:relative;' +
    'background:repeating-linear-gradient(#ddd 0 50px,#bbb 50px 100px)}</style>' + bands.join('') +
    '<div style="position:absolute;left:0;right:0;top:' + (h - 300) + 'px;height:300px;background:rgb(255,0,255)"></div>';
}
const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/tall.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    return res.end(tallPage(Number(url.searchParams.get('h')) || TALL_H));
  }
  if (url.pathname === '/plain.html') {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    return res.end('<!doctype html><meta charset="utf-8"><title>plain</title><body style="margin:0;background:rgb(10,120,200)"><p style="color:#fff;font:40px sans-serif;padding:40px">plain</p>');
  }
  const file = path.join(TEST_DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(TEST_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', resolve); })
  .catch(e => coverageLost('the fixture server could not listen on 127.0.0.1:' + PORT + ' (' + e.message + '); set PORT'));
const ORIGIN = 'http://127.0.0.1:' + PORT;
/* "localhost" resolves to the same server, and the profile forbids it to every
   add-on — which is how the refusal limb gets a real Gecko refusal offline. */
const BLOCKED_ORIGIN = 'http://localhost:' + PORT;

/* ---------- Firefox ---------- */
const v = firefoxVersion();
if (!v) coverageLost('no Firefox at ' + FIREFOX_BIN + ' (set FS_E2E_FIREFOX); the Gecko suites cannot run');
console.log('firefox: ' + v.text);
const ext = packedExtension('firefox');
const minMajor = parseInt(String(ext.packedManifest.browser_specific_settings.gecko.strict_min_version), 10);
if (v.major < minMajor) coverageLost('Firefox ' + v.major + ' is older than the manifest floor ' + minMajor);
const addonId = ext.packedManifest.browser_specific_settings.gecko.id;
const prefs = { 'extensions.webextensions.restrictedDomains': 'localhost' };
if (process.env.FS_GECKO_CANVAS_MAX) {
  prefs['gfx.canvas.max-size'] = Number(process.env.FS_GECKO_CANVAS_MAX);
  console.log('RED-CONTROL MODE: gfx.canvas.max-size = ' + prefs['gfx.canvas.max-size'] + ' (CI never sets it)');
}
const ff = await launchFirefox({ addonId, extraPrefs: prefs })
  .catch(e => coverageLost('Firefox did not start a BiDi session: ' + e.message));
const base = () => 'moz-extension://' + ff.uuid + '/';

async function contexts() {
  const tree = await ff.send('browsingContext.getTree', {});
  return tree.contexts || [];
}
async function waitForContext(pred, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const c = (await contexts()).find(pred);
    if (c) return c;
    await sleep(500);
  }
  throw new Error('no ' + what + ' within ' + ms + ' ms; open: ' + (await contexts()).map(c => c.url).join(' '));
}
async function openTab(url) {
  const { context } = await ff.send('browsingContext.create', { type: 'tab' });
  if (!/^moz-extension:/.test(url)) webContexts.add(context);
  await ff.send('browsingContext.navigate', { context, url, wait: 'complete' });
  return context;
}
const closeCtx = c => ff.send('browsingContext.close', { context: c }).catch(() => {});
/* The web pages this suite opens: their own console is the page's business
   (torture.html's cross-origin iframe, a blocked fixture), not the add-on's. */
const webContexts = new Set();
/* Waits in a page for a selector to be shown; resolves true/false, never throws. */
/* Polled from here, one short evaluate at a time: a single evaluate that waited
   the whole span would outlive bidi-lib's per-call ceiling and turn a page that
   never got ready (a finding) into a timeout (coverage lost). */
async function shown(ctx, sel, ms) {
  const until = Date.now() + ms;
  const probe = '(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); return !!(e && !e.hidden && !e.closest("[hidden]")); })()';
  while (Date.now() < until) {
    if (await evalJson(ff, ctx, probe).catch(() => false)) return true;
    await sleep(500);
  }
  const said = await evalJson(ff, ctx, 'Promise.resolve(document.body ? document.body.innerText.slice(0, 200) : "")').catch(e => String(e.message));
  console.log('  NOTE  ' + sel + ' never shown; the page says: ' + JSON.stringify(said));
  return false;
}

/* Everything a grade needs, measured INSIDE result.html: no image crosses BiDi.
   Per part: its declared size, what createImageBitmap decodes, the blob type,
   and how many rows carry each probe colour. */
const SHOT_STATS = `(async (colours) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  if (!shot) return { id, missing: true };
  const near = (d, o, c, tol) => Math.abs(d[o] - c[0]) <= tol && Math.abs(d[o + 1] - c[1]) <= tol && Math.abs(d[o + 2] - c[2]) <= tol;
  const parts = [];
  for (const s of shot.segments) {
    const p = { w: s.w, h: s.h, type: s.blob.type, bytes: s.blob.size };
    try {
      const bmp = await createImageBitmap(s.blob);
      p.dw = bmp.width; p.dh = bmp.height;
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      p.rows = {};
      for (const [name, rgb, tol] of colours) {
        let rows = 0;
        for (let y = 0; y < bmp.height; y++) {
          for (let x = 0; x < bmp.width; x += 4) { if (near(d, (y * bmp.width + x) * 4, rgb, tol)) { rows++; break; } }
        }
        p.rows[name] = rows;
      }
    } catch (e) { p.decodeError = String(e && e.message || e); }
    parts.push(p);
  }
  return { id, shotId: shot.id, parts };
})`;

/* One capture of `url` in `mode`, the way the popup starts one; resolves with
   the result context and the stats, or throws with the router's answer. */
async function capture(ctl, url, mode, { colours = [], during = null, keepResult = false } = {}) {
  const tab = await openTab(url);
  await sleep(1000);
  const before = new Set((await contexts()).map(c => c.context));
  const started = await evalJson(ff, ctl, '(async () => { const tabs = await chrome.tabs.query({}); const t = tabs.find(x => x.url === ' + JSON.stringify(url) + ');' +
    ' if (!t) return { ok: false, error: "test tab not found: " + tabs.map(x => x.url).join(" ") };' +
    ' await chrome.tabs.update(t.id, { active: true }); await new Promise(r => setTimeout(r, 400));' +
    ' return chrome.runtime.sendMessage({ type: "START_CAPTURE", tabId: t.id, mode: ' + JSON.stringify(mode) + ' }); })()');
  if (!started || !started.ok) { await closeCtx(tab); return { started }; }
  if (during) await during(tab);
  const rc = await waitForContext(c => !before.has(c.context) && /\/pages\/result\.html\?id=/.test(c.url), 240000, 'result.html for ' + mode);
  const ready = await shown(rc.context, '#view', 120000);
  const stats = ready ? await evalJson(ff, rc.context, SHOT_STATS + '(' + JSON.stringify(colours) + ')') : null;
  const page = await evalJson(ff, tab, '(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, H: document.documentElement.scrollHeight, board: (document.getElementById("scoreboard") || {}).textContent || "" }))()');
  await closeCtx(tab);
  if (!keepResult) await closeCtx(rc.context);
  return { started, ready, stats, page, result: rc.context };
}

let exitCode = 0;
const errors = [];
try {
  /* Every error-level entry from anything but a fixture page: the extension
     pages and the background. The one console.error the refusal limb provokes
     on purpose (startCapture's developer copy) is printed, not counted. */
  ff.on('log.entryAdded', e => {
    if (e.level !== 'error') return;
    const ctx = e.source && e.source.context;
    if (ctx && webContexts.has(ctx)) return;
    if (/FullShot could not start the capture/.test(String(e.text))) { console.log('  (background console.error, expected on the refusal limb: ' + e.text + ')'); return; }
    errors.push((ctx || 'no-context') + ' ' + e.text);
  });
  await ff.send('session.subscribe', { events: ['log.entryAdded'] });
  let installed;
  try { installed = await ff.send('webExtension.install', { extensionData: { type: 'path', path: ext.dir } }); }
  catch (e) { coverageLost('webExtension.install refused the packed Firefox tree: ' + e.message); }
  check('Firefox installs the packed add-on under the id the manifest pins', installed && installed.extension === addonId, JSON.stringify(installed));

  /* The controller: an extension page, which is what the popup is. */
  const ctl = await topContext(ff);
  try { await ff.send('browsingContext.navigate', { context: ctl, url: base() + 'pages/history.html', wait: 'complete' }); }
  catch (e) { coverageLost('moz-extension navigation was refused: ' + e.message); }
  const diag = await evalJson(ff, ctl, 'chrome.runtime.sendMessage({ type: "DIAGNOSTIC_BUNDLE" }).then(r => r && r.bundle && r.bundle.browser)')
    .catch(e => coverageLost('script.evaluate was refused in the controller page: ' + e.message));
  console.log('background answers as: ' + diag);
  await evalJson(ff, ctl, 'chrome.storage.sync.set({ imageFormat: "png" }).then(() => true)');

  /* ── VISIBLE ─────────────────────────────────────────────────────────── */
  console.log('\n=== visible ===');
  const vis = await capture(ctl, ORIGIN + '/plain.html', 'visible', { colours: [['blue', [10, 120, 200], 12]] });
  check('visible: the router starts the capture', vis.started && vis.started.ok, JSON.stringify(vis.started));
  if (vis.stats && !vis.stats.missing) {
    const p = vis.stats.parts[0];
    const want = { w: Math.round(vis.page.w * vis.page.dpr), h: Math.round(vis.page.h * vis.page.dpr) };
    console.log('  viewport ' + vis.page.w + 'x' + vis.page.h + ' @' + vis.page.dpr + ' -> part ' + JSON.stringify(p));
    check('visible: result.html opened and holds one part', vis.stats.parts.length === 1, vis.stats.parts.length + ' part(s)');
    check('visible: the part decodes at the viewport size (±2 px)', Math.abs(p.dw - want.w) <= 2 && Math.abs(p.dh - want.h) <= 2, p.dw + 'x' + p.dh + ' vs ' + want.w + 'x' + want.h);
    check('visible: it is the page (most rows carry its background)', p.rows && p.rows.blue >= p.dh * 0.8, (p.rows && p.rows.blue) + ' of ' + p.dh + ' rows');
  } else check('visible: result.html opened with the stitched shot', false, JSON.stringify(vis.stats));

  /* ── FULL: the torture page ──────────────────────────────────────────── */
  console.log('\n=== full: torture.html ===');
  const full = await capture(ctl, ORIGIN + '/torture.html', 'full', {
    colours: [['panel', [0, 255, 136], 24], ['iframe', [136, 255, 0], 24], ['bottom', [0, 136, 255], 24], ['fab', [255, 0, 255], 24]]
  });
  check('full: the router starts the capture (content/capture.js injected)', full.started && full.started.ok, JSON.stringify(full.started));
  let fullShotId = null;
  if (full.stats && !full.stats.missing) {
    fullShotId = full.stats.shotId;
    const parts = full.stats.parts;
    const H = parts.reduce((a, p) => a + (p.dh || 0), 0);
    const want = Math.round(full.page.H * full.page.dpr);
    const sum = k => parts.reduce((a, p) => a + ((p.rows && p.rows[k]) || 0), 0);
    console.log('  page ' + full.page.w + 'x' + full.page.H + ' @' + full.page.dpr + ' -> ' + parts.map(p => p.dw + 'x' + p.dh).join(' + '));
    check('full: every part decodes at its declared size', parts.every(p => p.dw === p.w && p.dh === p.h), JSON.stringify(parts.map(p => [p.w, p.h, p.dw, p.dh, p.decodeError])));
    /* Not EQUAL to the page: expandInner (on by default) unrolls the rail, the
       inner panel and the iframe, so the picture is taller than the page left
       behind. Never SHORTER — that is a lost frame. */
    check('full: the stitched height is at least the page height', H >= want - 2, H + ' vs page ' + want);
    check('full: the page BOTTOM marker is in the image', sum('bottom') >= 80, sum('bottom') + ' rows');
    check('full: the inner panel DEEP marker is in the image (panel expanded)', sum('panel') >= 80, sum('panel') + ' rows');
    check('full: the same-origin iframe DEEP marker is in the image', sum('iframe') >= 80, sum('iframe') + ' rows');
    check('full: the fixed FAB appears once, not per frame', sum('fab') >= 40 && sum('fab') <= 100, sum('fab') + ' rows');
    console.log('  torture scoreboard (the page grades itself; printed, not graded): ' + full.page.board.split('\n')[0]);
  } else check('full: result.html opened with the stitched shot', false, JSON.stringify(full.stats || full.started));

  /* ── REGION: a real drag ─────────────────────────────────────────────── */
  console.log('\n=== region ===');
  const drag = { x0: 100, y0: 120, x1: 500, y1: 420 };
  const reg = await capture(ctl, ORIGIN + '/plain.html', 'region', {
    colours: [['blue', [10, 120, 200], 12]],
    during: async (tab) => {
      await sleep(1200);   // region.js injected and its overlay painted
      await ff.send('input.performActions', { context: tab, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: drag.x0, y: drag.y0 }, { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', x: (drag.x0 + drag.x1) >> 1, y: (drag.y0 + drag.y1) >> 1, duration: 100 },
        { type: 'pointerMove', x: drag.x1, y: drag.y1, duration: 100 }, { type: 'pointerUp', button: 0 }] }] });
    }
  });
  check('region: the router starts the capture (content/region.js injected)', reg.started && reg.started.ok, JSON.stringify(reg.started));
  if (reg.stats && !reg.stats.missing) {
    const p = reg.stats.parts[0];
    const want = { w: Math.round((drag.x1 - drag.x0) * reg.page.dpr), h: Math.round((drag.y1 - drag.y0) * reg.page.dpr) };
    check('region: the crop is the dragged rectangle (±3 px)', Math.abs(p.dw - want.w) <= 3 && Math.abs(p.dh - want.h) <= 3, p.dw + 'x' + p.dh + ' vs ' + want.w + 'x' + want.h);
    check('region: the crop is the page, not the overlay', p.rows && p.rows.blue >= p.dh * 0.8, (p.rows && p.rows.blue) + ' of ' + p.dh + ' rows');
  } else check('region: result.html opened with the cropped shot', false, JSON.stringify(reg.stats || reg.started));

  /* ── TALL: past MAX_DIM and past the engine's canvas edge ────────────── */
  console.log('\n=== tall: ' + TALL_H + ' css px (MAX_DIM ' + MAX_DIM + ', MAX_AREA ' + MAX_AREA + ') ===');
  const tallColours = BANDS.map((c, i) => ['band' + i, c, 8]).concat([['end', [255, 0, 255], 8]]);
  const tall = await capture(ctl, ORIGIN + '/tall.html?h=' + TALL_H, 'full', { colours: tallColours });
  check('tall: the router starts the capture', tall.started && tall.started.ok, JSON.stringify(tall.started));
  if (tall.stats && !tall.stats.missing) {
    const parts = tall.stats.parts;
    const H = parts.reduce((a, p) => a + (p.dh || 0), 0);
    const want = Math.round(tall.page.H * tall.page.dpr);
    console.log('  parts: ' + parts.map(p => p.dw + 'x' + p.dh + (p.decodeError ? ' (' + p.decodeError + ')' : '')).join(' + '));
    check('tall: split into more than one part', parts.length >= 2, parts.length + ' part(s)');
    check('tall: no part is taller or wider than MAX_DIM, or larger than MAX_AREA', parts.every(p => p.h <= MAX_DIM && p.w <= MAX_DIM && p.w * p.h <= MAX_AREA),
      JSON.stringify(parts.map(p => [p.w, p.h])));
    check('tall: every part DECODES at its declared size in Firefox', parts.every(p => !p.decodeError && p.dw === p.w && p.dh === p.h),
      JSON.stringify(parts.map(p => [p.w, p.h, p.dw, p.dh, p.decodeError])));
    check('tall: the parts add up to the page (±1%)', Math.abs(H - want) <= Math.max(4, want * 0.01), H + ' vs ' + want);
    /* Band i sits at i*MAX_DIM+400 CSS px; at DPR 1 it lands in part i. */
    const perPart = parts.map((p, i) => (p.rows || {})['band' + (i % BANDS.length)] || 0);
    check('tall: each part carries its own marker band (no blank or shifted part)', perPart.every(r => r >= 200 * tall.page.dpr), JSON.stringify(perPart));
    const last = parts[parts.length - 1];
    check('tall: the page END marker is in the last part', ((last.rows || {}).end || 0) >= 200 * tall.page.dpr, JSON.stringify(last.rows));
  } else check('tall: result.html opened with the stitched shot', false, JSON.stringify(tall.stats || tall.started));

  /* ── WEBP ────────────────────────────────────────────────────────────── */
  console.log('\n=== webp ===');
  await evalJson(ff, ctl, 'chrome.storage.sync.set({ imageFormat: "webp" }).then(() => true)');
  const webp = await capture(ctl, ORIGIN + '/plain.html', 'visible', { colours: [['blue', [10, 120, 200], 16]] });
  await evalJson(ff, ctl, 'chrome.storage.sync.set({ imageFormat: "png" }).then(() => true)');
  if (webp.stats && !webp.stats.missing) {
    const p = webp.stats.parts[0];
    check('webp: the imageFormat=webp capture is image/webp', p.type === 'image/webp', p.type + ', ' + p.bytes + ' bytes');
    check('webp: Firefox decodes it at its declared size, and it is the page', p.dw === p.w && p.dh === p.h && p.rows && p.rows.blue >= p.dh * 0.8,
      JSON.stringify([p.w, p.h, p.dw, p.dh, p.rows, p.decodeError]));
  } else check('webp: result.html opened with the shot', false, JSON.stringify(webp.stats || webp.started));

  /* ── PAGES + WEBM, on the torture capture ────────────────────────────── */
  console.log('\n=== the four pages gecko-smoke never opens ===');
  if (!fullShotId) check('pages: a capture to open them on', false, 'the full capture produced no shot');
  else {
    const q = '?shot=' + encodeURIComponent(fullShotId) + '&seg=0';
    for (const [rel, ready] of [['pages/result.html?shot=' + encodeURIComponent(fullShotId), '#view'], ['pages/editor.html' + q, '#stage'],
      ['pages/beautify.html' + q, '#bfStage'], ['pages/scrollclip.html' + q, '#scStage']]) {
      const c = await openTab(base() + rel);
      const ok = await shown(c, ready, 60000);
      check(rel.split('?')[0] + ' opens on the capture and shows ' + ready, ok === true, String(ok));
      if (/scrollclip/.test(rel) && ok) {
        const wm = await evalJson(ff, c, '(async () => { const mime = fsPickWebmMime(); if (!mime) return { mime: null };' +
          ' const shot = await FSDB.get("shots", new URLSearchParams(location.search).get("shot")); const img = await createImageBitmap(shot.segments[0].blob);' +
          ' const g = fsScrollFrames(img.width, img.height, { outW: 480, fps: 12, speed: 800 });' +
          ' const blob = await fsRecordWebM(img, { frames: g.frames.slice(0, 12) }, g.view, mime); return { mime, type: blob.type, bytes: blob.size }; })()');
        console.log('  webm: ' + JSON.stringify(wm));
        if (wm.mime === null) {
          console.log('  NOTE  MediaRecorder offers no WebM here; scrollclip declares the GIF fallback (exportWebm -> exportGif)');
          const gif = await evalJson(ff, c, '(async () => { const b = fsEncodeGIF([{ data: new ImageData(8, 8).data, delayMs: 100 }], 8, 8, {}); return b && b.length; })()');
          check('webm: the declared GIF fallback encodes', gif > 0, String(gif));
        } else {
          check('webm: fsRecordWebM produces a video/webm blob in Firefox', /^video\/webm/.test(wm.type) && wm.bytes > 0, JSON.stringify(wm));
        }
      }
      await closeCtx(c);
    }
  }

  /* ── REFUSAL: a page Firefox forbids to extensions ───────────────────── */
  console.log('\n=== refusal: a restricted domain ===');
  const blockedUrl = BLOCKED_ORIGIN + '/plain.html';
  const ref = await capture(ctl, blockedUrl, 'full');
  const R_BLOCKED = await evalJson(ff, ctl, 'Promise.resolve(chrome.i18n.getMessage("errBlocked"))');
  const R_NO_START = await evalJson(ff, ctl, 'Promise.resolve(chrome.i18n.getMessage("errNoStart"))');
  /* The engine's own wording for the refusal, asked of the same API the
     background's injectFile calls, on a tab left open for it. Printed, because
     it is the string background.js has to recognise. */
  const probeTab = await openTab(blockedUrl);
  const wording = await evalJson(ff, ctl, '(async () => { const t = (await chrome.tabs.query({})).find(x => x.url === ' + JSON.stringify(blockedUrl) + ');' +
    ' if (!t) return "no tab"; return chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content/capture.js"] }).then(() => "INJECTED", e => String(e && e.message || e)); })()');
  await closeCtx(probeTab);
  console.log('  Gecko refuses the injection with: ' + JSON.stringify(wording));
  console.log('  router answered: ' + JSON.stringify(ref.started));
  check('refusal: Firefox really refuses the injection (the probe is not vacuous)', wording !== 'INJECTED' && wording !== 'no tab', JSON.stringify(wording));
  check('refusal: the capture is refused', ref.started && ref.started.ok === false, JSON.stringify(ref.started));
  check('refusal: with the BLOCKED sentence, not the reload-and-retry one', ref.started && ref.started.error === R_BLOCKED && ref.started.error !== R_NO_START,
    JSON.stringify(ref.started && ref.started.error) + ' (blocked: ' + JSON.stringify(R_BLOCKED) + ')');

  check('no error was logged by an extension page this suite opened (the background page is not a BiDi context)', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
  exitCode = fails.length ? 1 : 0;
  console.log('\n' + passes + ' pass · ' + fails.length + ' fail');
  if (fails.length) console.log('FINDINGS:\n  ' + fails.join('\n  '));
} catch (e) {
  console.log('COVERAGE LOST — the Gecko capture run did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ff.close();
  srv.close();
}
process.exit(exitCode);
