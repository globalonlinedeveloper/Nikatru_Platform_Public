#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// smoke-site-deploy.mjs — after deploy-web.yml's `site` job publishes sites/nikatru,
// the host it published to serves THIS commit, and its Pages Function answers (row
// O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE, D3a).
//
// Two limbs, in order, against one origin (since D3b: https://nikatru.com):
//   1. GET /version.json carries `sha` equal to --expect-sha. The job writes that file
//      just before the deploy, and the site has no build step, so the SHA is the one
//      joinable key. Judged by `judge` from tooling/ops/post-deploy-smoke.mjs — the same
//      field-and-retry rules the app deploys are smoked with, not a second reading of
//      them: a mismatch or a missing field is retried to the ceiling (a CDN still on the
//      previous deployment), and a 200 that is not JSON fails at once (a served page, not
//      the file).
//   2. POST /api/subscribe with an EMPTY body answers 400 with a JSON `ok: false`.
//      subscribe.js cannot read an empty JSON body, and its catch answers
//      `400 "Could not read your submission."` before it touches a binding
//      (sites/nikatru/functions/api/subscribe.js, onRequestPost). So the request writes
//      nothing, ever, and never carries an address. A static host with no Function
//      answers a POST with something else (405, or 404), and that is the failure this
//      limb exists for: `wrangler pages deploy` finds functions/ in its WORKING
//      directory, so a deploy run from the wrong place ships the pages and drops the
//      Function without an error.
//      ⚠️ WHAT LIMB 2 DOES NOT PROVE: that the bindings are present. subscribe.js checks
//      them only after a valid address, and a valid address would write a row. The
//      bindings are graded before the deploy, by tooling/ci/assert-site-bindings.mjs.
//
// Usage:
//   node tooling/sites/smoke-site-deploy.mjs --origin https://nikatru.com --expect-sha <40-hex>
// Exit 0 = both limbs pass. 1 = a limb failed (the deploy is not serving what it should).
//      2 = usage: a missing or malformed argument.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from '../ops/post-deploy-smoke.mjs';

export const ATTEMPTS = 6;
export const GAP_MS = 10_000;
export const VERSION_PATH = '/version.json';
export const FUNCTION_PATH = '/api/subscribe';
/** subscribe.js's answer to a body it cannot read. */
export const EMPTY_BODY_STATUS = 400;
const TIMEOUT_MS = 15_000;
const SHA = /^[0-9a-f]{40}$/;

/** PURE. An origin the smoke may call: https, or plain http to loopback (the tests). */
export function originOf(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ''));
  } catch {
    return null;
  }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
  if (u.pathname !== '/' || u.search || u.hash) return null;
  return u.origin;
}

/** Limb 1. `get(url)` answers `{ status, body }` or throws. */
export async function smokeVersion({ origin, sha, get, attempts = ATTEMPTS, gapMs = GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const url = `${origin}${VERSION_PATH}`;
  let last = 'no attempt was made';
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await get(url);
    } catch (e) {
      last = `request failed: ${e.message}`;
      if (i < attempts - 1) await sleep(gapMs);
      continue;
    }
    const verdict = judge({ status: res.status, body: String(res.body ?? ''), field: 'sha', expected: sha });
    if (verdict.ok) return { ok: true, detail: `${url} serves sha ${verdict.actual} (attempt ${i + 1}/${attempts})` };
    last = verdict.reason;
    if (!verdict.retry) break;
    if (i < attempts - 1) await sleep(gapMs);
  }
  return { ok: false, detail: `${url} — ${last}` };
}

/** Limb 2. `post(url)` sends an EMPTY body and answers `{ status, body }` or throws. */
export async function smokeFunction({ origin, post }) {
  const url = `${origin}${FUNCTION_PATH}`;
  let res;
  try {
    res = await post(url);
  } catch (e) {
    return { ok: false, detail: `${url} — request failed: ${e.message}` };
  }
  if (res.status !== EMPTY_BODY_STATUS) {
    const why =
      res.status === 405 || res.status === 404
        ? 'which is what a host with NO Function answers: the deploy shipped the pages without functions/'
        : 'which is not the answer subscribe.js gives a body it cannot read';
    return { ok: false, detail: `POST ${url} with an empty body answered ${res.status}, expected ${EMPTY_BODY_STATUS}, ${why}` };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(res.body ?? ''));
  } catch {
    // parsed stays null
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.ok !== false) {
    return { ok: false, detail: `POST ${url} answered ${EMPTY_BODY_STATUS} without subscribe.js's JSON \`{ ok: false }\` — something other than the Function answered` };
  }
  return { ok: true, detail: `POST ${url} with an empty body answered ${EMPTY_BODY_STATUS} { ok: false } — the Function is deployed, and nothing was written` };
}

async function fetchText(url, init) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  return { status: r.status, body: await r.text() };
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

export async function main(argv, { get = null, post = null, sleep } = {}) {
  const origin = originOf(flag(argv, '--origin'));
  const sha = flag(argv, '--expect-sha');
  if (!origin || !SHA.test(String(sha ?? ''))) {
    console.error('✗ usage: smoke-site-deploy.mjs --origin <https origin, no path> --expect-sha <40-hex commit sha>');
    return 2;
  }
  const getter = get ?? ((url) => fetchText(url, { headers: { 'cache-control': 'no-cache' } }));
  const poster = post ?? ((url) => fetchText(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '' }));
  const version = await smokeVersion({ origin, sha, get: getter, ...(sleep ? { sleep } : {}) });
  if (!version.ok) {
    console.error(`✗ SITE SMOKE FAILED — ${version.detail}`);
    console.error('  The deploy step reported success and the host does not serve this commit\'s version.json.');
    return 1;
  }
  console.log(`ok  ${version.detail}`);
  const fn = await smokeFunction({ origin, post: poster });
  if (!fn.ok) {
    console.error(`✗ SITE SMOKE FAILED — ${fn.detail}`);
    return 1;
  }
  console.log(`ok  ${fn.detail}`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = await main(process.argv.slice(2));
