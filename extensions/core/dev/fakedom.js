/* SPDX-License-Identifier: MPL-2.0
   core/dev/fakedom.js — NODE-SIDE TEST HELPER. NEVER SHIPPED.

   core/dev/ is OUTSIDE the vendored surface, and that is a rule rather than an
   accident: vendoring copies core/v1/** only, no package allowlist may include
   dev/, and nothing inside an extension may require this file.

   PROMOTED, NOT WRITTEN. Source: Extension/Full_Screen_Shot/test/pixel-sim/fakedom.js
   sha256 of that source at promotion: 8479fc889ef0c2155ec7e03d4de40fcaaf9cd77e17a27dcd9e6a15ba5ad35e8e
   Promoted 2026-08-14. Everything below this header is that file byte for byte;
   the header is the only addition.

   THE ORIGINAL IS STILL THERE, AND THAT IS DELIBERATE. FullShot's sims require
   it by relative path (test/pixel-sim/run.js and five *.node.js suites), and
   FullShot's import contract is zero file moves and zero source changes. So two
   copies exist today. The sha256 above is the whole defence against them
   drifting — there is no CI check on it yet — and re-pointing FullShot's sims
   at this copy is what removes the second one.

   Licence: core/ is MPL-2.0 (core/LICENSE), which is not the licence on the
   tree this came from. Both are the same copyright holder, which is what makes
   that possible; the copy still under Extension/Full_Screen_Shot/ keeps that
   tool's licence.

   Exports: El, Doc, ShadowRootFake, RangeFake, gcs, hiddenNow, makeWindow, collectSubtree. No dependencies.
*/
/* Shared fake DOM for FullShot pixel simulations (no browser needed).
   Same modelling approach as test/sim-torture.node.js, extended with:
   - getBoundingClientRect overrides (per-element viewport rects)
   - device-pixel-ratio quantization of scroll offsets (Windows 125% zoom:
     scrollTop can only store multiples of 1/dpr css px)
   - window size / dpr parameters per scenario. */

'use strict';

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
  querySelectorAll() { return collectSubtree(this.children); }
  getElementById(id) { for (const el of collectSubtree(this.children)) if (el.id === id) return el; return null; }
}

function collectSubtree(children) {
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
    this._raw = null;
    this._sm = new Map();
    this._attrs = new Map();
    this._scrollTop = 0;
    this._scrollLeft = 0;
    this._base = base || {};
    this._rect = null;            // optional () => {left,top,width,height}
    this.contentWindow = null;
    this._contentDoc = undefined;
    this._onClick = null;         // scenario click handler (load-more sim)
    this._onScroll = null;        // scenario scroll handler (pane infinite-scroll sim)
    this._onAttrRead = null;      // scenario attribute-read hook (skeleton settle sim)
  }
  appendChild(c) { c._parent = this; this.children.push(c); return c; }
  remove() {
    const p = this._parent;
    if (p && p.children) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
    this._parent = null;
  }
  click() { if (typeof this._onClick === 'function') { try { this._onClick(this); } catch (_) {} } }
  get parentElement() { return this._parent instanceof El ? this._parent : null; }
  get parentNode() { return this._parent; }
  // v1.9.6: a synthetic text node for LEAF elements (no element children) with
  // text -- lets Range.setStart(el.firstChild, off) + getClientRects() model a
  // sub-token rect for token-precise redaction. nodeType 3, back-ref to owner.
  get firstChild() {
    if (this.children && this.children.length) return null;
    const t = this.textContent;
    if (t == null || t === '') return null;
    return { nodeType: 3, nodeValue: String(t), textContent: String(t), _owner: this };
  }
  get shadowRoot() { return this._shadow; }
  attachShadow() { this._shadow = new ShadowRootFake(this); return this._shadow; }
  querySelectorAll() { return collectSubtree(this.children); }
  getAttribute(name) {
    if (typeof this._onAttrRead === 'function') { try { this._onAttrRead(this, name); } catch (_) {} }
    return name === 'style' ? this._raw : (this._attrs.has(name) ? this._attrs.get(name) : null);
  }
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
  get _dpr() {
    const w = this.ownerDocument && this.ownerDocument.defaultView;
    return (w && w.devicePixelRatio) || 1;
  }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(v) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    const c = Math.min(Math.max(0, Number(v) || 0), max);
    const dpr = this._dpr;
    this._scrollTop = Math.round(c * dpr) / dpr;   // device-pixel quantization
    if (typeof this._onScroll === 'function') { try { this._onScroll(this); } catch (_) {} }
  }
  get scrollLeft() { return this._scrollLeft; }
  set scrollLeft(v) {
    const max = Math.max(0, this.scrollWidth - this.clientWidth);
    const c = Math.min(Math.max(0, Number(v) || 0), max);
    const dpr = this._dpr;
    this._scrollLeft = Math.round(c * dpr) / dpr;
  }
  getBoundingClientRect() {
    if (this._rect) {
      const r = this._rect();
      return {
        left: r.left, top: r.top, width: r.width, height: r.height,
        right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top
      };
    }
    return { left: 0, top: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
  }
  get contentDocument() { return this._contentDoc === undefined ? undefined : this._contentDoc; }
}

/* v1.9.6: minimal Range for token-precise redaction. getClientRects() returns
   one sub-rect per LINE for the [startOffset,endOffset) character span, using a
   uniform char-width model on the owner element's rect.

   v1.10.2 — THE MODEL NOW WRAPS, AND THE OLD COMMENT HERE IS WHY IT HAD TO.
   It read: "The single-line model covers the sandbox test; real multi-line
   wrapping (multiple client rects) is a browser reality capture.js already
   iterates over." That sentence is the whole bug. capture.js does iterate, and
   it emits ONE BOX PER RECT, so a token that wraps produces two boxes from one
   match — and every counter downstream that subtracted a box count from a match
   count was wrong on ordinary markup while this file could not express the
   shape. A fake DOM that cannot produce the page shape that breaks the product
   is a fake DOM that grades the implementation's own assumptions.

   OPT-IN AND BYTE-COMPATIBLE. An element wraps only if it declares
   `_wrapAt = [k, ...]` — the character offsets at which a new line starts. With
   no declaration there is one line, maxLen === len, and the returned rect is
   identical to the one this class returned before, which is why no existing
   scenario moves. */
class RangeFake {
  constructor() { this._sn = null; this._so = 0; this._en = null; this._eo = 0; }
  setStart(node, off) { this._sn = node; this._so = off | 0; }
  setEnd(node, off) { this._en = node; this._eo = off | 0; }
  selectNodeContents(node) { this._sn = this._en = node; this._so = 0; this._eo = ((node && (node.nodeValue || '')).length) || 0; }
  getClientRects() {
    const node = this._sn;
    if (!node || !node._owner) return [];
    let r; try { r = node._owner.getBoundingClientRect(); } catch (_) { return []; }
    const len = (node.nodeValue || '').length || 1;
    const s = Math.max(0, Math.min(this._so, len));
    const e = Math.max(s, Math.min(this._eo, len));
    /* The line grid: [from,to) per line, from the owner's declared breaks. */
    const brk = Array.isArray(node._owner._wrapAt) ? node._owner._wrapAt : [];
    const cuts = brk.map(n => Math.max(0, Math.min(len, n | 0)))
      .filter(n => n > 0 && n < len).sort((a, b) => a - b);
    const lines = [];
    let from = 0;
    for (const c of cuts) { if (c > from) { lines.push([from, c]); from = c; } }
    lines.push([from, len]);
    const lineH = r.height / lines.length;
    let maxLen = 1;
    for (const ln of lines) maxLen = Math.max(maxLen, ln[1] - ln[0]);
    const cw = r.width / maxLen;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const a = Math.max(s, lines[i][0]), b = Math.min(e, lines[i][1]);
      if (b <= a) continue;
      const x0 = r.left + (a - lines[i][0]) * cw, w = (b - a) * cw;
      const y0 = r.top + i * lineH;
      if (w < 0.5) continue;
      out.push({ left: x0, top: y0, width: w, height: lineH, right: x0 + w, bottom: y0 + lineH, x: x0, y: y0 });
    }
    return out;
  }
  getBoundingClientRect() { const rs = this.getClientRects(); return rs[0] || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; }
  detach() {}
}

class Doc {
  constructor() { this.documentElement = null; this.body = null; this.defaultView = null; }
  get scrollingElement() { return this.documentElement; }
  createElement(tag) { return new El(tag, this, { clientH: 0, clientW: 0, contentH: 0 }); }
  createRange() { return new RangeFake(); }
  querySelectorAll() { return this.documentElement ? [this.documentElement].concat(collectSubtree(this.documentElement.children)) : []; }
  getElementById(id) { for (const el of this.querySelectorAll('*')) if (el.id === id) return el; return null; }
}

function inheritedVisibility(el) {
  for (let n = el; n; n = (n._parent instanceof ShadowRootFake ? n._parent.host : n._parent)) {
    const v = n._sv && n._sv('visibility');
    if (v) return v;
  }
  return 'visible';
}
/* font-size INHERITS in CSS, so the fake has to inherit it too. Added in the
   same commit as placement clause 4 (REDACTION-CLAIM-SPEC.md §6.2 / §7.5.4):
   without it every fixture's computed fontSize is `undefined`, parseFloat gives
   NaN, and capture.js routes the whole run to declined.unmeasurable — all 35
   scenarios collapse on day one for a reason that is entirely this file's.

   Note which way that cuts, because it is the first evidence that the routing
   is load-bearing. Had NaN been allowed to mean "not placed", an engine that
   answered nothing would have produced a CONFIDENT NEGATIVE indistinguishable
   from a measurement — proxy number seven, arriving through the failure path.
   The sim's inability to supply a font size is the cheapest possible proof
   that "unreadable" and "absent" must be different answers. */
function inheritedFontSize(el) {
  for (let n = el; n; n = (n._parent instanceof ShadowRootFake ? n._parent.host : n._parent)) {
    const v = n._sv && n._sv('font-size');
    if (v) return v;
  }
  return '16px';
}
function gcs(el) {
  return {
    position: el._sv('position') || 'static',
    overflowY: el._sv('overflow-y') || el._sv('overflow') || 'visible',
    overflowX: el._sv('overflow-x') || el._sv('overflow') || 'visible',
    visibility: inheritedVisibility(el),
    opacity: el._sv('opacity') || '1',
    display: el._sv('display') || 'block',
    fontSize: inheritedFontSize(el)
  };
}
function hiddenNow(el) {
  const cs = gcs(el);
  return cs.visibility === 'hidden' || Number(cs.opacity) === 0;
}

function makeWindow(doc, opts) {
  const { w, h, dpr } = Object.assign({ w: 1280, h: 720, dpr: 1 }, opts);
  const win = {
    innerWidth: w, innerHeight: h, devicePixelRatio: dpr,
    scrollX: 0, scrollY: 0,
    parent: null, top: null, document: doc,
    _msgListeners: [], _scrollListeners: [],
    scrollTo(x, y) {
      const maxY = Math.max(0, doc.documentElement.scrollHeight - h);
      const maxX = Math.max(0, doc.documentElement.scrollWidth - w);
      const cy = Math.min(Math.max(0, Number(y) || 0), maxY);
      const cx = Math.min(Math.max(0, Number(x) || 0), maxX);
      win.scrollX = Math.round(cx * dpr) / dpr;
      win.scrollY = Math.round(cy * dpr) / dpr;
      // Real browsers fire scroll events on programmatic scroll; infinite-scroll
      // loaders (IntersectionObserver / scroll handlers) key off these.
      for (const fn of win._scrollListeners) { try { fn(); } catch (_) {} }
    },
    addEventListener(type, fn) {
      if (type === 'message') win._msgListeners.push(fn);
      else if (type === 'scroll') win._scrollListeners.push(fn);
    },
    removeEventListener(type, fn) {
      const arr = type === 'message' ? win._msgListeners : type === 'scroll' ? win._scrollListeners : null;
      if (!arr) return;
      const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
    },
    postMessage() {},
    getComputedStyle: gcs
  };
  doc.defaultView = win;
  win.window = win;
  return win;
}

module.exports = { El, Doc, ShadowRootFake, RangeFake, gcs, hiddenNow, makeWindow, collectSubtree };
