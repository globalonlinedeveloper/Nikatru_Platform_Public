#!/usr/bin/env node
/* FullShot editor sim — loads the REAL pages/editor.js into a node vm behind a
   fake DOM and the pixel-sim rasterizer, drives it with pointer/key/click
   events, and grades the PIXELS it produces. The result-harness.js idiom, one
   layer up: nothing about the editor's geometry, crop math, undo stack or
   export path is re-implemented here — it is the shipped file doing the work.

   What this grades, and why those things:
     - every tool paints where the pointer went, in the chosen colour and width;
     - the crop changes the output DIMENSIONS and shifts the CONTENT by the crop
       origin (the two halves of a crop bug that hide each other);
     - blur/pixelate DESTROYS the underlying pixels, in the export and in the
       saved record — a blur that is only visual is a privacy leak, and privacy
       is this product's whole positioning;
     - undo/redo restores the previous canvas BYTE-IDENTICALLY, crop included;
     - step badges number sequentially and their digits stay legible;
     - display-to-image coordinate mapping survives a scaled view — the classic
       annotation editor bug is ink landing at screen coordinates;
     - export carries the annotations, not the original.

   THE FAKE DOM IS THE BROWSER'S SIDE OF THE CONTRACT. canvas.getBoundingClient-
   Rect() is computed from the CSS width layout() itself set (height:auto keeps
   the aspect), so the display scale the editor reads back is the one it asked
   for — exactly what makes the coordinate-mapping checks real instead of
   circular. Click events bubble target -> ancestors -> document, because the
   toolbar's menu logic is written around stopPropagation() and closest().

   Usage: node test/editor-sim.node.js      [exit 0 = all pass]
   FS_EDITOR=<path> loads a different editor source — that is how the fail-first
   run was done, against a deliberately wrong stub. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeCanvas } = require('./pixel-sim/canvas2d');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..');
const EDITOR_PATH = process.env.FS_EDITOR
  ? path.resolve(process.env.FS_EDITOR) : path.join(ROOT, 'pages', 'editor.js');
const EDITOR_SRC = fs.readFileSync(EDITOR_PATH, 'utf8');
const EDITOR_HTML = fs.readFileSync(path.join(ROOT, 'pages', 'editor.html'), 'utf8');

/* The REAL pages/common.js, loaded as a module. The failure-text checks at the
   bottom of this file grade what the SHIPPED reducer does with a hostile
   message, so a stub would grade the stub. Guarded so a load failure reads as
   one red check instead of killing the tier before the first check runs. */
let COMMON = {};
try { COMMON = require(path.join(ROOT, 'pages', 'common.js')) || {}; }
catch (e) { COMMON = { __loadError: String((e && e.message) || e) }; }

let FAILS = 0, CHECKS = 0;
function check(label, ok, extra) {
  CHECKS++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
/* A scenario that throws must read as one labelled red line, not as a stack
   trace that swallows every check after it. */
async function T(label, fn) {
  try { await fn(); }
  catch (e) { check(label + ' — scenario threw', false, String((e && e.stack) || e).split('\n').slice(0, 2).join(' | ')); }
}

/* ================================================================
   fake DOM
   ================================================================ */

function mkClassList(el) {
  return {
    add: (...n) => n.forEach(c => el._cls.add(c)),
    remove: (...n) => n.forEach(c => el._cls.delete(c)),
    contains: c => el._cls.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !el._cls.has(c) : !!force;
      if (on) el._cls.add(c); else el._cls.delete(c);
      return on;
    }
  };
}

/* Enough selector engine for the four shapes editor.js actually uses:
   '.tool[data-tool]', '.swatch', '#emojiPop', '#moreMenu'. */
function matches(el, sel) {
  let s = String(sel).trim(), attr = null;
  const am = /\[([a-z-]+)\]$/.exec(s);
  if (am) { attr = am[1]; s = s.slice(0, am.index); }
  let ok;
  if (!s) ok = true;
  else if (s[0] === '#') ok = el.id === s.slice(1);
  else if (s[0] === '.') ok = el._cls.has(s.slice(1));
  else ok = el.tagName === s.toUpperCase();
  if (ok && attr) {
    ok = attr.indexOf('data-') === 0
      ? el.dataset[attr.slice(5)] !== undefined : el[attr] !== undefined;
  }
  return ok;
}

class El {
  constructor(tag, id) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.parent = null;
    this.style = {};
    this.dataset = {};
    this._cls = new Set();
    this._on = {};
    this._attr = {};
    this._doc = null;                       // set by buildDom, for activeElement
    this.classList = mkClassList(this);
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.href = '';
    this.title = '';
    this.tabIndex = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
  }
  get className() { return Array.from(this._cls).join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  /* ARIA is the whole point of this pass, so the harness has to be able to
     carry it. `title` stays a property because the shipped code sets it both
     ways; setAttribute('title') keeps the two in step. */
  setAttribute(name, value) {
    const n = String(name).toLowerCase();
    this._attr[n] = String(value);
    if (n === 'title') this.title = String(value);
  }
  getAttribute(name) {
    const n = String(name).toLowerCase();
    if (n === 'title' && this._attr[n] === undefined) return this.title || null;
    return this._attr[n] === undefined ? null : this._attr[n];
  }
  removeAttribute(name) { delete this._attr[String(name).toLowerCase()]; }
  hasAttribute(name) { return this.getAttribute(name) != null; }
  addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const a = this._on[t]; if (!a) return;
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  appendChild(c) { c.parent = this; c._doc = this._doc; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  /* Focus is real here: it moves document.activeElement and fires focus/blur,
     because pages/editor.js now keeps a kbFocus flag from exactly those two
     events and hands focus back and forth between the canvas, the menus and
     the modal. A no-op focus() would grade none of that. */
  focus() {
    const d = this._doc;
    if (d && d.activeElement === this) { this._focused = true; return; }
    if (d && d.activeElement) {
      const prev = d.activeElement;
      d.activeElement = null;
      prev._fireBlur();
    }
    this._focused = true;
    if (d) d.activeElement = this;
    for (const fn of (this._on.focus || []).slice()) fn({ type: 'focus', target: this });
  }
  blur() {
    const d = this._doc;
    if (d && d.activeElement === this) d.activeElement = null;
    this._fireBlur();
  }
  /* The text overlay's dismissal is an .onblur PROPERTY, not a listener, so a
     harness that only walked addEventListener would never commit a caption the
     user typed and then clicked away from — and would then hand the next
     keystroke to a textarea the browser had already left. Both channels fire,
     property last, same as the DOM. */
  _fireBlur() {
    this._focused = false;
    for (const fn of (this._on.blur || []).slice()) fn({ type: 'blur', target: this });
    if (typeof this.onblur === 'function') this.onblur({ type: 'blur', target: this });
  }
  querySelectorAll(sel) {
    const out = [];
    (function walk(n) {
      for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); }
    })(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parent; } return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; }
}

class CanvasEl extends El {
  constructor(id, env) {
    super('canvas', id);
    this._cv = new FakeCanvas();
    this._env = env || null;
    this.dataUrls = [];
  }
  get width() { return this._cv.width; }
  set width(v) { this._cv.width = v; }
  get height() { return this._cv.height; }
  set height(v) { this._cv.height = v; }
  getContext() { return this._cv.getContext('2d'); }
  get _data() { return this._cv._data; }
  get data() { return this._cv._data; }            // image-like source for drawImage
  toDataURL(type, q) { this.dataUrls.push({ type, q }); return 'data:' + (type || 'image/png') + ';base64,'; }
  setPointerCapture() {}
  releasePointerCapture() {}
  /* The browser's side of the deal: the layout box comes from the CSS width
     layout() set, and height:auto keeps the source aspect ratio. */
  getBoundingClientRect() {
    const styleW = parseFloat(this.style.width);
    const w = isFinite(styleW) && styleW > 0 ? styleW : this.width;
    const styleH = parseFloat(this.style.height);
    const h = (this.style.height === 'auto' || !isFinite(styleH))
      ? (this.width ? w * this.height / this.width : this.height) : styleH;
    const L = this._env ? this._env.rectLeft : 0, Tp = this._env ? this._env.rectTop : 0;
    return { left: L, top: Tp, width: w, height: h, right: L + w, bottom: Tp + h, x: L, y: Tp };
  }
}

/* The accessible NAME of each tool button, as pages/editor.html spells it via
   data-i18n-attr="aria-label:…". editor.js reads these back to build its
   announcements ("Rectangle (R) selected, 1 of 3") rather than keeping a second
   copy of the English, so the harness has to carry them or the noun in every
   announcement would be the internal enum. Lifted from the shipped markup at
   load time — a renamed key or a dropped aria-label shows up as a red check
   rather than as a quietly-wrong sentence. */
function toolAriaLabels(html) {
  const out = {};
  const re = /<button[^>]*data-tool="([a-z]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const t = /\stitle="([^"]*)"/.exec(tag);
    const a = /aria-label:([A-Za-z0-9_]+)/.exec(tag);
    out[m[1]] = { title: t ? t[1] : '', ariaKey: a ? a[1] : null };
  }
  return out;
}
const TOOL_ARIA = toolAriaLabels(EDITOR_HTML);

/* pages/editor.html is the source of truth for the ARIA the MARKUP declares;
   editor.js only ever flips it afterwards. Copying the shipped values onto the
   fake elements is what makes "the trigger starts collapsed and ends collapsed"
   a round trip rather than a check on a value the harness invented — and a
   dropped attribute in the markup shows up here as well as in the static
   section at the bottom. */
const MIRRORED_ARIA = ['aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-pressed', 'role'];
function mirrorShippedAria(el, id) {
  const tag = new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*>', 'i').exec(EDITOR_HTML);
  if (!tag) return;
  for (const name of MIRRORED_ARIA) {
    const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag[0]);
    if (m) el.setAttribute(name, m[1]);
  }
}

/* The element tree of pages/editor.html, ids and nesting included — nesting is
   load-bearing because the menu handlers use closest() and stopPropagation(). */
function buildDom(env) {
  const root = new El('body', 'body');
  root._doc = env.focus;
  const byId = new Map();
  const mk = (tag, id, parent, cls) => {
    const e = new El(tag, id);
    e._doc = env.focus;
    if (cls) e.className = cls;
    (parent || root).appendChild(e);
    if (id) { byId.set(id, e); mirrorShippedAria(e, id); }
    return e;
  };

  const toolbar = mk('div', '', root, 'toolbar');
  mk('a', 'backBtn', toolbar, 'btn icon');

  const g1 = mk('div', '', toolbar, 'tgroup');
  const g2 = mk('div', '', toolbar, 'tgroup');
  const TOOLS = [['select', g1], ['crop', g1], ['pen', g2], ['hl', g2], ['line', g2],
                 ['arrow', g2], ['rect', g2], ['ellipse', g2], ['text', g2], ['blur', g2],
                 ['num', g2], ['emoji', g2]];
  for (const [name, g] of TOOLS) {
    const b = mk('button', name === 'emoji' ? 'emojiToolBtn' : '', g,
      'tool' + (name === 'pen' ? ' active' : ''));
    b.dataset.tool = name;
    const aria = TOOL_ARIA[name] || {};
    b.title = aria.title || name;
    // The browser's side of the deal: pages/common.js has already substituted
    // the key by the time boot() runs, so the attribute holds text, not a key.
    if (aria.ariaKey) b.setAttribute('aria-label', aria.title || name);
    env.toolBtns[name] = b;
  }

  mk('div', 'colors', toolbar, 'tgroup');
  mk('input', 'customColor', toolbar);
  const sSel = mk('select', 'strokeSel', toolbar, 'ctl'); sSel.value = '4';
  const zSel = mk('select', 'sizeSel', toolbar, 'ctl'); zSel.value = '28';

  const g3 = mk('div', '', toolbar, 'tgroup');
  mk('button', 'undoBtn', g3, 'tool');
  mk('button', 'redoBtn', g3, 'tool');
  const g4 = mk('div', '', toolbar, 'tgroup');
  mk('button', 'zoomOutBtn', g4, 'tool');
  mk('button', 'zoomBtn', g4, 'tool');
  mk('button', 'zoomInBtn', g4, 'tool');

  const exWrap = mk('div', '', toolbar);
  mk('button', 'exportBtn', exWrap, 'btn');
  const exMenu = mk('div', 'exportMenu', exWrap);
  ['copyBtn', 'pngBtn', 'jpgBtn', 'webpBtn', 'pdfBtn'].forEach(id => mk('button', id, exMenu));
  mk('button', 'saveBtn', toolbar, 'btn primary');
  const moreWrap = mk('div', '', toolbar);
  mk('button', 'moreBtn', moreWrap, 'btn icon');
  const moreMenu = mk('div', 'moreMenu', moreWrap);
  ['mFiles', 'mOptions', 'mShortcuts'].forEach(id => mk('button', id, moreMenu));
  mk('button', 'themeBtn', toolbar, 'btn icon');

  mk('div', 'loading', root);
  const stage = mk('div', 'stage', root);
  stage.hidden = true;
  stage.clientWidth = env.stageW;
  stage.clientHeight = env.stageH;
  const wrap = mk('div', 'canvasWrap', stage);

  const canvas = new CanvasEl('canvas', env);
  canvas._doc = env.focus;
  wrap.appendChild(canvas);
  byId.set('canvas', canvas);
  mk('textarea', 'textInput', wrap);
  mk('div', 'emojiPop', wrap);

  mk('p', 'a11yStatus', root, 'sr-only');

  const cropBar = mk('div', 'cropBar', root);
  mk('button', 'cropApply', cropBar, 'btn primary');
  mk('button', 'cropCancel', cropBar, 'btn');

  const shortcuts = mk('div', 'shortcutsPop', root);
  const box = mk('div', '', shortcuts, 'box');
  mk('h3', 'shortcutsHeading', box);
  mk('table', 'shortcutsTable', box);
  mk('button', 'shortcutsClose', box, 'btn');

  return { root, byId, canvas };
}

/* ================================================================
   pixels
   ================================================================ */

/* Positional fingerprint: (37x+11y, 101x+196y) mod 256 has an ODD determinant
   (6141), so the (R,G) pair of a pixel identifies its (x,y) uniquely inside any
   256x256 window. A crop that lands one pixel off is therefore visible, and any
   region has as many distinct colours as it has pixels — which is what makes the
   blur's colour collapse measurable. B is pinned at 200, a value no annotation
   colour or blend of one produces, so "differs from the base" never fires on a
   coincidence. */
const PAT = (x, y) => [(37 * x + 11 * y) & 255, (101 * x + 196 * y) & 255, 200];

function makeBlob(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y), o = (y * w + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  return { __w: w, __h: h, __data: d, size: w * h * 4 };
}
function at(data, w, x, y) {
  const o = (y * w + x) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isRGB = (p, rgb) => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
function hash(data) {                              // FNV-1a, exact-equality proxy
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}
function distinctColors(data, w, x0, y0, rw, rh) {
  const s = new Set();
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const o = (y * w + x) * 4;
      s.add((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
    }
  }
  return s.size;
}
/* fraction of a region whose pixels no longer match the source image */
function changedFraction(data, w, base, bw, x0, y0, rw, rh, ox, oy) {
  let n = 0;
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      if (!same(at(data, w, x, y), at(base, bw, x + (ox || 0), y + (oy || 0)))) n++;
    }
  }
  return n / (rw * rh);
}

const RED = [239, 68, 68];        // COLORS[0]
const BLUE = [59, 130, 246];      // COLORS[3] = #3b82f6
const SELBOX = [79, 70, 229];     // #4f46e5

/* ================================================================
   boot the real editor
   ================================================================ */

async function boot(opts) {
  const o = Object.assign({
    w: 400, h: 300, stageW: 4000, stageH: 4000, rectLeft: 0, rectTop: 0,
    shotId: 'shot-1', seg: 0, format: 'png', segs: 1, pattern: PAT,
    title: 'Example Page', url: 'https://example.com/a'
  }, opts || {});

  const env = {
    stageW: o.stageW, stageH: o.stageH, rectLeft: o.rectLeft, rectTop: o.rectTop,
    /* One shared focus registry, handed to every element the harness makes.
       El.focus() moves it and fires blur on whoever held it, which is what
       makes "Escape hands focus back to the More button" a measurable claim
       rather than a comment. */
    focus: { activeElement: null },
    toolBtns: {}, docOn: {}, winOn: {}, domReady: null,
    requestedIds: new Set(), missingIds: [], forbidden: [], network: [],
    toasts: [], downloads: [], copies: [], pdfs: [], calls: [], filenames: [],
    blobs: [], db: { shots: new Map() }
  };

  const dom = buildDom(env);
  const baseBlob = makeBlob(o.w, o.h, o.pattern);
  const segments = [];
  for (let i = 0; i < o.segs; i++) {
    segments.push({ blob: i === 0 ? baseBlob : makeBlob(20, 20, o.pattern), w: o.w, h: o.h });
  }
  const shot = {
    id: 'shot-1', title: o.title, url: o.url, format: o.format,
    w: o.w, h: o.h, segments, created: 1
  };
  env.db.shots.set(shot.id, shot);

  const doc = {
    body: dom.root,
    /* The direction the surrounding chrome is painted in. Set by
       pages/common.js from @@bidi_dir in the real product; here it exists so a
       check can force it to 'rtl' and prove the canvas geometry does not care. */
    documentElement: { dir: o.dir || 'ltr', lang: 'en', dataset: {}, style: {} },
    get activeElement() { return env.focus.activeElement; },
    addEventListener(t, fn) {
      if (t === 'DOMContentLoaded') env.domReady = fn;
      else (env.docOn[t] = env.docOn[t] || []).push(fn);
    },
    removeEventListener() {},
    getElementById(id) {
      env.requestedIds.add(id);
      const el = dom.byId.get(id);
      if (!el) { env.missingIds.push(id); return null; }
      return el;
    },
    createElement(tag) {
      const e = String(tag).toLowerCase() === 'canvas' ? new CanvasEl('', env) : new El(tag);
      e._doc = env.focus;
      return e;
    },
    querySelectorAll: sel => dom.root.querySelectorAll(sel),
    querySelector: sel => dom.root.querySelector(sel)
  };

  const sandbox = {
    console, setTimeout, clearTimeout, queueMicrotask,
    document: doc,
    location: { search: o.shotId ? '?shot=' + o.shotId + '&seg=' + o.seg : '', href: 'x/editor.html' },
    URLSearchParams,
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    confirm: () => true,                  // U-3 will add one; answering yes keeps these checks meaningful
    alert: () => {},
    addEventListener(t, fn) { (env.winOn[t] = env.winOn[t] || []).push(fn); },
    removeEventListener() {},
    chrome: {
      runtime: { openOptionsPage() { env.calls.push('openOptionsPage'); } },
      get downloads() { env.forbidden.push('downloads'); return {}; },
      get storage() { env.forbidden.push('storage'); return {}; },
      get tabs() { env.forbidden.push('tabs'); return {}; },
      get scripting() { env.forbidden.push('scripting'); return {}; }
    },
    fetch() { env.network.push('fetch'); throw new Error('no network in FullShot'); },
    XMLHttpRequest: function () { env.network.push('xhr'); throw new Error('no network in FullShot'); },
    WebSocket: function () { env.network.push('ws'); throw new Error('no network in FullShot'); },
    FSDB: {
      async get(store, key) { return env.db[store] ? env.db[store].get(key) : undefined; },
      async put(store, value) { env.calls.push('db.put:' + store); env.db[store].set(value.id, value); },
      async delete() {}, async getFrames() { return []; },
      frameKey: (c, i) => c + ':' + i
    },
    createImageBitmap: async blob => ({ width: blob.__w, height: blob.__h, data: blob.__data, close() {} }),
    fsGetSettings: async () => ({
      imageFormat: 'png', jpegQuality: 0.92, clipboardFit: true, theme: 'light',
      filenameTemplate: '{domain}-{date}'
    }),
    fsToggleTheme() { env.calls.push('toggleTheme'); },
    fsToast(m) { env.toasts.push(m); },
    fsMime: f => f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png',
    fsExt: f => f === 'jpeg' ? '.jpg' : f === 'webp' ? '.webp' : '.png',
    fsFormatBytes: n => n + ' B',
    fsBuildFilename: (tpl, info) => { env.filenames.push(info); return 'fullshot'; },
    fsCanvasToBlob: async (c, type, quality) => {
      const b = { __w: c.width, __h: c.height, __data: c._data.slice(), type, quality, size: c.width * c.height * 4 };
      env.blobs.push(b);
      return b;
    },
    fsDownloadBlob: async (blob, name) => { env.downloads.push({ blob, name }); },
    /* The clipboard write is the one step in the editor's export path that can
       reject with text nobody in this project wrote — navigator.clipboard is
       the engine's, not ours. o.clipboardError injects exactly that. */
    fsCopyBlobToClipboard: async (blob, fit) => {
      env.copies.push({ blob, fit });
      if (o.clipboardError !== undefined) throw o.clipboardError;
    },
    /* The real reducer, for the same reason COMMON is loaded at all. */
    fsHumanReason: (...a) => COMMON.fsHumanReason.apply(null, a),
    FSPDF: {
      PAPERS: { a4: [595, 842], letter: [612, 792], legal: [612, 1008] },
      build: (pages, meta) => { env.pdfs.push({ pages, meta }); return { size: 9, type: 'application/pdf' }; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(EDITOR_SRC, sandbox, { filename: 'editor.js' });
  if (!env.domReady) throw new Error('editor.js never registered DOMContentLoaded');
  await env.domReady();

  const cv = dom.canvas;
  function mkEvent(extra) {
    const ev = Object.assign({
      type: '', target: dom.root, button: 0, pointerId: 1,
      ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      _stopped: false, _prevented: false,
      stopPropagation() { this._stopped = true; },
      preventDefault() { this._prevented = true; }
    }, extra || {});
    return ev;
  }
  function fireList(list, ev, out) { for (const fn of (list || []).slice()) out.push(fn(ev)); }

  const ed = {
    env, dom, shot, cv, base: baseBlob,
    baseW: o.w, baseH: o.h, baseData: baseBlob.__data,
    cropX: 0, cropY: 0,

    el: id => dom.byId.get(id),
    async settle() { await new Promise(r => setTimeout(r, 0)); await Promise.resolve(); },

    /* click bubbles target -> ancestors -> document, and awaits any promise a
       handler returns (the export buttons are async). */
    async click(idOrEl) {
      const el = typeof idOrEl === 'string' ? (dom.byId.get(idOrEl) || env.toolBtns[idOrEl]) : idOrEl;
      if (!el) throw new Error('no such element: ' + idOrEl);
      /* A pointer press moves focus BEFORE the click fires, which is the only
         reason clicking the zoom button while the caption overlay is open ends
         the caption. A harness that skipped this left focus parked on a
         display:none textarea and every later keystroke was swallowed by the
         editor's "don't steal keys from the text field" guard. */
      el.focus();
      const ev = mkEvent({ type: 'click', target: el });
      const out = [];
      let n = el;
      while (n && !ev._stopped) { fireList(n._on.click, ev, out); n = n.parent; }
      if (!ev._stopped) fireList(env.docOn.click, ev, out);
      await Promise.all(out.filter(r => r && typeof r.then === 'function'));
      await ed.settle();
    },
    async key(k, mods) {
      const ev = mkEvent(Object.assign({ type: 'keydown', key: k, target: env.focus.activeElement || dom.root }, mods || {}));
      const out = [];
      fireList(env.docOn.keydown, ev, out);
      await Promise.all(out.filter(r => r && typeof r.then === 'function'));
      await ed.settle();
      return ev;
    },
    /* A keydown that starts at a specific element and BUBBLES, which is how the
       colour radiogroup and the two menu sheets actually receive theirs. The
       document handler is last in line, exactly as in the browser, so a check
       can prove the group consumes the arrow instead of letting it fall through
       to the canvas. */
    async keyOn(idOrEl, k, mods) {
      const el = typeof idOrEl === 'string' ? (dom.byId.get(idOrEl) || env.toolBtns[idOrEl]) : idOrEl;
      if (!el) throw new Error('no such element: ' + idOrEl);
      const ev = mkEvent(Object.assign({ type: 'keydown', key: k, target: el }, mods || {}));
      const out = [];
      let n = el;
      while (n && !ev._stopped) { fireList(n._on.keydown, ev, out); n = n.parent; }
      if (!ev._stopped) fireList(env.docOn.keydown, ev, out);
      await Promise.all(out.filter(r => r && typeof r.then === 'function'));
      await ed.settle();
      return ev;
    },
    focus(idOrEl) {
      const el = typeof idOrEl === 'string' ? (dom.byId.get(idOrEl) || env.toolBtns[idOrEl]) : idOrEl;
      if (!el) throw new Error('no such element: ' + idOrEl);
      el.focus();
      return el;
    },
    active: () => env.focus.activeElement,
    activeId: () => (env.focus.activeElement && env.focus.activeElement.id) || '',
    said: () => (dom.byId.get('a11yStatus') || {}).textContent || '',
    attr: (idOrEl, name) => {
      const el = typeof idOrEl === 'string' ? (dom.byId.get(idOrEl) || env.toolBtns[idOrEl]) : idOrEl;
      return el && el.getAttribute ? el.getAttribute(name) : null;
    },
    change(id, value) {
      const el = dom.byId.get(id);
      el.value = String(value);
      const out = [];
      fireList(el._on.change, mkEvent({ type: 'change', target: el }), out);
    },
    input(id, value) {
      const el = dom.byId.get(id);
      el.value = String(value);
      const out = [];
      fireList(el._on.input, mkEvent({ type: 'input', target: el }), out);
    },
    tool(t) { return ed.click(env.toolBtns[t]); },

    down(x, y) { const out = []; fireList(cv._on.pointerdown, mkEvent({ type: 'pointerdown', target: cv, clientX: x, clientY: y }), out); },
    move(x, y) { const out = []; fireList(cv._on.pointermove, mkEvent({ type: 'pointermove', target: cv, clientX: x, clientY: y }), out); },
    up() { const out = []; fireList(env.winOn.pointerup, mkEvent({ type: 'pointerup', target: cv }), out); },
    drag(pts) {
      ed.down(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ed.move(pts[i][0], pts[i][1]);
      ed.up();
    },
    resize() { const out = []; fireList(env.winOn.resize, mkEvent({ type: 'resize' }), out); },
    /* the textarea overlay: value in, Enter commits (Escape abandons) */
    type(text, key) {
      const input = dom.byId.get('textInput');
      input.value = text;
      if (input.onkeydown) {
        input.onkeydown(mkEvent({ type: 'keydown', target: input, key: key || 'Enter' }));
      }
    },
    setCrop(x, y) { ed.cropX = x; ed.cropY = y; },

    px: (x, y) => at(cv._data, cv.width, x, y),
    basePx: (x, y) => at(baseBlob.__data, o.w, x, y),
    changed(x, y) { return !same(ed.px(x, y), ed.basePx(x + ed.cropX, y + ed.cropY)); },
    changedCols(y, x0, x1) { let n = 0; for (let x = x0; x < x1; x++) if (ed.changed(x, y)) n++; return n; },
    changedRows(x, y0, y1) { let n = 0; for (let y = y0; y < y1; y++) if (ed.changed(x, y)) n++; return n; },
    hash: () => hash(cv._data),
    /* the white ink of a step badge, as a bitmap relative to its centre */
    whiteMap(cx, cy, r) {
      const rows = [];
      for (let y = cy - r; y <= cy + r; y++) {
        let line = '';
        for (let x = cx - r; x <= cx + r; x++) line += isRGB(ed.px(x, y), [255, 255, 255]) ? '#' : '.';
        rows.push(line);
      }
      return rows.join('\n');
    },
    whiteCount(cx, cy, r) {
      let n = 0;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (isRGB(ed.px(x, y), [255, 255, 255])) n++;
      }
      return n;
    }
  };
  return ed;
}

/* ================================================================ */

(async () => {

/* ================= 1 · boot ================= */
console.log('\n=== editor: boot ===');

await T('boot', async () => {
  const ed = await boot();
  check('the stage is revealed and the spinner hidden',
    ed.el('loading').hidden === true && ed.el('stage').hidden === false,
    ed.el('loading').hidden + ' / ' + ed.el('stage').hidden);
  check('the canvas is sized to the source image',
    ed.cv.width === 400 && ed.cv.height === 300, ed.cv.width + 'x' + ed.cv.height);
  check('the base image is blitted 1:1',
    same(ed.px(0, 0), ed.basePx(0, 0)) && same(ed.px(399, 299), ed.basePx(399, 299)) &&
    same(ed.px(137, 201), ed.basePx(137, 201)), ed.px(137, 201).join(','));
  check('an image that fits is displayed at 100%',
    ed.cv.style.width === '400px' && ed.el('zoomBtn').textContent === '100%',
    ed.cv.style.width + ' / ' + ed.el('zoomBtn').textContent);
  check('the back link points at this shot on the result page',
    ed.el('backBtn').href === 'result.html?shot=shot-1', ed.el('backBtn').href);
  check('undo is disabled with only the initial state on the stack',
    ed.el('undoBtn').disabled === true && ed.el('undoBtn').textContent === '↶ (0)',
    ed.el('undoBtn').disabled + ' / ' + ed.el('undoBtn').textContent);
  check('redo is disabled at boot',
    ed.el('redoBtn').disabled === true && ed.el('redoBtn').textContent === '↷ (0)',
    ed.el('redoBtn').disabled + ' / ' + ed.el('redoBtn').textContent);
  check('every element id editor.js asks for exists in pages/editor.html',
    Array.from(ed.env.requestedIds).every(id => EDITOR_HTML.indexOf('id="' + id + '"') >= 0),
    Array.from(ed.env.requestedIds).filter(id => EDITOR_HTML.indexOf('id="' + id + '"') < 0).join(',') || 'all present');
  check('the harness provided every element it asked for',
    ed.env.missingIds.length === 0, ed.env.missingIds.join(','));
});

await T('boot: no shot', async () => {
  const ed = await boot({ shotId: '' });
  check('a missing shot shows the not-found panel and leaves the stage hidden',
    /Screenshot not found/.test(ed.el('loading').innerHTML) && ed.el('stage').hidden === true,
    ed.el('stage').hidden);
  check('a missing shot draws nothing on the canvas',
    ed.cv.width === 0 && ed.cv.height === 0, ed.cv.width + 'x' + ed.cv.height);
});

/* ================= 2 · every tool paints where the pointer went ================= */
console.log('\n=== editor: tools paint at the pointer, in the chosen colour and width ===');

await T('pen', async () => {
  const ed = await boot();
  await ed.tool('pen');
  ed.drag([[60, 100], [140, 100], [200, 160]]);
  check('pen inks the first leg', ed.changed(100, 100), ed.px(100, 100).join(','));
  check('pen inks the second leg', ed.changed(170, 130), ed.px(170, 130).join(','));
  check('pen paints in the active colour', isRGB(ed.px(100, 100), RED), ed.px(100, 100).join(','));
  check('pen honours the default stroke width of 4', ed.changedRows(100, 90, 112) === 4,
    ed.changedRows(100, 90, 112));
  check('pen leaves the rest of the image untouched',
    !ed.changed(300, 250) && !ed.changed(20, 20), '');
  check('a pen stroke starts at the pointer, not before it',
    ed.changed(61, 100) && !ed.changed(56, 100), '');
});

await T('highlighter', async () => {
  const ed = await boot();
  await ed.tool('hl');
  ed.drag([[60, 100], [140, 100]]);
  const p = ed.px(100, 100);
  check('the highlighter is translucent, not opaque',
    p[2] === 154 && !isRGB(p, RED), p.join(','));   // 0.35*68 + 0.65*200 = 153.8
  check('the highlighter widens to max(14, stroke*4) = 16',
    ed.changedRows(100, 85, 115) === 16, ed.changedRows(100, 85, 115));
  check('the highlighter uses a butt cap (no round overhang)',
    ed.changed(60, 100) && !ed.changed(58, 100), '');
});

await T('line + stroke width + colour', async () => {
  const ed = await boot();
  await ed.tool('line');
  ed.change('strokeSel', 7);
  await ed.click(ed.el('colors').children[3]);      // COLORS[3] = #3b82f6
  ed.drag([[60, 100], [300, 100]]);
  check('a line is drawn between the two pointer positions',
    ed.changed(180, 100) && !ed.changed(320, 100), '');
  check('the line takes the colour picked from the swatch bar',
    isRGB(ed.px(180, 100), BLUE), ed.px(180, 100).join(','));
  check('the line takes the width picked from the stroke select',
    ed.changedRows(180, 90, 112) === 7, ed.changedRows(180, 90, 112));
  check('a swatch click marks itself active and clears the others',
    ed.el('colors').children[3].classList.contains('active') &&
    !ed.el('colors').children[0].classList.contains('active'), '');
});

await T('custom colour', async () => {
  const ed = await boot();
  await ed.tool('line');
  ed.input('customColor', '#00ff7f');
  ed.drag([[60, 100], [300, 100]]);
  check('the custom colour input feeds the next object',
    isRGB(ed.px(180, 100), [0, 255, 127]), ed.px(180, 100).join(','));
});

await T('arrow', async () => {
  const ed = await boot();
  await ed.tool('arrow');
  ed.drag([[60, 60], [200, 160]]);
  check('the arrow shaft runs between the two pointer positions', ed.changed(130, 110), '');
  // (193,151) sits 3.1px off the shaft axis and 11px from the tip: only a
  // FILLED head can reach it.
  check('the arrow has a filled head at the release point', ed.changed(193, 151),
    ed.px(193, 151).join(','));
  check('the arrow head is not painted at the start point', !ed.changed(52, 54), '');
});

await T('rect', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [150, 150], [200, 200]]);
  check('the rectangle top edge lands on the drag origin',
    ed.changed(150, 100) && ed.changed(150, 98) && !ed.changed(150, 96), '');
  check('the rectangle bottom edge lands on the release point',
    ed.changed(150, 199) && !ed.changed(150, 204), '');
  check('the rectangle left and right edges land on the drag x range',
    ed.changed(100, 150) && ed.changed(199, 150) && !ed.changed(96, 150), '');
  check('the rectangle is a hollow frame, not a fill', !ed.changed(150, 150), '');
  check('the rectangle edge is stroke-width thick', ed.changedRows(150, 90, 110) === 4,
    ed.changedRows(150, 90, 110));
});

await T('ellipse', async () => {
  const ed = await boot();
  await ed.tool('ellipse');
  ed.drag([[100, 100], [200, 180]]);
  check('the ellipse touches the top of the drag box', ed.changed(150, 100), '');
  check('the ellipse touches the left of the drag box', ed.changed(100, 140), '');
  check('the ellipse is a hollow ring', !ed.changed(150, 140), '');
  check('the ellipse stays inside its drag box corners', !ed.changed(102, 102), '');
});

await T('a drag too tiny to be an object is discarded', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('rect');
  ed.drag([[100, 100], [101, 101]]);
  check('a 1px rectangle drag leaves no object behind', ed.hash() === h0, ed.hash() + ' vs ' + h0);
  check('...and does not push an undo state', ed.el('undoBtn').disabled === true, '');
});

/* ================= 3 · text ================= */
console.log('\n=== editor: text tool ===');

await T('text', async () => {
  const ed = await boot();
  await ed.tool('text');
  ed.down(80, 120);
  const input = ed.el('textInput');
  check('the text overlay opens at the pointer, in image coordinates',
    input.style.display === 'block' && input.style.left === '80px' && input.style.top === '120px',
    input.style.left + ',' + input.style.top);
  check('the text overlay is sized and coloured like the object it will make',
    input.style.fontSize === '28px' && input.style.color === '#ef4444',
    input.style.fontSize + ' / ' + input.style.color);
  ed.type('AB');
  // textBaseline 'top': the ink hangs BELOW the click, starting 0.1em down.
  check('the committed text hangs below the click point, not centred on it',
    ed.changedCols(121, 78, 120) === 0 && ed.changedCols(126, 78, 120) > 0,
    ed.changedCols(121, 78, 120) + ' / ' + ed.changedCols(126, 78, 120));
  check('the text paints in the active colour',
    isRGB(ed.px(88, 124), RED) || isRGB(ed.px(89, 125), RED),
    ed.px(88, 124).join(',') + ' / ' + ed.px(89, 125).join(','));
  check('nothing is painted above the click point', ed.changedCols(118, 60, 140) === 0,
    ed.changedCols(118, 60, 140));
  check('nothing is painted left of the click point', ed.changedRows(78, 110, 160) === 0,
    ed.changedRows(78, 110, 160));
  check('the overlay hides itself once committed', input.style.display === 'none', input.style.display);
});

await T('text: multi-line + empty', async () => {
  const ed = await boot();
  await ed.tool('text');
  ed.down(80, 120);
  ed.type('AB\nCD');
  check('a two-line string paints two lines', ed.changedCols(126, 78, 130) > 0 &&
    ed.changedCols(162, 78, 130) > 0, ed.changedCols(126, 78, 130) + ' / ' + ed.changedCols(162, 78, 130));
  check('the line gap follows size*1.25 and stays clean',
    ed.changedCols(150, 78, 130) === 0, ed.changedCols(150, 78, 130));

  const h = ed.hash();
  ed.down(200, 200);
  ed.type('   ');
  check('an all-whitespace entry commits no object', ed.hash() === h, '');

  ed.down(220, 220);
  const input = ed.el('textInput');
  input.value = 'ZZ';
  input.onkeydown({ key: 'Escape', shiftKey: false, preventDefault() {}, stopPropagation() {} });
  check('Escape abandons the text entry', ed.hash() === h && input.style.display === 'none', '');
});

/* ================= 4 · step badges ================= */
console.log('\n=== editor: numbered step badges ===');

await T('badges', async () => {
  const ed = await boot({ w: 400, h: 200 });
  await ed.tool('num');
  ed.down(100, 100); ed.down(200, 100); ed.down(300, 100);
  check('three clicks leave three badges',
    ed.changed(100, 100) && ed.changed(200, 100) && ed.changed(300, 100), '');
  check('the badge disc is filled in the active colour', isRGB(ed.px(100, 85), RED),
    ed.px(100, 85).join(','));
  check('the badge disc is r = size*0.8 across',
    ed.changed(100, 79) && !ed.changed(100, 74), '');       // r = 22.4
  check('the badge is rimmed in near-white so it reads on any background',
    ed.px(100, 77)[0] >= 220 && ed.px(100, 77)[1] >= 220 && ed.px(100, 77)[2] >= 220,
    ed.px(100, 77).join(','));
  check('the digit is painted white on the disc — legible',
    isRGB(ed.px(100, 94), [255, 255, 255]), ed.px(100, 94).join(','));

  const m1 = ed.whiteMap(100, 100, 14), m2 = ed.whiteMap(200, 100, 14), m3 = ed.whiteMap(300, 100, 14);
  check('badge 1 and badge 2 render different digits', m1 !== m2, '');
  check('badge 2 and badge 3 render different digits', m2 !== m3, '');
  check('badge 1 and badge 3 render different digits', m1 !== m3, '');
  check("the '1' carries less ink than the '2' — the digits are shapes, not blobs",
    ed.whiteCount(100, 100, 14) < ed.whiteCount(200, 100, 14),
    ed.whiteCount(100, 100, 14) + ' vs ' + ed.whiteCount(200, 100, 14));
  check('every white digit pixel sits inside its disc (nothing clipped)',
    (() => {
      for (let y = 100 - 25; y <= 100 + 25; y++) for (let x = 100 - 25; x <= 100 + 25; x++) {
        if (isRGB(ed.px(x, y), [255, 255, 255]) && Math.hypot(x - 100, y - 100) > 22.4) return false;
      }
      return true;
    })(), '');
});

await T('badges: the counter really counts', async () => {
  const ed = await boot({ w: 560, h: 140 });
  await ed.tool('num');
  for (let i = 0; i < 10; i++) ed.down(30 + i * 52, 70);
  // A two-digit badge is drawn at 0.95em over two 0.6em advances: its ink
  // reaches +/-11.5px from the centre, a single digit's only +/-6.5px.
  const tenth = 30 + 9 * 52;
  check('the tenth badge is a two-digit number',
    ed.whiteCount(tenth - 11, 70, 2) > 0 && ed.whiteCount(tenth + 11, 70, 2) > 0,
    ed.whiteCount(tenth - 11, 70, 2) + ' / ' + ed.whiteCount(tenth + 11, 70, 2));
  check('the first badge is still a single digit',
    ed.whiteCount(30 - 11, 70, 2) === 0, ed.whiteCount(30 - 11, 70, 2));
});

await T('badges: numbering continues from the highest', async () => {
  const ed = await boot({ w: 400, h: 300 });
  await ed.tool('num');
  ed.down(100, 100); ed.down(200, 100); ed.down(300, 100);
  const two = ed.whiteMap(200, 100, 14), three = ed.whiteMap(300, 100, 14);
  await ed.key('z', { ctrlKey: true });
  await ed.key('z', { ctrlKey: true });            // back to a single badge
  ed.down(200, 220);
  check('after undoing to one badge the next one is numbered 2 again',
    ed.whiteMap(200, 220, 14) === two, '');
  check('...and is definitely not still numbered 3',
    ed.whiteMap(200, 220, 14) !== three, '');
});

/* ================= 5 · emoji stamp ================= */
console.log('\n=== editor: emoji stamp ===');

await T('emoji', async () => {
  const ed = await boot();
  await ed.key('e');
  ed.down(150, 150);
  // Colour is deliberately NOT graded: Chrome paints a colour-emoji glyph from
  // the font, ignoring fillStyle, so any colour assertion here would be a fact
  // about the sim's block font and not about the product.
  check('the emoji stamps at the click point', ed.changed(150, 150), '');
  check('the emoji is centred on the click, not hung off it',
    ed.changed(140, 150) && ed.changed(160, 150) && !ed.changed(134, 150) && !ed.changed(166, 150), '');
  check('the emoji is size*1.6 tall',            // 28*1.6 = 44.8 -> ink box 31.4 rows
    ed.changedRows(150, 120, 180) >= 30 && ed.changedRows(150, 120, 180) <= 33,
    ed.changedRows(150, 120, 180));
});

await T('emoji: size follows the size select', async () => {
  const ed = await boot();
  await ed.key('e');
  ed.change('sizeSel', 72);
  ed.down(200, 150);
  check('a larger size select makes a larger stamp',   // 72*1.6 = 115.2 -> 57.6 cols
    ed.changedCols(150, 120, 280) >= 56 && ed.changedCols(150, 120, 280) <= 59,
    ed.changedCols(150, 120, 280));
});

await T('emoji: the picker', async () => {
  const ed = await boot();
  await ed.click('emojiToolBtn');                 // first click selects the tool
  check('the first click on the emoji button selects the tool without opening the picker',
    ed.el('emojiPop').classList.contains('show') === false, '');
  await ed.click('emojiToolBtn');                 // second click opens the picker
  check('a second click opens the emoji picker', ed.el('emojiPop').classList.contains('show'), '');
  const pick = ed.el('emojiPop').children[14];    // EMOJIS[14] = fire
  await ed.click(pick);
  check('picking an emoji closes the picker', !ed.el('emojiPop').classList.contains('show'), '');
  check('picking an emoji shows it on the tool button',
    ed.el('emojiToolBtn').textContent === '\u{1F525}', ed.el('emojiToolBtn').textContent);
  ed.down(150, 150);
  check('the picked emoji stamps', ed.changed(150, 150), '');
});

/* ================= 6 · blur destroys pixels (privacy) ================= */
console.log('\n=== editor: blur/pixelate destroys the underlying pixels ===');

await T('blur', async () => {
  const ed = await boot();
  const R = { x: 60, y: 40, w: 60, h: 40 };
  const before = distinctColors(ed.baseData, ed.baseW, R.x, R.y, R.w, R.h);
  await ed.tool('blur');
  ed.drag([[R.x, R.y], [100, 60], [R.x + R.w, R.y + R.h]]);

  const after = distinctColors(ed.cv._data, ed.cv.width, R.x, R.y, R.w, R.h);
  // px = max(6, round(min(60,40)/10)) = 6 -> a 10x7 sample grid = 70 blocks.
  check('the region starts out with one distinct colour per pixel',
    before === R.w * R.h, before + ' of ' + (R.w * R.h));
  check('blur collapses the region to at most one colour per sample block',
    after <= 70 && after > 1, after + ' distinct colours (was ' + before + ')');
  const frac = changedFraction(ed.cv._data, ed.cv.width, ed.baseData, ed.baseW, R.x, R.y, R.w, R.h, 0, 0);
  check('blur moves the overwhelming majority of the region off its true value',
    frac >= 0.9, (frac * 100).toFixed(1) + '% changed');
  check('a whole sample block is one flat colour — information is gone, not shuffled',
    (() => {
      const p = ed.px(60, 40);
      for (let y = 40; y <= 45; y++) for (let x = 60; x <= 65; x++) if (!same(ed.px(x, y), p)) return false;
      return true;
    })(), '');
  check('blur does not bleed outside the drag box',
    !ed.changed(59, 60) && !ed.changed(120, 60) && !ed.changed(90, 39) && !ed.changed(90, 80), '');
});

await T('blur: the export and the saved record are destroyed too', async () => {
  const ed = await boot();
  const R = { x: 60, y: 40, w: 60, h: 40 };
  await ed.tool('blur');
  ed.drag([[R.x, R.y], [R.x + R.w, R.y + R.h]]);

  await ed.click('pngBtn');
  const dl = ed.env.downloads[0];
  check('a download was produced', !!dl, ed.env.downloads.length);
  if (dl) {
    const d = distinctColors(dl.blob.__data, dl.blob.__w, R.x, R.y, R.w, R.h);
    check('the EXPORTED image carries the destruction, not just the screen',
      d <= 70 && d > 1, d + ' distinct colours in the exported region');
    const frac = changedFraction(dl.blob.__data, dl.blob.__w, ed.baseData, ed.baseW, R.x, R.y, R.w, R.h, 0, 0);
    check('the exported region cannot be read back as the original',
      frac >= 0.9, (frac * 100).toFixed(1) + '% changed');
  }
  await ed.click('saveBtn');
  const rec = ed.env.db.shots.get('shot-1');
  const seg = rec && rec.segments[0];
  check('a save wrote the shot back', !!(seg && seg.blob && seg.blob.__data), '');
  if (seg && seg.blob && seg.blob.__data) {
    const d = distinctColors(seg.blob.__data, seg.blob.__w, R.x, R.y, R.w, R.h);
    check('the SAVED record carries the destruction — history keeps no clean copy',
      d <= 70 && d > 1, d + ' distinct colours in the saved region');
  }
});

await T('blur: undo is lossless', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('blur');
  ed.drag([[60, 40], [120, 80]]);
  check('the blur changed the canvas', ed.hash() !== h0, '');
  await ed.key('z', { ctrlKey: true });
  check('undoing a blur restores the original pixels exactly',
    ed.hash() === h0, ed.hash() + ' vs ' + h0);
});

/* ================= 7 · crop ================= */
console.log('\n=== editor: crop ===');

await T('crop', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [180, 160]]);
  const preCrop = ed.hash();

  await ed.tool('crop');
  ed.drag([[50, 40], [150, 120], [250, 190]]);
  check('a crop drag arms the apply bar', ed.el('cropBar').classList.contains('show'), '');
  check('the pending crop dims everything outside it',
    ed.px(10, 10)[2] === 120, ed.px(10, 10).join(','));      // 0.6 * 200
  check('the pending crop leaves the inside undimmed', ed.px(240, 180)[2] === 200,
    ed.px(240, 180).join(','));
  check('the pending crop is outlined in white',
    (() => { for (let x = 60; x < 240; x++) if (isRGB(ed.px(x, 40), [255, 255, 255])) return true; return false; })(), '');

  await ed.click('cropApply');
  ed.setCrop(50, 40);
  check('applying the crop resizes the canvas to the crop box',
    ed.cv.width === 200 && ed.cv.height === 150, ed.cv.width + 'x' + ed.cv.height);
  check('the cropped canvas starts at the crop origin, not at the image origin',
    same(ed.px(0, 0), ed.basePx(50, 40)) && !same(ed.px(0, 0), ed.basePx(0, 0)),
    ed.px(0, 0).join(',') + ' want ' + ed.basePx(50, 40).join(','));
  check('the cropped canvas ends at the crop far corner',
    same(ed.px(199, 149), ed.basePx(249, 189)), ed.px(199, 149).join(','));
  check('the content is offset by the crop origin everywhere, not just at (0,0)',
    same(ed.px(77, 31), ed.basePx(127, 71)) && same(ed.px(150, 100), ed.basePx(200, 140)), '');
  check('an annotation drawn before the crop moves with the content',
    ed.changed(90, 60) && !ed.changed(90, 100), '');          // image y=100 -> canvas y=60
  check('the crop bar closes on apply', !ed.el('cropBar').classList.contains('show'), '');
  check('applying a crop switches to the select tool',
    ed.env.toolBtns.select.classList.contains('active'), '');

  await ed.click('pngBtn');
  const dl = ed.env.downloads[0];
  check('the export takes the cropped dimensions',
    !!dl && dl.blob.__w === 200 && dl.blob.__h === 150,
    dl ? dl.blob.__w + 'x' + dl.blob.__h : 'none');
  check('the export takes the cropped content offset',
    !!dl && same(at(dl.blob.__data, 200, 0, 0), ed.basePx(50, 40)),
    dl ? at(dl.blob.__data, 200, 0, 0).join(',') : 'none');

  await ed.key('z', { ctrlKey: true });
  ed.setCrop(0, 0);
  check('undoing the crop restores the full canvas size',
    ed.cv.width === 400 && ed.cv.height === 300, ed.cv.width + 'x' + ed.cv.height);
  check('undoing the crop restores the pre-crop pixels byte for byte',
    ed.hash() === preCrop, ed.hash() + ' vs ' + preCrop);
});

await T('crop: edges', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('crop');
  ed.drag([[100, 100], [104, 104]]);
  check('a crop drag under 8px is thrown away', !ed.el('cropBar').classList.contains('show'), '');
  check('...and the canvas goes back to clean', ed.hash() === h0, '');

  ed.drag([[390, 290], [500, 400]]);
  check('a crop drag past the edge clamps to the image',
    ed.el('cropBar').classList.contains('show'), '');
  await ed.click('cropApply');
  ed.setCrop(390, 290);
  check('the clamped crop is exactly the remaining 10x10',
    ed.cv.width === 10 && ed.cv.height === 10, ed.cv.width + 'x' + ed.cv.height);
  check('the clamped crop shows the bottom-right corner of the image',
    same(ed.px(0, 0), ed.basePx(390, 290)) && same(ed.px(9, 9), ed.basePx(399, 299)), '');
});

await T('crop: cancel paths', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropCancel');
  check('the cancel button drops the pending crop', ed.hash() === h0 &&
    !ed.el('cropBar').classList.contains('show'), '');
  check('...without resizing anything', ed.cv.width === 400 && ed.cv.height === 300, '');

  ed.drag([[50, 40], [250, 190]]);
  await ed.key('Escape');
  check('Escape drops the pending crop', ed.hash() === h0 &&
    !ed.el('cropBar').classList.contains('show'), '');

  ed.drag([[50, 40], [250, 190]]);
  await ed.tool('pen');
  check('switching tools drops the pending crop', ed.hash() === h0 &&
    !ed.el('cropBar').classList.contains('show'), '');
});

/* ================= 8 · undo / redo ================= */
console.log('\n=== editor: undo / redo restore the exact previous pixels ===');

await T('undo/redo', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const h1 = ed.hash();
  ed.drag([[220, 100], [300, 160]]);
  const h2 = ed.hash();
  check('two objects give two undo steps', ed.el('undoBtn').textContent === '↶ (2)' &&
    ed.el('undoBtn').disabled === false, ed.el('undoBtn').textContent);

  await ed.key('z', { ctrlKey: true });
  check('undo restores the previous canvas byte for byte', ed.hash() === h1, ed.hash() + ' vs ' + h1);
  await ed.key('z', { ctrlKey: true });
  check('a second undo restores the boot canvas byte for byte', ed.hash() === h0, ed.hash() + ' vs ' + h0);
  check('undo is disabled again at the bottom of the stack', ed.el('undoBtn').disabled === true, '');
  await ed.key('z', { ctrlKey: true });
  check('undo at the bottom of the stack is a no-op', ed.hash() === h0, '');

  await ed.key('y', { ctrlKey: true });
  check('redo returns the first object exactly', ed.hash() === h1, ed.hash() + ' vs ' + h1);
  await ed.key('z', { ctrlKey: true, shiftKey: true });
  check('ctrl+shift+z is the second redo binding, not an undo',
    ed.hash() === h2, ed.hash() + ' vs ' + h2);
  check('redo is disabled at the top of the stack', ed.el('redoBtn').disabled === true, '');
  await ed.key('z', { ctrlKey: true });
  await ed.key('z', { ctrlKey: true });
  check('undo walks all the way back', ed.hash() === h0, ed.hash() + ' vs ' + h0);
});

await T('undo/redo: a new object clears the redo branch', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.key('z', { ctrlKey: true });
  check('undo enables redo', ed.el('redoBtn').disabled === false &&
    ed.el('redoBtn').textContent === '↷ (1)', ed.el('redoBtn').textContent);
  ed.drag([[220, 100], [300, 160]]);
  check('drawing after an undo throws the redo branch away',
    ed.el('redoBtn').disabled === true && ed.el('redoBtn').textContent === '↷ (0)',
    ed.el('redoBtn').textContent);
});

await T('undo/redo: buttons and crop round trip', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const hRect = ed.hash();
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropApply');
  ed.setCrop(50, 40);
  const hCrop = ed.hash();
  await ed.click('undoBtn');
  ed.setCrop(0, 0);
  check('the undo BUTTON undoes a crop', ed.cv.width === 400 && ed.hash() === hRect,
    ed.cv.width + ' / ' + ed.hash());
  await ed.click('redoBtn');
  ed.setCrop(50, 40);
  check('the redo BUTTON redoes a crop, pixels included',
    ed.cv.width === 200 && ed.hash() === hCrop, ed.cv.width + ' / ' + ed.hash());
});

/* ================= 9 · coordinate mapping under a scaled view ================= */
console.log('\n=== editor: display-to-image coordinate mapping ===');

await T('scaled view', async () => {
  // (260-60)/400 = 0.5, so the 400px image is laid out 200px wide, with the
  // canvas box offset (30,20) from the viewport origin.
  const ed = await boot({ w: 400, h: 400, stageW: 260, stageH: 260, rectLeft: 30, rectTop: 20 });
  check('the view scale is reported as 50%', ed.el('zoomBtn').textContent === '50%',
    ed.el('zoomBtn').textContent);
  check('the canvas is laid out at half size but keeps full resolution',
    ed.cv.style.width === '200px' && ed.cv.width === 400,
    ed.cv.style.width + ' / ' + ed.cv.width);

  await ed.tool('rect');
  ed.drag([[80, 70], [130, 120]]);                // -> image (100,100)-(200,200)
  check('the annotation lands at IMAGE coordinates, doubled from the pointer',
    ed.changed(150, 100) && ed.changed(150, 199), '');
  check('the annotation is not painted at screen coordinates',
    !ed.changed(75, 50) && !ed.changed(50, 75), '');
  check('the annotation keeps the pointer aspect (a square drag is a square)',
    ed.changed(100, 150) && ed.changed(199, 150) && !ed.changed(150, 150), '');
  check('the canvas box origin is subtracted before scaling',
    !ed.changed(150, 240) && !ed.changed(240, 150), '');
});

await T('scaled view: the text overlay maps back', async () => {
  const ed = await boot({ w: 400, h: 400, stageW: 260, stageH: 260, rectLeft: 30, rectTop: 20 });
  await ed.tool('text');
  ed.down(130, 120);                              // -> image (200,200)
  const input = ed.el('textInput');
  check('the text overlay is placed in VIEW pixels, not image pixels',
    input.style.left === '100px' && input.style.top === '100px',
    input.style.left + ',' + input.style.top);
  check('the text overlay font is scaled to the view', input.style.fontSize === '14px',
    input.style.fontSize);
});

await T('scaled view: zoom controls', async () => {
  const ed = await boot({ w: 400, h: 400, stageW: 260, stageH: 260, rectLeft: 30, rectTop: 20 });
  await ed.click('zoomBtn');
  check('the zoom toggle jumps to 100%', ed.el('zoomBtn').textContent === '100%' &&
    ed.cv.style.width === '400px', ed.el('zoomBtn').textContent);
  await ed.tool('text');
  ed.down(130, 120);                              // now 1:1 -> image (100,100)
  check('the mapping follows the new zoom', ed.el('textInput').style.left === '100px' &&
    ed.el('textInput').style.top === '100px', ed.el('textInput').style.left);
  await ed.click('zoomBtn');
  check('the zoom toggle returns to fit', ed.el('zoomBtn').textContent === '50%',
    ed.el('zoomBtn').textContent);
  await ed.click('zoomInBtn');
  check('zoom-in steps to the next preset above the current scale',
    ed.el('zoomBtn').textContent === '67%', ed.el('zoomBtn').textContent);
  await ed.click('zoomOutBtn');
  check('zoom-out steps to the next preset below', ed.el('zoomBtn').textContent === '50%',
    ed.el('zoomBtn').textContent);
  await ed.key('+');
  check('the + key zooms in', ed.el('zoomBtn').textContent === '67%', ed.el('zoomBtn').textContent);
  await ed.key('-');
  check('the - key zooms out', ed.el('zoomBtn').textContent === '50%', ed.el('zoomBtn').textContent);
});

await T('scaled view: crop offset is added on top of the scale', async () => {
  const ed = await boot({ w: 400, h: 400, stageW: 4000, stageH: 4000 });
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropApply');
  ed.setCrop(50, 40);
  await ed.tool('rect');
  ed.drag([[20, 20], [120, 100]]);   // canvas coords -> image (70,60)-(170,140)
  check('after a crop the pointer still maps through the crop origin',
    ed.changed(70, 20) && ed.changed(20, 60) && !ed.changed(70, 60), '');
});

/* ================= 10 · select, move, delete (bounds) ================= */
console.log('\n=== editor: select / move / delete ===');

await T('select + bounds', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const hPlain = ed.hash();
  await ed.tool('select');
  ed.down(150, 150); ed.up();
  check('clicking an object draws the selection box outside its bounds',
    isRGB(ed.px(93, 150), SELBOX) || isRGB(ed.px(94, 150), SELBOX),
    ed.px(93, 150).join(',') + ' / ' + ed.px(94, 150).join(','));
  check('the selection box is dashed, not solid',
    (() => { let n = 0; for (let x = 94; x < 206; x++) if (isRGB(ed.px(x, 93), SELBOX) || isRGB(ed.px(x, 94), SELBOX)) n++; return n > 10 && n < 100; })(),
    (() => { let n = 0; for (let x = 94; x < 206; x++) if (isRGB(ed.px(x, 93), SELBOX) || isRGB(ed.px(x, 94), SELBOX)) n++; return n; })());
  ed.down(320, 260); ed.up();
  check('clicking empty space deselects and removes the box', ed.hash() === hPlain, '');

  // hitTest() is bounds() +/- 8px of slop; that is the bounds() tripwire.
  ed.down(93, 150); ed.up();
  check('a click 7px outside the bounds still selects', ed.hash() !== hPlain, '');
  ed.down(320, 260); ed.up();
  ed.down(89, 150); ed.up();
  check('a click 11px outside the bounds does not select', ed.hash() === hPlain, '');
});

await T('select: text bounds follow the string', async () => {
  const ed = await boot();
  await ed.tool('text');
  ed.down(60, 60);
  ed.type('ABCD');                                 // bounds w = 4 * 28 * 0.6 = 67.2
  const hPlain = ed.hash();
  await ed.tool('select');
  // bounds() estimates 0.6em per character, so 'ABCD' at 28px measures 67.2 and
  // the selection box, drawn 6px outside it, puts its right edge at x = 133.2.
  // y stays between the box's horizontal edges, so only a VERTICAL edge counts.
  const strip = (x0, x1) => {
    let n = 0;
    for (let y = 60; y < 96; y++) for (let x = x0; x < x1; x++) if (isRGB(ed.px(x, y), SELBOX)) n++;
    return n;
  };
  ed.down(70, 70); ed.up();                        // on the first glyph either way
  check('the selection box is drawn at the measured text width', strip(132, 134) > 0, strip(132, 134));
  check('the selection box is not drawn at some other width', strip(98, 102) === 0, strip(98, 102));
  ed.down(320, 260); ed.up();
  ed.down(60 + 65, 70); ed.up();
  check('a click inside the measured text width selects it', ed.hash() !== hPlain, '');
  ed.down(320, 260); ed.up();
  ed.down(60 + 80, 70); ed.up();
  check('a click past the measured text width does not select it', ed.hash() === hPlain, '');
});

await T('move + delete', async () => {
  const ed = await boot();
  const h0 = ed.hash();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const hRect = ed.hash();
  await ed.tool('select');
  ed.drag([[150, 150], [160, 155], [170, 160]]);
  check('dragging a selected object moves it by the pointer delta',
    ed.changed(120, 160) && !ed.changed(100, 160), '');
  check('the moved object keeps its size', ed.changed(219, 160), '');
  await ed.key('z', { ctrlKey: true });
  check('undo puts a moved object back exactly', ed.hash() === hRect, ed.hash() + ' vs ' + hRect);

  ed.down(150, 150); ed.up();
  await ed.key('Delete');
  check('Delete removes the selected object', ed.hash() === h0, ed.hash() + ' vs ' + h0);
  await ed.key('z', { ctrlKey: true });
  check('undo brings a deleted object back exactly', ed.hash() === hRect, ed.hash() + ' vs ' + hRect);
  await ed.key('Escape');
  check('Escape clears the selection', ed.hash() === hRect, '');
});

await T('move under a scaled view', async () => {
  const ed = await boot({ w: 400, h: 400, stageW: 260, stageH: 260, rectLeft: 30, rectTop: 20 });
  await ed.tool('rect');
  ed.drag([[80, 70], [130, 120]]);                // image (100,100)-(200,200)
  await ed.tool('select');
  ed.drag([[105, 95], [115, 100]]);               // +10,+5 view -> +20,+10 image
  check('a move under a 50% view moves by the IMAGE delta',
    ed.changed(120, 160) && !ed.changed(100, 160), '');
  check('...and by exactly the image delta, not the view delta',
    !ed.changed(110, 160), '');
});

/* ================= 11 · export ================= */
console.log('\n=== editor: export carries the annotations ===');

await T('export: png', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.click('pngBtn');
  const dl = ed.env.downloads[0];
  check('a PNG download is produced', !!dl && /\.png$/.test(dl.name), dl && dl.name);
  check('the export is named as an edit of the shot', !!dl && /-edited\.png$/.test(dl.name), dl && dl.name);
  check('the export is the full image size', !!dl && dl.blob.__w === 400 && dl.blob.__h === 300,
    dl && dl.blob.__w + 'x' + dl.blob.__h);
  check('the export carries the annotation, not the original',
    !!dl && isRGB(at(dl.blob.__data, 400, 150, 100), RED),
    dl && at(dl.blob.__data, 400, 150, 100).join(','));
  check('the export keeps the untouched pixels of the base image',
    !!dl && same(at(dl.blob.__data, 400, 20, 20), ed.basePx(20, 20)), '');
  check('the export is not simply the source image',
    !!dl && hash(dl.blob.__data) !== hash(ed.baseData), '');
  check('the export was asked for as a PNG', !!dl && dl.blob.type === 'image/png' &&
    dl.blob.quality === undefined, dl && dl.blob.type + '/' + dl.blob.quality);
  const f = ed.env.filenames[0];
  check('the filename is built from the shot title, url and CURRENT size',
    !!f && f.title === 'Example Page' && f.url === 'https://example.com/a' &&
    f.width === 400 && f.height === 300, f && JSON.stringify(f));
  check('the export toasts', ed.env.toasts.indexOf('Downloaded') >= 0, ed.env.toasts.join('|'));
});

await T('export: jpeg / webp quality', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.click('jpgBtn');
  await ed.click('webpBtn');
  const j = ed.env.downloads[0], w = ed.env.downloads[1];
  check('JPEG export uses image/jpeg at 0.92 and a .jpg name',
    !!j && j.blob.type === 'image/jpeg' && j.blob.quality === 0.92 && /\.jpg$/.test(j.name),
    j && j.blob.type + '/' + j.blob.quality + '/' + j.name);
  check('WebP export uses image/webp at 0.92 and a .webp name',
    !!w && w.blob.type === 'image/webp' && w.blob.quality === 0.92 && /\.webp$/.test(w.name),
    w && w.blob.type + '/' + w.blob.quality + '/' + w.name);
  check('both formats carry the annotation',
    !!j && !!w && isRGB(at(j.blob.__data, 400, 150, 100), RED) &&
    isRGB(at(w.blob.__data, 400, 150, 100), RED), '');
});

await T('export: clipboard', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.click('copyBtn');
  const c = ed.env.copies[0];
  check('copy hands a PNG to the clipboard helper', !!c && c.blob.type === 'image/png',
    c && c.blob.type);
  check('copy passes the clipboardFit setting through', !!c && c.fit === true, c && String(c.fit));
  check('the copied image carries the annotation',
    !!c && isRGB(at(c.blob.__data, 400, 150, 100), RED), '');
  check('copy toasts', ed.env.toasts.indexOf('Copied to clipboard') >= 0, ed.env.toasts.join('|'));
});

/* The only one of the eight page failure-sinks this tier can reach by
   EXECUTION rather than by reading the source: the editor is the page this sim
   actually boots. Everything else is graded statically, here and in the sim
   nearest each file. */
await T('export: a clipboard failure never puts the engine\'s words on screen', async () => {
  const HOSTILE = "Write failed: file:///C:/Users/jane/Desktop/o'brien/statement.pdf" +
                  "?token=SECRET9&card=4111111111111111";
  const ed = await boot({ clipboardError: new Error(HOSTILE) });
  const real = console.error;
  console.error = function () {};                 // the reducer logs the raw text on purpose
  try { await ed.click('copyBtn'); } finally { console.error = real; }
  const toast = ed.env.toasts.join(' | ');
  check('the copy still reports that it failed', /fail/i.test(toast), toast);
  for (const k of ['token', 'SECRET9', '4111', "o'brien", 'file://', 'jane']) {
    check('...without "' + k + '"', toast.indexOf(k) < 0, toast);
  }
});

await T('export: pdf', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.click('pdfBtn');
  const p = ed.env.pdfs[0];
  check('a PDF is built', !!p && p.pages.length === 1, ed.env.pdfs.length);
  check('the PDF page carries the image at 0.75pt per pixel',
    !!p && p.pages[0].imgW === 400 && p.pages[0].imgH === 300 &&
    Math.abs(p.pages[0].pageW - 300) < 0.01 && Math.abs(p.pages[0].pageH - 225) < 0.01,
    p && JSON.stringify([p.pages[0].imgW, p.pages[0].imgH, p.pages[0].pageW, p.pages[0].pageH]));
  check('the PDF is titled from the shot', !!p && p.meta.title === 'Example Page', p && p.meta.title);
  check('a .pdf download follows', ed.env.downloads.length === 1 &&
    /\.pdf$/.test(ed.env.downloads[0].name), ed.env.downloads.map(d => d.name).join('|'));
});

await T('export: the selection box never ships', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.tool('select');
  ed.down(150, 150); ed.up();
  check('the selection box is on the screen', isRGB(ed.px(93, 150), SELBOX) ||
    isRGB(ed.px(94, 150), SELBOX), '');
  await ed.click('pngBtn');
  const dl = ed.env.downloads[0];
  check('the selection box is not in the export',
    !!dl && (() => {
      for (let y = 88; y < 215; y++) for (let x = 88; x < 215; x++) {
        if (isRGB(at(dl.blob.__data, 400, x, y), SELBOX)) return false;
      }
      return true;
    })(), '');
  check('...but the object itself is', !!dl && isRGB(at(dl.blob.__data, 400, 150, 100), RED), '');
});

await T('save', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropApply');
  ed.setCrop(50, 40);
  await ed.click('saveBtn');
  const rec = ed.env.db.shots.get('shot-1');
  check('save writes the shot record back', ed.env.calls.indexOf('db.put:shots') >= 0,
    ed.env.calls.join('|'));
  check('the saved segment takes the cropped size',
    rec.segments[0].w === 200 && rec.segments[0].h === 150,
    rec.segments[0].w + 'x' + rec.segments[0].h);
  check('a single-segment shot has its own size updated too',
    rec.w === 200 && rec.h === 150, rec.w + 'x' + rec.h);
  check('the saved pixels are the edited ones',
    isRGB(at(rec.segments[0].blob.__data, 200, 100, 60), RED),
    at(rec.segments[0].blob.__data, 200, 100, 60).join(','));
  check('the saved image is saved in the shot format', rec.segments[0].blob.type === 'image/png',
    rec.segments[0].blob.type);
  check('a fresh 480-wide thumbnail is generated for segment 0',
    !!rec.thumb && rec.thumb.__w === 480 && rec.thumb.__h === 360 && rec.thumb.type === 'image/jpeg',
    rec.thumb && rec.thumb.__w + 'x' + rec.thumb.__h);
  check('save toasts', ed.env.toasts.indexOf('Saved to history') >= 0, ed.env.toasts.join('|'));
});

await T('save: multi-segment shots keep their own size', async () => {
  const ed = await boot({ segs: 2 });
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropApply');
  await ed.click('saveBtn');
  const rec = ed.env.db.shots.get('shot-1');
  check('editing one segment of a multi-segment shot does not rewrite the shot size',
    rec.w === 400 && rec.h === 300, rec.w + 'x' + rec.h);
  check('...but that segment is resized', rec.segments[0].w === 200 && rec.segments[0].h === 150,
    rec.segments[0].w + 'x' + rec.segments[0].h);
});

await T('save: the keyboard shortcut', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const ev = await ed.key('s', { ctrlKey: true });
  await ed.settle();
  check('ctrl+S saves and swallows the browser default',
    ed.env.calls.indexOf('db.put:shots') >= 0 && ev._prevented === true,
    ed.env.calls.join('|'));
});

/* ================= 12 · keyboard map + menus ================= */
console.log('\n=== editor: keyboard tool map ===');

await T('tool keys', async () => {
  const ed = await boot();
  const MAP = { v: 'select', c: 'crop', p: 'pen', h: 'hl', l: 'line', a: 'arrow',
                r: 'rect', o: 'ellipse', t: 'text', b: 'blur', n: 'num', e: 'emoji' };
  let bad = [];
  for (const k of Object.keys(MAP)) {
    await ed.key(k);
    if (!ed.env.toolBtns[MAP[k]].classList.contains('active')) bad.push(k);
  }
  check('every documented tool key selects its tool', bad.length === 0, bad.join(','));
  await ed.key('r');
  await ed.key('z', { ctrlKey: true });
  check('a modified key is not read as a tool key',
    ed.env.toolBtns.rect.classList.contains('active'), '');
  const input = ed.el('textInput');
  const before = ed.env.toolBtns.rect.classList.contains('active');
  const out = [];
  for (const fn of (ed.env.docOn.keydown || [])) {
    fn({ target: input, key: 'p', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
         preventDefault() {}, stopPropagation() {} });
  }
  check('typing into the text overlay does not trigger tool keys',
    before && ed.env.toolBtns.rect.classList.contains('active'), '');
});

await T('menus', async () => {
  const ed = await boot();
  await ed.click('exportBtn');
  check('the export button opens its menu', ed.el('exportMenu').classList.contains('show'), '');
  // The menu buttons stopPropagation, so only a click on something ELSE reaches
  // the document listener that closes them.
  await ed.click('themeBtn');
  check('a click elsewhere in the toolbar closes the export menu',
    !ed.el('exportMenu').classList.contains('show') &&
    ed.env.calls.indexOf('toggleTheme') >= 0, ed.env.calls.join('|'));
  await ed.click('moreBtn');
  check('the more button opens its own menu', ed.el('moreMenu').classList.contains('show'), '');
  await ed.click('mShortcuts');
  check('the shortcuts item opens the shortcuts panel and closes the menu',
    ed.el('shortcutsPop').classList.contains('show') && !ed.el('moreMenu').classList.contains('show'), '');
  await ed.key('Escape');
  check('Escape closes the shortcuts panel', !ed.el('shortcutsPop').classList.contains('show'), '');
  await ed.click('moreBtn');
  await ed.click('mOptions');
  check('the options item opens the extension options page',
    ed.env.calls.indexOf('openOptionsPage') >= 0, ed.env.calls.join('|'));
});

/* ================= 13 · product invariants ================= */
console.log('\n=== editor: product invariants ===');

await T('invariants', async () => {
  const ed = await boot();
  await ed.tool('pen');
  ed.drag([[60, 100], [140, 100]]);
  await ed.tool('blur');
  ed.drag([[60, 40], [120, 80]]);
  await ed.click('pngBtn');
  await ed.click('copyBtn');
  await ed.click('saveBtn');
  check('the editor makes no network call of any kind', ed.env.network.length === 0,
    ed.env.network.join(','));
  check('the editor touches no chrome API beyond runtime.openOptionsPage',
    ed.env.forbidden.length === 0, ed.env.forbidden.join(','));
  check('the editor asks for no element pages/editor.html does not define',
    ed.env.missingIds.length === 0, ed.env.missingIds.join(','));
});

await T('invariants: nothing is persisted until the user saves', async () => {
  const ed = await boot();
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  await ed.tool('crop');
  ed.drag([[50, 40], [250, 190]]);
  await ed.click('cropApply');
  await ed.click('pngBtn');
  check('editing and exporting never writes to the database',
    ed.env.calls.indexOf('db.put:shots') < 0, ed.env.calls.join('|'));
  const rec = ed.env.db.shots.get('shot-1');
  check('the stored shot still has its original size', rec.w === 400 && rec.h === 300,
    rec.w + 'x' + rec.h);
});

await T('invariants: a resize re-lays-out without disturbing the drawing', async () => {
  const ed = await boot({ w: 400, h: 400, stageW: 4000, stageH: 4000 });
  await ed.tool('rect');
  ed.drag([[100, 100], [200, 200]]);
  const h = ed.hash();
  ed.resize();
  check('a window resize at the same size repaints identically', ed.hash() === h, '');
  ed.el('stage').clientWidth = 260;
  ed.el('stage').clientHeight = 260;
  ed.resize();
  check('a window resize re-fits the view', ed.el('zoomBtn').textContent === '50%',
    ed.el('zoomBtn').textContent);
  check('...without changing the canvas resolution or its pixels',
    ed.cv.width === 400 && ed.hash() === h, ed.cv.width + ' / ' + ed.hash());
});

/* ================================================================
   accessibility — the editor without a mouse
   ================================================================
   This section exists because a canvas annotation tool that answers only to a
   pointer is unusable to anyone who does not have one, and none of that is
   visible to the pixel checks above: an editor can paint perfectly and still be
   unreachable. What is gradeable, and what each group is really asking:

     - can every tool be chosen from the keyboard, and does anything SAY so;
     - can an annotation be placed, moved and deleted with no pointer at all,
       with a coarse step and a fine one;
     - does an arrow-key run collapse into ONE undo step (a nudge that spends
       the 60-deep stack destroys the history the user wanted back);
     - is there a keyboard path to undo, redo, crop confirm and export, and does
       focus go where it has to for that path to exist at all;
     - is what is selected VISIBLE on the canvas and ANNOUNCED to a screen
       reader — two separate claims, graded separately;
     - and the one this product can get catastrophically wrong: the canvas is a
       COORDINATE SYSTEM. Under an RTL locale the chrome around it mirrors and
       the surface must not. ArrowRight is +x in every language, or the same
       saved shot crops differently in Arabic than it does in English. */

console.log('\n=== a11y: every tool from the keyboard ===');

const TOOL_LETTERS = [['v', 'select'], ['c', 'crop'], ['p', 'pen'], ['h', 'hl'], ['l', 'line'],
                      ['a', 'arrow'], ['r', 'rect'], ['o', 'ellipse'], ['t', 'text'],
                      ['b', 'blur'], ['n', 'num'], ['e', 'emoji']];

function pressedTools(ed) {
  return Object.keys(ed.env.toolBtns)
    .filter(t => ed.attr(ed.env.toolBtns[t], 'aria-pressed') === 'true');
}

/* "Is anything selected?" as a pixel question rather than a state question —
   the point of these checks is that the answer is VISIBLE. #4f46e5 is painted
   by exactly two things, the selection box and the keyboard crosshair, and they
   are mutually exclusive by construction (the crosshair only draws when nothing
   is selected), so a non-zero count with a selection live is the box. Counted
   over the whole surface rather than probed at one coordinate: the box is
   dashed, and which pixel a dash lands on is not the claim. */
function selBoxPixels(ed) {
  let n = 0;
  for (let y = 0; y < ed.cv.height; y++) {
    for (let x = 0; x < ed.cv.width; x++) if (isRGB(ed.px(x, y), SELBOX)) n++;
  }
  return n;
}

/* A rectangle placed by Enter, then deselected — the state an undo or a redo
   lands in, since restore() clears the selection. Comparing a post-undo canvas
   against a still-selected one would grade the box, not the undo. */
async function placedAndDeselected() {
  const ref = await boot();
  await ref.key('r');
  ref.focus('canvas');
  await ref.key('Enter');
  await ref.key('Escape');
  return ref.hash();
}

await T('a11y: tool letters', async () => {
  const ed = await boot();
  check('the tool live at boot is the one marked pressed',
    pressedTools(ed).join(',') === 'pen', pressedTools(ed).join(',') || 'none');

  const misses = [], unspoken = [], multi = [];
  for (const [letter, name] of TOOL_LETTERS) {
    await ed.key(letter);
    const on = pressedTools(ed);
    if (!ed.env.toolBtns[name].classList.contains('active')) misses.push(letter + '->' + name);
    if (on.length !== 1 || on[0] !== name) multi.push(letter + ':' + (on.join(',') || 'none'));
    const label = ed.attr(ed.env.toolBtns[name], 'aria-label') || '';
    if (!label || ed.said().indexOf(label) < 0) unspoken.push(letter + ' said ' + JSON.stringify(ed.said()));
  }
  check('every one of the twelve tools can be chosen with one key', misses.length === 0,
    misses.join(' ') || TOOL_LETTERS.length + ' tools');
  check('...and exactly one button reads as pressed each time', multi.length === 0,
    multi.slice(0, 3).join(' | ') || 'single-valued throughout');
  check('...and the choice is announced by the tool\'s own translated name', unspoken.length === 0,
    unspoken.slice(0, 2).join(' | ') || 'all twelve announced');
});

await T('a11y: the announcement is never the internal enum', async () => {
  const ed = await boot();
  const raw = [];
  for (const [letter, name] of TOOL_LETTERS) {
    await ed.key(letter);
    // 'hl', 'num', 'rect'… are storage and protocol values. A user never reads one.
    if (ed.said() === name || ed.said() === name + ' selected') raw.push(name);
  }
  check('a tool announcement never leaks the enum the object is stored as',
    raw.length === 0, raw.join(',') || 'twelve announcements, no enum');
});

await T('a11y: a letter typed into a form control is not a tool switch', async () => {
  const ed = await boot();
  await ed.key('r');
  const before = pressedTools(ed).join(',');
  await ed.keyOn('strokeSel', 'p');          // "p" while the stroke <select> has focus
  check('a letter aimed at a <select> does not steal the tool',
    pressedTools(ed).join(',') === before, before + ' -> ' + pressedTools(ed).join(','));
});

console.log('\n=== a11y: place, nudge and delete with no pointer ===');

await T('a11y: Enter places the current tool at the keyboard cursor', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  // the default box is 80x50 centred on the middle of a 400x300 image
  check('Enter with the rectangle tool paints a rectangle',
    ed.changed(200, 125) && ed.changed(160, 150), ed.px(200, 125).join(','));
  check('...in the active colour', isRGB(ed.px(200, 125), RED), ed.px(200, 125).join(','));
  check('...centred on the keyboard cursor, not hung off a corner',
    ed.changed(200, 175) && !ed.changed(200, 90) && !ed.changed(200, 210), '');
  check('...and it says what it placed and where',
    ed.said().indexOf('160') >= 0 && ed.said().indexOf('125') >= 0 &&
    ed.said().indexOf(ed.attr(ed.env.toolBtns.rect, 'aria-label')) >= 0, JSON.stringify(ed.said()));
  check('...and the thing it placed is the thing that is now selected',
    selBoxPixels(ed) > 40, selBoxPixels(ed) + ' selection-box pixels');
});

await T('a11y: Enter places the point tools too', async () => {
  const ed = await boot();
  await ed.key('n');
  ed.focus('canvas');
  await ed.key('Enter');
  check('a numbered step lands on the cursor', ed.changed(200, 150), ed.px(200, 150).join(','));
  await ed.key('e');
  ed.focus('canvas');
  await ed.key('Enter');
  check('an emoji stamp lands on the cursor', ed.changed(200, 150), '');

  const ed2 = await boot();
  await ed2.key('t');
  ed2.focus('canvas');
  await ed2.key('Enter');
  check('the text tool opens its overlay rather than inventing a caption',
    ed2.el('textInput').style.display === 'block', ed2.el('textInput').style.display);
  ed2.type('HI');
  check('...and the typed caption is committed to the canvas', ed2.changed(202, 155),
    ed2.px(202, 155).join(','));
});

await T('a11y: arrow keys nudge, fine and coarse', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  await ed.key('ArrowRight');
  check('one arrow is one pixel', /\b161,\s*125\b/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('ArrowRight', { shiftKey: true });
  check('Shift makes the same arrow ten', /\b171,\s*125\b/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('ArrowDown', { shiftKey: true });
  check('the vertical axis behaves the same way', /\b171,\s*135\b/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('ArrowLeft', { shiftKey: true });
  await ed.key('ArrowUp', { shiftKey: true });
  check('back the other way returns to where it was', /\b161,\s*125\b/.test(ed.said()),
    JSON.stringify(ed.said()));

  // and the PIXELS moved, not just the sentence
  const a = await boot();
  await a.key('r'); a.focus('canvas'); await a.key('Enter');
  const still = a.hash();
  for (let i = 0; i < 10; i++) await a.key('ArrowRight');
  const b = await boot();
  await b.key('r'); b.focus('canvas'); await b.key('Enter');
  await b.key('ArrowRight', { shiftKey: true });
  check('ten fine steps land on exactly the same pixels as one coarse step',
    a.hash() === b.hash(), a.hash() + ' vs ' + b.hash());
  check('...and that is not just the unmoved position', a.hash() !== still,
    a.hash() + ' vs ' + still);
});

await T('a11y: an arrow run is one undo step', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  const depth = Number(/\d+/.exec(ed.el('undoBtn').textContent)[0]);
  for (let i = 0; i < 12; i++) await ed.key('ArrowRight', { shiftKey: true });
  const after = Number(/\d+/.exec(ed.el('undoBtn').textContent)[0]);
  check('twelve nudges add exactly one undo step', after === depth + 1, depth + ' -> ' + after);
  const placed = await placedAndDeselected();
  await ed.key('z', { ctrlKey: true });
  check('one undo puts the whole run back', ed.hash() === placed, ed.hash() + ' vs ' + placed);
});

await T('a11y: Delete removes what is selected, whatever tool drew it', async () => {
  const ed = await boot();
  const empty = ed.hash();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  check('a keyboard placement is selected without switching to the select tool',
    selBoxPixels(ed) > 40, selBoxPixels(ed) + ' selection-box pixels');
  await ed.key('Delete');
  check('Delete removes it while the rectangle tool is still live', ed.hash() === empty,
    ed.hash() + ' vs ' + empty);
  check('...and says so, by name',
    ed.said().indexOf(ed.attr(ed.env.toolBtns.rect, 'aria-label')) >= 0, JSON.stringify(ed.said()));
});

await T('a11y: Enter with the select tool picks what is under the cursor', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  await ed.key('Escape');
  check('Escape clears the selection and the box goes with it',
    selBoxPixels(ed) === 0, selBoxPixels(ed) + ' selection-box pixels');
  await ed.key('v');
  ed.focus('canvas');
  await ed.key('Enter');
  check('Enter re-selects the object under the cursor',
    selBoxPixels(ed) > 40, selBoxPixels(ed) + ' selection-box pixels');
  check('...and counts it, so a screen reader knows how many there are',
    /\b1\b/.test(ed.said()) && ed.said().indexOf(ed.attr(ed.env.toolBtns.rect, 'aria-label')) >= 0,
    JSON.stringify(ed.said()));
});

console.log('\n=== a11y: the keyboard cursor is visible, and never shipped ===');

await T('a11y: the crosshair', async () => {
  const ed = await boot();
  await ed.key('r');
  const clean = ed.hash();
  ed.focus('canvas');
  check('focus alone paints nothing — a pointer user never sees the crosshair',
    ed.hash() === clean, ed.hash() + ' vs ' + clean);
  await ed.key('ArrowRight');
  check('the first arrow key shows where the next Enter will land',
    ed.changed(201, 150) && ed.whiteCount(201, 150, 12) > 12,
    'changed=' + ed.changed(201, 150) + ' white=' + ed.whiteCount(201, 150, 12));
  check('...and nothing far from it', !ed.changed(60, 60) && !ed.changed(340, 240), '');
  ed.el('canvas').blur();
  check('leaving the surface takes the crosshair with it', ed.hash() === clean,
    ed.hash() + ' vs ' + clean);
});

await T('a11y: the crosshair never reaches the export', async () => {
  const ed = await boot();
  await ed.key('p');
  ed.drag([[60, 40], [200, 40]]);            // an annotation, well clear of the probe below
  ed.focus('canvas');
  /* A pointer press parks the insertion point where it landed, so the cursor
     starts at (60,40) — on the stroke. Walk it down to clear ground first, or
     the check would be grading the stroke it is supposed to ignore. */
  for (let i = 0; i < 10; i++) await ed.key('ArrowDown', { shiftKey: true });
  check('the crosshair is on the screen', ed.whiteCount(60, 140, 12) > 12,
    String(ed.whiteCount(60, 140, 12)));
  await ed.click('pngBtn');
  const dl = ed.env.downloads[0];
  const clean = !!dl && (() => {
    for (let y = 125; y < 156; y++) for (let x = 45; x < 76; x++) {
      if (!same(at(dl.blob.__data, 400, x, y), at(ed.baseData, 400, x, y))) return false;
    }
    return true;
  })();
  check('the exported file has no crosshair in it', clean, dl ? 'clean=' + clean : 'no download');
  check('...and still has the annotation', !!dl && isRGB(at(dl.blob.__data, 400, 120, 40), RED),
    dl ? at(dl.blob.__data, 400, 120, 40).join(',') : '');
});

console.log('\n=== a11y: the canvas is a coordinate system, not text ===');

await T('a11y: arrow keys do not mirror under an RTL locale', async () => {
  async function run(dir) {
    const ed = await boot({ dir });
    await ed.key('r');
    ed.focus('canvas');
    await ed.key('Enter');
    await ed.key('ArrowRight', { shiftKey: true });
    await ed.key('ArrowDown', { shiftKey: true });
    return { hash: ed.hash(), said: ed.said() };
  }
  const ltr = await run('ltr');
  const mirrored = await run('rtl');
  check('the chrome around it may mirror; the surface does not — same pixels either way',
    ltr.hash === mirrored.hash, ltr.hash + ' vs ' + mirrored.hash);
  check('...and ArrowRight moved +x in both, not +x and then -x',
    /\b170,\s*135\b/.test(ltr.said) && /\b170,\s*135\b/.test(mirrored.said),
    JSON.stringify(ltr.said) + ' | ' + JSON.stringify(mirrored.said));

  // the pointer half of the same claim, re-asserted beside the keyboard half
  const pl = await boot({ dir: 'ltr' }); await pl.tool('rect'); pl.drag([[100, 100], [200, 200]]);
  const pr = await boot({ dir: 'rtl' }); await pr.tool('rect'); pr.drag([[100, 100], [200, 200]]);
  check('a pointer drag lands on the same pixels under either direction',
    pl.hash() === pr.hash(), pl.hash() + ' vs ' + pr.hash());
});

await T('a11y: the source never asks which way the page runs', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages', 'editor.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  const sins = [];
  if (/documentElement\s*\.\s*dir/.test(src)) sins.push('reads documentElement.dir');
  if (/getComputedStyle/.test(src)) sins.push('reads computed style');
  if (/\bdirection\b/.test(src)) sins.push('names a direction');
  if (/scaleX\(\s*-|scale\(\s*-1/.test(src)) sins.push('mirrors with a negative scale');
  check('editor.js decides an arrow direction from a constant, never from the locale',
    sins.length === 0, sins.join(' | ') || 'no direction is read anywhere in the file');
  /* The arrow table is the single place the four keys become numbers. If a
     second one ever appears, this is the check that notices. */
  const tables = (src.match(/arrowleft\s*:/g) || []).length;
  check('there is exactly one arrow-to-vector table', tables === 1, tables + ' table(s)');
});

console.log('\n=== a11y: a keyboard path to crop, undo, redo and export ===');

await T('a11y: crop, start to finish, with no pointer', async () => {
  const ed = await boot();
  await ed.key('c');
  ed.focus('canvas');
  check('the crop bar is not up before there is anything to confirm',
    !ed.el('cropBar').classList.contains('show'), '');
  await ed.key('Enter');
  check('Enter proposes a crop rectangle', ed.el('cropBar').classList.contains('show'), '');
  check('...and reads out its size and position',
    /240/.test(ed.said()) && /180/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('ArrowRight', { shiftKey: true });
  check('arrows move the pending crop', /\b90,\s*60\b/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('ArrowRight', { ctrlKey: true, shiftKey: true });
  check('Ctrl+arrow resizes it instead of moving it',
    /250/.test(ed.said()) && /\b90,\s*60\b/.test(ed.said()), JSON.stringify(ed.said()));
  await ed.key('Enter');
  check('a second Enter confirms the crop', ed.cv.width === 250 && ed.cv.height === 180,
    ed.cv.width + 'x' + ed.cv.height);
  check('...the crop bar goes away', !ed.el('cropBar').classList.contains('show'), '');
  check('...and the confirmation is announced with the new size',
    /250/.test(ed.said()) && /180/.test(ed.said()), JSON.stringify(ed.said()));
  ed.setCrop(90, 60);
  check('...and the content shifted by the crop origin, exactly as a pointer crop does',
    same(ed.px(0, 0), ed.basePx(90, 60)) && same(ed.px(100, 100), ed.basePx(190, 160)),
    ed.px(0, 0).join(',') + ' vs ' + ed.basePx(90, 60).join(','));
});

await T('a11y: Escape abandons a keyboard crop', async () => {
  const ed = await boot();
  const clean = ed.hash();
  await ed.key('c');
  ed.focus('canvas');
  await ed.key('Enter');
  check('the proposal dims the canvas', ed.hash() !== clean, '');
  await ed.key('Escape');
  check('Escape drops it with the image untouched',
    ed.hash() === clean && !ed.el('cropBar').classList.contains('show'),
    ed.hash() + ' vs ' + clean);
  check('...and the canvas is still full size', ed.cv.width === 400 && ed.cv.height === 300,
    ed.cv.width + 'x' + ed.cv.height);
});

await T('a11y: undo, redo and save are all reachable as chords', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  /* restore() clears the selection, so the state an undo or a redo lands in is
     "placed, deselected" — comparing against the still-selected canvas would
     grade the selection box instead of the history. */
  const placed = await placedAndDeselected();
  await ed.key('z', { ctrlKey: true });
  check('Ctrl+Z undoes', ed.hash() !== placed, ed.hash() + ' vs ' + placed);
  await ed.key('z', { ctrlKey: true, shiftKey: true });
  check('Ctrl+Shift+Z redoes', ed.hash() === placed, ed.hash() + ' vs ' + placed);
  await ed.key('z', { ctrlKey: true });
  await ed.key('y', { ctrlKey: true });
  check('Ctrl+Y redoes too', ed.hash() === placed, ed.hash() + ' vs ' + placed);
  await ed.key('s', { ctrlKey: true });
  check('Ctrl+S saves to history', ed.env.calls.indexOf('db.put:shots') >= 0, ed.env.calls.join(','));
});

await T('a11y: the export sheet is operable and gives focus back', async () => {
  const ed = await boot();
  check('the trigger says it owns a sheet, and that the sheet is shut',
    ed.attr('exportBtn', 'aria-haspopup') === 'true' && ed.attr('exportBtn', 'aria-expanded') === 'false',
    ed.attr('exportBtn', 'aria-haspopup') + ' / ' + ed.attr('exportBtn', 'aria-expanded'));
  await ed.click('exportBtn');
  check('opening it moves focus INTO it, not just onto the screen',
    ed.activeId() === 'copyBtn', ed.activeId());
  check('...and the trigger now reads as expanded',
    ed.attr('exportBtn', 'aria-expanded') === 'true', ed.attr('exportBtn', 'aria-expanded'));
  await ed.keyOn('copyBtn', 'ArrowDown');
  check('Down walks to the next item', ed.activeId() === 'pngBtn', ed.activeId());
  await ed.keyOn(ed.active(), 'End');
  check('End jumps to the last', ed.activeId() === 'pdfBtn', ed.activeId());
  await ed.keyOn(ed.active(), 'ArrowDown');
  check('...and it wraps', ed.activeId() === 'copyBtn', ed.activeId());
  await ed.keyOn(ed.active(), 'Escape');
  check('Escape shuts the sheet',
    !ed.el('exportMenu').classList.contains('show') &&
    ed.attr('exportBtn', 'aria-expanded') === 'false', '');
  check('...and hands focus back to the control that opened it',
    ed.activeId() === 'exportBtn', ed.activeId());
});

await T('a11y: an export can be reached and fired without a pointer', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  ed.focus('exportBtn');
  await ed.click('exportBtn');           // Enter on a focused button IS a click
  await ed.click(ed.active());           // whatever the sheet put focus on
  check('the first item of the export sheet copies the annotated image',
    ed.env.copies.length === 1, String(ed.env.copies.length));
  check('...and focus came back out of the sheet', ed.activeId() === 'exportBtn', ed.activeId());
});

await T('a11y: the emoji sheet opens, is walkable, and gives focus back', async () => {
  const ed = await boot();
  await ed.tool('emoji');                    // first click picks the tool
  await ed.click(ed.env.toolBtns.emoji);     // second opens the sheet
  check('the sheet opens and takes focus',
    ed.el('emojiPop').classList.contains('show') && ed.active() === ed.el('emojiPop').children[0],
    ed.activeId() || 'first emoji');
  check('...and the trigger reads as expanded',
    ed.attr('emojiToolBtn', 'aria-expanded') === 'true', ed.attr('emojiToolBtn', 'aria-expanded'));
  await ed.key('Escape');
  check('Escape shuts it and hands focus back to the tool button',
    !ed.el('emojiPop').classList.contains('show') && ed.active() === ed.env.toolBtns.emoji &&
    ed.attr('emojiToolBtn', 'aria-expanded') === 'false',
    ed.attr('emojiToolBtn', 'aria-expanded'));
});

await T('a11y: the shortcut sheet is a modal that keeps and returns focus', async () => {
  const ed = await boot();
  await ed.click('moreBtn');
  check('the More sheet focuses its first item', ed.activeId() === 'mFiles', ed.activeId());
  await ed.click('mShortcuts');
  check('the dialog takes focus', ed.activeId() === 'shortcutsClose', ed.activeId());
  /* The claim is that the dialog SWALLOWS Tab, and the only honest way to grade
     it is on the event: a harness that does not implement the browser's tab
     order would leave focus on the Close button whether the page consumed the
     key or not, so asserting "focus did not move" alone is a check with no
     teeth. preventDefault() is the thing that stops the browser moving focus. */
  const tab = await ed.key('Tab');
  check('Tab cannot walk out of a modal',
    tab._prevented === true && ed.activeId() === 'shortcutsClose',
    'prevented=' + tab._prevented + ' focus=' + ed.activeId());
  await ed.key('Escape');
  check('Escape closes it', !ed.el('shortcutsPop').classList.contains('show'), '');
  check('...and focus lands back on the control that opened it',
    ed.activeId() === 'moreBtn', ed.activeId());
  check('the More sheet did not stay open behind the dialog',
    !ed.el('moreMenu').classList.contains('show') &&
    ed.attr('moreBtn', 'aria-expanded') === 'false', '');
});

await T('a11y: the shortcut sheet documents the keys this pass added', async () => {
  const ed = await boot();
  const rows = ed.el('shortcutsTable').children;
  check('three rows were appended for the cursor, the nudge and the crop resize',
    rows.length === 3, rows.length + ' row(s) built at boot');
  const text = rows.map(r => r.children.map(c =>
    c.textContent + (c.children[0] ? c.children[0].textContent : '')).join(' ')).join(' | ');
  check('...and each of them names a real chord and describes it',
    /Enter/.test(text) && /Ctrl/.test(text) && /→/.test(text) && /Shift/.test(text), text);
});

console.log('\n=== a11y: the colour palette is one control, not eight tab stops ===');

await T('a11y: the swatch radiogroup', async () => {
  const ed = await boot();
  const sw = ed.el('colors').children;
  check('eight swatches, each a radio',
    sw.length === 8 && sw.every(b => ed.attr(b, 'role') === 'radio'), sw.length + ' swatch(es)');
  check('exactly one is checked',
    sw.filter(b => ed.attr(b, 'aria-checked') === 'true').length === 1,
    sw.map(b => ed.attr(b, 'aria-checked')).join(','));
  check('exactly one is in the tab order', sw.filter(b => b.tabIndex === 0).length === 1,
    sw.map(b => b.tabIndex).join(','));
  check('each has a name a screen reader can read',
    sw.every(b => /^#[0-9a-f]{6}$/i.test(ed.attr(b, 'aria-label') || '')), ed.attr(sw[0], 'aria-label'));
  ed.focus(sw[0]);
  await ed.keyOn(sw[0], 'ArrowRight');
  check('Right moves the choice along the list',
    ed.attr(sw[1], 'aria-checked') === 'true' && ed.attr(sw[0], 'aria-checked') === 'false',
    sw.map(b => ed.attr(b, 'aria-checked')).join(','));
  check('...and takes the tab stop and the focus with it',
    sw[1].tabIndex === 0 && sw[0].tabIndex === -1 && ed.active() === sw[1], String(sw[1].tabIndex));
  await ed.keyOn(sw[1], 'Home');
  check('Home returns to the first', ed.attr(sw[0], 'aria-checked') === 'true', '');
  await ed.keyOn(sw[0], 'ArrowLeft');
  check('...and Left from the first wraps to the last',
    ed.attr(sw[7], 'aria-checked') === 'true', '');
  // and the choice is real: COLORS[7] is #ffffff, so the next object is white
  await ed.key('l');
  ed.focus('canvas');
  await ed.key('Enter');
  check('the keyboard-chosen colour is the colour that gets painted',
    isRGB(ed.px(200, 150), [255, 255, 255]), ed.px(200, 150).join(','));
});

await T('a11y: an arrow spent on the palette never also nudges the canvas', async () => {
  const ed = await boot();
  await ed.key('r');
  ed.focus('canvas');
  await ed.key('Enter');
  const placed = ed.hash();
  const sw = ed.el('colors').children;
  ed.focus(sw[0]);
  await ed.keyOn(sw[0], 'ArrowRight');
  check('the selection did not move because the palette was being walked',
    ed.hash() === placed, ed.hash() + ' vs ' + placed);
});

console.log('\n=== a11y: what pages/editor.html promises ===');
{
  /* Comments out first, always — the same lesson the direction checks in
     test/i18n-sim.node.js paid for. The note above the canvas explains what a
     bare <canvas> looks like to a screen reader, and a scanner cannot tell a
     prohibition from its own description of one. */
  const H = EDITOR_HTML.replace(/<!--[\s\S]*?-->/g, ' ');
  const tags = H.match(/<button[^>]*data-tool="[a-z]+"[^>]*>/g) || [];
  check('the markup carries all twelve tool buttons', tags.length === 12, tags.length + ' button(s)');
  const gaps = [];
  for (const t of tags) {
    const name = /data-tool="([a-z]+)"/.exec(t)[1];
    if (!/aria-label:/.test(t)) gaps.push(name + ' has no aria-label key');
    if (!/aria-pressed="/.test(t)) gaps.push(name + ' has no aria-pressed');
    if (!/aria-keyshortcuts="/.test(t)) gaps.push(name + ' has no aria-keyshortcuts');
  }
  check('every tool button has a name, a pressed state and its chord',
    gaps.length === 0, gaps.slice(0, 4).join(' | ') || '12 x 3 attributes');
  /* Every one of these paints a pictogram, so its accessible name would
     otherwise BE the pictogram. Each already carries a title, and the
     aria-label spends the SAME key — nothing new has to be translated. */
  const NAMED = ['backBtn', 'moreBtn', 'themeBtn', 'undoBtn', 'redoBtn',
                 'zoomOutBtn', 'zoomInBtn', 'customColor'];
  const unnamed = NAMED.filter(id => {
    const tag = new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>', 'i').exec(H);
    return !tag || !/aria-label:/.test(tag[0]);
  });
  check('every icon-only control on the toolbar has an accessible name',
    unnamed.length === 0, unnamed.join(',') || NAMED.length + ' controls');
  const invented = (H.match(/title:([A-Za-z0-9_]+); aria-label:([A-Za-z0-9_]+)/g) || [])
    .filter(s => { const m = /title:([A-Za-z0-9_]+); aria-label:([A-Za-z0-9_]+)/.exec(s); return m[1] !== m[2]; });
  check('...and every one of those names reuses the key its tooltip already spends',
    invented.length === 0, invented.join(' | ') || 'no new message key was invented in the markup');

  const canvasTag = /<canvas[^>]*>/.exec(H)[0];
  check('the drawing surface is in the tab order at all', /tabindex="0"/.test(canvasTag), canvasTag);
  check('...and is declared an application, so a screen reader hands it the arrow keys',
    /role="application"/.test(canvasTag), canvasTag);
  check('the live region exists, is polite, atomic, and starts empty',
    /<p id="a11yStatus"[^>]*role="status"[^>]*><\/p>/.test(H.replace(/\s*\n\s*/g, ' ')) &&
    /id="a11yStatus"[^>]*aria-live="polite"/.test(H) && /id="a11yStatus"[^>]*aria-atomic="true"/.test(H),
    (/<p id="a11yStatus"[^>]*>[^<]*<\/p>/.exec(H) || [''])[0]);
  check('the shortcut sheet is a labelled modal dialog',
    /id="shortcutsPop"[^>]*role="dialog"/.test(H) && /aria-modal="true"/.test(H) &&
    /aria-labelledby="shortcutsHeading"/.test(H) && /id="shortcutsHeading"/.test(H), '');
  check('both drop-down sheets are menus with a wired-up trigger',
    /id="exportMenu" role="menu"/.test(H) && /id="moreMenu" role="menu"/.test(H) &&
    (H.match(/aria-haspopup="true"/g) || []).length >= 3 &&
    (H.match(/aria-controls="/g) || []).length >= 3, '');
  check('every menu item is a menuitem, outside the tab order until its sheet opens',
    (H.match(/role="menuitem" tabindex="-1"/g) || []).length === 8,
    (H.match(/role="menuitem"/g) || []).length + ' menuitem(s)');
  check('a visible focus ring is declared for the toolbar, the palette and the surface',
    /\.toolbar \.tool:focus-visible/.test(H) && /\.swatch:focus-visible/.test(H) &&
    /#canvas:focus \{[^}]*outline:/.test(H) && /outline-offset/.test(H), '');
  check('the crosshair-bearing surface is still pinned direction: ltr',
    /#canvasWrap, #canvas \{ direction: ltr; \}/.test(H), '');
}

/* ================================================================
   accessibility — the popup
   ================================================================
   The popup is the other surface this pass owns, and it has no sim of its own:
   test/background-sim.node.js boots popup.js to grade the failure round trip,
   not the markup. These checks live here rather than nowhere. They are static
   because everything at issue IS static — a control nested inside another
   control, a live region that was not one, a focus ring that did not exist. */

console.log('\n=== a11y: popup/popup.html ===');
{
  const P = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const CSS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.css'), 'utf8');

  /* THE ONE THAT WAS ACTUALLY BROKEN. <button><select></select></button> is
     invalid HTML: the parser does not reject it, the browser renders it, and
     the result is a control whose accessible name swallows a second control and
     which a keyboard user cannot reach without firing a capture. */
  const modeBlocks = P.match(/<button class="mode"[\s\S]*?<\/button>/g) || [];
  check('all five capture modes are still buttons', modeBlocks.length === 5,
    modeBlocks.length + ' mode button(s)');
  // the button's OWN opening tag is not something it contains
  const inner = modeBlocks.map(b => b.slice(b.indexOf('>') + 1));
  check('no capture-mode button contains another control',
    !inner.some(b => /<(select|input|button|textarea|a)\b/i.test(b)),
    inner.filter(b => /<(select|input|button|textarea|a)\b/i.test(b)).length + ' nested');
  check('the delay dropdown is a sibling of its button, not a child',
    /<div class="mode-row">[\s\S]*?<\/button>\s*<select id="delaySel"/.test(P), '');
  const popJs = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
  check('...and popup.js no longer has to filter its own bubbling clicks',
    !/tagName === 'SELECT'/.test(popJs),
    /tagName === 'SELECT'/.test(popJs) ? 'the guard is still there' : 'the guard is gone, not commented out');
  check('...and the stylesheet lays the row out without naming a physical edge',
    /\.mode-row \{[^}]*position: relative/.test(CSS) &&
    /\.mode-select \{[^}]*inset-inline-end/.test(CSS) &&
    !/\.mode-select \{[^}]*\b(left|right):/.test(CSS), '');

  const errBlock = (/<div id="err"[\s\S]*?<\/div>/.exec(P) || [''])[0];
  check('the failure box is a live region',
    /role="alert"/.test(errBlock) && /aria-live="assertive"/.test(errBlock) &&
    /aria-atomic="true"/.test(errBlock), errBlock.slice(0, 90));
  check('...assertive, because a capture the user asked for did not happen',
    /aria-live="assertive"/.test(errBlock), '');
  /* Both halves have to be PRESENT before their order means anything — an
     ordering check that a missing element satisfies is worse than no check.
     (test/background-sim.node.js grades the same two ids from the other side:
     it reads whatever is nested in #err and asserts the dismiss control and the
     text node both survive.) */
  const iText = errBlock.indexOf('id="errText"'), iX = errBlock.indexOf('id="errDismiss"');
  check('...and the message comes before the control that dismisses it',
    iText >= 0 && iX >= 0 && iText < iX, 'errText@' + iText + ' errDismiss@' + iX);
  check('...so the stylesheet no longer needs an order override to undo the markup',
    !/\.err \.icon-btn \{[^}]*order:/.test(CSS),
    /\.err \.icon-btn \{[^}]*order:/.test(CSS) ? 'order: is still overriding the markup' : 'no order: in .err .icon-btn');
  check('the failure box still starts hidden', /\shidden[\s>]/.test(errBlock), errBlock.slice(0, 40));

  check('the popup has a document title a screen reader can announce',
    /<title data-i18n="appShortName">/.test(P), (/<title[^>]*>/.exec(P) || [''])[0]);
  check('every pictogram beside its own label is hidden from the reader',
    (P.match(/class="mode-icon" aria-hidden="true"/g) || []).length === 5 &&
    (P.match(/class="dot" aria-hidden="true"/g) || []).length === 2,
    (P.match(/aria-hidden="true"/g) || []).length + ' hidden decorations');
  check('the two chords are announced as shortcuts, not as trailing prose',
    (P.match(/<kbd aria-hidden="true">/g) || []).length === 2 &&
    (P.match(/aria-keyshortcuts="Alt\+Shift\+[PV]"/g) || []).length === 2,
    (P.match(/aria-keyshortcuts="/g) || []).length + ' aria-keyshortcuts');
  check('every icon-only control in the popup has an accessible name',
    /id="themeBtn"[^>]*aria-label:popupToggleTheme/.test(P) &&
    /id="errDismiss"[^>]*aria-label:popupDismiss/.test(P) &&
    /id="delaySel"[^>]*aria-label:popupDelayLabel/.test(P), '');
  const invented = (P.match(/title:([A-Za-z0-9_]+); aria-label:([A-Za-z0-9_]+)/g) || [])
    .filter(s => { const m = /title:([A-Za-z0-9_]+); aria-label:([A-Za-z0-9_]+)/.exec(s); return m[1] !== m[2]; });
  check('...and none of those names invented a message key',
    invented.length === 0, invented.join(' | ') || 'every aria-label reuses its own tooltip key');
  check('a visible focus ring is declared for every control in the window',
    /\.mode:focus-visible/.test(CSS) && /\.icon-btn:focus-visible/.test(CSS) &&
    /\.footer a:focus-visible/.test(CSS) && /\.mode-select:focus-visible/.test(CSS) &&
    /\.expand-toggle input:focus-visible/.test(CSS) && /outline-offset/.test(CSS), '');
}

/* ================================================================
   contrast — both themes, computed, not eyeballed
   ================================================================
   WCAG 2.1 relative luminance and the 1.4.3 / 1.4.11 thresholds, computed from
   the custom properties the two stylesheets actually declare rather than from
   a table copied out of a design doc: change a --fg2 and this arithmetic
   changes with it. Every pair below is a pair these two surfaces really paint.
   4.5:1 for text under 18.66px (which is all of it), 3:1 for a focus indicator
   or a control boundary. Ratios are printed whether they pass or not, because
   "AA" without a number is an assertion, not a measurement. */
console.log('\n=== contrast: computed ratios, light and dark ===');
{
  const srgb = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  function rgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const lum = c => 0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
  function ratio(a, b) {
    const x = lum(rgb(a)), y = lum(rgb(b));
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /* Pull the theme out of the stylesheet rather than restating it. The dark
     values are declared twice — once for the stored preference, once for the
     system one — and both are read, because a theme that only passes in one of
     them passes for half the users. */
  function vars(css, selector) {
    const i = css.indexOf(selector);
    if (i < 0) return null;
    const block = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
    const out = {};
    for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]] = m[2];
    return out;
  }
  const COMMON_CSS = fs.readFileSync(path.join(ROOT, 'pages', 'common.css'), 'utf8');
  const POPUP_CSS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.css'), 'utf8');
  const EDITOR_STYLE = (/<style>[\s\S]*?<\/style>/.exec(EDITOR_HTML) || [''])[0]
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  /* WHICH TOKEN THE RULE ACTUALLY NAMES. Grading a hard-coded pair of token
     NAMES measures the palette and nothing else: swap --control-line back to
     the 1.29:1 --line in the .swatch rule and a table that had "control-line"
     written into it would go on reporting 3.57:1 for a ring nobody can see.
     Teeth caught exactly that. The token is read out of the declaration, so the
     row grades the colour the browser will paint. */
  function tokenOf(css, selector, prop, fallback) {
    const i = css.indexOf(selector);
    if (i < 0) return fallback;
    const block = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
    const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:[^;]*var\\(\\s*--([a-z0-9-]+)').exec(block);
    return m ? m[1] : fallback;
  }
  const PAINTS = {
    swatchRing: tokenOf(EDITOR_STYLE, '.swatch {', 'outline', 'line'),
    chipBg: tokenOf(EDITOR_STYLE, '.tool.active {', 'background', 'accent'),
    chipFg: tokenOf(EDITOR_STYLE, '.tool.active {', 'color', 'accent-fg'),
    modeIcon: tokenOf(POPUP_CSS, '.mode-icon {', 'color', 'accent'),
    linkHover: tokenOf(POPUP_CSS, '.footer a:hover {', 'color', 'accent'),
    dot: tokenOf(POPUP_CSS, '.dot {', 'color', 'line')
  };
  check('the contrast table reads the token each rule names, not one it assumed',
    Object.values(PAINTS).every(t => t && t.length > 2),
    Object.entries(PAINTS).map(([k, v]) => k + '=--' + v).join(' '));

  const themes = [
    ['editor  light', vars(COMMON_CSS, ':root {')],
    ['editor  dark ', vars(COMMON_CSS, ':root[data-theme="dark"]')],
    ['editor  dark*', vars(COMMON_CSS, ':root:not([data-theme])')],
    ['popup   light', vars(POPUP_CSS, ':root {')],
    ['popup   dark ', vars(POPUP_CSS, ':root[data-theme="dark"]')],
    ['popup   dark*', vars(POPUP_CSS, ':root:not([data-theme])')]
  ];
  check('every theme block this section grades was found in the stylesheets',
    themes.every(([, v]) => v && v.fg && v.bg && v.accent),
    themes.map(([n, v]) => n.trim() + ':' + (v ? Object.keys(v).length : 'missing')).join(' '));

  /* Every colour pages/editor.html paints is a token, never a literal — a
     literal is a second opinion that nothing re-measures the day the palette
     moves, and the dark accent moved by 0.008 in luminance during this very
     release (4.44:1 to 4.60:1 against white). The two exceptions are the
     selection box and the crosshair, which are canvas INK: they are drawn into
     a bitmap by a 2D context that cannot resolve a custom property, and they
     sit on an arbitrary screenshot rather than on a theme surface — which is
     why the crosshair is drawn twice, white under accent. */
  {
    const style = (/<style>[\s\S]*?<\/style>/.exec(EDITOR_HTML) || [''])[0]
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    /* One exemption, by exact text, with a reason a person can read — the same
       shape as PHYSICAL_OK and BARE_OK in test/i18n-sim.node.js, and for the
       same reason: a regex that tries to tell a legitimate literal from an
       illegitimate one has to understand intent. #canvas's backing colour is
       PAPER, not chrome. A screenshot with transparency is composited onto it,
       renderExport() fills the exported bitmap with the same white, and a
       theme-following backdrop would mean the same shot looked different in
       dark mode and exported differently again. */
    const LITERAL_OK = [
      { decl: 'background: #fff', why: '#canvas paper — matches the white renderExport() fills, and must not follow the theme' }
    ];
    const literals = (style.match(/(?:color|background|outline|border|fill)[^;{}]*:\s*[^;{}]*#[0-9a-fA-F]{3,8}/g) || [])
      .map(s => s.trim())
      .filter(s => !LITERAL_OK.some(r => r.decl === s));
    check('the editor stylesheet paints only palette tokens, never a hex literal',
      literals.length === 0, literals.slice(0, 3).join(' | ') ||
      'no colour literals beyond ' + LITERAL_OK.length + ' named exemption');
  }

  const rows = [];
  function pair(theme, v, label, fg, bg, need) {
    if (!v) return;
    const r = ratio(fg, bg);
    rows.push({ theme, label, r, need, ok: r >= need - 0.005, fg, bg });
  }
  for (const [name, v] of themes) {
    if (!v) continue;
    const dark = /dark/.test(name);
    if (/editor/.test(name)) {
      pair(name, v, 'toolbar glyph            .tool', v.fg, v.bg, 4.5);
      pair(name, v, 'ACTIVE tool chip         .tool.active', v[PAINTS.chipFg], v[PAINTS.chipBg], 4.5);
      pair(name, v, 'menu item                #moreMenu button', v.fg, v.panel, 4.5);
      pair(name, v, 'menu item, hovered', v.fg, v.bg2, 4.5);
      pair(name, v, 'shortcut sheet body      td', v.fg2, v.panel, 4.5);
      pair(name, v, 'spinner caption          #loading', v.fg2, v.bg, 4.5);
      pair(name, v, 'swatch ring              .swatch', v[PAINTS.swatchRing], v.panel, 3.0);
      pair(name, v, 'focus ring on the panel', v.accent, v.panel, 3.0);
      pair(name, v, 'focus ring on the stage', v.accent, v.bg, 3.0);
      pair(name, v, 'focus ring on a hovered row', v.accent, v.bg2, 3.0);
    } else {
      const err = dark ? ['#fca5a5', '#3b1d1d'] : ['#991b1b', '#fee2e2'];
      pair(name, v, 'header title             .title', v.fg, v.bg, 4.5);
      pair(name, v, 'mode subtitle (11px)     .mode-text small', v.fg2, v.bg, 4.5);
      pair(name, v, 'mode subtitle, hovered', v.fg2, v.hover, 4.5);
      pair(name, v, 'mode pictogram           .mode-icon', v[PAINTS.modeIcon], v.bg2, 4.5);
      pair(name, v, 'shortcut chord           kbd', v.fg2, v.bg2, 4.5);
      pair(name, v, 'delay dropdown           .mode-select', v.fg, v.bg2, 4.5);
      pair(name, v, 'expand toggle label', v.fg2, v.bg2, 4.5);
      pair(name, v, 'footer link              .footer a', v.fg2, v.bg, 4.5);
      pair(name, v, 'footer link, hovered', v[PAINTS.linkHover], v.bg, 4.5);
      pair(name, v, 'footer separator         .dot', v[PAINTS.dot], v.bg, 4.5);
      pair(name, v, 'failure text             .err', err[0], err[1], 4.5);
      pair(name, v, 'focus ring on the window', v.accent, v.bg, 3.0);
      pair(name, v, 'focus ring on a panel', v.accent, v.bg2, 3.0);
      pair(name, v, 'focus ring on the failure box', v.accent, err[1], 3.0);
    }
  }
  for (const r of rows) {
    console.log('      ' + (r.ok ? 'AA   ' : 'FAIL ') + r.r.toFixed(2).padStart(6) +
      ' : 1  (need ' + r.need.toFixed(1) + ')  ' + r.theme + '  ' + r.label.padEnd(34) +
      r.fg + ' on ' + r.bg);
  }
  const bad = rows.filter(r => !r.ok);
  check('every colour pair the editor paints clears WCAG AA in both themes',
    bad.filter(r => /editor/.test(r.theme)).length === 0,
    bad.filter(r => /editor/.test(r.theme)).map(r => r.theme + ' ' + r.label.trim() + ' ' + r.r.toFixed(2)).join(' | ') ||
    rows.filter(r => /editor/.test(r.theme)).length + ' pairs, worst ' +
    Math.min.apply(null, rows.filter(r => /editor/.test(r.theme) && r.need === 4.5).map(r => r.r)).toFixed(2) + ':1');
  check('every colour pair the popup paints clears WCAG AA in both themes',
    bad.filter(r => /popup/.test(r.theme)).length === 0,
    bad.filter(r => /popup/.test(r.theme)).map(r => r.theme + ' ' + r.label.trim() + ' ' + r.r.toFixed(2)).join(' | ') ||
    rows.filter(r => /popup/.test(r.theme)).length + ' pairs, worst ' +
    Math.min.apply(null, rows.filter(r => /popup/.test(r.theme) && r.need === 4.5).map(r => r.r)).toFixed(2) + ':1');
  check('the two dark declarations (stored preference and system) agree',
    JSON.stringify(themes[1][1]) === JSON.stringify(themes[2][1]) ||
    Object.keys(themes[1][1]).every(k => themes[1][1][k] === themes[2][1][k]),
    'pages/common.css');
  check('...and so do the popup\'s',
    Object.keys(themes[4][1]).every(k => themes[4][1][k] === themes[5][1][k]),
    'popup/popup.css');
}

/* ================================================================
   failure text — what a page is allowed to put on screen
   ================================================================
   Same class of bug as the worker's parked failure note, one surface along:
   an exception's own text interpolated into a toast. The worker path took
   three attempts to settle and the answer was an ALLOWLIST — a table of fixed
   sentences, one generic sentence for anything else, and the raw text to the
   console only. These checks hold the page surface to that same answer.

   The hostile string below is the operator's original probe, deliberately
   re-run here: the apostrophe is the character that defeated the SECOND
   attempt on the worker path (a regex whose class excluded it, which Chrome
   does not percent-encode, so a path containing one carried the token and the
   card number straight through). A reducer that ever grows a pattern will fail
   on this input again. */
console.log('\n=== failure text ===');
{
  const HOSTILE = "Failed to write file:///C:/Users/jane/Desktop/o'brien/statement.pdf" +
                  "?token=SECRET9&card=4111111111111111";
  const SECRETS = ['token', 'SECRET9', '4111', "o'brien", 'file://', 'jane', 'Desktop', 'statement'];

  /* Call the reducer with console.error captured: "raw text to the console
     only" is half the contract, so the check has to see both halves. */
  function reduce(e) {
    const real = console.error;
    const logged = [];
    console.error = function (x) { logged.push(x); };
    try { return { out: COMMON.fsHumanReason(e), logged: logged }; }
    finally { console.error = real; }
  }
  const leaks = s => SECRETS.filter(k => String(s).indexOf(k) >= 0);

  check('pages/common.js exposes the reducer to a sim', typeof COMMON.fsHumanReason === 'function',
    COMMON.__loadError || typeof COMMON.fsHumanReason);

  if (typeof COMMON.fsHumanReason === 'function') {
    {
      const r = reduce(new Error(HOSTILE));
      check('a hostile exception message reaches the screen as none of itself', leaks(r.out).length === 0,
        JSON.stringify(r.out));
      check('...and the raw text still reaches the console', r.logged.length === 1, 'logged ' + r.logged.length);
    }
    {
      // A bare string throw, and a DOMException-shaped object: same answer.
      check('a bare hostile string is reduced too', leaks(reduce(HOSTILE).out).length === 0, '');
      check('a DOMException-shaped hostile object is reduced too',
        leaks(reduce({ name: 'NotAllowedError', message: HOSTILE }).out).length === 0, '');
    }
    {
      /* The output is never built OUT of the input. A substring test catches
         the whole family of "sanitise then interpolate" fixes at once — that is
         what both failed worker attempts were. */
      const inputs = [HOSTILE, 'https://a.example/p?k=v', 'x', '', '   ', 'Failed to fetch',
                      'blob:chrome-extension://abcdef/1-2-3', 'C:\\Users\\jane\\shot.png'];
      let carried = 0, shared = 0;
      for (const i of inputs) {
        const out = reduce(i).out;
        if (i.length > 3 && String(out).indexOf(i) >= 0) carried++;
        if (i.length > 3 && i.indexOf(String(out)) >= 0) shared++;
      }
      check('no input is ever carried into its own answer', carried === 0, carried + ' of ' + inputs.length);
      check('...and no answer is ever a slice of its input', shared === 0, shared + ' of ' + inputs.length);
    }
    {
      /* The guard must not ask a hostile value for its own opinion of itself:
         String()/concatenation on a foreign object runs that object's code.
         Same rule the worker's gate 2 was fixed to obey. */
      let toStrings = 0;
      const trap = {
        get message() { return { toString: function () { toStrings++; return HOSTILE; } }; },
        toString: function () { toStrings++; return HOSTILE; },
        valueOf: function () { toStrings++; return HOSTILE; }
      };
      const r = reduce(trap);
      check('a non-string message is never stringified by the guard', toStrings === 0, toStrings + ' calls');
      check('...and it still gets an answer', leaks(r.out).length === 0 && String(r.out).length > 0, JSON.stringify(r.out));
      check('null and undefined get an answer instead of throwing',
        String(reduce(null).out).length > 0 && String(reduce(undefined).out).length > 0, '');
    }
    {
      /* Sentences FullShot itself writes are the whole point of a table rather
         than a blanket "say nothing": the two most common real failures on
         these pages stay actionable. */
      const decode = reduce(new Error('Failed to decode image')).out;
      const big = reduce(new Error('Canvas export failed — image may be too large')).out;
      const generic = reduce(new Error('some engine wording nobody wrote')).out;
      check('a sentence FullShot wrote is answered specifically, not generically',
        decode !== generic && big !== generic && decode !== big, [decode, big, generic].join(' | '));
      check('an answer survives a second pass unchanged (idempotent)',
        reduce(decode).out === decode && reduce(generic).out === generic, '');
    }
  }

  /* ---- source: no page still interpolates a raw exception ---- */
  const PAGES = ['result.js', 'beautify.js', 'scrollclip.js', 'editor.js'];
  for (const f of PAGES) {
    const src = fs.readFileSync(path.join(ROOT, 'pages', f), 'utf8');
    const raw = src.match(/e\s*&&\s*e\.message\s*\|\|\s*e/g) || [];
    check('pages/' + f + ' never interpolates a raw exception', raw.length === 0,
      raw.length ? raw.length + ' site(s)' : 'none');
  }
  {
    /* The doctrine the worker path paid for twice: no pattern on this road.
       The region is bounded at both ends so an unrelated helper added later
       cannot redden a check about the reducer — or, worse, satisfy it. */
    const src = fs.readFileSync(path.join(ROOT, 'pages', 'common.js'), 'utf8');
    const from = src.indexOf('const FS_REASON_GENERIC');
    const to = src.indexOf('function fsToast');
    const region = from >= 0 && to > from ? src.slice(from, to) : '';
    check('the reducer is where the checks above think it is', region.length > 0,
      from + '..' + to);
    check('the reducer never matches text with a pattern',
      region.length > 0 && !/(RegExp|\.replace\s*\(|\.test\s*\(|\.match\s*\(|\.exec\s*\()/.test(region),
      'regex-free region');
    check('the sentences it can show are literals in a table',
      /const FS_REASONS = \[/.test(region), 'FS_REASONS table');
  }
}

console.log('\nchecks: ' + CHECKS);
console.log(FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS');
process.exit(FAILS ? 1 : 0);

})().catch(e => { console.log('FATAL ' + (e && e.stack || e)); process.exit(1); });
