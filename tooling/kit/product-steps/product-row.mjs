// product-steps/product-row.mjs — step 11: the product has its row in the private
// corpus's product list (14a). Source: <private root>/platform-state/manifest.json
// `products.list`. The corpus is its own repository beside this one and a CI
// runner never holds it, so with no private root this step is UNREAD: named, and
// neither a pass nor a finding (assert-store-bijection.mjs's "LIMB NOT RUN").
// With a private root and no manifest, it is COVERAGE LOST.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonAt } from './tree.mjs';

export const name = 'product row';
export const guard = 'the private corpus\'s assert-platform-state limb P (run from its hooks; no CI job can read it)';
export const MANIFEST_REL = 'platform-state/manifest.json';

export function read(root, id, { privateRoot = null, kind = 'app' } = {}) {
  if (privateRoot === null || !existsSync(privateRoot)) {
    return {
      state: 'UNREAD',
      detail: 'the private corpus is not beside this checkout, so its product list was not read; ' +
        'pass --private <path> from a machine that holds it',
      guard,
    };
  }
  const r = readJsonAt(privateRoot, MANIFEST_REL);
  if (!r.ok) return { lost: `${join(privateRoot, MANIFEST_REL)}: ${r.why}` };
  const list = r.value?.products?.list;
  if (!Array.isArray(list)) return { lost: `${MANIFEST_REL} holds no products.list array` };
  const row = list.find((p) => p?.id === id);
  if (row) return { state: 'DONE', detail: `${MANIFEST_REL} products.list carries "${id}" (${row.kind}, ${row.status})`, guard };
  return {
    state: 'NEXT',
    detail: `${MANIFEST_REL} products.list has no "${id}" row`,
    command: `add {"id": "${id}", "kind": "${kind}", "status": <its register status>, "firstPublish": {…}} to products.list in the private corpus's ${MANIFEST_REL}`,
    guard,
  };
}
