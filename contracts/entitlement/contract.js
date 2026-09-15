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
 * @typedef {{ readonly event: string, readonly reason: string | null, readonly dateDerived: boolean, readonly why: string }} RevenueCatEventReason
 *
 * WHICH REVENUECAT WEBHOOK EVENT MEANS WHICH OF OUR REVOCATION REASONS.
 *
 * 🔴 THE MAP IS DATA, IN THIS FILE, FOR THE SAME REASON THE REASON SET IS. Three
 * runtimes have to agree about it: the platform Worker's `revenuecatVerifier`
 * (when it is written — see the residue in
 * `Private/pre-prune-2026-09-08:research/revamp-2026-09-05/phase3-chassis-billing.md`), the Dart
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
 *
 * ⚠️ FIVE SEEDED REVOCATION REASONS ARE REACHABLE FROM NO REVENUECAT EVENT IN
 * THIS TABLE: `refund_approved`, `chargeback`, `chargeback_reversed`,
 * `trial_expired` and `payment_failed_final`. Four of those are Paddle-side or
 * dispute-side outcomes and belong to the hosted rail; the fifth,
 * `refund_approved`, is reachable from RevenueCat only as the PAST-DATED shape
 * of `CANCELLATION` (see that row), which no event NAME distinguishes. Recorded
 * here so the gap reads as measured rather than forgotten — and so nobody
 * "completes" the table by inventing a store event for each unused reason.
 *
 * 🔴 A SECOND, UNGOVERNED COPY OF THIS VOCABULARY ALREADY EXISTS IN THE TREE.
 * `services/subscriptiontracker-api/src/routes/webhooks.ts:95-106` carries `ACTIVE_TYPES` /
 * `INACTIVE_TYPES` / `GRACE_TYPES` as hard-coded sets and imports nothing from
 * `contracts/`; it is the ONE runtime that reads a RevenueCat event today
 * (`POST /revenuecat`, `:430`). The two vocabularies already disagree: that
 * Worker knows `NON_RENEWING_PURCHASE`, `PRODUCT_CHANGE` and
 * `SUBSCRIPTION_EXTENDED`, which this table does not, and this table knows
 * `SUBSCRIPTION_PAUSED`, which it does not. Limb 7 of
 * `tooling/ci/assert-entitlement-contract.mjs` holds that divergence to a
 * DECLARED list, in both directions, so it cannot widen unwatched — but the fix
 * is not a third table: the `revenuecatVerifier` unit must IMPORT this file and
 * DELETE those three sets, the way `services/platform/src/lib/mor/contract.ts`
 * already imports the reason vocabulary rather than restating it.
 *
 * ⏱ 2026-09-15 — THAT COPY IS GONE, AND THE PARAGRAPH ABOVE IS KEPT AS WHAT WAS
 * TRUE THE DAY IT WAS WRITTEN. services/subscriptiontracker-api/src/routes/webhooks.ts
 * now IMPORTS this file and decides access through `revenueCatAccessRuling`
 * below; its three literal sets were deleted. Closing the divergence meant
 * re-reading the vendor's own event reference first
 * (revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read
 * 2026-09-15), and it moved TWO things here, each quoted in its row's `why`:
 *   · SUBSCRIPTION_PAUSED WAS WRONG IN THIS TABLE. The reference says "Don't
 *     revoke access on this event. Revoke access only on `EXPIRATION` with
 *     expiration reason `SUBSCRIPTION_PAUSED`." It is now reason null, and
 *     `subscription_paused` joins the reasons no RevenueCat event NAME reaches.
 *     Had the Worker imported the table as it stood, it would have revoked a
 *     paying customer who merely scheduled a pause.
 *   · the three events only the Worker knew — NON_RENEWING_PURCHASE,
 *     PRODUCT_CHANGE, SUBSCRIPTION_EXTENDED — are rows now, with the vendor's
 *     own sentence, so the table and the one runtime that reads it are one list.
 */

/** @type {readonly RevenueCatEventReason[]} */
export const REVENUECAT_EVENT_REASONS = [
  {
    event: 'CANCELLATION',
    reason: 'cancelled_at_period_end',
    dateDerived: true,
    why: 'ONE EVENT NAME, TWO OPPOSITE ACCESS OUTCOMES, AND THE NAME CANNOT TELL THEM APART. Auto-renew turned off leaves access running to the paid-through date, which is exactly what cancelled_at_period_end names — mapping that to subscription_expired would end access on the day the user pressed cancel. But RevenueCat sends the SAME event for a REFUND, and then expiration_at_ms is in the PAST, access ends at once, and the honest reason is refund_approved. The two shapes differ only by the DATE, never by the event name, which is why this row is dateDerived: the reason above is the cancel-at-period-end shape and a consumer that revokes on the event name alone is wrong on the other one. Already documented and already implemented in this tree: services/subscriptiontracker-api/src/routes/webhooks.ts:53-57 states the split in prose, and resolveIsActive at :132 decides it on the paid-through ruling this row yields by comparing expiration_at_ms against now (re-measured 2026-09-15; until then the Worker held CANCELLATION in its own GRACE_TYPES set). THE REFUND SHAPE, RECORDED RATHER THAN LEFT TO BE REDISCOVERED: on the refund reading of this event the honest reason is refund_approved and access ends at once; that outcome is DATE-DERIVED and it belongs to the VERIFIER, not to this mapper, because the event name cannot carry it and only expiration_at_ms against now can decide it (services/subscriptiontracker-api/src/routes/webhooks.ts:53-57 states the split in prose, and resolveIsActive at :132 is the comparison, on the paid-through ruling it shares with BILLING_ISSUE). It is recorded in this why rather than as a second row because a second row keyed on the same event name would make the table answer twice for one key, and the reason a consumer must not take from the name is precisely the one it would then read first. FIVE OF THE EIGHT SEEDED REASONS ARE REACHABLE FROM NO REVENUECAT EVENT AT ALL TODAY: refund_approved, chargeback, chargeback_reversed, trial_expired and payment_failed_final. Every one of them arrives on the MoR (Paddle) rail or from an operator, never from this table, so a client that renders one of those strings did not learn it here.',
  },
  {
    event: 'EXPIRATION',
    reason: 'subscription_expired',
    dateDerived: false,
    why: 'The subscription reached its end and did not renew. This is the event that actually ends access on its own authority (services/subscriptiontracker-api/src/routes/webhooks.ts reads this row as the revoke ruling; until 2026-09-15 it was the Worker\'s own INACTIVE_TYPES set); the finer expiration_reason sub-field is NOT read here, because a per-sub-reason table would be a second vendor fact nobody has verified.',
  },
  {
    event: 'SUBSCRIPTION_PAUSED',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — CORRECTED 2026-09-15 FROM THE VENDOR REFERENCE. This row said reason subscription_paused ("the row stops being entitled and resumes later"). RevenueCat\'s event reference (revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-15) says the opposite for THIS event: "Don\'t revoke access on this event. Revoke access only on `EXPIRATION` with expiration reason `SUBSCRIPTION_PAUSED`." The pause is scheduled, the paid period runs on, and the revocation arrives later as EXPIRATION. subscription_paused stays in the reason set for that EXPIRATION sub-reason, which this table does not read (see the EXPIRATION row), so no RevenueCat event NAME reaches it. It is NOT a grant either, so revenueCatAccessRuling answers null for it and a reader acks it and changes nothing — the safe direction the header describes.',
  },
  {
    event: 'NON_RENEWING_PURCHASE',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — a grant. The vendor reference: "A customer has made a purchase that won\'t auto-renew." Added 2026-09-15 when services/subscriptiontracker-api/src/routes/webhooks.ts stopped restating its own sets; that Worker already granted on it outright (it was one of the three names limb 7 of tooling/ci/assert-entitlement-contract.mjs declared as worker-only). How long the grant lasts is the event\'s own expiration_at_ms, which the reader stores as expires_at; a CANCELLATION of the same purchase is that row\'s date-derived path.',
  },
  {
    event: 'PRODUCT_CHANGE',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — the subscriber moved between products, and access continues. The vendor reference warns: "This doesn\'t mean the new subscription is in effect immediately." That is a statement about WHICH product, not about whether access stands, and this table decides only the second; the reader keeps granting on the event\'s own expiration_at_ms, as services/subscriptiontracker-api/src/routes/webhooks.ts did when it restated this name itself (a worker-only name limb 7 declared, added here 2026-09-15). A downgrade that later lapses arrives as EXPIRATION.',
  },
  {
    event: 'SUBSCRIPTION_EXTENDED',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — a grant. The vendor reference: "The expiration date of the current subscription period was pushed back." Access continues to the NEW expiration_at_ms the event carries. Added 2026-09-15, the third worker-only name limb 7 declared.',
  },
  {
    event: 'BILLING_ISSUE',
    reason: null,
    dateDerived: true,
    why: 'NOT A REVOCATION BY NAME. It is a grace-period warning and the store retries; the final outcome arrives later as EXPIRATION. Mapping it to payment_failed_final would lock out a customer whose card recovers, which is the failure this whole table is shaped to avoid. It is dateDerived for the same reason CANCELLATION is: whether access still stands is the paid-through date, not the event name — services/subscriptiontracker-api/src/routes/webhooks.ts reads this row as the paid-through ruling beside CANCELLATION (until 2026-09-15, the Worker\'s own GRACE_TYPES set).',
  },
  {
    event: 'INITIAL_PURCHASE',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — a grant. Recorded so the table is a complete answer for the events the client can see, rather than a list that goes quiet on the ones that matter most.',
  },
  {
    event: 'RENEWAL',
    reason: null,
    dateDerived: false,
    why: 'NOT A REVOCATION — the subscription continued.',
  },
  {
    event: 'UNCANCELLATION',
    reason: null,
    dateDerived: false,
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

/**
 * @typedef {'grant' | 'revoke' | 'paid-through'} RevenueCatAccessRuling
 *
 * What a RevenueCat event does to ACCESS, read off the table rather than off a
 * second list. Added 2026-09-15, when the one Worker that reads these events
 * deleted its own ACTIVE / INACTIVE / GRACE sets and started asking this instead.
 *
 *   'paid-through' — `dateDerived`: access stands exactly while the event's
 *                    paid-through date is in the future (CANCELLATION,
 *                    BILLING_ISSUE). Checked FIRST, because CANCELLATION carries
 *                    a reason and must still never revoke on its name alone.
 *   'revoke'       — a reason and not date-derived: access ends (EXPIRATION).
 *   'grant'        — no reason and not date-derived: access is on.
 *   null           — the table does not decide this event. A reader acks it and
 *                    changes nothing: an unknown event revokes nothing, and
 *                    SUBSCRIPTION_PAUSED — no reason, but the vendor also says it
 *                    is no grant — is the one named row that answers null.
 *
 * @param {string} event
 * @returns {RevenueCatAccessRuling | null}
 */
export function revenueCatAccessRuling(event) {
  const row = REVENUECAT_EVENT_REASONS.find((r) => r.event === event);
  if (row === undefined || NOT_A_GRANT.has(event)) return null;
  if (row.dateDerived) return 'paid-through';
  return row.reason === null ? 'grant' : 'revoke';
}

/** Rows that carry no reason and are STILL not a grant. One member, sourced in its row's `why`. */
const NOT_A_GRANT = new Set(['SUBSCRIPTION_PAUSED']);

/** Machine-readable form, kept byte-identical to contract.json by generate.mjs. */
export const CONTRACT_TABLE = {
  moneyEnvironments: MONEY_ENVIRONMENTS,
  revocationReasons: REVOCATION_REASONS,
  revenuecatEventReasons: REVENUECAT_EVENT_REASONS,
};
