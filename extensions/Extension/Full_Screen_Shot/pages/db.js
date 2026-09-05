/* FullShot IndexedDB helper.
   Plain script so it works both in extension pages (<script>) and the
   service worker (importScripts). Exposes a global `FSDB`. */

(function (root) {
  'use strict';

  const DB_NAME = 'fullshot';
  const DB_VERSION = 1;
  /* Every store this database has, in one place. The wipe and the sweep below
     both walk this list, and a store added to the upgrade handler and forgotten
     here is a store the user cannot empty — which is exactly the promise
     publish/PRIVACY-POLICY.html §7 makes on this file's behalf. Graded against
     the createObjectStore calls below by test/background-sim.node.js, so the
     two cannot drift. */
  const STORES = ['frames', 'captures', 'shots'];
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Raw per-scroll frames of an in-flight capture. k = `${captureId}:${paddedIndex}`
        if (!db.objectStoreNames.contains('frames')) {
          db.createObjectStore('frames', { keyPath: 'k' });
        }
        // Metadata for an in-flight capture, keyed by captureId.
        if (!db.objectStoreNames.contains('captures')) {
          db.createObjectStore('captures', { keyPath: 'id' });
        }
        // Finished screenshots (history), keyed by id.
        if (!db.objectStoreNames.contains('shots')) {
          const s = db.createObjectStore('shots', { keyPath: 'id' });
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

  /* ---------------- the old verdict never leaves the store ----------------
     REDACTION-CLAIM-SPEC.md §4. Three populations exist in users' IndexedDB:
     v2 records carrying the eight-state ladder (`state`, `severity`, `pixels`,
     `scan`, `bake`); ancient records whose `pixels` came straight from the
     setting; and records with no redaction block at all.

     THE STORED VERDICT IS NEVER READ, IN ANY OF THEM. Not as an input, not as a
     fallback, not to seed a default. Those words were written by machinery this
     release deletes, and re-reading one carries a claim across the boundary on
     the strength of a word — which is the whole disease.

     IT HAPPENS HERE AND NOWHERE ELSE. Five files read this store — result,
     history, editor, beautify, scrollclip — and a strip written in any one of
     them is a strip the other four do not have. Doing it at the store boundary
     means no page can read the old fields even by accident, and any subsequent
     save persists the new shape. No bulk migration: rewriting every record in a
     user's library to delete five fields is more risk than the fields are
     worth, and this is the only door they can come through.

     EVERY COUNTER THE OLD LEDGER CANNOT SUPPLY IS `null`, NEVER `0`. A zero is
     a measurement; this is the absence of one, and printing a confident zero
     over a page nobody read is exactly the failure being removed. */

  /* ---------------- blocks are not matches, and only the NAME says which ------
     REDACTION-CLAIM-SPEC.md §2.1, and the reason this projection exists at all.

     `acts.matched`, `acts.painted` and `acts.verifiedOpaque` all count MATCHES,
     because every consumer of them subtracts one from another —
     AI-HANDOFF-ENVELOPE.md §5 tells 67 tools in as many words that they may —
     and TWO NUMBERS MAY ONLY BE SUBTRACTED IF THEY COUNT THE SAME THING. A block
     is one client rect. A token that wraps across a line is one match and two
     blocks, and for one release the surplus block paid for a genuinely uncovered
     email elsewhere on the same page: the alarm silent, the ledger a serene
     2/2/2, the address legible in the delivered image.

     A v2 bake ledger counted only blocks — `handed`, `painted`, `verified`. The
     match-unit roll-up needs a match identity on every box — an id AND the
     number of blocks that match produced, as one value — and no record written
     before this version carries one: the boxes died with `cap.meta` the instant
     the capture was sealed, exactly as they were designed to. So the two
     match-unit counters are not MISSING from an old record, they are UNKNOWABLE
     from it, and the honest answer to a question that cannot be answered is
     `null`. Never `0`, and never the block count: a wrong number is worse than an
     absent one, because a wrong number is actionable.

     THE PROJECTION IS THE POINT, NOT THE NULL. Reading `bake.matchesPainted`
     instead of `bake.painted` gives the same answer today and would be one
     keystroke from giving the wrong one again, because both units would still be
     reachable through the same object — and one keystroke is precisely the
     distance this defect travelled the first time. What the lift below is handed
     therefore CONTAINS NO BLOCK COUNTER AT ALL: `.painted` and `.verified` are
     `undefined` on it. The mistake is not discouraged, it is unavailable.

     `present` is a separate answer from the counters for the same reason: "there
     was a bake" and "the bake can say how many matches it covered" are different
     facts, and collapsing them is what makes an absent measurement look like a
     zero. */
  function fsMatchCounters(bake) {
    const b = (bake && typeof bake === 'object' && bake.v === 1) ? bake : null;
    const n = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null;
    /* MATCH-UNIT NAMES ONLY. Both are absent from every ledger sealed before
       this version, so a v2 record answers null twice — which is the finding,
       not a degradation of it. */
    return { present: !!b,
             matchesPainted: n(b && b.matchesPainted),
             matchesVerifiedOpaque: n(b && b.matchesVerifiedOpaque),
             /* THE BLOCK-UNIT GIVING-UP COUNTERS, under names that say `blocks`
                and therefore safe to project. All three are absent from a v2
                ledger for the same reason the two above are — nothing counted
                them — so they answer null, and null is "this record cannot
                say". A zero here would tell a reader that an old capture drew
                every block it found, which is a claim no old record supports. */
             blocksLost: n(b && b.blocksLost),
             blocksUnpainted: n(b && b.blocksUnpainted),
             verifySkipped: n(b && b.verifySkipped) };
  }

  /* The scan side of the same projection. A v2 scan ledger CAN answer two of
     the v4 questions — it counted its own per-leaf refusals and its own
     truncation flags, both in their own units — and it cannot answer any of the
     block-unit ones, because it had no per-match identity to count against.
     Lifting the two it can and nulling the rest is the §4 rule applied one
     field at a time: prefer `null` over a plausible-looking number. */
  function fsScanCounters(scan) {
    const s = (scan && typeof scan === 'object' && scan.v === 2) ? scan : null;
    const n = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v) : null;
    const d = (s && s.declined && typeof s.declined === 'object') ? s.declined : null;
    const tr = (s && s.truncated && typeof s.truncated === 'object') ? s.truncated : null;
    const parts = d ? [n(d.tooLong), n(d.unmeasurable)] : null;
    const textRefused = (parts && parts.every(v => v !== null)) ? parts[0] + parts[1] : null;
    /* The same conjunction content/capture.js seals, over the fields a v2
       ledger has. `tr.error` did not exist then and reads as absent, which is
       the only direction that is safe: it cannot turn a false into a true. */
    const matchedComplete = (!tr || textRefused === null || n(s.matched) === null) ? null
      : !!(!tr.walk && !tr.time && !tr.ceiling && !tr.error &&
           s.walksCompleted === s.walks && textRefused === 0 &&
           n(d.ceiling) === 0 && n(d.other) === 0);
    return { present: !!s, matched: n(s && s.matched), tr, textRefused, matchedComplete };
  }

  /* ---------------- an acts block written before the giving-up was data ------
     A v3 acts block is a correct reading by a build that could not see five of
     the things v4 reports. Its seven fields mean exactly what they meant; the
     five it lacks are UNKNOWABLE from it, not zero — a v3 record cannot say
     whether its walk refused a leaf or its cap dropped a block, because nobody
     was counting.

     Filling them in here, at the store boundary, is what stops the difference
     being invisible. `undefined` reads as absent to `typeof` and as falsy to
     everything else, so an un-normalised v3 block would render exactly like a
     v4 block that measured no gaps at all — the absence of a measurement wearing
     a measurement's clothes, which is the disease this whole release treats. */
  /* The local is named `acts` and not `a` on purpose: every counter read below
     is a MATCH-unit field of a v3 acts block, and naming the object it comes off
     is what keeps that legible — to a reader and to the source scan in
     test/aihandoff-sim, which forbids a bare `.painted` in this region precisely
     because a bare one would be a block counter off an old ledger. */
  function fsUpgradeActs(stored) {
    const acts = (stored && typeof stored === 'object') ? stored : null;
    if (!acts || acts.v === 4) return acts;
    const keep = v => (v === undefined ? null : v);
    return { v: 4,
             matched: keep(acts.matched), painted: keep(acts.painted),
             verifiedOpaque: keep(acts.verifiedOpaque),
             matchedComplete: null,
             walkComplete: keep(acts.walkComplete), truncatedBy: keep(acts.truncatedBy),
             textRefused: null, blocksLost: null,
             blocksUnpainted: null, blocksUnread: null,   // nobody was counting

             /* A reading this build cannot fully reproduce is not a full
                reading, and `partial` is the word §4 reserves for exactly that.
                Left at `absent` when that is what it said, because an absent
                ledger has counters that must stay null and a gate that re-reads
                them. */
             ledger: acts.ledger === 'absent' ? 'absent' : 'partial' };
  }

  /* §4's third population, and the reason it is answered HERE. A record written
     before the redaction block existed has no `redaction` at all, and an absent
     block is not a state the table in §4 has a row for — so every page that
     reads one has to invent the row itself. Five files read this store; five
     local fallbacks is the exact hazard that put the strip at the store
     boundary in the first place, and a page whose fallback is missing renders
     nothing rather than "no account of a pass".
     AN ABSENCE MADE INTO DATA: the block says, in the shape every consumer
     already reads, that this record cannot say what happened. `requested: null`
     gates the review (§3.1), which costs a dialog; the opposite default costs
     the user their data. */
  function fsAbsentRedaction() {
    return { v: 3, requested: null,
             acts: { v: 4, matched: null, painted: null, verifiedOpaque: null,
                     matchedComplete: null, walkComplete: null, truncatedBy: null,
                     textRefused: null, blocksLost: null, blocksUnpainted: null,
                     blocksUnread: null, ledger: 'absent' },
             kinds: {}, marks: [] };
  }

  function fsStripShot(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    const old = rec.redaction;
    if (!old || typeof old !== 'object') {
      return Object.assign({}, rec, { redaction: fsAbsentRedaction() });
    }
    if (old.v === 3 && old.acts && typeof old.acts === 'object' && !('pixels' in old) &&
        !('state' in old) && !('severity' in old) && !('scan' in old) && !('bake' in old)) {
      /* Already the new shape — but a derived image's marks describe a picture
         that no longer exists, and a mark at a stale coordinate is worse than
         no mark because it actively points at the wrong place. */
      if (rec.derivedFrom || old.derivedFrom) {
        return Object.assign({}, rec, { redaction: Object.assign({}, old,
          { requested: null, marks: [], acts: fsUpgradeActs(old.acts) }) });
      }
      if (old.acts.v === 4) return rec;
      return Object.assign({}, rec, { redaction: Object.assign({}, old,
        { acts: fsUpgradeActs(old.acts) }) });
    }
    /* The bake ledger, with every block-unit field left behind at the door. */
    const bake = fsMatchCounters(old.bake);
    const scan = fsScanCounters(old.scan);
    const s = (old.scan && typeof old.scan === 'object' && old.scan.v === 2) ? old.scan : null;
    const tr = scan.tr;
    const lifted = !!(s || bake.present);
    /* `requested` is `false` ONLY where the record positively says the setting
       was off. `null` — "we cannot tell whether redaction ran" — gates the
       review, which costs a dialog; the opposite default costs the user their
       data. */
    const requested = old.pixels === 'none' ? false : lifted ? true : null;
    const acts = {
      v: 4,
      /* `scan.matched` was ALREADY counted once per match by the line after the
         detector returned, so it crosses the boundary in the unit it was written
         in and needs no conversion. It is the only one of the three that does.
         Read off the projection rather than off the old ledger, so that the two
         scan-derived counters and the flag that says whether one of them is
         whole all come through the same door. */
      matched: scan.matched,
      painted: bake.matchesPainted,
      verifiedOpaque: bake.matchesVerifiedOpaque,
      /* Lifted, because a v2 scan ledger counted every refusal this conjunction
         reads — in leaves and in flags, none of them in the block unit that
         makes the other two counters unknowable. */
      matchedComplete: scan.matchedComplete,
      walkComplete: tr ? !!(!tr.walk && !tr.time && !tr.ceiling && !tr.error &&
                            s.walksCompleted === s.walks) : null,
      truncatedBy: !tr ? null
        : tr.ceiling ? 'ceiling' : tr.time ? 'time' : tr.walk ? 'elements' : null,
      textRefused: scan.textRefused,
      /* NOT KNOWABLE FROM AN OLD RECORD, and null is the whole answer. A v2
         bake counted `handed`, `painted` and `verified` in BLOCKS with no match
         identity behind them, so it cannot say which of them a cap dropped or a
         frame refused — and the block-unit projection above hands this lift no
         such number to be tempted by. */
      blocksLost: bake.blocksLost,
      blocksUnpainted: bake.blocksUnpainted,
      blocksUnread: bake.verifySkipped,
      /* A lift is not a reading, and `partial` is the word that says so. */
      ledger: lifted ? 'partial' : 'absent'
    };
    if (!lifted) {
      acts.matched = null; acts.painted = null; acts.verifiedOpaque = null;
      acts.matchedComplete = null; acts.walkComplete = null; acts.truncatedBy = null;
      acts.textRefused = null; acts.blocksLost = null;
      acts.blocksUnpainted = null; acts.blocksUnread = null;
    }
    const out = Object.assign({}, rec);
    out.redaction = { v: 3, requested, acts,
                      kinds: (old.kinds && typeof old.kinds === 'object') ? old.kinds : {},
                      /* Geometry was never stored by any version that wrote a
                         verdict, so there is nothing honest to carry over. */
                      marks: [] };
    return out;
  }

  const FSDB = {
    stores: STORES,
    fsStripShot: fsStripShot,

    put(store, value) {
      return tx(store, 'readwrite', s => s.put(value));
    },

    get(store, key) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(store === 'shots' ? fsStripShot(req.result) : req.result);
        req.onerror = () => reject(req.error);
      }));
    },

    getAll(store, query, count) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAll(query, count);
        req.onsuccess = () => resolve(store === 'shots'
          ? (req.result || []).map(fsStripShot) : (req.result || []));
        req.onerror = () => reject(req.error);
      }));
    },

    /* IS THERE A ROW UNDER THIS KEY — asked with getKey(), never with get().
       A `shots` row is an entire screenshot: one blob per segment plus a
       thumbnail, hundreds of megabytes for a long page. The batch runner asks
       this question once a quarter second while it waits for the result page to
       produce one, and pulling the record through a service worker's memory to
       learn a boolean is the same mistake keys() above exists to avoid.
       getKey() resolves with the key or with `undefined`, so the comparison is
       against undefined rather than a truthiness test: a legal key can be the
       empty string, and 0 is a legal key in a store that is not keyPath'd. */
    hasKey(store, key) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getKey(key);
        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => reject(req.error);
      }));
    },

    /* KEYS, never records. A screenshot library is hundreds of megabytes of
       pixels, and everything the sweep below reasons about is written on the
       front of the key. getAll() would pull the whole library through a service
       worker's memory to learn nothing the keys did not already say. */
    keys(store) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }));
    },

    delete(store, key) {
      return tx(store, 'readwrite', s => s.delete(key));
    },

    /* The whole database, in ONE transaction. Clearing the stores one at a time
       can stop half way — a failed write, a tab closed, the disk full — and what
       it leaves behind is frames pointing at captures that are gone, which is
       precisely the state planSweep() exists to clean up. A wipe that can create
       orphans is not a wipe. */
    clearAll() {
      return open().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(STORES, 'readwrite');
        STORES.forEach(name => t.objectStore(name).clear());
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('IDB transaction aborted'));
      }));
    },

    /* Frames of one capture (k is `${captureId}:${index padded to 5}`) */
    frameKey(captureId, index) {
      return captureId + ':' + String(index).padStart(5, '0');
    },

    getFrames(captureId) {
      const range = IDBKeyRange.bound(captureId + ':', captureId + ';', false, true);
      return FSDB.getAll('frames', range);
    },

    deleteFrames(captureId) {
      const range = IDBKeyRange.bound(captureId + ':', captureId + ';', false, true);
      return tx('frames', 'readwrite', s => s.delete(range));
    },

    /* Finished shots sorted newest first */
    getShotsNewestFirst() {
      return FSDB.getAll('shots').then(list =>
        list.sort((a, b) => b.createdAt - a.createdAt));
    },

    /* The inverse of frameKey(). Split at the LAST colon: a capture id comes
       from newId() and holds none today, but a key that grew one would silently
       regroup every frame in the database — and this function decides what gets
       deleted. */
    captureOfFrameKey(k) {
      const s = String(k), cut = s.lastIndexOf(':');
      return cut < 0 ? s : s.slice(0, cut);
    },

    /* ---------------- what nothing can reach (v1.10.1) ----------------
       PURE. It is handed three lists of KEYS and returns two lists of ids, so
       the rule that decides what gets destroyed can be graded without a
       database, and the code that does the destroying has no judgement of its
       own left to get wrong.

       TWO CATEGORIES, AND BOTH ARE PROVABLE RATHER THAN LIKELY. That is the
       whole design: a sweep that guesses is a sweep that eventually eats a
       screenshot somebody wanted.

         FRAMES WITH NO `captures` ROW. pages/result.js is the only thing that
         ever consumes frames and it needs that row to do it (result.js:177 —
         no row, no stitch, and it returns null). So a frame group with no row
         cannot be turned into a picture by any code path in this product. It
         appears on no page, so no page can delete it, and `unlimitedStorage`
         means nothing evicts it either.

         `captures` ROWS WITH NO FRAMES. The mirror image, left by a result page
         that deleted the frames and died before deleting the row (result.js
         :619-620 does them in that order). Nothing can stitch it either.

       WHAT IS DELIBERATELY NOT SWEPT: a `captures` row that still HAS its
       frames. That is a capture waiting to be stitched — result.html?id= opens
       it — and the fact that nothing in the UI currently links to one is a
       missing link, not licence to delete a screenshot the user took.

       PROTECT is the live captures. A capture in flight has frames on disk and
       no `captures` row until FS_DONE seals it, which is the exact shape of
       category one; the session map is the only thing that tells them apart.
       Reading it ONCE, before the plan, is enough: startCapture creates the
       session before any frame of that capture is written, so a frame that was
       on disk when the keys were read belongs to a capture whose session was
       already in the map — and capture ids are unique, so a row that is
       unreferenced now cannot become referenced by some later capture. */
    planSweep(inv) {
      const i = inv || {};
      const protect = new Set(i.protect || []);
      const captures = new Set(i.captureIds || []);
      const withFrames = new Set();
      const frames = [];
      for (const key of (i.frameKeys || [])) {
        const id = FSDB.captureOfFrameKey(key);
        if (withFrames.has(id)) continue;         // one entry per capture, not per frame
        withFrames.add(id);
        if (!captures.has(id) && !protect.has(id)) frames.push(id);
      }
      const empty = [];
      for (const id of captures) {
        if (!withFrames.has(id) && !protect.has(id)) empty.push(id);
      }
      return { frames: frames, captures: empty };
    },

    /* THE DISK IS FULL, asked of the error and never of its text. Chrome writes
       that message itself, in the browser's UI language, and has reworded it
       between versions; DOMException.name is fixed by the platform and is the
       same string in every language. `code === 22` is the pre-name spelling and
       costs one comparison. Firefox's IndexedDB uses its own name, so it is
       listed rather than guessed at.
       Only ever handed an exception this product's own awaits produced, and it
       reads two declared properties rather than stringifying anything — the
       same rule the reason allowlist follows in background.js. */
    isQuotaError(e) {
      if (!e) return false;
      return e.name === 'QuotaExceededError' ||
             e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
             e.code === 22;
    },

    /* ---------------- how much room there is ----------------
       navigator.storage is the only honest answer to "is my history about to be
       thrown away". Three states, and the third one matters: a browser that
       does not answer is not a browser with nothing stored, so it reports null
       rather than zero and the page says so in words. */
    estimate() {
      return Promise.resolve().then(() => {
        if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
          return { usage: null, quota: null };
        }
        return navigator.storage.estimate().then(e => ({
          usage: finite(e && e.usage), quota: finite(e && e.quota)
        }));
      }).catch(() => ({ usage: null, quota: null }));
    },

    persisted() {
      return Promise.resolve().then(() => {
        if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persisted) return null;
        return navigator.storage.persisted().then(v => !!v);
      }).catch(() => null);
    },

    /* WINDOW ONLY, and that is not an accident of this file: the platform
       exposes persist() to a Window and withholds it from a worker, so the page
       has to be the one that asks. A worker calling this gets null and says
       nothing, rather than reporting a refusal that never happened. */
    persist() {
      return Promise.resolve().then(() => {
        if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return null;
        return navigator.storage.persist().then(v => !!v);
      }).catch(() => null);
    }
  };

  function finite(n) {
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  root.FSDB = FSDB;
})(typeof self !== 'undefined' ? self : this);
