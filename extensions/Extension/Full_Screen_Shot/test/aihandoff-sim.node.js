#!/usr/bin/env node
/* FullShot AI hand-off tier — grades the ENVELOPE (AI-HANDOFF-ENVELOPE.md).

   Two instruments, deliberately:

   1. pages/common.js is REQUIRED as a plain module, so every pure function in
      the envelope (the fit, the token estimate, the tile planner, the masker,
      the legend, the bundle builder) is graded as the shipped code and not as a
      stub. common.js already ships this way for three other tiers.

   2. pages/result.js is BOOTED in a vm against a fake document, the same idiom
      as test/pixel-sim/result-harness.js — but with a clipboard RECORDER rather
      than the no-op that tier uses, because "which types were written" is the
      question this tier exists to answer and a no-op cannot answer it.

   The REAL pages/common.js clipboard writer runs here. It reaches for
   createImageBitmap, a canvas, navigator.clipboard and ClipboardItem as
   globals; those are installed on globalThis below, AFTER the require, because
   common.js runs its own load-time pass the moment it can see a document.

   What this tier cannot see, stated so nobody reads more into a green run:
   real pixels (the rasterizer is test/pixel-sim/canvas2d.js), what a real
   editor does with a two-type paste (measured separately in Chromium 149 —
   AI-HANDOFF-ENVELOPE.md §9, §13), and the page-text sidecar, which has no
   producer yet (§14). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..');
const COMMON = require(path.join(ROOT, 'pages', 'common.js'));
const { FakeCanvas } = require(path.join(ROOT, 'test', 'pixel-sim', 'canvas2d'));
/* pages/db.js is a plain script that hangs FSDB off its global; the strip that
   keeps the old verdict inside the store lives there (REDACTION-CLAIM-SPEC.md
   §4), so it is loaded here rather than reimplemented — a reimplementation is a
   second rule and the second rule is the one that drifts. */
const DB = (() => {
  const g = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'pages', 'db.js'), 'utf8'),
    { self: g, indexedDB: undefined, IDBKeyRange: undefined, navigator: undefined });
  return g.FSDB;
})();

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
/* A tier whose first run is against code that does not exist yet must report a
   red list, not a node stack trace: the next agent needs to see which claims
   failed, not which one threw first. */
function safe(fn, fallback) {
  try { const v = fn(); return v === undefined ? fallback : v; }
  catch (e) { return fallback === undefined ? { __threw: String(e && e.message || e) } : fallback; }
}
async function safeAsync(fn) { try { return await fn(); } catch (e) { return { __threw: String(e && e.message || e) }; } }
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* The three functions that produce every string in the payload, bounded by
   name at BOTH ends: an unbounded slice runs on into common.js's own i18n pass
   and grades that instead — which is how this row first passed. */
function builderRegion() {
  const c = stripComments(read('pages/common.js'));
  const a = c.indexOf('function fsAiBundle');
  const b = c.indexOf('function fsOnDomReady');
  return a < 0 || b < a ? '' : c.slice(a, b);
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ---------------- the fixture secrets ----------------
   Chosen so a whole-bundle substring scan cannot produce a false positive: no
   dimension, date or id this product emits can contain any of them. */
const SECRET_EMAIL = 'jane.doe@acme.example';
const SECRET_PHONE = '+1 (415) 555-0134';
const SECRET_TOKEN = 'sk-abcdefghijklmnopqrstuvwx';
/* A card-shaped number that FAILS the Luhn check — the over-masking control.
   Same decoy the pixel tier's tokenredact scenario already uses. */
const DECOY_CARD = '1234 5678 9012 3456';

/* ---------------- the two redaction ledgers, as fixtures ----------------
   REDACTION-CLAIM-SPEC.md §2.1 / §2.4. Spelled out in full rather than
   sprinkled per test, because a fixture that omits a counter is a fixture that
   silently exercises whatever the code does with `undefined` — and "what the
   code does with undefined" is how five of these bugs shipped. Every override
   below is therefore a DELIBERATE deviation from a complete, honest ledger. */
function SCAN(o) {
  return Object.assign({
    v: 2, fed: 0, chars: 0, placed: 0,
    unplaced: { offRegion: 0, degenerate: 0, hidden: 0, fontMismatch: 0, clipped: 0, faded: 0, total: 0 },
    unplacedChars: 0, inkPx: 0, nonText: 0,
    frames: { sameOrigin: 0, scanned: 0, crossOrigin: 0 },
    matched: 0, boxes: 0, boxesFromUnplaced: 0, matchedNoBox: 0,
    /* The blocks a match produced and the pass could not emit, and the matches
       that happened to — both in the unit their name gives. */
    blocksLost: 0, matchesTruncated: 0, rectsSkipped: { degenerate: 0, offRegion: 0 },
    lateTextPlaced: 0, lateChars: 0, lateMatched: 0,
    declined: { tooLong: 0, ceiling: 0, unmeasurable: 0, other: 0, total: 0 },
    declinedChars: 0, truncated: { walk: false, time: false, ceiling: false, error: false },
    walks: 1, walksCompleted: 1, remeasured: 0, movedUncovered: 0,
    /* THE COMPLETENESS THAT TRAVELS WITH `matched`. Default true because the
       default ledger above records no budget, no cap and no refusal; a fixture
       that moves any of those moves this in the same literal, exactly as
       content/capture.js writes both at its seal. */
    budgetMs: 1200, matchedComplete: true, sealed: true
  }, o || {});
}
function BAKE(o) {
  return Object.assign({
    v: 1, handed: 0, painted: 0, unplaced: 0, outOfRange: 0,
    verified: 0, verifyFailed: 0, verifySkipped: 0, modeSkipped: false,
    capturedPx: 1000000, sealed: true
  }, o || {});
}
/* The flat evidence block the envelope carries (§3.8). */
function ACTS(o) {
  return Object.assign({
    v: 4, matched: 2, painted: 2, verifiedOpaque: 2,
    /* v4 — THE GIVING-UP, AS DATA. Five fields that say whether the counters
       above them are whole and where the pass stopped short: a count without
       its completeness is not a count, and each reason is separate because a
       reader acts on them differently. The default is the honest common case —
       nothing refused, nothing dropped — and a fixture that means otherwise
       says which one it is moving. */
    matchedComplete: true, walkComplete: true, truncatedBy: null,
    textRefused: 0, blocksLost: 0, blocksUnpainted: 0, blocksUnread: 0,
    ledger: 'present'
  }, o || {});
}

/* ---------------- a fake document, shared by node and the vm ---------------- */
function makeEl(tag) {
  const el = {
    tag: tag || 'div', id: '', className: '', hidden: false, value: 'auto',
    disabled: false, style: {}, dataset: {}, src: '', alt: '', title: '',
    textContent: '', children: [], attrs: {}, on: {}, firstChild: null,
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'title') this.title = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); },
    removeEventListener() {},
    append(...n) { for (const x of n) this.children.push(x); },
    appendChild(n) { this.children.push(n); return n; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    focus() {}, contains() { return false; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    click() { for (const fn of (this.on.click || [])) fn({}); }
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = String(v);
      el.children.length = 0;
      el.firstChild = /<span/.test(html) ? makeEl('span') : null;
      if (el.firstChild) el.children.push(el.firstChild);
    }
  });
  return el;
}

/* result.js frees a canvas with `canvas.width = canvas.height = 0`, so the
   size a canvas ever REACHED is gone by the time a check can look. The peak is
   the measurement — "was the full stacked height ever allocated?" — so it is
   recorded as the height is set. */
function trackPeak(c) {
  c.__peakH = 0; c.__peakArea = 0;
  /* pages/common.js has its own fsCanvasToBlob and it calls canvas.toBlob —
     the rasterizer has no such method, so the shipped path gets one here
     rather than being stubbed out of the run. */
  c.toBlob = (cb) => cb({ __w: c.width, __h: c.height, __data: c._data.slice(),
                          size: c.width * c.height * 4, type: 'image/png' });
  const d = Object.getOwnPropertyDescriptor(FakeCanvas.prototype, 'height');
  Object.defineProperty(c, 'height', {
    get() { return d.get.call(c); },
    set(v) { d.set.call(c, v); c.__peakH = Math.max(c.__peakH, c.height);
             c.__peakArea = Math.max(c.__peakArea, c.width * c.height); }
  });
  return c;
}

function makeDoc() {
  const byId = new Map();
  const doc = {
    title: '', readyState: 'interactive',
    documentElement: { dataset: {}, dir: '', lang: '' },
    body: makeEl('body'),
    __ready: null, __created: [],
    addEventListener(t, fn) { if (t === 'DOMContentLoaded') doc.__ready = fn; },
    removeEventListener() {},
    activeElement: null,
    getElementById(id) {
      if (!byId.has(id)) { const e = makeEl('div'); e.id = id; byId.set(id, e); }
      return byId.get(id);
    },
    createElement(tag) {
      if (tag === 'canvas') { doc.__created.push(trackPeak(new FakeCanvas())); return doc.__created[doc.__created.length - 1]; }
      const e = makeEl(tag); doc.__created.push(e); return e;
    },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return doc;
}

/* The REAL fsCopyBlobToClipboard runs against these. */
const CLIP = { writes: [] };
globalThis.document = makeDoc();
/* node ships its own navigator and it is getter-only, so it is replaced by
   definition rather than by assignment. */
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, writable: true,
  value: { clipboard: { async write(items) { CLIP.writes.push(items); } } }
});
globalThis.ClipboardItem = class ClipboardItem {
  constructor(map) { this.__map = map; this.types = Object.keys(map); }
  getType(t) { return Promise.resolve(this.__map[t]); }
};
globalThis.createImageBitmap = async blob => {
  /* The one way this harness can make a copy fail the way a real one does. */
  if (blob && blob.__boom) throw new Error('Failed to decode image');
  return ({
  width: blob.__w || 1, height: blob.__h || 1, data: blob.__data, close() {}
});};
globalThis.fsCanvasToBlob = async canvas => ({
  __w: canvas.width, __h: canvas.height, __data: canvas._data && canvas._data.slice(),
  size: canvas.width * canvas.height * 4, type: 'image/png'
});
globalThis.Blob = globalThis.Blob || class Blob {
  constructor(parts, o) { this.__parts = parts; this.type = (o && o.type) || ''; this.size = String(parts[0] || '').length; }
};

/* The shipped writer, or a stand-in that records nothing so the tier reports a
   red list instead of a stack trace on the day it does not exist yet. */
const clipWriter = typeof COMMON.fsCopyBlobToClipboard === 'function'
  ? COMMON.fsCopyBlobToClipboard
  : async () => { throw new Error('pages/common.js does not export fsCopyBlobToClipboard'); };

/* ---------------- booting the shipped result.js ---------------- */
const RESULT_SRC = fs.readFileSync(path.join(ROOT, 'pages', 'result.js'), 'utf8');

function fakeBlob(w, h, tag) {
  const c = new FakeCanvas();
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = tag === 'bottom' ? '#0000ff' : '#ff0000';
  ctx.fillRect(0, 0, w, h);
  return { __w: w, __h: h, __data: c._data.slice(), size: w * h * 4, type: 'image/png' };
}

async function bootResult(opts) {
  const o = opts || {};
  const doc = makeDoc();
  const store = { shots: new Map(), captures: new Map(), frames: [] };
  if (o.shot) store.shots.set(o.shot.id, o.shot);
  if (o.capture) store.captures.set(o.capture.id, o.capture);
  if (o.frames) store.frames = o.frames.map(f => ({
    captureId: o.capture.id, index: f.index, x: f.x, y: f.y,
    pane: f.pane == null ? null : f.pane, inline: f.inline == null ? null : f.inline,
    dataUrl: f.img
  }));

  const clip = [];
  const toasts = [];
  const downloads = [];
  const search = o.shot ? '?shot=' + o.shot.id : '?id=' + (o.capture && o.capture.id);

  const sandbox = {
    console, setTimeout, clearTimeout, URLSearchParams, JSON, Math, Date, Object, Array,
    String, Number, Boolean, Error, Promise, Map, Set, isNaN, parseInt, parseFloat, atob,
    Uint8Array, encodeURIComponent, decodeURIComponent,
    document: doc,
    location: { search, href: '' },
    URL: { createObjectURL: () => 'blob:sim', revokeObjectURL() {} },
    confirm: () => false,
    chrome: { runtime: { openOptionsPage() {} } },
    navigator: globalThis.navigator,
    ClipboardItem: globalThis.ClipboardItem,
    createImageBitmap: globalThis.createImageBitmap,
    FSDB: {
      async get(s, k) { return store[s].get(k); },
      async put(s, v) { store[s].set(v.id, v); },
      async delete() {}, async deleteFrames() {},
      async getFrames() { return store.frames.slice(); }
    },
    fsGetSettings: async () => Object.assign({
      imageFormat: 'png', jpegQuality: 0.92, pdfPaper: 'auto', pdfOrientation: 'portrait',
      pdfStamp: false, pdfSmartSplit: true, filenameTemplate: 'shot', clipboardFit: true,
      autoDownload: false, autoOpenEditor: false, theme: 'light', redactPII: false
    }, o.settings || {}),
    fsToggleTheme() {},
    fsToast: t => toasts.push(t),
    fsHumanReason: COMMON.fsHumanReason,
    fsMime: f => f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png',
    fsExt: f => f === 'jpeg' ? '.jpg' : f === 'webp' ? '.webp' : '.png',
    fsFormatBytes: n => n + ' B',
    fsDims: COMMON.fsDims,
    fsBuildFilename: () => 'shot',
    fsDownloadBlob: async (b, n) => { downloads.push(n); },
    /* The REAL writer from pages/common.js, wrapped only to record. */
    fsCopyBlobToClipboard: async (blob, fit, text) => {
      const before = CLIP.writes.length;
      await clipWriter(blob, fit, text);
      const item = CLIP.writes[before] && CLIP.writes[before][0];
      clip.push({ types: item ? item.types.slice() : [], item, text, blob });
    },
    fsLoadImage: async img => (img && img.__data
      ? { width: img.__w, height: img.__h, data: img.__data } : img),
    fsCanvasToBlob: globalThis.fsCanvasToBlob,
    FSPDF: { PAPERS: { a4: [595, 842], letter: [612, 792], legal: [612, 1008] }, build: () => ({ size: 0 }) }
  };
  /* Everything the envelope adds to common.js, handed in by name so a missing
     function is a red check here rather than a ReferenceError inside the vm. */
  for (const k of Object.keys(COMMON)) if (/^fsAi/.test(k) || /^FS_AI/.test(k)) sandbox[k] = COMMON[k];
  /* The redaction claim's own exports, by the same rule and for the same
     reason: the state function and the line renderer are what turn two ledgers
     into a verdict and a sentence, and a sandbox that omitted them would grade
     result.js's degradation path instead of the shipped one. */
  for (const k of Object.keys(COMMON)) if (/^fsRedact/.test(k) || /^FS_REDACT/.test(k)) sandbox[k] = COMMON[k];
  sandbox.fsNumber = COMMON.fsNumber;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(RESULT_SRC, sandbox, { filename: 'result.js' });
  /* result.html renders #reviewDlg with the `hidden` attribute; the element
     stub defaults everything to visible, so the initial state is set here or
     every check that asks "did the dialog open?" answers yes by accident. */
  doc.getElementById('reviewDlg').hidden = true;
  if (!doc.__ready) throw new Error('result.js never registered DOMContentLoaded');
  await doc.__ready();
  return { doc, store, clip, toasts, downloads, sandbox, record: store.shots.get(search.slice(search.indexOf('=') + 1)) };
}

/* Press Copy and, when the review step opens, answer it. §3 puts a dialog in
   front of every AI hand-off of a capture where redaction was requested, so a
   check that only clicked the button would be waiting on a promise for ever —
   and one that never saw the dialog would be grading a path users do not have.
   Returns whether the dialog opened, which is itself an assertion in several
   checks below. */
async function clickCopy(r, opts) {
  const o = opts || {};
  const cb = r.doc.getElementById(o.id || 'copyBtn');
  const done = Promise.all((cb.on.click || []).map(fn => fn({})));
  for (let i = 0; i < 12; i++) await new Promise(res => setTimeout(res, 0));
  const dlg = r.doc.getElementById('reviewDlg');
  const opened = dlg.hidden === false;
  if (opened) r.doc.getElementById(o.cancel ? 'reviewCancel' : 'reviewConfirm').click();
  await done;
  return opened;
}

/* A shot record shaped like the one stitch() writes, for the ?shot= path. */
function makeShot(over) {
  return Object.assign({
    id: 'shot-1',
    title: 'Orders — Acme',
    url: 'https://acme.example/orders?session=abc',
    createdAt: Date.parse('2026-08-13T09:40:58.000Z'),
    mode: 'full', w: 1280, h: 3000, format: 'png', breakYs: null,
    segments: [{ blob: fakeBlob(1280, 2000, 'top'), w: 1280, h: 2000 },
               { blob: fakeBlob(1280, 1000, 'bottom'), w: 1280, h: 1000 }],
    thumb: fakeBlob(4, 4),
    meta: { totalW: 1280, totalH: 2400, vw: 1280, vh: 730, dpr: 1.25, winW: 1280, winH: 800,
            piiCount: 0, breakHintCount: 0, outScale: 1 },
    captureSettings: { redactPII: false },
    /* The v3 block pages/result.js writes and pages/db.js guarantees on the way
       out of the store: acts, never a verdict. */
    redaction: { v: 3, requested: false, kinds: {}, marks: [],
                 acts: { v: 4, matched: null, painted: null, verifiedOpaque: null,
                         matchedComplete: null, walkComplete: null, truncatedBy: null,
                         textRefused: null, blocksLost: null, blocksUnpainted: null,
                         blocksUnread: null, ledger: 'absent' } }
  }, over || {});
}

(async () => {

console.log('=== the envelope: a shape 67 tools can implement against ===');
{
  const env = safe(() => COMMON.fsAiBundle({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
    subject: {
      kind: 'web-page', mode: 'full', url: 'https://acme.example/orders',
      title: 'Orders — Acme', capturedAt: '2026-08-13T09:40:58.000Z',
      viewport: { w: 1280, h: 730, dpr: 1.25 },
      content: { w: 1280, h: 2400 },
      image: { w: 1600, h: 3000 }
    },
    redactRequested: false
  }), null);
  const e = (env && env.envelope) || {};

  check('the bundle names its own version, and a consumer can read the major',
    typeof e.envelope === 'string' && /^ai-handoff\/1\.\d+$/.test(e.envelope),
    JSON.stringify(e.envelope));
  check('the envelope says what was captured, where it came from and when',
    !!(e.subject && e.subject.kind === 'web-page' && e.subject.url && e.subject.title &&
       e.subject.capturedAt && e.createdAt),
    JSON.stringify(e.subject && { k: e.subject.kind, u: !!e.subject.url, t: !!e.subject.capturedAt }));
  /* The three sizes are three different questions and a model reasons with all
     of them: what fitted on screen at once, how big the thing really is, and
     how big the picture it is holding is. */
  check('...and all three sizes travel: viewport, content, image',
    !!(e.subject && e.subject.viewport && e.subject.viewport.dpr &&
       e.subject.content && e.subject.image) &&
    e.subject.content.h !== e.subject.image.h,
    JSON.stringify(e.subject && [e.subject.viewport, e.subject.content, e.subject.image]));
  check('the producing tool and its version travel with the payload',
    !!(e.producer && e.producer.tool === 'FullShot' && /^\d+\.\d+/.test(String(e.producer.version)) &&
       e.producer.surface),
    JSON.stringify(e.producer));
  /* Never a user agent: it carries the device model and the OS build, and this
     object is built to be handed to a stranger. The producer has to EXIST for
     the row to mean anything — the tier's first run passed this on {}. */
  check('...and never the user agent string',
    !!e.producer && Object.keys(e.producer).length >= 2 &&
    !/mozilla|applewebkit|chrome\//i.test(JSON.stringify(e.producer)),
    JSON.stringify(e.producer));
  check('every payload is described by a manifest row before anyone opens it',
    Array.isArray(e.contents) && e.contents.length > 0 &&
    e.contents.every(r => r.path && r.role && r.type),
    JSON.stringify(e.contents));
  check('an image row carries its own pixel size and its place in the whole',
    (e.contents || []).some(r => r.role === 'image' && r.w > 0 && r.h > 0 &&
      r.index === 1 && r.count >= 1 && r.fromY === 0 && typeof r.toY === 'number'),
    JSON.stringify((e.contents || []).filter(r => r.role === 'image')));
  /* An empty object round-trips perfectly, which is how this row passed on the
     first run. It has to round-trip a REAL bundle. */
  check('the bundle is plain JSON — it round-trips with nothing lost',
    Object.keys(e).length >= 6 &&
    safe(() => JSON.stringify(JSON.parse(JSON.stringify(e))) === JSON.stringify(e), false) &&
    !/undefined|\[object/.test(JSON.stringify(e)), Object.keys(e).length + ' top-level keys');
  check('the text payload leads with the context block, in a fixed order',
    typeof (env && env.text) === 'string' &&
    env.text.indexOf('Source:') > 0 &&
    env.text.indexOf('# ') === 0,
    JSON.stringify(String(env && env.text).slice(0, 60)));
  /* The payload is addressed to a model, not rendered as UI: it must read the
     same in every locale so a bundle built in one country parses in another. */
  check('...and the payload speaks one fixed language, not the user\'s',
    typeof (env && env.text) === 'string' &&
    /Source:/.test(env.text) && /Captured:/.test(env.text) &&
    !/data-i18n|fsMessage|getMessage/.test(builderRegion()),
    'no message lookup inside the builder');
  /* The payload's own vocabulary is ASCII, and the reason is not tidiness:
     "1280×3000" is a bidi-weak run, and the isolate characters that fix that
     on a page would be invisible junk inside a file a model reads. Removing
     the hazard beats annotating it. Text that came FROM the page is the user's
     own and travels in whatever script it was written in — which is why the
     fixture here is ASCII and the next check proves foreign text survives. */
  const frameOnly = safe(() => COMMON.fsAiBundle({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
    subject: { kind: 'web-page', mode: 'full', url: 'https://acme.example/orders',
      title: 'Orders', capturedAt: '2026-08-13T09:40:58.000Z',
      viewport: { w: 1280, h: 730, dpr: 1.25 }, content: { w: 1280, h: 2400 },
      image: { w: 1600, h: 3000 } },
    redactRequested: true, redactActs: ACTS(), reviewed: true,
    annotations: [{ type: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4 },
                  { type: 'rect', x: 1, y: 2, w: 3, h: 4 }],
    notes: ['Video is captured as painted.']
  }), null);
  check('the payload\'s own frame is ASCII, so it needs no encoding and cannot reverse',
    !!frameOnly && frameOnly.text.length > 80 &&
    !/[^\x09\x0a\x20-\x7e]/.test(frameOnly.text) &&
    !/[^\x09\x0a\x20-\x7e]/.test(JSON.stringify(frameOnly.envelope)),
    safe(() => ((frameOnly.text + JSON.stringify(frameOnly.envelope))
      .match(/[^\x09\x0a\x20-\x7e]/g) || []).join(' ') || 'ascii', ''));
  check('...while text that came from the page keeps its own script',
    safe(() => COMMON.fsAiBundle({
      producer: { tool: 'FullShot', version: '1', surface: 'x' },
      subject: { kind: 'web-page', mode: 'full', url: 'https://例え.example/',
        title: 'ページ全体のスクリーンショット', capturedAt: '2026-08-13T00:00:00.000Z',
        viewport: { w: 1, h: 1, dpr: 1 }, content: { w: 1, h: 1 }, image: { w: 1, h: 1 } },
      redactRequested: false
    }).text.indexOf('ページ全体のスクリーンショット') > 0, false), '');
  check('a context block ships even when there is no page-text sidecar',
    typeof (env && env.text) === 'string' && env.text.length > 80 &&
    (e.contents || []).some(r => r.role === 'text'),
    JSON.stringify((e.contents || []).map(r => r.role)));
}

console.log('\n=== INV-R: the redaction coupling ===');
{
  const input = () => ({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
    subject: {
      kind: 'web-page', mode: 'full',
      url: 'https://acme.example/orders?email=' + SECRET_EMAIL + '&session=' + SECRET_TOKEN,
      title: 'Orders for ' + SECRET_EMAIL,
      capturedAt: '2026-08-13T09:40:58.000Z',
      viewport: { w: 1280, h: 730, dpr: 1 }, content: { w: 1280, h: 2400 }, image: { w: 1280, h: 2400 }
    },
    redactRequested: true, redactActs: ACTS(), reviewed: true,
    pageText: [{ y: 10, kind: 'paragraph', text: 'Call ' + SECRET_PHONE + ' or write to ' + SECRET_EMAIL },
               { y: 90, kind: 'paragraph', text: 'Order ' + DECOY_CARD }],
    annotations: [{ type: 'text', x: 100, y: 200, text: 'ping ' + SECRET_EMAIL, color: '#f00', size: 20 }],
    notes: ['Video is captured as painted.']
  });
  const b = safe(() => COMMON.fsAiBundle(input()), null);
  const whole = safe(() => JSON.stringify(b.envelope) + '\n' + b.text, '');
  const red = (b && b.envelope && b.envelope.redaction) || {};
  const roles = new Set(((b && b.envelope && b.envelope.contents) || []).map(r => r.role));
  const surfaces = new Set(red.surfaces || []);

  /* ONE check, five conjuncts, ON PURPOSE. A text sidecar carrying the PII the
     image blacks out is worse than no redaction, because the user believes
     they are protected — so the claim has to be indivisible. Split into five
     checks, a change could land with four green and the fifth "known red";
     as one, either half of the implementation missing turns the row red. */
  const noSecret = whole.indexOf(SECRET_EMAIL) < 0 && whole.indexOf(SECRET_PHONE) < 0 &&
                   whole.indexOf(SECRET_TOKEN) < 0;
  const surfacesCover = [...roles].every(r => surfaces.has(r)) && surfaces.has('envelope');
  const marked = typeof (b && b.text) === 'string' && b.text.indexOf('[email]') >= 0;
  check('THE COUPLING: redaction requested AND text masked AND no member carries the secret',
    noSecret && red.requested === true && red.text === 'masked' && surfacesCover && marked,
    'noSecret=' + noSecret + ' requested=' + red.requested + ' text=' + red.text +
    ' surfaces=' + JSON.stringify([...surfaces]) + ' roles=' + JSON.stringify([...roles]) +
    ' marker=' + marked);

  check('the URL is text too — a session token in a query string is masked',
    typeof (b && b.envelope && b.envelope.subject.url) === 'string' &&
    b.envelope.subject.url.indexOf(SECRET_TOKEN) < 0 &&
    /\[token\]/.test(b.envelope.subject.url),
    JSON.stringify(b && b.envelope && b.envelope.subject.url));
  check('the page title is text too',
    typeof (b && b.envelope && b.envelope.subject.title) === 'string' &&
    b.envelope.subject.title.indexOf(SECRET_EMAIL) < 0,
    JSON.stringify(b && b.envelope && b.envelope.subject.title));
  check('an annotation the user typed is text too',
    typeof whole === 'string' && whole.indexOf(SECRET_EMAIL) < 0 && /ping \[email\]/.test(whole),
    safe(() => JSON.stringify(b.envelope.legend), 'no legend'));
  check('the marker names the kind, so a model still knows what was there',
    /\[email\]/.test(whole) && /\[phone\]/.test(whole) && /\[token\]/.test(whole),
    safe(() => JSON.stringify(red.kinds), ''));
  /* CONTROL. Over-masking is its own failure: a masker that eats a Luhn-invalid
     order number destroys the context the payload exists to carry. Same decoy
     the pixel tier's tokenredact scenario uses. */
  check('CONTROL: a Luhn-invalid order number survives verbatim',
    typeof whole === 'string' && whole.indexOf(DECOY_CARD) >= 0, DECOY_CARD);
  check('the honest limits are stated in the payload, not only in the docs',
    Array.isArray(red.notCovered) && red.notCovered.length >= 3 &&
    red.notCovered.join(' ').toLowerCase().indexOf('name') >= 0,
    JSON.stringify(red.notCovered));

  /* The builder must REFUSE, not degrade. Emitting the image alone would be a
     silent half: the user asked for a hand-off and would get one. */
  let refusal = '';
  let refused = false;
  try {
    const i = input();
    i.textAlreadyMasked = true;         // a lie: the caller claims masked, it is not
    COMMON.fsAiBundle(i);
  } catch (err) { refused = true; refusal = String(err && err.message || err); }
  /* The honest build above has to have SUCCEEDED for this to be a refusal
     rather than a function that does not exist — the tier's first run passed
     this row on exactly that. And the refusal must name itself, so a future
     TypeError cannot masquerade as the guard doing its job. */
  check('a caller that claims masked text and supplies raw text is refused, not trusted',
    !!b && refused && /FS_ENVELOPE_UNREDACTED/.test(refusal),
    (b ? '' : 'the honest build failed too — ') + (refusal || 'no throw'));

  /* Redaction off: nothing claims protection, and nothing is masked, so a URL
     holding a date does not come back as [phone]. Both halves off together is
     the other side of the same coupling. */
  const off = safe(() => COMMON.fsAiBundle({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
    subject: { kind: 'web-page', mode: 'full', url: 'https://acme.example/2026-08-13/report',
      title: 'Report', capturedAt: '2026-08-13T09:40:58.000Z',
      viewport: { w: 1280, h: 730, dpr: 1 }, content: { w: 1280, h: 900 }, image: { w: 1280, h: 900 } },
    redactRequested: false
  }), null);
  check('CONTROL: with redaction off the envelope claims nothing and masks nothing',
    !!off && off.envelope.redaction.requested === false && off.envelope.redaction.text === 'none' &&
    off.envelope.subject.url.indexOf('2026-08-13') >= 0,
    safe(() => off.envelope.subject.url, ''));

  /* The detector that masks the text must be the detector that boxed the
     pixels. Two copies that "agree" are two copies that will disagree after
     the next edit to one of them, so they are pinned to each other here. */
  const capSrc = read('content/capture.js');
  const comSrc = read('pages/common.js');
  const grab = src => (src.match(/push\(\/[^\n]*?\/g,\s*'(?:email|ssn|token|card|phone)'/g) || [])
    .map(s => s.replace(/\s+/g, ' '));
  const capPats = grab(capSrc), comPats = grab(comSrc);
  check('the text masker uses the same patterns that bake the pixels',
    capPats.length === 5 && comPats.length === 5 &&
    capPats.join('\n') === comPats.join('\n'),
    'capture.js ' + capPats.length + ' / common.js ' + comPats.length);
  check('...including the Luhn check, which is the difference between a card and an order number',
    /function fsAiLuhnOk|fsLuhnOk/.test(comSrc) &&
    safe(() => COMMON.fsAiPiiSpans('pay 4111 1111 1111 1111 now').some(s => s.kind === 'card'), false) &&
    safe(() => !COMMON.fsAiPiiSpans('order ' + DECOY_CARD).some(s => s.kind === 'card'), false),
    'valid masked, invalid kept');
}

console.log('\n=== the fit: what a model consumer will accept ===');
{
  const P = safe(() => COMMON.FS_AI_PROFILES, {});
  const fit = (w, h, o) => safe(() => COMMON.fsAiFitDims(w, h, o), {});
  /* A routine tall capture: 19.2 MP is UNDER the old area-only threshold, so
     today it is copied untouched at 15000px tall. The long edge is what
     consumers actually limit. */
  const tall = fit(1280, 15000, { maxEdge: 1568, maxArea: 1.15e6, minScale: 0.05 });
  /* The claim is that the long edge is a criterion AT ALL, which is what was
     missing — not that it is applied first. The two clamps are independent and
     the binding one wins whichever order they are written in, proved by a
     teeth injection that swapped them and reddened nothing. */
  check('the long edge is a criterion, not just the area — a 1280x15000 strip is not left untouched',
    tall.h === 1568 && tall.w < 1280 && tall.scale < 1 && tall.limitedBy != null,
    JSON.stringify(tall));
  const wide = fit(4000, 4000, { maxEdge: 8000, maxArea: 1.15e6, minScale: 0.05 });
  check('...then the area, for something inside the edge limit but too big',
    wide.w * wide.h <= 1.15e6 + 2 && wide.scale < 1 && wide.limitedBy === 'area',
    JSON.stringify(wide));
  const small = fit(800, 600, { maxEdge: 1568, maxArea: 1.15e6, minScale: 0.5 });
  check('an image already inside both limits is returned untouched',
    small.w === 800 && small.h === 600 && small.scale === 1 &&
    small.limitedBy === null && small.needsTiling === false, JSON.stringify(small));
  const tiny = fit(40, 30, { maxEdge: 1568, maxArea: 1.15e6, minScale: 0.5 });
  check('...and nothing is ever upscaled to fill the limit',
    tiny.w === 40 && tiny.h === 30 && tiny.scale === 1, JSON.stringify(tiny));
  /* The legibility floor. A picture of unreadable text is worse than no
     picture, so below the floor the answer is tiles, not a squash. */
  const huge = fit(1280, 60000, { maxEdge: 1568, maxArea: 1.15e6, minScale: 0.5 });
  check('below the legibility floor it asks for tiles instead of squashing the type',
    huge.needsTiling === true && huge.scale >= 0.5,
    JSON.stringify(huge));
  check('the fit says WHY it shrank, so a surface can explain the number',
    tall.limitedBy === 'edge' && wide.limitedBy === 'area' && small.limitedBy === null,
    [tall.limitedBy, wide.limitedBy, small.limitedBy].join(','));
  check('a declared, dated profile table is the single place the limits live',
    !!P.safe && P.safe.maxEdge > 0 && P.safe.maxArea > 0 &&
    /^\d{4}-\d{2}$/.test(String(P.safe.asOf)) &&
    Object.keys(P).every(k => /^\d{4}-\d{2}$/.test(String(P[k].asOf))),
    JSON.stringify(Object.keys(P)));
  check('...and it is marked as hand-maintained where the next reader will see it',
    /moving target|maintained by hand|hand-maintained/i.test(
      (read('pages/common.js').split('FS_AI_PROFILES')[0] || '').slice(-1400)), '');
}

/* ============================================================================
   THE VENDOR LIMIT TABLE
   The defect these rows exist for: pages/result.js clamps a stitched canvas at
   MAX_DIM = 16000 px, and the consumer this product exists to feed documents a
   HARD maximum of 8000x8000 px per image, beyond which the request fails with a
   validation error instead of being downscaled. A soft "fit target" and a hard
   "reject ceiling" are different facts and the table only ever carried the
   first, so nothing in the code knew that a number existed past which the paste
   does not shrink — it fails.

   Three vendors, three arithmetics, three sets of published numbers, so the
   rows are graded against the vendors' OWN published tables rather than against
   a number somebody once believed.
   ========================================================================== */
console.log('\n=== the limit table: numbers somebody read, from a document, on a date ===');
{
  const P = safe(() => COMMON.FS_AI_PROFILES, {});
  const rows = Object.keys(P);
  check('every row names the document it was read from and the month it was read',
    rows.length >= 4 && rows.every(k => typeof P[k].source === 'string' && P[k].source.length > 8 &&
      /^\d{4}-\d{2}$/.test(String(P[k].asOf))),
    rows.map(k => k + '@' + safe(() => P[k].asOf, '?')).join(' ') || 'no rows');
  check('the three vendors are three rows, because their arithmetic genuinely differs',
    !!(P.claude && P.openai && P.gemini) &&
    new Set([P.claude.rule, P.openai.rule, P.gemini.rule]).size === 3,
    safe(() => [P.claude.rule, P.openai.rule, P.gemini.rule].join(','), 'rows missing'));
  check('a REJECT ceiling is recorded, and it is not the same number as the fit target',
    !!P.claude && P.claude.hardMaxEdge === 8000 &&
    P.claude.maxEdge > 0 && P.claude.maxEdge < P.claude.hardMaxEdge,
    safe(() => P.claude.maxEdge + ' fit / ' + P.claude.hardMaxEdge + ' reject', 'no claude row'));
  /* THE DEFECT, stated as a check. The page's own canvas ceiling is twice the
     reject ceiling, which is exactly why the AI path cannot inherit it. */
  const md = Number((read('pages/result.js').match(/MAX_DIM\s*=\s*(\d+)/) || [])[1]);
  /* `> 0` on both sides, never a bare comparison: `16000 > null` is true, so a
     row that simply lost its ceiling would slip past this and past the row
     below it. Found by the teeth pass — removing safe.hardMaxEdge reddened one
     check where it should have reddened three. */
  check("the page's own canvas ceiling is ABOVE the reject ceiling — which is why the AI path needs its own",
    md > 0 && !!P.safe && P.safe.hardMaxEdge > 0 && md > P.safe.hardMaxEdge,
    md + ' px canvas / ' + safe(() => P.safe.hardMaxEdge, '?') + ' px reject');
  check('the default satisfies every row in the table, so the common case needs no choice',
    !!P.safe && P.safe.maxEdge > 0 && P.safe.hardMaxEdge > 0 &&
    rows.filter(k => k !== 'safe').every(k =>
      P.safe.maxEdge <= (P[k].hardMaxEdge > 0 ? P[k].hardMaxEdge : Infinity) &&
      P.safe.maxEdge <= (P[k].maxEdge > 0 ? P[k].maxEdge : Infinity) &&
      P.safe.hardMaxEdge <= (P[k].hardMaxEdge > 0 ? P[k].hardMaxEdge : Infinity)),
    safe(() => P.safe.maxEdge + ' fit / ' + P.safe.hardMaxEdge + ' reject', 'no safe row'));
  /* Nothing may leave this code above the ceiling — not the image, and not a
     piece of the plan the bundle tells a consumer to render. The tile plan is
     where this actually bites: a tile row is a full-width band, so a plan for a
     16000px-wide capture describes 16000px-wide images. */
  const shapes = [[1280, 900], [1280, 18750], [16000, 900], [16000, 40000], [3200, 60000]];
  const over = [];
  const hard = safe(() => P.safe.hardMaxEdge, 0);
  if (!(hard > 0)) over.push('the default row declares no reject ceiling to stay under');
  for (const [w, h] of shapes) {
    const b = safe(() => COMMON.fsAiBundle({
      producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
      subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
        capturedAt: '2026-08-13T00:00:00.000Z', image: { w, h } },
      redactRequested: false
    }), null);
    if (!b || !b.envelope) { over.push(w + 'x' + h + ': the builder threw'); continue; }
    const img = b.envelope.contents[0] || {};
    if (hard > 0 && (img.w > hard || img.h > hard)) over.push('image ' + img.w + 'x' + img.h);
    const plan = safe(() => COMMON.fsAiPlanTiles({ w, h, maxEdge: P.safe.maxEdge,
      maxArea: P.safe.maxArea, hardMaxEdge: hard, overlap: 64 }), {});
    if (!(plan.tileW > 0 && plan.tileH > 0)) over.push(w + 'x' + h + ': the plan does not say how big a tile is');
    else if (hard > 0 && (plan.tileW > hard || plan.tileH > hard)) over.push('tile ' + plan.tileW + 'x' + plan.tileH);
  }
  check('nothing the AI path emits — the image or a piece of the plan — is above the reject ceiling',
    over.length === 0, over.slice(0, 4).join(' | ') || shapes.length + ' shapes');
  /* Not only under the REJECT ceiling: a tile is an image, so it obeys §6's two
     criteria like any other. A full-width band of a 3200px-wide capture is
     legal for every vendor and still twice the size the consumer will keep,
     which is bytes spent to be thrown away and a token estimate computed for a
     picture nobody receives. */
  const widePlan = safe(() => COMMON.fsAiPlanTiles({ w: 3200, h: 40000, maxEdge: P.safe.maxEdge,
    maxArea: P.safe.maxArea, hardMaxEdge: P.safe.hardMaxEdge, overlap: 64 }), {});
  check('a tile is an image, so it obeys the fit target on BOTH axes and the area with it',
    widePlan.tileW === P.safe.maxEdge && widePlan.tileH > 0 &&
    widePlan.tileH <= P.safe.maxEdge && widePlan.tileW * widePlan.tileH <= P.safe.maxArea &&
    widePlan.scale > 0 && widePlan.scale < 1,
    JSON.stringify({ tileW: widePlan.tileW, tileH: widePlan.tileH, scale: widePlan.scale }));
  check('the builder refuses rather than hand over something the consumer would reject',
    /FS_ENVELOPE_OVERSIZE/.test(read('pages/common.js')), 'a second gate beside INV-R');
  /* The one thing nobody has measured. The rows are the documented API limits;
     what claude.ai, chatgpt.com and gemini.google.com do to an image dropped
     into the web UI is unknown, and a table that did not say so would be read
     as if it had been measured. */
  const preamble = (read('pages/common.js').split('FS_AI_PROFILES')[0] || '').slice(-2600);
  check('the table says plainly that the PASTE path is unverified, beside the numbers that are not',
    /paste|web ui|chat ui/i.test(preamble) &&
    /unverified|not been measured|nobody has measured|has not been measured/i.test(preamble), '');
}

/* ============================================================================
   THE CLAMP, ON EVERY ROW — NOT JUST THE ROW THAT HAPPENED TO HAVE A NUMBER

   The defect this block exists for is the redaction-claim bug wearing a
   different hat: a guard that reads as though it applies and does not.

   `openai` and `gemini` declared `maxEdge: null, maxArea: null,
   hardMaxEdge: null`. fsAiFitDims turns each null into Infinity, so both rows
   returned the capture UNTOUCHED — a 16000x40000 stitched canvas came back out
   of the builder as a 16000x40000 image at scale 1, no tiling, no fit note. And
   the oversize gate, guarded by `if (P.hardMaxEdge > 0)`, did not run at all for
   exactly those two rows, so nothing downstream noticed. The payload told the
   reader "at most null px on the long edge, rejected outright above null px".

   The nulls were not a transcription slip — they were an honest statement that
   neither vendor documents a REJECT threshold, which is still true. What was
   wrong is that "documents no reject threshold" was read as "documents no
   geometry", and both vendors do document geometry: OpenAI a 2048 px pixel-
   dimension limit and a patch budget, Google a 3072x3072 resolution box. A fit
   target and a reject ceiling are two different facts, and a row is allowed to
   have only the first — it is not allowed to have neither.

   EVERY CHECK BELOW LOOPS OVER Object.keys(FS_AI_PROFILES), never over a list of
   names, and that is the point of the block rather than an incidental style
   choice. The fourth vendor row somebody adds next year is graded the day it
   lands, without anyone remembering to come back here — which is the only
   version of this protection that survives the person who wrote it.
   ========================================================================== */
console.log('\n=== the clamp: every row, no exceptions ===');
{
  const P = safe(() => COMMON.FS_AI_PROFILES, {});
  const rows = Object.keys(P);
  const ceil = r => safe(() => COMMON.fsAiRowCeiling(P[r]), 0);

  /* THE CHECK THE TASK EXISTS FOR. Not "openai has a clamp" and not "gemini has
     a clamp" — those are two assertions that go stale the moment a fifth row
     appears. This is the universally quantified one. */
  const noClamp = rows.filter(r => !(ceil(r) > 0));
  check('EVERY row in the table declares a geometry clamp — a row without one is the whole defect',
    rows.length >= 4 && noClamp.length === 0,
    noClamp.length ? 'NO CLAMP ON: ' + noClamp.join(', ')
                   : rows.map(r => r + ' <=' + ceil(r) + 'px').join('  '));

  /* The ceiling function is PURE and TOTAL, and its answer for a row shape it
     has never seen is 0 — "this row declares no clamp" — never Infinity and
     never NaN. Infinity would make an unclamped row look clamped to every
     `> ceiling` comparison downstream, which is how the original guard managed
     to be wrong while looking right. */
  check('...and the ceiling of a row that declares nothing is 0, never Infinity and never NaN',
    safe(() => COMMON.fsAiRowCeiling({}), 'threw') === 0 &&
    safe(() => COMMON.fsAiRowCeiling(null), 'threw') === 0 &&
    safe(() => COMMON.fsAiRowCeiling(undefined), 'threw') === 0 &&
    safe(() => COMMON.fsAiRowCeiling({ maxEdge: 0, hardMaxEdge: null }), 'threw') === 0 &&
    safe(() => COMMON.fsAiRowCeiling({ maxEdge: null, hardMaxEdge: 8000 }), 'threw') === 8000 &&
    safe(() => COMMON.fsAiRowCeiling({ maxEdge: 1568, hardMaxEdge: 8000 }), 'threw') === 1568,
    [safe(() => COMMON.fsAiRowCeiling({}), 'threw'),
     safe(() => COMMON.fsAiRowCeiling({ maxEdge: null, hardMaxEdge: 8000 }), 'threw'),
     safe(() => COMMON.fsAiRowCeiling({ maxEdge: 1568, hardMaxEdge: 8000 }), 'threw')].join(' / ') +
    '  want 0/8000/1568');

  /* THE CEILINGS THEMSELVES, PINNED TO WHAT THE DOCUMENTS SAY.
     Every other check in this block grades a row against its OWN declared
     ceiling, and that family of check is self-referential by construction: a
     row that declares 999999 px satisfies all of them and clamps nothing. So
     the three vendor numbers are pinned here the way the token table already
     pins the three arithmetics, and for the same reason — a transcription slip
     reddens instead of shipping.

     Named by vendor, deliberately, because these ARE that vendor's numbers:
       claude 1568 fit / 8000 reject — platform.claude.com/docs/en/build-with-
         claude/vision, "The maximum dimensions per image are 8000x8000 px", and
         the standard resolution tier's 1568 px long edge.
       openai 2048, no reject — developers.openai.com/api/docs/guides/images-
         vision, the pixel-dimension limit at `detail: high`, which the tile-
         based models restate as a 2048x2048 square. Oversized images are
         resized, never refused.
       gemini 3072, no reject — Google's stated resolution box, "scaled down and
         padded to fit a maximum resolution of 3072 x 3072".
     All three re-read 2026-08-13. */
  const pinned = { claude: [1568, 8000], openai: [2048, null], gemini: [3072, null] };
  const wrong = [];
  for (const r of Object.keys(pinned)) {
    const want = pinned[r], got = safe(() => P[r], null);
    if (!got) { wrong.push(r + ': row missing'); continue; }
    if (ceil(r) !== want[0]) wrong.push(r + ' ceiling ' + ceil(r) + ', document says ' + want[0]);
    const hard = got.hardMaxEdge > 0 ? got.hardMaxEdge : null;
    if (hard !== want[1]) wrong.push(r + ' reject ' + hard + ', document says ' + want[1]);
  }
  check('each vendor ceiling is the number in that vendor\'s document, not merely a number',
    wrong.length === 0, wrong.join(' | ') ||
    Object.keys(pinned).map(r => r + ' ' + ceil(r) + '/' + (P[r] && P[r].hardMaxEdge > 0 ? P[r].hardMaxEdge : 'no reject')).join('  '));

  /* And the same question for the row the pins cannot cover: the fourth vendor.
     A flat sanity bound, because a ceiling nobody has read is more likely to be
     a typo than a real limit — 8192 sits above every number documented anywhere
     in this family (Claude's 8000 px reject is the largest), so a row above it
     is either a slip or a vendor change that needs a human, and both should
     stop the build rather than quietly widen the clamp. */
  const absurd = rows.filter(r => ceil(r) > 8192 || ceil(r) < 384);
  check('...and no row claims a ceiling nobody has read — the fourth vendor is bounded too',
    absurd.length === 0,
    absurd.map(r => r + ' <=' + ceil(r) + 'px').join(', ') || 'all within 384..8192');

  /* THE BEHAVIOURAL HALF. A number in the table that no code path reads is a
     comment. Every row is driven through the real builder at four shapes the
     stitcher can genuinely produce, and both the image it emits AND the tile it
     tells a consumer to render must land at or under that row's own ceiling. */
  const shapes = [[1280, 900], [1280, 18750], [16000, 40000], [3200, 60000]];
  const bad = [];
  for (const r of rows) {
    const lim = ceil(r);
    if (!(lim > 0)) { bad.push(r + ': no ceiling to measure against'); continue; }
    for (const [w, h] of shapes) {
      const b = safe(() => COMMON.fsAiBundle({
        producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
        subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
          capturedAt: '2026-08-13T00:00:00.000Z', image: { w, h } },
        redactRequested: false, profile: r
      }), null);
      if (!b || !b.envelope) { bad.push(r + ' ' + w + 'x' + h + ': the builder threw'); continue; }
      const img = b.envelope.contents[0] || {};
      if (img.w > lim || img.h > lim) bad.push(r + ' ' + w + 'x' + h + ' -> image ' + img.w + 'x' + img.h + ' > ' + lim);
      const plan = safe(() => COMMON.fsAiPlanTiles({ w, h, maxEdge: P[r].maxEdge,
        maxArea: P[r].maxArea, hardMaxEdge: P[r].hardMaxEdge, overlap: 64 }), {});
      if (!(plan.tileW > 0 && plan.tileH > 0)) bad.push(r + ' ' + w + 'x' + h + ': the plan does not say how big a tile is');
      else if (plan.tileW > lim || plan.tileH > lim) bad.push(r + ' tile ' + plan.tileW + 'x' + plan.tileH + ' > ' + lim);
    }
  }
  check('...and the clamp actually BINDS on every row — nothing any row emits is above its own ceiling',
    bad.length === 0, bad.slice(0, 5).join(' | ') || rows.length + ' rows x ' + shapes.length + ' shapes');

  /* A clamp that never fires on a 16000x40000 capture is not a clamp. The check
     above would be satisfied by a row whose ceiling is 99999, so this one says
     the giant shape came back SMALLER — either scaled or tiled. */
  const untouched = [];
  for (const r of rows) {
    const b = safe(() => COMMON.fsAiBundle({
      producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
      subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
        capturedAt: '2026-08-13T00:00:00.000Z', image: { w: 16000, h: 40000 } },
      redactRequested: false, profile: r
    }), null);
    const f = b && b.envelope && b.envelope.budget && b.envelope.budget.fit;
    if (!f) { untouched.push(r + ': no fit'); continue; }
    if (!(f.scale < 1)) untouched.push(r + ': scale ' + f.scale + ' on a 16000x40000 capture');
    if (!f.needsTiling) untouched.push(r + ': 16000x40000 not tiled');
    if (!f.limitedBy) untouched.push(r + ': shrank without saying why');
  }
  check('...and a 16000x40000 capture is shrunk AND tiled on every row, with a reason recorded',
    untouched.length === 0, untouched.slice(0, 5).join(' | ') || rows.length + ' rows');

  /* THE GATE. The two checks above cannot see this one, and that is worth
     stating rather than assuming: with a consistent table the fit already keeps
     every emission legal, so the gate never fires and a gate that was skipped
     entirely would grade identically. The gate exists for the INCONSISTENT
     table — a row edited to a maxEdge above its hardMaxEdge, a row that loses
     its clamp — and the only two instruments that can see it are the source and
     the teeth pass. Both are used; the teeth pass is in the session notes.

     The claim: the gate's guard is derived from the ROW'S CEILING, computed by
     the one exported function every check here uses, and is NOT keyed to
     `hardMaxEdge` — which is precisely the guard that exempted two of four
     rows while reading as though it protected all of them. */
  const gateSrc = (() => {
    const c = stripComments(read('pages/common.js'));
    const end = c.indexOf('FS_ENVELOPE_OVERSIZE');
    if (end < 0) return '';
    const start = c.lastIndexOf('FS_ENVELOPE_UNREDACTED', end);
    return start < 0 ? c.slice(Math.max(0, end - 900), end) : c.slice(start, end);
  })();
  check('the oversize gate is keyed to the row CEILING, not to a reject threshold two rows do not have',
    gateSrc.length > 0 && /fsAiRowCeiling/.test(gateSrc) && !/hardMaxEdge/.test(gateSrc),
    gateSrc.length ? (/fsAiRowCeiling/.test(gateSrc) ? 'ceiling' : 'NO ceiling') + ' / ' +
      (/hardMaxEdge/.test(gateSrc) ? 'STILL keyed to hardMaxEdge' : 'not keyed to hardMaxEdge')
      : 'gate region not found');
  /* REFUSE, DO NOT DEGRADE — the same doctrine as INV-R and the evidence gate.
     A row with no clamp is an unshippable table state, so the builder must
     throw rather than hand over an image it cannot vouch for. Silently emitting
     the capture at full size is what it did before, and it is the worst of the
     three options because it looks like success. */
  check('...and a row that declares no clamp is REFUSED by name, not waved through',
    /FS_ENVELOPE_NOCLAMP/.test(read('pages/common.js')) && /FS_ENVELOPE_NOCLAMP/.test(gateSrc),
    /FS_ENVELOPE_NOCLAMP/.test(gateSrc) ? 'thrown at the gate' : 'no refusal at the gate');

  /* THE SENTENCE THE READER GETS. `maxEdge: null` printed straight into the
     payload as the word "null", and a note that says "at most null px on the
     long edge, rejected outright above null px" is worse than no note: it is a
     limit claim that cannot be true, in the one artefact a model reads. Two
     rows document no reject threshold, so the note must not promise one — and
     must not print a JavaScript value's name at a person either. */
  const notes = [];
  for (const r of rows) {
    const b = safe(() => COMMON.fsAiBundle({
      producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
      subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
        capturedAt: '2026-08-13T00:00:00.000Z', image: { w: 1280, h: 900 } },
      redactRequested: false, profile: r
    }), null);
    const all = (b && b.envelope && b.envelope.notes) || [];
    const line = all.filter(s => /Image limits/.test(s))[0] || '';
    if (!line) { notes.push(r + ': no limits note'); continue; }
    if (/\bnull\b|\bundefined\b|\bNaN\b/.test(line)) notes.push(r + ': "' + line.slice(0, 90) + '"');
    if (line.indexOf(String(ceil(r))) < 0) notes.push(r + ': note does not carry its own ceiling ' + ceil(r));
    /* Only a row that documents a reject threshold may claim one, and it must
       name the right number. Matched on the affirmative CLAIM rather than on
       the word "reject", because the sentence a no-reject row is required to
       carry contains that word too — grading the vocabulary instead of the
       assertion is how a check ends up agreeing with both answers. */
    const hard = safe(() => P[r].hardMaxEdge, null);
    const claim = /rejected outright above (\d+) ?px/i.exec(line);
    if (!(hard > 0) && claim) notes.push(r + ': claims a reject threshold it does not document');
    if (hard > 0 && !claim) notes.push(r + ': documents a reject threshold and does not say so');
    if (hard > 0 && claim && Number(claim[1]) !== hard) notes.push(r + ': names ' + claim[1] + ', documents ' + hard);
    /* And the absence is stated, not merely omitted. A reader given a fit
       target and nothing else assumes there is a cliff past it. */
    if (!(hard > 0) && !/no reject threshold is documented/i.test(line)) {
      notes.push(r + ': silent about having no reject threshold');
    }
  }
  check('the limits note is true on every row — no "null px", and only a documented reject is called one',
    notes.length === 0, notes.slice(0, 4).join(' | ') || rows.length + ' notes');
}

console.log('\n=== the arithmetic, against each vendor\'s own published table ===');
{
  const n = (w, h, p) => safe(() => COMMON.fsAiTokenCount(w, h, p), -1);
  /* platform.claude.com/docs/en/build-with-claude/vision, "Resolution and token
     cost", read 2026-08: one visual token per 28x28 patch, and the published
     table gives 200x200 -> 64, 1000x1000 -> 1296, 1092x1092 -> 1521, and a
     1920x1080 downsized to 1456x819 -> 1560. Four independent datapoints from
     the vendor, so the row cannot be "close enough". */
  check('the Claude row reproduces every row of the published token table',
    n(200, 200, 'claude') === 64 && n(1000, 1000, 'claude') === 1296 &&
    n(1092, 1092, 'claude') === 1521 && n(1456, 819, 'claude') === 1560,
    [n(200, 200, 'claude'), n(1000, 1000, 'claude'), n(1092, 1092, 'claude'),
     n(1456, 819, 'claude')].join(' / ') + '  want 64/1296/1521/1560');
  check('...and it stops at the tier budget, because past it the consumer downscales rather than charging on',
    n(3840, 2160, 'claude') === 1568, String(n(3840, 2160, 'claude')) + '  want 1568');
  /* developers.openai.com/api/docs/guides/images-vision, read 2026-08:
     ceil(w/32) * ceil(h/32) patches, capped at the smallest documented budget. */
  check('the OpenAI row counts 32px patches and stops at its own budget',
    n(1024, 1024, 'openai') === 1024 && n(8000, 8000, 'openai') === 1536,
    n(1024, 1024, 'openai') + ' / ' + n(8000, 8000, 'openai') + '  want 1024/1536');
  /* ai.google.dev/gemini-api/docs/image-understanding, read 2026-08: 258 tokens
     when both sides are <= 384 px, else 768px tiles at 258 each, counted with
     the documented crop unit floor(min(w,h)/1.5). Its own worked example is
     960x540 -> 6 tiles. */
  check('the Gemini row reproduces the published 960x540 example, six tiles at 258',
    n(960, 540, 'gemini') === 1548 && n(300, 300, 'gemini') === 258,
    n(960, 540, 'gemini') + ' / ' + n(300, 300, 'gemini') + '  want 1548/258');
  check('the default quotes ONE stamped rule, and the table is where a second vendor\'s number comes from',
    safe(() => COMMON.fsAiTokens(1092, 1092, 'safe').rule, '') === 'patches-28' &&
    n(1092, 1092, 'safe') === n(1092, 1092, 'claude') &&
    n(1092, 1092, 'gemini') !== n(1092, 1092, 'claude'),
    safe(() => COMMON.fsAiTokens(1092, 1092, 'safe').rule, '?') + ': ' +
    ['safe', 'claude', 'openai', 'gemini'].map(k => k + ' ' + n(1092, 1092, k)).join(', '));
}

console.log('\n=== the budget: what a paste costs, before it is made ===');
{
  const t = safe(() => COMMON.fsAiTokens(1092, 1568, 'safe'), {});
  check('the estimate is stamped with the rule that produced it and the date it was checked',
    typeof t.estimate === 'number' && t.estimate > 0 &&
    typeof t.rule === 'string' && /^\d{4}-\d{2}$/.test(String(t.asOf)),
    JSON.stringify(t));
  check('no path claims the estimate is exact',
    t.exact === false && !/exact:\s*true/.test(stripComments(read('pages/common.js'))), JSON.stringify(t.exact));
  /* A precise-looking number from an imprecise rule is a lie told by
     formatting. Two significant figures, always. */
  const round2 = n => { const s = String(n); return /^[1-9][0-9]?0*$/.test(s) || n < 10; };
  check('the number is rounded so it cannot look more precise than it is',
    round2(t.estimate) && round2(safe(() => COMMON.fsAiTokens(1280, 15000, 'safe').estimate, 0)),
    t.estimate + ' / ' + safe(() => COMMON.fsAiTokens(1280, 15000, 'safe').estimate, '?'));
  check('the tile-counting rule is available beside the patch rule',
    safe(() => COMMON.fsAiTokens(1024, 1024, 'gemini').rule, '') === 'tiles-768' &&
    safe(() => COMMON.fsAiTokens(1024, 1024, 'gemini').estimate, 0) > 0,
    JSON.stringify(safe(() => COMMON.fsAiTokens(1024, 1024, 'gemini'), {})));
  /* The cost the user is quoted must be the cost of what is actually sent. */
  const b = safe(() => COMMON.fsAiBundle({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'x' },
    subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
      capturedAt: '2026-08-13T00:00:00.000Z', viewport: { w: 1280, h: 730, dpr: 1 },
      content: { w: 1280, h: 15000 }, image: { w: 1280, h: 15000 } },
    redactRequested: false
  }), null);
  const bud = (b && b.envelope && b.envelope.budget) || {};
  check('the quoted cost is the cost of the FITTED image, not of the source',
    !!bud.fit && bud.fit.h < 15000 &&
    safe(() => bud.tokens.estimate === COMMON.fsAiTokens(bud.fit.w, bud.fit.h, bud.profile).estimate, false),
    JSON.stringify(bud));
  check('...and the user can read it before pasting, in the payload\'s own words',
    typeof (b && b.text) === 'string' && /tokens/i.test(b.text) &&
    b.text.indexOf(String(bud.tokens && bud.tokens.rule)) > 0,
    safe(() => b.text.split('\n').filter(l => /token/i.test(l)).join(' | '), ''));
}

/* ============================================================================
   WHICH HAPPENED, AND WHY — told to the person, before the paste.
   A capture that is downscaled and a capture that can only travel as a reduced
   overview are two different things, and until now the page said neither. The
   worst of the two is the silent one: the user presses Copy on a 12000px page,
   gets a 167x1568 thumbnail on the clipboard, pastes it, and the model cannot
   read a word of it — with nothing anywhere having said so.
   ========================================================================== */
console.log('\n=== what the user is told before the paste ===');
{
  const lightBlob = (w, h) => ({ __w: w, __h: h, size: 4096, type: 'image/png' });
  /* 1280x12000: past the legibility floor, so the only thing a clipboard can
     hold is an overview. One segment, so the per-part row is not in the way. */
  const tall = await safeAsync(() => bootResult({ shot: makeShot({
    w: 1280, h: 12000,
    segments: [{ blob: lightBlob(1280, 12000), w: 1280, h: 12000 }]
  }) }));
  const tip = safe(() => tall.doc.getElementById('copyBtn').getAttribute('title'), '') || '';
  check('the copy button quotes the cost AND what is about to happen to the image',
    /tokens/.test(tip) && /->/.test(tip) && /tiles=\d+/.test(tip),
    JSON.stringify(tip));
  /* §2.2 — the overview notice MOVED from a toast into the review dialog,
     where the reduction it warns about is visible. A toast fired at render is
     gone by the time the decision is made; the dialog is the decision. */
  /* Real pixels, because this one is actually composed: 40x4000 is past the
     legibility floor on every row (1568/4000 = 0.39, under minScale 0.5) and is
     640 KB rather than the 61 MB a 1280x12000 buffer would be. */
  const tallRed = await safeAsync(() => bootResult({ shot: makeShot({
    w: 40, h: 4000, id: 'tall-red',
    segments: [{ blob: fakeBlob(40, 4000), w: 40, h: 4000 }],
    redaction: { v: 3, requested: true, kinds: {}, marks: [],
                 acts: { v: 4, matched: 0, painted: 0, verifiedOpaque: 0,
                         matchedComplete: true, walkComplete: true, truncatedBy: null,
                         textRefused: 0, blocksLost: 0, blocksUnpainted: 0, blocksUnread: 0,
                         ledger: 'present' } }
  }) }));
  await clickCopy(tallRed, { cancel: true });
  check('a capture that can only be pasted as an overview says so, in the dialog',
    safe(() => /overview/i.test(String(tallRed.doc.getElementById('reviewReduced').textContent)), false),
    safe(() => String(tallRed.doc.getElementById('reviewReduced').textContent).slice(0, 120), ''));
  check('...and it is NOT a toast fired at render, where the decision is not being made',
    safe(() => !tall.toasts.some(t => /overview/i.test(String(t))), false),
    JSON.stringify(safe(() => tall.toasts, [])));
  /* CONTROL. Almost every full-page capture is downscaled — a caveat on all of
     them is a caveat on none — so the ordinary case is quoted on the button and
     is NOT toasted about. */
  const ord = await safeAsync(() => bootResult({ shot: makeShot() }));
  const tip2 = safe(() => ord.doc.getElementById('copyBtn').getAttribute('title'), '') || '';
  check('CONTROL: an ordinary downscale is quoted on the button and NOT toasted about',
    /limitedBy=edge/.test(tip2) && /tiles=/.test(tip2) === false &&
    safe(() => !ord.toasts.some(t => /overview/i.test(String(t))), false),
    JSON.stringify(tip2) + ' | ' + JSON.stringify(safe(() => ord.toasts, [])));
  /* And the same distinction in the payload, for the reader who has only the
     bundle. Two different situations must not produce the same sentence. */
  const notesFor = (w, h) => safe(() => COMMON.fsAiBundle({
    producer: { tool: 'FullShot', version: '1.10.1', surface: 'chrome-extension' },
    subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'x',
      capturedAt: '2026-08-13T00:00:00.000Z', image: { w, h } },
    redactRequested: false
  }).envelope.notes.join('\n'), '');
  const nTall = notesFor(1280, 18750), nMid = notesFor(1280, 3000), nSmall = notesFor(800, 600);
  check('the bundle says in words which of the two happened, and says it differently',
    /overview/i.test(nTall) && !/overview/i.test(nMid) &&
    /downscal/i.test(nMid) && !/downscal/i.test(nSmall),
    [/overview/i.test(nTall), /downscal/i.test(nMid), /downscal/i.test(nSmall)].join(','));
  check('...and the payload records that the limits are the documented API limits, not a measured paste',
    /unverified|not been measured/i.test(nTall + nMid + nSmall) &&
    /documented/i.test(nTall + nMid + nSmall),
    JSON.stringify(nSmall.split('\n').filter(l => /documented|measured/i.test(l))));
}

console.log('\n=== tiles: a tall capture in model-sized pieces ===');
{
  const plan = safe(() => COMMON.fsAiPlanTiles({
    w: 1280, h: 10000, maxEdge: 1568, overlap: 64,
    breakYs: [1400, 2800, 4200, 5600, 7000, 8400, 9800], minTile: 400
  }), {});
  const tiles = plan.tiles || [];
  check('every row of the plan knows its index, its count and where it sits',
    tiles.length > 1 && tiles.every((t, i) => t.index === i + 1 && t.count === tiles.length &&
      typeof t.fromY === 'number' && typeof t.toY === 'number'),
    tiles.length + ' tiles');
  /* Coverage: the union has to be the whole image. A gap is a paragraph the
     model never sees and cannot know it never saw. */
  const covered = tiles.length > 0 && tiles[0].fromY === 0 &&
    tiles[tiles.length - 1].toY === 10000 &&
    tiles.every((t, i) => i === 0 || t.fromY <= tiles[i - 1].toY);
  check('the tiles cover the whole image with no gap', covered,
    JSON.stringify(tiles.map(t => [t.fromY, t.toY])));
  check('consecutive tiles share the overlap band, so a cut line survives whole',
    tiles.length > 1 && tiles.slice(1).every((t, i) => tiles[i].toY - t.fromY === t.overlapPx &&
      t.overlapPx === 64),
    JSON.stringify(tiles.map(t => t.overlapPx)));
  /* `.every` on [] is true, which is how the next three rows passed on the
     first run against a planner that did not exist. Each one now demands a
     plan with something in it. */
  check('a cut lands on a section top when one is in range',
    tiles.length > 1 && tiles.slice(0, -1).every(t => t.cutOn === 'break') &&
    tiles.slice(0, -1).every(t => [1400, 2800, 4200, 5600, 7000, 8400, 9800].indexOf(t.toY) >= 0),
    JSON.stringify(tiles.map(t => t.toY + ':' + t.cutOn)));
  /* ...but a section top just below the previous cut must not produce a
     sliver: a two-line tile is not a tile. */
  const sliver = safe(() => COMMON.fsAiPlanTiles({
    w: 1280, h: 4000, maxEdge: 1568, overlap: 0, breakYs: [30, 60, 90], minTile: 784
  }), {});
  check('...and never shrinks a tile below the floor to reach one',
    (sliver.tiles || []).length > 1 &&
    sliver.tiles.every(t => t.toY - t.fromY >= 784 || t.index === sliver.tiles.length),
    JSON.stringify((sliver.tiles || []).map(t => t.toY - t.fromY)));
  check('every tile is inside the long-edge target it was planned for',
    tiles.length > 1 && tiles.every(t => (t.toY - t.fromY) <= 1568),
    JSON.stringify(tiles.map(t => t.toY - t.fromY)));
  /* One image is all a clipboard holds, so the plan owes it an overview: the
     whole thing, fitted past the floor, which answers "what is this?" while
     the tiles answer "what does it say?". */
  check('the plan carries an overview for the surfaces that hold one image',
    !!plan.overview && plan.overview.h <= 1568 && plan.overview.scale < 0.5,
    JSON.stringify(plan.overview));
  const one = safe(() => COMMON.fsAiPlanTiles({ w: 800, h: 600, maxEdge: 1568, overlap: 64 }), {});
  check('CONTROL: something that already fits is one tile, not a stack of one-line strips',
    (one.tiles || []).length === 1 && one.tiles[0].fromY === 0 && one.tiles[0].toY === 600 &&
    one.tiles[0].overlapPx === 0, JSON.stringify(one.tiles));
}

console.log('\n=== the legend: what the arrows mean ===');
{
  const objects = [
    { type: 'num', x: 128, y: 300, n: 1, color: '#f00', size: 28 },
    { type: 'arrow', x1: 400, y1: 200, x2: 440, y2: 260, color: '#f00', width: 4 },
    { type: 'rect', x: 128, y: 500, w: 384, h: 80, color: '#f00', width: 3 },
    { type: 'blur', x: 100, y: 700, w: 200, h: 40, color: '#000', width: 1 },
    { type: 'text', x: 200, y: 900, text: 'check this', color: '#f00', size: 20 },
    { type: 'pen', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: '#f00', width: 3 },
    { type: 'hl', points: [{ x: 10, y: 20 }, { x: 90, y: 24 }], color: '#ff0', width: 14 },
    { type: 'line', x1: 10, y1: 10, x2: 20, y2: 20, color: '#f00', width: 2 },
    { type: 'ellipse', x: 10, y: 10, w: 40, h: 40, color: '#f00', width: 2 },
    { type: 'emoji', x: 600, y: 100, char: '⭐', size: 40 }
  ];
  const textLayer = [{ y: 300, text: 'Create invoice' }, { y: 262, text: 'Submit' },
                     { y: 905, text: 'Total due' }];
  const leg = safe(() => COMMON.fsAiLegend(objects, { w: 1280, h: 1000 }, textLayer), []);
  check('every mark the editor can make produces a legend row',
    Array.isArray(leg) && leg.length === objects.length &&
    new Set(leg.map(r => r.kind)).size === new Set(objects.map(o => o.type)).size,
    JSON.stringify((leg || []).map(r => r.kind)));
  /* Percentages, not pixels: the image is fitted, tiled and cropped between
     the editor and the model, and a pixel coordinate is wrong after any of
     those three. */
  const num = (leg || []).find(r => r.kind === 'num');
  /* Graded against the ROUNDED value, not against a tolerance: one decimal
     place is the rule, and a tolerance is how a rounding rule drifts. */
  check('positions are percentages of the exported image, never pixels',
    !!num && num.at && num.at.xPct === 10 && num.at.yPct === 30 &&
    (leg || []).every(r => !('x' in r) && !('y' in r)),
    JSON.stringify(num));
  const arrow = (leg || []).find(r => r.kind === 'arrow');
  check('an arrow carries BOTH ends — the tip is the whole point of an arrow',
    !!arrow && arrow.from && arrow.at &&
    arrow.at.xPct === 34.4 && arrow.at.yPct === 26 &&
    arrow.from.xPct === 31.3 && arrow.from.yPct === 20,
    JSON.stringify(arrow));
  check('a concealing mark says it is concealing something',
    safe(() => (leg || []).find(r => r.kind === 'blur').conceals === true, false),
    JSON.stringify((leg || []).find(r => r.kind === 'blur')));
  check('a box-shaped mark carries its box, not just a point',
    safe(() => { const r = (leg || []).find(x => x.kind === 'rect');
      return r.box && r.box.wPct === 30 && r.box.hPct === 8; }, false),
    JSON.stringify((leg || []).find(r => r.kind === 'rect')));
  /* The highest-signal field in the legend: "an arrow at 34%, 26%" is noise,
     "an arrow pointing at Submit" is the sentence the arrow stood in for. */
  check('a mark is placed against the nearest known text when there is a text layer',
    !!num && num.near === 'Create invoice' &&
    safe(() => (leg || []).find(r => r.kind === 'arrow').near === 'Submit', false),
    JSON.stringify((leg || []).map(r => r.near)));
  check('...and the field is simply absent when there is no text layer to ask',
    safe(() => COMMON.fsAiLegend(objects, { w: 1280, h: 1000 }, null)
      .every(r => !('near' in r)), false), '');
  check('the rows keep the order the marks were made — for steps that IS the meaning',
    safe(() => COMMON.fsAiLegend(objects, { w: 1280, h: 1000 }, textLayer)
      .map(r => r.id).join(',') === objects.map((_, i) => i + 1).join(','), false),
    JSON.stringify((leg || []).map(r => r.id)));
}

console.log('\n=== the clipboard: what actually lands in a chat UI ===');
{
  /* Measured in Chromium 149, headless AND headful through the real Windows
     clipboard: nothing is dropped by the clipboard — the receiving editor
     chooses. AI-HANDOFF-ENVELOPE.md §9. What this tier can hold is the shape
     FullShot offers, which is the half that is ours. */
  CLIP.writes.length = 0;
  const r = await bootResult({ shot: makeShot() });
  const copyBtn = r.doc.getElementById('copyBtn');
  await Promise.all((copyBtn.on.click || []).map(fn => fn({})));
  const w = r.clip[0] || {};
  check('the copy writes ONE clipboard item carrying two types',
    r.clip.length === 1 && w.types && w.types.length === 2 &&
    w.types.indexOf('image/png') >= 0 && w.types.indexOf('text/plain') >= 0,
    JSON.stringify(w.types));
  check('...and the text beside the image is the envelope\'s own context block',
    typeof w.text === 'string' && /Source:/.test(w.text) && /acme\.example/.test(w.text),
    JSON.stringify(String(w.text).slice(0, 70)));
  /* The whole capture, not part 1. A tall page is split into parts by CANVAS
     limits, which is an implementation detail of the stitcher and means
     nothing to a reader. */
  /* NOT "is it taller than part 1" — the fit makes the whole capture SHORTER
     than part 1 was, which is the point. The two things that prove the whole
     capture is in there: the aspect ratio is the stack's (1280x3000) and not
     part 1's (1280x2000), and a probe near the bottom finds the second
     segment's blue rather than the first's red. */
  const img = w.item && w.item.__map && w.item.__map['image/png'];
  const px = (b, wd, x, y) => { const i = (y * wd + x) * 4; return [b[i], b[i + 1], b[i + 2]]; };
  const aspect = img ? img.__w / img.__h : 0;
  const low = img && img.__data ? px(img.__data, img.__w, 2, img.__h - 3) : [0, 0, 0];
  const high = img && img.__data ? px(img.__data, img.__w, 2, 2) : [0, 0, 0];
  check('the WHOLE capture reaches the clipboard, not part 1',
    !!img && Math.abs(aspect - 1280 / 3000) < 0.01 &&
    low[2] > 200 && low[0] < 60 && high[0] > 200 && high[2] < 60,
    (img ? img.__w + 'x' + img.__h : 'no image') + ' aspect ' + aspect.toFixed(4) +
    ' top ' + high + ' bottom ' + low + ' (part 1 alone would be 0.6400 and red throughout)');
  /* Pre-scaled composition. Building the composite full size and then shrinking
     allocates exactly the canvas the limits exist to avoid. */
  const canvases = r.doc.__created.filter(c => c instanceof FakeCanvas);
  const biggest = canvases.reduce((m, c) => Math.max(m, c.__peakH || 0), 0);
  /* A run that allocated NOTHING satisfies "no canvas was too big", which is
     how this row passed on the first run. It has to have composed something,
     and that something has to be smaller than the stack it came from. */
  check('the composite is drawn pre-scaled — no canvas is ever the full stacked size',
    biggest > 0 && biggest < 3000 && canvases.every(c => (c.__peakH || 0) < 3000),
    'tallest canvas ' + biggest + ' (the stack is 3000)');
  check('the user is told what was copied',
    r.toasts.some(t => /Copied/i.test(String(t))), JSON.stringify(r.toasts));

  /* The image-only contract, unchanged: three other pages call this writer and
     none of them is mine to change. A caller that passes no text gets exactly
     what it got before the text existed. */
  CLIP.writes.length = 0;
  await safeAsync(() => clipWriter(fakeBlob(10, 10), false));
  const only = CLIP.writes[0] && CLIP.writes[0][0];
  check('a caller that offers no text still writes exactly one type',
    !!only && only.types.length === 1 && only.types[0] === 'image/png',
    JSON.stringify(only && only.types));
  CLIP.writes.length = 0;
  await safeAsync(() => clipWriter(fakeBlob(10, 10), false, ''));
  const empty = CLIP.writes[0] && CLIP.writes[0][0];
  check('...and an empty text is not a text',
    !!empty && empty.types.length === 1, JSON.stringify(empty && empty.types));

  /* "Just this part" stays one click for a multi-part capture. */
  const parts = r.doc.getElementById('segments').children;
  const partBtns = [];
  for (const p of parts) for (const c of (p.children || []))
    for (const b of (c.children || [])) if (b.tag === 'button') partBtns.push(b);
  CLIP.writes.length = 0;
  const copyPart = partBtns.filter(b => /copy/i.test(String(b.textContent)));
  check('a multi-part capture still offers "just this part" in one click',
    copyPart.length === 2, partBtns.map(b => b.textContent).join('|'));
  if (copyPart.length) {
    r.clip.length = 0;
    await Promise.all((copyPart[1].on.click || []).map(fn => fn({})));
    const p2 = r.clip[0] || {};
    const pimg = p2.item && p2.item.__map && p2.item.__map['image/png'];
    check('...and that copy says WHICH part it is, in the manifest the model reads',
      !!pimg && /part:? 2 of 2/i.test(String(p2.text)),
      safe(() => String(p2.text).split('\n').filter(l => /part|index/i.test(l))[0], ''));
  } else {
    check('...and that copy says WHICH part it is, in the manifest the model reads', false, 'no per-part copy button');
  }

  /* A failure still reaches a person, through the one reducer this page uses. */
  const boom = await bootResult({ shot: makeShot({ segments: [{ blob: Object.assign(fakeBlob(8, 8), { __boom: true }), w: 8, h: 8 }] }) });
  const cb = boom.doc.getElementById('copyBtn');
  await Promise.all((cb.on.click || []).map(fn => fn({})));
  check('a copy that fails still says so, through the shared reducer',
    boom.toasts.some(t => /Copy failed/i.test(String(t))), JSON.stringify(boom.toasts));
}

console.log('\n=== the record: what the stitcher has to keep for any of this to work ===');
{
  const img = (w, h) => { const c = new FakeCanvas(); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    return { width: w, height: h, data: c._data.slice(), __w: w, __h: h, __data: c._data.slice() }; };
  const cap = {
    id: 'cap-1', mode: 'full', title: 'Orders — Acme',
    url: 'https://acme.example/orders?session=' + SECRET_TOKEN,
    createdAt: Date.parse('2026-08-13T09:40:58.000Z'),
    meta: { totalW: 1280, totalH: 1460, vw: 1280, vh: 730, dpr: 1, winW: 1280, winH: 800,
            virtualScrollers: 2, breakHints: [400, 900],
            /* `match` is the ordinal of the DETECTOR MATCH each block came from
               AND the number of blocks that match produced, as one value. One
               match emits one block per client rect, so the two are different
               units and only this pairing relates them — and carrying the
               production count inside it is what stops the roll-up grading a
               match against the blocks that happened to arrive, which is how a
               match the box ceiling cut in half came to be counted covered.
               Two matches, one block each, here. */
            piiBoxes: [{ x: 10, y: 20, w: 100, h: 16, kind: 'email', match: { id: 0, blocks: 1 } },
                       { x: 10, y: 60, w: 90, h: 16, kind: 'phone', match: { id: 1, blocks: 1 } }],
            /* The pass's own arithmetic, and the reason "baked" below is a fact
               rather than an echo of the setting. Boxes alone cannot say
               whether the detector had anything to read — see the
               no-coverable-text case at the end of this block. */
            piiPass: true, piiScan: SCAN({ fed: 214, chars: 9412, placed: 214, inkPx: 120000,
                                           matched: 2, boxes: 2 }) },
    settings: { redactPII: true, expandInner: true, hideFixed: true, unrollVirtual: false,
                filenameTemplate: 'client-{title}', saveDirectory: 'Acme/Q3', imageFormat: 'png',
                jpegQuality: 0.92, theme: 'dark' }
  };
  const frames = [{ index: 0, x: 0, y: 0, img: img(1280, 730) },
                  { index: 1, x: 0, y: 730, img: img(1280, 730) }];
  const r = await bootResult({ capture: cap, frames, settings: { redactPII: true } });
  const rec = r.store.shots.get('cap-1') || {};

  check('the stitched record keeps what the capture knew about itself',
    !!rec.meta && rec.meta.totalH === 1460 && rec.meta.vw === 1280 && rec.meta.dpr === 1 &&
    rec.meta.winW === 1280, JSON.stringify(rec.meta));
  /* Persisting the rectangles would persist a MAP OF WHERE THE SECRETS ARE,
     next to an image in which they are blacked out. The count is the useful
     part; the geometry is the leak. */
  check('...and never the rectangles that say where the secrets were',
    !!rec.meta && rec.meta.piiBoxes === undefined && rec.meta.piiCount === 2,
    JSON.stringify(rec.meta && { boxes: rec.meta.piiBoxes, count: rec.meta.piiCount }));
  check('the record states the ACTS, and the three counts agree with the fixture',
    !!rec.redaction && rec.redaction.v === 3 && !!rec.redaction.acts &&
    rec.redaction.acts.matched === 2 && rec.redaction.acts.painted === 2 &&
    rec.redaction.acts.verifiedOpaque === 2 && rec.redaction.acts.ledger === 'present' &&
    rec.redaction.kinds && rec.redaction.kinds.email === 1 && rec.redaction.kinds.phone === 1,
    JSON.stringify(rec.redaction && { a: rec.redaction.acts, k: rec.redaction.kinds }));
  check('...and carries no verdict of any kind',
    !!rec.redaction && rec.redaction.pixels === undefined &&
    rec.redaction.state === undefined && rec.redaction.severity === undefined &&
    rec.redaction.scan === undefined && rec.redaction.bake === undefined,
    JSON.stringify(Object.keys(rec.redaction || {})));
  /* "Baked" is only worth reading if it is a REPORT. The count and the leaf
     tally travel in the same object, written by the same expression, so a
     reader can see the claim and the evidence for it together — and so the two
     cannot drift apart in a later edit to one of them. */
  /* THE ONE PLACE GEOMETRY IS ALLOWED TO TRAVEL (§3.3). A rect confirmed
     opaque in the delivered image describes THE PICTURE — a region that is
     already a solid block in the file the user holds. An unconfirmed rect
     describes THE PAGE and is a map to something that may still be visible. */
  /* Counted in BLOCKS — one outline per client rect — and deliberately not
     against an act, which counts matches: a wrapped token is one match covered
     and two rectangles for a person to look at. */
  check('only rects READ BACK OPAQUE are persisted as marks',
    !!rec.redaction && Array.isArray(rec.redaction.marks) &&
    rec.redaction.marks.length === 2 &&
    rec.redaction.marks.every(m => typeof m.x === 'number' && typeof m.y === 'number' &&
                                   m.w > 0 && m.h > 0),
    JSON.stringify(rec.redaction && rec.redaction.marks));
  /* BOTH LEDGERS, WHOLE (REDACTION-CLAIM-SPEC.md §3.9.1) — and still no
     geometry. The last attempt computed a counter, read it into a local and
     threw it away; a counter nobody can see is a counter nobody can check. */
  /* THE RACE (V2-FEATURE-COMPLETE-PLAN.md §9.1 R-10 / R-18), and the check that
     fails without the fix. `meta.piiPass` is an ACT — written by the branch in
     content/capture.js that decided to run the pass, from the settings snapshot
     the capture started with. `cap.settings.redactPII` is a SEPARATE, LATER
     read of the same preference, taken by background.js at FS_DONE. Anything
     that writes the preference in between makes the later read describe a
     different capture, and when it lands on `false` the whole act ledger
     collapses to zeros while three blocks are painted into the image: an
     outcome inferred from an input, which is the class this entire session is
     about. Boxes arrived, blocks were painted, and the record must say so. */
  const raced = await bootResult({
    capture: Object.assign({}, cap, { id: 'cap-race',
      settings: Object.assign({}, cap.settings, { redactPII: false }) }),
    frames, settings: { redactPII: false } });
  const rr = raced.store.shots.get('cap-race') || {};
  check('a mid-capture settings change cannot zero the act ledger',
    !!rr.redaction && rr.redaction.requested === true &&
    rr.redaction.acts.matched === 2 && rr.redaction.acts.painted === 2 &&
    rr.redaction.acts.verifiedOpaque === 2,
    JSON.stringify(rr.redaction && { requested: rr.redaction.requested, acts: rr.redaction.acts }));
  /* The settings digest is a PICK, not a copy: filenameTemplate and
     saveDirectory are free text, which is where a person types a client name. */
  check('the settings kept on the record are the capture flags, never the free text',
    !!rec.captureSettings && rec.captureSettings.redactPII === true &&
    rec.captureSettings.expandInner === true &&
    rec.captureSettings.filenameTemplate === undefined &&
    rec.captureSettings.saveDirectory === undefined,
    JSON.stringify(rec.captureSettings));
  check('a region capture, whose meta is two fields, still produces a record',
    await (async () => {
      const rr = await bootResult({
        capture: { id: 'cap-2', mode: 'region', title: 't', url: 'https://x.example/',
          createdAt: 1, meta: { cropRect: { x: 0, y: 0, w: 100, h: 80 }, dpr: 1 } },
        frames: [{ index: 0, x: 0, y: 0, img: img(200, 200) }]
      });
      const r2 = rr.store.shots.get('cap-2');
      return !!r2 && !!r2.meta && r2.meta.piiCount === 0 && r2.redaction.requested === null;
    })(), '');

  /* And the whole point: with the record in hand the copy is a real hand-off. */
  r.clip.length = 0; CLIP.writes.length = 0;
  const opened = await clickCopy(r);
  const w = r.clip[0] || {};
  const whole = String(w.text || '');
  check('THE COUPLING, END TO END: the copy of a redacted capture carries no secret',
    whole.length > 0 && whole.indexOf(SECRET_TOKEN) < 0 && /\[token\]/.test(whole) &&
    /text masked/.test(whole) && /2 matched \(whole count\), 2 of them painted over, 2 read back opaque/.test(whole),
    safe(() => whole.split('\n').filter(l => /Source|Redaction/.test(l)).join(' | '), ''));
  /* §3.1 — the gate fires, and it fires on the bundle and on nothing else. */
  check('...and the person was shown the image before it left',
    opened === true, 'reviewDlg opened = ' + opened);
  check('...and the payload carries the constant that stops a reader summarising the counts',
    /It cannot see this image/.test(whole) &&
    /counts what FullShot did, not what is in the picture/.test(whole),
    safe(() => whole.split('\n').filter(l => /cannot see this image/.test(l))[0], 'absent'));
  /* CANCEL LEAVES THE CLIPBOARD UNTOUCHED. Second copy in the same sitting, so
     the once-per-record flag has already been set — which is why this uses a
     fresh boot rather than the record above. */
  const cancelled = await bootResult({ capture: Object.assign({}, cap, { id: 'cap-cancel' }),
                                       frames, settings: { redactPII: true } });
  cancelled.clip.length = 0;
  const cOpened = await clickCopy(cancelled, { cancel: true });
  check('Cancel leaves the clipboard untouched',
    cOpened === true && cancelled.clip.length === 0,
    'opened=' + cOpened + ' writes=' + cancelled.clip.length);
  /* ONCE PER RECORD PER PAGE LOAD. Two copies in one sitting, one dialog. */
  r.clip.length = 0;
  const again = await clickCopy(r);
  check('...and a second copy in the same sitting is not asked again',
    again === false && r.clip.length === 1, 'opened=' + again + ' writes=' + r.clip.length);
  /* SAVE IS NEVER INTERRUPTED. A dialog on every action teaches people to click
     through everything, and then the one that matters is furniture. */
  r.downloads.length = 0;
  const dl = r.doc.getElementById('dlBtn');
  await Promise.all((dl.on.click || []).map(fn => fn({})));
  check('CONTROL: Download with redaction on opens nothing at all',
    r.doc.getElementById('reviewDlg').hidden === true && r.downloads.length > 0,
    'downloads=' + r.downloads.length);

  /* THE SENTENCE AND THE WEIGHT ON IT COME FROM ONE PREDICATE (§3.4).
     They did not: the dialog's bold arm tested `painted < matched` while the
     sentence's arm also accepted `verifiedOpaque < painted`, so on the run that
     produced the shortfall the one bolded line in the design was rendered
     unbolded. Graded by BOOTING THE PAGE and reading the class the dialog
     actually carries, not by reading the source for two similar expressions —
     two similar expressions is what shipped. */
  {
    /* 2 / 2 / 1 — both matches painted over, one of them NOT read back opaque,
       which is where the two predicates parted company: the sentence's arm saw
       `verifiedOpaque < painted` and fired, and the bold arm asked
       `painted < matched`, which is false here. The one line the design bolds
       was rendered in the same weight as everything around it. */
    const shortShot = makeShot({ id: 'short-1',
      redaction: { v: 3, requested: true, kinds: { email: 2 }, marks: [],
                   acts: { v: 4, matched: 2, painted: 2, verifiedOpaque: 1,
                           matchedComplete: true, walkComplete: true, truncatedBy: null,
                           textRefused: 0, blocksLost: 0, blocksUnpainted: 0, blocksUnread: 0,
                           ledger: 'present' } } });
    const sr = await bootResult({ shot: shortShot });
    await clickCopy(sr);
    const el = sr.doc.getElementById('reviewActs');
    check('the shortfall sentence and its emphasis are one predicate',
      /1 match is not covered in this image/.test(String(el.textContent)) &&
      el.className === 'review-short',
      JSON.stringify({ text: String(el.textContent), cls: el.className }));
    /* And the impossible arithmetic gets neither. No pipeline in the product
       still produces a covered count above its matched one — pages/db.js's §4
       lift used to, by reading a v2 ledger's BLOCK counters into these fields,
       and now answers `null` twice instead — but the renderer is handed a
       RECORD, written by any build that ever ran, so the shape arrives from
       outside the pipeline or not at all. The honest rendering of an
       impossibility is silence, not "0 matches are not covered". */
    const badShot = makeShot({ id: 'short-2',
      redaction: { v: 3, requested: true, kinds: { email: 3 }, marks: [],
                   acts: { v: 4, matched: 3, painted: 6, verifiedOpaque: 5,
                           matchedComplete: true, walkComplete: true, truncatedBy: null,
                           textRefused: 0, blocksLost: 0, blocksUnpainted: 0, blocksUnread: 0,
                           ledger: 'partial' } } });
    const br = await bootResult({ shot: badShot });
    await clickCopy(br);
    const bel = br.doc.getElementById('reviewActs');
    check('...and a covered count above the matched one is bolded nowhere and stated nowhere',
      !/not covered in this image/.test(String(bel.textContent)) && bel.className === '',
      JSON.stringify({ text: String(bel.textContent), cls: bel.className }));
  }

  /* An old shot from before any of this existed must not be described as
     unredacted with confidence the producer does not have. */
  const old = await bootResult({ shot: { id: 'old-1', title: 'Old', url: 'https://x.example/a',
    createdAt: 1, mode: 'full', w: 100, h: 100, format: 'png', breakYs: null,
    segments: [{ blob: fakeBlob(100, 100), w: 100, h: 100 }], thumb: fakeBlob(4, 4) } });
  old.clip.length = 0;
  const oldOpened = await clickCopy(old);
  const ow = old.clip[0] || {};
  check('a shot recorded before the envelope existed says it has no account of a pass',
    typeof ow.text === 'string' && /no record of a redaction pass/.test(ow.text) &&
    !/\d+ matched/.test(ow.text),
    safe(() => String(ow.text).split('\n').filter(l => /Redaction/i.test(l))[0], 'no line'));
  check('...and it still gates, because "we cannot tell" resolves toward showing the picture',
    oldOpened === true, 'reviewDlg opened = ' + oldOpened);

  /* A SHOT SEALED BY THE PREVIOUS ENGINE — the one back-compat case that is a
     safety case rather than a cosmetic one. Its redaction block is the OLD
     shape: `scan` is a string, there are no ledgers, nothing was ever read back
     out of a canvas, and `pixels` says "baked" because a rule this build no
     longer trusts said so. Carrying that word across the version boundary would
     be a claim surviving the very thing that invalidated it, and it would do it
     silently, on every capture already in the user's history.

     It must re-derive to `unknown`, it must still emit (refusing to hand off a
     historical shot at all would be a different bug), and the reader must be
     told which of the two it is. */
  const legacy = await bootResult({ shot: { id: 'legacy-1', title: 'Orders', url: 'https://x.example/o',
    createdAt: 1, mode: 'full', w: 100, h: 100, format: 'png', breakYs: null,
    segments: [{ blob: fakeBlob(100, 100), w: 100, h: 100 }], thumb: fakeBlob(4, 4),
    redaction: { scan: 'scanned', pixels: 'baked', boxes: 2, textLeaves: 214,
                 kinds: { email: 1, phone: 1 } } } });
  legacy.clip.length = 0;
  await clickCopy(legacy);
  const lw = String((legacy.clip[0] || {}).text || '');
  check('a previous engine\'s "baked" does not survive into this build\'s bundle',
    lw.length > 0 && !/baked/.test(lw) && !/pixels/.test(lw),
    safe(() => lw.split('\n').filter(l => /Redaction/i.test(l)).join(' | '), 'no bundle at all'));
  check('...and the bundle is still emitted, saying it has no account of a pass',
    /no record of a redaction pass on this capture/.test(lw),
    safe(() => lw.split('\n').filter(l => /Redaction/i.test(l)).join(' | '), ''));
  check('...and the text surfaces are still masked, because a null answer over-masks',
    /text masked/.test(lw), '');
  /* §4 — THE STRIP IS AT THE STORE BOUNDARY. Handed the same v2 record, the
     translator drops every verdict field and lifts only the surviving act
     fields, with `ledger: "partial"` so nobody mistakes a lift for a reading. */
  const v2rec = { id: 'v2-1', redaction: { v: 2, state: 'blocks-painted', severity: 'unread',
    pixels: 'baked', text: 'masked', kinds: { email: 1 },
    scan: SCAN({ fed: 10, matched: 3, boxes: 3 }), bake: BAKE({ handed: 3, painted: 3, verified: 2 }) } };
  const stripped = safe(() => DB.fsStripShot(v2rec), null);
  check('a v2 record\'s stored verdict never leaves the store',
    !!stripped && stripped.redaction.v === 3 && stripped.redaction.pixels === undefined &&
    stripped.redaction.state === undefined && stripped.redaction.severity === undefined &&
    stripped.redaction.scan === undefined && stripped.redaction.bake === undefined,
    JSON.stringify(stripped && Object.keys(stripped.redaction)));
  check('...and what it lifts is marked as a lift, never as a reading',
    !!stripped && stripped.redaction.acts.ledger === 'partial' &&
    stripped.redaction.acts.matched === 3 && stripped.redaction.marks.length === 0,
    JSON.stringify(stripped && stripped.redaction.acts));
  /* AND IT LIFTS ONLY WHAT IS IN THE RIGHT UNIT. `scan.matched` was already
     counted once per MATCH, so it survives the boundary unchanged. A v2 bake
     ledger's `painted` / `verified` count BLOCKS — one per client rect — and
     the match-unit roll-up needs a `matchId` on each box that no record written
     before this version carries, so the two match-unit counters are not merely
     missing from an old record, they are UNKNOWABLE from it. The honest answer
     to a question that cannot be answered is `null`; the block count wearing
     the match count's name is the defect this round removed everywhere the
     numbers are produced, and this is the one door they can still arrive
     through. */
  check('...and a v2 bake, which counted BLOCKS, supplies no MATCH count at all',
    !!stripped && stripped.redaction.acts.painted === null &&
    stripped.redaction.acts.verifiedOpaque === null,
    JSON.stringify(stripped && stripped.redaction.acts));
  /* GRADED ON THE SOURCE, because the runtime check above passes for two very
     different reasons and only one of them survives the next edit: reading
     `bake.matchesPainted` off an object that ALSO carries `bake.painted` answers
     null today and answers 4 the moment somebody "fixes" the null. The lift is
     handed a projection with no block-unit field on it at all, so the two units
     do not share an object, let alone a field — and this asserts that the region
     names neither, which is the thing a projection is for. */
  {
    const src = stripComments(read('pages/db.js'));
    const a = src.indexOf('function fsMatchCounters');
    const b = src.indexOf('const FSDB =');
    const region = (a < 0 || b < a) ? '' : src.slice(a, b);
    /* `acts.painted` is the match-unit field being WRITTEN and is excused by
       name; every other `.painted` / `.verified` in this region is a read off
       an old ledger, which is the thing being forbidden. (`acts.verifiedOpaque`
       needs no excusing — `\bverified\b` does not match inside it.) */
    const named = (region.replace(/\bacts\.painted\b/g, '')
      .match(/\.(painted|verified)\b/g) || []);
    check('the §4 lift names no block-unit counter anywhere in it',
      region.length > 0 && named.length === 0,
      named.length ? named.join(' ') : region.length + ' chars graded');
    /* AND THE PROJECTION IS LOAD-BEARING, not decoration. The check above is
       satisfied just as well by reading `old.bake.matchesPainted` directly —
       right name, right answer, and the block counters one keystroke away on
       the same object for the next person to reach for. So the old ledger is
       graded as reachable EXACTLY ONCE in this region, as the argument to the
       projection. That is what makes the two units unable to share an object,
       which is the only form of "cannot" available here. */
    const reaches = (region.match(/\bold\.bake\b/g) || []);
    check('...and the old ledger is reachable only as the projection\'s argument',
      reaches.length === 1 && /fsMatchCounters\(old\.bake\)/.test(region),
      reaches.length + ' read(s) of old.bake');
  }
  const ancient = safe(() => DB.fsStripShot({ id: 'a', redaction: { pixels: 'none', kinds: {} } }), null);
  const nothing = safe(() => DB.fsStripShot({ id: 'b', redaction: { pixels: 'baked', kinds: {} } }), null);
  check('...and a counter the old record cannot supply is null, never zero',
    !!nothing && nothing.redaction.acts.ledger === 'absent' &&
    nothing.redaction.acts.matched === null && nothing.redaction.acts.painted === null &&
    nothing.redaction.requested === null,
    JSON.stringify(nothing && nothing.redaction));
  check('...and only a record that positively says the setting was off reads as off',
    !!ancient && ancient.redaction.requested === false,
    JSON.stringify(ancient && ancient.redaction.requested));
  /* A BAKE WITH NO SCAN BESIDE IT — the population that decides whether "a pass
     happened" and "the pass can be counted" are the same question. They are not:
     the ledger positively records that blocks were handed and painted, so
     `absent` ("no record of a redaction pass on this capture") would be false,
     while every counter it can offer is in the wrong unit and is therefore null.
     A `partial` ledger carrying nothing but nulls is the honest shape here, and
     it is the one the strip's `present` flag exists to produce. */
  const bakeOnly = safe(() => DB.fsStripShot({ id: 'b2', redaction: { v: 2, pixels: 'baked',
    kinds: { email: 1 }, bake: BAKE({ handed: 2, painted: 2, verified: 2 }) } }), null);
  check('a v2 bake with no scan beside it says a pass happened and counts none of it',
    !!bakeOnly && bakeOnly.redaction.requested === true &&
    bakeOnly.redaction.acts.ledger === 'partial' &&
    bakeOnly.redaction.acts.matched === null && bakeOnly.redaction.acts.painted === null &&
    bakeOnly.redaction.acts.verifiedOpaque === null,
    JSON.stringify(bakeOnly && bakeOnly.redaction.acts));

  /* THE WRAPPED TOKEN, LIFTED — the units bug in the one path the roll-up never
     reached, graded over the whole distance the number travels: the v2 record
     goes through the REAL store boundary, the stripped record boots the REAL
     result page, and the assertion is read off the REAL clipboard.

     The fixture is the shape that started all of this. A card number breaking
     across two lines is ONE match and TWO blocks, and an email elsewhere on the
     page was matched and never covered at all: `scan.matched 3`, `bake.painted
     4`, `bake.verified 4`. Lifting those two block counts into the match-unit
     fields states a covered count ABOVE the matched one — and
     AI-HANDOFF-ENVELOPE.md §5 tells consumers in as many words that they may
     subtract these three numbers from one another, so the envelope would be
     lying about its own documented shape to every tool implementing against it.

     Both halves are asserted, because either alone is passable by accident: the
     bundle must print the two counters as unknown, and it must not print the
     block counts anywhere in that line. */
  const wrapped = safe(() => DB.fsStripShot({ id: 'v2-wrap',
    redaction: { v: 2, state: 'blocks-painted', severity: 'unread', pixels: 'baked',
      text: 'masked', kinds: { card: 1, email: 2 },
      scan: SCAN({ fed: 40, matched: 3, boxes: 4 }),
      bake: BAKE({ handed: 4, painted: 4, verified: 4 }) } }), null);
  const wr = await bootResult({ shot: makeShot({ id: 'v2-wrap',
    redaction: wrapped && wrapped.redaction }) });
  wr.clip.length = 0;
  const wrapOpened = await clickCopy(wr);
  const wt = String((wr.clip[0] || {}).text || '');
  const wline = safe(() => wt.split('\n').filter(l => /^- Redaction:/.test(l))[0], '') || 'no bundle at all';
  check('a lifted v2 ledger never reports more covered than it matched',
    /3 matched \((whole|PARTIAL) count\), unknown of them painted over, unknown read back opaque/.test(wt), wline);
  check('...and the block counts appear nowhere in the line a consumer subtracts',
    wt.length > 0 && !/4 of them painted/.test(wt) && !/4 read back opaque/.test(wt), wline);
  check('...and the record still gates, because a lift is not a reading',
    wrapOpened === true, 'reviewDlg opened = ' + wrapOpened);

  /* The cost is a decision the user makes BEFORE pasting, so it has to be on
     the page before the click, not in the toast after it. */
  const title = r.doc.getElementById('copyBtn').title || '';
  check('the cost of the paste is on the page before the paste',
    /tokens/i.test(title) && /\d/.test(title), JSON.stringify(title));

  /* ---- the canvas-rendered page (v1.10.2) ----
     THE STATE THAT USED TO BE INVISIBLE. Google Docs, Sheets, Slides and Figma
     paint their glyphs, so the detector has nothing to read; redaction is ON,
     the capture succeeds, and not one box is drawn. The old record said
     "pixels: baked" from the setting alone, which is a false claim about an
     image that still contains everything, handed to a reader — a compliance
     process, an assistant — who has no way to check it.

     Graded on the BUNDLE, not just the record, because the bundle is what
     leaves the machine. Three conjuncts, deliberately together: the envelope
     must not claim the bake, it must still mask the text surfaces (a producer
     that cannot prove the pixels are clean has to over-mask — §5), and the
     state has to be SAID, not left to be inferred from a value that also means
     "this record is from 2025". */
  const canvasCap = {
    id: 'cap-3', mode: 'full', title: 'Q3 review', url: 'https://docs.example/d/abc',
    createdAt: 2,
    meta: { totalW: 1280, totalH: 900, vw: 1280, vh: 900, dpr: 1, winW: 1280, winH: 900,
            piiPass: true, piiScan: SCAN({ fed: 3, chars: 41, placed: 0 }) },
    settings: { redactPII: true, imageFormat: 'png' }
  };
  const cv = await bootResult({ capture: canvasCap, frames: [{ index: 0, x: 0, y: 0, img: img(1280, 900) }],
                                settings: { redactPII: true } });
  const cvRec = cv.store.shots.get('cap-3') || {};
  check('a canvas-rendered page reports 0 / 0 / 0 — a fact about the reading',
    !!cvRec.redaction && cvRec.redaction.requested === true &&
    cvRec.redaction.acts.matched === 0 && cvRec.redaction.acts.painted === 0 &&
    cvRec.redaction.acts.verifiedOpaque === 0 && cvRec.redaction.marks.length === 0,
    JSON.stringify(cvRec.redaction && cvRec.redaction.acts));
  cv.clip.length = 0;
  await clickCopy(cv);
  const cvText = String((cv.clip[0] || {}).text || '');
  check('...and the bundle states the three counts and nothing that summarises them',
    /0 matched \((whole count|PARTIAL count|completeness unknown)\), 0 of them painted over, 0 read back opaque/.test(cvText) && /text masked/.test(cvText) &&
    !/baked/.test(cvText) && !/pixels/.test(cvText),
    safe(() => cvText.split('\n').filter(l => /Redaction/i.test(l)).join(' | '), ''));
  /* The sentence no longer describes THE PAGE. "This page draws its text as a
     picture" was an inference about the page — the exact class of claim this
     design retires — and 54 translations of that inference existed. */
  check('...without claiming to know how the page drew its text',
    !/draws its text as a picture/.test(cvText) && !/\bthis page\b/i.test(cvText), '');
  check('...and the limit of the instrument is stated beside the zeros',
    /FullShot reads the text a page exposes/.test(cvText),
    safe(() => cvText.split('\n').filter(l => /exposes/i.test(l))[0], 'no constant line'));
}

/* ============================================================================
   THE REDACTION CLAIM — there is no longer one (REDACTION-CLAIM-SPEC.md §0, §5)

   This tier used to own a MAPPING: eight states, two of which could say
   "baked". The mapping is gone, and with it the thing it was mapping to. What
   is owned here now is the REDUCTION itself, and the four checks that keep it
   reduced are the ones a future session will be tempted to soften:

     1. no `pixels` / `state` / `severity` / `evidence` key at ANY depth;
     2. `FS_ENVELOPE_VERDICT` throws when one is reintroduced — including under
        a NEW NAME, because the scan is by shape and not by a list of four;
     3. every value in `acts` is an integer, a boolean, `null`, or one of the
        four `truncatedBy` members;
     4. `FS_ENVELOPE_UNREVIEWED` throws without `reviewed: true`, AT THE
        PRODUCER, so a second call site cannot talk its way past it.

   None of these is about a page shape. That is the point: under this design the
   fourteen shapes that defeated the six previous fixes are uninteresting,
   because there is no claim left for them to be wrong about.
   ========================================================================== */
console.log('\n=== the reduction: what may not be in the envelope ===');
{
  const base = (over) => Object.assign({
    producer: { tool: 'FullShot', version: '1', surface: 'x' },
    subject: { kind: 'web-page', mode: 'full', url: 'https://x.example/', title: 'T',
      capturedAt: '2026-08-13T00:00:00.000Z', viewport: { w: 10, h: 10, dpr: 1 },
      content: { w: 10, h: 10 }, image: { w: 10, h: 10 } }
  }, over || {});
  const honest = () => base({ redactRequested: true, redactActs: ACTS(), reviewed: true });
  const threw = (mut) => {
    const i = honest(); mut(i);
    try { COMMON.fsAiBundle(i); return ''; } catch (e) { return String(e && e.message || e); }
  };
  /* Every key at every depth, flattened once so the checks below read the same
     envelope a consumer would. */
  const keysAtAnyDepth = (o, out, d) => {
    out = out || []; d = d || 0;
    if (!o || typeof o !== 'object' || d > 12) return out;
    if (Array.isArray(o)) { for (const v of o) keysAtAnyDepth(v, out, d + 1); return out; }
    for (const k of Object.keys(o)) { out.push(k); keysAtAnyDepth(o[k], out, d + 1); }
    return out;
  };

  /* CHECK 1 — FAIL-FIRST. All four of these were present in every bundle this
     product emitted until now. */
  const built = safe(() => COMMON.fsAiBundle(honest()), null);
  const allKeys = safe(() => keysAtAnyDepth(built.envelope), []);
  const found = ['pixels', 'state', 'severity', 'evidence'].filter(k => allKeys.indexOf(k) >= 0);
  check('no pixels / state / severity / evidence key at any depth of a built envelope',
    !!built && found.length === 0, found.join(',') || allKeys.length + ' keys graded');
  check('...and the acts block is there instead, with the three counts and the walk',
    !!built && built.envelope.redaction.acts.matched === 2 &&
    built.envelope.redaction.acts.painted === 2 &&
    built.envelope.redaction.acts.verifiedOpaque === 2 &&
    built.envelope.redaction.acts.walkComplete === true,
    safe(() => JSON.stringify(built.envelope.redaction.acts), ''));
  check('...and `requested` reports the setting, which is not a claim about the image',
    !!built && built.envelope.redaction.requested === true,
    safe(() => String(built.envelope.redaction.requested), ''));

  /* CHECK 2 — the gate, on each of the four names, at the depth each of them
     used to live at. */
  check('FS_ENVELOPE_VERDICT throws when `pixels` is reintroduced',
    threw(i => { i.redactActs = Object.assign(ACTS(), { pixels: 'baked' }); }) === 'FS_ENVELOPE_VERDICT', '');
  check('...when `state` is', threw(i => { i.redactActs = Object.assign(ACTS(), { state: 'blocks-painted' }); }) === 'FS_ENVELOPE_VERDICT', '');
  check('...when `severity` is', threw(i => { i.redactActs = Object.assign(ACTS(), { severity: 'unread' }); }) === 'FS_ENVELOPE_VERDICT', '');
  check('...when `evidence` is', threw(i => { i.redactActs = Object.assign(ACTS(), { evidence: {} }); }) === 'FS_ENVELOPE_VERDICT', '');

  /* TOOTH 5, AND IT IS THE ONE THAT DECIDES WHETHER THE SCAN IS A DENYLIST.
     `reviewedByHuman` is not one of the four names. If the scan were a list of
     four names it would sail through, and the next verdict would simply be
     called something else. It is refused because a BOOLEAN nobody declared is
     the shortest possible verdict — a rule about shape, not about spelling. */
  const smuggled = safe(() => COMMON.fsAiBundle(honest()).envelope, null);
  if (smuggled) smuggled.redaction.reviewedByHuman = true;
  check('a verdict under a NEW NAME is refused too — the scan is by shape, not by a list of four',
    !!smuggled && /reviewedByHuman/.test(String(COMMON.fsEnvelopeVerdict(smuggled) || '')),
    safe(() => String(COMMON.fsEnvelopeVerdict(smuggled)), 'the scan found nothing — it is a denylist'));
  const smuggled2 = safe(() => COMMON.fsAiBundle(honest()).envelope, null);
  if (smuggled2) smuggled2.budget.imageIsClean = true;
  check('...at the top of the envelope as readily as inside the redaction block',
    !!smuggled2 && /imageIsClean/.test(String(COMMON.fsEnvelopeVerdict(smuggled2) || '')),
    safe(() => String(COMMON.fsEnvelopeVerdict(smuggled2)), 'not caught'));
  /* CONTROL: the booleans the envelope legitimately carries are declared, so
     the rule above is a rule and not a ban on booleans. */
  check('CONTROL: the declared booleans do not trip it',
    !!built && COMMON.fsEnvelopeVerdict(built.envelope) === null,
    safe(() => String(COMMON.fsEnvelopeVerdict(built.envelope)), ''));

  /* CHECK 3 — Rule 2. A word is where a verdict hides, so the acts block holds
     none: integers, booleans, null, and one four-value enum. */
  const actVals = safe(() => Object.keys(built.envelope.redaction.acts)
    .map(k => [k, built.envelope.redaction.acts[k]]), []);
  const okVal = ([k, v]) => COMMON.fsRedactActValueOk(k, v);
  check('every value in `acts` is an integer, a boolean, null, or a truncatedBy member',
    actVals.length === 12 && actVals.every(okVal),
    actVals.filter(p => !okVal(p)).map(p => p[0] + '=' + JSON.stringify(p[1])).join(',') ||
      actVals.length + ' values graded');
  check('...and a free string smuggled into it is refused',
    threw(i => { i.redactActs = Object.assign(ACTS(), { coverage: 'complete' }); }) === 'FS_ENVELOPE_VERDICT', '');
  check('...as is a truncatedBy outside its four values',
    threw(i => { i.redactActs = ACTS({ truncatedBy: 'shadow-dom' }); }) === 'FS_ENVELOPE_VERDICT', '');
  check('CONTROL: each of the three real truncation reasons is accepted',
    ['elements', 'time', 'ceiling'].every(t =>
      threw(i => { i.redactActs = ACTS({ truncatedBy: t, walkComplete: false }); }) === ''),
    '');

  /* CHECK 3b — THE UNITS. Two numbers may only be subtracted if they count the
     same thing, and this is the subtraction §3.4 renders.

     `matched` counts DETECTOR MATCHES. A block is one CLIENT RECT, and a token
     that wraps across a line has two, so a match-count minus a block-count read
     one too many covered on ordinary markup — enough for one wrapped card
     number to pay for an entirely different uncovered email, which is the one
     case the whole design exists to surface. All three counters therefore count
     MATCHES, and the shortfall is computed in exactly one place so the sentence
     and the emphasis on it cannot come from different predicates. */
  const SHORT = COMMON.fsRedactShortfall;
  check('the shortfall is computed in one exported place, not at each call site',
    typeof SHORT === 'function', typeof SHORT);
  if (typeof SHORT === 'function') {
    check('a wrapped token does not cancel an uncovered match',
      SHORT(ACTS({ matched: 2, painted: 1, verifiedOpaque: 1 })) === 1,
      String(SHORT(ACTS({ matched: 2, painted: 1, verifiedOpaque: 1 }))));
    check('CONTROL: everything matched and covered is a shortfall of zero',
      SHORT(ACTS({ matched: 3, painted: 3, verifiedOpaque: 3 })) === 0,
      String(SHORT(ACTS({ matched: 3, painted: 3, verifiedOpaque: 3 }))));
    check('the read-back is what counts as covered, not the paint',
      SHORT(ACTS({ matched: 3, painted: 3, verifiedOpaque: 1 })) === 2,
      String(SHORT(ACTS({ matched: 3, painted: 3, verifiedOpaque: 1 }))));
    check('...and where there is no read-back at all, the paint is the fallback',
      SHORT(ACTS({ matched: 3, painted: 1, verifiedOpaque: null })) === 2,
      String(SHORT(ACTS({ matched: 3, painted: 1, verifiedOpaque: null }))));
    /* AN IMPOSSIBLE RESULT RENDERS NOTHING. `covered` counts a subset of
       `matched`, so a covered count above it is not a smaller alarm — it is an
       arithmetic impossibility, and the product printed one: "Redaction matched
       3 and covered 5. 0 matches are not covered in this image." A reasonable
       person reads "0 not covered" as "this is clean", which is the verdict
       §0.1 forbids "however it is computed". pages/db.js's §4 lift used to be
       the standing source of the shape — a v2 ledger predates any per-match
       identity, so its block counters landed in these fields — and now answers
       `null` twice instead. The guard stays because the predicate is handed
       acts by callers it does not control: a record on disk written by any
       build, and a `redactActs` passed straight into fsAiBundle. */
    check('a covered count above the matched one produces NO shortfall, never zero',
      SHORT(ACTS({ matched: 3, painted: 6, verifiedOpaque: 5, ledger: 'partial' })) <= 0,
      String(SHORT(ACTS({ matched: 3, painted: 6, verifiedOpaque: 5, ledger: 'partial' }))));
    check('...and no counter combination can make it claim MORE than was matched',
      [null, 0, 1, 2, 5].every(p => [null, 0, 1, 2, 5].every(v =>
        [0, 1, 3].every(m => {
          const s = SHORT(ACTS({ matched: m, painted: p, verifiedOpaque: v }));
          return s === null || (Number.isInteger(s) && s <= m);
        }))), '75 combinations graded');
    check('a counter that was never measured cannot be subtracted from',
      SHORT(ACTS({ matched: 3, painted: null, verifiedOpaque: null })) === null &&
      SHORT(ACTS({ matched: null, painted: 1, verifiedOpaque: 1 })) === null,
      JSON.stringify([SHORT(ACTS({ matched: 3, painted: null, verifiedOpaque: null })),
                      SHORT(ACTS({ matched: null, painted: 1, verifiedOpaque: 1 }))]));
    check('...and neither can a block of the wrong shape',
      SHORT(null) === null && SHORT({}) === null && SHORT('acts') === null, '');
  }
  /* The builder reads the MATCH-unit counters and nothing else: a ledger that
     can only supply block counts supplies `null`, because a zero is a
     measurement and this is the absence of one. */
  {
    const blocksOnly = COMMON.fsRedactActs({ scan: SCAN({ matched: 2, boxes: 3 }),
                                             bake: BAKE({ handed: 3, painted: 3, verified: 3 }) });
    check('a bake ledger that counts only blocks cannot supply a match count',
      blocksOnly.matched === 2 && blocksOnly.painted === null && blocksOnly.verifiedOpaque === null,
      JSON.stringify(blocksOnly));
    const both = COMMON.fsRedactActs({
      scan: SCAN({ matched: 2, boxes: 3 }),
      bake: BAKE({ handed: 3, painted: 3, verified: 3,
                   matchesPainted: 1, matchesVerifiedOpaque: 1 }) });
    check('...and the match-unit counters are what the acts carry',
      both.matched === 2 && both.painted === 1 && both.verifiedOpaque === 1,
      JSON.stringify(both));
  }

  /* CHECK 4 — the review precondition, at the producer. */
  check('FS_ENVELOPE_UNREVIEWED throws without reviewed:true',
    threw(i => { delete i.reviewed; }) === 'FS_ENVELOPE_UNREVIEWED', '');
  check('...and a truthy value that is not true does not satisfy it',
    threw(i => { i.reviewed = 'yes'; }) === 'FS_ENVELOPE_UNREVIEWED', '');
  check('...and `requested: null` gates as firmly as `true`',
    threw(i => { i.redactRequested = null; delete i.reviewed; }) === 'FS_ENVELOPE_UNREVIEWED', '');
  check('CONTROL: `requested: false` never gates — the default-off majority is never stopped',
    threw(i => { i.redactRequested = false; delete i.reviewed; i.redactActs = undefined; }) === '', '');
  /* NOTHING ABOUT THE REVIEW REACHES THE BUNDLE. A consumer reading
     `reviewedByHuman: true` summarises it as APPROVED, and a human's "I looked"
     laundered into machine-readable assurance is the same verdict wearing a
     person as a costume. */
  check('the review is a precondition and never a payload',
    !!built && !/review/i.test(JSON.stringify(built.envelope)) && !/review/i.test(built.text),
    safe(() => (JSON.stringify(built.envelope).match(/"[a-z]*review[a-z]*"/gi) || []).join(','), ''));

  /* The no-evidence gate, in its new shape: a block that says it has no ledger
     must not carry a counter beside that admission. */
  check('a bundle with redaction requested and no acts block at all is refused',
    threw(i => { i.redactActs = null; }) === 'FS_ENVELOPE_NOEVIDENCE' ||
    threw(i => { i.redactActs = null; }) === 'FS_ENVELOPE_VERDICT',
    threw(i => { i.redactActs = null; }));
  check('a bundle that says "no ledger" and prints a number beside it is refused',
    threw(i => { i.redactActs = ACTS({ ledger: 'absent' }); }) === 'FS_ENVELOPE_NOEVIDENCE', '');
  check('CONTROL: an honest absent ledger — every counter null — is emitted',
    threw(i => { i.redactActs = COMMON.fsRedactActs(null); }) === '', '');

  /* CHECK 5 — the ladder is GONE FROM SOURCE, not merely unused. A function
     left computed-but-uncalled is a function the next person finds and wires
     back up. */
  /* Comments stripped first: this file's own explanation of what was removed
     names the removed things, and a check that cannot tell a live reference
     from a note about its absence grades prose. */
  const cSrc = stripComments(read('pages/common.js'));
  const rSrc = stripComments(read('pages/result.js'));
  const dead = ['fsRedactionState', 'FS_REDACT_LINE', 'FS_REDACT_CLAUSE', 'fsRedactClause',
                'fsRedactionLine', 'fsRedactScanOk', 'fsRedactBakeOk'];
  const alive = dead.filter(n => cSrc.indexOf(n) >= 0 || rSrc.indexOf(n) >= 0);
  check('the eight-state ladder is absent from source, not just unreferenced',
    alive.length === 0, alive.join(',') || dead.length + ' names gone');
  check('...and so is the data-proven CSS hook — a verdict one stylesheet from being green',
    read('pages/result.js').indexOf('data-proven') < 0 &&
    read('pages/result.html').indexOf('data-proven') < 0, '');
  /* All four gates in the one builder, so a call site cannot pick which apply. */
  const body = /function fsAiBundle\([\s\S]*?\n\}/.exec(stripComments(cSrc));
  check('all four gates live inside the one builder',
    !!body && /FS_ENVELOPE_UNREDACTED/.test(body[0]) && /FS_ENVELOPE_OVERSIZE/.test(body[0]) &&
    /FS_ENVELOPE_NOEVIDENCE/.test(body[0]) && /FS_ENVELOPE_VERDICT/.test(body[0]) &&
    /FS_ENVELOPE_UNREVIEWED/.test(body[0]), '');

  /* CHECK 12 — no forbidden word in any English redaction string. Graded on the
     English because that is what 54 locales render today and what every
     translator will work from. */
  const en = JSON.parse(read('_locales/en/messages.json'));
  const redKeys = Object.keys(en).filter(k => /^redactActs|^review/.test(k));
  const joined = redKeys.map(k => en[k].message).join(' ');
  check('no forbidden word in any English redaction string',
    redKeys.length >= 12 &&
    !/\b(safe|clean|secure|protected|done|nothing to hide)\b/i.test(joined) &&
    !/(^|[.!?]\s+)this page\b/i.test(joined),
    (joined.match(/\b(safe|clean|secure|protected|done)\b/gi) || []).join(',') ||
      redKeys.length + ' keys graded');
  /* And the constraint travels to the translator, who cannot be machine-checked. */
  check('...and every one of them carries the constraint in its description',
    redKeys.filter(k => !/FORBIDDEN|AWAITING-TRANSLATION/.test(en[k].description || '')).length === 0,
    redKeys.filter(k => !/FORBIDDEN|AWAITING-TRANSLATION/.test(en[k].description || '')).join(','));
  check('the retired verdict sentences are gone from the English file, not orphaned',
    !en.resultRedactCoveredOther && !en.resultRedactReadNoMatch && !en.resultRedactUnknown &&
    !en.resultRedactNoCoverableText && !en.resultRedactWhyUncovered, '');
}

console.log('\n=== the seams that keep the envelope honest ===');
{
  const c = stripComments(read('pages/common.js'));
  const rj = stripComments(read('pages/result.js'));
  /* One path in, so a new call site cannot add text that skipped the mask.
     Counting parens was the first shape of this row and it graded the wrong
     thing — a helper's own declaration looks like a call. What matters is that
     the MASKER has exactly one caller: everything foreign then reaches it or
     reaches nothing. */
  const region = builderRegion();
  const uses = (region.match(/takeText/g) || []).length;
  const maskCalls = (region.match(/fsAiMaskText\(/g) || []).length;
  check('every foreign string enters the bundle through one function',
    /function takeText\(/.test(region) && uses >= 6 && maskCalls === 1,
    uses + ' uses of takeText, ' + maskCalls + ' call(s) to the masker');
  check('the builder re-reads its own output before returning it',
    /FS_ENVELOPE_UNREDACTED/.test(c), 'the gate grades the OUTPUT, not the path');
  /* The rectangles must not travel, and the check is on the source as well as
     on the value: a future edit that spreads cap.meta wholesale would pass the
     value check on a fixture with no boxes. */
  check('result.js never spreads the capture meta wholesale onto the record',
    !/meta:\s*cap\.meta\b/.test(rj) && !/\.\.\.cap\.meta/.test(rj),
    'piiBoxes can only travel by being named');
  check('result.js still routes every failure through the one reducer',
    (rj.match(/fsHumanReason\s*\(/g) || []).length === 3, '3 sinks');
  /* The envelope is a payload, not a UI string: it must not be translated, and
     it must not be built out of message lookups. */
  check('the envelope is never localised — it is a payload, not a label',
    builderRegion().length > 500 && !/fsMessage|fsPluralMessage|getMessage/.test(builderRegion()),
    builderRegion().length + ' chars graded');
  /* The spec is the deliverable the siblings read; a code change that leaves it
     behind is the failure mode this row exists for. */
  const spec = safe(() => read('AI-HANDOFF-ENVELOPE.md'), '');
  check('the spec exists and pins the same version string the code emits',
    spec.indexOf('ai-handoff/1.1') > 0 && typeof COMMON.FS_AI_ENVELOPE === 'string' &&
    /^ai-handoff\/\d/.test(COMMON.FS_AI_ENVELOPE) && spec.indexOf(COMMON.FS_AI_ENVELOPE) > 0,
    safe(() => COMMON.FS_AI_ENVELOPE, 'no constant'));
  check('...and it says which parts a sibling tool copies and which it rewrites',
    /SKELETON/.test(spec) && /PRODUCT-SPECIFIC/.test(spec) && /INV-R/.test(spec), '');
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
process.exit(FAILS ? 1 : 0);
})();
