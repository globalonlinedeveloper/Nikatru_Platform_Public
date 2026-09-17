// ─────────────────────────────────────────────────────────────────────────────
// erase-subject.ts — THE ONE PIECE OF CODE THAT ERASES A PERSON FROM
// subscriptiontracker_db, whichever door the request came through.
//
// ⏱ 2026-09-15 · [ADR 081] (owner: "Accept, build it"). Until today the deletion
// lived inline in routes/account.ts, reachable only by an ES256-verified user
// token. The platform now also retries an erasure that request could not finish,
// over a Cloudflare Service Binding into `ErasureEntrypoint`
// (src/erasure-entrypoint.ts) — and the ADR's rule is that the retry runs "the
// SAME deletion code the public route runs". So the walk moved HERE, and both
// doors call it. Two copies of an irreversible walk are two answers to "what does
// erasing a person delete", and the first schema change would make them differ.
//
// The rules are unchanged from the route's header (read it there):
//   ·  user_id   → the row IS this person's        → DELETE the row
//   · *_user_id  → the row REFERENCES this person  → NULL the column
// and the table set is derived from the schema (services/_shared/src/erasure.ts).
//
// 🔴 IDEMPOTENT BY CONSTRUCTION: a second erasure of a person already erased
// deletes zero rows and NULLs zero columns, and is SUCCESS. A retry that arrives
// after the first attempt actually landed (the response was lost) must not read
// as a failure, or the ledger would retry it forever.
// ─────────────────────────────────────────────────────────────────────────────
import { erasureTargets, eraseTargets, type ErasureTargets } from '../../../_shared/src/erasure';

export type EraseSubjectResult =
  | { ok: true; scope: 'subscriptiontracker_db'; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; error: 'account_deletion_failed'; reason: string };

// ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS: the walk is `erasureTargets` (two
// round trips) and the write is `eraseTargets` (one batch, one transaction), both
// from the shared home. This file keeps its envelope, its refusals and its words.
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
  // Refusing an EMPTY derivation is the property the route has always had: a
  // walk that found no user-owned table would report success while erasing nothing.
  if (targets.tables.length === 0) {
    return {
      ok: false,
      error: 'account_deletion_failed',
      reason: 'no user-owned table was found in subscriptiontracker_db, so this erasure would report success while erasing nothing',
    };
  }
  const { deleted, unlinked } = await eraseTargets(db, userId, targets);
  return { ok: true, scope: 'subscriptiontracker_db', deleted, unlinked };
}
