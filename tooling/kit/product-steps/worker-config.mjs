// product-steps/worker-config.mjs — where a product's own Worker lives, and the
// platform-register row that names it. Shared by the readers that ask a
// question of a Worker (backend, register row, crash sink, monitor row).
//   · an app: services/<id>-api/wrangler.jsonc, when its app.yaml declares
//     `hosts.api` (a client-only app has no Worker of its own);
//   · a service: the Worker directory the service set derives
//     (tooling/kit/product-set.mjs).
import { registerRows, REGISTER } from '../../ci/worker-set.mjs';
import { serviceConfigOf } from './service-stamp.mjs';
import { readAppYaml, readJsonAt } from './tree.mjs';

export { REGISTER };

/** `{ config }` (repo-relative, or null for a client-only app), `{ missing }` before
 *  an app's stamp, or `{ lost }`. */
export function workerConfigOf(root, id, kind) {
  if (kind === 'service') return { config: serviceConfigOf(root, id) };
  const y = readAppYaml(root, id);
  if (!y.ok && y.missing) return { missing: true };
  if (!y.ok) return { lost: y.why };
  const api = y.doc?.hosts?.api;
  return { config: typeof api === 'string' && api !== '' ? `services/${id}-api/wrangler.jsonc` : null, api };
}

/** The register row whose `config` is `config`: `{ field, row }`, `{ none }`, or `{ lost }`. */
export function registerRowOf(root, config) {
  const r = readJsonAt(root, REGISTER);
  if (!r.ok) return { lost: `${r.why}, so no Worker's register row can be read` };
  const hit = registerRows(r.value).find(({ row }) => String(row?.config ?? '').replace(/\\/g, '/') === config);
  return hit ? { field: hit.field, row: hit.row, register: r.value } : { none: true };
}
