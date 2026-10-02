// ─────────────────────────────────────────────────────────────────────────────
// tooling/catalog/read.mjs — THE NODE READER of catalog/*.json. A LIBRARY: it
// reads and returns, it never prints and never exits.
//
// O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST. catalog/apps.json alone had 88 direct
// readers at 19b252af, each with its own path string, its own parse and its own
// idea of what a missing file means. NEW CODE reads the catalogue through this
// file (Node) or services/platform/src/lib/catalog.ts (the Worker, which has no
// filesystem and imports the JSON as a module). The existing readers are not
// migrated in one sweep: tooling/ci/assert-bundle-availability.mjs limb G counts
// them against tooling/catalog/reader-floor.json, a floor that only falls.
//
// 🔴 A MISSING OR UNPARSEABLE FILE IS `ok: false`, NEVER AN EMPTY LIST. An empty
// list reads as "no products", which is a real answer; a file that could not be
// read is a reader that stopped reading, and the caller must be able to tell the
// two apart.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The catalogue directory, repo-relative. */
export const CATALOG_DIR = 'catalog';
/** The product register: one row per app, `{ slug, … }`. */
export const APPS_REGISTER = 'catalog/apps.json';
/** The bundle register: one row per feature set, `{ featureSet, version, status, members }`. */
export const BUNDLES_REGISTER = 'catalog/bundles.json';
/** The minted-membership lock: `featureSet@version` → the sorted member slugs, append-only. */
export const BUNDLE_LOCK = 'catalog/bundle-membership.lock.json';

/**
 * Read one catalogue file as JSON.
 * @param {string} root repo root
 * @param {string} rel repo-relative path under catalog/
 * @returns {{ ok: true, value: unknown, why: null } | { ok: false, value: null, why: string }}
 */
export function readCatalogFile(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return { ok: false, value: null, why: `${rel} does not exist` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(p, 'utf8')), why: null };
  } catch (e) {
    return { ok: false, value: null, why: `${rel} is not valid JSON (${e.message})` };
  }
}

/**
 * The first words of the `why` a STAMP writes when it excludes a new product
 * from every bundle row (rv2-newproduct-011). A stamped product is in the
 * catalogue the moment it is stamped, and limb F of
 * tooling/ci/assert-bundle-availability.mjs requires every catalogue product to
 * be a member or excluded BY NAME — so the stamp must say which, or the first
 * commit of app #2 is red. It cannot be a member: a member is locked into a
 * feature-set version (limb H), and a new version names only live members. So
 * it is excluded, with a why that says it is the stamp's placeholder and not a
 * decision. Limb F refuses the placeholder on a product that has gone LIVE, and
 * tooling/kit/product-steps/bundle-join.mjs reads it as the step still to do.
 */
export const STAMPED_EXCLUSION_MARK = 'STAMPED, NOT LIVE YET:';

/** The `why` the stamp writes for `slug`; it starts with STAMPED_EXCLUSION_MARK. */
export const stampedExclusionWhy = (slug) =>
  `${STAMPED_EXCLUSION_MARK} \`${slug}\` was stamped and has not gone live. A version's members are locked and a new ` +
  'version names only live members, so it joins the bundle once live, in a new featureSet version (new-product step 12, ' +
  'bundle join) — or this line is replaced by the reason it stays out.';

/** True when an `excluded` entry's `why` is the stamp's placeholder, not a decision. */
export const isStampedExclusion = (entry) =>
  typeof entry?.why === 'string' && entry.why.startsWith(STAMPED_EXCLUSION_MARK);

/** The lock key of one feature-set version. */
export const bundleKey = (featureSet, version) => `${featureSet}@${version}`;

/**
 * The member slugs a bundle row names, in register order. A member with no
 * string slug is dropped here and graded by the guard that reads the row.
 * @param {unknown} row
 * @returns {string[]}
 */
export function memberSlugsOf(row) {
  const members = row !== null && typeof row === 'object' ? /** @type {{members?: unknown}} */ (row).members : null;
  return (Array.isArray(members) ? members : [])
    .map((m) => (m !== null && typeof m === 'object' ? m.slug : null))
    .filter((s) => typeof s === 'string' && s.length > 0);
}

/**
 * Every bundle row, or why the register could not be read.
 * @param {string} root repo root
 * @returns {{ ok: true, rows: object[], why: null } | { ok: false, rows: [], why: string }}
 */
export function readBundles(root) {
  const r = readCatalogFile(root, BUNDLES_REGISTER);
  if (!r.ok) return { ok: false, rows: [], why: r.why };
  if (!Array.isArray(r.value)) return { ok: false, rows: [], why: `${BUNDLES_REGISTER} is not a JSON array` };
  return { ok: true, rows: r.value.filter((row) => row !== null && typeof row === 'object'), why: null };
}

/**
 * The minted-membership lock, as a plain object of `key → string[]`.
 * `_`-prefixed keys are documentation and are dropped.
 * @param {string} root repo root
 * @returns {{ ok: true, entries: Record<string, string[]>, why: null } | { ok: false, entries: {}, why: string }}
 */
export function readBundleLock(root) {
  const r = readCatalogFile(root, BUNDLE_LOCK);
  if (!r.ok) return { ok: false, entries: {}, why: r.why };
  return lockEntriesOf(r.value, BUNDLE_LOCK);
}

/**
 * The lock entries of an already-parsed lock document — the same projection for
 * the tree's lock and for a base branch's copy of it.
 * @param {unknown} doc
 * @param {string} label where the document came from, for the `why`
 */
export function lockEntriesOf(doc, label) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, entries: {}, why: `${label} is not a JSON object of featureSet@version → members` };
  }
  /** @type {Record<string, string[]>} */
  const entries = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('_')) continue;
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
      return { ok: false, entries: {}, why: `${label} entry \`${k}\` is not an array of member slugs` };
    }
    entries[k] = v;
  }
  return { ok: true, entries, why: null };
}
