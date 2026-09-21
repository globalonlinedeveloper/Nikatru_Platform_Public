#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-retired-names-live.mjs — a retired name may not still BE something in
// the Cloudflare account.
//
// [ADR 079]. The account twin of tooling/ci/assert-retired-names.mjs, and it
// exists because that guard cannot see the only place the name actually costs
// anything. The tree check reads configs; a resource that no config mentions any
// more is invisible to it and goes on existing, serving, billing and appearing
// in the dashboard.
//
// 🔴 THAT IS NOT HYPOTHETICAL. On 2026-09-12 the `subly` name was gone from
// every config in the tree — assert-retired-names.mjs was green — while the
// account still held a `subly` Pages project with 271 deployments and a
// `subly_db` D1 database. Both were removed that day, by hand, after somebody
// happened to look. Nothing in CI could have said so, and nothing would have
// said so next month either.
//
// ── WHAT IT READS (the live inventory) ───────────────────────────────────────
// Every resource kind in the account that CARRIES A NAME: Pages projects, D1
// databases, Worker scripts, KV namespaces, R2 buckets. Measured 2026-09-12:
// 4 + 2 + 2 + 3 + 2 = 13 named resources, all five endpoints readable by the
// CLOUDFLARE_API_TOKEN this repository already uses.
//
// ── WHY NOT DNS, ROUTES OR REDIRECTS ─────────────────────────────────────────
// Those are hostnames, and hostnames already have two checks of their own:
// assert-hostname-depth.mjs in the tree and the wildcard step in ops-watch on
// the account. Adding a third reader of the same zone would put the same fact
// under two owners. This check's subject is the RESOURCE INVENTORY — the things
// that persist after every reference to them is deleted.
//
// Exit: 0 = no live resource carries a retired name · 1 = one does ·
//       2 = COULD NOT LOOK (the account was not read, so nothing was proved)
// Usage: node tooling/ops/check-retired-names-live.mjs [repoRoot]
//   env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_REGISTER_REL, retiredIn, tokensFrom } from '../ci/retired-identity.mjs';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const REQUEST_TIMEOUT_MS = 20_000;

// ⏱ 2026-09-21 — `CouldNotLook` IS NO LONGER DECLARED HERE. Every reader under
// tooling/ops/ declared its own, so `err instanceof CouldNotLook` was only ever
// true inside the file that threw — survivable while every throw and catch sat
// in one file, and the first thing to break when the bounded retry moved out of
// one. One class for the lane, re-exported so every existing importer of THIS
// module is unmoved (row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause).
export { CouldNotLook } from './bounded-retry.mjs';

/**
 * Every named resource kind, and where its NAME lives in the API's answer.
 *
 * ⚠️ THE `pick` FIELDS DIFFER PER KIND AND THAT IS THE POINT OF WRITING THEM
 * DOWN. A KV namespace's name is `title` and its `id` is a uuid; reading `id`
 * for KV would compare the retired token against 32 hex characters and pass
 * every time, for ever, while looking exactly like a check. R2 answers with
 * `{ buckets: [...] }` rather than a bare array, so its rows are reached through
 * `unwrap`.
 */
export const RESOURCE_KINDS = [
  { kind: 'Pages project', path: 'pages/projects', pick: 'name' },
  { kind: 'D1 database', path: 'd1/database', pick: 'name' },
  { kind: 'Worker script', path: 'workers/scripts', pick: 'id' },
  { kind: 'KV namespace', path: 'storage/kv/namespaces', pick: 'title' },
  { kind: 'R2 bucket', path: 'r2/buckets', pick: 'name', unwrap: 'buckets' },
];

/**
 * The verdict over an inventory of `{ kind, name }` rows.
 *
 * An EMPTY inventory is COULD NOT LOOK, not a pass: an account this repository
 * deploys to has resources in it, so reading none means the reading failed in a
 * way that did not raise — the "clean run over nothing" shape every guard here
 * is built to refuse.
 */
export function judge({ tokens, inventory }) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new CouldNotLook(
      `${RETIRED_REGISTER_REL} declares no \`retiredIdentityTokens.tokens\`, so this check refuses nothing ` +
        'and a retired name still live in the account would read exactly like a clean one.',
    );
  }
  if (!Array.isArray(inventory) || inventory.length === 0) {
    throw new CouldNotLook(
      'the account answered with no named resources at all. This repository deploys Pages, D1, Workers, KV and ' +
        'R2 to it, so an empty inventory is a read that failed quietly, not an empty account.',
    );
  }
  const findings = inventory
    .map((row) => ({ ...row, token: retiredIn(tokens, row.name) }))
    .filter((row) => row.token !== null);

  const counted = `${inventory.length} live resource(s) across ${new Set(inventory.map((r) => r.kind)).size} kind(s)`;
  if (findings.length === 0) {
    return { ok: true, findings, counted, line: `ok   retired names — ${counted}, none carries a retired name` };
  }
  return {
    ok: false,
    findings,
    counted,
    line:
      `✗ retired names — ${findings.length} live resource(s) still carry a retired name: ` +
      `${findings.map((f) => `${f.kind} "${f.name}" (retired: "${f.token}")`).join('; ')}. ` +
      `[ADR 079] retires the NAME, and a resource nothing references any more still exists, still serves and ` +
      `still appears in the dashboard — which is why the tree check cannot see it. Delete or rename it in the ` +
      `Cloudflare dashboard.`,
  };
}

/**
 * ONE Cloudflare read, attempted up to READ_ATTEMPTS times on the shared bounded
 * plan (tooling/ops/bounded-retry.mjs).
 *
 * 🔴 THIS FILE READS FIVE RESOURCE KINDS AND STOPS AT THE FIRST ONE IT CANNOT
 * READ, on purpose — so before 2026-09-21 a single dropped connection on the
 * FIFTH kind discarded four complete reads and exited 2. That is the defect row
 * O-PAGES-FETCH-TRANSIENT-NOT-RETRIED measured on check-pages-deployments.mjs,
 * and this file is one of the eleven its sweep clause names. Nothing about the
 * exit code moves: a kind that outlives the plan is still COULD NOT LOOK.
 *
 * ⚠️ THE `AbortController` IS BUILT INSIDE THE ATTEMPT. An aborted signal stays
 * aborted, so a controller hoisted above the loop would make every retry after a
 * timeout fail instantly on the first attempt's abort.
 */
// 🔴 `doFetch` IS A TEST SEAM AND IT IS LOAD-BEARING. Without it the retry here can
// only be proven by the fact that the module is imported — and a mutation that put
// a bare `new CouldNotLook` back at the throw site was measured on 2026-09-21 to
// pass every import-shaped assertion while quietly re-asking nothing.
export async function cf(path, token, { sleep, note, doFetch = fetch } = {}) {
  return readWithBoundedRetry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await doFetch(`${CF_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare API could not be reached (${err.message})`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const line = `the Cloudflare API answered HTTP ${res.status} for ${path}`;
        throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
      }
      let body;
      try {
        body = await res.json();
      } catch (err) {
        throw classifyThrown(err, `the Cloudflare API answer for ${path} was not JSON (${err.message})`);
      }
      if (body?.success !== true) {
        throw new CouldNotLook(`the Cloudflare API refused ${path}: ${JSON.stringify(body?.errors ?? []).slice(0, 200)}`);
      }
      return body.result;
    },
    { sleep, note },
  );
}

/**
 * IMPURE. Every named resource in the account, or CouldNotLook.
 *
 * A kind that cannot be read stops the whole check. Reading four kinds out of
 * five and reporting ok would be a check whose coverage silently depends on
 * which scopes the token happens to hold that day.
 */
export async function readInventory({ accountId, token }, api = cf) {
  const inventory = [];
  for (const { kind, path, pick, unwrap } of RESOURCE_KINDS) {
    const result = await api(`/accounts/${accountId}/${path}`, token);
    const rows = unwrap ? result?.[unwrap] : result;
    if (!Array.isArray(rows)) {
      throw new CouldNotLook(`the account's ${kind} listing came back without an array of rows`);
    }
    for (const row of rows) {
      const name = row?.[pick];
      if (typeof name !== 'string' || name.trim() === '') {
        throw new CouldNotLook(`a ${kind} came back with no \`${pick}\`, so its name could not be compared`);
      }
      inventory.push({ kind, name });
    }
  }
  return inventory;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  // The exit code is SET, never forced: process.exit() tears the runtime down with
  // the HTTPS socket still open, which on Windows surfaces as a libuv assertion and
  // exit 127 — the verdict printed correctly and the caller read a crash.
  class Lost extends Error {}
  const lost = (why) => {
    throw new Lost(why);
  };

  try {
    for (const [name, value] of [
      ['CLOUDFLARE_API_TOKEN', token],
      ['CLOUDFLARE_ACCOUNT_ID', accountId],
    ]) {
      if (value === '') lost(`${name} is not set, so the account could not be read.`);
    }
    const registerPath = join(ROOT, RETIRED_REGISTER_REL);
    if (!existsSync(registerPath)) lost(`${RETIRED_REGISTER_REL} does not exist, so no retired token could be read.`);
    let register;
    try {
      register = JSON.parse(readFileSync(registerPath, 'utf8'));
    } catch (err) {
      lost(`${RETIRED_REGISTER_REL} did not parse (${err.message}).`);
    }
    const inventory = await readInventory({ accountId, token });
    const verdict = judge({ tokens: tokensFrom(register), inventory });
    if (!verdict.ok) {
      console.error(verdict.line);
      process.exitCode = 1;
    } else {
      console.log(verdict.line);
    }
  } catch (err) {
    const why = err instanceof CouldNotLook || err instanceof Lost ? err.message : null;
    if (why === null) throw err;
    console.error('check-retired-names-live: COULD NOT LOOK');
    console.error(`    ${why}`);
    console.error('    Exit 2 = the account could not be read. An unread account is not a clean one.');
    process.exitCode = 2;
  }
}
