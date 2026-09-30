/* SPDX-License-Identifier: MPL-2.0
   core/v1/entitlement-client.js — vendored into a tool as vendor/core/entitlement-client.js.

   THE ACCOUNT-CHECKED PRO ENTITLEMENT, AS EVERY EXTENSION HOLDS IT. WRITTEN
   HERE, NOT PROMOTED: no tool has an entitlement client yet, and the pipeline
   rule (owner lock 2026-09-28) is that what more than one tool needs is built
   once in core and ADOPTED. Design: research/session-2026-09-23/extension-
   account-check/design.md §3.2 (sign-in), §3.3 (cache and revocation), decided
   under decisions/ext/013 (Pro is checked over the network; the free tier is
   not). Round-2 findings EXA-01 and EXM-03, 2026-09-30.

   🔴 THIS FILE MAKES NO NETWORK CALL, AND CANNOT. docs/CORE-POLICY.md §1.3:
   shared code never names a network API. The ONE call the Pro check makes is
   the adopting tool's, in the one file its tool.json policy names, and it is
   handed in here as `transport` — a function that takes {method, path, bearer,
   query, body} and resolves {status, body}, or rejects when nothing answered.
   `body` is the parsed object ONLY when the response declared JSON and parsed
   as JSON; anything else (an HTML page, text, nothing) arrives as null.
   The sim scans these bytes for every network API name and fails on one.

   WHAT IT DECIDES
     isPro(cache, now)     the pure, fail-closed answer, ADR 057's shape:
                           signed in, the last answer said Pro, that answer is
                           at most 7 days old (and not from the future), and the
                           paid-through instant has not passed (null = lifetime,
                           unparseable = NOT Pro).
     applyAnswer(...)      what one answer to GET /v1/entitlements does:
                             200 is_pro:true  → cache refreshed
                             200 is_pro:false → Pro DROPS ON THE SAME TICK (a
                                                refund, a chargeback, a lapse)
                             401 {error:'invalid_link'} or
                             403 {error:'wrong_product'}
                                              → credential AND cache deleted —
                                                ONLY on OUR API's own JSON code
                             any other 401/403 → cache HELD, effect 'retry': a
                                                WAF page, a captive portal or a
                                                proxy is not our server saying
                                                the credential is dead (round-2
                                                re-review finding 7)
                             anything else    → cache HELD; isPro's 7-day
                                                ceiling decides. An outage on
                                                our side never takes Pro away
                                                inside that ceiling, and never
                                                keeps it past it.
     needsCheck(...)       on demand only — never with no credential, at most
                           once a day, at least an hour after a failure.

   WHAT A REQUEST MAY CARRY
     Exactly three paths (/v1/entitlements, /v1/ext/token, /v1/ext/revoke) and
     exactly four keys (app_id, code, code_verifier, redirect_uri). Nothing about
     a page, a tab, a capture or a setting (ADR 058). The client builds every
     request itself from these lists, so a tool cannot widen them by accident.

   WHERE THE CREDENTIAL LIVES
     `store` is the tool's chrome.storage.local area, handed in. Never
     storage.sync: a credential is per device, and the server revokes it per
     device. The one key is CACHE_KEY.
     ⚠️ THE TRADE-OFF, RECORDED FOR THE ADOPTION PR (re-review nit 12):
     storage.local is readable by the tool's content scripts by default, and
     FullShot injects content scripts. storage.session can be restricted to
     trusted contexts but dies with the browser, which would sign Pro out every
     restart. So the adopting tool must create this client in its service
     worker ONLY, and its content scripts must never read storage — the
     adoption PR adds the guard that holds that. The credential can read one
     product's entitlement and revoke itself, nothing more.

   Classic script, attaching SKENT to the global, like SKDB and SKJOBS.
*/
(function (root) {
  'use strict';

  var DAY = 86400000;
  var HOUR = 3600000;

  var OFFLINE_CEILING_MS = 7 * DAY;
  var CHECK_INTERVAL_MS = DAY;
  var RETRY_AFTER_FAILURE_MS = HOUR;
  var FUTURE_SKEW_MS = 5 * 60000;
  var CACHE_VERSION = 1;
  var CACHE_KEY = 'skEntitlement';
  var CONNECT_PAGE = 'https://nikatru.com/ext/connect';

  var PATHS = ['/v1/entitlements', '/v1/ext/token', '/v1/ext/revoke'];
  var KEYS = ['app_id', 'code', 'code_verifier', 'redirect_uri'];
  var CHANNELS = ['chrome-webstore', 'edge-addons', 'amo'];

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* A cache is usable only in its exact shape. Anything else — an older
     version, a hand-edited object, a string — is treated as signed out. */
  function readCache(v) {
    if (!isObj(v) || v.v !== CACHE_VERSION) return null;
    if (typeof v.token !== 'string' || v.token === '') return null;
    return v;
  }

  /* The latest instant an ACTIVE grant runs to. null when any active grant is a
     lifetime one (expires_at null — the server's rule 3). An unparseable value
     is carried through as the string, so isPro refuses it (rule 4). Absent any
     active grant, the answer is the empty string: not a date, so not Pro. */
  function paidThroughOf(body) {
    if (!isObj(body)) return '';
    var ends = [];
    var rows = Array.isArray(body.entitlements) ? body.entitlements : [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (isObj(r) && r.is_active === true) ends.push(r.expires_at);
    }
    if (isObj(body.bundle)) ends.push(body.bundle.expires_at);
    if (ends.length === 0) return '';
    var best = -Infinity;
    var bestRaw = '';
    for (var j = 0; j < ends.length; j++) {
      var e = ends[j];
      if (e === null) return null;
      var t = typeof e === 'string' ? Date.parse(e) : NaN;
      if (!isFinite(t)) return typeof e === 'string' ? e : '';
      if (t > best) { best = t; bestRaw = e; }
    }
    return bestRaw;
  }

  function isPro(cacheIn, now) {
    var c = readCache(cacheIn);
    if (c === null) return false;
    if (c.isPro !== true) return false;
    if (typeof c.checkedAt !== 'number' || !isFinite(c.checkedAt)) return false;
    if (c.checkedAt - now > FUTURE_SKEW_MS) return false;
    if (now - c.checkedAt > OFFLINE_CEILING_MS) return false;
    if (c.paidThrough === null) return true;
    if (typeof c.paidThrough !== 'string') return false;
    var until = Date.parse(c.paidThrough);
    if (!isFinite(until)) return false;
    return now < until;
  }

  /* One answer → {cache, effect}. `cache` null means delete the stored key. */
  function applyAnswer(cacheIn, answer, now) {
    var c = readCache(cacheIn);
    if (c === null) return { cache: null, effect: 'signed_out' };
    var status = isObj(answer) && typeof answer.status === 'number' ? answer.status : 0;
    if (isOurDeadCredential(status, answer)) return { cache: null, effect: 'signed_out' };
    if (status === 401 || status === 403) return { cache: withFailure(c, now), effect: 'retry' };
    if (status === 200 && isObj(answer.body) && typeof answer.body.is_pro === 'boolean') {
      var next = {
        v: CACHE_VERSION,
        token: c.token,
        linkId: c.linkId,
        isPro: answer.body.is_pro,
        paidThrough: answer.body.is_pro ? paidThroughOf(answer.body) : '',
        checkedAt: now,
        failedAt: null
      };
      return { cache: next, effect: answer.body.is_pro ? 'updated' : 'dropped' };
    }
    return { cache: withFailure(c, now), effect: 'held' };
  }

  /* OUR server's word that the credential is dead: a JSON body carrying our own
     code (services/platform/src/middleware/ext-device-auth.ts). A 401 or 403
     from anything in front of it carries no such body and is never obeyed. */
  var DEAD_CODES = { 401: 'invalid_link', 403: 'wrong_product' };
  function isOurDeadCredential(status, answer) {
    var want = DEAD_CODES[status];
    return typeof want === 'string' && isObj(answer.body) && answer.body.error === want;
  }

  function withFailure(c, now) {
    var held = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) held[k] = c[k];
    held.failedAt = now;
    return held;
  }

  function needsCheck(cacheIn, now) {
    var c = readCache(cacheIn);
    if (c === null) return false;
    if (typeof c.failedAt === 'number' && now - c.failedAt < RETRY_AFTER_FAILURE_MS) return false;
    if (typeof c.checkedAt !== 'number' || !isFinite(c.checkedAt)) return true;
    return now - c.checkedAt > CHECK_INTERVAL_MS;
  }

  /* Only the listed keys, only strings; anything else throws, so a caller that
     tried to send a tab url learns it here rather than in a store review. */
  function pick(obj) {
    var out = {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (KEYS.indexOf(k) < 0) throw new Error('entitlement-client: "' + k + '" may not leave the device');
      if (typeof obj[k] !== 'string') throw new Error('entitlement-client: "' + k + '" must be a string');
      out[k] = obj[k];
    }
    return out;
  }

  /* The one builder every request goes through. Exposed so the sim can hand it
     what no public entry would — a fourth path, a tab url — and watch it throw. */
  function buildRequest(method, path, opts) {
    if (PATHS.indexOf(path) < 0) throw new Error('entitlement-client: ' + path + ' is not one of the three paths');
    var o = opts || {};
    return {
      method: method,
      path: path,
      bearer: typeof o.bearer === 'string' ? o.bearer : null,
      query: o.query ? pick(o.query) : null,
      body: o.body ? pick(o.body) : null
    };
  }

  function request(transport, method, path, opts) {
    return transport(buildRequest(method, path, opts));
  }

  /* ── sign-in (design §3.2) ─────────────────────────────────────────── */

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* A PKCE pair and a state from the tool's crypto: 32 random bytes each
     (a 43-character verifier), challenge = base64url(SHA-256(verifier)). */
  function newFlow(cryptoImpl) {
    var verifier = b64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
    var state = b64url(cryptoImpl.getRandomValues(new Uint8Array(16)));
    return cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (d) {
      return { verifier: verifier, state: state, challenge: b64url(new Uint8Array(d)) };
    });
  }

  function authUrl(product, channel, redirectUri, flow) {
    if (CHANNELS.indexOf(channel) < 0) throw new Error('entitlement-client: unknown channel ' + channel);
    var q = new URLSearchParams({
      product: product,
      channel: channel,
      redirect_uri: redirectUri,
      code_challenge: flow.challenge,
      state: flow.state
    });
    return CONNECT_PAGE + '?' + q.toString();
  }

  /* The code from the URL the browser's auth window returned, or null. The
     window must have come back to OUR redirect, carrying OUR state. */
  function codeFrom(returnedUrl, redirectUri, state) {
    var u, r;
    try { u = new URL(returnedUrl); r = new URL(redirectUri); } catch (_) { return null; }
    if (u.origin !== r.origin || u.pathname !== r.pathname) return null;
    if (u.searchParams.get('state') !== state) return null;
    var code = u.searchParams.get('code');
    return code !== null && /^[A-Za-z0-9_-]{22}$/.test(code) ? code : null;
  }

  /* ── the client a tool adopts ─────────────────────────────────────── */

  function createClient(opts) {
    var transport = opts.transport;
    var store = opts.store;
    var product = opts.product;
    var clock = opts.now || function () { return Date.now(); };
    var inFlight = null;

    function load() {
      return store.get(CACHE_KEY).then(function (got) { return readCache(got && got[CACHE_KEY]); });
    }
    function save(c) {
      if (c === null) return store.remove(CACHE_KEY);
      var o = {}; o[CACHE_KEY] = c;
      return store.set(o);
    }

    function exchange(code, verifier, redirectUri) {
      return request(transport, 'POST', '/v1/ext/token', {
        body: { code: code, code_verifier: verifier, redirect_uri: redirectUri }
      }).then(function (res) {
        if (!res || res.status !== 200 || !isObj(res.body) || typeof res.body.token !== 'string') return false;
        var c = { v: CACHE_VERSION, token: res.body.token, linkId: String(res.body.link_id || ''), isPro: false, paidThrough: '', checkedAt: null, failedAt: null };
        return save(c).then(function () { return check(true); }).then(function () { return true; });
      });
    }

    /* One check at a time; `force` skips the daily interval (sign-in). */
    function check(force) {
      if (inFlight) return inFlight;
      inFlight = load().then(function (c) {
        var now = clock();
        if (c === null) return { effect: 'signed_out', pro: false };
        if (!force && !needsCheck(c, now)) return { effect: 'cached', pro: isPro(c, now) };
        var ask;
        try {
          ask = request(transport, 'GET', '/v1/entitlements', { bearer: c.token, query: { app_id: product } });
        } catch (e) {
          return Promise.reject(e);
        }
        return Promise.resolve(ask).then(function (res) { return res; }, function () { return { status: 0 }; })
          .then(function (res) {
            var r = applyAnswer(c, res, clock());
            return save(r.cache).then(function () { return { effect: r.effect, pro: isPro(r.cache, clock()) }; });
          });
      });
      var done = function () { inFlight = null; };
      inFlight.then(done, done);
      return inFlight;
    }

    /* Sign-out deletes locally FIRST, so it always succeeds; the server revoke
       is best-effort and its failure changes nothing here. */
    function signOut() {
      return load().then(function (c) {
        return save(null).then(function () {
          if (c === null) return { revoked: false };
          return Promise.resolve()
            .then(function () { return request(transport, 'POST', '/v1/ext/revoke', { bearer: c.token }); })
            .then(function (res) { return { revoked: !!res && res.status === 200 }; }, function () { return { revoked: false }; });
        });
      });
    }

    function status() {
      return load().then(function (c) { return { signedIn: c !== null, pro: isPro(c, clock()) }; });
    }

    return { exchange: exchange, check: check, signOut: signOut, status: status };
  }

  root.SKENT = {
    OFFLINE_CEILING_MS: OFFLINE_CEILING_MS,
    CHECK_INTERVAL_MS: CHECK_INTERVAL_MS,
    RETRY_AFTER_FAILURE_MS: RETRY_AFTER_FAILURE_MS,
    CACHE_KEY: CACHE_KEY,
    CONNECT_PAGE: CONNECT_PAGE,
    PATHS: PATHS.slice(),
    KEYS: KEYS.slice(),
    isPro: isPro,
    applyAnswer: applyAnswer,
    needsCheck: needsCheck,
    paidThroughOf: paidThroughOf,
    buildRequest: buildRequest,
    newFlow: newFlow,
    authUrl: authUrl,
    codeFrom: codeFrom,
    createClient: createClient
  };
})(typeof self !== 'undefined' ? self : globalThis);
