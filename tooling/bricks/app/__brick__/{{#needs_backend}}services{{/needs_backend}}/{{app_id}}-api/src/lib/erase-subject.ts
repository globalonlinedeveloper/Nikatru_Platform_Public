// ─────────────────────────────────────────────────────────────────────────────
// erase-subject.ts — THE ONE PIECE OF CODE THAT ERASES A PERSON FROM THIS APP'S
// OWN DATABASE (APP_DB), whichever door the request came through.
//
// ⏱ 2026-09-15 · [ADR 081]. The shared platform Worker retries an erasure it
// could not finish by calling this Worker's `ErasureEntrypoint` over a Service
// Binding (src/erasure-entrypoint.ts), and the ADR's rule is that the retry runs
// "the SAME deletion code the public route runs". So the APP_DB walk lives HERE
// and both doors call it; the public route keeps what only it does (the
// shared entitlements and the identity record).
//
// The set is DERIVED FROM THE SCHEMA, never listed: `user_id` means the row IS
// this person's (DELETE), `*_user_id` means the row REFERENCES them (NULL). See
// services/_shared/src/erasure.ts for why the walk is two statements and why the
// two sets are disjoint by construction. Idempotent: a second erasure of an
// erased person deletes nothing and is success.
// ─────────────────────────────────────────────────────────────────────────────
import { run } from './d1';
import { userOwnedTables, userReferencingColumns } from '../../../_shared/src/erasure';

export type EraseSubjectResult =
  | { ok: true; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; error: 'account_deletion_failed'; reason: string };

export async function eraseSubjectRows(db: D1Database, userId: string): Promise<EraseSubjectResult> {
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, error: 'account_deletion_failed', reason: 'no subject to erase' };
  }
  let tables: string[];
  let references: Array<{ table: string; column: string }>;
  try {
    tables = await userOwnedTables(db);
    references = await userReferencingColumns(db);
  } catch (err) {
    return { ok: false, error: 'account_deletion_failed', reason: `schema read failed: ${String(err)}` };
  }
  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH: a walk that found no table
  // would delete NOTHING and report ok, and the identity would then be deleted.
  if (tables.length === 0) {
    return {
      ok: false,
      error: 'account_deletion_failed',
      reason: 'no user-owned table was found, so this request cannot prove it erased anything',
    };
  }
  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};
  for (const table of tables) {
    // Through `run`: D1 lives in a Durable Object that is occasionally reset, and
    // a DELETE is idempotent by its own shape. The name comes from sqlite_master.
    // eslint-disable-next-line no-await-in-loop
    const res = await run(db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId));
    deleted[table] = res.meta.changes ?? 0;
  }
  for (const ref of references) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run(db.prepare(`UPDATE ${ref.table} SET ${ref.column} = NULL WHERE ${ref.column} = ?`).bind(userId));
    unlinked[`${ref.table}.${ref.column}`] = res.meta.changes ?? 0;
  }
  return { ok: true, deleted, unlinked };
}
