// product-steps/bundle-join.mjs — step 12 (an app's; an extension's last): the
// product joins the bundle (D-a, H-S12). Source: the product's `status` in its
// own register — catalog/apps.json for an app, extensions/catalog/extensions.json
// for an extension — read for an app through the app catalogue reader and for
// an extension through the extension row reader. The bundle's membership is
// derived from the LIVE products (tooling/bundle-availability.mjs), so a product
// that is not live yet waits on going live, and nothing here is a finding:
// AFTER-LIVE. Live, the derivation counts it.
import { extensionRowOf } from './extension-row.mjs';
import { catalogRowOf } from './tree.mjs';

export const name = 'bundle join';
export const guard = 'node tooling/ci/assert-bundle-availability.mjs';

export function read(root, id, { kind = 'app' } = {}) {
  const c = kind === 'extension' ? extensionRowOf(root, id) : catalogRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) return { state: 'AFTER-LIVE', detail: 'no catalogue row yet; the bundle counts a product once it is live', guard };
  if (c.row.status === 'live') {
    return { state: 'DONE', detail: 'catalog status live: tooling/bundle-availability.mjs counts it among the bundle\'s products', guard };
  }
  return { state: 'AFTER-LIVE', detail: `catalog status ${c.row.status}: the bundle counts a product once it is live`, guard };
}
