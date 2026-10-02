// product-steps/crash-sink.mjs — app and service: the product's own Worker
// reports its crashes to a sink a deploy actually delivers (rv2-newproduct-001).
// Sources: the Worker's tooling/platform-register.json row (`dsnSecret`) and
// .github/workflows/deploy-workers.yml `on.workflow_call.secrets`. A secret the
// called workflow does not declare reads as EMPTY there, so the Worker would
// deploy with no crash sink and a green smoke: assert-worker-error-sink.mjs
// refuses it. The secret's VALUE is the owner's (O-E1) and no read of this tree
// can see it; the detail says so rather than claiming it.
//
// A client-only app has no Worker of its own (the shared platform Worker and the
// one client GlitchTip project serve it), so the step is DONE by the declaration.
// An edge Worker reads no DSN by design (worker-set.mjs), so it owes none.
import { parseWorkflow } from '../../ci/workflow-scan.mjs';
import { REGISTER, registerRowOf, workerConfigOf } from './worker-config.mjs';

export const name = 'crash sink';
export const guard = 'node tooling/ci/assert-worker-error-sink.mjs';
export const DEPLOY_WORKFLOW = '.github/workflows/deploy-workers.yml';

/** The names `on.workflow_call.secrets` declares, read off workflow-scan.mjs's one
 *  comment-blanked parse of the file — the question assert-worker-error-sink.mjs asks
 *  (its declaredCallSecrets), paired with it in new-product-plan.test.mjs. */
export function declaredCallSecrets(wf) {
  const names = new Set();
  let inCall = -1;
  let inSecrets = -1;
  for (const { text: l } of wf.lines) {
    if (l.trim() === '') continue;
    const ind = l.length - l.trimStart().length;
    if (/^\S/.test(l) && !/^on:\s*(#.*)?$/.test(l)) { inCall = -1; inSecrets = -1; continue; }
    if (/^\s+workflow_call:\s*(#.*)?$/.test(l)) { inCall = ind; inSecrets = -1; continue; }
    if (inCall >= 0 && ind <= inCall) { inCall = -1; inSecrets = -1; }
    if (inCall >= 0 && /^\s+secrets:\s*(#.*)?$/.test(l)) { inSecrets = ind; continue; }
    if (inSecrets >= 0) {
      if (ind <= inSecrets) { inSecrets = -1; continue; }
      const m = l.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(#.*)?$/);
      if (m && ind === inSecrets + 2) names.add(m[1]);
    }
  }
  return names;
}

export function read(root, id, { kind = 'app' } = {}) {
  const w = workerConfigOf(root, id, kind);
  if (w.lost) return { lost: w.lost };
  if (w.missing) return { state: 'NEXT', detail: 'no app.yaml yet: the stamp decides whether there is a Worker', command: 'the stamp step above', guard };
  if (w.config === null && kind === 'app') {
    return { state: 'DONE', detail: 'client-only (no hosts.api): no Worker of its own, so no Worker crash sink is owed', guard };
  }
  if (w.config === null) return { state: 'NEXT', detail: 'no Worker yet', command: 'the stamp step above', guard };
  const r = registerRowOf(root, w.config);
  if (r.lost) return { lost: r.lost };
  const provision = `node tooling/scripts/provision-backend.mjs ${id} (step [6] writes the row with its dsnSecret and prints the two lines that deliver it)`;
  if (r.none) return { state: 'NEXT', detail: `${REGISTER} has no row for ${w.config}, so no crash-sink secret is named`, command: provision, guard };
  if (r.field.startsWith('edgeWorkers')) return { state: 'DONE', detail: `${r.field}: an edge Worker reads no DSN`, guard };
  const secret = r.row?.dsnSecret;
  if (typeof secret !== 'string' || secret === '') {
    return { state: 'NEXT', detail: `${REGISTER} ${r.field} names no dsnSecret`, command: provision, guard: 'node tooling/ci/worker-set.mjs --for-deploy' };
  }
  const owner = `the value of ${secret} is the owner's (O-E1): gh secret set ${secret}; no read of this tree can see it`;
  if (r.field.startsWith('appWorkers')) {
    const wf = parseWorkflow(root, DEPLOY_WORKFLOW);
    if (wf === null) return { lost: `${DEPLOY_WORKFLOW} does not exist, so whether ${secret} is delivered cannot be read` };
    const declared = declaredCallSecrets(wf);
    if (declared.size === 0) {
      return { lost: `${DEPLOY_WORKFLOW} declares no on.workflow_call.secrets at all, so whether ${secret} is delivered cannot be read` };
    }
    if (!declared.has(secret)) {
      return {
        state: 'NEXT',
        detail: `${r.field} names ${secret}, and ${DEPLOY_WORKFLOW} does not declare it under on.workflow_call.secrets, so a deploy delivers it EMPTY`,
        command: `declare ${secret} under on.workflow_call.secrets in ${DEPLOY_WORKFLOW} and pass it by name from ci.yml's deploy-workers: call`,
        owner,
        guard,
      };
    }
  }
  return { state: 'DONE', detail: `${r.field} names ${secret}, and the deploy delivers it; ${owner}`, guard };
}
