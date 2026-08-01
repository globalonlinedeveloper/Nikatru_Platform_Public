// ─────────────────────────────────────────────────────────────────────────────
// /v1/webhooks — server-to-server callbacks. NO Supabase user auth here; these
// are authenticated by a shared secret instead. Mounted OUTSIDE the protected
// group in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { nowIso } from '../lib/d1';
import {
  isIdString,
  isPlainObject,
  isoFromEpochMs,
  type Invalid,
} from '../lib/validate';

const app = new Hono<AppEnv>();

/**
 * Minimal shape of the RevenueCat webhook body we consume. RevenueCat sends
 * `{ event: {...}, api_version }`. We read the fields we upsert and ignore the
 * rest. See https://www.revenuecat.com/docs/webhooks for the full schema.
 *
 * ⚠️ This interface documents the shape; it does NOT enforce it. Types are erased
 * before the request lands. `validateEvent` below is the enforcement.
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
 * `expiresAtMs` is the event's `expiration_at_ms`. An ABSENT date (null /
 * undefined) on a grace-class event means "no known end" — the same reading
 * /v1/entitlements applies to a null `expires_at` — so it keeps access rather
 * than silently revoking. A date in the past (the refund shape of CANCELLATION)
 * revokes immediately.
 *
 * An UNREADABLE date is deliberately NOT the absent case: `NaN > nowMs` is
 * false, so it revokes. That used to be a `Number.isNaN(...) return 1` branch —
 * i.e. an expiry nobody could decide GRANTED access, the same fail-open that
 * /v1/entitlements had. `validateEvent` now rejects such an event before this is
 * reached; removing the branch means the fall-through stays correct instead of
 * merely unreachable.
 */
export function resolveIsActive(
  type: string,
  expiresAtMs: number | null | undefined,
  nowMs: number,
): 0 | 1 {
  if (ACTIVE_TYPES.has(type)) return 1;
  if (INACTIVE_TYPES.has(type)) return 0;
  if (GRACE_TYPES.has(type)) {
    if (expiresAtMs === null || expiresAtMs === undefined) return 1;
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

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — the body is public input written straight into the SHARED
// platform_db, so nothing below may reach a bind unchecked. Three concrete holes
// this closes, all reachable from a merely BUGGY sender:
//
//   1. `typeof ev.expiration_at_ms === 'number' ? new Date(...) : null` turned
//      EVERY non-number expiry — a stringified epoch, `"2026-09-01"`, a nested
//      object — into `expires_at = NULL`, which /v1/entitlements reads as a
//      LIFETIME GRANT. An expiry we cannot read must never become "no expiry":
//      it is rejected, so RevenueCat retries and the row keeps its old value.
//   2. `Infinity` (which is what `1e400` parses to out of JSON) IS a number, so
//      it passed that check and `new Date(Infinity).toISOString()` threw a
//      RangeError with no try/catch above it — a 500 the sender retries forever.
//   3. `app_user_id` was unshaped. An object or a number went straight into the
//      PRIMARY KEY of a shared table: D1_TYPE_ERROR (a 500) at best, a row keyed
//      by something no JWT `sub` can ever match at worst — an entitlement paid
//      for and permanently unreachable.
// ─────────────────────────────────────────────────────────────────────────────

/** RevenueCat app_user_id / entitlement id / product id / store bound.
 *  @ceiling none — an identifier column's width, not a platform resource. */
const MAX_ID_LENGTH = 256;
/**
 * One event carrying more than this is not a shape we recognise.
 *
 * @ceiling d1.queriesPerInvocation lte
 *
 * ⚠️ IT SITS EXACTLY ON THE CEILING, AND THAT IS DELIBERATE. The handler issues
 * one UPSERT per entitlement id in a single `PLATFORM_DB.batch()`, so this cap
 * IS the statement count — 50 against D1's documented Free limit of 50 queries
 * per Worker invocation. Raising it by one is a build failure, which is the
 * correct behaviour: the next value is the first one that cannot be served.
 */
const MAX_ENTITLEMENT_IDS = 50;

/** The checked fields of an event we are going to act on. */
export interface ValidatedEvent {
  type: string;
  userId: string;
  entitlementIds: string[];
  productId: string | null;
  store: string | null;
  /** Epoch ms, or null for "no known end". Already proven representable. */
  expiresAtMs: number | null;
  /** ISO form of [expiresAtMs] — converted once, inside validation. */
  expiresAt: string | null;
}

/**
 * Three outcomes, kept distinct on purpose:
 *
 *   · `ok:false`            — malformed. 400, write nothing, let the sender retry.
 *   · `ok:true, act:false`  — well-formed but nothing to do (unknown user, no
 *                             entitlement id, an event type we do not handle).
 *                             200 + ack, write nothing. NEVER a silent revoke.
 *   · `ok:true, act:true`   — checked values, safe to bind.
 *
 * Collapsing the first two is what let a broken payload look like a handled one.
 */
export type ValidatedWebhook =
  | { ok: true; act: true; event: ValidatedEvent }
  | { ok: true; act: false; reason: string; ignoredType?: string }
  | Invalid;

export function validateEvent(body: unknown): ValidatedWebhook {
  if (!isPlainObject(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const evRaw = body.event;
  if (evRaw === undefined || evRaw === null) {
    return { ok: true, act: false, reason: 'missing event' };
  }
  if (!isPlainObject(evRaw)) {
    return { ok: false, detail: 'event must be a JSON object' };
  }

  // ── type — CHECKED FIRST, BEFORE ANY OTHER FIELD ───────────────────────────
  // RevenueCat sends event types we do not consume, and 400ing one of those for
  // a field we would never read turns an ack-and-ignore into an infinite retry
  // that shares a delivery queue with the RENEWAL and EXPIRATION events that
  // actually move money. So: decide whether we care, THEN check what we read.
  // A non-string `type` matches nothing handled, so it takes the same ack path
  // rather than a 400 — a retry cannot fix the shape of that field either.
  const typeRaw = evRaw.type;
  const type = typeof typeRaw === 'string' ? typeRaw : '';
  if (!isHandledType(type)) {
    return { ok: true, act: false, reason: `unhandled event type: ${type}`, ignoredType: type };
  }

  // ── identity ───────────────────────────────────────────────────────────────
  // Absent / null / '' is "no user to act on" and is ACKED — indistinguishable
  // from an event that simply carries no id, and no retry can add one. A
  // PRESENT but wrong-typed or oversized id is a 400: coercing it would key a
  // row in the shared platform_db to something no JWT `sub` can ever match, and
  // an entitlement that is paid for and unreachable is worse than a retry.
  let userId: string | null = null;
  for (const key of ['app_user_id', 'original_app_user_id'] as const) {
    const v = evRaw[key];
    if (v === undefined || v === null || v === '') continue;
    if (!isIdString(v, MAX_ID_LENGTH)) {
      return {
        ok: false,
        detail: `event.${key} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`,
      };
    }
    if (userId === null) userId = v;
  }
  if (userId === null) {
    return { ok: true, act: false, reason: 'missing app_user_id' };
  }

  // ── the paid-through date — the whole money boundary on this side ───────────
  const expRaw = evRaw.expiration_at_ms;
  let expiresAtMs: number | null = null;
  let expiresAt: string | null = null;
  if (expRaw !== undefined && expRaw !== null) {
    const iso = isoFromEpochMs(expRaw);
    if (iso === null) {
      return {
        ok: false,
        detail:
          'event.expiration_at_ms must be a finite epoch-millisecond number ' +
          'within the representable date range',
      };
    }
    expiresAtMs = expRaw as number;
    expiresAt = iso;
  }

  // ── the rest ───────────────────────────────────────────────────────────────
  for (const key of ['product_id', 'store'] as const) {
    const v = evRaw[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || v.length > MAX_ID_LENGTH) {
      return {
        ok: false,
        detail: `event.${key} must be a string of at most ${MAX_ID_LENGTH} characters`,
      };
    }
  }
  const productId = (evRaw.product_id as string | undefined) ?? null;
  const store = (evRaw.store as string | undefined) ?? null;

  const idsRaw = evRaw.entitlement_ids;
  const entitlementIds: string[] = [];
  if (idsRaw !== undefined && idsRaw !== null) {
    if (!Array.isArray(idsRaw)) {
      return { ok: false, detail: 'event.entitlement_ids must be an array' };
    }
    if (idsRaw.length > MAX_ENTITLEMENT_IDS) {
      return {
        ok: false,
        detail: `event.entitlement_ids has ${idsRaw.length} entries, the maximum is ${MAX_ENTITLEMENT_IDS}`,
      };
    }
    for (let i = 0; i < idsRaw.length; i++) {
      const id = idsRaw[i] as unknown;
      if (!isIdString(id, MAX_ID_LENGTH)) {
        return {
          ok: false,
          detail: `event.entitlement_ids[${i}] must be a non-empty string of at most ${MAX_ID_LENGTH} characters`,
        };
      }
      entitlementIds.push(id);
    }
  }
  if (entitlementIds.length === 0) {
    const single = evRaw.entitlement_id;
    if (single !== undefined && single !== null) {
      if (!isIdString(single, MAX_ID_LENGTH)) {
        return {
          ok: false,
          detail: `event.entitlement_id must be a non-empty string of at most ${MAX_ID_LENGTH} characters`,
        };
      }
      entitlementIds.push(single);
    }
  }
  if (entitlementIds.length === 0) {
    return { ok: true, act: false, reason: 'event has no entitlement id(s)' };
  }

  return {
    ok: true,
    act: true,
    event: { type, userId, entitlementIds, productId, store, expiresAtMs, expiresAt },
  };
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

  let body: unknown;
  try {
    body = await c.req.json<RevenueCatEvent>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // ── VALIDATE FIRST — nothing below this line may touch a row otherwise ──────
  const checked = validateEvent(body);
  if (!checked.ok) {
    // 400, NOT an ack: the sender should retry with a body we can read, and the
    // stored entitlement keeps whatever it already said in the meantime.
    console.warn(`[webhooks/revenuecat] rejecting malformed event: ${checked.detail}`);
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }
  if (!checked.act) {
    // Well-formed but nothing to do; ack so RevenueCat doesn't retry forever.
    console.warn(`[webhooks/revenuecat] ${checked.reason}`);
    return checked.ignoredType !== undefined
      ? c.json({ ok: true, ignored: checked.ignoredType })
      : c.json({ ok: true });
  }

  const appId = c.env.APP_ID;
  const { type, userId, entitlementIds, productId, store, expiresAtMs, expiresAt } =
    checked.event;
  const isActive = resolveIsActive(type, expiresAtMs, Date.now());
  const ts = nowIso();

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
