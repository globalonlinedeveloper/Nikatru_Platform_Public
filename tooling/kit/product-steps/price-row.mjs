// product-steps/price-row.mjs — step 9: every offering the app serves has its
// price-book entry (D-c). Source: services/platform/src/app-config-data.json —
// the served offerings under `apps.<id>.paywall.offerings`, and the price book
// under `prices.apps.<id>.<product_id>`. This is render-rail-prices.mjs limb A
// (JOIN) read for one app. An app that serves no offering owes no entry. What
// the stores accept is the owner's O-B3, from the store sheet the detail names.
import { readJsonAt } from './tree.mjs';

export const name = 'price row';
export const guard = 'node tooling/catalog/render-rail-prices.mjs --check';
export const REGISTER_REL = 'services/platform/src/app-config-data.json';

export function read(root, id) {
  const r = readJsonAt(root, REGISTER_REL);
  if (!r.ok) return { lost: `${r.why}, so neither the served offerings nor the price book can be read` };
  const offerings = r.value?.apps?.[id]?.paywall?.offerings ?? [];
  if (!Array.isArray(offerings)) return { lost: `${REGISTER_REL} apps.${id}.paywall.offerings is not an array` };
  if (offerings.length === 0) {
    return { state: 'DONE', detail: `serves no offering (${REGISTER_REL} apps.${id}), so no price-book entry is owed`, guard };
  }
  const book = r.value?.prices?.apps?.[id] ?? {};
  const missing = offerings.map((o) => o?.product_id).filter((p) => !(typeof p === 'string' && book[p] && typeof book[p] === 'object'));
  if (missing.length) {
    return {
      state: 'NEXT',
      detail: `served offering(s) with no prices.apps.${id} entry: ${missing.join(', ')}`,
      command: `write prices.apps.${id}.<product_id> in ${REGISTER_REL}, then: node tooling/catalog/render-rail-prices.mjs`,
      guard,
    };
  }
  return {
    state: 'DONE',
    detail: `${offerings.length} offering(s), each priced; the stores' sheet (O-B3): node tooling/catalog/render-rail-prices.mjs --store-sheet ${id}`,
    guard,
  };
}
