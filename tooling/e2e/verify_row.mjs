// Server-side proof that the app's "add subscription" POST actually landed in
// live D1: counts subscription rows for the E2E user via the Cloudflare D1 HTTP
// API. Fails the job if none exist. Node 20 global fetch only.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, SUBLY_D1_DATABASE_ID,
//      E2E_USER_ID
// NOTE: CLOUDFLARE_API_TOKEN must have D1 read access for this account.

const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('SUBLY_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');
const userId = need('E2E_USER_ID');

const result = await d1(
  'SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?',
  [userId],
);
const n = Number(result?.[0]?.results?.[0]?.n ?? 0);
console.log(`D1 subscriptions for user ${userId}: ${n}`);

if (n < 1) {
  console.error('FAIL: expected >= 1 subscription row created by the E2E run.');
  process.exit(1);
}
console.log('PASS: subscription row confirmed in live D1.');

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
