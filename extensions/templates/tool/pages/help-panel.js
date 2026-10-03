/* help-panel.js — the options page's Help panel (lane help-search, Do 5).
   =====================================================================
   Searches the BUNDLED help index (lib/help-index.js, written with the ranker
   lib/help-search.js by tooling/help/build-index.mjs from content/help/) on the
   device as the person types: no request, no permission, and the query never
   leaves the page. Each result links to its article on nikatru.com/help, which
   the browser opens in a new tab. "Still stuck? Ask us" opens the report form
   (SKREPORT, lib/report-link.js) with category "question" and the
   search text, which the person reads and edits before anything is sent.
   scripts/policy-check.mjs gate 11 fails the build when the bundled index is
   absent or empty. */
import { search } from '../lib/help-search.js';
import index from '../lib/help-index.js';

const ORIGIN = 'https://nikatru.com';
const LIMIT = 5;

const input = document.getElementById('helpQuery');
const list = document.getElementById('helpResults');
const none = document.getElementById('helpNone');
const ask = document.getElementById('helpAskBtn');
/* global el, elAppend, elClear — pages/common.js, loaded before this module. */

function render() {
  const q = input.value.trim();
  const docs = q === '' ? index.docs.slice(0, LIMIT) : search(index, q, { limit: LIMIT }).map((h) => index.docs.find((d) => d.id === h.id));
  // The template's rule: only common.js assigns textContent; el() does it here.
  elClear(list);
  for (const d of docs) {
    const a = el('a', null, d.title);
    a.href = ORIGIN + d.url;
    a.target = '_blank';
    a.rel = 'noopener';
    elAppend(list, elAppend(el('li'), a, el('br'), el('small', null, d.summary)));
  }
  none.hidden = docs.length > 0;
}

ask.addEventListener('click', () => {
  const url = self.SKREPORT.link({
    app: document.getElementById('helpSection').dataset.app, // PLACEHOLDER(id) — set in options.html
    version: chrome.runtime.getManifest().version,
    uiLocale: chrome.i18n.getUILanguage(),
    userAgent: navigator.userAgent,
    category: 'question',
    query: input.value.trim(),
  });
  chrome.tabs.create({ url });
});
input.addEventListener('input', render);
render();
