/* SPDX-License-Identifier: MPL-2.0
   core/v1/jobs.js — vendored into a tool as vendor/core/jobs.js.

   PROMOTED, NOT WRITTEN. Source: templates/tool/lib/jobs.js
   sha256 of that source at promotion: 820e3d3be269a94a65d1597665816f59f9a52564700f73e78fa6a14fc13665f5
   Promoted 2026-08-14. Everything below this header is that file byte for byte;
   the header is the only addition. If the two ever disagree, the sha256 above
   says which one moved.

   Licence: core/ is MPL-2.0 (core/LICENSE), which is not the licence on the
   tree this came from. Both are the same copyright holder, which is what makes
   that possible; the copy still under templates/tool/ keeps its own licence.

   Not one of the modules the architecture enumerates for v1 — it is here because
   a real implementation exists, not because it was specified. It is the
   write-through job table over chrome.storage.session that stops in-flight state
   dying with the service worker.
*/
/* SKELETON — the job table. IN-FLIGHT STATE THAT SURVIVES THE WORKER.

   READ THIS BEFORE YOU WRITE A `new Map()` IN A SERVICE WORKER.

   An MV3 service worker is killed after ~30 seconds idle and after ~5 minutes
   of wall clock, WHILE YOUR JOB IS STILL RUNNING. When it comes back it is a
   fresh module: every module-scope variable is at its initial value. A job
   table that lives only in a Map therefore has exactly one behaviour after a
   suspension — it is empty — and everything the map was the owner of becomes
   unreachable:

     * the scratch rows that job wrote are orphaned in IndexedDB. Nothing in the
       UI lists scratch, so they are rows the user can neither see nor delete.
       That is the promise in lib/storage.js's banner, broken by the platform's
       normal lifecycle rather than by a bug.
     * abortJob(tabId) finds nothing, so closing the tab cleans up nothing.
     * the badge can be stuck, because the setTimeout that would have cleared it
       died with the worker.

   This is the recurring correctness bug in every tool that has a queue or a
   long operation, so the skeleton makes the right thing the easy thing: the
   job table is a WRITE-THROUGH mirror over chrome.storage.session. Reads are
   synchronous against an in-memory cache (so `SKJOBS.has(tabId)` is still a
   plain if), and every mutation is persisted immediately.

   WHY storage.session AND NOT local OR sync
     session dies when the browser closes, never touches the disk in a form the
     next browsing session can read, and never leaves the machine. In-flight
     state is exactly that shape. `local` would resurrect week-old jobs from a
     crash; `sync` would send another device a job record for a tab it does not
     have.

   WHAT MAY GO IN A JOB RECORD
     Numbers, tab ids, declared action codes, and an ORIGIN (scheme + host) —
     never a full url, never a page title, never anything the page controls.
     A job record outlives the run that wrote it, so it is subject to the same
     rule as the last-failure note in background.js. The sim asserts it: a
     hostile url's path, query and token must not appear anywhere in the
     persisted table.

   THE ONE THING YOU MUST DO IN YOUR WORKER
     Nothing that reads the table may run before rehydrate() has resolved.
     background.js does it once, at module top level, and every entry point
     awaits that promise. Copy that. */
(function (root) {
  'use strict';

  /* PLACEHOLDER(prefix) — one key per tool, so two extensions in one profile
     cannot collide (they cannot anyway, storage is per-extension, but the name
     is what a developer sees in devtools and it should say which tool it is). */
  const JOBS_KEY = 'skJobs';

  /* The cache. Every read hits this; every write updates it and then the
     session store. A read that could return a stale value is worse than a slow
     one, so the cache is updated FIRST and synchronously. */
  const cache = new Map();          // tabId (number) -> job object

  let readyPromise = null;
  let lastWrite = Promise.resolve();
  let writes = 0;

  function session() {
    try {
      return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) || null;
    } catch (_) { return null; }
  }

  /* Serialised as an object keyed by tab id, because JSON has no Map and a
     round trip through storage must produce the same shape it stored. */
  function snapshot() {
    const out = {};
    for (const [tabId, job] of cache) out[String(tabId)] = job;
    return out;
  }

  /* Best effort by design, and never awaited by the caller that mutated. A
     failed mirror write must not fail the work; the next mutation rewrites the
     whole table anyway, so one lost write self-heals. */
  function persist() {
    const area = session();
    if (!area) return Promise.resolve();
    writes++;
    lastWrite = Promise.resolve()
      .then(() => area.set({ [JOBS_KEY]: snapshot() }))
      .catch(() => {});
    return lastWrite;
  }

  const SKJOBS = {
    KEY: JOBS_KEY,

    /* Call once, at worker module top level. Idempotent: a second call returns
       the same promise rather than reading twice and racing itself. */
    rehydrate() {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        const area = session();
        if (!area) return 0;
        let stored = null;
        try {
          const got = await area.get(JOBS_KEY);
          stored = got && got[JOBS_KEY];
        } catch (_) { return 0; }
        if (!stored || typeof stored !== 'object') return 0;
        for (const key of Object.keys(stored)) {
          const job = stored[key];
          if (!job || typeof job !== 'object') continue;
          const tabId = Number(key);
          if (!Number.isFinite(tabId)) continue;
          // tabId is re-derived from the KEY, never trusted from the value: the
          // key is what every lookup uses, and a record whose two copies
          // disagreed would be findable by one path and not the other.
          job.tabId = tabId;
          cache.set(tabId, job);
        }
        return cache.size;
      })();
      return readyPromise;
    },

    /* The promise rehydrate() returned, or a resolved one if a caller has not
       started it yet. Entry points await this. */
    ready() { return readyPromise || Promise.resolve(0); },

    /* Synchronous reads, against the cache. */
    get(tabId) { return cache.get(Number(tabId)) || null; },
    has(tabId) { return cache.has(Number(tabId)); },
    size() { return cache.size; },
    keys() { return Array.from(cache.keys()); },
    values() { return Array.from(cache.values()); },
    entries() { return Array.from(cache.entries()); },

    /* Mutations. Each one writes through. */
    set(job) {
      if (!job || job.tabId == null) return job;
      cache.set(Number(job.tabId), job);
      persist();
      return job;
    },
    delete(tabId) {
      const id = Number(tabId);
      const had = cache.delete(id);
      if (had) persist();
      return had;
    },
    clear() {
      if (!cache.size) return 0;
      const n = cache.size;
      cache.clear();
      persist();
      return n;
    },

    /* Every job whose startedAt is older than maxAgeMs — the watchdog's input.
       A record with no startedAt counts as stale: it cannot be aged, and an
       un-ageable in-flight record is exactly the thing this file exists to stop
       accumulating. */
    stale(maxAgeMs, now) {
      const cut = (now == null ? Date.now() : now) - Math.max(0, Number(maxAgeMs) || 0);
      const out = [];
      for (const job of cache.values()) {
        const started = Number(job && job.startedAt);
        if (!Number.isFinite(started) || started <= cut) out.push(job);
      }
      return out;
    },

    /* ---- harness/diagnostic surface ---- */
    __writes() { return writes; },
    __flush() { return lastWrite; },
    /* Tests only: forget everything, including the fact that we rehydrated, so
       a fresh worker instance can be booted against the same storage. */
    __reset() { cache.clear(); readyPromise = null; writes = 0; }
  };

  root.SKJOBS = SKJOBS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { SKJOBS };
})(typeof self !== 'undefined' ? self : this);
