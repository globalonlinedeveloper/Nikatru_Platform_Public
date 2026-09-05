/* FullShot popup — pick a capture mode, hand off to the background worker. */

const err = document.getElementById('err');
const errText = document.getElementById('errText');

/* The worker parks the reason for its last failure here (chrome.storage.session
   — it dies with the browser and never syncs). A capture fired from a keyboard
   shortcut has no popup open to answer to, so this is the only place its
   failure can ever be read. */
const LAST_ERROR_KEY = 'fsLastError';

/* The capture-mode name that goes INSIDE the failure sentence, as a message key
   per mode. Two tables, not one, and both are load-bearing:
   MODE_KEY is what a translated popup renders; MODE_LABEL is the English each
   key resolves to, for the one environment that has no chrome.i18n at all
   (test/background-sim.node.js boots this file against a fake chrome). A mode
   the worker parked that this popup does not know falls back to the generic
   noun, which is a word in the message file too. */
const MODE_KEY = {
  full: 'popupModeNameFull', visible: 'popupModeNameVisible',
  region: 'popupModeNameRegion', element: 'popupModeNameElement'
};
const MODE_LABEL = {
  full: 'full-page capture', visible: 'visible-area capture',
  region: 'region capture', element: 'element capture'
};

/* Direction from the message file that actually loaded — the same rule and the
   same reasoning as pages/common.js (which the popup does not share). Guarded
   because test/background-sim.node.js boots this file against a fake chrome
   that has no i18n; a missing i18n means "no opinion", not a crash. */
function applyDir() {
  try {
    if (typeof chrome === 'undefined' || !chrome.i18n || !chrome.i18n.getMessage) return;
    const d = chrome.i18n.getMessage('@@bidi_dir');
    if (d === 'rtl' || d === 'ltr') document.documentElement.dir = d;
    const loc = chrome.i18n.getMessage('@@ui_locale');
    if (loc) document.documentElement.lang = loc.replace(/_/g, '-');
  } catch (_) {}
}
applyDir();

/* ---- strings ------------------------------------------------------------
   Deliberately a COPY of fsMessage/fsApplyI18n in pages/common.js, for exactly
   the reason applyDir above is a copy: the popup does not load common.js, and
   test/background-sim.node.js boots THIS FILE alone, in a sandbox whose chrome
   has no i18n and whose document is a stub. A popup that called into another
   file would take that tier down with a reference error instead of degrading to
   English. The shape is kept identical so the two read side by side, and
   test/i18n-sim.node.js grades both.

   Every string a user sees is either in popup.html carrying data-i18n — where
   the English text stays put as the fallback — or resolved here with the
   English passed alongside the key. Nothing is concatenated: a sentence built
   with + fixes English word order into the product, and "Last $MODE$ failed —
   $REASON$" is a sentence several languages reorder. */
function i18nAvailable() {
  try { return typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.getMessage); }
  catch (_) { return false; }
}

/* Fills $TOKEN$ in the English fallback in order of first appearance, which is
   the order the message file declares them ($1, $2, $3). Chrome does this
   itself whenever the key resolved. */
function subst(text, subs) {
  if (!subs || !subs.length) return String(text);
  const seen = new Map();
  return String(text).replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name) => {
    const n = name.toLowerCase();
    if (!seen.has(n)) seen.set(n, seen.size);
    const v = subs[seen.get(n)];
    return v == null ? whole : String(v);
  });
}

function msg(key, subs, english) {
  let text = '';
  try {
    if (i18nAvailable()) text = chrome.i18n.getMessage(key, subs == null ? undefined : subs.map(String)) || '';
  } catch (_) { text = ''; }
  if (text) return text;
  if (i18nAvailable()) console.warn('i18n: no message for "' + key + '"');
  return english == null ? null : subst(english, subs);
}

/* Walks the markup and fills in every key. Attributes are written by name from
   an allowlist — never a pattern, and never a navigation sink. */
const I18N_ATTRS = ['alt', 'aria-label', 'placeholder', 'title'];
function applyI18n() {
  if (typeof document.querySelectorAll !== 'function') return 0;
  const nodes = document.querySelectorAll('[data-i18n], [data-i18n-attr]');
  let written = 0;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const raw = el.getAttribute('data-i18n-args');
    const args = raw == null || raw === '' ? null : raw.split(',').map(s => s.trim());
    const key = el.getAttribute('data-i18n');
    if (key) {
      const text = msg(key, args, null);
      if (text != null) { el.textContent = text; written++; }
    }
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) continue;
    for (const pair of spec.split(';')) {
      if (!pair.trim()) continue;
      const cut = pair.indexOf(':');
      const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
      const k = cut < 0 ? '' : pair.slice(cut + 1).trim();
      if (!name || !k) { console.warn('i18n: malformed data-i18n-attr "' + pair.trim() + '"'); continue; }
      if (I18N_ATTRS.indexOf(name) < 0) { console.warn('i18n: refusing to write attribute "' + name + '"'); continue; }
      const text = msg(k, args, null);
      if (text != null) { el.setAttribute(name, text); written++; }
    }
  }
  return written;
}
/* popup.js is the last thing in <body>, so the markup is already parsed; the
   listener is the guard for the day the tag moves. Wrapped in an arrow so the
   handler cannot pass its Event in as an argument. */
if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => applyI18n(), { once: true });
} else {
  applyI18n();
}

async function applyTheme() {
  const { theme } = await chrome.storage.sync.get('theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
}
applyTheme();

document.getElementById('themeBtn').addEventListener('click', async () => {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  await chrome.storage.sync.set({ theme: next });
});

function showError(text) {
  errText.textContent = text;
  err.hidden = false;
}

async function showLastError() {
  let last = null;
  try {
    const got = await chrome.storage.session.get(LAST_ERROR_KEY);
    last = got && got[LAST_ERROR_KEY];
  } catch (_) { return; }   // a browser without storage.session has nothing to show
  if (!last || !last.message) return;
  /* The mode name is a noun inside the sentence, so it is resolved first and
     handed in as a substitution rather than glued on. */
  const mode = msg(MODE_KEY[last.mode] || 'popupModeNameGeneric', null,
    MODE_LABEL[last.mode] || 'capture');
  showError(last.origin
    ? msg('popupLastErrorFailedAt', [mode, last.message, last.origin],
        'Last $MODE$ failed — $REASON$ ($ORIGIN$)')
    : msg('popupLastErrorFailed', [mode, last.message],
        'Last $MODE$ failed — $REASON$'));
}
showLastError();

document.getElementById('errDismiss').addEventListener('click', async () => {
  err.hidden = true;
  try { await chrome.storage.session.remove(LAST_ERROR_KEY); } catch (_) {}
});

async function start(mode) {
  err.hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showError(msg('popupNoActiveTab', null, 'No active tab found.'));

  const delay = mode === 'delayed' ? Number(document.getElementById('delaySel').value) : 0;
  const realMode = mode === 'delayed' ? 'full' : mode;

  // The blocked-page list lives in the worker only: one vocabulary, so a browser
  // page answers with the reason for THAT kind of page, not a generic refusal.
  const resp = await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    tabId: tab.id,
    mode: realMode,
    startDelay: delay
    /* A rejection here means the message never reached the worker (asleep and
       failed to wake, context invalidated, port closed), so wireReason() never
       saw it — this is the one answer rendered in the error box that the
       worker's allowlist cannot gate. Drop the engine's text rather than let an
       ungated string onto the surface that allowlist exists to protect; the
       `||` below already holds the sentence. Raw text to the console only. */
  }).catch(e => { console.error(e); return { ok: false, error: null }; });

  if (resp && resp.ok === false) {
    /* The worker's own reason is already a whole sentence and is NOT re-looked
       up here: it is chosen from the worker's allowlist, which knows which kind
       of page refused. One vocabulary, one owner. */
    showError(resp.error || msg('popupCaptureFailedToStart', null, 'Capture failed to start.'));
    return;
  }
  window.close();
}

/* The delay dropdown used to be a CHILD of the delayed-capture button, so every
   click on it bubbled into "start a capture" and had to be filtered out by tag
   name here. A control inside a control is invalid HTML and was the reason that
   dropdown could not be reached from the keyboard without firing a capture; it
   is a sibling now (see popup.html), the click never arrives, and the filter
   that used to catch it is gone rather than left as decoration. */
document.querySelectorAll('.mode').forEach(btn => {
  btn.addEventListener('click', () => start(btn.dataset.mode));
});

// Quick toggle for expand-inner-content mode (full setting lives in Options).
const expandToggle = document.getElementById('expandInner');
chrome.storage.sync.get({ expandInner: true }).then(v => {
  expandToggle.checked = !!v.expandInner;
});
expandToggle.addEventListener('change', () => {
  // Save first — the permission dialog may close the popup.
  chrome.storage.sync.set({ expandInner: expandToggle.checked });
  if (expandToggle.checked) {
    chrome.permissions.contains({ origins: ['<all_urls>'] }).then(granted => {
      if (!granted) return chrome.permissions.request({ origins: ['<all_urls>'] });
    }).catch(() => {});
  }
});

document.getElementById('historyLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/history.html') });
});
document.getElementById('batchLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/batch.html') });
});
document.getElementById('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
