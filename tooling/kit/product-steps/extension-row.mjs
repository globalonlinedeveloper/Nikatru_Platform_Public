// product-steps/extension-row.mjs — extension step 2: the tool has its row in
// the published extension catalogue (rv2-newproduct-014). Source:
// extensions/catalog/extensions.json, the `extension` register PRODUCT_REGISTERS
// names, which extensions/scripts/publish-catalog.mjs derives from every
// extensions/Extension/<Tool>/tool.json. A tool with no row is the agent's:
// new-tool.mjs scaffolds it, publish-catalog.mjs writes the row.
import { readJsonAt } from './tree.mjs';

export const name = 'catalogue row';
export const guard = 'node extensions/scripts/publish-catalog.mjs --check';
export const REGISTER_REL = 'extensions/catalog/extensions.json';

/** The catalogue row for `id`, or null; `{ lost }` when the register cannot be read. */
export function extensionRowOf(root, id) {
  const r = readJsonAt(root, REGISTER_REL);
  if (!r.ok) return { lost: `${r.why}, so no extension's catalogue row can be read` };
  if (!Array.isArray(r.value)) return { lost: `${REGISTER_REL} is not a JSON array` };
  return { row: r.value.find((t) => t?.slug === id) ?? null };
}

export function read(root, id) {
  const c = extensionRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) {
    return {
      state: 'NEXT',
      detail: `${REGISTER_REL} has no "${id}" row`,
      command: `node extensions/scripts/new-tool.mjs --category Extension --name "<Name>" --id ${id} --tagline "<one sentence>", ` +
        'then: node extensions/scripts/publish-catalog.mjs',
      guard,
    };
  }
  return { state: 'DONE', detail: `${REGISTER_REL} carries "${id}" (status ${c.row.status})`, guard };
}
