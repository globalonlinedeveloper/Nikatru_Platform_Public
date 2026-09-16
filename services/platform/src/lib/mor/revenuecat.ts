import type {
  MoneyEnvironment,
  MoRWebhookVerifier,
  NormalizedNotification,
  ParseOutcome,
  SubjectSubscription,
  VerifyOutcome,
} from './contract';
import { REVENUECAT_EVENT_REASONS, revenueCatAccessRuling } from '../../../../../contracts/entitlement/contract.js';
import { REVENUECAT_APP_IDS } from './revenuecat-app-ids';

// ─────────────────────────────────────────────────────────────────────────────
// revenuecat.ts — THE STORE RAILS' WEBHOOK CHECK, ON THE ONE DOOR, AND NOTHING IT
// CANNOT SOURCE.
//
// O-REVENUECAT-VERIFIER. [ADR 039] D5 puts both store rails (Play Billing, Apple
// IAP) behind RevenueCat, and [ADR 020]:18 says a per-app Worker never sees a
// webhook — yet the only RevenueCat receiver in the tree is
// services/subscriptiontracker-api's POST /v1/webhooks/revenuecat, behind a bearer
// string. This adapter puts RevenueCat on `POST /v1/money/revenuecat`, the door
// every rail already uses (routes/money.ts), with a check stronger than a bearer:
// a signature over the body.
// ⏱ 2026-09-16 — THIS IS NOW THE ONLY RevenueCat RECEIVER. The bearer-gated
// legacy route in services/subscriptiontracker-api was retired (leg b of the row);
// the paragraph above is left as written. tooling/ci/assert-entitlement-contract.mjs
// limb 7 now reads THIS file as the runtime that takes RevenueCat events.
//
// ── WHAT IS ESTABLISHED HERE, AND FROM WHERE ─────────────────────────────────
// Read 2026-09-15 from RevenueCat's own documentation
// (revenuecat.com/docs/integrations/webhooks), quoted rather than paraphrased —
// the registry's standard is that an adapter rests on a PRIMARY SOURCE:
//
//   · "every delivery includes an `X-RevenueCat-Webhook-Signature` header with
//      the format: `X-RevenueCat-Webhook-Signature: t=<unix_timestamp>,v1=<hmac_sha256_hex>`"
//   · "The HMAC-SHA256 is computed over `"<timestamp>.<raw_json_body>"` using
//      your integration's signing secret."
//   · the documented samples compare `Date.now() / 1000` against `t`, so `t` is
//     unix SECONDS; and "Optionally reject requests where `abs(now - t)` exceeds
//     your tolerance (e.g. 5 minutes) to prevent replay attacks."
//   · the signing secret is NOT the dashboard Authorization-header value; it is
//     "shown only once — at creation or rotation".
//   · "Your server should return a 200 status code. Any other status code will be
//      considered a failure", retried "up to 5 times" at 5, 10, 20, 40 and 80 min.
//   · idempotency: "keep track of the event `id` we send with each webhook".
//
// 🔴 THREE DIFFERENCES FROM THE SIBLING RAILS, ALL SOURCED:
//   1. THE SEPARATOR IS A DOT. Paddle signs `${ts}:${body}`, RevenueCat
//      `${t}.${body}`; a copied Paddle digest rejects every genuine delivery. A
//      test computes the colon form and requires a 401.
//   2. THE HEADER FIELDS ARE COMMA-SEPARATED (`t=…,v1=…`), Paddle's `;`.
//   3. THE TOLERANCE IS THE VENDOR'S OWN EXAMPLE, FIVE MINUTES, not Paddle's five
//      seconds: RevenueCat's page says a 5-minute window "only needs to cover
//      clock skew and the latency of that POST". Enforced in both directions, as
//      Paddle's is, and before the digest is spent.
//
// ── WHAT IS NOT ESTABLISHED, AND SO IS NOT WRITTEN ───────────────────────────
// ⚠️ `parse` REFUSES, DELIBERATELY — the same line razorpay.ts draws, for the same
// reason in the contract's words: "Refusing is recoverable; a wrong grant is not."
// The event vocabulary IS decided (contracts/entitlement/contract.js →
// `revenueCatAccessRuling`, corrected against the vendor's event reference on
// 2026-09-15). What is NOT decided are four facts about turning a RevenueCat
// event into a row this store may write, and each is a decision about the money
// boundary rather than a missing line:
//
//   A. WHICH OF OUR APPS. The store keys (user_id, app_id, 'pro') and REFUSES an
//      app id that is not a registered product (store.ts `resolveAccount`). A
//      RevenueCat event names RevenueCat's app, not ours. The only declared
//      mapping is `billing.mobileIap.revenuecatAppIds` in apps/<id>/app.yaml
//      (Private/runbooks/revenuecat-setup.md), which no app declares and nothing
//      in this Worker reads yet.
//   B. WHICH SUBSCRIPTION HANDLE links later events (`provider_accounts`) — a
//      body field this repository has never read and no sample exists for.
//   C. THE REFUND SHAPE of CANCELLATION. The contract row says the past-dated
//      reading is `refund_approved` and "belongs to the VERIFIER"; the store's
//      `until_end` path would record `cancelled_at_period_end` instead.
//   D. A LAPSED BILLING_ISSUE (paid-through date in the past) carries no reason
//      in the table, and `decideSubscription` refuses a revocation with none — a
//      503 on every retry. The legacy route simply writes is_active = 0.
//
// So this rail can prove a delivery is genuinely RevenueCat's and will not claim
// to know what it means for a row. A forged body is refused today. No RevenueCat
// project or webhook exists (O-REVENUECAT-ACCOUNT), so nothing is lost by the
// refusal, and Private/runbooks/revenuecat-setup.md §5 still says not to point a
// live webhook anywhere until the second half lands.
//
// ── ⏱ 2026-09-15 · THE FOUR FACTS ARE DECIDED — [ADR 085], OWNER ───────────────
// The section above is history: the owner locked A–D the same day, and `parse`
// below implements them. Every vendor field it reads was re-read from
// revenuecat.com/docs/integrations/webhooks/event-types-and-fields and
// revenuecat.com/docs/customers/identifying-customers on 2026-09-15, and is quoted
// beside the line that reads it.
//
//   A. "RevenueCat app id per app" — `event.app_id` is looked up in
//      REVENUECAT_APP_IDS, RENDERED from apps/*/app.yaml
//      `billing.mobileIap.revenuecatAppIds` by tooling/app-yaml/render.mjs. An id
//      no app declares is REFUSED. ⚠️ TODAY NO APP DECLARES ONE (no RevenueCat
//      project exists, O-REVENUECAT-ACCOUNT), so the shipped verifier refuses
//      every event on A — the rule is built and tested, the map is empty.
//   B. "App user id = NIKATRU user id" — `event.app_user_id` IS the account id.
//      An anonymous id is REFUSED until the purchase is attached to a logged-in
//      user.
//   C. "Refund: revoke now" — a CANCELLATION whose `cancel_reason` is
//      CUSTOMER_SUPPORT revokes NOW as refund_approved; with another stated reason
//      it is the ordinary end-of-period cancellation; with NO usable reason
//      (absent, or UNKNOWN) the past date is the fallback — access stands while
//      `expiration_at_ms` is in the future and ends as refund_approved once it is
//      past.
//   D. "payment_failed_final" — a BILLING_ISSUE keeps access to the paid-through
//      date (`expiration_at_ms`) and, once that is past, revokes as
//      payment_failed_final. `grace_period_expiration_at_ms` is deliberately NOT
//      the end: the ADR names the paid-through date.
//
// 🔴 EVERY REFUSAL STAYS LOUD. A well-formed body refused on A, B, a world
// mismatch, or an event type the vocabulary does not decide becomes
// `SubjectRefused`: the store records it verbatim, writes NO entitlement, the
// route answers 503, and the nightly `money_rederive` heartbeat prints the refused
// count. A body that is not a RevenueCat event at all is still a parse failure
// (400). Nothing is a silent 200.
// ─────────────────────────────────────────────────────────────────────────────

/** RevenueCat's header, spelled as the documentation spells it. */
const SIGNATURE_HEADER = 'X-RevenueCat-Webhook-Signature';

/** @ceiling none — a VENDOR-DOCUMENTED TOLERANCE, not a platform resource. Its
 *  right-hand side is RevenueCat's own example ("e.g. 5 minutes"), a fact about
 *  the sender's POST latency rather than a Cloudflare limit. Widening it buys an
 *  attacker a longer replay window and nothing else. */
export const REVENUECAT_REPLAY_TOLERANCE_SECONDS = 300;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare over the ASCII of two hex digests (lengths first). */
function safeEqualHex(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a.toLowerCase());
  const bb = enc.encode(b.toLowerCase());
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

/** `t=<unix seconds>,v1=<hex>`, order-independent. An unknown field is ignored,
 *  so a future `v2` does not break a destination that still verifies `v1`. */
export function parseRevenueCatSignatureHeader(
  header: string,
): { ok: true; t: number; v1: string } | { ok: false; reason: string } {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      if (!/^\d{1,15}$/.test(value)) return { ok: false, reason: 't is not a unix-second integer' };
      t = Number(value);
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: 'v1 is not a 64-character hex digest' };
      v1 = value.toLowerCase();
    }
  }
  if (t === null) return { ok: false, reason: 'signature header carries no t' };
  if (v1 === null) return { ok: false, reason: 'signature header carries no v1' };
  return { ok: true, t, v1 };
}

/** HMAC-SHA256 over `${t}.${rawBody}` under the signing secret, hex. Exported for
 *  the tests, which compute their own vectors rather than trusting this. */
export async function revenueCatSignature(secret: string, t: number, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${raw}`)));
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE — [ADR 085]. Every vendor quotation below was read 2026-09-15.
// ─────────────────────────────────────────────────────────────────────────────

/** identifying-customers: RevenueCat "will generate a new random App User ID
 *  (prefixed with `$RCAnonymousID:`)". */
export const REVENUECAT_ANONYMOUS_PREFIX = '$RCAnonymousID:';

/** `environment`: "Store environment: `SANDBOX` or `PRODUCTION`." Mapped onto our
 *  two money worlds; any other value is refused, never defaulted. */
const RC_ENVIRONMENTS: Readonly<Record<string, MoneyEnvironment>> = { PRODUCTION: 'live', SANDBOX: 'sandbox' };

/** `cancel_reason` CUSTOMER_SUPPORT: "Customer received a refund from Apple
 *  support, a Google Play subscription was refunded through RevenueCat, an Amazon
 *  subscription was refunded through Amazon support, or a web (RevenueCat Billing
 *  or Stripe Billing) subscription was refunded." — [ADR 085] C's preferred signal. */
const RC_REFUND_CANCEL_REASON = 'CUSTOMER_SUPPORT';

/** `cancel_reason` UNKNOWN: "Apple did not provide the reason for the
 *  cancellation." A stated non-reason, so C falls back to the date. */
const RC_UNKNOWN_CANCEL_REASON = 'UNKNOWN';

/** `expiration_reason` SUBSCRIPTION_PAUSED: "The subscription expired because it
 *  was paused (only `EXPIRATION` event)." — the one EXPIRATION sub-reason the
 *  contract's `subscription_paused` exists for. */
const RC_PAUSED_EXPIRATION_REASON = 'SUBSCRIPTION_PAUSED';

/** TEST: "RevenueCat issued a test event. This event uses a purchase-like sample
 *  payload and isn't persisted in production." Acknowledged, never attributed. */
const RC_TEST_EVENT = 'TEST';

/** Our reasons for the two decided shapes that the table cannot carry by name. */
const REFUND_REASON = 'refund_approved';
const BILLING_ISSUE_FINAL_REASON = 'payment_failed_final';
const PAUSED_REASON = 'subscription_paused';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** ms since epoch → ISO, null when absent, undefined when present and unreadable. */
function isoFromMs(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Translate a verified RevenueCat body into the portfolio's vocabulary.
 *
 * `appIds` is the [ADR 085] A routing table (RevenueCat app id → NIKATRU app id).
 * Injected so the tests can route; the registry passes the rendered map.
 */
export function parseRevenueCatEvent(raw: string, appIds: Readonly<Record<string, string>>): ParseOutcome {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'revenuecat: the body is not JSON' };
  }
  // webhooks reference: `api_version` at the root, every other field inside `event`.
  if (!isRecord(body) || !isRecord(body.event)) {
    return { ok: false, reason: 'revenuecat: the body carries no `event` object' };
  }
  const e = body.event;
  // `id`: "Unique identifier of the event. Retries reuse the same `id` and `event_timestamp_ms`."
  if (!nonEmpty(e.id)) return { ok: false, reason: 'revenuecat: the event carries no `id`' };
  if (!nonEmpty(e.type)) return { ok: false, reason: 'revenuecat: the event carries no `type`' };
  // `event_timestamp_ms`: "The time that the event was generated".
  const occurredAt = isoFromMs(e.event_timestamp_ms);
  if (typeof occurredAt !== 'string') {
    return { ok: false, reason: 'revenuecat: `event_timestamp_ms` is absent or not a millisecond timestamp' };
  }

  const head = { provider: 'revenuecat', eventId: e.id, notificationId: null, eventType: e.type, occurredAt };
  const refuse = (detail: string): ParseOutcome => ({
    ok: true,
    notification: { ...head, subject: { kind: 'refused', detail: `revenuecat ${e.type}: ${detail}` } },
  });
  const ignore = (detail: string): ParseOutcome => ({
    ok: true,
    notification: { ...head, subject: { kind: 'unknown', detail } },
  });

  if (e.type === RC_TEST_EVENT) return ignore('revenuecat TEST event — a sample payload, attributed to nobody');

  // ── A · which of OUR apps ──────────────────────────────────────────────────
  // `app_id`: "Public identifier of the dashboard app (store configuration)
  // associated with the event."
  if (!nonEmpty(e.app_id)) return refuse('the event carries no `app_id`, so it cannot be routed to an app (ADR 085 A)');
  const appId = Object.prototype.hasOwnProperty.call(appIds, e.app_id) ? appIds[e.app_id] : undefined;
  if (appId === undefined) {
    return refuse(
      `app_id ${JSON.stringify(e.app_id)} is declared by no NIKATRU app (apps/*/app.yaml billing.mobileIap.revenuecatAppIds) — refused, never guessed (ADR 085 A)`,
    );
  }

  // ── what the event does to access, from the contract table ─────────────────
  const row = REVENUECAT_EVENT_REASONS.find((r) => r.event === e.type);
  const ruling = revenueCatAccessRuling(e.type);
  if (row === undefined) {
    return refuse('the event type is not in contracts/entitlement/contract.js REVENUECAT_EVENT_REASONS, so its outcome is undecided');
  }
  if (ruling === null) {
    // SUBSCRIPTION_PAUSED today: the table DECIDES it changes nothing (its `why`
    // quotes "Don't revoke access on this event").
    return ignore(`revenuecat ${e.type}: the contract table decides this event changes no access`);
  }

  // ── B · which account ───────────────────────────────────────────────────────
  // `app_user_id`: "Last seen App User ID of the subscriber." After logIn,
  // "`original_app_user_id` will be the anonymous id and `app_user_id` will be the
  // provided id" — so a logged-in purchase names the NIKATRU user id here.
  if (!nonEmpty(e.app_user_id)) return refuse('the event carries no `app_user_id` (ADR 085 B)');
  if (e.app_user_id.startsWith(REVENUECAT_ANONYMOUS_PREFIX)) {
    return refuse('app_user_id is anonymous; it is ignored until the purchase is attached to a logged-in NIKATRU user (ADR 085 B)');
  }

  const railEnvironment = typeof e.environment === 'string' ? RC_ENVIRONMENTS[e.environment] : undefined;
  if (railEnvironment === undefined) {
    return refuse('`environment` is neither PRODUCTION nor SANDBOX, so the money world is unknown');
  }
  // `original_transaction_id`: "`transaction_id` of the original transaction in
  // the subscription." — stable across renewals, so it is the link handle.
  if (!nonEmpty(e.original_transaction_id)) {
    return refuse('the event carries no `original_transaction_id`, so later events could not be linked to it');
  }
  // `expiration_at_ms`: "Expiration of the transaction, in milliseconds since Unix epoch."
  const expiresAt = isoFromMs(e.expiration_at_ms);
  if (expiresAt === undefined) return refuse('`expiration_at_ms` is present and not a millisecond timestamp');
  // `period_type`: "`TRIAL`, `INTRO`, `NORMAL`, `PROMOTIONAL`, or `PREPAID`."
  const trial = e.period_type === 'TRIAL';

  let access: SubjectSubscription['access'];
  let endsWithReason: string | null;
  let statusVerbatim = e.type;
  if (ruling === 'grant') {
    access = trial ? 'trialing' : 'granted';
    endsWithReason = null;
  } else if (ruling === 'revoke') {
    // EXPIRATION: "A subscription has expired. The associated user's access should be removed."
    access = 'suspended';
    endsWithReason = e.expiration_reason === RC_PAUSED_EXPIRATION_REASON ? PAUSED_REASON : row.reason;
    if (nonEmpty(e.expiration_reason)) statusVerbatim = `${e.type}/${e.expiration_reason}`;
  } else if (row.reason !== null) {
    // ── C · the paid-through row that CARRIES a reason: CANCELLATION ──────────
    // "A subscription or non-subscription purchase was canceled or refunded."
    const cancelReason = nonEmpty(e.cancel_reason) ? e.cancel_reason : null;
    if (cancelReason !== null) statusVerbatim = `${e.type}/${cancelReason}`;
    if (cancelReason === RC_REFUND_CANCEL_REASON) {
      access = 'suspended'; // refund: revoke now
      endsWithReason = REFUND_REASON;
    } else if (cancelReason !== null && cancelReason !== RC_UNKNOWN_CANCEL_REASON) {
      access = 'until_end'; // a stated, non-refund reason: the ordinary cancellation
      endsWithReason = row.reason;
    } else {
      access = 'until_end'; // no usable reason: the past date is the refund signal
      endsWithReason = REFUND_REASON;
    }
  } else {
    // ── D · the paid-through row with NO reason: BILLING_ISSUE ────────────────
    // "An attempt to charge the subscriber failed. This doesn't mean the
    // subscription has expired." Access to the paid-through date, then final.
    access = 'until_end';
    endsWithReason = BILLING_ISSUE_FINAL_REASON;
  }

  const subject: SubjectSubscription = {
    kind: 'subscription',
    subscriptionId: e.original_transaction_id,
    statusVerbatim,
    access,
    currentPeriodEnd: expiresAt,
    trialEnd: trial ? expiresAt : null,
    // `transaction_id`: "Transaction identifier from the store."
    transactionId: nonEmpty(e.transaction_id) ? e.transaction_id : null,
    endsWithReason,
    accountUserId: e.app_user_id,
    accountAppId: appId,
    // `original_app_user_id`: "The first App User ID used by the subscriber."
    customerId: nonEmpty(e.original_app_user_id) ? e.original_app_user_id : null,
    customerEmail: null,
    railEnvironment,
  };
  const notification: NormalizedNotification = { ...head, subject };
  return { ok: true, notification };
}

/** The verifier, over a routing table. The registry's instance uses the rendered one. */
export function makeRevenuecatVerifier(appIds: Readonly<Record<string, string>>): MoRWebhookVerifier {
  return { ...revenuecatVerifierBase, parse: (raw: string) => parseRevenueCatEvent(raw, appIds) };
}

const revenuecatVerifierBase = {
  provider: 'revenuecat',
  secretEnvVar: 'REVENUECAT_WEBHOOK_SIGNING_SECRET',

  async verify(raw: string, headers: Headers, secret: string, nowMs: number): Promise<VerifyOutcome> {
    if (secret.length === 0) {
      return { ok: false, status: 503, reason: 'no destination secret configured' };
    }
    const header = headers.get(SIGNATURE_HEADER);
    if (header === null || header.length === 0) {
      return { ok: false, status: 401, reason: `no ${SIGNATURE_HEADER} header` };
    }
    if (header.length > 512) {
      return { ok: false, status: 400, reason: `${SIGNATURE_HEADER} header is implausibly long` };
    }
    const parsed = parseRevenueCatSignatureHeader(header);
    if (!parsed.ok) return { ok: false, status: 400, reason: parsed.reason };

    // Replay window BEFORE the HMAC, in both directions.
    const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.t);
    if (skewSeconds > REVENUECAT_REPLAY_TOLERANCE_SECONDS) {
      return {
        ok: false,
        status: 401,
        reason: `timestamp is ${skewSeconds}s from now, outside the ${REVENUECAT_REPLAY_TOLERANCE_SECONDS}s tolerance`,
      };
    }
    const expected = await revenueCatSignature(secret, parsed.t, raw);
    if (!safeEqualHex(expected, parsed.v1)) {
      return { ok: false, status: 401, reason: 'signature does not match' };
    }
    return { ok: true };
  },

};

/**
 * The registered rail. ⏱ 2026-09-15: `parse` was a deliberate refusal naming the
 * four undecided facts; [ADR 085] decided them and it now reads the event, routed
 * by the RENDERED app-id table — which is EMPTY until an app declares mobile IAP,
 * so every real event is refused on A today.
 */
export const revenuecatVerifier: MoRWebhookVerifier = makeRevenuecatVerifier(REVENUECAT_APP_IDS);
