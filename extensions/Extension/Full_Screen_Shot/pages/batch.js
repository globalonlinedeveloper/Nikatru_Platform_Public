/* FullShot — batch URL capture (v1.9.7; hardened v1.9.12).
   PURE CORE (node-testable, no browser): URL-list parsing/validation, output
   filename derivation, and the sequential job-queue state machine. The browser
   controller (bottom, DOM-guarded) drives pages/batch.html and hands the plan to
   background.js, which runs the tab-capture loop. No new manifest permission —
   <all_urls> is already an optional host permission requested at run time.
   A pasted list is UNTRUSTED input: fsNormalizeUrl percent-encodes the RFC 3986
   excluded characters (so no token can carry markup), and both renderers build
   DOM nodes with textContent (so no token can become markup). Either gate alone
   would hold; both are asserted by test/batch-sim.node.js. */
(function (root) {
  'use strict';

  const BATCH_MAX = 50;   // hard cap on URLs per batch (an unbounded list can't be chased)
  /* The one place the over-cap rejection token is spelled. It is the only skip
     reason that carries a value inside it, so the renderer below cannot match
     it against a constant the way it matches the other five; both ends call
     this instead of writing the string twice. A skip reason is an ENUM the
     queue and test/batch-sim.node.js read — the sentence a person sees is
     looked up from it in skipReasonText(). */
  const overCapReason = max => 'over cap (' + max + ')';
  const BAD_SCHEME = /^(chrome|chrome-extension|moz-extension|about|file|data|javascript|blob|view-source|edge|brave|opera|vivaldi|ftp|mailto|tel):/i;
  /* RFC 3986 excludes these from a URI; a pasted list is untrusted input, so a
     token carrying them is canonicalized rather than trusted. Two forms: the /g
     one is for replace, the plain one for test (a /g regex keeps lastIndex). */
  const URL_UNSAFE = /[\x00-\x20"'<>`\\^{}|\x7f]/;
  const URL_UNSAFE_G = /[\x00-\x20"'<>`\\^{}|\x7f]/g;
  const pctEncode = c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');

  /* Normalize one raw token to a canonical http(s) URL (host lowercased, root
     "/" stripped) or a {bad:reason}. Bare domains become https://. */
  function fsNormalizeUrl(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/^["'<(\[]+|["'>)\],]+$/g, '').trim();
    if (!s) return null;
    if (BAD_SCHEME.test(s)) return { bad: 'unsupported scheme' };
    if (!/^https?:\/\//i.test(s)) {
      if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return { bad: 'unsupported scheme' };  // some other scheme
      s = 'https://' + s;                                                          // bare domain -> https
    }
    const m = /^(https?):\/\/([^\/?#]+)([\s\S]*)$/i.exec(s);
    if (!m) return { bad: 'invalid' };
    const host = m[2].toLowerCase();
    let rest = m[3] || '';
    if (!host || (host.indexOf('.') < 0 && !/^localhost(:\d+)?$/i.test(host))) return { bad: 'no host' };
    if (/\s/.test(host)) return { bad: 'invalid' };
    if (URL_UNSAFE.test(host)) return { bad: 'invalid' };   // a host can't hold them; don't mangle, reject
    if (rest === '/') rest = '';
    rest = rest.replace(URL_UNSAFE_G, pctEncode);           // path/query/fragment: encode, don't drop
    return { url: m[1].toLowerCase() + '://' + host + rest, host };
  }

  function fsParseUrlList(text, opts) {
    const max = (opts && opts.max) || BATCH_MAX;
    const urls = [], skipped = [], seen = Object.create(null);
    for (const line of String(text == null ? '' : text).split(/[\r\n,]+/)) {
      const raw = line.trim();
      if (!raw) continue;
      const n = fsNormalizeUrl(raw);
      if (!n || n.bad) { skipped.push({ raw, reason: (n && n.bad) || 'empty' }); continue; }
      const key = n.url.toLowerCase();
      if (seen[key]) { skipped.push({ raw, reason: 'duplicate' }); continue; }
      if (urls.length >= max) { skipped.push({ raw, reason: overCapReason(max) }); continue; }
      seen[key] = 1; urls.push(n.url);
    }
    return { urls, skipped, capped: urls.length >= max };
  }

  /* A safe, unique-in-`taken` download filename: NN-host-path.png. */
  function fsBatchFilename(url, index, taken) {
    let base = 'page';
    try {
      const noScheme = String(url).replace(/^https?:\/\//i, '');
      const host = noScheme.split(/[\/?#]/)[0].replace(/^www\./i, '').replace(/:\d+$/, '');
      const p = noScheme.slice(noScheme.indexOf(host) + host.length).split(/[?#]/)[0].replace(/\/+$/, '');
      base = (host + p).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'page';
    } catch (_) {}
    base = base.slice(0, 60).replace(/-+$/, '');
    const name = String(index + 1).padStart(2, '0') + '-' + base;
    const set = taken || new Set();
    let candidate = name + '.png', n = 2;
    while (set.has(candidate)) candidate = name + '-' + (n++) + '.png';
    set.add(candidate);
    return candidate;
  }

  /* ---- sequential job queue (one tab at a time; skip-on-error) ---- */
  function fsCreateBatch(urls) {
    return { jobs: (urls || []).map(u => ({ url: u, status: 'pending', error: null, shotId: null })), started: false };
  }
  function fsNextJob(batch) {
    for (let i = 0; i < batch.jobs.length; i++) if (batch.jobs[i].status === 'pending') return i;
    return -1;
  }
  function fsStartJob(batch, i) { const j = batch.jobs[i]; if (j && j.status === 'pending') j.status = 'capturing'; }
  function fsSettleJob(batch, i, ok, info) {
    const j = batch.jobs[i]; if (!j) return;
    if (ok) { j.status = 'done'; j.shotId = (info && info.shotId) || null; j.error = null; }
    else { j.status = 'error'; j.error = (info && info.error) || 'failed'; }
  }
  function fsBatchStats(batch) {
    let done = 0, errors = 0, pending = 0, active = 0;
    for (const j of batch.jobs) {
      if (j.status === 'done') done++;
      else if (j.status === 'error') errors++;
      else if (j.status === 'capturing') active++;
      else pending++;
    }
    return { total: batch.jobs.length, done, errors, pending, active, finished: pending === 0 && active === 0 };
  }

  const api = { BATCH_MAX, fsNormalizeUrl, fsParseUrlList, fsBatchFilename,
                fsCreateBatch, fsNextJob, fsStartJob, fsSettleJob, fsBatchStats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FSBatch = api;

  /* ---- browser controller (runs only on batch.html) ---- */
  if (typeof document === 'undefined') return;

  /* batch.html is the one page that does not share pages/common.css, so it
     cannot pick up `direction: __MSG_@@bidi_dir__` — Chrome substitutes that
     token in .css FILES and in manifest.json, never inside an inline <style>.
     Direction therefore arrives here only, and only via the attribute. Same
     rule as pages/common.js: ask which message file loaded, never keep a list
     of RTL language codes. */
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const d = chrome.i18n.getMessage('@@bidi_dir');
      if (d === 'rtl' || d === 'ltr') document.documentElement.dir = d;
      const loc = chrome.i18n.getMessage('@@ui_locale');
      if (loc) document.documentElement.lang = loc.replace(/_/g, '-');
    }
  } catch (_) { /* no i18n: read left-to-right, as before */ }

  /* ---- strings: the pass that reads the locale files ----------------------
     FullShot ships 55 translated message files; until this existed, this page
     rendered English in all of them. Chrome substitutes __MSG_x__ in
     manifest.json and in .css FILES — never inside HTML — so batch.html carries
     KEYS in data-i18n and the substitution happens here, once, on load. The
     authored English stays in the markup as the fallback: a key that fails to
     resolve leaves the page exactly as written and warns, so the worst case is
     the English this page shipped for a year, never a blank heading.

     Deliberately a COPY of fsMessage/fsPluralMessage/fsApplyI18n in
     pages/common.js, for the same reason popup.js carries one: batch.html is
     the ONE page that loads neither common.css nor common.js — it is standalone
     by design (see the note in its <style>) and wires its own direction above.
     A cross-file call would also take test/batch-sim.node.js down with a
     ReferenceError instead of degrading to English, because that tier requires
     THIS file as a plain module. The shape is kept identical to common.js so
     the two read side by side.

     Nothing is concatenated into a sentence. "$COUNT$ skipped: $REASONS$",
     "$DONE$/$TOTAL$ done, $FAILED$ failed" and the intro are sentences several
     of the 55 reorder, and a sentence built with + fixes English word order
     into the product. Text reaches the page through textContent and attributes
     through setAttribute against an allowlist — never a markup sink, which is
     the same rule the URL renderers below already keep. */
  function i18nAvailable() {
    try { return typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.getMessage); }
    catch (_) { return false; }
  }

  /* The locale of the message file that actually LOADED, not the one the user
     set: the two disagree whenever Chrome falls back, and it is the strings on
     screen that have to agree with the plural rule and the digits. Same reason
     the direction block above asks @@bidi_dir rather than getUILanguage(). */
  function uiLocale() {
    try {
      if (i18nAvailable()) {
        const l = chrome.i18n.getMessage('@@ui_locale');
        if (l) return l.replace(/_/g, '-');
      }
    } catch (_) {}
    return 'en';
  }

  /* Fills $TOKEN$ in the English FALLBACK in order of first appearance, which is
     the order the message file declares them ($1, $2, $3). Chrome does this
     itself whenever the key resolved. An unfilled token is left visible rather
     than blanked — a visible $MAX$ is a bug report, a silent gap is not. */
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

  /* Resolve without complaining — the plural selector tries two keys and a miss
     on the first is normal, not a defect. */
  function rawMsg(key, subs) {
    try {
      if (!i18nAvailable()) return '';
      return chrome.i18n.getMessage(key, subs == null ? undefined : subs.map(String)) || '';
    } catch (_) { return ''; }
  }

  function msg(key, subs, english) {
    const text = rawMsg(key, subs);
    if (text) return text;
    if (i18nAvailable()) console.warn('i18n: no message for "' + key + '"');
    return english == null ? null : subst(english, subs);
  }

  /* A count inside a sentence is a number, and a number belongs to the locale.
     The row ordinal and the derived filename's 01- prefix deliberately do NOT
     go through here: those pair with each other and with the file on disk. */
  function num(n) {
    try { return new Intl.NumberFormat(uiLocale()).format(Number(n)); }
    catch (_) { return String(n); }
  }

  /* Chrome's messages.json has NO plural support. The only shape that works is
     one key per CLDR category, chosen with Intl.PluralRules for the locale that
     loaded — never a table of languages, because ja has one category, de two,
     ru four and ar six. Same table as pages/common.js and i18n/plurals.mjs. */
  const PLURAL_SUFFIX = { zero: 'Zero', one: 'One', two: 'Two', few: 'Few', many: 'Many', other: 'Other' };
  function pluralCategory(count) {
    try { return new Intl.PluralRules(uiLocale()).select(Number(count)); }
    catch (_) { return 'other'; }
  }
  /* `subs` is the COMPLETE positional list the message declares. Falls back to
     <base>Other, because a locale file carries only the categories that locale
     uses and a category selected for a locale Chrome fell back FROM would
     otherwise blank the line. */
  function pluralMsg(base, count, subs, english) {
    const cat = pluralCategory(count);
    const keys = cat === 'other' ? [base + 'Other'] : [base + PLURAL_SUFFIX[cat], base + 'Other'];
    for (const k of keys) {
      const t = rawMsg(k, subs);
      if (t) return t;
    }
    if (i18nAvailable()) console.warn('i18n: no message for "' + base + PLURAL_SUFFIX[cat] + '" (or its Other form)');
    return english == null ? null : subst(english, subs);
  }

  /* Attributes the pass may write, BY NAME. An allowlist, never a pattern: a
     data-i18n-attr naming href would turn a message file into a link target.
     This page spends none of them today — the one attribute it renders, the
     textarea placeholder, has no key — but the walker is the shared shape and
     an allowlist that only exists once the first caller needs it is an
     allowlist nobody writes. */
  const I18N_ATTRS = ['alt', 'aria-label', 'placeholder', 'title'];
  function applyI18n() {
    if (typeof document.querySelectorAll !== 'function') return 0;
    const nodes = document.querySelectorAll('[data-i18n], [data-i18n-attr]');
    let written = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const raw = node.getAttribute('data-i18n-args');
      const args = raw == null || raw === '' ? null : raw.split(',').map(s => s.trim());
      const key = node.getAttribute('data-i18n');
      if (key) {
        const text = msg(key, args, null);
        if (text != null) { node.textContent = text; written++; }
      }
      const spec = node.getAttribute('data-i18n-attr');
      if (!spec) continue;
      for (const pair of spec.split(';')) {
        if (!pair.trim()) continue;
        const cut = pair.indexOf(':');
        const name = (cut < 0 ? pair : pair.slice(0, cut)).trim().toLowerCase();
        const k = cut < 0 ? '' : pair.slice(cut + 1).trim();
        if (!name || !k) { console.warn('i18n: malformed data-i18n-attr "' + pair.trim() + '"'); continue; }
        if (I18N_ATTRS.indexOf(name) < 0) { console.warn('i18n: refusing to write attribute "' + name + '"'); continue; }
        const text = msg(k, args, null);
        if (text != null) { node.setAttribute(name, text); written++; }
      }
    }
    return written;
  }

  /* ---- two vocabularies this page does not own, mapped where they are shown --
     A skip reason is an enum the pure core emits and test/batch-sim.node.js
     asserts by value; a job error is one of the sentences background.js chose
     from ITS allowlist. Neither is translated at the source — the core's tokens
     are read by code, and the worker owns its own wording — so the token
     becomes a person's sentence here, at the one place it is rendered.

     Exact-match tables, never a pattern: the same rule as the worker's reason
     allowlist. A value not listed is shown exactly as it arrived, which for a
     worker sentence is the English it was written in — the alternative is a
     blank status column, and only background.js can key the rest of its
     vocabulary. */
  const SKIP_REASON_KEY = Object.assign(Object.create(null), {
    'unsupported scheme': 'batchSkipReasonScheme',
    'invalid': 'batchSkipReasonInvalid',
    'no host': 'batchSkipReasonNoHost',
    'duplicate': 'batchSkipReasonDuplicate',
    'empty': 'batchSkipReasonEmpty'
  });
  function skipReasonText(reason) {
    const r = String(reason == null ? '' : reason);
    const key = SKIP_REASON_KEY[r];
    if (key) return msg(key, null, r);
    if (r === overCapReason(BATCH_MAX)) return msg('batchSkipReasonOverCap', [num(BATCH_MAX)], 'over cap ($MAX$)');
    return r;
  }
  const JOB_ERROR_KEY = Object.assign(Object.create(null), {
    'capture timed out': 'batchJobTimedOut',
    'no capture session': 'batchJobNoSession',
    'capture failed': 'batchJobFailed',
    'capture error': 'batchJobError',
    /* fsSettleJob's own default, for a settle that carried no reason at all.
       The worker always passes one, so this row is the belt to that braces. */
    'failed': 'batchJobFailed'
  });
  function jobErrorText(error) {
    const e = String(error == null ? '' : error);
    const key = JOB_ERROR_KEY[e];
    return key ? msg(key, null, e) : e;
  }

  document.addEventListener('DOMContentLoaded', () => {
    /* Strings first, before anything else paints. batchIntro's second
       substitution is itself a TRANSLATED word — the intro promises a link
       reading "open" and the row at the bottom renders one, so both must be the
       same word in every language — which markup cannot carry. It is resolved
       here and handed to the pass through the same data-i18n-args channel the
       markup uses, so the intro takes the ordinary single-write path instead of
       being rendered twice. $MAX$ comes from the cap the pure core enforces,
       never from the number in the HTML. The channel is comma-separated and no
       translation of batchRowOpen contains a comma (checked across all 55); one
       that did would lose the tail of that one word, not the sentence. */
    const intro = document.querySelector('[data-i18n="batchIntro"]');
    if (intro) intro.setAttribute('data-i18n-args', num(BATCH_MAX) + ',' + msg('batchRowOpen', null, 'open'));
    applyI18n();

    const $ = id => document.getElementById(id);
    const ta = $('bqUrls'), planEl = $('bqPlan'), runBtn = $('bqRun'), progEl = $('bqProgress');
    /* The two count lines are declared in the markup as role="status" and are
       WRITTEN INTO here, never rebuilt. A live region announces a change to an
       element the browser was already watching; replacing the element each
       render — which is what this file used to do — hands it a brand-new node
       that arrives with its text already in place, and that is precisely the
       case assistive technology may ignore. */
    const planCountEl = $('bqPlanCount'), progCountEl = $('bqProgressCount');
    if (!ta || !runBtn) return;   // not the batch page
    let batch = null;

    /* A pasted URL is untrusted text. It is canonicalized in fsNormalizeUrl, and
       it reaches the page only as a text node here — never as markup. */
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = String(text);
      return n;
    };
    const rowFor = (i, url, status) => {
      const row = el('div', status ? 'bq-row bq-' + status : 'bq-row');
      row.appendChild(el('span', 'bq-n', i + 1));
      row.appendChild(el('span', 'bq-url', url));
      return row;
    };

    /* One key per whole sentence. "N pages to capture" is a PLURAL — ja carries
       one form, ru four — and the capped variant is its own message because
       " (capped at 50)" glued onto the end assumes English puts the aside last
       and the count first. */
    function planCountText(r) {
      if (!r.urls.length) return msg('batchPlanEmpty', null, 'No valid URLs yet');
      if (r.capped) return msg('batchPlanCapped', [num(r.urls.length), num(BATCH_MAX)],
        '$COUNT$ pages to capture (capped at $MAX$)');
      return pluralMsg('batchPlanCount', r.urls.length, [num(r.urls.length)],
        r.urls.length === 1 ? '$COUNT$ page to capture' : '$COUNT$ pages to capture');
    }
    function renderPlan() {
      const r = fsParseUrlList(ta.value);
      const taken = new Set();
      planEl.textContent = '';
      planCountEl.textContent = planCountText(r);
      r.urls.forEach((u, i) => {
        const row = rowFor(i, u, '');
        row.appendChild(el('span', 'bq-fn', fsBatchFilename(u, i, taken)));
        planEl.appendChild(row);
      });
      if (r.skipped.length) {
        /* The reasons are a list inside a sentence, so the list is built first
           and spent as one substitution. The ellipsis belongs to the list (six
           shown, more behind it), not to the sentence. */
        const reasons = r.skipped.slice(0, 6).map(s => skipReasonText(s.reason)).join(', ') +
          (r.skipped.length > 6 ? '…' : '');
        planEl.appendChild(el('div', 'bq-skip',
          msg('batchSkipped', [num(r.skipped.length), reasons], '$COUNT$ skipped: $REASONS$')));
      }
      runBtn.disabled = r.urls.length === 0;
      return r;
    }
    /* Four states, four messages, no clauses glued on: ", N failed" and
       " — complete" are not sentence-final in every language, and a language
       that puts the total first has to be free to move the whole line. */
    function progressCountText(st) {
      const done = num(st.done), total = num(st.total), failed = num(st.errors);
      if (st.errors) {
        return st.finished
          ? msg('batchProgressCompleteFailed', [done, total, failed], '$DONE$/$TOTAL$ done, $FAILED$ failed — complete')
          : msg('batchProgressCountFailed', [done, total, failed], '$DONE$/$TOTAL$ done, $FAILED$ failed');
      }
      return st.finished
        ? msg('batchProgressComplete', [done, total], '$DONE$/$TOTAL$ done — complete')
        : msg('batchProgressCount', [done, total], '$DONE$/$TOTAL$ done');
    }
    function renderProgress() {
      if (!batch) return;
      const st = fsBatchStats(batch);
      progEl.textContent = '';
      progCountEl.textContent = progressCountText(st);
      batch.jobs.forEach((j, i) => {
        const row = rowFor(i, j.url, j.status);
        /* Glyph plus reason, not a sentence: ✓ ✕ … · are symbols and read the
           same everywhere, and the reason after ✕ is a phrase of its own. */
        const stat = el('span', 'bq-st',
          j.status === 'done' ? '✓' : j.status === 'error' ? '✕ ' + jobErrorText(j.error) :
          j.status === 'capturing' ? '…' : '·');
        if (j.shotId) {
          const a = el('a', '', msg('batchRowOpen', null, 'open'));
          a.href = 'result.html?shot=' + encodeURIComponent(j.shotId);
          a.target = '_blank';
          a.rel = 'noopener';
          stat.appendChild(document.createTextNode(' '));
          stat.appendChild(a);
        }
        row.appendChild(stat);
        progEl.appendChild(row);
      });
    }

    ta.addEventListener('input', renderPlan);
    /* `m`, not `msg`: msg() is the message lookup above, and a parameter of that
       name would shadow it for everything written inside this listener. */
    chrome.runtime.onMessage.addListener(m => {
      if (m && m.type === 'BATCH_PROGRESS' && m.batch) { batch = m.batch; renderProgress(); }
    });
    runBtn.addEventListener('click', async () => {
      const r = renderPlan();
      if (!r.urls.length) return;
      runBtn.disabled = true;
      try {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (!granted) {
          progEl.textContent = '';
          /* Into the live region, not into the list beneath it: a refusal is
             the outcome of the button the user just pressed, and it is the one
             message on this page a reader must not have to go looking for. */
          progCountEl.textContent = msg('batchPermissionDeclined', null,
            'Permission to open those pages was declined.');
          runBtn.disabled = false;
          runBtn.focus();
          return;
        }
      } catch (_) {}
      batch = fsCreateBatch(r.urls); renderProgress();
      chrome.runtime.sendMessage({ type: 'BATCH_START', urls: r.urls });
    });
    renderPlan();
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
