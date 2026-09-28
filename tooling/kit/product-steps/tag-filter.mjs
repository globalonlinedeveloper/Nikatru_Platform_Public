// product-steps/tag-filter.mjs — step 4: the app's release tag starts exactly
// one release lane. Sources: tooling/channel-register.json (which workflows are
// app lanes) and each workflow's ACTUAL `push: tags:` list, read with
// tag-owner.mjs's own exported readers. post_gen runs `tag-owner.mjs --write`
// after the site chain; this reader is what says NEXT when that did not happen.
import { actualOwners, lanesOfSurface, tagTriggeredWorkflows, CHANNEL_REGISTER_REL } from '../../ci/tag-owner.mjs';
import { readJsonAt } from './tree.mjs';

export const name = 'tag filter';
export const guard = 'node tooling/ci/tag-owner.mjs --check';

export function read(root, id) {
  const reg = readJsonAt(root, CHANNEL_REGISTER_REL);
  if (!reg.ok) return { lost: `${reg.why}, so no workflow can be named an app release lane` };
  const appLanes = new Set(lanesOfSurface(reg.value, 'app').map((l) => l.workflow));
  const tag = `${id}-v1.0.0`;
  const owners = actualOwners(tagTriggeredWorkflows(root), tag);
  const appOwners = owners.filter((rel) => appLanes.has(rel));
  if (owners.length === 1 && appOwners.length === 1) {
    return { state: 'DONE', detail: `${tag} starts ${appOwners[0]} and nothing else`, guard };
  }
  return {
    state: 'NEXT',
    detail: owners.length === 0 ? `no workflow's tags: list selects ${tag}` : `${tag} is selected by ${owners.join(', ')}`,
    command: 'node tooling/ci/tag-owner.mjs --write',
    guard,
  };
}
