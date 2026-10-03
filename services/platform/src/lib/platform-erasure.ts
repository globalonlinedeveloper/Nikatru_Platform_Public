// ─────────────────────────────────────────────────────────────────────────────
// platform-erasure.ts — limbs 1 and 2 of DELETE /v1/account, as one function.
//
// ⏱ 2026-09-15 · [ADR 081]. The platform_db walk lived inline in
// routes/account.ts. It moved here, unchanged in behaviour, because a SECOND
// caller now needs it: the nightly `erasureRetry` (src/scheduled.ts) re-walks
// platform_db immediately before it deletes a pending subject's identity, so
// rows written while the subject still had a login (between the 202 and the last
// app's confirmation) are not orphaned behind an identity that no longer exists.
// Read routes/account.ts's header for the two rules and why the table set is
// derived from the schema; they are the same rules, in the same order:
//   ·  user_id   → the row IS this person's        → DELETE the row
//   · *_user_id  → the row REFERENCES this person  → NULL the column
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { erasureTargets, eraseTargets, type ErasureTargets } from '../../../_shared/src/erasure';

export type PlatformErasureResult =
  | { ok: true; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; reason: string };

// ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS: the walk is `erasureTargets` (two
// round trips) and the write is `eraseTargets` (one batch, one transaction), both
// from the shared home. What stays HERE is this Worker's own envelope and its own
// words for the refusals. A thrown write still propagates, exactly as before.
export async function erasePlatformRows(db: SqlDb, userId: string): Promise<PlatformErasureResult> {
  let targets: ErasureTargets;
  try {
    targets = await erasureTargets(db);
  } catch (err) {
    return { ok: false, reason: `schema read failed: ${String(err)}` };
  }
  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH — a walk that found no table
  // would delete nothing and the caller would go on to delete the identity.
  if (targets.tables.length === 0) {
    return {
      ok: false,
      reason: 'no user-owned table was found in platform_db, so this request would erase the identity and orphan every row',
    };
  }
  const { deleted, unlinked } = await eraseTargets(db, userId, targets);
  return { ok: true, deleted, unlinked };
}

/**
 * ⏱ 2026-09-15 · [ADR 087] §3 "a signup is personal data and must be reachable by
 * erasure". The nikatru.com launch list (`signups`) is keyed by EMAIL, not by an
 * account, so the schema-derived walk above cannot see it. This purge reaches it for
 * a person who HAS an account, and only through an address the identity provider
 * says that person has CONFIRMED:
 *
 *   read the account (`GET /auth/v1/admin/users/<id>`, service role)
 *     → email present AND `email_confirmed_at` set → `DELETE FROM signups WHERE email = ?`
 *     → no email, or not confirmed               → skipped, never a failure
 *
 * 🔴 WHY THE CONFIRMATION, AND WHY IT IS NOT OPTIONAL. Without it, anyone could
 * register an unconfirmed account in someone else's address, delete it, and take that
 * person off the launch list. A confirmed address is one its owner proved they read.
 *
 * 🔴 WHY IT MUST RUN BEFORE `deleteIdentity`. After the identity is deleted there is
 * nothing left to read the address or its confirmation from, so the list row could
 * never be reached again. Both callers (routes/account.ts and scheduled.ts
 * `erasureRetry`) call this first; tooling/ci/assert-erasure-reach.mjs holds the order.
 *
 * `transient` (transport error, 5xx, 429, an unreadable body) means NOTHING IS KNOWN:
 * the caller must keep the identity and retry ([ADR 081] ledger). `failed` (any other
 * non-2xx, e.g. a service-role key that is refused) is also "not known", and is
 * reported rather than guessed past. 404 means the account is already gone, so there
 * is no address to confirm: skipped. The key is never echoed; the address is never
 * logged or returned.
 */
export type SignupPurgeOutcome =
  | { kind: 'purged'; deleted: number }
  | { kind: 'skipped'; why: 'unconfirmed' | 'no_email' | 'no_account' }
  | { kind: 'transient'; why: string }
  | { kind: 'failed'; why: string };

export async function purgeVerifiedSignups(
  db: SqlDb,
  supabaseUrl: string | undefined,
  serviceRoleKey: string,
  userId: string,
): Promise<SignupPurgeOutcome> {
  const account = await readAccount(supabaseUrl, serviceRoleKey, userId);
  if (account.kind === 'transient' || account.kind === 'failed') return account;
  if (account.kind === 'no_account') return { kind: 'skipped', why: 'no_account' };
  if (account.email === '') return { kind: 'skipped', why: 'no_email' };
  // The confirmation is read HERE, in the function that deletes, and not inside
  // `readAccount`: tooling/ci/assert-erasure-reach.mjs limb 5 grades exactly this
  // body, so a helper that decided "confirmed" out of its sight would leave the
  // guard green over a check it can no longer see.
  if (account.email_confirmed_at === null) return { kind: 'skipped', why: 'unconfirmed' };
  // `email` is the PRIMARY KEY with COLLATE NOCASE (0011_signups.sql), so `=` here
  // matches the row however its letters were cased when the visitor signed up.
  const out = await db.prepare('DELETE FROM signups WHERE email = ?').bind(account.email).run();
  return { kind: 'purged', deleted: out.meta.changes ?? 0 };
}

/**
 * ⏱ 2026-09-28 · ST-R1. How long one admin-user read may take before it counts
 * as TRANSIENT. The read had no bound while its one caller was a request the user
 * was waiting on; the nightly reminder job (lib/reminders.ts) now makes one per
 * opted-in account, sequentially, inside the one nightly firing — so an identity
 * provider that accepts the connection and never answers would otherwise hold the
 * whole firing, and every limb after it, until the runtime killed the invocation.
 * Ten seconds is the bound every other outbound call from the scheduler already
 * uses (probeReachability, sendHeartbeat).
 *
 * @ceiling none — a per-call wait we chose, not a platform resource.
 *
 * ⏱ 2026-10-02 — TWO ATTEMPTS OF FIVE SECONDS, NOT ONE OF TEN (E2E live #204,
 * run 36837985672). `DELETE /v1/account` answered 202 after 17.9 s with the
 * signup purge `pending`: the platform's read never reached Box C (its GoTrue log
 * holds only the E2E's own reads for that window), so one lost request cost the
 * whole ten seconds and left a real user waiting for the nightly retry. A second
 * attempt inside the same budget turns one lost request into a normal answer; the
 * worst case is still ten seconds. Only a TRANSIENT outcome is retried: a 404, a
 * 401/403 or any other definite answer is the answer.
 */
// @ceiling none — a retry count we chose, not a platform resource
export const ACCOUNT_READ_ATTEMPTS = 2;
// @ceiling none — a per-attempt wait we chose, not a platform resource
export const ACCOUNT_READ_ATTEMPT_MS = 5_000;
export const ACCOUNT_READ_TIMEOUT_MS = ACCOUNT_READ_ATTEMPTS * ACCOUNT_READ_ATTEMPT_MS;

/**
 * What the identity provider says about ONE account — the admin-user read, in one
 * place. ⏱ 2026-09-28 · ST-R1: extracted from `purgeVerifiedSignups` so the reminder
 * job reads an address the same way the signup purge does, with a timeout, and so
 * the one file in this Worker that names the admin endpoint stays one file
 * (tooling/ci/assert-erasure-reach.mjs limb 6).
 *
 *   `found`      — `email` (trimmed, '' when absent) and `email_confirmed_at`
 *                  (null unless a non-empty string). It DECIDES NOTHING: each caller
 *                  reads `email_confirmed_at` itself, because only a confirmed
 *                  address is one its owner proved they read.
 *   `no_account` — 404: the account is gone.
 *   `transient`  — transport error, timeout, 5xx, 429, a body that is not JSON:
 *                  NOTHING IS KNOWN, try again later.
 *   `failed`     — any other non-2xx (e.g. a refused service-role key).
 *
 * The key is never echoed; the address is returned to the caller and never logged
 * here. `fetchImpl` is injectable for tests, as in lib/report-notify.ts.
 *
 * A `transient` outcome is tried again once (ACCOUNT_READ_ATTEMPTS, each bounded
 * by `attemptMs`), so every caller — the signup purge on the request path, the
 * nightly erasure retry and the reminder job — gets the retry from this one place.
 */
export type AccountRead =
  | { kind: 'found'; email: string; email_confirmed_at: string | null }
  | { kind: 'no_account' }
  | { kind: 'transient'; why: string }
  | { kind: 'failed'; why: string };

export async function readAccount(
  supabaseUrl: string | undefined,
  serviceRoleKey: string,
  userId: string,
  fetchImpl: typeof fetch = fetch,
  attemptMs: number = ACCOUNT_READ_ATTEMPT_MS,
): Promise<AccountRead> {
  let read: AccountRead = { kind: 'transient', why: 'the identity provider was not asked' };
  for (let attempt = 1; attempt <= ACCOUNT_READ_ATTEMPTS; attempt++) {
    read = await readAccountOnce(supabaseUrl, serviceRoleKey, userId, fetchImpl, attemptMs);
    if (read.kind !== 'transient') return read;
  }
  return read;
}

async function readAccountOnce(
  supabaseUrl: string | undefined,
  serviceRoleKey: string,
  userId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<AccountRead> {
  let res: Response;
  try {
    res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { kind: 'transient', why: 'the identity provider could not be reached' };
  }
  if (res.status === 404) return { kind: 'no_account' };
  if (res.status >= 500 || res.status === 429) return { kind: 'transient', why: `the identity provider answered ${res.status}` };
  if (!res.ok) return { kind: 'failed', why: `the identity provider answered ${res.status}` };
  let user: { email?: unknown; email_confirmed_at?: unknown };
  try {
    user = (await res.json()) as { email?: unknown; email_confirmed_at?: unknown };
  } catch {
    return { kind: 'transient', why: 'the identity provider answered with a body that is not JSON' };
  }
  const confirmedAt = user?.email_confirmed_at;
  return {
    kind: 'found',
    email: typeof user?.email === 'string' ? user.email.trim() : '',
    email_confirmed_at: typeof confirmedAt === 'string' && confirmedAt !== '' ? confirmedAt : null,
  };
}

/** The response-body token for a purge outcome. Counts and reasons only, never the address. */
export function signupPurgeToken(o: SignupPurgeOutcome): string {
  return o.kind === 'purged' ? 'purged' : o.kind === 'skipped' ? `skipped_${o.why}` : o.kind === 'transient' ? 'pending' : 'failed';
}

/** The identity record, LAST. 404 counts as done (the user is already gone). The
 *  key is never echoed, logged, or returned. */
export async function deleteIdentity(
  supabaseUrl: string | undefined,
  serviceRoleKey: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok && res.status !== 404) return { ok: false, status: res.status };
  return { ok: true };
}
