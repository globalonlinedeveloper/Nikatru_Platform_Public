/* SPDX-License-Identifier: MPL-2.0
   core/test/harness.js — the fakes the core sims run against.

   NOT A SIM. The name is deliberate: .github/workflows/ci.yml globs
   `core/test/*.node.js` and runs every match, so a helper must NOT end in
   `.node.js` or CI would execute it as a sim and grade an empty run as a pass.

   WHY THIS DOES NOT REUSE templates/tool/test/harness.js, WHICH IS BIGGER AND
   ALREADY WORKS. Two reasons, both structural rather than stylistic:

     1. DIRECTION. core/ is vendored INTO tools; the template is one of the
        things downstream of it. A core sim that require()s a file under
        templates/ makes the shared runtime depend on a consumer, and the first
        symptom would be core going red for a change that belongs entirely to
        the template.
     2. LICENCE. core/ is MPL-2.0 (core/LICENSE). templates/tool/ is not — see
        CONTRIBUTING.md on the two-licence boundary. Test code is not shipped,
        but inventing a require() across that boundary is not this file's
        decision to make.

   WHAT IS FAKED, AND THE RULE THAT KEEPS IT HONEST. Nothing here
   re-implements a core module. Every function under test is the one the browser
   runs, loaded from the real file on disk through loadCore(); only what it
   TALKS TO is fake — chrome.storage, IndexedDB, navigator.storage. Each fake
   records what it was asked to do so a sim can assert on the traffic and not
   only on the return value.

   THE MUTATION CONTRACT. docs/CORE-POLICY.md §2 rule 3 requires every core
   module's sim to carry a recorded failing case, "because an assertion that
   cannot fail inflates coverage without adding any". `mutate()` below makes
   that an EXECUTED check rather than a comment: a sim edits the real source
   text, reloads it, and asserts a named check now goes red. mutate() throws
   when its search string is not found EXACTLY once — so a refactor that moves
   the mutated line breaks the sim loudly instead of quietly leaving the teeth
   pointed at nothing. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE_ROOT = path.join(__dirname, '..');

function readCore(rel) {
  return fs.readFileSync(path.join(CORE_ROOT, rel.split('/').join(path.sep)), 'utf8');
}

/* ------------------------------------------------------------------ */
/* scoreboard                                                          */
/* ------------------------------------------------------------------ */

let TOTAL = 0;
let FAILS = 0;
const FAILED = [];

function section(name) { console.log('\n=== ' + name + ' ==='); }
function note(text) { console.log('     ' + text); }

function check(label, ok, extra) {
  TOTAL++;
  if (ok) {
    console.log('  PASS  ' + label);
  } else {
    FAILS++;
    FAILED.push(label);
    console.log('  FAIL  ' + label + (extra === undefined ? '' : '  <- ' + extra));
  }
  return !!ok;
}

/* Used by the teeth sections. `fn` returns the boolean the corresponding real
   check asserted; under a mutation it must come back false (or throw). A
   mutation that leaves the predicate TRUE means the real check does not
   actually depend on the line that was broken — which is the vacuous-assertion
   defect, so it is reported as a failure of this sim. */
async function expectBroken(label, fn) {
  TOTAL++;
  let held;
  try {
    held = await fn();
  } catch (_) {
    console.log('  TEETH ' + label + '  (mutant threw)');
    return true;
  }
  if (held) {
    FAILS++;
    FAILED.push('TEETH ' + label);
    console.log('  FAIL  TEETH ' + label +
      '  <- the mutation changed nothing: the check above passes against broken source, so it is not testing what it claims');
    return false;
  }
  console.log('  TEETH ' + label);
  return true;
}

function finish() {
  console.log('\n' + (FAILS ? 'FAIL' : 'PASS') + '  ' + (TOTAL - FAILS) + '/' + TOTAL + ' assertions');
  if (FAILS) {
    console.log('failed:');
    for (const f of FAILED) console.log('  - ' + f);
  }
  if (TOTAL === 0) {
    console.log('REQUIRED COVERAGE: this sim graded ZERO assertions. An empty run that exits 0 is\n' +
      'indistinguishable from a passing one, which is the whole reason the core job fails on an\n' +
      'empty glob. Failing instead.');
    return 1;
  }
  return FAILS ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* source mutation                                                     */
/* ------------------------------------------------------------------ */

function mutate(source, from, to) {
  const first = source.indexOf(from);
  if (first < 0) {
    throw new Error('MUTATION NO LONGER APPLIES. This sim tried to break:\n\n' + from +
      '\n\nand that text is not in the source any more. The teeth are pointed at nothing, so the\n' +
      'recorded failing case this module is required to carry has silently stopped existing.\n' +
      'Re-point the mutation at whatever the line became — never delete it.');
  }
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error('AMBIGUOUS MUTATION. This text appears more than once:\n\n' + from +
      '\n\nA mutation must name exactly one site or the sim cannot say which one it broke.');
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

/* ------------------------------------------------------------------ */
/* loading a real core file                                            */
/* ------------------------------------------------------------------ */

/* Runs the REAL file in a fresh vm context and returns the context object, so
   the globals the module attaches (SKDB, SKJOBS, sk*) are readable from here.
   `opts.source` overrides the bytes on disk — that is how the teeth sections
   load a mutant of the same file. */
function loadCore(rel, globals, opts) {
  const o = opts || {};
  const src = o.source === undefined ? readCore(rel) : o.source;
  const sandbox = Object.assign({
    console: o.console || console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask,
    Date, Math, JSON, URL, TextEncoder, TextDecoder
  }, globals || {});
  const ctx = vm.createContext(sandbox);
  /* The modules end with `(typeof self !== 'undefined' ? self : this)`. Give
     them a real `self` so they attach to this context rather than to whatever
     `this` happens to be in a vm script. */
  vm.runInContext('this.self = this;', ctx, { filename: 'core-test-bootstrap' });
  vm.runInContext(src, ctx, { filename: 'core/' + rel });
  return sandbox;
}

/* ------------------------------------------------------------------ */
/* fake chrome.storage                                                 */
/* ------------------------------------------------------------------ */

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function makeChrome(opts) {
  const o = opts || {};
  const listeners = [];

  function fire(changes, areaName) {
    for (const fn of listeners.slice()) {
      try { fn(clone(changes), areaName); } catch (_) {}
    }
  }

  function makeArea(areaName, seed) {
    const data = Object.assign({}, clone(seed) || {});
    const api = {
      /* test-side handles */
      __name: areaName,
      __data: data,
      reads: 0,
      writes: 0,
      failGet: null,   // set to an Error to make get() reject
      failSet: null,   // set to an Error to make the NEXT set() reject

      async get(keys) {
        api.reads++;
        if (api.failGet) throw api.failGet;
        if (keys === null || keys === undefined) return clone(data);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) {
          if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = clone(data[k]);
        }
        return out;
      },

      async set(obj) {
        if (api.failSet) { const e = api.failSet; api.failSet = null; throw e; }
        api.writes++;
        const changes = {};
        for (const k of Object.keys(obj)) {
          changes[k] = { oldValue: clone(data[k]), newValue: clone(obj[k]) };
          data[k] = clone(obj[k]);
        }
        fire(changes, areaName);
      },

      async remove(keys) {
        api.writes++;
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const k of list) {
          if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
          changes[k] = { oldValue: clone(data[k]), newValue: undefined };
          delete data[k];
        }
        if (Object.keys(changes).length) fire(changes, areaName);
      },

      async clear() {
        api.writes++;
        const changes = {};
        for (const k of Object.keys(data)) changes[k] = { oldValue: clone(data[k]), newValue: undefined };
        for (const k of Object.keys(data)) delete data[k];
        if (Object.keys(changes).length) fire(changes, areaName);
      }
    };
    return api;
  }

  const storage = {
    sync: makeArea('sync', o.sync),
    local: makeArea('local', o.local),
    session: makeArea('session', o.session),
    onChanged: {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      __count() { return listeners.length; }
    }
  };
  /* `omit` drops an area entirely — the "this context has no storage.session"
     case that jobs.js is required to survive. */
  for (const name of o.omit || []) delete storage[name];

  return { runtime: { id: 'core-sim', lastError: null }, storage };
}

/* ------------------------------------------------------------------ */
/* fake IndexedDB                                                      */
/* ------------------------------------------------------------------ */

/* Enough of IndexedDB for core/v1/storage.js and no more: object stores with a
   keyPath, key ranges, and transactions that complete asynchronously after
   their requests. Requests fire in creation order in a later macrotask, which
   is what makes `t.oncomplete` (assigned AFTER fn(store) has run) reachable —
   the same ordering the real API has, and the reason storage.js's tx() helper
   is written the way it is. */
function makeIndexedDB() {
  const dbs = new Map();       // name -> { version, stores: Map }
  const log = [];              // ['put', store, key] ...
  let putHook = null;          // (storeName, value) => Error | null

  const later = fn => setTimeout(fn, 0);

  function nameList(list) {
    const a = list.slice();
    a.contains = n => a.indexOf(n) >= 0;
    return a;
  }

  function inRange(key, q) {
    if (q === undefined || q === null) return true;
    if (q && q.__range) {
      if (q.lower !== null && q.lower !== undefined) {
        if (q.lowerOpen ? !(key > q.lower) : !(key >= q.lower)) return false;
      }
      if (q.upper !== null && q.upper !== undefined) {
        if (q.upperOpen ? !(key < q.upper) : !(key <= q.upper)) return false;
      }
      return true;
    }
    return key === q;
  }

  function sortedKeys(rec) {
    return Array.from(rec.data.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function makeStore(t, name, rec) {
    function push(run) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      t.__ops.push({ req, run });
      return req;
    }
    function writable() {
      if (t.mode !== 'readwrite') {
        const e = new Error('ReadOnlyError');
        e.name = 'ReadOnlyError';
        throw e;
      }
    }
    return {
      name,
      keyPath: rec.keyPath,
      put(value) {
        return push(req => {
          writable();
          const key = rec.keyPath ? value[rec.keyPath] : undefined;
          if (key === undefined) {
            const e = new Error('DataError: no key at keyPath "' + rec.keyPath + '"');
            e.name = 'DataError';
            throw e;
          }
          const hookErr = putHook && putHook(name, value);
          if (hookErr) throw hookErr;
          rec.data.set(key, clone(value));
          log.push(['put', name, key]);
          req.result = key;
        });
      },
      get(key) { return push(req => { req.result = clone(rec.data.get(key)); }); },
      getAll(query) {
        return push(req => {
          req.result = sortedKeys(rec).filter(k => inRange(k, query)).map(k => clone(rec.data.get(k)));
        });
      },
      count() { return push(req => { req.result = rec.data.size; }); },
      delete(q) {
        return push(req => {
          writable();
          for (const k of sortedKeys(rec).filter(k => inRange(k, q))) {
            rec.data.delete(k);
            log.push(['delete', name, k]);
          }
          req.result = undefined;
        });
      },
      clear() {
        return push(req => {
          writable();
          rec.data.clear();
          log.push(['clear', name, null]);
          req.result = undefined;
        });
      }
    };
  }

  function makeTx(st, storeNames, mode) {
    const list = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    const t = {
      mode: mode || 'readonly',
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      __ops: [],
      objectStore(n) {
        if (list.indexOf(n) < 0) {
          const e = new Error('NotFoundError: "' + n + '" is not in this transaction');
          e.name = 'NotFoundError';
          throw e;
        }
        const rec = st.stores.get(n);
        if (!rec) {
          const e = new Error('NotFoundError: no object store named "' + n + '"');
          e.name = 'NotFoundError';
          throw e;
        }
        return makeStore(t, n, rec);
      }
    };
    later(() => {
      let failed = null;
      for (const op of t.__ops) {
        try {
          op.run(op.req);
        } catch (e) {
          op.req.error = e;
          failed = e;
          if (op.req.onerror) op.req.onerror({ target: op.req });
          break;
        }
        if (op.req.onsuccess) op.req.onsuccess({ target: op.req });
      }
      if (failed) {
        t.error = failed;
        if (t.onerror) t.onerror({ target: t });
        else if (t.onabort) t.onabort({ target: t });
      } else if (t.oncomplete) {
        t.oncomplete({ target: t });
      }
    });
    return t;
  }

  function makeDb(name) {
    const st = dbs.get(name);
    return {
      name,
      get version() { return st.version; },
      get objectStoreNames() { return nameList(Array.from(st.stores.keys()).sort()); },
      createObjectStore(n, o2) {
        const rec = { keyPath: (o2 && o2.keyPath) || null, indexes: [], data: new Map() };
        st.stores.set(n, rec);
        return { name: n, createIndex(iname, kp) { rec.indexes.push({ name: iname, keyPath: kp }); return { name: iname }; } };
      },
      transaction(storeNames, mode) { return makeTx(st, storeNames, mode); },
      close() {}
    };
  }

  const indexedDB = {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let st = dbs.get(name);
        if (!st) { st = { version: 0, stores: new Map() }; dbs.set(name, st); }
        const want = version === undefined || version === null ? Math.max(1, st.version) : version;
        if (want < st.version) {
          const e = new Error('VersionError');
          e.name = 'VersionError';
          req.error = e;
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        req.result = makeDb(name);
        if (want > st.version) {
          const old = st.version;
          st.version = want;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: old, newVersion: want });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    deleteDatabase(name) {
      const req = { onsuccess: null, onerror: null, result: undefined };
      later(() => { dbs.delete(name); if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    }
  };

  const IDBKeyRange = {
    bound(lower, upper, lowerOpen, upperOpen) {
      return { __range: true, lower, upper, lowerOpen: !!lowerOpen, upperOpen: !!upperOpen };
    },
    only(v) { return { __range: true, lower: v, upper: v, lowerOpen: false, upperOpen: false }; },
    lowerBound(v, open) { return { __range: true, lower: v, upper: null, lowerOpen: !!open, upperOpen: false }; },
    upperBound(v, open) { return { __range: true, lower: null, upper: v, lowerOpen: false, upperOpen: !!open }; }
  };

  return {
    indexedDB,
    IDBKeyRange,
    /* test-side handles */
    __log: log,
    __dbs: dbs,
    __stores(name) { const st = dbs.get(name); return st ? st.stores : null; },
    /* Adds a store the module never created — the case clearAll() must still
       cover, because it enumerates objectStoreNames rather than listing. */
    __injectStore(dbName, storeName, keyPath) {
      const st = dbs.get(dbName);
      if (!st) throw new Error('no such fake database: ' + dbName);
      st.stores.set(storeName, { keyPath: keyPath || 'id', indexes: [], data: new Map() });
      return st.stores.get(storeName);
    },
    __setPutHook(fn) { putHook = fn; },
    __reset() { dbs.clear(); log.length = 0; putHook = null; }
  };
}

function makeNavigator(estimate) {
  return { storage: estimate ? { estimate } : undefined };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 1); i++) p = p.then(() => sleep(0));
  return p;
}

module.exports = {
  CORE_ROOT, readCore, loadCore, mutate,
  section, note, check, expectBroken, finish,
  makeChrome, makeIndexedDB, makeNavigator,
  sleep, tick, clone,
  stats() { return { total: TOTAL, fails: FAILS, failed: FAILED.slice() }; }
};
