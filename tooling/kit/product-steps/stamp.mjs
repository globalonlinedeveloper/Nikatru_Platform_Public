// product-steps/stamp.mjs — step 3: the app is stamped (1a/1b). Sources:
// apps/<id>/app.yaml and apps/<id>/pubspec.yaml (what the brick writes) and the
// catalog/apps.json row (what post_gen's site chain renders from app.yaml).
//
// THE C6 MEETING POINT (plan-new-product-command.md §4). When
// tooling/ci/flutter-release-build.mjs exists in the tree read, DONE also needs
// `flutter-release-build.mjs <id> web web --print --root <root>` to exit 0: the
// stamped declaration composes a build. It is spawned read-only, by path, and
// nothing is imported from it. When it is absent the detail says so.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APPS_CATALOG, appYamlRel, catalogRowOf } from './tree.mjs';

export const name = 'stamp';
export const guard = 'node tooling/sites/regen.mjs --check (a stamp post-condition of tooling/kit/stamp-app.mjs)';
export const COMPOSER_REL = 'tooling/ci/flutter-release-build.mjs';

export function read(root, id) {
  const command = 'node tooling/kit/stamp-app.mjs --vars <vars.json with app_id "' + id + '" and the issued pages_origin>';
  const missing = [appYamlRel(id), `apps/${id}/pubspec.yaml`].filter((rel) => !existsSync(join(root, ...rel.split('/'))));
  if (missing.length) return { state: 'NEXT', detail: `${missing.join(' and ')} not in the tree`, command, guard };
  const c = catalogRowOf(root, id);
  if (c.lost) return { lost: c.lost };
  if (c.row === null) {
    return { state: 'NEXT', detail: `${APPS_CATALOG} has no "${id}" row: the site chain has not rendered this app.yaml`, command, guard };
  }
  const composer = join(root, ...COMPOSER_REL.split('/'));
  if (!existsSync(composer)) {
    return { state: 'DONE', detail: `stamped and catalogued; ${COMPOSER_REL} is absent, so the build-composes check is absent`, guard };
  }
  const r = spawnSync(process.execPath, [composer, id, 'web', 'web', '--print', '--root', root], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    const first = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n')[0] || `exit ${r.status}`;
    return {
      state: 'NEXT',
      detail: `stamped, but the declaration does not compose a web build: ${first}`,
      command: `node ${COMPOSER_REL} ${id} web web --print`,
      guard: `node ${COMPOSER_REL} ${id} web web --print`,
    };
  }
  return { state: 'DONE', detail: `stamped, catalogued (status ${c.row.status}), and ${COMPOSER_REL} ${id} web web --print composes`, guard };
}
