// The requests tooling/e2e/purge.mjs makes, and the retry they make them under.
// Split out of purge.mjs (which runs on import) so a test can drive every one of
// them through a fake transport.
//
// 🔴 WHY THIS FILE EXISTS: native-auth-proof run 36739638735 (main 0008ed54).
// All five targets PROVED sign-in; then the Windows leg's purge printed
// "purged budgets: 0 row(s)" and died on the Supabase identity DELETE with
// `TypeError: fetch failed [cause]: SocketError: other side closed` — an
// uncaught exception from a bare `fetch`, so one dropped connection turned a
// proven leg red and left the identity (and every consent step after it)
// unpurged. The D1 DELETEs had the same bare `fetch`, only inside a try.
//
// Every request now goes through tooling/ops/bounded-retry.mjs, the repo's one
// reading of "blip or outage": a dropped wire, HTTP 429 and HTTP 5xx are asked
// again (3 attempts, 1 s then 2 s, `Retry-After` honoured up to 5 s); every
// other 4xx is an ANSWER and is failed on first sight. Each attempt carries the
// module's per-request ceiling (REQUEST_TIMEOUT_MS, 15 s) on the fetch's signal,
// so a server that accepts the connection and never answers ends the attempt
// rather than the job. A failure that outlives the plan is still a failure: the
// caller counts it and purge.mjs exits 1 naming what was not purged.
//
// 🔴 WHY A RETRY IS SAFE HERE, ALTHOUGH EVERY REQUEST IS A WRITE. Each one is
// an IDEMPOTENT delete bound to ids this run minted:
//   · D1 `DELETE FROM <table> WHERE user_id = ?` (and the consent/stamp deletes)
//     — re-running it after a lost response deletes nothing more; the rows are
//     keyed by one throwaway id, so a second pass can only find fewer of them.
//     The one cost: when the lost attempt DID execute, the answering attempt
//     reports `changes: 0`, so a logged count can read low. It can never read
//     a row as deleted that is still there — verify_purged.mjs is the audit.
//   · Supabase `DELETE /auth/v1/admin/users/<id>` — a second delete of an
//     identity the first one removed answers 404, which is already the success
//     path (the in-app delete leg's normal outcome).
// No request here creates anything, so no retry can create a second of it.
import {
  readWithBoundedRetry,
  classifyThrown,
  isTransientStatus,
  transientLook,
  retryAfterMs,
  RETRY_BASE_MS,
} from '../ops/bounded-retry.mjs';

/** The backoff base. E2E_PURGE_RETRY_BASE_MS exists for the spawned tests and
 *  may only SHORTEN it (the VERIFY_FREE_API_SCOPE_RETRY_MS precedent): a knob
 *  that could lengthen it would let a caller push the purge past its step. */
export function purgeRetryBaseMs(env = process.env) {
  const n = Number(env.E2E_PURGE_RETRY_BASE_MS);
  return Number.isFinite(n) && n >= 0 ? Math.min(RETRY_BASE_MS, n) : RETRY_BASE_MS;
}

/**
 * ONE request under the shared plan. The body is read INSIDE the attempt, so a
 * connection that closes mid-body is retried like one that closed before the
 * headers. Resolves to `{ status, ok, text }`; a non-transient answer (any
 * 2xx–4xx) is returned for the caller to judge, never thrown.
 */
async function request(fetchImpl, url, init, what, retry) {
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    let text;
    try {
      res = await fetchImpl(url, { ...init, signal });
      text = await res.text();
    } catch (err) {
      throw classifyThrown(err, `${what}: the request did not answer (${err?.name ?? 'error'}: ${err?.message ?? err})`);
    }
    if (isTransientStatus(res.status)) {
      throw transientLook(`${what}: HTTP ${res.status}`, { retryAfterMs: retryAfterMs(res) });
    }
    return { status: res.status, ok: res.ok, text };
  }, retry);
}

/**
 * The purge's two request kinds, bound to its credentials.
 * `fetchImpl` and `sleep` are the test seams; production passes neither.
 */
export function purgeClient({ acct, token, supaUrl, serviceKey, fetchImpl = fetch, sleep, note, env = process.env }) {
  const retry = { baseMs: purgeRetryBaseMs(env), note: note ?? ((line) => console.log(`  retry — ${line}`)) };
  if (sleep) retry.sleep = sleep;

  return {
    /** A D1 query. Throws on a failed answer or an exhausted retry. */
    async d1(dbId, sql, params, what = 'D1 query') {
      const res = await request(
        fetchImpl,
        `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sql, params }),
        },
        what,
        retry,
      );
      let json;
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new Error(`HTTP ${res.status}, and the body is not JSON: ${res.text.slice(0, 200)}`);
      }
      if (!res.ok || !json.success) {
        throw new Error(`HTTP ${res.status} ${JSON.stringify(json.errors ?? json)}`);
      }
      return json.result;
    },

    /** The Supabase admin delete. Resolves to `{ status, ok, text }`; 404 is the caller's to forgive. */
    async deleteAuthUser(userId) {
      return request(
        fetchImpl,
        `${supaUrl}/auth/v1/admin/users/${userId}`,
        { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        'auth user delete',
        retry,
      );
    },

    /** One page of the Supabase admin user list (tooling/e2e/purge_stale.mjs).
     *  A READ, so a retry is safe. `filter` only narrows what GoTrue returns; the
     *  caller still holds every row to its own exact shape. Throws on a non-2xx
     *  answer, an exhausted retry, or a body with no `users` list. */
    async listAuthUsers({ page, perPage, filter }) {
      const q = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (filter) q.set('filter', filter);
      const res = await request(
        fetchImpl,
        `${supaUrl}/auth/v1/admin/users?${q}`,
        { method: 'GET', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        'auth user list',
        retry,
      );
      if (!res.ok) throw new Error(`auth user list: HTTP ${res.status}`);
      let json;
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new Error(`auth user list: HTTP ${res.status}, and the body is not JSON`);
      }
      if (!Array.isArray(json?.users)) throw new Error('auth user list: the answer carries no `users` list');
      return json.users;
    },
  };
}

/** D1 cannot bind a table name, so each one is checked where the DELETE is
 *  built. purge.mjs applies the same test above its first request, where a
 *  refusal can still exit; this copy is what the DELETE below relies on. */
export const PLAIN_TABLE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Deletes the user's rows from every table; returns how many tables FAILED.
 *  A failure names its table, and the loop goes on to the next one. */
export async function purgeUserTables(client, { dbId, userTables, userId, log = console.log, warn = console.error }) {
  let failures = 0;
  // The register lists child tables first, though all are keyed by user_id so
  // order is cosmetic.
  for (const table of userTables) {
    if (!PLAIN_TABLE.test(table)) {
      failures++;
      warn(`WARN: refused to purge ${JSON.stringify(table)}: not a plain table name, so no DELETE was sent`);
      continue;
    }
    try {
      const result = await client.d1(dbId, `DELETE FROM ${table} WHERE user_id = ?`, [userId], `purge ${table}`);
      const changes = result?.[0]?.meta?.changes ?? 0;
      log(`purged ${table}: ${changes} row(s)`);
    } catch (e) {
      failures++;
      warn(`WARN: failed to purge ${table}: ${e.message}`);
    }
  }
  return failures;
}

/** Deletes the Supabase identity; returns 1 when it was not removed, else 0. */
export async function purgeAuthUser(client, userId, { log = console.log, warn = console.error } = {}) {
  let del;
  try {
    del = await client.deleteAuthUser(userId);
  } catch (e) {
    warn(`WARN: failed to delete the auth user ${userId}: ${e.message}`);
    return 1;
  }
  log(
    del.status === 404
      ? 'auth user delete: HTTP 404 — the identity was already gone (expected when the suite deleted this account from inside the app)'
      : `auth user delete: HTTP ${del.status}`,
  );
  if (!del.ok && del.status !== 404) {
    warn(`WARN: user delete returned ${del.status}\n${del.text}`);
    return 1;
  }
  return 0;
}
