#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/entitlement-client.node.js — the sim for core/v1/entitlement-client.js.

   Loads the REAL shipped bytes on bare Node (H.loadCore) and grades the Pro
   decision every adopting extension will run. The rows below are design §3.3's
   table, one check per row, under a fake clock. Round-2 finding EXM-03 names
   three red controls, and each is a TEETH section at the bottom: the check
   above it goes red when the line it depends on is broken.

     is_pro:false  → Pro dropped at the same tick   (mutant: keeps the old Pro)
     401           → credential and cache deleted    (mutant: holds them)
     outage        → Pro held for at most 7 days     (mutant: no ceiling)

   Plus the fail-closed expiry (mutant: an unparseable paid-through reads as
   lifetime) and the request allow-list (mutant: any key may leave).

   Run: node core/test/entitlement-client.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, note } = H;

const MODULE = 'v1/entitlement-client.js';
const SRC = H.readCore(MODULE);
const DAY = 86400000;
const T = Date.parse('2026-09-30T12:00:00.000Z');

function boot(source) {
  const sandbox = H.loadCore(MODULE, { URLSearchParams, btoa, crypto: globalThis.crypto }, { source });
  return sandbox.SKENT;
}

const cache = (o) => Object.assign({ v: 1, token: 'nkx1_' + 'A'.repeat(43), linkId: 'l-1', isPro: true, paidThrough: null, checkedAt: T, failedAt: null }, o || {});

/* A fake storage.local area and a recording transport. */
function area(seed) {
  const data = Object.assign({}, seed || {});
  return {
    data,
    async get(k) { return Object.prototype.hasOwnProperty.call(data, k) ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {}; },
    async set(o) { Object.assign(data, JSON.parse(JSON.stringify(o))); },
    async remove(k) { delete data[k]; }
  };
}
function transport(answers) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const a = answers[req.path];
    if (typeof a === 'function') return a(req);
    if (a instanceof Error) throw a;
    return a;
  };
  fn.calls = calls;
  return fn;
}

async function main() {
  /* ---------------------------------------------------------------- */
  section('it loads at all, on bare Node, from the shipped bytes');
  /* ---------------------------------------------------------------- */
  const E = boot();
  check('SKENT is attached to the global', !!E);
  check('it exposes the decision, the flow and the client',
    ['isPro', 'applyAnswer', 'needsCheck', 'paidThroughOf', 'newFlow', 'authUrl', 'codeFrom', 'createClient'].every((n) => typeof E[n] === 'function'));

  /* ---------------------------------------------------------------- */
  section('CORE-POLICY §1.3 — shared code makes no network call, ever');
  /* ---------------------------------------------------------------- */
  {
    const banned = ['fetch(', 'fetch ', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'RTCPeerConnection', 'SharedWorker', 'importScripts'];
    const hits = banned.filter((b) => SRC.indexOf(b) >= 0);
    check('no network API name appears anywhere in the shipped source', hits.length === 0, hits.join(', '));
    check('nothing is scheduled at load', !/\bset(Timeout|Interval)\s*\(/.test(SRC));
    check('the credential is never put in storage.sync', SRC.indexOf('storage.sync') < 0 || /Never\s+storage\.sync/.test(SRC));
  }

  /* ---------------------------------------------------------------- */
  section('isPro — design §3.3, every row, fail-closed');
  /* ---------------------------------------------------------------- */
  {
    check('signed out (no cache) → false', E.isPro(null, T) === false);
    check('a cache of another version → false', E.isPro(cache({ v: 2 }), T) === false);
    check('no token → false', E.isPro(cache({ token: '' }), T) === false);
    check('isPro false → false', E.isPro(cache({ isPro: false }), T) === false);
    check('lifetime (paidThrough null), checked now → true', E.isPro(cache(), T) === true);
    check('checked exactly 7 days ago → true', E.isPro(cache(), T + 7 * DAY) === true);
    check('checked 7 days and 1 ms ago → false (the offline ceiling)', E.isPro(cache(), T + 7 * DAY + 1) === false);
    check('checkedAt more than 5 minutes in the future → false', E.isPro(cache({ checkedAt: T + 5 * 60000 + 1 }), T) === false);
    check('checkedAt 5 minutes in the future → true (clock skew)', E.isPro(cache({ checkedAt: T + 5 * 60000 }), T) === true);
    check('checkedAt not a number → false', E.isPro(cache({ checkedAt: '2026' }), T) === false && E.isPro(cache({ checkedAt: null }), T) === false);
    const until = new Date(T + DAY).toISOString();
    check('paid through tomorrow → true', E.isPro(cache({ paidThrough: until }), T) === true);
    check('at the paid-through instant → false', E.isPro(cache({ paidThrough: until }), T + DAY) === false);
    check('an unparseable paid-through → false (undecidable is not lifetime)', E.isPro(cache({ paidThrough: 'soon' }), T) === false);
    check('an empty paid-through (no active grant) → false', E.isPro(cache({ paidThrough: '' }), T) === false);
  }

  /* ---------------------------------------------------------------- */
  section('paidThroughOf — the latest end among ACTIVE grants and the bundle');
  /* ---------------------------------------------------------------- */
  {
    const a = '2026-10-01T00:00:00.000Z';
    const b = '2026-11-01T00:00:00.000Z';
    check('the later of two active ends', E.paidThroughOf({ entitlements: [{ is_active: true, expires_at: a }, { is_active: true, expires_at: b }] }) === b);
    check('an inactive row does not count', E.paidThroughOf({ entitlements: [{ is_active: false, expires_at: b }, { is_active: true, expires_at: a }] }) === a);
    check('any active lifetime grant → null', E.paidThroughOf({ entitlements: [{ is_active: true, expires_at: a }, { is_active: true, expires_at: null }] }) === null);
    check('the bundle block joins the maximum', E.paidThroughOf({ entitlements: [{ is_active: true, expires_at: a }], bundle: { expires_at: b } }) === b);
    check('an unparseable end is carried through, so isPro refuses it', E.paidThroughOf({ entitlements: [{ is_active: true, expires_at: 'x' }] }) === 'x');
    check('no active grant → "" (not a date)', E.paidThroughOf({ entitlements: [] }) === '');
  }

  /* ---------------------------------------------------------------- */
  section('applyAnswer — what one answer to GET /v1/entitlements does');
  /* ---------------------------------------------------------------- */
  {
    const later = T + 3 * DAY;
    const up = E.applyAnswer(cache({ checkedAt: T }), { status: 200, body: { is_pro: true, entitlements: [{ is_active: true, expires_at: null }] } }, later);
    check('200 is_pro:true → cache refreshed at the new instant', up.effect === 'updated' && up.cache.checkedAt === later && E.isPro(up.cache, later));
    const refund = E.applyAnswer(cache(), { status: 200, body: { is_pro: false, entitlements: [] } }, later);
    check('🔴 200 is_pro:false → Pro DROPPED on the same tick', refund.effect === 'dropped' && E.isPro(refund.cache, later) === false, JSON.stringify(refund));
    check('...and the credential is kept (still signed in)', refund.cache !== null && refund.cache.token === cache().token);
    const dead = E.applyAnswer(cache(), { status: 401, body: { error: 'unauthorized' } }, later);
    check('🔴 401 → credential AND cache deleted', dead.effect === 'signed_out' && dead.cache === null);
    const wrong = E.applyAnswer(cache(), { status: 403, body: { error: 'wrong_product' } }, later);
    check('403 → credential and cache deleted', wrong.cache === null);
    for (const status of [404, 429, 500, 503, 0]) {
      const r = E.applyAnswer(cache(), { status }, later);
      check(`${status} → held: the cache keeps its answer and its checkedAt`, r.effect === 'held' && r.cache.checkedAt === T && r.cache.isPro === true);
    }
    const outage = E.applyAnswer(cache(), { status: 503 }, T + 6 * DAY);
    check('🔴 an outage 6 days in: Pro still held', E.isPro(outage.cache, T + 6 * DAY) === true);
    check('🔴 ...and gone past the 7-day ceiling, however long the outage', E.isPro(outage.cache, T + 7 * DAY + 1) === false);
    check('a 200 whose body has no boolean is_pro is held, never read as true', E.applyAnswer(cache({ isPro: false }), { status: 200, body: { is_pro: 'yes' } }, later).cache.isPro === false);
  }

  /* ---------------------------------------------------------------- */
  section('needsCheck — on demand, daily, never without a credential');
  /* ---------------------------------------------------------------- */
  {
    check('no credential → never', E.needsCheck(null, T) === false);
    check('checked 23 h ago → no', E.needsCheck(cache(), T + 23 * 3600000) === false);
    check('checked 25 h ago → yes', E.needsCheck(cache(), T + 25 * 3600000) === true);
    check('a failure 30 min ago → not yet, even if stale', E.needsCheck(cache({ checkedAt: T - 3 * DAY, failedAt: T - 30 * 60000 }), T) === false);
    check('a failure 61 min ago → yes', E.needsCheck(cache({ checkedAt: T - 3 * DAY, failedAt: T - 61 * 60000 }), T) === true);
    check('never checked (just linked) → yes', E.needsCheck(cache({ checkedAt: null }), T) === true);
  }

  /* ---------------------------------------------------------------- */
  section('what a request may carry — three paths, four keys, nothing else');
  /* ---------------------------------------------------------------- */
  {
    const store = area({ [E.CACHE_KEY]: cache({ checkedAt: T - 2 * DAY }) });
    const tp = transport({ '/v1/entitlements': { status: 200, body: { is_pro: true, entitlements: [{ is_active: true, expires_at: null }] } } });
    const c = E.createClient({ transport: tp, store, product: 'fullshot', now: () => T });
    const r = await c.check();
    check('a stale cache is checked once', tp.calls.length === 1 && r.effect === 'updated' && r.pro === true, JSON.stringify(r));
    const req = tp.calls[0];
    check('GET /v1/entitlements with the credential as the bearer', req.method === 'GET' && req.path === '/v1/entitlements' && req.bearer === cache().token);
    check('the query is exactly {app_id}', JSON.stringify(req.query) === JSON.stringify({ app_id: 'fullshot' }) && req.body === null);
    check('every recorded path is one of the three', tp.calls.every((x) => E.PATHS.indexOf(x.path) >= 0));
    const fresh = await c.check();
    check('a fresh cache is NOT checked again the same day', tp.calls.length === 1 && fresh.effect === 'cached' && fresh.pro === true);
  }

  {
    const throws = (fn) => { try { fn(); return false; } catch (_) { return true; } };
    check('🔴 a tab url in the query throws — it may not leave the device',
      throws(() => E.buildRequest('GET', '/v1/entitlements', { query: { app_id: 'fullshot', url: 'https://bank.example/statement' } })));
    check('a title in the body throws', throws(() => E.buildRequest('POST', '/v1/ext/token', { body: { code: 'c', title: 'Inbox' } })));
    check('a non-string value throws', throws(() => E.buildRequest('GET', '/v1/entitlements', { query: { app_id: 7 } })));
    check('a fourth path throws', throws(() => E.buildRequest('GET', '/v1/account', {})));
    check('the four keys and three paths themselves build',
      !throws(() => E.buildRequest('POST', '/v1/ext/token', { body: { code: 'c', code_verifier: 'v', redirect_uri: 'r' } })) &&
      !throws(() => E.buildRequest('GET', '/v1/entitlements', { query: { app_id: 'fullshot' } })) &&
      !throws(() => E.buildRequest('POST', '/v1/ext/revoke', { bearer: 't' })));
  }

  /* ---------------------------------------------------------------- */
  section('the client — sign-in exchange, revocation, sign-out');
  /* ---------------------------------------------------------------- */
  {
    const store = area();
    const tp = transport({
      '/v1/ext/token': { status: 200, body: { token: 'nkx1_' + 'B'.repeat(43), link_id: 'l-2' } },
      '/v1/entitlements': { status: 200, body: { is_pro: true, entitlements: [{ is_active: true, expires_at: null }] } },
      '/v1/ext/revoke': new Error('offline')
    });
    const c = E.createClient({ transport: tp, store, product: 'fullshot', now: () => T });
    check('signed out → no network at all', (await c.status()).signedIn === false && tp.calls.length === 0);
    check('a check with no credential makes no call', (await c.check()).effect === 'signed_out' && tp.calls.length === 0);
    const ok = await c.exchange('C'.repeat(22), 'v'.repeat(43), 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/');
    check('exchange stores the credential and runs the first check', ok === true && (await c.status()).pro === true);
    check('the exchange body is exactly {code, code_verifier, redirect_uri}',
      Object.keys(tp.calls[0].body).sort().join(',') === 'code,code_verifier,redirect_uri');
    const out = await c.signOut();
    check('sign-out deletes locally even when the revoke cannot reach the server',
      out.revoked === false && store.data[E.CACHE_KEY] === undefined && (await c.status()).signedIn === false);

    const store2 = area({ [E.CACHE_KEY]: cache({ checkedAt: T - 2 * DAY }) });
    const tp2 = transport({ '/v1/entitlements': { status: 401, body: { error: 'unauthorized' } } });
    const c2 = E.createClient({ transport: tp2, store: store2, product: 'fullshot', now: () => T });
    const r2 = await c2.check();
    check('🔴 a revoked credential (401) signs the device out and deletes the cache',
      r2.effect === 'signed_out' && store2.data[E.CACHE_KEY] === undefined);

    const store3 = area({ [E.CACHE_KEY]: cache({ checkedAt: T - 2 * DAY }) });
    const tp3 = transport({ '/v1/entitlements': new Error('network down') });
    const c3 = E.createClient({ transport: tp3, store: store3, product: 'fullshot', now: () => T });
    const r3 = await c3.check();
    check('a rejected call is an outage: Pro held, the failure stamped', r3.effect === 'held' && r3.pro === true && store3.data[E.CACHE_KEY].failedAt === T);

    let resolve;
    const slow = transport({ '/v1/entitlements': () => new Promise((r) => { resolve = r; }) });
    const store4 = area({ [E.CACHE_KEY]: cache({ checkedAt: T - 2 * DAY }) });
    const c4 = E.createClient({ transport: slow, store: store4, product: 'fullshot', now: () => T });
    const p1 = c4.check();
    const p2 = c4.check();
    await new Promise((r) => setTimeout(r, 0));
    resolve({ status: 200, body: { is_pro: true, entitlements: [] } });
    await Promise.all([p1, p2]);
    check('at most one check is in flight', slow.calls.length === 1, slow.calls.length);
  }

  /* ---------------------------------------------------------------- */
  section('the sign-in URL and the returned code');
  /* ---------------------------------------------------------------- */
  {
    const flow = await E.newFlow(globalThis.crypto);
    check('a 43-character verifier and challenge', /^[A-Za-z0-9_-]{43}$/.test(flow.verifier) && /^[A-Za-z0-9_-]{43}$/.test(flow.challenge));
    const redirect = 'https://0123456789abcdef0123456789abcdef01234567.extensions.allizom.org/';
    const u = new URL(E.authUrl('fullshot', 'amo', redirect, flow));
    check('the auth URL is the connect page', u.origin + u.pathname === E.CONNECT_PAGE);
    check('it carries exactly product, channel, redirect_uri, code_challenge and state',
      [...u.searchParams.keys()].sort().join(',') === 'channel,code_challenge,product,redirect_uri,state');
    check('an unknown channel throws', (() => { try { E.authUrl('fullshot', 'safari', redirect, flow); return false; } catch (_) { return true; } })());
    const code = 'D'.repeat(22);
    check('our redirect with our state → the code', E.codeFrom(`${redirect}?code=${code}&state=${flow.state}`, redirect, flow.state) === code);
    check('another state → null', E.codeFrom(`${redirect}?code=${code}&state=other`, redirect, flow.state) === null);
    check('another host → null', E.codeFrom(`https://evil.example/?code=${code}&state=${flow.state}`, redirect, flow.state) === null);
    check('a malformed code → null', E.codeFrom(`${redirect}?code=short&state=${flow.state}`, redirect, flow.state) === null);
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — each red control above depends on the line it names');
  /* ---------------------------------------------------------------- */
  {
    const later = T + 3 * DAY;
    const M1 = boot(H.mutate(SRC, "paidThrough: answer.body.is_pro ? paidThroughOf(answer.body) : '',", 'paidThrough: c.paidThrough,')
      .replace('isPro: answer.body.is_pro,', 'isPro: answer.body.is_pro || c.isPro,'));
    await H.expectBroken('is_pro:false keeps the old Pro → the "dropped on the same tick" check goes red', () => {
      const r = M1.applyAnswer(cache(), { status: 200, body: { is_pro: false, entitlements: [] } }, later);
      return M1.isPro(r.cache, later) === false;
    });
    const M2 = boot(H.mutate(SRC, "if (status === 401 || status === 403) return { cache: null, effect: 'signed_out' };", ''));
    await H.expectBroken('a 401 holds the credential → the "deleted" check goes red', () => {
      return M2.applyAnswer(cache(), { status: 401 }, later).cache === null;
    });
    const M3 = boot(H.mutate(SRC, 'if (now - c.checkedAt > OFFLINE_CEILING_MS) return false;', ''));
    await H.expectBroken('no offline ceiling → the "gone past 7 days" check goes red', () => {
      const r = M3.applyAnswer(cache(), { status: 503 }, T + 6 * DAY);
      return M3.isPro(r.cache, T + 7 * DAY + 1) === false;
    });
    const M4 = boot(H.mutate(SRC, 'if (!isFinite(until)) return false;', 'if (!isFinite(until)) return true;'));
    await H.expectBroken('an unparseable paid-through read as lifetime → the fail-closed check goes red', () => {
      return M4.isPro(cache({ paidThrough: 'soon' }), T) === false;
    });
    const M5 = boot(H.mutate(SRC, "if (KEYS.indexOf(k) < 0) throw new Error('entitlement-client: \"' + k + '\" may not leave the device');", ''));
    await H.expectBroken('any key may leave → the "tab url throws" check goes red', () => {
      try { M5.buildRequest('GET', '/v1/entitlements', { query: { app_id: 'fullshot', url: 'https://bank.example/statement' } }); return false; } catch (_) { return true; }
    });
  }

  process.exit(H.finish());
}

main().catch((e) => { console.error(e); process.exit(1); });
