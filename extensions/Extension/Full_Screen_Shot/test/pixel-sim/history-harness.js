/* Runs the REAL pages/history.js — over the REAL pages/common.js — in a node
   vm against seeded records, and returns what each card actually renders.

   WHY A SECOND HARNESS EXISTS AT ALL. History is the third surface the
   redaction claim reaches (REDACTION-CLAIM-SPEC.md §2.2) and the one that had
   the least attention: it is where a person picks an OLD screenshot to share,
   days later, with no memory of what was on the page. That is exactly the
   moment the shortfall line is most needed and least likely to be remembered,
   and it is the moment nothing was grading. The result page fired the alarm on
   a record while the history card showed the flat line for the SAME record, so
   a user who checked history was handed a reassurance the result page would
   never have given them.

   NOTHING IN THE SENTENCE PATH IS STUBBED. common.js runs in the same context,
   so fsMessage, fsPluralMessage, fsNumber, fsRedactShortfall, FS_LRI/FS_PDI and
   the plural machinery are the shipped ones. A stub of any of them would let
   this file grade the stub while the shipped page said something else — the
   same reasoning as the note above fsRedactActs in result-harness.js. What IS
   stubbed is only what a node process cannot have: IndexedDB, chrome.*, blobs,
   and the DOM. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..', '..');
const COMMON_SRC = fs.readFileSync(path.join(ROOT, 'pages', 'common.js'), 'utf8');
const HISTORY_SRC = fs.readFileSync(path.join(ROOT, 'pages', 'history.js'), 'utf8');
const HISTORY_HTML = fs.readFileSync(path.join(ROOT, 'pages', 'history.html'), 'utf8');

/* ---- the smallest DOM history.js can be honest in -------------------------
   Enough of a node to be wrong in the ways that matter: textContent REPLACES
   children (so a card that overwrites its own info block loses it here too),
   innerHTML = '' clears them, and text is read back by walking the tree in
   document order rather than off a spy the page was handed. The check is "the
   sentence reached a node a reader looks at", and a spy would answer for a call
   site instead. */
class Node {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parent = null;
    this.id = '';
    this.className = '';
    this.title = '';
    this.type = '';
    this.href = '';
    this.src = '';
    this.alt = '';
    this.rel = '';
    this.target = '';
    this.loading = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.style = { cssText: '' };
    this.dataset = {};
    this._text = '';
    this._attrs = new Map();
    this._listeners = new Map();
    this.focused = false;
    this.classList = {
      add: c => { if (!this._classes().includes(c)) this.className = (this.className + ' ' + c).trim(); },
      remove: c => { this.className = this._classes().filter(x => x !== c).join(' '); },
      toggle: (c, on) => { on ? this.classList.add(c) : this.classList.remove(c); },
      contains: c => this._classes().includes(c)
    };
  }
  _classes() { return String(this.className || '').split(/\s+/).filter(Boolean); }
  get textContent() {
    return this.children.length ? this.children.map(c => c.textContent).join(' ') : this._text;
  }
  set textContent(v) { this.children = []; this._text = v == null ? '' : String(v); }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { if (String(v) === '') { this.children = []; this._text = ''; } }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  setAttribute(n, v) { this._attrs.set(String(n), String(v)); }
  getAttribute(n) { return this._attrs.has(String(n)) ? this._attrs.get(String(n)) : null; }
  removeAttribute(n) { this._attrs.delete(String(n)); }
  addEventListener(t, fn) {
    if (!this._listeners.has(t)) this._listeners.set(t, []);
    this._listeners.get(t).push(fn);
  }
  focus() { this.focused = true; }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
    this.parent = null;
  }
  /* Only the selectors history.js actually spends. An unknown one throws rather
     than answering null: a harness that silently returns nothing for a selector
     the page relies on turns a broken render into a green run. */
  querySelectorAll(sel) {
    const all = [];
    (function walk(n) { for (const c of n.children) { all.push(c); walk(c); } })(this);
    if (sel === '.card') return all.filter(n => n._classes().includes('card'));
    if (sel === 'input[type="checkbox"]') return all.filter(n => n.tagName === 'INPUT' && n.type === 'checkbox');
    if (sel === 'h2' || sel === 'p') return all.filter(n => n.tagName === sel.toUpperCase());
    if (sel === '[data-i18n], [data-i18n-attr]') {
      return all.filter(n => n.getAttribute('data-i18n') != null || n.getAttribute('data-i18n-attr') != null);
    }
    throw new Error('history-harness: unmodelled selector ' + JSON.stringify(sel));
  }
  querySelector(sel) { const r = this.querySelectorAll(sel); return r.length ? r[0] : null; }
}

/* Every id in pages/history.html, so the page this harness builds and the page
   the extension ships cannot drift apart without a hard error. history.js is
   then read for every id it asks for, and one it cannot get here is a failure
   of the harness, not a quiet null the render limps past. */
function idsInHtml() {
  const out = new Set();
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(HISTORY_HTML))) out.add(m[1]);
  return out;
}
function idsUsedByJs() {
  const out = new Set();
  const re = /\$\('([^']+)'\)|getElementById\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(HISTORY_SRC))) out.add(m[1] || m[2]);
  return out;
}

function buildDocument() {
  const html = new Node('html');
  html.dataset = {};
  const body = new Node('body');
  html.appendChild(body);

  const byId = new Map();
  const declared = idsInHtml();
  for (const id of declared) {
    const el = new Node(id === 'searchBox' ? 'input' : 'div');
    el.id = id;
    byId.set(id, el);
    body.appendChild(el);
  }
  /* The one nested shape history.js reaches into: the empty-state panel owns
     the heading and the paragraph it rewrites when a filter matches nothing. */
  const empty = byId.get('emptyState');
  if (empty) { empty.appendChild(new Node('h2')); empty.appendChild(new Node('p')); }

  const missing = [...idsUsedByJs()].filter(id => !declared.has(id));
  if (missing.length) {
    throw new Error('history-harness: pages/history.js asks for id(s) pages/history.html ' +
      'does not declare: ' + missing.join(', '));
  }

  const doc = {
    readyState: 'loading',
    documentElement: html,
    body,
    _ready: [],
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') doc._ready.push(fn); },
    removeEventListener() {},
    getElementById(id) { return byId.has(id) ? byId.get(id) : null; },
    createElement(tag) { return new Node(tag); },
    querySelectorAll(sel) { return html.querySelectorAll(sel); },
    querySelector(sel) { return html.querySelector(sel); }
  };
  return { doc, body, byId };
}

/* text, in document order, with the separator a reader's eye supplies. Read off
   the rendered tree — never off the values the page was handed. */
function textOf(node) {
  return String(node.textContent || '').replace(/\s+/g, ' ').trim();
}

/* records: the array pages/db.js would hand back, NEWEST FIRST and already
   stripped/translated by its store boundary (§4) — this harness is downstream
   of that on purpose, because what history renders is a question about
   history.js and not about the lift.

   Returns { cards: [{ text, acts, actsClass }], countText }, cards in the order
   the grid holds them. `acts` is the text of the element carrying the
   `redactline` class — the same hook pages/result.html puts on its permanent
   line — or null where the card rendered no acts line at all, which is itself
   one of the variants (§3.1: redaction positively off says nothing). */
async function renderHistoryWithRealHistoryJs(records, opts) {
  const o = opts || {};
  const { doc, byId } = buildDocument();
  const store = new Map((records || []).map(r => [r.id, r]));

  const sandbox = {
    console,
    setTimeout, clearTimeout,
    document: doc,
    location: { href: 'chrome-extension://fullshot/pages/history.html', search: '' },
    URL: { createObjectURL: () => 'blob:sim', revokeObjectURL() {} },
    URLSearchParams,
    matchMedia: () => ({ matches: false }),
    confirm: () => false,
    alert() {},
    /* No chrome.i18n, deliberately: every message then resolves to the English
       fallback the call site passes, which is the same resolution
       result-harness.js grades the result page through. The two pages are
       therefore compared on the same rung of the fallback ladder. */
    chrome: {
      runtime: { openOptionsPage() {} },
      storage: { sync: { get: async () => ({}), set: async () => {} } },
      downloads: { download: async () => 1 }
    },
    FSDB: {
      async getShotsNewestFirst() { return [...store.values()]; },
      async get(_s, k) { return store.get(k); },
      async delete(_s, k) { store.delete(k); },
      async put(_s, v) { store.set(v.id, v); }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  /* common.js first and IN THE SAME CONTEXT — this is the page's own script
     order (pages/history.html), and it is what makes fsRedactShortfall here the
     one the browser runs rather than a second implementation that agrees today. */
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  vm.runInContext(HISTORY_SRC, sandbox, { filename: 'history.js' });
  if (!doc._ready.length) throw new Error('history.js never registered DOMContentLoaded');
  for (const fn of doc._ready) await fn();
  if (o.settle !== false) await new Promise(r => setTimeout(r, 0));

  const grid = byId.get('grid');
  const cards = grid.querySelectorAll('.card').map(card => {
    /* The acts element by its CLASS, the way a stylesheet or a reader would
       find it, not by its position among the card's siblings: a check that
       counted children would keep passing after the line was moved and stop
       passing after an unrelated one was added. */
    const all = [];
    (function walk(n) { for (const c of n.children) { all.push(c); walk(c); } })(card);
    const el = all.find(n => String(n.className || '').split(/\s+/).includes('redactline')) || null;
    return { text: textOf(card), acts: el ? textOf(el) : null,
             actsClass: el ? String(el.className || '') : null };
  });
  return { cards, countText: textOf(byId.get('countText')), grid };
}

module.exports = { renderHistoryWithRealHistoryJs };
