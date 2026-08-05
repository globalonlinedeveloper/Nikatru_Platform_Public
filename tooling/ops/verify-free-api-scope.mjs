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
// The key lives at .claude/nikatru-platform-dd65a2de381c.json (gitignored).
// Nothing below ever prints the key, the token, or any part of either.
//
// Exit 0 = the account authenticates AND is denied every project-level read.
// Exit 1 = a project-level read SUCCEEDED (the fail-closed property is gone), or
//          an unexpected status made the answer unreadable.
// Exit 2 = could not look at all — key missing, or the token would not mint.
//          A DIFFERENT code on purpose: "I could not look" must never read as
//          "I looked and it was fine".
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY_PATH = join(ROOT, '.claude', 'nikatru-platform-dd65a2de381c.json');
const AUD = 'https://oauth2.googleapis.com/token';

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
if (!existsSync(KEY_PATH)) {
  console.error('⬜ the service-account key is not present, so GCP was NOT contacted.');
  console.error('   Exit 2, deliberately distinct from 1.');
  return 2;
}
const KEY = JSON.parse(readFileSync(KEY_PATH, 'utf8'));

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
  const r = await fetch(AUD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
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
for (const [label, url] of PROBES) {
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    problems.push(`${label} — could not be reached (${err.message}); this check cannot conclude.`);
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

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  return 1;
}
console.log(
  `\nverify-free-api-scope — the key is live and every one of ${PROBES.length} project-level reads is ` +
    `denied. [ADR 033]'s fail-closed half holds. The ENABLED-API half is owner-only by construction.`,
);
  return 0;
}

process.exitCode = await main();
