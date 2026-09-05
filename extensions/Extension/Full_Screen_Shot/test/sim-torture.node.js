#!/usr/bin/env node
/* FullShot torture-test SIMULATOR (no browser needed).
   Loads the REAL content/capture.js and content/frame-expand.js into node vm
   realms against a hand-rolled fake DOM that replicates test/torture.html:
   shadow-DOM sticky rail (+ sticky-bottom © bar with visibility override),
   25k-element walk-budget filler, fixed FAB in a late shadow root, inner
   scroll panel, same-origin iframe, cross-origin iframe, multi-screen page.
   Grades the same 12 scoreboard assertions plus stricter sim-only checks
   (per-frame hide integrity, style-attribute restore equality, no leftover
   <style> nodes, scroll restore).  Modes:
     A  expandInner=true,  expandFrames=false (same-origin iframe path)
     B  expandInner=true,  expandFrames=true  (postMessage frame protocol)
     C  expandInner=false                     (pin panels, classic capture)
   What it CANNOT verify: real pixels, the 350ms walk time budget, and
   whether chrome.scripting reaches srcdoc frames — that needs real Chrome.
   Usage: node test/sim-torture.node.js  [exit 0 = all pass] */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..');
const CAPTURE_SRC = fs.readFileSync(path.join(ROOT, 'content', 'capture.js'), 'utf8');
const FRAME_SRC = fs.readFileSync(path.join(ROOT, 'content', 'frame-expand.js'), 'utf8');

const VP_W = 1280, VP_H = 720;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================ fake DOM ============================ */

function parseStyle(raw) {
  const m = new Map();
  if (!raw) return m;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    let v = part.slice(i + 1).trim();
    const imp = /!important$/i.test(v);
    if (imp) v = v.replace(/\s*!\s*important$/i, '').trim();
    if (k) m.set(k, { v, imp });
  }
  return m;
}
function serializeStyle(m) {
  const out = [];
  for (const [k, { v, imp }] of m) out.push(k + ':' + v + (imp ? ' !important' : ''));
  return out.join('; ');
}

class ShadowRootFake {
  constructor(host) { this.host = host; this.children = []; }
  appendChild(c) { c._parent = this; this.children.push(c); return c; }
  querySelectorAll(sel) { return collectSubtree(this.children); }
  getElementById(id) { let hit = null; for (const el of collectSubtree(this.children)) if (el.id === id) { hit = el; break; } return hit; }
}

function collectSubtree(children) {
  // light-DOM document order, never crossing shadow boundaries (like real qSA)
  const out = [];
  (function walk(list) {
    for (const el of list) { out.push(el); walk(el.children); }
  })(children);
  return out;
}

class El {
  constructor(tag, doc, base) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this._parent = null;
    this._shadow = null;
    this.id = '';
    this.textContent = '';
    this.assignedSlot = null;
    this._raw = null;            // style attribute string (null = absent)
    this._sm = new Map();        // parsed style props
    this._attrs = new Map();     // non-style attributes
    this._scrollTop = 0;
    this._scrollLeft = 0;
    this._base = base || {};     // { clientH, clientW, contentH, contentW } num|fn
    this.contentWindow = null;
    this._contentDoc = undefined; // undefined = not a frame; null = cross-origin
  }
  /* tree */
  appendChild(c) { c._parent = this; this.children.push(c); return c; }
  remove() {
    const p = this._parent;
    if (p && p.children) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
    this._parent = null;
  }
  get parentElement() { return this._parent instanceof El ? this._parent : null; }
  get parentNode() { return this._parent; }
  get shadowRoot() { return this._shadow; }
  attachShadow() { this._shadow = new ShadowRootFake(this); return this._shadow; }
  querySelectorAll(sel) { return collectSubtree(this.children); }
  /* attributes & style */
  getAttribute(name) { return name === 'style' ? this._raw : (this._attrs.has(name) ? this._attrs.get(name) : null); }
  setAttribute(name, v) {
    if (name === 'style') { this._raw = String(v); this._sm = parseStyle(v); }
    else this._attrs.set(name, String(v));
  }
  removeAttribute(name) {
    if (name === 'style') { this._raw = null; this._sm = new Map(); }
    else this._attrs.delete(name);
  }
  get style() {
    const self = this;
    return {
      setProperty(k, v, pri) {
        self._sm.set(String(k).toLowerCase(), { v: String(v), imp: pri === 'important' });
        self._raw = serializeStyle(self._sm);
      },
      removeProperty(k) { self._sm.delete(String(k).toLowerCase()); self._raw = self._sm.size ? serializeStyle(self._sm) : null; }
    };
  }
  _sv(k) { const e = this._sm.get(k); return e ? e.v : undefined; }
  _px(k) { const v = this._sv(k); if (v == null) return null; const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v); return m ? parseFloat(m[1]) : null; }
  /* composed display:none chain (host hides its shadow content) */
  get _displayNone() {
    for (let n = this; n; ) {
      if (n._sv && n._sv('display') === 'none') return true;
      const p = n._parent;
      n = p ? (p instanceof ShadowRootFake ? p.host : p) : null;
    }
    return false;
  }
  _num(v, fallback) { return typeof v === 'function' ? v() : (v != null ? v : fallback); }
  _contentH() {
    if (this._base.contentH != null) return this._num(this._base.contentH, 0);
    let s = 0; for (const c of this.children) s += c.clientHeight; return s;
  }
  get clientHeight() {
    if (this._displayNone) return 0;
    if (this._sv('height') === 'auto') return Math.round(this._contentH());
    const h = this._px('height');
    if (h != null) return Math.round(h);
    if (this._base.clientH != null) return Math.round(this._num(this._base.clientH, 0));
    return Math.round(this._contentH());
  }
  get clientWidth() {
    if (this._displayNone) return 0;
    const w = this._px('width');
    if (w != null) return Math.round(w);
    return Math.round(this._num(this._base.clientW, 800));
  }
  get scrollHeight() { if (this._displayNone) return 0; return Math.max(this.clientHeight, Math.round(this._contentH())); }
  get scrollWidth() { if (this._displayNone) return 0; return Math.max(this.clientWidth, Math.round(this._num(this._base.contentW, this.clientWidth))); }
  get offsetHeight() { return this.clientHeight; }
  get offsetWidth() { return this.clientWidth; }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(v) { const max = Math.max(0, this.scrollHeight - this.clientHeight); this._scrollTop = Math.min(Math.max(0, Number(v) || 0), max); }
  get scrollLeft() { return this._scrollLeft; }
  set scrollLeft(v) { const max = Math.max(0, this.scrollWidth - this.clientWidth); this._scrollLeft = Math.min(Math.max(0, Number(v) || 0), max); }
  getBoundingClientRect() { return { top: 0, left: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  get contentDocument() { return this._contentDoc === undefined ? undefined : this._contentDoc; }
}

class Doc {
  constructor() { this.documentElement = null; this.body = null; this.defaultView = null; }
  get scrollingElement() { return this.documentElement; }
  createElement(tag) { return new El(tag, this, { clientH: 0, clientW: 0, contentH: 0 }); }
  querySelectorAll(sel) { return this.documentElement ? [this.documentElement].concat(collectSubtree(this.documentElement.children)) : []; }
  getElementById(id) { let hit = null; for (const el of this.querySelectorAll('*')) if (el.id === id) { hit = el; break; } return hit; }
}

function inheritedVisibility(el) {
  // visibility inherits; a descendant's explicit value overrides an ancestor's
  for (let n = el; n; n = (n._parent instanceof ShadowRootFake ? n._parent.host : n._parent)) {
    const v = n._sv && n._sv('visibility');
    if (v) return v;
  }
  return 'visible';
}
function gcs(el) {
  return {
    position: el._sv('position') || 'static',
    overflowY: el._sv('overflow-y') || el._sv('overflow') || 'visible',
    visibility: inheritedVisibility(el),
    opacity: el._sv('opacity') || '1',
    display: el._sv('display') || 'block'
  };
}

function makeWindow(doc) {
  const win = {
    innerWidth: VP_W, innerHeight: VP_H, devicePixelRatio: 1,
    scrollX: 0, scrollY: 0,
    parent: null, top: null, document: doc,
    _msgListeners: [],
    scrollTo(x, y) {
      const maxY = Math.max(0, doc.documentElement.scrollHeight - VP_H);
      const maxX = Math.max(0, doc.documentElement.scrollWidth - VP_W);
      win.scrollX = Math.min(Math.max(0, Number(x) || 0), maxX);
      win.scrollY = Math.min(Math.max(0, Number(y) || 0), maxY);
    },
    addEventListener(type, fn) { if (type === 'message') win._msgListeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'message') return;
      const i = win._msgListeners.indexOf(fn); if (i >= 0) win._msgListeners.splice(i, 1);
    },
    postMessage(data, origin) { deliverMessage(win, data, win._postSource || win); },
    getComputedStyle: gcs
  };
  doc.defaultView = win;
  win.window = win;
  return win;
}

function deliverMessage(targetWin, data, sourceWin) {
  setTimeout(() => {
    for (const fn of targetWin._msgListeners.slice()) {
      try { fn({ data, source: sourceWin }); } catch (e) { console.error('msg handler threw:', e); }
    }
  }, 0);
}

/* ==================== torture page replica ==================== */

function buildPage() {
  const doc = new Doc();
  const refs = {};

  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, {});
  doc.documentElement = html; doc.body = body;
  html.appendChild(body);

  const board = body.appendChild(new El('div', doc, { clientH: 60, clientW: VP_W }));
  board.id = 'scoreboard';

  const grid = body.appendChild(new El('div', doc, {}));
  const rail = grid.appendChild(new El('fs-test-rail', doc, { clientW: 280 }));
  const r = rail.attachShadow();

  // Reddit left-rail pattern: sticky WRAPPER (100vh, clipping) around the scroller
  const wrap = new El('div', doc, { clientH: VP_H, clientW: 264 });
  wrap.id = 'wrap';
  wrap.setAttribute('style', 'position:sticky;top:0;height:100vh;overflow:hidden');
  r.appendChild(wrap);
  const nav = new El('div', doc, { clientW: 264 });
  nav.id = 'nav';
  nav.setAttribute('style', 'height:100%;overflow-y:auto;background:#FF8800');
  nav._base.clientH = () => (wrap._sv('height') === 'auto' ? Math.round(nav._contentH()) : wrap.clientHeight);
  wrap.appendChild(nav);
  const navContent = nav.appendChild(new El('div', doc, { clientH: 2600, clientW: 248 }));
  navContent.appendChild(new El('div', doc, { clientH: 20, clientW: 248 })); // "STICKY NAV BOTTOM"
  const copy = nav.appendChild(new El('div', doc, { clientW: 264 }));
  copy.id = 'copy';
  copy.setAttribute('style', 'position:sticky;bottom:0;background:#8800FF;color:#fff;height:48px;padding:4px');
  const copySpan = copy.appendChild(new El('span', doc, { clientH: 40, clientW: 200 }));
  copySpan.setAttribute('style', 'visibility:visible !important');
  // nav natural content = 2600 + 48 (children sum), viewport-capped at 100vh
  nav._base.contentH = () => 2600 + copy.clientHeight;

  const main = grid.appendChild(new El('main', doc, {}));
  const panel = main.appendChild(new El('div', doc, { clientW: 900 }));
  panel.id = 'panel';
  panel.setAttribute('style', 'height:300px;overflow-y:auto;border:1px solid #ccc');
  panel.appendChild(new El('div', doc, { clientH: 900, clientW: 884 }));
  panel.appendChild(new El('div', doc, { clientH: 120, clientW: 884 })); // green marker

  const soifr = main.appendChild(new El('iframe', doc, { clientW: 900 }));
  soifr.id = 'soifr';
  soifr.setAttribute('style', 'width:90%;height:300px;border:1px solid #999;display:block;margin:20px 0');

  const xoifr = main.appendChild(new El('iframe', doc, { clientW: 900 }));
  xoifr.id = 'xoifr';
  xoifr.setAttribute('style', 'width:90%;height:200px;display:block;margin:20px 0;border:1px solid #999');
  xoifr._contentDoc = null; // cross-origin: contentDocument === null

  // self-sticky scroller (pre-Reddit-fix pattern must keep working)
  const toc = main.appendChild(new El('div', doc, { clientW: 900 }));
  toc.id = 'toc';
  toc.setAttribute('style', 'position:sticky;top:0;height:200px;overflow-y:auto');
  toc.appendChild(new El('div', doc, { clientH: 600, clientW: 884 }));

  const blocks = [];
  for (let i = 0; i < 6; i++) blocks.push(main.appendChild(new El('div', doc, { clientH: 500, clientW: 900 })));
  main._base.clientH = () => 100 + panel.clientHeight + 40 + soifr.clientHeight + 40 + xoifr.clientHeight + 40 + toc.clientHeight + 40 + 3000;
  main._base.contentH = main._base.clientH;
  rail._base.clientH = () => wrap.clientHeight;
  rail._base.contentH = rail._base.clientH;
  grid._base.clientH = () => Math.max(rail.clientHeight, main.clientHeight);
  grid._base.contentH = grid._base.clientH;

  const marker = body.appendChild(new El('div', doc, { clientH: 120, clientW: VP_W })); // blue bottom marker
  marker.id = 'bottomMarker';

  const filler = body.appendChild(new El('div', doc, {}));
  filler.setAttribute('style', 'display:none');
  for (let i = 0; i < 25000; i++) filler.appendChild(new El('span', doc, { clientH: 18, clientW: 40 }));

  const fabHost = body.appendChild(new El('fs-test-fab', doc, { clientH: 0, clientW: 0 }));
  const f = fabHost.attachShadow();
  const fab = new El('div', doc, { clientW: 64 });
  fab.id = 'fab';
  fab.setAttribute('style', 'position:fixed;right:24px;bottom:24px;width:64px;height:64px;border-radius:50%;background:#FF00FF');
  f.appendChild(fab);
  const fabI = fab.appendChild(new El('i', doc, { clientH: 64, clientW: 64 }));
  fabI.setAttribute('style', 'visibility:visible !important;display:block;width:100%;height:100%;background:#FF00FF;border-radius:50%');

  body._base.clientH = () => 60 + grid.clientHeight + 120;
  body._base.contentH = body._base.clientH;
  html._base.contentH = body._base.contentH;

  /* same-origin iframe inner document (1420px of content in a 300px frame) */
  const doc2 = new Doc();
  const html2 = new El('html', doc2, { clientH: 300, clientW: 900 });
  const body2 = new El('body', doc2, {});
  doc2.documentElement = html2; doc2.body = body2; html2.appendChild(body2);
  body2.appendChild(new El('div', doc2, { clientH: 1300, clientW: 900 }));
  body2.appendChild(new El('div', doc2, { clientH: 120, clientW: 900 })); // lime marker
  body2._base.clientH = () => 1420; body2._base.contentH = body2._base.clientH;
  html2._base.contentH = body2._base.contentH;
  soifr._contentDoc = doc2;

  /* cross-origin iframe inner document (short page — must never grow) */
  const doc3 = new Doc();
  const html3 = new El('html', doc3, { clientH: 200, clientW: 900 });
  const body3 = new El('body', doc3, {});
  doc3.documentElement = html3; doc3.body = body3; html3.appendChild(body3);
  body3.appendChild(new El('div', doc3, { clientH: 160, clientW: 900 }));
  body3._base.clientH = () => 160; body3._base.contentH = body3._base.clientH;
  html3._base.contentH = body3._base.contentH;

  /* pre-capture user state (like torture.html) */
  panel.scrollTop = 200;
  nav.scrollTop = 150;
  toc.scrollTop = 50;

  Object.assign(refs, { doc, html, body, wrap, nav, copy, panel, soifr, xoifr, fab, toc, doc2, html2, doc3, html3 });
  return refs;
}

/* ==================== realms & fake background ==================== */

function makeRealm(name, win, doc, bg) {
  const realm = { name, win, doc, listeners: [], injectedFrameExpand: false };
  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { realm.listeners.push(fn); } },
      sendMessage(msg) { return bg.handle(realm, msg); }
    }
  };
  realm.ctx = vm.createContext({
    window: win, document: doc, chrome,
    getComputedStyle: gcs,
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 16),
    console
  });
  realm.run = src => vm.runInContext(src, realm.ctx, { filename: name + '.js' });
  realm.deliver = msg => { for (const fn of realm.listeners.slice()) { try { fn(msg, {}, () => {}) } catch (e) { console.error(name, 'listener threw:', e); } } };
  return realm;
}

function makeBackground(state) {
  const bg = { realms: [] };
  bg.handle = async (realm, msg) => {
    switch (msg.type) {
      case 'FS_FRAME':
        state.onFrame(msg);
        return { ok: true };
      case 'FS_DONE':
        state.meta = msg.meta; state.done = true;
        return { ok: true };
      case 'FS_ERROR':
        state.error = msg.error; state.done = true;
        console.error('  FS_ERROR from page:', msg.error);
        return { ok: true };
      case 'FS_EXPAND_FRAMES':
        await sleep(15); // simulate injection latency
        for (const r of bg.realms) {
          if (!r.injectedFrameExpand) { r.injectedFrameExpand = true; r.run(FRAME_SRC); }
        }
        for (const r of bg.realms) r.deliver({ type: 'FS_FRAMES_EXPAND' });
        return { ok: true };
      case 'FS_RESTORE_FRAMES':
        for (const r of bg.realms) r.deliver({ type: 'FS_FRAMES_RESTORE' });
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown message: ' + msg.type };
    }
  };
  return bg;
}

/* ==================== integrity snapshots ==================== */

function allElements(refs) {
  const out = [];
  (function walkEl(el) {
    out.push(el);
    if (el._shadow) for (const c of el._shadow.children) walkEl(c);
    for (const c of el.children) walkEl(c);
  })(refs.html);
  for (const d of [refs.doc2, refs.doc3]) (function walkEl(el) {
    out.push(el);
    for (const c of el.children) walkEl(c);
  })(d.documentElement);
  return out;
}
function styleSnapshot(refs) {
  const m = new Map();
  for (const el of allElements(refs)) m.set(el, el.getAttribute('style'));
  return m;
}
function leftoverStyles(refs) {
  return allElements(refs).filter(el => el.tagName === 'STYLE').length;
}

/* ==================== one simulated capture run ==================== */

async function runMode(mode) {
  const refs = buildPage();
  const { doc, html, wrap, nav, copy, panel, soifr, xoifr, fab, toc } = refs;

  const topWin = makeWindow(doc);
  topWin.top = topWin; topWin.parent = topWin;
  const win2 = makeWindow(refs.doc2); // same-origin iframe realm
  const win3 = makeWindow(refs.doc3); // cross-origin iframe realm
  for (const w of [win2, win3]) {
    w.top = topWin;
    // Real semantics: window.parent.postMessage(d) targets the parent window
    // and the event arrives with e.source === the CALLING (child) window.
    w.parent = { postMessage: d => deliverMessage(topWin, d, w) };
  }
  soifr.contentWindow = win2;
  xoifr.contentWindow = win3;

  topWin.scrollTo(0, 300); // user was mid-page

  const state = {
    done: false, error: null, meta: null, frames: [],
    onFrame(msg) {
      state.frames.push({
        i: msg.index, x: msg.x, y: msg.y,
        copyHidden: hiddenNow(copy), fabHidden: hiddenNow(fab),
        navHidden: hiddenNow(nav),
        navPos: gcs(nav).position, navH: nav.clientHeight,
        copyPos: gcs(copy).position, wrapPos: gcs(wrap).position,
        panelH: panel.clientHeight, panelTop: panel.scrollTop, tocTop: toc.scrollTop,
        soifrH: soifr.clientHeight, xoifrH: xoifr.clientHeight
      });
    }
  };
  const bg = makeBackground(state);
  const topRealm = makeRealm('top', topWin, doc, bg);
  const realm2 = makeRealm('soifr', win2, refs.doc2, bg);
  const realm3 = makeRealm('xoifr', win3, refs.doc3, bg);
  bg.realms = [topRealm, realm2, realm3];

  function hiddenNow(el) { const cs = gcs(el); return cs.visibility === 'hidden' || Number(cs.opacity) === 0; }

  const preStyles = styleSnapshot(refs);

  topRealm.run(CAPTURE_SRC);

  /* live scoreboard flags, polled like the real page */
  const S = {
    navExpanded: false, navStatic: false, copyHidden: false, fabHidden: false,
    panelExpanded: false, iframeExpanded: false, scrolledToBottom: false,
    xoifrGrewEver: false, panelUnpinned: false, copySeenVisible: false,
    wrapStatic: false, tocExpanded: false, tocStatic: false,
    snapNeutralized: false
  };
  const poll = setInterval(() => {
    const cssNode = html.children.find(c => c.id === '__fullshot-css');
    if (!cssNode) return;
    if (/scroll-snap-type:\s*none/i.test(cssNode.textContent || '')) S.snapNeutralized = true;
    if (nav.clientHeight > 2000) S.navExpanded = true;
    if (gcs(wrap).position === 'static') S.wrapStatic = true;
    if (toc.clientHeight > 580) S.tocExpanded = true;
    if (gcs(toc).position === 'static') S.tocStatic = true;
    if (topWin.scrollY > 100) {
      if (hiddenNow(copy)) S.copyHidden = true; else S.copySeenVisible = true;
    }
    if (topWin.scrollY > 100 && hiddenNow(fab)) S.fabHidden = true;
    if (panel.clientHeight > 900) S.panelExpanded = true;
    if (soifr.clientHeight > 1200) S.iframeExpanded = true;
    if (xoifr.clientHeight > 260) S.xoifrGrewEver = true;
    if (panel.scrollTop !== 200 && panel.clientHeight <= 900) S.panelUnpinned = true;
    if (topWin.scrollY + VP_H > html.scrollHeight - 200) S.scrolledToBottom = true;
  }, 10);

  /* kick off, like background's FS_START after popup/shortcut */
  const settings = {
    captureDelay: 150, hideFixed: true, preScroll: false, maxPageHeight: 50000,
    expandInner: mode !== 'C', expandFrames: mode === 'B'
  };
  topRealm.deliver({ type: 'FS_START', settings });

  const deadline = Date.now() + 25000;
  while (!state.done && Date.now() < deadline) await sleep(25);
  clearInterval(poll);
  const timedOut = !state.done;
  await sleep(600); // settle restores + late frame reports, like the page's 600ms

  /* ---------- grade ---------- */
  const checks = [];
  const add = (label, ok, extra) => checks.push({ label, ok: !!ok, extra });
  const expand = mode !== 'C';
  const F = state.frames;

  add('capture completed without FS_ERROR/timeout', !state.error && !timedOut,
    state.error || (timedOut ? 'timed out' : ''));

  if (expand) {
    add('sticky shadow nav expanded to full content', S.navExpanded);
    add('sticky WRAPPER switched sticky→static (Reddit rail pattern)', S.wrapStatic);
    add('self-sticky toc panel expanded + static', S.tocExpanded && S.tocStatic);
    add('inner panel expanded (deep marker capturable)', S.panelExpanded);
    add('same-origin iframe expanded', S.iframeExpanded);
  } else {
    // Neutralization may un-stick the wrap after frame 1 (that's desired);
    // the nav itself must never grow with expansion off.
    add('nav NOT expanded (expansion off)', !S.navExpanded);
    add('panel NOT expanded and pinned at 200 in every frame',
      !S.panelExpanded && !S.panelUnpinned && F.every(f => f.panelTop === 200));
    add('toc pinned at 50 in every frame (expansion off)', F.every(f => f.tocTop === 50));
    add('iframe NOT expanded', !S.iframeExpanded);
  }
  if (expand) {
    add('© bar kept visible (sticky neutralized inside expanded nav)', S.copySeenVisible && !S.copyHidden);
  } else {
    // Sticky is normal-flow content: it must be NEUTRALIZED (static), never
    // visibility-hidden — hiding would leave a blank band at its layout slot.
    add('© bar neutralized after frame 1 (static, never blanked)',
      F.slice(1).every(f => f.copyPos === 'static' && !f.copyHidden));
  }
  add('fixed FAB hidden after frame 1 (behind 25k elements — walk budget)', S.fabHidden);
  add('cross-origin iframe never grew (no permission-less expansion)', !S.xoifrGrewEver,
    'xoifr max seen ' + Math.max(0, ...F.map(f => f.xoifrH)));
  add('page scrolled to bottom', S.scrolledToBottom);

  /* frame-by-frame integrity (what the stitched image would show) */
  add('≥ 5 frames captured, monotonically descending', F.length >= 5 && F.every((f, i) => i === 0 || f.y > F[i - 1].y),
    F.length + ' frames');
  add('frame 0 shows © bar and FAB (appear exactly once)', F.length && !F[0].copyHidden && !F[0].fabHidden);
  if (expand) add('frames 2..N hide FAB, keep © bar (in-flow content)', F.slice(1).every(f => f.fabHidden && !f.copyHidden));
  else add('frames 2..N hide FAB (no repetition)', F.slice(1).every(f => f.fabHidden));
  if (!expand) add('sticky wrap neutralized after frame 1 (classic mode, no travel, no blank rail)',
    F.slice(1).every(f => f.wrapPos === 'static' && !f.navHidden));
  if (expand) add('expanded nav stays visible in all frames', F.every(f => !f.navHidden));
  add('last frame reaches page bottom', F.length && state.meta &&
    F[F.length - 1].y === Math.max(0, state.meta.totalH - VP_H),
    state.meta ? 'last y=' + F[F.length - 1].y + ' totalH=' + state.meta.totalH : '');

  /* ---------- after-capture restore ---------- */
  add('wrap back to sticky, nav back to 100vh', nav.clientHeight <= VP_H + 20 && gcs(wrap).position === 'sticky');
  add('toc restored (sticky, 200px, scrollTop 50)', gcs(toc).position === 'sticky' && toc.clientHeight === 200 && toc.scrollTop === 50);
  add('panel scroll position restored (200)', panel.scrollTop === 200, 'got ' + panel.scrollTop);
  add('nav scroll position restored (150)', nav.scrollTop === 150, 'got ' + nav.scrollTop);
  add('FAB and © visible again', !hiddenNow(fab) && !hiddenNow(copy));
  add('iframe height restored (~300)', Math.round(soifr.getBoundingClientRect().height) <= 320,
    'got ' + soifr.getBoundingClientRect().height);
  add('window scroll restored to 300', topWin.scrollY === 300, 'got ' + topWin.scrollY);

  /* sim-only deep checks */
  const post = styleSnapshot(refs);
  let styleDiffs = 0; let firstDiff = '';
  for (const [el, pre] of preStyles) {
    if (post.get(el) !== pre) {
      styleDiffs++;
      if (!firstDiff) firstDiff = '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '> "' + pre + '" → "' + post.get(el) + '"';
    }
  }
  add('every style attribute byte-identical after restore', styleDiffs === 0, firstDiff);
  add('scroll-snap-type neutralized during capture (v1.5.2)', S.snapNeutralized,
    S.snapNeutralized ? '' : 'never saw scroll-snap-type:none in capture css');
  add('no leftover <style> nodes anywhere (shadow + iframes included)', leftoverStyles(refs) === 0,
    leftoverStyles(refs) + ' left');
  add('no stray data-fullshot-root attribute', allElements(refs).every(el => el.getAttribute('data-fullshot-root') === null));
  if (mode === 'B') add('frame helper injected into child realms', realm2.injectedFrameExpand && realm3.injectedFrameExpand);

  return checks;
}

/* ==================== main ==================== */

(async () => {
  const modes = [
    ['A', 'expandInner=ON, same-origin path (no <all_urls>)'],
    ['B', 'expandInner=ON, expandFrames=ON (postMessage protocol)'],
    ['C', 'expandInner=OFF (classic pinned capture)']
  ];
  let fails = 0;
  for (const [mode, desc] of modes) {
    console.log('\n=== MODE ' + mode + ' — ' + desc + ' ===');
    let checks;
    try {
      checks = await runMode(mode);
    } catch (e) {
      console.log('FAIL  harness crashed: ' + (e && e.stack || e));
      fails++;
      continue;
    }
    for (const c of checks) {
      console.log((c.ok ? 'PASS' : 'FAIL') + '  ' + c.label + (c.extra ? '  — ' + c.extra : ''));
      if (!c.ok) fails++;
    }
  }
  console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL PASS') +
    '  (sim cannot verify: real pixels, 350ms time budget, srcdoc injection reality)');
  process.exit(fails ? 1 : 0);
})();
