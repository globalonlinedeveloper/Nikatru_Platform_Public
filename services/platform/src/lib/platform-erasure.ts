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
import { userOwnedTables, userReferencingColumns } from '../../../_shared/src/erasure';

export type PlatformErasureResult =
  | { ok: true; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; reason: string };

export async function erasePlatformRows(db: D1Database, userId: string): Promise<PlatformErasureResult> {
  let tables: string[];
  let references: Array<{ table: string; column: string }>;
  try {
    tables = await userOwnedTables(db);
    references = await userReferencingColumns(db);
  } catch (err) {
    return { ok: false, reason: `schema read failed: ${String(err)}` };
  }
  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH — a walk that found no table
  // would delete nothing and the caller would go on to delete the identity.
  if (tables.length === 0) {
    return {
      ok: false,
      reason: 'no user-owned table was found in platform_db, so this request would erase the identity and orphan every row',
    };
  }
  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};
  for (const table of tables) {
    // The name comes from sqlite_master, not from the request; D1 cannot bind an identifier.
    const res = await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
    deleted[table] = res.meta.changes ?? 0;
  }
  for (const { table, column } of references) {
    const res = await db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).bind(userId).run();
    unlinked[`${table}.${column}`] = res.meta.changes ?? 0;
  }
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
  db: D1Database,
  supabaseUrl: string | undefined,
  serviceRoleKey: string,
  userId: string,
): Promise<SignupPurgeOutcome> {
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
  } catch {
    return { kind: 'transient', why: 'the identity provider could not be reached' };
  }
  if (res.status === 404) return { kind: 'skipped', why: 'no_account' };
  if (res.status >= 500 || res.status === 429) return { kind: 'transient', why: `the identity provider answered ${res.status}` };
  if (!res.ok) return { kind: 'failed', why: `the identity provider answered ${res.status}` };
  let user: { email?: unknown; email_confirmed_at?: unknown };
  try {
    user = (await res.json()) as { email?: unknown; email_confirmed_at?: unknown };
  } catch {
    return { kind: 'transient', why: 'the identity provider answered with a body that is not JSON' };
  }
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  if (email === '') return { kind: 'skipped', why: 'no_email' };
  if (typeof user.email_confirmed_at !== 'string' || user.email_confirmed_at === '') {
    return { kind: 'skipped', why: 'unconfirmed' };
  }
  // `email` is the PRIMARY KEY with COLLATE NOCASE (0011_signups.sql), so `=` here
  // matches the row however its letters were cased when the visitor signed up.
  const out = await db.prepare('DELETE FROM signups WHERE email = ?').bind(email).run();
  return { kind: 'purged', deleted: out.meta.changes ?? 0 };
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
