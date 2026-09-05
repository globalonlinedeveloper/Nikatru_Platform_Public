// ─────────────────────────────────────────────────────────────────────────────
// The MERCHANT-OF-RECORD contract — provider-agnostic, and the only vocabulary
// anything downstream of a webhook is allowed to speak.
//
// [ADR 004] LOCKS the merchant of record as Paddle, and locks the SHAPE: a
// `MoRWebhookVerifier` interface plus per-provider signature adapters, "so the
// choice can flip with zero app changes". This file is the interface side of
// that lock. No provider name and no provider vocabulary may appear below —
// `services/platform/src/lib/mor/paddle.ts` is where one rail's facts live, and
// it is the only file that knows them.
//
// ⚠️ CORRECTED 2026-08-28. That first sentence read "LOCKS the merchant of record
// as Paddle (primary) / Lemon Squeezy (parallel)" — present tense, and no longer
// true. [ADR 039] D4 (2026-08-09) RETIRED [ADR 004]'s parallel Lemon Squeezy
// clause: the parallel application was never evidenced and the product is
// sunsetting into Stripe. The SHAPE half of the lock is UNTOUCHED and is the
// reason this file exists — a successor rail is one adapter file plus one
// registry line, and WHICH successor is a queued owner decision. The comment in
// `registry.ts` on Lemon Squeezy's deliberate absence was already correct and is
// left exactly as it stands.
//
// 🔴 WHY THE VOCABULARY IS NOT RevenueCat's. services/subly-api's webhook route
// already speaks INITIAL_PURCHASE / CANCELLATION / BILLING_ISSUE / EXPIRATION.
// Carrying that across would encode one deferred provider's subscription model
// into the portfolio's shared table, and the shared table outlives every
// provider choice. The vocabulary here is the portfolio's; each adapter
// translates into it.
//
// 🔴 EVERY DECISION IN THIS FILE FAILS CLOSED. Undecidable ⇒ DENY, on both ends,
// with no exception and no "probably fine" branch. That is not a style
// preference: this session already had to fix the money boundary failing OPEN on
// both the server (`services/subly-api/src/routes/entitlements.ts` read an
// unparseable expiry as `is_pro: true`) and the client
// (`packages/core/lib/src/models/entitlement.dart` read one as a LIFETIME
// grant). The shape that produced both was a parse that returned "no value" and
// a reader that spelled "no value" as "no limit".
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE VOCABULARY IS NOT DECLARED HERE ANY MORE. IT IS IMPORTED.
//
// `contracts/entitlement/contract.js` is the ONE authored copy of the money
// environments and the revocation-reason set. Three runtimes have to agree about
// them — this TypeScript Worker, the vanilla-JS extensions, and Dart via a
// generated table — and until 2026-09-05 this file RESTATED the set instead of
// reading it. That is the failure `tooling/ci/assert-entitlement-contract.mjs`
// limb 4 was written for: the set and the SQL seed "were written minutes apart
// and were already out of step by one member".
//
// A restatement here is now a guard failure, not a style note: limb 4 refuses a
// `REVOCATION_REASONS … = [` literal in this file and requires this import.
//
// The relative path leaves the service directory on purpose, and it is not the
// first: `src/config.ts` already imports `../../../catalog/apps.json`. esbuild
// (wrangler) inlines both at bundle time — a Worker has no filesystem — and
// `wrangler deploy --dry-run` is what proves the bundle resolves it.
//
// The `.js` specifier resolves to the hand-written `contract.d.ts` beside it for
// types and to `contract.js` for runtime, which is exactly the arrangement that
// keeps the extensions build-free ([ADR 067] decision 1).
// ─────────────────────────────────────────────────────────────────────────────
import {
  MONEY_ENVIRONMENTS,
  REVOCATION_REASONS,
  isMoneyEnvironment,
  isRevocationReason,
  type MoneyEnvironment,
  type RevocationReason,
} from '../../../../../contracts/entitlement/contract.js';

/**
 * Which money world a credential, a notification and an entitlement row belong
 * to. [5]M-12. Declared in `contracts/entitlement/contract.js`; re-exported here
 * so every existing import site (`../lib/mor/contract`) keeps working and this
 * file stays the money rail's single TypeScript surface.
 *
 * ⚠️ IT COMES FROM CONFIGURATION, NEVER FROM THE PAYLOAD, and that is a decision
 * rather than an omission. No primary source establishes that a Paddle
 * notification body identifies its own environment, so a payload-derived
 * environment would be an invented vendor fact on the one boundary where an
 * invented fact grants a stranger a free subscription. The Worker declares which
 * world its configured destination secret belongs to; a notification inherits
 * that declaration, and the row records it.
 */
export type { MoneyEnvironment };

/**
 * The revocation-lifecycle reason set, and the two predicates over it. All four
 * come from `contracts/entitlement/contract.js` and are re-exported unchanged.
 *
 * The set MUST EQUAL the rows seeded by `migrations/0004_money_rail.sql`
 * section E — asserted by `tooling/ci/assert-entitlement-contract.mjs` limb 4,
 * which now compares FIVE copies: the SQL seed, that contract file, its
 * generated `contract.json`, the byte-identical copy the extensions vendor at
 * `extensions/core/entitlement-contract.js`, and the generated Dart table at
 * `packages/purchases/lib/src/generated/entitlement_contract.g.dart`.
 *
 * `restores` marks the one member that GIVES ACCESS BACK. Without it a customer
 * who raised a dispute in error, and lost it, stays locked out forever — nothing
 * else in this rail restores access to a row that was taken away.
 */
export type { RevocationReason };
export { MONEY_ENVIRONMENTS, REVOCATION_REASONS, isMoneyEnvironment, isRevocationReason };

// ─────────────────────────────────────────────────────────────────────────────
// THE NORMALISED NOTIFICATION — what an adapter produces and the store consumes.
// ─────────────────────────────────────────────────────────────────────────────

/** The entity kinds any rail's notification can carry, in our vocabulary. */
export type MoneySubjectKind = 'subscription' | 'adjustment' | 'unknown';

/** A subscription's access-relevant state, translated out of the rail's own. */
export interface SubjectSubscription {
  kind: 'subscription';
  /** The rail's stable subscription handle. */
  subscriptionId: string;
  /** The rail's own status string, VERBATIM — stored, never flattened. */
  statusVerbatim: string;
  /**
   * What that status means for ACCESS, before dates are considered.
   *   'granted'   — access is on outright.
   *   'trialing'  — access is on, and it is the free part.
   *   'until_end' — access continues only to `currentPeriodEnd`, then stops.
   *   'suspended' — access is off now.
   * There is deliberately no 'unknown' member: a status an adapter cannot
   * translate does not become a weak grant, it becomes a REFUSAL (see
   * `AdapterResult`).
   */
  access: 'granted' | 'trialing' | 'until_end' | 'suspended';
  /** ISO-8601, or null when the rail sent none. */
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  transactionId: string | null;
  /** The reason to record when this state ends access. Null when it does not. */
  endsWithReason: string | null;
  /** Our own account id, when the rail echoed the metadata we set at checkout. */
  accountUserId: string | null;
  accountAppId: string | null;
  customerId: string | null;
  customerEmail: string | null;
}

/** A refund / chargeback / reversal against a transaction. */
export interface SubjectAdjustment {
  kind: 'adjustment';
  /** The rail's own action string, VERBATIM. */
  actionVerbatim: string;
  /** The rail's own status string, VERBATIM. */
  statusVerbatim: string;
  transactionId: string | null;
  subscriptionId: string | null;
  /** One of [REVOCATION_REASONS]. Null when the adjustment changes no access. */
  reason: string | null;
  /** True when this adjustment RESTORES access rather than removing it. */
  restores: boolean;
  /** False when the adjustment is not yet effective (e.g. pending approval). */
  effective: boolean;
}

export interface SubjectUnknown {
  kind: 'unknown';
  /** Why nothing was derived. Recorded on the stored row, never swallowed. */
  detail: string;
}

export type MoneySubject = SubjectSubscription | SubjectAdjustment | SubjectUnknown;

/**
 * One notification, normalised. Every field here is REQUIRED to have been read
 * from the body — an adapter that cannot fill one refuses instead of defaulting.
 */
export interface NormalizedNotification {
  provider: string;
  /** The id of the EVENT. Never the id of the delivery attempt. */
  eventId: string;
  /** The id of THIS DELIVERY of the event, when the rail sends one. */
  notificationId: string | null;
  eventType: string;
  /** The provider's clock for the event, ISO-8601. The ordering authority. */
  occurredAt: string;
  subject: MoneySubject;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER RESULTS — three outcomes, kept distinct, exactly as the RevenueCat
// route learned to keep them distinct. Collapsing "malformed" into "nothing to
// do" is what let a broken payload look like a handled one.
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyOutcome =
  /** Signature checked and valid. `rawBody` is the exact signed bytes. */
  | { ok: true }
  /**
   * REFUSED. `status` is what the route must answer. 401 for a bad signature,
   * 400 for a malformed signature header, 503 when the seam is not configured.
   * There is no fourth branch: an unverifiable notification never reaches a row.
   */
  | { ok: false; status: 400 | 401 | 503; reason: string };

export type ParseOutcome =
  | { ok: true; notification: NormalizedNotification }
  /**
   * The body did not have the shape this adapter knows. 400, write nothing, let
   * the rail retry — the stored entitlement keeps whatever it already said.
   *
   * ⚠️ THIS IS THE BRANCH THAT MUST STAY LOUD. An adapter that guesses at a shape
   * it cannot source will mis-parse silently and write a wrong row that looks
   * exactly like a right one. Refusing is recoverable; a wrong grant is not.
   */
  | { ok: false; reason: string };

/**
 * A rail. ONE interface, per-provider implementations — [ADR 004]'s
 * "provider-agnostic webhook ... so the choice can flip with zero app changes".
 */
export interface MoRWebhookVerifier {
  /** Stable id: the URL segment, the `provider` column, the registry key. */
  readonly provider: string;
  /**
   * The name of the environment variable holding this rail's destination
   * secret. Named as DATA so `tooling/ci/assert-money-config.mjs` can enumerate
   * the money secrets from the registry instead of from a hand-kept list that
   * goes stale the day a second rail is added.
   */
  readonly secretEnvVar: string;
  /**
   * Verify the signature over the RAW BODY. Takes the raw string, never a parsed
   * object: every rail signs the bytes it sent, and a re-serialised copy of a
   * parsed body is a different byte string that can never re-verify.
   */
  verify(raw: string, headers: Headers, secret: string, nowMs: number): Promise<VerifyOutcome>;
  /** Translate the rail's body into the portfolio's vocabulary, or refuse. */
  parse(raw: string): ParseOutcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ENTITLEMENT DECISION — the money boundary, server end.
// ─────────────────────────────────────────────────────────────────────────────

export interface EntitlementDecision {
  isActive: 0 | 1;
  /** ISO-8601 or null. Null means NO END DATE, never "we could not tell". */
  expiresAt: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  providerStatus: string;
  revokedAt: string | null;
  revocationReason: string | null;
}

export type DecisionOutcome =
  | { ok: true; decision: EntitlementDecision }
  /** Undecidable ⇒ DENY. The row is not written; the rail retries. */
  | { ok: false; reason: string };

/**
 * ISO-8601 or refusal. There is no third answer.
 *
 * `Date.parse` returns NaN on anything it cannot read, and NaN silently becomes
 * "no expiry" in every downstream reader that spells `null` as "lifetime" —
 * which is the exact fail-open this repo fixed on both ends and must not
 * reintroduce. So an UNREADABLE value is not normalised to null here; it is
 * reported, and the caller refuses.
 */
export function normalizeInstant(v: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, iso: null };
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return { ok: false };
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, iso: new Date(ms).toISOString() };
}

/**
 * Turn a normalised subscription into an entitlement decision.
 *
 * ⚠️ ACCESS IS DERIVED FROM STATE AND DATES, NEVER FROM THE EVENT NAME. The
 * lesson is already recorded in services/subly-api/src/routes/webhooks.ts:40-71
 * and it cost a real bug: one event name can carry two opposite access outcomes,
 * distinguishable only by the paid-through date. Deriving from the entity's own
 * status also means this rail does not depend on knowing the complete list of a
 * provider's event names — a list this repo has NOT established from a primary
 * source (see paddle.ts's UNVERIFIED block).
 */
export function decideSubscription(
  s: SubjectSubscription,
  nowMs: number,
): DecisionOutcome {
  const periodEnd = normalizeInstant(s.currentPeriodEnd);
  if (!periodEnd.ok) {
    return { ok: false, reason: 'current_period_end is present but could not be read' };
  }
  const trialEnd = normalizeInstant(s.trialEnd);
  if (!trialEnd.ok) {
    return { ok: false, reason: 'trial_end is present but could not be read' };
  }
  if (s.statusVerbatim.length === 0) {
    return { ok: false, reason: 'the provider sent no subscription status' };
  }

  const base = {
    currentPeriodEnd: periodEnd.iso,
    trialEnd: trialEnd.iso,
    providerStatus: s.statusVerbatim,
  };
  const nowIso = new Date(nowMs).toISOString();

  switch (s.access) {
    case 'granted':
    case 'trialing':
      // Access is on. `expires_at` mirrors the paid-through date so the LEGACY
      // read path (services/subly-api/src/routes/entitlements.ts, which knows
      // only is_active + expires_at) reaches the same answer as the new columns.
      // Two readers of one row that can disagree is a defect waiting for a
      // deploy-order accident.
      return {
        ok: true,
        decision: { ...base, isActive: 1, expiresAt: periodEnd.iso, revokedAt: null, revocationReason: null },
      };

    case 'until_end': {
      // The already-paid period is honoured; access ends when it ends. An ABSENT
      // period end here is NOT "no expiry" — a subscription that is winding down
      // with no stated end is undecidable, and undecidable is a refusal. Reading
      // it as a lifetime grant is precisely the fail-open shape this rail exists
      // to keep out.
      if (periodEnd.iso === null) {
        return {
          ok: false,
          reason: `status '${s.statusVerbatim}' ends access at the period end, and the provider sent no current_period_end`,
        };
      }
      const stillPaid = Date.parse(periodEnd.iso) > nowMs;
      if (stillPaid) {
        return {
          ok: true,
          decision: { ...base, isActive: 1, expiresAt: periodEnd.iso, revokedAt: null, revocationReason: null },
        };
      }
      const reason = s.endsWithReason;
      if (reason === null || !isRevocationReason(reason)) {
        return { ok: false, reason: `status '${s.statusVerbatim}' revokes access but named no valid revocation reason` };
      }
      return {
        ok: true,
        decision: { ...base, isActive: 0, expiresAt: periodEnd.iso, revokedAt: nowIso, revocationReason: reason },
      };
    }

    case 'suspended': {
      const reason = s.endsWithReason;
      if (reason === null || !isRevocationReason(reason)) {
        return { ok: false, reason: `status '${s.statusVerbatim}' suspends access but named no valid revocation reason` };
      }
      return {
        ok: true,
        decision: { ...base, isActive: 0, expiresAt: periodEnd.iso, revokedAt: nowIso, revocationReason: reason },
      };
    }
  }
}

/**
 * Turn an adjustment (refund / chargeback / reversal) into a decision.
 *
 * A restoring adjustment is the ONLY path in this rail that gives access back,
 * and it deliberately does not invent a new paid-through date: it clears the
 * revocation and restores the period the row already carried. Inventing one
 * would be granting access on the strength of an arithmetic guess.
 */
export function decideAdjustment(
  a: SubjectAdjustment,
  existing: { currentPeriodEnd: string | null; trialEnd: string | null; providerStatus: string | null },
  nowMs: number,
): DecisionOutcome {
  if (!a.effective) {
    return { ok: false, reason: `adjustment status '${a.statusVerbatim}' is not yet effective` };
  }
  const reason = a.reason;
  if (reason === null || !isRevocationReason(reason)) {
    return { ok: false, reason: `adjustment action '${a.actionVerbatim}' maps to no known revocation reason` };
  }
  const base = {
    currentPeriodEnd: existing.currentPeriodEnd,
    trialEnd: existing.trialEnd,
    providerStatus: existing.providerStatus ?? a.statusVerbatim,
  };
  if (a.restores) {
    // Restore only as far as the row already reached. If the period it was
    // granted for has since passed, the restoration does not resurrect it —
    // the customer is un-revoked and simply out of period, which is the truth.
    const end = normalizeInstant(existing.currentPeriodEnd);
    if (!end.ok) {
      return { ok: false, reason: 'the stored current_period_end could not be read, so access cannot be restored from it' };
    }
    if (end.iso === null) {
      return { ok: false, reason: 'the stored row has no current_period_end, so there is no period to restore access to' };
    }
    const stillWithin = Date.parse(end.iso) > nowMs;
    return {
      ok: true,
      decision: {
        ...base,
        isActive: stillWithin ? 1 : 0,
        expiresAt: end.iso,
        revokedAt: stillWithin ? null : new Date(nowMs).toISOString(),
        revocationReason: reason,
      },
    };
  }
  return {
    ok: true,
    decision: {
      ...base,
      isActive: 0,
      // A refund or a chargeback ends access NOW, not at the period end: the
      // money went back. `expires_at` is set to the revocation instant so the
      // legacy `expires_at > now` read path agrees with `is_active = 0`.
      expiresAt: new Date(nowMs).toISOString(),
      revokedAt: new Date(nowMs).toISOString(),
      revocationReason: reason,
    },
  };
}
