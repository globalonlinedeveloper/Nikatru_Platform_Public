/* SKELETON popup — ask the worker for the active tab's title, show it, copy it.

   Trivial on purpose: it is the smallest thing that exercises the whole shell —
   popup → message router → job → answer → render → clipboard, plus the two error
   surfaces. Replace the feature, keep the wiring.

   Everything the page renders goes through elText()/el() from pages/common.js,
   so a page title of `<img src=x onerror=alert(1)>` is shown as those very
   characters and never becomes an element. There is no innerHTML in this file.
   Keep it that way: it is the single rule this family breaks least often because
   the helper is easier to reach for than the alternative.

   EVERY SENTENCE IS ONE MESSAGE. Nothing here glues two localised strings
   together with `+`: the worker answers with a message KEY, this file resolves
   it, and a sentence that needs a value inside it uses a $PLACEHOLDER$. The sim
   fails on a localised string that is an operand of `+`. */

const errBox = document.getElementById('err');
const errText = document.getElementById('errText');
const titleEl = document.getElementById('title');
const originEl = document.getElementById('origin');
const copyBtn = document.getElementById('copyBtn');

/* The worker parks the reason for its last failure here (chrome.storage.session:
   it dies with the browser and never syncs). Work fired from a keyboard shortcut
   or a context menu has no popup open to answer to, so this is the only place
   its failure can ever be read. */
const LAST_ERROR_KEY = 'skLastError';   // PLACEHOLDER(prefix) — must match background.js

/* PLACEHOLDER(note-ttl) — must match SK_NOTE_TTL_MS in background.js, and the
   sim asserts the two copies agree.
   storage.session bounds how long the note is STORED. This bounds how long it
   is SHOWN, which is a different question: without it, a failure on an intranet
   host at 09:00 is still on screen at 16:00, over an unrelated tab, in front of
   a screen share. */
const SK_NOTE_TTL_MS = 10 * 60 * 1000;

/* PLACEHOLDER(actions) — must match ACTIONS in background.js. Each action maps
   to its OWN message key, not to an English noun fragment: the old shape was a
   table of pieces that existed only to be glued into a sentence, which is a
   sentence whose word order is compiled into the program. */
const ACTION_KEY = {
  'read-title': 'actionReadTitle',
  'copy-title': 'actionCopyTitle',
  'clear-data': 'actionClearData',
  run: 'actionRun'
};

let currentTitle = '';
/* The parked note is read at the same time as the live answer. If the live one
   lands first and succeeded, the old note is history and must not pop back up
   behind it. */
let answeredOk = false;

/* ---------------- render ---------------- */
/* A top-level function in a classic script, so a real-browser test can call
   window.renderInfo({...}) with a hostile title and assert that nothing became
   an element. Shipped code, tested directly — no test-only hooks.

   `info.error` is a message KEY, never a sentence: the worker's two gates return
   only keys declared in background.js, so nothing an engine wrote can reach
   here, and the sentence is rendered in the language the browser is in NOW. */
function renderInfo(info) {
  if (!info || info.ok !== true) {
    answeredOk = false;
    currentTitle = '';
    copyBtn.disabled = true;
    elText(titleEl, skMsg('popupNoValue'));
    elText(originEl, '');
    showError(skMsg((info && info.error) || 'reasonNothingCameBack'));
    return;
  }
  answeredOk = true;
  currentTitle = info.title;
  copyBtn.disabled = false;
  elText(titleEl, info.title);      // untrusted page text -> text node, always
  elText(originEl, info.origin);    // scheme + host only; the worker never sends a path
  hideError();
}

/* Takes a RENDERED sentence, not a key: the two callers resolve their own key
   (one of them has to substitute placeholders first), and a function that
   accepts either would eventually be handed the wrong one. */
function showError(sentence) {
  elText(errText, sentence);
  errBox.hidden = false;
}
function hideError() {
  errBox.hidden = true;
}

/* ---------------- the last-failure note ---------------- */
/* TWO BOUNDS ON DISCLOSURE, not just on storage.

   The note is deliberately origin-only, which settles WHAT is in it. It does
   not settle WHEN, or IN FRONT OF WHOM — and those are the questions that make
   a scheme+host disclosure matter. So:

   1. TTL. Older than SK_NOTE_TTL_MS and it is not shown, and it is deleted on
      the way past, so it cannot come back. A stale note never generates a bug
      report, which is exactly why nothing would ever prompt anyone to fix it.
   2. TAB SCOPE. The note carries the tabId it came from. If the popup is open
      over a DIFFERENT tab, the sentence is shown without the host: the user
      still learns their last run failed and why, and the name of an unrelated
      page they were on this morning is not printed over the page they are on
      now. */
async function showLastError(activeTabId) {
  let last = null;
  try {
    const got = await chrome.storage.session.get(LAST_ERROR_KEY);
    last = got && got[LAST_ERROR_KEY];
  } catch (_) { return; }   // a browser without storage.session has nothing to show
  if (!last || !last.reason || answeredOk) return;

  const age = Date.now() - Number(last.when || 0);
  if (!Number.isFinite(age) || age > SK_NOTE_TTL_MS) {
    // Expired. Remove it rather than merely skipping it, or it is re-evaluated
    // on every popup open for the rest of the browser session.
    try { await chrome.storage.session.remove(LAST_ERROR_KEY); } catch (_) {}
    return;
  }

  const action = skMsg(ACTION_KEY[last.action] || 'actionRun');
  const reason = skMsg(last.reason);
  const sameTab = activeTabId != null && last.tabId === activeTabId;
  showError(last.origin && sameTab
    ? skMsg('lastRunFailedWithOrigin', [action, reason, last.origin])
    : skMsg('lastRunFailed', [action, reason]));
}

async function dismissError() {
  hideError();
  try { await chrome.storage.session.remove(LAST_ERROR_KEY); } catch (_) {}
}

document.getElementById('errDismiss').addEventListener('click', dismissError);

/* Escape dismisses whatever is dismissible, which in this popup is the error
   note. Handled at the document, once, so a tool that adds a second dismissible
   surface extends this branch instead of adding a second key listener that
   fights it. The browser may also close the popup on Escape — that is its
   prerogative, and the note is cleared either way. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || errBox.hidden) return;
  e.preventDefault();
  dismissError();
});

/* ---------------- load ---------------- */
async function load() {
  elText(titleEl, skMsg('popupReading'));
  elText(originEl, '');
  copyBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return renderInfo({ ok: false, error: 'reasonNoTab' });
  // The parked note is scoped to the tab it came from, so it needs to know
  // which tab is in front now. Awaited here, not fired at module load, for that
  // one reason.
  await showLastError(tab.id);

  // The blocked-page vocabulary lives in the worker only: one list, so a browser
  // page answers with the reason for THAT kind of page, not a generic refusal.
  const resp = await chrome.runtime.sendMessage({
    type: 'SK_TAB_INFO',
    tabId: tab.id,
    action: 'read-title'
  }).catch(() => ({ ok: false, error: 'reasonNoAnswer' }));

  renderInfo(resp);

  const s = await skGetSettings();
  if (s.copyOnOpen && resp && resp.ok) copy();

  /* PRIVATE WINDOW, HISTORY ON, NOTHING STORED — say so. The user turned
     keepHistory on and is about to look at an empty list; without this the only
     available conclusion is that the setting is broken. A toast, because it is
     a fact about this run and not a failure: skToast is already a role="status"
     live region, so it is announced without a second surface to maintain. */
  if (resp && resp.ok && resp.incognito && s.keepHistory) skToast('popupPrivateNotSaved');

  /* THE FIRST MEANINGFUL WRITE is the moment to ask the browser to keep what we
     just stored. navigator.storage.persist() exists on WINDOW ONLY — a service
     worker gets undefined — so the worker that did the writing cannot make the
     request, and this popup, which is a window with the user right there, can.
     Guarded to once by a local setting inside the helper, and only when the run
     actually kept something: asking on a run that stored nothing would spend
     the one request on a user who may never turn history on. */
  if (resp && resp.ok && resp.kept) skRequestPersistence();
}

/* ---------------- actions ---------------- */
async function copy() {
  if (!currentTitle) return;
  const ok = await skCopyText(currentTitle);
  skToast(ok ? 'popupCopied' : 'popupCopyFailed');
}

copyBtn.addEventListener('click', copy);
document.getElementById('refreshBtn').addEventListener('click', load);
document.getElementById('themeBtn').addEventListener('click', skToggleTheme);
document.getElementById('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

/* load() shows the parked note itself, as soon as it knows which tab is in
   front — the note is tab-scoped, so it cannot be rendered before that. A fresh
   answer arriving afterwards clears it. */
load();
