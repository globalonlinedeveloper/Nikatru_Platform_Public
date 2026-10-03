// product-steps/price-row.mjs — step 9: every offering the app serves has its
// price-book entry (D-c). Source: services/platform/src/app-config-data.json —
// the served offerings under `apps.<id>.paywall.offerings`, and the price book
// under `prices.apps.<id>.<product_id>`. This is render-rail-prices.mjs limb A
// (JOIN) read for one app. An app that DECLARES no offering owes no entry. What
// the stores accept is the owner's O-B3, from the store sheet the detail names.
//
// 🔴 AN ABSENT `apps.<id>` ROW IS NEXT, NEVER "FREE" (rv2-newproduct-002). The
// served document overlays `defaults` for an app with no row, and `defaults`
// serves no offering, so an absent row and a declared free app look the same
// on the wire. They are not the same fact: nothing writes `apps.<id>.paywall`
// (the stamp does not), so the undeclared paywall is every fresh stamp and every
// id that exists nowhere, and reading it as DONE printed "no price-book entry is owed" for a
// product whose price nobody has decided. Free is a declaration —
// `apps.<id>.paywall.offerings: []` — and only a declaration is DONE.
// ⏱ 2026-10-02 · the stamp now DOES write `apps.<id>`, with its `update_url`
// alone (tooling/kit/snap-update-row.mjs, [10]D-8), so a row with no `paywall`
// key is read exactly as an absent one: it declares nothing about the price.
import { readJsonAt } from './tree.mjs';

export const name = 'price row';
export const guard = 'node tooling/catalog/render-rail-prices.mjs --check';
export const REGISTER_REL = 'services/platform/src/app-config-data.json';

export function read(root, id) {
  const r = readJsonAt(root, REGISTER_REL);
  if (!r.ok) return { lost: `${r.why}, so neither the served offerings nor the price book can be read` };
  const row = r.value?.apps?.[id];
  const declared = row !== undefined && row !== null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'paywall');
  if (!declared) {
    return {
      state: 'NEXT',
      detail:
        row === undefined || row === null
          ? `${REGISTER_REL} has no apps.${id} row: it would be served the defaults, and whether it is free or sold is undecided`
          : `${REGISTER_REL} apps.${id} declares no \`paywall\`: it would be served the defaults, and whether it is free or sold is undecided`,
      command: `write apps.${id} (features, paywall) in ${REGISTER_REL} — \`"paywall": {"enabled": false, "offerings": []}\` declares it free; ` +
        `each offering it sells also needs prices.apps.${id}.<product_id>, then: node tooling/catalog/render-rail-prices.mjs`,
      guard,
    };
  }
  // ⏱ 2026-10-02 · A ROW IS NOT A PAYWALL DECISION. The stamp now writes `apps.<id>`
  // itself — only `update_url.linux-snap`, the Snap Store page [10]D-8 requires
  // (tooling/kit/stamp-shared.mjs planSnapUpdateUrls) — so a row that declares no
  // `paywall.offerings` is still the undecided price above, never "free".
  if (!Array.isArray(row?.paywall?.offerings)) {
    if (row?.paywall?.offerings !== undefined) return { lost: `${REGISTER_REL} apps.${id}.paywall.offerings is not an array` };
    return {
      state: 'NEXT',
      detail: `${REGISTER_REL} apps.${id} declares no paywall.offerings: whether it is free or sold is undecided`,
      command: `write apps.${id}.paywall in ${REGISTER_REL} — \`"paywall": {"enabled": false, "offerings": []}\` declares it free; ` +
        `each offering it sells also needs prices.apps.${id}.<product_id>, then: node tooling/catalog/render-rail-prices.mjs`,
      guard,
    };
  }
  const offerings = row.paywall.offerings;
  if (offerings.length === 0) {
    return { state: 'DONE', detail: `declares no offering (${REGISTER_REL} apps.${id}), so no price-book entry is owed`, guard };
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
