// ─────────────────────────────────────────────────────────────────────────────
// lib/mor/refund.ts — THE REFUND POLICY, AS CODE (refund-finish, MF-5).
//
// 🔴 THE POLICY IS THE PAGE: sites/nikatru/refund.html (owner copy, ADR 031
// class B; ADR 100 "the written automated policy ... IS the published page").
// What the page says, and what this file does — never MORE generous, never LESS:
//   · Paddle (section 2) and Razorpay (section 3): "ask us for a refund within
//     30 days of the charge and we will approve it"; "you do not need to give a
//     reason"; "No fee is deducted" → REFUND_WINDOW_DAYS from the CHARGE, the
//     whole amount (`amountMinor: null`), no reason asked;
//   · a store purchase (section 4): "that store took the payment and is the
//     seller. Refunds for those purchases go through the store's own process,
//     not through Nikatru" → the store's own refund page, never a promise.
// test/refund-route.test.ts reads refund.html and fails when its window and
// this constant disagree, so an owner edit to the page reddens the build
// instead of drifting from the code.
//
// THE CHARGE TIME is the provider's own clock on the FIRST signed notification
// that names the purchase reference (provider_notifications.occurred_at): a
// transaction or payment id first appears on the event that charged it. When no
// stored notification names it, the window cannot be shown, so the request is
// NOT refunded automatically — it is recorded for a human (never more generous).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../../_shared/src/ports/sql';

/**
 * The refund window, in days from the charge — refund.html sections 2 and 3.
 *
 * @ceiling none — a published commercial policy, not a platform resource.
 */
export const REFUND_WINDOW_DAYS = 30;

/** @ceiling none — a unit conversion (milliseconds in a day), not a limit. */
const DAY_MS = 86_400_000;

/** Whether a refund asked for at `requestedAt` is inside the window of a charge at `chargedAt`. */
export function withinRefundWindow(chargedAt: string, requestedAt: string): boolean {
  const c = Date.parse(chargedAt);
  const r = Date.parse(requestedAt);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return false;
  return r >= c && r - c <= REFUND_WINDOW_DAYS * DAY_MS;
}

/**
 * When the purchase `purchaseRef` was charged: the earliest provider clock of a
 * stored, signed notification from `provider` in `environment` whose raw body
 * names it as a JSON string. Null when none does.
 */
export async function chargedAtOf(db: SqlDb, provider: string, environment: string, purchaseRef: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MIN(occurred_at) AS charged_at
         FROM provider_notifications
        WHERE provider = ? AND environment = ? AND occurred_at IS NOT NULL AND instr(payload, ?) > 0`,
    )
    .bind(provider, environment, JSON.stringify(purchaseRef))
    .first<{ charged_at: string | null }>();
  return row?.charged_at ?? null;
}

/**
 * Where a store purchase is refunded — refund.html section 4, the two pages it
 * names. Null for a store the page does not name: the app then says to contact
 * support, which the page also offers ("email us and we will help you").
 */
export function storeRefundPage(store: string | null): { refundAt: 'app_store' | 'play_store'; refundUrl: string } | null {
  switch (store) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return { refundAt: 'app_store', refundUrl: 'https://reportaproblem.apple.com' };
    case 'PLAY_STORE':
      return { refundAt: 'play_store', refundUrl: 'https://play.google.com/store/account/orderhistory' };
    default:
      return null;
  }
}
