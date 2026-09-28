// ─────────────────────────────────────────────────────────────────────────────
// THE WORKER READER of catalog/*.json — the twin, for a runtime with no
// filesystem, of tooling/catalog/read.mjs.
//
// O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST. New Worker code reads the catalogue
// through this module; the JSON is imported as a module and inlined by esbuild
// at deploy time, as src/config.ts already does for catalog/apps.json. The
// existing direct importers are not migrated in one sweep:
// tooling/ci/assert-bundle-availability.mjs limb G counts them against a floor
// that only falls.
//
// ⚠️ NOTHING UNDER src/lib/ MAY IMPORT src/config.ts (lib/mor/store.ts says why:
// bare node refuses config.ts's JSON imports), so this module imports only JSON.
// ─────────────────────────────────────────────────────────────────────────────
import bundlesJson from '../../../../catalog/bundles.json';
import appsJson from '../../../../catalog/apps.json';

/** The bundle register's path, as `feature_sets.minted_from` records it. */
export const BUNDLES_REGISTER = 'catalog/bundles.json';

/** A bundle register row, declared as the MINIMUM a reader reads. */
export interface BundleRegisterRow {
  readonly featureSet?: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly members?: unknown;
  readonly priceIds?: unknown;
  readonly storeProductIds?: unknown;
}

/** Every bundle row in the register. A non-object row is dropped. */
export const BUNDLE_ROWS: readonly BundleRegisterRow[] = (Array.isArray(bundlesJson) ? (bundlesJson as unknown[]) : [])
  .filter((r): r is BundleRegisterRow => r !== null && typeof r === 'object');

/**
 * The register's `status` for one feature-set version, or null when the
 * register carries no row for that `(featureSet, version)` or the row names no
 * string status. `rows` is a parameter so a test can hand in a register; the
 * request path never passes it.
 */
export function bundleVersionStatus(
  featureSet: string,
  version: number,
  rows: readonly BundleRegisterRow[] = BUNDLE_ROWS,
): string | null {
  const row = rows.find((r) => r.featureSet === featureSet && r.version === version);
  return row !== undefined && typeof row.status === 'string' ? row.status : null;
}

/** An app row of catalog/apps.json, declared as the MINIMUM a reader reads. */
export interface CatalogueAppRow {
  readonly slug: string;
  readonly name?: string;
  readonly url?: string;
}

/** Every app row in the catalogue. A row without a string slug is dropped. */
export const APP_ROWS: readonly CatalogueAppRow[] = (Array.isArray(appsJson) ? (appsJson as unknown[]) : []).filter(
  (r): r is CatalogueAppRow =>
    r !== null && typeof r === 'object' && typeof (r as { slug?: unknown }).slug === 'string',
);

/** The catalogue row for `slug`, or undefined when the catalogue has none. */
export function catalogueApp(slug: string): CatalogueAppRow | undefined {
  return APP_ROWS.find((a) => a.slug === slug);
}
