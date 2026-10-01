// ─────────────────────────────────────────────────────────────────────────────
// ext-connect-dom.test.mjs — the /ext/connect PAGE, driven through its DOM
// (⏱ 2026-10-01, the #1077 review follow-up).
//
// ext-connect.test.mjs grades the page's pure functions. This file grades what
// the page DOES with them, which nothing graded: which section shows, what the
// status line says, and where the browser is sent. The module is the shipped
// sites/nikatru/ext/connect.js, copied beside a STUB of ../js/signin.js (so no
// sign-in reaches a network) and loaded under a minimal fake document built from
// the ids connect.html really carries — an id the module reads that the page
// does not carry fails here before it fails in a browser.
//
//   · a refused mint (401 link_needs_fresh_signin: the session STARTED before the
//     account's last reset) drops the session, shows the sign-in form again and
//     says to sign in again — and navigates nowhere;
//   · a minted code navigates to the SERVER's redirect_uri, never the query's;
//   · an unusable request shows only the bad-request block.
//
// 🔴 Red control, in this file: the same page with its navigation built from the
// QUERY's redirect_uri must fail the "server's value" case.
//
// Run:  node --test tooling/ci/test/ext-connect-dom.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE_JS = readFileSync(join(ROOT, 'sites/nikatru/ext/connect.js'), 'utf8');
const PAGE_HTML = readFileSync(join(ROOT, 'sites/nikatru/ext/connect.html'), 'utf8');

/** Every element id connect.html carries inside <main>, with whether it starts `hidden`. */
const PAGE_IDS = (() => {
  const main = PAGE_HTML.slice(PAGE_HTML.indexOf('<main'));
  const ids = new Map();
  for (const m of main.matchAll(/<(\w+)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    ids.set(m[3], { tag: m[1], hidden: /\shidden(?:\s|$|>|=)/.test(` ${m[2]} ${m[4]} `) });
  }
  return ids;
})();

const CHALLENGE = 'a'.repeat(43);
const QUERY = `?product=fullshot&channel=amo&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${CHALLENGE}&state=s-1`;
const SERVER_REDIRECT = 'https://abcdef.extensions.allizom.org/';

/** A fake element: what connect.js touches and nothing else. */
function element(id, hidden) {
  const listeners = new Map();
  return {
    id, hidden, textContent: '', value: '', disabled: false, focused: false,
    focus() { this.focused = true; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    async fire(type) { await listeners.get(type)?.({ preventDefault() {} }); },
  };
}

/** Load a fresh copy of the page module ([pageJs]) under a fake document; answer the page's handles. */
async function loadPage({ search = QUERY, pageJs = PAGE_JS, mint } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ext-connect-dom-'));
  mkdirSync(join(dir, 'ext'));
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'ext', 'connect.js'), pageJs);
  writeFileSync(join(dir, 'js', 'signin.js'), [
    "export async function signInWithPassword(email, password) { if (password !== 'right') throw new Error('credentials'); return { access_token: 'at-1' }; }",
    'export async function startAppleSignIn() {}',
    'export async function completeAppleSignIn() { throw new Error("no apple here"); }',
    'export function hasPendingAppleSignIn() { return false; }',
    '',
  ].join('\n'));
  const els = new Map([...PAGE_IDS].map(([id, { hidden }]) => [id, element(id, hidden)]));
  const assigned = [];
  const fetches = [];
  const fakes = {
    document: {
      getElementById(id) {
        if (!els.has(id)) throw new Error(`connect.js reads #${id}, which connect.html does not carry`);
        return els.get(id);
      },
    },
    location: { search, origin: 'https://nikatru.com', pathname: '/ext/connect', assign: (u) => assigned.push(u) },
    history: { replaceState() {} },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return mint();
    },
  };
  // The fakes stand in for the browser's globals while the page loads and while each of
  // its handlers runs (the handlers read `document` when they fire), and nowhere else.
  const withFakes = async (fn) => {
    const saved = Object.fromEntries(Object.keys(fakes).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    for (const [k, v] of Object.entries(fakes)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    try {
      return await fn();
    } finally {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    }
  };
  await withFakes(() => import(`${pathToFileURL(join(dir, 'ext', 'connect.js')).href}?t=${Date.now()}-${Math.random()}`));
  const shown = (id) => !els.get(id).hidden;
  const fire = (id, type) => withFakes(() => els.get(id).fire(type));
  return { els, shown, fire, assigned, fetches, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('/ext/connect — the page, through its DOM', () => {
  test('the page carries every id the module reads (the fake document refuses any other)', () => {
    for (const id of ['bad-request', 'connect-flow', 'product-name', 'channel-name', 'signin', 'signin-form', 'email', 'password', 'apple', 'consent', 'connect', 'cancel', 'status']) {
      assert.ok(PAGE_IDS.has(id), `connect.html has no #${id}`);
    }
  });

  test('a usable request shows the sign-in form first, with the product and the channel named', async () => {
    const p = await loadPage({ mint: () => json(500, {}) });
    try {
      assert.ok(p.shown('connect-flow') && p.shown('signin'));
      assert.ok(!p.shown('consent') && !p.shown('bad-request'));
      assert.equal(p.els.get('product-name').textContent, 'FullShot');
      assert.equal(p.els.get('channel-name').textContent, 'Firefox (Firefox Add-ons)');
      p.els.get('email').value = 'a@b.example';
      p.els.get('password').value = 'right';
      await p.fire('signin-form', 'submit');
      assert.ok(p.shown('consent') && !p.shown('signin'), 'signed in: the consent section replaces the form');
      assert.equal(p.els.get('password').value, '', 'the password field is cleared after sign-in');
    } finally { p.cleanup(); }
  });

  test('🔴 a mint refused because the session STARTED before the reset: back to the sign-in form, told to sign in again, no navigation', async () => {
    const p = await loadPage({ mint: () => json(401, { error: 'link_needs_fresh_signin' }) });
    try {
      p.els.get('password').value = 'right';
      await p.fire('signin-form', 'submit');
      await p.fire('connect', 'click');
      assert.equal(p.fetches.length, 1);
      assert.equal(p.fetches[0].init.headers.Authorization, 'Bearer at-1');
      assert.equal(p.els.get('status').textContent, 'For your security, sign in again to connect this browser.');
      assert.ok(p.shown('signin') && !p.shown('consent'), 'the dropped session shows the sign-in form again');
      assert.equal(p.els.get('connect').disabled, false);
      assert.deepEqual(p.assigned, []);
      // A second Connect without a new sign-in sends nothing: the session is gone.
      await p.fire('connect', 'click');
      assert.equal(p.fetches.length, 1);
    } finally { p.cleanup(); }
  });

  test('🔴 a minted code navigates to the SERVER\'s redirect_uri with the code and the state — never the query\'s', async () => {
    const p = await loadPage({ mint: () => json(200, { redirect_uri: SERVER_REDIRECT, code: 'c-1' }) });
    try {
      p.els.get('password').value = 'right';
      await p.fire('signin-form', 'submit');
      await p.fire('connect', 'click');
      assert.deepEqual(p.assigned, [`${SERVER_REDIRECT}?code=c-1&state=s-1`]);
      assert.equal(p.els.get('status').textContent, 'Connected. Returning you to the extension…');
    } finally { p.cleanup(); }
  });

  test('🔴 RED CONTROL: the same page navigating by the QUERY\'s redirect_uri is caught by the case above', async () => {
    const anchor = 'const to = res && res.ok && body ? returnUrl(body.redirect_uri, body.code, request.state) : null;';
    assert.ok(PAGE_JS.includes(anchor), 'the navigation line moved — this red control no longer reaches it');
    const p = await loadPage({
      pageJs: PAGE_JS.replace(anchor, anchor.replace('body.redirect_uri', 'request.redirect_uri')),
      mint: () => json(200, { redirect_uri: SERVER_REDIRECT, code: 'c-1' }),
    });
    try {
      p.els.get('password').value = 'right';
      await p.fire('signin-form', 'submit');
      await p.fire('connect', 'click');
      assert.notDeepEqual(p.assigned, [`${SERVER_REDIRECT}?code=c-1&state=s-1`]);
    } finally { p.cleanup(); }
  });

  test('an unusable request shows only the bad-request block', async () => {
    const p = await loadPage({ search: '?product=unknown&channel=amo', mint: () => json(500, {}) });
    try {
      assert.ok(p.shown('bad-request'));
      assert.ok(!p.shown('connect-flow'));
    } finally { p.cleanup(); }
  });

  test('Cancel drops the session and says nothing was connected', async () => {
    const p = await loadPage({ mint: () => json(500, {}) });
    try {
      p.els.get('password').value = 'right';
      await p.fire('signin-form', 'submit');
      await p.fire('cancel', 'click');
      assert.ok(p.shown('signin') && !p.shown('consent'));
      assert.equal(p.els.get('status').textContent, 'Nothing was connected. You can close this tab.');
    } finally { p.cleanup(); }
  });
});
