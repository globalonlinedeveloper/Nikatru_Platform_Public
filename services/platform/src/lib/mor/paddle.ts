// ─────────────────────────────────────────────────────────────────────────────
// The PADDLE adapter — the only file in this repo that knows one rail's facts.
//
// [ADR 004]: Paddle is the primary merchant of record; Lemon Squeezy is the
// parallel backup; the webhook is provider-agnostic so the choice flips with
// zero app changes. Everything Paddle-specific is here and nowhere else.
//
// ═════════════════════════════════════════════════════════════════════════════
// VERIFIED AGAINST developer.paddle.com ON 2026-08-01 — every fact below was
// FETCHED, not remembered, not inherited from a prior planning document, and not
// inferred from an SDK. The stage's own research file (00-STAGE-3-14-RESEARCH.md,
// 2026-07-28) carried most of these unverified; they are re-sourced here because
// an invented webhook shape mis-parses silently, and a mis-parse on this boundary
// writes a wrong entitlement that looks exactly like a right one.
//
//  V1 HEADER            `Paddle-Signature`
//                       developer.paddle.com/webhooks/signature-verification
//  V2 HEADER FORMAT     `ts=<unix seconds>;h1=<hex>` — two fields, `;` separated
//  V3 ALGORITHM         HMAC-SHA256 with the notification-setting secret
//  V4 SIGNED PAYLOAD    the string `${ts}:${rawBody}` — the RAW body, with the
//                       docs' own warning: "Don't transform or process the raw
//                       body of the request, including adding whitespace"
//  V5 SECRET PREFIX     `pdl_ntfset_`
//  V6 REPLAY TOLERANCE  five seconds (Paddle's SDKs enforce this by default)
//  V7 TOP-LEVEL BODY    `event_id`, `event_type`, `occurred_at`,
//                       `notification_id`, `data`
//                       developer.paddle.com/webhooks/about/respond-to-webhooks
//  V8 DELIVERY          success = HTTP 200 within five seconds. Live retries 60
//                       times over 3 days (first 20 in the first hour); sandbox
//                       3 times in 15 minutes. Exponential backoff, 60 s base,
//                       1.1 multiplier.
//  V9 SUBSCRIPTION      `status` ∈ active | canceled | past_due | paused |
//     ENTITY            trialing; `current_billing_period` = { starts_at,
//                       ends_at } and is NULL for paused/canceled;
//                       `items[].trial_dates` = { starts_at, ends_at };
//                       `transaction_id` on subscription.created only;
//                       `custom_data` is carried on the entity
//                       developer.paddle.com/webhooks/subscriptions/subscription-created
// V10 ADJUSTMENT        `action` ∈ credit | refund | chargeback |
//     ENTITY            chargeback_reverse | chargeback_warning |
//                       chargeback_warning_reverse | credit_reverse;
//                       `status` ∈ pending_approval | approved | rejected |
//                       reversed; `transaction_id`, `subscription_id`
//                       developer.paddle.com/api-reference/adjustments/create-adjustment
//                       developer.paddle.com/webhooks/adjustments/adjustment-created
// V11 SANDBOX SHAPES    API keys: `pdl_sdbx_apikey_` (sandbox) vs
//                       `pdl_live_apikey_` (live). Base URLs:
//                       `sandbox-api.paddle.com` vs `api.paddle.com`. Sandbox
//                       client-side tokens begin `test_`.
//                       developer.paddle.com/api-reference/about/authentication
//                       developer.paddle.com/sdks/sandbox
// V12 ENTITY ID SHAPES  `sub_[26 alphanumeric]` for a subscription and
//                       `txn_[26 alphanumeric]` for a transaction, as typed on
//                       the adjustment reference's own fields.
//                       developer.paddle.com/api-reference/adjustments/create-adjustment
//
// ═════════════════════════════════════════════════════════════════════════════
// 🔴 UNVERIFIED — NOT ENCODED ANYWHERE BELOW. Each of these was reachable only
// through a secondary summary, and each is refused rather than guessed. Where a
// design would otherwise depend on one, the design was changed so it does not.
//
//  U1 WHETHER THE NOTIFICATION BODY IDENTIFIES ITS OWN ENVIRONMENT. No primary
//     page establishes a live/sandbox marker in the payload. → the environment
//     comes from CONFIGURATION (`MONEY_ENVIRONMENT` + which secret verified the
//     signature), never from the body. [5]M-12 is enforced at the config layer.
//  U2 WHETHER THE DESTINATION SECRET DIFFERS IN SHAPE BETWEEN SANDBOX AND LIVE.
//     `pdl_ntfset_` is documented; nothing establishes a sandbox variant. → the
//     guard must NOT try to tell them apart by the secret. It cannot be done.
//  U3 WHETHER `custom_data` SET AT CHECKOUT PROPAGATES ONTO RENEWAL
//     TRANSACTIONS. → attribution never depends on it after the first
//     notification: the (provider, subscription) → account link is written down
//     once, in `provider_accounts` (migration 0004 section C).
//  U4 THE COMPLETE `event_type` LIST. Only `subscription.created` and
//     `adjustment.created` were sourced. → NOTHING here keys on the event name.
//     The subject is recognised from the ENTITY SHAPE in `data`, so the adapter
//     is correct for every subscription and adjustment event whether or not its
//     name was ever written down here.
//  U5 THE HOSTED-CHECKOUT URL SHAPE (`_ptxn=` and friends) and the claim that
//     hosted checkout works on all six platforms. → no checkout URL is
//     constructed in this file.
//  U6 A MANDATORY PADDLE 30-DAY MONEY-BACK GUARANTEE. Asserted by a secondary
//     summary; neither primary page confirms it. It bears on the published
//     refund window (sites/nikatru/refund.html publishes 7 days) and is an OWNER
//     decision, not an agent's.
// ═════════════════════════════════════════════════════════════════════════════
import {
  type MoRWebhookVerifier,
  type NormalizedNotification,
  type ParseOutcome,
  type SubjectAdjustment,
  type SubjectSubscription,
  type MoneySubject,
  type VerifyOutcome,
  normalizeInstant,
} from './contract';

/** V5. Also the prefix `tooling/ci/assert-money-config.mjs` refuses to see committed. */
export const PADDLE_SECRET_PREFIX = 'pdl_ntfset_';

/**
 * V6 — five seconds, Paddle's own SDK default.
 *
 * ⚠️ IT IS ENFORCED IN BOTH DIRECTIONS. A timestamp five seconds in the FUTURE is
 * as much a forgery signal as one five seconds in the past, and a one-sided
 * window lets a captured request be replayed forever by a clock claim. Paddle
 * retries 60 times over 3 days (V8), so a delivery rejected for staleness is
 * re-delivered rather than lost — the tight window costs nothing that the retry
 * schedule does not repay.
 */
/** @ceiling none — a VENDOR-DOCUMENTED TOLERANCE, not a platform resource. Its
 *  right-hand side is developer.paddle.com's own SDK default (five seconds),
 *  which is a fact about the sender rather than a Cloudflare limit, so there is
 *  no arithmetic for the ceiling guard to check. Widening it costs nothing on
 *  any platform budget and buys an attacker a longer replay window, which is the
 *  only reason to keep it pinned. */
export const PADDLE_REPLAY_TOLERANCE_SECONDS = 5;

/** V9 — the documented status set, complete. */
const SUBSCRIPTION_STATUSES = new Set(['active', 'canceled', 'past_due', 'paused', 'trialing']);

/**
 * V12 — the subscription entity's id format, documented as
 * `sub_[26 alphanumeric chars]` on the adjustment reference (which types its own
 * `subscription_id` field that way, alongside `txn_[26]` for transactions).
 *
 * This is what identifies the ENTITY, so the status check can be strict. The
 * length is deliberately NOT pinned to exactly 26: an id-length change is a
 * cosmetic vendor detail that would silently stop this rail recognising every
 * subscription, and the prefix alone already separates it from `txn_`, `adj_`,
 * `ctm_` and `pro_`.
 */
const SUBSCRIPTION_ID_PREFIX = /^sub_[A-Za-z0-9]+$/;

/** V10 — the documented adjustment action set, complete. */
const ADJUSTMENT_ACTIONS = new Set([
  'credit',
  'refund',
  'chargeback',
  'chargeback_reverse',
  'chargeback_warning',
  'chargeback_warning_reverse',
  'credit_reverse',
]);

/** V10 — the documented adjustment status set, complete. */
const ADJUSTMENT_STATUSES = new Set(['pending_approval', 'approved', 'rejected', 'reversed']);

/**
 * The metadata keys OUR checkout sets. These are not vendor facts — Paddle's
 * `custom_data` is a free-form object we fill in, so this is our own contract
 * with our own client, and the client half must use the same two strings.
 */
export const PADDLE_CUSTOM_DATA_USER_ID = 'nikatru_user_id';
export const PADDLE_CUSTOM_DATA_APP_ID = 'nikatru_app_id';

/** @ceiling none — bounds the WIDTH of one provider identifier we copy into a
 *  TEXT column, not a platform resource. Paddle's documented entity ids are
 *  `<prefix>_[26 alphanumeric]`, so 128 is generous by a factor of four and
 *  nothing in D1, KV or Workers moves with it. */
const MAX_ID_LEN = 128;
/** @ceiling none — RFC 5321's maximum forward-path length. An input SHAPE
 *  cap on a value we never store in plaintext (only its SHA-256), so no
 *  platform limit is on the other side of it. */
const MAX_EMAIL_LEN = 320;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const idOrNull = (v: unknown, max = MAX_ID_LEN): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Constant-time comparison of two hex signatures. Length is compared first and
 * that leak is unavoidable and harmless — both sides are fixed-width SHA-256
 * hex, so a length mismatch means "not a SHA-256 hex string" rather than
 * anything about the secret.
 */
function safeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

/** V2 — `ts=<unix seconds>;h1=<hex>`, order-independent, unknown fields ignored. */
export function parsePaddleSignatureHeader(
  header: string,
): { ok: true; ts: number; h1: string } | { ok: false; reason: string } {
  const parts = header.split(';');
  let ts: number | null = null;
  let h1: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') {
      // Unix SECONDS. `Number()` on '' is 0, which would be a 1970 timestamp
      // that the tolerance window rejects anyway — but an explicit shape check
      // makes the refusal say what was wrong instead of blaming the clock.
      if (!/^\d{1,15}$/.test(value)) return { ok: false, reason: 'ts is not a unix-second integer' };
      ts = Number(value);
    } else if (key === 'h1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: 'h1 is not a 64-character hex digest' };
      h1 = value.toLowerCase();
    }
    // Any other field is IGNORED rather than rejected: Paddle documents `h1`
    // as one of a possible set of signature versions, so a future `h2` must not
    // break a destination that still verifies h1 correctly.
  }
  if (ts === null) return { ok: false, reason: 'signature header carries no ts' };
  if (h1 === null) return { ok: false, reason: 'signature header carries no h1' };
  return { ok: true, ts, h1 };
}

/** V3 + V4 — HMAC-SHA256 over `${ts}:${rawBody}`. Exported for the tests. */
export async function paddleSignature(secret: string, ts: number, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}:${raw}`)));
}

/** V9 — translate Paddle's status into the portfolio's access vocabulary. */
function accessForStatus(status: string): {
  access: SubjectSubscription['access'];
  endsWithReason: string | null;
} | null {
  switch (status) {
    case 'active':
      return { access: 'granted', endsWithReason: null };
    case 'trialing':
      return { access: 'trialing', endsWithReason: null };
    case 'canceled':
      // Auto-renew is off. The already-paid period is honoured — revoking here
      // is the exact defect services/subly-api/src/routes/webhooks.ts:40-63
      // records and fixed: "do not revoke on cancel-at-period-end".
      return { access: 'until_end', endsWithReason: 'cancelled_at_period_end' };
    case 'past_due':
      // A charge failed and the rail is retrying. Access continues to the end of
      // the period already paid for; when that passes with the charge still
      // unmade, the subscriber has lapsed. "Dunning is cut (stage 13)" is about
      // the RETENTION campaign, never about the entitlement consequence.
      return { access: 'until_end', endsWithReason: 'payment_failed_final' };
    case 'paused':
      // V9: `current_billing_period` is NULL for a paused subscription, so there
      // is no paid-through date to honour and access stops now.
      return { access: 'suspended', endsWithReason: 'subscription_paused' };
    default:
      return null;
  }
}

/** V10 — translate an adjustment action into the portfolio's reason set. */
function reasonForAction(action: string): { reason: string | null; restores: boolean } | null {
  switch (action) {
    case 'refund':
      return { reason: 'refund_approved', restores: false };
    case 'chargeback':
      return { reason: 'chargeback', restores: false };
    case 'chargeback_reverse':
    case 'chargeback_warning_reverse':
      return { reason: 'chargeback_reversed', restores: true };
    case 'chargeback_warning':
      // A WARNING is notice that a dispute may be coming. It moves no money and
      // it must not move access: pre-emptively locking a customer who has not
      // actually charged back is a support incident we would create ourselves.
      return { reason: null, restores: false };
    case 'credit':
    case 'credit_reverse':
      // A credit adjusts a balance on the rail. It is not a reversal of the
      // payment that bought access, so it changes no entitlement.
      return { reason: null, restores: false };
    default:
      return null;
  }
}

/** V9 — the earliest trial end across the entity's items, or null. */
function trialEndOf(data: Record<string, unknown>): { ok: true; iso: string | null } | { ok: false } {
  const items = data.items;
  if (!Array.isArray(items)) return { ok: true, iso: null };
  let earliest: string | null = null;
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const dates = item.trial_dates;
    if (!isPlainObject(dates)) continue;
    const end = normalizeInstant(dates.ends_at);
    if (!end.ok) return { ok: false };
    if (end.iso === null) continue;
    if (earliest === null || Date.parse(end.iso) < Date.parse(earliest)) earliest = end.iso;
  }
  return { ok: true, iso: earliest };
}

function parseSubscription(data: Record<string, unknown>): ParseOutcome | SubjectSubscription {
  const status = data.status;
  if (typeof status !== 'string' || !SUBSCRIPTION_STATUSES.has(status)) {
    // A status outside the documented set is NOT a weak grant and NOT an
    // ack-and-ignore: it means the entity is not the entity this adapter was
    // written against, and acting on it would be acting on a guess.
    return { ok: false, reason: `data.status ${JSON.stringify(status)} is not a documented Paddle subscription status` };
  }
  const mapped = accessForStatus(status);
  if (mapped === null) {
    return { ok: false, reason: `no access mapping for subscription status '${status}'` };
  }
  const subscriptionId = idOrNull(data.id);
  if (subscriptionId === null) {
    return { ok: false, reason: 'data.id is missing or not a usable subscription id' };
  }

  // V9 — `current_billing_period` is an object, or null for paused/canceled.
  let periodEnd: string | null = null;
  const period = data.current_billing_period;
  if (period !== null && period !== undefined) {
    if (!isPlainObject(period)) {
      return { ok: false, reason: 'data.current_billing_period is present but is not an object' };
    }
    const end = normalizeInstant(period.ends_at);
    if (!end.ok) {
      return { ok: false, reason: 'data.current_billing_period.ends_at could not be read as a date' };
    }
    periodEnd = end.iso;
  }

  const trial = trialEndOf(data);
  if (!trial.ok) return { ok: false, reason: 'a data.items[].trial_dates.ends_at could not be read as a date' };

  const custom = isPlainObject(data.custom_data) ? data.custom_data : {};
  const customer = isPlainObject(data.customer) ? data.customer : {};

  return {
    kind: 'subscription',
    subscriptionId,
    statusVerbatim: status,
    access: mapped.access,
    endsWithReason: mapped.endsWithReason,
    currentPeriodEnd: periodEnd,
    trialEnd: trial.iso,
    transactionId: idOrNull(data.transaction_id),
    accountUserId: idOrNull(custom[PADDLE_CUSTOM_DATA_USER_ID]),
    accountAppId: idOrNull(custom[PADDLE_CUSTOM_DATA_APP_ID]),
    customerId: idOrNull(data.customer_id) ?? idOrNull(customer.id),
    customerEmail: idOrNull(customer.email, MAX_EMAIL_LEN),
  };
}

function parseAdjustment(data: Record<string, unknown>): ParseOutcome | SubjectAdjustment {
  const action = data.action;
  if (typeof action !== 'string' || !ADJUSTMENT_ACTIONS.has(action)) {
    return { ok: false, reason: `data.action ${JSON.stringify(action)} is not a documented Paddle adjustment action` };
  }
  const status = data.status;
  if (typeof status !== 'string' || !ADJUSTMENT_STATUSES.has(status)) {
    return { ok: false, reason: `data.status ${JSON.stringify(status)} is not a documented Paddle adjustment status` };
  }
  const mapped = reasonForAction(action);
  if (mapped === null) {
    return { ok: false, reason: `no revocation mapping for adjustment action '${action}'` };
  }
  return {
    kind: 'adjustment',
    actionVerbatim: action,
    statusVerbatim: status,
    transactionId: idOrNull(data.transaction_id),
    subscriptionId: idOrNull(data.subscription_id),
    reason: mapped.reason,
    restores: mapped.restores,
    // V10 — only an APPROVED adjustment has moved money. `pending_approval`
    // must not revoke: a refund request that is later rejected would otherwise
    // have already taken a paying customer's access away.
    effective: status === 'approved',
  };
}

/**
 * Which entity is in `data`. U4: recognised from the ENTITY SHAPE, never from
 * the event name — the complete `event_type` list is not established from a
 * primary source, and a name-keyed adapter is wrong for every event whose name
 * was never written down here.
 */
function subjectOf(data: Record<string, unknown>, eventType: string): ParseOutcome | MoneySubject {
  if (typeof data.action === 'string' && ADJUSTMENT_ACTIONS.has(data.action)) {
    return parseAdjustment(data);
  }
  // 🔴 RECOGNISED BY THE ENTITY ID PREFIX, NOT BY THE STATUS VALUE. The first
  // version of this function said "it is a subscription if `data.status` is one
  // of the five documented statuses", and its own test caught what that means: a
  // subscription carrying a status Paddle adds LATER would stop being recognised
  // as a subscription at all and be silently ignored — the rail would keep the
  // stale row and say nothing. Keying on the id prefix instead makes the status
  // check STRICT and LOUD: this IS a subscription, so a status outside the
  // documented set is a 400 and a retry, never a shrug.
  if (SUBSCRIPTION_ID_PREFIX.test(String(data.id ?? ''))) {
    return parseSubscription(data);
  }
  // Neither shape. This is NOT a failure: Paddle sends event types this rail does
  // not consume (products, prices, customers, reports), and 400ing one of those
  // starts an infinite retry that shares a delivery queue with the events that
  // actually move money. The notification is still stored VERBATIM with this
  // detail on it, so "we ignored it" is a fact in the database rather than a
  // silence.
  return { kind: 'unknown', detail: `no subscription or adjustment entity in data for event_type '${eventType}'` };
}

export const paddleVerifier: MoRWebhookVerifier = {
  provider: 'paddle',
  secretEnvVar: 'PADDLE_NOTIFICATION_SECRET',

  async verify(raw: string, headers: Headers, secret: string, nowMs: number): Promise<VerifyOutcome> {
    if (secret.length === 0) {
      return { ok: false, status: 503, reason: 'no destination secret configured' };
    }
    const header = headers.get('Paddle-Signature');
    if (header === null || header.length === 0) {
      return { ok: false, status: 401, reason: 'no Paddle-Signature header' };
    }
    if (header.length > 512) {
      return { ok: false, status: 400, reason: 'Paddle-Signature header is implausibly long' };
    }
    const parsed = parsePaddleSignatureHeader(header);
    if (!parsed.ok) return { ok: false, status: 400, reason: parsed.reason };

    // Replay window BEFORE the HMAC: a stale request is rejected without
    // spending a key import and a digest on it.
    const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.ts);
    if (skewSeconds > PADDLE_REPLAY_TOLERANCE_SECONDS) {
      return {
        ok: false,
        status: 401,
        reason: `timestamp is ${skewSeconds}s from now, outside the ${PADDLE_REPLAY_TOLERANCE_SECONDS}s tolerance`,
      };
    }
    const expected = await paddleSignature(secret, parsed.ts, raw);
    if (!safeEqualHex(expected, parsed.h1)) {
      return { ok: false, status: 401, reason: 'signature does not match' };
    }
    return { ok: true };
  },

  parse(raw: string): ParseOutcome {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'body is not JSON' };
    }
    if (!isPlainObject(body)) return { ok: false, reason: 'body is not a JSON object' };

    // V7 — the four top-level fields this rail depends on. Every one is REQUIRED
    // to be present and usable; there is no default for any of them, because a
    // defaulted event id breaks dedup and a defaulted occurred_at breaks
    // ordering, and both failures write a wrong row silently.
    const eventId = idOrNull(body.event_id);
    if (eventId === null) return { ok: false, reason: 'event_id is missing or unusable' };
    const eventType = idOrNull(body.event_type);
    if (eventType === null) return { ok: false, reason: 'event_type is missing or unusable' };
    const occurred = normalizeInstant(body.occurred_at);
    if (!occurred.ok || occurred.iso === null) {
      return { ok: false, reason: 'occurred_at is missing or could not be read as a date' };
    }
    const data = body.data;
    if (!isPlainObject(data)) return { ok: false, reason: 'data is missing or is not an object' };

    const subject = subjectOf(data, eventType);
    if ('ok' in subject) return subject; // a ParseOutcome refusal

    const notification: NormalizedNotification = {
      provider: 'paddle',
      eventId,
      notificationId: idOrNull(body.notification_id),
      eventType,
      occurredAt: occurred.iso,
      subject,
    };
    return { ok: true, notification };
  },
};
