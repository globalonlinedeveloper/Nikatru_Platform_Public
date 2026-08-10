// ─────────────────────────────────────────────────────────────────────────────
// publish-records.test.mjs — negative cases for [10]D-9's workflow limb.
//
// 🔴 THE TWO CASES THAT MATTER WERE RUN AGAINST THE REAL TREE, NOT AGAINST THE
// FIXTURES BELOW, and the fixtures exist only because the real-tree mutation
// cannot be left in place:
//
//   · delete the "Record the deployed SHA" step from .github/workflows/
//     deploy-web.yml  ⇒  exit 1, "the web channel is SERVED and … never records
//     subly-web".
//   · change submit-play.yml's `--dry-run` to `--submit`  ⇒  exit 1, "can
//     perform a REAL submission … and no later step records it".
//
// Both were performed on 2026-08-06 against the shipping workflows and both went
// red; the files were restored from a byte snapshot and `git hash-object`
// confirmed identity. This repo has a recorded case (assert-seams-wired.mjs) of
// six fixture tests passing against a guard whose central check could not fail,
// because a fixture written by the same hand encodes the same misunderstanding —
// so the fixtures here are for the branches the real tree CANNOT exhibit today
// (there is no publishing invocation and no store record anywhere in the tree),
// and the real tree carries the two that it can.
//
// ── 🔴 AND THAT WARNING CAME TRUE IN THIS VERY FILE, 2026-08-09 ─────────────
// The rule-6 fixture ("a record step behind a step-level `if:` fails") passed
// against a guard whose rule-6 scan could only ever see a job's FIRST step —
// because the fixture's job had exactly one step, and it was the record step.
// Every real deploy job puts the record LAST, so the rule was dead on every
// lane it was written for. Proven the only way it could be:
//
//   · put `if: github.actor == 'nobody'` on deploy-web.yml's real record step
//     ⇒ `ok  publish records`, exit 0. After the repair: exit 1.
//
// The rule-6 fixtures below therefore build a FOUR-STEP job with the record
// step last, which is the shape under test. Restored from a byte snapshot and
// re-verified green immediately afterwards.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '../..');
const GUARD = join(CI_DIR, 'assert-publish-records.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-pubrec-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let n = 0;
/** A minimal repository: register + apps.json + the workflows it names. The
 *  guard reads NOTHING else, which is itself the claim — the subject set comes
 *  from the register, so a fixture that names no lane is a fixture the guard
 *  must refuse rather than pass. */
function fixture({ channels, workflows }) {
  const root = join(TMP, `fx${n++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'sites/_shared/_data'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, 'tooling/channel-register.json'), JSON.stringify({ channels }, null, 2));
  writeFileSync(
    join(root, 'sites/_shared/_data/apps.json'),
    JSON.stringify([{ slug: 'subly', platforms: ['web', 'android'], status: 'live' }], null, 2),
  );
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github/workflows', name), body);
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const WEB_ROW = {
  id: 'web',
  kind: 'web',
  served: true,
  submittable: false,
  platforms: ['web'],
  deploymentEnvironment: '{app}-web',
  lane: { workflow: '.github/workflows/deploy-web.yml', job: 'deploy-web' },
};

const DEPLOY_WEB_OK = `name: web
on: [push]
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - name: Record the deployed SHA
        run: node tooling/ci/record-deployment.mjs subly-web https://subly.nikatru.com
`;

/** A store row whose submission workflow is written by the test. */
const storeRow = (over = {}) => ({
  id: 'android-play',
  kind: 'store',
  served: false,
  submittable: true,
  platforms: ['android'],
  deploymentEnvironment: '{app}-android-play',
  submission: {
    script: 'tooling/release/submit-play.mjs',
    workflow: '.github/workflows/submit-play.yml',
    job: 'dry-run',
  },
  ...over,
});

const REHEARSAL_WF = `name: play
on: [workflow_dispatch]
jobs:
  dry-run:
    runs-on: ubuntu-24.04
    steps:
      - run: node tooling/release/submit-play.mjs --dry-run --app subly
`;

const submitWorkflow = (steps) => `name: play
on: [workflow_dispatch]
jobs:
  dry-run:
    runs-on: ubuntu-24.04
    steps:
${steps}
`;

/** A tree exercising the SERVED limb. It still carries a submittable row and a
 *  healthy rehearsal lane, because a register with no submittable channel is
 *  COVERAGE LOST by design — the floor refuses to grade the deploy limb over a
 *  tree where the submission limb has quietly lost its subject. */
const served = (workflows) =>
  fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'submit-play.yml': REHEARSAL_WF, ...workflows } });

describe('assert-publish-records — the SERVED lane must record what it shipped', () => {
  test('a served channel whose lane job records its environment passes', () => {
    const { code, out } = run(served({ 'deploy-web.yml': DEPLOY_WEB_OK }));
    assert.equal(code, 0, out);
    assert.match(out, /1 served channel\(s\) → 1 required environment\(s\)/);
  });

  test('a served channel whose lane job records NOTHING fails', () => {
    const wf = DEPLOY_WEB_OK.replace(/      - name.*\n.*\n/, '      - run: echo deployed\n');
    const { code, out } = run(served({ 'deploy-web.yml': wf }));
    assert.equal(code, 1, out);
    assert.match(out, /is SERVED and .* never records "subly-web"/);
  });

  test('a record step with continue-on-error fails — a green job with no record', () => {
    const wf = DEPLOY_WEB_OK.replace(
      '      - name: Record the deployed SHA\n',
      '      - name: Record the deployed SHA\n        continue-on-error: true\n',
    );
    const { code, out } = run(served({ 'deploy-web.yml': wf }));
    assert.equal(code, 1, out);
    assert.match(out, /continue-on-error: true/);
  });

  // ── RULE 6, RE-FIXTURED ────────────────────────────────────────────────────
  // 🔴 THE OLD FIXTURE FOR THIS RULE PUT THE RECORD STEP FIRST, and that is the
  // only reason it passed. `stepGuards` set `inStep` on a job's first step
  // marker and `break`-ed on the second, so it inspected the FIRST STEP ONLY —
  // and a record step is the LAST step of every real deploy job. Mutation-proven
  // on the shipping tree 2026-08-09: `if: github.actor == 'nobody'` on
  // deploy-web.yml's record step still printed `ok  publish records`.
  //
  // Every fixture below therefore puts the record step LAST, behind a step that
  // declares `id: deploy` — the shape the real lanes have. A fixture whose job
  // has one step cannot distinguish a working scan from a dead one.
  const laneWith = (condition) => `name: web
on: [push]
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build
        run: echo built
      - name: Deploy to Cloudflare Pages
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          command: pages deploy build/web --project-name=subly
      - name: Smoke — the live site serves THIS build
        run: node tooling/ops/post-deploy-smoke.mjs --url https://subly.nikatru.com/version.json
      - name: Record the deployed SHA
${condition === null ? '' : `        if: ${condition}\n`}        run: node tooling/ci/record-deployment.mjs subly-web https://subly.nikatru.com
`;

  test('THE MUTANT THE OLD FIXTURE COULD NOT CATCH: a narrowing `if:` on a record step that is LAST fails', () => {
    const { code, out } = run(served({ 'deploy-web.yml': laneWith("github.actor == 'nobody'") }));
    assert.equal(code, 1, out);
    assert.match(out, /NARROWING/);
    assert.match(out, /does not begin with `always\(\)`/);
  });

  test('rule 6 says out loud how many record steps it graded — 0 would be a dead rule', () => {
    const { code, out } = run(served({ 'deploy-web.yml': laneWith(null) }));
    assert.equal(code, 0, out);
    assert.match(out, /RULE 6 .* graded 1 record step\(s\)/);
  });

  test("the widening `always() && steps.deploy.outcome == 'success'` is ACCEPTED and printed", () => {
    const { code, out } = run(served({ 'deploy-web.yml': laneWith("always() && steps.deploy.outcome == 'success'") }));
    assert.equal(code, 0, out);
    assert.match(out, /a WIDENING of the inherited `success\(\)`/);
    assert.match(out, /1 carry the one accepted widening/);
  });

  test('the same condition wrapped in `${{ }}` is the same condition', () => {
    const { code } = run(served({ 'deploy-web.yml': laneWith("${{ always() && steps.deploy.outcome == 'success' }}") }));
    assert.equal(code, 0);
  });

  test('a BARE `always()` fails — it would record a deploy step that failed', () => {
    const { code, out } = run(served({ 'deploy-web.yml': laneWith('always()') }));
    assert.equal(code, 1, out);
    assert.match(out, /records even when the deploy step FAILED/);
  });

  test('a WEAKER predicate than `== \'success\'` fails — the door opens only this wide', () => {
    const { code, out } = run(served({ 'deploy-web.yml': laneWith("always() && steps.deploy.outcome != 'skipped'") }));
    assert.equal(code, 1, out);
    assert.match(out, /is not `steps\.<id>\.outcome == 'success'`/);
  });

  test('THE RENAMED ID: conditioning on a step id no EARLIER step declares fails', () => {
    // GitHub resolves `steps.deployy.outcome` to null rather than erroring, so
    // the record would silently never be written and the run would still pass.
    const { code, out } = run(served({ 'deploy-web.yml': laneWith("always() && steps.deployy.outcome == 'success'") }));
    assert.equal(code, 1, out);
    assert.match(out, /NO EARLIER step in job "deploy-web" declares/);
    assert.match(out, /earlier ids: `deploy`/);
  });

  test('THE FORWARD REFERENCE: an id declared by a LATER step is not an earlier id', () => {
    // `steps.<later>.outcome` is `skipped` while this step is evaluated, so the
    // record can never run — the same silent skip, written a different way.
    const wf = laneWith("always() && steps.after.outcome == 'success'") + `      - name: Afterwards
        id: after
        run: echo done
`;
    const { code, out } = run(served({ 'deploy-web.yml': wf }));
    assert.equal(code, 1, out);
    assert.match(out, /NO EARLIER step in job "deploy-web" declares/);
  });

  test('an `id:` nested inside a `with:` mapping is NOT the step\'s id', () => {
    // The step key column is locked to the first step's, so a `with: id:` input
    // cannot lend its name to the step — otherwise a workflow could satisfy the
    // earlier-id rule with an action input that is not a step at all.
    const wf = `name: web
on: [push]
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - name: Deploy
        uses: some/action@v1
        with:
          id: deploy
      - name: Record the deployed SHA
        if: always() && steps.deploy.outcome == 'success'
        run: node tooling/ci/record-deployment.mjs subly-web https://subly.nikatru.com
`;
    const { code, out } = run(served({ 'deploy-web.yml': wf }));
    assert.equal(code, 1, out);
    assert.match(out, /NO EARLIER step in job "deploy-web" declares/);
  });

  test('the environment set is DERIVED — a second app makes a second requirement', () => {
    const root = served({ 'deploy-web.yml': DEPLOY_WEB_OK });
    writeFileSync(
      join(root, 'sites/_shared/_data/apps.json'),
      JSON.stringify([
        { slug: 'subly', platforms: ['web'], status: 'live' },
        { slug: 'drift', platforms: ['web'], status: 'live' },
      ]),
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /never records "drift-web"/);
  });
});

// ── RULE 6b · THE RECORD STEPS RULE 6 CANNOT SEE ─────────────────────────────
// 🔴 RULE 6 GRADES ONLY REGISTER-DECLARED CHANNEL LANES. deploy-workers.yml
// records `serviceEnvironments` — the Workers — which no channel row declares,
// so its two record steps were printed by the flat scan and graded by NOTHING.
// The 2026-08-09 change gave them `always() && steps.deploy.outcome ==
// 'success'`, which made an ungraded `if:` load-bearing: rename either wrangler
// step's `id:` and `steps.deploy.outcome` resolves to null, the record never
// runs, and the job stays green. That is the run-144 failure with a different
// file name.
//
// 6b carries NO policy — it does not care which condition a non-lane workflow
// chooses. It asserts only the thing that is unconditionally a bug: an `if:`
// naming an id no EARLIER step declares. Proven against the REAL tree by
// renaming deploy-workers.yml's `id: deploy` ⇒ exit 1.
describe('assert-publish-records — rule 6b, a dangling step reference anywhere', () => {
  const workersLane = (id, condition) => `name: workers
on: [push]
jobs:
  subly-api:
    runs-on: ubuntu-24.04
    steps:
      - name: Migrations
        uses: cloudflare/wrangler-action@v3
      - name: Deploy the Worker
        id: ${id}
        uses: cloudflare/wrangler-action@v3
      - name: Smoke
        run: node tooling/ops/post-deploy-smoke.mjs --url https://api.nikatru.com/v1/health
      - name: Record the deployed SHA
        if: ${condition}
        run: node tooling/ci/record-deployment.mjs subly-api https://api.nikatru.com
`;

  // The register in these fixtures declares deploy-web.yml as the only lane, so
  // workers.yml is exactly the "outside any declared lane" case.
  const tree = (wf) => served({ 'deploy-web.yml': DEPLOY_WEB_OK, 'workers.yml': wf });

  test('a matching id in a NON-LANE workflow passes, and 6b says it looked', () => {
    // 1, not 2: 6b counts record steps that CARRY an `if:`, and this fixture's
    // lane record step (DEPLOY_WEB_OK) has none — it rides the inherited
    // `success()`. The count is the rule's reach, so it must track the
    // conditioned steps rather than the record steps.
    const { code, out } = run(tree(workersLane('deploy', "always() && steps.deploy.outcome == 'success'")));
    assert.equal(code, 0, out);
    assert.match(out, /RULE 6b .* checked 1 conditioned record step\(s\)/);
  });

  test('THE RENAMED ID ONE FILE OVER: rule 6 passes it, 6b fails it', () => {
    const { code, out } = run(tree(workersLane('deployy', "always() && steps.deploy.outcome == 'success'")));
    assert.equal(code, 1, out);
    assert.match(out, /workers\.yml/);
    assert.match(out, /NO EARLIER step in job "subly-api" declares/);
    assert.match(out, /earlier ids: `deployy`/);
    // …and rule 6 was green on the same tree: it graded only the lane's step.
    assert.match(out, /RULE 6 .* graded 1 record step\(s\)/);
  });

  test('a `conclusion` reference is checked too — the same null resolves either way', () => {
    const { code, out } = run(tree(workersLane('deployy', "always() && steps.deploy.conclusion == 'success'")));
    assert.equal(code, 1, out);
    assert.match(out, /NO EARLIER step in job "subly-api" declares/);
  });

  test('6b holds NO policy — a non-lane workflow may condition however it likes', () => {
    // `github.ref == …` is a NARROWING condition and rule 6 would reject it on a
    // declared lane. Outside one, 6b must not object: it names no dangling id.
    const { code, out } = run(tree(workersLane('deploy', "github.ref == 'refs/heads/main'")));
    assert.equal(code, 0, out);
  });

  test('a record step with no `if:` at all is not counted by 6b', () => {
    const wf = workersLane('deploy', "always() && steps.deploy.outcome == 'success'")
      .replace("        if: always() && steps.deploy.outcome == 'success'\n", '');
    const { code, out } = run(tree(wf));
    assert.equal(code, 0, out);
    assert.match(out, /RULE 6b .* checked 0 conditioned record step\(s\)/);
  });
});

describe('assert-publish-records — a real submission must write a record', () => {
  const REAL_SUBMIT = submitWorkflow('      - run: node tooling/release/submit-play.mjs --submit --app subly');

  test('a rehearsal (`--dry-run`) needs no record and passes', () => {
    const { code, out } = run(
      fixture({
        channels: [WEB_ROW, storeRow()],
        workflows: {
          'deploy-web.yml': DEPLOY_WEB_OK,
          'submit-play.yml': submitWorkflow('      - run: node tooling/release/submit-play.mjs --dry-run --app subly'),
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /0 of 1 submission invocation\(s\) can perform a REAL submission/);
  });

  test('a REAL submission with no record step fails', () => {
    const { code, out } = run(
      fixture({
        channels: [WEB_ROW, storeRow()],
        workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': REAL_SUBMIT },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /can perform a REAL submission .* and no later step records it/s);
  });

  test('FAIL-CLOSED: a `--dry-run` assembled from an expression is NOT a rehearsal', () => {
    const wf = submitWorkflow('      - run: node tooling/release/submit-play.mjs ${{ inputs.mode }} --dry-run --app subly');
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': wf } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /not statically a rehearsal/);
  });

  test('a REAL submission followed by a proper in_review record PASSES', () => {
    const wf = submitWorkflow(
      '      - run: node tooling/release/submit-play.mjs --submit --app subly\n' +
        '      - name: Record the submission\n' +
        '        run: node tooling/ci/record-deployment.mjs subly-android-play --state in_review --listing-url https://play.google.com/store/apps/details?id=com.nikatru.subly',
    );
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': wf } }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 of 1 submission invocation\(s\) can perform a REAL submission/);
  });

  test('a record written BEFORE the submit step does not count', () => {
    const wf = submitWorkflow(
      '      - name: Record the submission\n' +
        '        run: node tooling/ci/record-deployment.mjs subly-android-play --state in_review --listing-url https://play.google.com/x\n' +
        '      - run: node tooling/release/submit-play.mjs --submit --app subly',
    );
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': wf } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no later step records it/);
  });

  test('a rehearsal job that writes a record anyway fails — a fiction in the ledger', () => {
    const wf = submitWorkflow(
      '      - run: node tooling/release/submit-play.mjs --dry-run --app subly\n' +
        '      - run: node tooling/ci/record-deployment.mjs subly-android-play --state in_review --listing-url https://play.google.com/x',
    );
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': wf } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /a fiction is not/);
  });
});

describe('assert-publish-records — SUBMITTED is not LIVE', () => {
  const withState = (state, extra = '--listing-url https://play.google.com/x') =>
    submitWorkflow(
      '      - run: node tooling/release/submit-play.mjs --submit --app subly\n' +
        `      - run: node tooling/ci/record-deployment.mjs subly-android-play --state ${state} ${extra}`,
    );

  for (const state of ['live', 'rejected', 'pulled']) {
    test(`a submitting run may not record --state ${state}`, () => {
      const { code, out } = run(
        fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': withState(state) } }),
      );
      assert.equal(code, 1, out);
      assert.match(out, /A submitting run knows one fact — it submitted/);
    });
  }

  test('a store record with no --state fails — no default may decide this', () => {
    const wf = submitWorkflow(
      '      - run: node tooling/release/submit-play.mjs --submit --app subly\n' +
        '      - run: node tooling/ci/record-deployment.mjs subly-android-play --listing-url https://play.google.com/x',
    );
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': wf } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no `--state`/);
  });

  test('a store record with no --listing-url fails', () => {
    const { code, out } = run(
      fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': withState('in_review', '') } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /no `--listing-url`/);
  });
});

describe('assert-publish-records — the floor cannot range over zero', () => {
  test('COVERAGE LOST when the register declares no served channel', () => {
    const { code, out } = run(fixture({ channels: [storeRow()], workflows: { 'submit-play.yml': submitWorkflow('      - run: node tooling/release/submit-play.mjs --dry-run --app subly') } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /REQUIRED_COVERAGE\.servedRows is 0/);
  });

  test('COVERAGE LOST when the register declares no submittable channel', () => {
    // 🔴 THE CASE THIS WHOLE INCREMENT EXISTS FOR, RUN BACKWARDS. D-9's second
    // limb passed for a month because it quantified over an empty set. A tree
    // whose submittable rows have gone is a tree where this guard would grade
    // the deploy limb, print ok, and cover no submission lane at all — the same
    // shape, one layer up. So it refuses instead of passing.
    const { code, out } = run(fixture({ channels: [WEB_ROW], workflows: { 'deploy-web.yml': DEPLOY_WEB_OK } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /REQUIRED_COVERAGE\.submittableRows is 0/);
  });

  test('COVERAGE LOST when the register is empty in both directions', () => {
    const { code, out } = run(fixture({ channels: [], workflows: {} }));
    assert.equal(code, 1, out);
    assert.match(out, /REQUIRED_COVERAGE\.servedRows is 0/);
  });

  test('COVERAGE LOST when no app declares the served channel\'s platforms', () => {
    const root = served({ 'deploy-web.yml': DEPLOY_WEB_OK });
    writeFileSync(join(root, 'sites/_shared/_data/apps.json'), JSON.stringify([{ slug: 'subly', platforms: ['ios'] }]));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /REQUIRED_COVERAGE\.requiredEnvironments is 0/);
  });

  test('COVERAGE LOST when a declared submission script is not in its declared job', () => {
    const { code, out } = run(
      fixture({
        channels: [WEB_ROW, storeRow()],
        workflows: { 'deploy-web.yml': DEPLOY_WEB_OK, 'submit-play.yml': submitWorkflow('      - run: echo nothing here') },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /and no step there runs it/);
  });

  test('COVERAGE LOST when a declared workflow file is missing', () => {
    const { code, out } = run(fixture({ channels: [WEB_ROW, storeRow()], workflows: { 'submit-play.yml': REHEARSAL_WF } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /that file does not exist/);
  });

  test('COVERAGE LOST when a declared job is missing from a workflow that exists', () => {
    const { code, out } = run(
      served({ 'deploy-web.yml': DEPLOY_WEB_OK.replace('  deploy-web:', '  renamed:') }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /that job is not there/);
  });
});

describe('assert-publish-records — against the REAL repository', () => {
  test('the shipping tree passes, and prints the emptiness of the publish branch', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /SUBMISSION-RECORD LIMB: 0 of \d+ submission invocation\(s\) can perform a REAL submission/);
    assert.match(r.stdout, /OWNER-GATED/);
  });

  test('every submittable channel in the real register is classified — none skipped', () => {
    const register = JSON.parse(spawnSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync('tooling/channel-register.json','utf8'))"], { cwd: ROOT, encoding: 'utf8' }).stdout);
    const submittable = register.channels.filter((c) => c.submittable === true).map((c) => c.id);
    assert.ok(submittable.length >= 1, 'the register must declare at least one submittable channel');
    const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8' });
    for (const id of submittable) assert.match(r.stdout, new RegExp(`${id}: \\d+ invocation`), `${id} was not classified`);
  });
});
