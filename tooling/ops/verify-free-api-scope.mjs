#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-free-api-scope.mjs — the store service account must stay powerless on GCP.
//
// [ADR 033] forbids ever enabling a metered API in the `nikatru-platform` GCP
// project, so that no credential living there can generate a bill BY
// CONSTRUCTION rather than by convention. The construction has two halves:
//
//   1. no metered API is enabled in the project, and
//   2. `nikatru-free-api@nikatru-platform.iam.gserviceaccount.com` holds **no
//      GCP IAM roles** — its authority comes only from the PRODUCTS it is
//      granted in (Play Developer API, Search Console), never from GCP itself.
//
// Half 2 is what this checks. Until 2026-08-05 neither half had ever been
// observed: ADR 033 records itself as "NOT owner-attributed, NOT
// machine-enforced, and the live enabled-API list of the project has NOT been
// read". Probed that day for the first time — the key authenticates fine, and
// FOUR different project-level reads all return PERMISSION_DENIED.
//
// 🔴 WHY THIS IS A STANDING CHECK AND NOT A ONE-OFF. "No roles" is not a
// property of the key, it is a property of an IAM policy that anyone with
// console access can change in ten seconds — and the reason to change it is
// always a good one at the time ("just let it read its own config"). The moment
// a role is granted, ADR 033's structural protection becomes a convention again,
// and NOTHING anywhere would say so. A grant is silent, instant and invisible;
// this is the thing that notices.
//
// ⚠️ IT ASSERTS DENIAL, WHICH IS AN UNUSUAL SHAPE — so read the failure mode
// carefully. A guard that expects 403 passes when the network is broken, when
// the project is deleted, when the key is revoked: everything fails, so
// everything "passes". That is why the token mint is checked FIRST and
// separately: a valid token proves the key still works and the account is still
// active, and only then is a 403 meaningful. Without that, this check would be
// the purest possible example of silence-mistaken-for-success.
//
// ⚠️ IT CANNOT CHECK HALF 1. Reading the enabled-API list requires
// `serviceusage.services.list`, which is exactly the permission this account
// must not have. So the enabled-API list is OWNER-ONLY — not "nobody has got
// round to it", but "no credential this repo holds can read it, and that is the
// design". The owner reads it in the console.
//
// Usage:  node tooling/ops/verify-free-api-scope.mjs
//
// The key comes from `PLAY_SERVICE_ACCOUNT_JSON` if that is set, and otherwise
// from .claude/nikatru-platform-dd65a2de381c.json (gitignored). Env first so a
// CI runner, which has no `.claude/`, can run this at all — the same account's
// key has been a repository secret since 2026-08-04.
// ⚠️ THE SECRET IS NOT WRITTEN TO DISK IN A WORKFLOW STEP, deliberately: that
// filename is bound to a key id that changes on rotation, and it would put a
// private key on the runner's filesystem for no gain.
// Nothing below ever prints the key, the token, or any part of either — only
// the account's own `client_email`, which is an identifier, not a credential.
//
// Exit 0 = the account authenticates AND is denied every project-level read.
// Exit 1 = a project-level read SUCCEEDED (the fail-closed property is gone), or
//          an unexpected non-transient status made the answer unreadable.
// Exit 2 = could not look — key missing, the token would not mint, or a read stayed
//          unreachable (thrown request, 5xx or 429) after its retries.
//          A DIFFERENT code on purpose: "I could not look" must never read as
//          "I looked and it was fine".
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry, RETRY_BASE_MS } from './bounded-retry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY_PATH = join(ROOT, '.claude', 'nikatru-platform-dd65a2de381c.json');
const AUD = 'https://oauth2.googleapis.com/token';

/// Env first, gitignored file second — so this can run on a CI runner, which
/// has no `.claude/`. `PLAY_SERVICE_ACCOUNT_JSON` is a repository secret already
/// (installed 2026-08-04) holding a key for this same account.
const KEY_ENV = 'PLAY_SERVICE_ACCOUNT_JSON';

/// 🔴 THE ACCOUNT THIS GUARD IS ABOUT. Asserted, not assumed.
///
/// The env source is a secret whose value cannot be read from here, so nothing
/// locally can confirm it holds the key it is believed to hold. If it were
/// swapped for a different service account's key, every probe below would still
/// answer 403 and this guard would still print PASS — while asserting that some
/// OTHER account is powerless and saying nothing at all about
/// `nikatru-free-api@`. That is the exact shape of a check that quietly stopped
/// checking, and it is cheap to close: the key states its own identity, so read
/// it and refuse to proceed on the wrong one.
const EXPECT_CLIENT_EMAIL =
  'nikatru-free-api@nikatru-platform.iam.gserviceaccount.com';

/// 🔴 A NETWORK BLIP IS NOT A VERDICT. ops-watch run 34602047972 (2026-09-11T13:02Z) went
/// red on `iam — list service accounts — could not be reached (fetch failed)` while the
/// token minted and the other three reads answered 403 in the same second; the re-run of
/// that job passed. So a request that throws, or answers 5xx or 429, is retried, and one
/// that stays unreachable is "could not look" (exit 2), never a finding (exit 1).
/// A 403, a success and any other 4xx are answers and are never retried.
/// ⏱ 2026-09-21 — THE PRIVATE LOOP THAT USED TO STAND HERE IS GONE. It was the
/// only CORRECT retry on this lane and it was still a FORK: its own `ATTEMPTS`,
/// its own LINEAR gap, its own `transientStatus`, and no reading of
/// `Retry-After`. Two readings of "is this transient?" eventually disagree
/// silently, which is the argument capture-suite-scan.mjs makes for being
/// imported by both its callers. The plan, the classification and the ceiling now
/// come from tooling/ops/bounded-retry.mjs (row
/// O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause).
///
/// 🔴 NOTHING ABOUT THE EXIT CONTRACT MOVES, AND THE SHAPE OF THE RETURN VALUE IS
/// KEPT ON PURPOSE: both call sites below read `{ res, err, attempts }` and turn
/// `err` into exit 2. A read that outlives the plan is still "could not look",
/// never a finding and never a pass.
///
/// ⚠️ VERIFY_FREE_API_SCOPE_RETRY_MS IS STILL HONOURED, because the test suite
/// sets it to collapse the gaps; it now overrides the shared BASE rather than a
/// private delay, so what it shortens is the documented plan.
const RETRY_BASE_OVERRIDE_MS = Number(process.env.VERIFY_FREE_API_SCOPE_RETRY_MS ?? RETRY_BASE_MS);
async function fetchWithRetry(url, init) {
  let attempts = 0;
  try {
    const res = await readWithBoundedRetry(
      async (attempt, { signal }) => {
        attempts = attempt;
        let r;
        try {
          r = await fetch(url, { ...init, signal });
        } catch (e) {
          throw classifyThrown(e, e?.message ?? String(e));
        }
        if (isTransientStatus(r.status)) {
          throw transientLook(`HTTP ${r.status}`, { retryAfterMs: retryAfterMs(r) });
        }
        return r;
      },
      { baseMs: RETRY_BASE_OVERRIDE_MS },
    );
    return { res, err: null, attempts };
  } catch (err) {
    // The LAST response is not kept: every caller below treats an exhausted read
    // as exit 2, and a 5xx that survived the plan is not an answer worth grading.
    return { res: null, err, attempts };
  }
}

// 🔴 NO `process.exit()` ANYWHERE BELOW, AND THAT IS A BUG FIX, NOT A STYLE
// CHOICE. Calling process.exit() while an undici (fetch) keep-alive handle is
// still open CRASHES libuv on Windows —
//   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\winsync.c:94`
// — and the process then reports 127 / 0xC0000409 instead of the code this file
// documents. The exit-2 contract ("I could not look" must be distinguishable
// from "I looked and it was fine") was therefore NOT being delivered on the one
// platform this runs on. Found by the negative test asserting `exit === 2`
// rather than merely asserting non-zero. Set process.exitCode and return; let
// Node drain and exit on its own.
async function main() {
const rawEnv = (process.env[KEY_ENV] ?? '').trim();
let KEY;
if (rawEnv !== '') {
  try {
    KEY = JSON.parse(rawEnv);
  } catch (err) {
    console.error(
      `⬜ ${KEY_ENV} is set but does not parse as JSON (${err.message}). A truncated or ` +
        `quote-wrapped paste looks EXACTLY like a present secret, so this is exit 2 — ` +
        `nothing was verified.`,
    );
    return 2;
  }
  for (const field of ['type', 'client_email', 'private_key']) {
    if (!KEY?.[field]) {
      console.error(`⬜ ${KEY_ENV} parses but carries no \`${field}\`. Exit 2 — nothing was verified.`);
      return 2;
    }
  }
} else if (!existsSync(KEY_PATH)) {
  console.error(
    `⬜ no service-account key: ${KEY_ENV} is unset and ${KEY_PATH} does not exist, ` +
      `so GCP was NOT contacted.`,
  );
  console.error('   Exit 2, deliberately distinct from 1.');
  return 2;
} else {
  KEY = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
}

// See EXPECT_CLIENT_EMAIL: a key for the wrong account would pass every probe
// below and prove nothing about the account this guard names.
if (KEY.client_email !== EXPECT_CLIENT_EMAIL) {
  console.error(
    `✗ this key belongs to ${KEY.client_email}, not ${EXPECT_CLIENT_EMAIL}. [ADR 033] is about ` +
      `THAT account; every probe below would answer 403 for an unrelated identity and this guard ` +
      `would report a pass it had not earned. Refusing to check the wrong subject.`,
  );
  return 1;
}
console.log(`--   key source: ${rawEnv !== '' ? KEY_ENV : KEY_PATH}  (${KEY.client_email})`);

const b64 = (o) =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const iat = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: KEY.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform.read-only',
  aud: AUD,
  iat,
  exp: iat + 3600,
})}`;
const sig = createSign('RSA-SHA256').update(unsigned).sign(KEY.private_key, 'base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let token;
try {
  const { res: r, err: mintErr } = await fetchWithRetry(AUD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (mintErr) throw mintErr;
  token = (await r.json()).access_token;
} catch (err) {
  console.error(`⬜ could not reach Google to mint a token — ${err.message}. Exit 2: I could not look.`);
  return 2;
}
// 🔴 THE LOAD-BEARING LINE. Every assertion below expects a 403, so without this
// the whole check passes when the credential is dead and nothing is reachable.
if (!token) {
  console.error('⬜ the token would not mint. The key may be revoked, disabled, or expired.');
  console.error('   Exit 2 — every check below expects a DENIAL, so they would all "pass" on a dead');
  console.error('   credential. Nothing was actually verified.');
  return 2;
}
console.log(`ok   the key authenticates — ${KEY.client_email} is live (token value never printed)`);

const PROBES = [
  ['serviceusage — list enabled APIs', `https://serviceusage.googleapis.com/v1/projects/${KEY.project_id}/services?filter=state:ENABLED`],
  ['cloudresourcemanager — read project', `https://cloudresourcemanager.googleapis.com/v1/projects/${KEY.project_id}`],
  ['cloudbilling — read billing info', `https://cloudbilling.googleapis.com/v1/projects/${KEY.project_id}/billingInfo`],
  ['iam — list service accounts', `https://iam.googleapis.com/v1/projects/${KEY.project_id}/serviceAccounts`],
];

const problems = [];
const unreachable = [];
for (const [label, url] of PROBES) {
  const { res, err, attempts } = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  // ⏱ 2026-09-21 — `err` alone. A transient STATUS can no longer survive
  // `fetchWithRetry`: it is re-asked inside the plan and, if it persists, comes
  // back as `err`. The second limb was the old loop's "returned the last response
  // anyway" escape hatch, and re-reading it here would have been the second
  // reading of "is this transient?" this change exists to delete.
  if (err) {
    unreachable.push(
      `${label} — could not be reached after ${attempts} attempt(s) (${err ? err.message : `HTTP ${res.status}`}); ` +
        'this check cannot conclude.',
    );
    continue;
  }
  if (res.ok) {
    problems.push(
      `🔓 ${label} SUCCEEDED. ${KEY.client_email} can now read project state on GCP, so it has been ` +
        `granted an IAM role since 2026-08-05. [ADR 033]'s protection is structural ONLY while this ` +
        `account is powerless — a role makes it a convention again. Revoke it, or amend ADR 033 ` +
        `deliberately and say why.`,
    );
  } else if (res.status !== 403) {
    problems.push(
      `${label} returned HTTP ${res.status}, which is neither the expected denial nor a success. ` +
        `The answer is unreadable, so this is a failure rather than a pass.`,
    );
  } else {
    console.log(`ok   denied: ${label}`);
  }
}

if (problems.length || unreachable.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  for (const u of unreachable) console.error(`⬜ ${u}`);
  if (problems.length) return 1;
  console.error('   Exit 2 — at least one read could not be made, so nothing is claimed about it.');
  return 2;
}
console.log(
  `\nverify-free-api-scope — the key is live and every one of ${PROBES.length} project-level reads is ` +
    `denied. [ADR 033]'s fail-closed half holds. The ENABLED-API half is owner-only by construction.`,
);
  return 0;
}

process.exitCode = await main();
