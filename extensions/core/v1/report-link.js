/* core/v1/report-link.js — "Report a problem" for every extension in this family
   (lane feedback-intake, Do 9). Classic script; attaches `SKREPORT`.
   =====================================================================

   WHAT IT DOES
     Builds the link the options page's "Report a problem" button opens: the
     report form on nikatru.com's /support page, with the extension's OWN state
     filled in. The person writes the description there, sees exactly what is
     sent, and sends it; the site's same-origin Pages Function forwards it to the
     private intake (the platform Worker's POST /v1/feedback). So the extension itself makes NO network
     call (policy-check gate 1 stays "zero network") and asks for no permission.

   WHAT THE LINK MAY CARRY — a closed list, built here and nowhere else
     app       the tool id (tool.json `id`)
     v         the extension version
     loc       the UI locale
     plat      the coarse platform ("chromium 130", "firefox 131"), never a
               user-agent string
     category  one of the intake's categories
     q         the words the person typed into the Help panel's search, for
               "Still stuck? Ask us" (lane help-search): at most 200
               characters, and dropped whole when it looks like a URL, a host
               or an e-mail address — the form shows it, editable, before
               anything is sent
   NOTHING ABOUT A PAGE: no URL, no title, no host, no tab, no capture. A key
   outside the list is dropped, and a value that is not its key's shape (a
   version is digits and dots, a locale a language tag) is dropped even under a
   listed key. scripts/policy-check.mjs gate 10 runs `payload()`
   on a probe state that carries a page URL and fails the build if any of it
   survives — the red control for "never the browsed page, never its URL".
*/
(function (root) {
  'use strict';

  var FORM = 'https://nikatru.com/support';
  var KEYS = ['app', 'v', 'loc', 'plat', 'category', 'q'];
  var CATEGORIES = ['bug', 'crash', 'billing', 'accessibility', 'translation', 'question', 'other'];
  /* One shape per key: a value that is not its key's shape is dropped. A
     generic "short and plain" test let a host name through under `loc`, which
     policy-check gate 10 caught on its first run. */
  var SHAPES = {
    app: /^[a-z][a-z0-9-]{1,40}$/,
    v: /^\d{1,5}(\.\d{1,5}){0,3}$/,
    loc: /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/,
    plat: /^(chromium|firefox) \d{1,4}$|^other$/,
    category: /^[a-z]{2,16}$/,
    q: /^(?!.*(?:\/\/|@|www\.|\.[a-z]{2,}(?:\/|$|\s)))[^\u0000-\u001f<>]{1,200}$/i
  };

  /* The coarse platform: engine and major version only. */
  function coarsePlatform(userAgent) {
    var ua = String(userAgent || '');
    var ff = ua.match(/Firefox\/(\d+)/);
    if (ff) return 'firefox ' + ff[1];
    var ch = ua.match(/Chrom(?:e|ium)\/(\d+)/);
    if (ch) return 'chromium ' + ch[1];
    return 'other';
  }

  /* The query the link carries, from `state`. Only KEYS survive, and only
     short plain values: a URL-looking value is dropped whatever its key. */
  function payload(state) {
    var s = state || {};
    var out = {};
    var raw = {
      app: s.app,
      v: s.version,
      loc: s.uiLocale,
      plat: coarsePlatform(s.userAgent),
      category: CATEGORIES.indexOf(s.category) >= 0 ? s.category : 'bug',
      q: typeof s.query === 'string' ? s.query.replace(/\s+/g, ' ').trim() : undefined
    };
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      var v = raw[k];
      if (typeof v !== 'string' || !SHAPES[k].test(v)) continue;
      out[k] = v;
    }
    return out;
  }

  /* The link the button opens. */
  function link(state) {
    var p = payload(state);
    var q = Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
    return FORM + (q ? '?' + q : '') + '#report-a-problem';
  }

  root.SKREPORT = {
    FORM: FORM,
    KEYS: KEYS.slice(),
    CATEGORIES: CATEGORIES.slice(),
    coarsePlatform: coarsePlatform,
    payload: payload,
    link: link
  };
})(typeof self !== 'undefined' ? self : globalThis);
