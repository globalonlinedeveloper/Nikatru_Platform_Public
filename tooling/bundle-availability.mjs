// ─────────────────────────────────────────────────────────────────────────────
// tooling/bundle-availability.mjs — THE ONE DERIVATION of whether the Nikatru
// bundle is visible, purchasable and steerable. A LIBRARY: it computes and
// returns, it never prints and never exits.
//
// 🔴 THERE IS NO `bundlePurchasable` FLAG ANYWHERE IN THIS TREE, AND THERE MAY
// NOT BE. The answer is computed from registers that already exist and are
// already graded by other guards:
//
//   liveProducts    = catalog/apps.json[status==='live'].slug
//                   ∪ extensions/catalog/extensions.json[status==='live'].slug
//   visible         = catalog/bundles.json declares a feature set at all
//   purchasable     = liveProducts.length >= MIN_LIVE_PRODUCTS_FOR_BUNDLE (2)
//                     AND members(featureSet@version) ⊆ liveProducts
//                     AND the feature set resolves to ≥1 price id on the
//                         channel's rail
//   steerable       = the channel's purchaseRail.rail === 'paddle'
//                     AND anti-steering does not bind that channel
//
// WHY DERIVED RATHER THAN DECLARED. A boolean in a file is one careless edit away
// from advertising a subscription that cannot be delivered — which is a store
// rejection cause, not a cosmetic slip. A derivation cannot be flipped by a
// stray string: to make the bundle purchasable you must make a second product
// LIVE, which is a change to the catalogue that four other guards already read.
//
// ⚠️ VISIBLE ≠ PURCHASABLE ≠ STEERABLE — three independent booleans, and
// collapsing any two is the failure mode the store-policy research is still open
// on. The pessimistic anti-steering outcome (no mention of an external bundle
// inside a store build) is `visible:false, steerable:false` on that channel; the
// permissive one (a US external-link entitlement) is `visible:true,
// steerable:true`. SAME CODE, DIFFERENT REGISTER ROW — so the architecture does
// not depend on which way the research lands.
//
// ⚠️ AND `universalUnlock` IS WHY NONE OF THIS BLOCKS DELIVERY. A web-bought
// bundle unlocks on every channel by login, store rails included ([ADR 039] D2).
// The bundle is deliverable everywhere on day one even if it is sellable nowhere
// in-store. `steerable` is about what a BUILD may say, never about what a user
// may own.
//
// The Worker carries a twin of this derivation at
// services/platform/src/lib/bundle/availability.ts — it cannot import a
// repo-relative .mjs from inside a bundled Worker. The two are held equal by
// tooling/ci/assert-bundle-availability.mjs, on the model of limb 4 of
// assert-entitlement-contract.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_KIND, MIN_LIVE_PRODUCTS_FOR_BUNDLE, PRODUCT_REGISTERS } from '../contracts/entitlement/bundle.js';

export const BUNDLES_REGISTER = 'catalog/bundles.json';
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
/** Where each browser tool declares its contract, `tool.json`, one directory per tool. */
export const EXTENSION_TOOLS_DIR = 'extensions/Extension';
/** The served config; its `sharedApiBaseUrl` host is where an entitlement is read. */
export const PLATFORM_CONFIG = 'services/platform/src/app-config-data.json';

/** @typedef {{ slug: string, kind: string, status: string, register: string }} LiveProduct */

function readJson(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return { ok: false, value: null, why: `${rel} does not exist` };
  try {
    return { ok: true, value: JSON.parse(readFileSync(p, 'utf8')), why: null };
  } catch (e) {
    return { ok: false, value: null, why: `${rel} is not valid JSON (${e.message})` };
  }
}

/**
 * Every product this factory publishes, from EVERY register a product kind can
 * live in — read from `PRODUCT_REGISTERS` in the contract rather than from a
 * hand-written list here, so adding a category is a data change in one file.
 *
 * 🔴 A MISSING OR UNPARSEABLE REGISTER IS `ok: false`, NEVER AN EMPTY SET. An
 * empty set makes `purchasable` false, which LOOKS like the correct
 * conservative answer and is in fact the derivation having stopped reading. The
 * caller has to be able to tell those apart: one is "not yet", the other is
 * "this guard is dark".
 *
 * @param {string} root repo root
 */
export function readProducts(root) {
  const products = [];
  const problems = [];
  let registersRead = 0;
  for (const { kind, register, slugField } of PRODUCT_REGISTERS) {
    // A declared category with no register yet is not a failure — it is the
    // recorded fact that nothing of that kind ships. `script` is that today.
    if (register === null) continue;
    const r = readJson(root, register);
    if (!r.ok) {
      problems.push(`${r.why} — the ${kind} register could not be read, so the live-product count is not a measurement.`);
      continue;
    }
    if (!Array.isArray(r.value)) {
      problems.push(`${register} is not a JSON array, so no ${kind} could be counted.`);
      continue;
    }
    registersRead += 1;
    // The bundle register's slug is its `featureSet`: PRODUCT_REGISTERS names
    // the field, so the mapping is data in the contract and not a branch here.
    const field = slugField ?? 'slug';
    for (const row of r.value) {
      if (row === null || typeof row !== 'object') continue;
      if (typeof row[field] !== 'string' || typeof row.status !== 'string') {
        problems.push(`${register} carries a row with no ${field}/status pair; a product with no status cannot be counted either way.`);
        continue;
      }
      products.push({ slug: row[field], kind, status: row.status, register });
    }
  }
  if (registersRead === 0) {
    problems.push('no product register could be read at all — every derivation below would be over an empty set.');
  }
  return { products, problems };
}

/**
 * The slugs that are actually LIVE. `preview` is not live; a third spelling is not live either.
 *
 * 🔴 A BUNDLE IS NEVER COUNTED, BY KIND. A bundle is a product made of products,
 * and the floor this count feeds decides whether a bundle may be sold, so a
 * bundle that counted would count toward itself. Excluded by BUNDLE_KIND, not by
 * the accident that its register spells `draft | sellable` and never `live`.
 */
export function liveSlugs(products) {
  return products.filter((p) => p.status === 'live' && p.kind !== BUNDLE_KIND).map((p) => p.slug);
}

/**
 * The channel's purchase rail, read from the register that owns the decision.
 * Returns null for an unknown channel — which is refused rather than defaulted,
 * because a default here would invent a rail for a channel nobody decided.
 */
export function railForChannel(register, channelId) {
  const rows = Array.isArray(register?.channels) ? register.channels : [];
  const row = rows.find((c) => c?.id === channelId);
  if (row === undefined) return null;
  return {
    rail: row?.purchaseRail?.rail ?? null,
    forbids: Array.isArray(row?.purchaseRail?.forbids) ? row.purchaseRail.forbids : [],
  };
}

/**
 * Derive the three booleans for one channel, for EVERY bundle in the register.
 *
 * 🔴 EVERY ROW, KEYED BY ITS featureSet. Until 2026-09-26 this read
 * `bundles.length > 0 ? bundles[0] : null`, so a second bundle row was silently
 * ignored and the twin-equality guard stayed green over it
 * (O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST). Each verdict keeps the shape the
 * single verdict had; a caller reads the one it means by `featureSet`.
 *
 * @param {string} root repo root
 * @param {{ channel?: string }} [opts] the channel to answer for; defaults to `web`,
 *   the only channel that is `served: true` today.
 * @returns {{ byFeatureSet: Map<string, ReturnType<typeof verdictFor>>, problems: string[] }}
 *   `problems` non-empty = the derivation could not read something it needed.
 *   Every verdict carries the SAME `problems` array.
 */
export function bundleAvailability(root, opts = {}) {
  const channel = opts.channel ?? 'web';
  const problems = [];

  const { products, problems: productProblems } = readProducts(root);
  problems.push(...productProblems);
  const live = liveSlugs(products);

  const bundlesRead = readJson(root, BUNDLES_REGISTER);
  if (!bundlesRead.ok) problems.push(bundlesRead.why);
  const bundles = Array.isArray(bundlesRead.value) ? bundlesRead.value : [];
  if (bundlesRead.ok && !Array.isArray(bundlesRead.value)) {
    problems.push(`${BUNDLES_REGISTER} is not a JSON array; every reader iterates one.`);
  }

  const channelRead = readJson(root, CHANNEL_REGISTER);
  if (!channelRead.ok) problems.push(channelRead.why);
  const railRow = channelRead.ok ? railForChannel(channelRead.value, channel) : null;
  if (channelRead.ok && railRow === null) {
    problems.push(`${CHANNEL_REGISTER} declares no channel '${channel}', so its rail is unknown — and an unknown rail is refused, never defaulted.`);
  }

  const byFeatureSet = new Map();
  for (const [i, bundle] of bundles.entries()) {
    const featureSet =
      bundle !== null && typeof bundle === 'object' && typeof bundle.featureSet === 'string' && bundle.featureSet.length > 0
        ? bundle.featureSet
        : null;
    if (featureSet === null) {
      problems.push(`${BUNDLES_REGISTER} row ${i} declares no featureSet, so it can be neither shown nor sold.`);
      continue;
    }
    if (byFeatureSet.has(featureSet)) {
      problems.push(
        `${BUNDLES_REGISTER} carries featureSet \`${featureSet}\` twice. One row per feature set: a version is bumped in ` +
          'place, and the lock keeps every minted version.',
      );
      continue;
    }
    byFeatureSet.set(featureSet, verdictFor(bundle, { channel, live, railRow, problems }));
  }
  return { byFeatureSet, problems };
}

/**
 * The per-bundle verdict — the shape `bundleAvailability` returned for its one
 * bundle before it returned every bundle.
 */
function verdictFor(bundle, { channel, live, railRow, problems }) {
  // ── visible ────────────────────────────────────────────────────────────────
  // A declared feature set is a thing we can name on a page. It is deliberately
  // NOT conditional on being sellable: "Coming soon" with no price and no
  // checkout control is an honest statement, and it is the whole point of
  // splitting these three booleans.
  const visible = bundle !== null && typeof bundle.featureSet === 'string' && bundle.featureSet.length > 0;

  // ── purchasable ────────────────────────────────────────────────────────────
  const members = Array.isArray(bundle?.members) ? bundle.members : [];
  const memberSlugs = members.map((m) => m?.slug).filter((s) => typeof s === 'string');
  const enoughLive = live.length >= MIN_LIVE_PRODUCTS_FOR_BUNDLE;
  const missingMembers = memberSlugs.filter((s) => !live.includes(s));
  const membersAllLive = memberSlugs.length > 0 && missingMembers.length === 0;

  // A price id is an opaque rail handle. `null` is the honest empty state and
  // reads as NOT purchasable — a bundle with no price cannot be bought, and a
  // page that rendered a Buy control over a null handle would send the first
  // buyer to a 404.
  const railName = railRow?.rail ?? null;
  const priceIds = bundle?.priceIds?.[railName ?? ''] ?? null;
  const resolvedPriceIds =
    priceIds === null || typeof priceIds !== 'object'
      ? []
      : Object.entries(priceIds)
          .filter(([k]) => !k.startsWith('_'))
          .map(([, v]) => v)
          .filter((v) => typeof v === 'string' && v.length > 0);
  const priced = resolvedPriceIds.length > 0;

  const purchasable = visible && enoughLive && membersAllLive && priced;

  // ── steerable ──────────────────────────────────────────────────────────────
  // The register is the authority, not the app. `paddle` is the only rail that
  // can sell a cross-product bundle at all — the store rails sell per-app SKUs —
  // and once a store IAP rail is offered on a channel that build performs NO
  // in-app steering ([ADR 039] D2/D3). Both halves are read from the register.
  const railIsPaddle = railName === 'paddle';
  const storeRailOffered = railName === 'play-billing' || railName === 'apple-iap';
  const steerable = railIsPaddle && !storeRailOffered;

  return {
    channel,
    visible,
    purchasable,
    steerable,
    // The evidence, so a caller can say WHY rather than just what. A boolean with
    // no reasons is a boolean nobody can argue with.
    why: {
      liveProducts: live,
      liveProductCount: live.length,
      minLiveProducts: MIN_LIVE_PRODUCTS_FOR_BUNDLE,
      enoughLive,
      featureSet: bundle?.featureSet ?? null,
      version: bundle?.version ?? null,
      members: memberSlugs,
      missingMembers,
      membersAllLive,
      rail: railName,
      priced,
      priceIdCount: resolvedPriceIds.length,
    },
    /** Non-empty = the derivation could not read something it needed. NEVER the same as `false`. */
    problems,
  };
}

/**
 * ⏱ 2026-09-29 · EXM-05. CAN EACH MEMBER READ ITS ENTITLEMENT? A bundle sold with a
 * member that cannot ask whether its buyer owns it delivers nothing for that member,
 * and nothing above noticed: `purchasable` counts a member live from its catalogue
 * status alone.
 *
 * An APP reads its entitlement through the platform client the chassis ships in every
 * build, so an app member is readable by construction and is not listed. An EXTENSION
 * declares every host it may reach in its tool.json `policy.networkAllowlist`; one whose
 * allowlist does not name the entitlement host (the host of `sharedApiBaseUrl` in
 * PLATFORM_CONFIG) cannot make the call, and is returned in `unreadable` with the reason.
 *
 * NOT A CONJUNCT OF `purchasable`, on purpose: the Worker twin cannot read a tool.json,
 * and a conjunct one copy has and the other lacks is the drift limb E exists to refuse.
 * tooling/ci/assert-bundle-availability.mjs limb I fails the TREE instead — a live
 * member in `unreadable` is exit 1 — so the state can never merge, and neither
 * derivation ever meets it.
 *
 * 🔴 A MEMBER WHOSE tool.json CANNOT BE FOUND OR READ IS A PROBLEM, NEVER READABLE.
 *
 * @param {string} root repo root
 * @param {unknown[]} members a bundle row's `members`
 * @returns {{ entitlementHost: string | null, extensionsRead: number, unreadable: { slug: string, why: string }[], problems: string[] }}
 */
export function memberEntitlementReach(root, members) {
  const problems = [];
  const unreadable = [];
  let entitlementHost = null;
  const cfg = readJson(root, PLATFORM_CONFIG);
  if (!cfg.ok) problems.push(`${cfg.why} — the entitlement host cannot be named.`);
  else {
    try {
      entitlementHost = new URL(cfg.value?.sharedApiBaseUrl).hostname;
    } catch {
      problems.push(`${PLATFORM_CONFIG} sharedApiBaseUrl is ${JSON.stringify(cfg.value?.sharedApiBaseUrl)}, not a URL — the entitlement host cannot be named.`);
    }
  }
  const extensionSlugs = (Array.isArray(members) ? members : [])
    .filter((m) => m?.kind === 'extension' && typeof m?.slug === 'string')
    .map((m) => m.slug);
  const tools = new Map();
  if (extensionSlugs.length > 0) {
    const dir = join(root, EXTENSION_TOOLS_DIR);
    const dirs = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
    for (const d of dirs) {
      const rel = `${EXTENSION_TOOLS_DIR}/${d.name}/tool.json`;
      const r = readJson(root, rel);
      if (r.ok && typeof r.value?.id === 'string') tools.set(r.value.id, { rel, tool: r.value });
    }
  }
  let extensionsRead = 0;
  for (const slug of extensionSlugs) {
    const hit = tools.get(slug);
    if (hit === undefined) {
      problems.push(`no ${EXTENSION_TOOLS_DIR}/*/tool.json declares id "${slug}", so whether that member can read its entitlement is unknown.`);
      continue;
    }
    extensionsRead += 1;
    const allow = hit.tool?.policy?.networkAllowlist;
    if (!Array.isArray(allow)) {
      problems.push(`${hit.rel} declares no policy.networkAllowlist array, so its reach is unknown.`);
    } else if (entitlementHost !== null && !allow.includes(entitlementHost)) {
      unreadable.push({
        slug,
        why:
          `${hit.rel} policy.networkAllowlist is ${JSON.stringify(allow)} and does not name ${entitlementHost}, the host ` +
          'an entitlement is read from — so the extension cannot ask whether its buyer owns the bundle.',
      });
    }
  }
  return { entitlementHost, extensionsRead, unreadable, problems };
}
