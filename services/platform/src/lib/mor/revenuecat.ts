import type { MoRWebhookVerifier, ParseOutcome, VerifyOutcome } from './contract';

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

export const revenuecatVerifier: MoRWebhookVerifier = {
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

  parse(_raw: string): ParseOutcome {
    // See the header of this file: the signature and the event vocabulary are
    // sourced; turning an event into a row this store may write is not.
    return {
      ok: false,
      reason:
        'revenuecat: the signature is verified (revenuecat.com/docs/integrations/webhooks, read 2026-09-15) and the ' +
        'event vocabulary is contracts/entitlement/contract.js, but four row facts are undecided, so nothing is ' +
        "written: (A) which of OUR app ids an event belongs to — RevenueCat names its own app, and the only declared " +
        'mapping (app.yaml billing.mobileIap.revenuecatAppIds) is declared by no app; (B) the subscription handle that ' +
        'links later events; (C) the refund reading of a past-dated CANCELLATION (refund_approved); (D) the reason a ' +
        'lapsed BILLING_ISSUE revokes with. No RevenueCat webhook exists yet (O-REVENUECAT-ACCOUNT).',
    };
  },
};
