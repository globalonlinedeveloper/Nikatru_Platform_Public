/* SKELETON — background service worker (MV3).

   What this file is: the shell every tool in this family starts from. It already
   does one small real thing (reads the active tab's title on request) so the
   patterns below are LIVE code you extend, not stubs you fill in.

   The seven patterns worth inheriting, in the order they appear:
     1. a message router with a SINGLE try/catch and one response gate
     2. the ALLOWLIST error path — a table of fixed sentences plus one generic
        fallback (never a regex over engine text; see the long note at GATE 1)
     3. the BLOCKED-PAGE table — one row per family of page an extension may not
        touch, each with a sentence that says what to do instead
     4. the last-failure note in chrome.storage.session — ORIGIN ONLY, never a
        full URL, never `local`, never `sync`
     5. jobs: one in-flight job per tab, in a table that SURVIVES THE WORKER
        (lib/jobs.js — read its banner before you write `new Map()` here)
     6. cleanup-on-abort: every path that gives a job up drops its scratch, AND
        a wake-time sweep for the abandonment no path can catch
     7. the wake sequence: an MV3 worker starts from nothing several times an
        hour, so what it does on the way up is a feature, not boilerplate

   ZERO NETWORK CALLS. No fetch, no XHR, no WebSocket, no sendBeacon, no remote
   script, no CDN, no remote font. If you are about to add one, you are writing a
   different kind of product than this family ships.
*/

/* THE GUARD IS PART OF THE SOURCE, NOT PART OF THE BUILD.

   Chrome and Edge run this file as an MV3 SERVICE WORKER, where importScripts()
   exists. Firefox runs the same file as a background EVENT-PAGE script, where
   importScripts is UNDEFINED — an unguarded call throws on load and the add-on
   is dead before it does anything. Firefox gets the three libraries from
   `background.scripts` in publish/manifest.firefox.json instead, which lists
   them BEFORE background.js so their globals already exist when this runs.

   The reference implementation applies this same guard at PACKAGE time, by
   matching the exact source text and rewriting it. That works until somebody
   edits these three lines, at which point the anchor stops matching and the
   build either ships an unguarded worker or refuses. Here it costs one `if`
   that is a no-op in Chrome, it is impossible to lose, and the Firefox package
   is a straight copy of the same file. Do not "simplify" it back. */
if (typeof importScripts === 'function') {
  importScripts('lib/settings.js');
  importScripts('lib/storage.js');
  importScripts('lib/jobs.js');
}

/* ---------------- pages no extension may touch ---------------- */
/* PLACEHOLDER(restricted-copy) — one REASON CODE per family of blocked page.
   The sentences themselves live in _locales/en/messages.json under these exact
   keys; this worker never holds prose (see the long note above R_GENERIC).
   A blocked page is not the user's mistake, so each family gets its own
   sentence saying what to do instead. "Not allowed" on its own leaves nowhere
   to go, and a user who has nowhere to go writes a one-star review. */
/* Every scheme no extension may read. The four at the end are the ones that
   were missing from the reference implementation's three divergent copies of
   this list, and each of them is a page a user is MORE likely to be looking at
   when something has gone wrong:
     file:              a downloaded or exported local page. Not blocked by the
                        browser at all — blocked by a CHECKBOX the user has
                        never seen, which is why it gets its own sentence naming
                        the checkbox rather than the generic refusal.
     chrome-error:      what an SSL interstitial or a DNS failure looks like.
                        The user is already worried; a confusing extension
                        failure on top of it is the worst possible moment.
     chrome-untrusted:  internal WebUI the browser sandboxes from itself.
     resource:          Firefox internals, for the cross-browser build. */
const RESTRICTED = /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|moz-extension|file|chrome-error|chrome-untrusted|resource):/;
const WEBSTORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;
/* Firefox refuses extension access to its own add-on site exactly as Chrome
   does to the Web Store. One list, both engines. */
const ADDON_STORE = /^https:\/\/addons\.mozilla\.org\//;

/* ORDER IS THE SPECIFICITY RULE HERE — first match wins, so the narrow rows go
   above the broad ones. about:srcdoc is the worked example: it starts with
   "about:", but it is a frame the SITE created, not a browser page, and telling
   the user "browser pages are off limits" about their own site's frame sends
   them looking in the wrong place. */
const RESTRICTED_REASONS = [
  [/^about:srcdoc/, 'reasonSandboxed'],
  [/^(chrome|edge|brave|about):/, 'reasonBrowserPage'],
  [/^devtools:/, 'reasonDevtools'],
  [/^view-source:/, 'reasonViewSource'],
  [/^(chrome|moz)-extension:/, 'reasonExtensionPage'],
  [/^file:/, 'reasonFileUrl'],
  [/^chrome-error:/, 'reasonPageDidNotLoad'],
  [/^(chrome-untrusted|resource):/, 'reasonBrowserPage'],
  [WEBSTORE, 'reasonWebStore'],
  [ADDON_STORE, 'reasonAddonStore']
];
const GENERIC_RESTRICTED = 'reasonRestricted';

function isRestricted(url) {
  return !url || RESTRICTED.test(url) || WEBSTORE.test(url) || ADDON_STORE.test(url);
}
function restrictedReason(url) {
  for (const pair of RESTRICTED_REASONS) if (pair[0].test(url || '')) return pair[1];
  return GENERIC_RESTRICTED;
}

/* THE TWO BLOCKED PAGES THAT DO NOT LOOK BLOCKED.

   Both of these serve an ordinary https: url, so every scheme test above says
   "fine" and the tool proceeds into a blank result. A user who gets nothing
   back from a page that looks completely normal has no idea why, and neither
   does a support reply.

   1. THE BUILT-IN PDF VIEWER. Chrome renders a PDF inside an extension-owned
      viewer; the tab's url is the pdf's own https: address. An extension can
      neither script it nor read text out of it.
      PLACEHOLDER(pdf-detect) — the path ending in .pdf is the cheap first cut
      and catches the overwhelming majority. A tool that can afford a probe
      should also look for an EMBED/OBJECT of type application/pdf filling the
      viewport, and route it to the same reason. Query and fragment are stripped
      first: "?download=1" after ".pdf" is still the viewer.

   2. A SANDBOXED DOCUMENT. `about:srcdoc`, a top-level data:/blob: document and
      any frame served with a sandbox attribute have an OPAQUE origin. There is
      no host to name, storage is inaccessible, and messaging into it does not
      work — so the honest answer is a specific sentence, not a generic one. */
function looksLikePdf(tab) {
  const url = String((tab && tab.url) || '');
  const path = url.split('#')[0].split('?')[0];
  return /\.pdf$/i.test(path);
}

function looksSandboxed(tab) {
  const url = String((tab && tab.url) || '');
  if (/^(data|blob|filesystem):/i.test(url)) return true;
  if (/^about:srcdoc/i.test(url)) return true;
  // Chrome reports an opaque origin as the literal string 'null'.
  return (tab && tab.origin) === 'null';
}

/* THE ONE ENTRY POINT. Everything that refuses a tab before doing any work
   comes through here, so a tool that adds a third un-obvious case adds a row
   rather than a second code path. Returns a MESSAGE KEY, or null for "go
   ahead". Order matters: the scheme test is cheapest and most certain. */
function blockReason(tab) {
  if (!tab) return R_NO_TAB;
  const url = tab.url;
  if (isRestricted(url)) return restrictedReason(url);
  if (looksSandboxed(tab)) return 'reasonSandboxed';
  if (looksLikePdf(tab)) return 'reasonPdfViewer';
  return null;
}

/* ---------------- badge ---------------- */
const BADGE_COLOR = '#4f46e5';   // PLACEHOLDER(accent) — keep in step with the CSS --accent
function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || BADGE_COLOR });
  chrome.action.setBadgeText({ text: text || '' });
}
function flashBadge(text, color, ms) {
  setBadge(text, color);
  setTimeout(() => setBadge(''), ms || 2000);
}

/* ---------------- the last-failure note ---------------- */
/* The badge clears itself after two seconds, and work started from a keyboard
   shortcut or a context menu has no popup listening for the return value — so a
   failure that is only badged is one the user can never act on. Park the reason
   where the popup can read it the next time it opens.

   storage.session, never local, never sync: the note dies with the browser and
   never leaves this machine. */
const LAST_ERROR_KEY = 'skLastError';   // PLACEHOLDER(prefix) — popup/popup.js reads this key back

/* HOW LONG A PARKED NOTE MAY STILL BE SHOWN.

   storage.session bounds how long the note is STORED — it dies with the
   browser. It does not bound how long it is DISCLOSED, and those are different
   questions. A failure on https://intranet.acme.example at 09:00 is otherwise
   still on screen at 16:00, on top of an unrelated tab, in front of whoever is
   looking: a screen share, a projector, the person at the next desk.

   The argument for the note is that shortcut-fired and menu-fired work has no
   popup listening, so its failure would otherwise be unreadable. That argument
   is good for minutes, not for the life of a browser session.

   popup/popup.js reads this constant too and the sim asserts the two copies
   agree, exactly as it does for LAST_ERROR_KEY. */
const SK_NOTE_TTL_MS = 10 * 60 * 1000;   // PLACEHOLDER(note-ttl)

/* Scheme and host only. A full URL can carry a name, an order number or a
   session token in its path or query, and this note outlives the job that wrote
   it.

   This is a character class, which is the shape that failed twice in this family
   on the MESSAGE field — so the difference is worth writing down rather than
   rediscovering. That class was POSITIVE and had to FIND a url inside prose in
   order to replace it: one character it did not know ended the match early and
   left the rest of the sentence, token and all, in the output. It failed OPEN.
   This one is NEGATED and the function EXTRACTS A PREFIX. It stops at the first
   '/', '?' or '#' — exactly the set RFC 3986 allows to end an authority — and
   everything from there on is discarded rather than carried, so a character it
   mishandles can only TRUNCATE the origin. There is no third outcome, whatever
   is in the path. */
function originOf(url) {
  const s = String(url || '');
  const withHost = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i.exec(s);
  if (withHost) {
    // Userinfo is part of the AUTHORITY, so stopping at the first slash would
    // keep a "user:secret@" prefix — credentials, which are worse than anything
    // the paragraph above exists to drop. The LAST '@' is the separator: an '@'
    // is legal inside userinfo, and taking the first would leave the real host
    // in the discarded half.
    // (Written without a literal example on purpose: this file ships, and a
    // credential-shaped string in shipped source is something a store scanner
    // reads without reading the sentence around it.)
    const auth = withHost[2], at = auth.lastIndexOf('@');
    return withHost[1] + (at < 0 ? auth : auth.slice(at + 1));
  }
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(s);
  return scheme ? scheme[1] : '';
}

/* The note's other field that arrives ON a message. `action` comes straight off
   whatever sent it, so it is the one field the sentence allowlist below does not
   already cover — everything else in the note is a number, a tab id, or
   humanReason()'s output. Same answer, same shape: a declared set, and anything
   outside it becomes the neutral word. Compared with indexOf, so nothing is
   coerced and no value is asked for its own opinion of itself. */
const ACTIONS = ['read-title', 'copy-title', 'clear-data'];   // PLACEHOLDER(actions)

function knownAction(action) {
  return ACTIONS.indexOf(action) >= 0 ? action : 'run';
}

/* PRIVATE BROWSING IS A MODE, NOT A BLOCKED PAGE.

   manifest.json declares "incognito": "spanning" — the MV3 default, stated out
   loud so it is a decision. Spanning means ONE service worker, ONE IndexedDB
   and ONE settings store shared between normal and private windows. So the
   moment a user ticks "Allow in Incognito" — which is exactly the user who
   cares most — anything this tool persists from a private window lands in the
   same on-disk store as everything else, is listed on the options page, and
   outlives the session that was supposed to leave no trace.

   Nothing refuses to WORK in a private window: refusing would be a worse
   product and is not what the user asked for. What changes is what is KEPT.
   One predicate, used at both write sites, so a tool that adds a third does
   not have to rediscover the rule. */
function isPrivate(tab) {
  return !!(tab && tab.incognito);
}

async function recordError(action, message, tab) {
  const note = {
    when: Date.now(),
    action: knownAction(action),
    /* No origin from a private window. The note is the only thing this product
       writes that survives the window that produced it and is then shown on top
       of a DIFFERENT tab — which is precisely the disclosure private browsing
       exists to prevent. The sentence still works without it. */
    origin: isPrivate(tab) ? '' : originOf(tab && tab.url),
    tabId: tab && tab.id != null ? tab.id : null,
    // Every note in the product is built here, so this is where the rule lives:
    // a caller that forgets — or one written next year — cannot get round it.
    //
    // A CODE, never a sentence. The note outlives the run that wrote it and can
    // be read back after the user has changed browser language, so a note
    // holding rendered prose would render in the OLD language. It is also a
    // schema question: a note field holding data survives translation, a note
    // field holding a paragraph does not.
    reason: humanReason(message)
  };
  try {
    await chrome.storage.session.set({ [LAST_ERROR_KEY]: note });
  } catch (_) { /* never fail the work because the note could not be parked */ }
}

async function clearError() {
  try { await chrome.storage.session.remove(LAST_ERROR_KEY); } catch (_) {}
}

/* ---------------- the reasons we recognise ---------------- */
/* READ THIS BEFORE CHANGING IT. Two earlier attempts in this family tried to
   SANITISE the engine's text on its way to the note. The first reduced nothing.
   The second reduced every url a regex could find down to its origin — and a
   reviewer beat it with an apostrophe in the path, because the class the regex
   used to find a url excluded the quote and Chrome does not percent-encode it.
   The match ended at the apostrophe, so only the stub in front of it was reduced
   and the whole remainder — token, card number, the lot — stayed in the sentence
   and reached the popup. A third character class would be the same mistake a
   third time.

   So the shape of the problem changes here instead. Nothing is sanitised. A
   reason is RECOGNISED — text this product wrote, or an engine wording it has a
   translation for — or it is not, and everything that is not becomes ONE generic
   sentence. Both gates below return only strings declared in this file, so there
   is no character class left to get wrong and no future engine string, however
   spelled, can carry anything out of it. The raw text still goes to
   console.error: local, ephemeral, never stored and never rendered.

   The note it collapses into is not a shrug — it still carries origin, action,
   tabId and when, which is what makes one sentence actionable.

   To add a reason: add a row. Left is the exact string a code path or the engine
   produces; right is what a person is shown for it. Never build the right-hand
   side out of the left. */
/* Every one of these is a MESSAGE KEY from _locales/en/messages.json, not a
   sentence. The worker holds no prose at all: it cannot, because a note parked
   today may be read after the user has changed browser language, and because a
   worker that held 55 translations of every sentence would be holding the
   catalogue twice. The page that renders one calls skMsg(key). The sim asserts
   that every key named here resolves in the default catalogue, which is what
   stops a typo reaching a user as the literal text "reasonRestricted". */
const R_GENERIC = 'reasonGeneric';
const R_BUSY = 'reasonBusy';
const R_BLOCKED = GENERIC_RESTRICTED;
const R_NO_TAB = 'reasonNoTab';
const R_NO_TITLE = 'reasonNoTitle';
const R_CANCELLED = 'reasonCancelled';
const R_UNKNOWN_MSG = 'reasonUnknownMessage';
/* The disk is full. This is the row that stops a QuotaExceededError collapsing
   into "Something stopped this before it finished. Please try again." — advice
   that cannot possibly work, offered to a user whose actual problem is that
   there is nowhere to put the result. */
const R_STORAGE_FULL = 'reasonStorageFull';
/* The watchdog's answer. A job the worker was suspended in the middle of comes
   back on the next wake, and if it is older than any legitimate run it is dead
   — but it must be given up ON THE RECORD, not silently dropped, because the
   user is looking at a badge that says something is happening. */
const R_TIMED_OUT = 'reasonTimedOut';
const R_SANDBOXED = 'reasonSandboxed';
const R_PDF = 'reasonPdfViewer';

/* PLACEHOLDER(reasons) — your tool's rows go here. Most rows are the same text
   twice (the product already writes sentences); rows that differ are engine
   wordings, which were never aimed at a person. */
const REASONS = [
  [R_GENERIC, R_GENERIC],
  [R_BUSY, R_BUSY],
  [R_BLOCKED, R_BLOCKED],
  [R_NO_TAB, R_NO_TAB],
  [R_NO_TITLE, R_NO_TITLE],
  [R_CANCELLED, R_CANCELLED],
  [R_UNKNOWN_MSG, R_UNKNOWN_MSG],
  [R_STORAGE_FULL, R_STORAGE_FULL],
  [R_TIMED_OUT, R_TIMED_OUT],
  [R_SANDBOXED, R_SANDBOXED],
  [R_PDF, R_PDF],
  ['reasonSettingTooBig', 'reasonSettingTooBig'],
  ['reasonSettingsWriteFailed', 'reasonSettingsWriteFailed'],
  // Example of the other kind of row: an engine string mapped to a key.
  ['No tab with id', 'reasonTabClosed']
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

/* GATE 1 — what a PERSON is shown: the parked note, and any list row. */
function humanReason(raw) {
  const hit = knownReason(raw);
  return hit ? hit.human : R_GENERIC;
}

/* GATE 2 — what the router ANSWERS A CALLER with. Same membership test and the
   same generic sentence for anything outside it; the only difference is that a
   protocol word stays the word the caller branches on. Neither gate ever returns
   a substring of its argument. */
function wireReason(raw) {
  const hit = knownReason(raw);
  return hit ? hit.wire : R_GENERIC;
}

/* ---------------- jobs, and giving them up ---------------- */
/* One in-flight job per tab, in SKJOBS (lib/jobs.js) — a table that is mirrored
   to chrome.storage.session on every mutation and rehydrated on every worker
   wake. It is NOT a Map, and the banner in lib/jobs.js is the argument for why:
   an MV3 worker is killed mid-job several times an hour, and a job table that
   lives only in memory comes back empty every single time.

   A job owns scratch rows in IndexedDB; nothing in the UI lists scratch, so a
   job that is abandoned without dropping its rows leaves data the user can
   neither see nor delete. Every path that removes a job from this table calls
   dropScratch on the way out — that is the whole rule, and wakeUp() below is
   the backstop for the one abandonment no path can catch. */

/* How long a job may live before the watchdog gives it up. Make it longer than
   the longest run your tool can legitimately have, and remember it is measured
   across suspensions: wall clock, not worker time. */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;      // PLACEHOLDER(job-timeout)

/* How old an UNOWNED scratch row must be before the wake sweep deletes it.
   Longer than JOB_TIMEOUT_MS on purpose: the watchdog gets first refusal on a
   row whose job is still in the table, and the sweeper only ever sees rows that
   already have no owner. */
const SCRATCH_TTL_MS = 15 * 60 * 1000;     // PLACEHOLDER(scratch-ttl)

function newJobId() {
  try { return crypto.randomUUID(); } catch (_) {}
  return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function beginJob(tab, action) {
  const job = {
    jobId: newJobId(),
    action: knownAction(action),
    tabId: tab.id,
    windowId: tab.windowId,
    /* ORIGIN, never the url. This record is written to storage.session and read
       back by a later instance of this worker, so it is subject to exactly the
       rule the last-failure note is subject to: a path or a query can carry a
       name, an order number or a session token, and in-flight state outlives
       the moment it described. It is also the navigation guard below — an
       origin is the part of a url that answers "is this still the same page?".
       Never put a page title in here. */
    origin: isPrivate(tab) ? '' : originOf(tab.url),
    /* Carried on the record so every later decision — the write sites, the
       watchdog's parked note, an abort — can still tell, after the worker has
       been suspended and the tab may be gone. */
    incognito: isPrivate(tab),
    startedAt: Date.now()
  };
  SKJOBS.set(job);
  // The in-flight record. A real tool writes its partial output here (frames,
  // chunks, parsed rows) so a long job survives the worker being suspended.
  try {
    await SKDB.put('scratch', {
      k: SKDB.scratchKey(job.jobId, 0),
      jobId: job.jobId,
      action: job.action,
      startedAt: job.startedAt
    });
  } catch (e) {
    // Never leave a half-started job in the table: the next call would be told
    // the tab is busy by a job that does not exist.
    SKJOBS.delete(tab.id);
    // A first write that fails because the disk is full is the most common real
    // failure here, and it is the one the generic sentence is useless for.
    throw new Error(SKDB.isQuotaError(e) ? R_STORAGE_FULL : ((e && e.message) || R_GENERIC));
  }
  return job;
}

/* Best effort by design: a job that reaches here is already failing, and a
   failed cleanup must not mask why. */
function dropScratch(job) {
  if (!job || !job.jobId) return;
  try { Promise.resolve(SKDB.deleteScratch(job.jobId)).catch(() => {}); } catch (_) {}
}

function endJob(job) {
  if (!job) return;
  SKJOBS.delete(job.tabId);
  dropScratch(job);
}

/* LEAVE NO TRACE ON THE PAGE EITHER.

   dropScratch() undoes what a job wrote to the DATABASE. This undoes what it
   did to the PAGE, and it is the half that went missing in the reference
   implementation for 25 sessions.

   A tool in this family that does real work usually injects something: an
   overlay, a selection highlight, a hidden element, document.designMode, a
   changed scroll position, pointer-events turned off. If the job is then
   abandoned — the tab navigated, the window closed, the user cancelled, the
   worker was suspended and the watchdog gave up — that state is left behind on
   a page the user is still using. An abandoned full-page overlay that was
   capturing clicks and key events, sitting on a page somebody is typing into,
   is not a cosmetic bug.

   PLACEHOLDER(abort) — this is a LIVE CALL, not a comment, so it cannot be
   forgotten: every abort path already routes through abortJob and therefore
   already routes through here. What is missing in the skeleton is only the
   other end. When your tool grows a content script, give it a `revert()` that
   restores every property it touched from a snapshot taken before it mutated
   anything, and answer SK_PAGE_REVERT with it.

   Best-effort by construction: a tab with no content script listening rejects,
   a closed tab rejects, and neither may be allowed to mask the failure that
   caused the abort. `chrome.tabs` may also be absent in a stripped test
   context, hence the typeof guard. */
const SK_PAGE_REVERT = 'SK_PAGE_REVERT';

function revertPage(tabId) {
  if (tabId == null) return;
  try {
    const p = chrome.tabs && chrome.tabs.sendMessage
      ? chrome.tabs.sendMessage(tabId, { type: SK_PAGE_REVERT })
      : null;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* never let cleanup throw over the failure it is cleaning up after */ }
}

/* THE cleanup-on-abort hook. Every involuntary end routes through here: the tab
   closed, the tab navigated, the window went away, the user cancelled, the
   router threw, the worker was suspended, the watchdog gave up. Add new abort
   sources here rather than growing a second path.

   Three things happen, in this order, and none may be skipped: the job leaves
   the table, its scratch rows go, and the page is put back. */
function abortJob(tabId, why) {
  const job = SKJOBS.get(tabId);
  if (!job) return null;
  SKJOBS.delete(tabId);
  dropScratch(job);
  revertPage(tabId);
  setBadge('');
  if (why) console.warn('SKELETON job aborted:', job.action, why);
  return job;
}

/* ---------------- the wake sequence ---------------- */
/* THIS RUNS SEVERAL TIMES AN HOUR, NOT ONCE A DAY.

   chrome.runtime.onStartup fires when the BROWSER starts. It does not fire when
   the service worker is respawned after an idle suspension — which is the
   common case, and on a machine that is never restarted it may not fire for
   weeks. A cleanup that only runs onStartup therefore never runs at all for the
   users who need it most, while every suspension leaves another orphan.

   So the recovery lives at module top level and runs on every wake:
     1. rehydrate the job table from storage.session
     2. clear the badge, because the setTimeout that would have cleared it died
        with the previous instance
     3. give up any job older than JOB_TIMEOUT_MS — the watchdog. Persisting the
        job table removed the accidental garbage collector that suspension used
        to be, so this has to be added in the same breath as the persistence.
     4. sweep scratch that no LIVE job owns and that is older than SCRATCH_TTL_MS
     5. apply the user's retention setting to the visible store

   Steps 3-5 are all best effort and none of them may throw: this promise is
   awaited by every entry point, and a wake that rejects would take the whole
   worker down with it. */
async function wakeUp() {
  try {
    await SKJOBS.rehydrate();
  } catch (_) { /* an unreadable table is an empty one; the sweep below covers it */ }

  try { setBadge(''); } catch (_) {}

  // 3. the watchdog, before the sweep — it is what turns a wedged job into an
  //    unowned scratch row that the sweep is then allowed to remove.
  try {
    for (const job of SKJOBS.stale(JOB_TIMEOUT_MS)) {
      abortJob(job.tabId, 'timed out across a worker suspension');
      await recordError(job.action, R_TIMED_OUT, { id: job.tabId, url: job.origin });
    }
  } catch (e) { console.error('SKELETON watchdog failed:', e); }

  // 4. the abandonment no abort path can catch.
  try {
    const live = SKJOBS.values().map(j => j.jobId);
    const gone = await SKDB.sweepScratch({ maxAgeMs: SCRATCH_TTL_MS, keepJobIds: live });
    if (gone) console.warn('SKELETON swept ' + gone + ' orphaned scratch row(s) on wake');
  } catch (e) { console.error('SKELETON scratch sweep failed:', e); }

  // 5. retention. A count cap is not a retention policy; this is the age half.
  try {
    const settings = await skGetSettings();
    await SKDB.trimItemsByAge(settings.retentionDays);
  } catch (e) { console.error('SKELETON retention sweep failed:', e); }
}

/* Started at module load, awaited by every entry point. Nothing that reads the
   job table may run before this resolves, or it will read an empty one and
   conclude the tab is free. */
const SK_WAKE = wakeUp();

/* ---------------- the one real thing this shell does ---------------- */
/* PLACEHOLDER(the-work) — replace this function with your tool's actual work,
   and keep the shape: begin a job, do the work, seal or drop, answer.

   Split it the way the family splits everything: a PURE CORE that takes data and
   returns data (node-testable, no chrome.*, no DOM) and a BROWSER CONTROLLER
   that talks to the browser and calls the core. `describeTab` below is the core;
   `runReadTitle` is the controller. The pure core is what a .node.js sim can
   grade without a browser. */
function describeTab(tab) {
  const title = String((tab && tab.title) || '').trim();
  return {
    title,                                   // untrusted: page-controlled text
    origin: originOf(tab && tab.url),        // scheme + host, never the path
    empty: title.length === 0
  };
}

async function runReadTitle(tab, action) {
  if (!tab) return { ok: false, error: R_NO_TAB };
  // ONE refusal point. chrome:, the stores, file:, an error page, the PDF
  // viewer and a sandboxed document all answer with their own sentence.
  const blocked = blockReason(tab);
  if (blocked) return { ok: false, error: blocked };
  // Refused BEFORE a job exists, so the answer can never be produced by killing
  // the job that is already running in this tab.
  if (SKJOBS.has(tab.id)) return { ok: false, error: R_BUSY };

  const job = await beginJob(tab, action);
  try {
    const info = describeTab(tab);
    if (info.empty) throw new Error(R_NO_TITLE);

    const settings = await skGetSettings();
    /* THE ONE PLACE PRIVATE BROWSING CHANGES THE ANSWER. keepHistory is the
       user's standing preference; a private window is a statement that THIS
       session is not part of the record, and the more specific statement wins.
       Reported back rather than applied silently — a user who turned history on
       and sees nothing appear is owed the reason. */
    const keep = settings.keepHistory && !isPrivate(tab);
    if (keep) {
      // Only what the user asked to keep, and only where they can see, export
      // and delete it (pages/options.html does all three).
      //
      // NEVER LOSE DATA SILENTLY. A write that fails because the disk is full
      // must not be swallowed and reported as success — the user would be told
      // their history is on, see nothing in the list, and have no way to learn
      // why. The quota error is classified on DOMException.name (see
      // SKDB.isQuotaError) and becomes its own sentence.
      try {
        await SKDB.put('items', {
          id: job.jobId,
          title: info.title,
          origin: info.origin,
          createdAt: Date.now()
        });
        await SKDB.trimItems(settings.historyLimit);
      } catch (e) {
        throw new Error(SKDB.isQuotaError(e) ? R_STORAGE_FULL : ((e && e.message) || R_GENERIC));
      }
    }

    endJob(job);            // success drops the scratch too — same rule, no exception
    await clearError();
    flashBadge('✓', '#16a34a', 1200);
    return {
      ok: true,
      title: info.title,
      origin: info.origin,
      kept: keep,
      /* So the popup can say why nothing was kept, instead of the user
         concluding the setting is broken. A boolean about the WINDOW, not about
         the page: it identifies nothing. */
      incognito: isPrivate(tab)
    };
  } catch (e) {
    endJob(job);
    flashBadge('!', '#dc2626');
    console.error('SKELETON read-title failed:', e);
    // Handed on RAW on purpose: recordError is where the allowlist lives, so a
    // caller cannot forget to apply it.
    await recordError(action, (e && e.message) || e, tab);
    return { ok: false, error: (e && e.message) || R_GENERIC };
  }
}

/* THE OTHER HALF OF "DELETE EVERYTHING".

   IndexedDB is where this family is TOLD to put payload, and SKDB.clearAll()
   enumerates it. chrome.storage.local is where payload ends up ANYWAY, because
   it is the easiest thing to reach for and nothing stops you — a cached parse,
   a per-site rule, a last result. Those keys are not settings and are not
   listed anywhere, so a wipe that only cleared IndexedDB would report success
   with the user's data still on disk.

   So the rule is stated as a SUBTRACTION, which is the only form that stays
   true as a tool grows: every local key that is not a DECLARED SETTING is
   payload, and payload goes. Settings survive, because the button says
   "Settings are kept" and there is a separate Reset for them. Adding a local
   setting means adding it to SK_LOCAL_KEYS, which the settings parity check
   already forces you to do. */
async function wipeLocalPayload() {
  try {
    const all = await chrome.storage.local.get(null);
    const keep = new Set(SK_LOCAL_KEYS);
    const doomed = Object.keys(all || {}).filter(k => !keep.has(k));
    if (doomed.length) await chrome.storage.local.remove(doomed);
    return doomed.length;
  } catch (e) {
    console.error('SKELETON local wipe failed:', e);
    return 0;
  }
}

/* ---------------- message router ---------------- */
/* WHO IS ALLOWED TO TALK TO THIS ROUTER.

   Safe today only by accident of what the skeleton does not yet do: there is no
   externally_connectable block and no content script, so nothing but this
   extension's own pages can reach onMessage at all. Both of those change the
   first time a tool follows TEMPLATE §8 and injects a content script — and the
   ordinary pattern for an in-page overlay is a window.postMessage bridge, at
   which point the PAGE is choosing msg.type and msg.tabId and the router
   honours both. Combine that with the optional <all_urls> grant the same table
   offers and msg.tabId becomes a caller-driven cross-tab read: ask for tab 17's
   title and origin from a page that has nothing to do with tab 17.

   It fails closed under activeTab-only, which is exactly why nobody notices it
   is missing until after a tool has been granted broad host access. Three
   lines, decided once, for all 67.

     sender.id      the extension that sent it. Chrome sets it; a page cannot.
     sender.url     for an extension page it must be under our own origin.
     sender.tab     when the sender IS a tab, the tab is derived, never claimed.

   Refused senders are not answered at all. A refusal that answers is a probe
   that succeeded. */
function senderIsOurs(sender) {
  if (!sender) return false;
  // A message from one of our own pages or our own content scripts always
  // carries our id. Anything else is somebody else's extension.
  if (sender.id !== chrome.runtime.id) return false;
  // An extension PAGE additionally has to be one of ours. A content script's
  // sender.url is the page's, so this only applies when there is no tab.
  if (!sender.tab && sender.url) {
    let base = '';
    try { base = chrome.runtime.getURL(''); } catch (_) { base = ''; }
    if (base && String(sender.url).indexOf(base) !== 0) return false;
  }
  return true;
}

/* Which tab a case is allowed to act on. When the sender IS a tab, that tab is
   the answer and msg.tabId is ignored — a content script cannot nominate a
   different tab. Only an extension page (no sender.tab) may name one, because
   an extension page is us. */
function tabIdFor(msg, sender) {
  if (sender && sender.tab && sender.tab.id != null) return sender.tab.id;
  return msg && msg.tabId != null ? msg.tabId : null;
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!senderIsOurs(sender)) {
    console.error('SKELETON refused a message from a foreign sender:', sender && sender.id);
    return false;   // no answer at all, and the channel is not held open
  }
  /* Whatever this router answers with goes on screen in the popup as it stands,
     and some answers are built out of a raw exception. One wrapper here means no
     case below can leak by forgetting to reduce its own — including the catch at
     the bottom, which hands its exception straight in.

     Admitted on the PRESENCE of an error, never on its type. Testing for a
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
      /* NOTHING BELOW MAY RUN BEFORE THE WAKE HAS FINISHED. This worker may
         have been started BY this very message, in which case the job table is
         still being read back out of storage.session — and a case that peeked
         at it early would see an empty table and cheerfully start a second job
         in a tab that already has one. One await, at the top, for every case. */
      await SK_WAKE;

      switch (msg && msg.type) {

        /* PLACEHOLDER(messages) — your tool's cases go here. Keep them thin:
           validate, call a controller, answer. No DOM, no markup, no network. */
        case 'SK_TAB_INFO': {
          // tabIdFor, not msg.tabId: a content script gets the tab it is in.
          const tab = await chrome.tabs.get(tabIdFor(msg, sender));
          sendResponse(await runReadTitle(tab, msg.action || 'read-title'));
          break;
        }

        case 'SK_JOB_CANCEL': {
          const tabId = tabIdFor(msg, sender);
          if (tabId != null) abortJob(tabId, 'cancelled by the user');
          sendResponse({ ok: true });
          break;
        }

        /* The promise in the privacy policy, wired to a button.

           EVERY AREA THIS TOOL WRITES, not just the two IndexedDB stores it
           shipped with. SKDB.clearAll() enumerates the database's own object
           stores rather than naming them, so a tool that adds a third cannot
           silently leave it behind; wipeLocalPayload() covers the other place a
           tool grows data without thinking about it. "Delete everything" is the
           one function in this folder the privacy policy makes a promise about,
           and a delete that reports success while retaining data is a
           data-subject-rights failure, not a bug. */
        case 'SK_CLEAR_DATA': {
          for (const tabId of SKJOBS.keys()) abortJob(tabId, 'data cleared');
          await SKDB.clearAll();
          await wipeLocalPayload();
          await clearError();
          sendResponse({ ok: true });
          break;
        }

        /* THE WORKER'S HALF OF THE PROBLEM REPORT.

           There is no backend and there never will be, so a diagnostic is a
           file the user saves and sends themselves. That makes REDACTION a
           design constraint rather than a courtesy: whatever goes in here is
           about to leave the machine by a route this product cannot see.

           So the answer is BUILT FROM A DECLARED LIST — counts, a boolean, a
           declared action code — and never assembled by walking the job table
           and taking what is there. A tool that adds a field to its job record
           does not silently add it to a file the user emails to a stranger.
           There is no url, no origin, no title and no key here at all. */
        case 'SK_DIAGNOSTIC': {
          let scratchRows = -1;
          try { scratchRows = await SKDB.count('scratch'); } catch (_) {}
          let itemRows = -1;
          try { itemRows = await SKDB.count('items'); } catch (_) {}
          sendResponse({
            ok: true,
            facts: {
              jobsInFlight: SKJOBS.size(),
              jobActions: SKJOBS.values().map(j => knownAction(j.action)).sort(),
              scratchRows,
              itemRows,
              jobTimeoutMs: JOB_TIMEOUT_MS,
              scratchTtlMs: SCRATCH_TTL_MS
            }
          });
          break;
        }

        default:
          // The type is a protocol constant, but it still arrives ON a message,
          // so it is named in the log a developer reads and not in the answer a
          // popup renders. Naming it in both would be one more place for text
          // nobody has read to escape.
          console.error('SKELETON unknown message:', msg && msg.type);
          sendResponse({ ok: false, error: R_UNKNOWN_MSG });
      }
    } catch (e) {
      console.error('SKELETON background error:', e);
      try {
        const tabId = (msg && msg.tabId != null) ? msg.tabId : (sender.tab && sender.tab.id);
        if (tabId != null) abortJob(tabId, 'router threw');
        flashBadge('!', '#dc2626');
        const known = knownReason(String(e && e.message || e));
        await recordError(msg && msg.action, known ? known.human : R_GENERIC, sender.tab);
      } catch (_) {}
      // Handed in raw on purpose: the sendResponse wrapper above is the second
      // gate, and a gate nothing depends on is a gate nobody notices breaking.
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;   // async sendResponse
});

/* ---------------- cleanup ---------------- */
/* Read before delete: the job is the only thing that knows which scratch rows
   belong to the work that just lost its tab. A finished job has already taken
   itself out of the map, so closing the tab afterwards finds nothing here. */
/* EVERY ONE OF THESE AWAITS THE WAKE FIRST, for the same reason the router
   does. Closing a tab can be the event that STARTS the worker, and a listener
   that ran before the job table had been read back would find nothing, abort
   nothing, and leave the scratch of the job it was supposed to clean up. The
   age sweep would eventually catch that row, but "eventually" is the next wake,
   which may be an hour away — and this is the path that is supposed to be
   immediate. */
chrome.tabs.onRemoved.addListener(async tabId => {
  await SK_WAKE;
  abortJob(tabId, 'tab closed');
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  // Navigating away mid-job kills the job: whatever it was working on is gone.
  if (info.status !== 'loading') return;
  await SK_WAKE;
  if (SKJOBS.has(tabId)) abortJob(tabId, 'tab navigated');
});

chrome.windows.onRemoved.addListener(async windowId => {
  await SK_WAKE;
  for (const [tabId, job] of SKJOBS.entries()) {
    if (job.windowId === windowId) abortJob(tabId, 'window closed');
  }
});

/* The LAST chance before the worker is killed. Not guaranteed to fire and never
   long enough to await anything, so it is a best-effort head start on what
   wakeUp() would do anyway — it closes the common case now instead of at the
   next wake, which may be an hour away. A job that survives this is caught by
   the watchdog; a scratch row that survives it is caught by the sweep. Belt and
   braces, because the platform gives no guarantee either way. */
chrome.runtime.onSuspend.addListener(() => {
  for (const tabId of SKJOBS.keys()) abortJob(tabId, 'the service worker is being suspended');
});

/* Browser start. Nothing can legitimately be in flight, so this is the one
   place a blanket wipe of scratch is correct — everywhere else it must be the
   age-and-ownership sweep in wakeUp(), which cannot destroy a live job's rows. */
chrome.runtime.onStartup.addListener(() => {
  SKJOBS.clear();
  SKDB.clear('scratch').catch(() => {});
});

/* ONE branch, on purpose. `details.reason` used to choose between "seed the
   defaults" and "migrate" — and that is the wrong question, because
   reason === 'install' does not mean the profile is empty. It fires on the
   second device of a signed-in account, where chrome.storage.sync has already
   replicated the settings from the first one, and again after any
   remove-and-reinstall. The seeding branch was therefore a settings wipe across
   every device on the account. skInitSettings() is the same call on every
   reason: absent keys get their defaults, present keys are left alone, and
   whatever migrations are outstanding run once. See the long note above it in
   lib/settings.js. */
chrome.runtime.onInstalled.addListener(async () => {
  await skInitSettings();
  SKJOBS.clear();
  SKDB.clear('scratch').catch(() => {});
});
