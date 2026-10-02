// product-steps/worker-row.mjs — service step 3: the service's Worker has its
// row in tooling/platform-register.json (`servingWorker`, `appWorkers[i]` or
// `edgeWorkers[i]`, matched by `config`), so a lane can read its hosts, routes
// and crash-sink secret (rv2-newproduct-016). provision-backend.mjs step [6]
// writes an `appWorkers` row for a stamped Worker, and its `--check` names every
// Worker directory the register has no row for.
import { REGISTER, registerRowOf, workerConfigOf } from './worker-config.mjs';

export const name = 'register row';
export const guard = 'node tooling/scripts/provision-backend.mjs --check';

export function read(root, id, { kind = 'service' } = {}) {
  const w = workerConfigOf(root, id, kind);
  if (w.lost) return { lost: w.lost };
  if (!w.config) return { state: 'NEXT', detail: 'no Worker yet, so no register row to write', command: 'the stamp step above', guard };
  const r = registerRowOf(root, w.config);
  if (r.lost) return { lost: r.lost };
  if (r.none) {
    return {
      state: 'NEXT',
      detail: `${REGISTER} has no row whose config is ${w.config}`,
      command: `node tooling/scripts/provision-backend.mjs ${id} (step [6] writes the appWorkers row)`,
      guard,
    };
  }
  return { state: 'DONE', detail: `${REGISTER} ${r.field} names ${w.config}`, guard };
}
