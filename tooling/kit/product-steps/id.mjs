// product-steps/id.mjs — step 1: the id is one contracts/app-id admits.
// Source: contracts/app-id/app-id.js (the contract itself, imported). Every later
// step is keyed on the id, so a refused id stops the plan here.
import { appIdProblems } from '../../../contracts/app-id/app-id.js';

export const name = 'id';
export const guard = 'node tooling/kit/stamp-app.mjs --vars <vars.json> --dry-run (refuses the id before mason)';

export function read(root, id) {
  const problems = appIdProblems(id);
  if (problems.length === 0) return { state: 'DONE', detail: `"${id}" is admitted by contracts/app-id`, guard };
  return {
    state: 'NEXT',
    detail: problems[0],
    command: 'choose an id contracts/app-id admits (contracts/app-id/README.md), then: node tooling/kit/new-product.mjs plan <id>',
    guard,
  };
}
