#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/jobs.node.js — the sim for core/v1/jobs.js.

   Loads the REAL core/v1/jobs.js on bare Node and grades it. Nothing here is a
   re-implementation: the only fake is chrome.storage.session, and it records
   every read and write so the traffic can be asserted, not just the answers.

   WHAT THIS MODULE IS FOR, AND THEREFORE WHAT IS WORTH TESTING. An MV3 service
   worker is killed mid-job; when it comes back, every module-scope variable is
   at its initial value. jobs.js exists so the job table is NOT one of them. So
   the central test here is not "set then get" — a plain Map passes that. It is:
   set a job, THROW THE MODULE AWAY, load it again from the same session store,
   and find the job. Section `restart` is the one that would go red if somebody
   replaced the write-through mirror with a Map, and the teeth at the bottom
   prove it by doing exactly that to the real source.

   Run: node core/test/jobs.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, note } = H;

const MODULE = 'v1/jobs.js';
const KEY = 'skJobs';

/* A worker "boot": a fresh module instance over a given chrome. Two boots over
   ONE chrome is a service-worker restart, which is the whole point of the file. */
function boot(chrome, source) {
  const sandbox = H.loadCore(MODULE, { chrome }, { source });
  return sandbox.SKJOBS;
}

function job(tabId, extra) {
  return Object.assign({ tabId, action: 'capture', startedAt: 1000, origin: 'https://example.com' }, extra || {});
}

async function main() {
  /* ---------------------------------------------------------------- */
  section('cold start');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    check('rehydrate() over an empty session store recovers 0 jobs', (await J.rehydrate()) === 0);
    check('the table is empty', J.size() === 0 && J.keys().length === 0);
    check('a miss is null, not undefined', J.get(7) === null);
    check('has() on a miss is false', J.has(7) === false);
    check('KEY is the documented session key', J.KEY === KEY, J.KEY);
  }

  /* ---------------------------------------------------------------- */
  section('write-through: every mutation reaches storage.session');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    await J.rehydrate();

    J.set(job(1));
    await J.__flush();
    check('set() mirrored the table into storage.session',
      !!chrome.storage.session.__data[KEY], JSON.stringify(chrome.storage.session.__data));
    check('the mirror is keyed by tab id as a STRING (JSON has no numeric keys)',
      Object.keys(chrome.storage.session.__data[KEY]).join(',') === '1');

    J.set(job(2));
    await J.__flush();
    check('a second job joins the same record',
      Object.keys(chrome.storage.session.__data[KEY]).sort().join(',') === '1,2');

    const writesBefore = J.__writes();
    check('delete() of an ABSENT tab returns false', J.delete(99) === false);
    check('...and does not write — a no-op must not cost a storage round trip',
      J.__writes() === writesBefore, J.__writes() + ' vs ' + writesBefore);

    check('delete() of a present tab returns true', J.delete(2) === true);
    await J.__flush();
    check('...and the mirror no longer holds it',
      Object.keys(chrome.storage.session.__data[KEY]).join(',') === '1');

    check('clear() returns the number it removed', J.clear() === 1);
    await J.__flush();
    check('...and the mirror is empty',
      Object.keys(chrome.storage.session.__data[KEY]).length === 0);

    const w = J.__writes();
    check('clear() on an already-empty table returns 0', J.clear() === 0);
    check('...and does not write', J.__writes() === w);
  }

  /* ---------------------------------------------------------------- */
  section('restart — THE reason this file exists');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const first = boot(chrome);
    await first.rehydrate();
    first.set(job(11, { startedAt: 5000 }));
    first.set(job(12, { startedAt: 6000 }));
    await first.__flush();

    /* The worker dies. A second module instance is a fresh module: its cache
       starts empty and everything it knows has to come back off storage. */
    const second = boot(chrome);
    check('a FRESH module instance starts with an empty cache', second.size() === 0);
    const recovered = await second.rehydrate();
    check('rehydrate() after a worker restart recovers every job', recovered === 2, recovered);
    check('...and they are the same records', second.get(11).startedAt === 5000 && second.get(12).startedAt === 6000);
    check('...reachable by the synchronous read path', second.has(11) && second.has(12));

    second.delete(11);
    await second.__flush();
    const third = boot(chrome);
    await third.rehydrate();
    check('a delete SURVIVES the next restart too — no resurrection', third.size() === 1 && !third.has(11));
  }

  /* ---------------------------------------------------------------- */
  section('the key is the authority, never the value');
  /* ---------------------------------------------------------------- */
  {
    /* A stored record whose own tabId disagrees with the key it is filed
       under. If the value won, the record would be findable by one path and
       not the other — get(4) would return an object claiming to be tab 9. */
    const chrome = H.makeChrome({ session: { [KEY]: { '4': { tabId: 9, action: 'capture' } } } });
    const J = boot(chrome);
    await J.rehydrate();
    const rec = J.get(4);
    check('a record filed under key 4 is reachable as 4', !!rec);
    check('...and its tabId is re-derived FROM THE KEY, not trusted from the value',
      rec && rec.tabId === 4, rec && rec.tabId);
    check('the value\'s claim of tab 9 creates no second entry', J.get(9) === null && J.size() === 1);
  }

  /* ---------------------------------------------------------------- */
  section('rubbish in the session store never throws');
  /* ---------------------------------------------------------------- */
  {
    const cases = [
      ['a string where the table should be', { [KEY]: 'not an object' }],
      ['null', { [KEY]: null }],
      ['an array', { [KEY]: ['a', 'b'] }],
      ['null entries', { [KEY]: { '1': null, '2': job(2) } }],
      ['non-numeric keys', { [KEY]: { 'abc': { tabId: 1 }, '3': job(3) } }],
      ['nothing at all', {}]
    ];
    for (const [label, seed] of cases) {
      const chrome = H.makeChrome({ session: seed });
      const J = boot(chrome);
      let threw = null;
      let n = -1;
      try { n = await J.rehydrate(); } catch (e) { threw = e; }
      check('rehydrate() survives ' + label, threw === null, threw && threw.message);
      check('  ...and reports a sane count for ' + label, n >= 0 && Number.isFinite(n), n);
    }
    /* The two mixed cases must keep the GOOD row rather than discarding the
       whole table — a single bad record is not a reason to lose the rest. */
    const chrome = H.makeChrome({ session: { [KEY]: { 'abc': { tabId: 1 }, '3': job(3) } } });
    const J = boot(chrome);
    check('a bad key is skipped and the good record still lands', (await J.rehydrate()) === 1 && J.has(3));
  }

  /* ---------------------------------------------------------------- */
  section('rehydrate() is idempotent');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome({ session: { [KEY]: { '1': job(1) } } });
    const J = boot(chrome);
    const [a, b] = await Promise.all([J.rehydrate(), J.rehydrate()]);
    check('two concurrent calls agree', a === 1 && b === 1);
    await J.rehydrate();
    check('the session store was read ONCE across three calls — the second call returns\n' +
      '        the same promise instead of racing itself',
      chrome.storage.session.reads === 1, chrome.storage.session.reads);
    check('ready() hands back that promise', (await J.ready()) === 1);
  }
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    check('ready() before rehydrate() resolves rather than hanging', (await J.ready()) === 0);
  }

  /* ---------------------------------------------------------------- */
  section('no storage.session in this context');
  /* ---------------------------------------------------------------- */
  {
    /* Firefox event pages and any page context that lacks the session area.
       The module must degrade to an in-memory table, not explode. */
    const chrome = H.makeChrome({ omit: ['session'] });
    const J = boot(chrome);
    check('rehydrate() returns 0 instead of throwing', (await J.rehydrate()) === 0);
    J.set(job(1));
    check('set() still works in memory', J.has(1));
    let threw = null;
    try { await J.__flush(); } catch (e) { threw = e; }
    check('the mirror write is best-effort and does not reject', threw === null, threw && threw.message);
  }
  {
    const J = boot(undefined);      // no `chrome` binding at all
    check('a context with no chrome global at all still loads and reads', (await J.rehydrate()) === 0);
    J.set(job(3));
    check('...and still tracks jobs in memory', J.get(3).tabId === 3);
  }

  /* ---------------------------------------------------------------- */
  section('a failing mirror write must not fail the work');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    await J.rehydrate();
    chrome.storage.session.failSet = new Error('QuotaExceededError');
    J.set(job(1));
    let threw = null;
    try { await J.__flush(); } catch (e) { threw = e; }
    check('a rejected session write is swallowed', threw === null, threw && threw.message);
    check('...and the job is still in the table', J.has(1));
    J.set(job(2));
    await J.__flush();
    check('the NEXT mutation rewrites the whole table, so one lost write self-heals',
      Object.keys(chrome.storage.session.__data[KEY]).sort().join(',') === '1,2',
      JSON.stringify(chrome.storage.session.__data[KEY]));
  }

  /* ---------------------------------------------------------------- */
  section('stale() — the watchdog predicate');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    await J.rehydrate();
    const NOW = 1000000;
    J.set(job(1, { startedAt: NOW - 10 }));            // fresh
    J.set(job(2, { startedAt: NOW - 60000 }));         // old
    J.set({ tabId: 3, action: 'capture' });            // no startedAt at all
    const stale = J.stale(30000, NOW).map(j => j.tabId).sort();
    check('an old job is stale', stale.indexOf(2) >= 0);
    check('a fresh job is not', stale.indexOf(1) < 0);
    check('a job with NO startedAt counts as stale — an un-ageable in-flight record is\n' +
      '        exactly the class this file exists to stop accumulating',
      stale.indexOf(3) >= 0, JSON.stringify(stale));
    check('a job exactly on the cut is stale (<=, not <)',
      J.stale(10, NOW).map(j => j.tabId).indexOf(1) >= 0);
  }

  /* ---------------------------------------------------------------- */
  section('__reset() gives a sim a clean instance');
  /* ---------------------------------------------------------------- */
  {
    const chrome = H.makeChrome();
    const J = boot(chrome);
    await J.rehydrate();
    J.set(job(1));
    J.__reset();
    check('__reset() empties the cache', J.size() === 0);
    check('...and forgets that we rehydrated, so the same storage can be re-read',
      (await J.rehydrate()) >= 0 && J.__writes() === 0);
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — every check above, re-run against broken source');
  /* ---------------------------------------------------------------- */
  note('docs/CORE-POLICY.md §2 rule 3: a sim must carry a recorded failing case.');
  note('These mutate the real file on the way into the vm. If a mutation stops applying,');
  note('harness.mutate() throws rather than letting the teeth quietly point at nothing.');

  const SRC = H.readCore(MODULE);

  /* 1. Drop the write-through in set(). A plain in-memory Map still passes
        every set/get test; only the restart survives or does not. */
  await H.expectBroken('restart recovery depends on set() persisting', async () => {
    const src = H.mutate(SRC,
      '      cache.set(Number(job.tabId), job);\n      persist();',
      '      cache.set(Number(job.tabId), job);');
    const chrome = H.makeChrome();
    const first = boot(chrome, src);
    await first.rehydrate();
    first.set(job(11));
    await first.__flush();
    const second = boot(chrome, src);
    return (await second.rehydrate()) === 1;
  });

  /* 2. Trust the value's tabId instead of re-deriving it from the key. */
  await H.expectBroken('the key-is-authority check depends on job.tabId being re-derived', async () => {
    const src = H.mutate(SRC, '          job.tabId = tabId;\n', '');
    const chrome = H.makeChrome({ session: { [KEY]: { '4': { tabId: 9, action: 'capture' } } } });
    const J = boot(chrome, src);
    await J.rehydrate();
    const rec = J.get(4);
    return !!rec && rec.tabId === 4;
  });

  /* 3. Re-read on every rehydrate() call. */
  await H.expectBroken('the idempotence check depends on the memoised promise', async () => {
    const src = H.mutate(SRC, '      if (readyPromise) return readyPromise;', '');
    const chrome = H.makeChrome({ session: { [KEY]: { '1': job(1) } } });
    const J = boot(chrome, src);
    await J.rehydrate();
    await J.rehydrate();
    await J.rehydrate();
    return chrome.storage.session.reads === 1;
  });

  /* 4. Persist on a delete that removed nothing. */
  await H.expectBroken('the no-write-on-miss check depends on the `if (had)` guard', async () => {
    const src = H.mutate(SRC, '      if (had) persist();', '      persist();');
    const chrome = H.makeChrome();
    const J = boot(chrome, src);
    await J.rehydrate();
    const before = J.__writes();
    J.delete(99);
    return J.__writes() === before;
  });

  /* 5. Treat an un-ageable record as fresh. */
  await H.expectBroken('the un-ageable-is-stale check depends on the !isFinite branch', async () => {
    const src = H.mutate(SRC,
      '        if (!Number.isFinite(started) || started <= cut) out.push(job);',
      '        if (started <= cut) out.push(job);');
    const chrome = H.makeChrome();
    const J = boot(chrome, src);
    await J.rehydrate();
    J.set({ tabId: 3, action: 'capture' });
    return J.stale(30000, 1000000).some(j => j.tabId === 3);
  });

  /* 6. Let a failing mirror write escape. */
  await H.expectBroken('the best-effort-write check depends on the .catch() in persist()', async () => {
    const src = H.mutate(SRC, "      .catch(() => {});", "      ;");
    const chrome = H.makeChrome();
    const J = boot(chrome, src);
    await J.rehydrate();
    chrome.storage.session.failSet = new Error('QuotaExceededError');
    J.set(job(1));
    try { await J.__flush(); } catch (_) { return false; }
    return true;
  });
}

main().then(() => process.exit(H.finish()), e => {
  console.error('\nSIM CRASHED — this is a failure, not a skip:\n', e);
  process.exit(1);
});
