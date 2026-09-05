#!/usr/bin/env node
/* ============================================================================
   FullShot — THE REDUCTION, GRADED IN A REAL BROWSER, FROM THE SPEC.

   WHAT THIS FILE IS. An independent fixture suite for the design in
   REDACTION-CLAIM-SPEC.md, written from that document and not from the code
   that implements it. Every assertion below cites the section it comes from.
   Where the implementation had to be read at all it was read for DRIVING ONLY
   — which button to click, what argument shape `fsAiBundle` takes — never to
   decide what "correct" is. That separation is the reason the last round found
   four escapes the implementer had not imagined.

   WHY A NEW FILE. `redaction-claim.mjs` and `adversarial-claim.mjs` grade the
   eight-state ladder, which §2.2 deletes. `claim-reduction.mjs` grades the
   replacement over eight shapes and keys most of its reads off the ids the
   implementation happens to use (`#reviewDlg`, `#reviewActs`, a hard-coded
   outline colour). This file runs the FULL corpus — every shape that defeated
   one of the six previous fixes — and reads the product through contracts the
   SPEC fixes: the ARIA dialog role (§8.2 asks for focus trapping and Esc, both
   of which presuppose one), the i18n KEYS named in §6, and the record and
   envelope field names in §2.1. A rename inside the implementation should not
   be able to turn a red check green, and an id this suite never mentions
   cannot become a contract by accident.

   THE POINT OF THE CORPUS, RESTATED. Under the old design each of these shapes
   was an escape, because each one could make a DOM-side reading produce a
   sentence about the PICTURE that was false. Under this design every one of
   them should be UNINTERESTING: there is no verdict field left to be wrong,
   the record states three integers, and the person is shown the image. So the
   assertions here are almost all invariants rather than per-shape expectations
   — and a shape that produces something a reader would take as a verdict is
   the design leaking, which is exactly what this file exists to catch.

   THREE VERDICTS, on purpose (inherited from claim-lib.mjs):
     PASS / FAIL — the spec says what must happen. Graded.
     OPEN        — the spec is silent or self-contradictory for this shape.
                   Printed with its evidence, never graded. A check that
                   quietly downgrades itself to "skipped" is the same disease
                   as a claim that quietly downgrades itself to "baked".

   Run:  cd test/e2e && node reduction-corpus.mjs
         HEADFUL=1 node reduction-corpus.mjs
         ONLY=control-pii,shadow-closed node reduction-corpus.mjs
         SKIPOLD=1 node reduction-corpus.mjs     (skip the §4 old-record block)
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXT_DIR, OUT_DIR, serve, prepareTestExtension, setSettings,
         begin, check, open, note, results } from './claim-lib.mjs';

const PORT = 8917;                /* run.mjs 8907 · redaction-claim 8911 ·
                                     adversarial + claim-reduction 8913 */
const FIX = 'http://localhost:' + PORT + '/test/e2e/fixtures/';
const ADV = 'http://localhost:' + PORT + '/test/e2e/fixtures-adv/';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const SKIPOLD = !!process.env.SKIPOLD;
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ==========================================================================
   THE SPEC, TRANSCRIBED. Everything graded below reads one of these.
   ========================================================================== */

/* §2.1 — the acts block, in full. Nothing else in it.
   v4 adds five, and every one of them is a place the pipeline GIVES UP: the
   completeness of `matched` itself, the leaves whose text was refused, and the
   blocks lost to the box cap, lost for want of a frame to draw them in, and
   drawn but never read back. They are here because "incompleteness computed and
   then thrown away" is the shape all nine rounds of this feature's defects
   share; they obey Rule 2 (integers and booleans, no words) and they carry
   their unit in their name so §2.1's subtraction rule survives them. */
const ACTS_KEYS = ['v', 'matched', 'painted', 'verifiedOpaque', 'matchedComplete',
                   'walkComplete', 'truncatedBy', 'textRefused', 'blocksLost',
                   'blocksUnpainted', 'blocksUnread', 'ledger'];
const TRUNCATED_BY = [null, 'elements', 'time', 'ceiling'];
const LEDGER_VALUES = ['present', 'partial', 'absent'];

/* §2.1 — the envelope's `redaction` object, in full. An ALLOWLIST, not a
   denylist: §8.3's tooth 5 says a scan by a list of four names is a denylist
   and "the next verdict will simply be named something else". A key nobody
   thought of is caught here because it is not on the list. */
const ENVELOPE_REDACTION_KEYS = ['requested', 'detector', 'acts', 'kinds',
                                 'text', 'markers', 'surfaces', 'notCovered'];
/* The record additionally carries §3.3's marks and a version. */
const RECORD_REDACTION_KEYS = ENVELOPE_REDACTION_KEYS.concat(['v', 'marks']);

/* §5 — the four names FS_ENVELOPE_VERDICT refuses at any depth. */
const VERDICT_NAMES = ['pixels', 'state', 'severity', 'evidence'];

/* §2.2 — the rest of the removal table. Scoped to the redaction block and the
   record, because `state` is a word other parts of an envelope may legitimately
   want and a check that fails for the wrong reason is a check somebody deletes. */
const REMOVED_NAMES = VERDICT_NAMES.concat([
  'chars', 'spans', 'placed', 'unplacedSpans', 'unplacedChars',
  'inkPx', 'capturedPx', 'declined', 'moved', 'frames', 'scan', 'bake'
]);

/* §3.5 — "Nothing about the review reaches the bundle." Not a timestamp, not a
   boolean. This is the tooth-5 shape check: a key nobody listed, caught by what
   it looks like rather than by its name being on a list of four. */
const REVIEW_LEAK = /^(reviewed|reviewedby|humanreview|lookedat|confirmedby|acknowledg)/i;
const VERDICT_SHAPED = /(verdict|assur|guarantee|approv|sanitis|sanitiz|safety|issafe|isclean|confidence|grade|score|risk|threat|leak|exposed|protection)/i;

/* §6 — forbidden in any redaction string, English or translated. `done` is on
   the list and is a common UI word, so it is graded only inside the redaction
   copy and the dialog, never over the whole page. */
const FORBIDDEN = /\b(safe|clean|secure|protected|done|nothing to hide)\b/i;
const THIS_PAGE = /(^|[.!?]\s+)this page\b/i;      /* §6: no sentence beginning "this page…" */

/* §6 — the keys the design is allowed to speak through. Asserting on KEYS
   rather than on English is what keeps this suite independent of the owner's
   editing of the English, which §6 explicitly permits. */
const ACTS_LINE_KEYS = ['redactActsLine', 'redactActsNone', 'redactActsShortfall',
                        'redactActsWalkTruncated', 'redactActsNoLedger'];
/* `reviewPrevBlock` / `reviewNextBlock` were here until §3.2 was amended. The
   controls they named stepped between MARKS — the regions FullShot had already
   covered — and could not magnify past 1:1 with an export that is itself a
   downscale, so on any tall capture the review could not show the thing being
   reviewed. §6 retires all three (the third is `reviewActualSize`) and names
   the walk's keys instead. */
const REVIEW_KEYS = ['reviewTitle', 'reviewLimit', 'reviewMarks', 'reviewNoMarks',
                     'reviewScale', 'reviewReduced', 'reviewConfirm', 'reviewCancel',
                     'reviewPrevView', 'reviewNextView', 'reviewZoomIn', 'reviewZoomOut',
                     'reviewViewPos', 'reviewMarkLabel', 'reviewMarkAt',
                     'reviewImgAlt', 'reviewImgRegion'];
/* Demanded by §3.4's third variant ("the only bolded line") and by §3.3's
   numbered badges. Probed, and their absence reported as a spec gap rather than
   graded. §6 now names the four review keys that used to sit here — the badge
   label, its spoken position, and the two names of the image — so what is left
   is the plural pair and the em-dash placeholder. */
const REVIEW_KEYS_EXTRA = ['redactActsUncoveredOne', 'redactActsUncoveredOther',
                           'redactActsUnknownCount'];
/* §6 retires these. A retired key still answering is a control one line of code
   away from coming back. */
const REVIEW_KEYS_RETIRED = ['reviewPrevBlock', 'reviewNextBlock', 'reviewActualSize'];

/* §2.3 — the text payload's constant second line, verbatim ASCII. Not
   localised, per AI-HANDOFF-ENVELOPE.md §4, so it CAN be matched literally. */
const PAYLOAD_CONSTANT_A = 'FullShot reads the text a page exposes. It cannot see this image.';
const PAYLOAD_CONSTANT_B = 'counts what FullShot did, not what is in the picture';

/* ==========================================================================
   THE CORPUS — every shape that defeated one of the six previous fixes, plus
   the two controls. `visible` describes what A HUMAN SEES IN THE PICTURE, which
   is the only ground truth this suite trusts: it is written from the fixture's
   rendered output, never from what the DOM walk would find.
   `gone` / `kept` are marker colours, read out of the DELIVERED image. They are
   the independent second opinion on `acts.painted` — see G-checks below.
   ========================================================================== */
const CORPUS = [
  { name: 'control-pii', url: FIX + 'control-pii.html', det: true,
    why: 'CONTROL — ordinary page, real PII, plainly visible and plainly in the DOM',
    spec: '§3.4 "Honest common case, walked"',
    visible: 3, minMatched: 3,
    gone: { email: [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255] },
    kept: { decoy: [245, 205, 45] } },

  { name: 'control-clean', url: FIX + 'control-clean.html', det: true,
    why: 'CONTROL — ordinary article, real prose, no PII at all',
    spec: '§3.4 variant 2', visible: 0, expectMatched: 0, gone: {}, kept: {} },

  { name: 'canvas-pii', url: FIX + 'canvas-pii.html', det: true,
    why: 'text drawn as pixels — three PII items a human reads, zero the DOM holds',
    spec: '§1 "Text drawn as pixels … is never read"', visible: 3,
    gone: {}, kept: { canvasEmailBand: [255, 90, 90], canvasCardBand: [90, 130, 255] } },

  { name: 'inline-code', url: FIX + 'inline-code.html', det: true,
    why: 'inline <style>/<script> source is the page\'s only text; nothing visible',
    spec: '§1 (inline script read as page text)', visible: 0,
    gone: {}, kept: { bandA: [150, 200, 190], bandB: [120, 175, 165] } },

  { name: 'sr-only', url: FIX + 'sr-only.html', det: true,
    why: 'sr-only, aria-label and title are the only strings; the picture has none',
    spec: '§1 (off-screen accessibility text)', visible: 0,
    gone: {}, kept: { band1: [120, 140, 220], band3: [90, 110, 200] } },

  { name: 'plaintext-short', url: FIX + 'plaintext-short.txt',
    why: 'text/plain — Chromium builds the synthetic <pre>; one visible email',
    spec: '§1 (text/plain)', visible: 1, gone: {}, kept: {} },

  { name: 'plaintext-long', url: FIX + 'plaintext-long.txt',
    why: 'text/plain past the leaf cap',
    spec: '§1 (text/plain)', visible: null, gone: {}, kept: {} },

  { name: 'ceiling', url: FIX + 'ceiling.html',
    why: '2500 visible emails against a 2000-box ceiling',
    spec: '§2.1 truncatedBy, §3.4 walkComplete', visible: 2500,
    expectTruncated: true, gone: {}, kept: {} },

  { name: 'shadow-open', url: FIX + 'shadow-open.html', det: true,
    why: 'PII inside an OPEN shadow root, ordinary nav outside',
    spec: '§1 (open shadow roots)', visible: 2,
    gone: { email: [255, 90, 90], phone: [90, 200, 120] }, kept: {} },

  { name: 'shadow-closed', url: FIX + 'shadow-closed.html', det: true,
    why: 'PII inside a CLOSED shadow root — a door that cannot be opened',
    spec: '§1 (closed shadow roots)', visible: 2,
    gone: {}, kept: { email: [255, 90, 90], card: [90, 130, 255] } },

  { name: 'contentvis', url: FIX + 'contentvis.html',
    why: 'content-visibility:auto subtree that renders AFTER the scan',
    spec: '§1 (content-visibility)', visible: 1, gone: {}, kept: {} },

  { name: 'details-closed', url: ADV + 'details-closed.html', det: true,
    why: 'a collapsed <details> — content-visibility:hidden from the UA sheet',
    spec: '§1 (content-visibility) + §3.4 alarm budget', visible: 0,
    gone: {}, kept: {} },

  { name: 'object-door', url: ADV + 'object-door.html',
    why: '<object type="text/html"> and <embed> as uncounted doors',
    spec: '§1 (<object>/<embed>)', visible: 6, gone: {}, kept: {} },

  { name: 'iframe-host', url: FIX + 'iframe-host.html',
    why: 'a same-origin iframe the walk never enters, grown to full height',
    spec: '§1 (same-origin iframes)', visible: 3, gone: {}, kept: {} },

  { name: 'split-token', url: ADV + 'split-token.html', det: true,
    why: 'a card, an email and an SSN split across inline elements and tspans',
    spec: '§1 "A number split across <span>s … is never seen whole"', visible: 3,
    gone: {}, kept: { card: [90, 130, 255], email: [255, 90, 90], ssn: [160, 110, 255] } },

  /* THE ONLY SHAPE IN THE CORPUS WHERE BLOCKS AND MATCHES ARE DIFFERENT
     NUMBERS. Everywhere else each token sits on one line, so a check that
     compared a block count with a match count was green by coincidence — which
     is how one sat in this file (A9b) reading like a law. `visible` is 2 because
     `visible` counts what a HUMAN reads, and a card number broken over a line is
     still one card number. */
  { name: 'wrapped-token', url: ADV + 'wrapped-token.html', det: true,
    why: 'a card number broken across a line: ONE match, TWO blocks',
    spec: '§2.1 "a block is one client rect"', visible: 2, minMatched: 2,
    gone: { card: [90, 130, 255], email: [255, 90, 90] }, kept: {} },

  { name: 'mixed-owntext', url: ADV + 'mixed-owntext.html', det: true,
    why: 'the commonest markup on the web: <p>Email <b>x</b> a@b.com</p>',
    spec: '§1 fsOwnLeafText', visible: null, gone: {}, kept: {} },

  { name: 'late-inject', url: FIX + 'late-inject.html',
    why: 'PII written into the page after the scan and before the frame',
    spec: '§9 (matched counts what the detector was handed)', visible: 2,
    gone: {}, kept: {} }
];

/* ==========================================================================
   helpers
   ========================================================================== */
const isInt = v => typeof v === 'number' && Number.isInteger(v);

/* A question about the SPEC is a run-level fact, not a per-fixture one. Raised
   once with the first fixture that shows it, so seventeen copies of the same
   sentence do not bury the sixteen that are only said once. */
const asked = new Set();
function askOnce(key, label, extra) {
  if (asked.has(key)) return;
  asked.add(key);
  open(label, extra);
}

/* Every {path, key, value} in an object, at any depth. §5's gate is specified
   "at any depth", so the check that grades it has to look there too. */
function deepEntries(o, base = '', out = [], d = 0) {
  if (!o || typeof o !== 'object' || d > 14) return out;
  if (Array.isArray(o)) { o.forEach((v, i) => deepEntries(v, base + '[' + i + ']', out, d + 1)); return out; }
  for (const k of Object.keys(o)) {
    out.push({ path: base ? base + '.' + k : k, key: k, value: o[k] });
    deepEntries(o[k], base ? base + '.' + k : k, out, d + 1);
  }
  return out;
}

/* Rule 2 (§0.1) with §2.1's two enums. Returns the offending entries. */
function actsViolations(acts) {
  const bad = [];
  if (!acts || typeof acts !== 'object') return [{ k: 'acts', v: '<the record has no acts block>' }];
  for (const k of Object.keys(acts)) {
    const v = acts[k];
    if (k === 'truncatedBy') { if (TRUNCATED_BY.indexOf(v) < 0) bad.push({ k, v }); continue; }
    if (k === 'ledger') { if (LEDGER_VALUES.indexOf(v) < 0) bad.push({ k, v }); continue; }
    if (v === null || typeof v === 'boolean' || isInt(v)) continue;
    bad.push({ k, v });
  }
  return bad;
}

/* A message template with its placeholders knocked out, turned into a matcher.
   The suite must not hard-code English — §6 says the English is owner-editable
   — so it asks the extension for its own string and then checks that the
   product rendered THAT one, with the numbers the record holds. */
const SENTINELS = ['', '', '', ''];
const SENTINEL_RE = /[-]/;
function templateToRe(tpl) {
  const raw = String(tpl || '');
  if (!raw.trim()) return null;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  /* The empty pieces MATTER. "$COUNT$ match is not covered" splits to
     ['', ' match is not covered'], and dropping the empty head drops the only
     capture group there is — which is how a check that reads the number out of
     a sentence comes back with NaN and calls it a failure. */
  const parts = raw.split(SENTINEL_RE);
  if (parts.length === 1) return new RegExp(esc(raw.trim()));
  return new RegExp(parts.map(p => esc(p.trim())).join('\\s*(\\S{1,24})\\s*'));
}
/* The first capture that reads as a number, with locale grouping removed —
   §6 sends human-facing counts through fsNumber, so 2000 arrives as "2,000". */
function firstNum(m) {
  if (!m) return null;
  for (let i = 1; i < m.length; i++) {
    const v = String(m[i] == null ? '' : m[i]).replace(/[\s,.  ']/g, '');
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  }
  return null;
}
const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/* ==========================================================================
   driving — selectors are discovered, never assumed
   ========================================================================== */

/* The two buttons this suite presses. Found through `data-i18n`, which §6
   makes a contract ("every user-visible string goes through chrome.i18n with a
   key"), with the element id printed so a rename reads as a rename. */
const BUTTONS = { copy: 'resultCopy', save: 'resultDownload' };
async function findButton(page, key) {
  return page.evaluate((k) => {
    const els = Array.from(document.querySelectorAll('[data-i18n="' + k + '"]'));
    for (const el of els) {
      const btn = el.closest('button');
      if (btn) return { sel: btn.id ? '#' + btn.id : null, id: btn.id || '', text: (btn.innerText || '').trim() };
    }
    return null;
  }, key);
}

/* A click that survives a dialog taller than the screen. The ceiling fixture
   produces two thousand marks and therefore two thousand jump controls, which
   pushes Cancel and Confirm outside the viewport; Playwright then waits thirty
   seconds and gives up. The fallback dispatches the same event the button
   listens for. It is recorded when it is used, because "the control could not
   be reached by pointer" is a finding about the dialog, not a detail of the
   harness. */
async function clickIt(page, sel, label) {
  try { await page.click(sel, { timeout: 6000 }); return 'pointer'; }
  catch (_) {
    await page.locator(sel).dispatchEvent('click');
    askOnce('pointer-' + label, 'the ' + label + ' control could not be reached by pointer (§3.2/§3.3)',
      'it is outside the viewport; the suite dispatched the click instead');
    return 'dispatched';
  }
}

/* §8.2 asks for a focus-trapped dialog that Esc cancels; both presuppose an
   ARIA dialog. That is the contract this suite reads — not an id. */
const DIALOG_PROBE = `(() => {
  const vis = el => {
    if (!el) return false;
    if (el.hasAttribute('hidden')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const cands = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]'));
  const el = cands.find(vis) || null;
  return { el, vis, cands };
})()`;

async function dialogOpen(page) {
  return page.evaluate('(' + `() => { const p = ${DIALOG_PROBE}; return !!p.el; }` + ')()');
}

async function waitDialog(page, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await dialogOpen(page)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/* Everything the dialog is showing, read structurally. */
async function readDialog(page) {
  return page.evaluate(`(() => {
    const p = ${DIALOG_PROBE};
    const d = p.el;
    if (!d) return null;
    const txt = el => (el.innerText || el.textContent || '').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
    const imgs = Array.from(d.querySelectorAll('img, canvas')).map(el => ({
      tag: el.tagName.toLowerCase(),
      w: el.naturalWidth || el.width || 0,
      h: el.naturalHeight || el.height || 0,
      src: (el.getAttribute('src') || '').slice(0, 12),
      alt: el.getAttribute('alt')
    }));
    /* §3.4 "the only bolded line in the design". Read as WEIGHT, not as tag: a
       <strong> and a class with font-weight:700 are the same thing to the
       reader, and grading the tag would let the emphasis move into CSS and out
       of the check. Headings and buttons are bold furniture and are excluded. */
    const bold = Array.from(d.querySelectorAll('*')).filter(el => {
      if (/^(H[1-6]|BUTTON|SUMMARY)$/.test(el.tagName)) return false;
      if (el.closest('button')) return false;
      const t = txt(el);
      if (!t || t.length < 8) return false;
      if (Array.from(el.children).some(c => txt(c) === t)) return false;   /* deepest holder only */
      const w = getComputedStyle(el).fontWeight;
      return (w === 'bold' || w === 'bolder' || parseInt(w, 10) >= 600);
    }).map(txt);
    const keys = Array.from(d.querySelectorAll('[data-i18n]')).map(el => el.getAttribute('data-i18n'));
    const buttons = Array.from(d.querySelectorAll('button')).map(b => ({
      id: b.id || '', key: b.getAttribute('data-i18n') || '', text: txt(b),
      disabled: b.disabled
    }));
    const ae = document.activeElement;
    return {
      role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
      id: d.id || '', text: txt(d), bold, keys, buttons, imgs,
      focusId: ae ? (ae.id || ae.tagName.toLowerCase()) : null,
      focusInside: !!(ae && d.contains(ae)),
      focusKey: ae ? (ae.getAttribute && ae.getAttribute('data-i18n')) || '' : ''
    };
  })()`);
}

/* The record, as the store hands it out. §4's strip lives at that boundary, so
   reading it through FSDB is reading the thing the spec constrains. */
const readRecord = (page) => page.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  return JSON.parse(JSON.stringify({
    id, topKeys: Object.keys(shot),
    redaction: shot.redaction ?? null,
    w: shot.w, segs: shot.segments ? shot.segments.length : 0
  }));
});

/* The bundle, built through the shipped producer. Read rather than copied: the
   clipboard belongs to the browser and a headless run cannot hold it. */
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
  Object.assign(input, o && o.input || {});
  if (o && o.deleteReviewed) delete input.reviewed;
  try {
    const b = fsAiBundle(input);
    return { ok: true, envelope: JSON.parse(JSON.stringify(b.envelope)), text: b.text };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}, over || {});

/* Rows of the delivered image that contain a colour, counted across every
   segment in the page so a 30 000 px capture never crosses CDP as base64. */
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

/* A hash of the image as stored — the artifact the Save path writes. Showing a
   preview must not change it, and byte-identity says so without a palette. */
const imageDigest = (page) => page.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const parts = [];
  for (const s of shot.segments) parts.push(new Uint8Array(await s.blob.arrayBuffer()));
  let n = 0; for (const p of parts) n += p.length;
  const all = new Uint8Array(n);
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const h = await crypto.subtle.digest('SHA-256', all);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
});

/* The first segment, written to out/, so a human can look at what the checks
   above only measured. A diagnostic, never an assertion. */
async function saveFirstSegment(page, name) {
  try {
    const b64 = await page.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.writeFileSync(path.join(OUT_DIR, 'corpus-' + name + '.png'), Buffer.from(b64, 'base64'));
  } catch (_) { /* the image is a diagnostic, not an assertion */ }
}

/* Clipboard spy. Installed before any click, so "Cancel left the clipboard
   untouched" (§8.1 check 6) is a measurement rather than a hope. */
const spyClipboard = (page) => page.evaluate(() => {
  if (window.__fsClipSpy) return true;
  window.__fsClipSpy = [];
  const rec = kind => function () {
    window.__fsClipSpy.push({ kind, at: Date.now() });
    return Promise.resolve();
  };
  try { Object.defineProperty(Clipboard.prototype, 'write', { configurable: true, writable: true, value: rec('write') }); } catch (_) {}
  try { Object.defineProperty(Clipboard.prototype, 'writeText', { configurable: true, writable: true, value: rec('writeText') }); } catch (_) {}
  try { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, writable: true, value: rec('write') }); } catch (_) {}
  try { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: rec('writeText') }); } catch (_) {}
  const ec = document.execCommand.bind(document);
  document.execCommand = function (c) {
    if (String(c).toLowerCase() === 'copy') { window.__fsClipSpy.push({ kind: 'execCommand', at: Date.now() }); return true; }
    return ec.apply(document, arguments);
  };
  return true;
});
const clipCalls = (page) => page.evaluate(() => (window.__fsClipSpy || []).length);

/* ==========================================================================
   one capture
   ========================================================================== */
async function capture(ctx, sw, url, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(opts.settleMs || 1000);
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
    await new Promise(r => setTimeout(r, 250));
    const res = await startCapture(tab, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, url);
  const result = await wait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  await result.waitForTimeout(opts.lineSettleMs || 1500);
  return { page, result };
}

/* ==========================================================================
   THE INVARIANTS — asked of every shape in the corpus.
   ========================================================================== */
async function gradeRecord(shape, rec) {
  const r = rec.redaction;
  const a = (r && r.acts) || null;

  /* A1 §2.1 — the block exists and holds the acts. */
  check('A1 the record carries redaction.acts',
    !!r && !!a && typeof a === 'object', r ? Object.keys(r).join(',') : 'no redaction block');

  /* A2 §2.2 + §5 — none of the removed fields survives beside the new one, at
     any depth. `evidence` is named explicitly because §2.2 says it "does not
     survive as a synonym". */
  const entries = deepEntries(r);
  const removed = entries.filter(e => REMOVED_NAMES.indexOf(e.key) >= 0);
  check('A2 no removed field at any depth of the record (§2.2)',
    removed.length === 0, removed.map(e => e.path).join(',') || entries.length + ' keys graded');

  /* A3 §2.1 — ALLOWLIST. Tooth 5: a scan by four names is a denylist. */
  const unknown = r ? Object.keys(r).filter(k => RECORD_REDACTION_KEYS.indexOf(k) < 0) : [];
  const leaky = unknown.filter(k => REVIEW_LEAK.test(k) || VERDICT_SHAPED.test(k));
  check('A3 no verdict- or review-shaped key on the record (§3.5, tooth 5)',
    leaky.length === 0, leaky.join(',') || 'none');
  if (unknown.length && !leaky.length) {
    open('A3b the record carries a key §2.1 does not name', unknown.join(','));
  }

  /* A4/A5 §0.1 Rule 2 — a word is where a verdict hides. */
  if (a) {
    const missing = ACTS_KEYS.filter(k => !(k in a));
    const extra = Object.keys(a).filter(k => ACTS_KEYS.indexOf(k) < 0);
    check('A4 acts holds exactly the twelve fields §2.1 names',
      missing.length === 0 && extra.length === 0,
      (missing.length ? 'missing ' + missing.join(',') : '') +
      (extra.length ? ' extra ' + extra.join(',') : '') || JSON.stringify(a));
    const bad = actsViolations(a);
    check('A5 every acts value is an integer, boolean, null or a closed enum (Rule 2)',
      bad.length === 0, bad.map(b => b.k + '=' + JSON.stringify(b.v)).join(' ') || JSON.stringify(a));
  }

  /* A6 §2.1 — "3/2/2 says one match is not covered — arithmetic, not judgement."
     The arithmetic only reads as arithmetic if it is actually monotone. */
  if (a && isInt(a.matched) && isInt(a.painted)) {
    check('A6 painted <= matched', a.painted <= a.matched, a.matched + '/' + a.painted);
    if (a.painted > a.matched) {
      /* Said out loud because the grading rests on an inference. §2.1 never
         writes "matched >= painted >= verifiedOpaque" as an invariant; it reads
         the numbers that way ("3/2/2 says one match is not covered — arithmetic")
         and §3.4 selects its variants with `painted < matched` and
         `verifiedOpaque < painted`, both of which presuppose the chain. If the
         chain is not meant to hold, §2.1 and §3.4 both need a sentence. */
      askOnce('A6-inference', 'A6 grades a chain §2.1 implies but never states',
        'matched >= painted >= verifiedOpaque is presupposed by §2.1\'s reading of ' +
        '3/2/2 and by §3.4\'s two variant conditions. Either the chain is an ' +
        'invariant and the spec should say so, or the sentences that subtract one ' +
        'from another need a rule for the case where it does not hold.');
    }
  }
  if (a && isInt(a.painted) && isInt(a.verifiedOpaque)) {
    check('A6b verifiedOpaque <= painted', a.verifiedOpaque <= a.painted,
      a.painted + '/' + a.verifiedOpaque);
  }

  /* A7 §2.1 — `"absent"` requires every counter above to be `null`. */
  if (a && a.ledger === 'absent') {
    const nonNull = ['matched', 'painted', 'verifiedOpaque', 'walkComplete', 'truncatedBy']
      .filter(k => a[k] !== null);
    check('A7 ledger "absent" leaves every counter null (§2.1)',
      nonNull.length === 0, nonNull.map(k => k + '=' + JSON.stringify(a[k])).join(',') || 'all null');
  }
  if (a && a.ledger === 'partial') note('ledger "partial": ' + JSON.stringify(a));

  /* A8 §2.1 — kinds is "counts only — never a value, never a position". */
  const kinds = r && r.kinds;
  if (kinds && typeof kinds === 'object') {
    const badKind = Object.keys(kinds).filter(k => !isInt(kinds[k]) || kinds[k] < 0);
    check('A8 kinds is a histogram of non-negative integers',
      badKind.length === 0, badKind.join(',') || JSON.stringify(kinds));
    const sum = Object.values(kinds).reduce((x, y) => x + (isInt(y) ? y : 0), 0);
    if (a && isInt(a.matched) && sum !== a.matched) {
      /* §2.1's table says kinds is "written by each emitted block" and also
         that it is a "histogram of which patterns MATCHED". Those two are the
         same number only when painted === matched. Recorded, not graded. */
      open('A8b kinds sums to ' + sum + ' but matched is ' + a.matched +
           ' — §2.1 gives kinds two different definitions',
           'painted=' + a.painted + ' verified=' + a.verifiedOpaque);
    }
  }

  /* A9 §3.3 — "Only verified-opaque blocks are marked, and only verified-opaque
     blocks are persisted." An unverified rect describes the PAGE and is a map
     to something that may still be visible. */
  const marks = (r && r.marks) || null;
  if (marks !== null) {
    const shapeOk = Array.isArray(marks) && marks.every(m => m && ['x', 'y', 'w', 'h']
      .every(k => typeof m[k] === 'number' && isFinite(m[k])) &&
      Object.keys(m).every(k => ['x', 'y', 'w', 'h'].indexOf(k) >= 0));
    check('A9 marks are bare {x,y,w,h} and nothing else (§3.3)',
      shapeOk, JSON.stringify(marks).slice(0, 160));
    if (a && isInt(a.verifiedOpaque)) {
      /* A9b WAS ITSELF THE UNITS BUG, ASSERTED. It read
         `marks.length === a.verifiedOpaque`, which is an equality across the one
         boundary §2.1 exists to close: A MARK IS A BLOCK — one per client rect,
         §3.3 draws an outline round each — and `verifiedOpaque` counts MATCHES.
         A card number wrapping across a line is one verified match and two
         marks, so the old assertion reddened on the honest record and was green
         only while the counters were block counts. A check that is only green
         while the defect is present does not merely fail to catch it, it argues
         for it to whoever reads the suite next.

         WHAT IS ACTUALLY TRUE, and it is an inequality, not an equality: a match
         counts as verified only if EVERY block it produced was read back opaque
         (§2.1 — half a card number is a card number), and every one of those
         blocks is marked, so each verified match contributes at least one mark.
         `marks.length >= verifiedOpaque`, and the surplus is wrapping.

         THE OTHER DIRECTION IS NOT GRADEABLE FROM A RECORD and must not be
         guessed at: §2.2 deliberately does not persist the block counters, so
         nothing here knows how many blocks there should have been. The surplus
         is recorded rather than bounded. Note also that the floor does NOT
         imply marks are empty when `verifiedOpaque` is 0 — a match with two
         blocks of which one verified is not a verified match, and its one
         verified block is still a solid region of the delivered image and is
         still marked. */
      check('A9b at least one mark per verified-opaque MATCH — a block is not a match (§2.1, §3.3)',
        marks.length >= a.verifiedOpaque,
        marks.length + ' marks vs verifiedOpaque ' + a.verifiedOpaque);
      if (marks.length > a.verifiedOpaque) {
        note('A9b surplus: ' + (marks.length - a.verifiedOpaque) + ' mark(s) beyond one per ' +
             'verified match — ' + marks.length + ' blocks for ' + a.verifiedOpaque +
             ' matches, which is what wrapping looks like');
      }
    } else if (marks.length) {
      /* The counter is not an integer, so the record cannot say how many
         matches were covered — and geometry with no accounting behind it is a
         set of rectangles nobody can relate to an act. The §4 lift of a v2
         record is the population this is aimed at: it stores no marks at all. */
      check('A9c no mark may be stored by a record that cannot count what it covered (§3.3)',
        false, marks.length + ' marks, verifiedOpaque=' + JSON.stringify(a && a.verifiedOpaque));
    }
  } else if (a && isInt(a.verifiedOpaque) && a.verifiedOpaque > 0) {
    open('A9d verifiedOpaque is ' + a.verifiedOpaque + ' but the record stores no marks',
      '§3.3 says verified blocks are persisted; the dialog has nothing to outline');
  }
  return { r, a, marks: marks || [] };
}

/* B — THE PICTURE. The only instrument in this suite that does not read the
   product's own account of itself. */
async function gradeImage(shape, result, rec, a, marks) {
  if (marks.length) {
    /* B1 §2.1 — verifiedOpaque means "read back out of that image as uniformly
       the block colour". The colour is an implementation choice, so what is
       graded is UNIFORMITY: five points inside the rect, byte-identical. */
    const probe = await result.evaluate(async (ms) => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const segs = [];
      let top = 0;
      for (const s of shot.segments) {
        const bmp = await createImageBitmap(s.blob);
        segs.push({ bmp, top, h: bmp.height }); top += bmp.height;
      }
      const px = (bmp, x, y) => {
        const cv = new OffscreenCanvas(1, 1);
        const c = cv.getContext('2d', { willReadFrequently: true });
        c.drawImage(bmp, x, y, 1, 1, 0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const bad = []; let colour = null;
      for (const m of ms) {
        const pts = [[0.5, 0.5], [0.25, 0.35], [0.75, 0.35], [0.25, 0.65], [0.75, 0.65]];
        let first = null, uniform = true, off = false;
        for (const [fx, fy] of pts) {
          const X = Math.round(m.x + m.w * fx), Y = Math.round(m.y + m.h * fy);
          const seg = segs.find(s => Y >= s.top && Y < s.top + s.h);
          if (!seg || X < 0 || X >= seg.bmp.width) { off = true; break; }
          const c = px(seg.bmp, X, Y - seg.top);
          if (!first) first = c;
          else if (c[0] !== first[0] || c[1] !== first[1] || c[2] !== first[2]) uniform = false;
        }
        if (off) bad.push('off-image ' + JSON.stringify(m));
        else if (!uniform) bad.push('not uniform at ' + JSON.stringify(m) + ' first=' + first.join(','));
        else colour = colour || first;
      }
      /* Dimensions read BEFORE close(): a closed ImageBitmap reports 0x0, and a
         zero-width image makes every mark look out of bounds. */
      const W = segs[0] ? segs[0].bmp.width : 0, H = top;
      for (const s of segs) s.bmp.close();
      return { bad, colour, w: W, h: H };
    }, marks);
    check('B1 every stored mark is a uniform solid region in the DELIVERED image',
      probe.bad.length === 0, probe.bad.join(' | ') ||
      marks.length + ' marks, block colour rgb(' + (probe.colour || []).join(',') + ')');
    const oob = marks.filter(m => m.x < 0 || m.y < 0 || m.w <= 0 || m.h <= 0 ||
      m.x + m.w > probe.w + 1 || m.y + m.h > probe.h + 1);
    check('B1b every mark is inside the image it describes',
      oob.length === 0, oob.length ? JSON.stringify(oob[0]) : probe.w + 'x' + probe.h);
    return probe.colour;
  }
  check('B1 no marks stored, so none can point at the wrong place', true,
    'verifiedOpaque=' + JSON.stringify(a && a.verifiedOpaque));
  return null;
}

/* B2–B4 — the ledger against the picture, both directions. The fixtures carry
   a marker colour on the PII token itself, so "the colour is gone" is a
   statement about the delivered image and not about the code path. */
async function gradeLedgerAgainstPicture(shape, result, a) {
  const want = Object.assign({}, shape.gone, shape.kept);
  if (!Object.keys(want).length) return;
  const rows = await colourRows(result, want);
  const goneNames = Object.keys(shape.gone || {});
  const keptNames = Object.keys(shape.kept || {});
  const painted = isInt(a && a.painted) ? a.painted : null;

  if (goneNames.length) {
    const survivors = goneNames.filter(n => rows[n] > 2);
    if (painted !== null && painted >= goneNames.length) {
      check('B2 the marker colour of every covered token is gone from the image',
        survivors.length === 0,
        goneNames.map(n => n + '=' + rows[n] + ' rows').join(' '));
    } else {
      open('B2 painted=' + painted + ' is below this fixture\'s ' + goneNames.length +
           ' visible tokens — the ledger does not claim to have covered them',
           goneNames.map(n => n + '=' + rows[n] + ' rows').join(' '));
    }
  }
  if (keptNames.length) {
    const missing = keptNames.filter(n => rows[n] === 0);
    check('B3 what FullShot did not cover is still in the picture',
      missing.length === 0, keptNames.map(n => n + '=' + rows[n] + ' rows').join(' '));
  }
  /* B4 — the other direction, which no previous suite asked: if the ledger says
     it painted nothing, nothing may have been painted. A colour that vanished
     while `painted === 0` is a block the ledger does not account for. */
  if (painted === 0 && keptNames.length) {
    const vanished = keptNames.filter(n => rows[n] === 0);
    check('B4 painted === 0, so no marker colour may have vanished',
      vanished.length === 0, vanished.join(',') || 'all present');
  }
}

/* C — THE BUNDLE. §2.1, §2.3, §3.5, §5. */
async function gradeBundle(shape, result, rec, a) {
  const requested = rec.redaction ? rec.redaction.requested : undefined;
  const gates = requested !== false;

  /* C1 §3.5 / §8.1 check 4 — the precondition is AT THE PRODUCER. This call is
     a second call site, which is precisely §8.3's tooth 3. */
  const unreviewed = await buildBundle(result, { deleteReviewed: true });
  if (gates) {
    check('C1 fsAiBundle refuses without reviewed:true (FS_ENVELOPE_UNREVIEWED)',
      !unreviewed.ok && /FS_ENVELOPE_UNREVIEWED/.test(unreviewed.error || ''),
      unreviewed.ok ? 'it built a bundle' : unreviewed.error);
    const truthy = await buildBundle(result, { input: { reviewed: 'yes' } });
    check('C1b a truthy non-true `reviewed` does not satisfy the precondition',
      !truthy.ok && /FS_ENVELOPE_UNREVIEWED/.test(truthy.error || ''),
      truthy.ok ? 'a string got past it' : truthy.error);
  } else {
    check('C1 redaction was never requested, so the producer does not gate (§3.1)',
      unreviewed.ok, unreviewed.error || 'built');
  }

  const b = await buildBundle(result);
  check('C2 the bundle builds when the review flag is set', b.ok, b.error || '');
  if (!b.ok) return null;

  const env = b.envelope;
  const all = deepEntries(env);

  /* C3 §5 — the four names, at any depth, in the thing that leaves. */
  const verdicts = all.filter(e => VERDICT_NAMES.indexOf(e.key) >= 0);
  check('C3 the envelope carries no verdict key at any depth (§5)',
    verdicts.length === 0, verdicts.map(e => e.path).join(',') || all.length + ' keys graded');

  /* C4 §2.1 — ALLOWLIST on the redaction block. */
  const red = env.redaction || null;
  check('C4 the envelope carries a redaction block', !!red, Object.keys(env).join(','));
  if (red) {
    const extra = Object.keys(red).filter(k => ENVELOPE_REDACTION_KEYS.indexOf(k) < 0);
    check('C4b the redaction block holds only the fields §2.1 lists',
      extra.length === 0, extra.join(',') || Object.keys(red).join(','));
    const bad = actsViolations(red.acts);
    check('C5 every emitted acts value satisfies Rule 2',
      bad.length === 0, bad.map(x => x.k + '=' + JSON.stringify(x.v)).join(' ') ||
      JSON.stringify(red.acts));
    if (a) {
      const differs = ['matched', 'painted', 'verifiedOpaque', 'walkComplete', 'truncatedBy']
        .filter(k => JSON.stringify(red.acts && red.acts[k]) !== JSON.stringify(a[k]));
      check('C5b the emitted counters are the record\'s counters, unchanged',
        differs.length === 0, differs.join(',') ||
        [a.matched, a.painted, a.verifiedOpaque].join('/'));
    }
  }

  /* C6 §3.5 — "Nothing about the review reaches the bundle." Tooth 5 in the
     form the spec asks for: caught by SHAPE, not by a list of four names. */
  const leak = all.filter(e => REVIEW_LEAK.test(e.key) || VERDICT_SHAPED.test(e.key));
  check('C6 nothing about the review, and nothing verdict-shaped, reaches the bundle',
    leak.length === 0, leak.map(e => e.path).join(',') || 'none');

  const redLines = b.text.split('\n').filter(l => /redact|FullShot reads the text/i.test(l));
  const joined = redLines.join(' ');

  /* C7 §6 "the bundle payload's copies stay bare ASCII", against
     AI-HANDOFF-ENVELOPE.md §4 "the envelope's own FRAME is ASCII … text that
     came from the subject keeps whatever script it was written in". So this is
     asked of the lines FullShot wrote about itself, never of the whole payload
     — a Japanese page title travels verbatim and must not redden this. */
  const nonAscii = (joined.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []);
  check('C7 the redaction lines FullShot wrote are bare ASCII (§6)',
    nonAscii.length === 0,
    nonAscii.slice(0, 8).map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase() +
      ' (' + c + ')').join(' ') || joined.length + ' chars');

  /* C7b §2.3 quotes the line verbatim. Graded as a prefix and its three counts
     in the stated order; anything appended is recorded rather than graded,
     because §2.3 shows a line and does not say it is a closed grammar. */
  const first = (b.text.split('\n').find(l => /^- Redaction:/.test(l)) || '').trim();
  if (requested !== false && a && isInt(a.matched)) {
    /* THE COUNT AND ITS COMPLETENESS ARE ONE PHRASE. `(\d+) matched` alone was
       a number a consumer could lift out and subtract from another without ever
       learning that the walk stopped at 40,000 elements, so the payload now
       states the completeness inside the same clause — attached to the number
       rather than appended to the line, because a qualifier at the end of a
       line is the part a summariser drops. */
    const re = /^- Redaction: requested; (\d+) matched \((whole count|PARTIAL count|completeness unknown)\), (\d+) of them painted over, (\d+) read back opaque; walk (complete|incomplete)/;
    const m = re.exec(first);
    check('C7b the payload line has §2.3\'s shape and order', !!m, JSON.stringify(first));
    if (m) {
      check('C7c ...carrying the record\'s own three counts',
        +m[1] === a.matched && +m[3] === a.painted && +m[4] === a.verifiedOpaque,
        [m[1], m[3], m[4]].join('/') + ' vs ' + [a.matched, a.painted, a.verifiedOpaque].join('/'));
      /* …and the word beside the first of them is the record's own flag. A
         payload that said "whole count" over a record marked partial would be a
         second, disagreeing account of the same pass — the failure C9 exists
         for, one field further in. */
      check('C7c2 ...and the completeness stated beside `matched` is the record\'s own',
        m[2] === (a.matchedComplete === true ? 'whole count'
          : a.matchedComplete === false ? 'PARTIAL count' : 'completeness unknown'),
        m[2] + ' vs matchedComplete=' + JSON.stringify(a.matchedComplete));
      const tail = first.replace(re, '').trim();
      if (tail && tail !== '.') askOnce('C7d', 'C7d the payload line carries a clause §2.3 does not show', tail + '   [first seen on ' + shape.name + ']');
    }
  }

  /* C8 §2.3 — the constant, "the only defence against a consumer turning 3/3/3
     back into clean in its own summary". */
  if (requested !== false) {
    check('C8 the payload carries §2.3\'s constant limit sentence',
      b.text.indexOf(PAYLOAD_CONSTANT_A) >= 0 && b.text.indexOf(PAYLOAD_CONSTANT_B) >= 0,
      JSON.stringify(joined).slice(0, 200));
  }

  /* C9 §2.3 — the counts in the payload are the counts on the record. A payload
     that prints different numbers is a second, disagreeing account. */
  if (a && isInt(a.matched)) {
    const nums = (joined.match(/\d+/g) || []).map(Number);
    const need = [a.matched, a.painted, a.verifiedOpaque].filter(isInt);
    const missing = need.filter(n => nums.indexOf(n) < 0);
    check('C9 the payload states the record\'s three counts',
      missing.length === 0, 'need ' + need.join('/') + ' saw ' + nums.join(','));
  } else if (a && a.ledger === 'absent') {
    check('C9b with no ledger the payload says so rather than printing zeros',
      /no record of a redaction pass/i.test(joined) || !/\b0\b/.test(joined),
      JSON.stringify(joined).slice(0, 200));
  }

  /* C10 §6 — no forbidden word in the redaction copy that leaves the machine. */
  const hits = (joined.match(FORBIDDEN) || []);
  check('C10 no forbidden word in the payload\'s redaction lines',
    hits.length === 0 && !THIS_PAGE.test(joined),
    hits.join(',') || redLines.length + ' line(s) graded');

  /* C11–C13 §5 — FS_ENVELOPE_VERDICT, proved to bite. Three probes, because the
     gate has to be a re-read of the OUTPUT by shape: a name it was told about,
     a name it was not, and a value of the wrong type. */
  const smuggledName = await buildBundle(result, { input: { pixelKinds: { pixels: 1 } } });
  check('C11 FS_ENVELOPE_VERDICT refuses a verdict NAME smuggled in at depth',
    !smuggledName.ok && /FS_ENVELOPE_VERDICT/.test(smuggledName.error || ''),
    smuggledName.ok ? 'the bundle was built with a `pixels` key in it' : smuggledName.error);

  const actsIn = Object.assign({}, (rec.redaction && rec.redaction.acts) || {},
                               { assurance: 'covered' });
  const smuggledShape = await buildBundle(result, { input: { redactActs: actsIn } });
  check('C12 ...and a word in the acts block that is not one of the enums (Rule 2)',
    !smuggledShape.ok && /FS_ENVELOPE_VERDICT/.test(smuggledShape.error || ''),
    smuggledShape.ok ? 'a free string survived inside acts' : smuggledShape.error);

  const actsEnum = Object.assign({}, (rec.redaction && rec.redaction.acts) || {},
                                { truncatedBy: 'partly' });
  const smuggledEnum = await buildBundle(result, { input: { redactActs: actsEnum } });
  check('C13 ...and a truncatedBy outside the four values §2.1 allows',
    !smuggledEnum.ok && /FS_ENVELOPE_VERDICT/.test(smuggledEnum.error || ''),
    smuggledEnum.ok ? 'an unlisted enum value survived' : smuggledEnum.error);

  return b;
}

/* D — WHAT THE PRODUCT SAYS WITHOUT BEING ASKED. §2.2 replaces the history
   badge with the acts line; §3.4 fixes which variant belongs to which counters. */
function expectedActsKey(a, requested) {
  if (requested === false) return null;              /* §2.2: shown where requested !== false */
  if (!a) return 'redactActsNoLedger';
  if (a.ledger === 'absent') return 'redactActsNoLedger';
  if (isInt(a.matched) && a.matched === 0) return 'redactActsNone';
  if (isInt(a.matched) && isInt(a.painted) && isInt(a.verifiedOpaque)) {
    /* SAME UNITS. All three counters count MATCHES (§2.1), so the shortfall is
       matched minus covered and the arm is chosen by the shortfall itself. The
       old pair of comparisons crossed a unit boundary — one match emits one
       block per client rect — so a wrapped card number cancelled an uncovered
       email, and `verifiedOpaque < painted` could open the arm on numbers whose
       subtraction is zero or negative. A non-positive shortfall is not a
       quieter alarm, it is an impossibility, and §0.1 forbids rendering one as
       a reassurance. */
    const covered = isInt(a.verifiedOpaque) ? a.verifiedOpaque : a.painted;
    if (a.matched - covered > 0) return 'redactActsShortfall';
    return 'redactActsLine';
  }
  return '?';                                        /* §3.4 has no row for partial nulls */
}

async function gradeCopy(shape, page, a, requested, where) {
  const tpl = await page.evaluate(({ keys, sent }) => {
    const out = {};
    for (const k of keys) {
      try { out[k] = chrome.i18n.getMessage(k, sent) || ''; } catch (_) { out[k] = ''; }
    }
    return out;
  }, { keys: ACTS_LINE_KEYS.concat(REVIEW_KEYS, REVIEW_KEYS_EXTRA), sent: SENTINELS.slice(0, 3) });

  const text = norm(where === 'dialog'
    ? ((await readDialog(page)) || {}).text
    : await page.evaluate(() => document.body.innerText));
  const matched = {};
  for (const k of ACTS_LINE_KEYS) {
    const re = templateToRe(tpl[k]);
    matched[k] = !!(re && re.test(text));
  }
  const want = expectedActsKey(a, requested);
  const exclusive = ['redactActsLine', 'redactActsNone', 'redactActsShortfall', 'redactActsNoLedger'];
  const shown = exclusive.filter(k => matched[k]);

  if (want === '?') {
    open('D1 §3.4 has no variant for these counters [' + where + ']',
      JSON.stringify(a) + ' — showing: ' + (shown.join(',') || 'none'));
  } else if (want === null) {
    check('D1 no acts line where redaction was never requested (§2.2) [' + where + ']',
      shown.length === 0, shown.join(',') || 'none');
  } else {
    check('D1 exactly the variant §3.4 requires is shown [' + where + ']',
      shown.length === 1 && shown[0] === want,
      'want ' + want + ', shown ' + (shown.join(',') || 'none'));
  }

  /* D2 §3.4 — walkComplete === false appends one sentence. Both directions: an
     unconditional warning is wallpaper, a missing one is a silent gap. */
  if (a && typeof a.walkComplete === 'boolean') {
    const re = templateToRe(tpl.redactActsWalkTruncated);
    const has = !!(re && re.test(text));
    check('D2 the truncation sentence appears exactly when walkComplete is false [' + where + ']',
      has === (a.walkComplete === false),
      'walkComplete=' + a.walkComplete + ' sentence=' + has);
  }

  /* D3 §6 — the forbidden vocabulary, in the copy the reader actually sees.
     Scoped to WHAT THE PRODUCT WROTE: the rendered acts-line variants, and the
     dialog's own prose. Not the whole page — a captured page's title travels
     verbatim into the meta line by design (AI-HANDOFF-ENVELOPE.md §4), and a
     fixture called "CLEAN CONTROL" would otherwise redden this check on the
     strength of the subject's own words, which is the wrong reason. */
  const rendered = [];
  for (const k of ACTS_LINE_KEYS.concat(REVIEW_KEYS_EXTRA)) {
    const re = templateToRe(tpl[k]);
    const m = re && re.exec(text);
    if (m) rendered.push(m[0]);
  }
  const sentences = where === 'dialog'
    ? text.split(/(?<=[.!?])\s+/).filter(Boolean)
    : rendered;
  const bad = sentences.filter(s => FORBIDDEN.test(s) || THIS_PAGE.test(s));
  check('D3 no forbidden word in the redaction copy [' + where + '] (§6)',
    bad.length === 0, bad.join(' | ').slice(0, 220) || sentences.length + ' sentence(s) graded');
  return { tpl, matched, want, text };
}

/* E — THE GATE AND THE DIALOG. §3.1–§3.5, §8.1 checks 6, 7 and 10. */
const REDUCED_SEEN = [];
async function gradeGate(shape, result, rec, a, marks, bundle) {
  const requested = rec.redaction ? rec.redaction.requested : undefined;
  const gates = requested !== false;
  await spyClipboard(result);
  const digestBefore = await imageDigest(result);

  const save = await findButton(result, BUTTONS.save);
  const copy = await findButton(result, BUTTONS.copy);
  check('E0 the Save and Copy controls are reachable through their i18n keys',
    !!(save && save.sel) && !!(copy && copy.sel), JSON.stringify({ save, copy }));
  if (!save || !save.sel || !copy || !copy.sel) return;

  check('E1 nothing is put in front of the person before they act (§3.1)',
    (await dialogOpen(result)) === false, '');

  /* E2 — §8.1 check 7: "Save PNG with redaction on opens NOTHING … must stay
     green forever." A person archiving a PNG is never interrupted, because a
     dialog on every action teaches them to click through everything. */
  await result.click(save.sel);
  await result.waitForTimeout(1200);
  check('E2 Save opens nothing at all (§3.1, check 7)',
    (await dialogOpen(result)) === false, 'redaction requested=' + JSON.stringify(requested));

  const clipBefore = await clipCalls(result);
  await result.click(copy.sel);
  const appeared = await waitDialog(result, gates ? 25000 : 6000);

  if (!gates) {
    /* §3.1 row 3 — "It does not fire when redaction was never requested." */
    check('E3 Copy does NOT ask when redaction was never requested (§3.1)',
      appeared === false, appeared ? 'the dialog opened anyway' : '');
    return;
  }
  check('E3 Copy shows the person the image first (§3.1, check 6)', appeared, '');
  if (!appeared) return;

  const d = await readDialog(result);
  check('E4 it is a modal dialog (§8.2 presupposes focus trapping and Esc)',
    (d.role === 'dialog' || d.role === 'alertdialog') && d.modal === 'true',
    'role=' + d.role + ' aria-modal=' + d.modal);

  /* E5 §6 — the dialog speaks through the keys the spec names. */
  const wantKeys = ['reviewTitle', 'reviewLimit', 'reviewConfirm', 'reviewCancel',
                    'reviewPrevView', 'reviewNextView'];
  const absent = wantKeys.filter(k => d.keys.indexOf(k) < 0);
  check('E5 the dialog carries §6\'s review keys', absent.length === 0,
    absent.join(',') || d.keys.join(','));

  /* E6 §3.2 — THE EXACT BLOB THAT IS ABOUT TO LEAVE. Not the full-size capture:
     "that is the artifact; the full-resolution capture is not what leaves." */
  const fit = bundle && bundle.envelope && bundle.envelope.budget && bundle.envelope.budget.fit;
  const img = (d.imgs || []).slice().sort((x, y) => (y.w * y.h) - (x.w * x.h))[0] || null;
  if (fit && img) {
    check('E6 the preview is the export, at the exported size (§3.2)',
      img.w === fit.w, 'preview ' + img.w + 'x' + img.h + ' vs export ' +
      fit.w + 'x' + fit.h + ' (capture width ' + rec.w + ')');
    if (fit.w < rec.w) {
      check('E6b ...and therefore not the full-size capture', img.w !== rec.w,
        'capture ' + rec.w + ' export ' + fit.w);
    }
    /* §3.2 — "When the export is a reduced overview the dialog says so … The
       person is judging a picture whose small text is illegible and must be
       told that is what they are judging." §2.2 moves that sentence out of the
       toast and into the dialog. Which key carries it is not graded; that it is
       said, is. */
    if (fit.needsTiling) {
      REDUCED_SEEN.push(shape.name);
      const said = await result.evaluate((s) => {
        const get = k => { try { return chrome.i18n.getMessage(k, s) || ''; } catch (_) { return ''; } };
        return { reviewReduced: get('reviewReduced'), legacyToast: get('resultAiOverviewOnly') };
      }, SENTINELS.slice(0, 1));
      const hit = Object.keys(said).filter(k => {
        const re = templateToRe(said[k]);
        return re && re.test(norm(d.text));
      });
      check('E6c a reduced overview is declared in the dialog (§3.2, §2.2)',
        hit.length > 0, hit.join(',') ||
        'neither reviewReduced nor the moved toast appears: ' + norm(d.text).slice(0, 180));
      if (hit.length && hit.indexOf('reviewReduced') < 0) {
        askOnce('E6c', 'E6c is carried by ' + hit.join(',') + ', not by §6\'s reviewReduced key',
          '§2.2 moves the toast into the dialog and §6 names a new key for it; ' +
          'only one of those two happened');
      }
    }
  } else {
    check('E6 the dialog renders an image at all (§3.2)', !!img, JSON.stringify(d.imgs));
  }

  /* E7 §3.2 — "with the scale stated". */
  const scaleTpl = await result.evaluate(s => {
    try { return chrome.i18n.getMessage('reviewScale', s) || ''; } catch (_) { return ''; }
  }, SENTINELS.slice(0, 1));
  const scaleRe = templateToRe(scaleTpl);
  check('E7 the dialog states the scale it is showing (§3.2)',
    !!scaleRe && scaleRe.test(norm(d.text)), JSON.stringify(norm(d.text).slice(0, 200)));

  /* E8 §3.3 — "a numbered badge, keyed to a numbered list beside the image …
     Numbered and listed, never colour alone." */
  const numbered = d.buttons.filter(b => !/^review(Prev|Next|Actual|Confirm|Cancel)/.test(b.key || '') &&
                                         /\d/.test(b.text));
  check('E8 one numbered jump control per stored mark (§3.3)',
    numbered.length === marks.length,
    numbered.length + ' numbered controls vs ' + marks.length + ' marks');
  if (marks.length === 0) {
    const noMarksTpl = await result.evaluate(() => {
      try { return chrome.i18n.getMessage('reviewNoMarks') || ''; } catch (_) { return ''; }
    });
    const re = templateToRe(noMarksTpl);
    check('E8b with nothing outlined the dialog says so (§3.3/§3.4)',
      !!re && re.test(norm(d.text)), norm(d.text).slice(0, 200));
  }

  /* E9 §3.4 — "the only bolded line in the design". */
  /* Same-unit, same predicate as the sentence itself — see expectedActsKey.
     This check reads "exactly one bolded line, and only when something is not
     covered", and it was computing "not covered" a different way from the
     renderer, which is how the product came to show the sentence unbolded. */
  const shortfall = !!(a && isInt(a.matched) && isInt(a.painted) && isInt(a.verifiedOpaque) &&
    a.matched - a.verifiedOpaque > 0);
  check('E9 exactly one bolded line, and only when something is not covered (§3.4)',
    d.bold.length === (shortfall ? 1 : 0),
    'bold=' + JSON.stringify(d.bold).slice(0, 200) + ' shortfall=' + shortfall +
    ' acts=' + (a ? [a.matched, a.painted, a.verifiedOpaque].join('/') : '?'));
  if (shortfall) {
    /* §3.4's third row states the shortfall as a subtraction. The sentence that
       carries the negation is the whole point of the variant, so its presence
       is graded separately from its weight. */
    const tpls = await result.evaluate((s) => {
      const g = k => { try { return chrome.i18n.getMessage(k, s) || ''; } catch (_) { return ''; } };
      return { one: g('redactActsUncoveredOne'), other: g('redactActsUncoveredOther'),
               shortfall: g('redactActsShortfall') };
    }, SENTINELS.slice(0, 2));
    let stated = null;
    for (const k of ['one', 'other']) {
      const re = templateToRe(tpls[k]);
      const m = re && re.exec(norm(d.text));
      if (m) { stated = firstNum(m); break; }
    }
    check('E9b ...and the sentence that says what is NOT covered is shown (§3.4)',
      stated !== null, norm(d.text).slice(0, 220));

    /* §3.4 reserves this sentence for the case where FullShot covered less than
       it found. A shortfall of zero — or of a negative — is the variant
       contradicting its own precondition in the one line the design bolds. */
    if (stated !== null) {
      check('E9c the shortfall it bolds is a real, positive shortfall (§3.4)',
        stated >= 1, 'it says ' + stated + ' with acts ' +
        [a.matched, a.painted, a.verifiedOpaque].join('/'));
    }
    /* And the two counts in the sentence above it must be readable as
       "matched N and covered M" with M <= N — §2.1 calls this arithmetic. */
    const sRe = templateToRe(tpls.shortfall);
    const sm = sRe && sRe.exec(norm(d.text));
    if (sm) {
      const nums = (sm[0].match(/\d+/g) || []).map(Number);
      check('E9d ...and it cannot say it covered more than it matched (§2.1)',
        nums.length >= 2 && nums[1] <= nums[0], 'the sentence reads: ' + sm[0]);
    }
  }

  /* E10/E11 — the copy, the limit paragraph, and §8.2's focus rule. */
  await gradeCopy(shape, result, a, requested, 'dialog');
  check('E10 the dialog states the limit of the instrument (§3.4)',
    d.keys.indexOf('reviewLimit') >= 0 || /cannot see this image/i.test(d.text),
    d.keys.join(','));
  check('E11 initial focus is not on the primary button (§8.2)',
    d.focusKey !== 'reviewConfirm' && !/confirm/i.test(String(d.focusId)),
    'focus=' + d.focusId + ' key=' + d.focusKey);
  check('E11b ...but it is inside the dialog', d.focusInside === true, 'focus=' + d.focusId);

  /* E12 §3.3 / §8.1 check 10 — "The marks are drawn in the preview only and
     never in the exported image." The outline colour is READ OUT OF THE LIVE
     DIALOG rather than hard-coded, so a change of palette cannot silently
     retire this check, and the image scanned is the blob the clipboard gets. */
  /* The outline is a BORDER or OUTLINE property with a real width — §3.3 says
     "Outline and badge, never a fill", so a background colour is not a
     candidate and grading one would redden on white. */
  const palette = await result.evaluate(`(() => {
    const p = ${DIALOG_PROBE};
    if (!p.el) return { colours: [], overlay: 0 };
    const out = [], seen = new Set();
    let overlay = 0;
    for (const el of p.el.querySelectorAll('*')) {
      const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      if (!/mark|outline|badge|block/i.test(cls)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') overlay++;
      for (const prop of ['borderTopColor', 'outlineColor']) {
        if (prop === 'borderTopColor' && !parseFloat(cs.borderTopWidth)) continue;
        if (prop === 'outlineColor' && !parseFloat(cs.outlineWidth)) continue;
        const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(cs[prop] || '');
        if (!m) continue;
        if (m[4] !== undefined && parseFloat(m[4]) === 0) continue;
        const key = m[1] + ',' + m[2] + ',' + m[3];
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([+m[1], +m[2], +m[3]]);
      }
    }
    return { colours: out, overlay };
  })()`);

  if (marks.length) {
    /* §3.3 — the marks are an OVERLAY. If they are positioned DOM elements over
       the image then by construction they are not in the blob, which is the
       structural half of check 10. */
    check('E12 the marks are positioned elements over the preview, not paint (§3.3)',
      palette.overlay > 0, palette.overlay + ' positioned mark element(s)');
  }

  if (marks.length && palette.colours.length && fit) {
    /* The measured half. A painted outline would occupy the RING just outside
       each block, so the ring is where it is looked for — asking whether the
       colour occurs anywhere in a screenshot answers a different question and
       reddens on any ordinary grey. */
    const ring = await result.evaluate(`(async () => {
      const p = ${DIALOG_PROBE};
      const imgs = p.el ? Array.from(p.el.querySelectorAll('img')) : [];
      const im = imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
      if (!im || !im.src) return null;
      const blob = await (await fetch(im.src)).blob();
      const bmp = await createImageBitmap(blob);
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const c = cv.getContext('2d', { willReadFrequently: true });
      c.drawImage(bmp, 0, 0);
      const D = c.getImageData(0, 0, bmp.width, bmp.height).data;
      const at = (x, y) => {
        if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return null;
        const o = (y * bmp.width + x) * 4;
        return [D[o], D[o + 1], D[o + 2]];
      };
      const marks = ${JSON.stringify(marks)};
      const list = ${JSON.stringify(palette.colours)};
      const s = bmp.width / ${JSON.stringify(rec.w)};
      const near = (c, q) => Math.abs(c[0] - q[0]) <= 6 && Math.abs(c[1] - q[1]) <= 6 &&
                             Math.abs(c[2] - q[2]) <= 6;
      /* The control. A colour that is everywhere in the picture anyway — the
         page's white background, its greys — is not evidence of a painted
         outline, and grading it reddens on every ordinary screenshot. */
      const global = list.map(() => 0);
      let gsamples = 0;
      for (let i = 0; i < D.length; i += 4 * 37) {
        gsamples++;
        for (let k = 0; k < list.length; k++) if (near([D[i], D[i+1], D[i+2]], list[k])) global[k]++;
      }
      const hits = list.map(() => 0);
      let samples = 0;
      for (const m of marks) {
        const x0 = m.x * s, y0 = m.y * s, x1 = (m.x + m.w) * s, y1 = (m.y + m.h) * s;
        const pts = [];
        for (let t = 0; t <= 1.0001; t += 0.05) {
          pts.push([x0 + (x1 - x0) * t, y0 - 2], [x0 + (x1 - x0) * t, y1 + 2],
                   [x0 - 2, y0 + (y1 - y0) * t], [x1 + 2, y0 + (y1 - y0) * t]);
        }
        for (const [px, py] of pts) {
          const c2 = at(Math.round(px), Math.round(py));
          if (!c2) continue;
          samples++;
          for (let k = 0; k < list.length; k++) if (near(c2, list[k])) hits[k]++;
        }
      }
      bmp.close();
      return { hits, samples, global, gsamples, w: bmp.width };
    })()`);
    if (ring && ring.samples > 0) {
      /* A leaked outline paints essentially the whole ring AND is not otherwise
         in the picture. Both halves are needed: the first alone reddens on a
         block sitting on a white row, the second alone would miss an outline
         drawn in a colour the page also uses. */
      const leaked = ring.hits.map((n, i) => {
        const onRing = n / ring.samples;
        const inPicture = ring.global[i] / Math.max(1, ring.gsamples);
        return (onRing >= 0.5 && inPicture < 0.02)
          ? 'rgb(' + palette.colours[i].join(',') + ') on ' + Math.round(100 * onRing) +
            '% of the ring but ' + (100 * inPicture).toFixed(2) + '% of the picture'
          : null;
      }).filter(Boolean);
      check('E12b no mark-outline colour is painted into the blob about to be ' +
            'copied (check 10)', leaked.length === 0,
        leaked.join(' | ') || ring.samples + ' ring samples, ' +
        palette.colours.length + ' candidate colour(s)');
    } else {
      open('E12b the preview image could not be re-decoded', 'check 10 not measured here');
    }
  } else if (marks.length) {
    open('E12b could not identify an outline colour from the live dialog',
      'no bordered/outlined element classed mark|outline|badge|block; check 10 not measured');
  }

  /* And the other artifact: Save writes the stored segments, so showing the
     dialog must not have touched them. Byte-identity needs no palette at all. */
  const digestAfter = await imageDigest(result);
  check('E12c showing the review left the saved image byte-identical',
    digestAfter === digestBefore, digestBefore.slice(0, 12) + ' -> ' + digestAfter.slice(0, 12));

  /* E13 §8.1 check 6 — Esc closes and the clipboard is untouched. */
  await result.keyboard.press('Escape');
  await result.waitForTimeout(600);
  check('E13 Escape closes the dialog (§8.2)', (await dialogOpen(result)) === false, '');
  const afterEsc = await clipCalls(result);
  check('E13b ...and nothing was copied', afterEsc === clipBefore,
    (afterEsc - clipBefore) + ' clipboard call(s)');

  /* E14 — Cancel, through the button §6 names. */
  await result.click(copy.sel);
  const again = await waitDialog(result, 25000);
  askOnce('E14', 'E14 the spec does not say whether a CANCELLED copy consumes the ' +
       '"once per record per page load" allowance (§3.1)',
       again ? 'it asked again after Escape' : 'it did NOT ask again after Escape — a ' +
       'person who cancelled by accident can now copy with no review');
  if (again) {
    const cancelSel = await result.evaluate(`(() => {
      const p = ${DIALOG_PROBE};
      const b = p.el && p.el.querySelector('button[data-i18n="reviewCancel"]');
      return b ? (b.id ? '#' + b.id : null) : null;
    })()`);
    if (cancelSel) {
      await clickIt(result, cancelSel, 'Cancel');
      await result.waitForTimeout(600);
      const afterCancel = await clipCalls(result);
      check('E14b Cancel closes it and copies nothing (check 6)',
        (await dialogOpen(result)) === false && afterCancel === clipBefore,
        (afterCancel - clipBefore) + ' clipboard call(s)');
    } else {
      open('E14b no button carries data-i18n="reviewCancel"', JSON.stringify(d.buttons));
    }
  }

  /* E15 §3.1 — "Two copies in one sitting, one dialog." */
  await result.click(copy.sel);
  if (await waitDialog(result, 25000)) {
    const confirmSel = await result.evaluate(`(() => {
      const p = ${DIALOG_PROBE};
      const b = p.el && p.el.querySelector('button[data-i18n="reviewConfirm"]');
      return b ? (b.id ? '#' + b.id : null) : null;
    })()`);
    if (!confirmSel) { open('E15 no button carries data-i18n="reviewConfirm"', JSON.stringify(d.buttons)); return; }
    await clickIt(result, confirmSel, 'Confirm');
    await result.waitForTimeout(3000);
    const after = await clipCalls(result);
    check('E15 confirming copies exactly once', after === clipBefore + 1,
      (after - clipBefore) + ' clipboard call(s)');
    check('E15b ...and the dialog is gone', (await dialogOpen(result)) === false, '');
    await result.click(copy.sel);
    const asksAgain = await waitDialog(result, 6000);
    check('E15c a second copy in the same page load does not ask again (§3.1)',
      asksAgain === false, asksAgain ? 'it asked twice' : '');
    await result.waitForTimeout(2500);
    const after2 = await clipCalls(result);
    check('E15d ...and it still copies', after2 > after, (after2 - after) + ' further call(s)');
  }
}

/* ==========================================================================
   one shape, end to end
   ========================================================================== */
async function runShape(ctx, sw, shape) {
  begin(shape.name, shape.why + '   [' + shape.spec + ']');
  const { page, result } = await capture(ctx, sw, shape.url);
  try {
    const rec = await readRecord(result);
    const { r, a, marks } = await gradeRecord(shape, rec);
    const requested = r ? r.requested : undefined;

    /* §2.1 — `requested` is "the setting, read once", not an inference. The
       setting was on for this pass, so the record must say so. */
    check('A0 requested records the setting that was actually on',
      requested === true, JSON.stringify(requested));

    await saveFirstSegment(result, shape.name);
    await gradeImage(shape, result, rec, a, marks);
    await gradeLedgerAgainstPicture(shape, result, a);
    await gradeCopy(shape, result, a, requested, 'page');
    const bundle = await gradeBundle(shape, result, rec, a);

    /* Per-shape ground truth. Only three shapes get a graded expectation: the
       two controls, and the ceiling, which the fixture provably overruns.
       Everywhere else the spec makes no promise about what the detector will
       find, and inventing one here would be the old design creeping back in
       through the test suite. What the picture holds is printed either way. */
    if (shape.minMatched != null) {
      check('F1 the honest control still finds what it is for (§3.4)',
        isInt(a && a.matched) && a.matched >= shape.minMatched,
        'matched=' + JSON.stringify(a && a.matched) + ' need >=' + shape.minMatched);
      check('F1b ...and covers what it found',
        isInt(a && a.painted) && a.painted === a.matched && a.verifiedOpaque === a.painted,
        [a && a.matched, a && a.painted, a && a.verifiedOpaque].join('/'));
    }
    if (shape.expectMatched != null) {
      check('F2 the clean control matches nothing (§3.4 variant 2)',
        !!a && a.matched === shape.expectMatched, 'matched=' + JSON.stringify(a && a.matched));
    }
    if (shape.expectTruncated) {
      check('F3 a page past the box ceiling records the truncation (§2.1)',
        !!a && (a.walkComplete === false || a.truncatedBy !== null),
        'walkComplete=' + JSON.stringify(a && a.walkComplete) +
        ' truncatedBy=' + JSON.stringify(a && a.truncatedBy));
    }
    if (shape.visible != null && a) {
      note('the picture holds ' + shape.visible + ' PII item(s) a human can read; the ' +
           'ledger says matched=' + JSON.stringify(a.matched) +
           ' painted=' + JSON.stringify(a.painted) +
           ' verified=' + JSON.stringify(a.verifiedOpaque));
      if (isInt(a.matched) && shape.visible > a.matched) {
        note('UNREAD BY DESIGN: ' + (shape.visible - a.matched) + ' visible item(s) the ' +
             'instrument never saw. §9 — the product must not imply otherwise, which is ' +
             'what D1/D3/C8/E10 above are for.');
      }
      if (shape.visible === 0 && isInt(a.painted) && a.painted > 0) {
        /* MATCH(ES), not block(s): `painted` counts matches (§2.1), and the
           outlines are drawn per block, so the number of things the person is
           asked to look at is `marks.length` and is at least this. */
        note('OVER-MASKED: ' + a.painted + ' match(es) painted on a picture that shows no ' +
             'PII at all, drawn as ' + marks.length + ' outline(s). Not a violation — §3.4 ' +
             'says the counts are acts, not a judgement — but every outline is something the ' +
             'person is asked to look at, and §3.4 warns that alarm spent on nothing is ' +
             'wallpaper within a week.');
      }
    }

    await gradeGate(shape, result, rec, a, marks, bundle);
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
  }
}

/* ==========================================================================
   §3.1 row 3 — the default-off majority. Redaction never requested: the
   producer does not gate, and Copy asks nothing.
   ========================================================================== */
async function runRedactionOff(ctx, sw) {
  begin('control-pii (redaction OFF)', 'the setting the majority never turns on   [§3.1]');
  await setSettings(sw, { redactPII: false });
  const { page, result } = await capture(ctx, sw, FIX + 'control-pii.html');
  try {
    const rec = await readRecord(result);
    const r = rec.redaction, a = r && r.acts;
    check('O1 requested is false where the setting was positively off (§4)',
      !!r && r.requested === false, JSON.stringify(r));
    await gradeCopy({ name: 'off' }, result, a, r && r.requested, 'page');
    await gradeBundle({ name: 'off' }, result, rec, a);
    await gradeGate({ name: 'off' }, result, rec, a, (r && r.marks) || [], null);
  } finally {
    await result.close().catch(() => {});
    await page.close().catch(() => {});
    await setSettings(sw, { redactPII: true });
  }
}

/* ==========================================================================
   §4 — CAPTURES THAT CARRY AN OLD-FORMAT RECORD.
   Three populations, seeded into the real IndexedDB on top of a real capture's
   segments, then read back through the store. The raw read is the control: it
   proves the old fields were really written, so a green strip cannot be green
   because the seed silently failed.
   ========================================================================== */
const V2_LEDGER = {
  v: 2, state: 'blocks-painted', severity: 'exposed', pixels: 'baked',
  scan: { v: 2, chars: 812, spans: 40, placed: 38, declined: { total: 2 },
          truncated: { elements: false, time: true, ceiling: false } },
  bake: { v: 1, painted: 3, verified: 2, moved: 0 },
  kinds: { email: 2, phone: 1 }
};
const POPULATIONS = [
  { name: 'v2-ledger', seed: V2_LEDGER, requested: true, ledger: 'partial' },
  { name: 'ancient-none', seed: { pixels: 'none' }, requested: false, ledger: 'absent' },
  { name: 'ancient-baked', seed: { pixels: 'baked' }, requested: null, ledger: 'absent' },
  { name: 'no-block', seed: null, requested: null, ledger: 'absent' }
];

async function runOldRecords(ctx, sw, extBase) {
  begin('old records', 'three populations in users\' IndexedDB   [§4]');
  const { page, result } = await capture(ctx, sw, FIX + 'control-pii.html');
  let ids = null;
  try {
    ids = await result.evaluate(async (pops) => {
      const id = new URLSearchParams(location.search).get('id');
      const live = await FSDB.get('shots', id);
      const out = [];
      for (const p of pops) {
        const clone = Object.assign({}, live, { id: 'oldrec-' + p.name });
        if (p.seed) clone.redaction = JSON.parse(JSON.stringify(p.seed));
        else delete clone.redaction;
        await FSDB.put('shots', clone);
        out.push(clone.id);
      }
      return out;
    }, POPULATIONS);
  } catch (e) {
    open('§4 could not seed old records', String(e && e.message || e));
  }
  await result.close().catch(() => {});
  await page.close().catch(() => {});
  if (!ids) return;

  for (const pop of POPULATIONS) {
    const id = 'oldrec-' + pop.name;
    const rp = await ctx.newPage();
    try {
      await rp.goto(extBase + 'pages/result.html?id=' + id, { waitUntil: 'load' });
      await rp.waitForTimeout(2500);

      /* The control: what is actually on disk, read around FSDB. */
      const raw = await rp.evaluate(async (key) => {
        const db = await new Promise((res, rej) => {
          const q = indexedDB.open('fullshot');
          q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
        });
        const rec = await new Promise((res, rej) => {
          const q = db.transaction('shots').objectStore('shots').get(key);
          q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
        });
        return rec && rec.redaction ? Object.keys(rec.redaction) : null;
      }, id);
      const seeded = pop.seed ? Object.keys(pop.seed) : null;
      check('P0 [' + pop.name + '] the seed really is on disk in the old shape',
        JSON.stringify(raw) === JSON.stringify(seeded), 'raw=' + JSON.stringify(raw));

      const rec = await rp.evaluate(async (key) => {
        const shot = await FSDB.get('shots', key);
        return JSON.parse(JSON.stringify({ redaction: shot.redaction ?? null }));
      }, id);
      const r = rec.redaction, a = r && r.acts;

      /* §4 — "The stored verdict is never read, in any of them." */
      const survived = deepEntries(r).filter(e => REMOVED_NAMES.indexOf(e.key) >= 0);
      check('P1 [' + pop.name + '] the store strips the old ladder on the way out (§4)',
        survived.length === 0, survived.map(e => e.path).join(',') || JSON.stringify(r));

      /* §4's table gives every population a `requested`, an `acts` and a
         `marks`. A record that comes out of the store with no redaction block
         at all is not on that table, and it pushes the normalisation into
         whichever page happens to have a fallback — which is the same hazard
         §4 names when it puts the strip at the store boundary. */
      check('P1b [' + pop.name + '] the store presents §4\'s three fields',
        !!r && 'requested' in r && !!a,
        r ? Object.keys(r).join(',') : 'the store returned no redaction block at all');
      check('P2 [' + pop.name + '] requested is ' + JSON.stringify(pop.requested) + ' (§4 table)',
        !!r && r.requested === pop.requested,
        r ? 'requested=' + JSON.stringify(r.requested) : 'no redaction block');
      check('P3 [' + pop.name + '] ledger is "' + pop.ledger + '"',
        !!a && a.ledger === pop.ledger,
        a ? 'ledger=' + JSON.stringify(a.ledger) : 'no acts block');

      /* §4 — "anything the ledger cannot supply is null, never 0 — a zero is a
         measurement and this is the absence of one." */
      const counters = ['matched', 'painted', 'verifiedOpaque', 'walkComplete', 'truncatedBy'];
      const zeros = a ? counters.filter(k => a[k] === 0) : [];
      if (pop.ledger === 'absent') {
        check('P4 [' + pop.name + '] every counter is null, never 0 (§4)',
          !!a && counters.every(k => a[k] === null), JSON.stringify(a));
      } else {
        check('P4 [' + pop.name + '] no counter is a manufactured zero (§4)',
          zeros.length === 0, zeros.join(',') || JSON.stringify(a));
      }
      const bad = actsViolations(a);
      check('P5 [' + pop.name + '] the lifted acts still satisfy Rule 2',
        bad.length === 0, bad.map(x => x.k + '=' + JSON.stringify(x.v)).join(' '));
      /* P5b §2.1 — THE UNITS, AT THE STORE BOUNDARY, ON A REAL RECORD IN A REAL
         INDEXEDDB. Nothing above can see this: P4 asks only that a counter is
         not a manufactured zero, and `bake.painted: 3` is not a zero — it is a
         BLOCK count in a field the whole product subtracts from `matched`, which
         is the defect this round removed everywhere the numbers are produced and
         then left standing in the one path that translates records already on
         users' disks. A v2 ledger has no `matchId` on anything, so the match-unit
         roll-up cannot be made from it and the honest answer is `null`. The
         fixture above deliberately carries `bake: { painted: 3, verified: 2 }`,
         so this reddens on any lift that reads them. */
      if (pop.seed && pop.seed.bake) {
        check('P5b [' + pop.name + '] a v2 bake counted BLOCKS, so it supplies no MATCH count (§2.1)',
          !!a && a.painted === null && a.verifiedOpaque === null,
          'painted=' + JSON.stringify(a && a.painted) +
          ' verifiedOpaque=' + JSON.stringify(a && a.verifiedOpaque) +
          ' from bake ' + JSON.stringify(pop.seed.bake));
      }
      check('P6 [' + pop.name + '] no mark travels with a record that never stored geometry (§4)',
        !r || !r.marks || r.marks.length === 0, JSON.stringify(r && r.marks));

      await gradeCopy({ name: pop.name }, rp, a, r && r.requested, 'page');

      /* §4 — "requested: null GATES." "We cannot tell whether redaction ran"
         resolves toward showing the person the picture, which costs a dialog;
         the opposite default costs them their data. */
      await spyClipboard(rp);
      const copy = await findButton(rp, BUTTONS.copy);
      if (copy && copy.sel) {
        await rp.click(copy.sel);
        const asked = await waitDialog(rp, pop.requested === false ? 6000 : 25000);
        check('P7 [' + pop.name + '] requested=' + JSON.stringify(pop.requested) +
              (pop.requested === false ? ' does not gate (§3.1)' : ' gates (§3.1, §4)'),
          asked === (pop.requested !== false), 'dialog=' + asked);
        if (asked) await rp.keyboard.press('Escape');
      }
    } catch (e) {
      check('P* [' + pop.name + '] the old record could be opened at all', false,
        String(e && e.message || e));
    }
    await rp.close().catch(() => {});
  }

  /* §4 — "Five files call FSDB.get('shots', …) … a strip written in any one of
     them is a strip the other four do not have." Read the same seeded record
     from each of those pages' own contexts. */
  for (const p of ['result', 'history', 'editor', 'beautify', 'scrollclip']) {
    const url = extBase + 'pages/' + p + '.html' + (p === 'history' ? '' : '?id=oldrec-v2-ledger');
    const pg = await ctx.newPage();
    try {
      await pg.goto(url, { waitUntil: 'load' });
      await pg.waitForTimeout(1500);
      const seen = await pg.evaluate(async (ids) => {
        if (typeof FSDB === 'undefined') return null;
        const out = {};
        for (const id of ids) {
          const s = await FSDB.get('shots', id);
          out[id] = s && s.redaction
            ? { keys: Object.keys(s.redaction), ledger: s.redaction.acts && s.redaction.acts.ledger }
            : null;
        }
        return out;
      }, POPULATIONS.map(x => 'oldrec-' + x.name));
      if (!seen) { open('P8 [' + p + '.html] does not load the store at all', 'no FSDB'); }
      else {
        const leaked = [];
        const unnormalised = [];
        for (const pop of POPULATIONS) {
          const v = seen['oldrec-' + pop.name];
          if (!v) { unnormalised.push(pop.name); continue; }
          for (const k of v.keys) if (REMOVED_NAMES.indexOf(k) >= 0) leaked.push(pop.name + '.' + k);
        }
        check('P8 [' + p + '.html] the old ladder is stripped for every population (§4)',
          leaked.length === 0, leaked.join(',') || 'four populations read clean');
        check('P8b [' + p + '.html] every population arrives normalised, so no page ' +
              'needs a fallback of its own (§4)',
          unnormalised.length === 0,
          unnormalised.length ? unnormalised.join(',') + ' arrive with no redaction block' : 'all four');
      }
    } catch (e) {
      open('P8 [' + p + '.html] could not be opened to read the store',
        String(e && e.message || e));
    }
    await pg.close().catch(() => {});
  }
}

/* ==========================================================================
   §6 — the keys the design speaks through. A run-level fact, asked once: a
   missing key is not seventeen findings, it is one.
   ========================================================================== */
async function runLocalePreflight(ctx, extBase) {
  begin('locale', 'the keys §6 names must exist before anything can render them');
  const pg = await ctx.newPage();
  try {
    await pg.goto(extBase + 'pages/history.html', { waitUntil: 'load' });
    const got = await pg.evaluate((keys) => {
      const out = {};
      for (const k of keys) { try { out[k] = chrome.i18n.getMessage(k) || ''; } catch (_) { out[k] = ''; } }
      return out;
    }, REVIEW_KEYS.concat(ACTS_LINE_KEYS, REVIEW_KEYS_EXTRA));
    const required = REVIEW_KEYS.concat(ACTS_LINE_KEYS);
    const missing = required.filter(k => !got[k]);
    check('L1 every new key §6 names exists in the English locale',
      missing.length === 0, missing.join(',') || required.length + ' keys present');
    const extras = REVIEW_KEYS_EXTRA.filter(k => got[k]);
    if (extras.length) {
      open('L1b the design needs keys §6 does not list',
        extras.join(',') + ' — §3.4\'s bolded shortfall line and §3.3\'s numbered ' +
        'badges cannot be built from §6\'s list alone');
    }
    /* §6's forbidden vocabulary, in the English the owner may edit. i18n-sim
       owns this; it is repeated here because a suite that drives the real UI
       and never reads the strings it renders is grading furniture. */
    const bad = required.filter(k => got[k] && (FORBIDDEN.test(got[k]) || THIS_PAGE.test(got[k])));
    check('L2 no forbidden word in any of those strings (§6)',
      bad.length === 0, bad.map(k => k + ': ' + got[k]).join(' | ') || 'none');
    /* §2.2 retires these. A retired key still answering is a sentence one line
       of code away from being shown again. */
    const RETIRED = ['resultRedactCoveredOne', 'resultRedactCoveredOther',
      'resultRedactReadNoMatch', 'resultRedactReadNoMatchBlind', 'resultRedactNoCoverableText',
      'resultRedactIncomplete', 'resultRedactPassNotRun', 'resultRedactDerived',
      'resultRedactUnknown', 'resultRedactNoTextLayer'].concat(REVIEW_KEYS_RETIRED);
    const alive = await pg.evaluate((keys) => keys.filter(k => {
      try { return !!chrome.i18n.getMessage(k); } catch (_) { return false; }
    }), RETIRED);
    check('L3 the retired ladder strings are gone from the locale (§6)',
      alive.length === 0, alive.join(',') || RETIRED.length + ' keys checked');
  } finally {
    await pg.close().catch(() => {});
  }
}

/* ==========================================================================
   runner
   ========================================================================== */
(async () => {
  const TEST_EXT = prepareTestExtension();
  /* Served from the extension root so `/test/e2e/fixtures/...` resolves, and so
     `plaintext-*.txt` arrives with a real text/plain content-type. A wrong root
     does not error: every fixture becomes the string "not found" and every
     check passes on a page with nothing in it. */
  const srv = await serve(EXT_DIR, PORT);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-reduction-corpus-'));
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
    const extBase = sw.url().replace(/background\.js.*$/, '');
    await setSettings(sw, { redactPII: true });

    /* §0.1 Rule 2 versus §5's gate: the two are not the same set, and the
       difference is not a detail — §5 as written refuses `ledger: "present"`,
       which §2.1 requires in the same block. Raised once, up front, rather than
       as seventeen identical failures. */
    begin('spec', 'questions raised before anything is graded');
    open('§0.1 / §2.1 / §5 disagree about the acts block\'s allowed values',
      '§5 allows "an integer, a boolean, null, or one of the four truncatedBy strings"; ' +
      '§2.1 also puts ledger:"present"|"partial"|"absent" inside acts, and §0.1 says ' +
      '"exactly one enum". Graded here as the union of the two closed enums.');

    await runLocalePreflight(ctx, extBase);

    for (const shape of CORPUS) {
      if (ONLY.length && !ONLY.includes(shape.name)) continue;
      try { await runShape(ctx, sw, shape); }
      catch (e) { check(shape.name + ' :: the shape ran to completion', false, String(e && e.message || e)); }
    }
    if (!ONLY.length || ONLY.includes('off')) {
      try { await runRedactionOff(ctx, sw); }
      catch (e) { check('redaction-off :: ran to completion', false, String(e && e.message || e)); }
    }
    if (!SKIPOLD && (!ONLY.length || ONLY.includes('old'))) {
      try { await runOldRecords(ctx, sw, extBase); }
      catch (e) { check('old-records :: ran to completion', false, String(e && e.message || e)); }
    }

    begin('census', 'what the corpus actually exercised');
    if (ONLY.length) {
      open('X1 not graded on a filtered run', 'reduced overviews seen: ' +
        (REDUCED_SEEN.join(',') || 'none'));
    } else {
      check('X1 at least one fixture exported a reduced overview, so §3.2\'s ' +
            'reduced-overview line was reachable at all',
        REDUCED_SEEN.length > 0, REDUCED_SEEN.join(',') || 'none did — the check never ran');
    }
  } finally {
    await ctx.close();
    srv.close();
  }

  if (results.opens.length) {
    console.log('\n=== OPEN (spec silent or self-contradictory — never graded) ===');
    for (const o of results.opens) console.log('  ' + o);
  }
  if (results.fails.length) {
    console.log('\n=== FAILURES ===');
    for (const f of results.fails) console.log('  ' + f);
  }
  console.log('\n' + results.pass + ' pass, ' + results.fail + ' fail, ' + results.open + ' open');
  process.exit(results.fail ? 1 : 0);
})();
