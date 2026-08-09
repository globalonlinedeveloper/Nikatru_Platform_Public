// Restores both stores to pristine after the E2E run: deletes every D1 row owned
// by the throwaway user (all four tables), then deletes the Supabase auth user,
// and — when the run exported one — the consent artifact the drive wrote into
// platform_db. Runs even when the test fails (workflow `if: always()`). Node 20
// fetch only.
//
// ⚠️ IT IS RUN ONCE PER THROWAWAY USER, AND ONE OF THEM IS ALREADY GONE.
// Since [pipeline N-6 leg 6] the nightly provisions a SECOND user whose account
// the app itself deletes from inside the running build, so this teardown's
// normal outcome for that id is "0 row(s)" on every table and HTTP 404 from the
// identity delete. Both are already the success path below — the D1 DELETEs are
// unconditional and report `changes: 0`, and 404 has always been forgiven — so
// nothing here needed loosening to become idempotent; it already was, and the
// 404 branch now SAYS which case it is rather than passing in silence.
//
// It still has to run for that user: the deletion happens at the END of the
// suite, and a run that fails before it (or fails the deletion itself) leaves a
// live account and its rows in production. A teardown that assumed the app had
// already cleaned up would strand exactly the users a red night creates.
//
// 🔴 THE CONSENT ARTIFACT IS DELETED TOO, AND THAT IS A DECISION, NOT HOUSEKEEPING.
// Every nightly answers the DPDP prompt on its first launch, so every nightly
// writes a `granted=0` row into platform_db's `consent_artifacts` — measured
// 2026-08-09: four of them on that day alone, all stamped `app_version=dev`,
// none belonging to any human. Two reasons they cannot be left there:
//
//   1. `analyticsLiveness` in services/platform/src/scheduled.ts uses this exact
//      table as its FOURTH liveness signal, on the stated grounds that "a consent
//      row exists only because a human answered a consent prompt in a shipped
//      build". CI is not a human. Left to accumulate, the nightly manufactures
//      the very evidence that alarm reads as reach, and `consents>0 && events=0`
//      — "REACH PROVEN WITH ZERO ARRIVALS" — becomes a sentence about the test
//      harness. A monitor fed by its own test data has stopped monitoring.
//   2. It is the same rule as every other row this file removes: a live proof
//      that writes to production leaves production as it found it.
//
// This is NOT a hole in the DPDP audit trail. The trail is append-only for DATA
// PRINCIPALS, and the id being deleted here is one the run minted seconds
// earlier in a throwaway browser profile that no person ever used — the same
// standing as the throwaway user whose subscriptions are deleted above it. The
// DELETE is bound to `app_id` AND that single `anon_id`, and the id is refused
// unless it has the exact shape the app mints (tooling/e2e/consent_anon_id.mjs),
// so it cannot widen into anyone else's record.
//
// It runs AFTER tooling/e2e/verify_consent.mjs, necessarily — that step exists
// to find this row, and a teardown that ran first would make the audit fail on
// an upload that worked.
//
// Env: E2E_USER_ID, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
//      SUBLY_D1_DATABASE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      and, for the consent artifact only: E2E_APP_ID, PLATFORM_D1_DATABASE_ID,
//      E2E_RESPONSE_DATA / E2E_DRIVE_LOG (the run's exported anon_id).
// NOTE: CLOUDFLARE_API_TOKEN must have D1 WRITE access for this account.
import { resolveConsentAnonId } from './consent_anon_id.mjs';

const userId = process.env.E2E_USER_ID;

// Resolved BEFORE the early exit below, because the two are independent: the
// consent artifact belongs to the browser PROFILE, not to either throwaway user,
// so a run that never provisioned one can still have written it.
const consent = process.env.PLATFORM_D1_DATABASE_ID
  ? resolveConsentAnonId({
      responsePath: process.env.E2E_RESPONSE_DATA,
      logPath: process.env.E2E_DRIVE_LOG,
    })
  : { id: null, source: null, notes: ['PLATFORM_D1_DATABASE_ID unset — this step does not purge consent'] };

if (!userId && !consent.id) {
  console.log('E2E_USER_ID unset and no consent anon_id exported — nothing to purge.');
  for (const n of consent.notes) console.log(`  anon_id lookup — ${n}`);
  process.exit(0);
}

const acct = need('CLOUDFLARE_ACCOUNT_ID');
const token = need('CLOUDFLARE_API_TOKEN');

// ⚠️ EVERY `need()` IS RESOLVED HERE, ABOVE THE FIRST REQUEST, and that is the
// same rule verify_purged.mjs's header states: `process.exit()` while an undici
// keep-alive handle is open crashes libuv on Windows and the process reports 127
// instead of the code that was asked for. Hoisting the credential checks keeps
// the only `exit()` calls in this file on the side of the first fetch where they
// are safe.
const dbId = userId ? need('SUBLY_D1_DATABASE_ID') : null;
const supaUrl = userId ? need('SUPABASE_URL').replace(/\/+$/, '') : null;
const serviceKey = userId ? need('SUPABASE_SERVICE_ROLE_KEY') : null;
const appId = consent.id ? need('E2E_APP_ID') : null;

let failures = 0;

if (userId) {
  // Order child-tables first, though all are keyed by user_id so order is cosmetic.
  for (const table of ['payment_history', 'subscriptions', 'budget_categories', 'budgets']) {
    try {
      const result = await d1(dbId, `DELETE FROM ${table} WHERE user_id = ?`, [userId]);
      const changes = result?.[0]?.meta?.changes ?? 0;
      console.log(`purged ${table}: ${changes} row(s)`);
    } catch (e) {
      failures++;
      console.error(`WARN: failed to purge ${table}: ${e.message}`);
    }
  }

  const del = await fetch(`${supaUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  console.log(
    del.status === 404
      ? 'auth user delete: HTTP 404 — the identity was already gone (expected when the suite deleted this account from inside the app)'
      : `auth user delete: HTTP ${del.status}`,
  );
  if (!del.ok && del.status !== 404) {
    failures++;
    console.error(`WARN: user delete returned ${del.status}\n${await del.text()}`);
  }
} else {
  console.log('E2E_USER_ID unset (user was never provisioned) — no subly_db rows or identity to purge.');
}

if (consent.id) {
  try {
    const result = await d1(
      process.env.PLATFORM_D1_DATABASE_ID,
      'DELETE FROM consent_artifacts WHERE app_id = ? AND anon_id = ?',
      [appId, consent.id],
    );
    const changes = result?.[0]?.meta?.changes ?? 0;
    console.log(`purged consent_artifacts for install ${consent.id} (${consent.source}): ${changes} row(s)`);
  } catch (e) {
    failures++;
    console.error(`WARN: failed to purge the consent artifact for install ${consent.id}: ${e.message}`);
  }
} else {
  // PRINTED, not silent. "No consent row was deleted" and "no consent row could
  // be identified" are different states, and only one of them leaves something
  // behind in production.
  console.log('no consent anon_id resolved — no consent artifact purged:');
  for (const n of consent.notes) console.log(`  anon_id lookup — ${n}`);
}

if (failures > 0) {
  console.error('Purge finished with warnings — check that prod is pristine.');
  // `exitCode`, not `exit()`: undici keep-alives are open by this line. See the
  // note above the hoisted `need()` calls.
  process.exitCode = 1;
} else {
  console.log('Purge complete.');
}

async function d1(dbId, sql, params) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`HTTP ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}
