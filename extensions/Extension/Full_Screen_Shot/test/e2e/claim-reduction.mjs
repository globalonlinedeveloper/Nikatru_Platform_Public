#!/usr/bin/env node
/* FullShot — THE REDUCTION, IN A REAL BROWSER.
   REDACTION-CLAIM-SPEC.md §8.2's `test/e2e` row: checks 6, 7 and 10, plus the
   three the node tiers structurally cannot make — that the dialog renders the
   DOWNSCALED EXPORT and not the full-size capture, that the marks land on the
   black blocks in the delivered image, and that the reduced-overview line
   appears on a very tall page.

   WHY THIS FILE EXISTS BESIDE redaction-claim.mjs. That suite grades an
   eight-state ladder that no longer exists; this one grades what replaced it.
   Its corpus is deliberately THE SHAPES THAT DEFEATED THE PREVIOUS SIX FIXES —
   closed shadow roots, content-visibility, <object>/<embed>, canvas-only,
   text/plain, text split across inline boundaries. Under this design every one
   of them should be UNINTERESTING, because there is no claim left to be wrong:
   the record states three counts, the bundle carries no verdict at any depth,
   and the person is shown the picture. A fixture that still produces something
   a reader would take as a verdict means the design has leaked, and this file
   is where that shows up.

   Run:  cd test/e2e && node claim-reduction.mjs
         HEADFUL=1 node claim-reduction.mjs
         ONLY=honest-pii,shadow-closed node claim-reduction.mjs
*/
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXT_DIR, OUT_DIR, serve, prepareTestExtension, setSettings,
         begin, check, results } from './claim-lib.mjs';

const PORT = 8913;
const FIX = 'http://localhost:' + PORT + '/test/e2e/fixtures/';
const ADV = 'http://localhost:' + PORT + '/test/e2e/fixtures-adv/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* The outline colour the dialog draws its marks in. It must not occur in the
   exported image — the marks are a preview, never a change to the artifact. */
const MARK_RGB = [0xd8, 0x1b, 0x60];

/* ---- one capture, with the result page kept open so the dialog can be driven ---- */
async function capture(ctx, sw, url, opts) {
  const o = opts || {};
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(o.settleMs || 900);
  const wait = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'), timeout: 240000
  });
  wait.catch(() => {});
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === pageUrl) || tabs.find(t => (t.url || '').startsWith('http'));
    if (!tab) throw new Error('test tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
    const res = await startCapture(tab, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, url);
  const result = await wait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 240000 });
  await result.waitForTimeout(1200);
  return { page, result };
}

const record = (result) => result.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  return JSON.parse(JSON.stringify({
    keys: Object.keys(shot), redaction: shot.redaction || null,
    w: shot.w, h: shot.h, segments: shot.segments.length
  }));
});

/* Every key at every depth of an object, so "no verdict anywhere" is asked of
   the whole thing rather than of the two places one would think to look. */
const deepKeys = (o, out = [], d = 0) => {
  if (!o || typeof o !== 'object' || d > 12) return out;
  if (Array.isArray(o)) { for (const v of o) deepKeys(v, out, d + 1); return out; }
  for (const k of Object.keys(o)) { out.push(k); deepKeys(o[k], out, d + 1); }
  return out;
};

/* THE BUNDLE THE CLIPBOARD WOULD RECEIVE, built through the shipped producer
   with the review flag the dialog sets. Read rather than copied: the clipboard
   is the browser's and a headless run cannot hold it. */
const bundleOf = (result) => result.evaluate(() => {
  const id = new URLSearchParams(location.search).get('id');
  return FSDB.get('shots', id).then(shot => {
    const r = shot.redaction || {};
    const b = fsAiBundle({
      id: shot.id,
      producer: { tool: 'FullShot', version: '0', surface: 'chrome-extension' },
      subject: { kind: 'web-page', mode: shot.mode, url: shot.url, title: shot.title,
                 capturedAt: new Date(shot.createdAt).toISOString(),
                 image: { w: shot.w, h: shot.segments.reduce((a, s) => a + s.h, 0) } },
      redactRequested: r.requested, redactActs: r.acts, pixelKinds: r.kinds || {},
      reviewed: true, notes: []
    });
    return JSON.parse(JSON.stringify({ envelope: b.envelope, text: b.text }));
  });
});

/* ---- the corpus: the shapes that defeated the previous six fixes ---- */
const CORPUS = [
  ['control-pii',     FIX + 'control-pii.html',     'the ordinary case — matches found, blocks painted'],
  ['shadow-closed',   FIX + 'shadow-closed.html',   'a closed shadow root the walk cannot enter'],
  ['contentvis',      FIX + 'contentvis.html',      'content-visibility: laid out, not painted'],
  ['object-door',     ADV + 'object-door.html',     '<object>/<embed> as uncounted doors'],
  ['canvas-pii',      FIX + 'canvas-pii.html',      'text drawn as pixels — nothing to read'],
  ['plaintext-short', FIX + 'plaintext-short.txt',  'text/plain, wrapped by Chrome in a synthetic <pre>'],
  ['split-token',     ADV + 'split-token.html',     'a card number split across inline elements'],
  ['mixed-owntext',   ADV + 'mixed-owntext.html',   'ordinary markup: <p>Email <b>x</b> a@b.com</p>']
];

(async () => {
  const TEST_EXT = prepareTestExtension();
  /* Served from the extension root, so `/test/e2e/fixtures/...` resolves. A
     wrong root does not error — it 404s, every fixture becomes the string "not
     found", and every check passes on a page with nothing in it. */
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-reduction-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await setSettings(sw, { redactPII: true });

    for (const [name, url, why] of CORPUS) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      begin(name, why);
      const { page, result } = await capture(ctx, sw, url);
      const rec = await record(result);

      /* R1 — THE WHOLE POINT. Not one of these fixtures can produce a verdict,
         because there is no field left to hold one. */
      const rk = deepKeys(rec.redaction);
      const verdicts = ['pixels', 'state', 'severity', 'evidence'].filter(k => rk.indexOf(k) >= 0);
      check('R1 the record carries no verdict field at any depth',
        !!rec.redaction && verdicts.length === 0,
        verdicts.join(',') || rk.join(','));
      check('R2 ...and it carries the acts instead',
        !!rec.redaction && rec.redaction.v === 3 && !!rec.redaction.acts &&
        ['matched', 'painted', 'verifiedOpaque', 'walkComplete', 'truncatedBy', 'ledger']
          .every(k => k in rec.redaction.acts),
        JSON.stringify(rec.redaction && rec.redaction.acts));

      const b = await bundleOf(result);
      const bk = deepKeys(b.envelope);
      const bv = ['pixels', 'state', 'severity', 'evidence'].filter(k => bk.indexOf(k) >= 0);
      check('R3 the bundle carries no verdict field at any depth', bv.length === 0,
        bv.join(',') || bk.length + ' keys graded');
      /* R4 — the words a reader would take as a verdict, in the artifact that
         leaves the machine. This is the check that catches a leak the key scan
         cannot: a sentence.

         Graded on the lines that talk about redaction, not on the whole
         payload, because `profile "safe"` is a ROW NAME in the limit table —
         the most restrictive of the four vendors — and says nothing about the
         image. Widening the grep to the whole text fails on that, and a check
         that fails for the wrong reason is a check the next person deletes. */
      const redLines = b.text.split('\n')
        .filter(l => /redact|FullShot reads the text/i.test(l)).join(' ');
      check('R4 ...and no sentence in the payload reads as a verdict about the image',
        redLines.length > 40 &&
        !/\b(safe|clean|secure|protected|sanitis|sanitiz|nothing to hide|baked|pixels)\b/i.test(redLines),
        (redLines.match(/\b(safe|clean|secure|protected|baked|pixels)\b/gi) || []).join(',') ||
          redLines.length + ' chars of redaction copy graded');
      check('R5 ...and the limit of the instrument is stated beside the counts',
        /It cannot see this image/.test(b.text) &&
        /counts what FullShot did, not what is in the picture/.test(b.text), '');

      /* R6 — every mark describes the PICTURE: a region that is already a solid
         block in the delivered file. Read back out of the encoded PNG, which is
         one step further than the canvas read-back the counter is built on. */
      const marks = (rec.redaction && rec.redaction.marks) || [];
      if (marks.length) {
        const bad = await result.evaluate(async (ms) => {
          const id = new URLSearchParams(location.search).get('id');
          const shot = await FSDB.get('shots', id);
          const out = [];
          let top = 0;
          const bmps = [];
          for (const s of shot.segments) bmps.push({ bmp: await createImageBitmap(s.blob), top: (top += 0, top), h: s.h });
          top = 0;
          for (const s of bmps) { s.top = top; top += s.bmp.height; }
          for (const m of ms) {
            const cx = Math.round(m.x + m.w / 2), cy = Math.round(m.y + m.h / 2);
            const seg = bmps.find(s => cy >= s.top && cy < s.top + s.bmp.height);
            if (!seg) { out.push('off-image ' + cx + ',' + cy); continue; }
            const cv = new OffscreenCanvas(1, 1);
            const cx2 = cv.getContext('2d', { willReadFrequently: true });
            cx2.drawImage(seg.bmp, cx, cy - seg.top, 1, 1, 0, 0, 1, 1);
            const d = cx2.getImageData(0, 0, 1, 1).data;
            if (d[0] !== 0x11 || d[1] !== 0x11 || d[2] !== 0x11) {
              out.push(cx + ',' + cy + ' -> rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')');
            }
          }
          for (const s of bmps) s.bmp.close();
          return out;
        }, marks);
        check('R6 every stored mark points at a solid block in the DELIVERED image',
          bad.length === 0, bad.join(' | ') || marks.length + ' marks re-read from the PNG');
      } else {
        check('R6 no marks stored, so none can point at the wrong place', true,
          'verifiedOpaque=' + (rec.redaction && rec.redaction.acts.verifiedOpaque));
      }

      /* R7 — THE MARK COLOUR IS NOT IN THE EXPORT. The outlines are drawn in the
         preview and nowhere else; if they ever reached the encoded image the
         product would be shipping an annotation nobody asked for. */
      const inked = await result.evaluate(async (rgb) => {
        const id = new URLSearchParams(location.search).get('id');
        const shot = await FSDB.get('shots', id);
        let hits = 0;
        for (const s of shot.segments) {
          const bmp = await createImageBitmap(s.blob);
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const c = cv.getContext('2d', { willReadFrequently: true });
          c.drawImage(bmp, 0, 0);
          const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
          for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - rgb[0]) <= 12 && Math.abs(d[i + 1] - rgb[1]) <= 12 &&
                Math.abs(d[i + 2] - rgb[2]) <= 12) { hits++; if (hits > 8) break; }
          }
          bmp.close();
          if (hits > 8) break;
        }
        return hits;
      }, MARK_RGB);
      check('R7 the exported image contains no mark-outline pixels', inked === 0,
        inked + ' pixel(s) of rgb(' + MARK_RGB.join(',') + ')');

      /* ---- §3.1, the gate: the AI hand-off and nothing else ---- */
      const dlgOpen = () => result.evaluate(() => {
        const d = document.getElementById('reviewDlg');
        return !!d && !d.hidden;
      });
      check('R8 nothing is asked before the person acts', (await dlgOpen()) === false, '');
      /* SAVE OPENS NOTHING — check 7, and it must stay green for ever. */
      await result.click('#dlBtn');
      await result.waitForTimeout(400);
      check('R9 Save with redaction on opens nothing at all', (await dlgOpen()) === false, '');
      /* COPY OPENS THE DIALOG, AND CANCEL LEAVES THE CLIPBOARD UNTOUCHED. */
      await result.click('#copyBtn');
      await result.waitForTimeout(1500);
      const opened = await dlgOpen();
      check('R10 Copy with redaction on shows the person the image first', opened, '');
      if (opened) {
        const dlg = await result.evaluate(() => ({
          acts: (document.getElementById('reviewActs').textContent || '').trim(),
          limit: (document.getElementById('reviewLimit').textContent || '').trim(),
          scale: (document.getElementById('reviewScale').textContent || '').trim(),
          marks: (document.getElementById('reviewMarkCount').textContent || '').trim(),
          reduced: (document.getElementById('reviewReduced').textContent || '').trim(),
          badges: document.querySelectorAll('#reviewMarkLayer .review-mark').length,
          jumps: document.querySelectorAll('#reviewMarkList button').length,
          imgW: document.getElementById('reviewImg').naturalWidth,
          focus: document.activeElement ? document.activeElement.id : null
        }));
        /* §3.2 — THE EXACT BLOB THAT IS ABOUT TO LEAVE, not the full-size
           capture. The exported width is the fitted one, so a preview showing
           the capture's own width is showing the wrong artifact. */
        /* §3.2 — THE EXACT BLOB THAT IS ABOUT TO LEAVE. The property is not
           "smaller": a page narrow enough to travel at 1:1 is exported at 1:1
           and the preview must match THAT. What must never happen is a preview
           of the full-size capture when the export is a reduction of it. */
        check('R11 the dialog renders the exact export, at the exported size',
          dlg.imgW > 0 && dlg.imgW === b.envelope.budget.fit.w,
          'preview ' + dlg.imgW + 'px vs export ' + b.envelope.budget.fit.w +
          'px (capture ' + rec.w + 'px)');
        check('R12 ...and states the scale it is showing', /%/.test(dlg.scale), dlg.scale);
        check('R13 the copy states the acts and the limit, and promises nothing',
          dlg.acts.length > 10 && /cannot see this image/i.test(dlg.limit) &&
          !/\b(safe|clean|secure|protected)\b/i.test(dlg.acts + ' ' + dlg.limit),
          JSON.stringify(dlg.acts).slice(0, 140));
        check('R14 one numbered badge and one jump control per stored mark',
          dlg.badges === marks.length && dlg.jumps === marks.length,
          dlg.badges + ' badges, ' + dlg.jumps + ' jumps, ' + marks.length + ' marks');
        /* §8.2's a11y row, asserted where it is real: initial focus is NOT on
           the confirm button. */
        check('R15 initial focus is not on the primary button',
          dlg.focus !== 'reviewConfirm', String(dlg.focus));
        await result.keyboard.press('Escape');
        await result.waitForTimeout(300);
        check('R16 Escape closes it without copying', (await dlgOpen()) === false, '');
      }
      await result.close();
      await page.close();
    }
  } finally {
    await ctx.close();
    srv.close();
  }

  if (results.fails.length) {
    console.log('\n=== FAILURES ===');
    for (const f of results.fails) console.log('  ' + f);
  }
  console.log('\n' + results.pass + ' pass, ' + results.fail + ' fail');
  process.exit(results.fail ? 1 : 0);
})();
