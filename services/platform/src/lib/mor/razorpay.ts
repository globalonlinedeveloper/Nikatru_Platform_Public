import { isPlainObject } from '../../../../_shared/src/validate';
import { isMoneyEnvironment } from './contract';
import type { MoRWebhookVerifier, MoneyEnvironment, MoneySubject, ParseOutcome, SubjectSubscription, VerifyOutcome } from './contract';

// ─────────────────────────────────────────────────────────────────────────────
// razorpay.ts — THE INDIA RAIL'S SIGNATURE CHECK, AND ITS PAYLOAD MAPPING (⏱ 2026-10-01).
//
// [ADR 076]: India domestic sales run on Razorpay; every non-India channel stays
// on Paddle. Nikatru is the seller of record and issues the GST invoice; Razorpay
// is the payment gateway. [ADR 004]'s seam is what makes that a file and a
// registry line rather than a rewrite.
//
// ── WHAT IS ESTABLISHED HERE, AND FROM WHERE ─────────────────────────────────
// Read 2026-09-12 from Razorpay's own documentation
// (razorpay.com/docs/webhooks/validate-test/), quoted rather than paraphrased
// because the registry's own standard is that an adapter rests on a PRIMARY
// SOURCE and never on a remembered scheme:
//
//   · "The hash signature is calculated using HMAC with SHA256 algorithm; with
//      your webhook secret set as the key and the webhook request body as the
//      message."
//   · the header is `X-Razorpay-Signature`, and the digest is written as
//      "HMAC Hex Digest": `expected_signature = hmac('sha256', message, key)`.
//   · "ensure that the webhook body passed as an argument is the raw webhook
//      request body. Do not parse or cast the webhook request body."
//   · duplicates are identified by the `x-razorpay-event-id` header, whose value
//      "is unique per event".
//
// 🔴 THREE DIFFERENCES FROM PADDLE THAT MATTER, ALL OF THEM SOURCED:
//   1. NO TIMESTAMP IS SIGNED. Paddle signs `${ts}:${body}` and this adapter's
//      sibling rejects a stale request before spending a digest. Razorpay signs
//      the body alone, so there is no timestamp to check and NO REPLAY WINDOW CAN
//      BE DERIVED FROM THE SIGNATURE. `nowMs` is therefore unused here, and that
//      is a property of the rail rather than an oversight — inventing a window
//      from a body field would be a guess wearing a check's clothes. Replay
//      defence for this rail STARTS at the store's idempotency on the event id,
//      where Razorpay's own documentation puts it, and does not end there: that id
//      is an unsigned header (see "AND THE ID IS NOT SIGNED" below).
//   2. THE DIGEST IS OVER THE BODY ALONE, so `raw` is passed through untouched.
//   3. THE EVENT ID IS A HEADER, NOT A BODY FIELD. See `parse` below.
//
// ── ⏱ 2026-10-01 · fix-india-rail-tax-data · WHAT `parse` NOW MAPS, AND FROM WHAT ──
// Until today `parse` REFUSED every body, because the signature page does not
// document the event payloads and no live sample existed. It now translates the
// subscription, refund and dispute events below into the contract's vocabulary
// (O-RAZORPAY-CHECKOUT-ADAPTER). ⚠️ THE SOURCE, STATED EXACTLY: the shapes are
// written against Razorpay's published webhook payload examples
// (razorpay.com/docs/webhooks/payloads/ — subscriptions, refunds, disputes). Those
// pages could NOT be fetched from the build sandbox on 2026-10-01 (HTTP 404 at
// /docs/webhooks/payloads/subscriptions/ and /docs/webhooks/subscriptions/), so
// what follows is the docs' published envelope as the author knows it, NOT a page
// re-read today and NOT a delivered event. No live or test-mode sample exists in
// this repository. EVERY SHAPE BELOW IS TO BE CONFIRMED AGAINST THE FIRST
// DELIVERED TEST-MODE EVENT, and a body that does not match is REFUSED (400, the
// rail retries, nothing is written) — never guessed into a row.
//
//   ENVELOPE   { entity: "event", account_id, event, contains: [...],
//                payload: { subscription?: { entity }, payment?: { entity },
//                           refund?: { entity }, dispute?: { entity } },
//                created_at: <unix seconds> }
//   EVENT ID   the `x-razorpay-event-id` HEADER, passed in as `eventIdHint`
//              (below); a parse without it is refused.
//   ORDERING   `created_at` (unix seconds) → `occurredAt`. ⚠️ THE CLOCK IS WHOLE
//              SECONDS (PR #1149 ruling item 6): the store applies only a STRICTLY
//              newer `occurred_at` (store.ts upsertEntitlement and moneyWentBackFor),
//              so two DIFFERENT events stamped in the same second — say
//              `subscription.charged` then `subscription.cancelled` — keep the FIRST
//              DELIVERED and conclude the second `stale`. Rare, and the price of the
//              replay defence below (a replay under a fresh id at the same instant is
//              dropped); the dropped event is stored, and the subscription's next
//              event re-states its status from the entity.
//
//   subscription.{activated,charged,resumed,authenticated,pending,halted,
//   paused,cancelled,completed}: access is derived from the ENTITY's `status`,
//   never from the event name (contract.ts decideSubscription), so an event name
//   this file never lists still decides correctly from its entity:
//     active        → granted, to `current_end` (an active body with no
//                     `current_end` is REFUSED: a null end reads as lifetime).
//     authenticated → trialing ONLY when `start_at` (the first charge) is later
//                     than the event's `created_at`: the free part ends at
//                     `start_at`, which is both `trialEnd` and the period end.
//                     Authenticated with no future start changes no access
//                     (`unknown`; the charge that follows decides).
//     cancelled / completed → until_end, `cancelled_at_period_end` (INV-514:
//                     a cancel ends renewal, the paid period is kept).
//     pending       → until_end, `payment_failed_final` (Razorpay is retrying
//                     the charge; access runs out with the paid period).
//     halted        → suspended, `payment_failed_final` (retries exhausted).
//     paused        → suspended, `subscription_paused`.
//     expired       → suspended, `subscription_expired`.
//     created       → `unknown` (nothing paid, nothing authorised).
//   refund.processed → adjustment `refund_approved`, effective (the refund
//                     entity's `status` is `processed`).
//   payment.dispute.{created,under_review,action_required,lost} → adjustment
//                     `chargeback` (a dispute HOLDS: it revokes while open).
//   payment.dispute.won, and .closed whose dispute `status` is `won` →
//                     `chargeback_reversed`, the contract's one `restores` member.
//   anything else  → `unknown`: stored verbatim, answered 200, never a crash.
//
//   ATTRIBUTION  `notes.user_id` / `notes.app_id` on the subscription entity —
//                the notes OUR razorpay-rail.ts sets when it creates the
//                subscription. Absent → `accountUserId: null`: stored, unlinked,
//                never granted.
//   THE MONEY WORLD  no Razorpay body field names it. razorpay-rail.ts writes
//                `notes.env` (`live` | `sandbox`) at creation, and it is mapped
//                to `railEnvironment`, so the store REFUSES an event of the other
//                world. Absent → null: configuration stays the authority. An
//                unreadable `notes.env` is a REFUSAL, never a default.
//   ⚠️ THE ADJUSTMENT'S SUBSCRIPTION — RESOLVED BY PAYMENT (⏱ 2026-10-02, PR
//                #1149 ruling item 2, option b). A refund or a dispute names a
//                PAYMENT (`payment_id`), and the store finds the account by
//                subscription id. Whether a real refund's payment entity carries
//                the subscription is UNCONFIRMED (the docs' payment entity names
//                `invoice_id`), so the link no longer rests on it: every
//                `subscription.charged` names the payment it charged, and the
//                store writes `payment id → subscription id` there
//                (store.ts `linkPayment`, migration 0025); an adjustment resolves
//                its subscription by its `payment_id` through that link FIRST.
//                Only with no stored link does the store fall back to what THIS
//                file reads off the body: the event's own subscription entity,
//                the payment entity's `subscription_id`, then its
//                `notes.subscription_id`. With neither, the adjustment is stored
//                unclaimed and changes no access — a missed revocation, recorded
//                and visible, never a wrong one. The link is still unproven on a
//                real event: tooling/ports/payments.json keeps the razorpay
//                `refund revokes` case PENDING until one test-mode refund is seen
//                to resolve by it.
//
// ⚠️ THE ACCOUNT WAS NEVER THE MISSING PIECE (corrected earlier, kept): the
// Razorpay account is `plan: live, KYC complete` as of 2026-09-05
// (Private/platform-state/identity.json). What the first delivered event still
// waits on is a webhook endpoint configured on it and its secret captured
// (RAZORPAY_WEBHOOK_SECRET) — an owner step, not code.
//
// ⚬ THE EVENT-ID SOURCE IS DECIDED (⏱ 2026-09-24, O-RAZORPAY-CHECKOUT-ADAPTER).
// Razorpay's unique event id lives in `x-razorpay-event-id`, a header, and
// `scheduled.ts` re-parses STORED payloads where no header survives. So the id
// travels beside the body instead of inside it: this verifier names the header
// (`eventIdHeader` below), the door refuses a verified delivery without it (400
// `missing_event_id`, nothing stored) and passes its value to `parse` as
// `eventIdHint`, the store persists that id as `provider_event_id`, and the
// nightly replay passes the stored id back as the same hint. No body field that
// no documentation promises is needed. (⏱ 2026-10-01: the BODY SHAPE is now mapped
// from the docs' examples, above — still to be confirmed on a real test-mode event.)
//
// ⚠️ AND THE ID IS NOT SIGNED. The digest covers the body alone (difference 2
// above), so the header is caller-controlled: a replayed genuine body under a
// fresh id passes `verify` and is not a duplicate by id. Whatever `parse` derives
// must therefore stay safe to apply twice on what the SIGNED body says, never
// lean on the id alone for replay defence. ⏱ 2026-10-01: it does — every field
// `parse` maps is read from the SIGNED body (the entity's status and dates, our
// notes, and the signed `created_at` as the ordering clock), so a replay under a
// fresh id re-states the same decision at the same instant and cannot outrank a
// newer event; nothing is derived from the header but the dedup key.
// ─────────────────────────────────────────────────────────────────────────────

/** Razorpay's own header, spelled as the documentation spells it. Header lookup
 *  is case-insensitive per the Fetch standard, so the casing is cosmetic. */
const SIGNATURE_HEADER = 'X-Razorpay-Signature';

/** A hex SHA-256 digest is 64 hex characters. Anything else is malformed rather
 *  than wrong — a 400, not a 401, exactly as the contract separates them. */
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time compare over the ASCII of two hex digests.
 *
 * The same shape the Paddle adapter uses, and for the same reason: a length check
 * short-circuits, so the lengths are compared first and the BYTES only when they
 * match. Neither branch reveals anything about the secret.
 */
function safeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a.toLowerCase());
  const bb = enc.encode(b.toLowerCase());
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

/** HMAC-SHA256 of the RAW body under the webhook secret, hex. Exported for the
 *  tests, which compute their own vectors rather than trusting this function to
 *  grade itself. */
export async function razorpaySignature(secret: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · fix-india-rail-tax-data · THE PAYLOAD MAPPING (see the header).
// ─────────────────────────────────────────────────────────────────────────────

/** The notes keys OUR subscription creation writes (razorpay-rail.ts imports these — one constant, two ends). */
export const RAZORPAY_NOTE_USER_ID = 'user_id';
export const RAZORPAY_NOTE_APP_ID = 'app_id';
export const RAZORPAY_NOTE_OFFERING_ID = 'offering_id';
export const RAZORPAY_NOTE_ENV = 'env';

/** @ceiling none — an input SHAPE cap on an id copied into a row. */
const MAX_ID_LEN = 128;

function idOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_ID_LEN ? t : null;
}

/** Unix SECONDS → ISO-8601, or null for anything that is not a positive integer. Never NaN. */
function unixToIso(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 32_503_680_000) return null;
  return new Date(v * 1000).toISOString();
}

/** A unix field that may be absent (null) but, when present, must be readable. */
function optionalUnix(v: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, iso: null };
  const iso = unixToIso(v);
  return iso === null ? { ok: false } : { ok: true, iso };
}

/** `notes` is an object of strings, or an EMPTY ARRAY when none were set (the docs' examples show `[]`). */
function notesOf(entity: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(entity.notes) ? entity.notes : {};
}

/** `payload.<name>.entity`, or null. */
function entityOf(payload: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const wrap = payload[name];
  if (!isPlainObject(wrap)) return null;
  return isPlainObject(wrap.entity) ? wrap.entity : null;
}

/** The subscription statuses this file maps; anything else on a subscription entity is a REFUSAL. */
const SUBSCRIPTION_STATUSES = new Set([
  'created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused',
]);

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]+$/;

function parseSubscription(
  eventType: string,
  sub: Record<string, unknown>,
  payment: Record<string, unknown> | null,
  occurredAt: string,
): ParseOutcome | MoneySubject {
  const status = sub.status;
  if (typeof status !== 'string' || !SUBSCRIPTION_STATUSES.has(status)) {
    return { ok: false, reason: `razorpay: subscription status ${JSON.stringify(status)} is not one this adapter maps` };
  }
  const subscriptionId = idOrNull(sub.id);
  if (subscriptionId === null || !SUBSCRIPTION_ID.test(subscriptionId)) {
    return { ok: false, reason: 'razorpay: subscription entity id is missing or not a sub_ id' };
  }
  const currentEnd = optionalUnix(sub.current_end);
  if (!currentEnd.ok) return { ok: false, reason: 'razorpay: subscription current_end is present but unreadable' };
  const startAt = optionalUnix(sub.start_at);
  if (!startAt.ok) return { ok: false, reason: 'razorpay: subscription start_at is present but unreadable' };

  const notes = notesOf(sub);
  // THE MONEY WORLD: our own `notes.env`, when we set it. Present but not a world is refused.
  let railEnvironment: MoneyEnvironment | null = null;
  const env = notes[RAZORPAY_NOTE_ENV];
  if (env !== undefined && env !== null) {
    if (!isMoneyEnvironment(env)) return { ok: false, reason: `razorpay: notes.${RAZORPAY_NOTE_ENV} ${JSON.stringify(env)} is not a money world` };
    railEnvironment = env;
  }

  let access: SubjectSubscription['access'];
  let endsWithReason: string | null = null;
  let periodEnd = currentEnd.iso;
  let trialEnd: string | null = null;
  switch (status) {
    case 'active':
      // A null end on a grant reads as LIFETIME downstream — the fail-open this rail exists to keep out.
      if (periodEnd === null) return { ok: false, reason: 'razorpay: an active subscription with no current_end cannot be granted' };
      access = 'granted';
      break;
    case 'authenticated':
      // The mandate is authorised; the first charge is at `start_at`. Free access exists only when that is later.
      if (startAt.iso === null || Date.parse(startAt.iso) <= Date.parse(occurredAt)) {
        return { kind: 'unknown', detail: `subscription ${subscriptionId} is authenticated with no future start_at; the charge decides access` };
      }
      access = 'trialing';
      trialEnd = startAt.iso;
      periodEnd = startAt.iso;
      break;
    case 'cancelled':
    case 'completed':
      access = 'until_end';
      endsWithReason = 'cancelled_at_period_end';
      break;
    case 'pending':
      access = 'until_end';
      endsWithReason = 'payment_failed_final';
      break;
    case 'halted':
      access = 'suspended';
      endsWithReason = 'payment_failed_final';
      break;
    case 'paused':
      access = 'suspended';
      endsWithReason = 'subscription_paused';
      break;
    case 'expired':
      access = 'suspended';
      endsWithReason = 'subscription_expired';
      break;
    default:
      // `created`: nothing paid, nothing authorised.
      return { kind: 'unknown', detail: `subscription ${subscriptionId} is '${status}' (${eventType}); no access follows from it` };
  }
  return {
    kind: 'subscription',
    subscriptionId,
    statusVerbatim: status,
    access,
    endsWithReason,
    currentPeriodEnd: periodEnd,
    trialEnd,
    transactionId: payment === null ? null : idOrNull(payment.id),
    accountUserId: idOrNull(notes[RAZORPAY_NOTE_USER_ID]),
    accountAppId: idOrNull(notes[RAZORPAY_NOTE_APP_ID]),
    customerId: idOrNull(sub.customer_id),
    customerEmail: null,
    railEnvironment,
    productId: idOrNull(sub.plan_id),
  };
}

/** The subscription an adjustment's OWN BODY names — the store's fallback when no charge linked its payment
 *  (see "THE ADJUSTMENT'S SUBSCRIPTION" in the header). */
function subscriptionOfAdjustment(payload: Record<string, unknown>, payment: Record<string, unknown> | null): string | null {
  const candidates = [
    entityOf(payload, 'subscription')?.id,
    payment?.subscription_id,
    payment === null ? undefined : notesOf(payment).subscription_id,
  ];
  for (const c of candidates) {
    const id = idOrNull(c);
    if (id !== null && SUBSCRIPTION_ID.test(id)) return id;
  }
  return null;
}

const DISPUTE_HOLDS = new Set(['payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required', 'payment.dispute.lost']);

function subjectOf(eventType: string, payload: Record<string, unknown>, occurredAt: string): ParseOutcome | MoneySubject {
  const payment = entityOf(payload, 'payment');
  if (eventType.startsWith('subscription.')) {
    const sub = entityOf(payload, 'subscription');
    if (sub === null) return { ok: false, reason: `razorpay: ${eventType} carries no payload.subscription.entity` };
    return parseSubscription(eventType, sub, payment, occurredAt);
  }
  if (eventType === 'refund.processed') {
    const refund = entityOf(payload, 'refund');
    if (refund === null) return { ok: false, reason: 'razorpay: refund.processed carries no payload.refund.entity' };
    const status = idOrNull(refund.status);
    if (status === null) return { ok: false, reason: 'razorpay: refund entity carries no status' };
    return {
      kind: 'adjustment',
      actionVerbatim: eventType,
      statusVerbatim: status,
      transactionId: idOrNull(refund.payment_id) ?? (payment === null ? null : idOrNull(payment.id)),
      subscriptionId: subscriptionOfAdjustment(payload, payment),
      reason: 'refund_approved',
      restores: false,
      // Only a PROCESSED refund has moved money back.
      effective: status === 'processed',
    };
  }
  if (eventType.startsWith('payment.dispute.')) {
    const dispute = entityOf(payload, 'dispute');
    if (dispute === null) return { ok: false, reason: `razorpay: ${eventType} carries no payload.dispute.entity` };
    const status = idOrNull(dispute.status) ?? '';
    const won = eventType === 'payment.dispute.won' || (eventType === 'payment.dispute.closed' && status === 'won');
    const holds = DISPUTE_HOLDS.has(eventType) || (eventType === 'payment.dispute.closed' && status === 'lost');
    if (!won && !holds) return { kind: 'unknown', detail: `${eventType} (dispute status '${status}') changes no access` };
    return {
      kind: 'adjustment',
      actionVerbatim: eventType,
      statusVerbatim: status || eventType,
      transactionId: idOrNull(dispute.payment_id) ?? (payment === null ? null : idOrNull(payment.id)),
      subscriptionId: subscriptionOfAdjustment(payload, payment),
      reason: won ? 'chargeback_reversed' : 'chargeback',
      restores: won,
      effective: true,
    };
  }
  // Payments, orders, invoices, settlements… stored verbatim with this detail, answered 200.
  return { kind: 'unknown', detail: `razorpay event '${eventType}' carries no subscription, refund or dispute this rail consumes` };
}

export const razorpayVerifier: MoRWebhookVerifier = {
  provider: 'razorpay',
  secretEnvVar: 'RAZORPAY_WEBHOOK_SECRET',
  // "is unique per event" — the header this rail's event id arrives in. The door
  // reads it by this name; nothing else in the Worker spells it.
  eventIdHeader: 'x-razorpay-event-id',

  async verify(raw: string, headers: Headers, secret: string, _nowMs: number): Promise<VerifyOutcome> {
    if (secret.length === 0) {
      return { ok: false, status: 503, reason: 'no destination secret configured' };
    }
    const header = headers.get(SIGNATURE_HEADER);
    if (header === null || header.length === 0) {
      return { ok: false, status: 401, reason: `no ${SIGNATURE_HEADER} header` };
    }
    // Bounded before any work is done on it, like the sibling rail: a header is a
    // caller-controlled string and a digest is not worth spending on nonsense.
    if (header.length > 512) {
      return { ok: false, status: 400, reason: `${SIGNATURE_HEADER} header is implausibly long` };
    }
    if (!HEX_SHA256.test(header.trim())) {
      return {
        ok: false,
        status: 400,
        reason: `${SIGNATURE_HEADER} is not a 64-character hex SHA-256 digest`,
      };
    }
    const expected = await razorpaySignature(secret, raw);
    if (!safeEqualHex(expected, header.trim())) {
      return { ok: false, status: 401, reason: 'signature does not match' };
    }
    return { ok: true };
  },

  parse(raw: string, eventIdHint?: string): ParseOutcome {
    // The event id is a HEADER on this rail (see the header of this file): the
    // door refuses a delivery without it before parse runs, and the nightly
    // replay passes the stored id back. A parse with neither has no dedup key.
    const eventId = idOrNull(eventIdHint);
    if (eventId === null) {
      return { ok: false, reason: 'razorpay: no event id — the x-razorpay-event-id header value is required as the hint' };
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'razorpay: body is not JSON' };
    }
    if (!isPlainObject(body)) return { ok: false, reason: 'razorpay: body is not a JSON object' };
    if (body.entity !== 'event') return { ok: false, reason: 'razorpay: body.entity is not "event"' };
    const eventType = idOrNull(body.event);
    if (eventType === null) return { ok: false, reason: 'razorpay: body.event is missing or unusable' };
    const occurredAt = unixToIso(body.created_at);
    if (occurredAt === null) return { ok: false, reason: 'razorpay: body.created_at is missing or not a unix timestamp' };
    const payload = isPlainObject(body.payload) ? body.payload : null;
    if (payload === null) return { ok: false, reason: 'razorpay: body.payload is missing or not an object' };

    const subject = subjectOf(eventType, payload, occurredAt);
    if ('ok' in subject) return subject; // a ParseOutcome refusal
    return {
      ok: true,
      notification: { provider: 'razorpay', eventId, notificationId: null, eventType, occurredAt, subject },
    };
  },
};
