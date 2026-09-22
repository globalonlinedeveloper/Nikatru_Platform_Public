// Server-side proof that the app's "add subscription" POST actually landed in
// live D1: counts subscription rows for the E2E user via the Cloudflare D1 HTTP
// API. Fails the job if none exist. Node 20 global fetch only.
//
// TARGET-AWARE since 2026-09-22 — the expectation and every verdict line live in
// tooling/e2e/auth_target_expectation.mjs:
//   hosted → at least 1 row, exactly as before: the golden path added one.
//   boxa   → EXACTLY 0 rows. Until the Phase 5 cutover the Worker refuses a Box A
//            session, so the full walk stops at that refusal before any add. A
//            row means the Worker ACCEPTED a Box A token (exit 1, a security
//            finding); a count that was never read is exit 2, never 0.
//   unset or anything else → exit 2, "could not decide what to expect". Never
//            defaulted to hosted: the two targets expect opposite answers.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, SUBSCRIPTIONTRACKER_D1_DATABASE_ID,
//      E2E_USER_ID, E2E_AUTH_TARGET (written to $GITHUB_ENV by e2e.yml's preflight)
// NOTE: CLOUDFLARE_API_TOKEN must have D1 read access for this account.
import { decideAuthTarget, expectationLine, rowVerdict, say } from './auth_target_expectation.mjs';

const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('SUBSCRIPTIONTRACKER_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');
const userId = need('E2E_USER_ID');

const auth = decideAuthTarget(process.env.E2E_AUTH_TARGET);
if (!auth.target) {
  console.error(auth.why);
  process.exit(2); // safe: this runs BEFORE any request, so no undici handle is open
}
console.log(expectationLine('verify_row', auth.target));

const result = await d1(
  'SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?',
  [userId],
);
const raw = result?.[0]?.results?.[0]?.n;
const n = Number(raw ?? 0);
console.log(`D1 subscriptions for user ${userId}: ${n}`);

// `exitCode`, not `exit()`: an undici keep-alive handle is open by now, and
// exiting over one crashes libuv on Windows (see verify_purged.mjs's header).
process.exitCode = say(rowVerdict(auth.target, raw));

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
