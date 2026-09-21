#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-turnstile-hosts.mjs — THE CAPTCHA'S HOSTNAME LIST IS A SECOND PLACE THE
// APP'S ADDRESS IS WRITTEN DOWN, AND NOTHING KEPT THE TWO IN STEP.
//
// 🔴 THE OUTAGE THIS EXISTS FOR, MEASURED 2026-09-12. The `nikatru-auth` widget's
// allowed hostnames were `localhost` and `subly.nikatru.com`. [ADR 075] moved the
// app to `nikatru.com/<id>` and [ADR 079] deleted `subly.nikatru.com`, so the
// widget allowed one host that no longer exists and refused the one the app is
// actually served from. Turnstile answered every sign-in page with
// "Domain not allowed.", the widget rendered "Unable to connect to website", and
// SIGN-IN AND SIGN-UP WERE DEAD FOR EVERY USER of the live app — silently, because
// nothing else changes: the page loads, the form draws, and only the challenge
// refuses.
//
// It was known, too, which is the part worth preventing. The address move recorded
// "the widget's own configured domain list is a SEPARATE console setting and still
// names the old subdomain" as an owner item. It sat there, and the first person to
// try to sign in found it — days later, by accident, while doing something else.
//
// ── WHY A LIVE CHECK AND NOT A GUARD OVER THE TREE ───────────────────────────
// The hostname list is not in this repository and cannot be. It is account state
// in the Cloudflare dashboard, exactly like the DNS records
// `check-wildcard-dns.mjs` reads, and for the same reason this check reads the
// ZONE ITSELF rather than anything committed: a file can only record what somebody
// remembered to write down.
//
// ── WHAT IT COMPARES ─────────────────────────────────────────────────────────
// Both sides are DERIVED, so neither can go stale:
//   · the WIDGET is found by the sitekey the web build actually ships
//     (`TURNSTILE_SITE_KEY`, the repository variable `deploy-web.yml` passes as a
//     --dart-define). Not by name: a widget can be renamed in the console, and the
//     sitekey is what the bytes in the browser carry.
//   · the HOSTS come from `catalog/apps.json` — every address the portfolio says
//     an app is published at. Add an app on a new host and this check asks about
//     it with no edit here.
//
// ⚠️ `localhost` AND EXTRA HOSTS ARE NOT A FINDING. The widget may allow more than
// the catalogue names — local development needs `localhost`, and a staging host is
// nobody's emergency. The claim is one-directional and that is deliberate: every
// host we SERVE must be allowed. What else is allowed is the owner's business.
//
// ── FAIL-CLOSED ──────────────────────────────────────────────────────────────
// No token, an API that refuses, a sitekey that matches no widget: exit 2. An
// unreadable console is not a passing one — that is the rule every live check in
// this directory follows, and the reason the wildcard check was written to read
// the zone rather than a resolver.
//
// Usage:  node tooling/ops/check-turnstile-hosts.mjs [repoRoot]
//   env:  CLOUDFLARE_API_TOKEN (read: Turnstile), CLOUDFLARE_ACCOUNT_ID,
//         TURNSTILE_SITE_KEY
// Exit 0 = every served host is allowed. 1 = one is not. 2 = could not look.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** The hostnames the catalogue says apps are published at, deduped and sorted.
 *  PURE: the parsed catalogue in, the hosts out. */
export function servedHosts(catalogue) {
  const rows = Array.isArray(catalogue) ? catalogue : (catalogue?.apps ?? []);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CouldNotLook('catalog/apps.json holds no app rows, so no served host could be derived');
  }
  const hosts = new Set();
  for (const row of rows) {
    for (const candidate of [row?.url, row?.listings?.web]) {
      if (typeof candidate !== 'string' || candidate === '') continue;
      try {
        hosts.add(new URL(candidate).hostname.toLowerCase());
      } catch {
        throw new CouldNotLook(`catalog/apps.json carries ${JSON.stringify(candidate)}, which is not a URL`);
      }
    }
  }
  if (hosts.size === 0) {
    throw new CouldNotLook('no app row carries a `url` or `listings.web`, so no served host could be derived');
  }
  return [...hosts].sort();
}

/** PURE. The verdict, given what the catalogue serves and what the widget allows. */
export function judge({ sitekey, served, allowed }) {
  const have = new Set(allowed.map((d) => String(d).toLowerCase()));
  const missing = served.filter((h) => !have.has(h));
  if (missing.length === 0) {
    return {
      ok: true,
      line:
        `ok  turnstile hostnames — every served host is allowed on widget ${sitekey}: ` +
        `${served.join(', ')} (widget allows ${allowed.length}: ${allowed.join(', ')})`,
    };
  }
  return {
    ok: false,
    missing,
    line:
      `✗ turnstile hostnames — widget ${sitekey} does not allow ${missing.length} host(s) the catalogue says ` +
      `we serve: ${missing.join(', ')}. It allows ${allowed.join(', ') || '(none)'}. Turnstile answers a page on ` +
      `a host it does not allow with "Domain not allowed.", so the challenge never renders and SIGN-IN AND ` +
      `SIGN-UP ARE DEAD on that host — silently: the page loads and the form draws. Add the host in the ` +
      `Cloudflare dashboard under Turnstile, on the widget carrying this sitekey.`,
  };
}

/**
 * ONE Cloudflare read, attempted up to READ_ATTEMPTS times on the shared bounded
 * plan (tooling/ops/bounded-retry.mjs).
 *
 * 🔴 IT WAS UN-RETRIED UNTIL 2026-09-21 AND ONE DROPPED TCP CONNECTION WAS A
 * RUN-LEVEL VERDICT — the defect row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED
 * measured on check-pages-deployments.mjs, whose sweep clause names this file.
 * The exit code is unmoved: a read that outlives the plan is still COULD NOT
 * LOOK, still exit 2, never a pass. Only the wire dropping, 429 and 5xx are
 * re-asked; a 403, unparseable JSON and `success:false` are ANSWERS.
 *
 * ⚠️ THE `AbortController` IS BUILT INSIDE THE ATTEMPT, NOT OUTSIDE IT. An
 * aborted signal stays aborted, so a controller hoisted above the loop would
 * make every retry after a timeout fail instantly on the FIRST attempt's abort —
 * a retry that is only ever going to spend the ceiling and report the same word.
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
        res = await doFetch(`${CF_API}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
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
        // A body that dies MID-READ is the wire dropping; a body that parsed to
        // something that is not JSON is an answer. `classifyThrown` tells them apart.
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

/** IMPURE. The widget carrying this sitekey, or CouldNotLook. */
export async function readWidget({ accountId, sitekey, token }, api = cf) {
  const result = await api(`/accounts/${accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`, token);
  const domains = result?.domains;
  if (!Array.isArray(domains)) {
    throw new CouldNotLook(`the widget for sitekey ${sitekey} came back without a \`domains\` array`);
  }
  return { name: result?.name ?? '(unnamed)', domains };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const sitekey = process.env.TURNSTILE_SITE_KEY ?? '';
  // The exit code is SET, never forced. `process.exit()` tears the runtime down
  // with the HTTPS socket this script just used still open, and on Windows that
  // surfaces as a libuv assertion and exit 127 - the verdict printed correctly and
  // the caller read a crash. Measured here on 2026-09-12, on the failing path
  // only, which is the path that matters. Setting `exitCode` lets the loop drain.
  class Lost extends Error {}
  const lost = (why) => {
    throw new Lost(why);
  };

  try {
    for (const [name, value] of [
      ['CLOUDFLARE_API_TOKEN', token],
      ['CLOUDFLARE_ACCOUNT_ID', accountId],
      ['TURNSTILE_SITE_KEY', sitekey],
    ]) {
      if (value === '') lost(`${name} is not set, so the widget could not be read.`);
    }
    const cataloguePath = join(ROOT, 'catalog', 'apps.json');
    if (!existsSync(cataloguePath)) lost('catalog/apps.json does not exist, so no served host could be derived.');
    let catalogue;
    try {
      catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    } catch (err) {
      lost(`catalog/apps.json did not parse (${err.message}).`);
    }
    const served = servedHosts(catalogue);
    const widget = await readWidget({ accountId, sitekey, token });
    const verdict = judge({ sitekey, served, allowed: widget.domains });
    if (!verdict.ok) {
      console.error(verdict.line);
      console.error(`    widget: ${widget.name}`);
      process.exitCode = 1;
    } else {
      console.log(verdict.line);
    }
  } catch (err) {
    const why = err instanceof CouldNotLook || err instanceof Lost ? err.message : null;
    if (why === null) throw err;
    console.error('check-turnstile-hosts: COULD NOT LOOK');
    console.error(`    ${why}`);
    console.error('    Exit 2 = the console could not be read. An unreadable setting is not a passing one.');
    process.exitCode = 2;
  }
}
