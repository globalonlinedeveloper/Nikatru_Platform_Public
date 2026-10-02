// product-steps/site-dir.mjs — site step 2: the site's deploy root exists and is
// in the site set (rv2-newproduct-017). Source: sites/<id>/index.html, read
// through tooling/ci/site-set.mjs, the set ci.yml now feeds both site guards
// (assert-web-cache-policy.mjs, check-site-integrity.mjs), so a site in it is
// graded on its first run. A page is hand-written HTML: there is no generator
// to run, and a directory with no index.html is site-set.mjs's finding.
import { siteSet, SITE_ENTRY } from '../../ci/site-set.mjs';

export const name = 'site directory';
export const guard = 'node tooling/ci/site-set.mjs';

export function read(root, id) {
  const set = siteSet(root);
  if (set === null) return { lost: 'sites/ does not exist, so no site can be read' };
  if (set.sites.includes(id)) {
    return { state: 'DONE', detail: `sites/${id}/${SITE_ENTRY} is in the site set, so ci.yml's two site guards claim it`, guard };
  }
  return {
    state: 'NEXT',
    detail: set.strays.includes(id) ? `sites/${id}/ exists and ships no ${SITE_ENTRY}` : `sites/${id}/ does not exist`,
    command: `write sites/${id}/${SITE_ENTRY} (hand-written HTML; the shared chrome contract grades it), then: node tooling/ci/check-site-integrity.mjs . sites/${id}`,
    guard,
  };
}
