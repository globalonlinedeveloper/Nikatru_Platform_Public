/* FullShot — PRIVACY VERIFIER, real Chromium, the shipped extension.
   ==========================================================================

   This suite does not grade the implementation against itself. It asks four
   questions the owner asked, in the order they were asked, and it asks them of
   the delivered artifact wherever an artifact exists:

     A  Is there a surviving CLAIM? Any field, sentence, icon or colour — in the
        record, in the envelope, in the ASCII payload, on the result page, or in
        the review dialog — that a reasonable person would read as "this image
        is safe to share." Including the review screen: a green tick is a
        verdict.

     B  Is the ACT LEDGER ACCURATE? `painted` and `verifiedOpaque` are compared
        against the number of solid blocks that are actually in the delivered
        PNG, counted by connected component and not by re-reading the counter
        that produced them. A truncated walk must be reported as truncated.

     C  Is the box-loss RACE fixed, or merely rarer? Answered by running it, with
        the preference under active attack, enough times to quote a frequency.

     D  Is the removed verdict GONE FROM THE CODE, or merely unused?

   THREE DELIBERATE INDEPENDENCE CHOICES, because a verifier that reads the
   implementation's own allowlist is grading the allowlist:

     1. The verdict scan is a LEXICON plus a SHAPE rule, run over every string
        and every boolean at any depth. It does not import FS_VERDICT_KEYS,
        FS_AI_BOOL_KEYS or fsEnvelopeVerdict. If the product's scan and mine
        disagree, that disagreement is the finding.
     2. `painted` is checked against PIXELS. A flood fill over the delivered
        image counts solid regions of the block colour; nothing in the product
        is consulted about how many there should be.
     3. Colour is measured, not assumed: every computed colour in the dialog is
        converted to HSL and anything in the success-green band is reported,
        whatever it is called in the stylesheet.

   Usage:  node privacy-verify.mjs            # lenses A, B, D
           MODE=race node privacy-verify.mjs  # lens C  (RUNS=30 to change N)
           HEADFUL=1 ...                      # watch it
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve, prepareTestExtension, setSettings, EXT_DIR, OUT_DIR } from './claim-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8127);
const BASE = 'http://127.0.0.1:' + PORT;
const FIX = BASE + '/test/e2e/fixtures/';
const ADV = BASE + '/test/e2e/fixtures-adv/';
const VER = BASE + '/test/e2e/fixtures-verify/';
const MODE = process.env.MODE || 'claim';
const RUNS = Number(process.env.RUNS || 30);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------------- verdicts ---------------- */
const R = { pass: 0, fail: 0, note: 0, fails: [], notes: [] };
let grp = '';
const begin = n => { grp = n; console.log('\n=== ' + n + ' ==='); };
function check(label, ok, extra) {
  if (ok) R.pass++; else { R.fail++; R.fails.push(grp + ' :: ' + label + (extra != null ? '  — ' + extra : '')); }
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
}
function note(label, extra) {
  R.note++; R.notes.push(grp + ' :: ' + label + (extra != null ? '  — ' + extra : ''));
  console.log('  NOTE  ' + label + (extra != null ? '  — ' + extra : ''));
}
const say = t => console.log('        ' + t);

/* ==========================================================================
   THE LEXICON — lens A, and it is mine, not the product's.

   Two lists. The first is what a reasonable person reads as an assurance about
   the picture. The second is the vocabulary the design is ALLOWED to use,
   because it names an act or an arithmetic fact rather than an outcome, and it
   exists so the first list can stay blunt: "complete" appears in "walk
   complete", which is a fact about the walk and not about the image.
   ========================================================================== */
const CLAIM_WORDS = [
  'safe', 'safely', 'unsafe', 'clean', 'cleaned', 'cleansed', 'secure', 'secured',
  'protected', 'protection', 'sanitis', 'sanitiz', 'scrubbed', 'redacted fully',
  'fully redacted', 'all pii', 'no pii', 'nothing to hide', 'nothing sensitive',
  'guarantee', 'guaranteed', 'assured', 'assurance', 'certified', 'verified clean',
  'ok to share', 'safe to share', 'ready to share', 'nothing left', 'nothing remains',
  'no sensitive', 'free of', 'risk-free', 'covered everything', 'everything covered',
  'all matches covered', 'fully covered', 'approved', 'compliant', 'passed', 'pass',
  'baked', 'exposed', 'unread', 'read-no-match', 'no-coverable-text'
];
/* Substrings that make a CLAIM_WORDS hit a false positive. Each is a phrase
   this product legitimately says; keeping them here rather than weakening the
   lexicon means a new sentence has to be argued for rather than absorbed. */
const CLAIM_EXEMPT = [
  'password', 'passed to', 'bypass',                       /* "pass" inside other words */
  'protected by the browser',                              /* errRestricted*, about capture, not redaction */
  'it does not tell you the image is clean',               /* the disclaimer itself */
  'cannot tell you whether the image is clean'
];

/* GLYPHS THAT ARE A VERDICT WITHOUT A SENTENCE. A tick, a shield, a padlock and
   a green circle all say "done, you are fine" to a person who reads nothing
   else on the screen, and none of them is caught by a word list. */
const VERDICT_GLYPHS = ['✓', '✔', '☑', '✅', '✔️',
  'ὑ2', '🔒', '🛡', '🟢', '⚠', '❌', '✗'];

function lexHits(s) {
  if (!s) return [];
  const low = String(s).toLowerCase();
  let masked = low;
  for (const ex of CLAIM_EXEMPT) masked = masked.split(ex).join(' '.repeat(ex.length));
  const out = [];
  for (const w of CLAIM_WORDS) {
    const at = masked.indexOf(w);
    if (at < 0) continue;
    /* whole-word for the short ones, so "pass" does not fire on "passage" */
    if (w.length <= 6) {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (!re.test(masked)) continue;
    }
    out.push(w);
  }
  return out;
}
function glyphHits(s) {
  if (!s) return [];
  return VERDICT_GLYPHS.filter(g => String(s).includes(g));
}

/* Every leaf of an object, as path -> value. Used for the deep scans; depth is
   capped for the same reason the product's is, and the cap is reported if it
   is ever reached so a scan that stopped short is visible. */
function leaves(o, base = '', out = [], d = 0) {
  if (d > 14) { out.push([base + '<depth-cap>', '<uninspected>']); return out; }
  if (o === null || typeof o !== 'object') { out.push([base, o]); return out; }
  if (Array.isArray(o)) { o.forEach((v, i) => leaves(v, base + '[' + i + ']', out, d + 1)); return out; }
  for (const k of Object.keys(o)) leaves(o[k], base ? base + '.' + k : k, out, d + 1);
  return out;
}

/* ==========================================================================
   page-side helpers
   ========================================================================== */
const readRecord = page => page.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  return JSON.parse(JSON.stringify({
    id, topKeys: Object.keys(shot), redaction: shot.redaction ?? null,
    captureSettings: shot.captureSettings ?? null,
    /* `aiMeta` persists `piiCount: piiBoxes.length` — the number of rects the
       scan HANDED the compositor. It is not part of the acts block and nothing
       renders it, but it is the only surviving witness to how many boxes there
       were before painting, which is what makes "painted equals matched" and
       "every emitted box was covered" separable questions. */
    piiCount: (shot.meta && typeof shot.meta.piiCount === 'number') ? shot.meta.piiCount : null,
    w: shot.w, h: shot.h, segs: shot.segments ? shot.segments.length : 0,
    segH: shot.segments ? shot.segments.map(s => s.h) : []
  }));
});

const buildBundle = (page, over) => page.evaluate(async (o) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const r = shot.redaction || {};
  const input = {
    id: shot.id,
    producer: { tool: 'FullShot', version: '0', surface: 'chrome-extension' },
    subject: { kind: 'web-page', mode: shot.mode || 'full', url: shot.url || '',
               title: shot.title || '', capturedAt: new Date(shot.createdAt || Date.now()).toISOString(),
               image: { w: shot.w, h: shot.segments.reduce((a, s) => a + s.h, 0) } },
    redactRequested: r.requested === undefined ? null : r.requested,
    redactActs: r.acts, pixelKinds: r.kinds || {}, notes: [], reviewed: true
  };
  Object.assign(input, (o && o.input) || {});
  if (o && o.deleteReviewed) delete input.reviewed;
  try {
    const b = fsAiBundle(input);
    return { ok: true, envelope: JSON.parse(JSON.stringify(b.envelope)), text: b.text };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}, over || {});

/* ---- LENS B's instrument -------------------------------------------------
   SOLID BLOCKS IN THE DELIVERED IMAGE, COUNTED BY FLOOD FILL. Nothing in the
   product is asked how many there should be; this counts what is there.

   Exact colour equality, not a tolerance: the block is filled with a single
   literal (#111111) and PNG is lossless, so a tolerance would only let
   antialiased dark glyph pixels join the count. A component must also be at
   least MIN_W x MIN_H and MIN_AREA before it is called a block, which is what
   separates a painted rect from a run of bold monospace text that happens to
   contain some very dark subpixels. Both thresholds are quoted in the result so
   a component just under them is visible rather than silently dropped. */
const BLOCK_RGB = [0x11, 0x11, 0x11];
const countBlocks = (page, opts = {}) => page.evaluate(async ({ rgb, minW, minH, minArea }) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const all = [];
  let near = 0;
  for (let si = 0; si < shot.segments.length; si++) {
    const seg = shot.segments[si];
    const bmp = await createImageBitmap(seg.blob);
    const W = bmp.width, H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, W, H).data;
    bmp.close();
    const seen = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    const isBlock = p => d[p * 4] === rgb[0] && d[p * 4 + 1] === rgb[1] && d[p * 4 + 2] === rgb[2];
    for (let p = 0; p < W * H; p++) {
      if (seen[p] || !isBlock(p)) continue;
      let top = 0; stack[top++] = p; seen[p] = 1;
      let n = 0, x0 = W, x1 = -1, y0 = H, y1 = -1;
      while (top) {
        const q = stack[--top];
        const qx = q % W, qy = (q / W) | 0;
        n++;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
        if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        if (qx > 0 && !seen[q - 1] && isBlock(q - 1)) { seen[q - 1] = 1; stack[top++] = q - 1; }
        if (qx < W - 1 && !seen[q + 1] && isBlock(q + 1)) { seen[q + 1] = 1; stack[top++] = q + 1; }
        if (qy > 0 && !seen[q - W] && isBlock(q - W)) { seen[q - W] = 1; stack[top++] = q - W; }
        if (qy < H - 1 && !seen[q + W] && isBlock(q + W)) { seen[q + W] = 1; stack[top++] = q + W; }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w >= minW && h >= minH && n >= minArea) {
        all.push({ seg: si, x: x0, y: y0, w, h, px: n, fill: Math.round(n / (w * h) * 100) });
      } else if (n >= 8) near++;
    }
  }
  return { blocks: all, rejected: near };
}, { rgb: BLOCK_RGB, minW: opts.minW || 6, minH: opts.minH || 6, minArea: opts.minArea || 80 });

/* ---- LENS B's second instrument -------------------------------------------
   THE MARKS, READ BACK OUT OF THE DELIVERED IMAGE, ONE AT A TIME.

   The flood fill above cannot separate blocks that touch, and on two fixtures
   they do: sr-only stacks four 18 px blocks 18 px apart, and ceiling paints two
   thousand of them down a list. A merged component is a limitation of the
   counter, not a defect in the product, so the per-block question is asked a
   second way that cannot merge — each persisted `redaction.marks` rect is
   sampled in the encoded PNG and required to be uniformly the block colour.

   That is also the stronger claim: §3.3 says a mark describes "a region that is
   a solid block in the file the user already holds", and this is that sentence
   turned into a measurement. `stray` is the complement — block-coloured pixels
   that lie inside NO mark rect — which is what would show a block painted into
   the image that the ledger never counted. */
const auditMarks = (page, marks) => page.evaluate(async ({ marks, rgb }) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  /* full-image coordinates -> (segment, y within segment) */
  const tops = []; let acc = 0;
  for (const s of shot.segments) { tops.push(acc); acc += s.h; }
  const bad = [];
  let stray = 0, markPx = 0, blockPx = 0;
  for (let si = 0; si < shot.segments.length; si++) {
    const seg = shot.segments[si];
    const bmp = await createImageBitmap(seg.blob);
    const W = bmp.width, H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0); bmp.close();
    const d = cx.getImageData(0, 0, W, H).data;
    const inMark = new Uint8Array(W * H);
    for (let mi = 0; mi < marks.length; mi++) {
      const m = marks[mi];
      const y0 = Math.round(m.y - tops[si]), y1 = y0 + Math.round(m.h);
      if (y1 <= 0 || y0 >= H) continue;                    // not in this segment
      const x0 = Math.max(0, Math.round(m.x)), x1 = Math.min(W, Math.round(m.x + m.w));
      const ya = Math.max(0, y0), yb = Math.min(H, y1);
      let n = 0, hit = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * W + x;
          inMark[p] = 1; n++;
          if (d[p * 4] === rgb[0] && d[p * 4 + 1] === rgb[1] && d[p * 4 + 2] === rgb[2]) hit++;
        }
      }
      markPx += n;
      if (n === 0) bad.push({ i: mi, why: 'rect falls outside the image', m });
      else if (hit < n) bad.push({ i: mi, why: 'not uniformly the block colour',
        pct: Math.round(hit / n * 100), m });
    }
    for (let p = 0; p < W * H; p++) {
      if (d[p * 4] === rgb[0] && d[p * 4 + 1] === rgb[1] && d[p * 4 + 2] === rgb[2]) {
        blockPx++; if (!inMark[p]) stray++;
      }
    }
  }
  return { bad, stray, markPx, blockPx };
}, { marks, rgb: BLOCK_RGB });

/* Is a marker colour still on the page? Rows rather than pixels, so a 30 000 px
   capture never crosses CDP as base64. A colour that survives the bake is a
   token that was not covered. */
const colourRows = (page, colours, tol = 18) => page.evaluate(async ({ names, list, tol }) => {
  if (!names.length) return {};
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const rows = {}; names.forEach(n => rows[n] = 0);
  for (const seg of shot.segments) {
    const bmp = await createImageBitmap(seg.blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    for (let y = 0; y < bmp.height; y++) {
      const hit = new Array(list.length).fill(false);
      let left = list.length;
      for (let x = 0; x < bmp.width && left > 0; x += 2) {
        const o = (y * bmp.width + x) * 4;
        for (let i = 0; i < list.length; i++) {
          if (hit[i]) continue;
          const c = list[i];
          if (Math.abs(d[o] - c[0]) <= tol && Math.abs(d[o + 1] - c[1]) <= tol &&
              Math.abs(d[o + 2] - c[2]) <= tol) { hit[i] = true; left--; }
        }
      }
      for (let i = 0; i < list.length; i++) if (hit[i]) rows[names[i]]++;
    }
    bmp.close();
  }
  return rows;
}, { names: Object.keys(colours), list: Object.values(colours), tol });

/* ---- LENS A's instrument for the screen ----------------------------------
   Every visible string AND every computed colour in a subtree, with the colour
   converted to HSL here rather than compared to a hex the stylesheet could
   rename. "Green tick" is two independent things and both are measured. */
const SURFACE_PROBE = `(root => {
  if (!root) return null;
  const txt = el => (el.innerText || el.textContent || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
  const hsl = css => {
    const m = /rgba?\\(([^)]+)\\)/.exec(css || '');
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s));
    if (p.length > 3 && p[3] === 0) return null;
    const r = p[0]/255, g = p[1]/255, b = p[2]/255;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      s = l > 0.5 ? dd/(2-mx-mn) : dd/(mx+mn);
      h = mx === r ? ((g-b)/dd + (g<b?6:0)) : mx === g ? ((b-r)/dd + 2) : ((r-g)/dd + 4);
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s*100), l: Math.round(l*100), css };
  };
  const colours = [];
  const strings = [];
  const els = Array.from(root.querySelectorAll('*')).concat([root]);
  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    for (const prop of ['color','backgroundColor','borderTopColor','borderInlineStartColor','outlineColor','fill']) {
      const c = hsl(cs[prop]);
      if (!c) continue;
      /* a border only counts if there is a border to see */
      if (prop.startsWith('border') && parseFloat(cs.borderTopWidth) === 0 && parseFloat(cs.borderInlineStartWidth) === 0) continue;
      colours.push({ el: tag, prop, h: c.h, s: c.s, l: c.l, css: c.css });
    }
    const t = txt(el);
    if (t && t.length <= 800 && !Array.from(el.children).some(c => txt(c) === t)) {
      strings.push({ el: tag, text: t,
        weight: cs.fontWeight, key: el.getAttribute('data-i18n') || '' });
    }
  }
  return { colours, strings, text: txt(root) };
})`;

const DIALOG_EL = `(() => {
  const vis = el => {
    if (!el || el.hasAttribute('hidden')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  return Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog,[aria-modal="true"]')).find(vis) || null;
})()`;

const readSurface = (page, rootExpr) =>
  page.evaluate('(' + SURFACE_PROBE + ')(' + rootExpr + ')');

async function waitDialog(page, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate('!!' + DIALOG_EL)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

const spyClipboard = page => page.evaluate(() => {
  if (window.__pvSpy) return true;
  window.__pvSpy = [];
  const rec = kind => function () { window.__pvSpy.push(kind); return Promise.resolve(); };
  for (const o of [Clipboard.prototype, navigator.clipboard]) {
    try { Object.defineProperty(o, 'write', { configurable: true, writable: true, value: rec('write') }); } catch (_) {}
    try { Object.defineProperty(o, 'writeText', { configurable: true, writable: true, value: rec('writeText') }); } catch (_) {}
  }
  return true;
});
const clipCalls = page => page.evaluate(() => (window.__pvSpy || []).length);

/* ==========================================================================
   one capture
   ========================================================================== */
async function capture(ctx, sw, url, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(opts.settleMs || 900);
  const wait = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'), timeout: 300000
  });
  wait.catch(() => {});
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === pageUrl) || tabs.find(t => (t.url || '').startsWith('http'));
    if (!tab) throw new Error('test tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
    const res = await startCapture(tab, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, url);
  const result = await wait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  await result.waitForTimeout(opts.lineSettleMs || 1400);
  return { page, result };
}

async function savePng(page, name) {
  try {
    const b64 = await page.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.writeFileSync(path.join(OUT_DIR, 'pv-' + name + '.png'), Buffer.from(b64, 'base64'));
  } catch (_) {}
}

/* ==========================================================================
   THE CORPUS — the shapes that defeated the six previous attempts, plus the
   two honest controls and one shape of my own.
   ========================================================================== */
const SHAPES = [
  { name: 'control-pii',  url: FIX + 'control-pii.html',
    colours: { email: [255,90,90], phone: [90,200,120], card: [90,130,255], decoy: [245,205,45] },
    /* the picture's own ground truth: three tokens must go, the Luhn decoy stays */
    gone: ['email','phone','card'], kept: ['decoy'], blocks: 3 },
  { name: 'canvas-pii',   url: FIX + 'canvas-pii.html' },
  { name: 'sr-only',      url: FIX + 'sr-only.html' },
  { name: 'shadow-closed', url: FIX + 'shadow-closed.html' },
  { name: 'contentvis',   url: FIX + 'contentvis.html', colours: { email: [255,90,90] } },
  { name: 'object-door',  url: ADV + 'object-door.html' },
  { name: 'iframe-host',  url: FIX + 'iframe-host.html' },
  { name: 'split-token',  url: ADV + 'split-token.html' },
  { name: 'mixed-owntext', url: ADV + 'mixed-owntext.html' },
  { name: 'plaintext-short', url: FIX + 'plaintext-short.txt' },
  { name: 'ceiling',      url: FIX + 'ceiling.html', truncated: true },
  /* mine — see fixtures-verify/wrap-cancel.html for the hypothesis */
  { name: 'wrap-cancel',  url: VER + 'wrap-cancel.html',
    colours: { email: [255,90,90], card: [90,130,255] } },
  /* …and its control. A wrapped token with nothing uncovered anywhere: one
     match, TWO blocks, both covered, no alarm. It is here because B4 compared a
     block count with a match count and this is the page on which that
     comparison is wrong — without it the check is green by luck, which is the
     state a suite is in when it teaches the defect instead of catching it. */
  { name: 'wrap-covered', url: VER + 'wrap-covered.html',
    colours: { card: [90,130,255] }, gone: ['card'], blocks: 2 }
];

/* ==========================================================================
   LENS A + LENS B, per shape
   ========================================================================== */
async function runShape(ctx, sw, shape) {
  begin(shape.name);
  let seenLine = null;
  const { page, result } = await capture(ctx, sw, shape.url);
  try {
    const rec = await readRecord(result);
    const r = rec.redaction || {};
    const a = r.acts || {};
    say('ledger  requested=' + JSON.stringify(r.requested) +
        '  matched=' + JSON.stringify(a.matched) +
        '  painted=' + JSON.stringify(a.painted) +
        '  verifiedOpaque=' + JSON.stringify(a.verifiedOpaque) +
        '  walkComplete=' + JSON.stringify(a.walkComplete) +
        '  truncatedBy=' + JSON.stringify(a.truncatedBy) +
        '  ledger=' + JSON.stringify(a.ledger) +
        '  marks=' + (Array.isArray(r.marks) ? r.marks.length : 'none'));
    await savePng(result, shape.name);

    /* ---------- A1  the record ---------- */
    const recLeaves = leaves(rec.redaction);
    const recStr = recLeaves.filter(([, v]) => typeof v === 'string');
    const recBad = recStr.filter(([, v]) => lexHits(v).length);
    check('A1 no verdict vocabulary in any string on the record',
      recBad.length === 0, recBad.map(([p, v]) => p + '=' + JSON.stringify(v)).join('; ') || 'strings: ' +
        recStr.map(([p, v]) => p + '=' + JSON.stringify(v)).join(' '));

    /* ---------- A2  the envelope, deep ---------- */
    const b = await buildBundle(result);
    check('A2a the producer built a bundle', b.ok, b.ok ? '' : b.error);
    if (b.ok) {
      const envL = leaves(b.envelope);
      /* TWO SCOPES, GRADED DIFFERENTLY AND ON PURPOSE. A word inside the
         redaction block, or in a redaction sentence, is a claim about the
         image and fails. The same word elsewhere in a 40-key envelope is
         reported and not graded — `budget.profile: "safe"` names an image-SIZE
         profile and predates this design — because a verifier that fails on it
         teaches the next reader to widen the exemptions until the check is
         furniture. It is a NOTE, and the note is the argument. */
      const inRed = ([p]) => /^redaction(\.|\[|$)/.test(p);
      const strAll = envL.filter(([, v]) => typeof v === 'string' && lexHits(v).length);
      const strBad = strAll.filter(inRed);
      check('A2b no verdict vocabulary in the envelope\'s redaction block',
        strBad.length === 0, strBad.map(([p, v]) => p + '=' + JSON.stringify(v)).join('; '));
      for (const [p, v] of strAll.filter(x => !inRed(x))) {
        note('the word ' + JSON.stringify(lexHits(v).join('/')) + ' appears at ' + p +
          ' — outside the redaction block, not graded',
          String(v).slice(0, 110));
      }
      /* a boolean is the shortest possible verdict. Report every one, by path,
         so a new one has to be argued for rather than noticed. */
      const bools = envL.filter(([, v]) => typeof v === 'boolean');
      say('booleans in the envelope: ' + (bools.map(([p, v]) => p + '=' + v).join(', ') || 'none'));
      /* MY list, arrived at by reading the envelope rather than the product's
         FS_AI_BOOL_KEYS: every one of these names a fact about the tool's own
         configuration or about the arithmetic of the paste. None summarises
         what became of the image. */
      /* `matchedComplete` joins the list for the same reason `walkComplete` is
         on it: it reports whether an act reached everything it could reach, and
         it is false whenever anything stopped the pass short. It is not a
         summary of the counters — a whole count of matches over a page whose
         text is all drawn as pixels is still 0, and the constant beside it in
         the payload says so. */
      const OK_BOOL = ['redaction.requested', 'redaction.acts.walkComplete',
        'redaction.acts.matchedComplete',
        'budget.fit.needsTiling', 'budget.tokens.exact'];
      const oddBool = bools.filter(([p]) => !OK_BOOL.includes(p) &&
        !/^legend\[\d+\]\.(conceals|inline)$/.test(p) && !/^contents\[\d+\]\.inline$/.test(p));
      check('A2c no boolean in the envelope beyond the four that name a configuration',
        oddBool.length === 0, oddBool.map(([p, v]) => p + '=' + v).join(', '));
      /* the four removed names, by KEY, at any depth — mine, not theirs */
      const removed = envL.filter(([p]) => /(^|\.)(pixels|state|severity|evidence)(\.|\[|$)/.test(p));
      check('A2d no key named pixels / state / severity / evidence at any depth',
        removed.length === 0, removed.map(([p]) => p).join(', '));

      /* ---------- A3  the ASCII payload ---------- */
      const lines = b.text.split('\n');
      const redLines = lines.filter(l => /redact|FullShot reads the text/i.test(l));
      const payBad = redLines.filter(l => lexHits(l).length).map(l => l.trim());
      check('A3a no verdict vocabulary in the payload\'s redaction lines',
        payBad.length === 0, payBad.join(' | '));
      const constant = 'It cannot see this image';
      const redLine = lines.filter(l => /^- Redaction:/.test(l));
      check('A3b the payload states the acts on exactly one line',
        redLine.length === 1, JSON.stringify(redLine));
      check('A3c the limit constant is emitted beside it',
        r.requested === false || b.text.includes(constant),
        r.requested === false ? 'requested:false — not required' : undefined);
      say('payload: ' + (redLine[0] || '').trim());
    }

    /* ---------- A4  the result page, as a person sees it ---------- */
    const pageSurface = await readSurface(result, 'document.body');
    const pageBad = pageSurface.strings.filter(s => lexHits(s.text).length);
    check('A4a no verdict vocabulary in any visible string on the result page',
      pageBad.length === 0, pageBad.map(s => s.el + ': ' + s.text.slice(0, 90)).join(' | '));
    const pageGlyph = pageSurface.strings.filter(s => glyphHits(s.text).length);
    check('A4b no tick / shield / padlock glyph on the result page',
      pageGlyph.length === 0, pageGlyph.map(s => s.el + ': ' + s.text.slice(0, 60)).join(' | '));
    const line = pageSurface.strings.find(s => /redactLine/.test(s.el));
    seenLine = line ? line.text : null;
    say('acts line: ' + (line ? line.text : '(hidden)'));

    /* ---------- A5 / E  the review dialog ---------- */
    await spyClipboard(result);
    const before = await clipCalls(result);
    await result.click('#copyBtn').catch(() => {});
    const opened = await waitDialog(result, 15000);
    const shouldGate = r.requested !== false;
    check('A5a Copy opens the review dialog exactly when redaction was requested',
      opened === shouldGate, 'requested=' + JSON.stringify(r.requested) + ' opened=' + opened);

    if (opened) {
      const dlg = await readSurface(result, DIALOG_EL);
      const dBad = dlg.strings.filter(s => lexHits(s.text).length);
      check('A5b no verdict vocabulary anywhere in the review dialog',
        dBad.length === 0, dBad.map(s => s.el + ': ' + s.text.slice(0, 90)).join(' | '));
      const dGly = dlg.strings.filter(s => glyphHits(s.text).length);
      check('A5c no tick / shield / padlock glyph in the review dialog',
        dGly.length === 0, dGly.map(s => s.el + ': ' + s.text.slice(0, 60)).join(' | '));
      /* THE COLOUR. Success-green is hue 90-165 with real saturation; anything
         in that band, on any property, in the dialog, is a verdict painted
         rather than written. Measured, so renaming the CSS variable does not
         move it. */
      const green = dlg.colours.filter(c => c.h >= 90 && c.h <= 165 && c.s >= 25 && c.l >= 18 && c.l <= 82);
      check('A5d nothing in the review dialog is painted success-green',
        green.length === 0, green.map(c => c.el + ' ' + c.prop + ' ' + c.css + ' (h' + c.h + ' s' + c.s + ')').join(' | '));
      const confirm = dlg.strings.find(s => /reviewConfirm/.test(s.el));
      say('confirm button: ' + (confirm ? JSON.stringify(confirm.text) : '(not found)'));
      say('dialog colours outside greyscale: ' + (dlg.colours.filter(c => c.s >= 20)
        .map(c => c.prop + ' ' + c.css).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || 'none'));

      /* Escape must cancel and the clipboard must be untouched. */
      await result.keyboard.press('Escape');
      await result.waitForTimeout(400);
      const stillOpen = await result.evaluate('!!' + DIALOG_EL);
      check('A5e Escape cancels the dialog', !stillOpen);
      check('A5f a cancelled review leaves the clipboard untouched',
        (await clipCalls(result)) === before, 'calls=' + (await clipCalls(result)));
    }

    /* ---------- B  the ledger against the picture ---------- */
    const found = await countBlocks(result);
    const nb = found.blocks.length;
    say('solid #111111 regions in the delivered image: ' + nb +
        (nb && nb <= 8 ? '  ' + found.blocks.map(x => x.x + ',' + x.y + ' ' + x.w + 'x' + x.h + ' ' + x.fill + '%').join(' | ') : '') +
        '  (rejected as too small: ' + found.rejected + ')');
    if (Array.isArray(r.marks) && typeof a.verifiedOpaque === 'number') {
      /* B3 — MARKS ARE BLOCKS, `verifiedOpaque` IS MATCHES, and this check used
         to equate them. One match is one block per client rect, so a token that
         wraps has two marks and is one covered match: the equality held only
         while no fixture wrapped, which is the same unit error the product
         carried. What is actually promised (§3.3) is that every mark is a
         verified block and no unverified rect travels — so the bound is the
         BLOCKS HANDED, and every mark is then re-read against the delivered
         pixels by B1. A covered match cannot have fewer than one mark. */
      check('B3 every mark is a verified block, and no unverified rect travels',
        r.marks.length <= (typeof rec.piiCount === 'number' ? rec.piiCount : r.marks.length) &&
        r.marks.length >= a.verifiedOpaque,
        'marks=' + r.marks.length + ' blocks handed=' + rec.piiCount +
        ' covered matches=' + a.verifiedOpaque);
      const audit = await auditMarks(result, r.marks);
      say('mark audit: ' + r.marks.length + ' marks cover ' + audit.markPx + ' px; ' +
          audit.blockPx + ' block-coloured px in the image, ' + audit.stray + ' of them outside every mark');
      /* B1 — the per-block form of "verifiedOpaque means opaque in the file the
         user holds". Cannot merge, so a stack of touching blocks is still N
         separate answers. */
      check('B1 every block the ledger verified is a solid block-coloured region in the DELIVERED image',
        audit.bad.length === 0,
        audit.bad.length + '/' + r.marks.length + ' bad: ' +
        audit.bad.slice(0, 4).map(x => '#' + x.i + ' ' + x.why +
          (x.pct != null ? ' (' + x.pct + '% block)' : '') +
          ' @' + x.m.x + ',' + x.m.y + ' ' + x.m.w + 'x' + x.m.h).join(' | '));
      /* B2 — the other direction. When painting and verifying agree, every
         block pixel in the image belongs to a counted rect; a stray one is a
         block the ledger did not count. Where painted > verifiedOpaque the
         surplus is legitimate (a painted block the read-back could not confirm)
         and the stray pixels are reported rather than graded. */
      if (a.painted === a.verifiedOpaque) {
        check('B2 the delivered image holds no block-coloured pixel outside a counted rect',
          audit.stray === 0, 'stray=' + audit.stray + ' of ' + audit.blockPx);
      } else {
        note('painted (' + a.painted + ') exceeds verifiedOpaque (' + a.verifiedOpaque +
          ') so B2 is not graded', audit.stray + ' block px lie outside every mark');
      }
    }

    /* ---- B4  THE ALARM, AND WHETHER IT CAN BE CANCELLED ---------------------
       §3.4 reserves one variant — "$N$ match is not covered in this image",
       "the only bolded line in the design" — for the case where FullShot
       covered less than it matched. The alarm's own condition used to be
       `painted < matched || verifiedOpaque < painted`, two comparisons across a
       unit boundary, and the product's fix was to put all three counters in the
       MATCH unit.

       THIS CHECK THEN CERTIFIED THAT FIX WITH THE SAME MISTAKE IN IT.
       `rec.piiCount > a.verifiedOpaque` compares BLOCKS handed with MATCHES
       covered, and it survived only because no fixture in this corpus wrapped a
       token across a line: the day one does, one match produces two blocks,
       piiCount is 2, verifiedOpaque is 1, and this demands an alarm about a
       capture in which nothing whatever went wrong. A green check that is green
       only while the defect it grades is present teaches the defect to whoever
       reads the suite next — and a check that lives in the file used to certify
       a unit fix has to be the last place in the tree where units are mixed.

       SO IT IS WRITTEN IN BLOCKS ON BOTH SIDES. `meta.piiCount` is the number of
       blocks the scan handed over; `redaction.marks` is one entry per block READ
       BACK OPAQUE in the delivered image (§3.3), and no unverified rect is
       allowed to travel there. Both count client rects. `piiCount > marks` is
       therefore an apples-to-apples statement that at least one emitted block is
       not covered — which by §2.1's rule (a match is covered only when every
       block it produced was) means some match is not covered, and the sentence
       must say so. Independent of the product's roll-up in the way the old form
       only claimed to be: neither side of it is a counter the roll-up wrote.

       B4b is the other end of the same pipeline. A block the box ceiling never
       emitted is not in `piiCount` at all — it is in `acts.blocksLost` — so the
       comparison above cannot see it, and the ninth round of this feature's
       bugs lived in exactly that blind spot. */
    const alarmShown = line ? /not covered/.test(line.text) : false;
    if (typeof a.matched === 'number' && typeof a.painted === 'number') {
      say('arithmetic: matched=' + a.matched + ' painted=' + a.painted +
          ' verifiedOpaque=' + a.verifiedOpaque + ' (matches)' +
          ' | blocks handed (meta.piiCount)=' + rec.piiCount +
          ' blocks marked=' + (Array.isArray(r.marks) ? r.marks.length : '?') +
          ' blocks lost to the ceiling=' + a.blocksLost +
          ' | shortfall sentence ' + (alarmShown ? 'SHOWN' : 'not shown'));
    }
    if (typeof rec.piiCount === 'number' && Array.isArray(r.marks) && r.requested !== false) {
      check('B4 when an emitted block is not covered in the delivered image, the sentence a person reads says so',
        !(rec.piiCount > r.marks.length) || alarmShown,
        'blocks handed=' + rec.piiCount + ' blocks read back opaque=' + r.marks.length +
        ' — alarm ' + (alarmShown ? 'shown' : 'SILENT') +
        ' | line: ' + (line ? JSON.stringify(line.text) : '(none)'));
    }
    if (typeof a.blocksLost === 'number' && r.requested !== false) {
      check('B4b …and a block the ceiling never let it draw is not a covered match either',
        !(a.blocksLost > 0) || alarmShown,
        'blocks lost=' + a.blocksLost + ' — alarm ' + (alarmShown ? 'shown' : 'SILENT') +
        ' | line: ' + (line ? JSON.stringify(line.text) : '(none)'));
    }

    /* B5 — the ground truth this fixture declares about its own picture. */
    if (shape.colours) {
      const rows = await colourRows(result, shape.colours);
      say('marker rows surviving in the delivered image: ' + JSON.stringify(rows));
      for (const n of (shape.gone || [])) {
        check('B5 the ' + n + ' marker is gone from the delivered image', rows[n] === 0, 'rows=' + rows[n]);
      }
      for (const n of (shape.kept || [])) {
        check('B5 the ' + n + ' decoy is still in the delivered image', rows[n] > 0, 'rows=' + rows[n]);
      }
    }
    if (typeof shape.blocks === 'number') {
      check('B6 the delivered image holds exactly the ' + shape.blocks + ' blocks this fixture declares',
        nb === shape.blocks, 'regions=' + nb);
    }

    /* B7 — a truncated walk must SAY it was truncated. */
    if (shape.truncated) {
      check('B7a a walk stopped by the box ceiling reports walkComplete:false',
        a.walkComplete === false, 'walkComplete=' + JSON.stringify(a.walkComplete));
      check('B7b …and names the budget that stopped it',
        a.truncatedBy === 'ceiling' || a.truncatedBy === 'time' || a.truncatedBy === 'elements',
        'truncatedBy=' + JSON.stringify(a.truncatedBy));
      check('B7c …and the sentence a person reads says so',
        !!line && /did not finish walking/i.test(line.text), line ? line.text.slice(0, 140) : '(no line)');
    } else if (a.walkComplete === false) {
      note(shape.name + ' reported an incomplete walk this run',
        'truncatedBy=' + JSON.stringify(a.truncatedBy));
    }
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }
  return { name: shape.name, line: seenLine };
}

/* ==========================================================================
   LENS C — the race, run enough times to quote a number
   ========================================================================== */
async function runRace(ctx, sw) {
  begin('race  (' + RUNS + ' captures, preference rewritten inside the window each time)');
  say('The defect: `requested` and the whole bake ledger were derived from');
  say('cap.settings.redactPII — a re-read of the preference taken at FS_DONE,');
  say('minutes after the pass it describes. Each run here starts a capture with');
  say('the setting ON, so the pass genuinely runs and meta.piiPass is true, then');
  say('writes `false` twice while the scroll loop is still going. Every later');
  say('read of the preference therefore returns the OPPOSITE of what the pass');
  say('did, which is the exact condition the defect needed. prefAtEnd proves it.');

  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    /* TRUE AT THE MOMENT THE PASS DECIDES. This is what makes the run a test of
       the RACE and not of the feature: `startCapture` reads the preference and
       hands it to the engine, so the pass must genuinely run. A first draft
       flipped throughout and simply turned redaction OFF for the whole
       capture — which produced `requested: false` over an unredacted image,
       an honest record of a capture that never redacted, and no evidence about
       the seam at all. */
    await setSettings(sw, { redactPII: true });
    const page = await ctx.newPage();
    await page.goto(VER + 'race-pii.html', { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForTimeout(400);

    const wait = ctx.waitForEvent('page', {
      predicate: p => p.url().includes('pages/result.html'), timeout: 300000
    });
    wait.catch(() => {});

    /* startCapture resolves after FS_START has been delivered and acknowledged,
       so by the time this returns the engine has already been handed the
       settings snapshot and `meta.piiPass` has been written from the branch
       that decided. Everything after this point is the WINDOW the old defect
       lived in: minutes wide in the field, a few seconds here. */
    await sw.evaluate(async (pageUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url === pageUrl) || tabs.find(t => (t.url || '').startsWith('http'));
      if (!tab) throw new Error('test tab not found');
      await chrome.tabs.update(tab.id, { active: true });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
      await new Promise(r => setTimeout(r, 150));
      /* not awaited: the write below must land DURING the scroll loop, and
         startCapture does not resolve until the capture is finished */
      self.__pvRace = startCapture(tab, 'full', 0);
      self.__pvRace.catch(() => {});
    }, VER + 'race-pii.html');

    /* THE ATTACK, and it is deliberately small. chrome.storage.sync enforces
       MAX_WRITE_OPERATIONS_PER_MINUTE, so a hundred flips per capture is not a
       harsher test — it is a test that throws. Two writes, both inside the
       window, is all the defect ever needed: one options save, one sync write
       from another machine landing. The second is timed a second later so it
       lands in a different phase of the scroll loop. */
    let flips = 0;
    for (const delay of [220, 1200]) {
      await page.waitForTimeout(delay);
      const ok = await sw.evaluate(async () => {
        try { await chrome.storage.sync.set({ redactPII: false }); return true; } catch (_) { return false; }
      });
      if (ok) flips++;
    }

    const result = await wait;
    await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
    await result.waitForTimeout(700);
    /* Proof the preference really was `false` while FS_DONE ran — otherwise a
       green run is a run where the attack never happened. */
    const prefAtEnd = await sw.evaluate(async () =>
      (await chrome.storage.sync.get('redactPII')).redactPII);

    const rec = await readRecord(result);
    const r = rec.redaction || {};
    const a = r.acts || {};
    const blocks = (await countBlocks(result)).blocks.length;
    const rowsSeen = await colourRows(result, { email: [255,90,90], phone: [90,200,120], card: [90,130,255] });
    const row = {
      i, flips, prefAtEnd,
      requested: r.requested,
      matched: a.matched, painted: a.painted, verified: a.verifiedOpaque,
      ledger: a.ledger,
      marks: Array.isArray(r.marks) ? r.marks.length : null,
      capSetting: rec.captureSettings ? rec.captureSettings.redactPII : undefined,
      blocks,
      leaked: Object.keys(rowsSeen).filter(k => rowsSeen[k] > 0)
    };
    rows.push(row);
    console.log('  run ' + String(i + 1).padStart(2) + '/' + RUNS +
      '  writes=' + flips + ' prefAtEnd=' + JSON.stringify(prefAtEnd) +
      '  requested=' + JSON.stringify(row.requested) +
      '  ' + row.matched + '/' + row.painted + '/' + row.verified +
      '  ledger=' + row.ledger +
      '  marks=' + row.marks +
      '  cap.settings.redactPII=' + JSON.stringify(row.capSetting) +
      '  blocks=' + blocks +
      (row.leaked.length ? '  LEAKED=' + row.leaked.join(',') : ''));

    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }

  await setSettings(sw, { redactPII: true });

  const bad = rows.filter(x => x.requested !== true);
  const zero = rows.filter(x => !(x.painted > 0));
  const collapsed = rows.filter(x => x.painted === 0 && x.blocks > 0);
  const leaks = rows.filter(x => x.leaked.length);
  const noMarks = rows.filter(x => !(x.marks > 0));
  const disagree = rows.filter(x => x.capSetting !== true);
  const totalFlips = rows.reduce((s, x) => s + x.flips, 0);
  const armed = rows.filter(x => x.flips > 0 && x.prefAtEnd === false);

  say('preference writes landed inside the window: ' + totalFlips +
      ' across ' + RUNS + ' captures');
  /* A green run where the attack never fired proves nothing, so the number of
     ARMED runs is reported before any of the results are. */
  check('C0 the attack was armed — the preference read `false` at the end of the capture',
    armed.length === RUNS, armed.length + '/' + RUNS + ' runs');
  check('C1 requested === true on every run (' + RUNS + ' runs)',
    bad.length === 0, bad.length + ' run(s): ' + bad.map(x => '#' + (x.i + 1) + '=' + JSON.stringify(x.requested)).join(', '));
  check('C2 the ledger never collapsed to zero while blocks were in the image',
    collapsed.length === 0, collapsed.length + ' run(s)');
  check('C3 painted > 0 on every run', zero.length === 0,
    zero.length + ' run(s): ' + zero.map(x => '#' + (x.i + 1)).join(', '));
  check('C4 marks persisted on every run', noMarks.length === 0,
    noMarks.length + ' run(s): ' + noMarks.map(x => '#' + (x.i + 1)).join(', '));
  check('C5 no marker colour survived in any delivered image — the protection actually happened',
    leaks.length === 0, leaks.map(x => '#' + (x.i + 1) + ':' + x.leaked.join('/')).join(', '));
  if (disagree.length) {
    note('the persisted cap.settings.redactPII disagreed with the pass on ' + disagree.length +
      '/' + RUNS + ' runs', 'the snapshot fix (R-18) is what keeps this at 0; a non-zero here ' +
      'is the seam re-opening and would matter even though `requested` no longer reads it');
  } else {
    say('cap.settings.redactPII agreed with the pass on all ' + RUNS +
        ' runs — the FS_START snapshot is holding as well as the piiPass fix');
  }
  return rows;
}

/* ==========================================================================
   THE SAME RECORD, ON THE OTHER SCREEN

   §2.2 replaces the history verdict badge with "the acts line", and the comment
   in pages/history.js calls it "the same stats line the result page shows".
   §3.4 defines FOUR sentences, not one, and reserves the third — "$N$ match is
   not covered in this image" — as "the only bolded line in the design".

   A record says what it says wherever it is listed, so this reads the SAME
   record on both screens and compares. It is graded on the sentence, not on
   the layout: the history card is a smaller thing than the result page and is
   entitled to look different. It is not entitled to leave out the alarm.
   ========================================================================== */
async function runHistoryEcho(ctx, extBase, seen) {
  begin('the same record on the history page');
  const p = await ctx.newPage();
  await p.goto(extBase + 'pages/history.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const cards = await p.evaluate(() => {
    const txt = el => (el ? (el.innerText || el.textContent || '') : '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('a[href*="result.html"], [class*="card"], li, article'))
      .map(el => txt(el)).filter(t => t.length > 10 && t.length < 900);
  });
  const blob = cards.join('\n');
  for (const s of seen) {
    if (!s.line) continue;
    /* the distinguishing half of each variant — the part §3.4 makes it for */
    const want = /not covered in this image/.test(s.line) ? 'not covered in this image'
      : /did not finish walking/.test(s.line) ? 'did not finish walking'
      : /matched nothing in the text it read/.test(s.line) ? 'matched nothing in the text it read'
      : null;
    if (!want) continue;
    check('A9 [' + s.name + '] the history page repeats the sentence the result page showed',
      blob.includes(want),
      'result page said: ' + JSON.stringify(s.line.slice(0, 120)) +
      ' | history has no "' + want + '"');
  }
  const shortfallCards = cards.filter(c => /Redaction on\. .* matched/.test(c));
  if (shortfallCards.length) say('history acts lines seen: ' +
    shortfallCards.slice(0, 6).map(c => JSON.stringify((/Redaction[^|]*?image\./.exec(c) || [c])[0].slice(0, 110))).join(' '));
  await p.close();
}

/* ==========================================================================
   LENS A, THE OTHER SURFACES

   §0.1 says "no field, sentence, icon or colour", not "no field in the bundle".
   The result page and the review dialog are graded per shape above; these are
   the two screens a person meets that are NOT the result page — the settings
   screen where they decide to trust the feature, and the history list where
   they meet the image again a week later. A claim on either is a claim.
   ========================================================================== */
async function runSurfaces(ctx, sw, extBase) {
  begin('other surfaces');
  for (const [name, url] of [['options', extBase + 'pages/options.html'],
                             ['history', extBase + 'pages/history.html']]) {
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    const s = await readSurface(p, 'document.body');
    const red = s.strings.filter(x => /redact|pii|sensitive/i.test(x.text));
    for (const x of red) say(name + ' [' + (x.key || x.el) + '] ' + x.text.slice(0, 240));
    const bad = s.strings.filter(x => lexHits(x.text).length);
    check('A6 no verdict vocabulary on the ' + name + ' page',
      bad.length === 0, bad.map(x => (x.key || x.el) + ': ' + x.text.slice(0, 100)).join(' | '));
    /* A tick is a verdict when it is a verdict ABOUT THE IMAGE. The options
       page's "Saved ✓" pill is the same generic form-save confirmation every
       one of the twenty-odd settings gets, and grading it here would be the
       verifier crying wolf — but it is reported, because it is rendered in
       --ok green immediately below the redaction toggle the user has just
       ticked, and adjacency is how a person assembles a meaning. */
    const gly = s.strings.filter(x => glyphHits(x.text).length);
    const glyRed = gly.filter(x => /redact|pii|sensitive|block|cover/i.test(x.text));
    check('A7 no tick / shield / padlock glyph on any redaction string on the ' + name + ' page',
      glyRed.length === 0, glyRed.map(x => (x.key || x.el) + ': ' + x.text.slice(0, 60)).join(' | '));
    for (const x of gly.filter(g => !glyRed.includes(g))) {
      note('a ' + glyphHits(x.text).join('') + ' glyph on the ' + name +
        ' page, outside any redaction string — not graded',
        (x.key || x.el) + ': ' + JSON.stringify(x.text.slice(0, 60)));
    }

    /* THE COMPLETENESS CLAIM, WHICH IS NOT A WORD ON THE FORBIDDEN LIST.
       §7 rewrote exactly this sentence in STORE-LISTING.md because "scans the
       page … over EACH" is two claims about the page rather than about what the
       tool did. The same sentence anywhere else in the product is the same
       claim, and this is the one screen where the user is deciding whether to
       rely on it. */
    const complete = s.strings.filter(x =>
      /\bscans the page\b/i.test(x.text) || /\bover each\b/i.test(x.text) ||
      /\bfinds? (?:all|every)\b/i.test(x.text));
    check('A8 the ' + name + ' page makes no completeness claim about the page',
      complete.length === 0,
      complete.map(x => (x.key || x.el) + ': ' + x.text.slice(0, 200)).join(' | '));
    await p.close();
  }
}

/* ==========================================================================
   runner
   ========================================================================== */
(async () => {
  const TEST_EXT = prepareTestExtension();
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-privacy-verify-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: ['--disable-extensions-except=' + TEST_EXT, '--load-extension=' + TEST_EXT]
  });
  ctx.on('page', p => p.on('download', d => d.delete().catch(() => {})));
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await setSettings(sw, { redactPII: true });

    const extBase = sw.url().replace(/background\.js.*$/, '');
    if (MODE === 'race') {
      await runRace(ctx, sw);
    } else {
      if (!ONLY.length || ONLY.includes('surfaces')) {
        try { await runSurfaces(ctx, sw, extBase); }
        catch (e) { check('other surfaces :: ran to completion', false, String((e && e.message) || e)); }
      }
      const seen = [];
      for (const s of SHAPES) {
        if (ONLY.length && !ONLY.includes(s.name)) continue;
        try { seen.push(await runShape(ctx, sw, s)); }
        catch (e) { check(s.name + ' :: ran to completion', false, String((e && e.message) || e)); }
      }
      if (seen.length) {
        try { await runHistoryEcho(ctx, extBase, seen); }
        catch (e) { check('history echo :: ran to completion', false, String((e && e.message) || e)); }
      }
    }
  } finally {
    await ctx.close();
    srv.close();
  }
  if (R.notes.length) { console.log('\n=== NOTES ==='); for (const n of R.notes) console.log('  ' + n); }
  if (R.fails.length) { console.log('\n=== FAILURES ==='); for (const f of R.fails) console.log('  ' + f); }
  console.log('\n' + R.pass + ' pass, ' + R.fail + ' fail, ' + R.note + ' note');
  process.exit(R.fail ? 1 : 0);
})();
