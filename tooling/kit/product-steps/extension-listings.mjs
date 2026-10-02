// product-steps/extension-listings.mjs — extension step 3: every store the tool
// publishes to carries its listing URL (rv2-newproduct-014). Source: the tool's
// extensions/catalog/extensions.json row, `listings.<store>`. A listing is
// created in each store's console, so a null one is the owner's.
// extensions/scripts/check-catalog.mjs prints it as an OWNER ACTION, and its
// `--owner-actions-fatal` refuses it.
import { extensionRowOf, REGISTER_REL } from './extension-row.mjs';

export const name = 'store listings';
export const guard = 'node extensions/scripts/check-catalog.mjs --owner-actions-fatal';

export function read(root, id) {
  const c = extensionRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) return { state: 'NEXT', detail: 'no catalogue row yet, so no store to list on', command: 'the catalogue row step above', guard };
  const listings = c.row.listings;
  if (listings === null || typeof listings !== 'object' || Array.isArray(listings)) {
    return { lost: `${REGISTER_REL} "${id}" carries no listings object, so no store's listing can be read` };
  }
  const stores = Object.keys(listings).sort();
  const unlisted = stores.filter((s) => listings[s] === null);
  if (stores.length > 0 && unlisted.length === 0) return { state: 'DONE', detail: `listed on ${stores.join(', ')}`, guard };
  return {
    state: 'OWNER',
    detail: stores.length === 0 ? `${REGISTER_REL} "${id}" publishes to no store` : `no listing on ${unlisted.join(', ')}`,
    owner: "the owner's store listings — create each in its store console; the agent records each URL in the tool's tool.json",
    guard,
  };
}
