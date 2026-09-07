// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// contracts/entitlement/contract.js — the entitlement vocabulary, authored once.
//
// 🔴 THIS FILE IS PLAIN ES-MODULE JAVASCRIPT ON PURPOSE, AND THE PURPOSE IS NOT
// STYLE. Three runtimes have to agree about this vocabulary:
//
//   services/platform      TypeScript on Cloudflare Workers  — imports this and,
//                          via contract.d.ts, gets exactly the types it had
//   extensions/**          vanilla MV3 JavaScript, NO BUILD  — imports THE SAME
//                          FILE, byte for byte, with no tool in between
//   packages/purchases     Dart                              — cannot import
//                          JavaScript, so it consumes generated Dart from
//                          contract.json, the way packages/tokens already
//                          generates CSS from DTCG JSON
//
// A `.ts` file here would serve the first and lock out the second: compiling it
// is verbatim "a custom tool that takes files, applies pre-processing, and
// generates file(s) to include in the extension", which is Mozilla's
// source-code submission trigger. `// @ts-check` plus JSDoc gives the checking
// with none of the compiling, and changes zero shipped bytes.
// tooling/ci/assert-extensions-build-free.mjs enforces the same rule inside
// extensions/.
//
// ⏱ AUTHORITATIVE SINCE 2026-09-05. The paragraph this replaces said the
// opposite — that contract.ts declared its own copy and that limb 4 held only
// that copy to the SQL seed. Both halves are now false:
//
//   · services/platform/src/lib/mor/contract.ts IMPORTS this file and
//     re-exports it. A re-declared REVOCATION_REASONS array in that file is a
//     guard FAILURE, not a redundancy.
//   · tooling/ci/assert-entitlement-contract.mjs limb 4 compares FIVE copies
//     against the SQL seed: this file, its generated contract.json, the
//     byte-identical copy at extensions/core/v1/entitlement-contract.js, and the
//     generated Dart at
//     packages/purchases/lib/src/generated/entitlement_contract.g.dart.
//
// 🔴 EDITING THIS FILE CHANGES WHAT THE LIVE platform WORKER RUNS. esbuild
// inlines it into the bundle, and .github/workflows/deploy-workers.yml names
// contracts/entitlement/*.js in its trigger list for that reason. After any edit
// here, run BOTH generators and the extension sync, or CI fails:
//
//     node contracts/entitlement/generate.mjs
//     node contracts/entitlement/generate-dart.mjs
//     node extensions/scripts/sync-contracts.mjs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'live' | 'sandbox'} MoneyEnvironment
 *
 * Which money world a credential, a notification and an entitlement row belong
 * to. ⚠️ IT COMES FROM CONFIGURATION, NEVER FROM THE PAYLOAD: no primary source
 * establishes that a Paddle notification body identifies its own environment, so
 * a payload-derived environment would be an invented vendor fact on the one
 * boundary where an invented fact grants a stranger a free subscription.
 */

/** @type {readonly MoneyEnvironment[]} */
export const MONEY_ENVIRONMENTS = /** @type {const} */ (['live', 'sandbox']);

/**
 * @param {unknown} v
 * @returns {v is MoneyEnvironment}
 */
export function isMoneyEnvironment(v) {
  return typeof v === 'string' && /** @type {readonly string[]} */ (MONEY_ENVIRONMENTS).includes(v);
}

/**
 * @typedef {{ readonly reason: string, readonly restores: boolean }} RevocationReason
 *
 * The revocation-lifecycle reason set. MUST EQUAL the rows seeded by
 * `services/platform/migrations/0004_money_rail.sql` section E.
 *
 * 🔴 `restores` MARKS THE ONE MEMBER THAT GIVES ACCESS BACK, and it is the field
 * a second copy of this set gets wrong. Without it a customer who raised a
 * dispute in error, and lost it, stays locked out forever — nothing else in this
 * rail restores access to a row that was taken away. The set and the SQL were
 * written minutes apart and were already out of step by one member; that is why
 * a guard exists, and why this file exists rather than a fourth transcription.
 */

/** @type {readonly RevocationReason[]} */
export const REVOCATION_REASONS = [
  { reason: 'refund_approved', restores: false },
  { reason: 'chargeback', restores: false },
  { reason: 'chargeback_reversed', restores: true },
  { reason: 'subscription_expired', restores: false },
  { reason: 'trial_expired', restores: false },
  { reason: 'payment_failed_final', restores: false },
  { reason: 'cancelled_at_period_end', restores: false },
  { reason: 'subscription_paused', restores: false },
];

const REASON_SET = new Set(REVOCATION_REASONS.map((r) => r.reason));

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isRevocationReason(v) {
  return typeof v === 'string' && REASON_SET.has(v);
}

/**
 * The one member that restores access, resolved rather than remembered.
 * @param {string} reason
 * @returns {boolean}
 */
export function restoresAccess(reason) {
  return REVOCATION_REASONS.some((r) => r.reason === reason && r.restores);
}


/**
 * @typedef {{ readonly event: string, readonly reason: string | null, readonly why: string }} RevenueCatEventReason
 *
 * WHICH REVENUECAT WEBHOOK EVENT MEANS WHICH OF OUR REVOCATION REASONS.
 *
 * 🔴 THE MAP IS DATA, IN THIS FILE, FOR THE SAME REASON THE REASON SET IS. Three
 * runtimes have to agree about it: the platform Worker's `revenuecatVerifier`
 * (when it is written — see the residue in
 * `Private/research/revamp-2026-09-05/phase3-chassis-billing.md`), the Dart
 * client, and any extension that reads an entitlement. A translation table
 * restated in a Worker and remembered in a client is the fourth transcription
 * this directory exists to prevent — and this one is worse than the reason set,
 * because getting it wrong REVOKES A PAYING CUSTOMER rather than mislabelling a
 * row somebody reads later.
 *
 * 🔒 `reason: null` MEANS "THIS EVENT IS NOT A REVOCATION", AND IT IS RECORDED
 * RATHER THAN OMITTED. An absent event and an event we deliberately do not
 * revoke on are different facts; leaving the second one out of the table makes
 * them indistinguishable, and the next reader closes the gap by guessing. Every
 * row carries the sentence that forces its answer, exactly as the channel
 * register's `purchaseRail.why` does.
 *
 * ⚠️ EVERY ROW HERE IS A VENDOR FACT AND THE ACCOUNT DOES NOT EXIST YET. The
 * conservative direction for a revocation table is the one that does NOT take
 * access away: an event this table does not map revokes nothing, and the client
 * still converges on `GET /v1/entitlements`, which is the only thing that ever
 * unlocks or locks. `Private/runbooks/revenuecat-setup.md` carries the owner
 * step that re-reads RevenueCat's webhook event reference against this table at
 * the moment the project is created, and any event this list does not name is a
 * deliberate refusal to guess rather than an omission.
 */

/** @type {readonly RevenueCatEventReason[]} */
export const REVENUECAT_EVENT_REASONS = [
  {
    event: 'CANCELLATION',
    reason: 'cancelled_at_period_end',
    why: 'Auto-renew was turned off. Access continues to the paid-through date, which is exactly what cancelled_at_period_end names — mapping it to subscription_expired would end access on the day the user pressed cancel.',
  },
  {
    event: 'EXPIRATION',
    reason: 'subscription_expired',
    why: 'The subscription reached its end and did not renew. This is the event that actually ends access; the finer expiration_reason sub-field is NOT read here, because a per-sub-reason table would be a second vendor fact nobody has verified.',
  },
  {
    event: 'SUBSCRIPTION_PAUSED',
    reason: 'subscription_paused',
    why: 'Play lets a subscriber pause; the row stops being entitled and resumes later. subscription_paused exists in the reason set precisely so a pause is not recorded as an expiry, which would be read as churn.',
  },
  {
    event: 'BILLING_ISSUE',
    reason: null,
    why: 'NOT A REVOCATION. It is a grace-period warning and the store retries; the final outcome arrives later as EXPIRATION. Mapping it to payment_failed_final would lock out a customer whose card recovers, which is the failure this whole table is shaped to avoid.',
  },
  {
    event: 'INITIAL_PURCHASE',
    reason: null,
    why: 'NOT A REVOCATION — a grant. Recorded so the table is a complete answer for the events the client can see, rather than a list that goes quiet on the ones that matter most.',
  },
  {
    event: 'RENEWAL',
    reason: null,
    why: 'NOT A REVOCATION — the subscription continued.',
  },
  {
    event: 'UNCANCELLATION',
    reason: null,
    why: 'NOT A REVOCATION — auto-renew was turned back on before the period ended, so there is nothing to take away.',
  },
];

const REVENUECAT_EVENT_MAP = new Map(REVENUECAT_EVENT_REASONS.map((r) => [r.event, r.reason]));

/**
 * The revocation reason a RevenueCat event means, or null when it means none.
 *
 * Returns null for an event this table does not name — the SAFE direction, and
 * the one the header explains: an unknown event revokes nothing and the server
 * read stays the only authority.
 * @param {string} event
 * @returns {string | null}
 */
export function revocationReasonForRevenueCatEvent(event) {
  return REVENUECAT_EVENT_MAP.get(event) ?? null;
}

/** Machine-readable form, kept byte-identical to contract.json by generate.mjs. */
export const CONTRACT_TABLE = {
  moneyEnvironments: MONEY_ENVIRONMENTS,
  revocationReasons: REVOCATION_REASONS,
  revenuecatEventReasons: REVENUECAT_EVENT_REASONS,
};
