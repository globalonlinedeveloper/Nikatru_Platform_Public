// product-steps/bundle-join.mjs — step 12 (an app's; an extension's last): the
// product joins the bundle (D-a, H-S12). Source: the product's `status` in its
// own register — catalog/apps.json for an app, extensions/catalog/extensions.json
// for an extension — read for an app through the app catalogue reader and for
// an extension through the extension row reader, and the bundle register. The
// bundle's membership is derived from the LIVE products
// (tooling/bundle-availability.mjs), so a product that is not live yet waits on
// going live, and nothing here is a finding: AFTER-LIVE.
//
// ⏱ 2026-10-01 (rv2-newproduct-011). The stamp EXCLUDES the product it stamps,
// with the placeholder why of tooling/catalog/read.mjs (STAMPED_EXCLUSION_MARK),
// so its first commit keeps assert-bundle-availability.mjs limb F green. Live,
// the step is DONE only when every bundle row places the product by decision —
// a member, or an exclusion whose why is not the stamp's. A live product still
// carrying the placeholder, or placed by no row, is NEXT, and limb F is red on
// exactly that tree (paired in tooling/ci/test/new-product-plan.test.mjs).
import { extensionRowOf } from './extension-row.mjs';
import { catalogRowOf } from './tree.mjs';
import { BUNDLES_REGISTER, isStampedExclusion, memberSlugsOf, readBundles } from '../../catalog/read.mjs';

export const name = 'bundle join';
export const guard = 'node tooling/ci/assert-bundle-availability.mjs';

export function read(root, id, { kind = 'app' } = {}) {
  const c = kind === 'extension' ? extensionRowOf(root, id) : catalogRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) return { state: 'AFTER-LIVE', detail: 'no catalogue row yet; the bundle counts a product once it is live', guard };
  if (c.row.status !== 'live') {
    return { state: 'AFTER-LIVE', detail: `catalog status ${c.row.status}: the bundle counts a product once it is live`, guard };
  }
  const b = readBundles(root);
  if (!b.ok) return { lost: `${b.why}, so whether the bundle places "${id}" cannot be read` };
  const undecided = [];
  for (const row of b.rows) {
    const label = `${row.featureSet ?? '?'}@${row.version ?? '?'}`;
    if (memberSlugsOf(row).includes(id)) continue;
    const ex = (Array.isArray(row.excluded) ? row.excluded : []).find((x) => x?.slug === id);
    if (ex && !isStampedExclusion(ex)) continue;
    undecided.push(ex ? `${label} (the stamp's placeholder exclusion)` : `${label} (neither member nor excluded)`);
  }
  if (undecided.length === 0) {
    return { state: 'DONE', detail: 'catalog status live, and every bundle row places it by decision (a member, or excluded with a why)', guard };
  }
  return {
    state: 'NEXT',
    detail: `catalog status live, and ${BUNDLES_REGISTER} has not decided it: ${undecided.join('; ')}`,
    command: `add "${id}" as a member of a NEW featureSet version (and its lock entry), or replace the placeholder with the reason it stays out; then ${guard}`,
    guard,
  };
}
