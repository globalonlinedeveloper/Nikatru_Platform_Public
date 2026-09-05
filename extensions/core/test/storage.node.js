#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/storage.node.js — the sim for core/v1/storage.js.

   Loads the REAL core/v1/storage.js on bare Node against a fake IndexedDB that
   records every put and delete. Nothing here re-implements the module.

   THE INVARIANT WORTH MOST OF THIS FILE. storage.js holds two kinds of row and
   they have OPPOSITE retention rules, which is the sort of pair that quietly
   inverts during a refactor:

     scratch  in-flight, invisible to the user. A row with no timestamp is
              SWEPT — it cannot be aged, and an un-ageable in-flight row is the
              exact class the sweep exists to remove.
     items    finished, listed, exportable, individually deletable. A row with
              no timestamp is KEPT — deleting user-visible data on a guess is
              losing it silently.

   Both directions are asserted, and both have teeth at the bottom.

   Run: node core/test/storage.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, note } = H;

const MODULE = 'v1/storage.js';
const SRC = H.readCore(MODULE);
const DB = 'skeleton';

function boot(opts) {
  const o = opts || {};
  const idb = o.idb || H.makeIndexedDB();
  const globals = { indexedDB: idb.indexedDB, IDBKeyRange: idb.IDBKeyRange };
  if (o.navigator !== undefined) globals.navigator = o.navigator;
  const sandbox = H.loadCore(MODULE, globals, { source: o.source });
  return { SKDB: sandbox.SKDB, idb };
}

const item = (id, createdAt, extra) => Object.assign({ id, title: 'row ' + id, createdAt }, extra || {});

async function main() {
  /* ---------------------------------------------------------------- */
  section('schema');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB, idb } = boot();
    await SKDB.count('items');                       // forces open()
    const stores = idb.__stores(DB);
    check('opening creates the two documented stores',
      !!stores && stores.has('scratch') && stores.has('items'),
      stores && Array.from(stores.keys()).join(','));
    check('scratch is keyed by k', stores.get('scratch').keyPath === 'k');
    check('items is keyed by id', stores.get('items').keyPath === 'id');
    check('items carries the createdAt index the newest-first read is built around',
      stores.get('items').indexes.some(i => i.name === 'createdAt'));
    check('the database is opened ONCE and the promise reused',
      idb.__dbs.get(DB).version === 1);
  }

  /* ---------------------------------------------------------------- */
  section('round trip');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    check('put() resolves with the key', (await SKDB.put('items', item('a', 100))) === 'a');
    const got = await SKDB.get('items', 'a');
    check('get() returns the row', got && got.title === 'row a', JSON.stringify(got));
    check('get() of a miss is undefined, not a throw', (await SKDB.get('items', 'nope')) === undefined);
    check('getAll() with no query returns everything', (await SKDB.getAll('items')).length === 1);
    check('count() counts', (await SKDB.count('items')) === 1);
    await SKDB.put('items', item('b', 200));
    check('delete() removes one row', (await SKDB.delete('items', 'a')) === undefined &&
      (await SKDB.count('items')) === 1);
    await SKDB.clear('items');
    check('clear() empties the store', (await SKDB.count('items')) === 0);
    check('getAll() on an empty store is [] and never null', (await SKDB.getAll('items')).length === 0);
  }

  /* ---------------------------------------------------------------- */
  section('scratch keys — one job\'s rows are a contiguous range');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    check('scratchKey pads the index to five digits, so 10 sorts after 9',
      SKDB.scratchKey('X', 7) === 'X:00007', SKDB.scratchKey('X', 7));
    check('...and a missing index is 0', SKDB.scratchKey('X') === 'X:00000', SKDB.scratchKey('X'));
    check('the padding is what keeps the range ORDERED',
      SKDB.scratchKey('X', 9) < SKDB.scratchKey('X', 10));

    /* The boundary that matters. ':' is 0x3A. A job id one character shorter
       ('j') must not reach 'j2:...' (0x32, below the colon) or 'jx:...' (0x78,
       above the semicolon) — those are two DIFFERENT jobs whose rows would be
       destroyed by a sloppy range. */
    for (const id of ['j', 'j2', 'jx']) {
      await SKDB.put('scratch', { k: SKDB.scratchKey(id, 0), jobId: id, startedAt: 1 });
      await SKDB.put('scratch', { k: SKDB.scratchKey(id, 1), jobId: id, startedAt: 1 });
    }
    const mine = await SKDB.getScratch('j');
    check('getScratch() returns exactly this job\'s rows', mine.length === 2, mine.length);
    check('...in index order', mine[0].k === 'j:00000' && mine[1].k === 'j:00001');
    check('...and none of the neighbours', mine.every(r => r.jobId === 'j'));

    const gone = await SKDB.deleteScratch('j');
    check('deleteScratch() takes the whole range in one call', gone === undefined &&
      (await SKDB.getScratch('j')).length === 0);
    check('...and does not touch a job id that sorts BELOW the separator (j2)',
      (await SKDB.getScratch('j2')).length === 2);
    check('...or one that sorts ABOVE it (jx)',
      (await SKDB.getScratch('jx')).length === 2);
    check('the total is exactly the four survivors', (await SKDB.count('scratch')) === 4);
  }

  /* ---------------------------------------------------------------- */
  section('sweepScratch — the wake sweep that closes the lifecycle hole');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    const NOW = 10000000;
    await SKDB.put('scratch', { k: 'live:00000', jobId: 'live', startedAt: 1 });          // ancient, but LIVE
    await SKDB.put('scratch', { k: 'old:00000', jobId: 'old', startedAt: NOW - 60000 });  // orphan, aged
    await SKDB.put('scratch', { k: 'new:00000', jobId: 'new', startedAt: NOW - 10 });     // orphan, fresh
    await SKDB.put('scratch', { k: 'undated:00000', jobId: 'undated' });                  // no startedAt

    const gone = await SKDB.sweepScratch({ maxAgeMs: 30000, keepJobIds: ['live'], now: NOW });
    check('the sweep reports what it removed', gone === 2, gone);
    check('a row belonging to a LIVE job is never touched, however old — a wedged job is\n' +
      '        the watchdog\'s problem, not the sweeper\'s',
      !!(await SKDB.get('scratch', 'live:00000')));
    check('an aged orphan is removed', (await SKDB.get('scratch', 'old:00000')) === undefined);
    check('a FRESH orphan is left alone — it may still be in flight',
      !!(await SKDB.get('scratch', 'new:00000')));
    check('an UNDATED scratch row is removed: it cannot be protected by an age rule, and\n' +
      '        the whole class this exists to delete is rows whose owner is gone',
      (await SKDB.get('scratch', 'undated:00000')) === undefined);
  }
  {
    const { SKDB } = boot();
    check('a sweep over an empty store removes nothing and does not throw',
      (await SKDB.sweepScratch({ maxAgeMs: 1000 })) === 0);
    check('no options at all is survivable', (await SKDB.sweepScratch()) === 0);
  }

  /* ---------------------------------------------------------------- */
  section('items — newest first, a count cap, and an age cap');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    await SKDB.put('items', item('mid', 200));
    await SKDB.put('items', item('new', 300));
    await SKDB.put('items', item('old', 100));
    const list = await SKDB.getItemsNewestFirst();
    check('getItemsNewestFirst sorts by createdAt descending',
      list.map(r => r.id).join(',') === 'new,mid,old', list.map(r => r.id).join(','));

    const trimmed = await SKDB.trimItems(2);
    check('trimItems drops the oldest beyond the cap', trimmed === 1, trimmed);
    check('...and keeps the newest two',
      (await SKDB.getItemsNewestFirst()).map(r => r.id).join(',') === 'new,mid');
    check('trimItems below the count is a no-op', (await SKDB.trimItems(5)) === 0);
  }
  {
    const { SKDB } = boot();
    const NOW = 40 * 86400000;
    await SKDB.put('items', item('recent', NOW - 3600000));
    await SKDB.put('items', item('ancient', NOW - 35 * 86400000));
    await SKDB.put('items', { id: 'undated', title: 'no date' });

    const gone = await SKDB.trimItemsByAge(30, NOW);
    check('trimItemsByAge removes rows past the retention window', gone === 1, gone);
    check('...and keeps a recent one', !!(await SKDB.get('items', 'recent')));
    check('an UNDATED ITEM IS KEPT — the opposite of the scratch rule, and deliberately so:\n' +
      '        items are listed, exported and individually deletable, so an undatable one is\n' +
      '        something the user can deal with',
      !!(await SKDB.get('items', 'undated')));
    check('days <= 0 means no age limit at all, so the count cap is the only bound',
      (await SKDB.trimItemsByAge(0, NOW)) === 0 && (await SKDB.count('items')) === 2);
  }

  /* ---------------------------------------------------------------- */
  section('export — the user\'s data, and only the user\'s data');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    await SKDB.put('items', item('a', 100));
    await SKDB.put('items', item('b', 200));
    await SKDB.put('scratch', { k: 'j:00000', jobId: 'j', startedAt: 1, fragment: 'HALF-DONE' });

    const p = await SKDB.exportAll({ version: '9.9.9', now: 86400000 });
    check('the export carries a schema stamp of its own, separate from DB_VERSION', p.schema === 1, p.schema);
    check('...the tool name', p.tool === DB, p.tool);
    check('...the caller\'s version', p.version === '9.9.9');
    check('...an ISO timestamp from the injected clock',
      p.exportedAt === new Date(86400000).toISOString(), p.exportedAt);
    check('...a count that matches the rows', p.count === 2 && p.items.length === 2);
    check('...newest first', p.items[0].id === 'b');
    check('SCRATCH IS NOT EXPORTED. It is in-flight fragments of a job that has not\n' +
      '        finished — not listed anywhere, not the user\'s data yet, and putting it in a\n' +
      '        file the user keeps would contradict the promise that scratch never outlives\n' +
      '        its job',
      JSON.stringify(p).indexOf('HALF-DONE') < 0, JSON.stringify(p));
    check('...and no exported row carries a scratch key', p.items.every(r => !('k' in r)));

    const empty = await SKDB.exportAll();
    check('an export with no meta still produces a well-formed file',
      empty.count === 2 && typeof empty.exportedAt === 'string' && empty.version === '');
  }

  /* ---------------------------------------------------------------- */
  section('clearAll ENUMERATES, it does not list');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB, idb } = boot();
    await SKDB.put('items', item('a', 100));
    await SKDB.put('scratch', { k: 'j:00000', jobId: 'j', startedAt: 1 });

    /* A third store, exactly as the PLACEHOLDER(db-stores) comment tells a tool
       author to add one — and exactly what the old two-hard-coded-lines version
       of clearAll silently left behind while reporting success. */
    const extra = idb.__injectStore(DB, 'thumbnails', 'id');
    extra.data.set('t1', { id: 't1', bytes: 'PAGE CONTENT' });

    const names = await SKDB.clearAll();
    check('clearAll returns every store it cleared',
      names.slice().sort().join(',') === 'items,scratch,thumbnails', names.join(','));
    check('items is empty', (await SKDB.count('items')) === 0);
    check('scratch is empty', (await SKDB.count('scratch')) === 0);
    check('THE STORE THIS FILE HAS NEVER HEARD OF IS ALSO EMPTY. Reading objectStoreNames\n' +
      '        off the open database is what makes "everything is gone" structurally true\n' +
      '        instead of true-if-somebody-remembered',
      extra.data.size === 0, extra.data.size);

    const again = await SKDB.clearAll();
    check('clearAll is idempotent', again.length === 3);
  }

  /* ---------------------------------------------------------------- */
  section('quota classification — enumerated values, never prose');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();
    check('a DOMException named QuotaExceededError is one',
      SKDB.isQuotaError({ name: 'QuotaExceededError' }));
    check('legacy code 22 is one', SKDB.isQuotaError({ code: 22 }));
    check('Chrome wraps the request error onto the transaction — one level down still counts',
      SKDB.isQuotaError({ name: 'AbortError', error: { name: 'QuotaExceededError' } }));
    check('...and through event.target.error',
      SKDB.isQuotaError({ target: { error: { code: 22 } } }));
    check('an ordinary error is not one', SKDB.isQuotaError({ name: 'AbortError' }) === false);
    check('null is not one', SKDB.isQuotaError(null) === false);
    check('undefined is not one', SKDB.isQuotaError(undefined) === false);
    check('NOTHING READS .message. An error whose PROSE mentions quota but whose name and\n' +
      '        code say otherwise is NOT classified — engine prose is localised and reworded\n' +
      '        between versions, so it is not parseable and is not parsed',
      SKDB.isQuotaError({ name: 'AbortError', message: 'QuotaExceededError: the disk is full' }) === false);
    check('a self-referential error does not loop forever',
      (() => { const e = { name: 'AbortError' }; e.error = e; return SKDB.isQuotaError(e) === false; })());
  }
  {
    /* End to end: a put that the engine refuses arrives as a rejection the
       caller can classify. */
    const { SKDB, idb } = boot();
    await SKDB.count('items');
    idb.__setPutHook(() => { const e = new Error('quota'); e.name = 'QuotaExceededError'; return e; });
    let caught = null;
    try { await SKDB.put('items', item('a', 100)); } catch (e) { caught = e; }
    check('a refused put REJECTS rather than resolving quietly', caught !== null);
    check('...and the rejection is classifiable as a quota failure', SKDB.isQuotaError(caught));
  }

  /* ---------------------------------------------------------------- */
  section('estimate() — never throws, because a summary line must not break a page');
  /* ---------------------------------------------------------------- */
  {
    const { SKDB } = boot();   // no navigator in this context at all
    const e = await SKDB.estimate();
    check('no navigator: supported false, no throw',
      e.supported === false && e.usage === null && e.quota === null, JSON.stringify(e));
  }
  {
    const { SKDB } = boot({ navigator: {} });
    const e = await SKDB.estimate();
    check('navigator with no storage API: supported false', e.supported === false);
  }
  {
    const { SKDB } = boot({ navigator: H.makeNavigator(async () => ({ usage: 1234, quota: 999999 })) });
    const e = await SKDB.estimate();
    check('a working estimate is reported', e.supported === true && e.usage === 1234 && e.quota === 999999,
      JSON.stringify(e));
  }
  {
    const { SKDB } = boot({ navigator: H.makeNavigator(async () => { throw new Error('nope'); }) });
    let threw = null, e = null;
    try { e = await SKDB.estimate(); } catch (x) { threw = x; }
    check('an estimate that REJECTS is swallowed', threw === null, threw && threw.message);
    check('...and reported as unsupported', e.supported === false);
  }
  {
    const { SKDB } = boot({ navigator: H.makeNavigator(async () => ({ usage: 'lots' })) });
    const e = await SKDB.estimate();
    check('a figure that will not coerce becomes null, rather than NaN reaching a screen',
      e.supported === true && e.usage === null, JSON.stringify(e));
    check('an ABSENT figure is null too', e.quota === null, JSON.stringify(e));
  }
  {
    /* PINNED BEHAVIOUR, NOT AN ENDORSEMENT. `Number(null)` is 0 and 0 is
       finite, so an engine that answers `{ quota: null }` — the documented way
       to say "unknown" — is reported here as a quota of ZERO, which a summary
       line renders as "0 bytes" rather than "unknown". Every other unusable
       value in this function lands on null.

       The sim pins it rather than fixing it because core/v1/storage.js is a
       byte-for-byte promotion of templates/tool/lib/storage.js with the source
       sha256 recorded in its header and in core/core.json; changing one copy
       here would break the invariant that makes the promotion checkable, and
       the fix belongs upstream in the template, in its own change. Recorded so
       the next person meets it as a known edge and not as a mystery. */
    const { SKDB } = boot({ navigator: H.makeNavigator(async () => ({ usage: 5, quota: null })) });
    const e = await SKDB.estimate();
    check('KNOWN EDGE, pinned: an explicit null quota coerces to 0, not to null — see the\n' +
      '        comment above; the fix belongs in templates/tool/lib/storage.js, upstream of\n' +
      '        this promoted copy',
      e.supported === true && e.quota === 0, JSON.stringify(e));
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — every check above, re-run against broken source');
  /* ---------------------------------------------------------------- */
  note('If a mutation stops applying, harness.mutate() throws rather than passing quietly.');

  await H.expectBroken('the scratch-key check depends on the five-digit pad', async () => {
    const src = H.mutate(SRC, ".padStart(5, '0');", ".padStart(3, '0');");
    const { SKDB } = boot({ source: src });
    return SKDB.scratchKey('X', 7) === 'X:00007';
  });

  await H.expectBroken('the range-isolation check depends on the half-open upper bound', async () => {
    const src = H.mutate(SRC, "IDBKeyRange.bound(jobId + ':', jobId + ';', false, true)",
      "IDBKeyRange.bound(jobId + ':', jobId + '~', false, true)");
    const { SKDB } = boot({ source: src });
    for (const id of ['j', 'jx']) await SKDB.put('scratch', { k: SKDB.scratchKey(id, 0), jobId: id, startedAt: 1 });
    await SKDB.deleteScratch('j');
    return (await SKDB.getScratch('jx')).length === 1;
  });

  await H.expectBroken('the third-store check depends on clearAll enumerating', async () => {
    const src = H.mutate(SRC, '      const names = Array.from(db.objectStoreNames);',
      "      const names = ['items', 'scratch'];");
    const { SKDB, idb } = boot({ source: src });
    await SKDB.put('items', item('a', 100));
    const extra = idb.__injectStore(DB, 'thumbnails', 'id');
    extra.data.set('t1', { id: 't1', bytes: 'PAGE CONTENT' });
    const names = await SKDB.clearAll();
    return names.indexOf('thumbnails') >= 0 && extra.data.size === 0;
  });

  await H.expectBroken('the undated-ITEM-is-kept check depends on the isFinite guard', async () => {
    const src = H.mutate(SRC, '        if (!Number.isFinite(at) || at > cut) continue;',
      '        if (at > cut) continue;');
    const { SKDB } = boot({ source: src });
    await SKDB.put('items', { id: 'undated', title: 'no date' });
    await SKDB.trimItemsByAge(30, 40 * 86400000);
    return (await SKDB.get('items', 'undated')) !== undefined;
  });

  await H.expectBroken('the undated-SCRATCH-is-swept check depends on the !isFinite branch', async () => {
    const src = H.mutate(SRC, '        const aged = !Number.isFinite(started) || started <= cut;',
      '        const aged = started <= cut;');
    const { SKDB } = boot({ source: src });
    await SKDB.put('scratch', { k: 'undated:00000', jobId: 'undated' });
    await SKDB.sweepScratch({ maxAgeMs: 30000, now: 10000000 });
    return (await SKDB.get('scratch', 'undated:00000')) === undefined;
  });

  await H.expectBroken('the live-job check depends on the keepJobIds guard', async () => {
    const src = H.mutate(SRC, '        if (keep.has(row.jobId)) continue;', '');
    const { SKDB } = boot({ source: src });
    await SKDB.put('scratch', { k: 'live:00000', jobId: 'live', startedAt: 1 });
    await SKDB.sweepScratch({ maxAgeMs: 30000, keepJobIds: ['live'], now: 10000000 });
    return (await SKDB.get('scratch', 'live:00000')) !== undefined;
  });

  await H.expectBroken('the no-prose rule depends on isQuotaError not reading .message', async () => {
    const src = H.mutate(SRC, '      if (!e) return false;',
      '      if (!e) return false;\n      if (/quota/i.test(String(e.message || ""))) return true;');
    const { SKDB } = boot({ source: src });
    return SKDB.isQuotaError({ name: 'AbortError', message: 'QuotaExceededError: the disk is full' }) === false;
  });

  await H.expectBroken('the scratch-is-not-exported check depends on exportAll reading items only', async () => {
    const src = H.mutate(SRC, '        count: items.length,\n        items\n      };',
      "        count: items.length,\n        items: items.concat(await SKDB.getAll('scratch'))\n      };");
    const { SKDB } = boot({ source: src });
    await SKDB.put('items', item('a', 100));
    await SKDB.put('scratch', { k: 'j:00000', jobId: 'j', startedAt: 1, fragment: 'HALF-DONE' });
    const p = await SKDB.exportAll();
    return JSON.stringify(p).indexOf('HALF-DONE') < 0;
  });
}

main().then(() => process.exit(H.finish()), e => {
  console.error('\nSIM CRASHED — this is a failure, not a skip:\n', e);
  process.exit(1);
});
