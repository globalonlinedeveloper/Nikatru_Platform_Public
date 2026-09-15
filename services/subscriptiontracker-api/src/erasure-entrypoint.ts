// ─────────────────────────────────────────────────────────────────────────────
// erasure-entrypoint.ts — THE RETRY DOOR INTO THIS WORKER'S ERASURE, reachable
// only over a Cloudflare Service Binding from the platform Worker.
//
// ⏱ 2026-09-15 · [ADR 081] (owner: "Accept, build it (Recommended)").
// When DELETE /v1/account on the platform could not reach this Worker, the
// platform records a pending erasure and its nightly cron calls
// `eraseSubject(subjectRef, orderId)` HERE, over the binding
// `ERASURE_SUBSCRIPTIONTRACKER` declared in services/platform/wrangler.jsonc.
//
// 🔴 WHY THIS DOOR NEEDS NO TOKEN AND NO SECRET. A Service Binding "allow[s] one
// Worker to call into another, without going through a publicly-accessible URL"
// (developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/,
// read 2026-09-15), and it exists only in the CALLING Worker's own config, inside
// this account. There is no route to reach, no header to forge and no secret to
// leak or rotate — so the public DELETE /v1/account keeps its ES256-only boundary
// unchanged, and this class is not mounted on any HTTP path. Proven on this
// account with two throwaway Workers before this was written (writer-4 progress,
// 2026-09-15T05:30:38Z; both deleted).
//
// It runs the SAME deletion code as the public route (src/lib/erase-subject.ts)
// and is idempotent: a second call for an erased subject deletes nothing and
// answers ok. It never throws for a refusal — the platform records the reason and
// retries — and it never returns the subject back, only counts.
// ─────────────────────────────────────────────────────────────────────────────
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './types';
import { eraseSubjectRows } from './lib/erase-subject';

/** What the platform receives. Counts only: the subject is never echoed back. */
export type EraseSubjectAnswer =
  | { ok: true; scope: 'subscriptiontracker_db'; orderId: string; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; orderId: string; error: string; reason: string };

/** The body of the RPC method, pure over `env` so a Node test can drive it. */
export async function eraseSubjectForOrder(env: Pick<Env, 'APP_DB'>, subjectRef: string, orderId: string): Promise<EraseSubjectAnswer> {
  const result = await eraseSubjectRows(env.APP_DB, subjectRef);
  if (!result.ok) {
    console.error(`[erasure-entrypoint] order=${orderId} refused: ${result.reason}`);
    return { ok: false, orderId, error: result.error, reason: result.reason };
  }
  console.log(`[erasure-entrypoint] order=${orderId} erased (${Object.values(result.deleted).reduce((a, b) => a + b, 0)} row(s))`);
  return { ok: true, scope: result.scope, orderId, deleted: result.deleted, unlinked: result.unlinked };
}

export class ErasureEntrypoint extends WorkerEntrypoint<Env> {
  async eraseSubject(subjectRef: string, orderId: string): Promise<EraseSubjectAnswer> {
    return eraseSubjectForOrder(this.env, subjectRef, orderId);
  }
}
