// Restores both stores to pristine after the E2E run: deletes every D1 row owned
// by the throwaway user (all four tables), then deletes the Supabase auth user.
// Runs even when the test fails (workflow `if: always()`). Node 20 fetch only.
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
// Env: E2E_USER_ID, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
//      SUBLY_D1_DATABASE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// NOTE: CLOUDFLARE_API_TOKEN must have D1 WRITE access for this account.

const userId = process.env.E2E_USER_ID;
if (!userId) {
  console.log('E2E_USER_ID unset (user was never provisioned) — nothing to purge.');
  process.exit(0);
}

const acct = need('CLOUDFLARE_ACCOUNT_ID');
const dbId = need('SUBLY_D1_DATABASE_ID');
const token = need('CLOUDFLARE_API_TOKEN');
const supaUrl = need('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');

let failures = 0;

// Order child-tables first, though all are keyed by user_id so order is cosmetic.
for (const table of ['payment_history', 'subscriptions', 'budget_categories', 'budgets']) {
  try {
    const result = await d1(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
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

if (failures > 0) {
  console.error('Purge finished with warnings — check that prod is pristine.');
  process.exit(1);
}
console.log('Purge complete — D1 rows and the auth user were removed.');

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
