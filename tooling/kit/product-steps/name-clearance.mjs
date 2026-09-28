// product-steps/name-clearance.mjs — step 7: the app's name carries a clearance
// record with an owner ruling (NC, #923). Source: apps/<id>/name-clearance.json.
// No record is the agent's step (the probe dials the stores; the weekly sweep
// re-derives it). A record whose `trademark.ruling` is still null waits on the
// owner, and `assert-name-clearance.mjs --for-submission=<channel>` refuses it.
import { readAppYaml, readJsonAt } from './tree.mjs';

export const name = 'name clearance';
export const guard = 'node tooling/ci/assert-name-clearance.mjs';

export function read(root, id) {
  const rel = `apps/${id}/name-clearance.json`;
  const y = readAppYaml(root, id);
  const declared = y.ok && typeof y.doc?.name === 'string' ? y.doc.name : '<Name>';
  const r = readJsonAt(root, rel);
  if (!r.ok && r.missing) {
    return {
      state: 'NEXT',
      detail: `no ${rel}: nothing has asked whether "${declared}" is free on the channels this factory releases to`,
      command: `node tooling/store/name-clearance.mjs "${declared}" --app ${id} --execute`,
      guard,
    };
  }
  if (!r.ok) return { lost: r.why };
  const ruling = r.value?.trademark?.ruling ?? null;
  if (ruling === null) {
    const item = r.value?.trademark?.ownerItem;
    return {
      state: 'OWNER',
      detail: `${rel} carries no trademark ruling${item ? ` (held on ${item})` : ''}`,
      owner: "the owner's trademark ruling: PROCEED or DO-NOT-PROCEED, with ruledBy, ruledOn and basis",
      guard: `${guard} --for-submission=<channel>`,
    };
  }
  return { state: 'DONE', detail: `${rel} asOf ${r.value?.asOf}, ruling ${ruling}`, guard };
}
