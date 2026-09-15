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
