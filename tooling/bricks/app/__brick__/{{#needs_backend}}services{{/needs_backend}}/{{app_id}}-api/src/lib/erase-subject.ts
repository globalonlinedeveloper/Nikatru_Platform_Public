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
import { erasureTargets, eraseTargets, type ErasureTargets } from '../../../_shared/src/erasure';

export type EraseSubjectResult =
  | { ok: true; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; error: 'account_deletion_failed'; reason: string };

// ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS: the walk is `erasureTargets` (two
// round trips) and the write is `eraseTargets` (one batch, one transaction, with
// the transient retry every copy now shares — this brick had it and the live
// Workers did not). This file keeps its envelope, its refusals and its words.
export async function eraseSubjectRows(db: D1Database, userId: string): Promise<EraseSubjectResult> {
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, error: 'account_deletion_failed', reason: 'no subject to erase' };
  }
  let targets: ErasureTargets;
  try {
    targets = await erasureTargets(db);
  } catch (err) {
    return { ok: false, error: 'account_deletion_failed', reason: `schema read failed: ${String(err)}` };
  }
  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH: a walk that found no table
  // would delete NOTHING and report ok, and the identity would then be deleted.
  if (targets.tables.length === 0) {
    return {
      ok: false,
      error: 'account_deletion_failed',
      reason: 'no user-owned table was found, so this request cannot prove it erased anything',
    };
  }
  const { deleted, unlinked } = await eraseTargets(db, userId, targets);
  return { ok: true, deleted, unlinked };
}
