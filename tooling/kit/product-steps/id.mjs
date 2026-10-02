// product-steps/id.mjs — step 1, every kind: the id is one contracts/app-id
// admits, and one no OTHER product already claims. Sources:
// contracts/app-id/app-id.js (the contract itself, imported) and the one
// claimed-id set (tooling/kit/product-set.mjs: every kind's ids, every Worker
// directory, Worker name and D1 database by stem, every *.nikatru.com host
// label). Every later step is keyed on the id, so a refused id stops the plan
// here.
//
// The contract is applied to every app, and to a NEW id of any kind; a product
// that already exists under its kind (services/edge-shield predates the
// contract, and a hyphen is a Worker's to carry) is held to the claimed set only.
// A claim on the id by another product is NEXT whether or not the id is new
// (rv2-newproduct-015): `platform` as an app would bind its APP_DB to the live
// platform_db, and stamp-app.mjs refuses the same claim before mason.
import { appIdProblems } from '../../../contracts/app-id/app-id.js';
import { clashesOf, describeClashes, kindsOf } from '../product-set.mjs';

export const name = 'id';
export const guard = 'node tooling/kit/stamp-app.mjs --vars <vars.json> --dry-run (refuses the id before mason)';
/** The command that refuses a bad or claimed id for each kind. An extension's new-tool.mjs
 *  and a hand-written site read no claimed set yet, so for those the set itself is named. */
export const GUARDS = {
  app: guard,
  service: 'node tooling/kit/stamp-service.mjs <id> --dry-run (refuses the id before writing)',
  extension: 'the claimed-id set, tooling/kit/product-set.mjs (new-tool.mjs checks the tool ids only)',
  site: 'the claimed-id set, tooling/kit/product-set.mjs (a site is hand-written; nothing stamps it)',
};

export function read(root, id, { kind = 'app' } = {}) {
  const guard = GUARDS[kind].replace('<id>', id);
  const { kinds, problems: kindProblems } = kindsOf(root, id);
  if (kindProblems.length) return { lost: kindProblems[0] };
  const exists = kinds.some((k) => k.kind === kind);
  const problems = kind === 'app' || !exists ? appIdProblems(id) : [];
  if (problems.length) {
    return {
      state: 'NEXT',
      detail: problems[0],
      command: 'choose an id contracts/app-id admits (contracts/app-id/README.md), then: node tooling/kit/new-product.mjs plan <id> --kind ' + kind,
      guard,
    };
  }
  const { clashes, problems: claimProblems } = clashesOf(root, id, kind);
  if (claimProblems.length) return { lost: claimProblems[0] };
  if (clashes.length) {
    return {
      state: 'NEXT',
      detail: describeClashes(id, clashes),
      command: `choose an id no other product claims, then: node tooling/kit/new-product.mjs plan <id> --kind ${kind}`,
      guard,
    };
  }
  const held = kind === 'app' || !exists ? 'is admitted by contracts/app-id' : `is the ${kind} in ${kinds.find((k) => k.kind === kind).source}`;
  return { state: 'DONE', detail: `"${id}" ${held}, and no other product claims it`, guard };
}
