/* FullShot background service worker (MV3).
   Orchestrates captures: injects content scripts, grabs visible-tab frames
   (throttled), stores them in IndexedDB, tracks badge progress, and opens
   the result page when done. */

/* 🔴 GUARDED 2026-08-20, AND WITHOUT THIS THE FIREFOX ADD-ON IS DEAD ON LOAD.
   Chrome and Edge run this file as an MV3 SERVICE WORKER, where importScripts()
   is how the two helpers arrive. Firefox ignores background.service_worker and
   runs the file as one of background.scripts — a classic script, where
   importScripts is not defined at all. Unguarded, line 1 of the Firefox add-on
   throws ReferenceError and nothing after it ever runs.

   Nothing rewrites this file on the way into the zip: scripts/pack.mjs copies
   it verbatim, so what is here is what ships to both stores. The Firefox
   overlay already lists ["pages/db.js", "pages/batch.js", "background.js"] in
   background.scripts, so under Firefox the two helpers are ALREADY loaded, in
   that order, before this file runs — the import is not merely unsafe there,
   it is redundant. The guard is the whole port.

   `typeof` rather than a try/catch, and BEFORE the first call, because that is
   also the shape publish/verify-firefox-package.node.js greps for. The sandbox
   in test/background-sim.node.js supplies a real importScripts(), so the sims
   take the same branch Chrome does and their coverage is unchanged. */
if (typeof importScripts === 'function') {
  importScripts('pages/db.js');
  importScripts('pages/batch.js');   // v1.9.7: FSBatch pure core (queue/parse) in the worker
}

/* ---------------- the sentences, in the reader's language (v1.10.1) ---------------- */
/* Every sentence this worker can say has been translated into all 55 locales
   since the i18n phase, and until now not one of them was ever asked for: the
   worker was the last surface still speaking English to everybody, because it
   is the only one that is not a page and so was missed by the pass that
   converted the pages.

   Same shape as popup/popup.js's msg(), and for the same reason — the key and
   the English it resolves to, side by side at the point of use. The English is
   not documentation: it is what ships when there is no chrome.i18n at all (a
   stripped build, and the sandbox test/background-sim.node.js grades this file
   in), and it is graded against the message file, so the two cannot drift.

   Resolved ONCE, at module scope. getMessage is synchronous, and the UI locale
   cannot change under a running worker. */
function msg(key, english) {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      // Chrome answers an unknown key with the empty string rather than throwing,
      // which is exactly the cue to fall back rather than render a blank.
      const s = chrome.i18n.getMessage(key);
      if (s) return s;
    }
  } catch (_) {}
  return english;
}

/* chrome:// is a FAMILY, not a scheme. chrome-untrusted:// is where the browser
   puts its own sandboxed pages (the Terminal, the media app), chrome-search://
   backs the New Tab page and chrome-native:// its Android surfaces — and none of
   them match /^chrome:/, because the hyphen ends the alternative. Each was
   therefore treated as an ordinary web page: injected into, failed on, and
   answered with advice to reload a page where reloading cannot help. The
   browser reserves this whole prefix family, so matching the family is both
   safer and less to maintain than chasing each new one. */
const RESTRICTED = /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|moz-extension)(-[a-z]+)?:/;
const WEBSTORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

// A blocked page is not the user's mistake, so say which kind of page it is and
// what to do instead — "protected" on its own leaves nowhere to go.
// The extension row comes FIRST: chrome-extension:// is inside the widened
// browser-page family above, and the sentence written for it is the better one.
const RESTRICTED_REASONS = [
  [/^(chrome|moz)-extension:/, msg('errRestrictedExtensionPage', 'Extension pages, including FullShot\'s own, are protected by the browser and cannot be captured.')],
  [/^(chrome|edge|brave|about)(-[a-z]+)?:/, msg('errRestrictedBrowserPage', 'Browser pages such as Settings, Extensions and the New Tab page are off limits to every extension. Try FullShot on a normal web page.')],
  [/^devtools:/, msg('errRestrictedDevtools', 'DevTools windows cannot be captured by an extension. Use your computer\'s own screenshot tool for those.')],
  [/^view-source:/, msg('errRestrictedViewSource', 'View-source pages cannot be captured. Capture the page itself instead.')],
  [WEBSTORE, msg('errRestrictedWebstore', 'The Chrome Web Store blocks extensions from reading its pages, so this one cannot be captured.')]
];
const GENERIC_RESTRICTED = msg('errRestrictedGeneric', 'This page is protected by the browser and cannot be captured.');

/* The browser's own PDF viewer. It is not a document a content script can be
   put into, so every mode that needs one fails there — slowly, and then advises
   a reload that can never work. Anchored at the end of the PATH, never anywhere
   in the url: `?file=x.pdf` is a viewer page, and `x.pdf.html` is html.
   Recognising a PDF by its extension is a guess, and the carve-out below is what
   makes the guess cheap: captureVisibleTab photographs whatever is on screen,
   PDF viewer included, so the visible-area mode is never refused here. The worst
   a false positive can do is send someone to the other button, which works. */
const PDF_URL = /^[^?#]*\.pdf(?:[?#]|$)/i;

/* "Allow access to file URLs" is a switch on chrome://extensions, off by
   default, and this is the only way to read it. Without it a file:// page cannot
   be scripted at all — the injection fails with a host-permission error that is
   perfectly true and completely unhelpful. */
async function fileAccessAllowed() {
  try {
    if (typeof chrome !== 'undefined' && chrome.extension && chrome.extension.isAllowedFileSchemeAccess) {
      /* Compared against false rather than coerced, and that is the whole
         difference between this refusal and a bug. A browser that answers with
         nothing — no promise form, a version that dropped the method, Firefox —
         would be COERCED into "access denied", and every local file would be
         refused a capture that would have worked. Only an explicit no is a no;
         anything else falls through to the attempt, which is what happened
         before this check existed. */
      return (await chrome.extension.isAllowedFileSchemeAccess()) !== false;
    }
  } catch (_) {}
  return true;   // nothing to ask: let the attempt speak for itself
}

const DEFAULTS = {
  imageFormat: 'png',        // png | jpeg | webp
  jpegQuality: 0.92,         // also used for webp
  captureDelay: 150,         // extra ms to wait after each scroll
  hideFixed: true,           // hide fixed/sticky elements after first frame
  preScroll: false,          // scroll through page first to trigger lazy-loading
  adaptiveWait: true,        // decode not-yet-ready images before each frame — avoids black/blank tiles (v1.6.4)
  hideOverlays: false,       // hide consent banners/modals + unlock scroll-locking overlays (opt-in) (v1.6.6)
  expandInner: true,         // expand inner scroll panels & iframes to full content
  unrollVirtual: false,      // step embedded virtualized (render-window) lists to full content (v1.6.1)
  expandInteractive: false,  // open <details>/tabs/accordions before capture (v1.6.2)
  loadMore: false,           // click "load more"/"show more" buttons to append content before capture (opt-in) (v1.6.11)
  infiniteScroll: false,     // scroll to the bottom to trigger no-button infinite feeds before capture (opt-in) (v1.6.12)
  waitStable: false,         // wait for skeleton/placeholder loaders to resolve to real content before measuring (opt-in) (v1.6.13)
  redactPII: false,          // detect emails/phones/cards/SSNs/tokens in the page and bake an opaque block over each (opt-in, local-only) (v1.7.0)
  /* THE REDACTION WALK'S TIME BUDGET, in ms, and -1 means "the engine's own"
     (content/capture.js FS_PII_WALK_MS = 1,200). There is NO OPTIONS CONTROL for
     it and there is not meant to be one: it is here because a budget in
     milliseconds is a fact about the machine, so the giving-up point it guards
     cannot be reached from a test except by racing the runner — and on
     2026-08-31 the runner won and test/e2e/giveup-verify.mjs went red for it.
     A declared key rather than a hidden one, so `diagSettings` reports it and a
     value somebody left behind is visible rather than silent. */
  redactWalkMs: -1,
  maxPageHeight: 50000,      // CSS px safety cap for infinite feeds
  filenameTemplate: 'fullshot-{domain}-{date}-{time}',
  pdfPaper: 'auto',          // auto | a4 | letter | legal
  pdfOrientation: 'portrait',
  pdfStamp: false,           // stamp URL + date on PDF pages
  pdfSmartSplit: true,       // avoid cutting text lines at PDF page breaks
  saveDirectory: '',         // subfolder under Downloads ('' = Downloads root)
  saveAs: false,             // show "Save as" dialog when downloading
  clipboardFit: true,        // downscale clipboard copies past 25MP (Google Docs limit)
  autoDownload: false,
  autoOpenEditor: false,
  theme: 'system'
};

// One active capture session per tab.
const sessions = new Map(); // tabId -> { captureId, mode, windowId, total, done }

let lastShotAt = 0;
const MIN_GAP = 550; // ms between captureVisibleTab calls (Chrome quota: 2/sec)

/* ---------------- helpers ---------------- */

async function getSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return Object.assign({}, DEFAULTS, stored);
}

function isRestricted(url) {
  return !url || RESTRICTED.test(url) || WEBSTORE.test(url);
}

function restrictedReason(url) {
  for (const pair of RESTRICTED_REASONS) {
    if (pair[0].test(url || '')) return pair[1];
  }
  return GENERIC_RESTRICTED;
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || '#4f46e5' });
  chrome.action.setBadgeText({ text: text || '' });
}

function flashBadge(text, color, ms) {
  setBadge(text, color);
  setTimeout(() => setBadge(''), ms || 2500);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- the last-failure note (v1.9.13) ---------------- */
/* The badge clears itself after 2.5 s and a shortcut capture has no popup
   listening for the return value, so a failure that is only badged is one the
   user can never act on. Park the reason where the popup can read it next time
   it opens. storage.session — never local, never sync: the note dies with the
   browser and never leaves this machine. */
const LAST_ERROR_KEY = 'fsLastError';   // popup/popup.js reads this key back

/* Scheme and host only. A full URL can carry a name, an order number or a
   session token in its path or query, and this note outlives the capture.

   This is a character class, which is the shape that failed twice on the
   message field — so the difference is worth writing down rather than
   rediscovering. That class was POSITIVE and had to FIND a url inside prose in
   order to replace it: a character it did not know ended the match early and
   left the rest of the sentence, token and all, in the output. It failed OPEN.
   This one is NEGATED and the function EXTRACTS A PREFIX. It stops at the first
   '/', '?' or '#' — exactly the set RFC 3986 allows to end an authority — and
   everything from there on is discarded rather than carried, so a character it
   mishandles can only truncate the origin. There is no third outcome, whatever
   is in the path. */
function originOf(url) {
  const s = String(url || '');
  const withHost = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i.exec(s);
  if (withHost) {
    // Userinfo is part of the AUTHORITY, so stopping at the first slash keeps
    // "ada:hunter2@" — a password, which is worse than any of the things the
    // sentence above exists to drop. Reachable because tabs.create hands the
    // batch runner back the url as the user typed it, before the browser has
    // normalised anything away. The LAST '@' is the separator: an '@' is legal
    // inside the userinfo itself, and taking the first one would leave the real
    // host in the discarded half.
    const auth = withHost[2], at = auth.lastIndexOf('@');
    return withHost[1] + (at < 0 ? auth : auth.slice(at + 1));
  }
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(s);
  return scheme ? scheme[1] : '';
}

/* The note's other field that arrives ON a message. `mode` comes straight off
   START_CAPTURE from whoever sent it, so it is the one field the sentence
   allowlist below does not already cover — everything else in the note is a
   number, a tab id, or humanReason()'s output. Same answer, same shape: a
   declared set, and anything outside it becomes the word the paths that have no
   session to ask already record. Compared with indexOf, so nothing is coerced
   and no value gets asked for its own opinion of itself. */
const MODES = ['full', 'visible', 'region', 'element', 'capture'];

function knownMode(mode) {
  return MODES.indexOf(mode) >= 0 ? mode : 'capture';
}

async function recordError(mode, message, tab) {
  const note = {
    when: Date.now(),
    mode: knownMode(mode),
    origin: originOf(tab && tab.url),
    tabId: tab && tab.id != null ? tab.id : null,
    // Every note in the product is built here, so this is where the rule lives:
    // a caller that forgets — or one written next year — cannot get round it.
    // The rule is the allowlist below ("the reasons we recognise"), which also
    // answers a caller that passes nothing at all: no text, nothing recognised,
    // the generic sentence.
    message: humanReason(message)
  };
  try {
    await chrome.storage.session.set({ [LAST_ERROR_KEY]: note });
  } catch (_) { /* never fail a capture because the note could not be parked */ }
}

async function clearError() {
  try { await chrome.storage.session.remove(LAST_ERROR_KEY); } catch (_) {}
}

/* ---------------- one note per capture (P-17) ---------------- */
/* A mid-flight failure is reported TWICE, and the second report is worse than the
   first. Whichever path still holds the session parks a note that knows the mode
   the user actually asked for; the engine then echoes its own reason back as
   FS_ERROR, by which time the session has been released — so that handler has
   nothing left to ask, files the same failure again as a plain 'capture', and
   overwrites the accurate note. It lands at the one moment the note is the only
   thing the user has.

   The defence that was here matched two engine messages BY NAME, because those
   were the two someone had seen; every other throw walked past it. So the rule
   below is about the CAPTURE rather than about the words: park a note, mark the
   capture, and the echo — whatever it says — goes to the log and stops there.
   Those two names are gone from FS_ERROR as a result, which is the tell that this
   is the right rule and not the old one with more rows in it.

   KEYED BY CAPTURE, NEVER BY TAB. A tab can start another capture the instant the
   first one fails, and a mark that outlived its capture would gag a note the user
   is owed. Silence is worse than the duplicate it replaces: the duplicate at
   least said something. Two things hold the mark to its capture — the record is
   REPLACED when a capture starts, and a note may only mark the capture it
   actually belongs to (startCapture's catch can hold a session the map has
   already replaced, which is the same staleness the `live` check in that catch
   guards against before it drops frames).

   The mark is worker memory on purpose. It is only ever consulted by an echo from
   the capture that set it, and a capture cannot outlive the worker driving it, so
   a restart has nothing to sweep: module scope comes back empty and the next
   failure is reported in full. Nothing durable would help — a mark in
   storage.session would outlive the worker whose in-flight capture gave it
   meaning. The map is bounded by tabs that have run a capture in this worker's
   lifetime, which MV3 keeps short.

   Deliberately NOT cleared when the tab closes: a message already in flight when
   the tab went is still the same echo about the same capture, and the note parked
   before it is still the accurate one. */
const captureMarks = new Map();   // tabId -> { captureId, noted }

function beginCapture(session) {
  captureMarks.set(session.tabId, { captureId: session.captureId, noted: false });
}

/* Called by every path that parks a note while it still owns the session — the
   only paths that know which capture the note is about. */
function markNoted(session) {
  if (!session) return;
  const mk = captureMarks.get(session.tabId);
  // Identity, not presence: a superseded capture parking its own late note must
  // not answer for the capture that replaced it.
  if (mk && mk.captureId === session.captureId) mk.noted = true;
}

function alreadyNoted(tabId) {
  const mk = tabId == null ? null : captureMarks.get(tabId);
  return !!(mk && mk.noted);
}

/* ---------------- the worker is evicted mid-capture (v1.10.1) ---------------- */
/* THE RECURRING MV3 CORRECTNESS BUG, and the reason this file kept growing paths
   that "cannot happen". Chrome tears a service worker down whenever it feels
   like it — thirty seconds of quiet is enough, and a capture spends most of its
   life waiting for a content script to scroll — and everything in module scope
   goes with it: the session map, the rate-limit floor, the queue the batch loop
   is walking. What does NOT go is the content script driving the capture, the
   frames already in IndexedDB, or storage.session. So the worker wakes with
   amnesia into a page that is still working, and until now that produced silence:
   the next FS_FRAME was answered "No active session", the frames on disk were
   referenced by nothing, and the note that would have told the user was never
   written because the code that writes it was in the worker that died.

   The state is therefore mirrored to storage.session on every change. Two
   outcomes are acceptable when a worker comes back, and only two:

     ADOPT — a full/region/element capture is driven by a content script the
     eviction never touched. Rehydrating the session lets the very next message
     land on it, and the capture finishes: the worker was never the thing doing
     the work, only the thing remembering it.

     RETIRE — a visible capture is one awaited function inside startCapture, and
     a batch job is settled by a closure inside a loop. Neither can be reached
     from a message ever again, so the frames are dropped and the user is told.

   storage.session and NOT local or sync, for the same reason the failure note
   uses it: it dies with the browser, never syncs, and an in-flight capture has
   no meaning past either. The key is REMOVED when the last capture ends, so the
   store is empty whenever nothing is running. */
const SESSIONS_KEY = 'fsSessions';
/* A capture cannot still be running five minutes later: the batch job cap is 90
   seconds and the longest honest full-page capture is a few tens of frames at
   550 ms. Past this, a mirrored session is a record of something that died
   without saying so, and adopting it would keep a ghost alive in the map. */
const SESSION_MAX_AGE = 300000;
const RESUMABLE = ['full', 'region', 'element'];

let mirrorChain = Promise.resolve();

function persistSessions() {
  /* Snapshot NOW, write later. Two mutations in the same turn must reach storage
     in the order they happened; a second write that overtook the first would
     leave the mirror describing a state that never existed, and the whole point
     of the mirror is that it is believed by a worker with no other memory. */
  const live = Array.from(sessions.values()).map(s => ({
    captureId: s.captureId, mode: s.mode, windowId: s.windowId, tabId: s.tabId,
    // The ORIGIN, never the url. This record outlives the capture that wrote it
    // and is read back by a worker that knows nothing about that tab, which is
    // exactly the situation the parked note's own reduction exists for.
    origin: s.origin || '', startedAt: s.startedAt || 0, batch: !!s.batchResolve,
    /* The settings SNAPSHOT rides along, because the alternative is the bug it
       exists to close: a worker that woke into an adopted capture with no
       snapshot would have to re-read the preferences at FS_DONE, which is the
       stale read all over again and on the one path where the gap is longest.
       storage.session, like everything else in this mirror — it dies with the
       browser and never syncs — and every value in it is already written into
       IndexedDB for this same capture, so nothing new is being kept. */
    settings: s.settings || null
  }));
  const at = lastShotAt;
  mirrorChain = mirrorChain.then(() => (live.length
    ? chrome.storage.session.set({ [SESSIONS_KEY]: { at, live } })
    : chrome.storage.session.remove(SESSIONS_KEY))).catch(() => {});
  return mirrorChain;
}

/* A capture nobody can finish. Take the pixels with it — publish/PRIVACY-POLICY
   .html promises the user can remove what is kept, and frames referenced by no
   `captures` row appear on no page and are deletable from none — and then say
   so, because this is the failure that used to be perfectly silent. */
function retireSession(session) {
  dropFrames(session);
  // Marked as well as parked: the tab may still hold an engine about to report
  // the same failure in its own words, and the note written here is the one that
  // knows which mode the person asked for.
  beginCapture(session);
  markNoted(session);
  recordError(session.mode, R_LOST_TAB, { url: session.origin, id: session.tabId });
}

async function restoreSessions() {
  let rec = null;
  try {
    const got = await chrome.storage.session.get(SESSIONS_KEY);
    rec = got && got[SESSIONS_KEY];
  } catch (_) { return; }
  if (!rec || !Array.isArray(rec.live) || !rec.live.length) return;
  // The rate-limit floor is state too, and the cheapest of all to lose: a fresh
  // worker starts at zero and shoots the instant the engine asks, which walks a
  // resumed capture straight into the quota it was pacing itself to avoid.
  if (typeof rec.at === 'number' && rec.at > lastShotAt) lastShotAt = rec.at;
  const now = Date.now();
  const adopt = [], dead = [];
  for (const r of rec.live) {
    const session = {
      captureId: r.captureId, mode: knownMode(r.mode), windowId: r.windowId,
      tabId: r.tabId == null ? null : r.tabId, origin: r.origin || '',
      startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0, total: 0, done: 0,
      settings: (r.settings && typeof r.settings === 'object') ? r.settings : null
    };
    const drivable = session.tabId != null && !r.batch &&
      RESUMABLE.indexOf(session.mode) >= 0 && now - session.startedAt < SESSION_MAX_AGE;
    (drivable ? adopt : dead).push(session);
  }
  for (const s of adopt) { sessions.set(s.tabId, s); beginCapture(s); }
  persistSessions();   // reconcile: the mirror now says what THIS worker holds
  for (const s of dead) retireSession(s);
}

/* ---------------- the target must still be the tab on screen (v1.9.13) ---------------- */
/* captureVisibleTab photographs whatever is ACTIVE in the window — never "the tab
   that asked". Switch tabs mid-capture and the frames that come back are of
   another page, stitched into the user's screenshot without a word. For a tool
   whose output gets pasted into a chat that is a leak, not a glitch. */
const WRONG_TAB = msg('errWrongTab', 'Capture stopped — you switched tabs. Keep this page in front until FullShot finishes.');

async function onScreen(session) {
  // The window matters as much as the id: a tab dragged out into a window of its
  // own keeps that id, while the shot still goes to the windowId frozen at the
  // start. Asking that one window who is active settles both at once.
  try {
    const [active] = await chrome.tabs.query({ active: true, windowId: session.windowId });
    return !!active && active.id === session.tabId;
  } catch (_) {
    return false;   // the window is gone; nothing in it is worth photographing
  }
}

/* A capture that stops keeps nothing. A full capture stores frames one at a
   time and only seals its `captures` row at FS_DONE, so the frames of one that
   never finished are referenced by nothing: they do not appear on the History
   page, no UI can delete them, and `unlimitedStorage` means nothing evicts
   them. Each is a full-resolution picture of whatever was on screen — an
   intranet, a mailbox, a statement — and publish/PRIVACY-POLICY.html promises
   the user can remove what is kept. The success path already deletes its frames
   once the result page has stitched them (pages/result.js:510); every path
   below is the other half of that promise. Best effort by design: a capture is
   already failing here, and a failed cleanup must not mask why. */
function dropFrames(session) {
  if (!session || !session.captureId) return;
  try {
    Promise.resolve(FSDB.deleteFrames(session.captureId)).catch(() => {});
  } catch (_) {}
}

/* Give the session up rather than hand back a picture of a page the user never
   chose. Returns the refusal so the caller can pass it straight on. */
async function abortWrongTab(session, tab) {
  sessions.delete(session.tabId);
  persistSessions();
  dropFrames(session);
  if (session.batchReject) session.batchReject(WRONG_TAB);   // fail the job now, don't sit out the cap
  flashBadge('✕', '#dc2626');
  // capture.js:1586 throws a refused frame's own reason straight back at us, so
  // this refusal returns as an FS_ERROR echo moments from now.
  markNoted(session);
  await recordError(session.mode, WRONG_TAB, tab);
  return { ok: false, error: WRONG_TAB };
}

/* ---------------- the reasons we recognise (v1.9.13) ---------------- */
/* Two earlier attempts tried to SANITISE the engine's text on its way to the
   note. The first reduced nothing. The second reduced every url a regex could
   find down to its origin — and a reviewer beat it with an apostrophe in the
   path, because the class the regex used to find a url excluded the quote and
   Chrome does not percent-encode it. The match ended at the apostrophe, so only
   the stub in front of it was reduced and the whole remainder — token, card
   number, the lot — stayed in the sentence and reached the popup. Session 23
   already wrote the lesson down: when a validator is a REGEX rather than the
   platform parser, audit what its permissive capture lets through. A third
   character class is the same mistake a third time.

   So the shape of the problem changes here instead. Nothing is sanitised. A
   reason is RECOGNISED — text this product wrote, or an engine wording it has a
   translation for — or it is not, and everything that is not becomes ONE generic
   sentence. Both gates below return only strings declared in this file, so there
   is no character class left to get wrong and no future engine string, however
   spelled, can carry anything out of it. The raw text still goes to
   console.error: local, ephemeral, never stored and never rendered.

   The note it collapses into is not a shrug — it still carries origin, mode,
   tabId and when, which is what makes one sentence actionable. */
const R_GENERIC = msg('errGeneric', 'The capture stopped before it finished. Please try again.');
const R_BUSY = msg('errBusy', 'A capture is already running in this tab.');
const R_BLOCKED = msg('errBlocked', 'This page cannot be captured (browser restriction).');
const R_NO_START = msg('errNoStart', 'FullShot could not start on this page. Reload the page and try again.');
const R_CRASH = msg('errCrash', 'The capture stopped unexpectedly. Please try again.');
const R_UNKNOWN_MSG = msg('errUnknownMessage', 'Unknown message.');
/* The two the engine's own wordings translate INTO, named because more than one
   path hands them to a person now: a lost session is also what a capture whose
   worker was evicted comes back as. */
const R_LOST_TAB = msg('errLostTab', 'The capture lost track of this tab. Reload the page and try again.');
const R_FRAME_HANDOVER = msg('errFrameHandover', 'The browser stopped handing over the screen part way through. Wait a few seconds and try again.');
const R_STOPPED_EARLY = msg('errStoppedEarly', 'The capture was stopped before it finished.');
/* Chrome allows two captureVisibleTab calls a second and grabVisible backs off
   four times before it gives up. Every other sentence on that path ends in
   "reload", which is the wrong thing to do about a limit that clears itself in a
   second — it costs the user the page state they were trying to photograph and
   fixes nothing. Two wordings reach here: the one this file writes when it runs
   out of retries, and Chrome's own, which is what actually arrives today
   (the fourth attempt rethrows the browser's error rather than reaching the
   sentence below the loop). Both are literals so neither can drift from its row. */
/* The disk, not the rate limit. The two are one word apart in English and
   opposite in every way that matters: one clears itself in a second and the
   remedy is to wait, the other never clears itself and the remedy is to delete
   something. Which one happened is decided by FSDB.isQuotaError() — by the
   exception's NAME, never by its words. */
const R_STORAGE_FULL = msg('errStorageFull', 'There is no room left to store this capture. Delete some screenshots from your History, then try again.');
const R_QUOTA = msg('errQuota', 'The browser is limiting how fast pages can be photographed. Wait a moment and try again.');
const R_QUOTA_OWN = 'captureVisibleTab kept hitting the rate limit';
const R_QUOTA_CHROME = 'MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded';

/* Left: the exact text a FullShot code path or the engine produces. Right: what
   a person is shown for it. Most rows are the same text twice — the product
   already writes sentences — and the rows that differ are the engine's
   log-style wordings, which were never aimed at a person. */
const REASONS = [
  /* content/capture.js, and the answers it echoes back at us */
  ['Frame capture failed', R_FRAME_HANDOVER],
  ['No active session',    R_LOST_TAB],
  ['Capture aborted',      R_STOPPED_EARLY],
  /* the batch runner's own job outcomes (captureFullAwait). Terse on purpose:
     they are printed into a queue row next to the url they belong to — and they
     stay ENGLISH on both sides, because pages/batch.js keys its own translation
     off exactly these four words (JOB_ERROR_KEY). They are a protocol between
     two halves of this product, not a sentence anybody reads. */
  ['capture timed out',  'capture timed out'],
  ['no capture session', 'no capture session'],
  ['capture failed',     'capture failed'],
  ['capture error',      'capture error'],
  /* the capture quota, in both the wordings that can arrive */
  [R_QUOTA_OWN, R_QUOTA], [R_QUOTA_CHROME, R_QUOTA],
  /* sentences this worker writes itself */
  [WRONG_TAB, WRONG_TAB],
  [GENERIC_RESTRICTED, GENERIC_RESTRICTED],
  [R_GENERIC, R_GENERIC], [R_BUSY, R_BUSY], [R_BLOCKED, R_BLOCKED],
  [R_NO_START, R_NO_START], [R_CRASH, R_CRASH], [R_UNKNOWN_MSG, R_UNKNOWN_MSG],
  // Recognised on its own way back in: a batch job's reason goes out of this
  // worker and comes back through humanReason() to be printed in a queue row.
  [R_STORAGE_FULL, R_STORAGE_FULL]
].concat(RESTRICTED_REASONS.map(pair => [pair[1], pair[1]]));   // one per blocked family

const BY_TEXT = new Map();
for (const row of REASONS) {
  BY_TEXT.set(row[0].toLowerCase(), { wire: row[0], human: row[1] });
  // A sentence that has been through a gate once must survive a second pass
  // unchanged. Idempotence is cheaper to guarantee here than to prove at every
  // call site for every caller written from now on.
  if (!BY_TEXT.has(row[1].toLowerCase())) BY_TEXT.set(row[1].toLowerCase(), { wire: row[1], human: row[1] });
}

function knownReason(raw) {
  return BY_TEXT.get(String(raw == null ? '' : raw).trim().toLowerCase()) || null;
}

/* GATE 1 — what a person is shown: the parked note, and a batch queue row. */
function humanReason(raw) {
  const hit = knownReason(raw);
  return hit ? hit.human : R_GENERIC;
}

/* GATE 2 — what the router answers a caller with. Same membership test, and the
   same generic sentence for anything outside it; the only difference is that a
   protocol word stays the word the caller already branches on ("No active
   session" is read by content/capture.js, not by a human). Neither gate ever
   returns a substring of its argument. */
function wireReason(raw) {
  const hit = knownReason(raw);
  return hit ? hit.wire : R_GENERIC;
}

/* Resolves with the image — or with null when the target is no longer the tab on
   screen, which every caller must treat as an abort, never as a missing frame. */
async function grabVisible(session) {
  // Respect Chrome's captureVisibleTab rate limit; retry on quota errors.
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastShotAt + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    // Checked here, after the wait, so it is true at the moment of the shot: the
    // 550 ms floor and the 700 ms quota backoff are each long enough for a tab
    // switch to land inside them, and a multi-frame capture reopens the gap
    // between every pair of frames.
    if (!(await onScreen(session))) return null;
    lastShotAt = Date.now();
    // Mirrored with the sessions, so a worker that wakes into the middle of this
    // capture knows how long ago the last shot was. Chrome allows two a second
    // and counts them per BROWSER, not per worker: the quota does not reset
    // because the thing pacing itself against it was evicted.
    persistSessions();
    try {
      const shot = await chrome.tabs.captureVisibleTab(session.windowId, { format: 'png' });
      // And again on the way out. The check above is a fact about the moment
      // BEFORE the shot; the shot is itself a window a switch can land inside,
      // and what comes back then is a photograph of the page the user moved to.
      // Checking only in front of the call is time-of-check/time-of-use — it
      // narrows the gap and never closes it. Two checks bracket the whole call,
      // so a frame is stored only if the target was on screen either side of it.
      if (!(await onScreen(session))) return null;
      return shot;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|rate|quota/i.test(msg) && attempt < 3) {
        await sleep(700);
        continue;
      }
      throw e;
    }
  }
  // Unreachable while the loop's last attempt always returns or rethrows — kept
  // because the retry budget is a tuned number, and the next hand to tune it
  // should land on a sentence the table already knows rather than on nothing.
  throw new Error(R_QUOTA_OWN);
}

async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
}

function openResultTab(captureId, tab) {
  const url = chrome.runtime.getURL('pages/result.html') + '?id=' + encodeURIComponent(captureId);
  return chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* ---------------- capture flows ---------------- */

/* The reason this page cannot be captured in this mode, or '' — asked BEFORE the
   tab is touched. Every answer here is a page where the injection could only
   ever have failed, and a failed injection costs the person the wait AND a
   sentence ending in "reload the page and try again", which is advice that
   cannot work on any of them.
   Mode-aware, because the block is not about the page but about what the mode
   needs: captureVisibleTab photographs whatever is on screen without asking the
   document anything, so the visible-area mode is never refused here. */
async function preflight(tab, mode) {
  const url = (tab && tab.url) || '';
  if (mode === 'visible') return '';
  if (PDF_URL.test(url)) return GENERIC_RESTRICTED;
  if (/^file:/i.test(url) && !(await fileAccessAllowed())) return R_BLOCKED;
  return '';
}

/* Everything that can refuse a capture BEFORE the tab is touched, in one
   function so the delayed arm of the router can ask the same questions in the
   same order without duplicating them (R-20). Two questions, one answer: the
   schemes the browser reserves, then the pages it renders itself. */
async function refuseReason(tab, mode) {
  if (!tab || isRestricted(tab.url)) return restrictedReason(tab && tab.url);
  return await preflight(tab, mode);
}

/* What a refusal DOES, as opposed to what it is. Badged, parked and returned —
   and in one place, so the router's delayed arm cannot answer a refusal without
   also leaving the note behind. */
async function refuse(mode, reason, tab) {
  flashBadge('✕', '#dc2626');
  await recordError(mode, reason, tab);
  return { ok: false, error: reason };
}

async function startCapture(tab, mode, startDelay) {
  /* Asked again here even when the router already asked: this runs at the
     moment the capture actually starts, and a countdown is three seconds in
     which the tab can navigate somewhere the answer is different. */
  const blocked = await refuseReason(tab, mode);
  if (blocked) return await refuse(mode, blocked, tab);
  if (sessions.has(tab.id)) {
    return { ok: false, error: R_BUSY };
  }

  if (startDelay > 0) {
    for (let s = startDelay; s > 0; s--) {
      setBadge(String(s), '#f59e0b');
      await sleep(1000);
    }
    setBadge('');
  }

  const settings = await getSettings();
  const captureId = newId();
  // origin and startedAt are carried for the mirror, and only for the mirror: a
  // worker that wakes into this capture has no tab to ask and no clock of its
  // own to work out how long ago this was.
  /* THE SNAPSHOT TRAVELS WITH THE SESSION (R-18). The `captures` row used to be
     sealed with a FRESH `await getSettings()` at FS_DONE — the preferences as
     they stand minutes after the pass the row describes. Anything that writes
     one in between (Options open in another tab, a sync write from another
     machine landing, the user changing their mind mid-scroll) makes the record
     describe a capture that never ran: content/capture.js is right to derive
     what it did from the settings it was HANDED, and this is the seam that
     undid it. The engine is handed `settings` below; the row is sealed from the
     same object. One read, one capture, one answer. */
  const session = { captureId, mode, windowId: tab.windowId, tabId: tab.id, total: 0, done: 0,
    origin: originOf(tab.url), startedAt: Date.now(), settings };
  sessions.set(tab.id, session);
  // A new capture in this tab retires whatever the last one left behind: this
  // capture's failure is its own, and must be reported however the last one went.
  beginCapture(session);
  persistSessions();

  try {
    if (mode === 'visible') {
      const shot = await captureVisibleFlow(tab, session, settings);
      if (!shot.ok) return shot;   // the tab moved out from under the countdown
    } else if (mode === 'region' || mode === 'element') {
      await injectFile(tab.id, 'content/region.js');
      await chrome.tabs.sendMessage(tab.id, {
        type: 'FS_REGION_START',
        pick: mode === 'element' ? 'element' : 'drag'
      });
      // Session stays open; continues on FS_REGION_SELECTED / FS_REGION_CANCEL.
      setBadge(mode === 'element' ? '◉' : '⬚', '#4f46e5');
    } else {
      await injectFile(tab.id, 'content/capture.js');
      setBadge('…');
      // Cross-origin frame expansion needs the optional <all_urls> grant.
      let expandFrames = false;
      if (settings.expandInner) {
        try { expandFrames = await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (_) {}
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: 'FS_START',
        captureId,
        settings: {
          captureDelay: settings.captureDelay,
          hideFixed: settings.hideFixed,
          preScroll: settings.preScroll,
          maxPageHeight: settings.maxPageHeight,
          expandInner: settings.expandInner,
          unrollVirtual: settings.unrollVirtual,
          expandInteractive: settings.expandInteractive,
          loadMore: settings.loadMore,
          infiniteScroll: settings.infiniteScroll,
          waitStable: settings.waitStable,
          adaptiveWait: settings.adaptiveWait,
          hideOverlays: settings.hideOverlays,
          redactPII: settings.redactPII,
          /* Named here rather than left to the engine's constant for the reason
             the block above gives: the walk's budget travels WITH the settings
             the pass is handed, so the ledger's `budgetMs` is the number that
             pass actually raced. -1 (the shipped default) is "no override". */
          redactWalkMs: settings.redactWalkMs,
          expandFrames
        }
      });
      // Continues via FS_FRAME / FS_DONE messages.
    }
    return { ok: true };
  } catch (e) {
    // Everything the try above guards runs BEFORE captureVisibleFlow seals its
    // `captures` row, so a throw here abandons a session and its frames like any
    // other abort. Asked by IDENTITY, not by presence, and that distinction is
    // the whole point: captureVisibleFlow seals the row and takes itself out of
    // the map before it opens the result page, so a throw from that last step
    // belongs to a capture that WORKED — dropping its frames would delete the
    // picture result.js is opening in order to stitch. The map is keyed by tab
    // id, which a later capture in the same tab reuses, so "is one there?" is
    // not the same question as "is it still mine?".
    const live = sessions.get(tab.id) === session;
    sessions.delete(tab.id);
    persistSessions();
    if (live) dropFrames(session);
    setBadge('');
    const msg = String(e && e.message || e);
    // The browser's own wording belongs in the log, where a developer reads it
    // at a devtools prompt — never interpolated into what we store or show.
    console.error('FullShot could not start the capture:', msg);
    // The allowlist first. Both fallbacks below end in "reload", which is right
    // for a page that will not start and wrong for a quota that clears itself —
    // and the quota is the one wording that reaches here from the browser.
    const known = knownReason(msg);
    /* The disk first, and asked of the EXCEPTION rather than of its text. Both
       fallbacks below end in "reload the page and try again", which on a full
       disk is advice that cannot work — the person retries until they give up.
       Reached here by the visible-area flow, where the frame is already stored
       and it is the row that seals it that fails. */
    const reason = FSDB.isQuotaError(e) ? R_STORAGE_FULL
      : known ? known.human
      : /Cannot access|cannot be scripted|showing error page|Extensions manifest/i.test(msg)
        ? R_BLOCKED
        : R_NO_START;
    // Marked with the SESSION, not with the tab: `live` above says this capture
    // may already have been replaced, and a note about a dead one must not gag
    // the live one's own report.
    markNoted(session);
    await recordError(mode, reason, tab);
    return { ok: false, error: reason };
  }
}

/* `piiPass: false` in the row below is written by the branch that DECIDES: this
   flow never calls collectPIIBoxes, and "this code path did not run the pass" is
   a fact about FullShot's own execution (REDACTION-CLAIM-SPEC.md §3.6a).

   It must be an explicit false. An ABSENT piiPass is `unknown`, because "we do
   not know whether the pass ran" is precisely unknown and `pass-not-run` may
   never be entered by elimination — but leaving it absent would also raise
   "treat the image as unredacted" on every crop the user ever takes with the
   setting on, forever, which is how a warning becomes wallpaper.

   (It sits inside the object literal rather than above it because the structural
   check in test/background-sim reads a 12-line window above every
   `sessions.delete` for the `captures` write that exempts it. That window is a
   safety gate about abandoned frames and it does not get widened for a comment.) */
async function captureVisibleFlow(tab, session, settings, cropRect, dpr) {
  const dataUrl = await grabVisible(session);
  if (dataUrl === null) return await abortWrongTab(session, tab);
  await FSDB.put('frames', {
    k: FSDB.frameKey(session.captureId, 0),
    captureId: session.captureId,
    index: 0, x: 0, y: 0,
    dataUrl
  });
  await FSDB.put('captures', {
    id: session.captureId,
    mode: cropRect ? 'region' : 'visible',
    title: tab.title || '',
    url: tab.url || '',
    createdAt: Date.now(),
    meta: { cropRect: cropRect || null, dpr: dpr || null, piiPass: false },
    settings
  });
  sessions.delete(session.tabId);
  persistSessions();
  setBadge('');
  await clearError();   // a shot that worked answers whatever went wrong last time
  await openResultTab(session.captureId, tab);
  return { ok: true };
}

/* ---------------- batch URL capture (v1.9.7) ---------------- */
/* Sequential: open each URL in an active tab, wait for load, run the SAME full
   capture flow (into history), then next. Browser-only glue over the FSBatch
   pure core (parse/queue). Needs the optional <all_urls> grant (requested by the
   batch page). Bounded by the pure core's cap + per-job timeouts. */
const BATCH_JOB_TIMEOUT = 90000;    // per-URL hard cap (load + capture + stitch-store)
const BATCH_LOAD_TIMEOUT = 30000;   // wait-for-load cap (proceed anyway after)
/* The wait for the SCREENSHOT, which is a different thing from the wait for the
   capture and needs its own cap: FS_DONE has already landed by then, so the job
   timeout above has nothing left to fire against. Sixty seconds is the stitcher
   working on a very long page in a tab the browser is not prioritising. */
const BATCH_STITCH_TIMEOUT = 60000;
const BATCH_STITCH_POLL = 250;
/* The row is written before the result page has finished with it — autoDownload
   fires after the record lands (result.js:138) — so closing the tab the instant
   the key appears can cut a download off at the knees. The same brief settle
   waitForTabComplete gives a freshly loaded page, for the same kind of reason. */
const BATCH_STITCH_SETTLE = 600;
let batchRunning = false;
let currentBatch = null;

/* A QUEUE IS THE SHAPE THAT SUFFERS MOST FROM AN EVICTION, and every sibling
   tool with one has this bug. runBatch walks its list in a `for` loop, and the
   whole of its progress is a local variable in a function nobody can call
   again: evict the worker mid-item and the loop is simply gone. No error, no
   rejection, nothing — the page that asked sits on "capturing…" for ever, and
   the person concludes the tool is broken rather than that it was interrupted.
   Mirrored at the one place a queue's state ever changes on screen, so the two
   cannot disagree. */
const BATCH_KEY = 'fsBatch';
let batchChain = Promise.resolve();

function persistBatch() {
  // Driven by batchRunning rather than by the caller, so the last broadcast of a
  // finished queue — which happens after the flag is cleared — is also what
  // clears the mirror. One rule, no second place to forget.
  const rec = batchRunning && currentBatch
    ? { at: Date.now(), jobs: currentBatch.jobs.map(j => ({ url: j.url, status: j.status, error: j.error, shotId: j.shotId })) }
    : null;
  batchChain = batchChain.then(() => (rec
    ? chrome.storage.session.set({ [BATCH_KEY]: rec })
    : chrome.storage.session.remove(BATCH_KEY))).catch(() => {});
  return batchChain;
}

function broadcastBatch(batch) {
  currentBatch = batch;
  persistBatch();
  chrome.runtime.sendMessage({ type: 'BATCH_PROGRESS', batch }).catch(() => {});
}

/* There is no resuming a queue: the tab it had open is gone, and the promise
   that would have settled the job in flight died with the worker holding it. So
   settle what is left and say so — an honest row of failures a person can retry
   is worth more than a queue that never moves again. */
async function restoreBatch() {
  let rec = null;
  try {
    const got = await chrome.storage.session.get(BATCH_KEY);
    rec = got && got[BATCH_KEY];
    // Removed before anything else can go wrong: a queue is retired exactly
    // once, and a record that survived its own retirement would be retired again
    // at every wake from now on.
    if (rec) await chrome.storage.session.remove(BATCH_KEY);
  } catch (_) { return; }
  if (!rec || !Array.isArray(rec.jobs) || !rec.jobs.length) return;
  const batch = { jobs: rec.jobs, started: true };
  let unfinished = 0;
  batch.jobs.forEach((job, i) => {
    if (job.status === 'done' || job.status === 'error') return;
    unfinished++;
    FSBatch.fsSettleJob(batch, i, false, { error: R_LOST_TAB });
  });
  if (!unfinished) return;
  // Not broadcastBatch(): that one owns the mirror and adopts the batch as the
  // running one. This queue is being retired, not run.
  chrome.runtime.sendMessage({ type: 'BATCH_PROGRESS', batch }).catch(() => {});
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(to);
      try { chrome.tabs.onUpdated.removeListener(onUpd); } catch (_) {}
      setTimeout(resolve, 600);   // brief settle for late paint
    };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const to = setTimeout(finish, BATCH_LOAD_TIMEOUT);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then(t => { if (t && t.status === 'complete') finish(); }).catch(() => {});
  });
}

/* Run the full capture flow on `tab` and resolve with its captureId when FS_DONE
   lands (hooked via session.batchResolve) — no result tab is opened for batch. */
function captureFullAwait(tab) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = id => { if (settled) return; settled = true; clearTimeout(to); resolve(id); };
    const fail = e => { if (settled) return; settled = true; clearTimeout(to); reject(new Error(e)); };
    const to = setTimeout(() => fail('capture timed out'), BATCH_JOB_TIMEOUT);
    startCapture(tab, 'full').then(res => {
      if (!res || !res.ok) { fail((res && res.error) || 'capture failed'); return; }
      const session = sessions.get(tab.id);
      if (!session) { fail('no capture session'); return; }
      session.batchResolve = ok; session.batchReject = fail;
      // The mirror was written before these two existed, and they are what makes
      // this session unresumable: a promise settled by a closure in a loop cannot
      // be picked up by a worker that has forgotten the loop.
      persistSessions();
    }).catch(e => fail(String((e && e.message) || e)));
  });
}

/* ---------------- a job is done when there is a SCREENSHOT (v1.10.2) ----------------
   FS_DONE means the engine finished scrolling and the frames are on disk. It
   does NOT mean a screenshot exists. The only thing in this product that turns
   frames into a `shots` row is pages/result.js, reached through
   result.html?id=, and the batch arm opened no result page at all — so "done"
   was inferred from the last MESSAGE of a capture rather than observed on the
   artifact, and fifty urls produced fifty green ticks, fifty dead "open" links
   (pages/batch.js links result.html?shot=, which resolves against `shots`), an
   empty History, and fifty full-resolution captures sitting on disk that no
   page can show and planSweep deliberately spares.

   So the queue opens the result page too. HIDDEN — a queue must not take the
   screen fifty times — and closed again the moment it has produced the row.

   THE WAIT IS ON THE DATABASE, NOT ON A HANDSHAKE. A message the page sends is
   one more thing that can be lost, and it would only ever attest that the page
   THINKS it finished; the `shots` row is the thing History lists and the thing
   the queue's own "open" link resolves against, so it is the only fact worth
   settling a job on. hasKey and not get: the row is the whole screenshot.

   THE HIDDEN TAB IS THE RISK IN THIS DESIGN AND IT IS NAMED HERE. Chrome
   throttles background tabs and the stitcher does canvas work across awaits, so
   the row can be slow or can never arrive. That is precisely why the poll is
   also a chrome.tabs.get: it is an extension API call, which keeps this worker's
   idle timer from expiring under a wait that is otherwise pure IndexedDB — and
   it is how a result tab the user closed is noticed rather than waited out.
   When the row does not come the job FAILS. Frames and `captures` row are left
   exactly where they are: result.html?id= can still stitch them, and deleting a
   person's pixels because a tab was slow is not an improvement on lying. */
async function stitchAwait(captureId) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('pages/result.html') + '?id=' + encodeURIComponent(captureId),
      active: false
    });
    const until = Date.now() + BATCH_STITCH_TIMEOUT;
    for (;;) {
      if (await FSDB.hasKey('shots', captureId)) {
        await sleep(BATCH_STITCH_SETTLE);
        return captureId;
      }
      if (Date.now() >= until) return null;
      await sleep(BATCH_STITCH_POLL);
      /* Throws once the tab is gone — closed by the user, or lost with a crashed
         renderer — and there is nothing left to wait for when it is. Answered
         the same way as the timeout rather than rethrown, so that every "there
         is no screenshot" outcome reaches the queue as one word. */
      try { await chrome.tabs.get(tab.id); } catch (_) { return null; }
    }
  } finally {
    if (tab) { try { await chrome.tabs.remove(tab.id); } catch (_) {} }
  }
}

async function runBatch(urls) {
  if (batchRunning) return;
  batchRunning = true;
  const batch = FSBatch.fsCreateBatch(urls);
  try {
    broadcastBatch(batch);
    for (;;) {
      const i = FSBatch.fsNextJob(batch);
      if (i < 0) break;
      FSBatch.fsStartJob(batch, i);
      broadcastBatch(batch);
      let tab = null;
      try {
        tab = await chrome.tabs.create({ url: batch.jobs[i].url, active: true });
        await waitForTabComplete(tab.id);
        /* RE-READ THE TAB; NEVER REUSE THE SNAPSHOT create() ANSWERED WITH.
           The navigation cannot have committed in the turn that asked for it, so
           that Tab carries `pendingUrl` and an EMPTY `url` — and the first
           question startCapture asks is whether the url is one the browser
           reserves, where `!url` counts as reserved. So every job in every queue
           was refused with "This page is protected by the browser and cannot be
           captured." before it took a single frame. Found in Chromium
           (test/e2e/batch-artifact.mjs); invisible to a fake that answers
           create() with the url already in place, which is what the sim used to
           do and no longer does.
           After the load is also the honest moment to ask: a url that redirected
           somewhere an extension may not touch is refused here rather than half
           way through a capture. */
        const loaded = await chrome.tabs.get(tab.id);
        const captureId = await captureFullAwait(loaded);
        // The job's own tab has done everything it can; close it before the
        // stitch so the queue never holds two tabs open for one url.
        try { await chrome.tabs.remove(tab.id); } catch (_) {}
        tab = null;
        const shotId = await stitchAwait(captureId);
        // No row, no screenshot, no tick. 'capture failed' rather than a new
        // wording: it is the row pages/batch.js already has a translation for
        // (JOB_ERROR_KEY -> batchJobFailed), and it is what happened — the
        // capture did not produce a screenshot the person can open.
        if (!shotId) throw new Error('capture failed');
        FSBatch.fsSettleJob(batch, i, true, { shotId });
      } catch (e) {
        // runBatch reaches startCapture DIRECTLY, so the router's gate never
        // sees this reason — and broadcastBatch puts it on pages/batch.html.
        // Same allowlist, applied at the one place a job's reason is recorded.
        // (The old .slice(0, 120) bounded text of unknown length; every reason
        // is now one of a fixed set of sentences, so there is nothing to bound.)
        FSBatch.fsSettleJob(batch, i, false, { error: humanReason((e && e.message) || e) });
      } finally {
        if (tab) { try { await chrome.tabs.remove(tab.id); } catch (_) {} }
      }
      broadcastBatch(batch);
      await sleep(300);   // breathe between tabs (also eases the captureVisibleTab quota)
    }
  } finally {
    batchRunning = false;
    setBadge('');
    broadcastBatch(batch);
  }
}

/* ---------------- report a problem, with nowhere to send it (v1.10.1) ---------------- */
/* This product makes no network calls and never will, so there is no crash
   reporter and no inbox. What is left is worth more anyway: a bundle the person
   can READ IN FULL, save, and send to whoever they choose — which is the only
   version of this feature that does not quietly become telemetry.
   Everything below follows from that:
     - it is built by NAMING the fields that may go in, never by copying a state
       and cleaning it up afterwards. A scrub has to find every secret; a pick
       cannot carry one it was never asked for. Same answer as the reason
       allowlist above, applied to a different kind of value;
     - the worker returns the exact TEXT rather than writing a file, so the bytes
       shown and the bytes saved are the same bytes. There is no second rendering
       to drift, and no path where something is written before it is seen. */
const DIAG_TITLE = 'FullShot diagnostic bundle';
/* Longest first where one contains another: every Edge and Opera user agent also
   says Chrome, and every Android one also says Linux. */
const DIAG_BROWSERS = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Brave/', 'Brave'], ['Chrome/', 'Chrome'], ['Firefox/', 'Firefox']];
const DIAG_PLATFORMS = [['CrOS', 'ChromeOS'], ['Android', 'Android'], ['Windows', 'Windows'], ['Macintosh', 'macOS'], ['X11', 'Linux'], ['Linux', 'Linux']];
const DIAG_UNKNOWN = 'unknown';
/* The values a string setting is allowed to have. Anything else is reported as a
   state rather than as itself — a person's own words are the one thing in the
   settings table that could carry anything. */
const DIAG_ENUMS = {
  imageFormat: ['png', 'jpeg', 'webp'],
  pdfPaper: ['auto', 'a4', 'letter', 'legal'],
  pdfOrientation: ['portrait', 'landscape'],
  theme: ['system', 'light', 'dark']
};
const DIAG_DEFAULT = '(default)', DIAG_SET = '(set)', DIAG_OTHER = '(other)';

function userAgent() {
  try {
    if (typeof navigator !== 'undefined' && navigator && navigator.userAgent) return String(navigator.userAgent);
  } catch (_) {}
  return '';
}

/* Digits only, at most four, stopping at the first character that is not one.
   Not a character class hunting through the string — the token is found with
   indexOf and this reads FORWARD from it into a closed set, so the worst a
   surprising user agent can do is produce a shorter number or none. The output
   shape is a name from the list above plus digits, and there is nowhere in that
   for the build id, the device model or the kernel version to hide. */
function diagVersion(ua, token) {
  let i = ua.indexOf(token) + token.length, out = '';
  while (out.length < 4 && i < ua.length && ua[i] >= '0' && ua[i] <= '9') out += ua[i++];
  return out;
}

function diagBrowser() {
  const ua = userAgent();
  for (const row of DIAG_BROWSERS) {
    if (ua.indexOf(row[0]) < 0) continue;
    const v = diagVersion(ua, row[0]);
    return v ? row[1] + ' ' + v : row[1];
  }
  return DIAG_UNKNOWN;
}

function diagPlatform() {
  const ua = userAgent();
  for (const row of DIAG_PLATFORMS) if (ua.indexOf(row[0]) >= 0) return row[1];
  return DIAG_UNKNOWN;
}

function diagSettings(settings) {
  const out = {};
  // The DECLARED keys and no others. A key someone else left in storage.sync — a
  // migration flag, an experiment, whatever a future version writes — is not
  // something this file can vouch for, so it does not travel.
  for (const key of Object.keys(DEFAULTS)) {
    const value = settings[key], fallback = DEFAULTS[key];
    if (typeof fallback === 'boolean') { out[key] = value === true; continue; }
    if (typeof fallback === 'number') { out[key] = (typeof value === 'number' && isFinite(value)) ? value : fallback; continue; }
    const allowed = DIAG_ENUMS[key];
    if (allowed) { out[key] = allowed.indexOf(value) >= 0 ? value : DIAG_OTHER; continue; }
    // What is left is free text a person typed: a filename template and a
    // download folder. Whether they changed it is the diagnostic fact; what they
    // wrote is their business, and can hold a name, a client or a card number.
    out[key] = value === fallback ? DIAG_DEFAULT : (value ? DIAG_SET : DIAG_DEFAULT);
  }
  return out;
}

function diagNumber(n) { return (typeof n === 'number' && isFinite(n)) ? n : null; }

/* Rebuilt field by field rather than passed on. This is the one part of the
   bundle that comes back out of storage, and a record is not to be trusted more
   for having been written by an older version of this same file. */
function diagLastError(note) {
  if (!note || !note.message) return null;
  return {
    when: diagNumber(note.when),
    mode: knownMode(note.mode),
    origin: originOf(note.origin),
    message: humanReason(note.message)
  };
}

async function diagCapture(captureId) {
  if (!captureId) return null;
  try {
    const row = await FSDB.get('captures', captureId);
    if (!row) return null;
    const frames = await FSDB.getFrames(captureId);
    const meta = row.meta || {};
    return {
      id: row.id,
      mode: knownMode(row.mode),
      createdAt: diagNumber(row.createdAt),
      // Origin, like everywhere else — and no title: a page title is on-screen
      // text ("Payroll — Ada Smith") and belongs to the person, not to the report.
      origin: originOf(row.url),
      width: diagNumber(meta.totalW), height: diagNumber(meta.totalH), dpr: diagNumber(meta.dpr),
      frames: frames.length,
      /* The pixels are the private part — the whole reason this product does not
         upload anything — and the user already has them as a file to attach if
         they choose to. A bundle that embedded them could not honestly be read
         before it was sent, which would break the one promise it makes. */
      imagesIncluded: false
    };
  } catch (_) { return null; }
}

async function buildDiagnostics(req) {
  const settings = await getSettings();
  let note = null;
  try {
    const got = await chrome.storage.session.get(LAST_ERROR_KEY);
    note = got && got[LAST_ERROR_KEY];
  } catch (_) {}
  let version = '';
  try { version = String((chrome.runtime.getManifest() || {}).version || ''); } catch (_) {}
  const lastError = diagLastError(note);
  const bundle = {
    report: DIAG_TITLE,
    when: new Date().toISOString(),
    version,
    browser: diagBrowser(),
    platform: diagPlatform(),
    // The failing page, through the same reducer the parked note goes through:
    // scheme and host, with nothing left that can carry an order number.
    page: originOf((lastError && lastError.origin) || (req && req.url) || ''),
    settings: diagSettings(settings),
    lastError,
    // What was running when they asked. Modes and origins only, which is what
    // makes "it happens on that one site" a thing a reader can act on.
    inFlight: Array.from(sessions.values()).map(s => ({ mode: knownMode(s.mode), origin: originOf(s.origin) })),
    capture: await diagCapture(req && req.captureId)
  };
  return { ok: true, bundle, text: JSON.stringify(bundle, null, 2) };
}

/* ---------------- the data lifecycle (v1.10.1) ---------------- */
/* publish/PRIVACY-POLICY.html §7 tells the user, in as many words, that they can
   remove what FullShot keeps. Until now that was true of exactly one of the four
   things it keeps: a screenshot in History can be deleted from the History page.
   The other three could not be reached at all —

     the frames of a capture that stopped: full-resolution pictures of whatever
     was on screen, on no page and therefore deletable from none;
     the `captures` rows their result page never came back for;
     the settings, which had no way back to the values they shipped with.

   The three functions below are the doors. They live in the worker rather than
   on the page for one reason: the worker is the only half that knows which
   captures are running, and every one of these operations is a decision about
   rows a running capture may own. A page that asked the database directly would
   be racing the capture engine. */

function liveCaptureIds() {
  return Array.from(sessions.values()).map(s => s.captureId);
}

/* THE WEIGHT OF WHAT IS ABOUT TO GO, read off the rows themselves.
   The first version of this asked navigator.storage.estimate() before and
   after and reported the difference — and in real Chromium that difference is
   ZERO. IndexedDB reclaims lazily and the estimate is padded and cached, so a
   sweep that had just deleted nine full-page frames reported "Space freed:
   0 B" (and sometimes a negative number). Found by running it in a browser,
   not here.
   So the number comes from the frames being deleted. Reading records rather
   than keys is the exception the sweep's own rule allows: the PLAN spans the
   whole database and is computed from keys alone, while this reads only the
   rows already condemned, one capture at a time — the same working set
   pages/result.js holds to stitch one capture. A frame's dataUrl is base64
   text and its length is what the row weighs, within a byte per character. */
async function frameBytes(captureId) {
  try {
    const frames = await FSDB.getFrames(captureId);
    return frames.reduce((n, f) => n + ((f && typeof f.dataUrl === 'string') ? f.dataUrl.length : 0), 0);
  } catch (_) { return 0; }
}

/* THE GENERAL CASE of the orphan bug that was fixed one abort at a time in
   v1.9.13. Those fixes each closed one door; this closes the room. A worker that
   is killed between writing a frame and sealing its row runs none of them, and
   that is the commonest way an orphan is made — so this also runs unprompted at
   every wake, which is the only moment in an MV3 extension's life that is
   guaranteed to happen after a crash.

   The rule itself is pages/db.js:planSweep — pure, and deliberately narrow
   enough to be provable. All this function does is ask for keys, hand them over,
   and delete what comes back. */
async function sweepOrphans() {
  let plan;
  try {
    const [frameKeys, captureIds] = await Promise.all([FSDB.keys('frames'), FSDB.keys('captures')]);
    // The protect list is read HERE, in the same turn as the keys: a capture in
    // flight owns frames that have no `captures` row yet, and the session map is
    // the only thing that tells those from the frames of a capture that died.
    plan = FSDB.planSweep({ frameKeys, captureIds, protect: liveCaptureIds() });
  } catch (e) {
    // Nothing to tell and nobody to tell it to on the wake path; the caller that
    // asked gets ok:false and logs it beside its own answer.
    return { ok: false, found: null, frames: 0, captures: 0, failed: null, freed: null };
  }
  /* WHAT WAS FOUND, ALONGSIDE WHAT WENT. The counters below used to be
     successes only, with every failure swallowed by an empty catch — so forty
     orphans that would not delete returned {ok:true, frames:0}, a value
     BYTE-IDENTICAL to the answer for a database with nothing left over, and the
     options page rendered "Nothing left over: everything stored belongs to a
     screenshot you can see." over forty full-resolution pictures of whatever
     had been on the person's screen. Both numbers were in scope and neither was
     returned. This function's whole reason for existing is the promise cited
     at the head of this section, which makes a false all-clear here a broken
     promise rather than a cosmetic bug.
     The empty catches stay — a sweep must not abandon the other 39 rows because
     one would not go — but what they swallow is now counted and reported. */
  const found = plan.frames.length + plan.captures.length;
  let frames = 0, captures = 0, freed = 0, failed = 0;
  for (const id of plan.frames) {
    // Weighed before it is deleted, for the obvious reason.
    const bytes = await frameBytes(id);
    try { await FSDB.deleteFrames(id); frames++; freed += bytes; } catch (_) { failed++; }
  }
  for (const id of plan.captures) {
    // A row on this list has no frames under it by definition, so there is
    // nothing to weigh: it is a few hundred bytes of metadata.
    try { await FSDB.delete('captures', id); captures++; } catch (_) { failed++; }
  }
  return { ok: true, found, frames, captures, failed, freed };
}

/* What is on disk, asked before anything is offered — the page cannot honestly
   say "this will delete 24 screenshots and free 310 MB" without it. */
async function dataStatus() {
  const before = await FSDB.estimate();
  /* NULL, NEVER ZERO — the same rule the storage estimate above it already
     follows, and for higher stakes. These two numbers go straight into the
     delete-everything confirmation, and a database that would not answer used
     to arrive there as "Screenshots in your History: 0": the reader agrees to
     destroy nothing and loses their whole library. A count is a measurement;
     this is the absence of one, and the page has to be able to tell them apart.
     Assigned one at a time on purpose, so a read that got as far as the shots
     keys reports that count and only leaves the one it could not compute. */
  let shots = null, leftovers = null;
  try {
    const [frameKeys, captureIds, shotIds] = await Promise.all(
      [FSDB.keys('frames'), FSDB.keys('captures'), FSDB.keys('shots')]);
    shots = shotIds.length;
    const plan = FSDB.planSweep({ frameKeys, captureIds, protect: liveCaptureIds() });
    leftovers = plan.frames.length + plan.captures.length;
  } catch (_) { /* an unreadable database is reported as unknown, never as a throw */ }
  return { ok: true, usage: before.usage, quota: before.quota, shots, leftovers, inFlight: sessions.size };
}

/* EVERYTHING, and nothing that is not the user's data. Settings are not touched
   — they are a separate door on the same page, and a person who wants their
   screenshots gone has not asked to have their filename template reset. */
async function deleteAllData() {
  // Same rule as dataStatus: a count nobody could read is null. This one is a
  // report of what went rather than an offer of what could, so nothing renders
  // it today — which is exactly why it is worth getting right now, before
  // something does and inherits a zero that means "the read failed".
  let shots = null;
  try { shots = (await FSDB.keys('shots')).length; } catch (_) {}
  /* The parked failure note is stored data too, and it goes FIRST: a capture
     retired below parks a note of its own, and that one is about something that
     is happening now rather than something that happened before. */
  await clearError();
  /* retireSession is the drop-and-tell shape: it takes the frames with it and
     says so. A capture cannot survive having its pixels deleted underneath it,
     and being told is the difference between a wipe and a mystery. It sits
     directly under the delete because that is where the next reader of this
     loop will look for it — and because the scan in test/background-sim.node.js
     that insists every abandoned session is dropped reads exactly that window. */
  for (const session of Array.from(sessions.values())) {
    sessions.delete(session.tabId);
    persistSessions();
    retireSession(session);
  }
  try {
    await FSDB.clearAll();
  } catch (e) {
    return { ok: false, error: R_GENERIC };
  }
  /* No "freed" number here, deliberately. The whole database goes, so the
     honest figure is the one the CONFIRMATION already showed before the user
     agreed — and a second number measured afterwards would be the estimator's
     stale one (see frameBytes above). Reporting nothing beats reporting 0 B. */
  return { ok: true, shots };
}

/* ---------------- message router ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  /* The note is one surface, this is the other: whatever the router answers with
     goes on screen in the popup as it stands (popup/popup.js:72), and some of
     those answers are built out of a raw exception. One wrapper here means no
     case below can leak by forgetting to reduce its own — the catch at the
     bottom of this router still hands the exception straight in. */
  /* Admitted on the PRESENCE of an error, never on its type. Testing for a
     string first would let everything that is not one straight past — an Error
     object, null, whatever a case written next year hands in — and a backstop
     that fails open is worse than none, because the cases under it are written
     assuming it is there. A recognised reason is a string by construction (the
     table is keyed by them), so anything else cannot be one and gets the generic
     sentence WITHOUT being stringified: String() on a foreign object runs that
     object's own code, which is not a thing a guard does to the value it is
     guarding against. An absent error is not an error, and passes through. */
  const sendResponse = r => respond(r && typeof r === 'object' && r.error !== undefined
    ? Object.assign({}, r, { error: typeof r.error === 'string' ? wireReason(r.error) : R_GENERIC })
    : r);
  (async () => {
    try {
      /* The wake and the message that caused it arrive together. Everything
         below reads the session map, and a worker that has not finished
         remembering has an empty one — which reads as "No active session" to a
         capture that is still running perfectly well in the page. */
      await restored;
      switch (msg.type) {

        case 'BATCH_START': {
          if (batchRunning) {
            /* Asking for a second queue while one is running used to be answered
               "ok" and then dropped on the floor inside runBatch, so the page
               rendered a plan that would never move. The answer is the smaller
               half of the fix: pages/batch.js does not read it. Putting the
               queue that IS running back on screen is what the person sees. */
            sendResponse({ ok: false });
            if (currentBatch) broadcastBatch(currentBatch);
            break;
          }
          sendResponse({ ok: true });
          runBatch(Array.isArray(msg.urls) ? msg.urls : []);
          break;
        }

        /* Report a problem, with nowhere to send it. The worker builds the
           bundle and hands back the exact text; SAVING it is the caller's act
           and the user's decision, which is what makes "show it before you send
           it" a property of the design rather than a promise. */
        case 'DIAGNOSTIC_BUNDLE': {
          sendResponse(await buildDiagnostics(msg));
          break;
        }

        /* The three data-lifecycle doors. All three are the worker's because it
           is the half that knows which captures are running; pages/options.js
           supplies the person, the sentence and the confirmation. */
        case 'DATA_STATUS': {
          sendResponse(await dataStatus());
          break;
        }

        case 'DATA_SWEEP': {
          const swept = await sweepOrphans();
          // Logged beside the answer, never instead of it: the page renders the
          // failure, the console carries it for whoever is debugging.
          if (!swept.ok) console.error('FullShot could not read the database to sweep it');
          sendResponse(swept);
          break;
        }

        case 'DATA_DELETE_ALL': {
          sendResponse(await deleteAllData());
          break;
        }

        case 'START_CAPTURE': {
          const tab = await chrome.tabs.get(msg.tabId);
          if ((msg.startDelay || 0) > 0) {
            /* THE ANSWER COMES EARLY BUT NOT BLIND (R-20). The popup must not be
               held open through a three-second countdown, which is why this arm
               answers before the capture runs — but it used to answer `ok:true`
               and only THEN look at the page, so a restricted url or a tab that
               was already capturing was reported as a success the popup closed
               on, and the real refusal reached the person as a 2.5 s badge flash
               plus a note they would read the NEXT time they opened it.
               Every question that can refuse a capture is answerable without
               touching the tab, so asking them first costs nothing and the
               ordering is the whole fix. */
            const blocked = await refuseReason(tab, msg.mode);
            if (blocked) { sendResponse(await refuse(msg.mode, blocked, tab)); break; }
            if (sessions.has(tab.id)) { sendResponse({ ok: false, error: R_BUSY }); break; }
            sendResponse({ ok: true });
            await startCapture(tab, msg.mode, msg.startDelay);
          } else {
            sendResponse(await startCapture(tab, msg.mode, 0));
          }
          break;
        }

        // Content script scrolled into place; grab one frame.
        case 'FS_FRAME': {
          const tabId = sender.tab && sender.tab.id;
          const session = sessions.get(tabId);
          if (!session) { sendResponse({ ok: false, error: 'No active session' }); break; }
          const dataUrl = await grabVisible(session);
          // Per frame, not once at the start — the switch lands mid-sequence.
          if (dataUrl === null) { sendResponse(await abortWrongTab(session, sender.tab)); break; }
          await FSDB.put('frames', {
            k: FSDB.frameKey(session.captureId, msg.index),
            captureId: session.captureId,
            index: msg.index, x: msg.x, y: msg.y,
            // Side-pane pass (v1.4.0): frames of a secondary scroller carry
            // the pane's index so the stitcher can unroll it into its column.
            pane: msg.pane == null ? null : msg.pane,
            // Inline unroll pass (v1.6.1): embedded virtualized-list windows
            // carry their inline-pane index for mid-page slot injection. Without
            // persisting this, result.js can't tell them from main-grid frames.
            inline: msg.inline == null ? null : msg.inline,
            dataUrl
          });
          session.total = msg.total;
          session.done = msg.index + 1;
          const pct = Math.round((session.done / Math.max(1, session.total)) * 100);
          setBadge(pct + '%');
          sendResponse({ ok: true });
          break;
        }

        // Content script finished the scroll pass.
        case 'FS_DONE': {
          const tabId = sender.tab && sender.tab.id;
          const session = sessions.get(tabId);
          if (!session) { sendResponse({ ok: false }); break; }
          await FSDB.put('captures', {
            id: session.captureId,
            mode: 'full',
            title: (sender.tab && sender.tab.title) || '',
            url: (sender.tab && sender.tab.url) || '',
            createdAt: Date.now(),
            meta: msg.meta, // { totalW, totalH, vw, vh, dpr }
            /* The snapshot this capture RAN with (R-18, see startCapture). The
               fallback can only be reached by a mirror an older worker wrote. */
            settings: session.settings || await getSettings()
          });
          sessions.delete(tabId);
          persistSessions();
          setBadge('');
          await clearError();
          if (session.batchResolve) session.batchResolve(session.captureId);   // batch: link from history, no result tab
          else await openResultTab(session.captureId, sender.tab);
          sendResponse({ ok: true });
          break;
        }

        case 'FS_ERROR': {
          const tabId = sender.tab && sender.tab.id;
          const eSession = tabId != null ? sessions.get(tabId) : null;
          const eMode = (eSession && eSession.mode) || 'capture';
          if (eSession && eSession.batchReject) eSession.batchReject(msg.error || 'capture error');
          if (tabId != null) sessions.delete(tabId);
          persistSessions();
          dropFrames(eSession);
          flashBadge('!', '#dc2626');
          console.error('FullShot capture error:', msg.error);
          /* The engine reports every mid-flight failure back to us — an abort it
             was told to perform, a frame this worker refused, a throw of its own.
             When one of those already parked a note it did so holding the session,
             so that note knows the mode this handler no longer can; the echo is
             the same failure said again by the half of the system that knows less
             about it, and it stops at the console.error above.
             Asked of the CAPTURE, not of the message: which words the engine chose
             is not what decides whether the user has already been told. */
          if (!alreadyNoted(tabId)) {
            // Nothing parked one, so this echo IS the note — and marking it keeps
            // the rule whole for whatever arrives next.
            markNoted(eSession);
            // Handed on raw on purpose: recordError is where the allowlist lives.
            await recordError(eMode, msg.error, sender.tab);
          }
          sendResponse({ ok: true });
          break;
        }

        // Region overlay finished selecting (already hidden itself).
        case 'FS_REGION_SELECTED': {
          const tabId = sender.tab && sender.tab.id;
          const session = sessions.get(tabId);
          if (!session) { sendResponse({ ok: false }); break; }
          /* The snapshot from when the OVERLAY went up, not from the moment the
             box was dragged — and the gap here is the widest in the product,
             because it is however long the person takes to choose a region. */
          const settings = session.settings || await getSettings();
          // region.js already copes with a refusal (region.js:187) by cleaning up.
          sendResponse(await captureVisibleFlow(sender.tab, session, settings, msg.rect, msg.dpr));
          break;
        }

        // Inject the frame-expansion helper into every frame (needs the
        // optional <all_urls> grant) and tell frames to expand.
        case 'FS_EXPAND_FRAMES': {
          const tabId = sender.tab && sender.tab.id;
          if (tabId == null) { sendResponse({ ok: false }); break; }
          try {
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['content/frame-expand.js']
            });
          } catch (_) { /* some frames are unscriptable; carry on with the rest */ }
          try { await chrome.tabs.sendMessage(tabId, { type: 'FS_FRAMES_EXPAND' }); } catch (_) {}
          sendResponse({ ok: true });
          break;
        }

        // Broadcast restore to all frames after the capture finishes.
        case 'FS_RESTORE_FRAMES': {
          const tabId = sender.tab && sender.tab.id;
          if (tabId != null) {
            try { await chrome.tabs.sendMessage(tabId, { type: 'FS_FRAMES_RESTORE' }); } catch (_) {}
          }
          sendResponse({ ok: true });
          break;
        }

        case 'FS_REGION_CANCEL': {
          const tabId = sender.tab && sender.tab.id;
          // Read before delete, and drop, for the same reason onRemoved does:
          // this hands the session up without ever asking what KIND it is, so it
          // abandons a full capture's frames as readily as an overlay nobody
          // used. Escape stays bound across the whole FS_REGION_SELECTED round
          // trip (region.js unbinds it only after the answer comes back), which
          // is where a cancel lands on a capture that is already writing.
          const session = tabId != null ? sessions.get(tabId) : null;
          if (tabId != null) sessions.delete(tabId);
          persistSessions();
          dropFrames(session);
          setBadge('');
          sendResponse({ ok: true });
          break;
        }

        default:
          // The type is a protocol constant, but it still arrives ON a message,
          // so it is named in the log a developer reads and not in the answer a
          // popup renders. Naming it in both would be one more place for text
          // nobody has read to escape.
          console.error('FullShot unknown message:', msg && msg.type);
          sendResponse({ ok: false, error: R_UNKNOWN_MSG });
      }
    } catch (e) {
      console.error('FullShot background error:', e);
      try {
        const tabId = sender.tab && sender.tab.id;
        const crashed = tabId != null ? sessions.get(tabId) : null;
        if (crashed) {
          sessions.delete(tabId);
          persistSessions();
          dropFrames(crashed);
          chrome.tabs.sendMessage(tabId, { type: 'FS_ABORT' }).catch(() => {});
        }
        flashBadge('!', '#dc2626');
        // Whatever the browser threw belongs in the log, not in front of the
        // user — unless the table already has a translation for it. The quota is
        // why that matters: a full-page capture is the mode that asks for a shot
        // per screenful, so it is the one that hits the limit, and it arrives
        // here rather than at startCapture's catch.
        const known = knownReason(String(e && e.message || e));
        /* The disk being full arrives HERE — a full-page capture writes a frame
           per screenful, so it is the mode that fills a disk, and the throw comes
           out of the FS_FRAME case. Asked of the exception's name, because the
           message is the browser's own prose in the browser's own language. */
        const crashReason = FSDB.isQuotaError(e) ? R_STORAGE_FULL : (known ? known.human : R_CRASH);
        // The FS_ABORT above makes the engine throw, and the throw comes back as
        // an FS_ERROR echo. This note is the one that knows the mode.
        markNoted(crashed);
        await recordError(crashed ? crashed.mode : 'capture', crashReason, sender.tab);
      } catch (_) {}
      // Handed in raw on purpose: the sendResponse wrapper above is the second
      // gate, and a gate nothing depends on is a gate nobody notices breaking.
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async sendResponse
});

/* ---------------- keyboard shortcuts ---------------- */

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const mode = { 'capture-full-page': 'full', 'capture-visible': 'visible', 'capture-region': 'region', 'capture-element': 'element' }[command];
  if (mode) await startCapture(tab, mode, 0);
});

/* ---------------- cleanup ---------------- */

chrome.tabs.onRemoved.addListener(tabId => {
  // Read before delete: the session is the only thing that knows which frames
  // belong to the capture that just lost its tab. A finished capture has
  // already been taken out of the map by FS_DONE, so closing the tab after a
  // successful batch job finds nothing here and leaves those frames alone.
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  persistSessions();
  dropFrames(session);
  /* No note, deliberately: the person closed the tab, so they already know why
     the capture stopped, and the worker closes a tab itself once per batch job —
     a note here would be noise on every queue that ever ran. The QUEUE still has
     to be told, though: nothing else will ever answer that job, and it would
     otherwise sit out the full 90-second cap waiting for a tab that has gone. */
  if (session && session.batchReject) session.batchReject('capture failed');
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Navigating away mid-capture kills the session.
  if (info.status === 'loading' && sessions.has(tabId)) {
    const session = sessions.get(tabId);
    sessions.delete(tabId);
    persistSessions();
    setBadge('');
    dropFrames(session);
    /* And SAY so. This one is not the user's doing — a redirect, a meta refresh,
       a single-page app changing route under a capture that was running — and
       until now it was the quietest failure in the product: the session went, the
       badge cleared itself, the engine went with the document, and nothing was
       ever written anywhere a person looks. */
    if (session.batchReject) session.batchReject('capture failed');
    else {
      markNoted(session);
      recordError(session.mode, R_LOST_TAB, { url: session.origin, id: tabId });
    }
  }
});

/* ---------------- waking up ---------------- */
/* Kicked off at module scope, which is the only place that runs on EVERY wake.
   Not onStartup: that fires when the BROWSER starts, a different and far rarer
   event than a worker coming back — the sessions this exists to rescue are
   created and lost between two of them.
   Last in the file rather than next to the functions it calls, because it runs
   during evaluation: every constant it reads has to be initialised by the time
   it does, and the two message keys it needs are declared far below where the
   logic reads best. */
const restored = Promise.all([restoreSessions(), restoreBatch()]).catch(() => {});

/* ...and then take out what nothing can reach. A worker killed mid-capture runs
   none of the tidy-up the abort paths do, so the wake is the one moment after a
   crash that is guaranteed to happen — which makes it the only honest place for
   this to be automatic.
   AFTER the restore and never beside it: the wake adopts the captures that are
   still running, and a sweep that got there first would delete the frames of the
   very capture it was about to rescue. Not awaited by the router either — a
   message arriving mid-sweep is answered from the session map, which `restored`
   has already filled, and the sweep touches nothing that map knows about. */
restored.then(() => sweepOrphans()).catch(() => {});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set(DEFAULTS);
  } else if (details.reason === 'update') {
    // 1.3.0: capturing everything (inner panels & iframes included) became
    // the default. Installs seeded with the old default get flipped ONCE —
    // after that the user's own choice always wins.
    const cur = await chrome.storage.sync.get(['expandInner', 'fsMigratedExpandDefault']);
    if (!cur.fsMigratedExpandDefault) {
      await chrome.storage.sync.set({ expandInner: true, fsMigratedExpandDefault: true });
    }
  }
});
