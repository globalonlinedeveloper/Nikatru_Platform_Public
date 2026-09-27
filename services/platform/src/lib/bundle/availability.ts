// ─────────────────────────────────────────────────────────────────────────────
// The Worker's TWIN of tooling/bundle-availability.mjs.
//
// 🔴 WHY A TWIN AND NOT AN IMPORT. The site generators run under node and read
// the repo from disk; the Worker has no filesystem and its bundle is built by
// esbuild at deploy time. A Worker cannot `readFileSync` a register, so the
// registers are imported as MODULES and inlined into the bundle — the same
// mechanism `src/config.ts` already uses for `catalog/apps.json`. That means two
// copies of one derivation, which is exactly the drift this repo has paid for
// before, so the two are held equal by tooling/ci/assert-bundle-availability.mjs
// on the model of limb 4 of assert-entitlement-contract.mjs: the guard runs BOTH
// implementations over the SAME registers and over a FIXTURE with a second live
// product, and requires the same answer in both directions.
//
// 🔴 THE CONSTANTS ARE IMPORTED, NOT RETYPED. `MIN_LIVE_PRODUCTS_FOR_BUNDLE` and
// `PRODUCT_REGISTERS` come from contracts/entitlement/bundle.js — the same file
// the .mjs derivation imports — so the one number that decides whether a bundle
// is an offer at all exists once. A literal `2` in this file would be a second
// place to change and the place nobody would remember.
//
// WHAT THIS FILE MAY NOT CONTAIN: a boolean literal assigned to `purchasable`.
// The gate is derived or it is not a gate. The guard greps for exactly that.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BUNDLE_KIND,
  MIN_LIVE_PRODUCTS_FOR_BUNDLE,
  PRODUCT_REGISTERS,
} from '../../../../../contracts/entitlement/bundle.js';
import appsJson from '../../../../../catalog/apps.json';
import extensionsJson from '../../../../../extensions/catalog/extensions.json';
import channelRegisterJson from '../../../../../tooling/channel-register.json';
import { BUNDLES_REGISTER, BUNDLE_ROWS, type BundleRegisterRow } from '../catalog';

/** A register row, declared as the MINIMUM this module reads. */
type ProductRow = Record<string, unknown>;

type BundleRow = BundleRegisterRow;

export interface BundleAvailability {
  readonly channel: string;
  readonly visible: boolean;
  readonly purchasable: boolean;
  readonly steerable: boolean;
  readonly featureSet: string | null;
  readonly version: number | null;
  readonly members: readonly string[];
  readonly liveProducts: readonly string[];
  readonly rail: string | null;
}

/**
 * The registers, keyed by the path `PRODUCT_REGISTERS` names — so the twin reads
 * the SAME list the .mjs derivation reads rather than a second hand-written one.
 * A kind whose register is `null` (no `script` ships today) contributes nothing.
 */
const REGISTER_MODULES: Record<string, unknown> = {
  'catalog/apps.json': appsJson,
  'extensions/catalog/extensions.json': extensionsJson,
  // The bundle register is read through src/lib/catalog.ts, the Worker's one
  // catalogue reader, rather than a second import of the same file here.
  [BUNDLES_REGISTER]: BUNDLE_ROWS,
};

/** One register row, as every product register spells it. */
export interface RegisterProduct {
  readonly slug: string;
  readonly kind: string;
  readonly status: string;
}

/**
 * Every product row from every register `PRODUCT_REGISTERS` names.
 *
 * EXPORTED because it is the one reader of the product registers inside the
 * Worker: src/config.ts builds the known-PRODUCT set from it, so the set that
 * gates `/v1/entitlements?app_id=` and the set this derivation counts live
 * products over are the same rows read once. A second reader would be the
 * drift this file's header warns about, one file over.
 */
export function productsFromRegisters(): RegisterProduct[] {
  const out: RegisterProduct[] = [];
  for (const entry of PRODUCT_REGISTERS) {
    if (entry.register === null) continue;
    const mod = REGISTER_MODULES[entry.register];
    if (!Array.isArray(mod)) continue;
    // The bundle register's slug is its `featureSet`: PRODUCT_REGISTERS names
    // the field, exactly as tooling/bundle-availability.mjs reads it.
    const field = entry.slugField ?? 'slug';
    for (const row of mod as ProductRow[]) {
      if (row === null || typeof row !== 'object') continue;
      const slug = row[field];
      if (typeof slug !== 'string' || typeof row.status !== 'string') continue;
      out.push({ slug, kind: entry.kind, status: row.status });
    }
  }
  return out;
}

/**
 * The slugs that are actually LIVE — the twin of tooling/bundle-availability.mjs
 * `liveSlugs`. 🔴 A BUNDLE IS NEVER COUNTED, BY KIND: the floor this count feeds
 * decides whether a bundle may be sold, so a bundle that counted would count
 * toward itself.
 */
export function liveSlugs(products: readonly RegisterProduct[]): string[] {
  return products.filter((p) => p.status === 'live' && p.kind !== BUNDLE_KIND).map((p) => p.slug);
}

function railForChannel(channelId: string): { rail: string | null } | null {
  const rows = (channelRegisterJson as { channels?: unknown }).channels;
  if (!Array.isArray(rows)) return null;
  const row = (rows as { id?: unknown; purchaseRail?: { rail?: unknown } }[]).find(
    (c) => c?.id === channelId,
  );
  if (row === undefined) return null;
  return { rail: typeof row.purchaseRail?.rail === 'string' ? row.purchaseRail.rail : null };
}

/**
 * Derive the three booleans for one channel, for EVERY bundle in the register,
 * keyed by `featureSet`. Defaults to `web`, the only channel that is
 * `served: true` today.
 *
 * 🔴 EVERY ROW. Until 2026-09-26 this read `bundles[0]` and a second bundle row
 * was silently ignored (O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST). Each verdict
 * keeps the shape the single verdict had; a caller reads it by `featureSet`.
 *
 * Every branch that cannot read a register answers `false` for `purchasable` —
 * which is the fail-closed direction on a gate whose wrong answer is advertising
 * a subscription that cannot be delivered.
 */
export function bundleAvailability(channel = 'web'): Map<string, BundleAvailability> {
  return availabilityFor(BUNDLE_ROWS, productsFromRegisters(), channel);
}

/**
 * The derivation over explicit rows — what `bundleAvailability` runs over the
 * committed registers, and what a test runs over a two-bundle fixture. A row
 * with no featureSet cannot be named or sold and is skipped; a featureSet seen
 * twice keeps its first row (tooling/bundle-availability.mjs reports the second
 * as a problem, and CI refuses the register).
 */
export function availabilityFor(
  rows: readonly BundleRow[],
  products: readonly RegisterProduct[],
  channel = 'web',
): Map<string, BundleAvailability> {
  const liveProducts = liveSlugs(products);
  const out = new Map<string, BundleAvailability>();
  for (const bundle of rows) {
    const verdict = verdictFor(bundle, liveProducts, channel);
    if (verdict.featureSet === null || out.has(verdict.featureSet)) continue;
    out.set(verdict.featureSet, verdict);
  }
  return out;
}

/** One bundle's verdict: the shape `bundleAvailability` returned before it returned every bundle. */
function verdictFor(bundle: BundleRow, liveProducts: string[], channel: string): BundleAvailability {
  const featureSet = typeof bundle?.featureSet === 'string' && bundle.featureSet.length > 0 ? bundle.featureSet : null;
  const version = typeof bundle?.version === 'number' ? bundle.version : null;
  const members = Array.isArray(bundle?.members)
    ? (bundle.members as { slug?: unknown }[])
        .map((m) => m?.slug)
        .filter((s): s is string => typeof s === 'string')
    : [];

  const railRow = railForChannel(channel);
  const rail = railRow?.rail ?? null;

  const priceIdsForRail =
    rail !== null && bundle?.priceIds !== null && typeof bundle?.priceIds === 'object'
      ? (bundle.priceIds as Record<string, unknown>)[rail]
      : null;
  const priceIdCount =
    priceIdsForRail === null || typeof priceIdsForRail !== 'object'
      ? 0
      : Object.entries(priceIdsForRail as Record<string, unknown>)
          .filter(([k]) => !k.startsWith('_'))
          .map(([, v]) => v)
          .filter((v) => typeof v === 'string' && v.length > 0).length;

  // The four conjuncts, each NAMED — the same four, under the same names, as
  // tooling/bundle-availability.mjs. assert-bundle-availability.mjs limb E
  // compares the two sets, so an inlined expression here is a real divergence
  // and not a style choice: it is how the edge and the site come to answer
  // differently about whether the same bundle can be bought.
  const visible = featureSet !== null;
  const enoughLive = liveProducts.length >= MIN_LIVE_PRODUCTS_FOR_BUNDLE;
  const membersAllLive = members.length > 0 && members.every((s) => liveProducts.includes(s));
  const priced = priceIdCount > 0;
  const purchasable = visible && enoughLive && membersAllLive && priced;

  const storeRailOffered = rail === 'play-billing' || rail === 'apple-iap';
  const steerable = rail === 'paddle' && !storeRailOffered;

  return { channel, visible, purchasable, steerable, featureSet, version, members, liveProducts, rail };
}

/**
 * The members of the feature set a grant PINNED, resolved from the register.
 *
 * 🔴 THIS IS NOT WHAT THE UNION READ USES FOR AN EXISTING GRANT, and the
 * distinction is [ADR 057] §4. A grant records `(feature_set_name,
 * feature_set_version)` and its members are resolved from the PINNED
 * `feature_set_members` rows in platform_db — never from this file — so editing
 * catalog/bundles.json can never silently change who owns what. This helper
 * exists for the FORWARD question only: "what would a grant minted today
 * contain", which is what checkout and the site need. Read by `featureSet`:
 * an unknown feature set has no members.
 */
export function draftMembers(featureSet: string): readonly string[] {
  return bundleAvailability().get(featureSet)?.members ?? [];
}

/**
 * Every channel id tooling/channel-register.json declares, read from the SAME
 * import `railForChannel` reads — src/config.ts gates `GET /config/<app>?channel=`
 * on it (O-UPDATE-FLOOR-HAS-NO-CHANNEL). Here rather than in a second import of
 * the register, so the rail lookup and this set read one import of one file.
 *
 * Every row counts, whatever its surface: the question the route asks is "is
 * this a channel id at all", and an id the register does not carry is refused
 * with a 400 before any I/O. A row with no string id is skipped, as
 * `railForChannel` skips it.
 */
export function channelIdsFromRegister(): string[] {
  const rows = (channelRegisterJson as { channels?: unknown }).channels;
  if (!Array.isArray(rows)) return [];
  return (rows as { id?: unknown }[])
    .map((c) => c?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
