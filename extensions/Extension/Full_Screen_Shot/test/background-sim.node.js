#!/usr/bin/env node
/* FullShot BACKGROUND service-worker sim (no browser). Loads the REAL
   background.js into a node vm behind a fake `chrome` and a virtual clock, then
   grades the OBSERVABLE behaviour: what gets injected, which FS_* messages flow
   and in what order, what lands in IndexedDB, what the badge says, and — above
   all — what happens on the error paths (restricted URL, dead tab, declined
   grant, rate limit, mid-flight throw, batch job that fails).

   Nothing reaches into the worker's private state: `sessions` is a module-scope
   const inside the vm and stays unreachable, so every session assertion is made
   through the router's own answers ("No active session", "already running").

   The fake is anchored to observed Chrome semantics, not to convenience —
   otherwise the sim becomes a mock of itself:
     - tabs.sendMessage resolves UNDEFINED when the receiver returns false, which
       is exactly why a declined FS_START still reports ok:true (see P-6);
     - tabs.sendMessage REJECTS when the file that answers that message was never
       injected, so "did the worker inject?" is observable rather than mocked;
     - captureVisibleTab grabs the WINDOW'S ACTIVE TAB, so the returned data URL
       carries the active tab's id (P-3's wrong-tab hazard is visible in the data);
     - every timer is virtual, so the 550 ms capture floor, the 2500 ms badge
       flash, the 30 s load cap and the 90 s batch job cap are asserted instead of
       waited out.

   Fail-first for a brand-new sim: point FS_BG at a stub worker
   (FS_BG=/tmp/stub.js node test/background-sim.node.js) and the suite goes red —
   proof the checks read the real file's behaviour and not the harness's. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..');
const BG_PATH = process.env.FS_BG || path.join(ROOT, 'background.js');
const BG_SRC = fs.readFileSync(BG_PATH, 'utf8');
/* The shipped manifest and the shipped English message file, read off disk. The
   worker reports one of them in its diagnostic bundle and names keys out of the
   other, and both claims are only worth grading against the real files. */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const EN_MESSAGES = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/en/messages.json'), 'utf8'));

const EXT_ID = 'fullshotsimextensionid';
const EXT_URL = 'chrome-extension://' + EXT_ID + '/';
const RESULT_URL = EXT_URL + 'pages/result.html';
const CONN_ERR = 'Could not establish connection. Receiving end does not exist.';
/* The one key the worker and the popup must agree on. Nothing here asserts the
   spelling for its own sake — every check below round-trips through it. */
const ERR_KEY = 'fsLastError';
/* The sentences the worker is allowed to hand a person, spelled out here rather
   than read back out of background.js — a guard that imports the implementation
   grades the implementation against itself. */
const R_GENERIC = 'The capture stopped before it finished. Please try again.';
const R_NO_START = 'FullShot could not start on this page. Reload the page and try again.';
const R_BLOCKED = 'This page cannot be captured (browser restriction).';
const R_UNKNOWN = 'Unknown message.';
const META = { totalW: 1200, totalH: 2400, vw: 1200, vh: 800, dpr: 1 };
/* The settings keys background.js projects into FS_START for the engine.
   `redactWalkMs` joined the list on 2026-09-02: the redaction walk's time
   budget is now handed to the engine with the rest of the settings instead of
   living only as a constant inside content/capture.js, so that a test can pin
   it and reach the walk's `time` giving-up point without racing the runner.
   -1 is the shipped default and means "the engine's own FS_PII_WALK_MS", so
   nothing about a production capture moved. */
const ENGINE_KEYS = ['captureDelay', 'hideFixed', 'preScroll', 'maxPageHeight', 'expandInner',
  'unrollVirtual', 'expandInteractive', 'loadMore', 'infiniteScroll', 'waitStable',
  'adaptiveWait', 'hideOverlays', 'redactPII', 'redactWalkMs', 'expandFrames'];

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
/* AN UNHANDLED REJECTION IS A FAILED CHECK, NOT A DEAD SUITE. Node has aborted
   the process on one since v15, so a shipped file that rejects with nobody
   listening — a debounced `setTimeout(save, 350)` whose write is refused is
   exactly that shape — takes the whole run down mid-file and prints no summary
   at all, which reads as "the sim is broken" rather than as "this line is".
   Recorded as a check so the red is attributable to the path that caused it,
   and the run carries on to everything after it. Nothing emits this check on a
   clean run: it is a guard, not a measurement. */
process.on('unhandledRejection', reason => {
  check('a promise rejected with nobody listening', false, String((reason && reason.message) || reason));
});

/* A router promise that never settles would otherwise end node silently, with
   no final line at all — turn that into a visible failure. */
const HANG = setTimeout(() => {
  console.log('FAIL  sim hung — a router promise never settled');
  process.exit(1);
}, 60000);

/* ---------------- virtual clock ---------------- */

function makeClock(start) {
  let now = start, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    nextAt() { let at = null; for (const t of timers.values()) if (at == null || t.at < at) at = t.at; return at; },
    tick() {
      const at = this.nextAt();
      if (at == null) return false;
      now = Math.max(now, at);
      for (const pair of Array.from(timers)) {
        if (pair[1].at <= now) { timers.delete(pair[0]); pair[1].fn(); }
      }
      return true;
    }
  };
}

/* Run the worker forward: flush real microtasks, then fire the next virtual
   timer, until nothing is left or the next deadline lies beyond `budget` ms of
   virtual time. The budget is what stops a routine test from accidentally
   firing the 30 s load cap or the 90 s batch job cap. */
async function pump(env, opts) {
  const o = opts || {};
  const deadline = env.clock.now() + (o.budget == null ? 5000 : o.budget);
  for (let i = 0; i < 200000; i++) {
    await new Promise(r => setImmediate(r));
    if (o.until && o.until()) break;
    const at = env.clock.nextAt();
    if (at == null || at > deadline) break;
    env.clock.tick();
  }
  await new Promise(r => setImmediate(r));
}

/* ---------------- the fake chrome ---------------- */

/* A content script answers a message only once the file that provides it has
   actually been injected — real Chrome rejects otherwise, and modelling that is
   what makes the injection assertions real. */
const PROVIDER = {
  FS_START: 'content/capture.js', FS_ABORT: 'content/capture.js',
  FS_REGION_START: 'content/region.js',
  FS_FRAMES_EXPAND: 'content/frame-expand.js', FS_FRAMES_RESTORE: 'content/frame-expand.js'
};

/* chrome.storage takes a key, a list, an object of defaults, or nothing at all. */
function keyList(keys, store) {
  if (keys == null) return Object.keys(store);
  if (Array.isArray(keys)) return keys.slice();
  return typeof keys === 'string' ? [keys] : Object.keys(keys);
}

/* ---------------- the result page, modelled by what it does to the database ----------------
   pages/result.js is the ONLY writer to the `shots` store in the whole product.
   Opened at result.html?id=<captureId> it reads the frames, stitches them, puts
   one `shots` row under that same id, and then deletes the frames and the
   `captures` row (result.js:688-690) — and it produces nothing at all when the
   `captures` row is missing (result.js:177 returns null, no row, no stitch).

   That three-step is the whole of what the worker can observe about it, so it is
   what this fake does. Deliberately NOT a handshake message: a message the page
   sends is a thing the harness invents, and the worker would then be graded
   against the harness's protocol rather than against the artifact a person can
   open. The database is the surface History and the queue's "open" link both
   read, so the database is what the wait has to be on.

   ONLY THE HIDDEN RESULT PAGE IS MODELLED, and that is a statement about what
   this tier grades rather than a convenience. A result tab opened ACTIVE is the
   one the worker hands to the user and lets go of; every check in this file
   reads the database at the moment it let go, so modelling that page's stitch
   would do nothing but race a hundred assertions with an arbitrary timer. The
   hidden one is different in kind: the worker opens it, waits on it, and
   settles a queue row from what it finds — it is part of the worker's own flow,
   so it has to be part of the worker's own model.

   env.stitch is the control the honesty checks need. 'never' is a hidden tab
   that never got round to it — the named risk of opening the result page with
   active:false is exactly that Chrome throttles it — and 'throw' is a stitch
   that died half way. Neither may reach the queue as a job that is done. */
function modelResultPage(env, url) {
  const id = decodeURIComponent(String(url).split('?id=')[1] || '');
  if (!id) return;
  env.clock.setTimeout(() => {
    if (env.stitch === 'never' || !env.db) return;
    if (!env.db.stores.captures.has(id)) return;   // result.js:177 — no row, no stitch
    const frames = Array.from(env.db.stores.frames.values())
      .filter(f => String(f.k).indexOf(id + ':') === 0);
    if (env.stitch === 'throw' || !frames.length) return;
    env.db.stores.shots.set(id, {
      id, title: 'A page', url: 'https://example.com/page', createdAt: env.clock.now(),
      mode: 'full', w: 1200, h: 2400, format: 'png',
      segments: [{ blob: new Blob(['x'.repeat(4096)], { type: 'image/png' }), w: 1200, h: 2400 }]
    });
    frames.forEach(f => env.db.stores.frames.delete(f.k));
    env.db.stores.captures.delete(id);
    env.trace.push('stitched:' + id);
  }, env.stitchMs);
}

function makeEnv(opts) {
  const o = opts || {};
  const clock = makeClock(1750000000000);
  const tabs = new Map();
  let nextTabId = 100;

  const env = {
    clock, tabs,
    trace: [], badges: [], shots: [], injects: [], broadcasts: [], imports: [], starts: [],
    // Every frame record ever written, kept even after the worker deletes it.
    // "What reached the disk" and "what is still there" are different questions,
    // and a cleanup that removes the evidence must not also remove the check.
    framesWritten: [],
    logs: [], network: [], downloads: [], syncGets: [], permQueries: [], permRequests: [], creates: [],
    reads: { keys: [], getAll: [], hasKey: [] },   // which shape the worker asks the database for
    confirms: [],                      // every sentence a page put in front of the user
    blobs: [],                         // every blob a page turned into a download
    sync: Object.assign({}, o.sync || {}), session: {}, local: {},
    granted: o.granted !== false,             // the optional <all_urls> grant
    /* "Allow access to file URLs" is a switch on chrome://extensions, off by
       default, and the only way an extension can ask about it. */
    // Passed through exactly as given, never coerced: a browser that answers the
    // question with nothing is a third state, and which way the worker falls on
    // it is a decision worth being able to grade.
    fileAccess: o.fileAccess === undefined ? true : o.fileAccess,
    /* A locale directory name, or null for a browser with no chrome.i18n at all
       — which is what the popup and this sim have always run against, and what
       every English assertion in this file grades. */
    locale: o.locale || null, i18nAsked: [],
    userAgent: o.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36',
    hasBatchPage: o.hasBatchPage !== false,   // is pages/batch.html listening?
    /* navigator.storage — the API this whole item is asked and answered through.
       estimate() reports what the fake database is ACTUALLY holding, so "how
       much did the sweep free" is measured rather than asserted. `false` models
       a browser that does not offer the API at all, which is a third state and
       not the same as "nothing stored".
       persist() is deliberately absent from the WORKER's navigator further
       down: the platform exposes it to a Window only, which is the entire
       reason the page and not the worker has to be the one that asks. */
    storage: o.storage === false ? null : Object.assign({ quota: 2000000000, persisted: false, grant: true }, o.storage || {}),
    persistCalls: 0,
    newTabStatus: o.newTabStatus || 'complete',
    hooks: o.hooks || {},                     // { capture(n, windowId), inject(tabId, files) }
    script: o.script || null,                 // default behaviour for worker-created tabs
    currentWindowId: 1, idbOpens: 0, listenerSets: [], gen: 0,
    /* Every tab the worker closed, with the url it was showing. The trace only
       ever carried the id, and "how many tabs were closed" stopped being a
       useful question the moment the queue opened a second kind of tab. */
    removes: [],
    /* WHAT THE RESULT PAGE DOES, AS A CONTROL. See modelResultPage below.
       'ok' stitches; 'never' is the hidden tab that never got round to it
       (Chrome throttling a background tab is the named risk of this design);
       'throw' is a stitch that died part way. */
    stitch: o.stitch === undefined ? 'ok' : o.stitch,
    stitchMs: o.stitchMs == null ? 120 : o.stitchMs
  };
  const t = s => { env.trace.push(s); return s; };
  /* What the origin is holding, in bytes, the way a browser would count it: the
     pixels dominate and the rows themselves are rounded to a constant. Derived
     from the store rather than tracked separately, so a delete really does show
     up as space freed and a check cannot pass on a counter nobody decremented. */
  env.usage = () => {
    if (!env.db) return 0;
    let n = 0;
    for (const name of Object.keys(env.db.stores)) {
      for (const rec of env.db.stores[name].values()) {
        if (!rec) continue;
        n += 200;
        if (typeof rec.dataUrl === 'string') n += rec.dataUrl.length;
        if (Array.isArray(rec.segments)) rec.segments.forEach(s => { n += (s && s.blob && s.blob.size) || 0; });
        if (rec.thumb && rec.thumb.size) n += rec.thumb.size;
      }
    }
    return n;
  };
  /* Window and worker get DIFFERENT StorageManagers, because the platform does:
     estimate() and persisted() are exposed to both, persist() only to a Window. */
  env.storageManager = (isWindow) => {
    if (!env.storage) return undefined;
    const api = {
      /* `frozen` is real Chromium's behaviour, not a convenience: IndexedDB
         reclaims lazily and the estimate is padded and cached, so it does not
         move over the second a sweep takes. */
      async estimate() { return { usage: env.storage.frozen ? 1000000 : env.usage(), quota: env.storage.quota }; },
      async persisted() { return !!env.storage.persisted; }
    };
    if (isWindow) {
      api.persist = async () => {
        env.persistCalls++;
        if (env.storage.grant) env.storage.persisted = true;
        return !!env.storage.persisted;
      };
    }
    return api;
  };
  env.mark = () => env.trace.length;
  env.since = m => env.trace.slice(m);
  env.badgesSince = m => env.since(m).filter(s => s.indexOf('badge:') === 0).map(s => s.slice(6));

  function evt() {
    const l = [];
    env.listenerSets.push(l);
    return {
      _l: l,
      addListener: f => l.push(f),
      removeListener: f => { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
      hasListener: f => l.indexOf(f) >= 0
    };
  }
  const onMessage = evt(), onInstalled = evt(), onCommand = evt();
  const onRemoved = evt(), onUpdated = evt();
  env.onMessage = onMessage; env.onInstalled = onInstalled; env.onCommand = onCommand;
  env.onRemoved = onRemoved; env.onUpdated = onUpdated;
  /* MV3 tears the whole worker down; a restart starts from zero listeners.
     Bumping the generation is the other half, and it is what makes a suspension
     check honest: an evicted worker does not keep running. Its pending timers
     never fire again and its half-finished loops never take another step, so a
     `for` loop sitting on an await is simply gone — which is the whole reason a
     queue has to be able to pick itself up from storage rather than from a
     closure. Without this, node would happily carry the dead worker's loop on
     to completion and every check below would pass for the wrong reason. */
  env.suspend = () => { env.listenerSets.forEach(l => l.splice(0, l.length)); env.gen++; };

  const snap = tab => Object.assign({}, tab, { scripts: undefined, script: undefined });
  env.addTab = spec => {
    const id = spec && spec.id != null ? spec.id : nextTabId++;
    const tab = Object.assign({
      id, index: 0, windowId: 1, url: 'https://example.com/page', title: 'Example page',
      active: true, status: 'complete'
    }, spec || {}, { id, scripts: [], script: (spec && spec.script) || null, frameResponses: [] });
    tabs.set(id, tab);
    return tab;
  };
  /* Exactly one tab is active per window. Clicking another tab is how the
     wrong-tab hazard actually happens, so model the switch rather than fake it. */
  env.activate = id => {
    const tab = tabs.get(id);
    if (!tab) throw new Error('no tab with id ' + id);
    tabs.forEach(x => { if (x.windowId === tab.windowId) x.active = (x === tab); });
    return tab;
  };
  /* Dragging a tab out into a window of its own keeps its id — which is exactly
     why an id-only check is not a check at all. */
  env.moveToWindow = (id, windowId) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error('no tab with id ' + id);
    tab.windowId = windowId;
    tabs.forEach(x => { if (x.windowId === windowId) x.active = (x === tab); });
    return tab;
  };
  env.senderTab = tab => ({ id: EXT_ID, url: tab.url, frameId: 0, tab: snap(tab) });
  env.fromPage = p => ({ id: EXT_ID, url: EXT_URL + (p || 'popup/popup.html') });

  /* Deliver a message to the worker's router and resolve with its response.
     A listener that returns true keeps the channel open for a later
     sendResponse; one that does not gets the channel closed under it. */
  env.send = (msg, sender) => new Promise(resolve => {
    let replied = false, keepOpen = false;
    const respond = v => { if (!replied) { replied = true; resolve(v); } };
    onMessage._l.slice().forEach(fn => { if (fn(msg, sender || env.fromPage(), respond) === true) keepOpen = true; });
    if (!keepOpen && !replied) resolve(undefined);
  });

  /* The scripted content script. Mirrors content/capture.js: it answers FS_START
     immediately and then drives frames on its own, so the worker really does go
     idle between messages the way it does in the browser. */
  function driveFrames(tab, beh) {
    const n = beh.frames == null ? 3 : beh.frames;
    (async () => {
      for (let i = 0; i < n; i++) {
        // The seam a human reaches into: this is where they click another tab,
        // and the worker has to notice before it takes the next shot.
        if (beh.beforeFrame) beh.beforeFrame(i, tab);
        const resp = await env.send({ type: 'FS_FRAME', index: i, total: n, x: 0, y: i * 800 }, env.senderTab(tab));
        tab.frameResponses.push(resp);
        if (!resp || !resp.ok) {                  // capture.js throws -> FS_ERROR
          await env.send({ type: 'FS_ERROR', error: (resp && resp.error) || 'Frame capture failed' }, env.senderTab(tab));
          return;
        }
      }
      await env.send({ type: 'FS_DONE', meta: beh.meta || META }, env.senderTab(tab));
    })().catch(e => { tab.driveError = String((e && e.message) || e); });
  }

  function deliver(tab, msg) {
    const beh = tab.script || {};
    if (msg.type === 'FS_START') {
      if (beh.onStart === 'decline') return false;             // capturing already -> no response
      if (beh.onStart === 'throw') throw new Error(beh.throwMessage || 'receiving end blew up');
      if (beh.onStart === 'error') {
        clock.setTimeout(() => env.send({ type: 'FS_ERROR', error: beh.error || 'engine exploded' }, env.senderTab(tab)), 10);
      } else if (beh.onStart !== 'silent') {
        clock.setTimeout(() => driveFrames(tab, beh), 10);
      }
      return { ok: true };
    }
    if (msg.type === 'FS_REGION_START') {
      tab.regionPick = msg.pick;
      if (beh.region === 'select') {
        clock.setTimeout(() => env.send({
          type: 'FS_REGION_SELECTED', rect: beh.rect || { x: 10, y: 20, w: 300, h: 200 }, dpr: beh.dpr || 2
        }, env.senderTab(tab)), 10);
      } else if (beh.region === 'cancel') {
        clock.setTimeout(() => env.send({ type: 'FS_REGION_CANCEL' }, env.senderTab(tab)), 10);
      }
      return { ok: true };
    }
    return { ok: true };
  }

  /* The real message file for the locale under test. Chrome answers an unknown
     key with the EMPTY STRING rather than throwing, and that is the behaviour
     every fallback in the product is written against — so a key the worker
     spells wrong degrades to English here exactly as it would in the browser,
     and the check that grades the Hindi sentence is the one that catches it. */
  let catalogue = null;
  function i18nFake() {
    if (!env.locale) return undefined;   // a browser with no chrome.i18n at all
    return {
      getMessage(key, subs) {
        env.i18nAsked.push(key);
        if (key === '@@ui_locale') return env.locale;
        if (!catalogue) catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', env.locale, 'messages.json'), 'utf8'));
        const row = catalogue[key];
        if (!row) return '';
        let text = String(row.message);
        const names = Object.keys(row.placeholders || {});
        (subs || []).forEach((v, i) => { if (names[i]) text = text.split('$' + names[i].toUpperCase() + '$').join(String(v)); });
        return text;
      }
    };
  }

  const chromeFake = {
    i18n: i18nFake(),
    /* The two chrome.extension members MV3 kept. isAllowedFileSchemeAccess is
       the only way to know about the file:// switch before trying the page. */
    extension: { async isAllowedFileSchemeAccess() { t('fileAccess?'); return env.fileAccess; } },
    runtime: {
      id: EXT_ID,
      getURL: p => EXT_URL + p,
      getManifest: () => JSON.parse(JSON.stringify(MANIFEST)),
      onMessage, onInstalled,
      sendMessage(msg) {
        t('bcast:' + (msg && msg.type));
        env.broadcasts.push(JSON.parse(JSON.stringify(msg)));
        return env.hasBatchPage ? Promise.resolve(undefined) : Promise.reject(new Error(CONN_ERR));
      }
    },
    tabs: {
      onRemoved, onUpdated,
      async get(id) {
        t('tab.get:' + id);
        const tab = tabs.get(id);
        if (!tab) throw new Error('No tab with id: ' + id + '.');
        return snap(tab);
      },
      async query(q) {
        t('tab.query');
        return Array.from(tabs.values()).filter(x =>
          (q.active == null || x.active === !!q.active) &&
          (!q.currentWindow || x.windowId === env.currentWindowId) &&
          (q.windowId == null || x.windowId === q.windowId)).map(snap);
      },
      async create(props) {
        if (env.hooks.createTab) {
          // A rejected create makes no tab at all — but "did the worker try to
          // open the result page?" is still a question, so record the attempt.
          const e = env.hooks.createTab(props);
          if (e) { t('tab.create!:' + props.url); throw (e instanceof Error ? e : new Error(String(e))); }
        }
        const active = props.active !== false;
        const tab = env.addTab({
          url: props.url, title: '', windowId: env.currentWindowId, active,
          index: props.index == null ? tabs.size : props.index,
          status: props.url && props.url.indexOf(EXT_URL) === 0 ? 'complete' : env.newTabStatus,
          script: env.script
        });
        if (active) tabs.forEach(x => { if (x !== tab && x.windowId === tab.windowId) x.active = false; });
        t('tab.create:' + props.url);
        env.creates.push({ url: props.url, index: props.index, active });
        if (!active && String(props.url || '').indexOf(RESULT_URL + '?id=') === 0) modelResultPage(env, props.url);
        /* THE TAB THIS ANSWERS WITH HAS NO URL YET, and that is Chrome, not a
           convenience. The navigation cannot have committed in the turn that
           asked for it, so the Tab that comes back carries `pendingUrl` and an
           EMPTY `url` — verified in Chromium (test/e2e/batch-artifact.mjs).
           The fake used to answer with the url already in place, which made a
           caller that reuses this snapshot look correct here and fail in every
           real browser: `isRestricted('')` is TRUE, so a stale snapshot is
           refused as a page the browser protects. The stored tab keeps the real
           url, so tabs.get answers properly — re-reading is the whole point. */
        return Object.assign(snap(tab), { url: '', pendingUrl: props.url, status: 'loading' });
      },
      async remove(id) {
        t('tab.remove:' + id);
        if (!tabs.has(id)) throw new Error('No tab with id: ' + id + '.');
        env.removes.push({ id, url: tabs.get(id).url });
        tabs.delete(id);
        onRemoved._l.slice().forEach(f => f(id, { windowId: env.currentWindowId, isWindowClosing: false }));
      },
      async captureVisibleTab(windowId) {
        env.shots.push({ windowId, at: clock.now() });
        t('shot:w' + windowId);
        if (env.hooks.capture) {
          const e = env.hooks.capture(env.shots.length, windowId);
          if (e) throw (e instanceof Error ? e : new Error(String(e)));
        }
        // captureVisibleTab photographs the window's ACTIVE tab, whichever it is.
        const act = Array.from(tabs.values()).find(x => x.windowId === windowId && x.active);
        return 'data:image/png;base64,SHOT' + env.shots.length + '@tab' + (act ? act.id : 'none');
      },
      sendMessage(id, msg) {
        t('msg>' + id + ':' + msg.type);
        if (msg.type === 'FS_START') env.starts.push(msg);
        /* Real Chrome answers this over a round trip: "Receiving end does not
           exist" comes back LATER, never on the same turn. Modelling that delay
           is the only way to reach the seam where a capture is still inside its
           own try while a NEWER capture has already started in the same tab —
           the staleness startCapture's catch already guards against before it
           drops frames (its `live` check), and the reason a mark has to belong
           to a capture rather than to a tab. */
        if (env.hooks.sendMessage) {
          const plan = env.hooks.sendMessage(id, msg);
          if (plan && plan.rejectAfter != null) {
            return new Promise((_, rej) => clock.setTimeout(
              () => rej(new Error(plan.error || CONN_ERR)), plan.rejectAfter));
          }
        }
        const tab = tabs.get(id);
        if (!tab) return Promise.reject(new Error(CONN_ERR));
        const need = PROVIDER[msg.type];
        if (need && tab.scripts.indexOf(need) < 0) return Promise.reject(new Error(CONN_ERR));
        try {
          const r = deliver(tab, msg);
          // A receiver that returns false closes the channel: the promise
          // resolves with undefined, it does NOT reject. This is the semantic
          // that makes a declined FS_START look like a success to the worker.
          return Promise.resolve(r === false ? undefined : r);
        } catch (e) { return Promise.reject(e); }
      }
    },
    scripting: {
      async executeScript(inj) {
        const tabId = inj.target.tabId;
        const files = inj.files || [];
        files.forEach(f => t('inject:' + tabId + ':' + f + (inj.target.allFrames ? ':allFrames' : '')));
        env.injects.push({ tabId, files, allFrames: !!inj.target.allFrames });
        if (env.hooks.inject) {
          const e = env.hooks.inject(tabId, files);
          if (e) throw (e instanceof Error ? e : new Error(String(e)));
        }
        const tab = tabs.get(tabId);
        if (!tab) throw new Error('No tab with id: ' + tabId + '.');
        if (tab.blockInject) {
          throw new Error('Cannot access contents of the page at "' + tab.url +
            '". Extension manifest must request permission to access this host.');
        }
        files.forEach(f => { if (tab.scripts.indexOf(f) < 0) tab.scripts.push(f); });
        return [{ frameId: 0, result: null }];
      }
    },
    permissions: {
      async contains(q) {
        t('perm.contains:' + (q.origins || []).join(','));
        env.permQueries.push(q);
        if (env.hooks.permissionThrows) throw new Error('permissions unavailable');
        return !!env.granted;
      },
      async request() { throw new Error('the worker must never request a permission itself'); }
    },
    storage: {
      sync: {
        async get(keys) {
          t('sync.get');
          const list = keyList(keys, env.sync);
          env.syncGets.push(list.slice());
          const out = {};
          // The object form supplies defaults for keys that were never stored.
          if (keys && typeof keys === 'object' && !Array.isArray(keys)) Object.assign(out, keys);
          list.forEach(k => { if (k in env.sync) out[k] = env.sync[k]; });
          return out;
        },
        async set(obj) { t('sync.set:' + Object.keys(obj).join(',')); Object.assign(env.sync, obj); }
      },
      /* Dies with the browser and never syncs — the surface P-2 parks the last
         failure in and the popup reads back out of. */
      session: {
        async get(keys) { const out = {}; keyList(keys, env.session).forEach(k => { if (k in env.session) out[k] = env.session[k]; }); return out; },
        async set(obj) { t('session.set:' + Object.keys(obj).join(',')); Object.assign(env.session, obj); },
        async remove(keys) {
          t('session.remove:' + [].concat(keys).join(','));
          [].concat(keys).forEach(k => { delete env.session[k]; });
        }
      },
      local: {
        async get() { return Object.assign({}, env.local); },
        async set(obj) { Object.assign(env.local, obj); }
      }
    },
    action: {
      async setBadgeText(o2) { env.badges.push({ text: o2.text, at: clock.now() }); t('badge:' + o2.text); },
      async setBadgeBackgroundColor(o2) { t('badgecolor:' + o2.color); }
    },
    commands: { onCommand, async getAll() { t('commands.getAll'); return []; } },
    downloads: { async download(d) { t('download:' + d.filename); env.downloads.push(d); return 1; } },
    windows: { async get(id) { t('window.get:' + id); return { id, focused: true }; } }
  };
  env.chrome = chromeFake;
  return env;
}

/* ---------------- boot the real worker ---------------- */

const RealDate = Date;
function makeDb(frameKey, env) {
  const stores = { frames: new Map(), captures: new Map(), shots: new Map() };
  const pfx = id => id + ':';
  const api = {
    async put(store, value) {
      env.trace.push('db.put:' + store + ':' + (value.id || value.k));
      if (env.hooks.dbPut) {
        // An IndexedDB write really does fail — quota, an aborted transaction,
        // a store the browser killed under a suspended worker — and a capture
        // that dies between writing a frame and sealing its `captures` row is
        // the exact shape of an orphan.
        const e = env.hooks.dbPut(store, value);
        if (e) throw (e instanceof Error ? e : new Error(String(e)));
      }
      if (store === 'frames') env.framesWritten.push(value);
      stores[store].set(value.id || value.k, value);
    },
    async get(store, key) { return stores[store].get(key); },
    /* Existence without the record. A `shots` row is an entire screenshot —
       segment blobs and a thumbnail — and the batch runner asks this question
       once a quarter second while it waits for one to appear, so counting it
       separately from get() is what keeps that wait honest about its cost. */
    async hasKey(store, key) { env.reads.hasKey.push(store); return stores[store].has(key); },
    /* Counted on env rather than pushed into the trace: these two are the
       READING half, they say nothing about what the worker did, and the
       ordering checks elsewhere in this file read the trace positionally. */
    async getAll(store) { env.reads.getAll.push(store); return Array.from(stores[store].values()); },
    /* KEYS, not records. A sweep that asked getAll('frames') would pull every
       screenshot in the database through memory just to read the ids off the
       front of the keys — counted separately so the difference is gradable. */
    async keys(store) {
      env.reads.keys.push(store);
      /* A database that will not answer at all. Both counting doors read this,
         and both used to turn its silence into a confident zero. */
      if (env.hooks.dbKeys) {
        const e = env.hooks.dbKeys(store);
        if (e) throw (e instanceof Error ? e : new Error(String(e)));
      }
      return Array.from(stores[store].keys());
    },
    async delete(store, key) {
      env.trace.push('db.del:' + store + ':' + key);
      /* A DELETE FAILS TOO, and until now nothing here could say so. An
         IndexedDB transaction aborts for reasons that have nothing to do with
         the caller — a store the browser killed under a suspended worker, a
         connection closing, a version change landing mid-turn — and the whole
         point of the sweep is that it is the user's only door to rows no page
         can show them. A door that reports success on a locked lock is worse
         than no door. */
      if (env.hooks.dbDelete) {
        const e = env.hooks.dbDelete(store, key);
        if (e) throw (e instanceof Error ? e : new Error(String(e)));
      }
      stores[store].delete(key);
    },
    async clearAll() {
      env.trace.push('db.clearall');
      Object.keys(stores).forEach(s => stores[s].clear());
      return true;
    },
    frameKey,
    async getFrames(id) {
      return Array.from(stores.frames.values()).filter(f => String(f.k).indexOf(pfx(id)) === 0)
        .sort((a, b) => a.index - b.index);
    },
    async deleteFrames(id) {
      env.trace.push('db.delframes:' + id);
      if (env.hooks.dbDeleteFrames) {
        const e = env.hooks.dbDeleteFrames(id);
        if (e) throw (e instanceof Error ? e : new Error(String(e)));
      }
      Array.from(stores.frames.keys()).forEach(k => { if (String(k).indexOf(pfx(id)) === 0) stores.frames.delete(k); });
    },
    async getShotsNewestFirst() { return Array.from(stores.shots.values()).sort((a, b) => b.createdAt - a.createdAt); }
  };
  return { stores, api };
}

/* Everything an EVICTED worker still holds a reference to has to stop working,
   or the sim is modelling node rather than Chrome. Two doors, and both are
   real: a chrome call from a dead worker throws the context-invalidated error
   the browser really raises, and a timer it scheduled never fires at all
   (Chrome does not resurrect a worker to run its setTimeout — that is the
   single most common way an MV3 extension loses work). */
const DEAD = 'Extension context invalidated.';
function genScoped(env, gen, obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'function') {
      // Looked up on the ORIGINAL object at CALL time, never captured: several
      // checks swap a chrome method out after the worker has booted, and a copy
      // taken at boot would quietly ignore them.
      out[k] = function () { if (env.gen !== gen) throw new Error(DEAD); return obj[k].apply(obj, arguments); };
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = genScoped(env, gen, v);
    } else out[k] = v;
  }
  return out;
}

function boot(env) {
  const clock = env.clock;
  const gen = env.gen;
  function FakeDate(a) { return arguments.length ? new RealDate(a) : new RealDate(clock.now()); }
  FakeDate.now = () => clock.now();
  FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;

  const sandbox = {
    console: {
      log() {}, info() {}, debug() {},
      warn() { env.logs.push(Array.from(arguments).map(String).join(' ')); },
      error() { env.logs.push(Array.from(arguments).map(x => String((x && x.message) || x)).join(' ')); }
    },
    setTimeout: (fn, ms) => clock.setTimeout(() => { if (env.gen === gen) fn(); }, ms),
    clearTimeout: id => clock.clearTimeout(id),
    setInterval() { throw new Error('the worker must not poll with setInterval'); },
    Date: FakeDate,
    chrome: genScoped(env, gen, env.chrome),
    /* A service worker has a navigator, and it is the only thing in reach that
       can name the browser for a diagnostic bundle. Deliberately the full,
       ordinary user-agent string: the point of the bundle checks is that what
       comes OUT of it is a name and a number, whatever went in.
       Its StorageManager is the WORKER's one: estimate() and persisted() are
       there, persist() is not, because the platform only exposes that to a
       Window. A worker that reached for it would find undefined. */
    navigator: { userAgent: env.userAgent, storage: env.storageManager(false) },
    /* Real importScripts: the shipped files must parse and must not touch
       IndexedDB at load time. FSDB's storage layer is swapped out below. */
    importScripts() {
      Array.from(arguments).forEach(f => {
        env.imports.push(f);
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
      });
    },
    fetch() { env.network.push('fetch'); throw new Error('zero-network doctrine: no fetch in the worker'); },
    XMLHttpRequest() { env.network.push('xhr'); throw new Error('zero-network doctrine: no XHR in the worker'); },
    WebSocket() { env.network.push('ws'); throw new Error('zero-network doctrine: no sockets in the worker'); },
    indexedDB: { open() { env.idbOpens++; throw new Error('the sim swaps FSDB; nothing else may open IDB'); } }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BG_SRC, sandbox, { filename: 'background.js' });

  const realFSDB = sandbox.FSDB || {};
  const realFrameKey = realFSDB.frameKey || ((c, i) => c + ':' + i);
  /* IndexedDB is DURABLE — it is the one thing that survives the worker being
     torn down, which is the whole reason a half-finished capture leaves frames
     behind. A restart that handed the worker an empty database would model the
     opposite of what MV3 does, and would make every suspension check below
     pass for the wrong reason. */
  env.db = env.db || makeDb(realFrameKey, env);
  /* ONLY THE STORAGE LAYER IS FAKED. Everything in pages/db.js that is a
     decision rather than a database call is the REAL function, carried across
     the swap: which rows are orphans, how a frame key names its capture,
     whether an exception is the disk being full, and the two platform queries
     that read the navigator this sandbox supplies. A sim that stubbed those
     would grade the stub — the same reason frameKey has always come across. */
  for (const name of ['frameKey', 'stores', 'captureOfFrameKey', 'planSweep', 'isQuotaError', 'estimate', 'persisted', 'persist']) {
    if (realFSDB[name] !== undefined) env.db.api[name] = realFSDB[name];
  }
  /* The worker's VIEW of the database dies with the worker, like every other
     door it holds: an evicted worker's half-finished promise chain does not get
     to carry on writing to IndexedDB. Found by a check rather than reasoned out
     in advance — the dead worker's sweep deleted the frames the NEW worker had
     just adopted, in node, because a plain object survives what Chrome would
     have torn down. The page gets its own, un-scoped view further down, which
     is also the truth: a page outlives the worker. */
  sandbox.FSDB = genScoped(env, gen, env.db.api);
  env.sandbox = sandbox;
  return sandbox;
}

function newEnv(opts) { const env = makeEnv(opts); boot(env); return env; }
/* Chrome evicts an idle service worker and starts a fresh one on the next
   event: listeners gone, module scope re-run, storage and IndexedDB untouched.
   That is the whole of it, and it is what every "MV3 lifetime" check below
   drives — usually from INSIDE the frame loop, because between two frames is
   exactly where the real thing happens. */
function restart(env) { env.suspend(); boot(env); }

/* ---------------- the popup, loaded for real ---------------- */

/* A parked failure only counts once a human can read it, so the round trip is
   graded end to end: the REAL worker writes the note into the fake session
   store and the REAL popup reads it back out of that same store, over the same
   fake chrome. The element tree is deliberately thin — every id the popup asks
   for is created on demand and then checked against the shipped popup.html, so
   a renamed element is a red check instead of a runtime null. */
const POPUP_PATH = process.env.FS_POPUP || path.join(ROOT, 'popup/popup.js');
const POPUP_SRC = fs.readFileSync(POPUP_PATH, 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
const POPUP_MODES = (POPUP_HTML.match(/data-mode="([^"]+)"/g) || []).map(s => s.slice(11, -1));
/* Whatever the shipped html nests inside #err is what the user actually reads. */
const ERR_BLOCK = (/<div id="err"[\s\S]*?<\/div>/.exec(POPUP_HTML) || [''])[0];
const ERR_PARTS = (ERR_BLOCK.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1));

function makeEl(id, tagName) {
  const el = {
    id: id || '', tagName: tagName || 'DIV', className: '', hidden: false,
    textContent: '', value: '', checked: false, dataset: {}, listeners: {},
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    async dispatch(type, ev) {
      const fns = (el.listeners[type] || []).slice();
      for (const fn of fns) await fn(Object.assign({ target: el, preventDefault() {} }, ev || {}));
    }
  };
  return el;
}

function makeDoc() {
  const els = new Map();
  const asked = [];
  const modes = POPUP_MODES.map(m => {
    const b = makeEl('', 'BUTTON');
    b.className = 'mode'; b.dataset.mode = m;
    return b;
  });
  return {
    _asked: asked, _modes: modes,
    _get: id => els.get(id),
    documentElement: { dataset: {} },
    getElementById(id) {
      if (asked.indexOf(id) < 0) asked.push(id);
      if (!els.has(id)) {
        const el = makeEl(id, id === 'delaySel' ? 'SELECT' : 'BUTTON');
        // A box the shipped html starts hidden must start hidden here too,
        // or "the popup shows the failure" passes without anything showing it.
        const tag = new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>', 'i').exec(POPUP_HTML);
        el.hidden = !!(tag && /\shidden[\s>]/.test(tag[0]));
        els.set(id, el);
      }
      return els.get(id);
    },
    querySelectorAll(sel) { return sel === '.mode' ? modes.slice() : []; }
  };
}

/* The popup is an extension page: runtime.sendMessage reaches the worker's
   router, and permissions.request is its own to make (the worker's must not). */
function popupChrome(env) {
  return {
    runtime: {
      id: EXT_ID,
      getURL: p => EXT_URL + p,
      sendMessage: msg => env.send(msg, env.fromPage('popup/popup.html')),
      openOptionsPage: async () => { env.trace.push('popup:options'); }
    },
    tabs: { query: env.chrome.tabs.query, create: env.chrome.tabs.create },
    storage: env.chrome.storage,
    permissions: {
      contains: env.chrome.permissions.contains,
      request: async q => { env.permRequests.push(q); return true; }
    }
  };
}

async function bootPopup(env) {
  const doc = makeDoc();
  const state = { closed: false };
  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    document: doc,
    matchMedia: q => ({ matches: false, media: q }),
    chrome: popupChrome(env),
    setTimeout: (fn, ms) => env.clock.setTimeout(fn, ms),
    clearTimeout: id => env.clock.clearTimeout(id),
    close: () => { state.closed = true; },
    fetch() { env.network.push('fetch'); throw new Error('zero-network doctrine: no fetch in the popup'); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(POPUP_SRC, sandbox, { filename: 'popup/popup.js' });
  await pump(env, { budget: 2000 });
  const box = () => doc._get('err') || {};
  return {
    doc, sandbox,
    shown: () => box().hidden === false,
    text: () => ERR_PARTS.map(id => (doc._get(id) || {}).textContent || '').join(' ').trim(),
    closed: () => state.closed,
    click: async id => { await doc.getElementById(id).dispatch('click'); await pump(env, { budget: 12000 }); },
    mode: async m => {
      const b = doc._modes.filter(x => x.dataset.mode === m)[0];
      if (!b) throw new Error('popup.html has no ' + m + ' button');
      await b.dispatch('click');
      await pump(env, { budget: 12000 });
    }
  };
}

/* ---------------- the options page, loaded for real ---------------- */

/* The data lifecycle is a WORKER feature with a PAGE for a face, and neither
   half is worth grading alone: the worker can wipe a database nobody asked it
   to wipe, and the page can promise a deletion it never sends. So the shipped
   pages/options.js runs here for real, over the shipped pages/common.js, against
   the same fake chrome and the same fake database the worker is using — its
   runtime.sendMessage reaches the real router, and what it writes into
   IndexedDB is what the worker reads back out.

   The document is a thin fake built FROM pages/options.html: every element the
   page asks for is the one the markup actually declares (tag, type, hidden), so
   a renamed id is a red check rather than a runtime null, and the i18n pass
   walks the real keys.

   confirm() is the piece this item turns on. It is recorded rather than
   answered by default, because "what exactly did the user agree to" is the
   whole of check 2 — a delete-everything button whose confirmation does not
   name what it destroys is the bug, not the dialog. */
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'pages/options.html'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(path.join(ROOT, 'pages/options.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(ROOT, 'pages/common.js'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'pages/db.js'), 'utf8');

function optAttrs(s) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
  return out;
}

/* Every opening tag in the shipped markup, in document order. No parser and
   none needed: this product's html is hand-written and the walker in
   test/i18n-sim.node.js reads it the same way. */
function optTags(html) {
  const out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ');
  while ((m = re.exec(clean))) out.push({ tag: m[1].toLowerCase(), attrs: optAttrs(m[2] || '') });
  return out;
}

function makeOptEl(doc, tag, attrs) {
  const a = Object.assign({}, attrs || {});
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: a.id || '', type: a.type || '', attrs: a,
    textContent: '', value: '', checked: false, disabled: false,
    hidden: 'hidden' in a, children: [], listeners: {}, style: {},
    dataset: {},
    classList: {
      _s: new Set(String(a.class || '').split(/\s+/).filter(Boolean)),
      add(c) { el.classList._s.add(c); }, remove(c) { el.classList._s.delete(c); },
      contains(c) { return el.classList._s.has(c); },
      toggle(c, on) { if (on === undefined ? el.classList._s.has(c) : !on) el.classList._s.delete(c); else el.classList._s.add(c); }
    },
    getAttribute(n) { const k = String(n).toLowerCase(); return k in el.attrs ? el.attrs[k] : null; },
    setAttribute(n, v) { el.attrs[String(n).toLowerCase()] = String(v); },
    hasAttribute(n) { return String(n).toLowerCase() in el.attrs; },
    removeAttribute(n) { delete el.attrs[String(n).toLowerCase()]; },
    appendChild(c) { el.children.push(c); return c; },
    querySelector() { return null; },
    focus() { doc.activeElement = el; },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    async dispatch(type, ev) {
      for (const fn of (el.listeners[type] || []).slice()) {
        await fn(Object.assign({ target: el, key: '', preventDefault() {} }, ev || {}));
      }
    }
  };
  return el;
}

function makeOptionsDoc() {
  const doc = { readyState: 'loading', activeElement: null, listeners: {}, _asked: [] };
  const byId = new Map();
  const all = [];
  for (const spec of optTags(OPTIONS_HTML)) {
    const el = makeOptEl(doc, spec.tag, spec.attrs);
    all.push(el);
    if (el.id && !byId.has(el.id)) byId.set(el.id, el);
  }
  doc.documentElement = makeOptEl(doc, 'html', {});
  doc.body = makeOptEl(doc, 'body', {});
  doc.getElementById = id => {
    if (doc._asked.indexOf(id) < 0) doc._asked.push(id);
    // Created on demand, exactly like the popup harness: an id the page asks
    // for and the markup does not declare is a check, not a crash.
    if (!byId.has(id)) { const el = makeOptEl(doc, 'div', { id }); byId.set(id, el); all.push(el); }
    return byId.get(id);
  };
  doc.createElement = tag => makeOptEl(doc, tag, {});
  doc.querySelectorAll = sel => (sel === '[data-i18n], [data-i18n-attr]'
    ? all.filter(e => 'data-i18n' in e.attrs || 'data-i18n-attr' in e.attrs) : []);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.removeEventListener = (type, fn) => {
    const l = doc.listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  };
  doc._fire = async (type, ev) => {
    for (const fn of (doc.listeners[type] || []).slice()) await fn(Object.assign({ preventDefault() {} }, ev || {}));
  };
  doc._all = all;
  return doc;
}

/* An extension page: runtime.sendMessage reaches the worker's router, and the
   downloads permission is the page's to spend (the worker's never is). */
function pageChrome(env) {
  return {
    i18n: env.chrome.i18n,
    runtime: {
      id: EXT_ID,
      getURL: p => EXT_URL + p,
      getManifest: env.chrome.runtime.getManifest,
      sendMessage: msg => env.send(msg, env.fromPage('pages/options.html')),
      openOptionsPage: async () => { env.trace.push('page:options'); }
    },
    storage: env.chrome.storage,
    downloads: env.chrome.downloads,
    permissions: {
      contains: env.chrome.permissions.contains,
      request: async q => { env.permRequests.push(q); return true; }
    }
  };
}

async function bootOptions(env, opts) {
  const o = opts || {};
  const doc = makeOptionsDoc();
  const answers = Object.assign({}, o.confirm || {});   // substring -> true/false
  const sandbox = {
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    document: doc,
    matchMedia: q => ({ matches: false, media: q }),
    chrome: pageChrome(env),
    navigator: { userAgent: env.userAgent, storage: env.storageManager(true) },
    setTimeout: (fn, ms) => env.clock.setTimeout(fn, ms),
    clearTimeout: id => env.clock.clearTimeout(id),
    Date: env.sandbox.Date,
    Blob, URL: { createObjectURL: b => { env.blobs.push(b); return 'blob:fake/' + env.blobs.length; }, revokeObjectURL() {} },
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    /* Recorded, then answered by the table the check supplied. Default NO:
       a destructive button whose test forgot to say yes must not destroy
       anything, or the confirmation is being graded by its absence. */
    confirm: text => {
      env.confirms.push(String(text));
      for (const key of Object.keys(answers)) if (String(text).indexOf(key) >= 0) return !!answers[key];
      return !!answers['*'];
    },
    fetch() { env.network.push('fetch'); throw new Error('zero-network doctrine: no fetch on a page'); }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DB_SRC, sandbox, { filename: 'pages/db.js' });
  /* Same swap as the worker's, and the same rule: the storage layer is the
     fake, the decisions are the shipped file. Its own copy, so the page's
     StorageManager (which HAS persist) cannot leak into the worker's. */
  const realFSDB = sandbox.FSDB || {};
  const pageFSDB = Object.assign({}, env.db.api);
  for (const name of ['frameKey', 'stores', 'captureOfFrameKey', 'planSweep', 'isQuotaError', 'estimate', 'persisted', 'persist']) {
    if (realFSDB[name] !== undefined) pageFSDB[name] = realFSDB[name];
  }
  sandbox.FSDB = pageFSDB;
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'pages/common.js' });
  vm.runInContext(OPTIONS_SRC, sandbox, { filename: 'pages/options.js' });
  await doc._fire('DOMContentLoaded');
  await pump(env, { budget: o.budget == null ? 12000 : o.budget });
  return {
    doc, sandbox, answers,
    el: id => doc.getElementById(id),
    text: id => String(doc.getElementById(id).textContent || ''),
    /* A real click FOCUSES the control it lands on, and one of these buttons
       hides itself as its own outcome — where focus goes next is a check, so the
       harness has to put it somewhere first. */
    click: async id => {
      const el = doc.getElementById(id);
      doc.activeElement = el;
      await el.dispatch('click');
      await pump(env, { budget: 30000 });
    },
    set: async (id, value) => {
      const el = doc.getElementById(id);
      if (typeof value === 'boolean') el.checked = value; else el.value = value;
      await el.dispatch(el.type === 'text' || el.type === 'number' ? 'input' : 'change');
      await pump(env, { budget: 30000 });
    }
  };
}

/* ---------------- test-side conveniences ---------------- */

async function startCapture(env, tabId, mode, startDelay, budget) {
  const p = env.send({ type: 'START_CAPTURE', tabId, mode, startDelay: startDelay || 0 }, env.fromPage());
  await pump(env, { budget: budget == null ? 12000 : budget });
  return p;
}
const framesOf = env => Array.from(env.db.stores.frames.values()).sort((a, b) => a.index - b.index);
const capturesOf = env => Array.from(env.db.stores.captures.values());
/* A missing record has to read as a failed check, not a node stack trace: a
   half-broken worker still owes the next agent a readable red list. */
const at = (l, i) => (l && l[i] != null ? l[i] : {});
const tail = l => at(l, (l || []).length - 1);
const fire = (e, ...a) => (e._l[0] ? e._l[0](...a) : undefined);
const jobsOf = env => (tail(env.broadcasts).batch || {}).jobs || [];
/* The queue opens two kinds of tab per url now — the page being captured, and
   the hidden result page that turns its frames into a screenshot — so "how many
   tabs" stopped being a question with one answer. Every count below says which. */
const jobCreates = env => env.creates.filter(c => c.url.indexOf(RESULT_URL) !== 0);
const jobRemoves = env => env.removes.filter(r => r.url.indexOf(RESULT_URL) !== 0);
/* The disk being full, as the platform really reports it: a DOMException whose
   NAME is the contract and whose message is the browser's own prose, in the
   browser's own language. Shared, because two sections drive it. */
const quotaError = (message) => {
  const e = new Error(message || 'Quota exceeded.');
  e.name = 'QuotaExceededError';
  return e;
};

/* ================= main ================= */

(async () => {
  /* ================= boot ================= */
  console.log('\n=== boot ===');
  {
    const env = newEnv();
    check('imports the two shipped worker libraries, db first',
      env.imports.join(',') === 'pages/db.js,pages/batch.js', env.imports.join(','));
    check('real FSBatch pure core is live in the worker',
      !!(env.sandbox.FSBatch && env.sandbox.FSBatch.fsNextJob), typeof env.sandbox.FSBatch);
    check('real FSDB frameKey survives the storage swap',
      env.db.api.frameKey('abc', 7) === 'abc:00007', env.db.api.frameKey('abc', 7));
    check('registers exactly one runtime.onMessage router', env.onMessage._l.length === 1, env.onMessage._l.length);
    check('registers onInstalled / onCommand / onRemoved / onUpdated once each',
      env.onInstalled._l.length === 1 && env.onCommand._l.length === 1 &&
      env.onRemoved._l.length === 1 && env.onUpdated._l.length === 1,
      [env.onInstalled._l.length, env.onCommand._l.length, env.onRemoved._l.length, env.onUpdated._l.length].join('/'));
    check('a worker wake is side-effect free (no badge, no storage, no tab touched)',
      env.trace.length === 0, JSON.stringify(env.trace));
    check('nothing opens IndexedDB at load', env.idbOpens === 0, env.idbOpens);
    // MV3 kills the worker; a restart must re-register from zero. Vehicle for P-4.
    env.suspend();
    check('after suspend every listener is gone', env.onMessage._l.length === 0, env.onMessage._l.length);
    boot(env);
    check('a restarted worker re-registers its router', env.onMessage._l.length === 1, env.onMessage._l.length);
  }

  /* ================= zero network ================= */
  console.log('\n=== zero network ===');
  {
    const env = newEnv();
    const tab = env.addTab({ script: { frames: 1 } });
    await startCapture(env, tab.id, 'full');
    check('a whole capture makes no fetch/XHR/socket call', env.network.length === 0, JSON.stringify(env.network));
    check('every importScripts target is a packaged relative path',
      env.imports.every(f => !/^[a-z]+:\/\//i.test(f)), env.imports.join(','));
    check('the worker never calls chrome.downloads (downloads belong to the pages)',
      env.downloads.length === 0, env.downloads.length);
  }

  /* ================= settings ================= */
  console.log('\n=== settings ===');
  {
    const env = newEnv({ sync: { captureDelay: 999, hideFixed: false, theme: 'dark' } });
    const tab = env.addTab({ script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    const asked = env.syncGets[0] || [];
    check('getSettings reads storage.sync once before FS_START', env.syncGets.length === 1, env.syncGets.length);
    check('every engine key it projects was actually read from storage',
      ENGINE_KEYS.filter(k => k !== 'expandFrames').every(k => asked.indexOf(k) >= 0),
      ENGINE_KEYS.filter(k => k !== 'expandFrames' && asked.indexOf(k) < 0).join(','));
    check('page-only keys are read too (one merged table)',
      ['theme', 'filenameTemplate', 'imageFormat', 'saveDirectory'].every(k => asked.indexOf(k) >= 0), asked.length + ' keys');
    check('no key is requested twice', new Set(asked).size === asked.length, asked.length + ' vs ' + new Set(asked).size);
  }
  {
    const env = newEnv({ sync: { captureDelay: 999, hideFixed: false } });
    const tab = env.addTab({ script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    const s = at(env.starts, 0).settings || {};
    check('FS_START carries exactly the 15 engine keys',
      Object.keys(s).sort().join(',') === ENGINE_KEYS.slice().sort().join(','), Object.keys(s).sort().join(','));
    check('a stored value beats the default (captureDelay 999)', s.captureDelay === 999, s.captureDelay);
    check('a stored false beats a true default (hideFixed)', s.hideFixed === false, String(s.hideFixed));
    check('an unset key falls back to the default (maxPageHeight 50000)', s.maxPageHeight === 50000, s.maxPageHeight);
    check('FS_START carries a capture id', String(at(env.starts, 0).captureId || '').length > 5, at(env.starts, 0).captureId);
  }

  /* ================= restricted URLs ================= */
  console.log('\n=== restricted ===');
  {
    const BLOCKED = [
      'chrome://settings/', 'chrome-extension://abcdefg/page.html', 'about:blank',
      'devtools://devtools/bundled/inspector.html', 'view-source:https://example.com/',
      'edge://flags', 'brave://settings', 'moz-extension://abc/x.html',
      'https://chromewebstore.google.com/detail/foo', 'https://chrome.google.com/webstore/category/extensions'
    ];
    const env = newEnv();
    let allRefused = true, anyInject = false, badMsg = '';
    for (const url of BLOCKED) {
      const tab = env.addTab({ url });
      const res = await startCapture(env, tab.id, 'full');
      // Which sentence each family gets is graded in the error-surface section.
      if (!res || res.ok !== false || !res.error) { allRefused = false; badMsg = url + ' -> ' + JSON.stringify(res); }
      if (env.injects.length) anyInject = true;
    }
    check('all 10 restricted schemes/hosts are refused with a reason', allRefused, badMsg || BLOCKED.length + ' urls');
    check('a restricted page is never injected into', !anyInject, JSON.stringify(env.injects));
    check('a restricted page never leaves a session behind',
      ((await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(env.addTab({ url: BLOCKED[0], id: 900 })))) || {}).error === 'No active session',
      'FS_FRAME after refusal');
  }
  {
    const env = newEnv();
    const tab = env.addTab({ url: undefined });
    const res = await startCapture(env, tab.id, 'full');
    check('a tab with no url is refused (not crashed on)', res && res.ok === false, JSON.stringify(res));
  }
  {
    const env = newEnv();
    const m = env.mark();
    const tab = env.addTab({ url: 'chrome://settings/' });
    await startCapture(env, tab.id, 'full');
    const b = env.badgesSince(m);
    check('refusal flashes the red cross and clears itself', b[0] === '✕' && b[b.length - 1] === '', JSON.stringify(b));
    check('the flash clears at 2500 ms, not sooner',
      at(env.badges, 1).at - at(env.badges, 0).at === 2500, (at(env.badges, 1).at - at(env.badges, 0).at) + 'ms');
  }
  {
    // The scheme test is anchored (^) — a normal page that merely mentions a
    // blocked scheme in its query string is perfectly capturable.
    const env = newEnv();
    const tab = env.addTab({ url: 'https://example.com/?next=chrome://settings', script: { frames: 1 } });
    const res = await startCapture(env, tab.id, 'full');
    check('a https url that merely contains "chrome://" is still captured', res && res.ok === true, JSON.stringify(res));
    check('...and it really ran (one capture record)', capturesOf(env).length === 1, capturesOf(env).length);
  }

  /* ================= full capture happy path ================= */
  console.log('\n=== full-capture-happy-path ===');
  {
    const env = newEnv({ sync: { captureDelay: 200 } });
    const tab = env.addTab({ id: 42, index: 3, url: 'https://news.example.com/story', title: 'A story', script: { frames: 3 } });
    const m = env.mark();
    const res = await startCapture(env, tab.id, 'full');
    const tr = env.since(m);
    const frames = framesOf(env), caps = capturesOf(env);
    const cap = caps[0] || {};

    check('START_CAPTURE answers ok', res && res.ok === true, JSON.stringify(res));
    check('injects content/capture.js into the sender tab, once',
      env.injects.length === 1 && env.injects[0].tabId === 42 && env.injects[0].files.join() === 'content/capture.js',
      JSON.stringify(env.injects));
    check('asks for the <all_urls> grant exactly once (expandInner is on by default)',
      env.permQueries.length === 1 && env.permQueries[0].origins.join() === '<all_urls>', JSON.stringify(env.permQueries));
    check('badge sequence is …, 33%, 67%, 100%, cleared',
      env.badgesSince(m).join(',') === '…,33%,67%,100%,', env.badgesSince(m).join(','));
    check('one captureVisibleTab per frame', env.shots.length === 3, env.shots.length);
    check('every shot targets the session window', env.shots.every(s => s.windowId === 1), JSON.stringify(env.shots.map(s => s.windowId)));
    // Bounded above as well: the floor exists to stay just clear of Chrome's
    // 2/sec quota, and a floor raised to 5 s would satisfy `>= 550` while making
    // every capture crawl. The gap is the floor plus the 200 ms captureDelay
    // this env sets, so 550..900 brackets it without pinning the arithmetic.
    check('successive shots respect the 550 ms quota floor, and do not exceed it',
      at(env.shots, 1).at - at(env.shots, 0).at >= 550 && at(env.shots, 1).at - at(env.shots, 0).at < 900 &&
      at(env.shots, 2).at - at(env.shots, 1).at >= 550 && at(env.shots, 2).at - at(env.shots, 1).at < 900,
      (at(env.shots, 1).at - at(env.shots, 0).at) + '/' + (at(env.shots, 2).at - at(env.shots, 1).at) + 'ms');
    check('3 frames stored under the shipped padded key form',
      frames.length === 3 && frames.map(f => f.k.split(':')[1]).join() === '00000,00001,00002',
      frames.map(f => f.k).join(' '));
    check('frame geometry is stored as reported by the engine',
      frames.map(f => f.y).join() === '0,800,1600' && frames.every(f => f.x === 0), frames.map(f => f.y).join());
    check('pane/inline default to null, never undefined',
      frames.every(f => f.pane === null && f.inline === null), JSON.stringify(frames.map(f => [f.pane, f.inline])));
    check('each frame carries the captured image data', frames.every(f => /^data:image\/png/.test(f.dataUrl)), frames[0] && frames[0].dataUrl);
    check('exactly one captures record, mode full', caps.length === 1 && cap.mode === 'full', caps.length + '/' + cap.mode);
    check('capture record carries the sender tab title and url',
      cap.title === 'A story' && cap.url === 'https://news.example.com/story', cap.title + ' | ' + cap.url);
    check('capture record carries the engine meta verbatim', cap.meta && cap.meta.totalH === 2400 && cap.meta.dpr === 1, JSON.stringify(cap.meta));
    check('capture record snapshots the settings used', cap.settings && cap.settings.captureDelay === 200, cap.settings && cap.settings.captureDelay);
    check('all frames are stored before the captures record',
      tr.indexOf('db.put:captures:' + cap.id) > tr.lastIndexOf('db.put:frames:' + cap.id + ':00002'),
      'captures@' + tr.indexOf('db.put:captures:' + cap.id));
    check('result tab opens next to the source tab with the capture id',
      env.creates.length === 1 && env.creates[0].url === RESULT_URL + '?id=' + encodeURIComponent(cap.id) && env.creates[0].index === 4,
      JSON.stringify(env.creates));
    check('the result tab opens only after the record is written',
      tr.indexOf('tab.create:' + RESULT_URL + '?id=' + cap.id) > tr.indexOf('db.put:captures:' + cap.id), 'order');
    // The result tab took the screen, as it does in the browser, so the user has
    // to come back to the page before it can be shot again (see "wrong tab").
    env.activate(42);
    check('the session is released (the tab can be captured again)',
      (await startCapture(env, 42, 'visible')).ok === true, 'second capture');
  }
  /* ---- the record describes the capture that ran (R-18) ----
     The `captures` row was sealed with `settings: await getSettings()` at
     FS_DONE — a FRESH READ of the preferences, minutes after the pass they are
     supposed to describe. A preference that moves in between (Options open in
     another tab, a sync write from another machine landing) desynchronises the
     record from the act: content/capture.js is right to derive what it did from
     the settings it was HANDED, and the seam that undoes it is here.
     The redaction claim is the loudest consumer — ON→OFF used to take the whole
     record to "not scanned" over an image with blocks painted into it — but the
     rule is not about redaction. A row that says what the capture did may not be
     assembled out of what the user prefers now. */
  {
    const env = newEnv({ sync: { redactPII: true, captureDelay: 200, imageFormat: 'webp' } });
    const tab = env.addTab({ id: 430, script: { onStart: 'silent' } });
    await startCapture(env, 430, 'full');
    const handed = (at(env.starts, 0).settings || {}).redactPII;
    // The engine has been told to redact and is scanning on it. NOW the
    // preference moves under the running capture.
    env.sync.redactPII = false; env.sync.captureDelay = 999; env.sync.imageFormat = 'png';
    await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(tab));
    await env.send({ type: 'FS_DONE', meta: META }, env.senderTab(tab));
    await pump(env);
    const cap = at(capturesOf(env), 0);
    const s = cap.settings || {};
    check('a preference changed mid-capture does not rewrite what the record says was done',
      handed === true && s.redactPII === true && s.captureDelay === 200 && s.imageFormat === 'webp',
      JSON.stringify([handed, s.redactPII, s.captureDelay, s.imageFormat]));
  }
  {
    const env = newEnv({ sync: { redactPII: true } });
    const tab = env.addTab({ id: 431, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 431, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(tab));
    // Evicted mid-capture and adopted back. The snapshot is worker memory, so
    // this is the seam where it would be lost and silently re-read.
    restart(env);
    await pump(env);
    env.sync.redactPII = false;
    await env.send({ type: 'FS_DONE', meta: META }, env.senderTab(tab));
    await pump(env);
    const cap = at(capturesOf(env), 0);
    check('...and the snapshot survives the worker being evicted mid-capture',
      cap.settings && cap.settings.redactPII === true,
      JSON.stringify(cap.settings && cap.settings.redactPII));
  }
  {
    /* The region flow has the same seam and a wider gap: the overlay can sit on
       screen for as long as the user takes to drag a box, and the capture used
       to read the preferences at the moment of the click. */
    const env = newEnv({ sync: { imageFormat: 'webp' } });
    env.addTab({ id: 432, active: true, script: { region: 'select' } });
    const res = await env.send({ type: 'START_CAPTURE', tabId: 432, mode: 'region', startDelay: 0 }, env.fromPage());
    env.sync.imageFormat = 'png';        // the overlay is up; nothing is captured yet
    await pump(env, { budget: 12000 });
    const cap = at(capturesOf(env), 0);
    check('a region capture records the settings it was started with, not the ones at the drag',
      res && res.ok === true && cap.settings && cap.settings.imageFormat === 'webp',
      JSON.stringify(cap.settings && cap.settings.imageFormat));
  }
  {
    /* CONTROL: the snapshot is a snapshot of the REAL settings, not a frozen
       default table. A capture started after a change records the change. */
    const env = newEnv({ sync: { captureDelay: 200 } });
    const tab = env.addTab({ id: 433, script: { onStart: 'silent' } });
    env.sync.captureDelay = 700;
    await startCapture(env, 433, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(tab));
    await env.send({ type: 'FS_DONE', meta: META }, env.senderTab(tab));
    await pump(env);
    check('CONTROL: a capture started after a change records the changed value',
      at(capturesOf(env), 0).settings.captureDelay === 700,
      at(capturesOf(env), 0).settings.captureDelay);
  }
  /* ---- the redaction scan crosses the worker intact (v1.10.2) ----
     THE WIRE BETWEEN TWO HALVES OF ONE HONEST ANSWER. content/capture.js is the
     only code that can know whether the page had a text layer to scan, and
     pages/result.js is the only code that writes the claim a reviewer or an
     assistant reads. The worker is the seam between them, and it seals the row
     both of them are judged on.

     Graded here because a worker that dropped or reshaped `meta.piiScan` would
     take the record straight back to the failure this item exists to remove:
     result.js, seeing no counters, degrades to "unknown" for every capture —
     which is honest but useless — while a worker that half-carried it (leaves
     but not the skipped count) would let a page that is one enormous <pre> be
     reported as a page that draws its text as a picture. The record's
     truthfulness rests on this passthrough being a passthrough. */
  {
    const env = newEnv();
    /* The v2 ledger, in full. Thirty-odd counters, nested three deep, and the
       passthrough has to carry ALL of them: a worker that kept the flat numbers
       and dropped `unplaced`, `declined`, `truncated` or `frames` would leave
       result.js's state function reading `undefined` on four of its conjuncts,
       and a conjunction with an undefined term is a conjunction that quietly
       stops guarding anything. */
    const scan = {
      v: 2, fed: 3, chars: 41, placed: 0,
      unplaced: { offRegion: 0, degenerate: 1, hidden: 1, fontMismatch: 1, clipped: 0, faded: 0, total: 3 },
      unplacedChars: 41, inkPx: 0, nonText: 2,
      frames: { sameOrigin: 1, scanned: 0, crossOrigin: 2 },
      matched: 0, boxes: 0, boxesFromUnplaced: 0, matchedNoBox: 0,
      lateTextPlaced: 0, lateChars: 0, lateMatched: 0,
      declined: { tooLong: 1, ceiling: 0, unmeasurable: 0, other: 0, total: 1 },
      declinedChars: 5200, truncated: { walk: false, time: true, ceiling: false },
      walks: 3, walksCompleted: 2, remeasured: 4, movedUncovered: 1,
      budgetMs: 1200, sealed: true
    };
    const tab = env.addTab({ script: { frames: 1,
      meta: Object.assign({}, META, { piiPass: true, piiScan: scan }) } });
    await startCapture(env, tab.id, 'full');
    const cap = capturesOf(env)[0] || {};
    const got = (cap.meta || {}).piiScan;
    check('the engine\'s redaction ledger reaches the captures row',
      !!got && got.v === 2 && got.sealed === true, JSON.stringify(got && { v: got.v, sealed: got.sealed }));
    check('...whole, to the last nested counter, not summarised',
      JSON.stringify(got) === JSON.stringify(scan), JSON.stringify(got));
    /* `piiPass` is the one field that decides between "we did not run the pass
       on this capture mode" and "we do not know whether it ran". Dropping it
       silently demotes every full-page capture to `unknown`. */
    check('...and the invocation flag crosses with it',
      (cap.meta || {}).piiPass === true, JSON.stringify((cap.meta || {}).piiPass));
  }
  {
    /* THE RECTANGLES STILL DO NOT CROSS INTO STORAGE AS A RECORD. The captures
       row is transient — result.js deletes it the moment the shot is sealed —
       but the ledger beside it is not, so this row proves the two travel
       separately and that only counts are ever in the durable one. */
    const env = newEnv();
    const boxes = [{ x: 10, y: 20, w: 100, h: 16, kind: 'email' }];
    const tab = env.addTab({ script: { frames: 1, meta: Object.assign({}, META,
      { piiPass: true, piiBoxes: boxes, piiScan: { v: 2, boxes: 1, sealed: true } }) } });
    await startCapture(env, tab.id, 'full');
    const cap = capturesOf(env)[0] || {};
    check('the ledger and the rectangles cross as two separate fields',
      Array.isArray((cap.meta || {}).piiBoxes) && !!(cap.meta || {}).piiScan &&
      JSON.stringify((cap.meta || {}).piiScan).indexOf('"x"') < 0,
      JSON.stringify(cap.meta && cap.meta.piiScan));
    check('...and no geometry was ever folded into the ledger itself',
      !/"[xywh]":/.test(JSON.stringify((cap.meta || {}).piiScan || {})), '');
  }
  {
    /* A region capture never runs the pass, and the worker has to say so
       EXPLICITLY. Absent would mean "we do not know", which is the state that
       raises a permanent warning on every crop the user ever takes. */
    const env = newEnv();
    const tab = env.addTab({ script: { frames: 1 } });
    await startCapture(env, tab.id, 'visible');
    const cap = capturesOf(env)[0] || {};
    check('a capture mode that never runs the pass records an explicit false',
      !!cap.meta && cap.meta.piiPass === false, JSON.stringify(cap.meta));
  }
  {
    /* The control. Absence has to survive too: a capture with redaction off
       sends no counters, and result.js reads that absence as "no pass ran". A
       worker that helpfully invented an empty scan object would turn every
       unredacted capture into one that claims a pass over nothing. */
    const env = newEnv();
    const tab = env.addTab({ script: { frames: 1 } });
    await startCapture(env, tab.id, 'full');
    const cap = capturesOf(env)[0] || {};
    check('CONTROL: no scan reported means no scan field invented',
      !!cap.meta && cap.meta.piiScan === undefined, JSON.stringify(cap.meta));
  }
  {
    const env = newEnv({ granted: false });
    const tab = env.addTab({ script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    check('a declined <all_urls> grant means expandFrames:false, not a failed capture',
      (at(env.starts, 0).settings || {}).expandFrames === false, JSON.stringify(at(env.starts, 0).settings));
  }
  {
    const env = newEnv({ sync: { expandInner: false } });
    const tab = env.addTab({ script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    check('expandInner off skips the permission probe entirely', env.permQueries.length === 0, env.permQueries.length);
  }
  {
    const env = newEnv({ hooks: { permissionThrows: true } });
    const tab = env.addTab({ script: { onStart: 'silent' } });
    const res = await startCapture(env, tab.id, 'full');
    check('a throwing permissions API degrades to expandFrames:false, capture still starts',
      res.ok === true && (at(env.starts, 0).settings || {}).expandFrames === false, JSON.stringify(res));
  }

  /* ================= the capture quota ================= */
  console.log('\n=== rate limit ===');
  {
    let n = 0;
    const env = newEnv({ hooks: { capture: () => (++n <= 2 ? new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded') : null) } });
    const tab = env.addTab({ script: { frames: 1 } });
    const res = await startCapture(env, tab.id, 'full');
    check('two quota errors are retried, the third attempt wins', res.ok === true && env.shots.length === 3, env.shots.length + ' attempts');
    check('the frame still lands after the retries', framesOf(env).length === 1, framesOf(env).length);
    check('a retry waits 700 ms before trying again', at(env.shots, 1).at - at(env.shots, 0).at >= 700, (at(env.shots, 1).at - at(env.shots, 0).at) + 'ms');
  }
  {
    const env = newEnv({ hooks: { capture: () => new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') } });
    const tab = env.addTab({ script: { frames: 1 } });
    await startCapture(env, tab.id, 'full');
    const resp = env.tabs.get(tab.id) ? env.tabs.get(tab.id).frameResponses[0] : null;
    check('a permanent quota wall gives up after 4 attempts', env.shots.length === 4, env.shots.length);
    check('the engine is told the frame failed', resp && resp.ok === false, JSON.stringify(resp));
    check('nothing half-captured is stored', framesOf(env).length === 0 && capturesOf(env).length === 0,
      framesOf(env).length + '/' + capturesOf(env).length);
  }
  {
    /* WHAT THE USER IS TOLD when that wall is permanent. A rate limit clears
       itself in a second, so the advice for it is the opposite of the advice for
       a page that will not start — and every fallback sentence on this path ends
       in "reload", which does nothing for a quota and costs the user the page
       state they were trying to photograph. Visible mode reaches it through
       startCapture's own catch. */
    const env = newEnv({ hooks: { capture: () => new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded') } });
    env.addTab({ id: 85, active: true, url: 'https://news.example.com/story' });
    const res = await startCapture(env, 85, 'visible');
    const rec = env.session[ERR_KEY] || {};
    check('a capture beaten by the rate limit is told to wait, not to reload',
      /wait a moment/i.test(String(rec.message)) && !/reload/i.test(String(rec.message)), JSON.stringify(rec.message));
    check('...and the answer the popup renders says the same thing',
      /wait a moment/i.test(String(res && res.error)) && !/reload/i.test(String(res && res.error)), JSON.stringify(res));
    check('...with Chrome\'s own wording kept in the log only',
      env.logs.some(l => /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(l)) &&
      !/MAX_CAPTURE/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
  }
  {
    // The same wall on the full-page path, which reaches the router's catch
    // instead — the mode that actually hits the quota, because it is the one
    // that asks for a shot per screenful.
    const env = newEnv({ hooks: { capture: () => new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded') } });
    const tab = env.addTab({ id: 86, active: true, script: { frames: 3 } });
    await startCapture(env, 86, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('a full-page capture beaten by the rate limit is told to wait too',
      /wait a moment/i.test(String(rec.message)) && !/reload/i.test(String(rec.message)), JSON.stringify(rec.message));
    check('...with Chrome\'s wording still kept out of the note on this path too',
      !/MAX_CAPTURE|quota exceeded/.test(JSON.stringify(env.session)) &&
      env.logs.some(l => /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(l)), JSON.stringify(env.session));
    // NOT asserted here: rec.mode. The engine echoes the reason back as FS_ERROR
    // after the router's catch has already dropped the session, so the second
    // note is written with no session to ask and records 'capture'. That is
    // pre-existing on every mid-flight throw, not something the quota rows
    // introduced, and it is a finding of its own rather than a thing to bury in
    // a rate-limit check.
  }
  {
    // Only the first grab throws, so the retry below can actually prove the
    // wedged session was released rather than re-hitting the same wall.
    const env = newEnv({ hooks: { capture: n => (n === 1 ? new Error('Cannot access contents of the page.') : null) } });
    const tab = env.addTab({ script: { frames: 2 } });
    const m = env.mark();
    await startCapture(env, tab.id, 'full');
    const t2 = env.since(m);
    check('a non-quota capture error is not retried', env.shots.length === 1, env.shots.length + ' attempts');
    check('the router aborts the content script after a mid-flight throw',
      t2.some(s => /:FS_ABORT$/.test(s)), t2.filter(s => s.indexOf('msg>') === 0).join(' '));
    check('and flashes the error badge', env.badgesSince(m).indexOf('!') >= 0, JSON.stringify(env.badgesSince(m)));
    check('the failure is logged with the FullShot prefix',
      env.logs.some(l => /FullShot background error/.test(l)), JSON.stringify(env.logs));
    check('the wedged session is released so the tab can be retried',
      (await startCapture(env, tab.id, 'visible')).ok === true, 'retry');
  }

  /* ================= visible-area capture ================= */
  console.log('\n=== visible ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 7, index: 1, url: 'https://a.test/x', title: 'A' });
    const m = env.mark();
    const res = await startCapture(env, tab.id, 'visible');
    const frames = framesOf(env), cap = capturesOf(env)[0] || {};
    check('visible mode injects nothing at all', env.injects.length === 0, JSON.stringify(env.injects));
    check('visible mode takes exactly one shot', env.shots.length === 1, env.shots.length);
    check('stores frame 0 at the origin', frames.length === 1 && frames[0].index === 0 && frames[0].x === 0 && frames[0].y === 0, JSON.stringify(frames[0] && [frames[0].index, frames[0].x, frames[0].y]));
    check('capture record mode is visible with a null cropRect',
      cap.mode === 'visible' && cap.meta && cap.meta.cropRect === null && cap.meta.dpr === null, JSON.stringify(cap.meta));
    check('opens the result tab and clears the badge',
      env.creates.length === 1 && tail(env.badgesSince(m)) === '', JSON.stringify(env.badgesSince(m)));
    check('START_CAPTURE answered ok', res.ok === true, JSON.stringify(res));
  }

  /* ================= region / element ================= */
  console.log('\n=== region ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 11, index: 0, script: { region: 'wait' } });
    const m = env.mark();
    const res = await startCapture(env, tab.id, 'region');
    check('region mode injects content/region.js only',
      env.injects.length === 1 && env.injects[0].files.join() === 'content/region.js', JSON.stringify(env.injects));
    check('region mode asks the overlay for a drag selection', (env.tabs.get(11) || {}).regionPick === 'drag', (env.tabs.get(11) || {}).regionPick);
    check('region mode badges the marquee glyph and waits', env.badgesSince(m).join() === '⬚', JSON.stringify(env.badgesSince(m)));
    check('no shot is taken until the human picks', env.shots.length === 0, env.shots.length);
    check('the session stays open across the wait (P-4/P-6 vehicle)',
      (await startCapture(env, 11, 'region')).error === 'A capture is already running in this tab.', 'second start');
    check('START_CAPTURE answered ok while the picker is up', res.ok === true, JSON.stringify(res));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 12, script: { region: 'select', rect: { x: 5, y: 6, w: 100, h: 50 }, dpr: 2 } });
    const m = env.mark();
    await startCapture(env, tab.id, 'element');
    check('element mode asks the overlay for an element pick', (env.tabs.get(12) || {}).regionPick === 'element', (env.tabs.get(12) || {}).regionPick);
    const cap = capturesOf(env)[0] || {};
    check('a selection stores the crop rect and the device pixel ratio',
      cap.mode === 'region' && cap.meta.cropRect.w === 100 && cap.meta.dpr === 2, JSON.stringify(cap.meta));
    check('a selection takes exactly one shot and stores one frame',
      env.shots.length === 1 && framesOf(env).length === 1, env.shots.length + '/' + framesOf(env).length);
    check('a selection opens the result tab and clears the badge',
      env.creates.length === 1 && tail(env.badgesSince(m)) === '', JSON.stringify(env.badgesSince(m)));
    env.activate(12);   // back from the result tab the selection opened
    check('the session is released after the selection',
      (await startCapture(env, 12, 'visible')).ok === true, 'retry');
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 13, script: { region: 'cancel' } });
    const m = env.mark();
    await startCapture(env, tab.id, 'region');
    check('escape clears the badge and stores nothing',
      tail(env.badgesSince(m)) === '' && capturesOf(env).length === 0 && framesOf(env).length === 0,
      JSON.stringify(env.badgesSince(m)));
    check('escape releases the session', (await startCapture(env, 13, 'visible')).ok === true, 'retry');
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 14 });
    const res = await env.send({ type: 'FS_REGION_SELECTED', rect: { x: 0, y: 0, w: 9, h: 9 }, dpr: 1 }, env.senderTab(tab));
    check('a selection with no session is refused, not captured',
      res && res.ok === false && env.shots.length === 0, JSON.stringify(res));
  }

  /* ================= the tab must still be the one on screen ================= */
  /* captureVisibleTab photographs the window's ACTIVE tab, never "the tab that
     asked". A capture that does not re-check its target therefore hands the user
     a picture of whatever page they switched to — a leak, not a glitch. Graded
     from the stored data: the fake stamps the photographed tab id into every
     data URL, so a wrong-tab frame is visible rather than inferred. */
  console.log('\n=== wrong tab ===');
  {
    const env = newEnv();
    env.addTab({ id: 202, active: false, url: 'https://mail.example.com/inbox' });
    const tab = env.addTab({
      id: 201, active: true, url: 'https://docs.example.com/spec', title: 'Spec',
      script: { frames: 4, beforeFrame: i => { if (i === 2) env.activate(202); } }
    });
    const m = env.mark();
    await startCapture(env, 201, 'full');
    const frames = framesOf(env);
    const rec = env.session[ERR_KEY] || {};
    check('a tab switch mid-sequence stops the capture at that frame',
      env.shots.length === 2, env.shots.length + ' shots for 4 frames');
    // Graded against what was ever WRITTEN, not what is still on disk: the
    // abort now deletes the orphans behind it (see "frames left behind"), and
    // an empty store must not be able to pass this vacuously.
    check('not one frame of the tab the user switched TO is stored',
      env.framesWritten.length === 2 && env.framesWritten.every(f => String(f.dataUrl).indexOf('@tab202') < 0),
      env.framesWritten.map(f => f.dataUrl).join(' '));
    check('every frame that did reach the disk was of the tab that asked',
      env.framesWritten.every(f => String(f.dataUrl).indexOf('@tab201') > 0),
      env.framesWritten.map(f => f.dataUrl).join(' '));
    check('and the abandoned capture leaves nothing behind in the store',
      frames.length === 0, frames.length + ' frames');
    check('the half capture is never sealed into a captures record',
      capturesOf(env).length === 0, capturesOf(env).length);
    check('...and no result tab is opened over it', env.creates.length === 0, JSON.stringify(env.creates));
    check('the engine is told that frame was refused, and why',
      at(tab.frameResponses, 2).ok === false && /switched tabs/.test(String(at(tab.frameResponses, 2).error)),
      JSON.stringify(at(tab.frameResponses, 2)));
    check('the user is told why, in the surface the popup reads',
      /switched tabs/.test(String(rec.message)), JSON.stringify(rec));
    check('the note names the page the user meant to capture, not the one they left for',
      rec.origin === 'https://docs.example.com' && rec.tabId === 201, rec.origin + '/' + rec.tabId);
    // capture.js:1586 throws a refused frame's own reason straight back at us.
    check('the engine echoing the refusal back does not downgrade the note',
      rec.mode === 'full' && Object.keys(env.session).length === 1,
      rec.mode + ' ' + JSON.stringify(Object.keys(env.session)));
    check('the abort flashes the refusal badge and then clears it',
      env.badgesSince(m).indexOf('✕') > 0 && tail(env.badgesSince(m)) === '', JSON.stringify(env.badgesSince(m)));
    env.activate(201);   // the user comes back
    check('the aborted session is released, so the page can be captured again',
      (await startCapture(env, 201, 'visible')).ok === true, 'retry');
  }
  {
    const env = newEnv();
    env.addTab({ id: 212, active: false, windowId: 1, url: 'https://mail.example.com/inbox' });
    const tab = env.addTab({
      id: 211, active: true, windowId: 1, url: 'https://docs.example.com/spec',
      // Dragged out into a window of its own: same tab, same id, still "active" —
      // but no longer the tab the frozen windowId photographs.
      script: { frames: 3, beforeFrame: i => { if (i === 1) { env.moveToWindow(211, 2); env.activate(212); } } }
    });
    await startCapture(env, 211, 'full');
    const frames = framesOf(env);
    check('a tab dragged into another window stops being the tab on screen',
      env.shots.length === 1, env.shots.length + ' shots');
    check('the id alone proves nothing — no frame of the tab left behind is stored',
      env.framesWritten.length === 1 && env.framesWritten.every(f => String(f.dataUrl).indexOf('@tab212') < 0),
      env.framesWritten.map(f => f.dataUrl).join(' '));
    check('nothing half captured is sealed after the move',
      capturesOf(env).length === 0 && env.creates.length === 0,
      capturesOf(env).length + '/' + env.creates.length);
    check('and the reason is parked for the popup',
      /switched tabs/.test(String((env.session[ERR_KEY] || {}).message)), JSON.stringify(env.session[ERR_KEY]));
    check('...and the one frame taken before the move is cleaned up, not orphaned',
      env.framesWritten.length === 1 && framesOf(env).length === 0,
      env.framesWritten.length + ' written / ' + framesOf(env).length + ' left');
  }
  {
    const env = newEnv();
    env.addTab({ id: 222, active: false, url: 'https://mail.example.com/inbox' });
    env.addTab({ id: 221, active: true, url: 'https://bank.example.com/statements' });
    const res = await env.send({ type: 'START_CAPTURE', tabId: 221, mode: 'visible', startDelay: 3 }, env.fromPage());
    check('a delayed capture still answers the popup at once', res && res.ok === true, JSON.stringify(res));
    env.activate(222);                       // the user goes to read something else
    await pump(env, { budget: 12000 });
    check('the countdown does not shoot the page that took its place',
      env.shots.length === 0, env.shots.length + ' shots');
    check('nothing is stored and no result tab is opened for it',
      framesOf(env).length === 0 && capturesOf(env).length === 0 && env.creates.length === 0,
      framesOf(env).length + '/' + capturesOf(env).length + '/' + env.creates.length);
    check('the reason is waiting for the popup, naming the visible-area capture',
      /switched tabs/.test(String((env.session[ERR_KEY] || {}).message)) &&
      (env.session[ERR_KEY] || {}).mode === 'visible', JSON.stringify(env.session[ERR_KEY]));
  }
  {
    const env = newEnv();
    env.addTab({ id: 232, active: false, url: 'https://mail.example.com/inbox' });
    const tab = env.addTab({ id: 231, active: true, url: 'https://docs.example.com/spec', script: { region: 'wait' } });
    await startCapture(env, 231, 'region');
    env.activate(232);                       // the overlay is still up, on a tab nobody is looking at
    const res = await env.send({ type: 'FS_REGION_SELECTED', rect: { x: 0, y: 0, w: 40, h: 40 }, dpr: 1 }, env.senderTab(tab));
    await pump(env);
    check('a region selection that lands after a tab switch is refused, not shot',
      res && res.ok === false && /switched tabs/.test(String(res.error)) && env.shots.length === 0,
      JSON.stringify(res) + ' shots=' + env.shots.length);
    env.activate(231);
    check('...and the region session is released rather than left wedged',
      (await startCapture(env, 231, 'visible')).ok === true, 'retry');
  }
  {
    // The control. A guard that fires when nothing moved is worse than none:
    // another window going busy is not a tab switch.
    const env = newEnv();
    env.addTab({ id: 242, windowId: 2, active: true, url: 'https://other.test/' });
    env.addTab({
      id: 241, windowId: 1, active: true, url: 'https://docs.example.com/spec',
      script: { frames: 3, beforeFrame: i => { if (i === 1) env.activate(242); } }
    });
    const m = env.mark();
    await startCapture(env, 241, 'full');
    check('activity in another window never stops a capture',
      framesOf(env).length === 3 && capturesOf(env).length === 1,
      framesOf(env).length + '/' + capturesOf(env).length);
    // Twice per frame, not once per capture: the shot is bracketed, so the pair
    // count scales with frames. One query per frame would mean the post-shot
    // check had been dropped; three would mean a check had been added blind.
    check('the target is re-verified around every frame, not once per capture',
      env.since(m).filter(s => s === 'tab.query').length === 6,
      env.since(m).filter(s => s === 'tab.query').length + ' queries for 3 frames');
    check('...and every stored frame really is of the tab that asked',
      framesOf(env).every(f => String(f.dataUrl).indexOf('@tab241') > 0), framesOf(env).map(f => f.dataUrl).join(' '));
    check('a capture that never went wrong parks no failure', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }
  {
    // Away and straight back: the check is a fact about right now, not a latch.
    const env = newEnv();
    env.addTab({ id: 252, active: false });
    env.addTab({ id: 251, active: true, script: { frames: 3, beforeFrame: i => { if (i === 1) { env.activate(252); env.activate(251); } } } });
    await startCapture(env, 251, 'full');
    check('a switch away and back before the next frame does not fail the capture',
      framesOf(env).length === 3 && capturesOf(env).length === 1,
      framesOf(env).length + '/' + capturesOf(env).length);
  }
  {
    /* The window the guard cannot see by checking only BEFORE the shot: the
       switch lands while captureVisibleTab is in flight. Checking first and
       storing whatever comes back is a time-of-check/time-of-use bug — the
       answer is a photograph of the page the user moved to, and the pre-check
       said yes about a moment that had already passed.

       Modelled exactly, not approximated: hooks.capture runs INSIDE the fake's
       captureVisibleTab and BEFORE it reads the window's active tab, so
       activating another tab from the hook produces the same thing Chrome
       would — a data URL of tab 272 returned to a call made for tab 271. */
    let inFlight = 0;
    const env = newEnv({
      hooks: { capture: () => { if (++inFlight === 2) env.activate(272); return null; } }
    });
    env.addTab({ id: 272, active: false, url: 'https://mail.example.com/inbox' });
    env.addTab({ id: 271, active: true, url: 'https://docs.example.com/spec', script: { frames: 3 } });
    await startCapture(env, 271, 'full');
    check('a tab switch that lands DURING the shot is caught after it, not missed',
      env.framesWritten.every(f => String(f.dataUrl).indexOf('@tab272') < 0),
      env.framesWritten.map(f => f.dataUrl).join(' '));
    check('...so the wrong-tab frame never reaches the disk at all',
      env.shots.length === 2 && env.framesWritten.length === 1,
      env.shots.length + ' shots -> ' + env.framesWritten.length + ' written');
    check('...and that capture is abandoned, not sealed',
      capturesOf(env).length === 0 && /switched tabs/.test(String((env.session[ERR_KEY] || {}).message)),
      capturesOf(env).length + ' ' + JSON.stringify(env.session[ERR_KEY]));
  }
  {
    // The control for the check above: re-verifying AFTER the shot must not
    // reject a capture where nothing moved. A guard that fires on a still tab
    // costs the user every capture they take.
    const env = newEnv();
    env.addTab({ id: 281, active: true, url: 'https://docs.example.com/spec', script: { frames: 3 } });
    const m = env.mark();
    await startCapture(env, 281, 'full');
    check('re-verifying after the shot does not break a capture nobody touched',
      framesOf(env).length === 3 && capturesOf(env).length === 1,
      framesOf(env).length + '/' + capturesOf(env).length);
    check('...and the target is verified twice per frame, before and after',
      env.since(m).filter(s => s === 'tab.query').length === 6,
      env.since(m).filter(s => s === 'tab.query').length + ' queries for 3 frames');
  }
  {
    // A batch job runs in a tab of its own, so the user clicking back to their
    // own tab must fail that job at once — not photograph the inbox, and not
    // wedge the queue until the 90 s cap.
    let switched = false;
    const env = newEnv({
      script: { frames: 2, beforeFrame: i => { if (i === 1 && !switched) { switched = true; env.activate(261); } } }
    });
    env.addTab({ id: 261, active: false, url: 'https://mail.example.com/inbox' });
    const t0 = env.clock.now();
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('a tab switch during a batch job fails that job with the reason',
      at(jobs, 0).status === 'error' && /switched tabs/.test(String(at(jobs, 0).error)), JSON.stringify(at(jobs, 0)));
    check('...without waiting out the 90 s job cap', env.clock.now() - t0 < 90000, (env.clock.now() - t0) + 'ms');
    check('...and the queue carries on to the next url',
      at(jobs, 1).status === 'done' && !!at(jobs, 1).shotId, JSON.stringify(at(jobs, 1)));
    check('no frame of the user\'s own tab is ever filed under a batch url',
      framesOf(env).every(f => String(f.dataUrl).indexOf('@tab261') < 0), framesOf(env).map(f => f.dataUrl).join(' '));
  }

  /* ================= protocol edges ================= */
  console.log('\n=== protocol ===');
  {
    // content/capture.js returns false when it is already capturing; Chrome then
    // resolves sendMessage with undefined, so the worker cannot tell. Today the
    // decline reports success — this is the exact semantic P-6 has to fix.
    const env = newEnv();
    const tab = env.addTab({ script: { onStart: 'decline' } });
    const res = await startCapture(env, tab.id, 'full');
    check('a declined FS_START resolves undefined and still reports ok (observed MV3 semantics)',
      res.ok === true && env.shots.length === 0, JSON.stringify(res));
  }
  {
    const env = newEnv();
    const tab = env.addTab();
    const res = await env.send({ type: 'FS_FRAME', index: 0, total: 4, x: 0, y: 0 }, env.senderTab(tab));
    check('a frame with no session is refused by name', res && res.error === 'No active session', JSON.stringify(res));
  }
  {
    const env = newEnv();
    const res = await env.send({ type: 'FS_DONE', meta: META }, env.fromPage());
    check('FS_DONE from a senderless message is refused, not crashed on', res && res.ok === false, JSON.stringify(res));
  }
  {
    const env = newEnv();
    const res = await env.send({ type: 'FS_NOT_A_REAL_MESSAGE' }, env.fromPage());
    // The type is a protocol constant, but it still arrives on a message, so it
    // is named in the log — where a developer reads it — and never in the answer.
    check('an unknown message is refused with a fixed sentence',
      res && res.error === R_UNKNOWN, JSON.stringify(res));
    check('...and the type it was is named in the log instead',
      env.logs.some(l => /FS_NOT_A_REAL_MESSAGE/.test(l)), JSON.stringify(env.logs));
    const res2 = await env.send({ type: 'FS_X https://shop.example/o\'brien?token=TYPE9' }, env.fromPage());
    check('...so a url spelled into the message type cannot ride out on the answer',
      res2 && res2.error === R_UNKNOWN, JSON.stringify(res2));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ script: { onStart: 'error', error: 'engine could not measure the page' } });
    const m = env.mark();
    await startCapture(env, tab.id, 'full');
    check('FS_ERROR flashes the error badge and clears it',
      env.badgesSince(m).indexOf('!') >= 0 && tail(env.badgesSince(m)) === '', JSON.stringify(env.badgesSince(m)));
    check('FS_ERROR logs the engine message', env.logs.some(l => /engine could not measure the page/.test(l)), JSON.stringify(env.logs));
    check('FS_ERROR releases the session', (await startCapture(env, tab.id, 'visible')).ok === true, 'retry');
  }

  /* ================= frame expansion ================= */
  console.log('\n=== expand frames ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 21 });
    const m = env.mark();
    const res = await env.send({ type: 'FS_EXPAND_FRAMES' }, env.senderTab(tab));
    await pump(env);
    const tr = env.since(m);
    check('injects frame-expand.js into every frame', tr[0] === 'inject:21:content/frame-expand.js:allFrames', tr[0]);
    check('then broadcasts FS_FRAMES_EXPAND to the tab', tr.indexOf('msg>21:FS_FRAMES_EXPAND') > 0, JSON.stringify(tr));
    check('answers ok so the engine can proceed', res && res.ok === true, JSON.stringify(res));
  }
  {
    const env = newEnv({ hooks: { inject: (id, files) => files.indexOf('content/frame-expand.js') >= 0 ? new Error('Cannot access contents of the page') : null } });
    const tab = env.addTab({ id: 22 });
    const res = await env.send({ type: 'FS_EXPAND_FRAMES' }, env.senderTab(tab));
    await pump(env);
    check('an unscriptable frame does not abort the capture', res && res.ok === true, JSON.stringify(res));
    check('...and the expand broadcast is still attempted',
      env.trace.some(s => s === 'msg>22:FS_FRAMES_EXPAND'), JSON.stringify(env.trace));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 23 });
    const res = await env.send({ type: 'FS_RESTORE_FRAMES' }, env.senderTab(tab));
    await pump(env);
    check('restore is broadcast to the tab and answered ok',
      res && res.ok === true && env.trace.indexOf('msg>23:FS_FRAMES_RESTORE') >= 0, JSON.stringify(env.trace));
    const m2 = env.mark();
    const res2 = await env.send({ type: 'FS_RESTORE_FRAMES' }, env.fromPage());
    await pump(env);
    check('restore without a tab answers ok and broadcasts to nobody',
      res2 && res2.ok === true && env.since(m2).length === 0, JSON.stringify(res2) + ' ' + JSON.stringify(env.since(m2)));
  }

  /* ================= teardown ================= */
  console.log('\n=== teardown ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 31, script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    fire(env.onRemoved, 31, {});
    const res = await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    check('closing the tab drops its session', res && res.error === 'No active session', JSON.stringify(res));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 32, script: { onStart: 'silent' } });
    const m = env.mark();
    await startCapture(env, tab.id, 'full');
    fire(env.onUpdated, 32, { status: 'loading' }, tab);
    await pump(env);
    const res = await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    check('navigating away mid-capture drops the session', res && res.error === 'No active session', JSON.stringify(res));
    check('...and clears the badge', tail(env.badgesSince(m)) === '', JSON.stringify(env.badgesSince(m)));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 33, script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    fire(env.onUpdated, 33, { status: 'complete' }, tab);
    fire(env.onUpdated, 99, { status: 'loading' }, tab);   // a different tab
    const res = await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    check('status:complete and another tab loading both leave the session alone',
      res && res.ok === true, JSON.stringify(res));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 34, script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    const m = env.mark();
    const res = await startCapture(env, tab.id, 'full');
    check('a second capture in the same tab is refused by name',
      res && res.error === 'A capture is already running in this tab.', JSON.stringify(res));
    check('...and nothing is injected the second time', env.since(m).every(s => s.indexOf('inject:') !== 0), JSON.stringify(env.since(m)));
  }

  /* ================= frames left behind ================= */
  /* A full capture writes its frames one at a time and only seals the `captures`
     row at FS_DONE, so an abort leaves rows nothing references: not in History,
     not deletable from any page, and `unlimitedStorage` means nothing evicts
     them. Each one is a full-resolution picture of whatever was on screen —
     an intranet, a mailbox, a bank statement — kept on disk for good. The only
     caller of deleteFrames used to be the SUCCESS path (pages/result.js:510),
     so every path below dropped the session and kept the pixels. */
  console.log('\n=== frames left behind ===');
  {
    const env = newEnv();
    env.addTab({ id: 292, active: false, url: 'https://mail.example.com/inbox' });
    env.addTab({
      id: 291, active: true, url: 'https://intranet.example.org/hr/pay',
      script: { frames: 4, beforeFrame: i => { if (i === 2) env.activate(292); } }
    });
    await startCapture(env, 291, 'full');
    check('a wrong-tab abort takes its stored frames with it',
      framesOf(env).length === 0, framesOf(env).length + ' frames left');
    check('...by deleting them, not by never having written them',
      env.trace.some(s => s.indexOf('db.put:frames:') === 0) &&
      env.trace.some(s => s.indexOf('db.delframes:') === 0),
      JSON.stringify(env.trace.filter(s => /frames/.test(s))));
  }
  {
    // Driven by hand rather than by the script runner: each of these paths is
    // reached from OUTSIDE the frame loop, and the point is that a frame is on
    // disk before the abort arrives.
    const env = newEnv();
    const tab = env.addTab({ id: 293, script: { onStart: 'silent' } });
    await startCapture(env, 293, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const mid = framesOf(env).length;
    await env.send({ type: 'FS_ERROR', error: 'Frame capture failed' }, env.senderTab(tab));
    await pump(env);
    check('an engine failure mid-capture takes its frames with it',
      mid === 1 && framesOf(env).length === 0, mid + ' -> ' + framesOf(env).length);
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 294, script: { onStart: 'silent' } });
    await startCapture(env, 294, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const mid = framesOf(env).length;
    fire(env.onUpdated, 294, { status: 'loading' }, tab);
    await pump(env);
    check('navigating away mid-capture takes its frames with it',
      mid === 1 && framesOf(env).length === 0, mid + ' -> ' + framesOf(env).length);
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 295, script: { onStart: 'silent' } });
    await startCapture(env, 295, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const mid = framesOf(env).length;
    fire(env.onRemoved, 295, {});
    await pump(env);
    check('closing the tab mid-capture takes its frames with it',
      mid === 1 && framesOf(env).length === 0, mid + ' -> ' + framesOf(env).length);
  }
  {
    // The router's own catch: the shot itself throws something that is not a
    // quota error, so grabVisible rethrows past every capture-flow handler.
    let n = 0;
    const env = newEnv({ hooks: { capture: () => (++n === 2 ? new Error('the compositor died') : null) } });
    env.addTab({ id: 297, active: true, script: { frames: 3 } });
    await startCapture(env, 297, 'full');
    check('a crash inside the router takes the frames with it too',
      env.shots.length === 2 && framesOf(env).length === 0,
      env.shots.length + ' shots -> ' + framesOf(env).length + ' frames');
  }
  {
    // The control. Cleaning up an abort must not touch a capture that WORKED —
    // result.js needs those frames to stitch, and deletes them itself at :510.
    const env = newEnv();
    env.addTab({ id: 296, active: true, script: { frames: 3 } });
    await startCapture(env, 296, 'full');
    check('a capture that finished keeps its frames for the result page',
      framesOf(env).length === 3 && capturesOf(env).length === 1,
      framesOf(env).length + '/' + capturesOf(env).length);
    check('...and nothing deleted them behind its back',
      !env.trace.some(s => s.indexOf('db.delframes:') === 0),
      JSON.stringify(env.trace.filter(s => /delframes/.test(s))));
  }
  {
    /* THE SIXTH PATH. startCapture has a catch of its own, and everything its
       try guards runs BEFORE captureVisibleFlow seals the `captures` row — so a
       throw there abandons a session by definition. Visible mode reaches it with
       a frame already on disk: the shot lands, the frame is written, and the
       seal is what fails. */
    const env = newEnv({ hooks: { dbPut: store => (store === 'captures' ? new Error('QuotaExceededError: the database is full') : null) } });
    env.addTab({ id: 298, active: true, url: 'https://intranet.example.org/hr/pay' });
    const res = await startCapture(env, 298, 'visible');
    check('a start that throws after writing a frame takes that frame with it',
      env.framesWritten.length === 1 && framesOf(env).length === 0,
      env.framesWritten.length + ' written / ' + framesOf(env).length + ' left');
    check('...and still answers with a sentence rather than the exception',
      res && res.ok === false && !/QuotaExceededError|database/.test(String(res.error)), JSON.stringify(res));
  }
  {
    /* The control for the path above, and the reason it cannot simply drop
       whatever session it was holding. captureVisibleFlow seals the `captures`
       row and takes itself out of the map BEFORE it opens the result page, so a
       throw from that last step belongs to a capture that WORKED — dropping its
       frames would delete the picture result.js is opening in order to stitch. */
    const env = newEnv({ hooks: { createTab: p => (/pages\/result\.html/.test(String(p.url)) ? new Error('Tab was closed before it could be created.') : null) } });
    env.addTab({ id: 299, active: true });
    await startCapture(env, 299, 'visible');
    check('a result tab that fails to open does NOT take the finished capture with it',
      framesOf(env).length === 1 && capturesOf(env).length === 1,
      framesOf(env).length + ' frames / ' + capturesOf(env).length + ' captures');
    check('...so the cleanup asks whether the session is still LIVE, not merely whether one exists',
      !env.trace.some(s => s.indexOf('db.delframes:') === 0),
      JSON.stringify(env.trace.filter(s => /delframes/.test(s))));
  }
  {
    /* THE SEVENTH. FS_REGION_CANCEL takes the tab's session out of the map
       without ever asking what kind of session it is, so it abandons a full
       capture's frames exactly the way the six above do. Driven by hand for the
       same reason the others are: the point is that a frame is on disk when the
       abandonment arrives. */
    const env = newEnv();
    const tab = env.addTab({ id: 300, script: { onStart: 'silent' } });
    await startCapture(env, 300, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const mid = framesOf(env).length;
    await env.send({ type: 'FS_REGION_CANCEL' }, env.senderTab(tab));
    await pump(env);
    check('a cancel that lands on a live capture takes its frames with it',
      mid === 1 && framesOf(env).length === 0, mid + ' -> ' + framesOf(env).length);
  }
  {
    /* The structural half of the promise. The seven behaviour checks above can
       only see the paths they were told about; this one sees the path someone
       adds next year. Every place background.js takes a session OUT of the map
       either sealed its `captures` row first — the two success paths, whose
       frames belong to result.js from that moment on — or hands the session to
       dropFrames within a line or two of the delete. Read off the shipped
       source on purpose: a check that has to be told about a path cannot fail
       on the path nobody told it about. */
    const L = BG_SRC.split('\n');
    const sites = [], unguarded = [], sealed = [];
    L.forEach((line, i) => {
      if (line.indexOf('sessions.delete(') < 0) return;
      sites.push(i + 1);
      // A `captures` row written just above means the pixels are reachable from
      // the History page now, and deleting them would be the bug.
      if (/FSDB\.put\('captures'/.test(L.slice(Math.max(0, i - 12), i).join('\n'))) { sealed.push(i + 1); return; }
      /* Tight window on purpose: the drop belongs next to the delete, where the
         next reader of this function cannot miss that the two go together.
         retireSession counts as the drop: it IS the drop-and-tell shape — frames
         gone, note parked, mode named — its own body is on this same scan, and
         spelling dropFrames() beside it as well would delete the same range
         twice to satisfy a regex. */
      if (!/dropFrames\(|retireSession\(/.test(L.slice(Math.max(0, i - 2), i + 5).join('\n'))) unguarded.push(i + 1);
    });
    check('every place the worker abandons a session hands it to dropFrames',
      unguarded.length === 0, 'unguarded at background.js line(s) ' + JSON.stringify(unguarded));
    check('...and the only two exempt are the two that sealed a captures row first',
      sealed.length === 2, 'sealed-first at ' + JSON.stringify(sealed));
    check('...on a scan that really found the delete sites', sites.length >= 9, sites.length + ' sites');
  }

  /* ================= start failures ================= */
  console.log('\n=== start failures ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 41, blockInject: true });
    const res = await startCapture(env, tab.id, 'full');
    check('an unscriptable page reports the browser-restriction message',
      res && res.ok === false && res.error === 'This page cannot be captured (browser restriction).', JSON.stringify(res));
    check('a failed start leaves no session behind',
      ((await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(tab))) || {}).error === 'No active session', 'FS_FRAME');
    check('a failed start clears the badge', tail(env.badges).text === '', JSON.stringify(tail(env.badges)));
  }
  {
    const env = newEnv({ hooks: { inject: () => new Error('disk on fire') } });
    const tab = env.addTab();
    const res = await startCapture(env, tab.id, 'full');
    check('an unrecognised start failure gets the fixed could-not-start sentence',
      res && res.error === R_NO_START, JSON.stringify(res));
    check('...with the browser\'s own wording kept in the log, not in the answer',
      env.logs.some(l => /disk on fire/.test(l)), JSON.stringify(env.logs));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ script: { onStart: 'throw', throwMessage: 'The message port closed before a response was received.' } });
    const res = await startCapture(env, tab.id, 'full');
    check('a content script that blows up on FS_START is reported, not swallowed',
      res && res.ok === false && res.error === R_NO_START, JSON.stringify(res));
    check('...and the port message survives in the log',
      env.logs.some(l => /message port closed/.test(l)), JSON.stringify(env.logs));
  }
  {
    const env = newEnv();
    const res = await startCapture(env, 4242, 'full');
    // chrome.tabs.get throws inside the ROUTER's try, so this answer is the
    // router wrapper's to reduce — a tab id is not a url, but the rule is that
    // nothing the browser wrote reaches the popup unread.
    check('START_CAPTURE on a dead tab id answers with the generic sentence',
      res && res.ok === false && res.error === R_GENERIC, JSON.stringify(res));
    check('...and the browser\'s own wording is in the log',
      env.logs.some(l => /No tab with id: 4242/.test(l)), JSON.stringify(env.logs));
  }

  /* ================= keyboard shortcuts ================= */
  console.log('\n=== commands ===');
  {
    const MODES = { 'capture-full-page': 'content/capture.js', 'capture-region': 'content/region.js', 'capture-element': 'content/region.js' };
    for (const cmd of Object.keys(MODES)) {
      const env = newEnv();
      env.addTab({ id: 51, active: true, script: { onStart: 'silent', region: 'wait' } });
      fire(env.onCommand, cmd);
      await pump(env);
      check('shortcut ' + cmd + ' injects ' + MODES[cmd],
        env.injects.length === 1 && env.injects[0].files.join() === MODES[cmd], JSON.stringify(env.injects));
    }
  }
  {
    const env = newEnv();
    env.addTab({ id: 52, active: true });
    fire(env.onCommand, 'capture-visible');
    await pump(env);
    check('shortcut capture-visible captures without injecting',
      env.injects.length === 0 && env.shots.length === 1 && capturesOf(env).length === 1,
      env.injects.length + '/' + env.shots.length);
  }
  {
    const env = newEnv();
    env.addTab({ id: 53, active: true, windowId: 1 });
    env.addTab({ id: 54, active: false, windowId: 1 });
    env.addTab({ id: 55, active: true, windowId: 2 });   // another window
    fire(env.onCommand, 'capture-visible');
    await pump(env);
    check('a shortcut targets the active tab of the current window only',
      capturesOf(env).length === 1 && at(capturesOf(env), 0).url === (env.tabs.get(53) || {}).url, JSON.stringify(capturesOf(env).map(c => c.url)));
  }
  {
    const env = newEnv();
    env.addTab({ id: 56, active: true });
    fire(env.onCommand, 'capture-the-moon');
    await pump(env);
    check('an unmapped command does nothing at all',
      env.injects.length === 0 && env.shots.length === 0 && env.badges.length === 0, JSON.stringify(env.trace));
  }
  {
    const env = newEnv();                    // no tabs at all
    let threw = null;
    try { await fire(env.onCommand, 'capture-full-page'); } catch (e) { threw = String(e && e.message); }
    await pump(env);
    check('a shortcut with no active tab is a no-op, not a throw', threw === null && env.shots.length === 0, threw);
  }

  /* ================= delayed capture ================= */
  console.log('\n=== delay ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 61, script: { frames: 1 } });
    const m = env.mark();
    const p = env.send({ type: 'START_CAPTURE', tabId: 61, mode: 'full', startDelay: 3 }, env.fromPage());
    const res = await p;                                   // must answer before the countdown
    check('a delayed capture answers the popup immediately', res && res.ok === true, JSON.stringify(res));
    check('...before anything is injected', env.injects.length === 0, JSON.stringify(env.injects));
    await pump(env, { budget: 12000 });
    const b = env.badgesSince(m);
    check('the badge counts 3, 2, 1 then clears', b.slice(0, 4).join() === '3,2,1,', JSON.stringify(b));
    check('each countdown step is one second apart',
      at(env.badges, 1).at - at(env.badges, 0).at === 1000 && at(env.badges, 2).at - at(env.badges, 1).at === 1000,
      (at(env.badges, 1).at - at(env.badges, 0).at) + '/' + (at(env.badges, 2).at - at(env.badges, 1).at));
    check('the capture runs after the countdown', capturesOf(env).length === 1, capturesOf(env).length);
  }
  {
    /* R-20 — `ok` FROM HAVING BEEN ASKED. The delayed arm answered the popup
       ok:true and only THEN went and looked at the page, so a restricted url, a
       busy tab or a page the browser will not let us script was reported as a
       success the popup closed on — and the actual refusal reached the person
       as a 2.5 s badge flash plus a note they would read the NEXT time they
       opened the popup. Every question that refuses a capture can be answered
       without touching the tab, so the ordering is free: ask first, answer with
       the truth, and start the countdown after. */
    const env = newEnv();
    env.addTab({ id: 460, active: true, url: 'chrome://settings/' });
    const m = env.mark();
    const res = await startCapture(env, 460, 'full', 3);
    check('a delayed capture of a page the browser protects is refused, not acknowledged',
      res && res.ok === false && /Settings, Extensions/.test(String(res.error)), JSON.stringify(res));
    check('...and no countdown was ever put on the badge',
      env.badgesSince(m).indexOf('3') < 0, JSON.stringify(env.badgesSince(m)));
    check('...while the person still gets the note they would have got anyway',
      (env.session[ERR_KEY] || {}).message === 'Browser pages such as Settings, Extensions and the New Tab page are off limits to every extension. Try FullShot on a normal web page.',
      JSON.stringify(env.session[ERR_KEY]));
  }
  {
    const env = newEnv();
    env.addTab({ id: 461, active: true, script: { onStart: 'silent' } });
    await startCapture(env, 461, 'full');
    const res = await startCapture(env, 461, 'full', 3);
    check('a delayed capture in a tab that is already capturing is refused too',
      res && res.ok === false && res.error === 'A capture is already running in this tab.', JSON.stringify(res));
  }
  {
    /* CONTROL: the reason the answer came early in the first place. A delayed
       capture of an ordinary page must still answer before the countdown, or
       the popup sits open for three seconds waiting for it. */
    const env = newEnv();
    env.addTab({ id: 462, active: true, script: { frames: 1 } });
    const p = env.send({ type: 'START_CAPTURE', tabId: 462, mode: 'full', startDelay: 3 }, env.fromPage());
    const res = await p;
    check('CONTROL: an ordinary delayed capture is still acknowledged before it starts',
      res && res.ok === true && env.injects.length === 0 && env.shots.length === 0,
      JSON.stringify(res) + ' injects=' + env.injects.length);
    await pump(env, { budget: 12000 });
    check('...and still runs', capturesOf(env).length === 1, capturesOf(env).length);
  }

  /* ================= batch ================= */
  console.log('\n=== batch ===');
  {
    const env = newEnv({ script: { frames: 2 } });
    const urls = ['https://one.test/', 'https://two.test/', 'https://three.test/'];
    const res = await env.send({ type: 'BATCH_START', urls }, env.fromPage('pages/batch.html'));
    // runBatch is deliberately not awaited: the page gets its answer while the
    // queue is still on its first tab, long before any capture has happened.
    check('BATCH_START answers without waiting for the queue',
      res && res.ok === true && env.shots.length === 0 && env.creates.length < urls.length,
      JSON.stringify(res) + ' shots=' + env.shots.length + ' creates=' + env.creates.length);
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    /* FOUND IN CHROMIUM, NOT HERE (test/e2e/batch-artifact.mjs). runBatch handed
       startCapture the Tab that chrome.tabs.create answered with, and that Tab's
       `url` is empty until the navigation commits — so the very first question
       startCapture asks, "is this a url the browser reserves", was asked of ''.
       `isRestricted('')` is true. Every job in every queue was refused with "This
       page is protected by the browser and cannot be captured." before it took a
       single frame, and this tier could not see it because its fake answered
       with the url already in place. The page has to be re-read after it loads. */
    check('the page a job captures is read after it loaded, not from the create() snapshot',
      jobs.every(j => j.status === 'done') &&
      env.trace.filter(s => s.indexOf('tab.get:') === 0).length >= 3,
      JSON.stringify(jobs.map(j => j.status + (j.error ? ':' + j.error : ''))));
    check('one tab is opened per url, in order, active',
      jobCreates(env).length === 3 && jobCreates(env).map(c => c.url).join() === urls.join() &&
      jobCreates(env).every(c => c.active),
      JSON.stringify(jobCreates(env).map(c => c.url)));
    check('every job tab is closed again', jobRemoves(env).length === 3,
      JSON.stringify(env.removes.map(r => r.url)));
    check('all three jobs report done with a shot id',
      jobs.length === 3 && jobs.every(j => j.status === 'done' && j.shotId), JSON.stringify(jobs.map(j => j.status)));
    check('each reported shot id is the id the frames were stored under',
      jobs.every(j => env.trace.indexOf('db.put:frames:' + j.shotId + ':00000') >= 0), JSON.stringify(jobs.map(j => j.shotId)));

    /* ---- DONE MEANS THERE IS A SCREENSHOT (R-12) ----
       FS_DONE says the engine finished scrolling and the frames are on disk. It
       does NOT say a screenshot exists: the only thing in this product that
       turns frames into a `shots` row is pages/result.js, and the batch arm used
       to open no result page at all. So fifty urls produced fifty green ticks,
       fifty dead "open" links (pages/batch.js links result.html?shot=, which
       resolves against `shots`), an empty History, and N full-resolution
       captures on disk that no page can show and planSweep deliberately spares.
       The ticks were derived from the last MESSAGE of the capture; nothing ever
       looked at the artifact. */
    check('a job that reports done has left a screenshot behind',
      env.db.stores.shots.size === 3 && jobs.every(j => env.db.stores.shots.has(j.shotId)),
      env.db.stores.shots.size + ' shots for ' + JSON.stringify(jobs.map(j => j.shotId)));
    check('...and the raw frames and capture rows are gone, not orphaned on disk',
      framesOf(env).length === 0 && capturesOf(env).length === 0,
      framesOf(env).length + ' frames / ' + capturesOf(env).length + ' captures');
    check('the queue opens the result page for every job, and never in front of the user',
      env.creates.filter(c => c.url.indexOf(RESULT_URL) === 0).length === 3 &&
      env.creates.filter(c => c.url.indexOf(RESULT_URL) === 0).every(c => c.active === false),
      JSON.stringify(env.creates.filter(c => c.url.indexOf(RESULT_URL) === 0).map(c => c.url + ' active=' + c.active)));
    check('...and closes it again, so a queue of fifty does not leave fifty tabs',
      env.removes.filter(r => r.url.indexOf(RESULT_URL) === 0).length === 3 &&
      Array.from(env.tabs.values()).every(x => x.url.indexOf(RESULT_URL) !== 0),
      env.removes.filter(r => r.url.indexOf(RESULT_URL) === 0).length + ' closed / ' +
      Array.from(env.tabs.values()).map(x => x.url).join(','));
    check('the wait for the artifact asks whether the row exists, never for the pixels',
      env.reads.hasKey.length >= 3 && env.reads.getAll.indexOf('shots') < 0,
      'hasKey x' + env.reads.hasKey.length + ' | getAll: ' + env.reads.getAll.join(','));
    check('every job took its own frames (2 per job)', env.shots.length === 6, env.shots.length);
    check('the first broadcast shows every job pending',
      (((at(env.broadcasts, 0).batch || {}).jobs) || []).length === 3 &&
      ((at(env.broadcasts, 0).batch || {}).jobs || []).every(j => j.status === 'pending'),
      JSON.stringify(((at(env.broadcasts, 0).batch || {}).jobs || []).map(j => j.status)));
    check('the badge is cleared when the queue drains', tail(env.badges).text === '', JSON.stringify(tail(env.badges)));
    check('the queue breathes between tabs (>=300 ms after each job)',
      at(env.shots, 2).at - at(env.shots, 1).at >= 300 + 550, (at(env.shots, 2).at - at(env.shots, 1).at) + 'ms');
  }
  {
    /* THE OTHER HALF OF R-12, and the one that decides whether the fix is a fix
       or just a different lie. Opening the result page with active:false is the
       part of this design with a named risk on it: Chrome throttles background
       tabs, and the stitcher does canvas work across awaits. If that risk lands,
       the row never appears — and the ONLY acceptable outcome is that the job
       says so. A tick over a screenshot that does not exist is the bug; a tick
       over a screenshot that does not exist because the tab was throttled is
       the same bug with an excuse. */
    const env = newEnv({ script: { frames: 2 }, stitch: 'never' });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 400000 });
    const jobs = jobsOf(env);
    check('a job whose screenshot never appears is not reported done',
      at(jobs, 0).status === 'error' && !at(jobs, 0).shotId,
      JSON.stringify(at(jobs, 0)));
    check('...and the frames it did take are left alone rather than thrown away',
      framesOf(env).length === 2 && capturesOf(env).length === 1,
      framesOf(env).length + ' frames / ' + capturesOf(env).length + ' captures');
    check('...and the tab it was waiting on is closed anyway',
      Array.from(env.tabs.values()).every(x => x.url.indexOf(RESULT_URL) !== 0),
      Array.from(env.tabs.values()).map(x => x.url).join(','));
  }
  {
    /* A stitch that starts and dies is the same answer as one that never runs:
       there is no screenshot, so there is nothing to report done. */
    const env = newEnv({ script: { frames: 1 }, stitch: 'throw' });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 400000 });
    const jobs = jobsOf(env);
    check('a stitch that dies part way fails the job rather than ticking it',
      jobs.length === 2 && jobs.every(j => j.status === 'error'), JSON.stringify(jobs.map(j => j.status)));
    check('...in a sentence pages/batch.js already has a translation for',
      jobs.every(j => j.error === 'capture failed'), JSON.stringify(jobs.map(j => j.error)));
    check('...and the queue still reaches the end', env.creates.filter(c => /\.test\/$/.test(c.url)).length === 2,
      JSON.stringify(env.creates.map(c => c.url)));
  }
  {
    /* CONTROL FOR BOTH OF THE ABOVE. A fix that makes the queue pessimistic
       everywhere is not a fix: the ordinary run must still tick, and the tick
       must still carry the id History opens. */
    const env = newEnv({ script: { frames: 2 } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 400000 });
    const jobs = jobsOf(env);
    check('CONTROL: an ordinary queue still reports every job done',
      jobs.length === 2 && jobs.every(j => j.status === 'done' && !j.error), JSON.stringify(jobs.map(j => j.status)));
    check('...and every id it reports opens something in History',
      jobs.every(j => env.db.stores.shots.has(j.shotId)) && env.db.stores.shots.size === 2,
      env.db.stores.shots.size + ' shots');
  }
  {
    // skip-on-error: the middle url is unscriptable. The queue must not stall.
    const env = newEnv({ script: { frames: 1 } });
    const orig = env.chrome.tabs.create;
    env.chrome.tabs.create = async props => {
      const tab = await orig.call(env.chrome.tabs, props);
      if (/two\.test/.test(props.url)) env.tabs.get(tab.id).blockInject = true;
      return tab;
    };
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/', 'https://three.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('skip-on-error: a failing job does not stop the queue',
      jobs.map(j => j.status).join() === 'done,error,done', JSON.stringify(jobs.map(j => j.status)));
    check('the failed job records the reason', at(jobs, 1).error === 'This page cannot be captured (browser restriction).', at(jobs, 1).error);
    check('all three tabs were still opened and closed',
      jobCreates(env).length === 3 && jobRemoves(env).length === 3,
      jobCreates(env).length + '/' + jobRemoves(env).length);
    check('the job after the failure really captured',
      at(jobs, 2).shotId && env.trace.indexOf('db.put:frames:' + at(jobs, 2).shotId + ':00000') >= 0, at(jobs, 2).shotId);
  }
  {
    const env = newEnv({ script: { onStart: 'error', error: 'the engine gave up' } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('an FS_ERROR mid-job fails that job with a sentence, not the engine text',
      jobs.every(j => j.status === 'error' && j.error === R_GENERIC), JSON.stringify(jobs.map(j => j.error)));
    check('...and the queue still reaches the end', jobs.length === 2 && env.creates.length === 2, env.creates.length);
  }
  {
    const env = newEnv({ script: { onStart: 'silent' } });
    const t0 = env.clock.now();
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 400000 });
    const jobs = jobsOf(env);
    check('a job that never finishes is timed out',
      at(jobs, 0).status === 'error' && at(jobs, 0).error === 'capture timed out', JSON.stringify(at(jobs, 0)));
    check('the timeout is the declared 90 s cap, not sooner',
      env.clock.now() - t0 >= 90000 && env.clock.now() - t0 < 130000, (env.clock.now() - t0) + 'ms');
    check('the abandoned tab is still closed', env.trace.filter(s => s.indexOf('tab.remove:') === 0).length === 1, 'removes');
  }
  {
    const env = newEnv({ script: { frames: 1 }, newTabStatus: 'loading' });
    await env.send({ type: 'BATCH_START', urls: ['https://slow.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 2000 });
    check('the queue waits for the tab to finish loading', env.injects.length === 0, JSON.stringify(env.injects));
    const id = at(Array.from(env.tabs.values()).filter(x => x.url === 'https://slow.test/'), 0).id;
    env.onUpdated._l.slice().forEach(f => f(id, { status: 'complete' }, {}));
    await pump(env, { budget: 120000 });
    check('...and proceeds once it completes', env.injects.length === 1 && env.shots.length === 1, env.injects.length + '/' + env.shots.length);
  }
  {
    const env = newEnv({ script: { frames: 1 }, newTabStatus: 'loading' });
    const t0 = env.clock.now();
    await env.send({ type: 'BATCH_START', urls: ['https://never.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 400000 });
    // Two-sided, like the 90 s job cap at the check above: a one-sided `>=` is
    // satisfied by a cap raised tenfold, which is the failure it exists to
    // catch. The upper bound leaves room for the 600 ms settle and one frame.
    check('a tab that never completes proceeds anyway after the 30 s load cap',
      env.shots.length === 1 && env.clock.now() - t0 >= 30000 && env.clock.now() - t0 < 45000,
      (env.clock.now() - t0) + 'ms');
  }
  {
    const env = newEnv({ script: { frames: 1 } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await env.send({ type: 'BATCH_START', urls: ['https://three.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    check('a second BATCH_START while one is running is ignored',
      jobCreates(env).length === 2 && env.creates.every(c => !/three/.test(c.url)),
      JSON.stringify(jobCreates(env).map(c => c.url)));
  }
  {
    const env = newEnv({ script: { frames: 1 }, hasBatchPage: false });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    check('a closed batch page (rejected broadcast) does not derail the queue',
      env.shots.length === 1 && env.db.stores.shots.size === 1,
      env.shots.length + ' frames shot / ' + env.db.stores.shots.size + ' screenshots');
  }
  {
    const env = newEnv({ script: { frames: 1 } });
    await env.send({ type: 'BATCH_START', urls: ['chrome://settings/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('a restricted url reaching the queue fails that job, not the worker',
      at(jobs, 0).status === 'error' && /Settings, Extensions/.test(String(at(jobs, 0).error)),
      JSON.stringify(at(jobs, 0)));
  }
  {
    const env = newEnv();
    const res = await env.send({ type: 'BATCH_START' }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 10000 });
    check('BATCH_START with no urls answers ok and opens nothing',
      res && res.ok === true && env.creates.length === 0, JSON.stringify(res));
  }

  /* ================= the last-failure surface ================= */
  /* The badge clears itself after 2.5 s and a shortcut capture has no popup
     listening for the return value, so a failure that is only badged is a
     failure the user can never act on. */
  console.log('\n=== error surface ===');
  {
    const env = newEnv();
    const t0 = env.clock.now();
    const tab = env.addTab({
      id: 71, title: 'Order 4417',
      url: 'https://shop.example.com/orders/4417?token=SEKRIT&email=ada%40example.com',
      script: { onStart: 'error', error: 'the page never stopped growing' }
    });
    const m = env.mark();
    await startCapture(env, tab.id, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('an engine failure is parked where the popup can read it',
      rec.message === R_GENERIC, JSON.stringify(rec));
    check('the note says what was attempted and in which tab',
      rec.mode === 'full' && rec.tabId === 71, rec.mode + '/' + rec.tabId);
    check('the note is stamped with the time it happened',
      rec.when >= t0 && rec.when <= env.clock.now(), rec.when + ' in [' + t0 + ',' + env.clock.now() + ']');
    check('the note keeps the ORIGIN only, never the path or the query',
      rec.origin === 'https://shop.example.com', rec.origin);
    check('nothing personal from the url reaches storage',
      (ERR_KEY in env.session) && !/SEKRIT|ada|4417|orders/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
    check('the note goes to storage.session — not sync, not local',
      env.since(m).some(s => s === 'session.set:' + ERR_KEY) &&
      !(ERR_KEY in env.sync) && !(ERR_KEY in env.local),
      JSON.stringify(env.since(m).filter(s => s.indexOf('session.') === 0)));
    check('parking the note takes no network call', env.network.length === 0, JSON.stringify(env.network));
  }
  {
    // Each blocked family says what it is and what to do instead. Anonymous
    // refusal is the whole finding; a bare "protected page" is the old answer.
    const FAMILIES = [
      ['chrome://settings/', /Settings, Extensions/],
      ['edge://flags', /Settings, Extensions/],
      ['brave://settings', /Settings, Extensions/],
      ['about:blank', /Settings, Extensions/],
      ['devtools://devtools/bundled/inspector.html', /DevTools/],
      ['view-source:https://example.com/', /View-source/],
      ['chrome-extension://abcdefg/page.html', /Extension pages/],
      ['moz-extension://abc/x.html', /Extension pages/],
      ['https://chromewebstore.google.com/detail/foo', /Web Store/],
      ['https://chrome.google.com/webstore/category/extensions', /Web Store/]
    ];
    const env = newEnv();
    let specific = 0, generic = null, raw = null, parked = 0;
    for (const pair of FAMILIES) {
      const tab = env.addTab({ url: pair[0] });
      const res = await startCapture(env, tab.id, 'full');
      const said = String((res && res.error) || '');
      if (pair[1].test(said)) specific++; else if (!generic) generic = pair[0] + ' -> ' + said;
      if (/:\/\/|"|\bundefined\b/.test(said)) raw = pair[0] + ' -> ' + said;
      if (pair[1].test(String((env.session[ERR_KEY] || {}).message))) parked++;
    }
    check('every blocked family is refused with its own reason', specific === FAMILIES.length, generic || specific + '/' + FAMILIES.length);
    check('no refusal leaks a url or a scheme into the sentence', raw === null, raw);
    check('every refusal is parked for the popup too', parked === FAMILIES.length, parked + '/' + FAMILIES.length);
  }
  {
    const env = newEnv();
    const tab = env.addTab({ url: undefined });
    const res = await startCapture(env, tab.id, 'full');
    check('a tab with no url still gets the shipped generic sentence',
      res.error === 'This page is protected by the browser and cannot be captured.', res.error);
    check('...parked with an empty origin rather than a broken one',
      (env.session[ERR_KEY] || {}).origin === '', JSON.stringify(env.session[ERR_KEY]));
  }
  {
    /* "Scheme and host only" has to mean it. Userinfo sits in the authority, so
       a capture group that stops at the first slash keeps the password — the
       one thing in a url worse than the order number the reduction exists to
       drop. Reachable because tabs.create hands back the url as ASKED FOR:
       the batch runner captures that snapshot before the browser has
       normalised anything away. */
    const CREDS = [
      ['https://ada:hunter2@intranet.example.org/hr/pay?who=ada', 'https://intranet.example.org'],
      ['https://ada%40corp.com:t0ken@mail.example/inbox',         'https://mail.example'],
      ['https://token-abc123@api.example.com/v1/me',              'https://api.example.com'],
      // The LAST '@' separates userinfo from host, so an '@' inside the userinfo
      // must not be mistaken for the separator and leave the real host behind.
      ['https://user@name:pw@evil.example/p',                     'https://evil.example'],
      ['https://ada:hunter2@intranet.example.org:8443/hr',        'https://intranet.example.org:8443']
    ];
    const env = newEnv();
    let ok = 0, bad = null, leaked = null;
    for (const [url, want] of CREDS) {
      const tab = env.addTab({ url, blockInject: true });
      await startCapture(env, tab.id, 'element');
      const got = (env.session[ERR_KEY] || {}).origin;
      if (got === want) ok++; else if (!bad) bad = url + ' -> ' + got;
      if (/hunter2|t0ken|abc123|:pw@|%40/.test(JSON.stringify(env.session))) leaked = url;
    }
    check('originOf drops the userinfo, keeping scheme and host only', ok === CREDS.length, bad || ok + '/' + CREDS.length);
    check('no embedded credential reaches storage', leaked === null, leaked);
  }
  {
    // The control for the reduction above: an '@' is legal in a PATH, where it
    // is not userinfo at all and the host still ends at the first slash.
    const env = newEnv();
    const tab = env.addTab({ url: 'https://social.example/@ada/posts/17?draft=1', blockInject: true });
    await startCapture(env, tab.id, 'element');
    check('an @ in the path is not mistaken for userinfo',
      (env.session[ERR_KEY] || {}).origin === 'https://social.example', JSON.stringify(env.session[ERR_KEY]));
  }
  {
    /* originOf() finds the authority with a character class, which is the shape
       that failed twice on the MESSAGE field — so it gets the same battery of
       inputs, and these checks are the record of why it is not the same hazard.
       The class there was POSITIVE and had to find a url inside prose in order
       to replace it, so a character it did not know ended the match early and
       left the rest of the sentence, token and all, in the output: it failed
       OPEN. The class here is NEGATED and the function EXTRACTS A PREFIX — it
       stops at the first '/', '?' or '#', which is exactly the set RFC 3986
       allows to end an authority, and everything past that point is discarded
       rather than carried. A character it mishandles can only truncate the
       origin. There is no third answer, whatever is in the path. */
    const AUTHORITY = [
      // the exact character that beat attempt 2, now sitting in a path
      ["https://shop.example/orders/o'brien/receipt?token=SECRET7&card=4111", 'https://shop.example'],
      ['https://shop.example/my orders/r?token=SPACERAW', 'https://shop.example'],
      ['https://shop.example/my%20orders/r?token=SPACEPCT', 'https://shop.example'],
      ['https://shop.example/or"ders/r?token=DQUOTE9', 'https://shop.example'],
      ['https://shop.example/or`ders/r?token=TICK9', 'https://shop.example'],
      ['https://shop.example/or<ders>/r?token=ANGLE9', 'https://shop.example'],
      ['https://shop.example/orders;jsessionid=SEMI9/r', 'https://shop.example'],
      ['https://shop.example/ordrés/naïve/r?token=UNI9', 'https://shop.example'],
      // no path at all: the query and the fragment are the first delimiter
      ['https://shop.example?token=NOPATH9', 'https://shop.example'],
      ['https://shop.example#tok=HASH9', 'https://shop.example'],
      // the user's own folder tree — a url with an empty authority
      ['file:///C:/Users/ada/Documents/tax-2024.pdf', 'file://'],
      // schemes with no authority to find: the scheme is the whole answer
      ['data:text/html,<b>DATA9</b>', 'data:'],
      ['javascript:void(0)/*JS9*/', 'javascript:'],
      ['blob:https://shop.example/uuid-BLOB9', 'blob:'],
      // not a url: nothing recognised, nothing kept
      ['not a url at all TOKEN9', '']
    ];
    const env = newEnv();
    let ok = 0, bad = null, leaked = null;
    const origins = [];
    for (const [url, want] of AUTHORITY) {
      const tab = env.addTab({ url, blockInject: true });
      await startCapture(env, tab.id, 'element');
      const got = (env.session[ERR_KEY] || {}).origin;
      origins.push(got);
      if (got === want) ok++; else if (!bad) bad = url + ' -> ' + JSON.stringify(got);
      if (/SECRET7|4111|SPACERAW|SPACEPCT|DQUOTE9|TICK9|ANGLE9|SEMI9|UNI9|NOPATH9|HASH9|Users|ada|tax-2024|DATA9|JS9|BLOB9|TOKEN9/
        .test(JSON.stringify(env.session))) leaked = url;
    }
    check('originOf keeps a prefix and drops everything from the first / ? or #',
      ok === AUTHORITY.length, bad || ok + '/' + AUTHORITY.length);
    check('...so no path, query or fragment from any of them reaches the note', leaked === null, leaked);
    // The property behind the table: whatever comes out is scheme, or scheme
    // plus one authority — never a shape with somewhere left to hide a token.
    check('...and every origin it produces is that shape and no other',
      origins.every(o => o === '' || /^[a-z][a-z0-9+.-]*:(\/\/[^/?#]*)?$/i.test(o)), JSON.stringify(origins));
  }
  {
    // The sharpest edge of that finding: the shortcut listener used to throw
    // startCapture's return value away, and a capture fired from a keystroke has
    // no popup listening and a badge that clears itself — so a failure said
    // nothing at all, anywhere. The parked note is the whole answer to it.
    const env = newEnv();
    env.addTab({ id: 81, active: true, url: 'chrome://settings/' });
    fire(env.onCommand, 'capture-full-page');
    await pump(env);
    check('a keyboard shortcut that fails is no longer silent',
      /Settings, Extensions/.test(String((env.session[ERR_KEY] || {}).message)), JSON.stringify(env.session[ERR_KEY]));
  }
  {
    const env = newEnv();
    // element mode injects content/region.js, so an unscriptable page fails at
    // the injection — visible mode injects nothing and would never get there.
    const tab = env.addTab({ id: 72, url: 'https://intranet.example.org/hr/pay?who=ada', blockInject: true });
    await startCapture(env, tab.id, 'element');
    const rec = env.session[ERR_KEY] || {};
    check('a page that cannot be scripted parks the browser-restriction reason',
      rec.message === 'This page cannot be captured (browser restriction).', rec.message);
    check('...against the origin of the page that failed, and the mode tried',
      rec.origin === 'https://intranet.example.org' && rec.mode === 'element', rec.origin + '/' + rec.mode);
  }
  {
    const env = newEnv({ hooks: { capture: () => new Error('Cannot access contents of the page at "https://x/s?tok=1".') } });
    const tab = env.addTab({ id: 73, url: 'https://intranet.example.org/hr/pay?who=ada', script: { region: 'select' } });
    await startCapture(env, tab.id, 'region');
    const rec = env.session[ERR_KEY] || {};
    check('a crash inside the router parks a plain sentence, not the exception',
      /^[A-Z].*\.$/.test(String(rec.message)) && !/Cannot access|tok=1|"/.test(String(rec.message)), rec.message);
    check('...and still names the mode the user actually picked', rec.mode === 'region', rec.mode);
    // content/capture.js throws "Capture aborted" the moment FS_ABORT lands, so
    // the echo must not bury the reason that caused the abort in the first place.
    await env.send({ type: 'FS_ERROR', error: 'Capture aborted' }, env.senderTab(tab));
    await pump(env);
    const after = (env.session[ERR_KEY] || {}).message;
    check('the abort echo does not overwrite the reason that caused it',
      typeof after === 'string' && after === rec.message, JSON.stringify(env.session[ERR_KEY]));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 74 });
    await env.send({ type: 'FS_ERROR', error: 'Frame capture failed' }, env.senderTab(tab));
    await pump(env);
    check('the engine\'s log wording is turned into something a person can act on',
      /try again/i.test(String((env.session[ERR_KEY] || {}).message)) &&
      !/^Frame capture failed$/.test(String((env.session[ERR_KEY] || {}).message)),
      JSON.stringify(env.session[ERR_KEY]));
  }
  {
    const env = newEnv();
    const a = env.addTab({ url: 'https://one.test/a', script: { onStart: 'error', error: 'first failure' } });
    await startCapture(env, a.id, 'full');
    const b = env.addTab({ url: 'https://two.test/b', script: { onStart: 'error', error: 'second failure' } });
    await startCapture(env, b.id, 'full');
    // Both sentences collapse to the same generic one, so the ORIGIN is what
    // says which of the two failures the surviving note belongs to.
    check('only the last failure is kept — the note never accumulates',
      Object.keys(env.session).length === 1 && (env.session[ERR_KEY] || {}).origin === 'https://two.test',
      JSON.stringify(env.session));
  }
  {
    const env = newEnv();
    env.session[ERR_KEY] = { when: env.clock.now() - 60000, mode: 'full', origin: 'https://old.example', tabId: 5, message: 'an older failure nobody resolved' };
    const tab = env.addTab({ script: { frames: 2 } });
    const m = env.mark();
    await startCapture(env, tab.id, 'full');
    check('a capture that works clears the stale note',
      !(ERR_KEY in env.session), JSON.stringify(env.session));
    check('...by removing the key, not by parking an empty note',
      env.since(m).some(s => s === 'session.remove:' + ERR_KEY), JSON.stringify(env.since(m).filter(s => s.indexOf('session.') === 0)));
  }
  {
    const env = newEnv();
    env.session[ERR_KEY] = { when: env.clock.now(), mode: 'full', origin: 'https://old.example', tabId: 5, message: 'an older failure nobody resolved' };
    const tab = env.addTab({ id: 75, script: { region: 'select' } });
    await startCapture(env, tab.id, 'element');
    check('a region/element capture that works clears it too', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ script: { frames: 1 } });
    await startCapture(env, tab.id, 'full');
    check('a capture that works never parks a failure of its own',
      Object.keys(env.session).length === 0, JSON.stringify(env.session));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ script: { region: 'cancel' } });
    await startCapture(env, tab.id, 'region');
    check('a human pressing escape is not a failure', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ script: { onStart: 'silent' } });
    await startCapture(env, tab.id, 'full');
    await startCapture(env, tab.id, 'full');
    check('"already running" is a nudge, not a failure to park', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }

  /* ================= one note per capture (P-17) ================= */
  /* A mid-flight failure is reported TWICE, and the second report is worse than
     the first. The path that still holds the session parks a note that knows
     which mode the user asked for; the engine then echoes its own reason back as
     FS_ERROR, by which time the session has been released — so that handler has
     nothing left to ask, files the same failure again as a plain 'capture', and
     OVERWRITES the accurate note. It happens at the one moment the note is the
     only thing the user has.

     The first defence was a string match on the two echoes someone had actually
     seen. Every other mid-flight throw walked straight past it, which is what
     this section is: the rule has to be about the CAPTURE, not about the words.

     Every check below counts session.set calls rather than reading the store,
     because "how many notes were parked" and "what is in the store now" are
     different questions — an overwrite leaves one key behind either way. */
  console.log('\n=== one note per capture ===');
  /* How many notes were parked since mark `m`. */
  const notesSince = (env, m) => env.since(m).filter(s => s === 'session.set:' + ERR_KEY).length;
  /* The wrong-tab refusal, spelled out here rather than read out of the worker —
     it is one of the two messages the old string match knew by name. */
  const WRONG_TAB_TEXT = 'Capture stopped — you switched tabs. Keep this page in front until FullShot finishes.';
  {
    const env = newEnv({ hooks: { capture: () => new Error('the display server went away') } });
    env.addTab({ id: 61, url: 'https://docs.example.com/spec', script: { frames: 3 } });
    const m = env.mark();
    await startCapture(env, 61, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('a mid-flight throw parks exactly ONE note',
      notesSince(env, m) === 1, notesSince(env, m) + ' notes parked for one failure');
    check('...and it says the mode the user asked for, not the echo\'s fallback',
      rec.mode === 'full', rec.mode);
  }
  {
    /* The same claim stated as an identity: whatever the engine says next, the
       note that is already parked must come out the far side untouched. Driven by
       hand so the note can be read BETWEEN the two writes. */
    const env = newEnv({ hooks: { capture: () => new Error('Cannot access contents of the page.') } });
    const tab = env.addTab({ id: 62, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 62, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    await pump(env);
    const before = JSON.stringify(env.session[ERR_KEY]);
    const m = env.mark();
    await env.send({ type: 'FS_ERROR', error: 'the page never stopped growing' }, env.senderTab(tab));
    await pump(env);
    check('the echo leaves a parked note byte-identical',
      JSON.stringify(env.session[ERR_KEY]) === before,
      before + '  ->  ' + JSON.stringify(env.session[ERR_KEY]));
    check('...because it parks no second note at all', notesSince(env, m) === 0, notesSince(env, m));
  }
  {
    /* The rule has to be general or it is the old defence with more rows in it.
       One parked note, eight different echoes: the two the string match knew by
       name, and six it had never seen — including the empty string and a sentence
       carrying a url, which are the two shapes most likely to be handled
       specially by someone patching this again. */
    const ECHOES = [
      'Capture aborted', WRONG_TAB_TEXT,
      'Frame capture failed', 'No active session', 'the page never stopped growing', '',
      'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded',
      'Cannot access contents of url "https://shop.example/o?token=ECHO9".'
    ];
    let overwrote = null, extra = 0;
    for (const echo of ECHOES) {
      const env = newEnv({ hooks: { capture: () => new Error('the display server went away') } });
      const tab = env.addTab({ id: 65, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
      await startCapture(env, 65, 'full');
      await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
      await pump(env);
      const before = JSON.stringify(env.session[ERR_KEY]);
      const m = env.mark();
      await env.send({ type: 'FS_ERROR', error: echo }, env.senderTab(tab));
      await pump(env);
      extra += notesSince(env, m);
      if (JSON.stringify(env.session[ERR_KEY]) !== before && !overwrote) {
        overwrote = JSON.stringify(echo) + ' -> ' + JSON.stringify(env.session[ERR_KEY]);
      }
      if (/ECHO9|shop\.example/.test(JSON.stringify(env.session))) overwrote = overwrote || 'ECHO9 reached storage';
    }
    check('every echo is answered by the same rule, named or not',
      extra === 0 && overwrote === null, overwrote || extra + ' second notes across 8 echoes');
  }
  {
    /* The tell that the general rule is the right one: the two messages the old
       defence matched by name are ordinary instances of it now, so their names
       are gone from the handler. A name-match left in place BESIDE a general rule
       is two mechanisms where one is needed, and the next hand cannot tell which
       one is load-bearing. Comments are stripped first — a check that can be
       satisfied by prose is grading the documentation, not the code. */
    const bare = fs.readFileSync(BG_PATH, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const body = (/case 'FS_ERROR':[\s\S]*?\n {8}}/.exec(bare) || [''])[0];
    check('the FS_ERROR handler matches no engine message by name',
      body !== '' && !/Capture aborted|WRONG_TAB/.test(body),
      body === '' ? 'FS_ERROR case not found in background.js' : (body.match(/Capture aborted|WRONG_TAB/g) || []).join(','));
  }
  {
    /* THE HAZARD THE FIX MUST NOT INTRODUCE. A mark that outlives its capture
       gags a note the user is owed, and silence is worse than the duplicate it
       replaced: the duplicate at least said something. A tab can start another
       capture the instant the first one fails, so the second capture's own
       failure has to be reported in full. */
    const env = newEnv({ hooks: { capture: () => new Error('Cannot access contents of the page.') } });
    const tab = env.addTab({ id: 63, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 63, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    await pump(env);
    await env.send({ type: 'FS_ERROR', error: 'Capture aborted' }, env.senderTab(tab));
    await pump(env);
    const first = String((env.session[ERR_KEY] || {}).message);
    // The user shrugs and tries again; this one dies on its own, with its session
    // still live, so its FS_ERROR is the only report it will ever get.
    env.tabs.get(63).script = { onStart: 'error', error: 'the second capture died on its own' };
    const m = env.mark();
    await startCapture(env, 63, 'full');
    check('a second capture in the same tab still parks its own note',
      notesSince(env, m) === 1, notesSince(env, m) + ' notes parked for the second capture');
    check('...and the note the user is left with is the second failure, not the first',
      (env.session[ERR_KEY] || {}).message === R_GENERIC && first !== R_GENERIC,
      JSON.stringify(first) + '  ->  ' + JSON.stringify((env.session[ERR_KEY] || {}).message));
  }
  {
    /* The third path that parks a note: startCapture's own catch. It is reachable
       with the engine ALREADY RUNNING — Chrome delivers FS_START, capture.js
       answers it, and the port then closes before the answer gets back, which
       rejects the send while run() carries on and eventually reports its own
       failure. So this note gets an echo behind it like any other, and the teeth
       pass is what found it: removing the mark here bit nothing until this rig
       existed. */
    const env = newEnv();
    const tab = env.addTab({ id: 70, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    env.hooks.sendMessage = (id, msg) => (msg.type === 'FS_START'
      ? { rejectAfter: 400, error: 'The message port closed before a response was received.' } : null);
    const p = env.send({ type: 'START_CAPTURE', tabId: 70, mode: 'full', startDelay: 0 }, env.fromPage());
    await pump(env, { budget: 2000 });
    const res = await p;
    const parked = String((env.session[ERR_KEY] || {}).message);
    check('a send that dies after delivery still parks a note startCapture owns',
      res && res.ok === false && parked === R_NO_START, JSON.stringify(res) + ' / ' + JSON.stringify(parked));
    const m = env.mark();
    await env.send({ type: 'FS_ERROR', error: 'Capture aborted' }, env.senderTab(tab));
    await pump(env);
    check('...and the engine still reporting behind it does not overwrite that note',
      notesSince(env, m) === 0 && (env.session[ERR_KEY] || {}).message === parked,
      notesSince(env, m) + ' notes / ' + JSON.stringify((env.session[ERR_KEY] || {}).message));
  }
  {
    /* The same hazard, reached the hard way. startCapture's catch can hold a
       session the map has ALREADY replaced — the file guards exactly that
       staleness with its `live` check before it drops frames — so a note parked by
       a superseded capture must not speak for the capture that replaced it. The
       rig: capture one is still waiting on FS_START when the page navigates
       (dropping its session) and the user starts a second capture; capture one's
       send then rejects, and only THEN does capture two fail. */
    const env = newEnv();
    const tab = env.addTab({ id: 64, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    env.hooks.sendMessage = (id, msg) => (msg.type === 'FS_START' ? { rejectAfter: 400 } : null);
    const m0 = env.mark();
    const p1 = env.send({ type: 'START_CAPTURE', tabId: 64, mode: 'full', startDelay: 0 }, env.fromPage());
    await pump(env, { budget: 100 });                      // capture one is inside its own try
    fire(env.onUpdated, 64, { status: 'loading' }, tab);    // the page navigates out from under it
    env.hooks.sendMessage = null;
    env.tabs.get(64).script = { region: 'wait' };
    const p2 = env.send({ type: 'START_CAPTURE', tabId: 64, mode: 'region', startDelay: 0 }, env.fromPage());
    await pump(env, { budget: 100 });                      // capture two is now this tab's capture
    await pump(env, { budget: 2000 });                      // ...and only now does capture one give up
    await p1; await p2;
    const tr = env.since(m0);
    const mid = String((env.session[ERR_KEY] || {}).message);
    /* lastIndexOf, not indexOf: the navigation that supersedes capture one now
       parks a note of its own on the way past (a page that moves out from under a
       capture is a failure the user is owed), so the note this rig is about — the
       one capture one's send rejection parks — is the LAST one, not the first. */
    check('the rig really did supersede capture one before it failed',
      mid === R_NO_START &&
      tr.indexOf('inject:64:content/region.js') >= 0 &&
      tr.indexOf('inject:64:content/region.js') < tr.lastIndexOf('session.set:' + ERR_KEY),
      JSON.stringify(mid) + ' ' + JSON.stringify(tr.filter(s => /inject:64|session\.set/.test(s))));
    const m = env.mark();
    await env.send({ type: 'FS_ERROR', error: 'the second capture died on its own' }, env.senderTab(tab));
    await pump(env);
    check('a note from a superseded capture does not gag the one that replaced it',
      notesSince(env, m) === 1 && (env.session[ERR_KEY] || {}).message === R_GENERIC,
      notesSince(env, m) + ' notes / ' + JSON.stringify((env.session[ERR_KEY] || {}).message));
  }
  {
    /* Closing the tab must NOT reopen the door. A message already in flight when
       the tab went is still the same echo about the same capture, and the note
       parked before it is still the accurate one — so the mark outlives the tab
       on purpose, and is only ever retired by the next capture in it. */
    const env = newEnv({ hooks: { capture: () => new Error('Cannot access contents of the page.') } });
    const tab = env.addTab({ id: 68, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 68, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    await pump(env);
    fire(env.onRemoved, 68, {});
    const m = env.mark();
    await env.send({ type: 'FS_ERROR', error: 'Frame capture failed' }, env.senderTab(tab));
    await pump(env);
    check('closing the tab does not reopen the door the mark closed',
      notesSince(env, m) === 0, notesSince(env, m) + ' notes after the tab closed');
  }
  {
    /* The mark is worker memory on purpose, so there is nothing to sweep at
       startup: MV3 tears the worker down and a capture cannot outlive the worker
       driving it. What must not happen is a suppression carried into a fresh
       worker, where the note it was protecting may no longer even exist. */
    const env = newEnv({ hooks: { capture: () => new Error('Cannot access contents of the page.') } });
    const tab = env.addTab({ id: 69, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 69, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    await pump(env);
    env.suspend(); boot(env);                              // evicted, then woken again
    const m = env.mark();
    await env.send({ type: 'FS_ERROR', error: 'the page never stopped growing' }, env.senderTab(tab));
    await pump(env);
    check('a restarted worker suppresses nothing — it starts with no marks',
      notesSince(env, m) === 1, notesSince(env, m) + ' notes after the restart');
  }

  /* ================= the allowlist ================= */
  /* The message field is the second door into the note that originOf() closed on
     the url field: Chrome refuses a host by quoting the WHOLE url back, and the
     engine hands a refused frame's own reason straight on (capture.js:1586).
     Two attempts tried to SANITISE that text on the way through. The second
     reduced any url a regex could find down to its origin, and a reviewer beat
     it with an apostrophe in the path — the character class stopped at the
     quote, so everything behind it, token included, stayed in the sentence. A
     third character class is the same mistake a third time.
     So nothing is sanitised any more. A reason is RECOGNISED — a sentence this
     product wrote, or an engine wording it has a translation for — or it becomes
     ONE generic sentence. These checks are that claim: every hostile shape below
     has to come out as the SAME sentence, whatever is inside it. */
  console.log('\n=== the allowlist ===');
  {
    /* Chrome's own host refusal is the sentence that carries the url. */
    const refusal = u => 'Cannot access contents of url "' + u +
      '". Extension manifest must request permission to access this host.';
    /* [ what makes it hard, the engine string, fragments that must not survive ].
       Each row is a character the last regex either mishandled or never saw. */
    const HOSTILE = [
      ['an apostrophe in the path — the url that defeated attempt 2',
        refusal("https://shop.example/orders/o'brien/receipt?token=SECRET7&card=4111"),
        ["o'brien", 'receipt', 'SECRET7', '4111']],
      ['a raw space in the path',
        refusal('https://shop.example/my orders/r?token=SPACERAW'), ['my orders', 'SPACERAW']],
      ['a percent-encoded space',
        refusal('https://shop.example/my%20orders/r?token=SPACEPCT'), ['my%20orders', 'SPACEPCT']],
      ['a double quote in the path',
        refusal('https://shop.example/or"ders/r?token=DQUOTE9'), ['or"ders', 'DQUOTE9']],
      ['an angle bracket in the path',
        refusal('https://shop.example/or<ders>/r?token=ANGLE9'), ['or<ders>', 'ANGLE9']],
      ['a backtick in the path',
        refusal('https://shop.example/or`ders/r?token=TICK9'), ['or`ders', 'TICK9']],
      ['a semicolon in the path',
        refusal('https://shop.example/orders;jsessionid=SEMI9/r'), ['jsessionid', 'SEMI9']],
      ['a unicode character in the path',
        refusal('https://shop.example/ordrés/naïve/r?token=UNI9'), ['ordrés', 'naïve', 'UNI9']],
      ['a very long query string',
        refusal('https://shop.example/r?' + 'pad=x&'.repeat(400) + 'token=LONG9'), ['pad=x', 'LONG9']],
      ['two urls in one sentence',
        refusal('https://alpha.example/p?token=TWO1') + ' See also https://beta.example/admin/keys?k=TWO2',
        ['alpha.example', 'beta.example', 'admin', 'TWO1', 'TWO2']],
      ['a windows file path — the user\'s own folder tree',
        refusal('file:///C:/Users/ada/Documents/tax-2024.pdf'), ['Users', 'ada', 'tax-2024']],
      ['an extension page url',
        refusal('chrome-extension://' + EXT_ID + '/pages/result.html?id=xyz'), ['result.html', 'id=xyz']],
      ['a message that is ENTIRELY a url, with no sentence around it',
        "https://shop.example/orders/o'brien/receipt?token=BARE9", ["o'brien", 'BARE9']],
      ['a bare file url with no sentence around it',
        'file:///C:/Users/ada/Documents/tax-2024.pdf', ['Users', 'ada', 'tax-2024']]
    ];
    let collapsed = 0, leaked = null, scheme = null, unlogged = null;
    for (const row of HOSTILE) {
      const env = newEnv();
      const tab = env.addTab({ url: 'https://app.example.com/dash' });
      await env.send({ type: 'FS_ERROR', error: row[1] }, env.senderTab(tab));
      await pump(env);
      const said = String((env.session[ERR_KEY] || {}).message);
      if (said === R_GENERIC) collapsed++;
      const stored = JSON.stringify(env.session);
      const hit = row[2].filter(f => stored.indexOf(f) >= 0);
      if (hit.length && !leaked) leaked = row[0] + ' -> ' + JSON.stringify(hit) + ' in ' + said;
      if (said.indexOf('://') >= 0 && !scheme) scheme = row[0] + ' -> ' + said;
      // The raw text is still worth having at a devtools prompt: local,
      // ephemeral, never stored, never rendered.
      if (!env.logs.some(l => l.indexOf(row[2][row[2].length - 1]) >= 0) && !unlogged) unlogged = row[0];
    }
    check('every hostile engine string collapses to the ONE generic sentence',
      collapsed === HOSTILE.length, collapsed + '/' + HOSTILE.length);
    check('no path, query, folder name or token from any of them reaches storage', leaked === null, leaked);
    check('no parked message carries a scheme separator at all', scheme === null, scheme);
    check('...while the raw string still reaches console.error for local debugging',
      unlogged === null, unlogged);
  }
  {
    // An innocent sentence with no url in it is unrecognised too, and collapses
    // exactly the same way. That is the point: the worker does not judge the
    // content of text it did not write, it declines to repeat it.
    const env = newEnv();
    const tab = env.addTab({ url: 'https://app.example.com/dash' });
    await env.send({ type: 'FS_ERROR', error: 'the page never stopped growing' }, env.senderTab(tab));
    await pump(env);
    check('an unrecognised engine sentence collapses even with no url in it',
      (env.session[ERR_KEY] || {}).message === R_GENERIC, JSON.stringify(env.session[ERR_KEY]));
    check('...and the note still says where, what and when it happened',
      (env.session[ERR_KEY] || {}).origin === 'https://app.example.com' &&
      (env.session[ERR_KEY] || {}).mode === 'capture' &&
      typeof (env.session[ERR_KEY] || {}).when === 'number',
      JSON.stringify(env.session[ERR_KEY]));
  }
  {
    // The three sentences the allowlist translates must read exactly as
    // shipped: a guard that also rewrites wording would be a regression, not a
    // fix. Green before the allowlist landed and green after it.
    const FRIENDLY = [
      ['', 'The capture stopped before it finished. Please try again.'],
      ['Frame capture failed', 'The browser stopped handing over the screen part way through. Wait a few seconds and try again.'],
      ['No active session', 'The capture lost track of this tab. Reload the page and try again.']
    ];
    const env = newEnv();
    let kept = 0, wrong = null;
    for (const pair of FRIENDLY) {
      const tab = env.addTab({ url: 'https://app.example.com/dash' });
      await env.send({ type: 'FS_ERROR', error: pair[0] }, env.senderTab(tab));
      await pump(env);
      const said = String((env.session[ERR_KEY] || {}).message);
      if (said === pair[1]) kept++; else if (!wrong) wrong = JSON.stringify(pair[0]) + ' -> ' + said;
    }
    check('the three friendly rewrites still read exactly as shipped', kept === FRIENDLY.length, wrong || kept + '/3');
  }
  {
    // The note is only half the surface: an answer this router gives is put on
    // screen by the popup as it stands (popup/popup.js:72), and this one is
    // built out of a raw exception message.
    const env = newEnv({ hooks: { inject: () => new Error('The message port closed before a response was received from file:///C:/Users/ada/Documents/tax-2024.html') } });
    const tab = env.addTab({ id: 79, url: 'https://app.example.com/dash' });
    const res = await startCapture(env, tab.id, 'full');
    check('the answer the popup is shown is a sentence, never the exception',
      res && res.error === R_NO_START, res && res.error);
    check('...and the note built from that same reason is clean too',
      !/Users|ada|tax-2024/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
    check('...with the raw exception kept in the log only',
      env.logs.some(l => /tax-2024/.test(l)), JSON.stringify(env.logs));
  }
  {
    /* GATE 2, on its own. The note is written by recordError; this is the OTHER
       door — whatever the router answers with goes on screen as it stands. An
       exception thrown outside startCapture's own try (here: the shot taken for
       a selected region) reaches the router catch, which stringifies it. The
       wrapper on sendResponse is the only thing standing between that string
       and the popup. */
    const hostile = 'Cannot access contents of url "https://shop.example/orders/o\'brien/receipt?token=ROUTER7&card=4111". Extension manifest must request permission to access this host.';
    const env = newEnv({ hooks: { capture: () => new Error(hostile) } });
    const tab = env.addTab({ id: 78, url: 'https://app.example.com/dash', script: { region: 'wait' } });
    await startCapture(env, tab.id, 'region');
    const p = env.send({ type: 'FS_REGION_SELECTED', rect: { x: 1, y: 2, w: 3, h: 4 }, dpr: 2 }, env.senderTab(tab));
    await pump(env, { budget: 12000 });
    const res = await p;
    check('the router path: an answer built from a raw exception collapses too',
      res && res.ok === false && res.error === R_GENERIC, JSON.stringify(res));
    check('...so no token from it can reach the popup',
      !/ROUTER7|o'brien|4111|:\/\//.test(String(res && res.error)), String(res && res.error));
    check('...and the note that same crash parks is clean as well',
      !/ROUTER7|o'brien|4111/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
  }
  {
    /* THE BATCH PATH. runBatch reaches startCapture DIRECTLY, not through the
       router, and broadcasts each job's reason to pages/batch.html — a surface
       the router's wrapper never touches. Same rule or it is a hole. */
    const hostile = 'Cannot access contents of url "https://shop.example/orders/o\'brien/receipt?token=BATCH7&card=4111". Extension manifest must request permission to access this host.';
    const env = newEnv({ script: { onStart: 'error', error: hostile } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('the batch path: a hostile engine reason collapses in the job row',
      at(jobs, 0).status === 'error' && at(jobs, 0).error === R_GENERIC, JSON.stringify(at(jobs, 0)));
    check('...so nothing from it is broadcast to the batch page',
      !/BATCH7|o'brien|4111|shop\.example/.test(JSON.stringify(env.broadcasts)),
      JSON.stringify(at(jobs, 0)));
    check('...and the raw reason is still logged locally',
      env.logs.some(l => /BATCH7/.test(l)), JSON.stringify(env.logs.length));
  }
  {
    // The other batch door: startCapture's own catch, reached directly.
    const env = newEnv({ hooks: { inject: () => new Error('The message port closed, see https://shop.example/o\'brien?token=BATCH8') } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('a batch job that cannot start reports the fixed sentence',
      at(jobs, 0).error === R_NO_START, JSON.stringify(at(jobs, 0)));
    check('...with nothing from the exception in the broadcast',
      !/BATCH8|o'brien/.test(JSON.stringify(env.broadcasts)), JSON.stringify(at(jobs, 0)));
  }
  {
    /* v1.9.12's structural gate, on this surface too: a batch row reaches the
       page as a text node, so a reason cannot become markup however it is
       built. Asserted, not assumed. */
    const BATCH_SRC = fs.readFileSync(path.join(ROOT, 'pages/batch.js'), 'utf8');
    check('the batch page never assigns innerHTML at all', !/innerHTML/.test(BATCH_SRC), 'innerHTML');
    check('...and builds every row cell with textContent',
      /n\.textContent\s*=/.test(BATCH_SRC), 'textContent');
  }
  {
    /* THE FIELD THE ALLOWLIST DID NOT COVER. Every other field of the note is a
       number, a tab id, or humanReason()'s output — but `mode` arrives ON a
       START_CAPTURE message, straight from whoever sent it, and was stored
       verbatim. Same shape of answer as the sentences: a declared set, and
       anything outside it becomes the word the paths with no session already
       use. */
    const env = newEnv();
    env.addTab({ id: 82, url: 'chrome://settings/' });
    await env.send({ type: 'START_CAPTURE', tabId: 82, startDelay: 0,
      mode: "https://shop.example/orders/o'brien/receipt?token=MODE9&card=4111" }, env.fromPage());
    await pump(env);
    check('a mode nobody declared is not parked verbatim',
      (env.session[ERR_KEY] || {}).mode === 'capture', JSON.stringify((env.session[ERR_KEY] || {}).mode));
    check('...so the last field arriving on a message cannot carry anything into storage',
      !/MODE9|o'brien|4111|receipt/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
  }
  {
    // The control: the four the product actually offers survive untouched, and
    // 'capture' — what a path with no session to ask already records — stays a
    // word the popup can render.
    const OFFERED = ['full', 'visible', 'region', 'element'];
    const env = newEnv();
    let kept = 0, wrong = null;
    for (const mode of OFFERED) {
      const tab = env.addTab({ url: 'chrome://settings/' });
      await startCapture(env, tab.id, mode);
      const got = (env.session[ERR_KEY] || {}).mode;
      if (got === mode) kept++; else if (!wrong) wrong = mode + ' -> ' + got;
    }
    check('every mode the product offers is kept exactly as it is', kept === OFFERED.length, wrong || kept + '/4');
    check('...and the popup has a label for each of them, plus a fallback for the fifth',
      OFFERED.every(m => new RegExp('\\b' + m + ':').test(POPUP_SRC)) && /\|\| 'capture'/.test(POPUP_SRC),
      OFFERED.filter(m => !new RegExp('\\b' + m + ':').test(POPUP_SRC)).join(','));
  }
  {
    /* GATE 2 IS A BACKSTOP, and its guard used to admit an answer by TYPE:
       `typeof r.error === 'string'`. Anything that was not a string — an Error
       object, a Proxy, null — went past it untouched, which is a backstop that
       fails OPEN, and the cases below it are written on the assumption that it
       is there. Nothing this worker can answer with today is a non-string, so
       the fix has to be read off the source: the guard admits on the PRESENCE
       of an error, and reduces what it cannot recognise. Reducing without
       stringifying matters too — String() on a foreign object runs that
       object's own code, which is not a thing a guard should do to the value it
       is guarding against. */
    const GUARD = (/const sendResponse = [\s\S]*?\n {2}\(async \(\) =>/.exec(BG_SRC) || [''])[0];
    check('gate 2 admits an answer by the PRESENCE of an error, not by its type',
      /r\.error !== undefined/.test(GUARD), JSON.stringify(GUARD.slice(0, 40)));
    check('...and answers a non-string error with the generic sentence instead of passing it on',
      /typeof r\.error === 'string' \? wireReason\(r\.error\) : R_GENERIC/.test(GUARD), 'non-string branch');
    check('...without stringifying it on the way', !/String\(r\.error\)/.test(GUARD), 'String(r.error)');
  }
  {
    // The regression the change above must not cause: an answer with no error
    // at all is not an error, and has to reach the caller as it was written.
    const env = newEnv();
    const tab = env.addTab({ id: 84 });
    const res = await env.send({ type: 'FS_DONE', meta: META }, env.senderTab(tab));
    check('an answer carrying no error is passed through untouched',
      res && res.ok === false && !('error' in res), JSON.stringify(res));
  }

  /* ================= restricted surfaces ================= */
  /* A page the browser will not let an extension read is not the user's mistake,
     and the worst answer is the one that costs them a wait first: inject, watch
     the engine fail to answer, and then say "reload the page and try again" about
     a page where reloading can never help. Every surface below is one the worker
     can recognise BEFORE it touches the tab. */
  console.log('\n=== restricted surfaces ===');
  const SESSIONS_KEY = 'fsSessions';   // the worker's in-flight-capture mirror
  const BATCH_KEY = 'fsBatch';         // the worker's queue mirror
  const R_LOST_TAB = 'The capture lost track of this tab. Reload the page and try again.';
  const R_RESTRICTED = 'This page is protected by the browser and cannot be captured.';
  {
    /* chrome:// is not one scheme, it is a family. chrome-untrusted:// is where
       the browser puts its OWN sandboxed pages (the Terminal, the media app),
       chrome-search:// backs the New Tab page and chrome-native:// its Android
       surfaces. None of them match /^chrome:/ — the hyphen ends the alternative
       — so each one used to be treated as an ordinary web page: injected into,
       failed on, and reported with advice that cannot work. */
    const INTERNAL = [
      'chrome-untrusted://terminal/html/terminal.html',
      'chrome-search://local-ntp/local-ntp.html',
      'chrome-native://newtab/',
      'edge-untrusted://pdf/index.html'
    ];
    const env = newEnv();
    let refused = 0, parked = 0, bad = null;
    for (const url of INTERNAL) {
      const tab = env.addTab({ url });
      const res = await startCapture(env, tab.id, 'full');
      if (res && res.ok === false && res.error) refused++; else if (!bad) bad = url + ' -> ' + JSON.stringify(res);
      if ((env.session[ERR_KEY] || {}).message === res.error) parked++;
    }
    check('every browser-internal scheme is refused, not only chrome://',
      refused === INTERNAL.length, bad || refused + '/' + INTERNAL.length);
    check('...before a line of script is put into any of them', env.injects.length === 0, JSON.stringify(env.injects));
    check('...and each refusal is parked where the popup will find it', parked === INTERNAL.length, parked + '/' + INTERNAL.length);
  }
  {
    // The control that keeps the widening honest: chrome-extension:// is in the
    // same family and must keep the sentence written for IT, not the browser-page
    // one it now sits next to.
    const env = newEnv();
    const res = await startCapture(env, env.addTab({ url: 'chrome-extension://abcdefg/page.html' }).id, 'full');
    check('CONTROL: an extension page still gets the extension-page sentence',
      /Extension pages/.test(String(res && res.error)), JSON.stringify(res));
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 110, url: 'https://reports.example.com/q3/annual-report.pdf', script: { frames: 2 } });
    const res = await startCapture(env, tab.id, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('the browser\'s built-in PDF viewer is refused up front',
      res && res.ok === false && res.error === R_RESTRICTED, JSON.stringify(res));
    check('...without the injection that could never have answered', env.injects.length === 0, JSON.stringify(env.injects));
    check('...and the note names the mode asked for and the origin only',
      rec.mode === 'full' && rec.origin === 'https://reports.example.com', rec.mode + '/' + rec.origin);
  }
  {
    /* THE CARVE-OUT, and the reason the refusal is worth its false positives.
       captureVisibleTab photographs whatever is on screen, PDF viewer included —
       so the one mode that needs no content script still works, and the refusal
       above is "use the other button", not "go away". */
    const env = newEnv();
    const tab = env.addTab({ id: 111, url: 'https://reports.example.com/q3/annual-report.pdf' });
    const res = await startCapture(env, tab.id, 'visible');
    check('...but a visible-area capture of a PDF still works',
      res && res.ok === true && capturesOf(env).length === 1, JSON.stringify(res));
  }
  {
    // Anchored at the end of the PATH, so the test is about what the browser is
    // rendering rather than about what a url happens to mention.
    const NOT_PDF = [
      'https://example.com/viewer?file=annual-report.pdf',
      'https://example.com/pdf/guide.html',
      'https://example.com/thing.pdfx',
      'https://example.com/report.pdf.html'
    ];
    const env = newEnv({ script: { frames: 1 } });
    let ok = 0, bad = null;
    for (const url of NOT_PDF) {
      const tab = env.addTab({ url, script: { frames: 1 } });
      const res = await startCapture(env, tab.id, 'full');
      if (res && res.ok === true) ok++; else if (!bad) bad = url + ' -> ' + JSON.stringify(res);
    }
    check('a url that merely mentions a pdf is captured like any other page', ok === NOT_PDF.length, bad || ok + '/' + NOT_PDF.length);
  }
  {
    const env = newEnv({ fileAccess: false });
    const tab = env.addTab({ id: 112, url: 'file:///C:/Users/ada.smith/Documents/pay-2024/plan.html' });
    const res = await startCapture(env, tab.id, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('a local file is refused up front when file access is switched off',
      res && res.ok === false && res.error === R_BLOCKED, JSON.stringify(res));
    check('...by ASKING the browser rather than guessing', env.trace.indexOf('fileAccess?') >= 0,
      JSON.stringify(env.trace.filter(s => /fileAccess/.test(s))));
    check('...without injecting into it first', env.injects.length === 0, JSON.stringify(env.injects));
    check('...and the note keeps the folder tree out of storage',
      rec.origin === 'file://' && !/ada\.smith|Documents|pay-2024/.test(JSON.stringify(env.session)), JSON.stringify(env.session));
  }
  {
    // The control: the switch is ON for plenty of people, and for them a local
    // file is an ordinary page.
    const env = newEnv({ fileAccess: true });
    const tab = env.addTab({ id: 113, url: 'file:///C:/Users/ada/notes/plan.html', script: { frames: 1 } });
    const res = await startCapture(env, tab.id, 'full');
    check('CONTROL: with file access granted a local file is captured like any page',
      res && res.ok === true && capturesOf(env).length === 1, JSON.stringify(res));
  }
  {
    /* WHICH WAY THE CHECK FAILS. A browser that answers the question with nothing
       — no promise form, a build that dropped the method, a Firefox package —
       must not be COERCED into "access denied", or every local file is refused a
       capture that would have worked. Only an explicit no is a no. */
    const env = newEnv({ fileAccess: undefined });   // asked, answered with nothing
    env.fileAccess = null;
    const tab = env.addTab({ id: 115, url: 'file:///C:/Users/ada/notes/plan.html', script: { frames: 1 } });
    const res = await startCapture(env, tab.id, 'full');
    check('a browser that cannot answer the file-access question is not a refusal',
      res && res.ok === true, JSON.stringify(res));
  }
  {
    /* THE ONE THIS WORKER CANNOT SEE COMING, stated rather than papered over. A
       document served with `Content-Security-Policy: sandbox` has an ordinary
       https url and an opaque origin; the header is invisible to a worker with no
       webRequest permission, and the signal it finally produces — an injection
       that lands followed by an engine that never answers — is the SAME signal a
       slow or half-torn-down content script produces, where "reload and try
       again" is exactly the right advice. Guessing between them would make the
       common case worse to improve the rare one. What must hold is that the
       failure still reaches a person. */
    const env = newEnv();
    const tab = env.addTab({ id: 114, url: 'https://sandboxed.example/app', script: { onStart: 'silent' } });
    env.hooks.sendMessage = (id, m) => (m.type === 'FS_START' ? { rejectAfter: 50, error: CONN_ERR } : null);
    const p = env.send({ type: 'START_CAPTURE', tabId: 114, mode: 'full', startDelay: 0 }, env.fromPage());
    await pump(env, { budget: 2000 });
    const res = await p;
    check('a page whose scripts cannot answer still reports a reason a person can read',
      res && res.ok === false && res.error === R_NO_START &&
      (env.session[ERR_KEY] || {}).message === R_NO_START, JSON.stringify(res));
  }
  {
    /* Whatever the new families say, they have to say it through the same door as
       everything else: a sentence the allowlist recognises, and therefore one
       that survives being handed back through the gate a second time. */
    const env = newEnv();
    const SAID = [];
    for (const url of ['chrome-untrusted://terminal/', 'https://x.example/a.pdf', 'file:///tmp/x.html']) {
      const e2 = newEnv({ fileAccess: false });
      SAID.push(String((await startCapture(e2, e2.addTab({ url }).id, 'full')).error));
    }
    let stable = 0;
    for (const said of SAID) {
      const tab = env.addTab({});
      await env.send({ type: 'FS_ERROR', error: said }, env.senderTab(tab));
      await pump(env);
      if ((env.session[ERR_KEY] || {}).message === said) stable++;
    }
    check('every new refusal is a sentence the allowlist already knows', stable === SAID.length,
      stable + '/' + SAID.length + ' ' + JSON.stringify(SAID));
  }

  /* ================= in the user's language ================= */
  /* All 55 locales carry a translation for every sentence this worker can say —
     and until now the worker said the English one to every one of them. The keys
     were there, translated, and dead. */
  console.log('\n=== in the user\'s language ===');
  {
    /* The whole vocabulary, driven for real, once per locale. Each row names the
       message key the shipped file is expected to spend; the sentence is then read
       out of the REAL message file rather than written here, so a key that does not
       exist degrades to English and the row goes red instead of quietly passing. */
    const VOICE = [
      ['errRestrictedBrowserPage', {}, async env => (await startCapture(env, env.addTab({ url: 'chrome://settings/' }).id, 'full')).error],
      ['errRestrictedDevtools', {}, async env => (await startCapture(env, env.addTab({ url: 'devtools://devtools/bundled/inspector.html' }).id, 'full')).error],
      ['errRestrictedViewSource', {}, async env => (await startCapture(env, env.addTab({ url: 'view-source:https://example.com/' }).id, 'full')).error],
      ['errRestrictedExtensionPage', {}, async env => (await startCapture(env, env.addTab({ url: 'moz-extension://abc/x.html' }).id, 'full')).error],
      ['errRestrictedWebstore', {}, async env => (await startCapture(env, env.addTab({ url: 'https://chromewebstore.google.com/detail/foo' }).id, 'full')).error],
      ['errRestrictedGeneric', {}, async env => (await startCapture(env, env.addTab({ url: undefined }).id, 'full')).error],
      ['errBlocked', {}, async env => (await startCapture(env, env.addTab({ blockInject: true }).id, 'full')).error],
      ['errNoStart', { hooks: { inject: () => new Error('disk on fire') } }, async env => (await startCapture(env, env.addTab({}).id, 'full')).error],
      ['errBusy', {}, async env => {
        const tab = env.addTab({ script: { onStart: 'silent' } });
        await startCapture(env, tab.id, 'full');
        return (await startCapture(env, tab.id, 'full')).error;
      }],
      ['errUnknownMessage', {}, async env => (await env.send({ type: 'FS_NOT_A_MESSAGE' }, env.fromPage())).error],
      ['errWrongTab', {}, async env => {
        env.addTab({ id: 202, active: false });
        env.addTab({ id: 201, active: true, script: { frames: 3, beforeFrame: i => { if (i === 1) env.activate(202); } } });
        await startCapture(env, 201, 'full');
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errQuota', { hooks: { capture: () => new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded') } }, async env => {
        await startCapture(env, env.addTab({ id: 203, active: true }).id, 'visible');
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errCrash', { hooks: { capture: () => new Error('the compositor died') } }, async env => {
        await startCapture(env, env.addTab({ id: 204, active: true, script: { region: 'select' } }).id, 'region');
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errFrameHandover', {}, async env => {
        await env.send({ type: 'FS_ERROR', error: 'Frame capture failed' }, env.senderTab(env.addTab({ id: 205 })));
        await pump(env);
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errLostTab', {}, async env => {
        await env.send({ type: 'FS_ERROR', error: 'No active session' }, env.senderTab(env.addTab({ id: 206 })));
        await pump(env);
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errStoppedEarly', {}, async env => {
        await env.send({ type: 'FS_ERROR', error: 'Capture aborted' }, env.senderTab(env.addTab({ id: 207 })));
        await pump(env);
        return (env.session[ERR_KEY] || {}).message;
      }],
      ['errGeneric', {}, async env => {
        await env.send({ type: 'FS_ERROR', error: 'the page never stopped growing' }, env.senderTab(env.addTab({ id: 208 })));
        await pump(env);
        return (env.session[ERR_KEY] || {}).message;
      }],
      /* The disk is full. Read out of the parked note rather than off a return
         value: this one arrives from inside the frame loop, where there is no
         caller left to answer. */
      ['errStorageFull', { hooks: { dbPut: store => (store === 'frames' ? quotaError() : null) } }, async env => {
        await startCapture(env, env.addTab({ active: true, script: { frames: 2 } }).id, 'full');
        return (env.session[ERR_KEY] || {}).message;
      }]
    ];
    const HI = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/hi/messages.json'), 'utf8'));
    const say = async (row, locale) => await row[2](newEnv(Object.assign({ locale }, row[1])));

    let english = 0, badEn = null;
    for (const row of VOICE) {
      const said = await say(row, null);
      const want = EN_MESSAGES[row[0]] && EN_MESSAGES[row[0]].message;
      if (said === want) english++; else if (!badEn) badEn = row[0] + ': ' + JSON.stringify(said) + ' != ' + JSON.stringify(want);
    }
    check('every sentence the worker can say is word-for-word the English message file\'s',
      english === VOICE.length, badEn || english + '/' + VOICE.length + ' sentences');

    let hindi = 0, badHi = null;
    for (const row of VOICE) {
      const said = await say(row, 'hi');
      const want = HI[row[0]] && HI[row[0]].message;
      if (said === want) hindi++; else if (!badHi) badHi = row[0] + ': ' + JSON.stringify(said) + ' != ' + JSON.stringify(want);
    }
    check('...and a Hindi browser is told the same thing in Hindi',
      hindi === VOICE.length, badHi || hindi + '/' + VOICE.length + ' sentences');
    check('the vocabulary graded here is the whole of it',
      VOICE.length === Object.keys(EN_MESSAGES).filter(k => k.indexOf('err') === 0).length,
      VOICE.length + ' driven / ' + Object.keys(EN_MESSAGES).filter(k => k.indexOf('err') === 0).length + ' err* keys in the message file');
  }
  {
    /* The line the translation must NOT cross. Some of these strings are read by
       content/capture.js, which branches on them — translate the wire and the
       engine stops understanding its own protocol. */
    const env = newEnv({ locale: 'hi' });
    const res = await env.send({ type: 'FS_FRAME', index: 0, total: 1, x: 0, y: 0 }, env.senderTab(env.addTab({ id: 209 })));
    check('the protocol word the engine branches on stays English in every locale',
      res && res.error === 'No active session', JSON.stringify(res));
  }
  {
    // Idempotence, in the locale: the engine hands a refused frame's own reason
    // straight back, so a translated sentence has to survive a second pass.
    const env = newEnv({ locale: 'hi' });
    const said = (await startCapture(env, env.addTab({ url: 'chrome://settings/' }).id, 'full')).error;
    await env.send({ type: 'FS_ERROR', error: said }, env.senderTab(env.addTab({ id: 210 })));
    await pump(env);
    check('a sentence already in the user\'s language survives a second pass through the gate',
      (env.session[ERR_KEY] || {}).message === said, JSON.stringify([said, (env.session[ERR_KEY] || {}).message]));
  }
  {
    /* A browser with no chrome.i18n at all is not hypothetical — it is what this
       whole file has always run against, and what a stripped build would be. */
    const env = newEnv();
    check('a chrome with no i18n at all is a fallback, not a crash',
      env.sandbox.chrome.i18n === undefined && (await startCapture(env, env.addTab({ url: 'about:blank' }).id, 'full')).error ===
      EN_MESSAGES.errRestrictedBrowserPage.message, 'no i18n');
  }
  {
    /* Every key the shipped worker names has to exist, for the same reason a key
       named in markup does — an absent key resolves to the empty string, and the
       fallback would hide it forever. test/i18n-sim.node.js makes this claim about
       the pages; the worker is graded here because this tier is the one that knows
       which sentences it can produce. */
    const bare = BG_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    const named = [];
    const re = /(?:getMessage|msg)\(\s*'([A-Za-z0-9_@]+)'/g;
    let m;
    while ((m = re.exec(bare))) named.push(m[1]);
    const missing = named.filter(k => k.indexOf('@@') !== 0 && !EN_MESSAGES[k]);
    check('every message key background.js names exists in the English file',
      named.length >= 17 && missing.length === 0, missing.join(',') || named.length + ' keys named');
  }

  /* ================= MV3: the worker is evicted mid-operation ================= */
  /* THE RECURRING CORRECTNESS BUG OF MV3. A service worker is torn down whenever
     Chrome feels like it — 30 seconds of quiet is enough — and everything in
     module scope goes with it: the session map, the rate-limit floor, the queue
     the batch loop is walking. What does NOT go is the content script driving the
     capture, the frames already in IndexedDB, or storage.session. So the worker
     wakes with amnesia into a page that is still working, and the only two
     acceptable outcomes are that the capture COMPLETES or that it FAILS CLEANLY:
     frames dropped, queue settled, and the user told. Silently doing neither is
     the bug, and it is invisible to every test that never suspends anything. */
  console.log('\n=== MV3 eviction ===');
  {
    const env = newEnv();
    env.addTab({ id: 130, url: 'https://docs.example.com/spec', title: 'The spec',
      script: { frames: 4, beforeFrame: i => { if (i === 2) restart(env); } } });
    await startCapture(env, 130, 'full');
    const frames = framesOf(env), caps = capturesOf(env);
    check('a capture whose worker is evicted mid-flight still COMPLETES',
      caps.length === 1 && caps[0].mode === 'full', caps.length + ' captures');
    check('...with every frame stored exactly once, in order',
      frames.length === 4 && frames.map(f => f.k.split(':')[1]).join() === '00000,00001,00002,00003',
      frames.map(f => f.k).join(' '));
    check('...and the result page opens for it as if nothing had happened',
      env.creates.length === 1 && env.creates[0].url.indexOf(RESULT_URL) === 0, JSON.stringify(env.creates.map(c => c.url)));
    /* The rate-limit floor is module-scope state too, and the cheapest to lose:
       a fresh worker starts at zero and shoots the instant it is asked, which is
       how a resumed capture walks straight into Chrome's 2-per-second quota.
       Spelled with the shot count in it so it cannot pass on a capture that
       stopped early — two shots and a gap of zero would otherwise satisfy it. */
    check('...and the woken worker still respects the 550 ms quota floor',
      env.shots.length === 4 && env.shots.every((s, i) => i === 0 || s.at - env.shots[i - 1].at >= 550),
      env.shots.map((s, i) => i ? s.at - env.shots[i - 1].at : 0).join('/') + 'ms');
  }
  {
    const env = newEnv();
    const tab = env.addTab({ id: 131, url: 'https://shop.example.com/orders/4417?token=SEKRIT', script: { onStart: 'silent' } });
    await startCapture(env, 131, 'full');
    const mid = env.session[SESSIONS_KEY];
    check('a capture in flight is mirrored to storage.session while it runs',
      !!mid && Array.isArray(mid.live) && mid.live.length === 1 && mid.live[0].mode === 'full' && mid.live[0].tabId === 131,
      JSON.stringify(mid));
    check('...carrying the origin only, never the page url',
      !!mid && !/SEKRIT|4417|orders/.test(JSON.stringify(mid)) && mid.live[0].origin === 'https://shop.example.com',
      JSON.stringify(mid));
    await env.send({ type: 'FS_ERROR', error: 'Frame capture failed' }, env.senderTab(tab));
    await pump(env);
    // Both halves in one claim on purpose: "the key is absent" is also true of a
    // worker that never wrote one, and that is the state this section replaced.
    check('...and the mirror is REMOVED when the last capture ends, not left lying about',
      !!mid && !(SESSIONS_KEY in env.session), JSON.stringify(Object.keys(env.session)));
  }
  {
    /* The other outcome, and the one that used to be silent: the worker is
       evicted and nothing ever wakes it on that capture's behalf — the tab was
       closed, the page frozen, the laptop shut. The frames are already on disk. */
    const env = newEnv();
    await env.db.api.put('frames', { k: env.db.api.frameKey('gone-1', 0), captureId: 'gone-1', index: 0, x: 0, y: 0, dataUrl: 'data:image/png;base64,ORPHAN' });
    env.session[SESSIONS_KEY] = { at: env.clock.now() - 1000, live: [{
      captureId: 'gone-1', mode: 'visible', windowId: 1, tabId: 140,
      origin: 'https://intranet.example.org', startedAt: env.clock.now() - 2000
    }] };
    restart(env);
    await pump(env);
    const rec = env.session[ERR_KEY] || {};
    check('a capture that cannot be resumed is retired at the next wake',
      !(SESSIONS_KEY in env.session), JSON.stringify(env.session[SESSIONS_KEY]));
    check('...and its orphaned frames go with it', framesOf(env).length === 0, framesOf(env).length + ' frames left');
    check('...and the user is told, in the mode they actually asked for',
      rec.mode === 'visible' && rec.message === R_LOST_TAB, JSON.stringify(rec));
    check('...against the origin the mirror kept, and nothing more',
      rec.origin === 'https://intranet.example.org', JSON.stringify(rec));
  }
  {
    // A capture cannot still be running an hour later, whatever the mirror says.
    const env = newEnv();
    env.session[SESSIONS_KEY] = { at: 0, live: [{
      captureId: 'stale-1', mode: 'full', windowId: 1, tabId: 141,
      origin: 'https://intranet.example.org', startedAt: env.clock.now() - 3600000
    }] };
    restart(env);
    await pump(env);
    check('a mirrored capture too old to be real is retired rather than adopted',
      !(SESSIONS_KEY in env.session) && (env.session[ERR_KEY] || {}).message === R_LOST_TAB,
      JSON.stringify(env.session));
  }
  {
    /* THE CONTROL THAT FAILS THE WRONG FIX. Retiring everything at boot would
       make all three checks above pass and would break the headline one, so the
       adoptable case is graded on its own: a full capture whose engine is still
       there picks up exactly where it left off. */
    const env = newEnv();
    const tab = env.addTab({ id: 142, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    env.session[SESSIONS_KEY] = { at: env.clock.now() - 100, live: [{
      captureId: 'live-1', mode: 'full', windowId: 1, tabId: 142,
      origin: 'https://docs.example.com', startedAt: env.clock.now() - 900
    }] };
    restart(env);
    await pump(env);
    // Pumped, not merely awaited: the adopted session brings the rate-limit floor
    // back with it, so the very first frame of the resumed capture waits out the
    // rest of the 550 ms — which is the behaviour, not an inconvenience.
    const p = env.send({ type: 'FS_FRAME', index: 0, total: 2, x: 0, y: 0 }, env.senderTab(tab));
    await pump(env, { budget: 2000 });
    const res = await p;
    check('CONTROL: a capture the engine can still drive is adopted, not thrown away',
      res && res.ok === true, JSON.stringify(res));
    check('...and the frame it stores belongs to the capture that started it',
      framesOf(env).length === 1 && framesOf(env)[0].captureId === 'live-1', JSON.stringify(framesOf(env).map(f => f.k)));
  }
  {
    /* THE QUEUE. This is the shape every sibling tool has: a loop walking a list,
       holding the whole of its progress in a local variable. Evict the worker and
       the loop is gone mid-item — no error, no rejection, nothing. The page that
       asked for it sits on "capturing…" for ever. */
    // The engine takes the first job and never answers, which is what holds the
    // queue still at a known point: job one capturing, two waiting behind it.
    const env = newEnv({ script: { onStart: 'silent' } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/', 'https://three.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 2000 });   // inside the first job, two still queued
    const mid = jobsOf(env).map(j => j.status).join();
    restart(env);
    await pump(env, { budget: 120000 });
    const jobs = jobsOf(env);
    check('the rig really did evict the worker in the middle of the queue',
      /capturing/.test(mid) && /pending/.test(mid), mid);
    check('a queue interrupted by an eviction is settled, not left running for ever',
      jobs.length === 3 && jobs.every(j => j.status === 'done' || j.status === 'error'),
      JSON.stringify(jobs.map(j => j.status)));
    check('...and the page waiting on it is told', tail(env.broadcasts).type === 'BATCH_PROGRESS', JSON.stringify(tail(env.broadcasts).type));
    check('...and nothing of the queue is left in storage', !(BATCH_KEY in env.session), JSON.stringify(Object.keys(env.session)));
  }
  {
    // The control for the queue: an uninterrupted batch must not be settled by
    // anybody but itself, and must leave the mirror empty behind it.
    const env = newEnv({ script: { frames: 1 } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 120000 });
    check('CONTROL: an uninterrupted queue still finishes on its own', jobsOf(env).every(j => j.status === 'done'),
      JSON.stringify(jobsOf(env).map(j => j.status)));
    check('...leaving nothing in storage.session at all', Object.keys(env.session).length === 0, JSON.stringify(env.session));
  }
  {
    /* The structural half, and the sibling of "every abandoned session is handed
       to dropFrames". A mirror that is written at some of the places the map
       changes is worse than none: it goes stale, and a stale mirror is adopted as
       if it were true. Read off the shipped source, so it fails on the path
       nobody remembered to tell it about. */
    const L = BG_SRC.split('\n');
    const sites = [], unmirrored = [];
    L.forEach((line, i) => {
      if (!/sessions\.(set|delete)\(/.test(line)) return;
      sites.push(i + 1);
      if (!/persistSessions\(/.test(L.slice(i, i + 6).join('\n'))) unmirrored.push(i + 1);
    });
    check('every place the worker changes the session map writes the mirror',
      unmirrored.length === 0, 'unmirrored at background.js line(s) ' + JSON.stringify(unmirrored));
    check('...on a scan that really found the mutation sites', sites.length >= 10, sites.length + ' sites');
  }

  /* ================= report a problem, with no backend ================= */
  /* There is nowhere to send a crash report and there never will be: this product
     makes no network calls at all. So the bundle is built locally, shown to the
     user in full, and saved by them — which means every judgement about what may
     go in it has to be made HERE, before it is written, and by picking fields
     rather than by scrubbing a copy of everything. */
  console.log('\n=== diagnostic bundle ===');
  const diag = (env, extra) => env.send(Object.assign({ type: 'DIAGNOSTIC_BUNDLE' }, extra || {}), env.fromPage());
  {
    const env = newEnv({ sync: { imageFormat: 'jpeg', captureDelay: 300, theme: 'dark' } });
    const tab = env.addTab({ id: 150, url: 'https://intranet.example.org/hr/pay?who=ada', blockInject: true });
    await startCapture(env, tab.id, 'element');
    const res = await diag(env);
    const b = (res || {}).bundle || {};
    check('the bundle names the extension version from the shipped manifest',
      b.version === MANIFEST.version, b.version + ' vs ' + MANIFEST.version);
    check('...and the browser, as a name and a number', /^Chrome 128$/.test(String(b.browser)), b.browser);
    check('...and the settings actually in force',
      b.settings && b.settings.imageFormat === 'jpeg' && b.settings.captureDelay === 300 && b.settings.theme === 'dark',
      JSON.stringify(b.settings));
    check('...and the last failure, with the page origin and nothing else of the page',
      b.lastError && b.lastError.message === R_BLOCKED && b.page === 'https://intranet.example.org',
      JSON.stringify([b.page, b.lastError]));
    check('what the user is SHOWN is byte-for-byte what they will SAVE',
      typeof res.text === 'string' && res.text === JSON.stringify(b, null, 2),
      typeof res.text);
    // Parsed defensively: a worker that answers with nothing owes this file a red
    // line, not a node stack trace on the next reader's screen.
    let round = null;
    try { round = JSON.stringify(JSON.parse(String(res.text))); } catch (e) { round = String(e && e.message); }
    check('...and it is a whole file, not a fragment', round === JSON.stringify(b), round === JSON.stringify(b) ? 'round trip' : round);
    check('the worker never writes the file itself — saving stays the user\'s act',
      env.downloads.length === 0 && !/chrome\.downloads/.test(BG_SRC), env.downloads.length + ' downloads');
  }
  {
    /* REDACTION IS A PICK, NOT A SCRUB. Everything hostile below is somewhere a
       person legitimately types their own words: a filename template, a download
       folder, a url. A bundle built by copying and then cleaning would have to
       find them all; one built by naming the fields it wants cannot carry what it
       never asked for. */
    const env = newEnv({ sync: {
      filenameTemplate: 'invoice-{date}-ada.smith@corp.example-4111111111111111',
      saveDirectory: 'C:/Users/ada.smith/Dropbox/SECRETDIR',
      imageFormat: 'webp',
      fsUndeclaredKey: 'TOKEN-DIAG9'
    } });
    const tab = env.addTab({ id: 151, url: 'https://shop.example.com/orders/4417?token=SEKRIT9&card=4111111111111111', blockInject: true });
    await startCapture(env, tab.id, 'element');
    const res = await diag(env, { url: 'https://shop.example.com/orders/4417?token=SEKRIT9' });
    const text = String((res || {}).text), b = ((res || {}).bundle) || {}, set = b.settings || {};
    check('nothing a person typed into their own settings reaches the file',
      !/ada\.smith|SECRETDIR|Dropbox|4111111111111111|Users/.test(text), text.slice(0, 120));
    check('nothing from the url reaches it either — origin, and that is all',
      !/SEKRIT9|4417|orders|token/.test(text) && b.page === 'https://shop.example.com', String(b.page));
    check('a setting nobody declared is not in the file at all',
      !/fsUndeclaredKey|TOKEN-DIAG9/.test(text), 'undeclared key');
    check('...while the settings that ARE declared still come through',
      set.imageFormat === 'webp' && Object.keys(set).length >= 20, Object.keys(set).length + ' settings');
    check('the two free-text settings are reported as a state, never as their text',
      /^\(/.test(String(set.filenameTemplate)) && /^\(/.test(String(set.saveDirectory)),
      JSON.stringify([set.filenameTemplate, set.saveDirectory]));
  }
  {
    /* THE FIELD THAT ARRIVES ON A MESSAGE, and the gap the teeth pass found: with
       no failure parked there is no origin to report, so the caller — the popup,
       which is the half that knows the active tab — may hand one in. A value that
       arrives on a message is not a value this worker gets to trust, and the
       check that only ever exercised the note's own origin could not see that.
       Same reducer as every other url in the product. */
    const env = newEnv();
    const res = await diag(env, { url: "https://shop.example.com/orders/o'brien/4417?token=DIAGURL9&card=4111111111111111" });
    check('a page origin handed in by the caller is reduced like every other url',
      (((res || {}).bundle) || {}).page === 'https://shop.example.com', String((((res || {}).bundle) || {}).page));
    check('...so nothing it carried reaches the file',
      !/DIAGURL9|4111|o'brien|4417|orders/.test(String((res || {}).text)), String((res || {}).text).slice(0, 120));
  }
  {
    // The user-agent string is the other place a browser hands over more than was
    // asked for. Whatever goes in, a name from a declared list and some digits is
    // what comes out.
    const UAS = [
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36', 'Chrome 128', 'Windows'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.86', 'Edge 127', 'macOS'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/UQ1A.240205.004) AppleWebKit/537.36 Chrome/126.0.6478.71 Mobile Safari/537.36', 'Chrome 126', 'Android'],
      ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36', 'Chrome 125', 'ChromeOS'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0', 'Firefox 129', 'Windows'],
      ['a user agent nobody has ever seen, with ada.smith@corp.example in it', 'unknown', 'unknown']
    ];
    let ok = 0, bad = null, leaked = null;
    for (const [ua, browser, platform] of UAS) {
      const env = newEnv({ userAgent: ua });
      const res = await diag(env);
      const b = ((res || {}).bundle) || {};
      if (b.browser === browser && b.platform === platform) ok++;
      else if (!bad) bad = ua.slice(0, 40) + ' -> ' + b.browser + '/' + b.platform;
      if (/Pixel 8|Build\/|Win64|rv:|AppleWebKit|ada\.smith|14541/.test(String((res || {}).text))) leaked = ua.slice(0, 40);
    }
    check('the browser is reported from a declared list, never as the raw user agent',
      ok === UAS.length, bad || ok + '/' + UAS.length);
    check('...so nothing the user agent carries about the machine reaches the file', leaked === null, leaked);
  }
  {
    // "Optionally the capture" means its shape, not its pixels: an image is the
    // one thing in this product that IS the private content, and the user already
    // has it as a file to attach if they choose to.
    const env = newEnv();
    env.addTab({ id: 152, active: true, url: 'https://intranet.example.org/hr/pay?who=ada', title: 'Payroll — Ada Smith', script: { frames: 2 } });
    await startCapture(env, 152, 'full');
    const id = capturesOf(env)[0].id;
    const res = await diag(env, { captureId: id });
    const cap = (((res || {}).bundle) || {}).capture || null;
    check('the bundle can carry the capture that went wrong',
      !!cap && cap.id === id && cap.frames === 2, JSON.stringify(cap));
    check('...as its shape and origin, never its pixels or its page title',
      !/data:image|Ada Smith|who=ada|hr\/pay/.test(String((res || {}).text)) && !!cap && cap.origin === 'https://intranet.example.org',
      JSON.stringify(cap));
    const gone = await diag(env, { captureId: 'no-such-capture' });
    check('...and asking for a capture that is not there is answered, not thrown',
      gone && gone.ok === true && gone.bundle && gone.bundle.capture === null, JSON.stringify(gone && gone.bundle && gone.bundle.capture));
  }
  {
    // A bundle built when nothing has gone wrong is still a bundle: the user may
    // be reporting something the worker never saw.
    const env = newEnv();
    const res = await diag(env);
    const b = ((res || {}).bundle) || {};
    check('a bundle with no failure to report is still well formed',
      res && res.ok === true && b.lastError === null && b.page === '' && String((res || {}).text).length > 50,
      JSON.stringify(b.lastError));
    check('...and building one makes no network call and takes no screenshot',
      env.network.length === 0 && env.shots.length === 0, JSON.stringify(env.network));
  }

  /* ================= every failure reaches a person ================= */
  /* A failure that only reaches console.error is a failure the user experiences
     as nothing happening. The badge clears itself, a shortcut capture has no
     popup listening, and the batch page is a different surface again — so each
     path has to end at one of the three places a person actually looks. */
  console.log('\n=== every failure reaches a person ===');
  {
    const env = newEnv();
    const tab = env.addTab({ id: 160, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 160, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const m = env.mark();
    fire(env.onUpdated, 160, { status: 'loading' }, tab);
    await pump(env);
    const rec = env.session[ERR_KEY] || {};
    check('a page that navigates out from under a capture says so',
      notesSince(env, m) === 1 && rec.message === R_LOST_TAB, notesSince(env, m) + ' notes / ' + JSON.stringify(rec.message));
    check('...naming the mode the user asked for and the origin they were on',
      rec.mode === 'full' && rec.origin === 'https://docs.example.com', rec.mode + '/' + rec.origin);
  }
  {
    /* The control, and a deliberate silence: the user closing the tab IS the
       report. The worker also closes tabs itself, once per batch job, so a note
       here would be noise on every queue that ever runs. */
    const env = newEnv();
    const tab = env.addTab({ id: 161, script: { onStart: 'silent' } });
    await startCapture(env, 161, 'full');
    const m = env.mark();
    fire(env.onRemoved, 161, {});
    await pump(env);
    check('CONTROL: closing the tab yourself is not a failure to report back',
      notesSince(env, m) === 0, notesSince(env, m) + ' notes');
  }
  {
    /* A batch job whose page navigates mid-capture used to sit out the full 90 s
       job cap before anyone was told — the session was dropped, and the promise
       nobody rejected simply waited. */
    const env = newEnv({ script: { onStart: 'silent' } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 2000 });
    const jobTab = Array.from(env.tabs.values()).filter(t2 => /one\.test/.test(t2.url))[0];
    const t0 = env.clock.now();
    fire(env.onUpdated, jobTab.id, { status: 'loading' }, jobTab);
    await pump(env, { budget: 5000 });
    const jobs = jobsOf(env);
    check('a queued job killed by a navigation fails at once, not after the 90 s cap',
      at(jobs, 0).status === 'error' && env.clock.now() - t0 < 90000,
      at(jobs, 0).status + ' after ' + (env.clock.now() - t0) + 'ms');
  }
  {
    /* Asking for a second queue while one is running used to be answered "ok" and
       then dropped on the floor: the page rendered a plan that would never move. */
    const env = newEnv({ script: { frames: 1 } });
    await env.send({ type: 'BATCH_START', urls: ['https://one.test/', 'https://two.test/'] }, env.fromPage('pages/batch.html'));
    await pump(env, { budget: 1500 });
    const before = env.broadcasts.length;
    const res = await env.send({ type: 'BATCH_START', urls: ['https://three.test/'] }, env.fromPage('pages/batch.html'));
    check('a second queue while one is running is refused rather than swallowed',
      res && res.ok === false, JSON.stringify(res));
    check('...and the queue that IS running is put back on the page',
      env.broadcasts.length > before && (tail(env.broadcasts).batch || {}).jobs.length === 2,
      JSON.stringify((tail(env.broadcasts).batch || {}).jobs || []));
    await pump(env, { budget: 120000 });
    check('...without disturbing the queue it was asked to interrupt',
      jobsOf(env).length === 2 && jobsOf(env).every(j => j.status === 'done'), JSON.stringify(jobsOf(env).map(j => j.status)));
  }
  {
    /* The structural half. Every console.error in this worker is a developer's
       copy of something; the check is that none of them is the ONLY thing that
       happens on its path. Comments stripped first — the file explains this rule
       in prose next to the code that follows it. */
    const L = BG_SRC.replace(/\/\*[\s\S]*?\*\//g, m2 => m2.replace(/[^\n]/g, ' ')).split('\n');
    const sites = [], mute = [];
    L.forEach((line, i) => {
      if (line.indexOf('console.error(') < 0) return;
      sites.push(i + 1);
      const near = L.slice(Math.max(0, i - 20), i + 21).join('\n');
      if (!/recordError\(|sendResponse\(|flashBadge\(|batchReject\(|fsSettleJob\(/.test(near)) mute.push(i + 1);
    });
    check('no failure in this worker ends at console.error alone',
      mute.length === 0, 'silent at background.js line(s) ' + JSON.stringify(mute));
    check('...on a scan that really found the logging sites', sites.length >= 4, sites.length + ' sites');
  }

  /* ================= the sweep: rows nothing can reach ================= */
  /* publish/PRIVACY-POLICY.html §7 promises the user can remove what is kept.
     Two kinds of row make that false, and both are ordinary consequences of how
     a capture works rather than exotic failures:

       FRAMES WITH NO `captures` ROW. A full capture writes its frames one at a
       time and only seals the row at FS_DONE. Anything that stops it in between
       leaves full-resolution pictures on disk that NOTHING can consume —
       pages/result.js needs the row to stitch — and that appear on no page, so
       no page can delete them. `unlimitedStorage` means nothing evicts them
       either. The abort paths were fixed one at a time in v1.9.13; this is the
       general case, and the general case is what survives a worker that was
       killed before its own cleanup ran.

       `captures` ROWS WITH NO FRAMES. The mirror image, left by a result page
       that deleted the frames and died before deleting the row. Harmless in
       bytes and dishonest in kind: a record of a screenshot that no longer
       exists.

     Both are provable rather than heuristic — neither can be reached by any
     code path in this product — which is what makes deleting them safe enough
     to do without asking. Anything less provable is NOT swept: the controls
     below are the half of this section that matters. */
  console.log('\n=== the sweep: rows nothing can reach ===');
  const orphanFrames = (env, id, n) => {
    for (let i = 0; i < (n || 1); i++) {
      const k = env.db.api.frameKey(id, i);
      env.db.stores.frames.set(k, { k, captureId: id, index: i, x: 0, y: i * 800,
        dataUrl: 'data:image/png;base64,' + 'A'.repeat(2000) });
    }
  };
  const captureRow = (env, id, extra) => env.db.stores.captures.set(id, Object.assign({
    id, mode: 'full', title: 'A page', url: 'https://intranet.example.org/hr/pay',
    createdAt: env.clock.now(), meta: META, settings: {}
  }, extra || {}));
  const shotRow = (env, id, bytes) => env.db.stores.shots.set(id, {
    id, title: 'A page', url: 'https://intranet.example.org/hr/pay', createdAt: env.clock.now(),
    mode: 'full', w: 1200, h: 2400, format: 'png',
    segments: [{ blob: new Blob(['x'.repeat(bytes || 4096)], { type: 'image/png' }), w: 1200, h: 2400 }],
    thumb: new Blob(['t'.repeat(512)], { type: 'image/jpeg' })
  });
  /* A worker that has finished waking. The wake sweep below runs unprompted at
     every boot, so a test that seeds a leftover the instant the worker starts is
     racing it — and what it would be grading is the automatic pass, not the door
     the user pressed. Everything seeded after this models the other half of the
     product's life: junk that appeared while the worker was already up. */
  const awake = async env => { await pump(env, { budget: 0 }); return env; };
  const sweep = env => env.send({ type: 'DATA_SWEEP' }, env.fromPage('pages/options.html'));
  const dataStatus = env => env.send({ type: 'DATA_STATUS' }, env.fromPage('pages/options.html'));
  {
    const env = await awake(newEnv());
    orphanFrames(env, 'dead-1', 3);
    orphanFrames(env, 'dead-2', 2);
    // The byte weight of exactly what is about to go, counted here so the
    // check grades the number against the rows and not against the estimator.
    const deleted = Array.from(env.db.stores.frames.values())
      .reduce((n, f) => n + String(f.dataUrl || '').length, 0);
    const res = await sweep(env);
    await pump(env);
    check('frames left by a capture nothing can finish are found and removed',
      framesOf(env).length === 0 && res && res.ok === true && res.frames === 2,
      framesOf(env).length + ' frames left / ' + JSON.stringify(res));
    check('...and the space they were holding is reported back, measured not guessed',
      res && res.freed === deleted && res.freed > 4000,
      JSON.stringify([res && res.freed, deleted]));
  }
  {
    /* FOUND IN REAL CHROMIUM, NOT HERE. The first version of this asked
       navigator.storage.estimate() before and after and reported the
       difference — and in a real browser that difference is ZERO, or negative:
       IndexedDB reclaims lazily and Chrome's estimate is padded and cached, so
       nine deleted full-page frames reported "Space freed: 0 B". The number has
       to come from the rows being deleted, not from a figure the browser
       recomputes when it feels like it.
       Modelled by freezing the estimate, which is what the real one does over
       the second or so a sweep takes. */
    const env = await awake(newEnv({ storage: { frozen: true } }));
    orphanFrames(env, 'dead-6', 4);
    const res = await sweep(env);
    check('the freed number survives a browser whose estimate has not caught up',
      res && res.ok === true && res.frames === 1 && res.freed > 4000, JSON.stringify(res));
  }
  {
    const env = await awake(newEnv());
    captureRow(env, 'stub-1');
    const res = await sweep(env);
    check('a capture record with no frames left under it goes too',
      capturesOf(env).length === 0 && res && res.captures === 1, JSON.stringify(res));
  }
  {
    /* EVERY DELETION FAILED, AND THE ANSWER WAS INDISTINGUISHABLE FROM A CLEAN
       DATABASE (R-13). `try { await FSDB.deleteFrames(id); frames++; } catch (_) {}`
       counted successes and swallowed failures, so forty orphans that would not
       go returned {ok:true, frames:0} — byte-identical to the answer for a
       database with nothing left over — and the options page rendered "Nothing
       left over: everything stored belongs to a screenshot you can see." over
       forty full-resolution pictures of whatever was on the user's screen.
       background.js:1079 cites PRIVACY-POLICY §7 as this function's whole reason
       for existing, which is what makes a false all-clear here a broken promise
       rather than a cosmetic bug. */
    const env = await awake(newEnv({ hooks: { dbDeleteFrames: () => new Error('The database connection is closing.') } }));
    orphanFrames(env, 'stuck-1', 3);
    orphanFrames(env, 'stuck-2', 2);
    const res = await sweep(env);
    check('a sweep where every deletion failed does not answer like a clean database',
      res && res.ok === true && res.frames === 0 && res.found === 2 && res.failed === 2,
      JSON.stringify(res));
    check('...and the rows really are still there, so the count is not a scare',
      framesOf(env).length === 5, framesOf(env).length + ' frames');
  }
  {
    // The half-way case, which is the one a boolean cannot express.
    const env = await awake(newEnv({ hooks: { dbDeleteFrames: id => (id === 'half-2' ? new Error('aborted') : null) } }));
    orphanFrames(env, 'half-1', 2);
    orphanFrames(env, 'half-2', 2);
    const res = await sweep(env);
    check('a sweep that removed some of what it found says how many of how many',
      res && res.ok === true && res.found === 2 && res.frames === 1 && res.failed === 1,
      JSON.stringify(res));
  }
  {
    /* CONTROL: the success path still reports success, and `failed` is a real
       zero rather than a field nobody sets. */
    const env = await awake(newEnv());
    orphanFrames(env, 'fine-1', 2);
    captureRow(env, 'fine-stub');
    const res = await sweep(env);
    check('CONTROL: a sweep that worked reports every row it found as removed',
      res && res.ok === true && res.found === 2 && res.frames === 1 && res.captures === 1 && res.failed === 0,
      JSON.stringify(res));
  }
  {
    /* THE CONTROL THAT FAILS THE WRONG FIX, and the one a "delete everything
       that looks unused" sweep would trip over: a capture that finished is
       waiting for pages/result.js to stitch it, and its frames are the picture
       that page is about to open. */
    const env = await awake(newEnv());
    captureRow(env, 'waiting-1');
    orphanFrames(env, 'waiting-1', 3);
    const res = await sweep(env);
    check('CONTROL: a finished capture waiting for its result page is left alone',
      framesOf(env).length === 3 && capturesOf(env).length === 1 && res && res.frames === 0 && res.captures === 0,
      framesOf(env).length + ' frames / ' + capturesOf(env).length + ' captures');
  }
  {
    const env = await awake(newEnv());
    shotRow(env, 'kept-1');
    const res = await sweep(env);
    check('CONTROL: a screenshot in History is never touched by a sweep',
      env.db.stores.shots.size === 1 && res && res.frames === 0, env.db.stores.shots.size + ' shots');
  }
  {
    /* The live case, driven for real rather than seeded: a capture that is
       running RIGHT NOW has frames on disk and no `captures` row, which is the
       exact shape of an orphan. The session is what tells the two apart. */
    const env = newEnv();
    const tab = env.addTab({ id: 400, script: { onStart: 'silent' } });
    await startCapture(env, 400, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const res = await sweep(env);
    check('CONTROL: a capture that is running keeps every frame it has taken',
      framesOf(env).length === 1 && res && res.frames === 0,
      framesOf(env).length + ' frames / ' + JSON.stringify(res));
    // And it still finishes afterwards — the sweep is not allowed to be a
    // capture-killer with a tidy name. Pumped around the send, because the
    // frame after the first waits out the 550 ms floor on the virtual clock.
    const next = env.send({ type: 'FS_FRAME', index: 1, total: 2, x: 0, y: 800 }, env.senderTab(tab));
    await pump(env, { budget: 5000 });
    await next;
    await env.send({ type: 'FS_DONE', meta: META }, env.senderTab(tab));
    await pump(env);
    check('...and completes as if the sweep had never run', capturesOf(env).length === 1, capturesOf(env).length);
  }
  {
    /* KEYS, NOT PIXELS. The ids the sweep reasons about are the front half of
       every frame key, so asking for the records would pull an entire library of
       full-resolution screenshots through a service worker's memory to learn
       nothing the keys did not already say. */
    const env = await awake(newEnv());
    orphanFrames(env, 'dead-3', 4);
    shotRow(env, 'kept-2', 200000);
    env.reads.keys.length = 0; env.reads.getAll.length = 0;
    await sweep(env);
    check('the sweep asks the database for keys and never for pixels',
      env.reads.keys.length >= 2 && env.reads.getAll.length === 0,
      env.reads.keys.join(',') + ' | getAll: ' + env.reads.getAll.join(','));
  }
  {
    /* NOBODY HAS TO ASK. The commonest way an orphan is made is the worker being
       killed mid-capture, and the person it happened to has no idea it did. */
    const env = newEnv();
    orphanFrames(env, 'dead-4', 2);
    restart(env);
    await pump(env);
    check('a woken worker takes out what nothing can reach, unprompted',
      framesOf(env).length === 0, framesOf(env).length + ' frames left');
  }
  {
    /* ...and the ORDER that makes that safe: the wake adopts its sessions before
       it sweeps, or the sweep deletes the frames of the very capture the wake
       just rescued. */
    const env = newEnv();
    const tab = env.addTab({ id: 401, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    orphanFrames(env, 'live-2', 2);
    env.session[SESSIONS_KEY] = { at: env.clock.now() - 100, live: [{
      captureId: 'live-2', mode: 'full', windowId: 1, tabId: 401,
      origin: 'https://docs.example.com', startedAt: env.clock.now() - 900
    }] };
    restart(env);
    await pump(env);
    check('CONTROL: the wake adopts before it sweeps, so a rescued capture keeps its frames',
      framesOf(env).length === 2, framesOf(env).length + ' frames left');
    // Pumped around the send: an adopted session brings the rate-limit floor
    // back with it, so the next frame waits out the rest of the 550 ms.
    const p = env.send({ type: 'FS_FRAME', index: 2, total: 3, x: 0, y: 1600 }, env.senderTab(tab));
    await pump(env, { budget: 5000 });
    const res = await p;
    check('...and the capture it rescued can still take the next one', res && res.ok === true, JSON.stringify(res));
  }
  {
    const env = await awake(newEnv());
    shotRow(env, 'kept-3', 10000);
    shotRow(env, 'kept-4', 10000);
    orphanFrames(env, 'dead-5', 1);
    captureRow(env, 'stub-2');
    const st = await dataStatus(env);
    check('the page can ask what is on disk before it offers to remove any of it',
      st && st.ok === true && st.shots === 2 && st.leftovers === 2, JSON.stringify(st));
    check('...including how much space is used, and of how much',
      st && st.usage === env.usage() && st.quota === 2000000000, JSON.stringify([st && st.usage, env.usage()]));
  }
  {
    // A browser that does not answer the question is a third state, and reading
    // its silence as "0 bytes used" would put a confident lie on the page.
    const env = await awake(newEnv({ storage: false }));
    shotRow(env, 'kept-5', 1000);
    const st = await dataStatus(env);
    check('a browser with no storage estimate is reported as unknown, never as zero',
      st && st.ok === true && st.usage === null && st.quota === null && st.shots === 1, JSON.stringify(st));
  }
  {
    /* THE SAME SHAPE ONE FUNCTION ALONG. dataStatus swallowed an unreadable
       database into `shots = 0, leftovers = 0` and still answered ok:true —
       and those two numbers are what the delete-everything confirmation puts
       in front of the user before an irreversible wipe. "Screenshots in your
       History: 0" over a library it could not read is the sweep's bug with
       higher stakes: the reader agrees to destroy nothing and loses everything. */
    const env = await awake(newEnv({ hooks: { dbKeys: () => new Error('The database connection is closing.') } }));
    const st = await dataStatus(env);
    check('a database that cannot be counted is reported as unknown, never as zero',
      st && st.ok === true && st.shots === null && st.leftovers === null, JSON.stringify(st));
    const gone = await env.send({ type: 'DATA_DELETE_ALL' }, env.fromPage('pages/options.html'));
    check('...and the wipe reports its own count the same way',
      gone && gone.ok === true && gone.shots === null, JSON.stringify(gone));
  }
  {
    /* CONTROL for both: a database that answers is still counted, and the wipe
       still says how many screenshots it took. */
    const env = await awake(newEnv());
    shotRow(env, 'cnt-1', 1000);
    shotRow(env, 'cnt-2', 1000);
    orphanFrames(env, 'cnt-junk', 2);
    const st = await dataStatus(env);
    const gone = await env.send({ type: 'DATA_DELETE_ALL' }, env.fromPage('pages/options.html'));
    check('CONTROL: a readable database is counted, and the wipe reports the count',
      st && st.shots === 2 && st.leftovers === 1 && gone && gone.ok === true && gone.shots === 2,
      JSON.stringify([st && st.shots, st && st.leftovers, gone && gone.shots]));
  }
  {
    /* The structural half. `frames`, `captures`, `shots` — a fourth store added
       to pages/db.js and forgotten by the wipe is a store the user cannot empty,
       which is the promise this whole item exists to keep. Read off the shipped
       source so it fails on the store nobody remembered to mention. */
    const declared = (DB_SRC.match(/createObjectStore\(\s*'([a-z]+)'/g) || []).map(s => s.replace(/.*'([a-z]+)'.*/, '$1'));
    const listed = (/const STORES = \[([^\]]*)\]/.exec(DB_SRC) || [, ''])[1].match(/'([a-z]+)'/g) || [];
    check('every store the database creates is on the list the wipe and the sweep walk',
      declared.length >= 3 && declared.sort().join(',') === listed.map(s => s.replace(/'/g, '')).sort().join(','),
      'created: ' + declared.join(',') + ' | listed: ' + listed.join(','));
    /* AND THE WIPE HAS TO SPEND THAT LIST. This one is structural because it has
       to be: the storage layer under FSDB is faked here, so clearAll's actual
       IndexedDB transaction is the one part of pages/db.js this tier cannot
       execute — found by the teeth pass, where clearing only one store bit
       nothing at all. Two claims in one, and both matter: ONE transaction over
       the whole list (a wipe that stops half way leaves frames pointing at
       captures that are gone, which is the exact state the sweep exists to
       clean up), and every store in it cleared. */
    const body = (/clearAll\(\)\s*\{[\s\S]*?\n    \},/.exec(DB_SRC) || [''])[0];
    check('...and the wipe opens one transaction over that whole list and clears every store in it',
      /db\.transaction\(STORES, 'readwrite'\)/.test(body) && /STORES\.forEach\([^)]*=>\s*t\.objectStore\([^)]*\)\.clear\(\)\)/.test(body),
      body ? body.replace(/\s+/g, ' ').slice(0, 120) : 'no clearAll() found');
    /* AND THE SAME BLIND SPOT ONE FUNCTION ALONG, found the same way. Which IDB
       request hasKey() issues is invisible here — the storage layer is the fake,
       so swapping getKey() for get() bit nothing at all in the teeth pass — and
       it is not a detail: a `shots` row is an entire screenshot, one blob per
       segment plus a thumbnail, and the batch runner asks this question four
       times a second while it waits for one to appear. Reading the record to
       learn a boolean would pull a full-page capture through a service worker's
       memory on every poll. */
    const hk = (/hasKey\(store, key\)\s*\{[\s\S]*?\n    \},/.exec(DB_SRC) || [''])[0];
    check('...and "is there a row here" is asked with getKey, never by reading the record',
      /\.getKey\(key\)/.test(hk) && !/objectStore\(store\)\.get\(key\)/.test(hk),
      hk ? hk.replace(/\s+/g, ' ').slice(0, 110) : 'no hasKey() found');
  }

  /* ================= there is no room left ================= */
  /* A capture that dies because the disk is full is the one failure where the
     generic sentence is actively harmful: "please try again" is advice that
     cannot work, and the person retries until they give up. The condition is
     also the one thing in this file that must NOT be recognised by its text —
     the browser writes that message itself, in the user's language, and has
     changed it between versions. DOMException.name is the platform's own
     contract and does not move. */
  console.log('\n=== there is no room left ===');
  const R_STORAGE_FULL = 'There is no room left to store this capture. Delete some screenshots from your History, then try again.';
  {
    const env = newEnv({ hooks: { dbPut: store => (store === 'frames' ? quotaError() : null) } });
    env.addTab({ id: 410, active: true, url: 'https://intranet.example.org/hr/pay', script: { frames: 3 } });
    const m = env.mark();
    await startCapture(env, 410, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('a capture that runs out of room says so, in those words',
      rec.message === R_STORAGE_FULL, JSON.stringify(rec.message));
    check('...naming the capture the person asked for, not a fallback',
      rec.mode === 'full' && rec.origin === 'https://intranet.example.org', rec.mode + '/' + rec.origin);
    check('...and it is reported exactly once, with the badge a person can see',
      notesSince(env, m) === 1 && env.badgesSince(m).indexOf('!') >= 0,
      notesSince(env, m) + ' notes / ' + JSON.stringify(env.badgesSince(m)));
    check('...and nothing of the half-written capture is left on disk',
      framesOf(env).length === 0 && capturesOf(env).length === 0,
      framesOf(env).length + ' frames / ' + capturesOf(env).length + ' captures');
  }
  {
    /* THE POINT OF THE WHOLE MECHANISM. Chrome writes this message in the UI
       language; Firefox writes another one; both set the same name. A check that
       matched the English would pass in the room it was written in and fail
       everywhere else. */
    const env = newEnv({ hooks: { dbPut: store => (store === 'frames'
      ? quotaError('Der Speicherplatz reicht nicht aus, um den Vorgang abzuschließen.') : null) } });
    env.addTab({ id: 411, active: true, script: { frames: 2 } });
    await startCapture(env, 411, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('the disk being full is recognised by the error\'s NAME, in any language',
      rec.message === R_STORAGE_FULL, JSON.stringify(rec.message));
    check('...and the browser\'s own wording never reaches the person',
      !/Speicherplatz|reicht nicht/.test(JSON.stringify(env.session)), JSON.stringify(rec.message));
  }
  {
    // The visible-area flow reaches it through a different catch: the frame is
    // already on disk and it is the sealing write that fails.
    const env = newEnv({ hooks: { dbPut: store => (store === 'captures' ? quotaError() : null) } });
    env.addTab({ id: 412, active: true });
    const res = await startCapture(env, 412, 'visible');
    check('the same is true when it is the sealing write that fails',
      res && res.ok === false && res.error === R_STORAGE_FULL, JSON.stringify(res));
  }
  {
    /* CONTROL: every other DOMException still gets the sentence it got before.
       A quota check that answers for everything is not a quota check. */
    const env = newEnv({ hooks: { dbPut: () => { const e = new Error('The database connection is closing.'); e.name = 'InvalidStateError'; return e; } } });
    env.addTab({ id: 413, active: true, script: { frames: 2 } });
    await startCapture(env, 413, 'full');
    const rec = env.session[ERR_KEY] || {};
    check('CONTROL: a database failure that is NOT the disk keeps the old sentence',
      rec.message === 'The capture stopped unexpectedly. Please try again.', JSON.stringify(rec.message));
  }
  {
    const env = newEnv({ hooks: { dbPut: store => (store === 'frames' ? quotaError() : null) } });
    env.addTab({ id: 414, active: true, url: 'https://news.example.com/story', script: { frames: 2 } });
    await startCapture(env, 414, 'full');
    const pop = await bootPopup(env);
    check('the person reads it in the popup, next time they open it',
      pop.shown() && pop.text().indexOf('no room left') >= 0, pop.text());
  }
  check('the storage-full sentence is a key in the English message file',
    !!EN_MESSAGES.errStorageFull && EN_MESSAGES.errStorageFull.message === R_STORAGE_FULL,
    JSON.stringify(EN_MESSAGES.errStorageFull && EN_MESSAGES.errStorageFull.message));

  /* ================= your data, on the options page ================= */
  /* The shipped pages/options.js, running for real over the shipped
     pages/common.js and pages/db.js, against the same worker and the same
     database as every check above. */
  console.log('\n=== your data, on the options page ===');
  {
    const env = await awake(newEnv());
    shotRow(env, 'p-1', 300000);
    const page = await bootOptions(env);
    check('the page says how much space is used, and of how much',
      /of/.test(page.text('storageUsage')) && /MB|KB|B/.test(page.text('storageUsage')),
      JSON.stringify(page.text('storageUsage')));
    check('...and it is the real number, not a placeholder',
      page.text('storageUsage').indexOf('1.91 GB') < 0 && page.text('storageUsage').length > 4,
      JSON.stringify(page.text('storageUsage')));
  }
  {
    const env = newEnv({ storage: false });
    const page = await bootOptions(env);
    check('a browser that does not report its usage is said to be silent, not empty',
      /does not report/.test(page.text('storageUsage')), JSON.stringify(page.text('storageUsage')));
  }
  {
    /* PERSISTENCE IS THE WHOLE LIBRARY'S SURVIVAL. Without it the database sits
       in the best-effort bucket, and Chrome clears best-effort storage under
       disk pressure without asking and without telling. */
    const env = await awake(newEnv({ storage: { persisted: false, grant: true } }));
    shotRow(env, 'p-2', 1000);
    const page = await bootOptions(env);
    check('a best-effort library is named as one, plainly',
      /best-effort/.test(page.text('storageState')), JSON.stringify(page.text('storageState')));
    // Asked of the SHIPPED markup, not of a stub this harness invented: an id
    // options.html does not declare comes back as a <div> that is never hidden,
    // which would answer this check with an absence.
    check('...and the page offers to fix it',
      page.el('persistBtn').tagName === 'BUTTON' && page.el('persistBtn').hidden === false,
      page.el('persistBtn').tagName + ' hidden=' + page.el('persistBtn').hidden);
    await page.click('persistBtn');
    check('pressing it asks the browser exactly once', env.persistCalls === 1, env.persistCalls + ' calls');
    check('...and the answer is on the page', /will not clear/.test(page.text('storageState')), JSON.stringify(page.text('storageState')));
    check('...the button that no longer applies is gone', page.el('persistBtn').hidden === true, 'hidden=' + page.el('persistBtn').hidden);
    check('...and the keyboard is not left standing on it',
      page.doc.activeElement === page.el('storageState'), (page.doc.activeElement || {}).id);
  }
  {
    const env = newEnv({ storage: { persisted: false, grant: false } });
    const page = await bootOptions(env);
    await page.click('persistBtn');
    check('a browser that refuses leaves the warning standing rather than lying',
      /best-effort/.test(page.text('storageState')) && page.el('persistBtn').hidden === false,
      JSON.stringify(page.text('storageState')));
  }
  {
    const env = newEnv({ storage: { persisted: true } });
    const page = await bootOptions(env);
    check('CONTROL: a library that is already persistent is not asked about again',
      env.persistCalls === 0 && page.el('persistBtn').hidden === true, env.persistCalls + ' calls');
  }
  check('the worker never asks for persistence — the platform only offers it to a page',
    !/storage\s*\.\s*persist\b|FSDB\.persist\(/.test(BG_SRC), 'navigator.storage.persist in background.js');
  {
    /* EXPORT. "Show the size before writing" is not a nicety: the file is the
       user's entire screenshot library, and the difference between the two
       answers below is three orders of magnitude. */
    const env = await awake(newEnv());
    shotRow(env, 'e-1', 120000);
    shotRow(env, 'e-2', 80000);
    const page = await bootOptions(env);
    const withImages = page.text('exportSize');
    check('the size of the file is on the page before anything is written',
      /\d/.test(withImages) && env.downloads.length === 0, JSON.stringify(withImages));
    await page.set('exportImages', false);
    const without = page.text('exportSize');
    check('...and it changes when the images are left out',
      without !== withImages && without.length > 0, JSON.stringify([withImages, without]));
    check('...still without writing anything',
      env.downloads.length === 0 && page.el('exportBtn').tagName === 'BUTTON',
      env.downloads.length + ' downloads from a ' + page.el('exportBtn').tagName);
  }
  {
    const env = await awake(newEnv({ sync: { imageFormat: 'webp', filenameTemplate: 'shot-{domain}' } }));
    shotRow(env, 'e-3', 4096);
    shotRow(env, 'e-4', 2048);
    const page = await bootOptions(env);
    await page.click('exportBtn');
    check('exporting writes exactly one file', env.downloads.length === 1 && env.blobs.length === 1,
      env.downloads.length + ' downloads / ' + env.blobs.length + ' blobs');
    const text = env.blobs.length ? await env.blobs[0].text() : '';
    let doc2 = null;
    try { doc2 = JSON.parse(text); } catch (e) { doc2 = { parseError: String(e && e.message) }; }
    check('...and the file is one JSON document', !!doc2 && !doc2.parseError && typeof doc2 === 'object',
      doc2 && doc2.parseError ? doc2.parseError : 'parsed');
    check('...carrying the settings as they actually are',
      doc2 && doc2.settings && doc2.settings.imageFormat === 'webp' && doc2.settings.filenameTemplate === 'shot-{domain}',
      JSON.stringify(doc2 && doc2.settings));
    check('...and one row per screenshot, with the metadata the History page shows',
      doc2 && Array.isArray(doc2.screenshots) && doc2.screenshots.length === 2 &&
      doc2.screenshots.every(s => s.id && s.url && s.createdAt && s.w === 1200),
      JSON.stringify((doc2 && doc2.screenshots || []).map(s => s.id)));
    check('...and the images themselves, because that is what was asked for',
      /data:image\/png;base64,/.test(text), text.length + ' bytes');
    check('exporting sends nothing anywhere',
      env.network.length === 0 && env.blobs.length === 1, JSON.stringify(env.network));
  }
  {
    const env = await awake(newEnv());
    shotRow(env, 'e-5', 4096);
    const page = await bootOptions(env);
    await page.set('exportImages', false);
    await page.click('exportBtn');
    const text = env.blobs.length ? await env.blobs[0].text() : '';
    check('an export without the images holds no image at all',
      env.downloads.length === 1 && !/data:image/.test(text), text.length + ' bytes');
    check('...and still lists every screenshot it left out',
      /"e-5"/.test(text), text.slice(0, 200));
  }
  {
    /* DELETE EVERYTHING. Nothing here is undoable, so the sentence in front of
       the user has to be the whole truth: how many screenshots, how much space,
       and what is NOT included. */
    const env = await awake(newEnv());
    shotRow(env, 'd-1', 50000);
    shotRow(env, 'd-2', 50000);
    orphanFrames(env, 'd-junk', 3);
    env.session[ERR_KEY] = { when: env.clock.now(), mode: 'full', origin: 'https://x.example', tabId: 1, message: R_GENERIC };
    const page = await bootOptions(env, { confirm: { 'Delete everything': false } });
    await page.click('deleteAllBtn');
    const said = env.confirms.join(' | ');
    check('nothing is destroyed until the user has said yes',
      env.confirms.length === 1 && env.db.stores.shots.size === 2 && framesOf(env).length === 3,
      env.confirms.length + ' asked / ' + env.db.stores.shots.size + ' shots left');
    check('the confirmation counts the screenshots it is about to destroy', /\b2\b/.test(said), said);
    check('...counts what is left over from interrupted captures too', /\b1\b/.test(said), said);
    check('...names the space it will free', /MB|KB|GB|\bB\b/.test(said), said);
    check('...and says plainly what it will NOT touch', /settings/i.test(said), said);
  }
  {
    /* THE SENTENCE 54 OTHER LANGUAGES ACTUALLY GET. Everything above runs
       against a chrome with no i18n at all, so what it grades is the English
       FALLBACK compiled into pages/options.js — and the teeth pass proved the
       difference: gutting the shipped message left every behavioural check
       green, because the fallback still said it. Both halves are graded here,
       and against each other, so neither can drift from the other. */
    const en = (EN_MESSAGES.optionsDeleteAllConfirm || {}).message || '';
    check('the confirmation in the message file counts both kinds of thing and names the size',
      /\$COUNT\$/.test(en) && /\$LEFTOVER\$/.test(en) && /\$SIZE\$/.test(en), JSON.stringify(en.slice(0, 60)));
    check('...and states what it will NOT touch, and that it cannot be undone',
      /settings are not affected/i.test(en) && /cannot be undone/i.test(en), JSON.stringify(en.slice(-70)));
    /* The fallback, lifted out of the shipped source the same way the worker's
       own English is graded: one string, spent in one call, identical to the
       message it stands in for. */
    const OPT_JS = fs.readFileSync(path.join(ROOT, 'pages/options.js'), 'utf8');
    const cut = OPT_JS.indexOf("fsMessage('optionsDeleteAllConfirm'");
    const tail = cut < 0 ? '' : OPT_JS.slice(cut, cut + 900);
    const parts = (tail.match(/'([^'\\]|\\.)*'/g) || []).map(s => s.slice(1, -1))
      .filter(s => /Delete everything|Screenshots in|Leftovers|Space this|settings are not/.test(s));
    const fallback = parts.join('').replace(/\\n/g, '\n');
    check('...and the English the page falls back to is that same sentence, to the character',
      fallback === en, JSON.stringify(fallback.slice(0, 60)) + ' vs ' + JSON.stringify(en.slice(0, 60)));
  }
  {
    const env = await awake(newEnv());
    shotRow(env, 'd-3', 50000);
    orphanFrames(env, 'd-junk2', 2);
    captureRow(env, 'd-stub');
    env.session[ERR_KEY] = { when: env.clock.now(), mode: 'full', origin: 'https://x.example', tabId: 1, message: R_GENERIC };
    const page = await bootOptions(env, { confirm: { '*': true } });
    await page.click('deleteAllBtn');
    check('saying yes empties every store the database has',
      env.db.stores.shots.size === 0 && env.db.stores.frames.size === 0 && env.db.stores.captures.size === 0,
      [env.db.stores.shots.size, env.db.stores.frames.size, env.db.stores.captures.size].join('/'));
    check('...and the last-failure note goes with it, because it is stored data too',
      !(ERR_KEY in env.session), JSON.stringify(Object.keys(env.session)));
    check('...and the page says so afterwards', /Deleted/i.test(page.text('deleteAllResult')), JSON.stringify(page.text('deleteAllResult')));
  }
  {
    const env = await awake(newEnv({ sync: { captureDelay: 999, theme: 'dark' } }));
    shotRow(env, 'd-4', 1000);
    const page = await bootOptions(env, { confirm: { '*': true } });
    await page.click('deleteAllBtn');
    check('deleting the data leaves the settings exactly as they were',
      env.sync.captureDelay === 999 && env.sync.theme === 'dark', JSON.stringify([env.sync.captureDelay, env.sync.theme]));
  }
  {
    /* A capture in flight when the database is emptied cannot finish — its
       frames are being deleted — so it is retired rather than left to fail on
       rows that are no longer there. */
    const env = newEnv();
    const tab = env.addTab({ id: 420, url: 'https://docs.example.com/spec', script: { onStart: 'silent' } });
    await startCapture(env, 420, 'full');
    await env.send({ type: 'FS_FRAME', index: 0, total: 3, x: 0, y: 0 }, env.senderTab(tab));
    const page = await bootOptions(env, { confirm: { '*': true } });
    await page.click('deleteAllBtn');
    check('a capture that was running when everything went is told, not left hanging',
      (env.session[ERR_KEY] || {}).mode === 'full' && env.db.stores.frames.size === 0,
      JSON.stringify(env.session[ERR_KEY]));
    const p = env.send({ type: 'FS_FRAME', index: 1, total: 3, x: 0, y: 800 }, env.senderTab(tab));
    await pump(env, { budget: 5000 });
    const res = await p;
    check('...and its session is gone, so the engine is answered rather than fed',
      res && res.error === 'No active session', JSON.stringify(res));
  }
  {
    /* RESET TO DEFAULTS. The triage instructions in this repo say "reproduce on
       defaults" and until now there was no way to get there short of removing
       the extension. */
    const env = newEnv({ sync: { captureDelay: 999, hideFixed: false, theme: 'dark', filenameTemplate: 'mine-{date}', fsMigratedExpandDefault: true } });
    shotRow(env, 'r-1', 1000);
    const page = await bootOptions(env, { confirm: { 'default': true } });
    await page.click('resetBtn');
    check('reset puts every setting back to the value it shipped with',
      env.sync.captureDelay === 150 && env.sync.hideFixed === true && env.sync.theme === 'system' &&
      env.sync.filenameTemplate === 'fullshot-{domain}-{date}-{time}',
      JSON.stringify([env.sync.captureDelay, env.sync.hideFixed, env.sync.theme, env.sync.filenameTemplate]));
    check('...without touching a single screenshot', env.db.stores.shots.size === 1, env.db.stores.shots.size + ' shots');
    check('...and the controls on the page follow the values, not the other way round',
      page.el('captureDelay').value === 150 || page.el('captureDelay').value === '150',
      JSON.stringify(page.el('captureDelay').value));
    check('...and it said so', /default/i.test(page.text('resetResult')), JSON.stringify(page.text('resetResult')));
  }
  {
    const env = newEnv({ sync: { captureDelay: 999 } });
    const page = await bootOptions(env, { confirm: { 'default': false } });
    await page.click('resetBtn');
    check('CONTROL: a reset the user declined changes nothing',
      env.confirms.length === 1 && env.sync.captureDelay === 999, env.confirms.length + ' asked / ' + env.sync.captureDelay);
  }
  {
    const env = await awake(newEnv());
    orphanFrames(env, 's-junk', 3);
    captureRow(env, 's-stub');
    const page = await bootOptions(env);
    await page.click('sweepBtn');
    check('the leftovers button removes them and says what it removed',
      framesOf(env).length === 0 && capturesOf(env).length === 0 && /\b2\b/.test(page.text('sweepResult')),
      JSON.stringify(page.text('sweepResult')));
    check('...and names the space it freed', /MB|KB|\bB\b/.test(page.text('sweepResult')), JSON.stringify(page.text('sweepResult')));
  }
  {
    const env = await awake(newEnv());
    shotRow(env, 's-keep', 1000);
    const page = await bootOptions(env);
    await page.click('sweepBtn');
    check('...and says so plainly when there is nothing left over',
      /Nothing/i.test(page.text('sweepResult')) && env.db.stores.shots.size === 1,
      JSON.stringify(page.text('sweepResult')));
  }
  {
    /* THE SENTENCE THE FALSE ALL-CLEAR USED TO PRODUCE (R-13). Forty orphans
       that will not delete, and the page said "Nothing left over: everything
       stored belongs to a screenshot you can see." */
    const env = await awake(newEnv({ hooks: { dbDeleteFrames: () => new Error('The database connection is closing.') } }));
    orphanFrames(env, 's-stuck-1', 3);
    orphanFrames(env, 's-stuck-2', 2);
    const page = await bootOptions(env);
    await page.click('sweepBtn');
    const said = page.text('sweepResult');
    check('a sweep that removed nothing it found never reads as an all-clear',
      !/Nothing left over/i.test(said) && said.length > 0, JSON.stringify(said));
    check('...and the page names how many are still there',
      /\b0\b/.test(said) && /\b2\b/.test(said), JSON.stringify(said));
    check('...over rows that really did survive', framesOf(env).length === 5, framesOf(env).length + ' frames');
  }
  {
    const env = await awake(newEnv({ hooks: { dbDeleteFrames: id => (id === 's-half-2' ? new Error('aborted') : null) } }));
    orphanFrames(env, 's-half-1', 2);
    orphanFrames(env, 's-half-2', 2);
    const page = await bootOptions(env);
    await page.click('sweepBtn');
    const said = page.text('sweepResult');
    check('a partial sweep says how many of how many, rather than only the good half',
      /\b1\b/.test(said) && /\b2\b/.test(said) && !/Nothing left over/i.test(said), JSON.stringify(said));
  }
  {
    /* CONTROL: the ordinary outcomes are unchanged. A page that has learned to
       be gloomy about a working sweep has not been fixed. */
    const env = await awake(newEnv());
    orphanFrames(env, 's-ok-1', 2);
    captureRow(env, 's-ok-stub');
    const page = await bootOptions(env);
    await page.click('sweepBtn');
    const said = page.text('sweepResult');
    check('CONTROL: a sweep that worked still says only that it removed them',
      /Removed/i.test(said) && !/could not|still on this device/i.test(said) &&
      framesOf(env).length === 0 && capturesOf(env).length === 0,
      JSON.stringify(said));
  }
  {
    /* THE CONFIRMATION MAY NOT INVENT A ZERO (the dataStatus half of R-13).
       Nothing here is undoable, so a count the worker could not read has to
       arrive on the page as "unknown" and not as "none". */
    const env = await awake(newEnv({ hooks: { dbKeys: () => new Error('The database connection is closing.') } }));
    const page = await bootOptions(env, { confirm: { '*': false } });
    await page.click('deleteAllBtn');
    /* Read off the two COUNT lines rather than off the whole sentence: the
       size line legitimately says "0 B" for an origin holding nothing, and a
       check that cannot tell those apart is the same conflation as the bug. */
    const lines = env.confirms.join('\n').split('\n')
      .filter(s => /History|Leftovers/.test(s));
    check('a confirmation built on counts nobody could read puts no number in them',
      env.confirms.length === 1 && lines.length === 2 &&
      lines.every(s => /—/.test(s) && !/\d/.test(s)), JSON.stringify(lines));
  }
  {
    /* R-22 — A SETTINGS WRITE THAT FAILS. `setTimeout(save, 350)` with no catch
       inside it: storage.sync caps at 120 writes a minute and the 350 ms
       debounce issues about 170 under sustained typing, so the rejection is
       ordinary. What the user saw was the "Saved ✓" pill simply not appearing —
       and that pill appears on every other keystroke, so its absence reads as a
       rendering hiccup rather than as data that did not save. */
    const env = await awake(newEnv());
    const page = await bootOptions(env);
    await page.set('captureDelay', 800);
    await pump(env, { budget: 5000 });
    const first = page.text('saveNote');
    const realSet = env.chrome.storage.sync.set;
    env.chrome.storage.sync.set = async () => { throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'); };
    await page.set('captureDelay', 900);
    await pump(env, { budget: 5000 });
    const said = page.text('saveNote');
    check('a settings write that was refused says so rather than going quiet',
      first === 'Saved ✓' && said.length > 0 && said !== first && !/Saved ✓/.test(said),
      JSON.stringify(first) + ' -> ' + JSON.stringify(said));
    /* The pill is role="status", and a live region only fires on a CHANGE — so
       the failure has to REPLACE the confirmation still sitting there from the
       last keystroke, not merely fail to add a new one. */
    check('...and it replaces the confirmation the previous keystroke left standing',
      said !== first && env.sync.captureDelay === 800,
      JSON.stringify(said) + ' / stored ' + env.sync.captureDelay);
    env.chrome.storage.sync.set = realSet;
  }
  {
    /* CONTROL: the ordinary save still confirms, and still writes. */
    const env = await awake(newEnv());
    const page = await bootOptions(env);
    await page.set('captureDelay', 900);
    await pump(env, { budget: 5000 });
    check('CONTROL: a settings write that worked still says Saved',
      /Saved/.test(page.text('saveNote')) && env.sync.captureDelay === 900,
      JSON.stringify(page.text('saveNote')) + ' / ' + env.sync.captureDelay);
  }
  {
    const env = await awake(newEnv({ locale: 'hi' }));
    shotRow(env, 'hi-1', 1000);
    const page = await bootOptions(env, { confirm: { '*': false } });
    const devanagari = /[ऀ-ॿ]/;
    check('the whole section reads in the browser\'s language, not just the old half',
      devanagari.test(page.text('optionsSectionDataHeading')) || devanagari.test((page.doc._all.find(e => e.attrs['data-i18n'] === 'optionsSectionData') || {}).textContent || ''),
      JSON.stringify((page.doc._all.find(e => e.attrs['data-i18n'] === 'optionsSectionData') || {}).textContent));
    check('...including the sentence that asks before destroying anything',
      (await page.click('deleteAllBtn'), devanagari.test(env.confirms.join(' '))), JSON.stringify(env.confirms[0]));
  }
  {
    const env = newEnv();
    const page = await bootOptions(env);
    const missing = page.doc._asked.filter(id => OPTIONS_HTML.indexOf('id="' + id + '"') < 0);
    check('every id the options page asks for exists in options.html', missing.length === 0, JSON.stringify(missing));
    check('the page loads the database helper it now depends on',
      /<script src="db\.js"><\/script>/.test(OPTIONS_HTML), 'db.js script tag');
  }

  /* ================= the popup reads it back ================= */
  console.log('\n=== popup ===');
  {
    const env = newEnv();
    env.session[ERR_KEY] = {
      when: env.clock.now() - 5000, mode: 'full', origin: 'https://news.example.com', tabId: 9,
      message: 'The browser stopped handing over the screen part way through.'
    };
    env.addTab({ id: 91, active: true, url: 'https://news.example.com/story' });
    const pop = await bootPopup(env);
    check('the popup shows the parked failure the moment it opens', pop.shown(), 'hidden=' + !pop.shown());
    check('...in the words the worker parked', /stopped handing over the screen/.test(pop.text()), pop.text());
    check('...saying which capture it was', /full[- ]page/i.test(pop.text()), pop.text());
    check('...and which site it happened on', /news\.example\.com/.test(pop.text()), pop.text());
    check('the popup shows no stack trace and no code',
      !/\bat \w+ \(|Error:|chrome-extension:/.test(pop.text()), pop.text());
    check('the popup never looks for the note in sync storage',
      !env.syncGets.some(l => l.indexOf(ERR_KEY) >= 0), JSON.stringify(env.syncGets));
    const wasShown = pop.shown();
    await pop.click('errDismiss');
    check('dismiss hides the box', wasShown && !pop.shown(), 'shown ' + wasShown + ' -> ' + pop.shown());
    check('...and forgets the note for good', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }
  {
    const env = newEnv();
    env.addTab({ id: 92, active: true });
    const pop = await bootPopup(env);
    check('with nothing parked the popup opens clean', !pop.shown() && pop.text() === '', JSON.stringify(pop.text()));
  }
  {
    // One vocabulary: the worker owns the blocked-scheme list, so the specific
    // reason is what the user reads instead of the popup's own generic copy.
    const env = newEnv();
    env.addTab({ id: 93, active: true, url: 'chrome://settings/' });
    const pop = await bootPopup(env);
    await pop.mode('full');
    check('a browser page is refused with the worker\'s specific reason',
      /Settings, Extensions/.test(pop.text()), pop.text());
    check('...and the popup stays open to show it', !pop.closed(), 'closed=' + pop.closed());
  }
  {
    const env = newEnv();
    env.addTab({ id: 94, active: true, blockInject: true });
    const pop = await bootPopup(env);
    await pop.mode('full');
    check('a live failure from the worker is shown as it happens',
      pop.shown() && /browser restriction/.test(pop.text()), pop.text());
  }
  {
    const env = newEnv();
    env.addTab({ id: 95, active: true, script: { frames: 1 } });
    const pop = await bootPopup(env);
    await pop.mode('visible');
    check('a capture that starts closes the popup with nothing to say',
      pop.closed() && !pop.shown(), pop.text());
    check('...and leaves no failure behind it', !(ERR_KEY in env.session), JSON.stringify(env.session));
  }
  {
    const env = newEnv({ hooks: { inject: () => new Error('The message port closed before a response was received from https://intranet.example.org/hr/pay?who=ada') } });
    env.addTab({ id: 96, active: true, url: 'https://intranet.example.org/hr/pay?who=ada' });
    const pop = await bootPopup(env);
    await pop.mode('full');
    check('a live failure never puts a url path in front of the user',
      pop.shown() && !/who=ada|\/hr\/pay/.test(pop.text()), pop.text());
  }
  {
    /* End to end, over the fake chrome: the REAL worker parks a note built from
       the url that defeated attempt 2, and the REAL popup reads it back. This is
       the reviewer's own probe, run every time the suite runs. */
    const env = newEnv();
    const tab = env.addTab({ id: 97, active: true, url: 'https://app.example.com/dash' });
    await env.send({ type: 'FS_ERROR', error: 'Cannot access contents of url ' +
      '"https://shop.example/orders/o\'brien/receipt?token=SECRET7&card=4111". ' +
      'Extension manifest must request permission to access this host.' }, env.senderTab(tab));
    await pump(env);
    const pop = await bootPopup(env);
    check('the reviewer\'s probe, end to end: the popup shows the generic sentence',
      pop.shown() && pop.text().indexOf(R_GENERIC) >= 0, pop.text());
    // The origin in brackets is the one scheme the popup is meant to print —
    // originOf() already reduced it — so the sentence itself is what is scanned.
    const sentence = pop.text().split(' (https://app.example.com)')[0];
    check('...with no token, no path and no scheme in the sentence',
      !/SECRET7|o'brien|receipt|4111|:\/\//.test(sentence), sentence);
    check('...and it still tells the user which site and which capture it was',
      /app\.example\.com/.test(pop.text()), pop.text());
  }
  {
    /* v1.9.12's other gate, on this surface: a sentence that reaches the page as
       a text node cannot become markup, however the sentence was built. */
    check('the popup never assigns innerHTML at all', !/innerHTML/.test(POPUP_SRC), 'innerHTML');
    check('...the failure sentence reaches the page through textContent',
      /errText\.textContent\s*=/.test(POPUP_SRC), 'errText.textContent');
    check('...and reaches for no other markup sink either',
      !/insertAdjacentHTML|outerHTML|document\.write/.test(POPUP_SRC), 'markup sinks');
  }
  {
    /* THE ONE ANSWER THE ALLOWLIST CANNOT REACH. Every sentence above got here
       through wireReason() — but only because the message reached the worker.
       When runtime.sendMessage itself REJECTS (worker asleep and failed to
       wake, extension context invalidated, port closed), the popup's own catch
       supplies the answer and gate 2 never ran. That path renders whatever the
       engine said, on the exact surface the whole allowlist exists to protect.

       Driven for real: env.send is replaced with a rejection, and the SHIPPED
       popup handles it. */
    const env = newEnv();
    env.addTab({ id: 97, active: true, script: { frames: 1 } });   // a tab the popup CAN start on
    const HOSTILE = "Could not connect: file:///C:/Users/jane/o'brien/notes.txt" +
                    "?token=SECRET8&card=4111111111111111";
    env.send = () => Promise.reject(new Error(HOSTILE));
    const pop = await bootPopup(env);
    await pop.mode('full');
    check('a send that never reaches the worker still tells the user', pop.shown(), pop.text());
    check('...without the engine\'s own words',
      !/SECRET8|o'brien|4111|file:\/\/|jane|notes\.txt/.test(pop.text()), pop.text());
    check('...and the popup does not close over a failure',
      pop.closed() === false, String(pop.closed()));
    check('the popup never renders an exception message it caught itself',
      !/error:\s*e\.message/.test(POPUP_SRC),
      (POPUP_SRC.match(/error:\s*e\.message/g) || []).join(','));
  }
  {
    const pop = await bootPopup(newEnv());
    const missing = pop.doc._asked.filter(id => POPUP_HTML.indexOf('id="' + id + '"') < 0);
    check('every id the popup asks for exists in popup.html', missing.length === 0, JSON.stringify(missing));
    check('the dismiss control lives inside the failure box',
      ERR_PARTS.indexOf('errDismiss') > 0, JSON.stringify(ERR_PARTS));
    check('the failure box has its own text node, so dismiss survives a message',
      ERR_PARTS.indexOf('errText') > 0, JSON.stringify(ERR_PARTS));
    check('the popup still offers all five capture modes', POPUP_MODES.length === 5, JSON.stringify(POPUP_MODES));
  }

  /* ================= install & update ================= */
  console.log('\n=== onInstalled ===');
  {
    const env = newEnv();
    await fire(env.onInstalled, { reason: 'install' });
    await pump(env);
    check('a fresh install seeds every default', Object.keys(env.sync).length === 27, Object.keys(env.sync).length + ' keys');
    check('the seeded defaults are the shipped values',
      env.sync.expandInner === true && env.sync.captureDelay === 150 && env.sync.theme === 'system',
      JSON.stringify([env.sync.expandInner, env.sync.captureDelay, env.sync.theme]));
  }
  {
    // 1.3.0 flipped expandInner on for old installs — exactly once.
    const env = newEnv({ sync: { expandInner: false, captureDelay: 400 } });
    await fire(env.onInstalled, { reason: 'update', previousVersion: '1.2.0' });
    await pump(env);
    check('the one shipped migration flips expandInner on and stamps itself',
      env.sync.expandInner === true && env.sync.fsMigratedExpandDefault === true, JSON.stringify(env.sync));
    check('the migration touches nothing else', env.sync.captureDelay === 400, env.sync.captureDelay);
    env.sync.expandInner = false;                       // the user turns it back off
    await fire(env.onInstalled, { reason: 'update', previousVersion: '1.3.0' });
    await pump(env);
    check('a later update never overrides the user choice again', env.sync.expandInner === false, String(env.sync.expandInner));
  }
  {
    const env = newEnv({ sync: { theme: 'dark' } });
    await fire(env.onInstalled, { reason: 'chrome_update' });
    await pump(env);
    check('a browser update writes nothing', Object.keys(env.sync).join() === 'theme', JSON.stringify(env.sync));
  }

  clearTimeout(HANG);
  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
  process.exit(FAILS ? 1 : 0);
})();
