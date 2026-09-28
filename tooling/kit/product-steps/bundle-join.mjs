// product-steps/bundle-join.mjs — step 12: the product joins the bundle (D-a,
// H-S12). Source: the app's catalog/apps.json `status`. The bundle's membership
// is derived from the LIVE products (tooling/bundle-availability.mjs), so a
// product that is not live yet waits on going live, and nothing here is a
// finding: AFTER-LIVE. Live, the derivation counts it.
import { catalogRowOf } from './tree.mjs';

export const name = 'bundle join';
export const guard = 'node tooling/ci/assert-bundle-availability.mjs';

export function read(root, id) {
  const c = catalogRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) return { state: 'AFTER-LIVE', detail: 'no catalogue row yet; the bundle counts a product once it is live', guard };
  if (c.row.status === 'live') {
    return { state: 'DONE', detail: 'catalog status live: tooling/bundle-availability.mjs counts it among the bundle\'s products', guard };
  }
  return { state: 'AFTER-LIVE', detail: `catalog status ${c.row.status}: the bundle counts a product once it is live`, guard };
}
