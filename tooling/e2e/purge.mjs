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
//      SUBSCRIPTIONTRACKER_D1_DATABASE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      and, for the consent artifact only: E2E_APP_ID, PLATFORM_D1_DATABASE_ID,
//      E2E_RESPONSE_DATA / E2E_DRIVE_LOG (the run's exported anon_id).
//      E2E_APP_VERSION is OPTIONAL and is read for its message only — it is the
//      `e2e-<run_number>-<sha7>` stamp e2e.yml derives once into $GITHUB_ENV, and
//      it is what the failure below can point a human at.
//      E2E_CONSENT_LEDGER (added 2026-09-23) is the STORE CAPTURE's consent
//      source: the ledger tooling/store/capture-play-screenshots.mjs writes, one
//      entry per drive, read by resolveCaptureConsentIds. It is MUTUALLY EXCLUSIVE
//      with E2E_RESPONSE_DATA / E2E_DRIVE_LOG (the nightly's single-drive
//      sources), and it requires PLATFORM_D1_DATABASE_ID: either mix is a wiring
//      defect and is refused before any request is made. Since 2026-09-25 a
//      ledger also refuses a PRODUCTION database id in PLATFORM_D1_DATABASE_ID
//      or SUBSCRIPTIONTRACKER_D1_DATABASE_ID: a store capture drives the sandbox
//      Workers (tooling/store/capture-backend.mjs), so its rows are in the
//      sandbox databases, and its purge has no business in production's.
//
// 🔴 PLATFORM_D1_DATABASE_ID IS THE SWITCH THAT SAYS "THIS INVOCATION OWNS THE
// CONSENT ARTIFACT", and it decides whether an unresolved anon_id is a failure
// or a no-op. e2e.yml runs this file TWICE per leg and hands the consent env to
// exactly one of them; see the branch at the bottom for why that asymmetry is
// the only thing keeping the hard failure off a green run.
// NOTE: CLOUDFLARE_API_TOKEN must have D1 WRITE access for this account.
import { resolveConsentAnonId, resolveCaptureConsentIds } from './consent_anon_id.mjs';
import { stampDeletable } from './app-version-stamp.mjs';
import { sandboxBackend, productionD1Ids, CaptureBackendRefused } from '../store/capture-backend.mjs';

const userId = process.env.E2E_USER_ID;

// The store capture's consent source (see the env header). All three refusals
// below run before the first request, so `process.exit()` is still safe here.
const ledgerPath = process.env.E2E_CONSENT_LEDGER || null;
if (ledgerPath && (process.env.E2E_RESPONSE_DATA || process.env.E2E_DRIVE_LOG)) {
  console.error(
    "REFUSED: E2E_CONSENT_LEDGER (the store capture's consent source) is set together with " +
      "E2E_RESPONSE_DATA / E2E_DRIVE_LOG (the e2e nightly's). The two describe different drives, and a " +
      'purge that read both could delete by one and report on the other. This is a wiring defect in the ' +
      'calling step; nothing was purged.',
  );
  process.exit(1);
}
if (ledgerPath && !process.env.PLATFORM_D1_DATABASE_ID) {
  console.error(
    'REFUSED: E2E_CONSENT_LEDGER is set but PLATFORM_D1_DATABASE_ID is not. A ledger exists only to purge ' +
      'the consent rows a capture wrote into platform_db, so this step would skip the very purge it was ' +
      'wired for and still pass. Nothing was purged.',
  );
  process.exit(1);
}
// The third refusal (O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS, 2026-09-25): the
// production ids are the top-level D1 ids of both Workers' wrangler.jsonc, as
// sandboxBackend() reads them. A backend it refuses is refused here too, since
// a purge that cannot tell production from sandbox has no safe target.
if (ledgerPath) {
  let productionIds;
  try {
    productionIds = productionD1Ids(sandboxBackend());
  } catch (e) {
    if (!(e instanceof CaptureBackendRefused)) throw e;
    console.error(
      `REFUSED: E2E_CONSENT_LEDGER is set, and the capture backend could not be read (${e.message}). ` +
        'Without it this step cannot tell a production database id from a sandbox one. Nothing was purged.',
    );
    process.exit(1);
  }
  for (const key of ['PLATFORM_D1_DATABASE_ID', 'SUBSCRIPTIONTRACKER_D1_DATABASE_ID']) {
    if (process.env[key] && productionIds.has(process.env[key])) {
      console.error(
        `REFUSED: E2E_CONSENT_LEDGER is set and ${key} is ${process.env[key]}, a PRODUCTION database. ` +
          'A store capture drives the sandbox Workers, so its rows are in the sandbox databases; pointing ' +
          'its purge at production would delete by its ids where it wrote nothing. Nothing was purged.',
      );
      process.exit(1);
    }
  }
}

// Resolved BEFORE the early exit below, because the two are independent: the
// consent artifact belongs to the browser PROFILE, not to either throwaway user,
// so a run that never provisioned one can still have written it.
const capture = process.env.PLATFORM_D1_DATABASE_ID && ledgerPath ? resolveCaptureConsentIds(ledgerPath) : null;
const consent = capture
  ? { id: null, source: null, notes: [] }
  : process.env.PLATFORM_D1_DATABASE_ID
    ? resolveConsentAnonId({
        responsePath: process.env.E2E_RESPONSE_DATA,
        logPath: process.env.E2E_DRIVE_LOG,
      })
    : { id: null, source: null, notes: ['PLATFORM_D1_DATABASE_ID unset — this step does not purge consent'] };

// The build identity the run stamped into every row it wrote: e2e.yml's
// `e2e-<run_number>-<sha7>` (derived ONCE into $GITHUB_ENV, added 2026-08-28),
// or the capture's `cap-<run_number>-<sha7>` as its ledger records it (added
// 2026-09-23). For e2e it is still message-only — nothing looks a row up by it
// and nothing deletes by it; it is the WHERE-TO-LOOK the failure below hands a
// human, and it is unique to one run, which `dev` never was. For a CAPTURE the
// stamp delete further down DOES delete by it; the comment there says why that
// is safe for `cap-*` and never for `e2e-*`.
const stamp = process.env.E2E_APP_VERSION ?? capture?.stamp ?? null;

// Every anon_id this invocation deletes by: each drive's id for a capture, the
// one resolved id for the nightly.
const ids = capture ? capture.ids : consent.id ? [consent.id] : [];
const idSource = capture ? `capture ledger ${ledgerPath}` : consent.source;

// ⚠️ THE `!PLATFORM_D1_DATABASE_ID` CONJUNCT IS LOAD-BEARING AND WAS ADDED WITH
// THE HARD FAILURE BELOW (2026-08-28). Without it this early exit is a hole
// straight through that failure: a run whose provisioning died halfway leaves
// `E2E_USER_ID` empty, the purge step still runs (`steps.user.outcome !=
// 'skipped'` is true once provisioning was ATTEMPTED), and "nothing to purge"
// would have been printed at exit 0 over a consent purge that was asked for and
// could not be performed. An early exit that outranks the guard below is the
// same defect in a different place.
if (!userId && !consent.id && !process.env.PLATFORM_D1_DATABASE_ID) {
  console.log('E2E_USER_ID unset and no consent purge was asked for — nothing to purge.');
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
const dbId = userId ? need('SUBSCRIPTIONTRACKER_D1_DATABASE_ID') : null;
const supaUrl = userId ? need('SUPABASE_URL').replace(/\/+$/, '') : null;
const serviceKey = userId ? need('SUPABASE_SERVICE_ROLE_KEY') : null;
// A capture needs it even with zero ids: the stamp delete below binds it too.
const appId = ids.length > 0 || capture ? need('E2E_APP_ID') : null;

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
  console.log('E2E_USER_ID unset (user was never provisioned) — no subscriptiontracker_db rows or identity to purge.');
}

for (const id of ids) {
  try {
    const result = await d1(
      process.env.PLATFORM_D1_DATABASE_ID,
      'DELETE FROM consent_artifacts WHERE app_id = ? AND anon_id = ?',
      [appId, id],
    );
    const changes = result?.[0]?.meta?.changes ?? 0;
    console.log(`purged consent_artifacts for install ${id} (${idSource}): ${changes} row(s)`);
  } catch (e) {
    failures++;
    console.error(`WARN: failed to purge the consent artifact for install ${id}: ${e.message}`);
  }
}

if (capture) {
  // 🔴 THE STAMP DELETE — A CAPTURE ONLY, AND THE ASYMMETRY IS THE POINT (added
  // 2026-09-23). A `cap-<run_number>-<sha7>` stamp is unique to ONE
  // store-screenshots.yml run; every row carrying it was written by that run's
  // own drives in throwaway profiles; all four jobs of the run are residue by
  // construction; and nothing reads these rows back to verify them. So deleting
  // by (app_id, app_version) removes exactly this run's rows — including those
  // whose anon_id no drive lived long enough to report — and nobody else's.
  // `stampDeletable` admits only `cap-*` and `rehearsal-*`, never `dev`.
  //
  // It is NEVER done for e2e, and `stampDeletable` refuses `e2e-*` to keep it
  // that way (consent-anon-id.test.mjs pins the refusal). The nightly's matrix
  // legs share one stamp, and
  // tooling/e2e/verify_consent.mjs reads the row back, so a stamp delete there
  // would race another leg's audit and delete the row that leg is about to prove.
  let removed = 0;
  if (stampDeletable(capture.stamp)) {
    try {
      const result = await d1(
        process.env.PLATFORM_D1_DATABASE_ID,
        'DELETE FROM consent_artifacts WHERE app_id = ? AND app_version = ?',
        [appId, capture.stamp],
      );
      const changes = result?.[0]?.meta?.changes ?? 0;
      removed += changes;
      console.log(`purged consent_artifacts stamped app_version = '${capture.stamp}': ${changes} row(s)`);
    } catch (e) {
      failures++;
      console.error(`WARN: failed to purge consent_artifacts stamped '${capture.stamp}': ${e.message}`);
    }
    try {
      const result = await d1(
        process.env.PLATFORM_D1_DATABASE_ID,
        'DELETE FROM events WHERE app_id = ? AND app_version = ?',
        [appId, capture.stamp],
      );
      const changes = result?.[0]?.meta?.changes ?? 0;
      removed += changes;
      console.log(`purged events stamped app_version = '${capture.stamp}': ${changes} row(s)`);
    } catch (e) {
      failures++;
      console.error(`WARN: failed to purge events stamped '${capture.stamp}': ${e.message}`);
    }
  } else {
    console.log(
      `no stamp delete: the ledger's stamp ${JSON.stringify(capture.stamp)} is not a capture stamp ` +
        '(only cap-* and rehearsal-* are ever deleted by app_version)',
    );
  }
  for (const n of capture.notes) console.log(`  capture ledger — ${n}`);
  if (capture.unresolved.length > 0) {
    // Still RED after the stamp delete has run: the residue it could reach is
    // gone, but a drive whose id is unknown is exactly the state in which
    // removal is not PROVEN — the same rule as the nightly's hard failure below.
    failures++;
    console.error(
      `WARN: ${capture.unresolved.length} capture drive(s) left no usable consent anon_id, so this teardown ` +
        'cannot show production is pristine. ' +
        (stampDeletable(capture.stamp)
          ? `The stamp delete DID run and removed ${removed} row(s) stamped '${capture.stamp}'; a row it ` +
            'could not reach was written under some other stamp.'
          : `The stamp delete did NOT run (stamp ${JSON.stringify(capture.stamp)}), so look for ` +
            `app_id = '${appId}' rows from this run by hand.`),
    );
    for (const u of capture.unresolved) console.error(`  unresolved — ${u}`);
  }
} else if (!consent.id && process.env.PLATFORM_D1_DATABASE_ID) {
  // 🔴 A HARD FAILURE SINCE 2026-08-28. IT WAS A PRINTED LINE THAT PASSED, AND
  // THAT IS WHAT LET SIX ROWS SIT IN PRODUCTION FOR A DAY.
  // Two scheduled runs re-run on 2026-08-27 replayed their own OLD commit, which
  // predates #399's `ref`-after-`await` fix, so attempt 2 of each CRASHED after
  // the consent POST and before the driver exported the anon_id. This branch
  // printed its notes, left `failures` at 0, and both nightlies reported success
  // — while `consent_artifacts` held three rows apiece until ops-watch run
  // 33139423096 went red on 2026-08-28 and a different workflow's owner had to
  // work out what had written them. Full record:
  // Private/pre-minimal-2026-09-08:notes/EVIDENCE-consent-artifacts-dev-rows-2026-08-28.md.
  //
  // [pipeline B-17] asks that every artifact a live verification creates be
  // PROVABLY removed. "I could not identify the row" is precisely the state in
  // which removal is not proven — whether or not a row exists — so it is the
  // teardown's own failure to report, not a detail to log.
  //
  // ⚠️ THE FALSE-POSITIVE QUESTION, ANSWERED RATHER THAN ASSUMED. Two states
  // reach a null anon_id benignly, and only ONE of them is separable from what
  // the harness records:
  //   (a) this invocation was never asked to purge consent — the delete-leg
  //       teardown in e2e.yml carries no PLATFORM_D1_DATABASE_ID and no consent
  //       env at all, so "nothing resolved" is its NORMAL outcome on a perfectly
  //       green night. That is the `else` below, and failing there would have
  //       reded every single run. Separable, and separated.
  //   (b) the suite died before the app ever rendered the DPDP prompt (a failed
  //       build, a dead chromedriver, a web-server that never came up), so no
  //       row was written and nothing was left behind. 🔴 NOT SEPARABLE. Both
  //       of resolveConsentAnonId's sources are absent in that state AND in the
  //       crash-after-POST state; `_ConsentPrompt._answer` deliberately does not
  //       await the record call, so nothing host-side observes the POST; and the
  //       only token the harness writes is printed by the driver at the END of
  //       the suite. This branch does NOT guess between them.
  //
  // Failing closed is still the version that cannot red a healthy run, and the
  // reason is the ORDER of the workflow rather than anything measured here:
  // tooling/e2e/verify_consent.mjs runs BEFORE this teardown, is not `if:`-gated,
  // and resolves the SAME id through the SAME parser (consent_anon_id.mjs). So a
  // run that reached the suite and stayed green has already resolved the id and
  // never reaches this line; every path that does reach it is a run that is
  // ALREADY FAILING. The cost is one more red step on an already-red run.
  //
  // 📌 THE RESIDUAL GAP, STATED SO NOBODY HAS TO REDISCOVER IT: this message
  // cannot promise a row was left behind — only that this teardown could not
  // prove one was not. It is worded that way on purpose. Closing it properly
  // needs the app or the driver to record the POST at the moment it is made,
  // which is a change to files this teardown does not own.
  failures++;
  console.error(
    'WARN: no consent anon_id resolved — NO CONSENT ARTIFACT WAS PURGED, and this teardown cannot show ' +
      'production is pristine. If the suite reached the DPDP prompt before it died, a row is still in ' +
      `platform_db \`consent_artifacts\`. Look for app_id = '${process.env.E2E_APP_ID ?? '(E2E_APP_ID unset)'}'` +
      (stamp
        ? ` AND app_version = '${stamp}' — that value is unique to this run, so it names exactly the rows this run wrote and no others.`
        : ' — and note that E2E_APP_VERSION is UNSET for this run, so any row it wrote carries the compile-time default `dev` and cannot be told apart from another run\'s. Bound any deletion by `consent_id` literals, never by `app_version`.'),
  );
  for (const n of consent.notes) console.error(`  anon_id lookup — ${n}`);
} else if (!consent.id) {
  // PRINTED, not silent, and NOT a failure. This is case (a) above: no
  // PLATFORM_D1_DATABASE_ID means this invocation was never handed the consent
  // env, which is the delete-leg teardown's every-run state.
  console.log('no consent anon_id resolved — this step does not purge consent (PLATFORM_D1_DATABASE_ID unset):');
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
