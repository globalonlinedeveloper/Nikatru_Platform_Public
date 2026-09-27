// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// contracts/entitlement/bundle.js — the BUNDLE vocabulary, authored once.
//
// The companion to contract.js, and separate from it on purpose. contract.js is
// byte-copied into extensions/core/v1/entitlement-contract.js because the
// extension runtime decides revocation strings; the extension runtime never
// decides a bundle SOURCE — grants are server-side and the client only reads the
// answer. Folding these tables into contract.js would push a second copy of them
// into every extension zip and into the generated Dart, where nothing reads them,
// and would make every bundle edit a change to the file the live Worker's
// revocation vocabulary is inlined from.
//
// 🔴 PLAIN ES-MODULE JAVASCRIPT, for the same reason contract.js is: no build
// step, importable by the TypeScript Worker and by plain node tooling with
// nothing in between. `// @ts-check` plus JSDoc gives the checking with none of
// the compiling.
//
// WHAT MUST AGREE WITH THIS FILE, and what holds it there:
//   services/platform/migrations/0009_bundle_grants.sql section B — the SEEDED
//   `bundle_sources` rows. tooling/ci/assert-entitlement-contract.mjs limb 9
//   compares the two sets in BOTH directions, including `requires_receipt`.
//
// After any edit here, run the generator or CI fails:
//
//     node contracts/entitlement/generate-bundle.mjs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ readonly source: string, readonly requiresReceipt: boolean }} BundleSource
 *
 * How a bundle grant came to exist. MUST EQUAL the rows seeded by
 * `services/platform/migrations/0009_bundle_grants.sql` section B.
 *
 * 🔴 `requiresReceipt` IS THE FIELD A SECOND COPY GETS WRONG, and it is the one
 * that matters: it is the machine-readable half of "no entitlement without a
 * verified receipt". A copy that keeps all seven names and flips one flag to
 * false turns a paid rail into one that will mint a grant from nothing, and it
 * looks correct in a diff. [ADR 057] §3 — the set is decided in the migration
 * that creates it or never, because a grant whose provenance was not written at
 * insert time is unclassifiable forever.
 */

/** @type {readonly BundleSource[]} */
export const BUNDLE_SOURCES = [
  { source: 'paddle_subscription', requiresReceipt: true },
  { source: 'razorpay_subscription', requiresReceipt: true },
  { source: 'apple_iap', requiresReceipt: true },
  { source: 'google_play_billing', requiresReceipt: true },
  { source: 'microsoft_store', requiresReceipt: true },
  // ⏱ 2026-09-27 · a Paddle one-time purchase (migration 0019, term `one_time`),
  // granted through services/platform/src/lib/mor/grant.ts.
  { source: 'paddle_one_time', requiresReceipt: true },
  // ⏱ 2026-09-27 · a store bundle bought through RevenueCat ([ADR 092] §4.7,
  // migration 0019, term `subscription`), never recorded as a store rail.
  { source: 'revenuecat', requiresReceipt: true },
  // The two operator acts. Nobody paid, so no receipt exists — and the exemption
  // is WRITTEN DOWN rather than absent, because an exemption that is recorded can
  // be audited and one that is not is indistinguishable from the bug.
  { source: 'promo_code', requiresReceipt: false },
  { source: 'owner_comp', requiresReceipt: false },
];

const SOURCE_MAP = new Map(BUNDLE_SOURCES.map((s) => [s.source, s.requiresReceipt]));

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isBundleSource(v) {
  return typeof v === 'string' && SOURCE_MAP.has(v);
}

/**
 * Whether a grant from this source is only legitimate with a verified receipt
 * behind it.
 *
 * 🔴 AN UNKNOWN SOURCE RETURNS `true` — the FAIL-CLOSED direction. A source this
 * table does not name is a source nobody has decided the rules for, and the safe
 * reading of "we do not know" is "evidence is required", never "evidence is
 * optional". Defaulting to false would make every future typo an exemption.
 * @param {string} source
 * @returns {boolean}
 */
export function requiresReceipt(source) {
  return SOURCE_MAP.get(source) ?? true;
}

/**
 * @typedef {'app' | 'extension' | 'script' | 'bundle' | 'service' | 'site'} ProductKind
 *
 * 🔴 A PRODUCT IS AN app | extension | script | bundle | service | site. This is
 * the single fact that keeps a new category a DATA change rather than a schema
 * change: `feature_set_members.product_kind` records which register a slug came
 * from, so adding "script" to the bundle is a row, not a migration. The
 * registers each kind is read from are named in PRODUCT_REGISTERS below — as
 * data, so that tooling/bundle-availability.mjs and the Worker's twin derive the
 * live-product set from the same list rather than from two hand-written ones.
 *
 * ⏱ 2026-09-26 · O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST. `bundle`, `service` and
 * `site` joined the list so `isKnownProduct` can name a bundle. The code's word
 * is `kind`; the standing decision's word is `category`. The live API
 * (`productKindOf`, `feature_set_members.product_kind`) says `kind`, so `kind`
 * stays and nothing live is renamed.
 */

/** @type {readonly ProductKind[]} */
export const PRODUCT_KINDS = /** @type {const} */ (['app', 'extension', 'script', 'bundle', 'service', 'site']);

/**
 * 🔴 THE KIND THAT IS NEVER COUNTED LIVE AND IS NEVER A MEMBER. A bundle is a
 * product (it can be named, priced and sold), but it is made OF products: it
 * must never count toward the `MIN_LIVE_PRODUCTS_FOR_BUNDLE` floor that decides
 * whether it may be sold, or a bundle would count toward itself. Both
 * availability twins exclude it from the live count BY THIS NAME rather than by
 * the accident that a bundle's status spells `draft | sellable` and not `live`.
 */
export const BUNDLE_KIND = 'bundle';

/** The kinds a feature-set member may have: every kind but the bundle itself. */
export const MEMBER_KINDS = /** @type {readonly ProductKind[]} */ (PRODUCT_KINDS.filter((k) => k !== BUNDLE_KIND));

/**
 * @param {unknown} v
 * @returns {v is ProductKind}
 */
export function isProductKind(v) {
  return typeof v === 'string' && /** @type {readonly string[]} */ (PRODUCT_KINDS).includes(v);
}

/**
 * @typedef {{ readonly kind: ProductKind, readonly register: string | null, readonly slugField?: string }} ProductRegister
 *
 * Where each kind's slugs are published. `register: null` means the category is
 * DECLARED and has no register yet — which is a different fact from a category
 * nobody has thought about, and the difference is what stops a `script` product
 * from being invented in some third place later.
 *
 * `slugField` names the row field that IS the product's slug, and is absent when
 * that field is `slug`. The bundle register's rows are `{ featureSet, version,
 * status: draft | sellable }`, so its slug is its `featureSet`. Both readers map
 * the field by this name, so the mapping is data in one list.
 */

/** @type {readonly ProductRegister[]} */
export const PRODUCT_REGISTERS = [
  { kind: 'app', register: 'catalog/apps.json' },
  { kind: 'extension', register: 'extensions/catalog/extensions.json' },
  // No script ships today. When one does, it gets a register of the same shape
  // (`slug` + `status`) and this row gains its path — and the derivation below
  // picks it up with no code change, which is the whole point of the list.
  { kind: 'script', register: null },
  { kind: 'bundle', register: 'catalog/bundles.json', slugField: 'featureSet' },
  // A service gains its register with the service kit (worker-set.mjs), and a
  // site gains one when a site register exists. Each is a one-line edit here.
  { kind: 'service', register: null },
  { kind: 'site', register: null },
];

/**
 * @typedef {'live' | 'preview'} ProductStatus
 *
 * The two values `tooling/ci/assert-catalog-contract.mjs` permits, restated here
 * because the bundle's purchasable gate is a predicate over them. A third
 * spelling is not a new state, it is a row no guard grades. A bundle row's
 * `draft | sellable` is its register's own vocabulary and is not one of these:
 * a bundle is never counted live (BUNDLE_KIND above).
 */

/** @type {readonly ProductStatus[]} */
export const PRODUCT_STATUSES = /** @type {const} */ (['live', 'preview']);

/**
 * 🔴 THE MINIMUM LIVE-PRODUCT COUNT THAT MAKES A BUNDLE AN OFFER AT ALL.
 *
 * TWO, and it is a NAMED CONSTANT rather than a literal in the derivation so
 * that the number can be asserted rather than read. One live product plus a
 * "bundle" is the same product at a different price, which is not a bundle; it
 * is a second SKU for one thing, and selling it as "everything we make" would be
 * a false statement on the day it was made.
 *
 * As of 2026-09-09 the count is 1 — catalog/apps.json has one `live` row and
 * extensions/catalog/extensions.json has one `preview` row — so the gate is
 * false FROM DATA. Flipping FullShot's status to `live` is what enables it.
 */
export const MIN_LIVE_PRODUCTS_FOR_BUNDLE = 2;

/** Machine-readable form, kept byte-identical to bundle.json by generate-bundle.mjs. */
export const BUNDLE_TABLE = {
  bundleSources: BUNDLE_SOURCES,
  productKinds: PRODUCT_KINDS,
  productRegisters: PRODUCT_REGISTERS,
  productStatuses: PRODUCT_STATUSES,
  minLiveProductsForBundle: MIN_LIVE_PRODUCTS_FOR_BUNDLE,
};
