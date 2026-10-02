// ─────────────────────────────────────────────────────────────────────────────
// routes/refund.ts — POST /v1/plan/refund: the in-window refund the published
// policy promises, carried out by itself (refund-finish, MF-5;
// O-REFUND-IN-WINDOW-UNAUTOMATED).
//
// AUTHENTICATED (`platformAuth` on /v1/plan/* in index.ts). The body carries an
// app id and nothing else; the purchase is resolved from the SESSION's own
// entitlement row, never from the body (cancellation.ts's header says why).
// An `Idempotency-Key` header is REQUIRED: a retried POST reads its own row back.
//
// THE POLICY IS lib/mor/refund.ts (which quotes sites/nikatru/refund.html). The
// answers, each a separately true statement:
//   · 409 { route: 'store', refund_at, refund_url } — a store purchase: the store
//     is the seller and refunds it; nothing recorded, nothing promised;
//   · 403 { error: 'outside_refund_window' } — more than REFUND_WINDOW_DAYS after
//     the charge: refused, nothing recorded;
//   · 200 { recorded, executed: true, refund_ref } — the rail CONFIRMED the
//     refund through the payments port. The entitlement is revoked as today: by
//     the rail's own signed refund notification (lib/mor/store.ts), so access
//     ends on the money event, not on our word;
//   · 202 { recorded, executed: false, route: 'manual', reason } — recorded and
//     NOT carried out: the rail declares no `refund` (Paddle and Razorpay today),
//     the rail did not confirm, or the charge time cannot be shown. The row is
//     the prepared case tooling/ops/refund.mjs builds from; refund.html's "we
//     decide within 3 business days" is the human half.
//   · one refund per payment: a second request for the same charge answers the
//     first one's record (UNIQUE (provider, purchase_ref)), never a second refund.
// A rail without `refund` is the manual route — never a 500.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows, firstRow, isUniqueViolation, nowIso, run } from '../lib/d1';
import { isKnownApp, isSellableExtension } from '../config';
import { isMoneyEnvironment } from '../lib/mor/contract';
import { readBoundedBody } from '../lib/body';
import { cancelPathFor } from '../lib/mor/registry';
import { chargedAtOf, storeRefundPage, withinRefundWindow } from '../lib/mor/refund';
import { railCan } from '../../../_shared/src/ports/payments';
import { railFor } from '../ports';

const refund = new Hono<AppEnv>();

/**
 * An app id and nothing else.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_REFUND_BODY_BYTES = 1024;

/** Why a recorded refund was not carried out. ENUMERABLE, like cancellation.ts's. */
export type RefundNotExecutedReason = 'rail_has_no_refund' | 'provider_error' | 'charge_time_unknown';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

interface PurchaseRow {
  provider: string | null;
  provider_transaction_id: string | null;
  store: string | null;
}

interface RefundRow {
  request_id: string;
  executed_at: string | null;
  refund_ref: string | null;
  not_executed_reason: string | null;
}

const answer = (r: RefundRow) =>
  r.executed_at !== null
    ? ({ body: { recorded: true, executed: true, request_id: r.request_id, refund_ref: r.refund_ref }, status: 200 } as const)
    : ({ body: { recorded: true, executed: false, request_id: r.request_id, route: 'manual', reason: r.not_executed_reason }, status: 202 } as const);

refund.post('/plan/refund', async (c) => {
  const userId = c.get('userId');
  const rid = c.get('requestId') ?? '-';
  const key = c.req.header('Idempotency-Key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) return c.json({ error: 'idempotency_key_required' }, 400);

  const read = await readBoundedBody(c.req.raw, MAX_REFUND_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const appId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).app_id : undefined;
  if (typeof appId !== 'string' || !(isKnownApp(appId) || isSellableExtension(appId))) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);

  const environment = c.env.MONEY_ENVIRONMENT;
  if (!isMoneyEnvironment(environment)) {
    console.error(`[refund] rid=${rid} MONEY_ENVIRONMENT is ${JSON.stringify(environment)} — refusing.`);
    return c.json({ error: 'money_rail_not_configured' }, 503);
  }
  const db = c.env.PLATFORM_DB;

  // A retry of THIS request: its own row, read back.
  const again = await firstRow<RefundRow>(
    db.prepare('SELECT request_id, executed_at, refund_ref, not_executed_reason FROM refund_requests WHERE user_id = ? AND idempotency_key = ?').bind(userId, key),
  );
  if (again) {
    const a = answer(again);
    return c.json(a.body, a.status);
  }

  // 🔴 BOTH PREDICATES AND THE ENVIRONMENT, and the purchase the row last recorded.
  const rows = await allRows<PurchaseRow>(
    db
      .prepare(
        `SELECT provider, provider_transaction_id, store
           FROM entitlements
          WHERE user_id = ? AND app_id = ? AND provider_environment = ?
            AND provider IS NOT NULL AND provider_transaction_id IS NOT NULL
          ORDER BY occurred_at DESC LIMIT 1`,
      )
      .bind(userId, appId, environment),
  );
  const row = rows[0];
  if (!row || row.provider === null || row.provider_transaction_id === null) return c.json({ has_purchase: false, recorded: false }, 404);
  const provider = row.provider;
  const purchaseRef = row.provider_transaction_id;

  // A store purchase is the store's to refund (refund.html section 4).
  if (cancelPathFor(provider) === 'store') {
    const page = storeRefundPage(row.store);
    return c.json({ recorded: false, executed: false, route: 'store', refund_at: page?.refundAt ?? 'store', refund_url: page?.refundUrl ?? null }, 409);
  }

  // One refund per payment: a request for a charge already asked about answers that record.
  const prior = await firstRow<RefundRow>(
    db.prepare('SELECT request_id, executed_at, refund_ref, not_executed_reason FROM refund_requests WHERE provider = ? AND purchase_ref = ?').bind(provider, purchaseRef),
  );
  if (prior) {
    const a = answer(prior);
    return c.json(a.body, a.status);
  }

  const now = nowIso();
  const chargedAt = await chargedAtOf(db, provider, environment, purchaseRef);
  if (chargedAt !== null && !withinRefundWindow(chargedAt, now)) {
    return c.json({ error: 'outside_refund_window', charged_at: chargedAt }, 403);
  }

  // Carry it out through the port, where the rail declares `refund`.
  let reason: RefundNotExecutedReason | null;
  let refundRef: string | null = null;
  if (chargedAt === null) {
    reason = 'charge_time_unknown';
  } else {
    const rail = railFor(provider, c.env);
    if (rail === null || !railCan(rail, 'refund')) {
      reason = 'rail_has_no_refund';
    } else {
      const done = await rail.refund({ purchaseRef, amountMinor: null, environment });
      if (done.ok) {
        reason = null;
        refundRef = done.refundRef;
      } else {
        console.error(`[refund] rid=${rid} app=${appId} ${provider} refund not executed: ${done.detail}`);
        reason = 'provider_error';
      }
    }
  }

  const requestId = crypto.randomUUID();
  try {
    await run(
      db
      .prepare(
          `INSERT INTO refund_requests
           (request_id, user_id, app_id, environment, provider, purchase_ref, idempotency_key,
            charged_at, requested_at, executed_at, refund_ref, not_executed_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(requestId, userId, appId, environment, provider, purchaseRef, key, chargedAt, now, reason === null ? now : null, refundRef, reason),
    );
  } catch (err) {
    // A parallel request for the same charge or with the same key landed first:
    // answer ITS record. The rail's refund is idempotent per purchase (the port's
    // conformance suite), so the second ask moved no money twice.
    if (!isUniqueViolation(err)) throw err;
    const won = await firstRow<RefundRow>(
      db
        .prepare('SELECT request_id, executed_at, refund_ref, not_executed_reason FROM refund_requests WHERE (provider = ? AND purchase_ref = ?) OR (user_id = ? AND idempotency_key = ?)')
        .bind(provider, purchaseRef, userId, key),
    );
    if (!won) throw err;
    const w = answer(won);
    return c.json(w.body, w.status);
  }
  const a = answer({ request_id: requestId, executed_at: reason === null ? now : null, refund_ref: refundRef, not_executed_reason: reason });
  return c.json(a.body, a.status);
});

export default refund;
