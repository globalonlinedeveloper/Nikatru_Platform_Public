#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// create-glitchtip-release.mjs — create and finalize the GlitchTip release a web
// deploy's source maps are stored under, and survive ONE transient origin error
// doing it.
//
// Row O-GLITCHTIP-CALLS-HAVE-NO-RETRY, 2026-09-23.
//
// ── THE DEFECT, MEASURED ─────────────────────────────────────────────────────
// deploy-web run 35831511489 (main f64cd921) went red at step 14, "Create and
// finalize the GlitchTip release", on this line and nothing else:
//
//   error: Failed to create release: POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522 <unknown status code>: error code: 522
//
// A 522 is Cloudflare saying the ORIGIN did not answer in time: a blip on the
// path, not an answer about the release. The step was `glitchtip-cli releases
// new --finalize`, and the CLI has no retry of its own — read at the pinned
// v1.0.0: src/api/client.rs builds a reqwest client with a 30 s CONNECT timeout,
// no total timeout and no retry, and src/commands/releases.rs `new_release`
// bails `POST {url} returned {status}: {body}` on any non-2xx. So one dropped
// request failed the whole deploy of every app in the matrix that hit it.
//
// ── WHAT THIS FILE SENDS: THE CLI'S OWN REQUEST, BYTE FOR BYTE IN SHAPE ──────
// Read from releases.rs `new_release` at v1.0.0: it computes `now` ONCE
// (`Utc::now().to_rfc3339()`), then POSTs to `organizations/{org}/releases/`
// with a Bearer token and the body
//     { "version", "projects": [<project>], "dateStarted": now,
//       "dateReleased": now }            ← dateReleased only with --finalize
// (serde renames to camelCase and skips a None; `url` is sent only with --url,
// which deploy-web.yml never passed). This file sends that body, with the stamp
// computed once per RUN, so every attempt of one run sends the SAME bytes.
// The request goes through `fetchWithBoundedRetry` (tooling/ops/bounded-retry.mjs,
// the shared plan — 3 attempts, gaps of 1 s then 2 s, Retry-After honoured and
// clamped to 5 s, a 15 s ceiling per attempt). No per-call option is passed: the
// last green create took 2 s (deploy-web run 35836688646), so the module's
// numbers already fit it and nothing measured asks for different ones.
//
// ── WHY A POST MAY BE RE-SENT HERE ───────────────────────────────────────────
// bounded-retry.mjs re-asks only SAFE methods by default (`isSafeMethod`) and
// says the decision for a write belongs at its call site. It is recorded there,
// below `createRelease`, with the measurement it rests on.
//
// Usage:
//   SENTRY_URL=https://<host> SENTRY_AUTH_TOKEN=<token> \
//   node tooling/ops/create-glitchtip-release.mjs \
//     --release '<app>@<x.y.z.run>+<sha7>' --org <slug> --project <slug>
//
// Exit 0 = the server answered 2xx with a release row carrying this version.
// Exit 1 = it did not, including a 5xx that outlived the retry (an OUTAGE).
// Failing cases: tooling/ci/test/glitchtip-release-create.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithBoundedRetry, CouldNotLook } from './bounded-retry.mjs';

/** The request body, built ONCE per run. PURE: the stamp is an argument, so a
 *  test can hold the clock still and compare two attempts byte for byte. */
export function releaseBody({ release, project, stamp }) {
  return JSON.stringify({ version: release, projects: [project], dateStarted: stamp, dateReleased: stamp });
}

/**
 * Create and finalize `release` on `server`. Resolves to
 * `{ ok: true, attempts, status, row }` or `{ ok: false, attempts, lines }`;
 * never throws for a server's answer.
 *
 * `fetchImpl`, `sleep`, `note` and `now` are the test seams: no case in the
 * suite reaches a live GlitchTip, and no case waits a real second.
 */
export async function createRelease({
  server,
  token,
  org,
  project,
  release,
  fetchImpl = fetch,
  sleep,
  note = (line) => console.log(`  retry: ${line}`),
  now = () => new Date(),
}) {
  const url = `${server}/api/0/organizations/${encodeURIComponent(org)}/releases/`;
  const body = releaseBody({ release, project, stamp: now().toISOString() });
  let attempts = 0;
  let res;
  try {
    // 🔴 THE POST IS RE-SENT ON A TRANSIENT FAILURE, AND THIS IS WHY IT IS SAFE.
    // MEASURED 2026-09-23 by the parent session of this row, against the live
    // instance, re-POSTing a release that already existed with its own stored
    // dateReleased (Private/research/session-2026-09-23/glitchtip-retry/
    // idempotency-measured.md), verbatim:
    //   GET list 200 n=50
    //   release subscriptiontracker@1.0.439+d90dbfc GET before 200 dateCreated 2026-09-23T08:30:42.841Z dateReleased 2026-09-23T08:30:41.942Z
    //   POST again 201 body.version subscriptiontracker@1.0.439+d90dbfc body.dateCreated 2026-09-23T08:30:42.841Z
    //   GET after 200 dateCreated 2026-09-23T08:30:42.841Z dateReleased 2026-09-23T08:30:41.942Z
    //   rows with this version after 1 list n 50
    //   VERDICT IDEMPOTENT (2xx, one row, dates unchanged)
    // So a second create of an existing version answers 201 with the SAME row:
    // no duplicate, no error, no date moved. That dateReleased precedes
    // dateCreated shows the server STORES the client's stamp — and `body` is
    // built once above, so attempt 2 re-sends attempt 1's stamp exactly, which
    // is the measured case. (The measured body omitted dateStarted; a re-POST
    // with a NEWER dateReleased, which a whole-job re-run sends, was not
    // measured — the CLI sent the same on a re-run.)
    res = await fetchWithBoundedRetry(
      async ({ signal }) => {
        attempts += 1;
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body,
          signal,
        });
        // The body is read INSIDE the attempt, so a connection that drops
        // mid-body is the wire failing (re-asked), not a garbled answer.
        const text = await r.text();
        return { status: r.status, statusText: r.statusText, ok: r.ok, headers: r.headers, text };
      },
      // ⏱ 2026-09-25 (row O-OPS-PROBE-US-EDGE-STALL): `secondLook` — when all
      // three attempts got nothing, four more 15 s apart before the deploy
      // fails. The re-send is safe for the reason recorded below `createRelease`.
      { describe: (what) => `POST ${url}: ${what}`, sleep, note, secondLook: true },
    );
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    return { ok: false, attempts, lines: [e.message] };
  }
  if (!res.ok) {
    return {
      ok: false,
      attempts,
      lines: [`POST ${url} returned ${res.status} ${res.statusText}: ${res.text.slice(0, 400)}`],
    };
  }
  let row;
  try {
    row = JSON.parse(res.text);
  } catch {
    return { ok: false, attempts, lines: [`POST ${url} answered ${res.status} with a non-JSON body: ${res.text.slice(0, 200)}`] };
  }
  if (row?.version !== release) {
    return {
      ok: false,
      attempts,
      lines: [
        `POST ${url} answered ${res.status} but the row names version ${JSON.stringify(row?.version)}, not "${release}".`,
        'The source maps would be stored under a release the SDK never reports.',
      ],
    };
  }
  return { ok: true, attempts, status: res.status, row };
}

// Imported for `createRelease` alone by the test; only a direct run does the work below.
const RUN_DIRECTLY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (RUN_DIRECTLY) {
  const fail = (lines) => {
    console.error(`::error title=GlitchTip release::${lines[0]}`);
    console.error(`\nFAIL create-glitchtip-release — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`     ${l}`);
    process.exitCode = 1;
  };
  const args = new Map();
  let bad = null;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { bad = `unexpected argument "${a}"`; break; }
    const value = argv[i + 1];
    // A flag given no value must not eat the next flag (TRAPS shell-13).
    if (value === undefined || value.startsWith('--')) { bad = `${a} needs a value, and none followed it`; break; }
    args.set(a.slice(2), value);
    i += 1;
  }
  const server = (process.env.SENTRY_URL ?? '').replace(/\/+$/, '');
  const token = process.env.SENTRY_AUTH_TOKEN ?? '';
  const missing = ['release', 'org', 'project'].filter((k) => !args.get(k));
  if (bad) fail([bad]);
  else if (missing.length > 0) fail([`--${missing[0]} is required`]);
  // The origin is checked for SHAPE and never printed whole: only a host reaches the log.
  else if (!/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(server)) fail(['SENTRY_URL must be a bare server origin (https://<host>)']);
  else if (!token) fail(['SENTRY_AUTH_TOKEN is empty, so no release could be created']);
  else {
    const host = new URL(server).host;
    const release = args.get('release');
    const r = await createRelease({ server, token, org: args.get('org'), project: args.get('project'), release });
    if (!r.ok) fail(r.lines);
    else {
      const on = r.attempts > 1 ? ` on attempt ${r.attempts}` : '';
      console.log(`ok  release "${release}" created and finalized on ${host} (HTTP ${r.status}${on})`);
    }
  }
}
