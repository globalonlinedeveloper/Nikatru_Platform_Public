/* ============================================================================
   real-copy.mjs — the product's Copy button, a REAL clipboard, read back
   (2026-09-24, O-FIREFOX-BUILD-NEVER-RUN-IN-A-BROWSER limb 4).

   Every copy test in this tree before this file stubbed navigator.clipboard —
   privacy-verify.mjs, reduction-corpus.mjs and giveup-verify.mjs spy on the
   write, and test/aihandoff-sim.node.js replaces it — so "Copy works" had been
   asserted against a function the tests supplied themselves. This captures a
   fixture with the PACKED Chromium extension, clicks #copyBtn on the result
   page with a real pointer (the user activation the write needs), and reads the
   system clipboard back: an image/png that is the picture on screen (same
   aspect, never larger — the handoff's export fit may scale it down).

   The write is the shipped manifest's (no clipboardWrite, in either the
   package or packed-lib.mjs's delta); clipboardRead is the delta's, for the
   read-back alone. The page's CSP-violation and network recorder rides along.

   Exit: 0 green · 1 a finding · 2 coverage lost.
   Run:  node real-copy.mjs   (FS_E2E_CHROMIUM=<path> to use a local binary)
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, FIXTURE_DIR } from './claim-lib.mjs';
import { packedExtension, coverageLost, PAGE_RECORDER } from './packed-lib.mjs';

const PORT = Number(process.env.PORT || 8932);
let passes = 0;
const fails = [];
const check = (label, ok, extra) => {
  if (ok) passes++; else fails.push(label + (extra != null ? '  — ' + extra : ''));
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
};

const ext = packedExtension('chromium');
if ((ext.packedManifest.permissions || []).includes('clipboardWrite')) {
  console.log('NOTE  the packed manifest declares clipboardWrite; this run measures the copy WITH it.');
}
const srv = await serve(FIXTURE_DIR, PORT);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-copy-')), {
  ...(process.env.FS_E2E_CHROMIUM ? { executablePath: process.env.FS_E2E_CHROMIUM } : { channel: 'chromium' }),
  headless: !process.env.HEADFUL,
  viewport: { width: 1280, height: 800 },
  args: ['--disable-extensions-except=' + ext.dir, '--load-extension=' + ext.dir]
});
let exitCode = 0;
try {
  await ctx.addInitScript(PAGE_RECORDER);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });

  const fixtureUrl = 'http://127.0.0.1:' + PORT + '/control-clean.html';
  const tab = await ctx.newPage();
  await tab.goto(fixtureUrl, { waitUntil: 'load' });
  await tab.bringToFront();
  await tab.waitForTimeout(800);
  const resultWait = ctx.waitForEvent('page', { predicate: p => p.url().includes('pages/result.html'), timeout: 300000 });
  resultWait.catch(() => {});
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(x => x.url === pageUrl);
    if (!t) throw new Error('test tab not found');
    await chrome.tabs.update(t.id, { active: true });
    const res = await startCapture(t, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, fixtureUrl);
  const result = await resultWait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  await result.bringToFront();
  await result.waitForTimeout(1000);

  const before = await result.evaluate(async () => {
    try { const items = await navigator.clipboard.read(); return items.map(i => i.types.join('+')).join(','); }
    catch (e) { return 'unreadable: ' + e.name; }
  });
  console.log('clipboard before the click: ' + JSON.stringify(before));
  if (/image\/png/.test(before)) coverageLost('the clipboard already holds an image before the click, so a read-back could not tell this copy from an older one');

  const t0 = Date.now();
  await result.click('#copyBtn');
  let back = null;
  for (let i = 0; i < 40 && !(back && back.w); i++) {
    await result.waitForTimeout(250);
    back = await result.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        const it = items.find(x => x.types.includes('image/png'));
        if (!it) return { types: items.map(x => x.types.join('+')).join(',') };
        const bmp = await createImageBitmap(await it.getType('image/png'));
        return { w: bmp.width, h: bmp.height, types: it.types.join('+') };
      } catch (e) { return { error: e.name + ': ' + e.message }; }
    });
  }
  const ms = Date.now() - t0;
  const onScreen = await result.evaluate(() => {
    const c = document.querySelector('#view canvas, #view img');
    return c ? { w: c.width || c.naturalWidth, h: c.height || c.naturalHeight } : null;
  });
  check('clicking Copy puts an image/png on the real clipboard', !!(back && back.w), JSON.stringify(back) + ' after ' + ms + ' ms');
  /* NOT pixel-equal to the screen, on purpose: the copy goes through the AI
     handoff's export fit (pages/result.js exportFit -> buildHandoff), which
     scales a large capture down. Measured 2026-09-24 on Chromium 1194: 974x1180
     copied from a 1242x1505 canvas. So the picture is graded as THE SAME
     PICTURE — same aspect within 1%, never larger than what is shown. */
  const aspect = (a) => a.w / a.h;
  check('...the picture on screen: same aspect within 1%, never larger',
    !!(back && back.w && onScreen && Math.abs(aspect(back) / aspect(onScreen) - 1) < 0.01 && back.w <= onScreen.w && back.h <= onScreen.h),
    JSON.stringify(back) + ' vs on screen ' + JSON.stringify(onScreen));
  const rec = await result.evaluate(() => window.__fsRec || null);
  check('the result page raised no CSP violation while copying', !!rec && rec.csp.length === 0, rec ? JSON.stringify(rec.csp) : 'no recorder');
  check('...and made no network-API call', !!rec && rec.net.length === 0, rec ? JSON.stringify(rec.net) : 'no recorder');

  exitCode = fails.length ? 1 : 0;
  console.log('\n' + passes + ' pass · ' + fails.length + ' fail');
  if (fails.length) console.log('FINDINGS:\n  ' + fails.join('\n  '));
} catch (e) {
  console.log('COVERAGE LOST — the copy run did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ctx.close().catch(() => {});
  srv.close();
}
process.exit(exitCode);
