// product-steps/store-records.mjs — step 6: every store channel's per-app record
// is `issued` (family A, 9a). Source: apps/<id>/app.yaml `stores`, whose record
// shape tooling/store/store-record.mjs owns. A pending record is the owner's:
// the ids are read from a signed-in console, and nothing a record lacks is
// invented. assert-store-identity.mjs prints OWNER-GATED for a pending record
// on an armed channel and fails one on a served channel.
import { RECORD_STATES } from '../../store/store-record.mjs';
import { readAppYaml } from './tree.mjs';

export const name = 'store records';
export const guard = 'node tooling/ci/assert-store-identity.mjs';

export function read(root, id) {
  const y = readAppYaml(root, id);
  if (!y.ok && y.missing) return { state: 'NEXT', detail: 'no app.yaml yet: the stamp writes one record per store channel', command: 'the stamp step above', guard };
  if (!y.ok) return { lost: y.why };
  const stores = y.doc?.stores;
  if (stores === null || typeof stores !== 'object' || Object.keys(stores).length === 0) {
    return { lost: `apps/${id}/app.yaml declares no \`stores\` records, so no channel's record can be read` };
  }
  const unknown = Object.entries(stores).filter(([, r]) => !RECORD_STATES.includes(r?.state)).map(([c]) => c);
  if (unknown.length) return { lost: `apps/${id}/app.yaml stores.${unknown[0]} has no state in ${RECORD_STATES.join('/')}` };
  const pending = Object.entries(stores).filter(([, r]) => r.state === 'pending').map(([c]) => c);
  if (pending.length === 0) return { state: 'DONE', detail: `${Object.keys(stores).length} channel record(s), every one issued`, guard };
  return {
    state: 'OWNER',
    detail: `pending: ${pending.join(', ')}`,
    owner: 'O-A4 — create the console records (ASC record, Play app, Partner Center name, snap name); ' +
      `the agent reads the issued ids back into apps/${id}/app.yaml stores`,
    guard,
  };
}
