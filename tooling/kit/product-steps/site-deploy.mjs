// product-steps/site-deploy.mjs — site step 3: something deploys the site. Source:
// the workflows' code (comments stripped): a workflow that names `sites/<id>`
// deploys it (deploy-web.yml's `site:` job deploys sites/nikatru). A site no
// workflow names is served, if at all, by a Cloudflare Pages Git binding that
// lives outside this repository (tooling/github-org.json says which), so its
// state is UNREAD here — named, and neither a pass nor a finding. Creating a
// Pages project is the owner's Cloudflare write.
import { parseAllWorkflows, WORKFLOW_DIR } from '../../ci/workflow-scan.mjs';

export const name = 'deploy';
export const guard = 'node tooling/ci/assert-lane-coverage.mjs (claims the site; the deploy itself is the Pages project\'s)';

export function read(root, id) {
  const workflows = parseAllWorkflows(root);
  if (workflows.length === 0) return { lost: `${WORKFLOW_DIR} holds no workflow this could read, so no deploy can be read` };
  const deploys = workflows.filter((wf) => /\/deploy-[^/]*\.ya?ml$/.test(wf.rel));
  if (deploys.length === 0) return { lost: `${WORKFLOW_DIR} holds no deploy-*.yml, so no deploy can be read` };
  const want = new RegExp(`(^|[\\s'"=])sites/${id}(/|[\\s'"]|$)`);
  const deploying = deploys.filter((wf) => wf.lines.some(({ text }) => want.test(text))).map((wf) => wf.rel);
  if (deploying.length) return { state: 'DONE', detail: `${deploying.join(', ')} names sites/${id}`, guard };
  return {
    state: 'UNREAD',
    detail: `no deploy workflow names sites/${id}: a Cloudflare Pages Git binding outside this repository serves it, if anything does`,
    owner: `the owner's Pages project bound to sites/${id} (a Cloudflare write; tooling/github-org.json records the bindings)`,
    guard,
  };
}
