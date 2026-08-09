// ─────────────────────────────────────────────────────────────────────────────
// verify_consent.mjs — the SERVER-SIDE half of the consent leg. Node 20+ global
// fetch only, no SDK.
//
// `integration_test/app_test.dart` proves the DPDP consent prompt comes up on a
// fresh live launch and answers it. That is the whole of what the suite can
// see, and it is less than it looks:
//
//   · `_ConsentPrompt._answer` (app.dart) does NOT await the record call, and
//   · `applyConsentDecision` (state/analytics_providers.dart) treats the consent
//     transport as best-effort BY CONTRACT — "an upload failure must never make
//     the user's choice look rejected".
//
// Both are right for the user. Together they mean a `POST /v1/consent` that 404s
// on an unknown app id, is shed by the rate limiter, is refused by CORS or never
// leaves the browser at all produces EXACTLY the same green run: prompt opens,
// prompt closes, suite continues. The DPDP §6(3) audit trail would simply be
// empty, and nothing anywhere would say so. This file is the thing that says so.
//
// It re-reads `consent_artifacts` in platform_db through the same Cloudflare D1
// HTTP API `verify_row.mjs` and `verify_purged.mjs` use, with no app in the
// loop, and asserts the row the run's own tap should have written:
//
//   · at least one row for (app_id, anon_id)      — the upload reached D1
//   · the newest row has `granted = 0`            — the suite taps "No thanks",
//     and the decision that arrived is the decision that was made
//   · `policy_version` is non-empty               — a record of a tap with no
//     record of what was shown proves nothing
//   · `platform = 'web'`                          — the envelope is the drive's
//   · `consent_id` is non-empty                   — the idempotency key exists
//
// 🔴 `policy_version` IS CHECKED FOR PRESENCE, NEVER FOR A VALUE. The value
// lives in `kPrivacyPolicyVersion` and must equal `data-policy-version` on
// sites/nikatru/privacy.html; `tooling/ci/assert-seams-wired.mjs` already fails
// the build if those two drift. A third copy here would be a constant nobody
// updates, and the day the policy is revised this nightly would go red against
// production for a string it had no business knowing.
//
// ── EXIT CODES, AND WHY THERE ARE THREE ─────────────────────────────────────
//   0 = looked, and the artifact is there and says what the run said.
//   1 = looked, and it is NOT — no row, or a row that disagrees with the tap.
//   2 = COULD NOT LOOK — a missing credential, an unresolvable anon_id, a D1
//       read that answered something this script cannot interpret. Deliberately
//       distinct from 1, because "I could not look" must never be readable as
//       "I looked and it was fine".
//   1 BEATS 2 when both happen: `Math.max` over the codes would report a blind
//   read OVER a confirmed missing artifact, burying the finding that names a
//   real bug under the one that names an access problem. Same contract, and the
//   same ordering, as verify_purged.mjs.
//
// 🔴 `process.exit()` IS BANNED BELOW THE FIRST fetch. Calling it while an
// undici keep-alive handle is open crashes libuv on Windows — `Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING), src/win/async.c:94` — and the process
// then reports 127 instead of the code documented above, collapsing 1 and 2 into
// each other. Set `process.exitCode` and RETURN. Everything above the first
// request may exit directly, and only that.
//
// Env: E2E_APP_ID, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
//      PLATFORM_D1_DATABASE_ID, and ONE OF E2E_RESPONSE_DATA / E2E_DRIVE_LOG
//      (both, normally — see tooling/e2e/consent_anon_id.mjs for the order).
// Argv: --response-data <path> --drive-log <path> override the two env paths.
// NOTE: CLOUDFLARE_API_TOKEN needs D1 READ access for this account.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveConsentAnonId } from './consent_anon_id.mjs';

/** The route whose EFFECT this file audits. Named as a VALUE rather than in
 *  prose because tooling/ci/assert-e2e-legs.mjs reads this harness
 *  COMMENT-STRIPPED: a sentence describing a step is exactly what a nightly
 *  that does not run it would also contain. */
const CONSENT_ROUTE = '/v1/consent';

/** How long the upload is given to land. It is fire-and-forget from a browser
 *  and the assertion runs a whole test suite later, so a miss here is far more
 *  likely to be a genuinely absent row than a slow one — but D1 is eventually
 *  consistent across regions and the edge write is not free, so a bounded wait
 *  costs one page of log and removes the only flake this check could have.
 *  It gates the "does a row exist" question and NOTHING ELSE: a row that is
 *  present and wrong is wrong immediately, and re-reading it would only spend
 *  20 seconds confirming that. */
const ROW_ATTEMPTS = 3;
const ROW_RETRY_MS = 10_000;

const appId = need('E2E_APP_ID');
const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('PLATFORM_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');

const { id: anonId, source, notes } = resolveConsentAnonId({
  responsePath: flag('--response-data') ?? process.env.E2E_RESPONSE_DATA,
  logPath: flag('--drive-log') ?? process.env.E2E_DRIVE_LOG,
});
for (const n of notes) console.log(`  anon_id lookup — ${n}`);
if (!anonId) {
  console.error(
    'COULD NOT LOOK: the run never handed over the anon_id its consent artifact was written ' +
      'under, so there is no key to look the row up by. `consent_artifacts` holds no user id — ' +
      'anon_id is the only handle there is.',
  );
  console.error(
    '  Exit code 2, deliberately distinct from 1: an artifact this step could not FIND must never ' +
      'be reported as an artifact that is missing.',
  );
  process.exit(2); // safe: this runs BEFORE any request, so no undici handle is open
}

console.log(
  `Auditing the effect of POST ${CONSENT_ROUTE} for ${appId} install ${anonId} (from ${source}) — ` +
    'the consent artifact the run answered its own prompt with.',
);

// TWO INDEPENDENT FINDINGS, RESOLVED AT THE END — see the header on 1 beating 2.
let wrong = false; // the artifact is missing, or disagrees with the run
let blind = false; // the read could not be made at all
const worse = (code) => {
  if (code === 1) wrong = true;
  else if (code === 2) blind = true;
};

let rows = null;
for (let attempt = 1; attempt <= ROW_ATTEMPTS; attempt++) {
  // eslint-disable-next-line no-await-in-loop
  const result = await d1(
    `SELECT consent_id, purpose, granted, policy_version, app_version, platform, client_ts, server_ts
       FROM consent_artifacts
      WHERE app_id = ? AND anon_id = ?
      ORDER BY server_ts DESC`,
    [appId, anonId],
  );
  if (result === null) {
    // Back to `null`, not to whatever an earlier attempt saw. An attempt that
    // read zero rows and a later attempt that could not read at all is NOT
    // "the row is absent" — the retry exists precisely because absence at
    // attempt 1 is not yet a finding. d1() has already said why.
    worse(2);
    rows = null;
    break;
  }
  rows = result?.[0]?.results ?? [];
  if (rows.length > 0) break;
  if (attempt < ROW_ATTEMPTS) {
    console.log(`no row yet (attempt ${attempt}/${ROW_ATTEMPTS}) — waiting ${ROW_RETRY_MS / 1000}s`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, ROW_RETRY_MS));
  }
}

if (rows !== null && rows.length === 0) {
  console.error(
    `FAIL: no consent artifact exists for ${appId} install ${anonId} after ` +
      `${ROW_ATTEMPTS} attempts over ${((ROW_ATTEMPTS - 1) * ROW_RETRY_MS) / 1000}s. The suite answered ` +
      'the prompt and the app recorded the decision on-device, so the DECISION is not in doubt — what ' +
      `is missing is the server-side record of it. The upload is fire-and-forget, so ${CONSENT_ROUTE} ` +
      'answering 404 (unknown_app), 429 (shed), 503 (consent_failed), or the request never leaving the ' +
      'browser at all, are all invisible from inside the app and all produce exactly this. The DPDP ' +
      '§6(3) trail for this install is empty.',
  );
  worse(1);
} else if (rows !== null) {
  const newest = rows[0];
  console.log(
    `consent artifacts for this install: ${rows.length} — newest: ` +
      `purpose=${newest.purpose} granted=${newest.granted} policy_version=${newest.policy_version} ` +
      `platform=${newest.platform} app_version=${newest.app_version} server_ts=${newest.server_ts}`,
  );

  // 🔴 `granted` IS ASSERTED 0 BECAUSE THE SUITE TAPS "No thanks", AND THE TAP
  // IS THE DELIBERATE ONE. `applyConsentDecision` records AND uploads for either
  // answer, so declining exercises the identical seam without pointing a nightly
  // stream of CI analytics at production. A 1 here therefore does not mean
  // somebody was too generous — it means the decision that arrived is not the
  // decision that was made, which is the failure a consent record exists to
  // rule out.
  if (Number(newest.granted) !== 0) {
    console.error(
      `FAIL: the newest artifact says granted=${newest.granted}, but the suite tapped "No thanks". ` +
        'The record does not match the decision, which is the one thing a consent trail must never do.',
    );
    worse(1);
  }
  if (!newest.policy_version) {
    console.error(
      'FAIL: the artifact carries no policy_version. A record that someone tapped a button, with no ' +
        'record of what they were shown, establishes nothing — which is the whole purpose of the row.',
    );
    worse(1);
  }
  if (newest.platform !== 'web') {
    console.error(
      `FAIL: the artifact's platform is ${JSON.stringify(newest.platform)}, not "web". This leg runs ` +
        'in headless Chrome, so an envelope from anywhere else means this row belongs to a different ' +
        'install and the one this run wrote is not here.',
    );
    worse(1);
  }
  if (!newest.consent_id) {
    console.error(
      'FAIL: the artifact carries no consent_id. It is the UNIQUE key the route dedups a retried ' +
        'upload on, so a row without one cannot be idempotent and was not written by this client.',
    );
    worse(1);
  }
}

if (wrong) {
  console.error(
    'The consent leg is BROKEN against production: the app asked, the user answered, and the ' +
      'append-only record either did not arrive or does not say what happened.',
  );
  if (blind) {
    console.error(
      '  (Another read in this audit also could not be made, so the damage above may be the smaller ' +
        'half of it.)',
    );
  }
} else if (blind) {
  console.error(
    'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the consent artifact ' +
      'landed. Exit 2 is deliberately not 1: fix the access, then re-run.',
  );
} else {
  console.log(
    'PASS: the consent decision this run made really reached the append-only record — the artifact is ' +
      'in platform_db, it says what the run said, and it names the policy the user was shown.',
  );
}

// `exitCode`, not `exit()` — see the header. Undici keep-alives are open by now.
process.exitCode = wrong ? 1 : blind ? 2 : 0;

// ── helpers ─────────────────────────────────────────────────────────────────

/** One D1 HTTP query. Returns `json.result`, or `null` after printing why —
 *  never throws, because a thrown error here would end the run before the
 *  findings above had been reported. */
async function d1(sql, params) {
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sql, params }),
      },
    );
  } catch (e) {
    console.error(`COULD NOT LOOK: the D1 HTTP API was unreachable (${e.message}).`);
    return null;
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    console.error(`COULD NOT LOOK: D1 answered HTTP ${res.status} with a body that is not JSON (${e.message}).`);
    return null;
  }
  if (!res.ok || !json.success) {
    console.error(
      `COULD NOT LOOK: D1 query failed — HTTP ${res.status} ${JSON.stringify(json.errors ?? json)}`,
    );
    return null;
  }
  return json.result;
}

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That exact off-by-one shipped in assert-gate-passed.mjs and blocked both
// production deploys with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`COULD NOT LOOK: missing required env var ${name}.`);
    console.error(
      '  Exit code 2, deliberately distinct from 1: a credential this step could not read must ' +
        'never be reported as a consent record that verified.',
    );
    process.exit(2); // safe: this runs BEFORE any request, so no undici handle is open
  }
  return v;
}
