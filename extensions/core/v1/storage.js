/* SPDX-License-Identifier: MPL-2.0
   core/v1/storage.js — vendored into a tool as vendor/core/storage.js.

   PROMOTED, NOT WRITTEN. Source: templates/tool/lib/storage.js
   sha256 of that source at promotion: 7f40a480f088fc728a895ea9e8bd0c66980fa5f0602e1d4175a1ef0ba82fbb6f
   Promoted 2026-08-14. Everything below this header is that file byte for byte;
   the header is the only addition. If the two ever disagree, the sha256 above
   says which one moved.

   Licence: core/ is MPL-2.0 (core/LICENSE), which is not the licence on the
   tree this came from. Both are the same copyright holder, which is what makes
   that possible; the copy still under templates/tool/ keeps its own licence.

   This is NOT core/v1/idb.js. idb.js is specified as the generic IndexedDB
   primitive — open/upgrade/transaction/put/get/cursor/quota and nothing else —
   and it does not exist. What is here is the skeleton's concrete wrapper: two
   named stores (scratch, items), the sweeps, export and clearAll. It is real,
   working code with opinions in it; extracting the generic third of it is the
   work idb.js names, and that work has not been done.
*/
/* SKELETON — IndexedDB wrapper.

   Plain script so it works in extension pages (<script src>) and in the service
   worker (importScripts). Exposes a global `SKDB`.

   Two kinds of row, and the difference matters more than it looks:

     'scratch'  work IN FLIGHT. Written while a job runs, deleted when it ends —
                including when it ends badly. Nothing in the UI lists these, so
                a scratch row that outlives its job is a row the user cannot see
                and cannot delete. background.js dropScratch() is the other half
                of that promise; every abort path calls it.

     'items'    finished work the user can SEE and DELETE (pages/options.html
                lists them, exports them, deletes them one at a time and offers
                "Delete everything"). Never write anything here that the user
                has not asked you to keep.

   EVERY ROW IN EITHER STORE CARRIES A TIMESTAMP. scratch rows carry startedAt,
   items carry createdAt. That is not bookkeeping — it is what makes the two
   sweeps below possible, and the sweeps are what stop a store growing forever
   in a product whose promise is that the user can account for what it holds.

   THE BROWSER CAN DELETE ALL OF THIS WITHOUT ASKING. An origin's IndexedDB
   lives in a best-effort bucket until something calls navigator.storage
   .persist(), which is a WINDOW-only API — a service worker calling it gets
   undefined. pages/common.js's skRequestPersistence() is where that happens,
   and pages/options.js prints the answer verbatim in both branches. Never
   describe a best-effort origin as durable; unlimitedStorage raises the QUOTA
   and does not make anything durable.

   Nothing in this file talks to the network, and nothing in it should ever
   start to. */
(function (root) {
  'use strict';

  const DB_NAME = 'skeleton';   // PLACEHOLDER(db-name) — one per tool, lowercase, no spaces
  const DB_VERSION = 1;
  /* The schema stamp that rides in every export. Bump it when the SHAPE of an
     exported row changes, so a file written by v1 is recognisable years later.
     It is deliberately not DB_VERSION: the database version is about upgrade
     paths inside this browser, the export version is a file format. */
  const EXPORT_SCHEMA = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      /* PLACEHOLDER(db-stores) — add stores here, and bump DB_VERSION when you
         do. onupgradeneeded runs for every version between the installed one and
         DB_VERSION, so guard each store with `contains` rather than assuming a
         fresh database. */
      req.onupgradeneeded = () => {
        const db = req.result;
        // In-flight work. k = `${jobId}:${paddedIndex}` so one job's rows form a
        // contiguous key range and can be deleted in a single call.
        if (!db.objectStoreNames.contains('scratch')) {
          db.createObjectStore('scratch', { keyPath: 'k' });
        }
        // Finished, user-visible, user-deletable.
        if (!db.objectStoreNames.contains('items')) {
          const s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('IDB transaction aborted'));
    }));
  }

  function req1(store, method, arg) {
    return open().then(db => new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store)[method](arg);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  const SKDB = {
    put(store, value) { return tx(store, 'readwrite', s => s.put(value)); },
    get(store, key) { return req1(store, 'get', key); },
    getAll(store, query) { return req1(store, 'getAll', query).then(r => r || []); },
    count(store) { return req1(store, 'count', undefined).then(n => n || 0); },
    delete(store, key) { return tx(store, 'readwrite', s => s.delete(key)); },
    clear(store) { return tx(store, 'readwrite', s => s.clear()); },

    /* ---- scratch: one job's rows, as a key range ---- */
    scratchKey(jobId, index) {
      return jobId + ':' + String(index == null ? 0 : index).padStart(5, '0');
    },
    // ':' is 0x3A and ';' is 0x3B, so the half-open range [id:, id;) is exactly
    // the rows of this job and cannot reach the next job's.
    scratchRange(jobId) {
      return IDBKeyRange.bound(jobId + ':', jobId + ';', false, true);
    },
    getScratch(jobId) { return SKDB.getAll('scratch', SKDB.scratchRange(jobId)); },
    deleteScratch(jobId) {
      return tx('scratch', 'readwrite', s => s.delete(SKDB.scratchRange(jobId)));
    },

    /* THE SWEEP THAT CLOSES THE LIFECYCLE HOLE.

       Every named abort path in background.js drops its own scratch. There is
       one abandonment it cannot catch, because the code that would catch it is
       not running: the service worker is suspended mid-job and comes back with
       an empty job table. onStartup does not fire for that — it fires when the
       BROWSER starts, and on a machine that is never restarted it may not fire
       for weeks while every suspension leaves another orphan.

       So the worker sweeps on every WAKE instead, and this is the predicate.
       A row is deleted when its job is not live AND (it is older than maxAgeMs
       OR it carries no startedAt at all). The unaged case is deliberate: a row
       that cannot be dated cannot be protected by an age rule, and the whole
       class this exists to remove is rows whose owner is gone.

       keepJobIds is what makes it safe for a long job: rows belonging to a job
       that IS in the live table are never touched, however old they are. A
       wedged job is the watchdog's problem, not the sweeper's — two mechanisms,
       one concern each. */
    async sweepScratch(opts) {
      const o = opts || {};
      const maxAge = Math.max(0, Number(o.maxAgeMs) || 0);
      const keep = new Set(o.keepJobIds || []);
      const now = Number(o.now) || Date.now();
      const cut = now - maxAge;
      let rows = [];
      try { rows = await SKDB.getAll('scratch'); } catch (_) { return 0; }
      let gone = 0;
      for (const row of rows) {
        if (!row) continue;
        if (keep.has(row.jobId)) continue;
        const started = Number(row.startedAt);
        const aged = !Number.isFinite(started) || started <= cut;
        if (!aged) continue;
        try { await SKDB.delete('scratch', row.k); gone++; } catch (_) {}
      }
      return gone;
    },

    /* ---- items: newest first, and a cap so history cannot grow forever ---- */
    getItemsNewestFirst() {
      return SKDB.getAll('items').then(list =>
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    },
    async trimItems(limit) {
      const max = Math.max(0, Number(limit) || 0);
      const list = await SKDB.getItemsNewestFirst();
      for (const row of list.slice(max)) await SKDB.delete('items', row.id);
      return Math.max(0, list.length - max);
    },

    /* RETENTION. A count cap is not a retention policy: 50 rows of page
       content from eight months ago are still 50 rows of page content. This is
       the age half, driven by the retentionDays setting and run by the same
       worker wake that sweeps scratch.
       days <= 0 means "no age limit" — the count cap is then the only bound,
       which is a choice the user makes on the options page, not a default. */
    async trimItemsByAge(days, now) {
      const d = Math.max(0, Number(days) || 0);
      if (!d) return 0;
      const cut = (Number(now) || Date.now()) - d * 86400000;
      let rows = [];
      try { rows = await SKDB.getAll('items'); } catch (_) { return 0; }
      let gone = 0;
      for (const row of rows) {
        // A row with no createdAt is NOT swept here. Unlike scratch, items are
        // user-visible: they are listed, exported and individually deletable,
        // so an undatable one is something the user can deal with, and deleting
        // it on a guess would be losing data silently.
        const at = Number(row && row.createdAt);
        if (!Number.isFinite(at) || at > cut) continue;
        try { await SKDB.delete('items', row.id); gone++; } catch (_) {}
      }
      return gone;
    },

    /* EXPORT. Portability is the other half of "anything stored is reachable
       and deletable" — a user who cannot get their data out has to choose
       between keeping it somewhere they cannot read and destroying it.

       It exports 'items' and nothing else. scratch is in-flight fragments of a
       job that has not finished; it is not the user's data yet, it is not
       listed anywhere, and putting it in a file the user keeps would contradict
       the promise that scratch never outlives its job.

       PLACEHOLDER(export) — a tool whose rows hold binary (an image blob, a
       PDF) must decide here: base64 into the same JSON, or a second file. Do
       not let a Blob reach JSON.stringify — it serialises as {} and the export
       silently loses the payload. */
    async exportAll(meta) {
      const items = await SKDB.getItemsNewestFirst();
      return {
        schema: EXPORT_SCHEMA,
        tool: DB_NAME,
        version: (meta && meta.version) || '',
        exportedAt: new Date((meta && meta.now) || Date.now()).toISOString(),
        count: items.length,
        items
      };
    },

    /* HOW MUCH ROOM IS LEFT, and whether the browser has promised to keep any
       of it. Never throws: a summary line must not be able to break the page
       that shows it. */
    async estimate() {
      try {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        if (!nav || !nav.storage || typeof nav.storage.estimate !== 'function') {
          return { supported: false, usage: null, quota: null };
        }
        const e = await nav.storage.estimate();
        const usage = Number(e && e.usage);
        const quota = Number(e && e.quota);
        return {
          supported: true,
          usage: Number.isFinite(usage) ? usage : null,
          quota: Number.isFinite(quota) ? quota : null
        };
      } catch (_) {
        return { supported: false, usage: null, quota: null };
      }
    },

    /* IS THIS THE DISK BEING FULL?

       Read this next to the allowlist banner in background.js, because it looks
       like the thing that banner forbids and is not. That rule is about ENGINE
       PROSE: a human-readable sentence, localised, reworded between versions,
       and carrying whatever the engine felt like interpolating — you cannot
       parse it, so you do not.

       `name` and `code` are neither. DOMException.name is a fixed identifier
       from the WebIDL spec ('QuotaExceededError'), and code 22 is the legacy
       constant QUOTA_EXCEEDED_ERR. They are enumerated protocol values, exactly
       like the message keys the REASONS table is built from, and comparing them
       with === is a membership test against a declared set. Nothing here reads
       .message, and nothing here should start to. */
    isQuotaError(e) {
      if (!e) return false;
      if (e.name === 'QuotaExceededError') return true;
      if (Number(e.code) === 22) return true;
      // Chrome wraps the failing IDB REQUEST's error onto the transaction, so a
      // put that overflowed the disk can arrive one level down.
      const inner = e.error || e.target && e.target.error;
      return !!inner && inner !== e && SKDB.isQuotaError(inner);
    },

    /* Everything this tool has stored in THIS DATABASE, gone. pages/options.html
       calls it; the privacy policy promises it.

       IT ENUMERATES, IT DOES NOT LIST. This used to be two hard-coded lines —
       clear('items'), clear('scratch') — beside a PLACEHOLDER(db-stores) that
       tells every tool author to add their own stores and never mentions this
       function. Following the instructions exactly therefore produced a silent
       lie: the button reports success, the summary re-renders as "Nothing is
       stored on this device", and the third store keeps the user's data. It was
       invisible to the test tier too, because the check counted items and
       scratch and a third store full of page content passed green.

       Reading objectStoreNames off the open database makes the promise
       structurally impossible to break: a store that exists is a store that is
       cleared, whether or not anybody remembered this file. Cleared in ONE
       transaction over all of them, so a failure part-way cannot leave half the
       user's data behind while the caller is told it is gone. */
    async clearAll() {
      const db = await open();
      const names = Array.from(db.objectStoreNames);
      if (!names.length) return [];
      await new Promise((resolve, reject) => {
        const t = db.transaction(names, 'readwrite');
        for (const name of names) t.objectStore(name).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('IDB clearAll aborted'));
      });
      return names;
    }
  };

  root.SKDB = SKDB;
})(typeof self !== 'undefined' ? self : this);
