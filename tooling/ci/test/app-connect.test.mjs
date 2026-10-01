// ─────────────────────────────────────────────────────────────────────────────
// app-connect.test.mjs — the pure functions that keep sites/nikatru/app/
// connect.js (the desktop app's system-browser sign-in, ⏱ 2026-10-01,
// O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH) from being an open redirect.
//
// The page navigates exactly once with a one-time code. Each rule below is the
// shape of a way that navigation could leak it:
//   · returnUrl builds the redirect ONLY from the server's value, and only when
//     that value is the app's own loopback or deep link — https, localhost, a
//     privileged port, another app's scheme, javascript: are all refused;
//   · no code, no navigation;
//   · the code rides as `nk_code` (never `code`, which supabase_flutter would try
//     to spend at GoTrue) and `state` goes back byte for byte;
//   · readRequest refuses an app, a return address, a method or a challenge the
//     page does not know, and a missing state.
//
// The page module is imported as it ships — its DOM half is behind
// `typeof document !== 'undefined'`, so node loads only the functions.
//
// Red control: a returnUrl that skips isReturnAddress → the "refuses" case fails.
//
// Run:  node --test tooling/ci/test/app-connect.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { returnUrl, readRequest, mintFailure, isReturnAddress, mintUrl } = await import(
  pathToFileURL(resolve(ROOT, 'sites/nikatru/app/connect.js')).href
);

const APP = 'subscriptiontracker';
const LOOP = 'http://127.0.0.1:53111/nk-auth-callback';
const DEEP = `com.nikatru.${APP}://auth-callback?nk_auth=handoff`;
const CODE = 'h1.AbCdEfGhIjKlMnOp.QrStUvWxYz0123456789abcdefghijklmnopqrstuvwxyzAB';
const CHALLENGE = 'ZHSMcMAgn7z81MHS2ETyNlj3jbpen2MOzQvb_vo-ba8';

describe('returnUrl — the one navigation that carries a code', () => {
  test('the loopback gets nk_code and the state, and nothing else changes', () => {
    const u = new URL(returnUrl(APP, LOOP, CODE, 'st-1'));
    assert.equal(`${u.origin}${u.pathname}`, 'http://127.0.0.1:53111/nk-auth-callback');
    assert.deepEqual([...u.searchParams], [['nk_code', CODE], ['state', 'st-1']]);
  });

  test('the deep link keeps its marker and gets nk_code and the state after it', () => {
    assert.equal(returnUrl(APP, DEEP, CODE, 'st-1'), `${DEEP}&nk_code=${encodeURIComponent(CODE)}&state=st-1`);
  });

  test('refuses every address that is not the app\'s own return', () => {
    for (const bad of [
      'https://evil.example/nk-auth-callback',
      'http://localhost:53111/nk-auth-callback',
      'http://127.0.0.1:80/nk-auth-callback',
      'http://127.0.0.1:53111/other',
      `${LOOP}?x=1`,
      'com.nikatru.budgetbuddy://auth-callback?nk_auth=handoff',
      `com.nikatru.${APP}://auth-callback?nk_auth=oauth`,
      'javascript:alert(1)',
      '',
      null,
    ]) {
      assert.equal(returnUrl(APP, bad, CODE, 'st'), null, String(bad));
    }
  });

  test('no code, no navigation', () => {
    assert.equal(returnUrl(APP, LOOP, '', 'st'), null);
    assert.equal(returnUrl(APP, LOOP, undefined, 'st'), null);
  });

  test('the return-address rule is the server\'s (lib/native-attest/handoff.ts isHandoffRedirect)', () => {
    assert.equal(isReturnAddress(APP, LOOP), true);
    assert.equal(isReturnAddress(APP, DEEP), true);
    assert.equal(isReturnAddress(APP, 'http://127.0.0.1:65536/nk-auth-callback'), false);
    assert.equal(isReturnAddress(APP, 'http://127.0.0.1:053111/nk-auth-callback'), false);
    // ⏱ 2026-10-02 (review of #1133, finding 5): 1000-1023 are the only ports the
    // 4-5 digit pattern lets through to the `port >= 1024` limb.
    assert.equal(isReturnAddress(APP, 'http://127.0.0.1:1023/nk-auth-callback'), false);
    assert.equal(isReturnAddress(APP, 'http://127.0.0.1:1024/nk-auth-callback'), true);
  });
});

describe('readRequest — what the page agrees to show', () => {
  const ok = { app: APP, redirect_uri: LOOP, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'st' };
  const q = (o) => `?${new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined)).toString()}`;

  test('a well-formed request is read', () => {
    assert.deepEqual(readRequest(q(ok)), ok);
  });

  test('refuses an unknown app, a foreign return, plain, a bad challenge, a missing state', () => {
    for (const over of [
      { app: 'nosuchapp' },
      { redirect_uri: 'https://evil.example/' },
      { code_challenge_method: 'plain' },
      { code_challenge: 'short' },
      { state: undefined },
    ]) {
      assert.equal(readRequest(q({ ...ok, ...over })), null, JSON.stringify(over));
    }
  });
});

describe('mintFailure', () => {
  test('a stale web session is told to sign in again', () => {
    assert.equal(mintFailure(401, { error: 'handoff_needs_fresh_signin' }).signInAgain, true);
    assert.equal(mintFailure(400, { error: 'redirect_uri_mismatch' }).signInAgain, false);
    assert.equal(mintFailure(0, null).signInAgain, false);
  });
});

describe('mintUrl — the URL the bearer token is POSTed to', () => {
  // ⏱ 2026-10-01 · CodeQL js/client-side-request-forgery (#550 on #1133): the URL
  // was a template over the address bar's `app`. It is now a constant per app.
  test('a served app gets its constant mint URL', () => {
    assert.equal(mintUrl(APP), `https://platform.nikatru.com/v1/auth/handoff/${APP}/code`);
  });

  test('🔴 an app id the page does not serve, or one carrying a path, gets no URL', () => {
    assert.equal(mintUrl('otherapp'), null);
    assert.equal(mintUrl(`${APP}/../../v1/ext/codes`), null);
    assert.equal(mintUrl('__proto__'), null);
    assert.equal(mintUrl(null), null);
  });
});
