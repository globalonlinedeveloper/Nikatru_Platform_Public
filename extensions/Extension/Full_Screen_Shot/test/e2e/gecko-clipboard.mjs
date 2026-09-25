/* ============================================================================
   gecko-clipboard.mjs — a REAL Firefox clipboard write, per image size
   (2026-09-24, O-FIREFOX-BUILD-NEVER-RUN-IN-A-BROWSER limb 3).

   AI-HANDOFF-ENVELOPE.md §13 records the clipboard as measured on Chromium 149
   and says nothing of Firefox, and every copy test in this tree stubs
   navigator.clipboard. This installs the PACKED Firefox add-on — whose shipped
   manifest has no clipboardWrite — opens a packaged page that loads
   pages/common.js, and for each size in clipboard-expect.json calls the
   product's own fsCopyBlobToClipboard() from inside a user activation, then
   reads the clipboard back (clipboardRead is in packed-lib.mjs's delta, so the
   READ is the test's; the WRITE is exactly what ships).

   Recorded per size: the outcome ('ok' | 'refused' | 'unverified'), the error
   text on a refusal, and click-to-write milliseconds — Firefox's transient
   activation expires, and a large encode between the click and the write is
   the shape that would run out of it. The outcome is graded against
   clipboard-expect.json; the table is printed for the §13 row either way.

   Exit: 0 every outcome as expected · 1 one differs · 2 coverage lost (no
   Firefox, older than 140, BiDi refused, or no size graded).

   e2e-display: headful — a HEADLESS Firefox clipboard holds text only. On
   2026-09-25, Firefox 156.0.1, this suite headless read back no type at all for
   3 of 3 sizes ('unverified'), and headful read back 3 of 3 ('ok'). The
   e2e-suite step reads that marker and runs this file under xvfb-run -a with
   HEADFUL=1; by hand, run it with HEADFUL=1 for the same reason.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packedExtension, coverageLost } from './packed-lib.mjs';
import { firefoxVersion, launchFirefox, evalJson, topContext, FIREFOX_BIN } from './bidi-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECT = JSON.parse(fs.readFileSync(path.join(__dirname, 'clipboard-expect.json'), 'utf8'));
if (!Array.isArray(EXPECT.sizes) || !EXPECT.sizes.length) coverageLost('clipboard-expect.json lists no sizes');
const OUTCOMES = ['ok', 'refused', 'unverified'];
for (const s of EXPECT.sizes) {
  if (!OUTCOMES.includes(s.expect)) coverageLost('clipboard-expect.json row ' + JSON.stringify(s) + ' expects none of ' + OUTCOMES.join('/'));
}

const v = firefoxVersion();
if (!v) coverageLost('no Firefox at ' + FIREFOX_BIN + ' (set FS_E2E_FIREFOX)');
console.log('firefox: ' + v.text);
if (v.major < 140) coverageLost('Firefox ' + v.major + ' is older than 140');

const ext = packedExtension('firefox');
if ((ext.packedManifest.permissions || []).includes('clipboardWrite')) {
  console.log('NOTE  the packed Firefox manifest declares clipboardWrite; this run measures the copy WITH it.');
}
const addonId = ext.packedManifest.browser_specific_settings.gecko.id;
const ff = await launchFirefox({ addonId }).catch(e => coverageLost('Firefox did not start a BiDi session: ' + e.message));
let exitCode = 0;
try {
  try { await ff.send('webExtension.install', { extensionData: { type: 'path', path: ext.dir } }); }
  catch (e) { coverageLost('webExtension.install refused the packed Firefox tree: ' + e.message); }
  const ctx = await topContext(ff);
  try {
    await ff.send('browsingContext.navigate', { context: ctx, url: 'moz-extension://' + ff.uuid + '/pages/history.html', wait: 'complete' });
  } catch (e) { coverageLost('moz-extension navigation was refused: ' + e.message); }
  const hasFn = await evalJson(ff, ctx, 'Promise.resolve(typeof fsCopyBlobToClipboard)')
    .catch(e => coverageLost('script.evaluate was refused: ' + e.message));
  if (hasFn !== 'function') coverageLost('pages/history.html has no fsCopyBlobToClipboard (' + hasFn + '): pages/common.js did not load');

  const rows = [];
  for (const s of EXPECT.sizes) {
    /* Everything before the call is setup and is NOT inside the timed span:
       the image is drawn and encoded first, then the product's function is
       called in a fresh activation, the way a click on a copy button calls it. */
    await evalJson(ff, ctx, '(async () => { const c = document.createElement("canvas"); c.width = ' + s.w + '; c.height = ' + s.h + ';' +
      ' const g = c.getContext("2d"); g.fillStyle = "#2a6"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#123"; g.fillRect(0, 0, 16, 16);' +
      ' window.__clipSrc = await new Promise(r => c.toBlob(r, "image/png")); return true; })()');
    const r = await evalJson(ff, ctx, '(async () => { const t0 = performance.now();' +
      ' try { await fsCopyBlobToClipboard(window.__clipSrc, true); }' +
      ' catch (e) { return { outcome: "refused", ms: Math.round(performance.now() - t0), error: (e && e.name) + ": " + (e && e.message) }; }' +
      ' const ms = Math.round(performance.now() - t0);' +
      ' try { const items = await navigator.clipboard.read(); const it = items.find(i => i.types.includes("image/png"));' +
      '   if (!it) return { outcome: "unverified", ms, error: "no image/png on the clipboard; types: " + items.map(i => i.types.join("+")).join(",") };' +
      '   const bmp = await createImageBitmap(await it.getType("image/png"));' +
      '   return { outcome: bmp.width === ' + s.w + ' && bmp.height === ' + s.h + ' ? "ok" : "unverified", ms, back: bmp.width + "x" + bmp.height };' +
      ' } catch (e) { return { outcome: "unverified", ms, error: "read-back: " + (e && e.name) + ": " + (e && e.message) }; } })()',
    { userActivation: true });
    rows.push({ size: s.w + 'x' + s.h, expect: s.expect, ...r });
  }

  console.log('\nFirefox ' + v.major + ' clipboard, packed add-on, shipped permissions ' + JSON.stringify(ext.packedManifest.permissions));
  console.log('  size         expect      observed    click-to-write   detail');
  for (const r of rows) {
    console.log('  ' + r.size.padEnd(12) + ' ' + r.expect.padEnd(11) + ' ' + r.outcome.padEnd(11) + ' ' +
      String(r.ms + ' ms').padEnd(16) + ' ' + (r.error || r.back || ''));
  }
  const off = rows.filter(r => r.outcome !== r.expect);
  if (!rows.length) coverageLost('no size was graded');
  console.log('\n' + (rows.length - off.length) + ' as expected · ' + off.length + ' differ');
  if (off.length) console.log('FINDINGS:\n  ' + off.map(r => r.size + ': expected ' + r.expect + ', observed ' + r.outcome + (r.error ? ' (' + r.error + ')' : '')).join('\n  '));
  exitCode = off.length ? 1 : 0;
} catch (e) {
  console.log('COVERAGE LOST — the Gecko clipboard run did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ff.close();
}
process.exit(exitCode);
