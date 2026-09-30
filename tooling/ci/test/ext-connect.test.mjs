// ─────────────────────────────────────────────────────────────────────────────
// ext-connect.test.mjs — the two pure functions that keep sites/nikatru/ext/
// connect.js from being an open redirect (O-EXTENSION-ACCOUNT-CHECK-UNBUILT).
//
// ⏱ 2026-09-30 · EXA-06 (round-2 review). `returnUrl` and `readRequest` were
// exported for testing and never tested: nothing outside sites/nikatru/ext
// imported the page. They decide the one navigation that carries a one-time
// code, so each rule below is the shape of a way that navigation could leak it:
//   · returnUrl builds the redirect ONLY from the server's value, and only an
//     https one — an http:, javascript: or unparseable value is refused;
//   · no code, no navigation;
//   · `state` goes back byte for byte, and a `code`/`state` already on the
//     server's value cannot survive beside ours;
//   · readRequest refuses a product, channel or challenge the page does not know.
//
// The page module is imported as it ships — its DOM half is behind
// `typeof document !== 'undefined'`, so node loads only the functions.
//
// Red control: a returnUrl that accepts `http:` → the http case fails; a
// mintFailure that ignores the error code → the "sign in again" case fails.
//
// Run:  node --test tooling/ci/test/ext-connect.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { returnUrl, readRequest, mintFailure } = await import(pathToFileURL(resolve(ROOT, 'sites/nikatru/ext/connect.js')).href);

const CHROME = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('returnUrl — the one navigation that carries a code', () => {
  test('an https server value gets the code and the state, and nothing else changes', () => {
    const to = returnUrl(CHROME, CODE, 'st-1');
    const u = new URL(to);
    assert.equal(`${u.origin}${u.pathname}`, 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/');
    assert.equal(u.searchParams.get('code'), CODE);
    assert.equal(u.searchParams.get('state'), 'st-1');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['code', 'state']);
  });

  test('🔴 an http: server value is refused — the code never travels in clear', () => {
    assert.equal(returnUrl('http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/', CODE, 's'), null);
  });

  test('javascript:, data: and an unparseable value are refused', () => {
    assert.equal(returnUrl('javascript:alert(1)', CODE, 's'), null);
    assert.equal(returnUrl('data:text/html,hi', CODE, 's'), null);
    assert.equal(returnUrl('not a url', CODE, 's'), null);
    assert.equal(returnUrl(undefined, CODE, 's'), null);
  });

  test('🔴 an empty or missing code is refused — no navigation without one', () => {
    assert.equal(returnUrl(CHROME, '', 's'), null);
    assert.equal(returnUrl(CHROME, undefined, 's'), null);
    assert.equal(returnUrl(CHROME, 42, 's'), null);
  });

  test('state is passed through byte for byte, reserved characters included', () => {
    const state = 'a b&c=d/é?#';
    assert.equal(new URL(returnUrl(CHROME, CODE, state)).searchParams.get('state'), state);
  });

  test('no state in, no state out', () => {
    assert.equal(new URL(returnUrl(CHROME, CODE, null)).searchParams.has('state'), false);
  });

  test('a code or state already on the server value is REPLACED, never kept beside ours', () => {
    const u = new URL(returnUrl(`${CHROME}?code=planted&state=planted`, CODE, 'mine'));
    assert.deepEqual(u.searchParams.getAll('code'), [CODE]);
    assert.deepEqual(u.searchParams.getAll('state'), ['mine']);
  });
});

describe('mintFailure — what a refused mint tells the user (EXA-11 review 2)', () => {
  test('🔴 401 link_needs_fresh_signin → sign in again, back to the form', () => {
    const r = mintFailure(401, { error: 'link_needs_fresh_signin' });
    assert.equal(r.signInAgain, true);
    assert.match(r.message, /sign in again/);
  });

  test('any other failure → start again from the extension', () => {
    for (const [status, body] of [[401, { error: 'unauthorized' }], [400, { error: 'redirect_uri_mismatch' }], [503, null], [0, null], [401, null], [401, 'link_needs_fresh_signin']]) {
      const r = mintFailure(status, body);
      assert.equal(r.signInAgain, false, JSON.stringify([status, body]));
      assert.match(r.message, /start again from the extension/);
    }
  });
});

describe('readRequest — the extension request, validated for display', () => {
  const q = (o) => `?${new URLSearchParams(o).toString()}`;
  const ok = { product: 'fullshot', channel: 'amo', redirect_uri: CHROME, code_challenge: CHALLENGE, state: 'xyz' };

  test('a well-formed request parses to its five fields', () => {
    assert.deepEqual(readRequest(q(ok)), ok);
  });

  test('every one of the three channels is accepted, and nothing else', () => {
    for (const channel of ['chrome-webstore', 'edge-addons', 'amo']) assert.notEqual(readRequest(q({ ...ok, channel })), null);
    for (const channel of ['android-play', 'safari', '', 'constructor', '__proto__']) assert.equal(readRequest(q({ ...ok, channel })), null, channel);
  });

  test('an unknown product is refused, prototype names included', () => {
    for (const product of ['subscriptiontracker', '', 'toString', '__proto__']) assert.equal(readRequest(q({ ...ok, product })), null, product);
  });

  test('a missing redirect_uri is refused', () => {
    const { redirect_uri: _r, ...rest } = ok;
    assert.equal(readRequest(q(rest)), null);
    assert.equal(readRequest(q({ ...ok, redirect_uri: '' })), null);
  });

  test('a challenge that is not a 43-character S256 digest is refused', () => {
    for (const code_challenge of ['', CHALLENGE.slice(1), `${CHALLENGE}x`, `${CHALLENGE.slice(1)}+`]) {
      assert.equal(readRequest(q({ ...ok, code_challenge })), null, code_challenge);
    }
  });

  test('a state longer than 512 characters is refused; 512 is accepted; none is accepted', () => {
    assert.equal(readRequest(q({ ...ok, state: 'x'.repeat(513) })), null);
    assert.notEqual(readRequest(q({ ...ok, state: 'x'.repeat(512) })), null);
    const { state: _s, ...rest } = ok;
    assert.equal(readRequest(q(rest)).state, null);
  });
});
