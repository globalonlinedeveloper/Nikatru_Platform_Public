// ─────────────────────────────────────────────────────────────────────────────
// grant.ts — THE ONE ENTRY FROM A VERIFIED MONEY EVENT TO A GRANT, for every
// rail (O-ONE-TIME-GRANT-UNBUILT, O-IAP-BUNDLE-SALE-UNLOCKS-ONE-APP).
//
// A notification reaches this module only AFTER its rail's verifier has checked
// the signature and its adapter has parsed it: routes/money.ts (the door) and
// scheduled.ts `moneyRederive` (the nightly re-derivation of a stored,
// already-verified row) are its two callers, and
// tooling/ci/assert-bundle-provenance.mjs (G7) requires each of them to reach a
// verification seam above its call. It decides WHICH writer a grant goes to and
// nothing else — both writers keep their own ordering clause:
//
//   · a ONE-TIME purchase (Paddle's completed, subscription-less transaction)
//     whose price sells a `one_time` offering of a single-app product →
//     store.ts `applyOneTime`, with no end date. A price that sells no one-time
//     offering grants nothing (`ignored`, stored with its reason).
//   · a RevenueCat event whose product is a BUNDLE SKU in the rendered map
//     (store-skus.ts) → bundle-store.ts `upsertBundleGrant`, the one writer into
//     bundle_grants, with the SKU's term.
//   · EVERYTHING ELSE — every subscription and adjustment on every rail, an app
//     SKU and a SKU the map does not hold — → store.ts `deriveAndApply`, exactly
//     as before this module existed. test/grant.test.ts holds that re-point to
//     byte-equal rows on the existing fixtures.
//
// 🔴 WHAT A PRICE OR A MINT MEANS IS INJECTED, NOT IMPORTED. The offering a
// rail's price sells lives beside the checkout that creates it
// (routes/checkout.ts), and minting a feature-set version reads the product
// registers (routes/receipts.ts); both import src/config.ts, which nothing under
// src/lib/ may import (store.ts `MoneyStoreDeps` records the measured reason).
// The callers hand both in; a missing one is a TypeError at the first event that
// needs it — loud, and it grants nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { type BundleStoreDeps, upsertBundleGrant } from './bundle-store';
import {
  type NormalizedNotification,
  type SubjectOneTime,
  type SubjectSubscription,
  decideSubscription,
} from './contract';
import { type ApplyResult, type MoneyStoreDeps, applyOneTime, concludeDerivation, deriveAndApply } from './store';
import { STORE_SKUS, type StoreSku } from './store-skus';

/** The offering a rail's one-time price sells: OUR app and offering ids. */
export interface OneTimeOffering {
  readonly appId: string;
  readonly offeringId: string;
}

export interface GrantDeps extends MoneyStoreDeps {
  /**
   * The `one_time` offering `priceId` on `provider` sells, or null when it sells
   * none (an unmapped price, or a price for a recurring offering).
   */
  oneTimeOffering: (provider: string, priceId: string) => OneTimeOffering | null;
  /**
   * Mint (pin) a feature-set version before a bundle grant points at it — the
   * receipt route's mint, which refuses a version the register does not call
   * `sellable` ([ADR 057] §4). It throws on refusal, and the caller answers 503.
   */
  mintFeatureSet: (featureSet: string, version: number) => Promise<void>;
  /** The store SKU map. Absent ⇒ the rendered one; a test hands in its own. */
  storeSkus?: readonly StoreSku[];
}

/** The rail whose events name a store product ([ADR 092] E1 stores it). */
const REVENUECAT_PROVIDER = 'revenuecat';

/**
 * The `bundle_sources` member a bundle grant bought through RevenueCat is recorded
 * under, on either store ([ADR 092] §4.7; seeded by migration 0019). RevenueCat
 * validated the store receipt, so the store's own check never ran here: recording
 * `apple_iap` or `google_play_billing` would claim one that did ([ADR 092] §2).
 */
const REVENUECAT_BUNDLE_SOURCE = 'revenuecat';

/**
 * The SKU a store product id names for `app`, or null. RevenueCat reports a Play
 * product as `<subscription id>:<base plan id>` (LEAD RULINGS 3 item 2:
 * `pro_monthly:monthly`), so a Play SKU also matches its own id followed by `:`.
 */
export function storeSkuFor(
  skus: readonly StoreSku[],
  app: string | null,
  productId: string | null | undefined,
): StoreSku | null {
  if (app === null || productId === null || productId === undefined || productId === '') return null;
  for (const s of skus) {
    if (s.app !== app) continue;
    if (s.productId === productId) return s;
    if (s.store !== 'apple-iap' && productId.startsWith(`${s.productId}:`)) return s;
  }
  return null;
}

/**
 * Write the grant a verified, parsed notification decides — through the one
 * writer its kind names — and stamp the stored notification with the outcome.
 */
export async function grantFromVerifiedEvent(deps: GrantDeps, n: NormalizedNotification): Promise<ApplyResult> {
  const s = n.subject;
  if (s.kind === 'one_time') {
    const result = await grantOneTime(deps, n, s);
    await concludeDerivation(deps, n, result);
    return result;
  }
  if (s.kind === 'subscription' && n.provider === REVENUECAT_PROVIDER) {
    const sku = storeSkuFor(deps.storeSkus ?? STORE_SKUS, s.accountAppId, s.productId);
    if (sku !== null && sku.kind === 'bundle') {
      const result = await grantBundleSku(deps, n, s, sku);
      await concludeDerivation(deps, n, result);
      return result;
    }
  }
  // Every other subject, and an app SKU or an unknown one: the single-app path,
  // unchanged (store.ts concludes it itself).
  return deriveAndApply(deps, n);
}

async function grantOneTime(deps: GrantDeps, n: NormalizedNotification, s: SubjectOneTime): Promise<ApplyResult> {
  // Our checkout creates a transaction for ONE offering. A purchase of several
  // prices is not one this server sold, and granting any subset of it would be a
  // guess — refused, so it is stored, retried and counted nightly.
  if (s.priceIds.length !== 1) {
    return {
      outcome: 'refused',
      detail: `one_time_multi_item: ${n.provider} purchase ${s.transactionId} carries ${s.priceIds.length} prices, and a checkout here sells one offering per transaction`,
    };
  }
  const offering = deps.oneTimeOffering(n.provider, s.priceIds[0]);
  if (offering === null) {
    return {
      outcome: 'ignored',
      detail: `${n.provider} price ${s.priceIds[0]} on purchase ${s.transactionId} sells no one_time offering, so it grants nothing`,
    };
  }
  return applyOneTime(deps, n, s, offering.appId);
}

async function grantBundleSku(
  deps: GrantDeps,
  n: NormalizedNotification,
  s: SubjectSubscription,
  sku: StoreSku,
): Promise<ApplyResult> {
  // [5]M-12, as store.ts checks it for a single-app grant, before anything is minted.
  if (s.railEnvironment != null && s.railEnvironment !== deps.environment) {
    return {
      outcome: 'refused',
      detail: `the notification says it is ${s.railEnvironment} money and this destination is configured for ${deps.environment}`,
    };
  }
  if (s.accountUserId === null || sku.featureSet === null || sku.version === null || sku.store === null) {
    return {
      outcome: 'refused',
      detail: `bundle SKU ${sku.productId} for ${sku.app} names no account, feature set or known store rail, so no bundle grant can be written`,
    };
  }
  const decision = decideSubscription(s, deps.nowMs);
  if (!decision.ok) return { outcome: 'refused', detail: decision.reason };
  const d = decision.decision;
  await deps.mintFeatureSet(sku.featureSet, sku.version);
  const bundleDeps: BundleStoreDeps = { db: deps.db, environment: deps.environment };
  const write = await upsertBundleGrant(bundleDeps, {
    userId: s.accountUserId,
    source: REVENUECAT_BUNDLE_SOURCE,
    term: sku.term,
    featureSetName: sku.featureSet,
    featureSetVersion: sku.version,
    provider: n.provider,
    providerSubscriptionId: s.subscriptionId,
    providerTransactionId: s.transactionId,
    providerStatus: d.providerStatus,
    lastEventId: n.eventId,
    occurredAt: n.occurredAt,
    currentPeriodEnd: d.currentPeriodEnd,
    trialEnd: d.trialEnd,
    expiresAt: d.expiresAt,
    graceUntil: null,
    revokedAt: d.revokedAt,
    revocationReason: d.revocationReason,
    creditDaysApplied: null,
  });
  return write.outcome === 'applied'
    ? { outcome: 'applied', userId: s.accountUserId, appId: sku.featureSet, isActive: d.isActive }
    : { outcome: 'stale', userId: s.accountUserId, appId: sku.featureSet };
}
