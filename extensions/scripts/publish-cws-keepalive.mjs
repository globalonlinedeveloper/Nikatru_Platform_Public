#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-cws-keepalive.mjs — the scheduled proof that the Chrome Web Store
// credential the release lane depends on still works.
//
// ⏱ THE ORIGINAL DUTY IS RETIRED, AND SAYING SO IS THE POINT ─────────────────
// This job was written to EXERCISE A REFRESH TOKEN. A Google OAuth refresh token
// issued to a client whose consent screen is in "Testing" expires after seven
// days, and any refresh token that goes unused long enough is revoked — so the
// token needed on release day was exactly the token nothing touched between
// releases. That failure mode NO LONGER EXISTS. As of 2026-09-09 the lane
// authenticates with a service account (see publish-cws-token.mjs and
// https://developer.chrome.com/docs/webstore/service-accounts, fetched
// 2026-09-09): a JWT-bearer assertion is minted fresh on every call, there is no
// long-lived grant to keep warm, and there is no non-use clock to lose a race
// against. A job that "keeps a refresh token alive" would now be keeping alive a
// thing that does not exist and printing OK for it — the exact silence this
// factory treats as worse than a red.
//
// 🔴 THE JOB SURVIVES BECAUSE A DIFFERENT SILENT FAILURE REPLACED THE OLD ONE,
// AND IT IS NOT SMALLER. A service-account key can be disabled, deleted or
// rotated in the Google Cloud console; the account itself can be removed from the
// project; and the API can be disabled on the project. Every one of those is
// instant, invisible from this repository, and discovered on a tag push — on the
// one path that ships bytes — unless something scheduled asks. That is what this
// now does: MINT A TOKEN, on the schedule, with the same module the release uses,
// so a dead credential is a next-morning alarm rather than a release-day surprise.
//
// ⚠️ WHAT IT STILL CANNOT PROVE, STATED SO NOBODY READS MORE INTO A GREEN.
// A minted token proves the KEY authenticates. It does NOT prove the service
// account has been added to the publisher in the Developer Dashboard (Account
// section) — authentication is not authorisation. Measured 2026-09-09 with the
// real publisher id: `GET /v2/publishers/{P}/items/{I}:fetchStatus` answers 403
// PERMISSION_DENIED "…(or it might not exist)" for the REAL publisher and for a
// BOGUS one ALIKE, byte for byte apart from the echoed id, while a bogus token
// answers 401 — so the API deliberately conflates "not your publisher" with "no
// such item", and with ZERO items in the account linkage is unreadable.
// It becomes readable the moment the owner's manual first publish (ADR 067
// decision 8) issues a real listing id: `:fetchStatus` on THAT id returns 200 if
// the account is linked and 403 if it is not. Wiring that probe in here is
// deliberately left until an id exists, because a probe with nothing to point at
// is a probe that always answers the same way.
//
// ── WHAT IT DOES AND DOES NOT FAIL ON ────────────────────────────────────────
// ⏱ 2026-09-25 (EXT-6): the gate is PRESENCE, not arming (keepaliveGate in
// store-poll.mjs, shared with store-key-keepalive.mjs). Before, an unarmed row
// skipped the mint even with the key set — and CWS_SERVICE_ACCOUNT_JSON has been
// set since 2026-09-09 while chrome-webstore is unarmed, so the key was never
// exercised. Now:
//   · the key is SET and the mint FAILS           → exit 1, armed or not. A dead
//     key is somebody's job to re-issue before a release depends on it.
//   · the key is SET and the mint succeeds        → exit 0, printing the account
//     email, the lifetime and the scope, never the token and never the key.
//   · the key is ABSENT and the row is ARMED      → exit 1: the release lane
//     depends on a key that is not there.
//   · the key is ABSENT and the row is NOT ARMED  → exit 0, printing the owner
//     step. [pipeline C-6]: no agent can create these secrets, so failing here
//     would redden a scheduled lane on work only the owner can do.
// SEAM: CWS_OAUTH_TOKEN_URL accepts the canonical token URL or http on loopback
// only (loopbackBase), for the self-test's stub token server; no workflow sets it.
//
// ⚠️ NEVER `process.exit()` AFTER A `fetch` ON WINDOWS (TRAPS shell-12).
//
// Usage:  node scripts/publish-cws-keepalive.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { ArmingCoverageLost, REPO_ROOT } from './publish-arming.mjs';
import { keepaliveGate, loopbackBase, overrideLine } from './store-poll.mjs';

/** --repo-root points the REGISTER READ at another tree, so the gate self-test can
 *  drive a fixture row rather than the live register. */
const rootArg = (() => { const i = process.argv.indexOf('--repo-root'); return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : REPO_ROOT; })();
import { mintAccessToken, CWS_SA_ENV, CWS_SA_DOC, TOKEN_URL } from './publish-cws-token.mjs';

// The gate asks for the ONE value the token mint needs, CWS_SA_ENV (store-poll's
// KEEPALIVE_NAMES). CWS_PUBLISHER_ID is a route segment, not a credential, and
// nothing here addresses a publisher — asking for it would make this job red on
// a value it never uses.

async function main() {
  let result = null;
  try {
    result = keepaliveGate('chrome-webstore', process.env, rootArg);
  } catch (e) {
    if (e instanceof ArmingCoverageLost) {
      console.error('');
      for (const l of e.lines) console.error(l);
      console.error('\ncws-token-keepalive: FAILED');
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  for (const l of result.lines) console.log(l);

  if (result.gate === 'refuse') {
    // Armed with a missing credential: the release lane cannot publish, and the
    // whole point of a scheduled check is to say so on a scheduled run rather
    // than on a tag.
    console.error(`FAIL the register ARMS chrome-webstore and ${CWS_SA_ENV} is absent.`);
    console.error('\ncws-token-keepalive: FAILED');
    process.exitCode = 1;
    return;
  }
  if (result.gate === 'owner-step') {
    console.log(`cws-token-keepalive: NOTHING TO CHECK — ${CWS_SA_ENV} is not set and the register does not arm chrome-webstore.`);
    return;
  }

  // A refused override stops the run before any request, to any host.
  const seam = loopbackBase('CWS_OAUTH_TOKEN_URL', TOKEN_URL);
  if (seam.error !== undefined) {
    console.error(`FAIL ${seam.error}`);
    console.error('\ncws-token-keepalive: FAILED');
    process.exitCode = 1;
    return;
  }
  if (seam.override) console.log(overrideLine('CWS_OAUTH_TOKEN_URL', seam.base));
  const tok = await mintAccessToken({ serviceAccountJson: process.env[CWS_SA_ENV], tokenUrl: seam.base });
  if (!tok.ok) {
    console.error('');
    console.error(`FAIL the service-account token mint returned HTTP ${tok.status}: ${tok.detail}`);
    console.error(`     Source: ${CWS_SA_DOC}. The key in ${CWS_SA_ENV} is set, so a release would use it,`);
    console.error(`     and it is not working. Check it against the`);
    console.error('     Google Cloud console: a disabled, deleted or rotated key fails exactly here, and');
    console.error('     nothing else in the tree would notice before a tag push.');
    console.error('\ncws-token-keepalive: FAILED');
    process.exitCode = 1;
    return;
  }
  console.log(`cws-token-keepalive: OK — access token minted as ${tok.clientEmail}, expires_in ${tok.expiresIn}s, scope ${tok.scope}. The token value and the key are never printed.`);
  console.log('cws-token-keepalive: NOTE — this proves the KEY authenticates, not that it is linked to the publisher.');
  console.log(`cws-token-keepalive: NOTE — linkage becomes measurable once a chrome listingId exists; until then ${CWS_SA_DOC} names the owner step (Developer Dashboard -> Account -> add the service account email).`);
}

await main();
