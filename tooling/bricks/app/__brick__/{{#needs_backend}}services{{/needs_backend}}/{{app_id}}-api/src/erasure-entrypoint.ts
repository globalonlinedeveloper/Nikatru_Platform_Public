// ─────────────────────────────────────────────────────────────────────────────
// erasure-entrypoint.ts — THE RETRY DOOR INTO THIS WORKER'S ERASURE, reachable
// only over a Cloudflare Service Binding from the shared platform Worker.
//
// ⏱ 2026-09-15 · [ADR 081]. Every app stamped from this template inherits it.
// When the platform's DELETE /v1/account cannot reach this Worker it records a
// pending erasure and its nightly cron calls `eraseSubject(subjectRef, orderId)`
// here, over the binding `ERASURE_<APP_ID>` it declares for this app. A Service
// Binding exists only in the calling Worker's config inside the account — no
// public route, no token, no secret — so this class is mounted on no HTTP path
// and the public route keeps its ES256-only boundary. It runs the SAME APP_DB
// deletion as the public route (src/lib/erase-subject.ts), is idempotent, and
// answers counts only: the subject is never echoed back.
//
// ⚠️ A STAMPED APP IS NOT RETRIED UNTIL THE PLATFORM BINDS IT: its app id goes in
// services/platform/wrangler.jsonc APP_ERASURE_ENDPOINTS AND a `services` entry
// `ERASURE_<APP_ID>` → `<app>-api` / `ErasureEntrypoint`, together
// (tooling/ci/assert-erasure-reach.mjs limb 4b refuses one without the other).
// ─────────────────────────────────────────────────────────────────────────────
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './types';
import { eraseSubjectRows } from './lib/erase-subject';

export type EraseSubjectAnswer =
  | { ok: true; orderId: string; deleted: Record<string, number>; unlinked: Record<string, number> }
  | { ok: false; orderId: string; error: string; reason: string };

/** The body of the RPC method, pure over `env` so a Node test can drive it. */
export async function eraseSubjectForOrder(env: Pick<Env, 'APP_DB'>, subjectRef: string, orderId: string): Promise<EraseSubjectAnswer> {
  const result = await eraseSubjectRows(env.APP_DB, subjectRef);
  if (!result.ok) {
    console.error(`[erasure-entrypoint] order=${orderId} refused: ${result.reason}`);
    return { ok: false, orderId, error: result.error, reason: result.reason };
  }
  return { ok: true, orderId, deleted: result.deleted, unlinked: result.unlinked };
}

export class ErasureEntrypoint extends WorkerEntrypoint<Env> {
  async eraseSubject(subjectRef: string, orderId: string): Promise<EraseSubjectAnswer> {
    return eraseSubjectForOrder(this.env, subjectRef, orderId);
  }
}
