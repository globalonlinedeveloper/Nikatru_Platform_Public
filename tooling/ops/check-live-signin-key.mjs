#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-live-signin-key.mjs — the sign-in script the LIVE site serves carries a
// publishable key the auth host still ACCEPTS.
//
// sites/nikatru/js/signin.js holds two constants every sign-in depends on:
// SUPABASE_URL (the self-hosted auth host) and SUPABASE_PUBLISHABLE_KEY, which
// every call sends in the `apikey` header. The key is public by design
// (.gitleaks.toml records why), so it lives in the file as a literal, and the
// file holds __SUPABASE_PUBLISHABLE_KEY__ until that literal is filled. What
// nothing watched is the pair drifting apart: a key rotated on the auth host
// leaves the site serving a key the gateway refuses, and every sign-in fails
// while every page still answers 200.
//
// So this reads what a BROWSER reads, in the order it reads it:
//   1. GET <apex>/js/signin.js — the script the live site serves today, not the
//      one in this checkout. The path is the file's place under sites/nikatru/.
//   2. Take SUPABASE_URL and the one `sb_publishable_` key out of that body.
//   3. GET <SUPABASE_URL>/auth/v1/settings with the key in `apikey` — the header
//      signin.js sends, and nothing else.
//
// THE ENDPOINT. `GET /auth/v1/settings` is GoTrue's public settings read
// (supabase/auth README, "GET /settings"; supabase/auth-js
// src/GoTrueClient.ts). It changes nothing, and the gateway in front of it
// checks `apikey` before GoTrue ever sees the request — which is the question
// here. Measured on the auth host 2026-09-25 00:40Z: 200 with the real key, 401
// with no key, 401 with a made-up `sb_publishable_` key. verify-auth-providers
// reads the same endpoint for a different question (which providers are on).
//
// 🔴 THE KEY IS NEVER PRINTED. Every line below names it as `sha8=<first 8 hex
// of sha256(key)>`. The value exists only in memory and in the one request
// header. The auth host is printed; it is public and is the thing to fix.
//
// Usage:  node tooling/ops/check-live-signin-key.mjs
//         node tooling/ops/check-live-signin-key.mjs --fixtures <file.json>
//   --fixtures answers every request from a JSON file keyed by URL:
//   {"<url>": {"status": 200, "body": "…", "apikeySha8": "…"}} or
//   {"<url>": {"fail": "reset"|"hang"}}.
//   It is the test seam; it prints a banner that must never appear in a real
//   ops-watch log.
//
// Exit 0 = the live script carries one publishable key and the auth host
//          answers 200 with GoTrue's settings for it.
// Exit 1 = a FINDING: the host refuses the key (401/403); the live script still
//          holds the placeholder; it carries no key, or several; it names no
//          auth host; or the site answers 404 for the script.
// Exit 2 = COULD NOT LOOK: the network failed, a 429/5xx or a hang outlived the
//          bounded retry, or an answer said nothing about the key. Never a pass.
//
// 🔴 NO `process.exit()` ANYWHERE BELOW — `process.exitCode` + return, for the
// Windows libuv reason verify-auth-providers.mjs records.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APEX_ORIGIN } from '../sites/apex.mjs';
import { CouldNotLook, fetchWithBoundedRetry } from './bounded-retry.mjs';

/** The site directory the apex serves, and the sign-in script inside it. The
 *  served path is DERIVED from the pair, so moving the file moves the probe;
 *  the test fails if the tree no longer holds the file. */
export const SITE_DIR = 'sites/nikatru';
export const SIGNIN_FILE = `${SITE_DIR}/js/signin.js`;

/** What signin.js holds until the key is filled in. */
export const PLACEHOLDER = '__SUPABASE_PUBLISHABLE_KEY__';

const KEY_SHAPE = /\bsb_publishable_[A-Za-z0-9_-]+/g;
const AUTH_URL_SHAPE = /\bSUPABASE_URL\s*=\s*(['"`])(https:\/\/[^'"`\s]+)\1/;

/** PURE. The URL the live site serves the sign-in script at. */
export function servedScriptUrl(origin = APEX_ORIGIN) {
  return new URL(SIGNIN_FILE.slice(SITE_DIR.length + 1), origin).href;
}

/** PURE. The fingerprint every line prints in place of the key. */
export function sha8(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

/** PURE. The https auth host a script body names as SUPABASE_URL, or null. */
export function extractAuthUrl(body) {
  const m = AUTH_URL_SHAPE.exec(String(body));
  return m ? m[2].replace(/\/+$/, '') : null;
}

/** PURE. What the served script says, before anything is sent anywhere.
 *  Returns { verdict: 'placeholder' | 'no-host' | 'no-key' | 'ambiguous' | 'ok', … }.
 *  Only 'ok' carries the key, and only so the caller can send it. */
export function judgeServedScript(body) {
  const text = String(body);
  if (text.includes(PLACEHOLDER)) return { verdict: 'placeholder' };
  const authUrl = extractAuthUrl(text);
  if (!authUrl) return { verdict: 'no-host' };
  const keys = [...new Set(text.match(KEY_SHAPE) ?? [])];
  if (keys.length === 0) return { verdict: 'no-key', authUrl };
  if (keys.length > 1) return { verdict: 'ambiguous', authUrl, count: keys.length, sha8s: keys.map(sha8) };
  return { verdict: 'ok', authUrl, key: keys[0] };
}

/** PURE. The auth host's answer to the settings read, as an exit code.
 *  429/5xx never reach here: the bounded retry turns them into COULD NOT LOOK. */
export function judgeSettings(status, text) {
  if (status === 401 || status === 403) return { code: 1, why: `HTTP ${status}` };
  if (status !== 200) return { code: 2, why: `HTTP ${status}, which says nothing about the key` };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { code: 2, why: 'HTTP 200 with a body that is not JSON, so not GoTrue settings' };
  }
  if (!body || typeof body !== 'object' || !body.external || typeof body.external !== 'object') {
    return { code: 2, why: 'HTTP 200 with JSON that has no `external` object, so not GoTrue settings' };
  }
  return { code: 0, why: 'HTTP 200, GoTrue settings' };
}

/** The live fetch. Every call passes the signal the bounded retry hands it. */
function liveFetch(url, { headers, signal }) {
  return fetch(url, { headers, signal, redirect: 'follow' });
}

/** The --fixtures seam: answers from a file, never the network. A `hang` never
 *  settles until the per-request signal fires, which is how a timeout is proved.
 *  A row with `apikeySha8` models the gateway: it answers 401 unless the request
 *  carried, in `apikey`, the key with that fingerprint. */
function fixtureFetchFrom(file) {
  const table = JSON.parse(readFileSync(file, 'utf8'));
  return (url, { headers, signal }) => {
    const row = table[url];
    if (!row) return Promise.reject(new Error(`fixture has no answer for ${url}`));
    if (row.apikeySha8 !== undefined && sha8(headers?.apikey ?? '') !== row.apikeySha8) {
      return Promise.resolve(new Response('{"message":"Invalid API key"}', { status: 401 }));
    }
    if (row.fail === 'hang') {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (row.fail === 'reset') {
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return Promise.reject(err);
    }
    return Promise.resolve(new Response(row.body ?? '', { status: row.status }));
  };
}

/** One GET under the shared bounded retry; the body is read under the same
 *  ceiling. Throws CouldNotLook for anything that is not an answer. */
async function read(doFetch, url, headers, label) {
  const res = await fetchWithBoundedRetry(({ signal }) => doFetch(url, { headers, signal }), {
    describe: (s) => `${label} (${url}): ${s}`,
    note: (line) => console.error(`  ↻ ${line}`),
  });
  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw new CouldNotLook(`${label} (${url}): the body did not arrive (${err?.name ?? 'error'})`);
  }
  return { status: res.status, text };
}

export async function main(argv = process.argv.slice(2)) {
  const scriptUrl = servedScriptUrl();
  try {
    let doFetch = liveFetch;
    const at = argv.indexOf('--fixtures');
    if (at !== -1) {
      console.error('!!  OFFLINE FIXTURE MODE — --fixtures is set. This must NEVER appear in a real ops-watch log.');
      doFetch = fixtureFetchFrom(argv[at + 1]);
    }
    console.log(`live sign-in key: reading ${scriptUrl}`);

    const script = await read(doFetch, scriptUrl, {}, 'the sign-in script');
    if (script.status === 404) {
      console.error(`❌ the live site answers 404 for ${scriptUrl}: it does not serve the sign-in script ${SIGNIN_FILE} records.`);
      return 1;
    }
    if (script.status !== 200) {
      console.error(`⚠️  COULD NOT LOOK: ${scriptUrl} answered HTTP ${script.status}; nothing was judged.`);
      return 2;
    }
    console.log(`  served script: HTTP 200, ${script.text.length} chars`);

    const served = judgeServedScript(script.text);
    if (served.verdict === 'placeholder') {
      console.error(`❌ the live sign-in script still holds ${PLACEHOLDER}: the deploy did not fill the publishable key, so every sign-in is refused.`);
      return 1;
    }
    if (served.verdict === 'no-host') {
      console.error('❌ the live sign-in script names no https SUPABASE_URL: the site is not serving the script this repository records.');
      return 1;
    }
    if (served.verdict === 'no-key') {
      console.error(`❌ the live sign-in script carries no sb_publishable_ key: the deploy did not fill it (auth host ${served.authUrl}).`);
      return 1;
    }
    if (served.verdict === 'ambiguous') {
      console.error(`❌ the live sign-in script carries ${served.count} different sb_publishable_ keys (sha8 ${served.sha8s.join(', ')}); it must carry one.`);
      return 1;
    }

    const fp = `sha8=${sha8(served.key)}`;
    const settingsUrl = `${served.authUrl}/auth/v1/settings`;
    console.log(`  key: ${fp} · auth host: ${served.authUrl}`);
    const answer = await read(doFetch, settingsUrl, { apikey: served.key }, 'the auth host settings read');
    const verdict = judgeSettings(answer.status, answer.text);
    console.log(`  ${settingsUrl} → HTTP ${answer.status}`);
    if (verdict.code === 1) {
      console.error(`❌ the live site's publishable key is refused by the auth host (${fp}, ${verdict.why}). Sign-in is broken until the served key matches the host's.`);
      return 1;
    }
    if (verdict.code === 2) {
      console.error(`⚠️  COULD NOT LOOK: ${settingsUrl} answered ${verdict.why}; the key (${fp}) was not judged.`);
      return 2;
    }
    console.log(`✅ the auth host accepts the live site's publishable key (${fp}, status ${answer.status}).`);
    return 0;
  } catch (err) {
    // Anything else is the reader failing, not the key: it judged nothing, so it
    // is COULD NOT LOOK and never the finding an uncaught throw's exit 1 reads as.
    const why = err instanceof CouldNotLook ? err.message : `the reader failed (${err?.name ?? 'error'}: ${err?.message ?? err})`;
    console.error(`⚠️  COULD NOT LOOK: ${why}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
