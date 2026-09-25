// Server-side proof that the app's "add subscription" POST actually landed in
// live D1: counts subscription rows for the E2E user via the Cloudflare D1 HTTP
// API. Fails the job if none exist. Node 20 global fetch only.
//
// TRUST-AWARE since 2026-09-22 (re-keyed from the target name 2026-09-25) — the
// expectation and every verdict line live in tooling/e2e/auth_target_expectation.mjs:
//   E2E_WORKERS_TRUST=yes → at least 1 row, exactly as before: the golden path
//            added one.
//   E2E_WORKERS_TRUST=no  → EXACTLY 0 rows. The Workers refuse this run's
//            issuer, so the full walk stops at that refusal before any add. A
//            row means the Worker ACCEPTED a token from an issuer it does not
//            trust (exit 1, a security finding); a count that was never read is
//            exit 2, never 0.
//   unset or anything else → exit 2, "could not decide what to expect". Never
//            defaulted: the two answers expect opposite outcomes.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, SUBSCRIPTIONTRACKER_D1_DATABASE_ID,
//      E2E_USER_ID, E2E_WORKERS_TRUST (written to $GITHUB_ENV by e2e.yml's step
//      "Derive what this run expects")
// NOTE: CLOUDFLARE_API_TOKEN must have D1 read access for this account.
import { decideTrust, expectationLine, rowVerdict, say } from './auth_target_expectation.mjs';

const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('SUBSCRIPTIONTRACKER_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');
const userId = need('E2E_USER_ID');

const auth = decideTrust(process.env.E2E_WORKERS_TRUST);
if (!auth.trust) {
  console.error(auth.why);
  process.exit(2); // safe: this runs BEFORE any request, so no undici handle is open
}
console.log(expectationLine('verify_row', auth.trust));

const result = await d1(
  'SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?',
  [userId],
);
const raw = result?.[0]?.results?.[0]?.n;
const n = Number(raw ?? 0);
console.log(`D1 subscriptions for user ${userId}: ${n}`);

// `exitCode`, not `exit()`: an undici keep-alive handle is open by now, and
// exiting over one crashes libuv on Windows (see verify_purged.mjs's header).
process.exitCode = say(rowVerdict(auth.trust, raw));

async function d1(sql, params) {
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
    console.error(`D1 query failed: HTTP ${res.status}\n${JSON.stringify(json.errors ?? json)}`);
    process.exit(1);
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
