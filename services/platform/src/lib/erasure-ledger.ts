// ─────────────────────────────────────────────────────────────────────────────
// erasure-ledger.ts — the pending-erasure ledger ([ADR 081]), over
// platform_db `pending_erasures` (migrations/0010_pending_erasures.sql).
//
// ⏱ 2026-09-15. An erasure an app could not finish inside the request is written
// down here and retried by the nightly cron over a Service Binding. The ledger
// holds NO credential (option A in the ADR was refused precisely because a stored
// user token would make this table a credential store) — only which subject,
// which app, and how the retries are going.
//
// 🔴 THE SUBJECT COLUMN IS `subject_ref`, NEVER `user_id`: the erasure walk
// deletes every table with a `user_id` column, and a ledger named that way would
// delete its own order mid-erasure. The migration's header says it at length.
// ─────────────────────────────────────────────────────────────────────────────

/** What an app's `ErasureEntrypoint` answers (services/subscriptiontracker-api
 *  src/erasure-entrypoint.ts). Counts only; the subject is never echoed. */
export interface EraseSubjectAnswer {
  ok: boolean;
  orderId?: string;
  error?: string;
  reason?: string;
}

/** The RPC surface a Service Binding to an app's `ErasureEntrypoint` exposes. */
export interface ErasureBinding {
  eraseSubject(subjectRef: string, orderId: string): Promise<EraseSubjectAnswer>;
}

/** `subscriptiontracker` → `ERASURE_SUBSCRIPTIONTRACKER`. ONE spelling, used by the
 *  route, the cron and the guard (assert-erasure-reach reads wrangler.jsonc for it). */
export function erasureBindingName(appId: string): string {
  return `ERASURE_${appId.toUpperCase()}`;
}

/**
 * ⏱ 2026-09-15 · [ADR 087]. A ledger order that is NOT an app: the signup-list
 * purge, which needs the account's email and its confirmation from the identity
 * provider BEFORE the identity is deleted. When that read fails transiently the
 * route records an order under this id instead of an app id, the identity stays,
 * and `erasureRetry` runs the purge rather than a Service Binding call.
 *
 * ⚠️ THE `<NAME>_STEP` SPELLING IS READ BY tooling/ops/check-prod-provenance.mjs
 * (resolver `erasure-step`), which accepts a `pending_erasures.app_id` that is not
 * an app only if it is one of these exported literals. The `:` cannot appear in an
 * app slug, so a step can never be mistaken for an app or collide with one.
 */
export const SIGNUP_PURGE_STEP = 'platform:signups';

/**
 * ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE. The SECOND non-app step, and
 * the same shape as the one above: revoking this subject's Sign in with Apple
 * token at Apple (`POST https://appleid.apple.com/auth/revoke`) is part of their
 * erasure, is not an app, and cannot be retried over a Service Binding. When the
 * call cannot be completed — Apple unreachable, or the owner-provisioned
 * credentials absent — the route records an order under this id, the identity
 * STAYS, and `erasureRetry` runs the revoke itself.
 *
 * ⚠️ Same load-bearing `<NAME>_STEP` spelling read by
 * tooling/ops/check-prod-provenance.mjs (resolver `erasure-step`).
 */
export const APPLE_REVOKE_STEP = 'platform:apple-revoke';

/** The binding for an app, or null when this Worker declares none for it. */
export function erasureBindingFor(env: object, appId: string): ErasureBinding | null {
  const candidate = (env as Record<string, unknown>)[erasureBindingName(appId)];
  if (candidate === null || typeof candidate !== 'object' && typeof candidate !== 'function') return null;
  return typeof (candidate as { eraseSubject?: unknown }).eraseSubject === 'function' ? (candidate as ErasureBinding) : null;
}

/** @ceiling none — a RETRY SCHEDULE, not a platform resource. The first retry is
 *  the next nightly run; the cap keeps a long outage from pushing an order out of
 *  a nightly cadence altogether. */
export const ERASURE_RETRY_BASE_MS = 15 * 60 * 1000;
/** @ceiling none — see ERASURE_RETRY_BASE_MS. One day: the cron is nightly. */
export const ERASURE_RETRY_CAP_MS = 24 * 60 * 60 * 1000;

/** Exponential backoff after `attempts` failed attempts, capped at a day. */
export function nextAttemptDelayMs(attempts: number): number {
  const n = Math.max(0, Math.min(attempts, 20));
  return Math.min(ERASURE_RETRY_BASE_MS * 2 ** n, ERASURE_RETRY_CAP_MS);
}

export interface PendingOrder {
  order_id: string;
  subject_ref: string;
  app_id: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string;
  confirmed_at: string | null;
}

/**
 * Record (or re-open) the order for one (subject, app). A subject who asks again
 * while an order is pending re-opens the SAME row — `UNIQUE (subject_ref, app_id)` —
 * so a second request never makes a second order that could confirm twice.
 * Due immediately: the first retry is the next cron run.
 */
export async function recordPendingErasure(
  db: D1Database,
  o: { subjectRef: string; appId: string; nowIso: string; reason: string },
): Promise<string> {
  const orderId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO pending_erasures (order_id, subject_ref, app_id, created_at, attempts, next_attempt_at, last_attempt_at, last_error, confirmed_at)
       VALUES (?,?,?,?,0,?,NULL,?,NULL)
       ON CONFLICT (subject_ref, app_id) DO UPDATE SET
         confirmed_at = NULL,
         next_attempt_at = excluded.next_attempt_at,
         last_error = excluded.last_error`,
    )
    .bind(orderId, o.subjectRef, o.appId, o.nowIso, o.nowIso, o.reason.slice(0, 200))
    .run();
  const row = await db
    .prepare('SELECT order_id FROM pending_erasures WHERE subject_ref = ? AND app_id = ?')
    .bind(o.subjectRef, o.appId)
    .first<{ order_id: string }>();
  return row?.order_id ?? orderId;
}

/** The synchronous path reached the app after all: any open order for it is moot. */
export async function clearPendingErasure(db: D1Database, subjectRef: string, appId: string): Promise<void> {
  await db.prepare('DELETE FROM pending_erasures WHERE subject_ref = ? AND app_id = ?').bind(subjectRef, appId).run();
}

/** Unconfirmed orders whose next attempt is due, oldest first, at most `limit`. */
export async function dueOrders(db: D1Database, nowIso: string, limit: number): Promise<PendingOrder[]> {
  const res = await db
    .prepare(
      `SELECT order_id, subject_ref, app_id, created_at, attempts, next_attempt_at, confirmed_at
         FROM pending_erasures
        WHERE confirmed_at IS NULL AND next_attempt_at <= ?
        ORDER BY next_attempt_at
        LIMIT ?`,
    )
    .bind(nowIso, limit)
    .all<PendingOrder>();
  return res.results ?? [];
}

export async function markConfirmed(db: D1Database, orderId: string, nowIso: string): Promise<void> {
  await db
    .prepare(
      'UPDATE pending_erasures SET confirmed_at = ?, last_attempt_at = ?, attempts = attempts + 1, last_error = NULL WHERE order_id = ?',
    )
    .bind(nowIso, nowIso, orderId)
    .run();
}

export async function markFailed(
  db: D1Database,
  o: { orderId: string; attempts: number; nowMs: number; error: string },
): Promise<void> {
  const now = new Date(o.nowMs).toISOString();
  const next = new Date(o.nowMs + nextAttemptDelayMs(o.attempts + 1)).toISOString();
  await db
    .prepare(
      'UPDATE pending_erasures SET attempts = attempts + 1, last_attempt_at = ?, next_attempt_at = ?, last_error = ? WHERE order_id = ?',
    )
    .bind(now, next, o.error.slice(0, 200), o.orderId)
    .run();
}

/** Subjects every one of whose orders is confirmed — ready for the identity step. */
export async function subjectsReadyForIdentity(db: D1Database, limit: number): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT subject_ref FROM pending_erasures
        GROUP BY subject_ref
       HAVING SUM(CASE WHEN confirmed_at IS NULL THEN 1 ELSE 0 END) = 0
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ subject_ref: string }>();
  return (res.results ?? []).map((r) => r.subject_ref);
}

/** The subject's erasure is complete: its orders are deleted (the retention bound). */
export async function closeSubject(db: D1Database, subjectRef: string): Promise<void> {
  await db.prepare('DELETE FROM pending_erasures WHERE subject_ref = ?').bind(subjectRef).run();
}

/** Unconfirmed orders older than `cutoffIso` — the stuck set the heartbeat turns RED. */
export async function stuckOrderCount(db: D1Database, cutoffIso: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM pending_erasures WHERE confirmed_at IS NULL AND created_at < ?')
    .bind(cutoffIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
