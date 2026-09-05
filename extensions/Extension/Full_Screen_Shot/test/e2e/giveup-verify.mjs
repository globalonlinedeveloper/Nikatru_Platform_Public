/* FullShot — THE GIVING-UP POINTS, in a real browser.
   ==========================================================================

   REDACTION-CLAIM-SPEC.md §2.1.1 states one rule and this suite is that rule
   turned into pages:

     Anywhere the pipeline gives up on something — a cap, a ceiling, a timeout,
     a `continue`, a refusal, a catch — that fact is recorded, carried, and
     reaches the surface. A count without its completeness flag is not a count.

   So each fixture TRIPS one giving-up point in real Chromium, and for each the
   suite follows the fact all the way out: the record, the envelope, the ASCII
   payload, the permanent line on the result page, the review dialog, and the
   History row. A fact that stops anywhere short of the last of those is the
   class the round claims to have fixed, one instance later.

   It also asks the question the class is really about — is there a giving-up
   point NOBODY ENUMERATED — by grading a property rather than a list:

     G  where the pipeline ITSELF observed that it was declining to read
        something, `matchedComplete` must not be `true`.

   The narrowing is the whole point. §9 already concedes that text drawn as
   pixels is invisible to this instrument, and `matchedComplete: true` over a
   canvas full of card numbers is defensible because NOTHING WAS COMPUTED.
   §2.1.1 is about the other case: a refusal the code positively observed,
   counted, and then dropped, after which downstream reasons over a partial set
   believing it complete. So the check asks the PAGE what the engine could see
   itself declining, and grades only that.

   Usage:  node giveup-verify.mjs
           ONLY=leafcap node giveup-verify.mjs
           HEADFUL=1 node giveup-verify.mjs
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve, prepareTestExtension, setSettings, EXT_DIR, OUT_DIR } from './claim-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* run.mjs 8907 · claim 8911 · adv 8913 · corpus 8917 · batch 8921 ·
   privacy 8127. Overridable because a run that is killed mid-flight leaves the
   listener up, and a suite that cannot be re-run is a suite nobody re-runs. */
const PORT = Number(process.env.PORT || 8131);
const BASE = 'http://127.0.0.1:' + PORT;
const GIV = BASE + '/test/e2e/fixtures-giveup/';
const FIX = BASE + '/test/e2e/fixtures/';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);

fs.mkdirSync(OUT_DIR, { recursive: true });

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
const J = v => JSON.stringify(v);

/* ---- the SCAN ledger, before result.js consumes it -----------------------
   `meta.piiScan` lives on the `captures` row for the few seconds between
   FS_DONE and the stitch, and §2.2 deliberately does not persist it. Reading it
   here is not a shortcut past the record: it is how a claim about something
   being COMPUTED AND THEN DROPPED is made out of the pipeline's own bookkeeping
   rather than out of my inference. The tap wraps FSDB.put in the worker and is
   installed once. */
const installLedgerTap = sw => sw.evaluate(() => {
  if (self.__guTap) return true;
  self.__guTap = [];
  const orig = FSDB.put.bind(FSDB);
  FSDB.put = async (store, rec) => {
    if (store === 'captures') {
      try { self.__guTap.push(JSON.parse(JSON.stringify((rec.meta && rec.meta.piiScan) || null))); } catch (_) {}
    }
    return orig(store, rec);
  };
  return true;
});
const lastScanLedger = sw => sw.evaluate(() =>
  (self.__guTap && self.__guTap.length) ? self.__guTap[self.__guTap.length - 1] : null);

/* ---------------- one capture ---------------- */
async function capture(ctx, sw, url, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(opts.settleMs || 900);
  /* 🔴 A BUDGET IN MILLISECONDS IS A FACT ABOUT THE MACHINE, and this is where
     that sentence used to be answered with CDP CPU throttling — put the browser
     on a slow machine and hope 9,000 leaves take longer than 1,200 ms. That is
     a race against the runner, and on 2026-08-31 the runner won: `timecap` came
     back `truncatedBy: null`, `walkComplete: true`, and R1/R2/R3/B3/S6 failed
     because the pass under test NEVER GAVE UP. The subject was non-deterministic,
     not the assertions, so the subject is what changed: the walk's budget is now
     injected through the settings the engine is handed (`redactWalkMs`, see
     content/capture.js `fsPiiWalkBudget`), and `settings` on a shape below pins
     it. Nothing here is throttled and nothing here is timed.

     The assertions are untouched and they still bite: if the pin does not reach
     the engine the walk simply finishes, and R1/R2/R3 fail exactly as they did
     on 2026-08-31. */
  const wait = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'), timeout: 600000
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
  await result.waitForSelector('#view:not([hidden])', { timeout: 600000 });
  await result.waitForTimeout(opts.lineSettleMs || 1600);
  return { page, result };
}

const readRecord = page => page.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const plain = v => { try { return JSON.parse(JSON.stringify(v == null ? null : v)); } catch (_) { return '<unserialisable>'; } };
  return { id, redaction: plain(shot.redaction), w: shot.w,
           segs: shot.segments.length, segH: shot.segments.map(s => s.h),
           topKeys: Object.keys(shot) };
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

/* ---- what a person can read in the delivered PNG -------------------------
   Colour, per row, across every segment. The fixtures put the marker colour on
   the PII token itself, so a surviving row of that colour is a surviving token.
   Nothing in the product is asked whether it should be there. */
const countColours = (page, colours, tol = 22) => page.evaluate(async ({ names, list, tol }) => {
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

/* Solid #111111 components in the delivered image — the blocks that are really
   there, counted by flood fill rather than by re-reading the counter that drew
   them. */
const countBlocks = page => page.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  let total = 0;
  for (const seg of shot.segments) {
    const bmp = await createImageBitmap(seg.blob);
    const W = bmp.width, H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, W, H).data;
    const seen = new Uint8Array(W * H);
    const isB = i => d[i * 4] === 0x11 && d[i * 4 + 1] === 0x11 && d[i * 4 + 2] === 0x11;
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || !isB(i)) continue;
      let minX = i % W, maxX = minX, minY = (i / W) | 0, maxY = minY, n = 0;
      const st = [i]; seen[i] = 1;
      while (st.length) {
        const p = st.pop(); n++;
        const x = p % W, y = (p / W) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const push = q => { if (q >= 0 && q < W * H && !seen[q] && isB(q)) { seen[q] = 1; st.push(q); } };
        if (x > 0) push(p - 1);
        if (x < W - 1) push(p + 1);
        push(p - W); push(p + W);
      }
      if (maxX - minX >= 6 && maxY - minY >= 6 && n >= 120) total++;
    }
    bmp.close();
  }
  return total;
});

async function savePng(page, name) {
  try {
    const b64 = await page.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.writeFileSync(path.join(OUT_DIR, 'gu-' + name + '.png'), Buffer.from(b64, 'base64'));
  } catch (_) {}
}

/* ---- the surfaces --------------------------------------------------------
   The permanent line, then the review dialog, found the way the corpus finds
   it: role=dialog + aria-modal, never by id. */
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

const lineText = page => page.evaluate(() => {
  const el = document.querySelector('[data-fs-redaction-line], #redactLine, .redactline');
  if (!el || el.hidden) return null;
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
});

async function openDialog(page) {
  await page.evaluate(() => {
    if (window.__guSpy) return;
    window.__guSpy = [];
    const rec = () => function () { window.__guSpy.push('write'); return Promise.resolve(); };
    for (const o of [Clipboard.prototype, navigator.clipboard]) {
      try { Object.defineProperty(o, 'write', { configurable: true, writable: true, value: rec() }); } catch (_) {}
      try { Object.defineProperty(o, 'writeText', { configurable: true, writable: true, value: rec() }); } catch (_) {}
    }
  });
  const btn = await page.$('#copyBtn');
  if (!btn) return null;
  await btn.click();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (await page.evaluate('!!' + DIALOG_EL)) break;
    await page.waitForTimeout(150);
  }
  const txt = await page.evaluate(`(() => { const d = ${DIALOG_EL};
     return d ? (d.innerText || d.textContent || '').replace(/\\s+/g,' ').trim() : null; })()`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  return txt;
}

async function historyText(ctx, extBase, id) {
  const p = await ctx.newPage();
  await p.goto(extBase + 'pages/history.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const t = await p.evaluate((wanted) => {
    const cards = Array.from(document.querySelectorAll('*')).filter(el =>
      el.querySelector && el.querySelector('img') &&
      (el.innerText || '').trim().length > 4 && el.children.length &&
      !Array.from(el.children).some(c => c.querySelector && c.querySelector('img')));
    const all = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const own = Array.from(document.querySelectorAll('[data-id="' + wanted + '"], [data-shot="' + wanted + '"]'))
      .map(el => (el.innerText || '').replace(/\s+/g, ' ').trim());
    return { all, own, cards: cards.length };
  }, id);
  await p.close();
  return t;
}

/* ==========================================================================
   THE FIXTURES, one per giving-up point
   ========================================================================== */
const SHAPES = [
  { name: 'ceiling-straddle', url: GIV + 'ceiling-straddle.html',
    colours: { card: [90, 130, 255] },
    want: { truncatedBy: 'ceiling', matchedComplete: false, shortfall: true,
            gapKey: 'blocksLost' } },
  { name: 'leafcap', url: GIV + 'leafcap.html',
    colours: { refused: [90, 200, 120], covered: [255, 90, 90] },
    want: { matchedComplete: false, gapKey: 'textRefused' } },
  { name: 'walkcap', url: GIV + 'walkcap.html',
    colours: { late: [255, 90, 90] },
    want: { truncatedBy: 'elements', walkComplete: false, matchedComplete: false } },
  /* THE ONE SHAPE THAT CANNOT TRIP ITSELF. Every other fixture here trips its
     giving-up point with MARKUP — 40,010 elements, a 4,001-character leaf, a
     block that straddles the 2,000-box ceiling — and markup is the same on
     every machine. A millisecond budget is not: whether 9,000 leaves take
     longer than 1,200 ms is a property of the runner, and the runner is not
     under test. So this shape pins the budget the engine races instead of
     trying to outrun it. `redactWalkMs: 0` puts the deadline at the walk's
     first instant, so `forEachDeep` takes the `time` branch at its first
     deadline check whatever the hardware, and the page below stays exactly as
     tall and as expensive as it was — a walk that stops after 512 of 9,000
     elements leaves the email at its foot unread, which is the fact the
     fixture exists to produce. */
  { name: 'timecap', url: GIV + 'timecap.html', settings: { redactWalkMs: 0 },
    colours: { late: [255, 90, 90] },
    want: { truncatedBy: 'time', walkComplete: false, matchedComplete: false } },
  /* THE CROSS-SURFACE QUESTION. The one refusal that reaches `matchedComplete`
     and no gap counter — so the payload says PARTIAL and every human surface is
     silent, about the same record. */
  { name: 'defercap', url: GIV + 'defercap.html',
    colours: { covered: [255, 90, 90] },
    want: { matchedComplete: false }, crossSurface: true },
  { name: 'verifyrefusal', url: GIV + 'verifyrefusal.html',
    colours: { control: [255, 90, 90] },
    want: { shortfall: true, gapKey: 'blocksUnread' } },
  /* THE CLASS HUNT. Not a cap, not a ceiling, not a timeout — a door the walk
     counts and never opens, while the capture pipeline grows what is behind it
     to full height and puts it in the picture. */
  { name: 'iframe-door', url: FIX + 'iframe-host.html',
    colours: { email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255] },
    want: {}, hunt: true },
  /* the control that keeps G1 narrow — see the header */
  { name: 'canvas-pii', url: FIX + 'canvas-pii.html',
    colours: {}, want: {}, huntControl: true }
];

/* THE SETTINGS EVERY SHAPE RUNS UNDER unless it says otherwise. Written out in
   full and re-asserted per shape rather than patched and left, because
   `setSettings` writes until the value STICKS and a shape that pinned something
   must not leak it into the next one — a fixture that trips a giving-up point
   because the shape before it changed a budget is a fixture proving nothing. */
const BASE_SETTINGS = { redactPII: true, redactWalkMs: -1 };

async function runShape(ctx, sw, extBase, shape) {
  begin(shape.name);
  await setSettings(sw, Object.assign({}, BASE_SETTINGS, shape.settings || {}));
  const { page, result } = await capture(ctx, sw, shape.url, shape);
  try {
    const scan = await lastScanLedger(sw);
    if (scan) {
      say('scan ledger (not persisted, §2.2): matched=' + J(scan.matched) +
          ' frames=' + J(scan.frames) + ' declined=' + J(scan.declined) +
          ' truncated=' + J(scan.truncated) + ' matchedComplete=' + J(scan.matchedComplete) +
          ' blocksLost=' + J(scan.blocksLost) + ' matchesTruncated=' + J(scan.matchesTruncated) +
          ' rectsSkipped=' + J(scan.rectsSkipped) + ' matchedNoBox=' + J(scan.matchedNoBox));
    }
    const rec = await readRecord(result);
    const r = rec.redaction || {};
    const a = r.acts || {};
    say('acts ' + J(a));
    say('marks=' + (Array.isArray(r.marks) ? r.marks.length : 'none') +
        '  image ' + rec.w + 'x' + rec.segH.reduce((x, y) => x + y, 0) + ' in ' + rec.segs + ' segment(s)');
    await savePng(result, shape.name);

    const pix = shape.colours ? await countColours(result, shape.colours) : {};
    const blocks = await countBlocks(result);
    say('surviving marker rows ' + J(pix) + '  solid blocks in the PNG: ' + blocks);

    const w = shape.want || {};

    /* ---------- 1  the fact is RECORDED ---------- */
    if (w.truncatedBy !== undefined) {
      check('R1 the ledger names the limit that bound it', a.truncatedBy === w.truncatedBy,
        'truncatedBy=' + J(a.truncatedBy) + ' want ' + J(w.truncatedBy));
    }
    if (w.walkComplete !== undefined) {
      check('R2 walkComplete says the walk stopped early', a.walkComplete === w.walkComplete,
        'walkComplete=' + J(a.walkComplete));
    }
    if (w.matchedComplete !== undefined) {
      check('R3 the COUNT carries its own completeness, not only the walk',
        a.matchedComplete === w.matchedComplete, 'matchedComplete=' + J(a.matchedComplete));
    }
    if (w.gapKey) {
      check('R4 the gap counter ' + w.gapKey + ' is a positive number',
        typeof a[w.gapKey] === 'number' && a[w.gapKey] > 0, w.gapKey + '=' + J(a[w.gapKey]));
    }
    if (w.shortfall) {
      const short = (typeof a.matched === 'number' && typeof a.verifiedOpaque === 'number')
        ? a.matched - a.verifiedOpaque : null;
      check('R5 a match is NOT graded covered on truncated evidence',
        short !== null && short > 0,
        'matched=' + J(a.matched) + ' painted=' + J(a.painted) +
        ' verifiedOpaque=' + J(a.verifiedOpaque) + ' shortfall=' + J(short));
    }
    /* Monotone, always: a covered count above a matched one is the arithmetic
       impossibility §2.1 forbids, whatever produced it. */
    const mono = (typeof a.matched !== 'number') ||
      ((typeof a.painted !== 'number' || a.painted <= a.matched) &&
       (typeof a.verifiedOpaque !== 'number' || a.verifiedOpaque <= a.matched) &&
       (typeof a.painted !== 'number' || typeof a.verifiedOpaque !== 'number' ||
        a.verifiedOpaque <= a.painted));
    check('R6 matched >= painted >= verifiedOpaque', mono, J(a));

    /* ---------- 2  the fact is CARRIED ---------- */
    const b = await buildBundle(result);
    check('B1 the producer built a bundle', b.ok, b.ok ? '' : b.error);
    let payload = '';
    if (b.ok) {
      const ea = (b.envelope.redaction || {}).acts || {};
      check('B2 the envelope carries the same acts the record does',
        J(ea) === J(a), 'envelope ' + J(ea));
      payload = String(b.text || '');
      const redLines = payload.split('\n').filter(l => /^- (Redaction|FullShot reads|The redactor)/.test(l));
      say('payload:');
      for (const l of redLines) say('   ' + l);
      const wholeClaim = /\(whole count\)/.test(payload);
      if (w.matchedComplete === false) {
        check('B3 the payload states the count as PARTIAL, inside the clause that states it',
          /\(PARTIAL count\)/.test(payload) && !wholeClaim,
          redLines[0] || '(no redaction line)');
      }
      if (w.gapKey) {
        check('B4 the payload has a gaps line naming this gap',
          /^- Redaction gaps:/m.test(payload), redLines.find(l => /gaps/.test(l)) || '(no gaps line)');
      }
      check('B5 the payload carries §2.3\'s constant',
        /It cannot see this image/.test(payload), '');
    }

    /* ---------- 3  the fact REACHES THE SURFACE ---------- */
    const line = await lineText(result);
    say('result line: ' + J(line));
    check('S1 the result page shows an acts line', !!line, J(line));
    const dlg = await openDialog(result);
    say('dialog: ' + J(dlg && dlg.slice(0, 260)));
    check('S2 Copy shows the person the image first', !!dlg, dlg ? '' : 'no dialog');
    if (dlg && line) {
      check('S3 the dialog and the page say the same thing about the acts',
        dlg.indexOf(line) >= 0,
        dlg.indexOf(line) >= 0 ? '' : 'the page line is not inside the dialog text');
    }
    /* THE SURFACE TEST THAT MATTERS: a gap the ledger records must be readable
       by a person, not only by a consumer of the JSON. */
    if (w.gapKey) {
      const GAP_WORDS = {
        textRefused: /did not read/i,
        blocksLost: /did not draw|never drawn/i,
        blocksUnpainted: /could not place|not placed/i,
        blocksUnread: /did not read back|not read back/i
      };
      const re = GAP_WORDS[w.gapKey];
      check('S4 the ' + w.gapKey + ' gap is stated on the result page',
        !!line && re.test(line), J(line));
      check('S5 ...and inside the review dialog',
        !!dlg && re.test(dlg), J(dlg && dlg.slice(0, 300)));
    }
    if (w.walkComplete === false) {
      check('S6 the truncation sentence is on the result page',
        !!line && /did not finish walking/i.test(line), J(line));
    }
    /* THE ONE THE SPEC DOES NOT NAME A KEY FOR. matchedComplete travels in the
       payload as "(PARTIAL count)"; if no human surface says it, the two
       surfaces disagree about the same record, which is §3's whole promise. */
    if (w.matchedComplete === false) {
      const said = !!line && (/partial/i.test(line) || /did not finish walking/i.test(line) ||
        /did not read/i.test(line) || /did not draw/i.test(line));
      if (shape.crossSurface) {
        /* GRADED HERE, because this is the shape that isolates it: the payload
           and the screen are describing THE SAME RECORD and only one of them
           says the count may be short. A disagreement means one of them is
           lying and the user believes whichever they saw. */
        check('S7 the payload and the screen agree about whether the count is whole',
          said, 'payload says ' +
          (/\(PARTIAL count\)/.test(payload) ? '"(PARTIAL count)"' : '"(whole count)"') +
          '; the screen says ' + J(line));
        check('S7b ...and the review dialog agrees too',
          !!dlg && (/partial/i.test(dlg) || /did not finish walking/i.test(dlg) ||
                    /did not read/i.test(dlg) || /did not draw/i.test(dlg)),
          J(dlg && dlg.slice(0, 220)));
      } else if (!said) {
        note('the record says matchedComplete=false and the human surface says nothing about it',
          'line=' + J(line));
      } else {
        check('S7 the human surface says something about the count being short', said, J(line));
      }
    }

    const hist = await historyText(ctx, extBase, rec.id);
    if (line) {
      check('S8 History repeats the same sentence for the same record',
        hist.all.indexOf(line) >= 0,
        'history text: ' + J(hist.all.slice(0, 220)));
    }

    /* ---------- 4  the class hunt ---------- */
    const visible = Object.entries(pix).filter(([, n]) => n > 0).map(([k, n]) => k + '=' + n);
    if (shape.hunt) {
      /* WHAT THE ENGINE COULD SEE ITSELF DECLINING, asked of the page rather
         than of the extension. A same-origin frame whose contentDocument is
         readable is a door the walk positively observes, counts, and does not
         open — content/capture.js books it as `frames.sameOrigin` at the moment
         it tries. Read the same fact here, independently, so the finding does
         not rest on the implementation's own bookkeeping. */
      const doors = await page.evaluate(() => {
        const out = { readable: 0, unreadable: 0, chars: 0, pii: 0, sample: [] };
        const RE = [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
                    /\b\d{3}-\d{2}-\d{4}\b/g,
                    /\d(?:[ -]?\d){12,18}/g,
                    /\+?\d[\d().\-\s]{5,}\d/g];
        for (const f of document.querySelectorAll('iframe,frame')) {
          if (!f.offsetWidth && !f.offsetHeight) continue;
          let d = null; try { d = f.contentDocument; } catch (_) {}
          if (!(d && d.documentElement)) { out.unreadable++; continue; }
          out.readable++;
          const t = (d.body && d.body.innerText) || '';
          out.chars += t.length;
          for (const re of RE) { const m = t.match(re); if (m) { out.pii += m.length; out.sample.push(m[0]); } }
        }
        return out;
      });
      say('THE HUNT: same-origin frames the walk can read but does not enter: ' +
          doors.readable + ' (' + doors.chars + ' chars, ' + doors.pii + ' detector-shaped tokens)');
      say('THE HUNT: PII a person can read in the delivered PNG: ' + (visible.join(', ') || 'none'));

      /* THE PIPELINE'S OWN BOOKKEEPING, quoted. `frames.sameOrigin` is written
         by content/capture.js at the moment `scan()` meets an IFRAME whose
         contentDocument is readable, and it is the number that then reaches
         nothing. */
      if (scan) {
        check('G0 the pipeline itself counted the refusal',
          !!(scan.frames && scan.frames.sameOrigin > 0),
          'scan.frames=' + J(scan.frames));
      }
      const declined = doors.readable > 0;
      check('G1 where the pipeline observed itself declining to read something, ' +
        'the match count must not be reported as whole',
        !(declined && a.matchedComplete === true),
        'readable-but-unentered frames=' + doors.readable +
        ' matchedComplete=' + J(a.matchedComplete) + ' matched=' + J(a.matched) +
        ' gaps: textRefused=' + J(a.textRefused) + ' blocksLost=' + J(a.blocksLost) +
        ' blocksUnpainted=' + J(a.blocksUnpainted) + ' blocksUnread=' + J(a.blocksUnread) +
        ' | still legible in the delivered PNG: ' + (visible.join(', ') || 'none'));
      if (b.ok) {
        check('G2 ...and the payload must not print "(whole count)" for it',
          !(declined && /\(whole count\)/.test(payload)),
          (payload.split('\n').find(l => /^- Redaction:/.test(l)) || ''));
        /* Graded over the REDACTION lines only. The first draft of this check
           searched the whole payload and passed on a fixture whose TITLE
           contains the word "iframe" — a check that passes by accident is
           worse than no check, so the haystack is now the sentences that make
           the claim. */
        const claimText = (line || '') + ' ' +
          payload.split('\n').filter(l => /^- (Redaction|FullShot reads|The redactor)/.test(l)).join(' ');
        check('G3 ...and some surface must state the refusal',
          !declined || /frame|embedded document|did not read/i.test(claimText),
          'graded text: ' + J(claimText.slice(0, 200)));
      }
    }
    /* THE CONTROL FOR THE HUNT. Text drawn as pixels is invisible to this
       instrument and §9 says so; nothing is computed, so nothing was dropped,
       and `matchedComplete: true` here is the honest answer rather than the
       defect. Graded, so that G1's narrowing is a claim this suite has to keep
       rather than a convenience. */
    if (shape.huntControl) {
      say('THE CONTROL: PII a person can read in the delivered PNG: ' + (visible.join(', ') || 'none'));
      const doors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('iframe,frame')).filter(f => {
          if (!f.offsetWidth && !f.offsetHeight) return false;
          try { return !!(f.contentDocument && f.contentDocument.documentElement); } catch (_) { return false; }
        }).length);
      check('C0 the pipeline observed no refusal on this page, so nothing was dropped',
        doors === 0 && a.textRefused === 0 && a.blocksLost === 0 &&
        !!(scan && scan.frames && scan.frames.sameOrigin === 0),
        'frames=' + doors + ' scan.frames=' + J(scan && scan.frames) +
        ' textRefused=' + J(a.textRefused));
      note('for reference: PII is legible in this PNG and matchedComplete=' + J(a.matchedComplete) +
        ' — defensible, because nothing in the pipeline computed a refusal here (§9)',
        visible.join(', ') || 'none');
    }
    return { name: shape.name, acts: a, line, dlg, payload, pix, blocks };
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

/* ==========================================================================
   THE SMUGGLING PASS — can a verdict get back in under a new name?
   ========================================================================== */
async function runSmuggle(ctx, sw, extBase) {
  begin('smuggling a verdict back in');
  /* Re-asserted here for the same reason runShape does it: this pass runs
     after every shape above, one of which pins a budget. */
  await setSettings(sw, BASE_SETTINGS);
  const { page, result } = await capture(ctx, sw, FIX + 'control-pii.html');
  try {
    const attempts = [
      { label: 'a boolean nobody declared, at the top of the envelope',
        input: { producer: { tool: 'FullShot', version: '0', surface: 'x' } }, patch: 'topBool' },
      { label: 'a boolean inside the redaction block under a friendly name',
        patch: 'redBool' },
      { label: 'a word inside the acts block (Rule 2)', patch: 'actsWord' },
      { label: 'an old verdict name at depth', patch: 'deepPixels' },
      { label: 'a verdict wearing a person as a costume (reviewedByHuman)', patch: 'reviewed' },
      { label: 'a NUMBER that summarises the counters, inside acts', patch: 'actsScore' },
      { label: 'a summary string in kinds, which is not an allowlisted scope', patch: 'kindsWord' },
      { label: 'a summary string at the top level of the envelope', patch: 'topWord' }
    ];
    const out = await result.evaluate(async (list) => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const r = shot.redaction || {};
      const base = () => ({
        id: shot.id,
        producer: { tool: 'FullShot', version: '0', surface: 'chrome-extension' },
        subject: { kind: 'web-page', mode: 'full', url: shot.url || '', title: shot.title || '',
                   capturedAt: new Date().toISOString(),
                   image: { w: shot.w, h: shot.segments.reduce((a, s) => a + s.h, 0) } },
        redactRequested: r.requested === undefined ? null : r.requested,
        redactActs: JSON.parse(JSON.stringify(r.acts || {})),
        pixelKinds: JSON.parse(JSON.stringify(r.kinds || {})), notes: [], reviewed: true
      });
      const res = [];
      for (const at of list) {
        const i = base();
        if (at.patch === 'topBool') i.producer.approved = true;
        if (at.patch === 'redBool') i.redactActs.coverageOk = true;
        if (at.patch === 'actsWord') i.redactActs.outcome = 'covered';
        if (at.patch === 'deepPixels') i.redactActs.pixels = 'baked';
        if (at.patch === 'reviewed') i.redactActs.reviewedByHuman = true;
        if (at.patch === 'actsScore') i.redactActs.coverageScore = 100;
        if (at.patch === 'kindsWord') i.pixelKinds = Object.assign({}, i.pixelKinds, { assessment: 'clean' });
        if (at.patch === 'topWord') i.notes = ['This image is safe to share.'];
        let threw = null, env = null, text = null;
        try { const b = fsAiBundle(i); env = JSON.parse(JSON.stringify(b.envelope)); text = b.text; }
        catch (e) { threw = String((e && e.message) || e); }
        res.push({ label: at.label, patch: at.patch, threw, env, text });
      }
      return res;
    }, attempts);

    for (const a of out) {
      /* Everything aimed AT the acts block or at a boolean anywhere must not
         reach a consumer — either the gate refuses the bundle, or the builder's
         named picks never let the field in. Both are acceptable answers and the
         check says which one happened, because "it threw" and "it was never
         copied" are different guarantees and only one of them survives a
         builder that starts spreading its input. The last two are aimed at
         scopes §5 does not close; they are reported, and the report is the
         argument. */
      const mustThrow = ['topBool', 'redBool', 'actsWord', 'deepPixels', 'reviewed', 'actsScore'];
      if (mustThrow.includes(a.patch)) {
        const leaked = a.env ? JSON.stringify(a.env).indexOf('approved') >= 0 : false;
        const ok = a.threw === 'FS_ENVELOPE_VERDICT' || (!a.threw && !leaked);
        check('V ' + a.label + ' cannot reach a consumer', ok,
          a.threw ? 'refused: ' + J(a.threw)
                  : 'not refused, but the builder never copied it into the envelope');
      } else if (a.threw) {
        check('V ' + a.label + ' is refused', true, 'threw=' + J(a.threw));
      } else {
        note('a verdict-shaped string survived: ' + a.label,
          (a.patch === 'kindsWord'
            ? 'redaction.kinds.assessment=' + J(a.env.redaction.kinds.assessment)
            : 'notes[0]=' + J(a.env.notes && a.env.notes[0])) +
          ' — FS_ENVELOPE_VERDICT closes acts by allowlist and booleans by shape, ' +
          'but a STRING outside the redaction block is not graded by it');
      }
    }
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

/* ==========================================================================
   runner
   ========================================================================== */
(async () => {
  const TEST_EXT = prepareTestExtension();
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-giveup-'));
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
    await setSettings(sw, BASE_SETTINGS);
    await installLedgerTap(sw);
    const extBase = sw.url().replace(/background\.js.*$/, '');
    for (const s of SHAPES) {
      if (ONLY.length && !ONLY.includes(s.name)) continue;
      try { await runShape(ctx, sw, extBase, s); }
      catch (e) { check(s.name + ' :: ran to completion', false, String((e && e.stack) || e)); }
    }
    if (!ONLY.length || ONLY.includes('smuggle')) {
      try { await runSmuggle(ctx, sw, extBase); }
      catch (e) { check('smuggle :: ran to completion', false, String((e && e.stack) || e)); }
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
