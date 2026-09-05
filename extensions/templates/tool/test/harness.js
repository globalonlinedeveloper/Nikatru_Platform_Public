/* SKELETON — the shared node-sim harness.
   =====================================================================
   Every tool in this family copies this file and imports it from its own
   `test/<tool>-sim.node.js`. It exists so a sim can grade the REAL shipped
   files — background.js, lib/*.js, pages/*.js, popup/*.js — with no browser,
   no dependency and no build step, the way the reference implementation's
   test/pixel-sim/result-harness.js runs the real stitcher in a vm.

   What is in here, and why each piece earns its place:

     1. REPORTER      check(label, ok, extra) -> "PASS  label  — extra",
                      section(), and finish() with the FAILURES / ALL PASS
                      footer and the exit code the reference uses. A sim that
                      prints anything else cannot be graded by a script.

     2. FAKE CHROME   runtime · tabs · windows · storage · scripting ·
                      downloads · action · permissions · commands, and every
                      call is RECORDED. A sim asserts on what the shipped code
                      ASKED THE BROWSER TO DO, which is the half a pure-function
                      test can never see.

     3. FAKE INDEXEDDB  enough of the real event-driven shape (requests that
                      settle in a later task, transactions that complete after
                      their requests, IDBKeyRange.bound) that lib/storage.js
                      runs unmodified. If the fake resolved synchronously the
                      shipped code's `t.oncomplete = ...` — assigned AFTER
                      fn(s) returns — would never fire, and the sim would be
                      grading a different program than the browser runs.

     4. LOADER        loadBackground() boots the real service worker in a vm
                      context, importScripts and all. loadPage() boots a real
                      page controller against the fake DOM. Nothing under test
                      is stubbed, re-implemented or copied.

     5. FAKE DOM      built from the tool's OWN html, so the ids it hands out
                      are the ids the shipped page actually has. Its innerHTML
                      setter RECORDS instead of parsing: markup written by a
                      controller is a violation this harness can see, which is
                      what gives a node sim teeth on rule 1 of this family.

     6. NETWORK TRAP  fetch / XMLHttpRequest / WebSocket / sendBeacon /
                      EventSource are installed as functions that record and
                      THROW. Shipped code in this family makes zero network
                      calls; if that ever stops being true the sim says so
                      loudly instead of quietly succeeding.

   A note on the regexes in this file: they parse OUR OWN source and OUR OWN
   html, which we control. That is not the thing the family rule forbids — the
   rule is that untrusted text is never sanitised by a regex on its way to a
   user (see the post-mortem above R_GENERIC in background.js). Nothing here
   ever renders anything.

   THIS FILE IS NOT SHIPPED. It must never be referenced from manifest.json,
   from any html, or from any file the browser loads.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

/* The extension root — the folder holding manifest.json. Overridable so a sim
   can point the harness at a copy (a mutated tree, a fixture) without moving. */
const ROOT = process.env.SK_ROOT ? path.resolve(process.env.SK_ROOT) : path.join(__dirname, '..');

function readRoot(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function existsRoot(rel) { try { fs.accessSync(path.join(ROOT, rel)); return true; } catch (_) { return false; } }

/* WHICH SKELETON GRADED THIS RUN.

   Printed on the footer of every sim in the fleet, so a pasted test result
   carries its own provenance. Without it, "67 tools, which ones have the fixed
   harness?" is answerable only by diffing 1,600 lines per tool — and a run
   posted into a bug report says nothing about which substrate produced it.
   Read from skeleton.json rather than duplicated here, because two copies of a
   version number is the drift this whole file exists to catch elsewhere. */
const SKELETON_VERSION = (() => {
  try { return JSON.parse(readRoot('skeleton.json')).skeletonVersion || 'unstamped'; }
  catch (_) { return 'unstamped'; }
})();

/* ==================================================================== */
/* 1. REPORTER                                                          */
/* ==================================================================== */

let FAILS = 0;
let TOTAL = 0;
const FAILED_LABELS = [];

/* The reference format, character for character:
     PASS  label
     PASS  label  — extra
   Two spaces after the verdict, two spaces and an em dash before the extra. */
function check(label, ok, extra) {
  TOTAL++;
  const good = !!ok;
  console.log((good ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!good) { FAILS++; FAILED_LABELS.push(label); }
  return good;
}

function section(name) { console.log('\n=== ' + name + ' ==='); }

function note(text) { console.log('     ' + text); }

/* Run one section so that an EXCEPTION inside it costs one red and the rest of
   the file, instead of the whole run.

   This was added after a teeth pass: injecting "park the note in storage.local"
   into background.js made a later line dereference an undefined note, the sim
   died on the spot, and 140 checks never ran — including the one that would
   have named the actual bug ("the note lives in storage.session only"). A
   harness that stops at the first surprise reports the least when there is the
   most to report. */
async function runSection(name, fn) {
  section(name);
  try {
    await fn();
  } catch (e) {
    check(name + ' section ran to completion', false, 'THREW: ' + ((e && e.message) || String(e)));
    const stack = String((e && e.stack) || e).split(/\r?\n/).slice(1, 4);
    for (const l of stack) console.log('     ' + l.trim());
  }
}

/* Same footer and same exit code as the reference, with the check count on the
   line above so a run can be compared with the last one at a glance. The LAST
   line is exactly `ALL PASS` or `FAILURES: n`. */
function finish() {
  if (FAILS) { console.log('\nfailed checks:'); for (const l of FAILED_LABELS) console.log('  - ' + l); }
  console.log('\n' + TOTAL + ' checks  ·  skeleton v' + SKELETON_VERSION);
  console.log(FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS');
  process.exit(FAILS ? 1 : 0);
}

/* Exported for a tool that wants to chain tiers in one process and decide the
   exit code itself. Nothing in the skeleton calls it — finish() does — so if
   you find yourself deleting unused surface, this is a deliberate keep: a
   reporter with no way to read its own totals is a reporter you have to fork. */
function stats() { return { total: TOTAL, fails: FAILS, failed: FAILED_LABELS.slice() }; }

/* ==================================================================== */
/* 2. NETWORK TRAP                                                      */
/* ==================================================================== */

/* Installed into every vm context this harness creates. Shipped code that
   reaches for the network gets an exception AND leaves a record, so a sim can
   assert on the record even if the shipped code swallowed the throw in a
   catch — which is exactly how a leak would hide. */
function installNetworkTrap(sandbox, sink) {
  function trip(api) {
    return function () {
      const arg = arguments.length ? String(arguments[0] == null ? '' : arguments[0]).slice(0, 200) : '';
      sink.push({ api, arg, stack: new Error().stack });
      throw new Error('NETWORK TRAP: shipped code called ' + api + '()' + (arg ? ' with ' + arg : ''));
    };
  }
  sandbox.fetch = trip('fetch');
  sandbox.XMLHttpRequest = function XMLHttpRequest() { trip('XMLHttpRequest').apply(null, arguments); };
  sandbox.WebSocket = function WebSocket() { trip('WebSocket').apply(null, arguments); };
  sandbox.EventSource = function EventSource() { trip('EventSource').apply(null, arguments); };
  sandbox.Request = function Request() { trip('Request').apply(null, arguments); };
  sandbox.Response = function Response() { trip('Response').apply(null, arguments); };
  sandbox.__sendBeaconTrap = trip('navigator.sendBeacon');
  return sink;
}

/* ==================================================================== */
/* 3. FAKE INDEXEDDB                                                    */
/* ==================================================================== */

/* Only what lib/storage.js uses, but with the real ASYNCHRONY, because the
   shipped code depends on it (see the banner). Keys are compared as strings,
   which is what every store in this family uses. */
function makeIndexedDB() {
  const dbs = new Map();          // name -> { version, stores: Map }
  const log = [];                 // every operation, for assertions

  function laterFire(target, prop, ev) {
    setTimeout(() => {
      const fn = target[prop];
      if (typeof fn === 'function') { try { fn.call(target, ev || { target }); } catch (e) { console.error(e); } }
    }, 0);
  }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function inRange(key, q) {
    if (q == null) return true;
    if (typeof q !== 'object' || !q.__isKeyRange) return key === q;
    if (q.lower !== undefined) { const c = cmp(key, q.lower); if (c < 0 || (c === 0 && q.lowerOpen)) return false; }
    if (q.upper !== undefined) { const c = cmp(key, q.upper); if (c > 0 || (c === 0 && q.upperOpen)) return false; }
    return true;
  }

  const IDBKeyRange = {
    bound(lower, upper, lowerOpen, upperOpen) {
      return { __isKeyRange: true, lower, upper, lowerOpen: !!lowerOpen, upperOpen: !!upperOpen };
    },
    only(v) { return { __isKeyRange: true, lower: v, upper: v, lowerOpen: false, upperOpen: false }; },
    lowerBound(v, open) { return { __isKeyRange: true, lower: v, upper: undefined, lowerOpen: !!open, upperOpen: false }; },
    upperBound(v, open) { return { __isKeyRange: true, lower: undefined, upper: v, lowerOpen: false, upperOpen: !!open }; }
  };

  function makeStoreState(name, opts) {
    return { name, keyPath: (opts && opts.keyPath) || null, indexes: new Set(), data: new Map() };
  }

  function makeDb(name, state) {
    const db = {
      name,
      get version() { return state.version; },
      /* A REAL DOMStringList, not a bag with .contains on it.

         This used to expose only contains/length/item, which is enough for
         `db.objectStoreNames.contains('items')` in an onupgradeneeded guard and
         nothing else — so `Array.from(db.objectStoreNames)` answered `[]`, and
         an implementation that ENUMERATES the stores (which is what makes
         "Delete everything" survive a tool adding a third one) looked like it
         was clearing nothing while a hard-coded two-line version passed. The
         real thing is array-like AND iterable; so is this. */
      get objectStoreNames() {
        const names = Array.from(state.stores.keys());
        const list = {
          contains(n) { return names.indexOf(n) >= 0; },
          length: names.length,
          item(i) { return i >= 0 && i < names.length ? names[i] : null; },
          [Symbol.iterator]() { return names[Symbol.iterator](); }
        };
        names.forEach((n, i) => { list[i] = n; });
        return list;
      },
      createObjectStore(n, opts) {
        log.push({ op: 'createObjectStore', store: n });
        const st = makeStoreState(n, opts);
        state.stores.set(n, st);
        return {
          createIndex(iname) { st.indexes.add(iname); return { name: iname }; }
        };
      },
      deleteObjectStore(n) { state.stores.delete(n); },
      transaction(storeNames, mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        for (const n of names) {
          if (!state.stores.has(n)) throw new Error('NotFoundError: no object store named ' + n);
        }
        const t = {
          mode: mode || 'readonly',
          error: null,
          oncomplete: null, onerror: null, onabort: null,
          _pending: 0, _done: false,
          objectStore(n) { return makeStore(t, state.stores.get(n)); },
          abort() {
            if (t._done) return;
            t._done = true;
            t.error = new Error('AbortError');
            laterFire(t, 'onabort', { target: t });
          }
        };
        maybeComplete(t);
        return t;
      },
      close() {}
    };
    return db;
  }

  function maybeComplete(t) {
    setTimeout(() => {
      if (t._done || t._pending > 0) return;
      t._done = true;
      const fn = t.oncomplete;
      if (typeof fn === 'function') { try { fn({ target: t }); } catch (e) { console.error(e); } }
    }, 0);
  }

  /* Injected failures, so a sim can drive the disk-full path without a full
     disk. Keyed by operation name ('put', 'get', 'delete', 'clear', …) and
     consumed once, the same shape as chrome.__failOnce. The DEFAULT error is a
     real-looking DOMException: `name` and `code` are what lib/storage.js
     classifies on, and a fake that only set `message` would let a message-
     sniffing implementation pass. */
  const failOnce = new Map();      // op -> { err, skip }
  function quotaError() {
    const e = new Error('The current transaction exceeded its quota limitations.');
    e.name = 'QuotaExceededError';
    e.code = 22;
    return e;
  }

  function request(t, run) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null, transaction: t, readyState: 'pending' };
    if (t) t._pending++;
    setTimeout(() => {
      try {
        r.result = run();
        r.readyState = 'done';
        if (t) t._pending--;
        if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
        if (t) maybeComplete(t);
      } catch (e) {
        r.error = e;
        r.readyState = 'done';
        if (t) t._pending--;
        if (typeof r.onerror === 'function') r.onerror({ target: r });
        else if (t) { t.error = e; t._done = true; laterFire(t, 'onerror', { target: t }); }
      }
    }, 0);
    return r;
  }

  function makeStore(t, st) {
    if (!st) throw new Error('NotFoundError: object store missing');
    const readonlyGuard = () => {
      if (t && t.mode !== 'readwrite') throw new Error('ReadOnlyError: transaction is not readwrite');
    };
    const sortedKeys = () => Array.from(st.data.keys()).sort(cmp);
    return {
      name: st.name,
      keyPath: st.keyPath,
      indexNames: { contains: n => st.indexes.has(n) },
      put(value) {
        readonlyGuard();
        return request(t, () => {
          if (failOnce.has('put')) {
            const f = failOnce.get('put');
            if (f.skip > 0) { f.skip--; }
            else { failOnce.delete('put'); throw f.err; }
          }
          const key = st.keyPath ? value[st.keyPath] : undefined;
          if (key === undefined) throw new Error('DataError: no key for ' + st.name);
          log.push({ op: 'put', store: st.name, key });
          st.data.set(key, JSON.parse(JSON.stringify(value)));
          return key;
        });
      },
      add(value) { return this.put(value); },
      get(key) { return request(t, () => { log.push({ op: 'get', store: st.name, key }); const v = st.data.get(key); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }); },
      getAll(query) {
        return request(t, () => {
          log.push({ op: 'getAll', store: st.name });
          return sortedKeys().filter(k => inRange(k, query)).map(k => JSON.parse(JSON.stringify(st.data.get(k))));
        });
      },
      getAllKeys(query) { return request(t, () => sortedKeys().filter(k => inRange(k, query))); },
      count(query) { return request(t, () => sortedKeys().filter(k => inRange(k, query)).length); },
      delete(key) {
        readonlyGuard();
        return request(t, () => {
          const hits = sortedKeys().filter(k => inRange(k, key));
          log.push({ op: 'delete', store: st.name, n: hits.length });
          for (const k of hits) st.data.delete(k);
          return undefined;
        });
      },
      clear() {
        readonlyGuard();
        return request(t, () => { log.push({ op: 'clear', store: st.name }); st.data.clear(); return undefined; });
      },
      index(name) {
        if (!st.indexes.has(name)) throw new Error('NotFoundError: no index ' + name);
        return { getAll: q => request(t, () => sortedKeys().filter(k => inRange(k, q)).map(k => st.data.get(k))) };
      }
    };
  }

  const indexedDB = {
    open(name, version) {
      const r = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        let state = dbs.get(name);
        const wanted = version == null ? (state ? state.version : 1) : version;
        if (!state) { state = { version: 0, stores: new Map() }; dbs.set(name, state); }
        const db = makeDb(name, state);
        r.result = db;
        if (wanted > state.version) {
          const oldVersion = state.version;
          state.version = wanted;
          log.push({ op: 'upgrade', db: name, from: oldVersion, to: wanted });
          if (typeof r.onupgradeneeded === 'function') {
            // A real upgrade runs inside a versionchange transaction; the only
            // thing lib/storage.js does in there is createObjectStore, which the
            // db object above handles directly.
            r.onupgradeneeded({ target: r, oldVersion, newVersion: wanted });
          }
        }
        if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
      }, 0);
      return r;
    },
    deleteDatabase(name) {
      const r = { onsuccess: null, onerror: null };
      setTimeout(() => { dbs.delete(name); if (r.onsuccess) r.onsuccess({ target: r }); }, 0);
      return r;
    },
    __dbs: dbs,
    __log: log,
    /* Direct inspection, so a sim can assert on the DATABASE rather than only on
       what the shipped wrapper reports about it. */
    __rows(dbName, store) {
      const st = dbs.get(dbName);
      if (!st || !st.stores.has(store)) return [];
      return Array.from(st.stores.get(store).data.values());
    },
    __count(dbName, store) { return indexedDB.__rows(dbName, store).length; },
    /* ADD A STORE THE SHIPPED CODE HAS NEVER HEARD OF.

       TEMPLATE §5.2 tells every tool author to add their own object stores, so
       the interesting question about "Delete everything" is not whether it
       empties the two the skeleton ships — it is whether it empties a THIRD.
       A sim cannot ask that without a way to create one outside the shipped
       onupgradeneeded, which is what this is for. */
    __addStore(dbName, store, keyPath) {
      const st = dbs.get(dbName);
      if (!st) throw new Error('__addStore: no such database: ' + dbName);
      if (!st.stores.has(store)) st.stores.set(store, makeStoreState(store, { keyPath: keyPath || 'id' }));
      return store;
    },
    /* Make a write fail, once. With no argument it is a real
       QuotaExceededError — name 'QuotaExceededError', code 22 — which is what
       the shipped classifier reads.

       `skip` lets that many writes succeed first, and it is not a nicety: a job
       writes its scratch row BEFORE it writes the row the user asked for, so
       failing the very next put only ever exercises the first of the two quota
       paths and leaves the second one ungraded. That is exactly how the
       swallowed-write bug survived its first teeth run. */
    __failNext(op, err, skip) {
      failOnce.set(op || 'put', { err: err || quotaError(), skip: Math.max(0, Number(skip) || 0) });
    },
    __quotaError: quotaError,
    __reset() { dbs.clear(); log.length = 0; failOnce.clear(); }
  };

  return { indexedDB, IDBKeyRange, log };
}

/* ==================================================================== */
/* 4. FAKE CHROME                                                       */
/* ==================================================================== */

/* Records every call as { name, args }. `name` is the dotted API path, so a sim
   asserts with chrome.__callsOf('action.setBadgeText') and never has to guess
   at argument order. */
function makeChrome(opts) {
  opts = opts || {};
  const calls = [];
  const listeners = Object.create(null);
  const onceErrors = new Map();     // dotted name -> value to reject with, once
  const overrides = new Map();      // dotted name -> replacement implementation
  const routerReturns = [];

  function rec(name, args) { calls.push({ name, args: Array.prototype.slice.call(args), at: calls.length }); }

  /* ---- the i18n catalogue, read from disk once ---- */
  const i18nLocale = opts.uiLanguage || 'en';
  const i18nDir = opts.bidiDir || 'ltr';
  const i18nAsked = [];
  const i18nCatalogue = (function () {
    const file = '_locales/' + (opts.catalogueLocale || 'en') + '/messages.json';
    try { return JSON.parse(readRoot(file)); } catch (_) { return {}; }
  })();

  /* Chrome's own substitution rules, faithfully enough to catch the mistakes
     that matter: an unknown key is '' (never a throw), $NAME$ resolves through
     the placeholders block to a 1-based argument, and a placeholder with no
     argument becomes ''. */
  function i18nGetMessage(key, subs) {
    const k = String(key == null ? '' : key);
    i18nAsked.push(k);
    if (k.slice(0, 2) === '@@') {
      if (k === '@@bidi_dir') return i18nDir;
      if (k === '@@bidi_reversed_dir') return i18nDir === 'rtl' ? 'ltr' : 'rtl';
      if (k === '@@bidi_start_edge') return i18nDir === 'rtl' ? 'right' : 'left';
      if (k === '@@bidi_end_edge') return i18nDir === 'rtl' ? 'left' : 'right';
      if (k === '@@ui_locale') return i18nLocale.replace(/-/g, '_');
      if (k === '@@extension_id') return 'skeletonharnessextensionid';
      return '';
    }
    const entry = i18nCatalogue[k];
    if (!entry || typeof entry.message !== 'string') return '';
    let out = entry.message;
    const args = subs == null ? [] : (Array.isArray(subs) ? subs : [subs]);
    const ph = entry.placeholders || {};
    for (const name of Object.keys(ph)) {
      const content = String((ph[name] && ph[name].content) || '');
      const m = /^\$(\d+)$/.exec(content);
      const value = m ? (args[Number(m[1]) - 1] == null ? '' : String(args[Number(m[1]) - 1])) : content;
      out = out.split('$' + name.toUpperCase() + '$').join(value)
               .split('$' + name + '$').join(value);
    }
    return out;
  }

  function ev(name) {
    if (!listeners[name]) listeners[name] = [];
    return {
      addListener(fn) { rec(name + '.addListener', arguments); listeners[name].push(fn); },
      removeListener(fn) { const i = listeners[name].indexOf(fn); if (i >= 0) listeners[name].splice(i, 1); },
      hasListener(fn) { return listeners[name].indexOf(fn) >= 0; },
      hasListeners() { return listeners[name].length > 0; }
    };
  }

  /* A call that should FAIL exactly once — the cheapest way to drive the
     router's catch and the allowlist behind it. */
  function guard(name, fn) {
    return function () {
      rec(name, arguments);
      if (overrides.has(name)) return overrides.get(name).apply(null, arguments);
      if (onceErrors.has(name)) {
        const e = onceErrors.get(name);
        onceErrors.delete(name);
        return Promise.reject(e);
      }
      return fn.apply(null, arguments);
    };
  }

  /* ---- storage ---- */
  const changeListeners = [];
  /* Storage goes through guard() like every other API, so a sim can drive a
     REAL write failure with chrome.__failOnce('storage.sync.set', …). Settings
     writes fail in the field — the 8 KB per-item ceiling, the 120-writes-a-
     minute limiter — and a harness that could not produce one left the whole
     failure path ungraded. guard() does the call recording, so nothing here
     calls rec() as well: two records per call would break every assertion that
     counts writes (the debounce check counts exactly one). */
  function area(areaName) {
    const data = new Map();
    const raw = {
      get(keys) {
        const out = {};
        if (keys == null) { for (const [k, v] of data) out[k] = v; }
        else if (typeof keys === 'string') { if (data.has(keys)) out[keys] = data.get(keys); }
        else if (Array.isArray(keys)) { for (const k of keys) if (data.has(k)) out[k] = data.get(k); }
        else { for (const k of Object.keys(keys)) out[k] = data.has(k) ? data.get(k) : keys[k]; }
        return Promise.resolve(JSON.parse(JSON.stringify(out)));
      },
      set(obj) {
        const changes = {};
        for (const k of Object.keys(obj || {})) {
          changes[k] = { oldValue: data.get(k), newValue: obj[k] };
          data.set(k, JSON.parse(JSON.stringify(obj[k])));
        }
        for (const fn of changeListeners) { try { fn(changes, areaName); } catch (e) { console.error(e); } }
        return Promise.resolve();
      },
      remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const k of list) { changes[k] = { oldValue: data.get(k) }; data.delete(k); }
        for (const fn of changeListeners) { try { fn(changes, areaName); } catch (e) { console.error(e); } }
        return Promise.resolve();
      },
      clear() { data.clear(); return Promise.resolve(); },
      getBytesInUse() { return Promise.resolve(0); }
    };
    const api = { __data: data };
    for (const name of ['get', 'set', 'remove', 'clear', 'getBytesInUse']) {
      api[name] = guard('storage.' + areaName + '.' + name, raw[name]);
    }
    /* Only chrome.storage.session has it, and the default is TRUSTED_CONTEXTS —
       which is what keeps the parked failure note out of reach of code sharing
       a process with the page. Recorded rather than merely tolerated, so a sim
       can assert on the call as well as scan for it in the source. */
    if (areaName === 'session') {
      api.setAccessLevel = guard('storage.session.setAccessLevel', (opts2) => {
        storage.__sessionAccessLevel = (opts2 && opts2.accessLevel) || 'TRUSTED_CONTEXTS';
        return Promise.resolve();
      });
    }
    return api;
  }

  const storage = {
    sync: area('sync'),
    local: area('local'),
    session: area('session'),
    managed: area('managed'),
    /* setAccessLevel EXISTS on the real chrome.storage.session, so it exists
       here. A fake that omitted it made the injected-bug run crash with
       "not a function" in sixteen sections — a red, but for the wrong reason,
       and one that hides whether the STATIC scan (the check that is supposed to
       catch this) actually bites. A fake that cannot express the bug cannot
       grade the check that forbids it. */
    __sessionAccessLevel: 'TRUSTED_CONTEXTS',
    onChanged: {
      addListener(fn) { rec('storage.onChanged.addListener', arguments); changeListeners.push(fn); },
      removeListener(fn) { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }
    }
  };

  /* ---- tabs ---- */
  const tabs = new Map();
  if (opts.tabs) for (const t of opts.tabs) tabs.set(t.id, t);

  /* THE DEFAULT SENDER IS A REAL ONE.

     This used to be `{}`, which no browser ever produces and which quietly made
     every sender check untestable: a router that validated `sender.id` would
     refuse the sim's own messages, so the natural conclusion is that the check
     is wrong rather than that the fake is. Chrome always populates `id` for a
     message from this extension, and `url` for one from an extension PAGE (a
     content script's sender carries `tab` and the page's url instead).

     A sim drives a hostile caller with chrome.__dispatch(msg, {...}) or
     bg.send(msg, {...}) and gets exactly what the engine would deliver. */
  function ownSender() {
    return { id: chrome.runtime.id, url: 'chrome-extension://' + chrome.runtime.id + '/pages/options.html' };
  }

  function dispatch(msg, sender) {
    rec('runtime.sendMessage', [msg]);
    return new Promise((resolve, reject) => {
      const ls = listeners['runtime.onMessage'] || [];
      if (!ls.length) return reject(new Error('Could not establish connection. Receiving end does not exist.'));
      const from = sender || ownSender();
      let answered = false;
      let wantsAsync = false;
      for (const fn of ls) {
        let ret;
        try {
          ret = fn(msg, from, resp => { if (!answered) { answered = true; resolve(resp); } });
        } catch (e) { return reject(e); }
        routerReturns.push(ret);
        if (ret === true) wantsAsync = true;
      }
      /* A listener that returns false has REFUSED: it will never call
         sendResponse and the channel is closed. Chrome answers the caller with
         undefined, which is what a refused sender must observe — not a hang. */
      if (!wantsAsync && !answered) resolve(undefined);
    });
  }

  /* Whether the optional host grant is currently held. Moved by request(),
     remove() and chrome.__permissionsGranted(); seeded by
     opts.permissionsGranted. Declared here because the permissions block and
     the harness surface both reach it. */
  let permGranted = !!opts.permissionsGranted;
  function setPermissions(next) {
    const was = permGranted;
    permGranted = !!next;
    if (permGranted === was) return permGranted;
    const ls = listeners[permGranted ? 'permissions.onAdded' : 'permissions.onRemoved'] || [];
    for (const fn of ls) { try { fn({ permissions: [], origins: ['<all_urls>'] }); } catch (e) { console.error(e); } }
    return permGranted;
  }

  const chrome = {
    runtime: {
      id: 'skeletonsimskeletonsimskeletonsim00',
      lastError: undefined,
      onMessage: ev('runtime.onMessage'),
      onInstalled: ev('runtime.onInstalled'),
      onStartup: ev('runtime.onStartup'),
      onConnect: ev('runtime.onConnect'),
      onSuspend: ev('runtime.onSuspend'),
      sendMessage: (msg) => dispatch(msg, opts.sender || ownSender()),
      connect: () => { rec('runtime.connect', arguments); return { postMessage() {}, onMessage: ev('port.onMessage'), disconnect() {} }; },
      getURL(p) { rec('runtime.getURL', arguments); return 'chrome-extension://' + chrome.runtime.id + '/' + String(p || '').replace(/^\//, ''); },
      /* The REAL manifest by default — a fake one would let the shipped code
         pass against a shape the browser never sees. `opts.manifest` overrides
         it so a sim can ask "what does this same page do on a tool that
         declared optional_host_permissions?" without editing manifest.json. */
      getManifest() {
        rec('runtime.getManifest', arguments);
        return opts.manifest ? JSON.parse(JSON.stringify(opts.manifest)) : JSON.parse(readRoot('manifest.json'));
      },
      openOptionsPage() { rec('runtime.openOptionsPage', arguments); return Promise.resolve(); },
      reload() { rec('runtime.reload', arguments); }
    },

    tabs: {
      get: guard('tabs.get', id => {
        const t = tabs.get(id);
        // The engine's own wording, so a sim grades the shipped translation of
        // it rather than one this harness invented.
        return t ? Promise.resolve(Object.assign({}, t)) : Promise.reject(new Error('No tab with id: ' + id + '.'));
      }),
      query: guard('tabs.query', q => {
        let list = Array.from(tabs.values());
        if (q && q.active) list = list.filter(t => t.active);
        if (q && q.currentWindow) list = list.filter(t => t.windowId === (opts.currentWindowId == null ? 1 : opts.currentWindowId));
        if (q && q.url) list = list.filter(t => t.url === q.url);
        return Promise.resolve(list.map(t => Object.assign({}, t)));
      }),
      sendMessage: guard('tabs.sendMessage', () => Promise.resolve(undefined)),
      update: guard('tabs.update', (id, props) => {
        const t = tabs.get(id);
        if (t) Object.assign(t, props);
        return Promise.resolve(t && Object.assign({}, t));
      }),
      create: guard('tabs.create', props => {
        const id = 1000 + tabs.size;
        const t = Object.assign({ id, windowId: 1, active: true, title: '', url: '' }, props);
        tabs.set(id, t);
        return Promise.resolve(Object.assign({}, t));
      }),
      remove: guard('tabs.remove', () => Promise.resolve()),
      captureVisibleTab: guard('tabs.captureVisibleTab', () => Promise.resolve('data:image/png;base64,')),
      onRemoved: ev('tabs.onRemoved'),
      onUpdated: ev('tabs.onUpdated'),
      onActivated: ev('tabs.onActivated'),
      onCreated: ev('tabs.onCreated')
    },

    windows: {
      get: guard('windows.get', id => Promise.resolve({ id, focused: true })),
      getCurrent: guard('windows.getCurrent', () => Promise.resolve({ id: 1, focused: true })),
      create: guard('windows.create', () => Promise.resolve({ id: 2 })),
      onRemoved: ev('windows.onRemoved'),
      onFocusChanged: ev('windows.onFocusChanged')
    },

    storage,

    scripting: {
      executeScript: guard('scripting.executeScript', () =>
        Promise.resolve(opts.executeScriptResult || [{ frameId: 0, result: null }])),
      insertCSS: guard('scripting.insertCSS', () => Promise.resolve()),
      removeCSS: guard('scripting.removeCSS', () => Promise.resolve()),
      registerContentScripts: guard('scripting.registerContentScripts', () => Promise.resolve())
    },

    downloads: {
      download: guard('downloads.download', () => Promise.resolve(1)),
      cancel: guard('downloads.cancel', () => Promise.resolve()),
      onChanged: ev('downloads.onChanged')
    },

    action: {
      setBadgeText: guard('action.setBadgeText', () => Promise.resolve()),
      setBadgeBackgroundColor: guard('action.setBadgeBackgroundColor', () => Promise.resolve()),
      setTitle: guard('action.setTitle', () => Promise.resolve()),
      setIcon: guard('action.setIcon', () => Promise.resolve()),
      setPopup: guard('action.setPopup', () => Promise.resolve()),
      onClicked: ev('action.onClicked')
    },

    /* The grant is STATE, not a constant. It used to be `!!opts.permissionsGranted`
       read afresh on every call, which cannot express the only sequence that
       matters — not granted, request, granted, revoke, not granted — so a
       revoke path was untestable and an options row could claim anything.
       chrome.__permissionsGranted(bool) moves it, exactly as the browser's own
       prompt and chrome://extensions do. */
    permissions: {
      contains: guard('permissions.contains', () => Promise.resolve(permGranted)),
      /* request() and remove() CHANGE THE STATE, the way the browser's prompt
         does — and fire the matching event, because that is how a second
         options tab (or chrome://extensions) finds out. A fake where request()
         merely reported a constant could not express the only sequence that
         matters: not held → grant → held → revoke → not held.
         opts.permissionsPromptAnswer === false models a user who declines. */
      request: guard('permissions.request', () => {
        if (opts.permissionsPromptAnswer === false) return Promise.resolve(false);
        setPermissions(true);
        return Promise.resolve(true);
      }),
      remove: guard('permissions.remove', () => { setPermissions(false); return Promise.resolve(true); }),
      getAll: guard('permissions.getAll', () => Promise.resolve({ permissions: ['activeTab', 'storage'], origins: [] })),
      onAdded: ev('permissions.onAdded'),
      onRemoved: ev('permissions.onRemoved')
    },

    commands: {
      getAll: guard('commands.getAll', () => Promise.resolve([])),
      onCommand: ev('commands.onCommand')
    },

    /* ---- i18n ----
       Reads the REAL _locales/<default>/messages.json, so a key a controller
       asks for that is not in the catalogue returns '' exactly as Chrome does,
       and pages/common.js's skMsg() turns that into its ⟦key⟧ marker. Every key
       asked for is recorded, which is what lets a sim assert that a page
       resolved the keys its markup declares rather than merely not crashing.
       @@bidi_dir is settable so a sim can boot a page in RTL. */
    i18n: {
      getMessage: guard('i18n.getMessage', (key, subs) => i18nGetMessage(key, subs)),
      getUILanguage: guard('i18n.getUILanguage', () => i18nLocale),
      getAcceptLanguages: guard('i18n.getAcceptLanguages', () => Promise.resolve([i18nLocale]))
    },

    contextMenus: {
      create: guard('contextMenus.create', () => 1),
      removeAll: guard('contextMenus.removeAll', () => Promise.resolve()),
      onClicked: ev('contextMenus.onClicked')
    },

    /* ---- harness surface (double underscore: never a real chrome API) ---- */
    __calls: calls,
    __callsOf(name) { return calls.filter(c => c.name === name); },
    __lastCall(name) { const l = calls.filter(c => c.name === name); return l.length ? l[l.length - 1] : null; },
    __clearCalls() { calls.length = 0; },
    __listeners: listeners,
    __routerReturns: routerReturns,
    __tabs: tabs,
    __setTab(t) { tabs.set(t.id, t); return t; },
    __dispatch: dispatch,
    /* The sender Chrome would build for this extension's own options page —
       exported so a sim can start from a legitimate one and change exactly the
       field under test, rather than hand-rolling a shape that drifts. */
    __ownSender: ownSender,
    /* Move the grant from OUTSIDE the product — the user opening
       chrome://extensions and changing Site access while this page is open. A
       page that only re-reads on its own button press lies from that moment on. */
    __permissionsGranted: setPermissions,
    /* Fire a registered event: chrome.__fire('tabs.onRemoved', 7) */
    __fire(name, ...args) {
      const ls = listeners[name] || [];
      const out = [];
      for (const fn of ls) out.push(fn.apply(null, args));
      return out;
    },
    __hasListener(name) { return !!(listeners[name] && listeners[name].length); },
    /* TEAR DOWN A DEAD WORKER'S LISTENERS.

       Booting background.js twice against the same fake chrome used to leave
       the FIRST instance's onMessage listener registered, so the harness kept
       answering as if the suspended worker were still alive — and a suspend
       test written against it would show a confident false green. A real
       suspension takes every listener with it. This is what restartWorker()
       calls to model that. */
    __clearListeners() {
      for (const name of Object.keys(listeners)) listeners[name].length = 0;
      changeListeners.length = 0;
    },
    /* Every message key any shipped file asked chrome.i18n for, in order. */
    __i18nAsked: i18nAsked,
    __i18nCatalogue: i18nCatalogue,
    __i18nMissing() { return i18nAsked.filter(k => k.slice(0, 2) !== '@@' && !i18nCatalogue[k]); },
    /* Make one call fail, once, with a value of the sim's choosing. */
    __failOnce(name, err) { onceErrors.set(name, err); },
    __override(name, fn) { overrides.set(name, fn); },
    __restore(name) { overrides.delete(name); }
  };

  return chrome;
}

/* ==================================================================== */
/* 5. FAKE DOM                                                          */
/* ==================================================================== */

/* Small, but faithful where it matters:
     - textContent is a real getter/setter pair over a node list, so setting it
       REMOVES children, and reading it concatenates descendants.
     - innerHTML does NOT parse. It RECORDS. A node sim cannot see a string
       become an <img>, but it can see a controller write markup at all, and
       that is the thing the family rule actually forbids. The browser tier
       proves the rest.
     - ids come from the tool's OWN html, so a sim breaks when the page and the
       controller drift apart instead of quietly testing a phantom element. */
/* EVERY attribute is kept, not just id/type. An applier that walks
   [data-i18n] and a check that a control resolves an accessible name both need
   the attributes the page actually declares; a seeded node that carried only
   {id, tag, type} made both of those look like they worked when the node list
   was simply empty. A green that was never observed to fail is worth nothing. */
function parseAttrs(attrText) {
  const attrs = new Map();
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(attrText))) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (!attrs.has(name)) attrs.set(name, value);
  }
  return attrs;
}

function extractIds(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    if (!attrs.has('id')) continue;
    let type = attrs.get('type') || '';
    if (!type && tag === 'select') type = 'select-one';
    if (!type && tag === 'textarea') type = 'textarea';
    out.push({ id: attrs.get('id'), tag, type, attrs });
  }
  return out;
}

/* Every element in the file, id or not — what a static accessible-name check
   has to walk, because the controls that have no name are exactly the ones
   nobody gave an id to either. Void elements and closing tags are skipped;
   text between tags is captured so a <button>Save</button> can be seen to have
   content and a <button></button> can be seen not to. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseElements(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    const attrs = parseAttrs(m[2]);
    let text = '';
    if (!VOID_TAGS.has(tag) && m[3] !== '/') {
      const close = html.indexOf('</' + tag, re.lastIndex);
      if (close >= 0) text = html.slice(re.lastIndex, close).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
    out.push({ tag, attrs, text, index: m.index });
  }
  return out;
}

function makeDom(opts) {
  opts = opts || {};
  const markupWrites = [];       // every innerHTML / outerHTML / insertAdjacentHTML
  const events = [];             // every addEventListener, for assertions
  const byId = new Map();
  const activeStack = [];        // every focus() call, in order
  const dialogOpens = [];        // every showModal()/show()
  let active = null;             // document.activeElement
  let created = 0;

  class FEl {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this._nodes = [];          // { text } | { el }
      this._parent = null;
      this._attrs = new Map();
      this._handlers = Object.create(null);
      this.id = '';
      this._class = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this.type = '';
      this.href = '';
      this.src = '';
      this.rel = '';
      this.alt = '';
      this.download = '';
      this.title = '';
      this.dataset = Object.create(null);
      this.open = false;         // <dialog>
      this.returnValue = '';
      this.style = makeStyle();
      created++;
      const self = this;
      this.classList = {
        _set: new Set(),
        add(...c) { for (const x of c) this._set.add(x); self._syncClass(); },
        remove(...c) { for (const x of c) this._set.delete(x); self._syncClass(); },
        toggle(c, on) { if (on === undefined ? this._set.has(c) : !on) this._set.delete(c); else this._set.add(c); self._syncClass(); },
        contains(c) { return this._set.has(c); }
      };
    }
    /* className and classList are ONE piece of state. They used to be two, so
       el('div', 'a b') gave a node whose classList.contains('a') was false —
       and every check written against classList quietly tested nothing. */
    get className() { return this._class; }
    set className(v) {
      this._class = String(v == null ? '' : v);
      this.classList._set.clear();
      for (const c of this._class.split(/\s+/)) if (c) this.classList._set.add(c);
    }
    _syncClass() { this._class = Array.from(this.classList._set).join(' '); }

    get children() { return this._nodes.filter(n => n.el).map(n => n.el); }
    get childNodes() { return this._nodes.slice(); }
    get firstChild() { const n = this._nodes[0]; return n ? (n.el || { nodeType: 3, nodeValue: n.text }) : null; }
    get parentElement() { return this._parent; }
    get parentNode() { return this._parent; }

    get textContent() {
      return this._nodes.map(n => (n.el ? n.el.textContent : n.text)).join('');
    }
    set textContent(v) {
      const s = v == null ? '' : String(v);
      this._nodes = s === '' ? [] : [{ text: s }];
    }

    /* The markup sink. Recorded, never parsed — see the banner. */
    get innerHTML() { return this._markup == null ? '' : this._markup; }
    set innerHTML(v) {
      this._markup = String(v == null ? '' : v);
      markupWrites.push({ sink: 'innerHTML', id: this.id, tag: this.tagName, value: this._markup.slice(0, 200) });
    }
    get outerHTML() { return ''; }
    set outerHTML(v) { markupWrites.push({ sink: 'outerHTML', id: this.id, tag: this.tagName, value: String(v).slice(0, 200) }); }
    insertAdjacentHTML(pos, v) { markupWrites.push({ sink: 'insertAdjacentHTML', id: this.id, tag: this.tagName, value: String(v).slice(0, 200) }); }

    appendChild(c) { if (!c) return c; if (c._parent) c.remove(); c._parent = this; this._nodes.push({ el: c }); if (c.id) byId.set(c.id, c); return c; }
    append(...kids) { for (const k of kids) this.appendChild(k); }
    insertBefore(c, ref) {
      const i = this._nodes.findIndex(n => n.el === ref);
      if (c._parent) c.remove();
      c._parent = this;
      if (i < 0) this._nodes.push({ el: c }); else this._nodes.splice(i, 0, { el: c });
      if (c.id) byId.set(c.id, c);
      return c;
    }
    removeChild(c) { const i = this._nodes.findIndex(n => n.el === c); if (i >= 0) this._nodes.splice(i, 1); c._parent = null; return c; }
    remove() { if (this._parent) this._parent.removeChild(this); }

    setAttribute(n, v) {
      this._attrs.set(n, String(v));
      if (n === 'id') { this.id = String(v); byId.set(this.id, this); }
      if (n === 'class') this.className = String(v);
      if (n === 'href') this.href = String(v);
      if (n === 'src') this.src = String(v);
      if (n === 'title') this.title = String(v);
      if (n === 'type') this.type = String(v);
      if (n === 'hidden') this.hidden = true;
      if (n === 'disabled') this.disabled = true;
      if (n === 'checked') this.checked = true;
      if (n.slice(0, 5) === 'data-') this.dataset[n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    }
    getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
    removeAttribute(n) { this._attrs.delete(n); }
    hasAttribute(n) { return this._attrs.has(n); }

    /* ---- <dialog>, enough of it to grade focus behaviour ----
       A hand-rolled modal is untestable in this tier and that is half the
       reason the family bans them. showModal() records the open, moves focus
       the way the spec says (autofocus, else the first focusable descendant),
       and close() fires the 'close' event skConfirm() restores focus on. */
    showModal() {
      this.open = true;
      dialogOpens.push({ id: this.id, modal: true });
      const target = this.querySelectorAll('[autofocus]')[0] ||
        this.querySelectorAll('button')[0] || this;
      target.focus();
    }
    show() { this.open = true; dialogOpens.push({ id: this.id, modal: false }); }
    close(v) {
      if (!this.open) return;
      this.open = false;
      if (v !== undefined) this.returnValue = String(v);
      this.__fire('close');
    }
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }

    addEventListener(type, fn) {
      (this._handlers[type] || (this._handlers[type] = [])).push(fn);
      events.push({ id: this.id, tag: this.tagName, type });
    }
    removeEventListener(type, fn) {
      const l = this._handlers[type]; if (!l) return;
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    }
    __fire(type, evt) {
      const l = this._handlers[type] || [];
      const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, evt || {});
      const out = [];
      for (const fn of l) out.push(fn(e));
      return out;
    }
    click() { return this.__fire('click'); }
    /* focus() RECORDS. It used to be a no-op, which made every focus-management
       assertion — did the dialog take focus, did it hand focus back to the
       button that opened it — silently unfalsifiable. */
    focus() { activeStack.push(this); active = this; }
    blur() { if (active === this) active = null; }
    select() {} scrollIntoView() {}

    /* Assertion helpers a sim reaches for constantly. */
    countElements() { let n = 0; for (const k of this.children) n += 1 + k.countElements(); return n; }
    find(tag) {
      const T = String(tag).toUpperCase(); const out = [];
      for (const k of this.children) { if (k.tagName === T) out.push(k); out.push(...k.find(tag)); }
      return out;
    }
    querySelector(sel) { const r = this.querySelectorAll(sel); return r.length ? r[0] : null; }
    /* #id, .class, tag, [attr], [attr="value"], and a tag/class prefixed form
       of the attribute selectors. The attribute forms are the ones that matter:
       skApplyI18n walks '[data-i18n]', and the old implementation fell through
       to `tagName === '[DATA-I18N]'` and returned an EMPTY LIST — so an applier
       that translated nothing looked exactly like one that worked. */
    querySelectorAll(sel) {
      const s = String(sel).trim();
      const all = [];
      (function walk(el) { for (const k of el.children) { all.push(k); walk(k); } })(this);

      const parts = s.split(',').map(x => x.trim()).filter(Boolean);
      if (parts.length > 1) {
        const seen = new Set(), out = [];
        for (const p of parts) for (const e of this.querySelectorAll(p)) if (!seen.has(e)) { seen.add(e); out.push(e); }
        return out;
      }

      const m = /^([a-zA-Z][\w-]*)?(?:([.#])([\w-]+))?(?:\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\])?$/.exec(s);
      if (!m) return [];
      const [, tag, kind, name, attr, op, value] = m;
      if (!tag && !kind && !attr) return [];
      return all.filter(e => {
        if (tag && e.tagName !== tag.toUpperCase()) return false;
        if (kind === '#' && e.id !== name) return false;
        if (kind === '.' && !e.classList.contains(name)) return false;
        if (attr) {
          if (!e.hasAttribute(attr)) return false;
          if (op === '=' && e.getAttribute(attr) !== value) return false;
          if (op === '*=' && String(e.getAttribute(attr)).indexOf(value) < 0) return false;
        }
        return true;
      });
    }
  }

  function makeStyle() {
    const m = new Map();
    return {
      get cssText() { return Array.from(m).map(([k, v]) => k + ':' + v).join(';'); },
      set cssText(v) {
        m.clear();
        for (const part of String(v).split(';')) { const i = part.indexOf(':'); if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim()); }
      },
      setProperty(k, v) { m.set(k, v); },
      removeProperty(k) { m.delete(k); },
      getPropertyValue(k) { return m.get(k) || ''; }
    };
  }

  const documentElement = new FEl('html');
  const body = new FEl('body');
  const head = new FEl('head');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const domReady = [];
  const docHandlers = Object.create(null);   // document-level listeners, e.g. keydown
  const execCommandCalls = [];

  const document = {
    documentElement,
    body,
    head,
    /* Real, not a stub: skConfirm() reads it to know which control to give
       focus back to, and a sim that could not observe it could not grade the
       one thing a hand-rolled modal always gets wrong. */
    get activeElement() { return active || body; },
    title: opts.title || '',
    createElement(tag) { return new FEl(tag); },
    createTextNode(t) { return { nodeType: 3, nodeValue: String(t), textContent: String(t) }; },
    createDocumentFragment() { return new FEl('#fragment'); },
    getElementById(id) { return byId.has(id) ? byId.get(id) : null; },
    querySelector(s) { return documentElement.querySelector(s); },
    querySelectorAll(s) { return documentElement.querySelectorAll(s); },
    addEventListener(type, fn) {
      if (type === 'DOMContentLoaded') domReady.push(fn);
      (docHandlers[type] || (docHandlers[type] = [])).push(fn);
      events.push({ id: '#document', tag: 'DOCUMENT', type });
    },
    removeEventListener(type, fn) {
      const l = docHandlers[type]; if (!l) return;
      const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    },
    execCommand(cmd) { execCommandCalls.push(cmd); return opts.execCommandResult !== false; },
    hasFocus() { return true; }
  };

  /* Seed the ids the real page declares. A controller's top-level
     getElementById() then finds a real element, and one it invents finds null —
     which is the failure you want to see. */
  const seeded = [];
  for (const rel of (opts.html || [])) {
    for (const spec of extractIds(readRoot(rel))) {
      const e = new FEl(spec.tag);
      e.id = spec.id;
      e.type = spec.type;
      /* EVERY attribute the page declares, not just id and type. data-i18n,
         aria-labelledby, role and hidden are the whole point: without them a
         seeded node cannot be asked any of the questions an a11y or i18n check
         needs to ask, and the check passes on an empty node list. */
      for (const [name, value] of spec.attrs) if (name !== 'id') e.setAttribute(name, value);
      byId.set(spec.id, e);
      body.appendChild(e);
      seeded.push(spec);
    }
  }
  for (const spec of (opts.ids || [])) {
    const e = new FEl(spec.tag || 'div');
    e.id = spec.id || spec;
    e.type = spec.type || '';
    byId.set(e.id, e);
    body.appendChild(e);
  }

  const objectUrls = [];
  function URLShim(u, b) { return new URL(u, b); }
  URLShim.createObjectURL = function (blob) { objectUrls.push(blob); return 'blob:sk/' + objectUrls.length; };
  URLShim.revokeObjectURL = function () {};

  const clipboardWrites = [];
  const beacons = [];

  /* StorageManager. The knobs matter more than the API surface: the whole point
     of the durability work is that the two branches must BOTH be exercised, and
     that "durable" is never printed on a guess.
       opts.persisted        what persisted() answers before anything is asked
       opts.persistGrants    what persist() decides (default: it grants)
       opts.noStorageManager the browser that has no StorageManager at all
       opts.usage/opts.quota what estimate() reports */
  const persistCalls = [];
  const storageManager = {
    persisted() { return Promise.resolve(!!storageManager.__persisted); },
    persist() {
      persistCalls.push(Date.now());
      if (opts.persistGrants !== false) storageManager.__persisted = true;
      return Promise.resolve(!!storageManager.__persisted);
    },
    estimate() {
      return Promise.resolve({
        usage: opts.usage == null ? 12345 : opts.usage,
        quota: opts.quota == null ? 1073741824 : opts.quota
      });
    },
    __persisted: !!opts.persisted,
    __calls: persistCalls
  };

  const navigator = {
    /* A real-shaped user-agent, so skCoarsePlatform() is graded on the thing it
       will actually be handed rather than on a placeholder it cannot parse. */
    userAgent: opts.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    clipboard: {
      writeText(s) {
        clipboardWrites.push(String(s));
        return opts.clipboardFails ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
      },
      readText() { return Promise.resolve(''); }
    },
    sendBeacon(url) { beacons.push(url); throw new Error('NETWORK TRAP: shipped code called navigator.sendBeacon()'); }
  };
  if (!opts.noStorageManager) navigator.storage = storageManager;

  const window = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    matchMedia(q) { return { media: q, matches: !!opts.dark, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; },
    getComputedStyle() { return { getPropertyValue: () => '' }; },
    location: { href: opts.href || 'chrome-extension://sk/page.html', search: opts.search || '', hash: '' },
    close() {}, focus() {}, alert() {}, confirm: () => false, prompt: () => null
  };

  return {
    document, window, navigator, URL: URLShim,
    body, documentElement,
    markupWrites, events, byId, seeded, clipboardWrites, execCommandCalls, beacons,
    activeStack, dialogOpens,
    /* Every Blob a controller handed to URL.createObjectURL, in order. That is
       how a sim reads what an export or a report ACTUALLY wrote, rather than
       asserting that a download was requested and hoping about the payload. */
    objectUrls, storageManager, persistCalls,
    get created() { return created; },
    get activeElement() { return active; },
    $(id) { return byId.get(id) || null; },
    /* Fire DOMContentLoaded, for controllers that wait for it (options.js). */
    async ready() { for (const fn of domReady) await fn({ type: 'DOMContentLoaded' }); },
    hasReadyHandler() { return domReady.length > 0; },
    /* Fire a document-level event — how a sim presses Escape. */
    fireDoc(type, evt) {
      const e = Object.assign({ type, preventDefault() {}, stopPropagation() {} }, evt || {});
      const out = [];
      for (const fn of (docHandlers[type] || [])) out.push(fn(e));
      return out;
    },
    docListeners(type) { return (docHandlers[type] || []).length; }
  };
}

/* ==================================================================== */
/* 6. LOADERS — the real shipped files, in a vm                         */
/* ==================================================================== */

function makeConsole(sink, echo) {
  const mk = level => (...args) => {
    sink.push({ level, text: args.map(a => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? safeJson(a) : String(a))).join(' ') });
    if (echo) console[level === 'debug' ? 'log' : level](...args);
  };
  return { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug') };
}

function safeJson(o) { try { return JSON.stringify(o); } catch (_) { return '[object]'; } }

const cryptoShim = {
  randomUUID: () => nodeCrypto.randomUUID(),
  getRandomValues: a => nodeCrypto.randomFillSync(a),
  subtle: undefined
};

function baseSandbox(extra) {
  const s = Object.assign({
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URLSearchParams, TextEncoder, TextDecoder, Blob: typeof Blob !== 'undefined' ? Blob : undefined,
    crypto: cryptoShim,
    structuredClone: typeof structuredClone === 'function' ? structuredClone : (v => JSON.parse(JSON.stringify(v)))
  }, extra || {});
  return s;
}

/* Boot the REAL background.js the way the reference boots the real stitcher:
   nothing under test is replaced, only what it talks to. */
function loadBackground(opts) {
  opts = opts || {};
  const chrome = opts.chrome || makeChrome(opts);
  const idb = opts.idb || makeIndexedDB();
  const net = opts.net || [];
  const logs = [];
  const file = opts.file || 'background.js';

  const sandbox = baseSandbox({
    console: makeConsole(logs, opts.echo),
    chrome,
    indexedDB: idb.indexedDB,
    IDBKeyRange: idb.IDBKeyRange,
    URL
  });
  sandbox.self = sandbox;
  installNetworkTrap(sandbox, net);

  const loaded = [];
  sandbox.importScripts = function (...rels) {
    for (const rel of rels) {
      loaded.push(rel);
      vm.runInContext(readRoot(rel), sandbox, { filename: rel });
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(readRoot(file), sandbox, { filename: file });

  return {
    sandbox, chrome, idb, net, logs, imported: loaded,
    /* Top-level `const`/`let` in a vm script live in the context's lexical
       scope, not on the sandbox object, so reading REASONS or jobs needs an
       eval in that same context. Function declarations land on the sandbox and
       can be called directly. */
    eval(code) { return vm.runInContext(code, sandbox); },
    send(msg, sender) { return chrome.__dispatch(msg, sender); },
    fire(name, ...args) { return chrome.__fire(name, ...args); },
    logText() { return logs.map(l => l.level + ': ' + l.text).join('\n'); }
  };
}

/* KILL THE WORKER AND START IT AGAIN, against the same chrome and the same
   IndexedDB — which is exactly what Chrome does to an MV3 service worker every
   time it goes idle for 30 seconds, several times an hour, mid-job.

   This is the single most important primitive for grading a job model, and it
   is the one the skeleton did not have: without it, "state survives a
   suspension" is untestable and every tool inherits an in-memory Map. The
   previous instance's listeners are torn down first, because a real suspension
   takes them with it and a harness that left them behind would answer from the
   dead worker.

   `sw.fire('runtime.onSuspend')` before calling this models the graceful case
   (Chrome sometimes gives that event); calling it without is the ungraceful
   one, which is the case that actually matters. */
function restartWorker(prev, opts) {
  const o = opts || {};
  const chrome = (prev && prev.chrome) || o.chrome;
  const idb = (prev && prev.idb) || o.idb;
  if (chrome && typeof chrome.__clearListeners === 'function') chrome.__clearListeners();
  return loadBackground(Object.assign({}, o, { chrome, idb }));
}

/* Boot a page controller (popup.js, options.js, …) against the fake DOM. Pass
   the SAME chrome and idb objects as loadBackground() to model a page talking
   to its worker. */
function loadPage(scripts, opts) {
  opts = opts || {};
  const chrome = opts.chrome || makeChrome(opts);
  const idb = opts.idb || makeIndexedDB();
  const dom = opts.dom || makeDom(opts.domOpts || {});
  const net = opts.net || [];
  const logs = [];

  const sandbox = baseSandbox({
    console: makeConsole(logs, opts.echo),
    chrome,
    indexedDB: idb.indexedDB,
    IDBKeyRange: idb.IDBKeyRange,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.window.location,
    matchMedia: dom.window.matchMedia,
    getComputedStyle: dom.window.getComputedStyle,
    URL: dom.URL,
    alert() {}, confirm: () => false
  });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  installNetworkTrap(sandbox, net);
  // navigator.sendBeacon already throws; keep the record in the same sink.
  const origBeacon = dom.navigator.sendBeacon;
  dom.navigator.sendBeacon = function (u) { net.push({ api: 'navigator.sendBeacon', arg: String(u) }); return origBeacon.call(this, u); };

  vm.createContext(sandbox);
  for (const rel of scripts) vm.runInContext(readRoot(rel), sandbox, { filename: rel });

  return {
    sandbox, chrome, idb, dom, net, logs,
    eval(code) { return vm.runInContext(code, sandbox); },
    logText() { return logs.map(l => l.level + ': ' + l.text).join('\n'); }
  };
}

/* Let every pending fake-IDB request, promise and timer settle. */
function tick(n) {
  const rounds = n == null ? 8 : n;
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) p = p.then(() => new Promise(r => setTimeout(r, 0)));
  return p;
}

/* Real wall-clock wait. tick() drains microtasks and zero-delay timers, which is
   not the same thing: a controller that debounces with setTimeout(fn, 350) — as
   pages/options.js does — needs the clock to actually move. Ticking 350 times
   would not do it, and a sim that used tick() there would report a red that says
   "the code does not clamp" when the truth is "the save had not run yet". */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ==================================================================== */
/* 7. STATIC SCANNING — for the "=== sink ===" section                  */
/* ==================================================================== */

/* Everything the browser loads, discovered rather than listed, so a tool that
   adds a page is covered without editing the harness. */
const SKIP_DIRS = new Set(['test', 'publish', 'node_modules', '.git', 'screenshots', 'dist', 'store']);

function shippedFiles(exts) {
  const want = exts || ['.js', '.html', '.css', '.json'];
  const out = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const r = rel ? rel + '/' + name : name;
      let st;
      try { st = fs.statSync(abs); } catch (_) { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(abs, r); continue; }
      // .mjs tooling (the icon generator) is a build-time script, never shipped.
      if (name.endsWith('.mjs')) continue;
      if (want.some(e => name.endsWith(e))) out.push(r);
    }
  })(ROOT, '');
  return out.sort();
}

function readShipped(exts) {
  const map = new Map();
  for (const rel of shippedFiles(exts)) map.set(rel, readRoot(rel));
  return map;
}

/* Every file whose source matches, as "file:line" strings. */
function scanSource(re, exts) {
  const hits = [];
  for (const [rel, src] of readShipped(exts)) {
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const r = new RegExp(re.source, re.flags.replace('g', ''));
      if (r.test(lines[i])) hits.push(rel + ':' + (i + 1) + '  ' + lines[i].trim().slice(0, 120));
    }
  }
  return hits;
}

/* ==================================================================== */
/* 8. COLOUR — WCAG contrast, computed, no browser                      */
/* ==================================================================== */

/* Contrast is ARITHMETIC OVER DECLARED HEX VALUES. There is nothing to render
   and nothing to eyeball, which is what makes leaving it unchecked
   indefensible: a token that fails AA fails identically on every machine, and
   the failure is always in dark mode, which nobody screenshots.

   WCAG 2.x relative luminance, sRGB. Alpha is composited over the background
   before the ratio is taken, because a translucent foreground is not the colour
   it was declared as. */
function parseColor(value, over) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const c = {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
    return composite(c, over);
  }
  if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (x) => x.endsWith('%') ? Math.round(parseFloat(x) * 2.55) : Math.round(parseFloat(x));
    const c = {
      r: num(parts[0]), g: num(parts[1]), b: num(parts[2]),
      a: parts.length > 3 ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1
    };
    if ([c.r, c.g, c.b].some(v => !isFinite(v))) return null;
    return composite(c, over);
  }
  return null;
}

function composite(c, over) {
  if (c.a >= 1 || !over) return { r: c.r, g: c.g, b: c.b, a: 1 };
  const bg = typeof over === 'string' ? parseColor(over) : over;
  if (!bg) return { r: c.r, g: c.g, b: c.b, a: 1 };
  return {
    r: Math.round(c.r * c.a + bg.r * (1 - c.a)),
    g: Math.round(c.g * c.a + bg.g * (1 - c.a)),
    b: Math.round(c.b * c.a + bg.b * (1 - c.a)),
    a: 1
  };
}

function relativeLuminance(c) {
  const ch = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function contrastRatio(fg, bg) {
  const b = parseColor(bg);
  const f = parseColor(fg, b);
  if (!f || !b) return null;
  const lf = relativeLuminance(f), lb = relativeLuminance(b);
  const hi = Math.max(lf, lb), lo = Math.min(lf, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* The three token blocks in pages/common.css, read as three maps. The dark
   palette is declared twice — once for the explicit choice, once for "follow
   the system" — and the two drifting apart is invisible until someone flips the
   toggle, so the sim compares them. */
function parseTokenBlocks(css) {
  const out = {};
  const wanted = [
    ['light', /:root\s*\{/],
    ['dark', /:root\[data-theme\s*=\s*"dark"\]\s*\{/],
    ['darkMedia', /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{/]
  ];
  for (const [name, re] of wanted) {
    const m = re.exec(css);
    if (!m) { out[name] = null; continue; }
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    const tokens = {};
    const dre = /(--[\w-]+)\s*:\s*([^;}]+)/g;
    let d;
    while ((d = dre.exec(body))) tokens[d[1]] = d[2].trim();
    out[name] = tokens;
  }
  return out;
}

module.exports = {
  ROOT, readRoot, existsRoot, SKELETON_VERSION,
  check, section, note, runSection, finish, stats,
  makeChrome, makeIndexedDB, makeDom, extractIds, parseElements, parseAttrs,
  loadBackground, loadPage, restartWorker, tick, sleep,
  installNetworkTrap,
  shippedFiles, readShipped, scanSource,
  contrastRatio, relativeLuminance, parseColor, parseTokenBlocks
};
