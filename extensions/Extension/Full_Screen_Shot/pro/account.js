/* pro/account.js — FullShot Pro: the account check's ONE network file, and the Upgrade path.

   ⏱ 2026-10-01 (EXM-01, train P47). FullShot Pro had no purchase path on any
   browser: no Upgrade control, no checkout, no offering. This file is what the
   service worker (and only the service worker) uses to answer "is this browser
   Pro?" and "where does Upgrade go?".

   WHAT DECIDES PRO. vendor/core/entitlement-client.js (SKENT), the shared
   client #1077 landed in extensions/core: isPro() over the cached answer of OUR
   API's GET /v1/entitlements, fail-closed, at most 7 days old. Nothing here — and
   nothing in FullShot — reads a store SDK or a store licence: Chrome Web Store
   payments are retired, and Edge and AMO have none (tooling/channel-register.json
   purchaseRail). A store can never unlock Pro.

   THE ONE NETWORK CALL. `transport` is what SKENT.createClient is handed: it
   fetches platform.nikatru.com, the one host tool.json policy.networkAllowlist
   names and the manifest CSP connect-src allows. SKENT builds every request from
   its own three paths and four keys, so this file cannot widen what is sent.
   Nothing about a page, a tab or a capture is ever a parameter.

   THE UPGRADE URL carries the PRODUCT and the ACCOUNT BINDING: `app=fullshot` (the
   parameter sites/nikatru/pricing.html already reads to know which product a
   checkout is for, and the page's FullShot section, which generate-discovery.mjs
   renders from app-config-data) and, when this browser is linked to a Nikatru
   account, `link=<link_id>` — the
   id POST /v1/ext/token returned for this browser's credential. The checkout page
   is signed in; it sells to that account (POST /v1/checkout attributes by the
   signed-in user, ADR 044 §6), and the link id lets it confirm the account it
   charges is the one this browser checks. The CREDENTIAL never leaves the
   service worker and never appears in a URL.

   ⬜ SIGN-IN IS NOT HERE YET. The connect flow (identity permission,
   launchWebAuthFlow, SKENT.newFlow/authUrl/codeFrom, client.exchange) waits on a
   registered redirect URI per channel — every extension row's
   `extensionRedirectUri` in tooling/channel-register.json is null today, so the
   server refuses every code mint. Until then no credential exists, the check
   never runs (needsCheck is false with no credential), and Upgrade opens the
   checkout with the product alone. O-EXTENSION-ACCOUNT-CHECK-UNBUILT owns it.

   Classic script, attaching FSPRO to the global, like SKENT and SKDB. */
(function (root) {
  'use strict';

  var PRODUCT = 'fullshot';
  var UPGRADE_PAGE = 'https://nikatru.com/pricing';
  /* A link id is the server's opaque identifier for one linked browser. Anything
     else is not put in a URL. */
  var LINK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

  /* The checkout this browser's Upgrade control opens. */
  function upgradeUrl(linkId) {
    var q = new URLSearchParams({ app: PRODUCT });
    if (typeof linkId === 'string' && LINK_ID_RE.test(linkId)) q.set('link', linkId);
    return UPGRADE_PAGE + '?' + q.toString();
  }

  /* SKENT's transport: {method, path, bearer, query, body} -> {status, body}.
     `body` is parsed only when the answer declared JSON; a WAF page or a captive
     portal arrives as null (SKENT holds the cache on those). Rejects when
     nothing answered, which SKENT reads as status 0. */
  function transport(req) {
    var qs = req.query ? '?' + new URLSearchParams(req.query).toString() : '';
    var headers = {};
    if (req.bearer) headers.Authorization = 'Bearer ' + req.bearer;
    if (req.body) headers['Content-Type'] = 'application/json';
    return fetch('https://platform.nikatru.com' + req.path + qs, {
      method: req.method,
      headers: headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      var json = /^application\/json\b/i.test(res.headers.get('content-type') || '');
      if (!json) return { status: res.status, body: null };
      return res.json().then(function (b) { return { status: res.status, body: b }; },
        function () { return { status: res.status, body: null }; });
    });
  }

  /* The client, over chrome.storage.local (never sync: a credential is per device). */
  function client(store) {
    return root.SKENT.createClient({ transport: transport, store: store, product: PRODUCT });
  }

  /* {pro, signedIn, upgradeUrl} — what the popup is told. Runs the daily check
     first when one is due (never with no credential); a check that throws or
     fails leaves the cached answer, which isPro then judges. */
  function state(store, now) {
    var t = typeof now === 'function' ? now : function () { return Date.now(); };
    var c = client(store);
    return Promise.resolve()
      .then(function () { return c.check(false); })
      .then(null, function () { return null; })
      .then(function () { return store.get(root.SKENT.CACHE_KEY); })
      .then(function (got) {
        var cache = got ? got[root.SKENT.CACHE_KEY] : null;
        var signedIn = !!(cache && typeof cache === 'object' && typeof cache.token === 'string');
        var linkId = signedIn && typeof cache.linkId === 'string' ? cache.linkId : null;
        return { pro: root.SKENT.isPro(cache, t()), signedIn: signedIn, upgradeUrl: upgradeUrl(linkId) };
      });
  }

  root.FSPRO = { PRODUCT: PRODUCT, UPGRADE_PAGE: UPGRADE_PAGE, upgradeUrl: upgradeUrl, transport: transport, client: client, state: state };
})(typeof self !== 'undefined' ? self : globalThis);
