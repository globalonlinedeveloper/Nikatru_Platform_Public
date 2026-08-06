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

  test('a record step behind a step-level `if:` fails — the job can end without it', () => {
    const wf = `name: web
on: [push]
jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - name: Record the deployed SHA
        if: github.ref == 'refs/heads/main'
        run: node tooling/ci/record-deployment.mjs subly-web https://subly.nikatru.com
`;
    const { code, out } = run(served({ 'deploy-web.yml': wf }));
    assert.equal(code, 1, out);
    assert.match(out, /step-level `if:`/);
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
