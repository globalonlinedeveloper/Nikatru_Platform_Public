// ─────────────────────────────────────────────────────────────────────────────
// /v1/webhooks — server-to-server callbacks. NO Supabase user auth here; these
// are authenticated by a shared secret instead. Mounted OUTSIDE the protected
// group in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { nowIso, run } from '../lib/d1';

const app = new Hono<AppEnv>();

/**
 * Minimal shape of the RevenueCat webhook body we consume. RevenueCat sends
 * `{ event: {...}, api_version }`. We read the fields we upsert and ignore the
 * rest. See https://www.revenuecat.com/docs/webhooks for the full schema.
 */
interface RevenueCatEvent {
  event?: {
    type?: string;
    app_user_id?: string;
    original_app_user_id?: string;
    entitlement_id?: string | null;
    entitlement_ids?: string[] | null;
    product_id?: string | null;
    store?: string | null; // APP_STORE | PLAY_STORE | STRIPE | ...
    expiration_at_ms?: number | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITLEMENT LIFECYCLE — derive ACCESS from state, never from the event NAME.
//
// RevenueCat's event names describe what happened to the SUBSCRIPTION, not what
// happened to the user's ACCESS, and conflating the two revokes a paying
// customer mid-period:
//
//   · CANCELLATION  — auto-renew was turned OFF. The user has already paid
//     through `expiration_at_ms` and keeps access until then. It is ALSO the
//     event RevenueCat sends for a refund, in which case `expiration_at_ms` is
//     in the PAST: one event name, two opposite access outcomes, distinguishable
//     only by the date.
//   · BILLING_ISSUE — a charge failed and the store's grace/retry window has
//     begun. Access continues until the store gives up; that deadline is again
//     `expiration_at_ms`.
//   · EXPIRATION    — access has actually ended. The only event that revokes on
//     its own authority.
//
// So the two grace-class events are RESOLVED AGAINST THE PAID-THROUGH DATE
// rather than mapped to is_active = 0. Before this, toggling auto-renew off (or
// a single card blip) dropped the user off Pro on the very next read, because
// /v1/entitlements short-circuits on `is_active !== 1` before it ever reaches
// the `expires_at > now` check. [pipeline 5]M-8 — "do not revoke on
// cancel-at-period-end".
//
// ⚠️ KNOWN GAP, deliberately not fixed here: RevenueCat gives NO ordering
// guarantee, and the UPSERT below overwrites unconditionally, so a delayed
// retry of an older event can still clobber a newer state. Rejecting that needs
// the event's own clock persisted alongside the row — an `event_ts` column on
// the SHARED platform_db, i.e. a migration owned by services/platform. It is
// its own change; do not fake it with `updated_at`, which is receipt time.
// ─────────────────────────────────────────────────────────────────────────────

/** Access is granted outright. */
const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
]);
/** Access is revoked outright — the subscription is over. */
const INACTIVE_TYPES = new Set(['EXPIRATION']);
/** Access is decided by the paid-through date carried on the event itself. */
const GRACE_TYPES = new Set(['CANCELLATION', 'BILLING_ISSUE']);

/**
 * Resolve a handled event type to is_active (0/1).
 *
 * `expiresAtMs` is the event's `expiration_at_ms`. A null/absent date on a
 * grace-class event means "no known end" — the same reading /v1/entitlements
 * already applies to a null `expires_at` — so it keeps access rather than
 * silently revoking. A date in the past (the refund shape of CANCELLATION)
 * revokes immediately.
 */
export function resolveIsActive(
  type: string,
  expiresAtMs: number | null | undefined,
  nowMs: number,
): 0 | 1 {
  if (ACTIVE_TYPES.has(type)) return 1;
  if (INACTIVE_TYPES.has(type)) return 0;
  if (GRACE_TYPES.has(type)) {
    if (typeof expiresAtMs !== 'number' || Number.isNaN(expiresAtMs)) return 1;
    return expiresAtMs > nowMs ? 1 : 0;
  }
  // Unreachable: callers gate on isHandledType first.
  return 0;
}

/** Types this handler acts on. Everything else is an ack-and-ignore no-op. */
export function isHandledType(type: string): boolean {
  return (
    ACTIVE_TYPES.has(type) || INACTIVE_TYPES.has(type) || GRACE_TYPES.has(type)
  );
}

// POST /revenuecat
/** Constant-time string comparison (length leak only — unavoidable). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

app.post('/revenuecat', async (c) => {
  // ── Auth: Bearer <REVENUECAT_WEBHOOK_SECRET> — FAIL CLOSED ──────────────────
  // Without a secret, anyone could write entitlements to the shared PLATFORM_DB.
  const configured = c.env.REVENUECAT_WEBHOOK_SECRET;
  if (!configured) {
    console.error(
      '[webhooks/revenuecat] REVENUECAT_WEBHOOK_SECRET not set — rejecting. ' +
        'Set it via `wrangler secret put` before wiring RevenueCat.',
    );
    return c.json({ error: 'webhook_not_configured' }, 503);
  }
  const authz = c.req.header('Authorization') ?? '';
  if (!safeEqual(authz, `Bearer ${configured}`)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: RevenueCatEvent;
  try {
    body = await c.req.json<RevenueCatEvent>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const ev = body.event;
  const userId = ev?.app_user_id ?? ev?.original_app_user_id;
  if (!ev || !userId) {
    // Nothing actionable; ack so RevenueCat doesn't retry forever.
    console.warn('[webhooks/revenuecat] missing event or app_user_id');
    return c.json({ ok: true });
  }

  const appId = c.env.APP_ID;
  const type = ev.type ?? '';
  // Unknown event types are a NO-OP (ack + ignore) — never silently revoke.
  if (!isHandledType(type)) {
    console.warn(`[webhooks/revenuecat] ignoring unhandled event type: ${type}`);
    return c.json({ ok: true, ignored: type });
  }
  const isActive = resolveIsActive(type, ev.expiration_at_ms, Date.now());
  const expiresAt =
    typeof ev.expiration_at_ms === 'number'
      ? new Date(ev.expiration_at_ms).toISOString()
      : null;
  const store = ev.store ?? null;
  const productId = ev.product_id ?? null;
  const ts = nowIso();

  // An event can carry one or many entitlement ids. Upsert each.
  const entitlementIds =
    ev.entitlement_ids && ev.entitlement_ids.length > 0
      ? ev.entitlement_ids
      : ev.entitlement_id
        ? [ev.entitlement_id]
        : [];

  if (entitlementIds.length === 0) {
    console.warn('[webhooks/revenuecat] event has no entitlement id(s)');
    return c.json({ ok: true });
  }

  const stmt = c.env.PLATFORM_DB.prepare(
    `INSERT INTO entitlements
       (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, app_id, entitlement) DO UPDATE SET
       product_id = excluded.product_id,
       store      = excluded.store,
       is_active  = excluded.is_active,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  );

  await c.env.PLATFORM_DB.batch(
    entitlementIds.map((entId) =>
      stmt.bind(
        userId,
        appId,
        entId,
        productId,
        store,
        isActive,
        expiresAt,
        ts,
      ),
    ),
  );

  return c.json({ ok: true });
});

export default app;
