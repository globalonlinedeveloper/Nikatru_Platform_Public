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
 * @typedef {{ readonly event: string, readonly reason: string | null, readonly dateDerived: boolean, readonly notAGrant: boolean, readonly why: string }} RevenueCatEventReason
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
 *
 * ⏱ 2026-09-16 — AND THAT WORKER ROUTE IS RETIRED (O-REVENUECAT-VERIFIER leg b).
 * The one runtime that reads a RevenueCat event is now
 * services/platform/src/lib/mor/revenuecat.ts, which imports this file; limb 7
 * of tooling/ci/assert-entitlement-contract.mjs reads it there. The two
 * paragraphs above are kept as what was true on their dates.
 *
 * ⏱ 2026-09-24 · F912 (the #912 review, finding 3) — `notAGrant` IS A REQUIRED
 * FIELD OF EVERY ROW. Until this date a row with no reason that is not
 * date-derived was read as a grant unless its event name was ALSO written into a
 * Set beside this table, so a row added without that second edit granted access.
 * Each row now says it itself: `notAGrant: true` marks a row the vendor describes
 * as no access change (each quoted in its `why`), and revenueCatAccessRulingForRow
 * answers null for it. The ruling goes on to 'grant' only on an explicit `false`,
 * so a row that omits the field is never a grant, and limb 6b of
 * tooling/ci/assert-entitlement-contract.mjs refuses that row by name, as it
 * refuses `notAGrant: true` on a row that carries a reason or is date-derived.
 * services/platform/src/lib/mor/revenuecat.ts reads the field BEFORE routing step
 * A ([ADR 085] A, append 2026-09-24). A row's `why` that says it "is in
 * NOT_A_GRANT" names that Set, which this field replaced on this date.
 */

/** @type {readonly RevenueCatEventReason[]} */
export const REVENUECAT_EVENT_REASONS = [
  {
    event: 'CANCELLATION',
    reason: 'cancelled_at_period_end',
    dateDerived: true,
    notAGrant: false,
    why: 'ONE EVENT NAME, TWO OPPOSITE ACCESS OUTCOMES, AND THE NAME CANNOT TELL THEM APART. Auto-renew turned off leaves access running to the paid-through date, which is exactly what cancelled_at_period_end names — mapping that to subscription_expired would end access on the day the user pressed cancel. But RevenueCat sends the SAME event for a REFUND, and then expiration_at_ms is in the PAST, access ends at once, and the honest reason is refund_approved. The two shapes differ only by the DATE, never by the event name, which is why this row is dateDerived: the reason above is the cancel-at-period-end shape and a consumer that revokes on the event name alone is wrong on the other one. Already documented and already implemented in this tree: services/platform/src/lib/mor/revenuecat.ts states the split in its header (decision C) and parseRevenueCatEvent decides it on the paid-through ruling this row yields — a cancel_reason of CUSTOMER_SUPPORT revokes at once as refund_approved, another stated reason runs to expiration_at_ms, and no usable reason lets the past date decide (re-pointed 2026-09-16 from the retired legacy route services/subscriptiontracker-api/src/routes/webhooks.ts, whose resolveIsActive made the date comparison; until 2026-09-15 that Worker held CANCELLATION in its own GRACE_TYPES set). THE REFUND SHAPE, RECORDED RATHER THAN LEFT TO BE REDISCOVERED: on the refund reading of this event the honest reason is refund_approved and access ends at once; that outcome is DATE-DERIVED and it belongs to the VERIFIER, not to this mapper, because the event name cannot carry it and only expiration_at_ms against now can decide it (services/platform/src/lib/mor/revenuecat.ts parseRevenueCatEvent is that verifier since 2026-09-16, on the paid-through ruling it shares with BILLING_ISSUE; the retired legacy route services/subscriptiontracker-api/src/routes/webhooks.ts was, before it). It is recorded in this why rather than as a second row because a second row keyed on the same event name would make the table answer twice for one key, and the reason a consumer must not take from the name is precisely the one it would then read first. FIVE OF THE EIGHT SEEDED REASONS ARE REACHABLE FROM NO REVENUECAT EVENT AT ALL TODAY: refund_approved, chargeback, chargeback_reversed, trial_expired and payment_failed_final. Every one of them arrives on the MoR (Paddle) rail or from an operator, never from this table, so a client that renders one of those strings did not learn it here.',
  },
  {
    event: 'EXPIRATION',
    reason: 'subscription_expired',
    dateDerived: false,
    notAGrant: false,
    why: 'The subscription reached its end and did not renew. This is the event that actually ends access on its own authority (services/platform/src/lib/mor/revenuecat.ts reads this row as the revoke ruling; until 2026-09-16 the retired legacy route services/subscriptiontracker-api/src/routes/webhooks.ts did, and until 2026-09-15 it was that Worker\'s own INACTIVE_TYPES set); the finer expiration_reason sub-field is NOT read here, because a per-sub-reason table would be a second vendor fact nobody has verified.',
  },
  {
    event: 'SUBSCRIPTION_PAUSED',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A REVOCATION — CORRECTED 2026-09-15 FROM THE VENDOR REFERENCE. This row said reason subscription_paused ("the row stops being entitled and resumes later"). RevenueCat\'s event reference (revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-15) says the opposite for THIS event: "Don\'t revoke access on this event. Revoke access only on `EXPIRATION` with expiration reason `SUBSCRIPTION_PAUSED`." The pause is scheduled, the paid period runs on, and the revocation arrives later as EXPIRATION. subscription_paused stays in the reason set for that EXPIRATION sub-reason, which this table does not read (see the EXPIRATION row), so no RevenueCat event NAME reaches it. It is NOT a grant either, so revenueCatAccessRuling answers null for it and a reader acks it and changes nothing — the safe direction the header describes.',
  },
  {
    event: 'NON_RENEWING_PURCHASE',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — a grant. The vendor reference: "A customer has made a purchase that won\'t auto-renew." Added 2026-09-15 when services/subscriptiontracker-api/src/routes/webhooks.ts (retired 2026-09-16) stopped restating its own sets; that Worker already granted on it outright (it was one of the three names limb 7 of tooling/ci/assert-entitlement-contract.mjs declared as worker-only). How long the grant lasts is the event\'s own expiration_at_ms, which the reader stores as expires_at; a CANCELLATION of the same purchase is that row\'s date-derived path.',
  },
  {
    event: 'PRODUCT_CHANGE',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — the subscriber moved between products, and access continues. The vendor reference warns: "This doesn\'t mean the new subscription is in effect immediately." That is a statement about WHICH product, not about whether access stands, and this table decides only the second; the reader keeps granting on the event\'s own expiration_at_ms, as services/platform/src/lib/mor/revenuecat.ts does today and as the retired legacy route services/subscriptiontracker-api/src/routes/webhooks.ts did when it restated this name itself (a worker-only name limb 7 declared, added here 2026-09-15). A downgrade that later lapses arrives as EXPIRATION.',
  },
  {
    event: 'SUBSCRIPTION_EXTENDED',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — a grant. The vendor reference: "The expiration date of the current subscription period was pushed back." Access continues to the NEW expiration_at_ms the event carries. Added 2026-09-15, the third worker-only name limb 7 declared.',
  },
  {
    event: 'BILLING_ISSUE',
    reason: null,
    dateDerived: true,
    notAGrant: false,
    why: 'NOT A REVOCATION BY NAME. It is a grace-period warning and the store retries; the final outcome arrives later as EXPIRATION. Mapping it to payment_failed_final would lock out a customer whose card recovers, which is the failure this whole table is shaped to avoid. It is dateDerived for the same reason CANCELLATION is: whether access still stands is the paid-through date, not the event name — services/platform/src/lib/mor/revenuecat.ts reads this row as the paid-through ruling beside CANCELLATION and ends a lapsed one as payment_failed_final (until 2026-09-16 the retired legacy route services/subscriptiontracker-api/src/routes/webhooks.ts read it; until 2026-09-15 it was that Worker\'s own GRACE_TYPES set).',
  },
  {
    event: 'INITIAL_PURCHASE',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — a grant. Recorded so the table is a complete answer for the events the client can see, rather than a list that goes quiet on the ones that matter most.',
  },
  {
    event: 'RENEWAL',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — the subscription continued.',
  },
  {
    event: 'UNCANCELLATION',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A REVOCATION — auto-renew was turned back on before the period ended, so there is nothing to take away.',
  },
  {
    event: 'TRANSFER',
    reason: null,
    dateDerived: false,
    notAGrant: false,
    why: 'NOT A GRANT AND NOT A REVOCATION — AN OWNERSHIP NOTICE, DECIDED 2026-09-22 BY [ADR 092] §4.3 (LOCKED). RevenueCat\'s event reference (revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-22T15:31:55Z) sends it when the restore behaviour moves purchases between App User IDs: `transferred_from` names the old owner(s), `transferred_to` the new, both String[] marked Always, and the vendor warns that an Always key is present but its value may be null. "The webhook is sent only for the destination user". The body carries NO app_user_id, product_id, original_transaction_id or expiration_at_ms, so it cannot say what access anyone has. revenueCatAccessRuling answers \'transfer\' for it, checked BEFORE the grant rule this row\'s shape (no reason, not date-derived) would otherwise fall into: a TRANSFER read as a grant would give access to an id whose purchase this rail has never seen. services/platform/src/lib/mor/revenuecat.ts refuses it by name when an id list is null or empty, when an id on either side is anonymous, when more than one destination is named, or when `environment` (Sometimes on this event) is absent; store.ts refuses it as transfer_from_live_owner while a source user still holds a live RevenueCat row for the app, and otherwise concludes it with NO write — the ledger\'s owner of a purchase moves later, on the next newer signed money event (ADR 092 §4.4).',
  },
  {
    event: 'TEMPORARY_ENTITLEMENT_GRANT',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — [ADR 092] §4.6, 2026-09-22. RevenueCat\'s event reference (revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-22T15:31:55Z) sends it during a store outage: a provisional grant of at most 24 hours, carrying only `app_user_id` and (Sometimes) `store` — no `environment`, so its money world cannot be told, and no transaction, so it could never be linked. The purchase it stands for arrives later as INITIAL_PURCHASE when validation succeeds, or as EXPIRATION when it fails. It is in NOT_A_GRANT beside SUBSCRIPTION_PAUSED, so revenueCatAccessRuling answers null and a reader acks it and changes nothing.',
  },
  {
    event: 'INVOICE_ISSUANCE',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "A new, unpaid invoice was issued." It is created for a purchase "that hasn\'t yet been paid", and "This only applies to RevenueCat Billing purchases". An unpaid invoice is not access, and the reference describes no access change for it. Until this row it was an unnamed type, which services/platform/src/lib/mor/revenuecat.ts refuses with a 503 that the vendor retries five times. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing. ⏱ 2026-09-24 (F912, the #912 review, finding 4): the vendor limits this event to RevenueCat Billing purchases, a setup subscriptiontracker does not have: the RevenueCat app ids it declares are its Play and App Store apps (apps/subscriptiontracker/app.yaml billing.mobileIap.revenuecatAppIds).',
  },
  {
    event: 'VIRTUAL_CURRENCY_TRANSACTION',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "An in-app currency transaction occurred." It "provides details about the in-app currency adjustment, including the amount, currency type, and source of the change": a currency balance, not an entitlement. The vendor sends it beside the purchase, renewal or refund that caused it, and each of those reaches this table as its own event. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing.',
  },
  {
    event: 'EXPERIMENT_ENROLLMENT',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "A customer was enrolled in an experiment." The reference says "This event isn\'t associated with a store" and that `app_id` "is usually excluded", so services/platform/src/lib/mor/revenuecat.ts still refuses one that carries no app_id on [ADR 085] decision A, before it reads this row. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing. ⏱ 2026-09-24 ([ADR 085] A, append 2026-09-24): no longer refused. revenuecat.ts now reads this row\'s notAGrant BEFORE routing step A and acknowledges the event with or without an app_id: it writes nothing, so routing it could change no entitlement, and the refusal only cost five vendor retries and a false count in the nightly refused total.',
  },
  {
    event: 'PURCHASE_REDEEMED',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "A Paddle, RevenueCat Billing, or Stripe purchase was redeemed and associated with an App User ID." It "fires when a user opens a redemption deep link in your app", and "If the redemption results in a transfer, this is fired in addition to `TRANSFER`", so an ownership move is the TRANSFER row\'s to rule on, not this one\'s. The reference describes no access change for the redemption itself. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing. ⏱ 2026-09-24 (F912, the #912 review, finding 4): the vendor limits this event to Paddle, RevenueCat Billing or Stripe purchases, a setup subscriptiontracker does not have: the RevenueCat app ids it declares are its Play and App Store apps (apps/subscriptiontracker/app.yaml billing.mobileIap.revenuecatAppIds). This row is re-ruled before any web-billing app id is declared.',
  },
  {
    event: 'SUBSCRIBER_ALIAS',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT, AND DEPRECATED BY THE VENDOR — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "Deprecated. A new App User ID was registered for an existing subscriber." and "This is a legacy event type. New projects don\'t receive this webhook." It names an id, not an access change. It stays a row so that a legacy delivery is acknowledged rather than retried. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing.',
  },
  {
    event: 'PRICE_INCREASE_CONSENT_REQUIRED',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "A price increase requires customer consent before the subscription can renew at the new price." App Store and Google Play only. The current paid period is unchanged; the subscription then renews or lapses through its own later event (RENEWAL or EXPIRATION). A notice to the user would be a separate product decision, not an access ruling. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing.',
  },
  {
    event: 'PRICE_INCREASE_CONSENT_APPROVED',
    reason: null,
    dateDerived: false,
    notAGrant: true,
    why: 'NOT A GRANT — re-read 2026-09-24 (O-REVENUECAT-ACCOUNT step 6). RevenueCat\'s event reference (Event Types and Fields, revenuecat.com/docs/integrations/webhooks/event-types-and-fields, read 2026-09-24T04:01:33Z): "A customer consented to a pending price increase." App Store and Google Play only. Consent changes the next price, not the current access; the renewal at the new price arrives as its own RENEWAL. It is in NOT_A_GRANT, so revenueCatAccessRuling answers null and a reader acks it and changes nothing.',
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
 * @typedef {'grant' | 'revoke' | 'paid-through' | 'transfer'} RevenueCatAccessRuling
 *
 * What a RevenueCat event does to ACCESS, read off the table rather than off a
 * second list. Added 2026-09-15, when the one Worker that reads these events
 * deleted its own ACTIVE / INACTIVE / GRACE sets and started asking this instead.
 *
 *   'transfer'     — ⏱ 2026-09-22 · [ADR 092] §4.3. The purchases moved between
 *                    App User IDs; the event says who owns them now and nothing
 *                    about access. Checked FIRST: the TRANSFER row has no reason
 *                    and is not date-derived, so the grant rule below would read
 *                    it as 'grant'.
 *   'paid-through' — `dateDerived`: access stands exactly while the event's
 *                    paid-through date is in the future (CANCELLATION,
 *                    BILLING_ISSUE). Checked FIRST, because CANCELLATION carries
 *                    a reason and must still never revoke on its name alone.
 *   'revoke'       — a reason and not date-derived: access ends (EXPIRATION).
 *   'grant'        — no reason and not date-derived: access is on.
 *   null           — the table does not decide this event. A reader acks it and
 *                    changes nothing: an unknown event revokes nothing, and the
 *                    rows marked `notAGrant: true` — no reason, but the vendor
 *                    describes none of them as a grant, each quoted in its row's
 *                    `why` — are the named rows that answer null. ⏱ 2026-09-24:
 *                    that mark is the row's own field (a Set of event names
 *                    until then), and a row whose field is anything but `false`
 *                    answers null here too, never 'grant'.
 *
 * ⏱ 2026-09-22 · [ADR 092] §4.6 — A REASON THAT RESTORES ACCESS IS NEVER 'revoke'.
 * Before this date a row whose reason was `chargeback_reversed` (restores: true
 * in REVOCATION_REASONS above) would have been read as 'revoke' by the last line,
 * because that line asks only whether a reason exists. A REFUND_REVERSED row
 * mapped that way would SUSPEND the customer whose refund was just undone. Such a
 * row now answers null, and a reader must refuse it rather than ack it (the row
 * carries a reason, so it is not the "changes nothing" shape above); a restore
 * is routed as an adjustment with `restores: true`, never through this ruling.
 *
 * @param {string} event
 * @returns {RevenueCatAccessRuling | null}
 */
export function revenueCatAccessRuling(event) {
  const row = REVENUECAT_EVENT_REASONS.find((r) => r.event === event);
  return row === undefined ? null : revenueCatAccessRulingForRow(row);
}

/**
 * The ruling for ONE row, so a row the table does not (yet) carry can be ruled on
 * in a test — the REFUND_REVERSED shape is exactly such a row.
 * @param {Pick<RevenueCatEventReason, 'event' | 'reason' | 'dateDerived' | 'notAGrant'>} row
 * @returns {RevenueCatAccessRuling | null}
 */
export function revenueCatAccessRulingForRow(row) {
  if (TRANSFER_EVENTS.has(row.event)) return 'transfer';
  // ⏱ 2026-09-24 · F912 — the ROW decides. Only an explicit `false` goes on, so a
  // row that omits the field fails closed here as well as in limb 6b.
  if (row.notAGrant !== false) return null;
  if (row.reason !== null && !REVOCATION_REASONS.some((r) => r.reason === row.reason && r.restores === false)) {
    return null;
  }
  if (row.dateDerived) return 'paid-through';
  return row.reason === null ? 'grant' : 'revoke';
}

/** Rows that move OWNERSHIP and say nothing about access ([ADR 092] §4.3). Sourced in the row's `why`. */
const TRANSFER_EVENTS = new Set(['TRANSFER']);

/** Machine-readable form, kept byte-identical to contract.json by generate.mjs. */
export const CONTRACT_TABLE = {
  moneyEnvironments: MONEY_ENVIRONMENTS,
  revocationReasons: REVOCATION_REASONS,
  revenuecatEventReasons: REVENUECAT_EVENT_REASONS,
};
