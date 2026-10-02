// product-steps/service-stamp.mjs — service step 2: the service's Worker is
// stamped (rv2-newproduct-016). Source: services/<id>-api/wrangler.jsonc (what
// tooling/kit/stamp-service.mjs writes), or the Worker directory a service that
// predates the kit lives in (services/<id>). The Worker set
// (tooling/ci/worker-set.mjs) reads the same directories; a directory there with
// no wrangler.jsonc is its finding.
import { productsOf } from '../product-set.mjs';

export const name = 'stamp';
export const guard = 'node tooling/ci/worker-set.mjs';

/** The service's Worker config, repo-relative, or null when it has none. */
export function serviceConfigOf(root, id) {
  const hit = productsOf(root).products.find((p) => p.kind === 'service' && p.id === id);
  return hit ? hit.source : null;
}

export function read(root, id) {
  const { problems } = productsOf(root);
  if (problems.length) return { lost: problems[0] };
  const cfg = serviceConfigOf(root, id);
  if (cfg === null) {
    return {
      state: 'NEXT',
      detail: `no Worker directory services/${id}-api (or services/${id}) holds a wrangler.jsonc`,
      command: `node tooling/kit/stamp-service.mjs ${id}`,
      guard,
    };
  }
  return { state: 'DONE', detail: `${cfg} is in the Worker set`, guard };
}
